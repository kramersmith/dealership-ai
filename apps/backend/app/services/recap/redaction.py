"""Deterministic share-safe recap from full recap + redaction profile."""

from __future__ import annotations

import re

from app.schemas.recap import (
    DealRecapPublicResponse,
    DealRecapResponse,
    PublicTimelineBeatResponse,
    RedactionProfile,
    SavingsSnapshotResponse,
)
from app.services.recap.timeline_payload import read_world_app

_DOLLAR_PATTERN = re.compile(r"\$[\d,]+(?:\.\d{2})?")
_USD_WORD_PATTERN = re.compile(r"\bUSD\s*[\d,]+(?:\.\d{2})?\b", re.IGNORECASE)


def _strip_dollars(text: str) -> str:
    out = _DOLLAR_PATTERN.sub("[amount redacted]", text)
    return _USD_WORD_PATTERN.sub("[amount redacted]", out)


def _strip_dealer_names(text: str, names: list[str]) -> str:
    """Replace known dealer names (case-insensitive) with a neutral phrase."""
    if not text or not names:
        return text
    out = text
    for name in sorted({n.strip() for n in names if len(n.strip()) >= 2}, key=len, reverse=True):
        pattern = re.compile(re.escape(name), flags=re.IGNORECASE)
        out = pattern.sub("the dealership", out)
    return out


def apply_redaction(
    recap: DealRecapResponse,
    profile: RedactionProfile,
    *,
    dealer_names: list[str] | None = None,
) -> DealRecapPublicResponse:
    names = [n.strip() for n in (dealer_names or []) if n.strip()]
    public_beats: list[PublicTimelineBeatResponse] = []
    for beat in recap.beats:
        world, app = read_world_app(beat.payload)
        if profile.hide_user_message_quotes and beat.user_message_id:
            if world:
                world = "You shared an update in chat; details omitted for privacy."
            if app:
                app = "You shared an update in chat; details omitted for privacy."
        if profile.hide_dealer_name and names:
            world = _strip_dealer_names(world, names)
            app = _strip_dealer_names(app, names)
        if profile.hide_dollar_amounts:
            world = _strip_dollars(world)
            app = _strip_dollars(app)

        public_beats.append(
            PublicTimelineBeatResponse(
                id=beat.id,
                occurred_at=beat.occurred_at,
                kind=beat.kind,
                world=world,
                app=app,
                sort_order=beat.sort_order,
            )
        )

    savings = recap.savings.model_copy(deep=True)
    if profile.hide_dealer_name and names:
        savings = savings.model_copy(
            update={
                "assumptions": [_strip_dealer_names(a, names) for a in savings.assumptions],
                "disclaimer": _strip_dealer_names(savings.disclaimer, names),
            }
        )
    if profile.hide_dollar_amounts:
        assumptions_redacted = [_strip_dollars(a) for a in savings.assumptions]
        disclaimer_redacted = _strip_dollars(savings.disclaimer)
        savings = SavingsSnapshotResponse(
            first_offer=None,
            current_offer=None,
            concession_vs_first_offer=None,
            monthly_payment=None,
            apr_percent=savings.apr_percent,
            loan_term_months=savings.loan_term_months,
            estimated_total_interest_delta_usd=None,
            assumptions=assumptions_redacted
            + ["Dollar amounts hidden for this share preview."],
            disclaimer=disclaimer_redacted,
        )

    return DealRecapPublicResponse(
        session_id=recap.session_id,
        beats=public_beats,
        savings=savings,
    )
