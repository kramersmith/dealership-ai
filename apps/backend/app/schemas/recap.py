from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, model_validator


class RecapBeatLLM(BaseModel):
    """One beat from the LLM before persistence validation."""

    kind: str = Field(..., max_length=64)
    world: str = Field(
        default="",
        max_length=4000,
        description="Real-world: lot, drive, dealer/buyer conversation — not app credit.",
    )
    app: str = Field(
        default="",
        max_length=4000,
        description="What Dealership AI did in chat or tools; empty if this beat has no in-app beat.",
    )
    user_message_id: str | None = None
    assistant_message_id: str | None = None
    occurred_at_iso: str | None = None

    @model_validator(mode="after")
    def at_least_one_section(self) -> RecapBeatLLM:
        if not self.world.strip() and not self.app.strip():
            raise ValueError("Each beat needs non-empty world and/or app text")
        return self


class EmitDealRecapInput(BaseModel):
    beats: list[RecapBeatLLM] = Field(default_factory=list)


class TimelineBeatResponse(BaseModel):
    id: str
    session_id: str
    deal_id: str | None
    recap_generation_id: str | None
    user_message_id: str | None
    assistant_message_id: str | None
    occurred_at: datetime
    kind: str
    payload: dict[str, Any]
    source: str
    supersedes_event_id: str | None
    sort_order: int


class SavingsSnapshotResponse(BaseModel):
    """Deterministic savings summary for recap (estimated / illustrative)."""

    first_offer: float | None = None
    current_offer: float | None = None
    concession_vs_first_offer: float | None = Field(
        None,
        description="first_offer - current_offer when both present and meaningful",
    )
    monthly_payment: float | None = None
    apr_percent: float | None = None
    loan_term_months: int | None = None
    estimated_total_interest_delta_usd: float | None = Field(
        None,
        description="Illustrative delta vs same term at +1% APR if inputs allow.",
    )
    assumptions: list[str] = Field(default_factory=list)
    disclaimer: str = Field(
        default="Figures are illustrative estimates, not guarantees.",
    )


class DealRecapGenerationInfo(BaseModel):
    id: str
    created_at: datetime
    status: str
    model: str | None


class DealRecapResponse(BaseModel):
    session_id: str
    active_deal_id: str | None
    generation: DealRecapGenerationInfo | None
    beats: list[TimelineBeatResponse]
    savings: SavingsSnapshotResponse


class RedactionProfile(BaseModel):
    hide_user_message_quotes: bool = True
    hide_dealer_name: bool = True
    hide_dollar_amounts: bool = False


class RecapGenerateRequest(BaseModel):
    """Optional body for recap generation."""

    deal_id: str | None = Field(
        default=None,
        description="Scope recap to this deal; default active deal from deal state.",
    )
    force: bool = Field(
        default=False,
        description=(
            "When false and a succeeded recap already exists, the server returns that recap "
            "without calling the model. When true, always runs generation (replacing prior model beats)."
        ),
    )
    redaction: RedactionProfile | None = Field(
        default=None,
        description=(
            "Optional share-style preferences passed into the recap model so new beats omit quoted chat, "
            "dealer names, and/or dollar amounts when those flags are true."
        ),
    )


class TimelineEventCreateRequest(BaseModel):
    kind: str = Field(..., max_length=64)
    world: str = Field(default="", max_length=4000)
    app: str = Field(default="", max_length=4000)
    occurred_at: datetime | None = None
    supersedes_event_id: str | None = None
    deal_id: str | None = None

    @model_validator(mode="after")
    def removal_or_sections(self) -> TimelineEventCreateRequest:
        kind = (self.kind or "").strip()
        if kind.lower() == "user_beat_removal":
            if not (self.supersedes_event_id or "").strip():
                raise ValueError("user_beat_removal requires supersedes_event_id")
            return self
        if not self.world.strip() and not self.app.strip():
            raise ValueError("world and app cannot both be empty")
        return self


class DealRecapSharePreviewRequest(BaseModel):
    redaction: RedactionProfile = Field(default_factory=RedactionProfile)


class PublicTimelineBeatResponse(BaseModel):
    id: str
    occurred_at: datetime
    kind: str
    world: str
    app: str
    sort_order: int


class DealRecapPublicResponse(BaseModel):
    session_id: str
    beats: list[PublicTimelineBeatResponse]
    savings: SavingsSnapshotResponse
