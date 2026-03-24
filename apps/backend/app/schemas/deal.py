from datetime import datetime

from pydantic import BaseModel


class DealStateResponse(BaseModel):
    session_id: str
    phase: str
    buyer_context: str
    msrp: float | None
    invoice_price: float | None
    their_offer: float | None
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
    checklist: list[dict]
    timer_started_at: datetime | None
    updated_at: datetime

    class Config:
        from_attributes = True
