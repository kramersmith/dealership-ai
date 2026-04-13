from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.deal_state import DealState
from app.models.enums import InsightsUpdateMode, MessageRole
from app.models.message import Message
from app.models.session import ChatSession
from app.models.user import User
from app.schemas.chat import PanelRefreshResponse
from app.services.insights_followup import run_linked_insights_followup_to_completion
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
    if (
        await db.scalar(select(DealState.id).where(DealState.session_id == session_id))
        is None
    ):
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

    result = await run_linked_insights_followup_to_completion(
        db=db,
        session=session,
        session_id=session_id,
        assistant_message_id=latest_assistant.id,
        force_rerun=True,
        followup_enabled=True,
    )

    logger.info(
        "Panel refreshed on demand: session_id=%s, cards=%d",
        session_id,
        len(result.cards),
    )
    return PanelRefreshResponse(
        cards=result.cards,
        assistant_message_id=result.assistant_message_id,
    )


__all__ = [
    "PanelUpdatePolicy",
    "refresh_panel_on_demand",
    "resolve_panel_update_policy",
]
