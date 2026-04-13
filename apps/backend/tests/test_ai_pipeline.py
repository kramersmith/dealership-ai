"""Tests for the AI chat pipeline: step loop, snapshots, SSE ordering, and VCR hooks."""

from __future__ import annotations

import json
import re
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from app.core.config import settings
from app.core.deps import get_db
from app.core.security import create_access_token
from app.main import app
from app.models.deal import Deal
from app.models.deal_state import DealState
from app.models.enums import (
    BuyerContext,
    InsightsFollowupKind,
    InsightsFollowupStatus,
    InsightsFollowupStepStatus,
    InsightsUpdateMode,
    MessageRole,
)
from app.models.insights_followup_job import InsightsFollowupJob
from app.models.message import Message
from app.models.session import ChatSession
from app.models.user_settings import UserSettings
from app.services.buyer_chat_stream import stream_buyer_chat_turn
from app.services.claude import (
    CHAT_TOOLS,
    POST_TOOL_CONTINUATION_REMINDER,
    ChatLoopResult,
    SyntheticBlockStopEvent,
    SyntheticTextEvent,
    SyntheticToolJsonEvent,
    SyntheticToolStartEvent,
    build_context_message,
    build_messages,
    build_system_prompt,
    build_temporal_hint_line,
    calendar_years_since_model_year,
    chat_tool_choice_for_step,
    get_buyer_chat_tools,
    merge_usage_summary,
    move_message_cache_breakpoint,
    primary_vehicle_model_year,
    stream_chat_loop,
    strip_redundant_continuation_opener,
    summarize_usage,
)
from app.services.deal_state import deal_state_to_dict
from app.services.panel import generate_ai_panel_cards, stream_ai_panel_cards_with_usage
from app.services.panel_cards import normalize_panel_card as normalize_panel_card_impl
from app.services.turn_cancellation import TurnCancellationState
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
            ("stream_event", SyntheticTextEvent(chunk)) for chunk in chunks
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
            ("stream_event", SyntheticTextEvent(chunk)) for chunk in text_chunks
        ]
        for call in calls:
            items.extend(
                [
                    (
                        "stream_event",
                        SyntheticToolStartEvent(call["id"], call["name"]),
                    ),
                    (
                        "stream_event",
                        SyntheticToolJsonEvent(json.dumps(call["input"])),
                    ),
                    ("stream_event", SyntheticBlockStopEvent()),
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
            ("stream_event", SyntheticTextEvent(chunk)) for chunk in text_chunks
        ]
        items.extend(
            [
                ("stream_event", SyntheticToolStartEvent(tool_id, name)),
                ("stream_event", SyntheticToolJsonEvent(partial_json)),
                ("stream_event", SyntheticBlockStopEvent()),
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


def test_get_buyer_chat_tools_paused_mode_only_allows_chat_only_tools():
    assert [tool["name"] for tool in get_buyer_chat_tools()] == [
        tool["name"] for tool in CHAT_TOOLS
    ]
    assert [
        tool["name"]
        for tool in get_buyer_chat_tools(allow_persistence_affecting_tools=False)
    ] == []
    assert [
        tool["name"]
        for tool in get_buyer_chat_tools(
            allow_persistence_affecting_tools=True,
            allow_chat_only_tools=False,
        )
    ] == [tool["name"] for tool in CHAT_TOOLS]


def test_context_message_includes_current_utc_date():
    context_message = build_context_message(
        {"buyer_context": BuyerContext.RESEARCHING, "deals": [], "vehicles": []}
    )

    assert context_message is not None
    content = context_message["content"]
    assert "Current date (UTC):" in content
    assert re.search(r"Current date \(UTC\): \d{4}-\d{2}-\d{2}\.", content)


@patch(
    "app.services.claude.context_message.current_utc_date_iso",
    return_value="2026-04-06",
)
def test_context_message_includes_temporal_hint_for_model_year(_mock_date):
    context_message = build_context_message(
        {
            "buyer_context": BuyerContext.RESEARCHING,
            "active_deal_id": "d1",
            "vehicles": [
                {
                    "id": "v1",
                    "role": "primary",
                    "year": 2022,
                    "make": "Ford",
                    "model": "F-250",
                    "trim": "Lariat",
                    "mileage": 175000,
                }
            ],
            "deals": [{"id": "d1", "vehicle_id": "v1", "phase": "research"}],
        }
    )

    assert context_message is not None
    content = context_message["content"]
    assert "Temporal hint:" in content
    assert "model year 2022" in content
    assert "~4 full" in content
    assert "miles/year" in content
    assert "Computed annualized miles:" in content
    assert "175,000" in content
    assert "43,750" in content


@patch(
    "app.services.claude.context_message.current_utc_date_iso",
    return_value="2026-04-08",
)
def test_context_message_provisional_temporal_hint_from_user_text_when_no_vehicle(
    _mock_date,
):
    context_message = build_context_message(
        {
            "buyer_context": BuyerContext.RESEARCHING,
            "vehicles": [],
            "deals": [],
        },
        user_turn_text=(
            "It's a 2021 FORD F-250 SUPER DUTY LARIAT with 175k miles for 34k"
        ),
    )

    assert context_message is not None
    body = context_message["content"]
    assert "Temporal hint (from this user message):" in body
    assert "model year 2021" in body
    assert "~5 full" in body
    assert "35,000" in body


def test_context_message_includes_timeline_fork_reminder_when_requested():
    context_message = build_context_message(
        {
            "buyer_context": BuyerContext.RESEARCHING,
            "vehicles": [],
            "deals": [],
        },
        include_timeline_fork_reminder=True,
    )

    assert context_message is not None
    body = context_message["content"]
    assert "Session branch:" in body
    assert "Structured deal and vehicle records were cleared" in body


def test_build_temporal_hint_line_none_without_vehicle_year():
    assert build_temporal_hint_line({"vehicles": [], "deals": []}, "2026-04-06") is None


def test_calendar_years_since_model_year_same_year_returns_one():
    assert calendar_years_since_model_year(2026, "2026-04-06") == 1


def test_calendar_years_since_model_year_future_returns_none():
    assert calendar_years_since_model_year(2028, "2026-04-06") is None


def test_calendar_years_since_model_year_normal_span():
    assert calendar_years_since_model_year(2020, "2026-04-06") == 6


def test_calendar_years_since_model_year_invalid_date_returns_none():
    assert calendar_years_since_model_year(2020, "not-a-date") is None


def test_primary_vehicle_model_year_uses_active_deal_vehicle():
    state = {
        "active_deal_id": "d1",
        "vehicles": [
            {"id": "v1", "role": "primary", "year": 2020},
            {"id": "v2", "role": "trade_in", "year": 2018},
        ],
        "deals": [{"id": "d1", "vehicle_id": "v2"}],
    }
    assert primary_vehicle_model_year(state) == 2018


def test_primary_vehicle_model_year_falls_back_to_primary_role():
    state = {
        "vehicles": [
            {"id": "v1", "role": "trade_in", "year": 2015},
            {"id": "v2", "role": "primary", "year": 2022},
        ],
        "deals": [],
    }
    assert primary_vehicle_model_year(state) == 2022


def test_primary_vehicle_model_year_none_when_empty():
    assert primary_vehicle_model_year({"vehicles": []}) is None
    assert primary_vehicle_model_year({}) is None


def test_strip_redundant_continuation_opener_removes_repeated_good_info_paragraph():
    prior = (
        "Good info — the 7.3L gas engine is actually a solid choice at high mileage "
        "compared to the 6.7L diesel. It's simpler, cheaper to maintain, and parts are "
        "more accessible. That said, 175k is still 175k."
    )
    cont = (
        "Good info — the 7.3L gas is genuinely one of Ford's better modern engines. "
        "It's a pushrod V8 (simple, proven architecture) and holds up well at high "
        "mileage compared to the diesel. That works in your favor.\n\n"
        "Here's where things stand on this deal:\n\n"
        "The price concern is real."
    )
    out = strip_redundant_continuation_opener(prior, cont)
    assert out.startswith("Here's where things stand")
    assert "Good info" not in out


def test_strip_redundant_continuation_opener_unchanged_when_topics_diverge():
    prior = "The APR at 8.9% over 72 months adds roughly $5,200 in interest."
    cont = (
        "Separately, you should verify the trade-in payoff before signing.\n\n"
        "Next, ask for the out-the-door total in writing."
    )
    assert strip_redundant_continuation_opener(prior, cont) == cont


def test_context_message_omits_ai_panel_cards_from_prompt_state():
    context_message = build_context_message(
        {
            "buyer_context": BuyerContext.RESEARCHING,
            "deals": [],
            "vehicles": [],
            "ai_panel_cards": [
                {
                    "kind": "vehicle",
                    "title": "Vehicle",
                }
            ],
        }
    )

    assert context_message is not None
    content = context_message["content"]
    assert '"buyer_context": "researching"' in content
    assert "ai_panel_cards" not in content


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


# ─── chat_tool_choice_for_step tests ───


def test_chat_tool_choice_step_zero_is_auto():
    """Step 0 always returns auto (model decides freely)."""
    result = chat_tool_choice_for_step(
        0,
        prev_step_had_tool_errors=False,
        prev_step_had_visible_assistant_text=False,
        prev_step_tools_were_dashboard_only=False,
    )
    assert result.tool_choice == {"type": "auto"}
    assert not result.inject_dashboard_reconcile_nudge


def test_chat_tool_choice_step_two_or_beyond_is_none():
    """Step >= 2 always forces text-only (no tools)."""
    for step in (2, 3, 4):
        result = chat_tool_choice_for_step(
            step,
            prev_step_had_tool_errors=False,
            prev_step_had_visible_assistant_text=True,
            prev_step_tools_were_dashboard_only=False,
        )
        assert result.tool_choice == {"type": "none"}, f"step={step}"
        assert not result.inject_dashboard_reconcile_nudge


def test_chat_tool_choice_step_one_none_when_text_and_no_errors():
    """Step 1 forces none when step 0 had visible text and no errors."""
    result = chat_tool_choice_for_step(
        1,
        prev_step_had_tool_errors=False,
        prev_step_had_visible_assistant_text=True,
        prev_step_tools_were_dashboard_only=False,
    )
    assert result.tool_choice == {"type": "none"}
    assert not result.inject_dashboard_reconcile_nudge
    assert not result.inject_post_extraction_assessment_nudge


def test_chat_tool_choice_step_one_none_when_dashboard_only_no_errors():
    """Step 1 forces none when step 0 had dashboard-only tools and no errors."""
    result = chat_tool_choice_for_step(
        1,
        prev_step_had_tool_errors=False,
        prev_step_had_visible_assistant_text=False,
        prev_step_tools_were_dashboard_only=True,
    )
    assert result.tool_choice == {"type": "none"}
    assert not result.inject_dashboard_reconcile_nudge


def test_chat_tool_choice_step_one_auto_when_tool_errors():
    """Step 1 allows auto when step 0 had tool errors (model self-correction)."""
    result = chat_tool_choice_for_step(
        1,
        prev_step_had_tool_errors=True,
        prev_step_had_visible_assistant_text=True,
        prev_step_tools_were_dashboard_only=False,
    )
    assert result.tool_choice == {"type": "auto"}
    assert not result.inject_dashboard_reconcile_nudge


def test_chat_tool_choice_step_one_auto_when_no_text_and_not_dashboard():
    """Step 1 allows auto when step 0 had no visible text and non-dashboard tools."""
    result = chat_tool_choice_for_step(
        1,
        prev_step_had_tool_errors=False,
        prev_step_had_visible_assistant_text=False,
        prev_step_tools_were_dashboard_only=False,
    )
    assert result.tool_choice == {"type": "auto"}
    assert not result.inject_dashboard_reconcile_nudge


def test_chat_tool_choice_step_one_reconcile_when_flags_without_health():
    """Step 1 allows a catch-up tool round after visible text + flags/gaps but no health."""
    result = chat_tool_choice_for_step(
        1,
        prev_step_had_tool_errors=False,
        prev_step_had_visible_assistant_text=True,
        prev_step_tools_were_dashboard_only=False,
        prev_step_tool_names=frozenset({"update_deal_red_flags"}),
    )
    assert result.tool_choice == {"type": "auto"}
    assert result.inject_dashboard_reconcile_nudge
    assert not result.inject_post_extraction_assessment_nudge


def test_chat_tool_choice_step_one_post_extraction_after_set_vehicle_only():
    """Step 1 allows tools after visible text + extraction-only step (e.g. second truck + pasted CARFAX)."""
    result = chat_tool_choice_for_step(
        1,
        prev_step_had_tool_errors=False,
        prev_step_had_visible_assistant_text=True,
        prev_step_tools_were_dashboard_only=False,
        prev_step_tool_names=frozenset({"set_vehicle"}),
    )
    assert result.tool_choice == {"type": "auto"}
    assert not result.inject_dashboard_reconcile_nudge
    assert result.inject_post_extraction_assessment_nudge


def test_chat_tool_choice_step_one_no_post_extraction_when_assessment_ran():
    result = chat_tool_choice_for_step(
        1,
        prev_step_had_tool_errors=False,
        prev_step_had_visible_assistant_text=True,
        prev_step_tools_were_dashboard_only=False,
        prev_step_tool_names=frozenset({"set_vehicle", "update_negotiation_context"}),
    )
    assert result.tool_choice == {"type": "none"}
    assert not result.inject_post_extraction_assessment_nudge


def test_chat_tool_choice_step_one_no_reconcile_when_health_present():
    result = chat_tool_choice_for_step(
        1,
        prev_step_had_tool_errors=False,
        prev_step_had_visible_assistant_text=True,
        prev_step_tools_were_dashboard_only=False,
        prev_step_tool_names=frozenset({"update_deal_red_flags", "update_deal_health"}),
    )
    assert result.tool_choice == {"type": "none"}
    assert not result.inject_dashboard_reconcile_nudge


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


def test_build_messages_compaction_prefix_before_history_cache_on_last_history_only():
    """Rolling-summary prefix is not part of the history cache breakpoint."""
    prefix = [
        {
            "role": "user",
            "content": "<system-reminder>Prior summary</system-reminder>",
        }
    ]
    history = [
        {"role": "user", "content": "h1"},
        {"role": "assistant", "content": "a1"},
    ]
    messages = build_messages(history, "New question", compaction_prefix=prefix)

    assert messages[0] == prefix[0]
    assert isinstance(messages[0]["content"], str)
    last_history = messages[2]
    assert last_history["role"] == "assistant"
    assert last_history["content"][-1].get("cache_control") == {"type": "ephemeral"}
    new_user = messages[-1]
    if isinstance(new_user["content"], list):
        for block in new_user["content"]:
            assert "cache_control" not in block


def test_move_message_cache_breakpoint_moves_to_last():
    """move_message_cache_breakpoint moves breakpoint to the last message."""
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

    move_message_cache_breakpoint(messages)

    # Old breakpoint removed
    assert "cache_control" not in messages[0]["content"][0]
    # New breakpoint on last message's last block
    assert messages[2]["content"][-1].get("cache_control") == {"type": "ephemeral"}


def test_move_message_cache_breakpoint_string_content():
    """move_message_cache_breakpoint converts string content to list with cache_control."""
    messages = [
        {"role": "user", "content": "plain string"},
    ]

    move_message_cache_breakpoint(messages)

    assert isinstance(messages[0]["content"], list)
    assert messages[0]["content"][0] == {
        "type": "text",
        "text": "plain string",
        "cache_control": {"type": "ephemeral"},
    }


def test_move_message_cache_breakpoint_strips_all_previous():
    """move_message_cache_breakpoint strips breakpoints from all previous messages."""
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

    move_message_cache_breakpoint(messages)

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
                "kind": "next_best_move",
                "content": {
                    "body": "Their counter is still above your target. Hold your number and push for the out-the-door total."
                },
                "priority": "high",
            },
            {
                "kind": "what_changed",
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
        ['[{"kind": "next_best_move"'], stop_reason="max_tokens"
    )
    recovered_stream = _FakePanelStream(
        [
            json.dumps(
                [
                    {
                        "kind": "next_best_move",
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
            "kind": "next_best_move",
            "template": "briefing",
            "title": "Next Best Move",
            "content": {"body": "The second attempt completed cleanly."},
            "priority": "high",
        }
    ]
    assert mock_client.messages.stream.await_count == 2
    assert mock_client.messages.stream.await_args_list[0].kwargs["max_tokens"] == 4096
    assert mock_client.messages.stream.await_args_list[1].kwargs["max_tokens"] == 8192


@patch("app.services.panel.create_anthropic_client")
async def test_stream_ai_panel_cards_with_usage_omits_ai_panel_cards_from_prompt_state(
    mock_create_client,
):
    mock_client = AsyncMock()
    mock_client.messages.stream = AsyncMock(
        return_value=_FakePanelStream(["[]"], stop_reason="end_turn")
    )
    mock_create_client.return_value = mock_client

    events = []
    async for event in stream_ai_panel_cards_with_usage(
        {
            "buyer_context": "researching",
            "vehicles": [],
            "deals": [],
            "ai_panel_cards": [
                {
                    "kind": "warning",
                    "template": "warning",
                    "title": "Warning",
                    "content": {"message": "stale", "severity": "warning"},
                    "priority": "high",
                }
            ],
        },
        "Use the latest state only.",
        [{"role": "user", "content": "What should I do next?"}],
    ):
        events.append((event.type, event.data))

    request_messages = mock_client.messages.stream.await_args.kwargs["messages"]
    prompt_text = request_messages[0]["content"][1]["text"]

    assert [event_type for event_type, _ in events] == ["panel_started", "panel_done"]
    assert '"buyer_context": "researching"' in prompt_text
    assert "ai_panel_cards" not in prompt_text


@patch("app.services.panel.create_anthropic_client")
async def test_stream_ai_panel_cards_with_usage_parses_incremental_cards(
    mock_create_client,
):
    streamed_chunks = [
        '[{"kind":"next_best_move","content":{"body":"Hold your target."},"priority":"high"},',
        '{"kind":"notes","content":{"items":["First offer: $31,900"]},"priority":"normal"},',
        '{"kind":"unknown","content":{"body":"invalid"},"priority":"high"},',
        '{"kind":"your_leverage","content":{"body":"You can walk away."},"priority":"normal"}]',
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
        "panel_done",
    ]

    panel_done = events[-1][1]
    assert [card["title"] for card in panel_done["cards"]] == [
        "Next Best Move",
        "Your Leverage",
        "Notes",
    ]
    assert panel_done["usage_summary"] == {
        "requests": 1,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "total_tokens": 0,
    }


@patch("app.services.panel.create_anthropic_client")
async def test_stream_ai_panel_cards_with_usage_reconciles_final_cards(
    mock_create_client,
):
    streamed_chunks = [
        '[{"kind":"notes","content":{"items":["VIN still missing"]},"priority":"normal"},',
        '{"kind":"next_best_move","content":{"body":"Get the VIN before you drive down."},"priority":"high"}]',
    ]

    mock_client = AsyncMock()
    mock_client.messages.stream = AsyncMock(
        return_value=_FakePanelStream(streamed_chunks, stop_reason="end_turn")
    )
    mock_create_client.return_value = mock_client

    notes_seen_incrementally = False

    def flaky_normalize(raw_card):
        nonlocal notes_seen_incrementally
        if (
            isinstance(raw_card, dict)
            and raw_card.get("kind") == "notes"
            and not notes_seen_incrementally
        ):
            notes_seen_incrementally = True
            return None
        return normalize_panel_card_impl(raw_card)

    events = []
    with patch("app.services.panel.normalize_panel_card", side_effect=flaky_normalize):
        async for event in stream_ai_panel_cards_with_usage(
            {"buyer_context": "researching", "vehicles": [], "deals": []},
            "Get the VIN before making the trip.",
            [{"role": "user", "content": "Should I drive down tomorrow?"}],
        ):
            events.append((event.type, event.data))

    assert [event_type for event_type, _ in events] == [
        "panel_started",
        "panel_done",
    ]

    panel_done = events[-1][1]
    assert [card["title"] for card in panel_done["cards"]] == [
        "Next Best Move",
        "Notes",
    ]


@patch("app.services.panel.create_anthropic_client")
async def test_stream_ai_panel_cards_with_usage_canonicalizes_duplicates_and_applies_per_kind_limits(
    mock_create_client,
):
    streamed_chunks = [
        "["
        '{"kind":"warning","content":{"severity":"warning","message":"Old concern."},"priority":"normal"},'
        '{"kind":"warning","content":{"severity":"critical","message":"The CARFAX shows a likely auction origin.","action":"Ask why it was wholesaled."},"priority":"critical"},'
        '{"kind":"numbers","content":{"rows":[{"label":"List","value":"$44,900"}]},"priority":"high"},'
        '{"kind":"notes","content":{"items":["One-owner claim is unverified"]},"priority":"normal"},'
        '{"kind":"your_leverage","content":{"body":"The repeated price cuts give you room to counter."},"priority":"high"},'
        '{"kind":"what_still_needs_confirming","content":{"items":[{"label":"Ask for the auction disclosure","done":false}]},"priority":"high"},'
        '{"kind":"vehicle","content":{"vehicle":{"year":2022,"make":"Ford","model":"F-250"}},"priority":"normal"}'
        "]"
    ]

    mock_client = AsyncMock()
    mock_client.messages.stream = AsyncMock(
        return_value=_FakePanelStream(streamed_chunks, stop_reason="end_turn")
    )
    mock_create_client.return_value = mock_client

    events = []
    async for event in stream_ai_panel_cards_with_usage(
        {"buyer_context": "reviewing_deal", "vehicles": [], "deals": []},
        "This history report needs a closer look.",
        [{"role": "user", "content": "Here is the CARFAX."}],
    ):
        events.append((event.type, event.data))

    panel_done = events[-1][1]
    assert [card["kind"] for card in panel_done["cards"]] == [
        "warning",
        "numbers",
        "your_leverage",
        "notes",
        "vehicle",
        "what_still_needs_confirming",
    ]
    assert (
        panel_done["cards"][0]["content"]["message"]
        == "The CARFAX shows a likely auction origin."
    )


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


@patch("app.services.panel.create_anthropic_client")
async def test_stream_ai_panel_cards_with_usage_keeps_only_active_vehicle_when_not_comparing(
    mock_create_client,
):
    streamed_chunks = [
        "["
        '{"kind":"next_best_move","content":{"body":"Get the full out-the-door sheet first."},"priority":"high"},'
        '{"kind":"vehicle","content":{"vehicle":{"year":2026,"make":"FORD","model":"F-250","vin":"1FTBF2BA4TEC99136","engine":"6.8L V8"}},"priority":"normal"},'
        '{"kind":"vehicle","content":{"vehicle":{"year":2026,"make":"FORD","model":"F-250","vin":"1FTBF2AT3TED05981","engine":"6.7L V8"}},"priority":"normal"}'
        "]"
    ]

    mock_client = AsyncMock()
    mock_client.messages.stream = AsyncMock(
        return_value=_FakePanelStream(streamed_chunks, stop_reason="end_turn")
    )
    mock_create_client.return_value = mock_client

    events = []
    async for event in stream_ai_panel_cards_with_usage(
        {
            "buyer_context": "researching",
            "active_deal_id": "deal-gas",
            "vehicles": [
                {
                    "id": "veh-gas",
                    "year": 2026,
                    "make": "FORD",
                    "model": "F-250",
                    "vin": "1FTBF2BA4TEC99136",
                    "engine": "6.8L V8",
                },
                {
                    "id": "veh-diesel",
                    "year": 2026,
                    "make": "FORD",
                    "model": "F-250",
                    "vin": "1FTBF2AT3TED05981",
                    "engine": "6.7L V8",
                },
            ],
            "deals": [
                {"id": "deal-gas", "vehicle_id": "veh-gas"},
                {"id": "deal-diesel", "vehicle_id": "veh-diesel"},
            ],
            "negotiation_context": {
                "situation": "Buyer picked the gas 4x4 and is preparing to engage."
            },
        },
        "Buyer chose the gas 4x4.",
        [{"role": "user", "content": "I think the gas 4x4 is best for me."}],
    ):
        events.append((event.type, event.data))

    panel_done = events[-1][1]
    vehicle_cards = [card for card in panel_done["cards"] if card["kind"] == "vehicle"]
    assert len(vehicle_cards) == 1
    assert vehicle_cards[0]["content"]["vehicle"]["vin"] == "1FTBF2BA4TEC99136"


@patch("app.services.panel.create_anthropic_client")
async def test_stream_ai_panel_cards_with_usage_keeps_both_vehicle_cards_without_explicit_choice(
    mock_create_client,
):
    streamed_chunks = [
        "["
        '{"kind":"next_best_move","content":{"body":"Compare both trucks before deciding."},"priority":"high"},'
        '{"kind":"vehicle","content":{"vehicle":{"year":2026,"make":"FORD","model":"F-250","vin":"1FTBF2BA4TEC99136","engine":"6.8L V8"}},"priority":"normal"},'
        '{"kind":"vehicle","content":{"vehicle":{"year":2026,"make":"FORD","model":"F-250","vin":"1FTBF2AT3TED05981","engine":"6.7L V8"}},"priority":"normal"}'
        "]"
    ]

    mock_client = AsyncMock()
    mock_client.messages.stream = AsyncMock(
        return_value=_FakePanelStream(streamed_chunks, stop_reason="end_turn")
    )
    mock_create_client.return_value = mock_client

    events = []
    async for event in stream_ai_panel_cards_with_usage(
        {
            "buyer_context": "researching",
            "active_deal_id": "deal-gas",
            "vehicles": [
                {
                    "id": "veh-gas",
                    "role": "candidate",
                    "year": 2026,
                    "make": "FORD",
                    "model": "F-250",
                    "vin": "1FTBF2BA4TEC99136",
                    "engine": "6.8L V8",
                },
                {
                    "id": "veh-diesel",
                    "role": "candidate",
                    "year": 2026,
                    "make": "FORD",
                    "model": "F-250",
                    "vin": "1FTBF2AT3TED05981",
                    "engine": "6.7L V8",
                },
            ],
            "deals": [
                {"id": "deal-gas", "vehicle_id": "veh-gas"},
                {"id": "deal-diesel", "vehicle_id": "veh-diesel"},
            ],
            "negotiation_context": {
                "situation": "Buyer is comparing gas vs diesel and has not decided."
            },
        },
        "Help me compare these two F-250 options.",
        [{"role": "user", "content": "Which one is better for me?"}],
    ):
        events.append((event.type, event.data))

    panel_done = events[-1][1]
    vehicle_cards = [card for card in panel_done["cards"] if card["kind"] == "vehicle"]
    assert len(vehicle_cards) == 2
    vins = {
        card["content"]["vehicle"]["vin"]
        for card in vehicle_cards
        if card.get("content", {}).get("vehicle", {}).get("vin")
    }
    assert vins == {"1FTBF2BA4TEC99136", "1FTBF2AT3TED05981"}


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
        patch(
            "app.services.claude.chat_loop.create_anthropic_client",
            return_value=object(),
        ),
        patch(
            "app.services.claude.streaming.stream_step_with_retry",
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
        patch(
            "app.services.claude.chat_loop.create_anthropic_client",
            return_value=object(),
        ),
        patch(
            "app.services.claude.streaming.stream_step_with_retry",
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
                "content": "Tool 'update_deal_phase' validation failed: update_deal_phase requires a non-empty phase string (see tool schema enum).",
            },
            {
                "type": "text",
                "text": POST_TOOL_CONTINUATION_REMINDER,
                "cache_control": {"type": "ephemeral"},
            },
        ]
    )


async def test_stream_chat_loop_handles_malformed_tool_json(adb, async_buyer_user):
    _, deal_state = await async_create_session_with_deal_state(adb, async_buyer_user)
    messages = [{"role": "user", "content": "Update my checklist."}]
    result = ChatLoopResult()

    step_0 = FakeClaudeResponse.malformed_tool_call(
        tool_id="check-1",
        name="update_checklist",
        partial_json='{"items": [',
        text_chunks=("I tried to update your checklist.",),
    ).to_items()
    step_1 = FakeClaudeResponse.text(
        "I hit a formatting issue while updating the checklist.",
        stop_reason="end_turn",
    ).to_items()

    with (
        patch(
            "app.services.claude.chat_loop.create_anthropic_client",
            return_value=object(),
        ),
        patch(
            "app.services.claude.streaming.stream_step_with_retry",
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
            {"type": "text", "text": "I tried to update your checklist."},
            {
                "type": "tool_use",
                "id": "check-1",
                "name": "update_checklist",
                "input": {},
            },
        ]
    )
    assert messages[-1]["content"] == snapshot(
        [
            {
                "type": "tool_result",
                "tool_use_id": "check-1",
                "is_error": True,
                "content": "Tool 'update_checklist' received malformed JSON input",
            },
            {
                "type": "text",
                "text": POST_TOOL_CONTINUATION_REMINDER,
                "cache_control": {"type": "ephemeral"},
            },
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
        patch(
            "app.services.claude.chat_loop.create_anthropic_client",
            return_value=object(),
        ),
        patch(
            "app.services.claude.streaming.stream_step_with_retry",
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
        patch(
            "app.services.claude.chat_loop.create_anthropic_client",
            return_value=object(),
        ),
        patch(
            "app.services.claude.streaming.stream_step_with_retry",
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


async def test_stream_chat_loop_recovers_full_done_when_max_steps_reached(
    adb, async_buyer_user
):
    _, deal_state = await async_create_session_with_deal_state(adb, async_buyer_user)
    await adb.commit()
    await adb.refresh(deal_state)
    result = ChatLoopResult()

    step_0 = FakeClaudeResponse.tool_calls(
        [
            {
                "id": "check-1",
                "name": "update_checklist",
                "input": {"items": [{"label": "Ask for OTD", "done": False}]},
            }
        ],
        text_chunks=("I updated your checklist.",),
    ).to_items()
    step_1 = FakeClaudeResponse.tool_calls(
        [
            {
                "id": "context-1",
                "name": "update_buyer_context",
                "input": {"buyer_context": "reviewing_deal"},
            }
        ],
        text_chunks=("I also updated your buyer context.",),
    ).to_items()
    recovery = FakeClaudeResponse.text(
        "Ask for the out-the-door price first, then make them itemize every fee before you react.",
    ).to_items()

    with (
        patch(
            "app.services.claude.chat_loop.create_anthropic_client",
            return_value=object(),
        ),
        patch(
            "app.services.claude.streaming.stream_step_with_retry",
            new=_scripted_stream_factory(step_0, step_1, recovery),
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

    assert events[-2] == (
        "retry",
        {"attempt": 1, "reason": "max_steps_recovery", "reset_text": True},
    )
    assert events[-1] == (
        "done",
        {
            "text": "Ask for the out-the-door price first, then make them itemize every fee before you react."
        },
    )
    assert result.completed is True
    assert result.full_text == (
        "Ask for the out-the-door price first, then make them itemize every fee before you react."
    )


async def test_stream_chat_loop_refreshes_context_between_steps(adb, async_buyer_user):
    _, deal_state = await async_create_session_with_deal_state(adb, async_buyer_user)
    await adb.commit()
    await adb.refresh(deal_state)
    result = ChatLoopResult()
    recorded_messages: list[list[dict]] = []

    step_0 = FakeClaudeResponse.tool_calls(
        [
            {
                "id": "vehicle-1",
                "name": "set_vehicle",
                "input": {
                    "make": "Ford",
                    "model": "F-250",
                    "role": "primary",
                },
            }
        ]
    ).to_items()
    step_1 = FakeClaudeResponse.text(
        "Tell me the year, trim, and whether it's new or used so I can narrow it down."
    ).to_items()
    scripts = iter((step_0, step_1))

    async def _recording_stream(*_args, **kwargs):
        messages_arg = kwargs.get("messages")
        if messages_arg is not None:
            recorded_messages.append(json.loads(json.dumps(messages_arg)))
        for item in next(scripts):
            yield item

    initial_context = build_context_message(
        await deal_state_to_dict(deal_state, adb),
    )
    messages = build_messages(
        [],
        "I'm considering purchasing an F250.",
        context_message=initial_context,
    )

    with (
        patch(
            "app.services.claude.chat_loop.create_anthropic_client",
            return_value=object(),
        ),
        patch(
            "app.services.claude.streaming.stream_step_with_retry",
            new=_recording_stream,
        ),
    ):
        await _collect_generator_events(
            stream_chat_loop(
                build_system_prompt(),
                messages,
                CHAT_TOOLS,
                TurnContext.create(session=None, deal_state=deal_state, db=adb),
                result,
                max_steps=2,
                session_factory=TestingAsyncSessionLocal,
            )
        )

    assert len(recorded_messages) == 2
    second_call_first_message = recorded_messages[1][0]
    assert second_call_first_message["role"] == "user"
    context_text = second_call_first_message["content"][0]["text"]
    assert '"make": "Ford"' in context_text
    assert '"model": "F-250"' in context_text
    assert '"active_deal_id": null' not in context_text


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
                "id": "check-1",
                "name": "update_checklist",
                "input": {
                    "items": [
                        {
                            "label": "Set budget around $45,000",
                            "done": False,
                        }
                    ]
                },
            }
        ],
        text_chunks=(duplicated_text,),
    ).to_items()
    step_1 = FakeClaudeResponse.text(duplicated_text, stop_reason="end_turn").to_items()

    with (
        patch(
            "app.services.claude.chat_loop.create_anthropic_client",
            return_value=object(),
        ),
        patch(
            "app.services.claude.streaming.stream_step_with_retry",
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


async def test_stream_chat_loop_fast_recovers_after_tool_only_step(
    adb, async_buyer_user
):
    _, deal_state = await async_create_session_with_deal_state(adb, async_buyer_user)
    result = ChatLoopResult()

    step_0 = FakeClaudeResponse.tool_calls(
        [
            {
                "id": "vehicle-1",
                "name": "set_vehicle",
                "input": {
                    "make": "Ford",
                    "model": "F-250",
                    "role": "primary",
                },
            }
        ]
    ).to_items()
    step_1 = FakeClaudeResponse.tool_calls(
        [
            {
                "id": "check-1",
                "name": "update_checklist",
                "input": {
                    "items": [
                        {
                            "label": "Share a listing with mileage and price",
                            "done": False,
                        }
                    ]
                },
            }
        ]
    ).to_items()
    recovery = FakeClaudeResponse.text(
        "Share a couple of listings with year, mileage, and asking price so I can tell you which one is strongest."
    ).to_items()

    with (
        patch(
            "app.services.claude.chat_loop.create_anthropic_client",
            return_value=object(),
        ),
        patch(
            "app.services.claude.streaming.stream_step_with_retry",
            new=_scripted_stream_factory(step_0, step_1, recovery),
        ),
    ):
        events = await _collect_generator_events(
            stream_chat_loop(
                build_system_prompt(),
                [{"role": "user", "content": "I'm considering purchasing an F250."}],
                CHAT_TOOLS,
                TurnContext.create(session=None, deal_state=deal_state, db=adb),
                result,
                session_factory=TestingAsyncSessionLocal,
            )
        )

    assert all(name != "retry" for name, _ in events)
    done_event = next(data for name, data in events if name == "done")
    assert done_event["text"] == (
        "Share a couple of listings with year, mileage, and asking price so I can tell you which one is strongest."
    )
    assert result.completed is True
    assert result.full_text == done_event["text"]


async def test_stream_chat_loop_continues_after_successful_text_and_structural_tools(
    adb, async_buyer_user
):
    _, deal_state = await async_create_session_with_deal_state(adb, async_buyer_user)
    result = ChatLoopResult()

    step_0 = FakeClaudeResponse.tool_calls(
        [
            {
                "id": "vehicle-1",
                "name": "set_vehicle",
                "input": {
                    "make": "Ford",
                    "model": "F-250",
                    "role": "primary",
                },
            }
        ],
        text_chunks=(
            "Share a couple of listings with year, mileage, and asking price so I can compare them.",
        ),
    ).to_items()
    step_1 = FakeClaudeResponse.text(
        "Send me the asking price too and I will tell you whether it is worth pursuing."
    ).to_items()

    recorded_messages: list[list[dict]] = []

    async def _recording_stream(*_args, **kwargs):
        messages_arg = kwargs.get("messages")
        if messages_arg is not None:
            recorded_messages.append(json.loads(json.dumps(messages_arg)))
        script = step_0 if len(recorded_messages) == 1 else step_1
        for item in script:
            yield item

    with (
        patch(
            "app.services.claude.chat_loop.create_anthropic_client",
            return_value=object(),
        ),
        patch(
            "app.services.claude.streaming.stream_step_with_retry",
            new=_recording_stream,
        ),
    ):
        events = await _collect_generator_events(
            stream_chat_loop(
                build_system_prompt(),
                [{"role": "user", "content": "Help me shop for this truck."}],
                CHAT_TOOLS,
                TurnContext.create(session=None, deal_state=deal_state, db=adb),
                result,
                session_factory=TestingAsyncSessionLocal,
            )
        )

    assert len(recorded_messages) == 2
    done_event = next(data for name, data in events if name == "done")
    assert done_event["text"] == (
        "Share a couple of listings with year, mileage, and asking price so I can compare them.\n\nSend me the asking price too and I will tell you whether it is worth pursuing."
    )
    assert result.completed is True
    assert result.full_text == done_event["text"]


async def test_send_message_sse_done_before_detached_followup(
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
        result.completed = True
        yield (
            "event: text\n"
            'data: {"chunk": "Hold at $28,500 and get the out-the-door total in writing."}\n\n'
        )

    with (
        patch(
            "app.services.buyer_chat_stream.stream_chat_loop", new=fake_stream_chat_loop
        ),
        patch(
            "app.services.buyer_chat_stream.update_session_metadata", new=AsyncMock()
        ),
    ):
        async with async_client.stream(
            "POST",
            f"/api/chat/{session.id}/message",
            json={"content": "They came back at 30,200"},
            headers={"Authorization": f"Bearer {token}"},
        ) as response:
            assert response.status_code == 200
            events = await _collect_response_events(response)

    assert [event_name for event_name, _ in events] == ["turn_started", "text", "done"]
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
    assert done_event["assistant_message_id"]

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
        assert persisted_messages[-1].id == done_event["assistant_message_id"]
        assert persisted_messages[-1].panel_cards is None
        assert persisted_messages[-1].usage == {
            "requests": 1,
            "inputTokens": 240,
            "outputTokens": 96,
            "cacheCreationInputTokens": 0,
            "cacheReadInputTokens": 180,
            "totalTokens": 336,
        }
        assert persisted_messages[-1].tool_calls is None

        session_result = await check_db.execute(
            select(ChatSession).where(ChatSession.id == session.id)
        )
        persisted_session = session_result.scalar_one()
        assert persisted_session.usage == {
            "request_count": 1,
            "input_tokens": 240,
            "output_tokens": 96,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 180,
            "total_tokens": 336,
            "total_cost_usd": 0.002214,
            "per_model": {
                "claude-sonnet-4-6": {
                    "request_count": 1,
                    "input_tokens": 240,
                    "output_tokens": 96,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 180,
                    "total_tokens": 336,
                    "total_cost_usd": 0.002214,
                }
            },
        }

    history_response = await async_client.get(
        f"/api/chat/{session.id}/messages",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert history_response.status_code == 200
    history_payload = history_response.json()
    assert "messages" in history_payload
    assert "context_pressure" in history_payload
    cp = history_payload["context_pressure"]
    assert cp["level"] in ("ok", "warn", "critical")
    assert isinstance(cp["estimated_input_tokens"], int)
    assert isinstance(cp["input_budget"], int)
    msgs = history_payload["messages"]
    assert msgs[-1]["usage"] == {
        "requests": 1,
        "inputTokens": 240,
        "outputTokens": 96,
        "cacheCreationInputTokens": 0,
        "cacheReadInputTokens": 180,
        "totalTokens": 336,
    }
    assert msgs[-1]["id"] == done_event["assistant_message_id"]
    assert msgs[-1]["panel_cards"] is None


async def test_send_message_runs_compaction_before_chat_when_over_budget(
    async_client, adb, async_buyer_user
):
    session, deal_state = await async_create_session_with_deal_state(
        adb, async_buyer_user
    )
    for i in range(10):
        role = MessageRole.USER if i % 2 == 0 else MessageRole.ASSISTANT
        adb.add(Message(session_id=session.id, role=role, content=f"hist-{i}"))
    await adb.commit()
    await adb.refresh(session)
    await adb.refresh(deal_state)
    token = create_access_token({"sub": async_buyer_user.id})

    block = MagicMock()
    block.text = "Session summary from primary model."
    summarizer_resp = MagicMock()
    summarizer_resp.content = [block]
    mock_summarizer = MagicMock()
    mock_summarizer.messages.create = AsyncMock(return_value=summarizer_resp)

    async def fake_stream_chat_loop(*args, **kwargs):
        result = args[4]
        result.full_text = "After compaction assistant text."
        merge_usage_summary(
            result.usage_summary,
            summarize_usage(
                SimpleNamespace(
                    input_tokens=10,
                    output_tokens=20,
                    cache_creation_input_tokens=0,
                    cache_read_input_tokens=0,
                )
            ),
        )
        result.completed = True
        yield ('event: text\ndata: {"chunk": "After compaction assistant text."}\n\n')

    with (
        patch(
            "app.services.compaction.estimate_turn_input_tokens",
            return_value=500_000,
        ),
        patch(
            "app.services.compaction.create_anthropic_client",
            return_value=mock_summarizer,
        ),
        patch(
            "app.services.buyer_chat_stream.stream_chat_loop", new=fake_stream_chat_loop
        ),
        patch(
            "app.services.buyer_chat_stream.update_session_metadata", new=AsyncMock()
        ),
    ):
        async with async_client.stream(
            "POST",
            f"/api/chat/{session.id}/message",
            json={"content": "Latest buyer turn"},
            headers={"Authorization": f"Bearer {token}"},
        ) as response:
            assert response.status_code == 200
            events = await _collect_response_events(response)

    names = [n for n, _ in events]
    assert names[:3] == ["turn_started", "compaction_started", "compaction_done"]
    assert "text" in names
    started = next(d for n, d in events if n == "compaction_started")
    assert started["reason"] == "input_budget"
    assert "estimated_input_tokens" in started
    mock_summarizer.messages.create.assert_awaited_once()

    async with TestingAsyncSessionLocal() as check_db:
        sess_row = (
            await check_db.execute(
                select(ChatSession).where(ChatSession.id == session.id)
            )
        ).scalar_one()
        assert sess_row.compaction_state is not None
        assert (
            sess_row.compaction_state["rolling_summary"]
            == "Session summary from primary model."
        )

        message_result = await check_db.execute(
            select(Message)
            .where(Message.session_id == session.id)
            .order_by(Message.created_at)
        )
        rows = list(message_result.scalars().all())
        assert any(m.role == MessageRole.SYSTEM for m in rows)
        assert rows[-1].role == MessageRole.ASSISTANT


async def test_send_message_skips_live_panel_events_when_user_mode_is_paused(
    async_client, adb, async_buyer_user
):
    session, deal_state = await async_create_session_with_deal_state(
        adb, async_buyer_user
    )
    adb.add(
        UserSettings(
            user_id=async_buyer_user.id,
            insights_update_mode=InsightsUpdateMode.PAUSED.value,
        )
    )
    await adb.commit()
    await adb.refresh(session)
    await adb.refresh(deal_state)
    token = create_access_token({"sub": async_buyer_user.id})
    offered_tool_names: list[str] = []

    async def fake_stream_chat_loop(*args, **kwargs):
        nonlocal offered_tool_names
        offered_tool_names = [tool["name"] for tool in args[2]]
        result = args[4]
        result.full_text = "Manual mode response."
        merge_usage_summary(
            result.usage_summary,
            summarize_usage(
                SimpleNamespace(
                    input_tokens=16,
                    output_tokens=12,
                    cache_creation_input_tokens=0,
                    cache_read_input_tokens=0,
                )
            ),
        )
        result.completed = True
        yield ('event: text\ndata: {"chunk": "Manual mode response."}\n\n')

    with (
        patch(
            "app.services.buyer_chat_stream.stream_chat_loop", new=fake_stream_chat_loop
        ),
        patch(
            "app.services.buyer_chat_stream.update_session_metadata", new=AsyncMock()
        ),
    ):
        async with async_client.stream(
            "POST",
            f"/api/chat/{session.id}/message",
            json={"content": "Check mode"},
            headers={"Authorization": f"Bearer {token}"},
        ) as response:
            assert response.status_code == 200
            events = await _collect_response_events(response)

        assert [event_name for event_name, _ in events] == [
            "turn_started",
            "text",
            "done",
        ]
        assert offered_tool_names == []
    done_event = next(data for name, data in events if name == "done")
    assert done_event["assistant_message_id"]


async def test_insights_followup_skips_all_work_when_user_mode_is_paused(
    async_client, adb, async_buyer_user
):
    session, deal_state = await async_create_session_with_deal_state(
        adb, async_buyer_user
    )
    adb.add(
        UserSettings(
            user_id=async_buyer_user.id,
            insights_update_mode=InsightsUpdateMode.PAUSED.value,
        )
    )
    assistant = Message(
        session_id=session.id,
        role=MessageRole.ASSISTANT,
        content="Here is how to hold the line on price.",
    )
    adb.add(assistant)
    await adb.commit()
    await adb.refresh(session)
    await adb.refresh(deal_state)
    await adb.refresh(assistant)
    token = create_access_token({"sub": async_buyer_user.id})

    async def should_not_reconcile(*args, **kwargs):
        raise AssertionError("reconcile should not run in paused mode")
        if False:
            yield ""

    async def should_not_stream_panel(*args, **kwargs):
        raise AssertionError("panel should not run in paused mode")
        if False:
            yield None

    with (
        patch(
            "app.services.insights_followup.stream_chat_loop",
            new=should_not_reconcile,
        ),
        patch(
            "app.services.insights_followup.stream_ai_panel_cards_with_usage",
            new=should_not_stream_panel,
        ),
    ):
        response = await async_client.post(
            f"/api/chat/{session.id}/insights-followup",
            json={"assistant_message_id": assistant.id},
            headers={"Authorization": f"Bearer {token}"},
        )

    assert response.status_code == 409
    assert response.json() == {
        "detail": (
            "Insights follow-up is unavailable while live updates are paused; "
            "use panel-refresh instead"
        )
    }

    job = await adb.scalar(
        select(InsightsFollowupJob).where(
            InsightsFollowupJob.session_id == session.id,
            InsightsFollowupJob.assistant_message_id == assistant.id,
        )
    )
    assert job is None


async def test_insights_followup_rejects_assistant_message_from_another_session(
    async_client, adb, async_buyer_user
):
    session, _ = await async_create_session_with_deal_state(adb, async_buyer_user)
    other_session, _ = await async_create_session_with_deal_state(adb, async_buyer_user)
    other_assistant = Message(
        session_id=other_session.id,
        role=MessageRole.ASSISTANT,
        content="Assistant reply in another session.",
    )
    adb.add(other_assistant)
    await adb.commit()
    await adb.refresh(session)
    await adb.refresh(other_assistant)
    token = create_access_token({"sub": async_buyer_user.id})

    response = await async_client.post(
        f"/api/chat/{session.id}/insights-followup",
        json={"assistant_message_id": other_assistant.id},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Assistant message not found for this session"}


async def test_insights_followup_persists_empty_panel_results_and_clears_stale_cards(
    async_client, adb, async_buyer_user
):
    session, deal_state = await async_create_session_with_deal_state(
        adb, async_buyer_user
    )
    deal_state.ai_panel_cards = [
        {
            "kind": "warning",
            "template": "warning",
            "title": "Warning",
            "content": {"severity": "warning", "message": "Stale warning"},
            "priority": "high",
        }
    ]
    assistant = Message(
        session_id=session.id,
        role=MessageRole.ASSISTANT,
        content="Here is the latest read on the deal.",
        usage={
            "requests": 1,
            "inputTokens": 20,
            "outputTokens": 10,
            "cacheCreationInputTokens": 0,
            "cacheReadInputTokens": 0,
            "totalTokens": 30,
        },
    )
    adb.add(assistant)
    await adb.commit()
    await adb.refresh(session)
    await adb.refresh(deal_state)
    await adb.refresh(assistant)
    token = create_access_token({"sub": async_buyer_user.id})

    async def fake_stream_panel_cards_with_usage(*args, **kwargs):
        yield SimpleNamespace(
            type="panel_started", data={"attempt": 1, "max_tokens": 2048}
        )
        yield SimpleNamespace(
            type="panel_done",
            data={
                "cards": [],
                "usage_summary": {
                    "requests": 1,
                    "input_tokens": 40,
                    "output_tokens": 10,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 0,
                    "total_tokens": 50,
                },
            },
        )

    async def fake_stream_chat_loop_noop(*args, **kwargs):
        result = args[4]
        result.completed = True
        if False:
            yield ""

    with (
        patch(
            "app.services.insights_followup.stream_chat_loop",
            new=fake_stream_chat_loop_noop,
        ),
        patch(
            "app.services.insights_followup.stream_ai_panel_cards_with_usage",
            new=fake_stream_panel_cards_with_usage,
        ),
    ):
        async with async_client.stream(
            "POST",
            f"/api/chat/{session.id}/insights-followup",
            json={"assistant_message_id": assistant.id},
            headers={"Authorization": f"Bearer {token}"},
        ) as response:
            assert response.status_code == 200
            events = await _collect_response_events(response)

    assert [event_name for event_name, _ in events] == ["panel_started", "panel_done"]
    panel_done = next(data for name, data in events if name == "panel_done")
    assert panel_done["cards"] == []

    async with TestingAsyncSessionLocal() as check_db:
        deal_state_result = await check_db.execute(
            select(DealState).where(DealState.session_id == session.id)
        )
        persisted_deal_state = deal_state_result.scalar_one()
        assert persisted_deal_state.ai_panel_cards == []

        message_result = await check_db.execute(
            select(Message)
            .where(Message.session_id == session.id)
            .order_by(Message.created_at)
        )
        persisted_messages = list(message_result.scalars().all())
        assert persisted_messages[-1].tool_calls[-1] == {
            "name": "update_insights_panel",
            "args": {"cards": []},
        }
        assert persisted_messages[-1].panel_cards == []
        assert persisted_messages[-1].usage == {
            "requests": 2,
            "inputTokens": 60,
            "outputTokens": 20,
            "cacheCreationInputTokens": 0,
            "cacheReadInputTokens": 0,
            "totalTokens": 80,
        }

        job = await check_db.scalar(
            select(InsightsFollowupJob).where(
                InsightsFollowupJob.session_id == session.id,
                InsightsFollowupJob.assistant_message_id == assistant.id,
            )
        )
        assert job is not None
        assert job.status == InsightsFollowupStatus.SUCCEEDED.value


async def test_insights_followup_reconciles_before_panel_and_emits_tool_results(
    async_client, adb, async_buyer_user
):
    session, deal_state = await async_create_session_with_deal_state(
        adb, async_buyer_user
    )
    assistant = Message(
        session_id=session.id,
        role=MessageRole.ASSISTANT,
        content="You should ask for the out-the-door price before discussing financing.",
        usage={
            "requests": 1,
            "inputTokens": 20,
            "outputTokens": 10,
            "cacheCreationInputTokens": 0,
            "cacheReadInputTokens": 0,
            "totalTokens": 30,
        },
    )
    adb.add(assistant)
    await adb.commit()
    await adb.refresh(session)
    await adb.refresh(deal_state)
    await adb.refresh(assistant)
    token = create_access_token({"sub": async_buyer_user.id})

    async def fake_stream_chat_loop(*args, **kwargs):
        turn_context = args[3]
        result = args[4]
        turn_context.deal_state.negotiation_context = {
            "stance": "negotiating",
            "situation": "Waiting for the dealer's out-the-door quote.",
        }
        merge_usage_summary(
            result.usage_summary,
            summarize_usage(
                SimpleNamespace(
                    input_tokens=12,
                    output_tokens=8,
                    cache_creation_input_tokens=0,
                    cache_read_input_tokens=0,
                )
            ),
        )
        result.completed = True
        yield (
            "event: tool_result\n"
            'data: {"tool": "update_negotiation_context", '
            '"data": {"stance": "negotiating", "situation": "Waiting for the dealer\'s out-the-door quote."}}\n\n'
        )

    async def fake_stream_panel_cards_with_usage(*args, **kwargs):
        yield SimpleNamespace(
            type="panel_started", data={"attempt": 1, "max_tokens": 2048}
        )
        yield SimpleNamespace(
            type="panel_done",
            data={
                "cards": [
                    {
                        "kind": "phase",
                        "template": "briefing",
                        "title": "Status",
                        "content": {
                            "stance": "negotiating",
                            "situation": "Waiting for the dealer's out-the-door quote.",
                        },
                        "priority": "high",
                    }
                ],
                "usage_summary": {
                    "requests": 1,
                    "input_tokens": 40,
                    "output_tokens": 10,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 0,
                    "total_tokens": 50,
                },
            },
        )

    with (
        patch(
            "app.services.insights_followup.stream_chat_loop",
            new=fake_stream_chat_loop,
        ),
        patch(
            "app.services.insights_followup.stream_ai_panel_cards_with_usage",
            new=fake_stream_panel_cards_with_usage,
        ),
    ):
        async with async_client.stream(
            "POST",
            f"/api/chat/{session.id}/insights-followup",
            json={"assistant_message_id": assistant.id},
            headers={"Authorization": f"Bearer {token}"},
        ) as response:
            assert response.status_code == 200
            events = await _collect_response_events(response)

    assert [event_name for event_name, _ in events] == [
        "panel_started",
        "tool_result",
        "panel_done",
    ]
    assert events[1] == (
        "tool_result",
        {
            "tool": "update_negotiation_context",
            "data": {
                "stance": "negotiating",
                "situation": "Waiting for the dealer's out-the-door quote.",
            },
        },
    )
    panel_done = events[-1][1]
    assert panel_done["usage"] == {
        "requests": 2,
        "inputTokens": 52,
        "outputTokens": 18,
        "cacheCreationInputTokens": 0,
        "cacheReadInputTokens": 0,
        "totalTokens": 70,
    }

    async with TestingAsyncSessionLocal() as check_db:
        persisted_deal_state = await check_db.scalar(
            select(DealState).where(DealState.session_id == session.id)
        )
        assert persisted_deal_state is not None
        assert persisted_deal_state.negotiation_context == {
            "stance": "negotiating",
            "situation": "Waiting for the dealer's out-the-door quote.",
        }

        persisted_message = await check_db.scalar(
            select(Message).where(Message.id == assistant.id)
        )
        assert persisted_message is not None
        assert persisted_message.usage == {
            "requests": 3,
            "inputTokens": 72,
            "outputTokens": 28,
            "cacheCreationInputTokens": 0,
            "cacheReadInputTokens": 0,
            "totalTokens": 100,
        }

        job = await check_db.scalar(
            select(InsightsFollowupJob).where(
                InsightsFollowupJob.session_id == session.id,
                InsightsFollowupJob.assistant_message_id == assistant.id,
            )
        )
        assert job is not None
        assert job.reconcile_status == InsightsFollowupStepStatus.SUCCEEDED.value
        assert job.panel_status == InsightsFollowupStepStatus.SUCCEEDED.value
        assert job.usage == panel_done["usage"]


async def test_insights_followup_marks_job_failed_when_panel_generation_errors(
    async_client, adb, async_buyer_user
):
    session, deal_state = await async_create_session_with_deal_state(
        adb, async_buyer_user
    )
    assistant = Message(
        session_id=session.id,
        role=MessageRole.ASSISTANT,
        content="The dealer still has not provided a written out-the-door quote.",
        panel_cards=[
            {
                "kind": "phase",
                "template": "briefing",
                "title": "Status",
                "content": {
                    "stance": "researching",
                    "situation": "Waiting on written numbers.",
                },
                "priority": "high",
            }
        ],
    )
    adb.add(assistant)
    await adb.commit()
    await adb.refresh(session)
    await adb.refresh(deal_state)
    await adb.refresh(assistant)
    token = create_access_token({"sub": async_buyer_user.id})

    async def fake_stream_chat_loop(*args, **kwargs):
        result = args[4]
        merge_usage_summary(
            result.usage_summary,
            summarize_usage(
                SimpleNamespace(
                    input_tokens=12,
                    output_tokens=8,
                    cache_creation_input_tokens=0,
                    cache_read_input_tokens=0,
                )
            ),
        )
        result.completed = True
        if False:
            yield ""

    async def fake_stream_panel_cards_with_usage(*args, **kwargs):
        yield SimpleNamespace(
            type="panel_started", data={"attempt": 1, "max_tokens": 2048}
        )
        yield SimpleNamespace(
            type="panel_error",
            data={"message": "Panel generation failed"},
        )

    with (
        patch(
            "app.services.insights_followup.stream_chat_loop",
            new=fake_stream_chat_loop,
        ),
        patch(
            "app.services.insights_followup.stream_ai_panel_cards_with_usage",
            new=fake_stream_panel_cards_with_usage,
        ),
    ):
        async with async_client.stream(
            "POST",
            f"/api/chat/{session.id}/insights-followup",
            json={"assistant_message_id": assistant.id},
            headers={"Authorization": f"Bearer {token}"},
        ) as response:
            assert response.status_code == 200
            events = await _collect_response_events(response)

    assert [event_name for event_name, _ in events] == [
        "panel_started",
        "panel_error",
    ]
    assert events[-1][1] == {"message": "Insights follow-up failed"}

    async with TestingAsyncSessionLocal() as check_db:
        persisted_message = await check_db.scalar(
            select(Message).where(Message.id == assistant.id)
        )
        assert persisted_message is not None
        assert persisted_message.panel_cards == assistant.panel_cards

        job = await check_db.scalar(
            select(InsightsFollowupJob).where(
                InsightsFollowupJob.session_id == session.id,
                InsightsFollowupJob.assistant_message_id == assistant.id,
            )
        )
        assert job is not None
        assert job.status == InsightsFollowupStatus.FAILED.value
        assert job.reconcile_status == InsightsFollowupStepStatus.SUCCEEDED.value
        assert job.panel_status == InsightsFollowupStepStatus.FAILED.value
        assert job.error == "Insights follow-up failed"


async def test_insights_followup_returns_cached_panel_done_for_succeeded_job(
    async_client, adb, async_buyer_user
):
    session, _ = await async_create_session_with_deal_state(adb, async_buyer_user)
    assistant = Message(
        session_id=session.id,
        role=MessageRole.ASSISTANT,
        content="Here is the latest read on the deal.",
        panel_cards=[
            {
                "kind": "phase",
                "template": "briefing",
                "title": "Status",
                "content": {
                    "stance": "researching",
                    "situation": "Waiting on fees.",
                },
                "priority": "high",
            }
        ],
    )
    adb.add(assistant)
    await adb.commit()
    await adb.refresh(session)
    await adb.refresh(assistant)

    job = InsightsFollowupJob(
        session_id=session.id,
        assistant_message_id=assistant.id,
        status=InsightsFollowupStatus.SUCCEEDED.value,
        attempts=1,
        reconcile_status=InsightsFollowupStepStatus.SKIPPED.value,
        panel_status=InsightsFollowupStepStatus.SUCCEEDED.value,
        usage={
            "requests": 1,
            "inputTokens": 12,
            "outputTokens": 8,
            "cacheCreationInputTokens": 0,
            "cacheReadInputTokens": 0,
            "totalTokens": 20,
        },
    )
    adb.add(job)
    await adb.commit()
    token = create_access_token({"sub": async_buyer_user.id})

    async def should_not_run_panel(*args, **kwargs):
        raise AssertionError(
            "panel stream should not run for succeeded cached follow-up"
        )
        yield

    with patch(
        "app.services.insights_followup.stream_ai_panel_cards_with_usage",
        new=should_not_run_panel,
    ):
        async with async_client.stream(
            "POST",
            f"/api/chat/{session.id}/insights-followup",
            json={"assistant_message_id": assistant.id},
            headers={"Authorization": f"Bearer {token}"},
        ) as response:
            assert response.status_code == 200
            events = await _collect_response_events(response)

    assert events == [
        (
            "panel_done",
            {
                "cards": assistant.panel_cards,
                "usage": job.usage,
                "assistant_message_id": assistant.id,
            },
        )
    ]


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
        patch(
            "app.services.buyer_chat_stream.stream_chat_loop",
            new=failing_stream_chat_loop,
        ),
        patch(
            "app.services.buyer_chat_stream.update_session_metadata", new=AsyncMock()
        ),
    ):
        async with async_client.stream(
            "POST",
            f"/api/chat/{session.id}/message",
            json={"content": "Can you help me?"},
            headers={"Authorization": f"Bearer {token}"},
        ) as response:
            assert response.status_code == 200
            events = await _collect_response_events(response)

    event_names = [n for n, _ in events]
    assert event_names[0] == "turn_started"
    assert ("error", {"message": "AI response failed. Please try again."}) in events

    async with TestingAsyncSessionLocal() as check_db:
        message_result = await check_db.execute(
            select(Message)
            .where(Message.session_id == session.id)
            .order_by(Message.created_at)
        )
        persisted_messages = list(message_result.scalars().all())
        # Failed turns must not leave a user row — otherwise retries duplicate history.
        assert persisted_messages == []


async def test_send_message_failed_turn_does_not_accumulate_duplicate_user_rows(
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
        patch(
            "app.services.buyer_chat_stream.stream_chat_loop",
            new=failing_stream_chat_loop,
        ),
        patch(
            "app.services.buyer_chat_stream.update_session_metadata", new=AsyncMock()
        ),
    ):
        for _ in range(3):
            async with async_client.stream(
                "POST",
                f"/api/chat/{session.id}/message",
                json={"content": "Same text every time"},
                headers={"Authorization": f"Bearer {token}"},
            ) as response:
                assert response.status_code == 200
                await _collect_response_events(response)

    async with TestingAsyncSessionLocal() as check_db:
        message_result = await check_db.execute(
            select(Message).where(Message.session_id == session.id)
        )
        assert message_result.scalars().all() == []


async def test_stream_buyer_chat_turn_emits_error_and_removes_orphan_user_when_assistant_persist_fails(
    adb, async_buyer_user
):
    session, deal_state = await async_create_session_with_deal_state(
        adb, async_buyer_user
    )
    await adb.commit()
    await adb.refresh(session)
    await adb.refresh(deal_state)

    deal_state_dict = await deal_state_to_dict(deal_state, adb)
    original_commit = adb.commit
    commit_count = 0

    async def commit_with_assistant_failure():
        nonlocal commit_count
        commit_count += 1
        if commit_count == 2:
            raise RuntimeError("assistant insert failed")
        await original_commit()

    async def fake_stream_chat_loop(*args, **kwargs):
        result = args[4]
        result.full_text = "Assistant reply before persist"
        result.completed = True
        yield ('event: text\ndata: {"chunk": "Assistant reply before persist"}\n\n')

    with (
        patch.object(
            adb, "commit", new=AsyncMock(side_effect=commit_with_assistant_failure)
        ),
        patch(
            "app.services.buyer_chat_stream.run_auto_compaction_if_needed",
            new=AsyncMock(
                return_value=SimpleNamespace(
                    sse_chunks=[],
                    updated_state=None,
                    system_notice_content=None,
                )
            ),
        ),
        patch(
            "app.services.buyer_chat_stream.stream_chat_loop", new=fake_stream_chat_loop
        ),
    ):
        turn_state = TurnCancellationState(
            turn_id="test-turn", session_id=session.id, user_id=async_buyer_user.id
        )
        events = await _collect_generator_events(
            stream_buyer_chat_turn(
                db=adb,
                session=session,
                session_id=session.id,
                content="Please help",
                image_url=None,
                resumed_user_row=None,
                history=[],
                deal_state=deal_state,
                deal_state_dict=deal_state_dict,
                linked_messages=None,
                system_prompt=[],
                allow_persistence_affecting_tools=True,
                turn_state=turn_state,
            )
        )

    assert events == [
        ("text", {"chunk": "Assistant reply before persist"}),
        (
            "error",
            {"message": "We could not save the assistant response. Please try again."},
        ),
    ]

    message_result = await adb.execute(
        select(Message)
        .where(Message.session_id == session.id)
        .order_by(Message.created_at)
    )
    assert message_result.scalars().all() == []


async def test_insights_followup_emits_panel_error_when_panel_stream_crashes_after_start(
    async_client, adb, async_buyer_user
):
    session, _ = await async_create_session_with_deal_state(adb, async_buyer_user)
    assistant = Message(
        session_id=session.id,
        role=MessageRole.ASSISTANT,
        content="Use your pre-approval as leverage.",
    )
    adb.add(assistant)
    await adb.commit()
    await adb.refresh(session)
    await adb.refresh(assistant)
    token = create_access_token({"sub": async_buyer_user.id})

    async def failing_stream_panel_cards_with_usage(*args, **kwargs):
        yield SimpleNamespace(
            type="panel_started", data={"attempt": 1, "max_tokens": 2048}
        )
        raise RuntimeError("panel stream crashed")

    async def fake_stream_chat_loop_noop(*args, **kwargs):
        result = args[4]
        result.completed = True
        if False:
            yield ""

    with (
        patch(
            "app.services.insights_followup.stream_chat_loop",
            new=fake_stream_chat_loop_noop,
        ),
        patch(
            "app.services.insights_followup.stream_ai_panel_cards_with_usage",
            new=failing_stream_panel_cards_with_usage,
        ),
    ):
        async with async_client.stream(
            "POST",
            f"/api/chat/{session.id}/insights-followup",
            json={"assistant_message_id": assistant.id},
            headers={"Authorization": f"Bearer {token}"},
        ) as response:
            assert response.status_code == 200
            events = await _collect_response_events(response)

    assert [event_name for event_name, _ in events] == [
        "panel_started",
        "panel_error",
    ]
    assert events[-1] == ("panel_error", {"message": "Insights follow-up failed"})


async def test_insights_followup_treats_panel_error_event_as_terminal_failure(
    async_client, adb, async_buyer_user
):
    session, _ = await async_create_session_with_deal_state(adb, async_buyer_user)
    assistant = Message(
        session_id=session.id,
        role=MessageRole.ASSISTANT,
        content="Use your pre-approval as leverage.",
        panel_cards=[
            {
                "kind": "notes",
                "template": "notes",
                "title": "Existing panel",
                "content": {"summary": "Keep this until a real replacement exists."},
                "priority": "high",
            }
        ],
    )
    adb.add(assistant)
    await adb.commit()
    await adb.refresh(session)
    await adb.refresh(assistant)
    token = create_access_token({"sub": async_buyer_user.id})

    async def fake_panel_stream_with_error_event(*args, **kwargs):
        yield SimpleNamespace(
            type="panel_started", data={"attempt": 1, "max_tokens": 2048}
        )
        yield SimpleNamespace(
            type="panel_error", data={"message": "Panel generation failed"}
        )

    async def fake_stream_chat_loop_noop(*args, **kwargs):
        result = args[4]
        result.completed = True
        if False:
            yield ""

    with (
        patch(
            "app.services.insights_followup.stream_chat_loop",
            new=fake_stream_chat_loop_noop,
        ),
        patch(
            "app.services.insights_followup.stream_ai_panel_cards_with_usage",
            new=fake_panel_stream_with_error_event,
        ),
    ):
        async with async_client.stream(
            "POST",
            f"/api/chat/{session.id}/insights-followup",
            json={"assistant_message_id": assistant.id},
            headers={"Authorization": f"Bearer {token}"},
        ) as response:
            assert response.status_code == 200
            events = await _collect_response_events(response)

    assert [event_name for event_name, _ in events] == [
        "panel_started",
        "panel_error",
    ]
    assert events[-1] == ("panel_error", {"message": "Insights follow-up failed"})

    assistant_result = await adb.execute(
        select(Message).where(Message.id == assistant.id)
    )
    refreshed_assistant = assistant_result.scalar_one()
    assert refreshed_assistant.panel_cards == assistant.panel_cards

    job_result = await adb.execute(
        select(InsightsFollowupJob).where(
            InsightsFollowupJob.session_id == session.id,
            InsightsFollowupJob.assistant_message_id == assistant.id,
            InsightsFollowupJob.kind
            == InsightsFollowupKind.LINKED_RECONCILE_PANEL.value,
        )
    )
    job = job_result.scalar_one()
    assert job.status == InsightsFollowupStatus.FAILED.value
    assert job.reconcile_status == InsightsFollowupStepStatus.SUCCEEDED.value
    assert job.panel_status == InsightsFollowupStepStatus.FAILED.value


async def test_insights_followup_fails_when_panel_stream_ends_without_terminal_event(
    async_client, adb, async_buyer_user
):
    session, _ = await async_create_session_with_deal_state(adb, async_buyer_user)
    assistant = Message(
        session_id=session.id,
        role=MessageRole.ASSISTANT,
        content="Use your pre-approval as leverage.",
    )
    adb.add(assistant)
    await adb.commit()
    await adb.refresh(session)
    await adb.refresh(assistant)
    token = create_access_token({"sub": async_buyer_user.id})

    async def fake_panel_stream_without_terminal(*args, **kwargs):
        yield SimpleNamespace(
            type="panel_started", data={"attempt": 1, "max_tokens": 2048}
        )

    async def fake_stream_chat_loop_noop(*args, **kwargs):
        result = args[4]
        result.completed = True
        if False:
            yield ""

    with (
        patch(
            "app.services.insights_followup.stream_chat_loop",
            new=fake_stream_chat_loop_noop,
        ),
        patch(
            "app.services.insights_followup.stream_ai_panel_cards_with_usage",
            new=fake_panel_stream_without_terminal,
        ),
    ):
        async with async_client.stream(
            "POST",
            f"/api/chat/{session.id}/insights-followup",
            json={"assistant_message_id": assistant.id},
            headers={"Authorization": f"Bearer {token}"},
        ) as response:
            assert response.status_code == 200
            events = await _collect_response_events(response)

    assert [event_name for event_name, _ in events] == [
        "panel_started",
        "panel_error",
    ]
    assert events[-1] == ("panel_error", {"message": "Insights follow-up failed"})

    job_result = await adb.execute(
        select(InsightsFollowupJob).where(
            InsightsFollowupJob.session_id == session.id,
            InsightsFollowupJob.assistant_message_id == assistant.id,
            InsightsFollowupJob.kind
            == InsightsFollowupKind.LINKED_RECONCILE_PANEL.value,
        )
    )
    job = job_result.scalar_one()
    assert job.status == InsightsFollowupStatus.FAILED.value
    assert job.panel_status == InsightsFollowupStepStatus.FAILED.value


async def test_insights_followup_rejects_concurrent_run_for_same_message(
    async_client, adb, async_buyer_user
):
    """When a followup job is already RUNNING, the endpoint emits panel_error."""
    session, _ = await async_create_session_with_deal_state(adb, async_buyer_user)
    assistant = Message(
        session_id=session.id,
        role=MessageRole.ASSISTANT,
        content="Negotiate on the out-the-door price.",
    )
    adb.add(assistant)
    await adb.commit()
    await adb.refresh(session)
    await adb.refresh(assistant)

    running_job = InsightsFollowupJob(
        session_id=session.id,
        assistant_message_id=assistant.id,
        kind=InsightsFollowupKind.LINKED_RECONCILE_PANEL.value,
        status=InsightsFollowupStatus.RUNNING.value,
        reconcile_status=InsightsFollowupStepStatus.RUNNING.value,
        panel_status=InsightsFollowupStepStatus.PENDING.value,
        attempts=1,
    )
    adb.add(running_job)
    await adb.commit()
    token = create_access_token({"sub": async_buyer_user.id})

    async def should_not_run_chat_loop(*args, **kwargs):
        raise AssertionError("chat loop should not run when job is already running")
        if False:
            yield ""

    async def should_not_run_panel(*args, **kwargs):
        raise AssertionError("panel should not run when job is already running")
        if False:
            yield None

    with (
        patch(
            "app.services.insights_followup.stream_chat_loop",
            new=should_not_run_chat_loop,
        ),
        patch(
            "app.services.insights_followup.stream_ai_panel_cards_with_usage",
            new=should_not_run_panel,
        ),
    ):
        async with async_client.stream(
            "POST",
            f"/api/chat/{session.id}/insights-followup",
            json={"assistant_message_id": assistant.id},
            headers={"Authorization": f"Bearer {token}"},
        ) as response:
            assert response.status_code == 200
            events = await _collect_response_events(response)

    assert events == [
        ("panel_error", {"message": "Insights follow-up is already running."}),
    ]


def test_get_buyer_chat_tools_both_flags_false_returns_empty():
    """When both allow_persistence_affecting_tools and allow_chat_only_tools are False, no tools are returned."""
    assert (
        get_buyer_chat_tools(
            allow_persistence_affecting_tools=False,
            allow_chat_only_tools=False,
        )
        == []
    )


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
