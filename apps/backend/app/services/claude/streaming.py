from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncGenerator
from typing import Any

import anthropic

from app.core.config import settings

logger = logging.getLogger(__name__)


class StreamInterruptedError(RuntimeError):
    """Raised when a user stop request interrupts Claude streaming."""


async def stream_step_with_retry(  # noqa: C901
    client: anthropic.AsyncAnthropic,
    *,
    model: str,
    max_tokens: int,
    system: list[dict],
    messages: list[dict],
    tools: list[dict] | None = None,
    tool_choice: dict | None = None,
    idle_timeout: int = settings.CLAUDE_STREAM_IDLE_TIMEOUT,
    max_retries: int = settings.CLAUDE_STREAM_MAX_RETRIES,
    is_cancelled=None,
) -> AsyncGenerator[tuple[str, Any], None]:
    """Stream a single step with idle-timeout watchdog and retry.

    Yields (event_type, event_data) tuples from the Anthropic stream.
    On stream stall or connection error: retries up to max_retries times.
    On exhausted retries: falls back to a non-streaming API call.

    Event types yielded:
    - ("stream_event", event) — raw Anthropic stream event
    - ("final_message", message) — the final Message object (usage, stop_reason)
    - ("retry", {"attempt": N, "reason": str}) — retry notification for SSE
    """
    last_error: Exception | None = None

    for attempt in range(1 + max_retries):
        if is_cancelled and is_cancelled():
            raise StreamInterruptedError("Chat stream interrupted before request")
        try:
            stream_kwargs: dict[str, Any] = {
                "model": model,
                "max_tokens": max_tokens,
                "system": system,
                "messages": messages,
            }
            if tools is not None:
                stream_kwargs["tools"] = tools
            if tool_choice is not None:
                stream_kwargs["tool_choice"] = tool_choice

            async with client.messages.stream(
                **stream_kwargs,
            ) as stream:
                stream_iter = stream.__aiter__()
                while True:
                    if is_cancelled and is_cancelled():
                        raise StreamInterruptedError("Chat stream interrupted")
                    try:
                        event = await asyncio.wait_for(
                            stream_iter.__anext__(), timeout=idle_timeout
                        )
                        yield ("stream_event", event)
                    except StopAsyncIteration:
                        break
                    except asyncio.TimeoutError:
                        logger.warning(
                            "Stream stalled (no events for %ds), attempt %d/%d",
                            idle_timeout,
                            attempt + 1,
                            1 + max_retries,
                        )
                        raise  # break out of stream context to retry

                # Stream completed successfully — get final message
                final_message = await stream.get_final_message()
                yield ("final_message", final_message)
                return

        except asyncio.TimeoutError:
            last_error = asyncio.TimeoutError(f"Stream idle for {idle_timeout}s")
            reason = "stream_stall"
        except anthropic.APIConnectionError as exc:
            last_error = exc
            reason = "connection_error"
            logger.warning(
                "Stream connection error, attempt %d/%d: %s",
                attempt + 1,
                1 + max_retries,
                exc,
            )
        except anthropic.APIStatusError as exc:
            # HTTP-level 429/529 are retried by the SDK before the stream opens.
            # But transient errors (overloaded, rate_limit) can also arrive INSIDE
            # an already-open SSE stream — the SDK can't retry those because the
            # HTTP response was already 200. Retry them at the stream level.
            body = getattr(exc, "body", None)
            error_type = (
                body.get("error", {}).get("type", "") if isinstance(body, dict) else ""
            )
            if error_type in ("overloaded_error", "rate_limit_error"):
                last_error = exc
                reason = "api_overloaded"
                logger.warning(
                    "Transient API error during stream (%s), attempt %d/%d",
                    error_type,
                    attempt + 1,
                    1 + max_retries,
                )
            else:
                raise

        # Emit retry event (unless this was the last attempt)
        if attempt < max_retries:
            yield ("retry", {"attempt": attempt + 1, "reason": reason})
            backoff = (attempt + 1) * 1.0  # 1s, 2s
            await asyncio.sleep(backoff)

    # All stream retries exhausted — fall back to non-streaming
    logger.warning("Stream retries exhausted, falling back to non-streaming API call")
    try:
        if is_cancelled and is_cancelled():
            raise StreamInterruptedError("Chat stream interrupted before fallback")
        create_kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": messages,
        }
        if tools is not None:
            create_kwargs["tools"] = tools
        if tool_choice is not None:
            create_kwargs["tool_choice"] = tool_choice

        response = await client.messages.create(  # type: ignore[call-overload]
            **create_kwargs,
        )
        # Convert non-streaming response to the same event shape
        for block in response.content:
            if block.type == "text":
                yield ("stream_event", SyntheticTextEvent(block.text))
            elif block.type == "tool_use":
                yield ("stream_event", SyntheticToolStartEvent(block.id, block.name))
                yield ("stream_event", SyntheticToolJsonEvent(json.dumps(block.input)))
                yield ("stream_event", SyntheticBlockStopEvent())
        yield ("final_message", response)

    except Exception:
        # Non-streaming fallback also failed — re-raise
        logger.exception("Non-streaming fallback failed")
        raise last_error or Exception("All retry attempts failed")  # noqa: B904


# Synthetic event wrappers for non-streaming fallback — minimal duck-typed objects
# that match the attributes accessed in stream_chat_loop's event processing.


class SyntheticTextEvent:
    type = "content_block_delta"

    def __init__(self, text: str) -> None:
        self.delta = type("Delta", (), {"type": "text_delta", "text": text})()


class SyntheticToolStartEvent:
    type = "content_block_start"

    def __init__(self, tool_id: str, name: str) -> None:
        self.content_block = type(
            "CB", (), {"type": "tool_use", "id": tool_id, "name": name}
        )()


class SyntheticToolJsonEvent:
    type = "content_block_delta"

    def __init__(self, json_str: str) -> None:
        self.delta = type(
            "Delta", (), {"type": "input_json_delta", "partial_json": json_str}
        )()


class SyntheticBlockStopEvent:
    type = "content_block_stop"
