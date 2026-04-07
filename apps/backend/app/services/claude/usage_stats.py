from __future__ import annotations

from typing import Any

from app.core.config import settings


def empty_usage_summary() -> dict[str, int]:
    return {
        "requests": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "total_tokens": 0,
    }


def summarize_usage(usage: Any) -> dict[str, int]:
    input_tokens = getattr(usage, "input_tokens", 0) or 0
    output_tokens = getattr(usage, "output_tokens", 0) or 0
    cache_creation_input_tokens = getattr(usage, "cache_creation_input_tokens", 0) or 0
    cache_read_input_tokens = getattr(usage, "cache_read_input_tokens", 0) or 0
    return {
        "requests": 1,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_creation_input_tokens": cache_creation_input_tokens,
        "cache_read_input_tokens": cache_read_input_tokens,
        "total_tokens": input_tokens + output_tokens,
    }


def merge_usage_summary(total: dict[str, int], delta: dict[str, int]) -> None:
    for key in (
        "requests",
        "input_tokens",
        "output_tokens",
        "cache_creation_input_tokens",
        "cache_read_input_tokens",
    ):
        total[key] += delta.get(key, 0)
    total["total_tokens"] = total["input_tokens"] + total["output_tokens"]


def get_escalated_max_tokens(current_max_tokens: int) -> int:
    """Return the next bounded max_tokens budget for truncation retries."""
    factor = max(settings.CLAUDE_MAX_TOKENS_ESCALATION_FACTOR, 1)
    proposed = max(current_max_tokens + 1, current_max_tokens * factor)
    cap = max(settings.CLAUDE_MAX_TOKENS_CAP, current_max_tokens)
    return min(proposed, cap)
