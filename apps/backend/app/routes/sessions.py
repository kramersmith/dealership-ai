import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import get_current_user, get_db
from app.models.deal import Deal
from app.models.deal_state import DealState
from app.models.enums import DealPhase, ScoreStatus, SessionType, UserRole
from app.models.message import Message
from app.models.session import ChatSession
from app.models.user import User
from app.models.vehicle import Vehicle
from app.schemas.session import (
    DealSummary,
    SessionCreate,
    SessionResponse,
    SessionUpdate,
)
from app.services.post_chat_processing import DEFAULT_BUYER_TITLE, DEFAULT_DEALER_TITLE
from app.services.usage_tracking import session_usage_payload

# Maps session types to the role allowed to create them
_SESSION_TYPE_ROLE = {
    SessionType.BUYER_CHAT: UserRole.BUYER,
    SessionType.DEALER_SIM: UserRole.DEALER,
}

logger = logging.getLogger(__name__)

router = APIRouter()


async def _build_deal_summary(
    deal_state: DealState | None, db: AsyncSession
) -> DealSummary | None:
    """Build a lightweight deal summary from a DealState, or None if absent."""
    if deal_state is None:
        return None

    count_result = await db.execute(
        select(func.count())
        .select_from(Deal)
        .where(Deal.session_id == deal_state.session_id)
    )
    deal_count = count_result.scalar_one()

    # Get active deal or most recent
    active_deal = None
    if deal_state.active_deal_id:
        active_result = await db.execute(
            select(Deal).where(Deal.id == deal_state.active_deal_id)
        )
        active_deal = active_result.scalar_one_or_none()
    if not active_deal:
        recent_result = await db.execute(
            select(Deal)
            .where(Deal.session_id == deal_state.session_id)
            .order_by(Deal.created_at.desc())
        )
        active_deal = recent_result.scalars().first()

    vehicle = None
    if active_deal and active_deal.vehicle_id:
        vehicle_result = await db.execute(
            select(Vehicle).where(Vehicle.id == active_deal.vehicle_id)
        )
        vehicle = vehicle_result.scalar_one_or_none()

    return DealSummary(
        phase=DealPhase(active_deal.phase)
        if active_deal and active_deal.phase
        else None,
        vehicle_year=vehicle.year if vehicle else None,
        vehicle_make=vehicle.make if vehicle else None,
        vehicle_model=vehicle.model if vehicle else None,
        vehicle_trim=vehicle.trim if vehicle else None,
        current_offer=active_deal.current_offer if active_deal else None,
        listing_price=active_deal.listing_price if active_deal else None,
        score_overall=ScoreStatus(active_deal.score_overall)
        if active_deal and active_deal.score_overall
        else None,
        deal_count=deal_count,
    )


async def _session_to_response(
    session: ChatSession, db: AsyncSession
) -> SessionResponse:
    """Convert a ChatSession ORM instance to a SessionResponse with deal summary."""
    return SessionResponse(
        id=session.id,
        title=session.title,
        session_type=SessionType(session.session_type),
        linked_session_ids=session.linked_session_ids or [],
        last_message_preview=session.last_message_preview,
        usage=session_usage_payload(session.usage),
        deal_summary=await _build_deal_summary(session.deal_state, db),
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


@router.get("", response_model=list[SessionResponse])
async def list_sessions(
    q: str | None = Query(
        default=None, description="Search sessions by title or message content"
    ),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = (
        select(ChatSession)
        .options(selectinload(ChatSession.deal_state))
        .where(ChatSession.user_id == user.id)
    )

    if q:
        # Escape SQL LIKE wildcards so literal '%' and '_' in user input
        # don't act as pattern characters.
        escaped = q.replace("%", r"\%").replace("_", r"\_")
        search_term = f"%{escaped}%"
        matching_session_ids = (
            select(Message.session_id)
            .where(Message.content.ilike(search_term))
            .distinct()
            .scalar_subquery()
        )
        query = query.filter(
            or_(
                ChatSession.title.ilike(search_term),
                ChatSession.id.in_(matching_session_ids),
            )
        )

    result = await db.execute(query.order_by(ChatSession.updated_at.desc()))
    sessions = list(result.scalars().all())
    return [await _session_to_response(session, db) for session in sessions]


@router.post("", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(
    body: SessionCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    allowed_role = _SESSION_TYPE_ROLE.get(SessionType(body.session_type))
    if allowed_role and user.role != allowed_role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Your role ({user.role}) cannot create {body.session_type} sessions",
        )

    session = ChatSession(
        user_id=user.id,
        title=body.title
        or (
            DEFAULT_BUYER_TITLE
            if body.session_type == SessionType.BUYER_CHAT
            else DEFAULT_DEALER_TITLE
        ),
        auto_title=body.title is None,
        session_type=body.session_type,
    )
    db.add(session)
    await db.flush()

    # Create deal state for this session with optional buyer context
    deal_state = DealState(
        session_id=session.id,
        **({"buyer_context": body.buyer_context} if body.buyer_context else {}),
    )
    db.add(deal_state)
    await db.commit()

    # Reload with eager relationship — async sessions cannot lazy-load
    result = await db.execute(
        select(ChatSession)
        .options(selectinload(ChatSession.deal_state))
        .where(ChatSession.id == session.id)
    )
    session = result.scalar_one()
    logger.info(
        "Session created: session_id=%s, user_id=%s, type=%s",
        session.id,
        user.id,
        body.session_type,
    )
    return await _session_to_response(session, db)


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ChatSession)
        .options(selectinload(ChatSession.deal_state))
        .where(ChatSession.id == session_id, ChatSession.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return await _session_to_response(session, db)


@router.patch("/{session_id}", response_model=SessionResponse)
async def update_session(
    session_id: str,
    body: SessionUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ChatSession)
        .options(selectinload(ChatSession.deal_state))
        .where(ChatSession.id == session_id, ChatSession.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if body.title is not None:
        session.title = body.title
        session.auto_title = False
    if body.linked_session_ids is not None:
        # Verify all linked sessions belong to the current user to prevent
        # reading another user's chat history via the linked-context feature.
        if body.linked_session_ids:
            unique_ids = set(body.linked_session_ids)
            count_result = await db.execute(
                select(func.count())
                .select_from(ChatSession)
                .where(
                    ChatSession.id.in_(unique_ids),
                    ChatSession.user_id == user.id,
                )
            )
            owned_count = count_result.scalar_one()
            if owned_count != len(unique_ids):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot link to sessions you do not own",
                )
        session.linked_session_ids = body.linked_session_ids

    await db.commit()
    # Reload with eager relationship — refresh alone doesn't reload relationships
    result = await db.execute(
        select(ChatSession)
        .options(selectinload(ChatSession.deal_state))
        .where(ChatSession.id == session.id)
    )
    session = result.scalar_one()
    return await _session_to_response(session, db)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == user.id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    try:
        # Null out active_deal_id before cascade delete — the FK from
        # deal_states → deals has no DB-level ON DELETE SET NULL, so
        # SQLAlchemy would try to delete deals while the reference exists.
        deal_state_result = await db.execute(
            select(DealState).where(DealState.session_id == session_id)
        )
        deal_state = deal_state_result.scalar_one_or_none()
        if deal_state and deal_state.active_deal_id:
            deal_state.active_deal_id = None
            await db.flush()
        await db.delete(session)
        await db.commit()
    except Exception:
        await db.rollback()
        logger.exception(
            "Failed to delete session: session_id=%s, user_id=%s",
            session_id,
            user.id,
        )
        raise HTTPException(status_code=500, detail="Failed to delete session")
    logger.info(
        "Session deleted with cascade: session_id=%s, user_id=%s", session_id, user.id
    )
