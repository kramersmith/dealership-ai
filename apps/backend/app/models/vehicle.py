import uuid
from datetime import datetime, timezone

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import IdentityConfirmationStatus, VehicleRole


class Vehicle(Base):
    __tablename__ = "vehicles"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        String, ForeignKey("chat_sessions.id"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(
        String, nullable=False, default=VehicleRole.PRIMARY
    )

    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    make: Mapped[str | None] = mapped_column(String, nullable=True)
    model: Mapped[str | None] = mapped_column(String, nullable=True)
    trim: Mapped[str | None] = mapped_column(String, nullable=True)
    vin: Mapped[str | None] = mapped_column(String, nullable=True)
    mileage: Mapped[int | None] = mapped_column(Integer, nullable=True)
    color: Mapped[str | None] = mapped_column(String, nullable=True)
    engine: Mapped[str | None] = mapped_column(String, nullable=True)
    identity_confirmation_status: Mapped[str] = mapped_column(
        String, nullable=False, default=IdentityConfirmationStatus.UNCONFIRMED
    )
    identity_confirmed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    identity_confirmation_source: Mapped[str | None] = mapped_column(
        String, nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
