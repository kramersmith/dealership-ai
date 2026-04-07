from __future__ import annotations

import anthropic

from app.core.config import settings


def create_anthropic_client() -> anthropic.AsyncAnthropic:
    """Create an Anthropic client with consistent resilience settings."""
    return anthropic.AsyncAnthropic(
        api_key=settings.ANTHROPIC_API_KEY,
        max_retries=settings.CLAUDE_SDK_MAX_RETRIES,
        timeout=settings.CLAUDE_API_TIMEOUT,
    )
