import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class VehicleHistoryReport(Base):
    __tablename__ = "vehicle_history_reports"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    vehicle_id: Mapped[str] = mapped_column(
        String, ForeignKey("vehicles.id"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    vin: Mapped[str] = mapped_column(String, nullable=False, index=True)

    title_brands: Mapped[list] = mapped_column(JSON, default=list)
    title_brand_count: Mapped[int] = mapped_column(Integer, default=0)
    has_salvage: Mapped[bool] = mapped_column(Boolean, default=False)
    has_total_loss: Mapped[bool] = mapped_column(Boolean, default=False)
    has_theft_record: Mapped[bool] = mapped_column(Boolean, default=False)
    has_odometer_issue: Mapped[bool] = mapped_column(Boolean, default=False)
    source_summary: Mapped[str | None] = mapped_column(String, nullable=True)
    coverage_notes: Mapped[str | None] = mapped_column(String, nullable=True)
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
