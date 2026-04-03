"""Tests for the AI chat pipeline: step loop, snapshots, SSE ordering, and VCR hooks."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from app.core.config import settings
from app.core.deps import get_db
from app.core.security import create_access_token
from app.main import app
from app.models.deal import Deal
from app.models.message import Message
from app.models.session import ChatSession
from app.services.claude import (
    CHAT_TOOLS,
    ChatLoopResult,
    _SyntheticBlockStopEvent,
    _SyntheticTextEvent,
    _SyntheticToolJsonEvent,
    _SyntheticToolStartEvent,
    build_system_prompt,
    merge_usage_summary,
    stream_chat_loop,
    summarize_usage,
)
from app.services.deal_state import deal_state_to_dict
from app.services.panel import generate_ai_panel_cards
from httpx import ASGITransport, AsyncClient
from inline_snapshot import snapshot
from sqlalchemy import select

from tests.conftest import (
    TestingAsyncSessionLocal,
    async_create_deal,
    async_create_session_with_deal_state,
    async_create_vehicle,
)

SNAPSHOT_DIR = Path(__file__).parent / "snapshots" / "ai_pipeline"
VCR_CASSETTE = (
    Path(__file__).parent
    / "cassettes"
    / "test_ai_pipeline"
    / "test_generate_ai_panel_cards_vcr_smoke.yaml"
)


def _load_snapshot(name: str) -> str:
    return (SNAPSHOT_DIR / name).read_text()


def _assert_json_snapshot(name: str, payload: object) -> None:
    actual = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    assert actual == _load_snapshot(name)


def _normalize_tool_calls(tool_calls: list[dict]) -> list[dict]:
    normalized: list[dict] = []
    for tool_call in tool_calls:
        args = dict(tool_call["args"])
        for dynamic_key in ("deal_id", "vehicle_id"):
            if args.get(dynamic_key):
                args[dynamic_key] = f"<{dynamic_key}>"
        normalized.append({"name": tool_call["name"], "args": args})
    return normalized


def _tool_schema_contract() -> list[dict]:
    return [
        {
            "name": tool["name"],
            "description": tool["description"],
            "input_schema": tool["input_schema"],
        }
        for tool in CHAT_TOOLS
    ]


def _parse_sse(raw_event: str) -> tuple[str, dict]:
    event_name = "message"
    data: dict = {}
    for line in raw_event.strip().splitlines():
        if line.startswith("event: "):
            event_name = line.removeprefix("event: ")
        elif line.startswith("data: "):
            data = json.loads(line.removeprefix("data: "))
    return event_name, data


async def _collect_generator_events(generator) -> list[tuple[str, dict]]:
    events = []
    async for raw_event in generator:
        events.append(_parse_sse(raw_event))
    return events


async def _collect_response_events(response) -> list[tuple[str, dict]]:
    chunks: list[str] = []
    current: list[str] = []

    async for line in response.aiter_lines():
        if line:
            current.append(line)
            continue
        if current:
            chunks.append("\n".join(current))
            current = []

    if current:
        chunks.append("\n".join(current))

    return [_parse_sse(chunk) for chunk in chunks]


class FakeClaudeFinalMessage:
    def __init__(self, stop_reason: str) -> None:
        self.stop_reason = stop_reason
        self.usage = SimpleNamespace(
            cache_creation_input_tokens=0,
            cache_read_input_tokens=0,
            input_tokens=0,
        )


class FakeClaudeResponse:
    def __init__(self, items: list[tuple[str, object]]) -> None:
        self._items = items

    @classmethod
    def text(cls, *chunks: str, stop_reason: str = "end_turn") -> "FakeClaudeResponse":
        items: list[tuple[str, object]] = [
            ("stream_event", _SyntheticTextEvent(chunk)) for chunk in chunks
        ]
        items.append(("final_message", FakeClaudeFinalMessage(stop_reason)))
        return cls(items)

    @classmethod
    def tool_calls(
        cls,
        calls: list[dict],
        *,
        text_chunks: tuple[str, ...] = (),
        stop_reason: str = "tool_use",
    ) -> "FakeClaudeResponse":
        items: list[tuple[str, object]] = [
            ("stream_event", _SyntheticTextEvent(chunk)) for chunk in text_chunks
        ]
        for call in calls:
            items.extend(
                [
                    (
                        "stream_event",
                        _SyntheticToolStartEvent(call["id"], call["name"]),
                    ),
                    (
                        "stream_event",
                        _SyntheticToolJsonEvent(json.dumps(call["input"])),
                    ),
                    ("stream_event", _SyntheticBlockStopEvent()),
                ]
            )
        items.append(("final_message", FakeClaudeFinalMessage(stop_reason)))
        return cls(items)

    @classmethod
    def malformed_tool_call(
        cls,
        *,
        tool_id: str,
        name: str,
        partial_json: str,
        text_chunks: tuple[str, ...] = (),
        stop_reason: str = "tool_use",
    ) -> "FakeClaudeResponse":
        items: list[tuple[str, object]] = [
            ("stream_event", _SyntheticTextEvent(chunk)) for chunk in text_chunks
        ]
        items.extend(
            [
                ("stream_event", _SyntheticToolStartEvent(tool_id, name)),
                ("stream_event", _SyntheticToolJsonEvent(partial_json)),
                ("stream_event", _SyntheticBlockStopEvent()),
                ("final_message", FakeClaudeFinalMessage(stop_reason)),
            ]
        )
        return cls(items)

    def to_items(self) -> list[tuple[str, object]]:
        return list(self._items)


def _scripted_stream_factory(*step_scripts: list[tuple[str, object]]):
    scripts = iter(step_scripts)

    async def _fake_stream(*_args, **_kwargs):
        try:
            script = next(scripts)
        except StopIteration as exc:  # pragma: no cover - defensive guard
            raise AssertionError("Unexpected extra model step") from exc
        for item in script:
            yield item

    return _fake_stream


async def _create_active_deal(adb, async_buyer_user):
    session, deal_state = await async_create_session_with_deal_state(
        adb, async_buyer_user
    )
    vehicle = await async_create_vehicle(adb, session.id)
    deal = await async_create_deal(adb, session.id, vehicle.id)
    deal_state.active_deal_id = deal.id
    await adb.commit()
    await adb.refresh(deal_state)
    await adb.refresh(deal)
    return session, deal_state, vehicle, deal


@pytest_asyncio.fixture
async def async_client():
    async def override_get_db():
        async with TestingAsyncSessionLocal() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client
    app.dependency_overrides.clear()


async def test_chat_tools_schema_snapshot():
    _assert_json_snapshot("chat_tools_schema.json", _tool_schema_contract())


@patch("app.services.panel.create_anthropic_client")
async def test_generate_ai_panel_cards_snapshot(mock_create_client):
    mock_response = AsyncMock()
    mock_response.stop_reason = "end_turn"
    mock_response.usage = SimpleNamespace(
        cache_creation_input_tokens=0,
        cache_read_input_tokens=0,
        input_tokens=0,
    )
    mock_response.content = [
        SimpleNamespace(
            text=json.dumps(
                [
                    {
                        "type": "briefing",
                        "title": "Stand Firm",
                        "content": {
                            "body": "Their counter is still above your target. Hold your number and push for the out-the-door total."
                        },
                        "priority": "high",
                    },
                    {
                        "type": "numbers",
                        "title": "Price Gap",
                        "content": {
                            "rows": [
                                {
                                    "label": "Your Target",
                                    "value": "$28,500",
                                    "field": "your_target",
                                    "highlight": "good",
                                },
                                {
                                    "label": "Their Offer",
                                    "value": "$30,200",
                                    "field": "current_offer",
                                    "highlight": "bad",
                                },
                            ]
                        },
                        "priority": "high",
                    },
                ]
            )
        )
    ]
    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_response)
    mock_create_client.return_value = mock_client

    actual = await generate_ai_panel_cards(
        {
            "buyer_context": "at_dealership",
            "vehicles": [],
            "deals": [],
            "negotiation_context": {
                "situation": "Dealer came back at $30,200",
                "key_numbers": {"your_target": 28500, "current_offer": 30200},
            },
        },
        "Stay firm at $28,500 and ask for the out-the-door total.",
        [{"role": "user", "content": "They came back at 30,200"}],
    )

    _assert_json_snapshot("panel_cards.json", actual)


@patch("app.services.panel.create_anthropic_client")
async def test_generate_ai_panel_cards_retries_after_max_tokens(mock_create_client):
    truncated_response = AsyncMock()
    truncated_response.stop_reason = "max_tokens"
    truncated_response.usage = SimpleNamespace(
        cache_creation_input_tokens=0,
        cache_read_input_tokens=0,
        input_tokens=0,
    )
    truncated_response.content = [SimpleNamespace(text='[{"type": "briefing"')]

    recovered_response = AsyncMock()
    recovered_response.stop_reason = "end_turn"
    recovered_response.usage = SimpleNamespace(
        cache_creation_input_tokens=0,
        cache_read_input_tokens=0,
        input_tokens=0,
    )
    recovered_response.content = [
        SimpleNamespace(
            text=json.dumps(
                [
                    {
                        "type": "briefing",
                        "title": "Recovered",
                        "content": {"body": "The second attempt completed cleanly."},
                        "priority": "high",
                    }
                ]
            )
        )
    ]

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(
        side_effect=[truncated_response, recovered_response]
    )
    mock_create_client.return_value = mock_client

    actual = await generate_ai_panel_cards(
        {"buyer_context": "researching", "vehicles": [], "deals": []},
        "We should retry that panel generation.",
        [{"role": "user", "content": "Show me the latest panel"}],
    )

    assert actual == [
        {
            "type": "briefing",
            "title": "Recovered",
            "content": {"body": "The second attempt completed cleanly."},
            "priority": "high",
        }
    ]
    assert mock_client.messages.create.await_count == 2
    assert mock_client.messages.create.await_args_list[0].kwargs["max_tokens"] == 2048
    assert mock_client.messages.create.await_args_list[1].kwargs["max_tokens"] == 4096


async def test_stream_chat_loop_applies_multi_tool_chain_and_snapshots_state(
    adb, async_buyer_user
):
    session, deal_state = await async_create_session_with_deal_state(
        adb, async_buyer_user
    )
    await adb.commit()
    await adb.refresh(deal_state)
    messages = [{"role": "user", "content": "I found a 2024 Honda Civic for $25,000."}]
    result = ChatLoopResult()

    step_0 = FakeClaudeResponse.tool_calls(
        [
            {
                "id": "veh-1",
                "name": "set_vehicle",
                "input": {
                    "role": "primary",
                    "year": 2024,
                    "make": "Honda",
                    "model": "Civic",
                },
            },
            {
                "id": "num-1",
                "name": "update_deal_numbers",
                "input": {"listing_price": 25000},
            },
        ],
        text_chunks=("I captured the vehicle and price details.",),
    ).to_items()
    step_1 = FakeClaudeResponse.text(
        "That gives us a clean starting point for negotiation.",
        stop_reason="end_turn",
    ).to_items()

    with (
        patch("app.services.claude.create_anthropic_client", return_value=object()),
        patch(
            "app.services.claude._stream_step_with_retry",
            new=_scripted_stream_factory(step_0, step_1),
        ),
    ):
        events = await _collect_generator_events(
            stream_chat_loop(
                build_system_prompt(),
                messages,
                CHAT_TOOLS,
                deal_state,
                adb,
                result,
                session_factory=TestingAsyncSessionLocal,
            )
        )

    await adb.refresh(deal_state)
    state_dict = await deal_state_to_dict(deal_state, adb)
    deal_result = await adb.execute(
        select(Deal).where(Deal.id == deal_state.active_deal_id)
    )
    deal = deal_result.scalar_one()

    assert deal.listing_price == 25000
    assert result.full_text == (
        "I captured the vehicle and price details.\n\n"
        "That gives us a clean starting point for negotiation."
    )
    assert [event_name for event_name, _ in events] == snapshot(
        ["text", "tool_result", "tool_result", "tool_result", "step", "text", "done"]
    )

    snapshot_payload = {
        "tool_calls": _normalize_tool_calls(result.tool_calls),
        "buyer_context": state_dict["buyer_context"],
        "vehicles": [
            {
                "role": vehicle["role"],
                "year": vehicle["year"],
                "make": vehicle["make"],
                "model": vehicle["model"],
            }
            for vehicle in state_dict["vehicles"]
        ],
        "deals": [
            {
                "phase": deal_entry["phase"],
                "numbers": deal_entry["numbers"],
            }
            for deal_entry in state_dict["deals"]
        ],
    }
    _assert_json_snapshot("fake_pipeline_state.json", snapshot_payload)


async def test_stream_chat_loop_synthesizes_tool_error_on_execution_failure(
    adb, async_buyer_user
):
    _, deal_state, _, _ = await _create_active_deal(adb, async_buyer_user)
    messages = [{"role": "user", "content": "Update the phase."}]
    result = ChatLoopResult()

    step_0 = FakeClaudeResponse.tool_calls(
        [
            {
                "id": "phase-1",
                "name": "update_deal_phase",
                "input": {},
            }
        ]
    ).to_items()
    step_1 = FakeClaudeResponse.text(
        "I could not update the deal phase because the required field was missing.",
        stop_reason="end_turn",
    ).to_items()

    with (
        patch("app.services.claude.create_anthropic_client", return_value=object()),
        patch(
            "app.services.claude._stream_step_with_retry",
            new=_scripted_stream_factory(step_0, step_1),
        ),
    ):
        events = await _collect_generator_events(
            stream_chat_loop(
                build_system_prompt(),
                messages,
                CHAT_TOOLS,
                deal_state,
                adb,
                result,
                session_factory=TestingAsyncSessionLocal,
            )
        )

    assert [event_name for event_name, _ in events] == [
        "tool_error",
        "step",
        "text",
        "done",
    ]
    assert messages[-1]["role"] == "user"
    assert messages[-1]["content"] == snapshot(
        [
            {
                "type": "tool_result",
                "tool_use_id": "phase-1",
                "is_error": True,
                "content": "Tool 'update_deal_phase' failed: 'phase'",
            }
        ]
    )


async def test_stream_chat_loop_handles_malformed_tool_json(adb, async_buyer_user):
    _, deal_state = await async_create_session_with_deal_state(adb, async_buyer_user)
    messages = [{"role": "user", "content": "Save this quick action."}]
    result = ChatLoopResult()

    step_0 = FakeClaudeResponse.malformed_tool_call(
        tool_id="qa-1",
        name="update_quick_actions",
        partial_json='{"actions": [',
        text_chunks=("I tried to update the quick actions.",),
    ).to_items()
    step_1 = FakeClaudeResponse.text(
        "I hit a formatting issue while updating the quick actions.",
        stop_reason="end_turn",
    ).to_items()

    with (
        patch("app.services.claude.create_anthropic_client", return_value=object()),
        patch(
            "app.services.claude._stream_step_with_retry",
            new=_scripted_stream_factory(step_0, step_1),
        ),
    ):
        events = await _collect_generator_events(
            stream_chat_loop(
                build_system_prompt(),
                messages,
                CHAT_TOOLS,
                deal_state,
                adb,
                result,
                session_factory=TestingAsyncSessionLocal,
            )
        )

    assert [event_name for event_name, _ in events] == [
        "text",
        "tool_error",
        "step",
        "text",
        "done",
    ]
    assert messages[-2]["content"] == snapshot(
        [
            {"type": "text", "text": "I tried to update the quick actions."},
            {
                "type": "tool_use",
                "id": "qa-1",
                "name": "update_quick_actions",
                "input": {},
            },
        ]
    )
    assert messages[-1]["content"] == snapshot(
        [
            {
                "type": "tool_result",
                "tool_use_id": "qa-1",
                "is_error": True,
                "content": "Tool 'update_quick_actions' received malformed JSON input",
            }
        ]
    )


async def test_stream_chat_loop_emits_retry_event_before_recovery(
    adb, async_buyer_user
):
    _, deal_state = await async_create_session_with_deal_state(adb, async_buyer_user)
    result = ChatLoopResult()

    step_0 = [
        ("retry", {"attempt": 1, "reason": "stream_stall"}),
        *FakeClaudeResponse.text(
            "Recovered after a transient stream stall.", stop_reason="end_turn"
        ).to_items(),
    ]

    with (
        patch("app.services.claude.create_anthropic_client", return_value=object()),
        patch(
            "app.services.claude._stream_step_with_retry",
            new=_scripted_stream_factory(step_0),
        ),
    ):
        events = await _collect_generator_events(
            stream_chat_loop(
                build_system_prompt(),
                [{"role": "user", "content": "Hello"}],
                CHAT_TOOLS,
                deal_state,
                adb,
                result,
                session_factory=TestingAsyncSessionLocal,
            )
        )

    assert events == snapshot(
        [
            (
                "retry",
                {"attempt": 1, "reason": "stream_stall", "reset_text": True},
            ),
            ("text", {"chunk": "Recovered after a transient stream stall."}),
            (
                "done",
                {"text": "Recovered after a transient stream stall."},
            ),
        ]
    )


async def test_stream_chat_loop_retries_after_max_tokens(adb, async_buyer_user):
    _, deal_state = await async_create_session_with_deal_state(adb, async_buyer_user)
    result = ChatLoopResult()

    truncated_attempt = FakeClaudeResponse.text(
        "This partial response was truncated.",
        stop_reason="max_tokens",
    ).to_items()
    recovered_attempt = FakeClaudeResponse.text(
        "This retried response completed successfully.",
        stop_reason="end_turn",
    ).to_items()

    with (
        patch("app.services.claude.create_anthropic_client", return_value=object()),
        patch(
            "app.services.claude._stream_step_with_retry",
            new=_scripted_stream_factory(truncated_attempt, recovered_attempt),
        ),
    ):
        events = await _collect_generator_events(
            stream_chat_loop(
                build_system_prompt(),
                [{"role": "user", "content": "Help me."}],
                CHAT_TOOLS,
                deal_state,
                adb,
                result,
                session_factory=TestingAsyncSessionLocal,
            )
        )

    assert events == [
        ("text", {"chunk": "This partial response was truncated."}),
        (
            "retry",
            {
                "attempt": 1,
                "reason": "max_tokens",
                "reset_text": True,
                "max_tokens": 8192,
            },
        ),
        ("text", {"chunk": "This retried response completed successfully."}),
        ("done", {"text": "This retried response completed successfully."}),
    ]
    assert result.full_text == "This retried response completed successfully."


async def test_stream_chat_loop_emits_partial_done_when_max_steps_reached(
    adb, async_buyer_user
):
    _, deal_state = await async_create_session_with_deal_state(adb, async_buyer_user)
    result = ChatLoopResult()

    step_0 = FakeClaudeResponse.tool_calls(
        [
            {
                "id": "qa-1",
                "name": "update_quick_actions",
                "input": {
                    "actions": [
                        {
                            "label": "Ask OTD",
                            "prompt": "What is the out-the-door price?",
                        }
                    ]
                },
            }
        ],
        text_chunks=("I updated your quick actions.",),
    ).to_items()
    step_1 = FakeClaudeResponse.tool_calls(
        [
            {
                "id": "check-1",
                "name": "update_checklist",
                "input": {"items": [{"label": "Ask for OTD", "done": False}]},
            }
        ],
        text_chunks=("I also updated your checklist.",),
    ).to_items()

    with (
        patch("app.services.claude.create_anthropic_client", return_value=object()),
        patch(
            "app.services.claude._stream_step_with_retry",
            new=_scripted_stream_factory(step_0, step_1),
        ),
    ):
        events = await _collect_generator_events(
            stream_chat_loop(
                build_system_prompt(),
                [{"role": "user", "content": "Help me negotiate."}],
                CHAT_TOOLS,
                deal_state,
                adb,
                result,
                max_steps=2,
                session_factory=TestingAsyncSessionLocal,
            )
        )

    assert events[-1] == (
        "done",
        {"text": "I updated your quick actions.\n\nI also updated your checklist."},
    )
    assert result.completed is True


async def test_send_message_sse_done_before_panel_updates(
    async_client, adb, async_buyer_user
):
    session, deal_state = await async_create_session_with_deal_state(
        adb, async_buyer_user
    )
    await adb.commit()
    await adb.refresh(session)
    await adb.refresh(deal_state)
    token = create_access_token({"sub": async_buyer_user.id})

    async def fake_stream_chat_loop(*args, **kwargs):
        result = args[5]
        result.full_text = "Hold at $28,500 and get the out-the-door total in writing."
        merge_usage_summary(
            result.usage_summary,
            summarize_usage(
                SimpleNamespace(
                    input_tokens=240,
                    output_tokens=96,
                    cache_creation_input_tokens=0,
                    cache_read_input_tokens=180,
                )
            ),
        )
        result.tool_calls.append(
            {
                "name": "update_quick_actions",
                "args": {
                    "actions": [
                        {
                            "label": "Ask OTD",
                            "prompt": "What is the out-the-door price?",
                        }
                    ]
                },
            }
        )
        result.completed = True
        yield (
            "event: text\n"
            'data: {"chunk": "Hold at $28,500 and get the out-the-door total in writing."}\n\n'
        )
        yield (
            "event: tool_result\n"
            'data: {"tool": "update_quick_actions", "data": {"actions": [{"label": "Ask OTD", "prompt": "What is the out-the-door price?"}]}}\n\n'
        )

    with (
        patch("app.routes.chat.stream_chat_loop", new=fake_stream_chat_loop),
        patch(
            "app.routes.chat.generate_ai_panel_cards_with_usage",
            new=AsyncMock(
                return_value=(
                    [
                        {
                            "type": "briefing",
                            "title": "Hold Firm",
                            "content": {
                                "body": "Their latest counter is still above your target."
                            },
                            "priority": "high",
                        }
                    ],
                    {
                        "requests": 1,
                        "input_tokens": 120,
                        "output_tokens": 40,
                        "cache_creation_input_tokens": 0,
                        "cache_read_input_tokens": 60,
                        "total_tokens": 160,
                    },
                )
            ),
        ),
        patch("app.routes.chat.update_session_metadata", new=AsyncMock()),
    ):
        async with async_client.stream(
            "POST",
            f"/api/chat/{session.id}/message",
            json={"content": "They came back at 30,200"},
            headers={"Authorization": f"Bearer {token}"},
        ) as response:
            assert response.status_code == 200
            events = await _collect_response_events(response)

    # done fires immediately after the step loop so the frontend can
    # unblock input; panel tool_result arrives after done.
    assert [event_name for event_name, _ in events] == [
        "text",
        "tool_result",
        "done",
        "tool_result",
    ]
    # done carries step-loop-only usage (no panel generation costs)
    done_event = next(data for name, data in events if name == "done")
    assert done_event["text"] == "Hold at $28,500 and get the out-the-door total in writing."
    assert done_event["usage"] == {
        "requests": 1,
        "inputTokens": 240,
        "outputTokens": 96,
        "cacheCreationInputTokens": 0,
        "cacheReadInputTokens": 180,
        "totalTokens": 336,
    }
    # Panel cards arrive as the last tool_result
    panel_event = events[-1]
    assert panel_event[0] == "tool_result"
    assert panel_event[1]["tool"] == "update_insights_panel"

    async with TestingAsyncSessionLocal() as check_db:
        message_result = await check_db.execute(
            select(Message)
            .where(Message.session_id == session.id)
            .order_by(Message.created_at)
        )
        persisted_messages = list(message_result.scalars().all())
        assert [message.role for message in persisted_messages] == [
            "user",
            "assistant",
        ]
        assert persisted_messages[-1].content == (
            "Hold at $28,500 and get the out-the-door total in writing."
        )
        assert persisted_messages[-1].usage == {
            "requests": 2,
            "inputTokens": 360,
            "outputTokens": 136,
            "cacheCreationInputTokens": 0,
            "cacheReadInputTokens": 240,
            "totalTokens": 496,
        }
        assert _normalize_tool_calls(persisted_messages[-1].tool_calls) == snapshot(
            [
                {
                    "name": "update_quick_actions",
                    "args": {
                        "actions": [
                            {
                                "label": "Ask OTD",
                                "prompt": "What is the out-the-door price?",
                            }
                        ]
                    },
                },
                {
                    "name": "update_insights_panel",
                    "args": {
                        "cards": [
                            {
                                "type": "briefing",
                                "title": "Hold Firm",
                                "content": {
                                    "body": "Their latest counter is still above your target."
                                },
                                "priority": "high",
                            }
                        ]
                    },
                },
            ]
        )

        session_result = await check_db.execute(
            select(ChatSession).where(ChatSession.id == session.id)
        )
        persisted_session = session_result.scalar_one()
        assert persisted_session.usage == {
            "request_count": 2,
            "input_tokens": 360,
            "output_tokens": 136,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 240,
            "total_tokens": 496,
            "total_cost_usd": 0.003192,
            "per_model": {
                "claude-sonnet-4-6": {
                    "request_count": 2,
                    "input_tokens": 360,
                    "output_tokens": 136,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 240,
                    "total_tokens": 496,
                    "total_cost_usd": 0.003192,
                }
            },
        }

    history_response = await async_client.get(
        f"/api/chat/{session.id}/messages",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert history_response.status_code == 200
    history_payload = history_response.json()
    assert history_payload[-1]["usage"] == {
        "requests": 2,
        "inputTokens": 360,
        "outputTokens": 136,
        "cacheCreationInputTokens": 0,
        "cacheReadInputTokens": 240,
        "totalTokens": 496,
    }


async def test_send_message_stops_after_stream_failure(
    async_client, adb, async_buyer_user
):
    session, _ = await async_create_session_with_deal_state(adb, async_buyer_user)
    await adb.commit()
    await adb.refresh(session)
    token = create_access_token({"sub": async_buyer_user.id})

    async def failing_stream_chat_loop(*args, **kwargs):
        result = args[5]
        result.failed = True
        yield (
            "event: error\n"
            'data: {"message": "AI response failed. Please try again."}\n\n'
        )

    with (
        patch("app.routes.chat.stream_chat_loop", new=failing_stream_chat_loop),
        patch(
            "app.routes.chat.generate_ai_panel_cards_with_usage",
            new=AsyncMock(
                return_value=(
                    [],
                    {
                        "requests": 0,
                        "input_tokens": 0,
                        "output_tokens": 0,
                        "cache_creation_input_tokens": 0,
                        "cache_read_input_tokens": 0,
                        "total_tokens": 0,
                    },
                )
            ),
        ),
        patch("app.routes.chat.update_session_metadata", new=AsyncMock()),
    ):
        async with async_client.stream(
            "POST",
            f"/api/chat/{session.id}/message",
            json={"content": "Can you help me?"},
            headers={"Authorization": f"Bearer {token}"},
        ) as response:
            assert response.status_code == 200
            events = await _collect_response_events(response)

    assert events == [("error", {"message": "AI response failed. Please try again."})]

    async with TestingAsyncSessionLocal() as check_db:
        message_result = await check_db.execute(
            select(Message)
            .where(Message.session_id == session.id)
            .order_by(Message.created_at)
        )
        persisted_messages = list(message_result.scalars().all())
        assert [message.role for message in persisted_messages] == ["user"]


@pytest.mark.vcr
async def test_generate_ai_panel_cards_vcr_smoke():
    if not VCR_CASSETTE.exists() and not settings.ANTHROPIC_API_KEY:
        pytest.skip(
            "Record the initial cassette with ANTHROPIC_API_KEY before enabling replay"
        )

    cards = await generate_ai_panel_cards(
        {
            "buyer_context": "reviewing_deal",
            "vehicles": [
                {
                    "id": "vehicle-1",
                    "role": "primary",
                    "year": 2024,
                    "make": "Honda",
                    "model": "Civic",
                    "trim": "Sport",
                    "vin": None,
                    "mileage": 1200,
                    "color": None,
                    "engine": None,
                    "identity_confirmation_status": "pending",
                    "identity_confirmed_at": None,
                    "identity_confirmation_source": None,
                    "intelligence": {
                        "decode": None,
                        "history": None,
                        "valuation": None,
                    },
                }
            ],
            "deals": [
                {
                    "id": "deal-1",
                    "vehicle_id": "vehicle-1",
                    "dealer_name": "Metro Honda",
                    "phase": "negotiation",
                    "numbers": {
                        "listing_price": 30200,
                        "your_target": 28500,
                        "current_offer": 30000,
                    },
                    "scorecard": {},
                    "health": {},
                    "red_flags": [],
                    "information_gaps": [],
                }
            ],
            "session_red_flags": [],
            "session_information_gaps": [],
            "checklist": [],
            "ai_panel_cards": [],
            "negotiation_context": {
                "situation": "Dealer countered at $30,000 and says it is final.",
                "key_numbers": {"your_target": 28500, "current_offer": 30000},
            },
        },
        "Their latest number is still too high. Hold your target and ask for the out-the-door total before discussing financing.",
        [
            {"role": "user", "content": "They came back at 30,000 and say it's final."},
            {
                "role": "assistant",
                "content": "Hold your target and ask for the out-the-door number before discussing monthly payment.",
            },
        ],
    )

    assert isinstance(cards, list)
    assert all(isinstance(card, dict) for card in cards)
