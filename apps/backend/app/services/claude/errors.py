from __future__ import annotations

import anthropic

_DEFAULT_USER_ERROR_MESSAGE = "AI response failed. Please try again."


def extract_anthropic_error_details(
    exc: anthropic.APIStatusError,
) -> tuple[str, str]:
    """Extract (error_type, error_message) from an Anthropic API error response body."""
    body = getattr(exc, "body", None)
    if not isinstance(body, dict):
        return ("", "")
    err = body.get("error")
    if not isinstance(err, dict):
        return ("", "")
    return (err.get("type") or "", err.get("message") or "")


def is_anthropic_low_credit_error(exc: anthropic.APIStatusError) -> bool:
    _, msg = extract_anthropic_error_details(exc)
    msg_lower = msg.lower()
    return "credit balance is too low" in msg_lower or "purchase credits" in msg_lower


def user_visible_message_for_anthropic_error(exc: anthropic.APIStatusError) -> str:
    """Map known API failures to a safe SSE message.

    Operators see the full error in logs.
    """
    if is_anthropic_low_credit_error(exc):
        return (
            "The assistant is temporarily unavailable due to API account limits. "
            "Try again later."
        )
    err_type, _ = extract_anthropic_error_details(exc)
    if err_type == "authentication_error":
        return "The assistant is misconfigured. Please contact support."
    return _DEFAULT_USER_ERROR_MESSAGE
