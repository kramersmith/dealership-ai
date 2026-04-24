import uuid
from datetime import datetime, timezone

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DealTimelineEvent(Base):
    """Single timeline beat: model-generated, user correction, or tool-sourced hint."""

    __tablename__ = "deal_timeline_events"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        String, ForeignKey("chat_sessions.id"), nullable=False, index=True
    )
    deal_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("deals.id"), nullable=True
    )
    recap_generation_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("deal_recap_generations.id"), nullable=True, index=True
    )
    user_message_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("messages.id"), nullable=True
    )
    assistant_message_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("messages.id"), nullable=True
    )
    occurred_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc), index=True
    )
    kind: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    source: Mapped[str] = mapped_column(String, nullable=False)
    supersedes_event_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("deal_timeline_events.id"), nullable=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    idempotency_key: Mapped[str | None] = mapped_column(String, nullable=True)
