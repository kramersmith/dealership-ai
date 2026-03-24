import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.models.deal_state import DealState
from app.models.enums import SessionType, UserRole
from app.models.session import ChatSession
from app.models.user import User
from app.schemas.session import SessionCreate, SessionResponse, SessionUpdate

# Maps session types to the role allowed to create them
_SESSION_TYPE_ROLE = {
    SessionType.BUYER_CHAT: UserRole.BUYER,
    SessionType.DEALER_SIM: UserRole.DEALER,
}

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("", response_model=list[SessionResponse])
def list_sessions(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    sessions = (
        db.query(ChatSession)
        .filter(ChatSession.user_id == user.id)
        .order_by(ChatSession.updated_at.desc())
        .all()
    )
    return sessions


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
            "New Deal"
            if body.session_type == SessionType.BUYER_CHAT
            else "New Simulation"
        ),
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
    return session


@router.get("/{session_id}", response_model=SessionResponse)
def get_session(
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
    return session


@router.patch("/{session_id}", response_model=SessionResponse)
def update_session(
    session_id: str,
    body: SessionUpdate,
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

    if body.title is not None:
        session.title = body.title
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
    return session


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
