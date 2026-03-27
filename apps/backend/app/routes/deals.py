import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.models.deal_state import DealState
from app.models.enums import HealthStatus
from app.models.session import ChatSession
from app.models.user import User
from app.routes.chat import _deal_state_to_dict
from app.schemas.deal import (
    DealCorrectionRequest,
    DealCorrectionResponse,
    DealStateResponse,
)
from app.services.claude import assess_deal_state

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_deal_state_or_404(
    session_id: str, user: User, db: Session
) -> tuple[ChatSession, DealState]:
    """Verify session ownership and return deal state."""
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

    return session, deal_state


@router.get("/{session_id}", response_model=DealStateResponse)
def get_deal_state(
    session_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _, deal_state = _get_deal_state_or_404(session_id, user, db)
    return deal_state


# Fields that can be corrected via PATCH
CORRECTABLE_NUMBER_FIELDS = {
    "msrp",
    "invoice_price",
    "listing_price",
    "your_target",
    "walk_away_price",
    "current_offer",
    "monthly_payment",
    "apr",
    "loan_term_months",
    "down_payment",
    "trade_in_value",
}

CORRECTABLE_VEHICLE_FIELDS = {
    "vehicle_year",
    "vehicle_make",
    "vehicle_model",
    "vehicle_trim",
    "vehicle_vin",
    "vehicle_mileage",
    "vehicle_color",
}


@router.patch("/{session_id}", response_model=DealCorrectionResponse)
async def correct_deal_state(
    session_id: str,
    body: DealCorrectionRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Apply user-initiated corrections and return updated assessment."""
    _, deal_state = _get_deal_state_or_404(session_id, user, db)

    # Apply corrections
    corrections = body.model_dump(exclude_unset=True)
    if not corrections:
        raise HTTPException(status_code=400, detail="No corrections provided")

    for field, value in corrections.items():
        if field in CORRECTABLE_NUMBER_FIELDS or field in CORRECTABLE_VEHICLE_FIELDS:
            setattr(deal_state, field, value)

    # Snapshot first_offer if current_offer is being set for the first time
    if (
        "current_offer" in corrections
        and deal_state.first_offer is None
        and deal_state.current_offer is not None
    ):
        deal_state.first_offer = deal_state.current_offer

    db.commit()

    logger.info(
        "Deal state corrected: session_id=%s, fields=%s",
        session_id,
        list(corrections.keys()),
    )

    # Re-assess via Haiku
    deal_state_dict = _deal_state_to_dict(deal_state)
    assessment = await assess_deal_state(deal_state_dict)

    # Apply assessment to deal state
    health = assessment.get("health")
    flags = assessment.get("flags")

    if health:
        raw_status = health.get("status")
        try:
            validated_status = HealthStatus(raw_status) if raw_status else None
            deal_state.health_status = validated_status
            deal_state.health_summary = health.get("summary")
            if "recommendation" in health:
                deal_state.recommendation = health["recommendation"]
        except ValueError:
            logger.warning("Invalid health_status from assessment: %s", raw_status)
    if flags is not None:
        deal_state.red_flags = flags

    db.commit()

    return DealCorrectionResponse(
        health_status=deal_state.health_status,
        health_summary=deal_state.health_summary,
        recommendation=deal_state.recommendation,
        red_flags=deal_state.red_flags or [],
    )
