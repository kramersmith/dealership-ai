import uuid
from datetime import datetime, timezone

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import MessageCompletionStatus


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        String, ForeignKey("chat_sessions.id"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    image_url: Mapped[str | None] = mapped_column(String, nullable=True)
    tool_calls: Mapped[list | None] = mapped_column(JSON, nullable=True)
    """Canonical AI insights panel snapshot for this assistant turn (sanitized cards)."""
    panel_cards: Mapped[list | None] = mapped_column(JSON, nullable=True)
    usage: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    completion_status: Mapped[str] = mapped_column(
        String, nullable=False, default=MessageCompletionStatus.COMPLETE.value
    )
    interrupted_at: Mapped[datetime | None] = mapped_column(nullable=True)
    interrupted_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc)
    )
