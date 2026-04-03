"""Session title generation — deterministic vehicle titles and LLM fallback."""

import logging
import time

from app.core.config import settings
from app.services.claude import create_anthropic_client, summarize_usage
from app.services.usage_tracking import (
    UsageRecorder,
    build_request_usage,
    log_request_usage,
)

logger = logging.getLogger(__name__)

MAX_TITLE_LENGTH = 40


def build_vehicle_title(vehicle: dict | None) -> str | None:
    """Build a title from a vehicle dict. Returns None if no vehicle data.

    Accepts a flat vehicle dict with keys: year, make, model, trim.
    """
    if not vehicle or not vehicle.get("make"):
        return None

    parts = []
    if vehicle.get("year"):
        parts.append(str(vehicle["year"]))
    parts.append(vehicle["make"])
    if vehicle.get("model"):
        parts.append(vehicle["model"])
    if vehicle.get("trim"):
        parts.append(vehicle["trim"])

    return " ".join(parts)[:MAX_TITLE_LENGTH]


async def generate_session_title(
    messages: list[dict],
    *,
    usage_recorder: UsageRecorder | None = None,
    session_id: str | None = None,
) -> str | None:
    """Generate a short title from conversation using Haiku.

    Returns None on failure so the caller can keep the existing title.
    """
    if not messages:
        return None

    # Use last 3 messages for context (enough to capture the topic)
    recent = messages[-3:]
    context_messages = [
        {"role": m["role"], "content": m["content"]}
        for m in recent
        if m["role"] in ("user", "assistant") and m.get("content")
    ]
    if not context_messages:
        return None

    # Claude API requires messages to start with "user" and alternate roles.
    # Merge consecutive same-role messages and ensure the final prompt (user)
    # doesn't create a duplicate.
    merged: list[dict] = []
    for msg in context_messages:
        if merged and merged[-1]["role"] == msg["role"]:
            merged[-1]["content"] += "\n" + msg["content"]
        else:
            merged.append(dict(msg))

    # Ensure first message is from user (API requirement)
    if merged and merged[0]["role"] != "user":
        merged = merged[1:]
    if not merged:
        return None

    # The title prompt is a user message; if the last context message is also
    # user, merge the prompt into it to avoid consecutive user messages.
    title_prompt = (
        "Generate a 3-6 word title for this car buying conversation. "
        "Focus on the vehicle or topic being discussed. "
        "Return ONLY the title text, no quotes or punctuation."
    )
    if merged[-1]["role"] == "user":
        merged[-1]["content"] += "\n\n" + title_prompt
        api_messages = merged
    else:
        api_messages = [*merged, {"role": "user", "content": title_prompt}]

    try:
        client = create_anthropic_client()
        started_at = time.monotonic()
        response = await client.messages.create(
            model=settings.CLAUDE_FAST_MODEL,
            max_tokens=30,
            messages=api_messages,  # type: ignore[arg-type]
        )
        request_usage = build_request_usage(
            model=settings.CLAUDE_FAST_MODEL,
            usage_summary=summarize_usage(response.usage),
            latency_ms=int((time.monotonic() - started_at) * 1000),
        )
        log_request_usage(
            logger,
            request_usage,
            context="title_generation",
            session_id=session_id,
        )
        if usage_recorder:
            usage_recorder(request_usage)
        block = response.content[0]
        title = (
            block.text.strip().strip('"').strip("'") if hasattr(block, "text") else ""
        )
        if title:
            return title[:MAX_TITLE_LENGTH]
    except Exception:
        logger.warning("Title generation failed, keeping existing title", exc_info=True)

    return None
