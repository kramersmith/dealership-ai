"""Custom context compaction for buyer chat (ADR 0017).

Projects long transcripts into a rolling summary + verbatim tail for the model,
while persisting full history and user-visible system notices.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import anthropic

from app.core.config import settings
from app.models.enums import ContextPressureLevel, MessageRole
from app.models.message import Message
from app.models.session import ChatSession
from app.services.claude import create_anthropic_client

logger = logging.getLogger(__name__)

COMPACTION_STATE_VERSION = 1

# Rough image token budget for estimation (no pixel decode).
_IMAGE_TOKEN_ESTIMATE = 2000

_SUMMARY_SYSTEM = (
    "You compress a car-buying chat transcript into a dense rolling summary for the assistant. "
    "Preserve: numbers (prices, payments, APR, miles), vehicle identifiers (VIN, year/make/model), "
    "deal structure, red flags mentioned, user goals, open questions, and negotiation stance. "
    "Use concise bullets or short paragraphs. Do not address the user; output summary text only."
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _estimate_tokens(text: str) -> int:
    if not text:
        return 0
    return max(1, len(text) // 4)


def estimate_message_tokens(msg: Message) -> int:
    t = _estimate_tokens(msg.content)
    if msg.image_url:
        t += _IMAGE_TOKEN_ESTIMATE
    return t


def dialogue_messages(messages: list[Message]) -> list[Message]:
    return [m for m in messages if m.role in (MessageRole.USER, MessageRole.ASSISTANT)]


def _find_dialogue_index(dialogue: list[Message], message_id: str) -> int | None:
    for i, m in enumerate(dialogue):
        if m.id == message_id:
            return i
    return None


def parse_compaction_state(raw: dict[str, Any] | None) -> dict[str, Any]:
    if not raw or not isinstance(raw, dict):
        return {}
    return raw


def project_for_model(
    messages: list[Message],
    compaction_state: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """Return (compaction_prefix_blocks, history_tail_dicts) for build_messages.

    history_tail_dicts are user/assistant turns only, already truncated to the
    logical verbatim tail (then build_messages applies CLAUDE_MAX_HISTORY again).
    """
    state = parse_compaction_state(compaction_state)
    dialogue = dialogue_messages(messages)
    first_id = state.get("first_kept_message_id")
    rolling = (state.get("rolling_summary") or "").strip()

    if first_id:
        idx = _find_dialogue_index(dialogue, str(first_id))
        if idx is None:
            logger.warning(
                "compaction first_kept_message_id not found in dialogue; ignoring compaction state"
            )
            tail = dialogue
            rolling = ""
        else:
            tail = dialogue[idx:]
    else:
        tail = dialogue

    max_hist = settings.CLAUDE_MAX_HISTORY
    tail_slice = tail[-max_hist:]
    tail_dicts = [{"role": m.role, "content": m.content} for m in tail_slice]

    prefix: list[dict[str, Any]] = []
    if rolling:
        wrapped = (
            "<system-reminder>\n"
            "Prior conversation (summarized for context; full history is still available to the app):\n"
            f"{rolling}\n"
            "</system-reminder>"
        )
        prefix = [{"role": "user", "content": wrapped}]
        # Ensure message alternation: if the tail starts with a user message,
        # insert a synthetic assistant acknowledgment so the API doesn't reject
        # two consecutive user messages.
        if tail_dicts and tail_dicts[0]["role"] == MessageRole.USER:
            prefix.append(
                {
                    "role": "assistant",
                    "content": "Understood, continuing with that context.",
                }
            )

    return prefix, tail_dicts


def _linked_messages_text_estimate(linked_messages: list[dict] | None) -> int:
    if not linked_messages:
        return 0
    total = 0
    for msg in linked_messages:
        content = msg.get("content", "")
        if isinstance(content, list):
            parts = [
                p.get("text", "")
                for p in content
                if isinstance(p, dict) and p.get("type") == "text"
            ]
            content = " ".join(parts)
        elif not isinstance(content, str):
            content = str(content)
        total += _estimate_tokens(content[:4000])
    return total


def estimate_turn_input_tokens(
    compaction_prefix: list[dict[str, Any]],
    history_tail: list[dict[str, str]],
    context_text: str | None,
    new_user_text: str,
    new_image_url: str | None,
    linked_messages: list[dict] | None,
) -> int:
    """Heuristic input-token estimate for the next Claude call."""
    static = settings.CLAUDE_COMPACTION_STATIC_OVERHEAD_TOKENS
    ctx = _estimate_tokens(context_text or "")
    linked = _linked_messages_text_estimate(linked_messages)

    body = 0
    for block in compaction_prefix:
        c = block.get("content")
        if isinstance(c, str):
            body += _estimate_tokens(c)
    for msg in history_tail:
        body += _estimate_tokens(msg.get("content", "") or "")

    user_turn = _estimate_tokens(new_user_text)
    if new_image_url:
        user_turn += _IMAGE_TOKEN_ESTIMATE

    return static + ctx + linked + body + user_turn


def context_pressure_level(estimated: int) -> ContextPressureLevel:
    budget = settings.CLAUDE_CONTEXT_INPUT_BUDGET
    warn_line = budget - settings.CLAUDE_COMPACTION_WARN_BUFFER_TOKENS
    critical_line = budget - settings.CLAUDE_COMPACTION_AUTO_BUFFER_TOKENS
    if estimated >= critical_line:
        return ContextPressureLevel.CRITICAL
    if estimated >= warn_line:
        return ContextPressureLevel.WARN
    return ContextPressureLevel.OK


def build_context_pressure_payload(estimated: int) -> dict[str, Any]:
    return {
        "level": context_pressure_level(estimated),
        "estimated_input_tokens": estimated,
        "input_budget": settings.CLAUDE_CONTEXT_INPUT_BUDGET,
    }


def compute_session_context_pressure(
    messages: list[Message],
    compaction_state: dict[str, Any] | None,
    context_message: dict | None,
    linked_messages: list[dict] | None,
) -> dict[str, Any]:
    """Pressure for GET /messages — assumes minimal next user turn (empty)."""
    prefix, tail = project_for_model(messages, compaction_state)
    ctx = None
    if context_message and isinstance(context_message.get("content"), str):
        ctx = context_message["content"]
    est = estimate_turn_input_tokens(
        prefix,
        tail,
        ctx,
        new_user_text="",
        new_image_url=None,
        linked_messages=linked_messages,
    )
    return build_context_pressure_payload(est)


def _fold_plan(
    dialogue: list[Message], state: dict[str, Any]
) -> tuple[list[Message], str | None, bool]:
    """Return (segment_to_fold, new_first_kept_id, should_run).

    should_run is False when there is nothing to fold or dialogue too short.
    """
    v = max(1, settings.CLAUDE_COMPACTION_VERBATIM_MESSAGES)
    if len(dialogue) <= v:
        return [], "", False

    first_id = state.get("first_kept_message_id")
    if first_id:
        idx = _find_dialogue_index(dialogue, str(first_id))
        if idx is None:
            i_old = 0
        else:
            i_old = idx
    else:
        i_old = 0

    i_new = len(dialogue) - v
    if i_new <= i_old:
        return [], "", False

    segment = dialogue[i_old:i_new]
    new_first = dialogue[i_new].id
    return segment, new_first, True


def _is_prompt_too_long(exc: BaseException) -> bool:
    if isinstance(exc, anthropic.APIStatusError):
        body = getattr(exc, "body", None)
        if isinstance(body, dict):
            err = body.get("error")
            if isinstance(err, dict):
                msg = (err.get("message") or "").lower()
                if "prompt is too long" in msg or "too many tokens" in msg:
                    return True
    return False


async def _call_summarizer(
    client: anthropic.AsyncAnthropic,
    prior_summary: str,
    segment_text: str,
) -> str:
    user_parts: list[str] = []
    if prior_summary:
        user_parts.append(f"Existing summary to merge and replace:\n{prior_summary}\n")
    user_parts.append("New transcript to incorporate:\n" + segment_text)
    user_content = "\n".join(user_parts)

    response = await client.messages.create(
        model=settings.CLAUDE_MODEL,
        max_tokens=settings.CLAUDE_COMPACTION_SUMMARY_MAX_TOKENS,
        system=_SUMMARY_SYSTEM,
        messages=[{"role": "user", "content": user_content}],
    )
    if not response.content:
        return ""
    block = response.content[0]
    if hasattr(block, "text"):
        return block.text.strip()
    return ""


@dataclass
class CompactionRunResult:
    sse_chunks: list[str]
    system_notice_content: str | None
    updated_state: dict[str, Any] | None


async def run_auto_compaction_if_needed(
    session: ChatSession,
    messages_before_user: list[Message],
    new_user_text: str,
    new_image_url: str | None,
    context_message: dict | None,
    linked_messages: list[dict] | None,
) -> CompactionRunResult:
    """Run summarization (same model as chat) when estimated input exceeds auto threshold.

    Mutates session.compaction_state in memory; caller persists. On success may
    return system_notice_content for persisting a Message(role=system).
    """
    chunks: list[str] = []
    if not settings.CLAUDE_COMPACTION_ENABLED:
        return CompactionRunResult(chunks, None, None)

    state = parse_compaction_state(session.compaction_state)
    failures = int(state.get("consecutive_failures") or 0)
    if failures >= settings.CLAUDE_COMPACTION_MAX_CONSECUTIVE_FAILURES:
        logger.info(
            "compaction skipped (circuit open): session_id=%s failures=%s",
            session.id,
            failures,
        )
        return CompactionRunResult(chunks, None, None)

    prefix, tail = project_for_model(messages_before_user, state)
    ctx = None
    if context_message and isinstance(context_message.get("content"), str):
        ctx = context_message["content"]
    est = estimate_turn_input_tokens(
        prefix,
        tail,
        ctx,
        new_user_text,
        new_image_url,
        linked_messages,
    )
    budget = settings.CLAUDE_CONTEXT_INPUT_BUDGET
    auto_line = budget - settings.CLAUDE_COMPACTION_AUTO_BUFFER_TOKENS
    if est < auto_line:
        return CompactionRunResult(chunks, None, None)

    dialogue = dialogue_messages(messages_before_user)
    segment, new_first_id, should = _fold_plan(dialogue, state)
    if not should or not new_first_id:
        return CompactionRunResult(chunks, None, None)

    prior_summary = (state.get("rolling_summary") or "").strip()

    def _segment_as_text(msgs: list[Message]) -> str:
        lines: list[str] = []
        for m in msgs:
            cap = m.content[:12000]
            lines.append(f"{m.role.upper()}: {cap}")
        return "\n\n".join(lines)

    working_segment = list(segment)
    max_retries = max(1, settings.CLAUDE_COMPACTION_PTL_MAX_RETRIES)
    client = create_anthropic_client()
    summary = ""
    last_error: BaseException | None = None

    chunks.append(
        f"event: compaction_started\ndata: {json.dumps({'reason': 'input_budget', 'estimated_input_tokens': est, 'input_budget': budget})}\n\n"
    )

    for attempt in range(max_retries):
        try:
            if not working_segment:
                break
            st = _segment_as_text(working_segment)
            summary = await _call_summarizer(client, prior_summary, st)
            if summary:
                break
        except Exception as e:
            last_error = e
            if _is_prompt_too_long(e) and len(working_segment) > 2:
                working_segment = working_segment[len(working_segment) // 2 :]
                logger.warning(
                    "compaction summarizer prompt too long; shrinking segment attempt=%s",
                    attempt + 1,
                )
                continue
            logger.exception("compaction summarizer failed attempt=%s", attempt + 1)
            break

    if not summary:
        new_state = {
            **state,
            "version": COMPACTION_STATE_VERSION,
            "consecutive_failures": failures + 1,
            "updated_at": _utc_now_iso(),
        }
        err_payload: dict[str, Any] = {
            "message": "Context summarization failed; continuing without compacting."
        }
        if last_error is not None:
            err_payload["detail"] = type(last_error).__name__
        chunks.append(f"event: compaction_error\ndata: {json.dumps(err_payload)}\n\n")
        return CompactionRunResult(chunks, None, new_state)

    new_state = {
        "version": COMPACTION_STATE_VERSION,
        "rolling_summary": summary,
        "first_kept_message_id": new_first_id,
        "updated_at": _utc_now_iso(),
        "consecutive_failures": 0,
    }
    notice = (
        "Earlier messages were summarized to stay within the assistant context limit. "
        "Your full chat history is still saved; this only affects how the model reads past turns."
    )
    chunks.append(
        f"event: compaction_done\ndata: {json.dumps({'first_kept_message_id': new_first_id})}\n\n"
    )
    return CompactionRunResult(chunks, notice, new_state)
