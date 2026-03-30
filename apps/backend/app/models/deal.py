import uuid
from datetime import datetime, timezone

from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import DealPhase


class Deal(Base):
    __tablename__ = "deals"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        String, ForeignKey("chat_sessions.id"), nullable=False, index=True
    )
    vehicle_id: Mapped[str] = mapped_column(
        String, ForeignKey("vehicles.id"), nullable=False, index=True
    )

    # Dealer identification
    dealer_name: Mapped[str | None] = mapped_column(String, nullable=True)

    # Phase (per-deal)
    phase: Mapped[str] = mapped_column(
        String, nullable=False, default=DealPhase.RESEARCH
    )

    # Financial numbers
    msrp: Mapped[float | None] = mapped_column(Float, nullable=True)
    invoice_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    listing_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    your_target: Mapped[float | None] = mapped_column(Float, nullable=True)
    walk_away_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    current_offer: Mapped[float | None] = mapped_column(Float, nullable=True)
    monthly_payment: Mapped[float | None] = mapped_column(Float, nullable=True)
    apr: Mapped[float | None] = mapped_column(Float, nullable=True)
    loan_term_months: Mapped[int | None] = mapped_column(Integer, nullable=True)
    down_payment: Mapped[float | None] = mapped_column(Float, nullable=True)
    trade_in_value: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Scorecard
    score_price: Mapped[str | None] = mapped_column(String, nullable=True)
    score_financing: Mapped[str | None] = mapped_column(String, nullable=True)
    score_trade_in: Mapped[str | None] = mapped_column(String, nullable=True)
    score_fees: Mapped[str | None] = mapped_column(String, nullable=True)
    score_overall: Mapped[str | None] = mapped_column(String, nullable=True)

    # Deal health (Tier 2 — AI-assessed)
    health_status: Mapped[str | None] = mapped_column(String, nullable=True)
    health_summary: Mapped[str | None] = mapped_column(String, nullable=True)
    recommendation: Mapped[str | None] = mapped_column(String, nullable=True)

    # Red flags (deal-level, Tier 2 — AI-assessed)
    red_flags: Mapped[list] = mapped_column(JSON, default=list)

    # Information gaps (deal-level)
    information_gaps: Mapped[list] = mapped_column(JSON, default=list)

    # Offer history — per-deal snapshots
    first_offer: Mapped[float | None] = mapped_column(Float, nullable=True)
    pre_fi_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    savings_estimate: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Deal comparison (AI-generated, stored for persistence)
    comparison: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
