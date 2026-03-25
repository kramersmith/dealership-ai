from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import SessionType

if TYPE_CHECKING:
    from app.models.deal_state import DealState
    from app.models.message import Message
    from app.models.simulation import Simulation


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String, nullable=False, default="New Deal")
    auto_title: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_message_preview: Mapped[str] = mapped_column(
        String, nullable=False, default=""
    )
    session_type: Mapped[str] = mapped_column(
        String, nullable=False, default=SessionType.BUYER_CHAT
    )
    linked_session_ids: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # Relationships — cascade deletes so child rows are removed automatically.
    # passive_deletes is intentionally False (the default) because the FK columns
    # do not declare ON DELETE CASCADE at the DB level; SQLAlchemy must emit the
    # child DELETEs itself when db.delete(session) is called.
    messages: Mapped[list["Message"]] = relationship(
        "Message", cascade="all, delete-orphan"
    )
    deal_state: Mapped["DealState | None"] = relationship(
        "DealState", cascade="all, delete-orphan", uselist=False
    )
    simulation: Mapped["Simulation | None"] = relationship(
        "Simulation", cascade="all, delete-orphan", uselist=False
    )
