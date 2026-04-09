"""Chat turn harness logging: full vs lite NDJSON payloads for ``chat_turn_summary``."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from typing import Any

from app.core.config import settings
from app.core.log_redact import (
    DEFAULT_PREVIEW_MAX_CHARS,
    chat_text_for_full_log,
    deep_sanitize_log_data,
    preview_chat_text,
)
from app.core.logging_setup import flush_logging_handlers

logger = logging.getLogger(__name__)

_HARNESS_SHAPE_FULL = "full"
_HARNESS_SHAPE_LITE = "lite"
_CHAT_TURN_SUMMARY_EVENT = "chat_turn_summary"
VerbosePayloadFactory = Callable[[], dict[str, Any]]


def tool_names_in_order(tool_calls: list[dict[str, Any]]) -> list[str]:
    """Return distinct tool names in first-seen order from a tool-call trace."""

    seen: set[str] = set()
    names: list[str] = []
    for tool_call in tool_calls:
        tool_name = tool_call.get("name")
        if isinstance(tool_name, str) and tool_name not in seen:
            seen.add(tool_name)
            names.append(tool_name)
    return names


def build_chat_turn_summary_payload(
    *,
    session_id: str,
    user_text: str,
    assistant_text: str,
    tool_names: list[str],
    tool_calls: list[dict[str, Any]],
    final_panel_cards: list[dict[str, Any]] | None,
    include_full_payload: bool,
    preview_max_chars: int = DEFAULT_PREVIEW_MAX_CHARS,
) -> dict[str, Any]:
    """Build the JSON object embedded in the ``chat_turn_summary`` log line.

    ``final_panel_cards`` uses ``None`` to mean the panel did not complete and an
    empty list to mean the panel completed with zero cards.
    """

    payload: dict[str, Any] = {
        "event": _CHAT_TURN_SUMMARY_EVENT,
        "session_id": session_id,
        "user_chars": len(user_text),
        "assistant_chars": len(assistant_text),
        "tool_names": tool_names,
        "harness_shape": (
            _HARNESS_SHAPE_FULL if include_full_payload else _HARNESS_SHAPE_LITE
        ),
    }

    if include_full_payload:
        payload["user_text"] = chat_text_for_full_log(user_text)
        payload["assistant_text"] = chat_text_for_full_log(assistant_text)
        payload["tool_calls"] = deep_sanitize_log_data(tool_calls)
        if final_panel_cards is not None:
            payload["panel_cards"] = deep_sanitize_log_data(final_panel_cards)
        return payload

    payload["user_preview"] = preview_chat_text(
        user_text,
        max_chars=preview_max_chars,
    )
    payload["assistant_preview"] = preview_chat_text(
        assistant_text,
        max_chars=preview_max_chars,
    )
    if final_panel_cards is not None:
        payload["panel_card_count"] = len(final_panel_cards)
        payload["panel_card_kinds"] = [
            str(card.get("kind") or "") for card in final_panel_cards
        ]
    return payload


def log_chat_turn_summary(
    *,
    session_id: str,
    user_text: str,
    assistant_text: str,
    tool_calls: list[dict[str, Any]],
    final_panel_cards: list[dict[str, Any]] | None,
) -> None:
    """Emit the canonical INFO ``chat_turn_summary`` line for a completed turn."""

    payload = build_chat_turn_summary_payload(
        session_id=session_id,
        user_text=user_text,
        assistant_text=assistant_text,
        tool_names=tool_names_in_order(tool_calls),
        tool_calls=tool_calls,
        final_panel_cards=final_panel_cards,
        include_full_payload=settings.chat_harness_includes_full_payload(),
        preview_max_chars=settings.LOG_CHAT_HARNESS_PREVIEW_MAX_CHARS,
    )
    logger.info(
        "%s %s",
        _CHAT_TURN_SUMMARY_EVENT,
        json.dumps(payload, ensure_ascii=False, default=str),
    )
    flush_logging_handlers()


def log_chat_harness_verbose_event(
    tag: str,
    payload_source: dict[str, Any] | VerbosePayloadFactory,
) -> None:
    """Emit a single DEBUG line when ``LOG_CHAT_HARNESS_VERBOSITY=verbose``.

    Observability must never affect the chat turn, so bad payloads are logged and
    swallowed instead of propagating.
    """

    if not settings.chat_harness_is_verbose():
        return
    try:
        payload = payload_source() if callable(payload_source) else payload_source
        serialized = json.dumps(
            deep_sanitize_log_data({"tag": tag, **payload}),
            default=str,
        )
    except Exception:
        logger.exception("chat_harness_verbose payload failed: tag=%s", tag)
        return

    try:
        logger.debug("chat_harness_verbose %s", serialized)
    except Exception:
        logger.exception("chat_harness_verbose emit failed: tag=%s", tag)
