"""Log redaction helpers for structured application logs."""

from __future__ import annotations

import re
from typing import Any

# NHTSA-style VIN: 17 chars, no I/O/Q
_VIN_PATTERN = re.compile(r"\b([A-HJ-NPR-Z0-9]{17})\b", re.IGNORECASE)
_EMAIL_PATTERN = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
_PHONE_PATTERN = re.compile(
    r"(?<!\w)(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\w)"
)
_BEARER_TOKEN_PATTERN = re.compile(r"\bBearer\s+[A-Za-z0-9\-._~+/]+=*", re.IGNORECASE)
_SECRET_TOKEN_PATTERN = re.compile(r"\bsk-[A-Za-z0-9_-]{8,}\b")
_REDACTED_EMAIL = "[redacted-email]"
_REDACTED_PHONE = "[redacted-phone]"
_REDACTED_SECRET = "[redacted]"
_SENSITIVE_KEY_EXACT = {
    "anthropic_api_key",
    "api_key",
    "authorization",
    "cookie",
    "hashed_password",
    "password",
    "refresh_token",
    "secret",
    "secret_key",
    "set_cookie",
    "x_api_key",
}

# Default preview length for ad-hoc excerpts and the lite chat_turn_summary shape.
# Exported so callers (config defaults, chat harness logging) share one source of truth.
DEFAULT_PREVIEW_MAX_CHARS = 240


def mask_vins(text: str) -> str:
    """Replace VINs with last 6 chars only (see logging guidelines)."""

    def _replace_vin(match: re.Match[str]) -> str:
        full_vin = match.group(1).upper()
        return f"***{full_vin[-6:]}"

    return _VIN_PATTERN.sub(_replace_vin, text)


def _mask_emails(text: str) -> str:
    return _EMAIL_PATTERN.sub(_REDACTED_EMAIL, text)


def _mask_phone_numbers(text: str) -> str:
    return _PHONE_PATTERN.sub(_REDACTED_PHONE, text)


def _mask_secret_tokens(text: str) -> str:
    masked = _BEARER_TOKEN_PATTERN.sub("Bearer [redacted]", text)
    return _SECRET_TOKEN_PATTERN.sub(_REDACTED_SECRET, masked)


def sanitize_log_text(text: str) -> str:
    """Mask common identifiers and secret-like values in free-form log text."""

    sanitized = mask_vins(text)
    sanitized = _mask_emails(sanitized)
    sanitized = _mask_phone_numbers(sanitized)
    sanitized = _mask_secret_tokens(sanitized)
    return sanitized


def _is_sensitive_key(key: object) -> bool:
    if not isinstance(key, str):
        return False
    normalized = re.sub(r"[^a-z0-9]+", "_", key.lower()).strip("_")
    return (
        normalized in _SENSITIVE_KEY_EXACT
        or normalized.endswith("_token")
        or normalized.endswith("_secret")
        or normalized.endswith("_password")
        or normalized.endswith("_api_key")
    )


def preview_chat_text(text: str, *, max_chars: int = DEFAULT_PREVIEW_MAX_CHARS) -> str:
    """One-line, length-bounded excerpt for INFO logs and coding agents."""
    if not text:
        return ""
    masked = sanitize_log_text(text)
    collapsed = " ".join(masked.split())
    if max_chars <= 0:
        return ""
    if len(collapsed) <= max_chars:
        return collapsed
    if max_chars == 1:
        return "…"
    return f"{collapsed[: max_chars - 1]}…"


def chat_text_for_full_log(text: str) -> str:
    """Full message text for harness logs; identifiers masked, newlines preserved."""

    return sanitize_log_text(text)


def deep_sanitize_log_data(value: Any) -> Any:
    """Recursively sanitize strings and redact secret-labeled fields in nested data."""

    if isinstance(value, str):
        return sanitize_log_text(value)
    if isinstance(value, dict):
        return {
            key: _REDACTED_SECRET
            if _is_sensitive_key(key)
            else deep_sanitize_log_data(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [deep_sanitize_log_data(item) for item in value]
    if isinstance(value, tuple):
        return tuple(deep_sanitize_log_data(item) for item in value)
    return value
