from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.models.deal_state import DealState
from app.models.session import ChatSession
from app.models.user import User
from app.schemas.deal import DealStateResponse

router = APIRouter()


@router.get("/{session_id}", response_model=DealStateResponse)
def get_deal_state(
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

    deal_state = db.query(DealState).filter(DealState.session_id == session_id).first()
    if not deal_state:
        raise HTTPException(status_code=404, detail="Deal state not found")

    return deal_state
