import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db
from app.models.deal import Deal
from app.models.deal_state import DealState
from app.models.enums import (
    HealthStatus,
    IdentityConfirmationStatus,
    MessageRole,
    VehicleRole,
)
from app.models.message import Message
from app.models.session import ChatSession
from app.models.user import User
from app.models.vehicle import Vehicle
from app.schemas.deal import (
    DealCorrectionRequest,
    DealCorrectionResponse,
    DealResponse,
    DealStateResponse,
    VehicleIdentityConfirmationRequest,
    VehicleIntelligenceRequest,
    VehicleIntelligenceResponse,
    VehicleResponse,
    VehicleUpsertFromVinRequest,
)
from app.schemas.panel_cards import AiPanelCardResponse
from app.services.deal_analysis import analyze_deal
from app.services.deal_state import (
    DEAL_NUMBER_FIELDS,
    VEHICLE_FIELDS,
    build_deal_assessment_dict,
    deal_state_to_dict,
)
from app.services.panel import generate_ai_panel_cards
from app.services.panel_cards import sanitize_panel_cards
from app.services.post_chat_processing import _get_primary_vehicle
from app.services.title_generator import build_vehicle_title
from app.services.usage_tracking import SessionUsageSummary
from app.services.vehicle_intelligence import (
    ProviderConfigurationError,
    VehicleIntelligenceError,
    apply_confirmed_decode_to_vehicle,
    build_vehicle_intelligence_response,
    check_history,
    decode_vin,
    get_valuation,
    normalize_vin,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Fields that can be corrected via the PATCH endpoint
VEHICLE_CORRECTION_FIELDS = set(VEHICLE_FIELDS)
DEAL_CORRECTION_FIELDS = set(DEAL_NUMBER_FIELDS) | {"dealer_name"}


async def _get_vehicle_or_404(
    session_id: str, vehicle_id: str, db: AsyncSession
) -> Vehicle:
    result = await db.execute(
        select(Vehicle).where(
            Vehicle.id == vehicle_id, Vehicle.session_id == session_id
        )
    )
    vehicle = result.scalar_one_or_none()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found in this session")
    return vehicle


async def _serialize_vehicle(vehicle: Vehicle, db: AsyncSession) -> VehicleResponse:
    base = VehicleResponse.model_validate(vehicle)
    base.intelligence = await build_vehicle_intelligence_response(vehicle.id, db)
    return base


async def _get_deal_state_or_404(
    session_id: str, user: User, db: AsyncSession
) -> tuple[ChatSession, DealState]:
    """Verify session ownership and return deal state."""
    session_result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id, ChatSession.user_id == user.id
        )
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    deal_state_result = await db.execute(
        select(DealState).where(DealState.session_id == session_id)
    )
    deal_state = deal_state_result.scalar_one_or_none()
    if not deal_state:
        raise HTTPException(status_code=404, detail="Deal state not found")

    return session, deal_state


async def _get_deal_in_session(
    session_id: str, deal_id: str, db: AsyncSession
) -> Deal | None:
    result = await db.execute(
        select(Deal).where(Deal.id == deal_id, Deal.session_id == session_id)
    )
    return result.scalar_one_or_none()


async def _refresh_after_identity_resolution(
    session: ChatSession, deal_state: DealState, db: AsyncSession
) -> None:
    session_usage = SessionUsageSummary.from_dict(session.usage)
    updated_state = await deal_state_to_dict(deal_state, db)
    history_result = await db.execute(
        select(Message)
        .where(Message.session_id == session.id)
        .order_by(Message.created_at)
    )
    history = list(history_result.scalars().all())
    latest_assistant = next(
        (m for m in reversed(history) if m.role == MessageRole.ASSISTANT), None
    )
    if latest_assistant:
        messages = [{"role": m.role, "content": m.content} for m in history]
        try:
            deal_state.ai_panel_cards = await generate_ai_panel_cards(
                updated_state,
                latest_assistant.content,
                messages,
                usage_recorder=session_usage.add_request,
                session_id=session.id,
            )
        except Exception:
            logger.exception(
                "Panel card refresh failed after identity resolution: session_id=%s",
                session.id,
            )

    vehicle_dict = await _get_primary_vehicle(deal_state, db)
    if vehicle_dict:
        title = build_vehicle_title(vehicle_dict)
        if title:
            session.title = title
    session.usage = session_usage.to_dict()
    session.updated_at = datetime.now(timezone.utc)


@router.get("/{session_id}", response_model=DealStateResponse)
async def get_deal_state(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, deal_state = await _get_deal_state_or_404(session_id, user, db)
    vehicles_result = await db.execute(
        select(Vehicle).where(Vehicle.session_id == session_id)
    )
    vehicles = list(vehicles_result.scalars().all())
    deals_result = await db.execute(select(Deal).where(Deal.session_id == session_id))
    deals = list(deals_result.scalars().all())

    # Defensive: checklist may be stored as a JSON string instead of a list
    checklist = deal_state.checklist or []
    if isinstance(checklist, str):
        try:
            checklist = json.loads(checklist)
        except (ValueError, TypeError):
            logger.warning(
                "Checklist stored as unparseable string, resetting to empty: session_id=%s",
                session_id,
            )
            checklist = []

    return DealStateResponse(
        session_id=deal_state.session_id,
        buyer_context=deal_state.buyer_context,
        active_deal_id=deal_state.active_deal_id,
        vehicles=[await _serialize_vehicle(vehicle, db) for vehicle in vehicles],
        deals=[DealResponse.model_validate(d) for d in deals],
        red_flags=deal_state.red_flags or [],
        information_gaps=deal_state.information_gaps or [],
        checklist=checklist,
        timer_started_at=deal_state.timer_started_at,
        ai_panel_cards=[
            AiPanelCardResponse.model_validate(card)
            for card in sanitize_panel_cards(deal_state.ai_panel_cards)
        ],
        deal_comparison=deal_state.deal_comparison,
        negotiation_context=deal_state.negotiation_context,
        updated_at=deal_state.updated_at,
    )


@router.patch("/{session_id}", response_model=DealCorrectionResponse)
async def correct_deal_state(
    session_id: str,
    body: DealCorrectionRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Apply user-initiated corrections to vehicles and/or deals, then re-assess."""
    session, _deal_state = await _get_deal_state_or_404(session_id, user, db)

    if not body.vehicle_corrections and not body.deal_corrections:
        raise HTTPException(status_code=400, detail="No corrections provided")

    corrected_deal_ids: set[str] = set()

    # Apply vehicle corrections
    if body.vehicle_corrections:
        for vehicle_correction in body.vehicle_corrections:
            vehicle = await _get_vehicle_or_404(
                session_id, vehicle_correction.vehicle_id, db
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
            linked_result = await db.execute(
                select(Deal).where(
                    Deal.vehicle_id == vehicle_correction.vehicle_id,
                    Deal.session_id == session_id,
                )
            )
            linked_deals = list(linked_result.scalars().all())
            for deal in linked_deals:
                corrected_deal_ids.add(deal.id)

    # Apply deal corrections
    if body.deal_corrections:
        for deal_correction in body.deal_corrections:
            corrected_deal = await _get_deal_in_session(
                session_id, deal_correction.deal_id, db
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
        await db.commit()
    except Exception:
        logger.exception("Failed to save corrections: session_id=%s", session_id)
        await db.rollback()
        raise HTTPException(status_code=500, detail="Failed to save corrections")

    # Re-assess the first corrected deal via Sonnet
    first_deal_id: str | None = None
    assessment_deal: Deal | None = None

    if corrected_deal_ids:
        first_deal_id = next(iter(corrected_deal_ids))
        assessment_deal = await _get_deal_in_session(session_id, first_deal_id, db)

    if assessment_deal:
        session_usage = SessionUsageSummary.from_dict(session.usage)
        deal_dict = await build_deal_assessment_dict(assessment_deal, db)
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
                usage_recorder=session_usage.add_request,
                session_id=session.id,
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

        session.usage = session_usage.to_dict()

        try:
            await db.commit()
        except Exception:
            logger.exception("Failed to save re-assessment: session_id=%s", session_id)
            await db.rollback()
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


@router.get(
    "/{session_id}/vehicles/{vehicle_id}/intelligence",
    response_model=VehicleIntelligenceResponse,
)
async def get_vehicle_intelligence(
    session_id: str,
    vehicle_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_deal_state_or_404(session_id, user, db)
    await _get_vehicle_or_404(session_id, vehicle_id, db)
    return await build_vehicle_intelligence_response(vehicle_id, db)


@router.post("/{session_id}/vehicles/upsert-from-vin", response_model=VehicleResponse)
async def upsert_vehicle_from_vin(
    session_id: str,
    body: VehicleUpsertFromVinRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session, deal_state = await _get_deal_state_or_404(session_id, user, db)
    try:
        normalized_vin = normalize_vin(body.vin)
    except VehicleIntelligenceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if deal_state.active_deal_id:
        active_deal = await _get_deal_in_session(
            session_id, deal_state.active_deal_id, db
        )
        if active_deal:
            active_vehicle = await _get_vehicle_or_404(
                session_id, active_deal.vehicle_id, db
            )
            if active_vehicle.vin == normalized_vin:
                return await _serialize_vehicle(active_vehicle, db)

    existing_vehicle_result = await db.execute(
        select(Vehicle)
        .where(
            Vehicle.session_id == session_id,
            Vehicle.role == VehicleRole.PRIMARY,
            Vehicle.vin == normalized_vin,
        )
        .order_by(Vehicle.created_at.desc())
    )
    existing_vehicle = existing_vehicle_result.scalars().first()
    if existing_vehicle:
        existing_deal_result = await db.execute(
            select(Deal)
            .where(
                Deal.session_id == session_id, Deal.vehicle_id == existing_vehicle.id
            )
            .order_by(Deal.created_at.desc())
        )
        existing_deal = existing_deal_result.scalars().first()
        if existing_deal:
            deal_state.active_deal_id = existing_deal.id
        session.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(existing_vehicle)
        return await _serialize_vehicle(existing_vehicle, db)

    vehicle = Vehicle(
        session_id=session_id, role=VehicleRole.PRIMARY, vin=normalized_vin
    )
    db.add(vehicle)
    await db.flush()

    deal = Deal(session_id=session_id, vehicle_id=vehicle.id)
    db.add(deal)
    await db.flush()
    deal_state.active_deal_id = deal.id

    session.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(vehicle)
    return await _serialize_vehicle(vehicle, db)


async def _run_intelligence_action(
    action_fn,
    vehicle: Vehicle,
    db: AsyncSession,
    session_id: str,
    vehicle_id: str,
    action_name: str,
    failure_detail: str,
    vin: str | None = None,
) -> VehicleIntelligenceResponse:
    """Shared try/except/rollback wrapper for vehicle intelligence route handlers."""
    logger.info(
        "vehicle_intelligence.%s.started session_id=%s vehicle_id=%s",
        action_name,
        session_id,
        vehicle_id,
    )
    try:
        await action_fn(vehicle, db, vin=vin)
        await db.commit()
    except ProviderConfigurationError as exc:
        await db.rollback()
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except VehicleIntelligenceError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        await db.rollback()
        logger.exception(
            "vehicle_intelligence.%s.failed session_id=%s vehicle_id=%s",
            action_name,
            session_id,
            vehicle_id,
        )
        raise HTTPException(status_code=502, detail=failure_detail)

    await db.refresh(vehicle)
    return await build_vehicle_intelligence_response(vehicle_id, db)


@router.post(
    "/{session_id}/vehicles/{vehicle_id}/decode-vin",
    response_model=VehicleIntelligenceResponse,
)
async def decode_vehicle_vin(
    session_id: str,
    vehicle_id: str,
    body: VehicleIntelligenceRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_deal_state_or_404(session_id, user, db)
    vehicle = await _get_vehicle_or_404(session_id, vehicle_id, db)
    return await _run_intelligence_action(
        decode_vin,
        vehicle,
        db,
        session_id,
        vehicle_id,
        action_name="decode",
        failure_detail="VIN decode failed",
        vin=body.vin,
    )


@router.post(
    "/{session_id}/vehicles/{vehicle_id}/confirm-identity",
    response_model=VehicleResponse,
)
async def confirm_vehicle_identity(
    session_id: str,
    vehicle_id: str,
    body: VehicleIdentityConfirmationRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session, deal_state = await _get_deal_state_or_404(session_id, user, db)
    vehicle = await _get_vehicle_or_404(session_id, vehicle_id, db)

    try:
        if body.status == IdentityConfirmationStatus.CONFIRMED:
            vehicle.identity_confirmation_status = IdentityConfirmationStatus.CONFIRMED
            vehicle.identity_confirmed_at = datetime.now(timezone.utc)
            vehicle.identity_confirmation_source = "user_confirmed_decode"
            await apply_confirmed_decode_to_vehicle(vehicle, db)
        else:
            vehicle.identity_confirmation_status = IdentityConfirmationStatus.REJECTED
            vehicle.identity_confirmed_at = None
            vehicle.identity_confirmation_source = None

        await _refresh_after_identity_resolution(session, deal_state, db)
        await db.commit()
    except Exception:
        await db.rollback()
        logger.exception(
            "vehicle_intelligence.confirm_identity.failed session_id=%s vehicle_id=%s",
            session_id,
            vehicle_id,
        )
        raise HTTPException(
            status_code=500,
            detail="Failed to confirm vehicle identity",
        ) from None

    await db.refresh(vehicle)
    return await _serialize_vehicle(vehicle, db)


@router.post(
    "/{session_id}/vehicles/{vehicle_id}/check-history",
    response_model=VehicleIntelligenceResponse,
)
async def check_vehicle_history(
    session_id: str,
    vehicle_id: str,
    body: VehicleIntelligenceRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_deal_state_or_404(session_id, user, db)
    vehicle = await _get_vehicle_or_404(session_id, vehicle_id, db)
    return await _run_intelligence_action(
        check_history,
        vehicle,
        db,
        session_id,
        vehicle_id,
        action_name="history",
        failure_detail="Vehicle history lookup failed",
        vin=body.vin,
    )


@router.post(
    "/{session_id}/vehicles/{vehicle_id}/get-valuation",
    response_model=VehicleIntelligenceResponse,
)
async def get_vehicle_valuation(
    session_id: str,
    vehicle_id: str,
    body: VehicleIntelligenceRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_deal_state_or_404(session_id, user, db)
    vehicle = await _get_vehicle_or_404(session_id, vehicle_id, db)
    return await _run_intelligence_action(
        get_valuation,
        vehicle,
        db,
        session_id,
        vehicle_id,
        action_name="valuation",
        failure_detail="Vehicle valuation lookup failed",
        vin=body.vin,
    )
