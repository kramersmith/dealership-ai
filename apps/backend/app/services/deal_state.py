import json
import logging

from sqlalchemy.orm import Session

from app.models.deal import Deal
from app.models.deal_state import DealState
from app.models.enums import (
    BuyerContext,
    DealPhase,
    HealthStatus,
    IdentityConfirmationStatus,
    VehicleRole,
)
from app.models.vehicle import Vehicle
from app.services.vehicle_intelligence import build_vehicle_intelligence_response

logger = logging.getLogger(__name__)

# ─── Shared field lists used across extraction, serialization, and corrections ───

VEHICLE_FIELDS = ("year", "make", "model", "trim", "vin", "mileage", "color", "engine")

DEAL_NUMBER_FIELDS = (
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
)


def _is_vehicle_identity_confirmed(vehicle: Vehicle) -> bool:
    return vehicle.identity_confirmation_status == IdentityConfirmationStatus.CONFIRMED


def _compact_raw_payload(payload: dict | None) -> dict | None:
    """Strip empty/irrelevant fields from raw NHTSA payload to reduce LLM token usage."""
    if not payload:
        return None
    return {
        key: value
        for key, value in payload.items()
        if value not in (None, "", "Not Applicable", "0", "0.0")
        and not key.endswith("ID")  # MakeID, ModelID, ManufacturerId, etc.
        and key
        not in ("ErrorCode", "ErrorText", "AdditionalErrorText", "VehicleDescriptor")
    }


def _build_prompt_vehicle_dict(vehicle: Vehicle, db: Session) -> dict:
    intelligence = build_vehicle_intelligence_response(vehicle.id, db).model_dump(
        mode="json"
    )
    if not _is_vehicle_identity_confirmed(vehicle):
        intelligence["decode"] = None
    elif intelligence.get("decode") and intelligence["decode"].get("raw_payload"):
        intelligence["decode"]["raw_payload"] = _compact_raw_payload(
            intelligence["decode"]["raw_payload"]
        )

    return {
        "id": vehicle.id,
        "role": vehicle.role,
        "year": vehicle.year if _is_vehicle_identity_confirmed(vehicle) else None,
        "make": vehicle.make if _is_vehicle_identity_confirmed(vehicle) else None,
        "model": vehicle.model if _is_vehicle_identity_confirmed(vehicle) else None,
        "trim": vehicle.trim if _is_vehicle_identity_confirmed(vehicle) else None,
        "vin": vehicle.vin,
        "mileage": vehicle.mileage,
        "color": vehicle.color,
        "engine": vehicle.engine if _is_vehicle_identity_confirmed(vehicle) else None,
        "identity_confirmation_status": vehicle.identity_confirmation_status,
        "identity_confirmed_at": vehicle.identity_confirmed_at.isoformat()
        if vehicle.identity_confirmed_at
        else None,
        "identity_confirmation_source": vehicle.identity_confirmation_source,
        "intelligence": intelligence,
    }


def _build_assessment_vehicle_dict(vehicle: Vehicle, db: Session) -> dict:
    """Build a compact vehicle dict for deal assessment, gating identity fields."""
    confirmed = _is_vehicle_identity_confirmed(vehicle)
    result = {
        field: getattr(vehicle, field) if field == "mileage" or confirmed else None
        for field in ("year", "make", "model", "trim", "mileage")
    }
    intelligence = build_vehicle_intelligence_response(vehicle.id, db).model_dump(
        mode="json"
    )
    if not confirmed:
        intelligence["decode"] = None
    result["intelligence"] = intelligence
    result["identity_confirmation_status"] = vehicle.identity_confirmation_status
    return result


def get_active_deal(deal_state: DealState, db: Session) -> Deal | None:
    """Get the active deal for the current deal state."""
    if not deal_state.active_deal_id:
        return None
    return db.query(Deal).filter(Deal.id == deal_state.active_deal_id).first()


# Maps tool names from CHAT_TOOLS to the extraction keys that apply_extraction() expects.
_TOOL_TO_EXTRACTION_KEY: dict[str, str] = {
    "set_vehicle": "vehicle",
    "create_deal": "deal",
    "update_deal_numbers": "numbers",
    "update_scorecard": "scorecard",
    "update_deal_health": "health",
    "update_deal_red_flags": "deal_red_flags",
    "update_session_red_flags": "session_red_flags",
    "update_deal_information_gaps": "deal_information_gaps",
    "update_session_information_gaps": "session_information_gaps",
    "update_deal_comparison": "deal_comparison",
    "update_checklist": "checklist",
    "update_quick_actions": "quick_actions",
}

# Tools where the tool_input value itself is the extraction value (not a sub-dict)
_SCALAR_TOOLS: dict[str, str] = {
    "update_deal_phase": "phase",
    "update_buyer_context": "buyer_context",
    "switch_active_deal": "switch_active_deal_id",
    "remove_vehicle": "remove_vehicle_id",
}


def execute_tool(
    tool_name: str,
    tool_input: dict,
    deal_state: DealState,
    db: Session,
) -> list[dict]:
    """Execute a single chat tool call by routing to apply_extraction().

    Returns the list of applied tool calls (for SSE emission and persistence).
    Handles update_negotiation_context directly since it's not in apply_extraction.
    """
    # Negotiation context is applied directly to deal_state, not through extraction
    if tool_name == "update_negotiation_context":
        deal_state.negotiation_context = tool_input
        return [{"name": "update_negotiation_context", "args": tool_input}]

    # Scalar tools: extract a single value from tool_input
    if tool_name in _SCALAR_TOOLS:
        extraction_key = _SCALAR_TOOLS[tool_name]
        if tool_name == "switch_active_deal":
            value = tool_input["deal_id"]
        elif tool_name == "remove_vehicle":
            value = tool_input["vehicle_id"]
        elif tool_name == "update_deal_phase":
            value = tool_input["phase"]
        elif tool_name == "update_buyer_context":
            value = tool_input["buyer_context"]
        else:
            value = tool_input
        return apply_extraction(deal_state, {extraction_key: value}, db)

    # Standard tools: tool_input is the extraction sub-dict
    std_key = _TOOL_TO_EXTRACTION_KEY.get(tool_name)
    if std_key:
        return apply_extraction(deal_state, {std_key: tool_input}, db)

    logger.warning("execute_tool: unknown tool %s", tool_name)
    return []


def apply_extraction(
    deal_state: DealState, extraction: dict, db: Session
) -> list[dict]:
    """Apply extracted deal data to the database. Returns tool calls for frontend."""
    applied_tools = []

    # Vehicle
    if "vehicle" in extraction:
        vehicle_data = extraction["vehicle"]
        vehicle_id = vehicle_data.get("vehicle_id")
        role = vehicle_data.get("role", VehicleRole.PRIMARY)

        if vehicle_id:
            # Update existing — scope to session to prevent cross-session writes
            vehicle = (
                db.query(Vehicle)
                .filter(
                    Vehicle.id == vehicle_id,
                    Vehicle.session_id == deal_state.session_id,
                )
                .first()
            )
            if vehicle:
                for field in VEHICLE_FIELDS:
                    if field in vehicle_data:
                        setattr(vehicle, field, vehicle_data[field])
                logger.debug(
                    "Updated vehicle %s: fields=%s",
                    vehicle_id,
                    [f for f in vehicle_data if f not in ("vehicle_id", "role")],
                )
            else:
                logger.warning(
                    "set_vehicle: vehicle %s not found for update", vehicle_id
                )
                vehicle_id = None  # Signal that the update failed
        else:
            # Handle trade_in replacement
            if role == VehicleRole.TRADE_IN:
                existing = (
                    db.query(Vehicle)
                    .filter(
                        Vehicle.session_id == deal_state.session_id,
                        Vehicle.role == VehicleRole.TRADE_IN,
                    )
                    .first()
                )
                if existing:
                    logger.debug("Replacing existing trade-in vehicle %s", existing.id)
                    db.delete(existing)
                    db.flush()

            # Create new
            vehicle = Vehicle(session_id=deal_state.session_id, role=role)
            for field in VEHICLE_FIELDS:
                if field in vehicle_data:
                    setattr(vehicle, field, vehicle_data[field])
            db.add(vehicle)
            db.flush()
            vehicle_id = vehicle.id
            logger.debug("Created vehicle %s: role=%s", vehicle_id, role)

            # Auto-create deal for primary vehicle if no deals exist
            if role == VehicleRole.PRIMARY:
                existing_deals = (
                    db.query(Deal)
                    .filter(Deal.session_id == deal_state.session_id)
                    .count()
                )
                if existing_deals == 0:
                    auto_deal = Deal(
                        session_id=deal_state.session_id,
                        vehicle_id=vehicle.id,
                    )
                    db.add(auto_deal)
                    db.flush()
                    deal_state.active_deal_id = auto_deal.id
                    logger.debug(
                        "Auto-created deal %s for primary vehicle %s",
                        auto_deal.id,
                        vehicle.id,
                    )
                    # Emit create_deal so frontend receives the backend-generated ID
                    applied_tools.append(
                        {
                            "name": "create_deal",
                            "args": {
                                "deal_id": auto_deal.id,
                                "vehicle_id": vehicle.id,
                            },
                        }
                    )

        if vehicle_id is not None:
            applied_tools.append(
                {
                    "name": "set_vehicle",
                    "args": {**vehicle_data, "vehicle_id": vehicle_id},
                }
            )

    # Deal creation
    if "deal" in extraction:
        deal_data = extraction["deal"]
        deal_id = deal_data.get("deal_id")
        if deal_id:
            # Update existing deal — scope to session to prevent cross-session writes
            deal = (
                db.query(Deal)
                .filter(
                    Deal.id == deal_id,
                    Deal.session_id == deal_state.session_id,
                )
                .first()
            )
            if deal:
                if "dealer_name" in deal_data:
                    deal.dealer_name = deal_data["dealer_name"]
                if "phase" in deal_data:
                    # Snapshot pre_fi_price on financing entry
                    if (
                        deal_data["phase"] == DealPhase.FINANCING
                        and deal.pre_fi_price is None
                        and deal.current_offer is not None
                    ):
                        deal.pre_fi_price = deal.current_offer
                        logger.debug(
                            "Snapshot pre_fi_price=%s for deal %s",
                            deal.current_offer,
                            deal_id,
                        )
                    deal.phase = deal_data["phase"]
                logger.debug(
                    "Updated deal %s: fields=%s",
                    deal_id,
                    [k for k in deal_data if k != "deal_id"],
                )
            else:
                logger.warning("create_deal: deal %s not found for update", deal_id)
                deal_id = None  # Signal that the update failed
        else:
            vehicle_id_for_deal = deal_data.get("vehicle_id")
            if vehicle_id_for_deal:
                new_deal = Deal(
                    session_id=deal_state.session_id,
                    vehicle_id=vehicle_id_for_deal,
                    dealer_name=deal_data.get("dealer_name"),
                )
                if "phase" in deal_data:
                    new_deal.phase = deal_data["phase"]
                db.add(new_deal)
                db.flush()
                deal_state.active_deal_id = new_deal.id
                deal_id = new_deal.id
                logger.debug(
                    "Created deal %s for vehicle %s", deal_id, vehicle_id_for_deal
                )
            else:
                logger.warning("create_deal: no vehicle_id or deal_id provided")

        if deal_id is not None:
            applied_tools.append(
                {"name": "create_deal", "args": {**deal_data, "deal_id": deal_id}}
            )

    # Numbers — apply to specified deal or active deal
    if "numbers" in extraction:
        numbers_deal_id = extraction["numbers"].get("deal_id")
        if numbers_deal_id:
            deal = (
                db.query(Deal)
                .filter(
                    Deal.id == numbers_deal_id, Deal.session_id == deal_state.session_id
                )
                .first()
            )
        else:
            deal = get_active_deal(deal_state, db)
        if deal:
            numbers = extraction["numbers"]
            for field in DEAL_NUMBER_FIELDS:
                if field in numbers:
                    setattr(deal, field, numbers[field])
            # Snapshot first_offer
            if (
                "current_offer" in numbers
                and deal.first_offer is None
                and deal.current_offer is not None
            ):
                deal.first_offer = deal.current_offer
                logger.debug(
                    "Snapshot first_offer=%s for deal %s", deal.current_offer, deal.id
                )
            applied_tools.append({"name": "update_deal_numbers", "args": numbers})
            logger.debug(
                "Updated deal numbers: deal=%s, fields=%s",
                deal.id,
                list(numbers.keys()),
            )
        else:
            logger.warning("update_deal_numbers: no active deal found")

    # Scorecard
    if "scorecard" in extraction:
        scorecard_deal_id = extraction["scorecard"].get("deal_id")
        if scorecard_deal_id:
            deal = (
                db.query(Deal)
                .filter(
                    Deal.id == scorecard_deal_id,
                    Deal.session_id == deal_state.session_id,
                )
                .first()
            )
        else:
            deal = get_active_deal(deal_state, db)
        if deal:
            scorecard_data = extraction["scorecard"]
            # The analyst tool schema uses "score_price", "score_financing", etc.
            # Map both prefixed and unprefixed keys to the model attributes.
            for field in ("price", "financing", "trade_in", "fees", "overall"):
                prefixed = f"score_{field}"
                if prefixed in scorecard_data:
                    setattr(deal, prefixed, scorecard_data[prefixed])
                elif field in scorecard_data:
                    setattr(deal, f"score_{field}", scorecard_data[field])
            applied_tools.append({"name": "update_scorecard", "args": scorecard_data})
            logger.debug(
                "Updated scorecard: deal=%s, fields=%s",
                deal.id,
                list(scorecard_data.keys()),
            )
        else:
            logger.warning("update_scorecard: no active deal found")

    # Health
    if "health" in extraction:
        health_deal_id = extraction["health"].get("deal_id")
        if health_deal_id:
            deal = (
                db.query(Deal)
                .filter(
                    Deal.id == health_deal_id,
                    Deal.session_id == deal_state.session_id,
                )
                .first()
            )
        else:
            deal = get_active_deal(deal_state, db)
        if deal:
            health_data = extraction["health"]
            if "status" in health_data:
                try:
                    deal.health_status = HealthStatus(health_data["status"])
                except ValueError:
                    logger.warning(
                        "Invalid health_status from extraction: %s",
                        health_data["status"],
                    )
                else:
                    if "summary" in health_data:
                        deal.health_summary = health_data["summary"]
                    if "recommendation" in health_data:
                        deal.recommendation = health_data["recommendation"]
                    applied_tools.append(
                        {"name": "update_deal_health", "args": health_data}
                    )
                    logger.debug(
                        "Updated deal health: deal=%s, status=%s",
                        deal.id,
                        health_data["status"],
                    )
        else:
            logger.warning("update_deal_health: no active deal found")

    # Deal red flags
    if "deal_red_flags" in extraction:
        red_flags_deal_id = (
            extraction["deal_red_flags"].get("deal_id")
            if isinstance(extraction["deal_red_flags"], dict)
            else None
        )
        if red_flags_deal_id:
            deal = (
                db.query(Deal)
                .filter(
                    Deal.id == red_flags_deal_id,
                    Deal.session_id == deal_state.session_id,
                )
                .first()
            )
        else:
            deal = get_active_deal(deal_state, db)
        if deal:
            flags_data = extraction["deal_red_flags"]
            deal.red_flags = (
                flags_data.get("flags", flags_data)
                if isinstance(flags_data, dict)
                else flags_data
            )
            applied_tools.append(
                {
                    "name": "update_deal_red_flags",
                    "args": {"deal_id": deal.id, "flags": deal.red_flags},
                }
            )
            logger.debug(
                "Updated deal red flags: deal=%s, count=%d",
                deal.id,
                len(deal.red_flags),
            )
        else:
            logger.warning("update_deal_red_flags: no active deal found")

    # Session red flags
    if "session_red_flags" in extraction:
        flags_data = extraction["session_red_flags"]
        deal_state.red_flags = (
            flags_data.get("flags", flags_data)
            if isinstance(flags_data, dict)
            else flags_data
        )
        applied_tools.append(
            {
                "name": "update_session_red_flags",
                "args": {"flags": deal_state.red_flags},
            }
        )
        logger.debug("Updated session red flags: count=%d", len(deal_state.red_flags))

    # Deal information gaps
    if "deal_information_gaps" in extraction:
        gaps_deal_id = (
            extraction["deal_information_gaps"].get("deal_id")
            if isinstance(extraction["deal_information_gaps"], dict)
            else None
        )
        if gaps_deal_id:
            deal = (
                db.query(Deal)
                .filter(
                    Deal.id == gaps_deal_id,
                    Deal.session_id == deal_state.session_id,
                )
                .first()
            )
        else:
            deal = get_active_deal(deal_state, db)
        if deal:
            gaps_data = extraction["deal_information_gaps"]
            deal.information_gaps = (
                gaps_data.get("gaps", gaps_data)
                if isinstance(gaps_data, dict)
                else gaps_data
            )
            applied_tools.append(
                {
                    "name": "update_deal_information_gaps",
                    "args": {"deal_id": deal.id, "gaps": deal.information_gaps},
                }
            )
            logger.debug(
                "Updated deal information gaps: deal=%s, count=%d",
                deal.id,
                len(deal.information_gaps),
            )
        else:
            logger.warning("update_deal_information_gaps: no active deal found")

    # Session information gaps
    if "session_information_gaps" in extraction:
        gaps_data = extraction["session_information_gaps"]
        deal_state.information_gaps = (
            gaps_data.get("gaps", gaps_data)
            if isinstance(gaps_data, dict)
            else gaps_data
        )
        applied_tools.append(
            {
                "name": "update_session_information_gaps",
                "args": {"gaps": deal_state.information_gaps},
            }
        )
        logger.debug(
            "Updated session information gaps: count=%d",
            len(deal_state.information_gaps),
        )

    # Checklist
    if "checklist" in extraction:
        checklist_data = extraction["checklist"]
        if isinstance(checklist_data, str):
            try:
                checklist_data = json.loads(checklist_data)
            except (ValueError, TypeError):
                logger.warning(
                    "Checklist extraction contained unparseable string, resetting to empty"
                )
                checklist_data = []
        deal_state.checklist = (
            checklist_data.get("items", checklist_data)
            if isinstance(checklist_data, dict)
            else checklist_data
        )
        applied_tools.append(
            {"name": "update_checklist", "args": {"items": deal_state.checklist}}
        )
        logger.debug("Updated checklist: count=%d", len(deal_state.checklist))

    # Buyer context
    if "buyer_context" in extraction:
        try:
            deal_state.buyer_context = BuyerContext(extraction["buyer_context"])
            applied_tools.append(
                {
                    "name": "update_buyer_context",
                    "args": {"buyer_context": extraction["buyer_context"]},
                }
            )
            logger.debug("Updated buyer context: %s", extraction["buyer_context"])
        except ValueError:
            logger.warning(
                "Invalid buyer_context from extraction: %s", extraction["buyer_context"]
            )

    # Switch active deal — verify deal belongs to this session
    if "switch_active_deal_id" in extraction:
        target_deal_id = extraction["switch_active_deal_id"]
        target_deal = (
            db.query(Deal)
            .filter(
                Deal.id == target_deal_id,
                Deal.session_id == deal_state.session_id,
            )
            .first()
        )
        if target_deal:
            deal_state.active_deal_id = target_deal_id
            applied_tools.append(
                {
                    "name": "switch_active_deal",
                    "args": {"deal_id": target_deal_id},
                }
            )
            logger.debug("Switched active deal to %s", target_deal_id)
        else:
            logger.warning(
                "switch_active_deal: deal %s not found in session %s",
                target_deal_id,
                deal_state.session_id,
            )

    # Remove vehicle
    if "remove_vehicle_id" in extraction:
        removed_vehicle_id = extraction["remove_vehicle_id"]
        vehicle = (
            db.query(Vehicle)
            .filter(
                Vehicle.id == removed_vehicle_id,
                Vehicle.session_id == deal_state.session_id,
            )
            .first()
        )
        if vehicle:
            deals = (
                db.query(Deal)
                .filter(
                    Deal.vehicle_id == removed_vehicle_id,
                    Deal.session_id == deal_state.session_id,
                )
                .all()
            )
            deal_ids = {deal.id for deal in deals}
            if deal_state.active_deal_id in deal_ids:
                deal_state.active_deal_id = None
            for deal in deals:
                db.delete(deal)
            db.delete(vehicle)
            db.flush()
            applied_tools.append(
                {
                    "name": "remove_vehicle",
                    "args": {"vehicle_id": removed_vehicle_id},
                }
            )
            logger.debug(
                "Removed vehicle %s and %d associated deals",
                removed_vehicle_id,
                len(deals),
            )
        else:
            logger.warning("remove_vehicle: vehicle %s not found", removed_vehicle_id)

    # Phase (top-level, applies to active deal)
    if "phase" in extraction:
        deal = get_active_deal(deal_state, db)
        if deal:
            phase_val = extraction["phase"]
            # Snapshot pre_fi_price on financing entry
            if (
                phase_val == DealPhase.FINANCING
                and deal.pre_fi_price is None
                and deal.current_offer is not None
            ):
                deal.pre_fi_price = deal.current_offer
                logger.debug(
                    "Snapshot pre_fi_price=%s for deal %s",
                    deal.current_offer,
                    deal.id,
                )
            deal.phase = phase_val
            applied_tools.append(
                {"name": "update_deal_phase", "args": {"phase": phase_val}}
            )
            logger.debug("Updated deal phase: deal=%s, phase=%s", deal.id, phase_val)
        else:
            logger.warning("update_phase: no active deal found")

    # Quick actions — extraction["quick_actions"] is already {"actions": [...]}
    if "quick_actions" in extraction:
        qa_data = extraction["quick_actions"]
        applied_tools.append(
            {
                "name": "update_quick_actions",
                "args": qa_data,
            }
        )
        logger.debug(
            "Updated quick actions: count=%d",
            len(qa_data.get("actions", [])) if isinstance(qa_data, dict) else 0,
        )

    # Deal comparison (merge maps analyst "comparison" -> "deal_comparison")
    if "deal_comparison" in extraction:
        deal_state.deal_comparison = extraction["deal_comparison"]
        applied_tools.append(
            {"name": "update_deal_comparison", "args": extraction["deal_comparison"]}
        )
        logger.debug("Updated deal comparison")

    return applied_tools


def deal_state_to_dict(deal_state: DealState, db: Session) -> dict:
    """Convert deal state to dict for system prompt context."""
    vehicles = (
        db.query(Vehicle).filter(Vehicle.session_id == deal_state.session_id).all()
    )
    deals = db.query(Deal).filter(Deal.session_id == deal_state.session_id).all()

    return {
        "buyer_context": deal_state.buyer_context,
        "active_deal_id": deal_state.active_deal_id,
        "vehicles": [_build_prompt_vehicle_dict(v, db) for v in vehicles],
        "deals": [
            {
                "id": d.id,
                "vehicle_id": d.vehicle_id,
                "dealer_name": d.dealer_name,
                "phase": d.phase,
                "numbers": {field: getattr(d, field) for field in DEAL_NUMBER_FIELDS},
                "scorecard": {
                    "price": d.score_price,
                    "financing": d.score_financing,
                    "trade_in": d.score_trade_in,
                    "fees": d.score_fees,
                    "overall": d.score_overall,
                },
                "health": {
                    "status": d.health_status,
                    "summary": d.health_summary,
                    "recommendation": d.recommendation,
                },
                "red_flags": d.red_flags or [],
                "information_gaps": d.information_gaps or [],
            }
            for d in deals
        ],
        "session_red_flags": deal_state.red_flags or [],
        "session_information_gaps": deal_state.information_gaps or [],
        "checklist": deal_state.checklist or [],
        "ai_panel_cards": deal_state.ai_panel_cards or [],
        "negotiation_context": deal_state.negotiation_context,
    }


def build_deal_assessment_dict(deal: Deal, db: Session) -> dict:
    """Build a dict suitable for assess_deal_state from a Deal and its vehicles."""
    result: dict = {
        "deal_id": deal.id,
        "phase": deal.phase,
        "dealer_name": deal.dealer_name,
        **{field: getattr(deal, field) for field in DEAL_NUMBER_FIELDS},
        "first_offer": deal.first_offer,
        "pre_fi_price": deal.pre_fi_price,
        "score_price": deal.score_price,
        "score_financing": deal.score_financing,
        "score_trade_in": deal.score_trade_in,
        "score_fees": deal.score_fees,
        "score_overall": deal.score_overall,
    }

    # Include the primary vehicle info
    vehicle = db.query(Vehicle).filter(Vehicle.id == deal.vehicle_id).first()
    if vehicle:
        result["vehicle"] = _build_assessment_vehicle_dict(vehicle, db)

    # Include trade-in vehicle if one exists for this session
    trade_in = (
        db.query(Vehicle)
        .filter(
            Vehicle.session_id == deal.session_id,
            Vehicle.role == VehicleRole.TRADE_IN,
        )
        .first()
    )
    if trade_in:
        result["trade_in_vehicle"] = _build_assessment_vehicle_dict(trade_in, db)

    return result
