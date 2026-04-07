from __future__ import annotations

import logging
from typing import Any

import anthropic

from app.core.config import settings
from app.services.claude import streaming as claude_streaming
from app.services.claude.usage_stats import (
    empty_usage_summary,
    get_escalated_max_tokens,
    merge_usage_summary,
    summarize_usage,
)

logger = logging.getLogger(__name__)


async def generate_text_only_recovery_response(
    client: anthropic.AsyncAnthropic,
    *,
    system: list[dict],
    messages: list[dict],
) -> dict[str, Any] | None:
    current_max_tokens = settings.CLAUDE_MAX_TOKENS
    truncation_retry_count = 0
    usage_summary = empty_usage_summary()

    while True:
        recovery_text = ""
        stop_reason = None

        try:
            async for event_type, event_data in claude_streaming.stream_step_with_retry(
                client,
                model=settings.CLAUDE_MODEL,
                max_tokens=current_max_tokens,
                system=system,
                messages=messages,
            ):
                if event_type == "retry":
                    recovery_text = ""
                    continue

                if event_type == "final_message":
                    stop_reason = event_data.stop_reason
                    merge_usage_summary(
                        usage_summary,
                        summarize_usage(event_data.usage),
                    )
                    logger.info(
                        "Cache [chat_loop recovery]: creation=%d read=%d uncached=%d stop=%s max_tokens=%d",
                        getattr(event_data.usage, "cache_creation_input_tokens", 0)
                        or 0,
                        getattr(event_data.usage, "cache_read_input_tokens", 0) or 0,
                        event_data.usage.input_tokens,
                        stop_reason,
                        current_max_tokens,
                    )
                    continue

                event = event_data
                if (
                    event.type == "content_block_delta"
                    and getattr(event.delta, "type", None) == "text_delta"
                ):
                    recovery_text += event.delta.text

        except Exception:
            logger.exception("Chat loop recovery response failed")
            return None

        if stop_reason == "max_tokens":
            next_max_tokens = get_escalated_max_tokens(current_max_tokens)
            if (
                truncation_retry_count < settings.CLAUDE_MAX_TOKENS_RETRIES
                and next_max_tokens > current_max_tokens
            ):
                truncation_retry_count += 1
                logger.warning(
                    "Chat loop recovery hit max_tokens at %d, retrying with %d (%d/%d)",
                    current_max_tokens,
                    next_max_tokens,
                    truncation_retry_count,
                    settings.CLAUDE_MAX_TOKENS_RETRIES,
                )
                current_max_tokens = next_max_tokens
                continue

            logger.warning(
                "Chat loop recovery exhausted max_tokens retries at budget=%d",
                current_max_tokens,
            )

        stripped_text = recovery_text.strip()
        if stripped_text:
            return {
                "text": stripped_text,
                "usage_summary": usage_summary,
            }
        return None
