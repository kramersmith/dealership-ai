"""Chat harness summary payload (full vs lite)."""

from __future__ import annotations

import io
import json
import logging
from typing import Any

import pytest
from app.core.config import Settings
from app.services.chat_harness_log import (
    build_chat_turn_summary_payload,
    log_chat_harness_verbose_event,
    log_chat_turn_summary,
    tool_names_in_order,
)
from pydantic import ValidationError


def test_build_chat_turn_summary_payload_full() -> None:
    payload = build_chat_turn_summary_payload(
        session_id="s1",
        user_text="Hello",
        assistant_text="Hi there",
        tool_names=["set_vehicle"],
        tool_calls=[{"name": "set_vehicle", "args": {"vin": "1HGBH41JXMN109186"}}],
        final_panel_cards=[
            {"kind": "phase", "title": "Status", "content": {"stance": "researching"}}
        ],
        include_full_payload=True,
    )

    assert payload["harness_shape"] == "full"
    assert payload["user_text"] == "Hello"
    assert payload["assistant_text"] == "Hi there"
    assert payload["tool_calls"][0]["args"]["vin"] == "***109186"
    assert payload["panel_cards"][0]["kind"] == "phase"


def test_settings_chat_harness_includes_full_payload() -> None:
    assert Settings(ENV="production").chat_harness_includes_full_payload() is False
    assert Settings(ENV="staging").chat_harness_includes_full_payload() is True
    assert (
        Settings(
            ENV="production", LOG_CHAT_HARNESS_FULL=True
        ).chat_harness_includes_full_payload()
        is True
    )
    assert (
        Settings(
            ENV="development", LOG_CHAT_HARNESS_FULL=False
        ).chat_harness_includes_full_payload()
        is False
    )


def test_settings_chat_harness_verbosity_normalizes_and_rejects_typos() -> None:
    # Invalid Literal values are intentional here (we're testing the validator),
    # so suppress mypy on each call rather than weakening the Settings type.
    verbose = Settings(LOG_CHAT_HARNESS_VERBOSITY=" VERBOSE ")  # type: ignore[arg-type]
    assert verbose.LOG_CHAT_HARNESS_VERBOSITY == "verbose"
    assert verbose.chat_harness_is_verbose() is True

    default = Settings(LOG_CHAT_HARNESS_VERBOSITY="")  # type: ignore[arg-type]
    assert default.LOG_CHAT_HARNESS_VERBOSITY == "normal"
    assert default.chat_harness_is_verbose() is False

    whitespace = Settings(LOG_CHAT_HARNESS_VERBOSITY="   ")  # type: ignore[arg-type]
    assert whitespace.LOG_CHAT_HARNESS_VERBOSITY == "normal"
    assert whitespace.chat_harness_is_verbose() is False

    # Typos must raise instead of silently coercing to "normal" — misconfigured
    # observability should be visible at startup, not hidden behind a fallback.
    with pytest.raises(ValidationError):
        Settings(LOG_CHAT_HARNESS_VERBOSITY="loud")  # type: ignore[arg-type]


def test_build_chat_turn_summary_payload_lite() -> None:
    payload = build_chat_turn_summary_payload(
        session_id="s1",
        user_text="Hello world " * 50,
        assistant_text="Reply " * 50,
        tool_names=["set_vehicle"],
        tool_calls=[{"name": "set_vehicle"}],
        final_panel_cards=[
            {"kind": "numbers", "title": "Numbers"},
            {"kind": "phase", "title": "Status"},
        ],
        include_full_payload=False,
        preview_max_chars=40,
    )

    assert payload["harness_shape"] == "lite"
    assert "user_text" not in payload
    assert "assistant_text" not in payload
    assert "tool_calls" not in payload
    assert len(payload["user_preview"]) <= 40
    assert len(payload["assistant_preview"]) <= 40
    assert payload["panel_card_count"] == 2
    assert payload["panel_card_kinds"] == ["numbers", "phase"]


def test_build_chat_turn_summary_payload_required_fields_lite_no_panel() -> None:
    payload = build_chat_turn_summary_payload(
        session_id="sess-42",
        user_text="hi",
        assistant_text="yo",
        tool_names=[],
        tool_calls=[],
        final_panel_cards=None,
        include_full_payload=False,
    )

    for key in (
        "event",
        "session_id",
        "user_chars",
        "assistant_chars",
        "tool_names",
        "harness_shape",
        "user_preview",
        "assistant_preview",
    ):
        assert key in payload, f"missing {key}"
    assert payload["event"] == "chat_turn_summary"
    assert payload["session_id"] == "sess-42"
    assert payload["user_chars"] == 2
    assert payload["assistant_chars"] == 2
    assert payload["harness_shape"] == "lite"
    assert "panel_card_count" not in payload
    assert "panel_card_kinds" not in payload


def test_build_chat_turn_summary_payload_records_zero_card_panel_completion() -> None:
    payload = build_chat_turn_summary_payload(
        session_id="sess-empty-panel",
        user_text="hi",
        assistant_text="yo",
        tool_names=[],
        tool_calls=[],
        final_panel_cards=[],
        include_full_payload=False,
    )

    assert payload["panel_card_count"] == 0
    assert payload["panel_card_kinds"] == []


def test_tool_names_in_order_preserves_order_and_dedupes() -> None:
    calls: list[dict[str, Any]] = [
        {"name": "set_vehicle"},
        {"name": "update_deal_health"},
        {"name": "set_vehicle"},
        {"name": "update_checklist"},
        {"name": None},
        {"name": 123},
        {},
    ]

    assert tool_names_in_order(calls) == [
        "set_vehicle",
        "update_deal_health",
        "update_checklist",
    ]


def test_log_chat_harness_verbose_event_emits_debug_json_line(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.chat_harness_log.settings.LOG_CHAT_HARNESS_VERBOSITY",
        "verbose",
    )

    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setLevel(logging.DEBUG)
    handler.setFormatter(logging.Formatter("%(levelname)s %(message)s"))

    test_logger = logging.getLogger("app.services.chat_harness_log")
    prior_handlers = test_logger.handlers[:]
    prior_level = test_logger.level
    prior_propagate = test_logger.propagate
    test_logger.handlers = [handler]
    test_logger.propagate = False
    test_logger.setLevel(logging.DEBUG)
    try:
        log_chat_harness_verbose_event(
            "panel",
            {
                "session_id": "s1",
                "card_count": 2,
                "kinds": ["phase", "numbers"],
                "tool_calls": [
                    {"name": "set_vehicle", "args": {"vin": "1HGBH41JXMN109186"}}
                ],
            },
        )
    finally:
        test_logger.handlers = prior_handlers
        test_logger.propagate = prior_propagate
        test_logger.setLevel(prior_level)

    line = stream.getvalue().strip()
    assert line.startswith("DEBUG chat_harness_verbose ")
    payload = json.loads(line[len("DEBUG chat_harness_verbose ") :])
    assert payload["tag"] == "panel"
    assert payload["session_id"] == "s1"
    assert payload["card_count"] == 2
    assert payload["kinds"] == ["phase", "numbers"]
    assert payload["tool_calls"][0]["args"]["vin"] == "***109186"


def test_log_chat_harness_verbose_event_is_noop_when_disabled(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.chat_harness_log.settings.LOG_CHAT_HARNESS_VERBOSITY",
        "normal",
    )

    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setLevel(logging.DEBUG)
    handler.setFormatter(logging.Formatter("%(levelname)s %(message)s"))

    test_logger = logging.getLogger("app.services.chat_harness_log")
    prior_handlers = test_logger.handlers[:]
    prior_level = test_logger.level
    prior_propagate = test_logger.propagate
    test_logger.handlers = [handler]
    test_logger.propagate = False
    test_logger.setLevel(logging.DEBUG)
    try:
        log_chat_harness_verbose_event(
            "panel",
            {"session_id": "s1", "card_count": 2, "kinds": ["phase", "numbers"]},
        )
    finally:
        test_logger.handlers = prior_handlers
        test_logger.propagate = prior_propagate
        test_logger.setLevel(prior_level)

    assert stream.getvalue() == ""


def test_log_chat_harness_verbose_event_swallows_payload_factory_errors(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "app.services.chat_harness_log.settings.LOG_CHAT_HARNESS_VERBOSITY",
        "verbose",
    )

    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setLevel(logging.ERROR)
    handler.setFormatter(logging.Formatter("%(levelname)s %(message)s"))

    test_logger = logging.getLogger("app.services.chat_harness_log")
    prior_handlers = test_logger.handlers[:]
    prior_level = test_logger.level
    prior_propagate = test_logger.propagate
    test_logger.handlers = [handler]
    test_logger.propagate = False
    test_logger.setLevel(logging.ERROR)
    try:
        log_chat_harness_verbose_event(
            "step_loop",
            lambda: (_ for _ in ()).throw(RuntimeError("boom")),
        )
    finally:
        test_logger.handlers = prior_handlers
        test_logger.propagate = prior_propagate
        test_logger.setLevel(prior_level)

    assert "chat_harness_verbose payload failed: tag=step_loop" in stream.getvalue()


def test_chat_turn_summary_logger_emits_expected_shape(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.chat_harness_log.settings.LOG_CHAT_HARNESS_FULL",
        True,
    )

    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging.Formatter("%(message)s"))

    test_logger = logging.getLogger("app.services.chat_harness_log")
    prior_handlers = test_logger.handlers[:]
    prior_level = test_logger.level
    prior_propagate = test_logger.propagate
    test_logger.handlers = [handler]
    test_logger.propagate = False
    test_logger.setLevel(logging.INFO)
    try:
        log_chat_turn_summary(
            session_id="s9",
            user_text="hello 1HGBH41JXMN109186",
            assistant_text="ok",
            tool_calls=[{"name": "set_vehicle", "args": {"vin": "1HGBH41JXMN109186"}}],
            final_panel_cards=None,
        )
    finally:
        test_logger.handlers = prior_handlers
        test_logger.propagate = prior_propagate
        test_logger.setLevel(prior_level)

    line = stream.getvalue().strip()
    assert line.startswith("chat_turn_summary ")
    payload = json.loads(line[len("chat_turn_summary ") :])
    assert payload["event"] == "chat_turn_summary"
    assert payload["session_id"] == "s9"
    assert payload["harness_shape"] == "full"
    assert "1HGBH41JXMN109186" not in payload["user_text"]
    assert "***109186" in payload["user_text"]
    assert payload["tool_calls"][0]["args"]["vin"] == "***109186"
