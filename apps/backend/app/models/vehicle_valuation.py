import uuid
from datetime import datetime, timezone

from sqlalchemy import Float, ForeignKey, String
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class VehicleValuation(Base):
    __tablename__ = "vehicle_valuations"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    vehicle_id: Mapped[str] = mapped_column(
        String, ForeignKey("vehicles.id"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    vin: Mapped[str] = mapped_column(String, nullable=False, index=True)

    amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    currency: Mapped[str] = mapped_column(String, default="USD")
    valuation_label: Mapped[str] = mapped_column(
        String, default="Market Asking Price Estimate"
    )
    source_summary: Mapped[str | None] = mapped_column(String, nullable=True)
    raw_payload: Mapped[dict] = mapped_column(JSON, default=dict)

    requested_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc)
    )
    fetched_at: Mapped[datetime | None] = mapped_column(nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
