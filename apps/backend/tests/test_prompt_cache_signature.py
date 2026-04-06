"""Unit tests for prompt cache fingerprint helpers (§16)."""

import logging

from app.services.prompt_cache_signature import (
    CHAT_STABLE_CACHE_KEYS,
    build_chat_prompt_cache_snapshot,
    build_chat_stable_cache_snapshot,
    build_panel_static_prompt_cache_snapshot,
    canonical_json,
    log_prompt_cache_break,
    prompt_cache_components_changed,
    sha256_hex,
    strip_cache_control,
)


def test_strip_cache_control_removes_nested_keys():
    data = [
        {
            "type": "text",
            "text": "hello",
            "cache_control": {"type": "ephemeral"},
        }
    ]
    stripped = strip_cache_control(data)
    assert stripped == [{"type": "text", "text": "hello"}]


def test_canonical_json_sorts_keys():
    assert canonical_json({"b": 1, "a": 2}) == canonical_json({"a": 2, "b": 1})


def test_sha256_hex_stable():
    h = sha256_hex("x")
    assert len(h) == 64
    assert h == sha256_hex("x")


def test_build_chat_snapshot_combined_aggregates_components():
    snap = build_chat_prompt_cache_snapshot(
        system=[{"type": "text", "text": "sys"}],
        tools=[{"name": "t1", "input_schema": {"type": "object"}}],
        model="claude-sonnet-4-6",
        tool_choice={"type": "auto"},
        betas=(),
    )
    assert set(snap.keys()) == {
        "system",
        "tools",
        "model",
        "betas",
        "tool_choice",
        "combined",
    }
    snap2 = build_chat_prompt_cache_snapshot(
        system=[{"type": "text", "text": "sys"}],
        tools=[{"name": "t1", "input_schema": {"type": "object"}}],
        model="claude-sonnet-4-6",
        tool_choice={"type": "auto"},
        betas=(),
    )
    assert snap == snap2


def test_cache_control_on_tool_does_not_change_content_hash():
    tools_plain = [{"name": "n", "input_schema": {"type": "object"}}]
    tools_cached = [{**tools_plain[0], "cache_control": {"type": "ephemeral"}}]
    a = build_chat_prompt_cache_snapshot(
        system=[],
        tools=tools_plain,
        model="m",
        tool_choice={"type": "auto"},
    )
    b = build_chat_prompt_cache_snapshot(
        system=[],
        tools=tools_cached,
        model="m",
        tool_choice={"type": "auto"},
    )
    assert a["tools"] == b["tools"]
    sa = build_chat_stable_cache_snapshot(base_system=[], tools=tools_plain, model="m")
    sb = build_chat_stable_cache_snapshot(base_system=[], tools=tools_cached, model="m")
    assert sa["tools"] == sb["tools"]


def test_stable_chat_fingerprint_ignores_step_only_system_and_tool_choice():
    """Stable slice is identical across inner steps; full request fingerprint differs."""
    base = [{"type": "text", "text": "base"}]
    tools = [{"name": "t", "input_schema": {"type": "object"}}]
    stable_a = build_chat_stable_cache_snapshot(
        base_system=base, tools=tools, model="claude-sonnet-4-6"
    )
    stable_b = build_chat_stable_cache_snapshot(
        base_system=base, tools=tools, model="claude-sonnet-4-6"
    )
    assert stable_a == stable_b
    assert (
        prompt_cache_components_changed(
            stable_a, stable_b, component_keys=CHAT_STABLE_CACHE_KEYS
        )
        == []
    )

    full_step0 = build_chat_prompt_cache_snapshot(
        system=base,
        tools=tools,
        model="claude-sonnet-4-6",
        tool_choice={"type": "auto"},
    )
    full_step1 = build_chat_prompt_cache_snapshot(
        system=[*base, {"type": "text", "text": "continuation-only"}],
        tools=tools,
        model="claude-sonnet-4-6",
        tool_choice={"type": "none"},
    )
    assert full_step0 != full_step1
    assert set(prompt_cache_components_changed(full_step0, full_step1)) == {
        "system",
        "tool_choice",
    }


def test_prompt_cache_components_changed_empty_when_no_prior():
    curr = build_chat_prompt_cache_snapshot(
        system=[],
        tools=[],
        model="m",
        tool_choice={},
    )
    assert prompt_cache_components_changed(None, curr) == []


def test_prompt_cache_components_changed_detects_model():
    a = build_chat_prompt_cache_snapshot(
        system=[],
        tools=[],
        model="m1",
        tool_choice={},
    )
    b = build_chat_prompt_cache_snapshot(
        system=[],
        tools=[],
        model="m2",
        tool_choice={},
    )
    assert prompt_cache_components_changed(a, b) == ["model"]


def test_log_prompt_cache_break_info_hashes_only(caplog):
    prior = build_chat_prompt_cache_snapshot(
        system=[{"type": "text", "text": "<<<prompt-slice-aaa>>>"}],
        tools=[],
        model="m",
        tool_choice={},
    )
    curr = build_chat_prompt_cache_snapshot(
        system=[{"type": "text", "text": "<<<prompt-slice-bbb>>>"}],
        tools=[],
        model="m",
        tool_choice={},
    )
    changed = prompt_cache_components_changed(prior, curr)
    test_logger = logging.getLogger("test_pc")
    with caplog.at_level(logging.INFO, logger="test_pc"):
        log_prompt_cache_break(
            test_logger,
            session_id="s1",
            phase="chat",
            step=0,
            prior=prior,
            current=curr,
            changed_components=changed,
        )
    assert "Prompt cache break detected" in caplog.text
    assert "system_prev=" in caplog.text
    assert "prompt-slice-aaa" not in caplog.text
    assert "prompt-slice-bbb" not in caplog.text


def test_panel_static_snapshot_matches_chat_shape():
    p = build_panel_static_prompt_cache_snapshot(
        static_panel_prompt="PANEL_PROMPT",
        model="claude-sonnet-4-6",
    )
    assert p["tools"] == sha256_hex(canonical_json([]))
    assert "combined" in p


def test_session_usage_summary_prompt_cache_roundtrip():
    from app.services.usage_tracking import SessionUsageSummary

    s = SessionUsageSummary()
    snap = build_chat_stable_cache_snapshot(
        base_system=[],
        tools=[],
        model="x",
    )
    s.prompt_cache_chat_last = snap
    s.prompt_cache_panel_last = build_panel_static_prompt_cache_snapshot(
        static_panel_prompt="p",
        model="x",
    )
    s.prompt_cache_break_count = 3
    d = s.to_dict()
    r = SessionUsageSummary.from_dict(d)
    assert r.prompt_cache_chat_last == snap
    assert r.prompt_cache_break_count == 3
    assert r.prompt_cache_panel_last == s.prompt_cache_panel_last
