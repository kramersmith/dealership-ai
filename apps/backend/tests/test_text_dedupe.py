"""Tests for chat text dedupe / continuation heuristics."""

from app.services.claude.text_dedupe import promises_substantive_followup_after_tools


def test_promises_substantive_followup_detects_break_down_teaser() -> None:
    text = (
        "175k miles on a 2022 is a lot — that's the most important number here. "
        "Let me break down what that means for your negotiation."
    )
    assert promises_substantive_followup_after_tools(text) is True


def test_promises_substantive_followup_false_when_long_substantive() -> None:
    long = "175k miles on a 2022 is a lot. Here's what that means: " + (
        "More detail. " * 80
    )
    assert len(long) > 450
    assert promises_substantive_followup_after_tools(long) is False


def test_promises_substantive_followup_false_without_teaser() -> None:
    assert (
        promises_substantive_followup_after_tools(
            "Get pre-approved before you visit. Negotiate out-the-door price first."
        )
        is False
    )
