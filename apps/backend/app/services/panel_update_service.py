from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.deal_state import DealState
from app.models.enums import InsightsUpdateMode, MessageRole
from app.models.message import Message
from app.models.session import ChatSession
from app.models.user import User
from app.schemas.chat import PanelRefreshResponse
from app.services.deal_state import deal_state_to_dict
from app.services.panel import generate_ai_panel_cards_with_usage
from app.services.usage_tracking import SessionUsageSummary, build_request_usage
from app.services.user_settings import get_or_create_user_settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class PanelUpdatePolicy:
    mode: InsightsUpdateMode

    @property
    def live_updates_enabled(self) -> bool:
        return self.mode == InsightsUpdateMode.LIVE


async def resolve_panel_update_policy(
    db: AsyncSession,
    user: User | None = None,
    *,
    user_id: str | None = None,
) -> PanelUpdatePolicy:
    settings_row = await get_or_create_user_settings(db, user, user_id=user_id)
    return PanelUpdatePolicy(mode=InsightsUpdateMode(settings_row.insights_update_mode))


async def refresh_panel_on_demand(
    *,
    db: AsyncSession,
    session: ChatSession,
    session_id: str,
) -> PanelRefreshResponse:
    deal_state = await db.scalar(
        select(DealState).where(DealState.session_id == session_id)
    )
    if deal_state is None:
        raise ValueError("Deal state not found")

    latest_assistant = await db.scalar(
        select(Message)
        .where(
            Message.session_id == session_id,
            Message.role == MessageRole.ASSISTANT.value,
        )
        .order_by(desc(Message.created_at), desc(Message.id))
        .limit(1)
    )
    if latest_assistant is None:
        raise RuntimeError("No assistant message available to refresh")

    history_rows = (
        (
            await db.execute(
                select(Message)
                .where(Message.session_id == session_id)
                .order_by(Message.created_at, Message.id)
            )
        )
        .scalars()
        .all()
    )
    model_history = [{"role": row.role, "content": row.content} for row in history_rows]

    cards, usage_summary = await generate_ai_panel_cards_with_usage(
        await deal_state_to_dict(deal_state, db),
        latest_assistant.content,
        model_history,
        session_id=session_id,
    )
    deal_state.ai_panel_cards = cards
    latest_assistant.panel_cards = cards

    session_usage = SessionUsageSummary.from_dict(session.usage)
    if usage_summary.get("requests", 0) > 0:
        session_usage.add_request(
            build_request_usage(
                model=settings.CLAUDE_MODEL,
                usage_summary=usage_summary,
            )
        )
    session.usage = session_usage.to_dict()
    session.updated_at = datetime.now(timezone.utc)
    await db.commit()

    logger.info(
        "Panel refreshed on demand: session_id=%s, cards=%d",
        session_id,
        len(cards),
    )
    return PanelRefreshResponse(cards=cards, assistant_message_id=latest_assistant.id)


__all__ = [
    "PanelUpdatePolicy",
    "refresh_panel_on_demand",
    "resolve_panel_update_policy",
]
