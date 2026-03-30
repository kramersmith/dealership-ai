from datetime import datetime

from pydantic import BaseModel

from app.models.enums import BuyerContext, DealPhase, ScoreStatus, SessionType


class SessionCreate(BaseModel):
    session_type: SessionType = SessionType.BUYER_CHAT
    title: str | None = None
    buyer_context: BuyerContext | None = None


class SessionUpdate(BaseModel):
    title: str | None = None
    linked_session_ids: list[str] | None = None


class DealSummary(BaseModel):
    phase: DealPhase | None = None
    vehicle_year: int | None = None
    vehicle_make: str | None = None
    vehicle_model: str | None = None
    vehicle_trim: str | None = None
    current_offer: float | None = None
    listing_price: float | None = None
    score_overall: ScoreStatus | None = None
    deal_count: int = 0


class SessionResponse(BaseModel):
    id: str
    title: str
    session_type: SessionType
    linked_session_ids: list[str]
    last_message_preview: str
    deal_summary: DealSummary | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
