from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

TOKEN_UNIT = Decimal("1000000")
USD_PRECISION = Decimal("0.000001")

# Shared token field names used across serialization, deserialization,
# accumulation, and camelCase payload transformation.
_TOKEN_FIELDS = (
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
    "total_tokens",
)


@dataclass(frozen=True)
class ModelPricing:
    input_cost_per_mtok: Decimal
    output_cost_per_mtok: Decimal
    cache_read_input_cost_per_mtok: Decimal
    cache_creation_input_cost_per_mtok: Decimal


# Model keys must match settings.CLAUDE_MODEL / settings.CLAUDE_FAST_MODEL
MODEL_PRICING: dict[str, ModelPricing] = {
    "claude-sonnet-4-6": ModelPricing(
        input_cost_per_mtok=Decimal("3.00"),
        output_cost_per_mtok=Decimal("15.00"),
        cache_read_input_cost_per_mtok=Decimal("0.30"),
        cache_creation_input_cost_per_mtok=Decimal("3.75"),
    ),
    "claude-haiku-4-5-20251001": ModelPricing(
        input_cost_per_mtok=Decimal("0.80"),
        output_cost_per_mtok=Decimal("4.00"),
        cache_read_input_cost_per_mtok=Decimal("0.08"),
        cache_creation_input_cost_per_mtok=Decimal("1.00"),
    ),
}


def _token_cost(tokens: int, rate_per_mtok: Decimal) -> Decimal:
    return (Decimal(tokens) * rate_per_mtok) / TOKEN_UNIT


def _rounded_cost(value: Decimal) -> float:
    return float(value.quantize(USD_PRECISION, rounding=ROUND_HALF_UP))


def _safe_int(value: Any) -> int:
    if value is None:
        return 0
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _safe_float(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def calculate_request_cost_usd(model: str, usage_summary: dict[str, int]) -> float:
    pricing = MODEL_PRICING.get(model)
    if not pricing:
        return 0.0

    total_cost = (
        _token_cost(
            _safe_int(usage_summary.get("input_tokens", 0)),
            pricing.input_cost_per_mtok,
        )
        + _token_cost(
            _safe_int(usage_summary.get("output_tokens", 0)),
            pricing.output_cost_per_mtok,
        )
        + _token_cost(
            _safe_int(usage_summary.get("cache_read_input_tokens", 0)),
            pricing.cache_read_input_cost_per_mtok,
        )
        + _token_cost(
            _safe_int(usage_summary.get("cache_creation_input_tokens", 0)),
            pricing.cache_creation_input_cost_per_mtok,
        )
    )
    return _rounded_cost(total_cost)


@dataclass
class RequestUsage:
    model: str
    requests: int = 1
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0
    total_tokens: int = 0
    latency_ms: int | None = None
    total_cost_usd: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "model": self.model,
            "requests": self.requests,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cache_creation_input_tokens": self.cache_creation_input_tokens,
            "cache_read_input_tokens": self.cache_read_input_tokens,
            "total_tokens": self.total_tokens,
            "latency_ms": self.latency_ms,
            "total_cost_usd": self.total_cost_usd,
        }


UsageRecorder = Callable[[RequestUsage], None]


# ── Shared helpers for ModelUsageSummary / SessionUsageSummary ──


def _parse_totals(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "request_count": data.get("request_count", 0),
        **{f: data.get(f, 0) for f in _TOKEN_FIELDS},
        "total_cost_usd": _safe_float(data.get("total_cost_usd")),
    }


def _totals_dict(obj: ModelUsageSummary | SessionUsageSummary) -> dict[str, Any]:
    return {
        "request_count": obj.request_count,
        **{f: getattr(obj, f) for f in _TOKEN_FIELDS},
        "total_cost_usd": obj.total_cost_usd,
    }


def _accumulate(
    target: ModelUsageSummary | SessionUsageSummary, request_usage: RequestUsage
) -> None:
    target.request_count += request_usage.requests
    for f in _TOKEN_FIELDS:
        setattr(target, f, getattr(target, f) + getattr(request_usage, f))
    target.total_cost_usd = round(
        target.total_cost_usd + request_usage.total_cost_usd, 6
    )


@dataclass
class ModelUsageSummary:
    request_count: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0
    total_tokens: int = 0
    total_cost_usd: float = 0.0

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> ModelUsageSummary:
        if not data:
            return cls()
        return cls(**_parse_totals(data))

    def add_request(self, request_usage: RequestUsage) -> None:
        _accumulate(self, request_usage)

    def to_dict(self) -> dict[str, Any]:
        return _totals_dict(self)


@dataclass
class SessionUsageSummary:
    request_count: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0
    total_tokens: int = 0
    total_cost_usd: float = 0.0
    per_model: dict[str, ModelUsageSummary] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> SessionUsageSummary:
        if not data:
            return cls()
        return cls(
            **_parse_totals(data),
            per_model={
                model: ModelUsageSummary.from_dict(model_data)
                for model, model_data in (data.get("per_model") or {}).items()
            },
        )

    def add_request(self, request_usage: RequestUsage) -> None:
        _accumulate(self, request_usage)
        if request_usage.model not in self.per_model:
            self.per_model[request_usage.model] = ModelUsageSummary()
        self.per_model[request_usage.model].add_request(request_usage)

    def to_dict(self) -> dict[str, Any]:
        return {
            **_totals_dict(self),
            "per_model": {
                model: summary.to_dict() for model, summary in self.per_model.items()
            },
        }


def build_request_usage(
    *,
    model: str,
    usage_summary: dict[str, int],
    latency_ms: int | None = None,
) -> RequestUsage:
    return RequestUsage(
        model=model,
        requests=_safe_int(usage_summary.get("requests", 1)) or 1,
        input_tokens=_safe_int(usage_summary.get("input_tokens", 0)),
        output_tokens=_safe_int(usage_summary.get("output_tokens", 0)),
        cache_creation_input_tokens=_safe_int(
            usage_summary.get("cache_creation_input_tokens", 0)
        ),
        cache_read_input_tokens=_safe_int(
            usage_summary.get("cache_read_input_tokens", 0)
        ),
        total_tokens=_safe_int(
            usage_summary.get(
                "total_tokens",
                _safe_int(usage_summary.get("input_tokens", 0))
                + _safe_int(usage_summary.get("output_tokens", 0)),
            )
        ),
        latency_ms=latency_ms,
        total_cost_usd=calculate_request_cost_usd(model, usage_summary),
    )


def log_request_usage(
    logger: logging.Logger,
    request_usage: RequestUsage,
    *,
    context: str,
    session_id: str | None = None,
) -> None:
    logger.info(
        "Claude usage: context=%s session_id=%s model=%s requests=%d input_tokens=%d output_tokens=%d cache_creation_input_tokens=%d cache_read_input_tokens=%d total_tokens=%d total_cost_usd=%.6f latency_ms=%s",
        context,
        session_id,
        request_usage.model,
        request_usage.requests,
        request_usage.input_tokens,
        request_usage.output_tokens,
        request_usage.cache_creation_input_tokens,
        request_usage.cache_read_input_tokens,
        request_usage.total_tokens,
        request_usage.total_cost_usd,
        request_usage.latency_ms,
    )


def _usage_summary_to_camel(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "requestCount": data.get("request_count", 0),
        "inputTokens": data.get("input_tokens", 0),
        "outputTokens": data.get("output_tokens", 0),
        "cacheCreationInputTokens": data.get("cache_creation_input_tokens", 0),
        "cacheReadInputTokens": data.get("cache_read_input_tokens", 0),
        "totalTokens": data.get("total_tokens", 0),
        "totalCostUsd": _safe_float(data.get("total_cost_usd")),
    }


def session_usage_payload(summary: dict[str, Any] | None) -> dict[str, Any] | None:
    if not summary:
        return None

    per_model = {
        model: _usage_summary_to_camel(model_summary)
        for model, model_summary in (summary.get("per_model") or {}).items()
    }

    return {
        **_usage_summary_to_camel(summary),
        "perModel": per_model,
    }
