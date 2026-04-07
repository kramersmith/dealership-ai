"""Tests for Anthropic error → user-visible SSE message mapping."""

from types import SimpleNamespace

from app.services.claude import user_visible_message_for_anthropic_error


def test_maps_low_credit_balance_message() -> None:
    exc = SimpleNamespace(
        body={
            "error": {
                "type": "invalid_request_error",
                "message": (
                    "Your credit balance is too low to access the Anthropic API. "
                    "Please go to Plans & Billing to upgrade or purchase credits."
                ),
            }
        }
    )
    msg = user_visible_message_for_anthropic_error(exc)  # type: ignore[arg-type]
    assert "API account limits" in msg
    assert "credit" not in msg.lower()


def test_default_for_unknown_api_error() -> None:
    exc = SimpleNamespace(
        body={"error": {"type": "invalid_request_error", "message": "Some other issue"}}
    )
    msg = user_visible_message_for_anthropic_error(exc)  # type: ignore[arg-type]
    assert msg == "AI response failed. Please try again."


def test_maps_authentication_error() -> None:
    exc = SimpleNamespace(
        body={"error": {"type": "authentication_error", "message": "invalid x-api-key"}}
    )
    msg = user_visible_message_for_anthropic_error(exc)  # type: ignore[arg-type]
    assert "misconfigured" in msg.lower()
