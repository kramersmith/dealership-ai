import uuid
from datetime import datetime, timezone

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.sqlite import JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import BuyerContext


class DealState(Base):
    """Session-level deal state — buyer context and fields shared across all deals."""

    __tablename__ = "deal_states"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, default=lambda: str(uuid.uuid4())
    )
    session_id: Mapped[str] = mapped_column(
        String, ForeignKey("chat_sessions.id"), nullable=False, unique=True, index=True
    )

    # Buyer context (session-level)
    buyer_context: Mapped[str] = mapped_column(
        String, nullable=False, default=BuyerContext.RESEARCHING
    )

    # Active deal — which deal the panel is showing
    active_deal_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("deals.id", use_alter=True), nullable=True
    )

    # Red flags (session/buyer-level — e.g., "You haven't been pre-approved")
    red_flags: Mapped[list] = mapped_column(JSON, default=list)

    # Information gaps (session-level — e.g., "Have you been pre-approved?")
    information_gaps: Mapped[list] = mapped_column(JSON, default=list)

    # Checklist (session-level)
    checklist: Mapped[list] = mapped_column(JSON, default=list)

    # Timer (session-level)
    timer_started_at: Mapped[datetime | None] = mapped_column(nullable=True)

    # AI-driven panel state (persisted cards)
    ai_panel_cards: Mapped[list] = mapped_column(JSON, default=list)

    # Deal comparison (AI-generated, session-level since it spans deals)
    deal_comparison: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
