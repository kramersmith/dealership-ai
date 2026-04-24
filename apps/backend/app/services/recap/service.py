"""Deal recap assembly, generation, and share-preview orchestration."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.deal_recap_generation import DealRecapGeneration
from app.models.deal_state import DealState
from app.models.deal_timeline_event import DealTimelineEvent
from app.models.enums_recap import DealRecapGenerationStatus, TimelineEventSource
from app.models.message import Message
from app.models.user import User
from app.schemas.recap import (
    DealRecapGenerationInfo,
    DealRecapPublicResponse,
    DealRecapResponse,
    DealRecapSharePreviewRequest,
    RecapGenerateRequest,
    TimelineBeatResponse,
    TimelineEventCreateRequest,
)
from app.services.deal_state import deal_state_to_dict
from app.services.recap.context_pack import build_context_pack
from app.services.recap.generate_llm import (
    run_recap_generation_llm,
    validate_beats_message_ids,
)
from app.services.recap.redaction import apply_redaction
from app.services.recap.savings_math import compute_savings_snapshot
from app.services.recap.timeline_payload import read_world_app

logger = logging.getLogger(__name__)


def _parse_iso_ts(raw: str | None, fallback: datetime) -> datetime:
    if not raw:
        return fallback
    text = raw.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return fallback


def _occurred_at_utc_aware(dt: datetime) -> datetime:
    """Persist timeline beats as timezone-aware UTC (avoids naive/aware mixes from ISO strings)."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


async def _latest_generation(
    db: AsyncSession, session_id: str
) -> DealRecapGeneration | None:
    result = await db.execute(
        select(DealRecapGeneration)
        .where(DealRecapGeneration.session_id == session_id)
        .order_by(DealRecapGeneration.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _latest_succeeded_generation(
    db: AsyncSession, session_id: str
) -> DealRecapGeneration | None:
    """Most recent successful run — used to attach model beats (failed runs have no beats)."""
    result = await db.execute(
        select(DealRecapGeneration)
        .where(
            DealRecapGeneration.session_id == session_id,
            DealRecapGeneration.status == DealRecapGenerationStatus.SUCCEEDED.value,
        )
        .order_by(DealRecapGeneration.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _load_messages_ordered(db: AsyncSession, session_id: str) -> list[Message]:
    result = await db.execute(
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.created_at.asc(), Message.id.asc())
    )
    return list(result.scalars().all())


def _filter_superseded(events: list[DealTimelineEvent]) -> list[DealTimelineEvent]:
    """Hide rows that another row explicitly supersedes (supersedes_event_id -> hidden id)."""
    hidden = {e.supersedes_event_id for e in events if e.supersedes_event_id}
    return [e for e in events if e.id not in hidden]


async def list_timeline_events_for_recap(
    db: AsyncSession, session_id: str
) -> list[DealTimelineEvent]:
    result = await db.execute(
        select(DealTimelineEvent)
        .where(DealTimelineEvent.session_id == session_id)
        .order_by(
            DealTimelineEvent.occurred_at.asc(), DealTimelineEvent.sort_order.asc()
        )
    )
    rows = list(result.scalars().all())
    return _filter_superseded(rows)


def _occurred_at_sort_ts(dt: datetime) -> float:
    """UTC epoch seconds — avoids TypeError when mixing naive and offset-aware datetimes."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc).timestamp()
    return dt.astimezone(timezone.utc).timestamp()


def _visible_events(
    events: list[DealTimelineEvent], latest_gen_id: str | None
) -> list[DealTimelineEvent]:
    visible: list[DealTimelineEvent] = []
    for e in events:
        if e.source == TimelineEventSource.TOOL.value:
            visible.append(e)
        elif e.source == TimelineEventSource.USER.value:
            visible.append(e)
        elif e.source == TimelineEventSource.MODEL.value:
            if latest_gen_id and e.recap_generation_id == latest_gen_id:
                visible.append(e)
    return sorted(visible, key=lambda x: (_occurred_at_sort_ts(x.occurred_at), x.sort_order))


def _buyer_timeline_hints_block(events: list[DealTimelineEvent]) -> str:
    """Serialize buyer-authored timeline rows for recap generation (capped)."""
    user_ev = [e for e in events if e.source == TimelineEventSource.USER.value]
    user_ev.sort(key=lambda e: (_occurred_at_sort_ts(e.occurred_at), e.sort_order))
    user_ev = user_ev[-30:]
    if not user_ev:
        return ""
    lines: list[str] = []
    for e in user_ev:
        pl = e.payload if isinstance(e.payload, dict) else {}
        w, a = read_world_app(pl)
        w = w[:2000]
        a = a[:1200]
        if not w and not a:
            continue
        ts = e.occurred_at.isoformat()
        lines.append(f"- [{ts}] (lot) {w} | (app) {a}".strip())
    if not lines:
        return ""
    return (
        "Buyer-provided timeline notes and corrections (stored on this deal; integrate faithfully):\n"
        + "\n".join(lines)
    )


async def build_recap_response(
    db: AsyncSession,
    *,
    session_id: str,
    deal_state: DealState,
) -> DealRecapResponse:
    deal_dict = await deal_state_to_dict(deal_state, db)
    savings = compute_savings_snapshot(
        deal_dict, active_deal_id=deal_state.active_deal_id
    )
    latest = await _latest_generation(db, session_id)
    latest_ok = await _latest_succeeded_generation(db, session_id)
    all_e = await list_timeline_events_for_recap(db, session_id)
    gen_id = latest_ok.id if latest_ok else None
    visible = _visible_events(all_e, gen_id)
    # Tool rows (e.g. phase_change) are for internal continuity; buyers retell the chat story,
    # not CRM-style audit lines — omit from API / share payloads (model + user beats only).
    buyer_facing = [
        e
        for e in visible
        if e.source != TimelineEventSource.TOOL.value and e.kind != "user_beat_removal"
    ]
    beats = [
        TimelineBeatResponse(
            id=e.id,
            session_id=e.session_id,
            deal_id=e.deal_id,
            recap_generation_id=e.recap_generation_id,
            user_message_id=e.user_message_id,
            assistant_message_id=e.assistant_message_id,
            occurred_at=e.occurred_at,
            kind=e.kind,
            payload=dict(e.payload or {}),
            source=e.source,
            supersedes_event_id=e.supersedes_event_id,
            sort_order=e.sort_order,
        )
        for e in buyer_facing
    ]
    gen_info = None
    if latest:
        gen_info = DealRecapGenerationInfo(
            id=latest.id,
            created_at=latest.created_at,
            status=latest.status,
            model=latest.model,
        )
    return DealRecapResponse(
        session_id=session_id,
        active_deal_id=deal_state.active_deal_id,
        generation=gen_info,
        beats=beats,
        savings=savings,
    )


async def generate_recap(
    db: AsyncSession,
    *,
    session_id: str,
    user: User,
    deal_state: DealState,
    body: RecapGenerateRequest | None,
) -> DealRecapResponse:
    body = body or RecapGenerateRequest()
    latest_ok = await _latest_succeeded_generation(db, session_id)
    if latest_ok is not None and not body.force:
        logger.info(
            "recap_generate_skipped session_id=%s reason=no_force_existing_succeeded_gen",
            session_id,
        )
        return await build_recap_response(db, session_id=session_id, deal_state=deal_state)

    deal_dict = await deal_state_to_dict(deal_state, db)
    messages = await _load_messages_ordered(db, session_id)
    all_events = await list_timeline_events_for_recap(db, session_id)
    buyer_hints = _buyer_timeline_hints_block(all_events)
    pack = build_context_pack(deal_dict, messages)
    parsed, usage_dict = await run_recap_generation_llm(
        deal_state_json=pack.deal_state_json,
        messages_block=pack.messages_block,
        session_id=session_id,
        buyer_timeline_hints=buyer_hints,
        redaction=body.redaction,
    )
    msg_ids = {m.id for m in messages}
    roles = {m.id: m.role for m in messages}
    beats_in = validate_beats_message_ids(
        beats=parsed.beats,
        message_ids_in_session=msg_ids,
        message_role_by_id=roles,
    )

    if len(beats_in) == 0:
        active_deal_id = body.deal_id or deal_state.active_deal_id
        failed_gen = DealRecapGeneration(
            id=str(uuid.uuid4()),
            session_id=session_id,
            deal_id=active_deal_id,
            user_id=user.id,
            usage=usage_dict,
            model=settings.CLAUDE_MODEL,
            status=DealRecapGenerationStatus.FAILED.value,
        )
        db.add(failed_gen)
        await db.commit()
        logger.warning(
            "recap_generate_empty_beats session_id=%s generation_id=%s",
            session_id,
            failed_gen.id,
        )
        raise HTTPException(
            status_code=422,
            detail=(
                "The recap model returned no timeline beats. Your previous recap is unchanged. "
                "Try again, add more chat context, or edit your timeline notes."
            ),
        )

    active_deal_id = body.deal_id or deal_state.active_deal_id
    prior_succeeded = await _latest_succeeded_generation(db, session_id)

    new_gen = DealRecapGeneration(
        id=str(uuid.uuid4()),
        session_id=session_id,
        deal_id=active_deal_id,
        user_id=user.id,
        usage=usage_dict,
        model=settings.CLAUDE_MODEL,
        status=DealRecapGenerationStatus.SUCCEEDED.value,
    )
    db.add(new_gen)
    await db.flush()

    if prior_succeeded:
        doomed_ids = select(DealTimelineEvent.id).where(
            DealTimelineEvent.recap_generation_id == prior_succeeded.id,
            DealTimelineEvent.source == TimelineEventSource.MODEL.value,
        )
        await db.execute(
            update(DealTimelineEvent)
            .where(DealTimelineEvent.supersedes_event_id.in_(doomed_ids))
            .values(supersedes_event_id=None)
        )
        await db.execute(
            delete(DealTimelineEvent).where(
                DealTimelineEvent.recap_generation_id == prior_succeeded.id,
                DealTimelineEvent.source == TimelineEventSource.MODEL.value,
            )
        )

    now = datetime.now(timezone.utc)
    for order, beat in enumerate(beats_in):
        occurred = _occurred_at_utc_aware(_parse_iso_ts(beat.occurred_at_iso, now))
        row = DealTimelineEvent(
            id=str(uuid.uuid4()),
            session_id=session_id,
            deal_id=active_deal_id,
            recap_generation_id=new_gen.id,
            user_message_id=beat.user_message_id,
            assistant_message_id=beat.assistant_message_id,
            occurred_at=occurred,
            kind=beat.kind[:64],
            payload={
                "world": beat.world[:4000],
                "app": beat.app[:4000],
            },
            source=TimelineEventSource.MODEL.value,
            supersedes_event_id=None,
            sort_order=order,
            idempotency_key=None,
        )
        db.add(row)

    await db.commit()
    logger.info(
        "recap_generate_succeeded session_id=%s beat_count=%d force=%s",
        session_id,
        len(beats_in),
        body.force,
    )
    deal_state_result = await db.execute(
        select(DealState).where(DealState.session_id == session_id)
    )
    fresh_state = deal_state_result.scalar_one()
    return await build_recap_response(db, session_id=session_id, deal_state=fresh_state)


async def add_user_timeline_event(
    db: AsyncSession,
    *,
    session_id: str,
    _user: User,
    deal_state: DealState,
    body: TimelineEventCreateRequest,
) -> TimelineBeatResponse:
    kind_raw = (body.kind or "").strip()[:64]
    kind = "user_beat_removal" if kind_raw.lower() == "user_beat_removal" else kind_raw
    sort_order = 9999
    deal_id = body.deal_id or deal_state.active_deal_id
    occurred = _occurred_at_utc_aware(
        body.occurred_at
        if body.occurred_at is not None
        else datetime.now(timezone.utc)
    )
    payload: dict[str, object]
    if kind == "user_beat_removal":
        if not body.supersedes_event_id:
            raise HTTPException(
                status_code=400, detail="user_beat_removal requires supersedes_event_id"
            )
        prev = await db.get(DealTimelineEvent, body.supersedes_event_id)
        if prev is None or prev.session_id != session_id:
            raise HTTPException(status_code=404, detail="Timeline beat not found")
        sort_order = int(prev.sort_order)
        occurred = _occurred_at_utc_aware(prev.occurred_at)
        payload = {"removed": True}
    else:
        if body.supersedes_event_id:
            prev = await db.get(DealTimelineEvent, body.supersedes_event_id)
            if prev is not None:
                sort_order = int(prev.sort_order)
                if body.occurred_at is None:
                    occurred = _occurred_at_utc_aware(prev.occurred_at)
        payload = {
            "world": body.world[:4000],
            "app": body.app[:4000],
        }
    row = DealTimelineEvent(
        id=str(uuid.uuid4()),
        session_id=session_id,
        deal_id=deal_id,
        recap_generation_id=None,
        user_message_id=None,
        assistant_message_id=None,
        occurred_at=occurred,
        kind=kind,
        payload=payload,
        source=TimelineEventSource.USER.value,
        supersedes_event_id=body.supersedes_event_id,
        sort_order=sort_order,
        idempotency_key=None,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return TimelineBeatResponse(
        id=row.id,
        session_id=row.session_id,
        deal_id=row.deal_id,
        recap_generation_id=row.recap_generation_id,
        user_message_id=row.user_message_id,
        assistant_message_id=row.assistant_message_id,
        occurred_at=row.occurred_at,
        kind=row.kind,
        payload=dict(row.payload or {}),
        source=row.source,
        supersedes_event_id=row.supersedes_event_id,
        sort_order=row.sort_order,
    )


async def build_share_preview(
    db: AsyncSession,
    *,
    session_id: str,
    deal_state: DealState,
    body: DealRecapSharePreviewRequest,
) -> DealRecapPublicResponse:
    full = await build_recap_response(db, session_id=session_id, deal_state=deal_state)
    deal_dict = await deal_state_to_dict(deal_state, db)
    dealer_names = [
        str(d.get("dealer_name", "")).strip()
        for d in (deal_dict.get("deals") or [])
        if str(d.get("dealer_name", "")).strip()
    ]
    return apply_redaction(full, body.redaction, dealer_names=dealer_names)


async def export_public_recap_stub(
    _body: DealRecapSharePreviewRequest,
    recap: DealRecapPublicResponse,
) -> dict:
    """v1: return JSON suitable for client-side image/PDF rendering."""
    return {
        "format": "json",
        "recap": recap.model_dump(mode="json"),
        "note": "Render share image on device from this payload.",
    }
