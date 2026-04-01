import uuid
from datetime import datetime, timezone

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class VehicleDecode(Base):
    __tablename__ = "vehicle_decodes"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    vehicle_id: Mapped[str] = mapped_column(
        String, ForeignKey("vehicles.id"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    vin: Mapped[str] = mapped_column(String, nullable=False, index=True)

    year: Mapped[int | None] = mapped_column(nullable=True)
    make: Mapped[str | None] = mapped_column(String, nullable=True)
    model: Mapped[str | None] = mapped_column(String, nullable=True)
    trim: Mapped[str | None] = mapped_column(String, nullable=True)
    engine: Mapped[str | None] = mapped_column(String, nullable=True)
    body_type: Mapped[str | None] = mapped_column(String, nullable=True)
    drivetrain: Mapped[str | None] = mapped_column(String, nullable=True)
    transmission: Mapped[str | None] = mapped_column(String, nullable=True)
    fuel_type: Mapped[str | None] = mapped_column(String, nullable=True)
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
