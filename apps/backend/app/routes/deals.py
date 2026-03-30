import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.models.deal import Deal
from app.models.deal_state import DealState
from app.models.enums import HealthStatus
from app.models.session import ChatSession
from app.models.user import User
from app.models.vehicle import Vehicle
from app.schemas.deal import (
    DealCorrectionRequest,
    DealCorrectionResponse,
    DealResponse,
    DealStateResponse,
    VehicleResponse,
)
from app.services.claude import analyze_deal
from app.services.deal_state import (
    DEAL_NUMBER_FIELDS,
    VEHICLE_FIELDS,
    build_deal_assessment_dict,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Fields that can be corrected via the PATCH endpoint
VEHICLE_CORRECTION_FIELDS = set(VEHICLE_FIELDS)
DEAL_CORRECTION_FIELDS = set(DEAL_NUMBER_FIELDS) | {"dealer_name"}


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
    vehicles = db.query(Vehicle).filter(Vehicle.session_id == session_id).all()
    deals = db.query(Deal).filter(Deal.session_id == session_id).all()

    return DealStateResponse(
        session_id=deal_state.session_id,
        buyer_context=deal_state.buyer_context,
        active_deal_id=deal_state.active_deal_id,
        vehicles=[VehicleResponse.model_validate(v) for v in vehicles],
        deals=[DealResponse.model_validate(d) for d in deals],
        red_flags=deal_state.red_flags or [],
        information_gaps=deal_state.information_gaps or [],
        checklist=deal_state.checklist or [],
        timer_started_at=deal_state.timer_started_at,
        ai_panel_cards=deal_state.ai_panel_cards or [],
        deal_comparison=deal_state.deal_comparison,
        updated_at=deal_state.updated_at,
    )


@router.patch("/{session_id}", response_model=DealCorrectionResponse)
async def correct_deal_state(
    session_id: str,
    body: DealCorrectionRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Apply user-initiated corrections to vehicles and/or deals, then re-assess."""
    _get_deal_state_or_404(session_id, user, db)

    if not body.vehicle_corrections and not body.deal_corrections:
        raise HTTPException(status_code=400, detail="No corrections provided")

    corrected_deal_ids: set[str] = set()

    # Apply vehicle corrections
    if body.vehicle_corrections:
        for vehicle_correction in body.vehicle_corrections:
            vehicle = (
                db.query(Vehicle)
                .filter(
                    Vehicle.id == vehicle_correction.vehicle_id,
                    Vehicle.session_id == session_id,
                )
                .first()
            )
            if not vehicle:
                raise HTTPException(
                    status_code=404,
                    detail=f"Vehicle {vehicle_correction.vehicle_id} not found in this session",
                )

            fields = vehicle_correction.model_dump(
                exclude_unset=True, exclude={"vehicle_id"}
            )
            for field, value in fields.items():
                if field in VEHICLE_CORRECTION_FIELDS:
                    setattr(vehicle, field, value)

            logger.info(
                "Vehicle corrected: vehicle_id=%s, session_id=%s, fields=%s",
                vehicle_correction.vehicle_id,
                session_id,
                list(fields.keys()),
            )

            # Mark any deals linked to this vehicle for re-assessment
            linked_deals = (
                db.query(Deal)
                .filter(
                    Deal.vehicle_id == vehicle_correction.vehicle_id,
                    Deal.session_id == session_id,
                )
                .all()
            )
            for deal in linked_deals:
                corrected_deal_ids.add(deal.id)

    # Apply deal corrections
    if body.deal_corrections:
        for deal_correction in body.deal_corrections:
            corrected_deal = (
                db.query(Deal)
                .filter(
                    Deal.id == deal_correction.deal_id,
                    Deal.session_id == session_id,
                )
                .first()
            )
            if not corrected_deal:
                raise HTTPException(
                    status_code=404,
                    detail=f"Deal {deal_correction.deal_id} not found in this session",
                )

            fields = deal_correction.model_dump(exclude_unset=True, exclude={"deal_id"})
            for field, value in fields.items():
                if field in DEAL_CORRECTION_FIELDS:
                    setattr(corrected_deal, field, value)

            # Snapshot first_offer if current_offer is being set for the first time
            if (
                "current_offer" in fields
                and corrected_deal.first_offer is None
                and corrected_deal.current_offer is not None
            ):
                corrected_deal.first_offer = corrected_deal.current_offer

            corrected_deal_ids.add(deal_correction.deal_id)

            logger.info(
                "Deal corrected: deal_id=%s, session_id=%s, fields=%s",
                deal_correction.deal_id,
                session_id,
                list(fields.keys()),
            )

    try:
        db.commit()
    except Exception:
        logger.exception("Failed to save corrections: session_id=%s", session_id)
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to save corrections")

    # Re-assess the first corrected deal via Haiku
    first_deal_id: str | None = None
    assessment_deal: Deal | None = None

    if corrected_deal_ids:
        first_deal_id = next(iter(corrected_deal_ids))
        assessment_deal = db.query(Deal).filter(Deal.id == first_deal_id).first()

    if assessment_deal:
        deal_dict = build_deal_assessment_dict(assessment_deal, db)
        # Use analyst to re-assess health + flags after corrections
        try:
            analysis = await analyze_deal(
                deal_dict,
                [
                    {
                        "role": "user",
                        "content": "User corrected deal numbers via inline editing.",
                    }
                ],
                "The deal numbers were updated by the user.",
            )
        except Exception:
            logger.exception(
                "Re-assessment failed after correction: deal_id=%s, session_id=%s",
                assessment_deal.id,
                session_id,
            )
            analysis = {}

        health = analysis.get("health")
        flags_data = analysis.get("deal_red_flags")
        flags = (
            flags_data.get("flags", flags_data)
            if isinstance(flags_data, dict)
            else flags_data
        )

        if health:
            raw_status = health.get("status")
            try:
                validated_status = HealthStatus(raw_status) if raw_status else None
                assessment_deal.health_status = validated_status
                assessment_deal.health_summary = health.get("summary")
                if "recommendation" in health:
                    assessment_deal.recommendation = health["recommendation"]
            except ValueError:
                logger.warning("Invalid health_status from extraction: %s", raw_status)
        if flags is not None:
            assessment_deal.red_flags = flags

        try:
            db.commit()
        except Exception:
            logger.exception("Failed to save re-assessment: session_id=%s", session_id)
            db.rollback()
            raise HTTPException(status_code=500, detail="Failed to save re-assessment")

        return DealCorrectionResponse(
            deal_id=assessment_deal.id,
            health_status=assessment_deal.health_status,
            health_summary=assessment_deal.health_summary,
            recommendation=assessment_deal.recommendation,
            red_flags=assessment_deal.red_flags or [],
        )

    # No deals to assess (e.g., vehicle correction with no linked deals)
    return DealCorrectionResponse(
        deal_id="",
        health_status=None,
        health_summary=None,
        recommendation=None,
        red_flags=[],
    )
