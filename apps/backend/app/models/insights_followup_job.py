import uuid
from datetime import datetime, timezone

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import (
    InsightsFollowupKind,
    InsightsFollowupStatus,
    InsightsFollowupStepStatus,
)


class InsightsFollowupJob(Base):
    __tablename__ = "insights_followup_jobs"
    __table_args__ = (
        UniqueConstraint(
            "session_id",
            "assistant_message_id",
            "kind",
            name="uq_insights_followup_jobs_identity",
        ),
    )

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        String, ForeignKey("chat_sessions.id"), nullable=False, index=True
    )
    assistant_message_id: Mapped[str] = mapped_column(
        String, ForeignKey("messages.id"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default=InsightsFollowupKind.LINKED_RECONCILE_PANEL.value,
    )
    status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default=InsightsFollowupStatus.PENDING.value,
        index=True,
    )
    reconcile_status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default=InsightsFollowupStepStatus.PENDING.value,
    )
    panel_status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        default=InsightsFollowupStepStatus.PENDING.value,
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    usage: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
