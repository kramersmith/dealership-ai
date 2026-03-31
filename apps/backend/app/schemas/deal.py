from datetime import datetime

from pydantic import BaseModel, Field

# ─── Vehicle schemas ───


class VehicleResponse(BaseModel):
    id: str
    role: str
    year: int | None = None
    make: str | None = None
    model: str | None = None
    trim: str | None = None
    vin: str | None = None
    mileage: int | None = None
    color: str | None = None
    engine: str | None = None

    class Config:
        from_attributes = True


class VehicleCorrection(BaseModel):
    """Corrections to a specific vehicle, identified by ID."""

    vehicle_id: str
    year: int | None = None
    make: str | None = Field(None, max_length=100)
    model: str | None = Field(None, max_length=100)
    trim: str | None = Field(None, max_length=100)
    vin: str | None = Field(None, max_length=17)
    mileage: int | None = None
    color: str | None = Field(None, max_length=50)
    engine: str | None = Field(None, max_length=100)


# ─── Deal schemas ───


class DealResponse(BaseModel):
    id: str
    vehicle_id: str
    dealer_name: str | None = None
    phase: str
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
    # Scorecard
    score_price: str | None = None
    score_financing: str | None = None
    score_trade_in: str | None = None
    score_fees: str | None = None
    score_overall: str | None = None
    # Health
    health_status: str | None = None
    health_summary: str | None = None
    recommendation: str | None = None
    # Red flags (deal-level)
    red_flags: list[dict] = []
    # Information gaps (deal-level)
    information_gaps: list[dict] = []
    # Offer history
    first_offer: float | None = None
    pre_fi_price: float | None = None
    savings_estimate: float | None = None

    class Config:
        from_attributes = True


class DealNumberCorrection(BaseModel):
    """Corrections to a specific deal's numbers, identified by ID."""

    deal_id: str
    dealer_name: str | None = None
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


# ─── Correction request/response ───


class DealCorrectionRequest(BaseModel):
    """User-initiated corrections to vehicles and/or deal numbers."""

    vehicle_corrections: list[VehicleCorrection] | None = None
    deal_corrections: list[DealNumberCorrection] | None = None


class DealCorrectionResponse(BaseModel):
    """Assessment result after corrections are applied."""

    deal_id: str
    health_status: str | None = None
    health_summary: str | None = None
    recommendation: str | None = None
    red_flags: list[dict] = []


# ─── Full deal state response ───


class DealStateResponse(BaseModel):
    """Complete deal state for a session, including all vehicles and deals."""

    session_id: str
    buyer_context: str
    active_deal_id: str | None = None
    vehicles: list[VehicleResponse] = []
    deals: list[DealResponse] = []
    # Session-level fields
    red_flags: list[dict] = []
    information_gaps: list[dict] = []
    checklist: list[dict] = []
    timer_started_at: datetime | None = None
    ai_panel_cards: list[dict] = []
    deal_comparison: dict | None = None
    negotiation_context: dict | None = None
    updated_at: datetime
