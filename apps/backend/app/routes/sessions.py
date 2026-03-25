import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.core.deps import get_current_user, get_db
from app.models.deal_state import DealState
from app.models.enums import DealPhase, ScoreStatus, SessionType, UserRole
from app.models.message import Message
from app.models.session import ChatSession
from app.models.user import User
from app.schemas.session import (
    DealSummary,
    SessionCreate,
    SessionResponse,
    SessionUpdate,
)
from app.services.post_chat_processing import DEFAULT_BUYER_TITLE, DEFAULT_DEALER_TITLE

# Maps session types to the role allowed to create them
_SESSION_TYPE_ROLE = {
    SessionType.BUYER_CHAT: UserRole.BUYER,
    SessionType.DEALER_SIM: UserRole.DEALER,
}

logger = logging.getLogger(__name__)

router = APIRouter()


def _build_deal_summary(deal_state: DealState | None) -> DealSummary | None:
    """Build a lightweight deal summary from a DealState, or None if absent."""
    if deal_state is None:
        return None
    return DealSummary(
        phase=DealPhase(deal_state.phase) if deal_state.phase else None,
        vehicle_year=deal_state.vehicle_year,
        vehicle_make=deal_state.vehicle_make,
        vehicle_model=deal_state.vehicle_model,
        vehicle_trim=deal_state.vehicle_trim,
        current_offer=deal_state.current_offer,
        listing_price=deal_state.listing_price,
        score_overall=ScoreStatus(deal_state.score_overall)
        if deal_state.score_overall
        else None,
    )


def _session_to_response(session: ChatSession) -> SessionResponse:
    """Convert a ChatSession ORM instance to a SessionResponse with deal summary."""
    return SessionResponse(
        id=session.id,
        title=session.title,
        session_type=SessionType(session.session_type),
        linked_session_ids=session.linked_session_ids or [],
        last_message_preview=session.last_message_preview,
        deal_summary=_build_deal_summary(session.deal_state),
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


@router.get("", response_model=list[SessionResponse])
def list_sessions(
    q: str | None = Query(
        default=None, description="Search sessions by title or message content"
    ),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = (
        db.query(ChatSession)
        .options(joinedload(ChatSession.deal_state))
        .filter(ChatSession.user_id == user.id)
    )

    if q:
        # Escape SQL LIKE wildcards so literal '%' and '_' in user input
        # don't act as pattern characters.
        escaped = q.replace("%", r"\%").replace("_", r"\_")
        search_term = f"%{escaped}%"
        matching_session_ids = (
            db.query(Message.session_id)
            .filter(Message.content.ilike(search_term))
            .distinct()
            .scalar_subquery()
        )
        query = query.filter(
            or_(
                ChatSession.title.ilike(search_term),
                ChatSession.id.in_(matching_session_ids),
            )
        )

    sessions = query.order_by(ChatSession.updated_at.desc()).all()
    return [_session_to_response(s) for s in sessions]


@router.post("", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
def create_session(
    body: SessionCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
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
    db.flush()

    # Create deal state for this session with optional buyer context
    deal_state = DealState(
        session_id=session.id,
        **({"buyer_context": body.buyer_context} if body.buyer_context else {}),
    )
    db.add(deal_state)
    db.commit()
    db.refresh(session)
    logger.info(
        "Session created: session_id=%s, user_id=%s, type=%s",
        session.id,
        user.id,
        body.session_type,
    )
    return _session_to_response(session)


@router.get("/{session_id}", response_model=SessionResponse)
def get_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = (
        db.query(ChatSession)
        .options(joinedload(ChatSession.deal_state))
        .filter(ChatSession.id == session_id, ChatSession.user_id == user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return _session_to_response(session)


@router.patch("/{session_id}", response_model=SessionResponse)
def update_session(
    session_id: str,
    body: SessionUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = (
        db.query(ChatSession)
        .options(joinedload(ChatSession.deal_state))
        .filter(ChatSession.id == session_id, ChatSession.user_id == user.id)
        .first()
    )
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
            owned_count = (
                db.query(ChatSession)
                .filter(
                    ChatSession.id.in_(unique_ids),
                    ChatSession.user_id == user.id,
                )
                .count()
            )
            if owned_count != len(unique_ids):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot link to sessions you do not own",
                )
        session.linked_session_ids = body.linked_session_ids

    db.commit()
    db.refresh(session)
    return _session_to_response(session)


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    session_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    try:
        db.delete(session)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception(
            "Failed to delete session: session_id=%s, user_id=%s",
            session_id,
            user.id,
        )
        raise HTTPException(status_code=500, detail="Failed to delete session")
    logger.info(
        "Session deleted with cascade: session_id=%s, user_id=%s", session_id, user.id
    )
