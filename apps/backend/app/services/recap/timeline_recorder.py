"""Append-only tool-sourced timeline hints (e.g. phase changes) with idempotency."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.deal_timeline_event import DealTimelineEvent
from app.models.enums import DealPhase
from app.models.enums_recap import TimelineEventSource

logger = logging.getLogger(__name__)


async def record_phase_change(
    db: AsyncSession,
    *,
    session_id: str,
    deal_id: str,
    old_phase: str,
    new_phase: str,
) -> None:
    """Record a deal phase transition as a tool-sourced timeline hint."""
    if old_phase == new_phase:
        return
    idempotency_key = f"phase:{deal_id}:{new_phase}"
    dup = await db.execute(
        select(DealTimelineEvent.id).where(
            DealTimelineEvent.session_id == session_id,
            DealTimelineEvent.idempotency_key == idempotency_key,
        )
    )
    if dup.first():
        return

    event = DealTimelineEvent(
        id=str(uuid.uuid4()),
        session_id=session_id,
        deal_id=deal_id,
        recap_generation_id=None,
        user_message_id=None,
        assistant_message_id=None,
        occurred_at=datetime.now(timezone.utc),
        kind="phase_change",
        payload={
            "world": "",
            "app": f"Phase moved from {old_phase} to {new_phase}.",
            "old_phase": old_phase,
            "new_phase": new_phase,
        },
        source=TimelineEventSource.TOOL.value,
        supersedes_event_id=None,
        sort_order=0,
        idempotency_key=idempotency_key,
    )
    db.add(event)
    await db.flush()
    logger.debug(
        "Recorded phase timeline hint session_id=%s deal_id=%s %s→%s",
        session_id,
        deal_id,
        old_phase,
        new_phase,
    )


def is_valid_phase(value: str) -> bool:
    return value in {p.value for p in DealPhase}
