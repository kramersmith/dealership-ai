"""Unit tests for context compaction projection and pressure helpers."""

import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import anthropic
import httpx
from app.models.enums import MessageRole
from app.models.message import Message
from app.models.session import ChatSession
from app.services.compaction import (
    COMPACTION_STATE_VERSION,
    build_context_pressure_payload,
    compute_session_context_pressure,
    context_pressure_level,
    dialogue_messages,
    estimate_message_tokens,
    estimate_turn_input_tokens,
    project_for_model,
    run_auto_compaction_if_needed,
)


def _msg(role: str, content: str, mid: str | None = None) -> Message:
    return Message(
        id=mid or str(uuid.uuid4()),
        session_id="s1",
        role=role,
        content=content,
    )


def test_dialogue_messages_filters_roles():
    rows = [
        _msg(MessageRole.USER, "u1"),
        _msg(MessageRole.SYSTEM, "notice"),
        _msg(MessageRole.ASSISTANT, "a1"),
    ]
    d = dialogue_messages(rows)
    assert [m.role for m in d] == [MessageRole.USER, MessageRole.ASSISTANT]


def test_project_for_model_no_state_full_tail():
    rows = [_msg(MessageRole.USER, f"m{i}") for i in range(3)]
    prefix, tail = project_for_model(rows, None)
    assert prefix == []
    assert len(tail) == 3


def test_project_for_model_with_summary_and_first_kept():
    kept_id = "keep-me"
    rows = [
        _msg(MessageRole.USER, "old", "x1"),
        _msg(MessageRole.ASSISTANT, "mid", "x2"),
        _msg(MessageRole.USER, "new", kept_id),
        _msg(MessageRole.ASSISTANT, "last", "x4"),
    ]
    state = {
        "rolling_summary": "User discussed pricing.",
        "first_kept_message_id": kept_id,
    }
    prefix, tail = project_for_model(rows, state)
    # prefix has summary + synthetic assistant ack (tail starts with user)
    assert len(prefix) == 2
    assert "Prior conversation" in prefix[0]["content"]
    assert "pricing" in prefix[0]["content"]
    assert prefix[1]["role"] == "assistant"
    assert [t["content"] for t in tail] == ["new", "last"]


def test_project_for_model_alternation_no_ack_when_tail_starts_with_assistant():
    """No synthetic ack when verbatim tail already starts with an assistant message."""
    rows = [
        _msg(MessageRole.USER, "old", "x1"),
        _msg(MessageRole.ASSISTANT, "kept-first", "x2"),
        _msg(MessageRole.USER, "new", "x3"),
    ]
    state = {
        "rolling_summary": "Summary text.",
        "first_kept_message_id": "x2",
    }
    prefix, tail = project_for_model(rows, state)
    assert len(prefix) == 1  # only summary, no ack needed
    assert tail[0]["role"] == "assistant"


def test_context_pressure_level_thresholds():
    from app.core.config import settings

    budget = settings.CLAUDE_CONTEXT_INPUT_BUDGET
    warn_line = budget - settings.CLAUDE_COMPACTION_WARN_BUFFER_TOKENS
    critical_line = budget - settings.CLAUDE_COMPACTION_AUTO_BUFFER_TOKENS
    assert context_pressure_level(0) == "ok"
    assert context_pressure_level(warn_line - 1) == "ok"
    assert context_pressure_level(warn_line) == "warn"
    assert context_pressure_level(critical_line - 1) == "warn"
    assert context_pressure_level(critical_line) == "critical"


def test_compute_session_context_pressure_shape():
    rows = [_msg(MessageRole.USER, "hello")]
    p = compute_session_context_pressure(rows, None, None, None)
    assert set(p.keys()) == {"level", "estimated_input_tokens", "input_budget"}
    assert p["level"] in ("ok", "warn", "critical")


def _summarizer_response(text: str) -> MagicMock:
    block = MagicMock()
    block.text = text
    resp = MagicMock()
    resp.content = [block]
    return resp


def _dialogue_turns(num_pairs: int) -> list[Message]:
    """Alternating user/assistant messages with stable ids (2 * num_pairs rows)."""
    out: list[Message] = []
    for i in range(num_pairs * 2):
        role = MessageRole.USER if i % 2 == 0 else MessageRole.ASSISTANT
        out.append(_msg(role, f"turn-{i}", mid=f"mid-{i}"))
    return out


def _sse_event_names(chunks: list[str]) -> list[str]:
    names: list[str] = []
    for raw in chunks:
        for line in raw.splitlines():
            if line.startswith("event: "):
                names.append(line.removeprefix("event: ").strip())
    return names


async def test_run_auto_compaction_success_calls_summarizer_and_returns_notice():
    session = ChatSession(id="sess-1", user_id="user-1", title="T")
    dialogue = _dialogue_turns(5)
    mock_client = MagicMock()
    mock_client.messages.create = AsyncMock(
        return_value=_summarizer_response("Compact summary.")
    )

    with (
        patch(
            "app.services.compaction.estimate_turn_input_tokens",
            return_value=500_000,
        ),
        patch(
            "app.services.compaction.create_anthropic_client",
            return_value=mock_client,
        ),
    ):
        result = await run_auto_compaction_if_needed(
            session, dialogue, "next user text", None, None, None
        )

    assert _sse_event_names(result.sse_chunks) == [
        "compaction_started",
        "compaction_done",
    ]
    assert result.system_notice_content
    assert "summarized" in result.system_notice_content.lower()
    assert result.updated_state is not None
    assert result.updated_state["rolling_summary"] == "Compact summary."
    assert result.updated_state["first_kept_message_id"] == dialogue[2].id
    assert result.updated_state["version"] == COMPACTION_STATE_VERSION
    assert result.updated_state["consecutive_failures"] == 0
    mock_client.messages.create.assert_awaited_once()


async def test_run_auto_compaction_skips_when_estimate_below_auto_line():
    session = ChatSession(id="sess-2", user_id="user-1", title="T")
    dialogue = _dialogue_turns(5)
    mock_client = MagicMock()
    mock_client.messages.create = AsyncMock(return_value=_summarizer_response("x"))

    with (
        patch(
            "app.services.compaction.estimate_turn_input_tokens",
            return_value=1,
        ),
        patch(
            "app.services.compaction.create_anthropic_client",
            return_value=mock_client,
        ),
    ):
        result = await run_auto_compaction_if_needed(
            session, dialogue, "hi", None, None, None
        )

    assert result.sse_chunks == []
    assert result.updated_state is None
    mock_client.messages.create.assert_not_awaited()


async def test_run_auto_compaction_circuit_open_skips_api():
    session = ChatSession(id="sess-3", user_id="user-1", title="T")
    session.compaction_state = {"consecutive_failures": 3}
    dialogue = _dialogue_turns(5)
    mock_client = MagicMock()
    mock_client.messages.create = AsyncMock(return_value=_summarizer_response("x"))

    with (
        patch(
            "app.services.compaction.estimate_turn_input_tokens",
            return_value=500_000,
        ),
        patch(
            "app.services.compaction.create_anthropic_client",
            return_value=mock_client,
        ),
    ):
        result = await run_auto_compaction_if_needed(
            session, dialogue, "hi", None, None, None
        )

    assert result.sse_chunks == []
    assert result.updated_state is None
    mock_client.messages.create.assert_not_awaited()


async def test_run_auto_compaction_api_failure_emits_error_and_increments_failures():
    session = ChatSession(id="sess-4", user_id="user-1", title="T")
    dialogue = _dialogue_turns(5)
    mock_client = MagicMock()
    mock_client.messages.create = AsyncMock(side_effect=RuntimeError("api down"))

    with (
        patch(
            "app.services.compaction.estimate_turn_input_tokens",
            return_value=500_000,
        ),
        patch(
            "app.services.compaction.create_anthropic_client",
            return_value=mock_client,
        ),
    ):
        result = await run_auto_compaction_if_needed(
            session, dialogue, "hi", None, None, None
        )

    assert _sse_event_names(result.sse_chunks) == [
        "compaction_started",
        "compaction_error",
    ]
    assert result.system_notice_content is None
    assert result.updated_state is not None
    assert result.updated_state["consecutive_failures"] == 1
    data = json.loads(result.sse_chunks[-1].split("data: ", 1)[1].split("\n", 1)[0])
    assert "message" in data


async def test_run_auto_compaction_ptl_shrink_then_succeeds():
    session = ChatSession(id="sess-5", user_id="user-1", title="T")
    dialogue = _dialogue_turns(6)
    ptl = anthropic.APIStatusError(
        "bad",
        response=httpx.Response(
            400, request=httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        ),
        body={"error": {"message": "prompt is too long"}},
    )
    mock_client = MagicMock()
    mock_client.messages.create = AsyncMock(
        side_effect=[ptl, _summarizer_response("After shrink OK")]
    )

    with (
        patch(
            "app.services.compaction.estimate_turn_input_tokens",
            return_value=500_000,
        ),
        patch(
            "app.services.compaction.create_anthropic_client",
            return_value=mock_client,
        ),
    ):
        result = await run_auto_compaction_if_needed(
            session, dialogue, "hi", None, None, None
        )

    assert result.updated_state is not None
    assert result.updated_state["rolling_summary"] == "After shrink OK"
    assert mock_client.messages.create.await_count == 2


async def test_run_auto_compaction_requires_foldable_history():
    """Below verbatim tail size, high estimate alone must not call the API."""
    session = ChatSession(id="s-short", user_id="u1", title="T")
    short = _dialogue_turns(3)
    mock_client = MagicMock()
    mock_client.messages.create = AsyncMock(return_value=_summarizer_response("x"))

    with (
        patch(
            "app.services.compaction.estimate_turn_input_tokens",
            return_value=500_000,
        ),
        patch(
            "app.services.compaction.create_anthropic_client",
            return_value=mock_client,
        ),
    ):
        result = await run_auto_compaction_if_needed(
            session, short, "hi", None, None, None
        )

    assert result.sse_chunks == []
    mock_client.messages.create.assert_not_awaited()


def test_run_auto_compaction_disabled(monkeypatch):
    import app.services.compaction as compaction_mod

    monkeypatch.setattr(compaction_mod.settings, "CLAUDE_COMPACTION_ENABLED", False)
    session = ChatSession(id="sess-off", user_id="u1", title="T")
    dialogue = _dialogue_turns(5)

    async def _run():
        with patch(
            "app.services.compaction.create_anthropic_client",
            return_value=MagicMock(),
        ):
            return await run_auto_compaction_if_needed(
                session, dialogue, "hi", None, None, None
            )

    import asyncio

    result = asyncio.run(_run())
    assert result.sse_chunks == []
    assert result.updated_state is None


# ── estimate_turn_input_tokens direct tests ──


def test_estimate_turn_input_tokens_empty_inputs():
    est = estimate_turn_input_tokens([], [], None, "", None, None)
    from app.core.config import settings

    assert est == settings.CLAUDE_COMPACTION_STATIC_OVERHEAD_TOKENS


def test_estimate_turn_input_tokens_accounts_for_all_components():
    prefix = [{"role": "user", "content": "summary " * 100}]
    tail = [{"role": "user", "content": "tail " * 50}]
    ctx = "context " * 20
    user_text = "hello world"

    est = estimate_turn_input_tokens(prefix, tail, ctx, user_text, None, None)
    from app.core.config import settings

    assert est > settings.CLAUDE_COMPACTION_STATIC_OVERHEAD_TOKENS


def test_estimate_turn_input_tokens_image_adds_budget():
    base = estimate_turn_input_tokens([], [], None, "hi", None, None)
    with_img = estimate_turn_input_tokens([], [], None, "hi", "http://img.png", None)
    assert with_img > base


def test_estimate_turn_input_tokens_linked_messages():
    linked = [
        {"role": "user", "content": "linked " * 200},
        {"role": "assistant", "content": "reply " * 200},
    ]
    base = estimate_turn_input_tokens([], [], None, "hi", None, None)
    with_linked = estimate_turn_input_tokens([], [], None, "hi", None, linked)
    assert with_linked > base


def test_estimate_turn_input_tokens_linked_messages_content_blocks():
    """Linked messages with list-of-blocks content should still be estimated."""
    linked = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "block text " * 100},
                {"type": "image", "source": "data:..."},
            ],
        },
    ]
    est = estimate_turn_input_tokens([], [], None, "hi", None, linked)
    base = estimate_turn_input_tokens([], [], None, "hi", None, None)
    assert est > base


# ── estimate_message_tokens ──


def test_estimate_message_tokens_basic():
    msg = _msg(MessageRole.USER, "a" * 400)
    t = estimate_message_tokens(msg)
    assert t == 100  # 400 chars // 4


def test_estimate_message_tokens_with_image():
    msg = _msg(MessageRole.USER, "short")
    msg.image_url = "http://example.com/photo.jpg"
    t = estimate_message_tokens(msg)
    assert t > 2000  # includes _IMAGE_TOKEN_ESTIMATE


def test_estimate_message_tokens_empty():
    msg = _msg(MessageRole.USER, "")
    t = estimate_message_tokens(msg)
    assert t == 0


# ── build_context_pressure_payload ──


def test_build_context_pressure_payload_shape():
    payload = build_context_pressure_payload(50_000)
    assert set(payload.keys()) == {"level", "estimated_input_tokens", "input_budget"}
    assert payload["estimated_input_tokens"] == 50_000
    assert payload["level"] == "ok"


# ── project_for_model edge cases ──


def test_project_for_model_missing_first_kept_id_falls_back():
    """When first_kept_message_id references a deleted message, fall back to full dialogue."""
    rows = [
        _msg(MessageRole.USER, "u1", "id1"),
        _msg(MessageRole.ASSISTANT, "a1", "id2"),
    ]
    state = {
        "rolling_summary": "old summary",
        "first_kept_message_id": "nonexistent-id",
    }
    prefix, tail = project_for_model(rows, state)
    # Should ignore compaction state and return full tail with no summary prefix
    assert prefix == []
    assert len(tail) == 2
