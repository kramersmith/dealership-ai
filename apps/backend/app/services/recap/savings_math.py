"""Deterministic savings / financing figures for deal recap (illustrative, not advice)."""

from __future__ import annotations

import math
from typing import Any

from app.schemas.recap import SavingsSnapshotResponse

# Match panel_card_builder threshold for "meaningful" concession vs first offer.
_SAVINGS_MIN_DELTA = 100.0


def _monthly_payment(
    principal: float, annual_apr_percent: float, term_months: int
) -> float:
    if principal <= 0 or term_months <= 0:
        return 0.0
    r = (annual_apr_percent / 100.0) / 12.0
    if r <= 0:
        return principal / term_months
    factor = (1 + r) ** term_months
    return principal * r * factor / (factor - 1)


def _total_paid(principal: float, annual_apr_percent: float, term_months: int) -> float:
    m = _monthly_payment(principal, annual_apr_percent, term_months)
    return m * term_months


def compute_savings_snapshot(
    deal_state_dict: dict[str, Any],
    *,
    active_deal_id: str | None,
) -> SavingsSnapshotResponse:
    """Build savings snapshot from canonical deal_state dict (same shape as prompts)."""
    assumptions: list[str] = []
    deals = deal_state_dict.get("deals") or []
    active: dict[str, Any] | None = None
    if active_deal_id:
        for d in deals:
            if isinstance(d, dict) and d.get("id") == active_deal_id:
                active = d
                break
    if active is None and deals:
        active = next((d for d in deals if isinstance(d, dict)), None)

    if not active:
        return SavingsSnapshotResponse(
            assumptions=["No deal data in session."],
            concession_vs_first_offer=None,
            estimated_total_interest_delta_usd=None,
        )

    deal: dict[str, Any] = active
    numbers_raw = deal.get("numbers")
    numbers: dict[str, Any] = numbers_raw if isinstance(numbers_raw, dict) else {}
    offer_hist = deal.get("offer_history")
    first_offer = (
        offer_hist.get("first_offer") if isinstance(offer_hist, dict) else None
    )
    if first_offer is None:
        first_offer = deal.get("first_offer")
    current_offer = numbers.get("current_offer")
    if current_offer is None:
        current_offer = deal.get("current_offer")

    fo = float(first_offer) if first_offer is not None else None
    co = float(current_offer) if current_offer is not None else None

    concession: float | None = None
    if fo is not None and co is not None:
        concession = fo - co
        if concession < _SAVINGS_MIN_DELTA:
            # Omit concession from the payload; do not surface internal threshold copy to buyers.
            concession = None

    apr = numbers.get("apr")
    if apr is None:
        apr = deal.get("apr")
    term = numbers.get("loan_term_months")
    if term is None:
        term = deal.get("loan_term_months")
    monthly = numbers.get("monthly_payment")
    if monthly is None:
        monthly = deal.get("monthly_payment")
    down = numbers.get("down_payment")
    if down is None:
        down = deal.get("down_payment")

    apr_f = float(apr) if apr is not None else None
    term_i = int(term) if term is not None else None
    principal = None
    if co is not None:
        down_f = float(down) if down is not None else 0.0
        principal = max(co - down_f, 0.0)
        assumptions.append(
            "Interest illustration uses financed amount ≈ current offer minus down payment."
        )

    interest_delta: float | None = None
    if (
        principal is not None
        and principal > 0
        and apr_f is not None
        and term_i is not None
        and term_i > 0
    ):
        alt_apr = apr_f + 1.0
        total_a = _total_paid(principal, apr_f, term_i)
        total_b = _total_paid(principal, alt_apr, term_i)
        interest_delta = total_b - total_a
        if math.isfinite(interest_delta):
            assumptions.append(
                "Estimated interest difference vs same loan at +1% APR (illustrative)."
            )
        else:
            interest_delta = None

    return SavingsSnapshotResponse(
        first_offer=fo,
        current_offer=co,
        concession_vs_first_offer=concession,
        monthly_payment=float(monthly) if monthly is not None else None,
        apr_percent=apr_f,
        loan_term_months=term_i,
        estimated_total_interest_delta_usd=interest_delta,
        assumptions=assumptions,
    )
