"""Tests for the AI chat pipeline: step loop, snapshots, SSE ordering, and VCR hooks."""

from __future__ import annotations

import json
import re
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
from app.models.enums import BuyerContext
from app.models.message import Message
from app.models.session import ChatSession
from app.services.claude import (
    CHAT_TOOLS,
    ChatLoopResult,
    _move_message_cache_breakpoint,
    _SyntheticBlockStopEvent,
    _SyntheticTextEvent,
    _SyntheticToolJsonEvent,
    _SyntheticToolStartEvent,
    build_context_message,
    build_messages,
    build_system_prompt,
    merge_usage_summary,
    stream_chat_loop,
    summarize_usage,
)
from app.services.deal_state import deal_state_to_dict
from app.services.panel import generate_ai_panel_cards, stream_ai_panel_cards_with_usage
from app.services.turn_context import TurnContext
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


class _FakePanelTextDeltaEvent:
    type = "content_block_delta"

    def __init__(self, text: str) -> None:
        self.delta = SimpleNamespace(type="text_delta", text=text)


class _FakePanelStream:
    def __init__(self, chunks: list[str], stop_reason: str = "end_turn") -> None:
        self._chunks = chunks
        self._stop_reason = stop_reason

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def __aiter__(self):
        async def _iterate():
            for chunk in self._chunks:
                yield _FakePanelTextDeltaEvent(chunk)

        return _iterate()

    async def get_final_message(self):
        return SimpleNamespace(
            stop_reason=self._stop_reason,
            usage=SimpleNamespace(
                cache_creation_input_tokens=0,
                cache_read_input_tokens=0,
                input_tokens=0,
                output_tokens=0,
            ),
        )


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


def test_context_message_includes_current_utc_date():
    context_message = build_context_message(
        {"buyer_context": BuyerContext.RESEARCHING, "deals": [], "vehicles": []}
    )

    assert context_message is not None
    content = context_message["content"]
    assert "Current date (UTC):" in content
    assert re.search(r"Current date \(UTC\): \d{4}-\d{2}-\d{2}\.", content)


# ─── TurnContext unit tests ───


def test_turn_context_create_with_deal_state():
    """TurnContext.create() stores deal_state and initialises step to 0."""
    from unittest.mock import MagicMock

    mock_deal_state = MagicMock()
    mock_db = MagicMock()

    ctx = TurnContext.create(session=None, deal_state=mock_deal_state, db=mock_db)

    assert ctx.deal_state is mock_deal_state
    assert ctx.session is None
    assert ctx.db is mock_db
    assert ctx.step == 0


def test_turn_context_create_with_deal_state_none():
    """TurnContext.create() handles deal_state=None gracefully."""
    from unittest.mock import MagicMock

    mock_db = MagicMock()

    ctx = TurnContext.create(session=None, deal_state=None, db=mock_db)

    assert ctx.deal_state is None


def test_turn_context_for_step():
    """for_step() returns a new context with updated step number."""
    from unittest.mock import MagicMock

    mock_db = MagicMock()
    ctx = TurnContext.create(session=None, deal_state=None, db=mock_db)
    stepped = ctx.for_step(3)

    assert stepped.step == 3
    assert ctx.step == 0  # original unchanged
    assert stepped.db is ctx.db
    assert stepped is not ctx


def test_turn_context_for_db_session():
    """for_db_session() returns a new context with replaced db and deal_state."""
    from unittest.mock import MagicMock

    mock_db = MagicMock()
    mock_deal_state = MagicMock()
    ctx = TurnContext.create(session=None, deal_state=mock_deal_state, db=mock_db)

    new_db = MagicMock()
    new_deal_state = MagicMock()

    swapped = ctx.for_db_session(new_db, deal_state=new_deal_state)

    assert swapped.db is new_db
    assert swapped.deal_state is new_deal_state
    # original unchanged
    assert ctx.db is mock_db
    assert ctx.deal_state is mock_deal_state


def test_turn_context_for_db_session_without_deal_state():
    """for_db_session() without deal_state kwarg keeps existing deal_state."""
    from unittest.mock import MagicMock

    mock_db = MagicMock()
    mock_deal_state = MagicMock()
    ctx = TurnContext.create(session=None, deal_state=mock_deal_state, db=mock_db)

    new_db = MagicMock()
    swapped = ctx.for_db_session(new_db)

    assert swapped.db is new_db
    assert swapped.deal_state is mock_deal_state


# ─── build_messages tests ───


def test_build_messages_context_merged_into_user_message():
    """Context message is merged into the user message as content blocks."""
    context = {
        "role": "user",
        "content": "<system-reminder>Deal context</system-reminder>",
    }
    messages = build_messages([], "What should I do?", context_message=context)

    assert len(messages) == 1
    msg = messages[0]
    assert msg["role"] == "user"
    # Should be a list of content blocks (context + user text)
    assert isinstance(msg["content"], list)
    assert len(msg["content"]) == 2
    assert msg["content"][0]["type"] == "text"
    assert "Deal context" in msg["content"][0]["text"]
    assert msg["content"][1]["type"] == "text"
    assert msg["content"][1]["text"] == "What should I do?"


def test_build_messages_no_context_plain_string():
    """Without context message, user message is a plain string."""
    messages = build_messages([], "Hello")

    assert len(messages) == 1
    assert messages[0] == {"role": "user", "content": "Hello"}


def test_build_messages_with_image_and_context():
    """Image URL + context message produces context + image + text blocks."""
    context = {
        "role": "user",
        "content": "<system-reminder>Context here</system-reminder>",
    }
    messages = build_messages(
        [],
        "What is this?",
        image_url="https://example.com/img.jpg",
        context_message=context,
    )

    assert len(messages) == 1
    msg = messages[0]
    assert msg["role"] == "user"
    blocks = msg["content"]
    assert isinstance(blocks, list)
    assert len(blocks) == 3
    # First block: context text
    assert blocks[0]["type"] == "text"
    assert "Context here" in blocks[0]["text"]
    # Second block: image
    assert blocks[1]["type"] == "image"
    assert blocks[1]["source"]["url"] == "https://example.com/img.jpg"
    # Third block: user text
    assert blocks[2]["type"] == "text"
    assert blocks[2]["text"] == "What is this?"


def test_build_messages_with_image_no_context():
    """Image URL without context produces image + text blocks (no context block)."""
    messages = build_messages(
        [], "Describe this", image_url="https://example.com/pic.png"
    )

    assert len(messages) == 1
    blocks = messages[0]["content"]
    assert isinstance(blocks, list)
    assert len(blocks) == 2
    assert blocks[0]["type"] == "image"
    assert blocks[1]["type"] == "text"
    assert blocks[1]["text"] == "Describe this"


def test_build_messages_no_synthetic_reply_injected():
    """build_messages no longer injects a synthetic assistant reply after context."""
    context = {"role": "user", "content": "Some context"}
    messages = build_messages([], "Hi", context_message=context)

    # Should be just the merged user message, no synthetic assistant reply
    assistant_msgs = [m for m in messages if m["role"] == "assistant"]
    assert len(assistant_msgs) == 0


def test_build_messages_cache_breakpoint_on_last_history():
    """build_messages places cache_control on the last history message."""
    history = [
        {"role": "user", "content": "First message"},
        {"role": "assistant", "content": "First reply"},
        {"role": "user", "content": "Second message"},
        {"role": "assistant", "content": "Second reply"},
    ]
    messages = build_messages(history, "New question")

    # Last history message (index 3) should have cache_control
    last_history = messages[3]
    assert isinstance(last_history["content"], list)
    assert last_history["content"][-1].get("cache_control") == {"type": "ephemeral"}

    # Earlier history messages should NOT have cache_control
    for msg in messages[:3]:
        content = msg["content"]
        if isinstance(content, list):
            for block in content:
                assert "cache_control" not in block
        # String content can't have cache_control

    # New user message (last) should NOT have cache_control
    new_msg = messages[-1]
    if isinstance(new_msg["content"], list):
        for block in new_msg["content"]:
            assert "cache_control" not in block


def test_build_messages_cache_breakpoint_with_list_content():
    """cache_control is applied to the last block when history content is a list."""
    history = [
        {
            "role": "assistant",
            "content": [
                {"type": "text", "text": "Some text"},
                {"type": "tool_use", "id": "t1", "name": "foo", "input": {}},
            ],
        },
    ]
    messages = build_messages(history, "Next question")

    # The last block of the last history message should have cache_control
    last_block = messages[0]["content"][-1]
    assert last_block.get("cache_control") == {"type": "ephemeral"}
    # First block should NOT
    assert "cache_control" not in messages[0]["content"][0]


def test_move_message_cache_breakpoint_moves_to_last():
    """_move_message_cache_breakpoint moves breakpoint to the last message."""
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "old breakpoint",
                    "cache_control": {"type": "ephemeral"},
                }
            ],
        },
        {"role": "assistant", "content": [{"type": "text", "text": "reply"}]},
        {
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "ok"}],
        },
    ]

    _move_message_cache_breakpoint(messages)

    # Old breakpoint removed
    assert "cache_control" not in messages[0]["content"][0]
    # New breakpoint on last message's last block
    assert messages[2]["content"][-1].get("cache_control") == {"type": "ephemeral"}


def test_move_message_cache_breakpoint_string_content():
    """_move_message_cache_breakpoint converts string content to list with cache_control."""
    messages = [
        {"role": "user", "content": "plain string"},
    ]

    _move_message_cache_breakpoint(messages)

    assert isinstance(messages[0]["content"], list)
    assert messages[0]["content"][0] == {
        "type": "text",
        "text": "plain string",
        "cache_control": {"type": "ephemeral"},
    }


def test_move_message_cache_breakpoint_strips_all_previous():
    """_move_message_cache_breakpoint strips breakpoints from all previous messages."""
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "msg1", "cache_control": {"type": "ephemeral"}}
            ],
        },
        {
            "role": "assistant",
            "content": [
                {"type": "text", "text": "msg2", "cache_control": {"type": "ephemeral"}}
            ],
        },
        {
            "role": "user",
            "content": [{"type": "text", "text": "msg3"}],
        },
    ]

    _move_message_cache_breakpoint(messages)

    # All previous breakpoints stripped
    assert "cache_control" not in messages[0]["content"][0]
    assert "cache_control" not in messages[1]["content"][0]
    # Last message has the breakpoint
    assert messages[2]["content"][-1].get("cache_control") == {"type": "ephemeral"}


@patch("app.services.panel.create_anthropic_client")
async def test_generate_ai_panel_cards_snapshot(mock_create_client):
    response_json = json.dumps(
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
    mock_client = AsyncMock()
    mock_client.messages.stream = AsyncMock(
        return_value=_FakePanelStream([response_json], stop_reason="end_turn")
    )
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
    truncated_stream = _FakePanelStream(
        ['[{"type": "briefing"'], stop_reason="max_tokens"
    )
    recovered_stream = _FakePanelStream(
        [
            json.dumps(
                [
                    {
                        "type": "briefing",
                        "title": "Recovered",
                        "content": {"body": "The second attempt completed cleanly."},
                        "priority": "high",
                    }
                ]
            )
        ],
        stop_reason="end_turn",
    )

    mock_client = AsyncMock()
    mock_client.messages.stream = AsyncMock(
        side_effect=[truncated_stream, recovered_stream]
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
    assert mock_client.messages.stream.await_count == 2
    assert mock_client.messages.stream.await_args_list[0].kwargs["max_tokens"] == 2048
    assert mock_client.messages.stream.await_args_list[1].kwargs["max_tokens"] == 4096


@patch("app.services.panel.create_anthropic_client")
async def test_stream_ai_panel_cards_with_usage_parses_incremental_cards(
    mock_create_client,
):
    streamed_chunks = [
        '[{"type":"briefing","title":"Hold","content":{"body":"Hold your target."},"priority":"high"},',
        '{"type":"unknown","title":"Skip","content":{"body":"invalid"},"priority":"high"},',
        '{"type":"tip","title":"Leverage","content":{"body":"You can walk away."},"priority":"normal"}]',
    ]

    mock_client = AsyncMock()
    mock_client.messages.stream = AsyncMock(
        return_value=_FakePanelStream(streamed_chunks, stop_reason="end_turn")
    )
    mock_create_client.return_value = mock_client

    events = []
    async for event in stream_ai_panel_cards_with_usage(
        {"buyer_context": "at_dealership", "vehicles": [], "deals": []},
        "Hold your target and be ready to leave.",
        [{"role": "user", "content": "They came back with 30,200"}],
    ):
        events.append((event.type, event.data))

    assert [event_type for event_type, _ in events] == [
        "panel_started",
        "panel_card",
        "panel_card",
        "panel_done",
    ]

    panel_done = events[-1][1]
    assert [card["title"] for card in panel_done["cards"]] == ["Hold", "Leverage"]
    assert panel_done["usage_summary"] == {
        "requests": 1,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "total_tokens": 0,
    }


@patch("app.services.panel.create_anthropic_client")
async def test_stream_ai_panel_cards_with_usage_emits_panel_error_after_retries(
    mock_create_client,
):
    retries = settings.CLAUDE_MAX_TOKENS_RETRIES
    mock_client = AsyncMock()
    mock_client.messages.stream = AsyncMock(
        side_effect=RuntimeError("stream unavailable")
    )
    mock_client.messages.create = AsyncMock(side_effect=RuntimeError("fallback failed"))
    mock_create_client.return_value = mock_client

    events = []
    async for event in stream_ai_panel_cards_with_usage(
        {"buyer_context": "researching", "vehicles": [], "deals": []},
        "We can review options.",
        [{"role": "user", "content": "show panel"}],
    ):
        events.append((event.type, event.data))

    started_count = sum(1 for event_type, _ in events if event_type == "panel_started")
    assert started_count == retries + 1
    assert events[-1][0] == "panel_error"
    assert events[-1][1]["attempt"] == retries + 1


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
                TurnContext.create(session=session, deal_state=deal_state, db=adb),
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
                TurnContext.create(session=None, deal_state=deal_state, db=adb),
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
                "cache_control": {"type": "ephemeral"},
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
                TurnContext.create(session=None, deal_state=deal_state, db=adb),
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
                "cache_control": {"type": "ephemeral"},
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
                TurnContext.create(session=None, deal_state=deal_state, db=adb),
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
                TurnContext.create(session=None, deal_state=deal_state, db=adb),
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
                TurnContext.create(session=None, deal_state=deal_state, db=adb),
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


async def test_stream_chat_loop_deduplicates_repeated_step_text_after_tools(
    adb, async_buyer_user
):
    _, deal_state = await async_create_session_with_deal_state(adb, async_buyer_user)
    result = ChatLoopResult()

    duplicated_text = (
        "Good call on the 7.3L - it's proven and simpler to maintain than diesel."
    )

    step_0 = FakeClaudeResponse.tool_calls(
        [
            {
                "id": "qa-1",
                "name": "update_quick_actions",
                "input": {
                    "actions": [
                        {
                            "label": "Set budget",
                            "prompt": "My budget is around $45,000.",
                        }
                    ]
                },
            }
        ],
        text_chunks=(duplicated_text,),
    ).to_items()
    step_1 = FakeClaudeResponse.text(duplicated_text, stop_reason="end_turn").to_items()

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
                [{"role": "user", "content": "I want the 7.3L gas V8."}],
                CHAT_TOOLS,
                TurnContext.create(session=None, deal_state=deal_state, db=adb),
                result,
                session_factory=TestingAsyncSessionLocal,
            )
        )

    done_event = next(data for name, data in events if name == "done")
    assert done_event["text"] == duplicated_text
    assert result.full_text == duplicated_text


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
        result = args[4]
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

    async def fake_stream_panel_cards_with_usage(*args, **kwargs):
        yield SimpleNamespace(
            type="panel_started", data={"attempt": 1, "max_tokens": 2048}
        )
        yield SimpleNamespace(
            type="panel_card",
            data={
                "index": 0,
                "attempt": 1,
                "card": {
                    "type": "briefing",
                    "title": "Hold Firm",
                    "content": {
                        "body": "Their latest counter is still above your target."
                    },
                    "priority": "high",
                },
            },
        )
        yield SimpleNamespace(
            type="panel_done",
            data={
                "cards": [
                    {
                        "type": "briefing",
                        "title": "Hold Firm",
                        "content": {
                            "body": "Their latest counter is still above your target."
                        },
                        "priority": "high",
                    }
                ],
                "usage_summary": {
                    "requests": 1,
                    "input_tokens": 120,
                    "output_tokens": 40,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 60,
                    "total_tokens": 160,
                },
            },
        )

    with (
        patch("app.routes.chat.stream_chat_loop", new=fake_stream_chat_loop),
        patch(
            "app.routes.chat.stream_ai_panel_cards_with_usage",
            new=fake_stream_panel_cards_with_usage,
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
    # unblock input; panel lifecycle events arrive after done.
    assert [event_name for event_name, _ in events] == [
        "text",
        "tool_result",
        "done",
        "panel_started",
        "panel_card",
        "panel_done",
    ]
    # done carries step-loop-only usage (no panel generation costs)
    done_event = next(data for name, data in events if name == "done")
    assert (
        done_event["text"]
        == "Hold at $28,500 and get the out-the-door total in writing."
    )
    assert done_event["usage"] == {
        "requests": 1,
        "inputTokens": 240,
        "outputTokens": 96,
        "cacheCreationInputTokens": 0,
        "cacheReadInputTokens": 180,
        "totalTokens": 336,
    }
    panel_done = next(data for name, data in events if name == "panel_done")
    assert panel_done["cards"][0]["title"] == "Hold Firm"

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
        result = args[4]
        result.failed = True
        yield (
            "event: error\n"
            'data: {"message": "AI response failed. Please try again."}\n\n'
        )

    with (
        patch("app.routes.chat.stream_chat_loop", new=failing_stream_chat_loop),
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
