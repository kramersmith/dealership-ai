from datetime import datetime

from pydantic import BaseModel, Field


class DealCorrectionRequest(BaseModel):
    """User-initiated corrections to deal state fields."""

    # Numbers
    msrp: float | None = None
    invoice_price: float | None = None
    listing_price: float | None = None
    your_target: float | None = None
    walk_away_price: float | None = None
    current_offer: float | None = None
    monthly_payment: float | None = None
    apr: float | None = None
    loan_term_months: int | None = None
    down_payment: float | None = None
    trade_in_value: float | None = None

    # Vehicle
    vehicle_year: int | None = None
    vehicle_make: str | None = Field(None, max_length=100)
    vehicle_model: str | None = Field(None, max_length=100)
    vehicle_trim: str | None = Field(None, max_length=100)
    vehicle_vin: str | None = Field(None, max_length=17)
    vehicle_mileage: int | None = None
    vehicle_color: str | None = Field(None, max_length=50)


class DealCorrectionResponse(BaseModel):
    health_status: str | None = None
    health_summary: str | None = None
    recommendation: str | None = None
    red_flags: list[dict] = []


class DealStateResponse(BaseModel):
    session_id: str
    phase: str
    buyer_context: str
    msrp: float | None
    invoice_price: float | None
    listing_price: float | None
    your_target: float | None
    walk_away_price: float | None
    current_offer: float | None
    monthly_payment: float | None
    apr: float | None
    loan_term_months: int | None
    down_payment: float | None
    trade_in_value: float | None
    vehicle_year: int | None
    vehicle_make: str | None
    vehicle_model: str | None
    vehicle_trim: str | None
    vehicle_vin: str | None
    vehicle_mileage: int | None
    vehicle_color: str | None
    score_price: str | None
    score_financing: str | None
    score_trade_in: str | None
    score_fees: str | None
    score_overall: str | None
    health_status: str | None
    health_summary: str | None
    recommendation: str | None
    red_flags: list[dict]
    information_gaps: list[dict]
    first_offer: float | None
    pre_fi_price: float | None
    savings_estimate: float | None
    checklist: list[dict]
    timer_started_at: datetime | None
    updated_at: datetime

    class Config:
        from_attributes = True
