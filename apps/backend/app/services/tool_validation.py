"""Semantic validation for chat tool inputs (post-parse, pre-DB).

Invalid extractions that satisfy JSON schema but fail domain checks are rejected
with a specific message so the model can self-correct on the next step via
is_error tool_result (see docs/ai-harness-improvements.md §10).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.deal import Deal
from app.models.deal_state import DealState
from app.models.enums import DealPhase, HealthStatus
from app.services.turn_context import TurnContext

# Align with deal_state.DEAL_NUMBER_FIELDS — dollars / payment amounts
_NON_NEGATIVE_MONEY_FIELDS = frozenset(
    (
        "msrp",
        "invoice_price",
        "listing_price",
        "your_target",
        "walk_away_price",
        "current_offer",
        "monthly_payment",
        "down_payment",
        "trade_in_value",
    )
)

_MAX_MONEY = 50_000_000.0
_MAX_APR = 35.0
_MIN_LOAN_TERM_MONTHS = 1
_MAX_LOAN_TERM_MONTHS = 120

_DEAL_PHASE_ORDER: tuple[DealPhase, ...] = (
    DealPhase.RESEARCH,
    DealPhase.INITIAL_CONTACT,
    DealPhase.TEST_DRIVE,
    DealPhase.NEGOTIATION,
    DealPhase.FINANCING,
    DealPhase.CLOSING,
)


class ToolValidationError(Exception):
    """Tool arguments are syntactically fine but semantically invalid."""


def _phase_index(phase: DealPhase) -> int:
    return _DEAL_PHASE_ORDER.index(phase)


def _normalize_phase(raw: Any) -> DealPhase:
    if isinstance(raw, DealPhase):
        return raw
    if raw is None:
        raise ToolValidationError(
            "update_deal_phase requires a non-empty phase string (see tool schema enum)."
        )
    if isinstance(raw, str):
        return DealPhase(raw)
    raise ToolValidationError(f"phase must be a string, got {type(raw).__name__}")


def _validate_update_deal_numbers(tool_input: dict) -> None:
    for key, value in tool_input.items():
        if key == "deal_id" or value is None:
            continue
        if key in _NON_NEGATIVE_MONEY_FIELDS:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ToolValidationError(
                    f"Field {key!r} must be a number, got {type(value).__name__}"
                )
            if value < 0:
                raise ToolValidationError(
                    f"Field {key!r} cannot be negative (got {value})."
                )
            if value > _MAX_MONEY:
                raise ToolValidationError(
                    f"Field {key!r} is unrealistically large (>{_MAX_MONEY:g}). "
                    "Check units (dollars vs cents) and retry."
                )
        elif key == "apr":
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ToolValidationError(
                    f"apr must be a number, got {type(value).__name__}"
                )
            if value < 0 or value > _MAX_APR:
                raise ToolValidationError(
                    f"apr must be between 0 and {_MAX_APR:g} (got {value})."
                )
        elif key == "loan_term_months":
            if not isinstance(value, int) or isinstance(value, bool):
                raise ToolValidationError(
                    "loan_term_months must be an integer number of months."
                )
            if value < _MIN_LOAN_TERM_MONTHS or value > _MAX_LOAN_TERM_MONTHS:
                raise ToolValidationError(
                    f"loan_term_months must be between {_MIN_LOAN_TERM_MONTHS} and "
                    f"{_MAX_LOAN_TERM_MONTHS} (got {value})."
                )


def _deal_has_numeric_context(deal: Deal) -> bool:
    from app.services.deal_state import DEAL_NUMBER_FIELDS

    return any(getattr(deal, field) is not None for field in DEAL_NUMBER_FIELDS)


async def _resolve_target_deal(
    deal_id: str | None, deal_state: DealState, db: AsyncSession
) -> Deal | None:
    from app.services.deal_state import _get_session_deal, get_active_deal

    if deal_id:
        return await _get_session_deal(db, deal_state.session_id, deal_id)
    return await get_active_deal(deal_state, db)


def _validate_create_deal_phase(tool_input: dict) -> None:
    if "phase" not in tool_input or tool_input["phase"] is None:
        return
    try:
        _normalize_phase(tool_input["phase"])
    except ValueError as e:
        raise ToolValidationError(f"Invalid deal phase: {e}") from e


async def _validate_update_deal_phase(tool_input: dict, context: TurnContext) -> None:
    from app.services.deal_state import get_active_deal

    assert context.deal_state is not None
    try:
        next_phase = _normalize_phase(tool_input.get("phase"))
    except ValueError as e:
        raise ToolValidationError(f"Invalid deal phase: {e}") from e

    deal = await get_active_deal(context.deal_state, context.db)
    if deal is None:
        raise ToolValidationError(
            "Cannot update deal phase: no active deal. Create or select a deal first."
        )

    try:
        current = DealPhase(deal.phase)
    except ValueError:
        current = DealPhase.RESEARCH

    if next_phase == current:
        return

    cur_i = _phase_index(current)
    new_i = _phase_index(next_phase)
    if new_i < cur_i:
        raise ToolValidationError(
            f"Deal phase cannot move backward from {current.value!r} to "
            f"{next_phase.value!r}. If this is a correction, set phase to the "
            "current stage or a later one."
        )


async def _validate_update_deal_health(tool_input: dict, context: TurnContext) -> None:
    assert context.deal_state is not None
    status_raw = tool_input.get("status")
    if not isinstance(status_raw, str):
        raise ToolValidationError(
            "update_deal_health requires status as a string enum value."
        )
    try:
        HealthStatus(status_raw)
    except ValueError as e:
        raise ToolValidationError(
            f"Invalid health status {status_raw!r}; must be one of: "
            f"{', '.join(s.value for s in HealthStatus)}"
        ) from e

    summary = tool_input.get("summary")
    rec = tool_input.get("recommendation")
    if not summary or not isinstance(summary, str) or not summary.strip():
        raise ToolValidationError(
            "update_deal_health requires a non-empty summary grounded in the buyer's data."
        )
    if not rec or not isinstance(rec, str) or not rec.strip():
        raise ToolValidationError(
            "update_deal_health requires a non-empty recommendation."
        )

    deal = await _resolve_target_deal(
        tool_input.get("deal_id"), context.deal_state, context.db
    )
    if deal is None:
        raise ToolValidationError(
            "Cannot update deal health: no target deal (set an active deal or pass deal_id)."
        )

    if not _deal_has_numeric_context(deal):
        raise ToolValidationError(
            "Set at least one deal number (update_deal_numbers) before "
            "update_deal_health so the assessment is grounded in extracted figures."
        )


async def validate_tool_input(
    tool_name: str, tool_input: dict, context: TurnContext
) -> None:
    """Raise ToolValidationError if tool_input is semantically invalid.

    Callers (_execute_tool_batch) are responsible for logging; this function
    raises without logging to avoid double-logging the same event.
    """
    if tool_name == "update_deal_numbers":
        _validate_update_deal_numbers(tool_input)
    elif tool_name == "update_deal_health":
        await _validate_update_deal_health(tool_input, context)
    elif tool_name == "update_deal_phase":
        await _validate_update_deal_phase(tool_input, context)
    elif tool_name == "create_deal":
        _validate_create_deal_phase(tool_input)
