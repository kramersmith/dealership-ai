"""Session timeline branch: truncate messages after a user anchor and reset commerce state.

Used when the buyer edits an earlier user message and continues from that point.
See docs/adr/0020-chat-branch-from-user-message.md (and ADR 0019 for VIN resume).
"""

from __future__ import annotations

import logging

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.deal import Deal
from app.models.deal_state import DealState
from app.models.enums import MessageRole
from app.models.insights_followup_job import InsightsFollowupJob
from app.models.message import Message
from app.models.session import ChatSession
from app.models.vehicle import Vehicle

logger = logging.getLogger(__name__)


class SessionBranchError(Exception):
    """Base error for invalid session-branch operations."""


class BranchAnchorNotFoundError(SessionBranchError):
    """Raised when the requested branch anchor does not exist in the session."""


class BranchAnchorNotUserError(SessionBranchError):
    """Raised when the branch anchor is not a user message."""


async def reset_session_commerce_state(session_id: str, db: AsyncSession) -> None:
    """Clear deals, vehicles, and session-level deal JSON; preserve ``buyer_context``.

    Nulls ``active_deal_id`` first so FK from deal_states → deals does not block deletes.
    """
    deal_state_result = await db.execute(
        select(DealState).where(DealState.session_id == session_id)
    )
    deal_state = deal_state_result.scalar_one_or_none()
    if deal_state:
        deal_state.active_deal_id = None
        await db.flush()
        deal_state.red_flags = []
        deal_state.information_gaps = []
        deal_state.checklist = []
        deal_state.timer_started_at = None
        deal_state.ai_panel_cards = []
        deal_state.deal_comparison = None
        deal_state.negotiation_context = None

    await db.execute(delete(Deal).where(Deal.session_id == session_id))
    await db.execute(delete(Vehicle).where(Vehicle.session_id == session_id))
    await db.flush()


async def prepare_session_branch_from_user_message(
    db: AsyncSession,
    session: ChatSession,
    anchor_user_message_id: str,
) -> int:
    """Delete messages after the anchor when present; always clear compaction, usage, and commerce.

    Commits once. Returns the number of message rows removed after the anchor (not including the anchor).
    Structured deal/vehicle state is reset on every branch, even when there is no tail to delete.
    """
    messages_result = await db.execute(
        select(Message)
        .where(Message.session_id == session.id)
        .order_by(Message.created_at, Message.id)
    )
    ordered = list(messages_result.scalars().all())

    anchor_index: int | None = None
    for message_index, message_row in enumerate(ordered):
        if message_row.id == anchor_user_message_id:
            anchor_index = message_index
            break
    if anchor_index is None:
        raise BranchAnchorNotFoundError
    anchor = ordered[anchor_index]
    if anchor.role != MessageRole.USER:
        raise BranchAnchorNotUserError

    tail_messages = ordered[anchor_index + 1 :]
    message_ids_to_delete = [message.id for message in tail_messages]
    removed_count = len(message_ids_to_delete)
    if message_ids_to_delete:
        assistant_message_ids_to_delete = [
            message.id
            for message in tail_messages
            if message.role == MessageRole.ASSISTANT
        ]
        if assistant_message_ids_to_delete:
            await db.execute(
                delete(InsightsFollowupJob).where(
                    InsightsFollowupJob.session_id == session.id,
                    InsightsFollowupJob.assistant_message_id.in_(
                        assistant_message_ids_to_delete
                    ),
                )
            )
        await db.execute(delete(Message).where(Message.id.in_(message_ids_to_delete)))

    session.compaction_state = None
    session.usage = None

    await reset_session_commerce_state(session.id, db)

    await db.commit()

    logger.info(
        "chat_branch_prepared session_id=%s anchor_message_id=%s messages_removed=%d",
        session.id,
        anchor_user_message_id,
        removed_count,
    )
    return removed_count
