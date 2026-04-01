from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import IdentityConfirmationStatus

# ─── Vehicle schemas ───


class VehicleDecodeResponse(BaseModel):
    id: str
    provider: str
    status: str
    vin: str
    year: int | None = None
    make: str | None = None
    model: str | None = None
    trim: str | None = None
    engine: str | None = None
    body_type: str | None = None
    drivetrain: str | None = None
    transmission: str | None = None
    fuel_type: str | None = None
    source_summary: str | None = None
    raw_payload: dict | None = None
    requested_at: datetime
    fetched_at: datetime | None = None
    expires_at: datetime | None = None

    class Config:
        from_attributes = True


class VehicleHistoryReportResponse(BaseModel):
    id: str
    provider: str
    status: str
    vin: str
    title_brands: list[str] = []
    title_brand_count: int = 0
    has_salvage: bool = False
    has_total_loss: bool = False
    has_theft_record: bool = False
    has_odometer_issue: bool = False
    source_summary: str | None = None
    coverage_notes: str | None = None
    requested_at: datetime
    fetched_at: datetime | None = None
    expires_at: datetime | None = None

    class Config:
        from_attributes = True


class VehicleValuationResponse(BaseModel):
    id: str
    provider: str
    status: str
    vin: str
    amount: float | None = None
    currency: str = "USD"
    valuation_label: str = "Market Asking Price Estimate"
    source_summary: str | None = None
    requested_at: datetime
    fetched_at: datetime | None = None
    expires_at: datetime | None = None

    class Config:
        from_attributes = True


class VehicleIntelligenceResponse(BaseModel):
    decode: VehicleDecodeResponse | None = None
    history_report: VehicleHistoryReportResponse | None = None
    valuation: VehicleValuationResponse | None = None


class VehicleIntelligenceRequest(BaseModel):
    vin: str | None = Field(None, max_length=17, pattern=r"^[A-HJ-NPR-Z0-9]{17}$")


class VehicleUpsertFromVinRequest(BaseModel):
    vin: str = Field(
        ...,
        min_length=1,
        max_length=20,
        pattern=r"^[A-HJ-NPR-Za-hj-npr-z0-9\s\-]{1,20}$",
    )


class VehicleIdentityConfirmationRequest(BaseModel):
    status: str = Field(..., pattern="^(confirmed|rejected)$")


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
    identity_confirmation_status: str = IdentityConfirmationStatus.UNCONFIRMED
    identity_confirmed_at: datetime | None = None
    identity_confirmation_source: str | None = None
    intelligence: VehicleIntelligenceResponse | None = None

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
