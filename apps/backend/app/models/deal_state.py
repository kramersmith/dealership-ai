import uuid
from datetime import datetime, timezone

from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DealState(Base):
    __tablename__ = "deal_states"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id: Mapped[str] = mapped_column(
        String, ForeignKey("chat_sessions.id"), nullable=False, unique=True, index=True
    )

    # Phase
    phase: Mapped[str] = mapped_column(String, nullable=False, default="research")

    # Numbers
    msrp: Mapped[float | None] = mapped_column(Float, nullable=True)
    invoice_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    their_offer: Mapped[float | None] = mapped_column(Float, nullable=True)
    your_target: Mapped[float | None] = mapped_column(Float, nullable=True)
    walk_away_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    current_offer: Mapped[float | None] = mapped_column(Float, nullable=True)
    monthly_payment: Mapped[float | None] = mapped_column(Float, nullable=True)
    apr: Mapped[float | None] = mapped_column(Float, nullable=True)
    loan_term_months: Mapped[int | None] = mapped_column(Integer, nullable=True)
    down_payment: Mapped[float | None] = mapped_column(Float, nullable=True)
    trade_in_value: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Vehicle
    vehicle_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    vehicle_make: Mapped[str | None] = mapped_column(String, nullable=True)
    vehicle_model: Mapped[str | None] = mapped_column(String, nullable=True)
    vehicle_trim: Mapped[str | None] = mapped_column(String, nullable=True)
    vehicle_vin: Mapped[str | None] = mapped_column(String, nullable=True)
    vehicle_mileage: Mapped[int | None] = mapped_column(Integer, nullable=True)
    vehicle_color: Mapped[str | None] = mapped_column(String, nullable=True)

    # Scorecard
    score_price: Mapped[str | None] = mapped_column(String, nullable=True)
    score_financing: Mapped[str | None] = mapped_column(String, nullable=True)
    score_trade_in: Mapped[str | None] = mapped_column(String, nullable=True)
    score_fees: Mapped[str | None] = mapped_column(String, nullable=True)
    score_overall: Mapped[str | None] = mapped_column(String, nullable=True)

    # Checklist
    checklist: Mapped[list] = mapped_column(JSON, default=list)

    # Timer
    timer_started_at: Mapped[datetime | None] = mapped_column(nullable=True)

    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
