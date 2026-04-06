"""Unit tests for usage_tracking module."""

import logging

import pytest
from app.services.usage_tracking import (
    ModelUsageSummary,
    RequestUsage,
    SessionUsageSummary,
    build_request_usage,
    calculate_request_cost_usd,
    log_request_usage,
    session_usage_payload,
)

# ── calculate_request_cost_usd ──


def test_cost_sonnet_basic():
    cost = calculate_request_cost_usd(
        "claude-sonnet-4-6",
        {"input_tokens": 1000, "output_tokens": 500},
    )
    # (1000 * 3.00 / 1M) + (500 * 15.00 / 1M) = 0.003 + 0.0075 = 0.0105
    assert cost == 0.0105


def test_cost_haiku_basic():
    cost = calculate_request_cost_usd(
        "claude-haiku-4-5-20251001",
        {"input_tokens": 1000, "output_tokens": 500},
    )
    # (1000 * 0.80 / 1M) + (500 * 4.00 / 1M) = 0.0008 + 0.002 = 0.0028
    assert cost == 0.0028


def test_cost_with_cache_tokens():
    cost = calculate_request_cost_usd(
        "claude-sonnet-4-6",
        {
            "input_tokens": 100,
            "output_tokens": 50,
            "cache_read_input_tokens": 200,
            "cache_creation_input_tokens": 300,
        },
    )
    # input: 100 * 3.00 / 1M = 0.0003
    # output: 50 * 15.00 / 1M = 0.00075
    # cache_read: 200 * 0.30 / 1M = 0.00006
    # cache_creation: 300 * 3.75 / 1M = 0.001125
    expected = 0.0003 + 0.00075 + 0.00006 + 0.001125
    assert cost == pytest.approx(expected, abs=1e-6)


def test_cost_unknown_model():
    assert calculate_request_cost_usd("unknown-model", {"input_tokens": 1000}) == 0.0


def test_cost_zero_tokens():
    assert calculate_request_cost_usd("claude-sonnet-4-6", {}) == 0.0


def test_cost_missing_keys():
    cost = calculate_request_cost_usd("claude-sonnet-4-6", {"input_tokens": 100})
    assert cost == pytest.approx(0.0003, abs=1e-6)


# ── build_request_usage ──


def test_build_request_usage_basic():
    usage = build_request_usage(
        model="claude-sonnet-4-6",
        usage_summary={"input_tokens": 100, "output_tokens": 50},
    )
    assert usage.model == "claude-sonnet-4-6"
    assert usage.requests == 1
    assert usage.input_tokens == 100
    assert usage.output_tokens == 50
    assert usage.total_tokens == 150
    assert usage.latency_ms is None
    assert usage.total_cost_usd > 0


def test_build_request_usage_with_latency():
    usage = build_request_usage(
        model="claude-sonnet-4-6",
        usage_summary={"input_tokens": 100, "output_tokens": 50},
        latency_ms=250,
    )
    assert usage.latency_ms == 250


def test_build_request_usage_requests_default():
    usage = build_request_usage(
        model="claude-sonnet-4-6",
        usage_summary={"input_tokens": 0, "output_tokens": 0},
    )
    assert usage.requests == 1


def test_build_request_usage_total_tokens_computed():
    usage = build_request_usage(
        model="claude-sonnet-4-6",
        usage_summary={"input_tokens": 200, "output_tokens": 100},
    )
    assert usage.total_tokens == 300


def test_build_request_usage_total_tokens_explicit():
    usage = build_request_usage(
        model="claude-sonnet-4-6",
        usage_summary={
            "input_tokens": 200,
            "output_tokens": 100,
            "total_tokens": 999,
        },
    )
    assert usage.total_tokens == 999


# ── RequestUsage.to_dict ──


def test_request_usage_to_dict():
    usage = RequestUsage(
        model="claude-sonnet-4-6",
        requests=2,
        input_tokens=100,
        output_tokens=50,
        total_tokens=150,
        total_cost_usd=0.01,
    )
    d = usage.to_dict()
    assert d["model"] == "claude-sonnet-4-6"
    assert d["requests"] == 2
    assert d["input_tokens"] == 100
    assert d["total_cost_usd"] == 0.01
    assert d["latency_ms"] is None


# ── ModelUsageSummary ──


def test_model_summary_from_dict_none():
    s = ModelUsageSummary.from_dict(None)
    assert s.request_count == 0
    assert s.total_cost_usd == 0.0


def test_model_summary_from_dict_empty():
    s = ModelUsageSummary.from_dict({})
    assert s.request_count == 0


def test_model_summary_from_dict_with_data():
    s = ModelUsageSummary.from_dict(
        {
            "request_count": 3,
            "input_tokens": 500,
            "output_tokens": 200,
            "cache_creation_input_tokens": 100,
            "cache_read_input_tokens": 50,
            "total_tokens": 700,
            "total_cost_usd": 0.005,
        }
    )
    assert s.request_count == 3
    assert s.input_tokens == 500
    assert s.total_cost_usd == 0.005


def test_model_summary_from_dict_null_cost():
    """from_dict handles total_cost_usd stored as null in JSON."""
    s = ModelUsageSummary.from_dict({"total_cost_usd": None})
    assert s.total_cost_usd == 0.0


def test_model_summary_add_request():
    s = ModelUsageSummary()
    s.add_request(
        RequestUsage(
            model="claude-sonnet-4-6",
            requests=1,
            input_tokens=100,
            output_tokens=50,
            total_tokens=150,
            total_cost_usd=0.001,
        )
    )
    assert s.request_count == 1
    assert s.input_tokens == 100
    assert s.total_tokens == 150
    assert s.total_cost_usd == 0.001


def test_model_summary_to_dict_roundtrip():
    original = ModelUsageSummary(
        request_count=2,
        input_tokens=300,
        output_tokens=100,
        total_tokens=400,
        total_cost_usd=0.003,
    )
    restored = ModelUsageSummary.from_dict(original.to_dict())
    assert restored.request_count == original.request_count
    assert restored.input_tokens == original.input_tokens
    assert restored.total_cost_usd == original.total_cost_usd


# ── SessionUsageSummary ──


def test_session_summary_from_dict_none():
    s = SessionUsageSummary.from_dict(None)
    assert s.request_count == 0
    assert s.per_model == {}


def test_session_summary_from_dict_with_per_model():
    s = SessionUsageSummary.from_dict(
        {
            "request_count": 2,
            "input_tokens": 300,
            "output_tokens": 100,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
            "total_tokens": 400,
            "total_cost_usd": 0.003,
            "per_model": {
                "claude-sonnet-4-6": {
                    "request_count": 2,
                    "input_tokens": 300,
                    "output_tokens": 100,
                    "total_tokens": 400,
                    "total_cost_usd": 0.003,
                }
            },
        }
    )
    assert s.request_count == 2
    assert "claude-sonnet-4-6" in s.per_model
    assert s.per_model["claude-sonnet-4-6"].request_count == 2


def test_session_summary_from_dict_missing_per_model():
    s = SessionUsageSummary.from_dict({"request_count": 1})
    assert s.per_model == {}


def test_session_summary_from_dict_null_cost():
    """from_dict handles total_cost_usd stored as null in JSON."""
    s = SessionUsageSummary.from_dict({"total_cost_usd": None})
    assert s.total_cost_usd == 0.0


def test_session_summary_add_request_creates_model():
    s = SessionUsageSummary()
    s.add_request(
        RequestUsage(
            model="claude-sonnet-4-6",
            input_tokens=100,
            output_tokens=50,
            total_tokens=150,
            total_cost_usd=0.001,
        )
    )
    assert s.request_count == 1
    assert "claude-sonnet-4-6" in s.per_model
    assert s.per_model["claude-sonnet-4-6"].input_tokens == 100


def test_session_summary_add_request_accumulates():
    s = SessionUsageSummary()
    req = RequestUsage(
        model="claude-sonnet-4-6",
        input_tokens=100,
        output_tokens=50,
        total_tokens=150,
        total_cost_usd=0.001,
    )
    s.add_request(req)
    s.add_request(req)
    assert s.request_count == 2
    assert s.input_tokens == 200
    assert s.total_cost_usd == 0.002


def test_session_summary_add_request_multi_model():
    s = SessionUsageSummary()
    s.add_request(
        RequestUsage(
            model="claude-sonnet-4-6",
            input_tokens=100,
            output_tokens=50,
            total_tokens=150,
            total_cost_usd=0.001,
        )
    )
    s.add_request(
        RequestUsage(
            model="claude-haiku-4-5-20251001",
            input_tokens=50,
            output_tokens=20,
            total_tokens=70,
            total_cost_usd=0.0002,
        )
    )
    assert s.request_count == 2
    assert len(s.per_model) == 2
    assert s.per_model["claude-sonnet-4-6"].input_tokens == 100
    assert s.per_model["claude-haiku-4-5-20251001"].input_tokens == 50
    assert s.total_cost_usd == pytest.approx(0.0012, abs=1e-6)


def test_session_summary_to_dict_roundtrip():
    s = SessionUsageSummary()
    s.add_request(
        RequestUsage(
            model="claude-sonnet-4-6",
            input_tokens=100,
            output_tokens=50,
            total_tokens=150,
            total_cost_usd=0.001,
        )
    )
    d = s.to_dict()
    restored = SessionUsageSummary.from_dict(d)
    assert restored.request_count == s.request_count
    assert restored.input_tokens == s.input_tokens
    assert restored.per_model["claude-sonnet-4-6"].input_tokens == 100


# ── session_usage_payload ──


def test_session_usage_payload_none():
    assert session_usage_payload(None) is None


def test_session_usage_payload_empty():
    assert session_usage_payload({}) is None


def test_session_usage_payload_transform():
    result = session_usage_payload(
        {
            "request_count": 2,
            "input_tokens": 300,
            "output_tokens": 100,
            "cache_creation_input_tokens": 50,
            "cache_read_input_tokens": 80,
            "total_tokens": 400,
            "total_cost_usd": 0.005,
            "per_model": {
                "claude-sonnet-4-6": {
                    "request_count": 2,
                    "input_tokens": 300,
                    "output_tokens": 100,
                    "cache_creation_input_tokens": 50,
                    "cache_read_input_tokens": 80,
                    "total_tokens": 400,
                    "total_cost_usd": 0.005,
                }
            },
        }
    )
    assert result["requestCount"] == 2
    assert result["inputTokens"] == 300
    assert result["totalCostUsd"] == 0.005
    assert result["perModel"]["claude-sonnet-4-6"]["requestCount"] == 2


def test_session_usage_payload_missing_per_model():
    result = session_usage_payload({"request_count": 1, "total_cost_usd": 0.001})
    assert result["perModel"] == {}


def test_session_usage_payload_null_cost():
    """Handles total_cost_usd stored as null in JSON."""
    result = session_usage_payload({"request_count": 1, "total_cost_usd": None})
    assert result["totalCostUsd"] == 0.0


def test_session_usage_payload_includes_prompt_cache():
    result = session_usage_payload(
        {
            "request_count": 1,
            "total_cost_usd": 0.001,
            "prompt_cache": {
                "chat_last": {"system": "abc123", "combined": "def456"},
                "panel_last": None,
                "break_count": 2,
            },
        }
    )
    assert "promptCache" in result
    assert result["promptCache"]["chatLast"] == {
        "system": "abc123",
        "combined": "def456",
    }
    assert result["promptCache"]["panelLast"] is None
    assert result["promptCache"]["breakCount"] == 2


def test_session_usage_payload_omits_prompt_cache_when_absent():
    result = session_usage_payload({"request_count": 1, "total_cost_usd": 0.001})
    assert "promptCache" not in result


# ── log_request_usage ──


def test_log_request_usage_format(caplog):
    usage = RequestUsage(
        model="claude-sonnet-4-6",
        requests=1,
        input_tokens=100,
        output_tokens=50,
        total_tokens=150,
        total_cost_usd=0.001,
        latency_ms=200,
    )
    test_logger = logging.getLogger("test_usage")
    with caplog.at_level(logging.INFO, logger="test_usage"):
        log_request_usage(
            test_logger, usage, context="test_context", session_id="sess-123"
        )
    assert len(caplog.records) == 1
    record = caplog.records[0]
    assert record.levelno == logging.INFO
    assert "context=test_context" in record.message
    assert "session_id=sess-123" in record.message
    assert "model=claude-sonnet-4-6" in record.message
    assert "latency_ms=200" in record.message
