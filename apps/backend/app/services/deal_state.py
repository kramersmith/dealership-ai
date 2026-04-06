import json
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
from app.services.turn_context import TurnContext
from app.services.vehicle_intelligence import build_vehicle_intelligence_response

logger = logging.getLogger(__name__)

VEHICLE_FIELDS = (
    "year",
    "make",
    "model",
    "trim",
    "cab_style",
    "bed_length",
    "vin",
    "mileage",
    "color",
    "engine",
)

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


def _json_like_equal(current, new) -> bool:
    return json.dumps(current, sort_keys=True, default=str) == json.dumps(
        new, sort_keys=True, default=str
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
        and not key.endswith("ID")
        and key
        not in ("ErrorCode", "ErrorText", "AdditionalErrorText", "VehicleDescriptor")
    }


async def _build_prompt_vehicle_dict(vehicle: Vehicle, db: AsyncSession) -> dict:
    intelligence = (
        await build_vehicle_intelligence_response(vehicle.id, db)
    ).model_dump(mode="json")
    if not _is_vehicle_identity_confirmed(vehicle):
        intelligence["decode"] = None
    elif intelligence.get("decode") and intelligence["decode"].get("raw_payload"):
        intelligence["decode"]["raw_payload"] = _compact_raw_payload(
            intelligence["decode"]["raw_payload"]
        )

    return {
        "id": vehicle.id,
        "role": vehicle.role,
        "year": vehicle.year,
        "make": vehicle.make,
        "model": vehicle.model,
        "trim": vehicle.trim,
        "cab_style": vehicle.cab_style,
        "bed_length": vehicle.bed_length,
        "vin": vehicle.vin,
        "mileage": vehicle.mileage,
        "color": vehicle.color,
        "engine": vehicle.engine,
        "identity_confirmation_status": vehicle.identity_confirmation_status,
        "identity_confirmed_at": vehicle.identity_confirmed_at.isoformat()
        if vehicle.identity_confirmed_at
        else None,
        "identity_confirmation_source": vehicle.identity_confirmation_source,
        "intelligence": intelligence,
    }


async def _build_assessment_vehicle_dict(vehicle: Vehicle, db: AsyncSession) -> dict:
    """Build a compact vehicle dict for deal assessment, gating identity fields."""
    result = {
        field: getattr(vehicle, field)
        for field in (
            "year",
            "make",
            "model",
            "trim",
            "cab_style",
            "bed_length",
            "mileage",
        )
    }
    intelligence = (
        await build_vehicle_intelligence_response(vehicle.id, db)
    ).model_dump(mode="json")
    if not _is_vehicle_identity_confirmed(vehicle):
        intelligence["decode"] = None
    result["intelligence"] = intelligence
    result["identity_confirmation_status"] = vehicle.identity_confirmation_status
    return result


async def get_active_deal(deal_state: DealState, db: AsyncSession) -> Deal | None:
    """Get the active deal for the current deal state."""
    if not deal_state.active_deal_id:
        return None
    result = await db.execute(select(Deal).where(Deal.id == deal_state.active_deal_id))
    return result.scalar_one_or_none()


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

_SCALAR_TOOLS: dict[str, str] = {
    "update_deal_phase": "phase",
    "update_buyer_context": "buyer_context",
    "switch_active_deal": "switch_active_deal_id",
    "remove_vehicle": "remove_vehicle_id",
}

TOOL_PRIORITY: dict[str, int] = {
    "set_vehicle": 0,
    "remove_vehicle": 0,
    "create_deal": 1,
    "switch_active_deal": 1,
}
DEFAULT_TOOL_PRIORITY = 2


def build_execution_plan(tool_blocks: list[dict]) -> list[list[dict]]:
    """Group tool calls into ordered batches by priority."""
    buckets: dict[int, list[dict]] = {}
    for block in tool_blocks:
        priority = TOOL_PRIORITY.get(block["name"], DEFAULT_TOOL_PRIORITY)
        buckets.setdefault(priority, []).append(block)
    return [buckets[priority] for priority in sorted(buckets)]


async def execute_tool(
    tool_name: str,
    tool_input: dict,
    context: TurnContext,
) -> list[dict]:
    """Execute a single chat tool call by routing to apply_extraction()."""
    if context.deal_state is None:
        logger.warning(
            "execute_tool: called without deal_state context for %s", tool_name
        )
        return []

    deal_state = context.deal_state
    db = context.db

    if tool_name == "update_negotiation_context":
        if _json_like_equal(deal_state.negotiation_context, tool_input):
            logger.debug("Skipped negotiation context update: no changes")
            return []
        deal_state.negotiation_context = tool_input
        return [{"name": "update_negotiation_context", "args": tool_input}]

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
        return await apply_extraction(deal_state, {extraction_key: value}, db)

    std_key = _TOOL_TO_EXTRACTION_KEY.get(tool_name)
    if std_key:
        return await apply_extraction(deal_state, {std_key: tool_input}, db)

    logger.warning("execute_tool: unknown tool %s", tool_name)
    return []


async def _get_session_vehicle(
    db: AsyncSession, session_id: str, vehicle_id: str
) -> Vehicle | None:
    result = await db.execute(
        select(Vehicle).where(
            Vehicle.id == vehicle_id,
            Vehicle.session_id == session_id,
        )
    )
    return result.scalar_one_or_none()


async def _get_session_deal(
    db: AsyncSession, session_id: str, deal_id: str
) -> Deal | None:
    result = await db.execute(
        select(Deal).where(
            Deal.id == deal_id,
            Deal.session_id == session_id,
        )
    )
    return result.scalar_one_or_none()


async def apply_extraction(
    deal_state: DealState, extraction: dict, db: AsyncSession
) -> list[dict]:
    """Apply extracted deal data to the database. Returns tool calls for frontend."""
    applied_tools = []

    if "vehicle" in extraction:
        vehicle_data = extraction["vehicle"]
        vehicle_id = vehicle_data.get("vehicle_id")
        role = vehicle_data.get("role", VehicleRole.PRIMARY)

        if vehicle_id:
            vehicle = await _get_session_vehicle(db, deal_state.session_id, vehicle_id)
            if vehicle:
                for field in VEHICLE_FIELDS:
                    if field in vehicle_data:
                        setattr(vehicle, field, vehicle_data[field])
                logger.debug(
                    "Updated vehicle %s: fields=%s",
                    vehicle_id,
                    [
                        field_name
                        for field_name in vehicle_data
                        if field_name not in ("vehicle_id", "role")
                    ],
                )
            else:
                logger.warning(
                    "set_vehicle: vehicle %s not found for update", vehicle_id
                )
                vehicle_id = None
        else:
            if role == VehicleRole.TRADE_IN:
                result = await db.execute(
                    select(Vehicle).where(
                        Vehicle.session_id == deal_state.session_id,
                        Vehicle.role == VehicleRole.TRADE_IN,
                    )
                )
                existing = result.scalar_one_or_none()
                if existing:
                    logger.debug("Replacing existing trade-in vehicle %s", existing.id)
                    await db.delete(existing)
                    await db.flush()

            vehicle = Vehicle(session_id=deal_state.session_id, role=role)
            for field in VEHICLE_FIELDS:
                if field in vehicle_data:
                    setattr(vehicle, field, vehicle_data[field])
            db.add(vehicle)
            await db.flush()
            vehicle_id = vehicle.id
            logger.debug("Created vehicle %s: role=%s", vehicle_id, role)

            if role == VehicleRole.PRIMARY:
                result = await db.execute(
                    select(Deal.id)
                    .where(Deal.session_id == deal_state.session_id)
                    .limit(1)
                )
                if result.first() is None:
                    auto_deal = Deal(
                        session_id=deal_state.session_id,
                        vehicle_id=vehicle.id,
                    )
                    db.add(auto_deal)
                    await db.flush()
                    deal_state.active_deal_id = auto_deal.id
                    logger.debug(
                        "Auto-created deal %s for primary vehicle %s",
                        auto_deal.id,
                        vehicle.id,
                    )
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

    if "deal" in extraction:
        deal_data = extraction["deal"]
        deal_id = deal_data.get("deal_id")
        if deal_id:
            deal = await _get_session_deal(db, deal_state.session_id, deal_id)
            if deal:
                if "dealer_name" in deal_data:
                    deal.dealer_name = deal_data["dealer_name"]
                if "phase" in deal_data:
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
                    [field_name for field_name in deal_data if field_name != "deal_id"],
                )
            else:
                logger.warning("create_deal: deal %s not found for update", deal_id)
                deal_id = None
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
                await db.flush()
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

    if "numbers" in extraction:
        numbers_deal_id = extraction["numbers"].get("deal_id")
        if numbers_deal_id:
            deal = await _get_session_deal(db, deal_state.session_id, numbers_deal_id)
        else:
            deal = await get_active_deal(deal_state, db)
        if deal:
            numbers = extraction["numbers"]
            changed_fields = [
                field
                for field in DEAL_NUMBER_FIELDS
                if field in numbers and getattr(deal, field) != numbers[field]
            ]
            if not changed_fields:
                logger.debug("Skipped deal numbers update: deal=%s no changes", deal.id)
            else:
                for field in changed_fields:
                    setattr(deal, field, numbers[field])
                if (
                    "current_offer" in changed_fields
                    and deal.first_offer is None
                    and deal.current_offer is not None
                ):
                    deal.first_offer = deal.current_offer
                    logger.debug(
                        "Snapshot first_offer=%s for deal %s",
                        deal.current_offer,
                        deal.id,
                    )
                applied_tools.append({"name": "update_deal_numbers", "args": numbers})
                logger.debug(
                    "Updated deal numbers: deal=%s, fields=%s",
                    deal.id,
                    changed_fields,
                )
        else:
            logger.warning("update_deal_numbers: no active deal found")

    if "scorecard" in extraction:
        scorecard_deal_id = extraction["scorecard"].get("deal_id")
        if scorecard_deal_id:
            deal = await _get_session_deal(db, deal_state.session_id, scorecard_deal_id)
        else:
            deal = await get_active_deal(deal_state, db)
        if deal:
            scorecard_data = extraction["scorecard"]
            changed_score_fields: list[str] = []
            for field in ("price", "financing", "trade_in", "fees", "overall"):
                prefixed = f"score_{field}"
                if prefixed in scorecard_data:
                    if getattr(deal, prefixed) != scorecard_data[prefixed]:
                        setattr(deal, prefixed, scorecard_data[prefixed])
                        changed_score_fields.append(prefixed)
                elif field in scorecard_data:
                    if getattr(deal, prefixed) != scorecard_data[field]:
                        setattr(deal, prefixed, scorecard_data[field])
                        changed_score_fields.append(prefixed)
            if changed_score_fields:
                applied_tools.append(
                    {"name": "update_scorecard", "args": scorecard_data}
                )
                logger.debug(
                    "Updated scorecard: deal=%s, fields=%s",
                    deal.id,
                    changed_score_fields,
                )
            else:
                logger.debug("Skipped scorecard update: deal=%s no changes", deal.id)
        else:
            logger.warning("update_scorecard: no active deal found")

    if "health" in extraction:
        health_deal_id = extraction["health"].get("deal_id")
        if health_deal_id:
            deal = await _get_session_deal(db, deal_state.session_id, health_deal_id)
        else:
            deal = await get_active_deal(deal_state, db)
        if deal:
            health_data = extraction["health"]
            if "status" in health_data:
                try:
                    next_status = HealthStatus(health_data["status"])
                except ValueError:
                    logger.warning(
                        "Invalid health_status from extraction: %s",
                        health_data["status"],
                    )
                else:
                    next_summary = health_data.get("summary", deal.health_summary)
                    next_recommendation = health_data.get(
                        "recommendation", deal.recommendation
                    )
                    if (
                        deal.health_status == next_status
                        and deal.health_summary == next_summary
                        and deal.recommendation == next_recommendation
                    ):
                        logger.debug(
                            "Skipped deal health update: deal=%s no changes", deal.id
                        )
                    else:
                        deal.health_status = next_status
                        deal.health_summary = next_summary
                        deal.recommendation = next_recommendation
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

    if "deal_red_flags" in extraction:
        red_flags_deal_id = (
            extraction["deal_red_flags"].get("deal_id")
            if isinstance(extraction["deal_red_flags"], dict)
            else None
        )
        if red_flags_deal_id:
            deal = await _get_session_deal(db, deal_state.session_id, red_flags_deal_id)
        else:
            deal = await get_active_deal(deal_state, db)
        if deal:
            flags_data = extraction["deal_red_flags"]
            next_flags = (
                flags_data.get("flags", flags_data)
                if isinstance(flags_data, dict)
                else flags_data
            )
            if _json_like_equal(deal.red_flags or [], next_flags):
                logger.debug(
                    "Skipped deal red flags update: deal=%s no changes", deal.id
                )
            else:
                deal.red_flags = next_flags
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

    if "session_red_flags" in extraction:
        flags_data = extraction["session_red_flags"]
        next_flags = (
            flags_data.get("flags", flags_data)
            if isinstance(flags_data, dict)
            else flags_data
        )
        if _json_like_equal(deal_state.red_flags or [], next_flags):
            logger.debug("Skipped session red flags update: no changes")
        else:
            deal_state.red_flags = next_flags
            applied_tools.append(
                {
                    "name": "update_session_red_flags",
                    "args": {"flags": deal_state.red_flags},
                }
            )
            logger.debug(
                "Updated session red flags: count=%d", len(deal_state.red_flags)
            )

    if "deal_information_gaps" in extraction:
        gaps_deal_id = (
            extraction["deal_information_gaps"].get("deal_id")
            if isinstance(extraction["deal_information_gaps"], dict)
            else None
        )
        if gaps_deal_id:
            deal = await _get_session_deal(db, deal_state.session_id, gaps_deal_id)
        else:
            deal = await get_active_deal(deal_state, db)
        if deal:
            gaps_data = extraction["deal_information_gaps"]
            next_gaps = (
                gaps_data.get("gaps", gaps_data)
                if isinstance(gaps_data, dict)
                else gaps_data
            )
            if _json_like_equal(deal.information_gaps or [], next_gaps):
                logger.debug(
                    "Skipped deal information gaps update: deal=%s no changes",
                    deal.id,
                )
            else:
                deal.information_gaps = next_gaps
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

    if "session_information_gaps" in extraction:
        gaps_data = extraction["session_information_gaps"]
        next_gaps = (
            gaps_data.get("gaps", gaps_data)
            if isinstance(gaps_data, dict)
            else gaps_data
        )
        if _json_like_equal(deal_state.information_gaps or [], next_gaps):
            logger.debug("Skipped session information gaps update: no changes")
        else:
            deal_state.information_gaps = next_gaps
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
        next_checklist = (
            checklist_data.get("items", checklist_data)
            if isinstance(checklist_data, dict)
            else checklist_data
        )
        if _json_like_equal(deal_state.checklist or [], next_checklist):
            logger.debug("Skipped checklist update: no changes")
        else:
            deal_state.checklist = next_checklist
            applied_tools.append(
                {"name": "update_checklist", "args": {"items": deal_state.checklist}}
            )
            logger.debug("Updated checklist: count=%d", len(deal_state.checklist))

    if "buyer_context" in extraction:
        try:
            next_buyer_context = BuyerContext(extraction["buyer_context"])
            if deal_state.buyer_context == next_buyer_context:
                logger.debug("Skipped buyer context update: no changes")
            else:
                deal_state.buyer_context = next_buyer_context
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

    if "switch_active_deal_id" in extraction:
        target_deal_id = extraction["switch_active_deal_id"]
        target_deal = await _get_session_deal(db, deal_state.session_id, target_deal_id)
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

    if "remove_vehicle_id" in extraction:
        removed_vehicle_id = extraction["remove_vehicle_id"]
        vehicle = await _get_session_vehicle(
            db, deal_state.session_id, removed_vehicle_id
        )
        if vehicle:
            deals_result = await db.execute(
                select(Deal).where(
                    Deal.vehicle_id == removed_vehicle_id,
                    Deal.session_id == deal_state.session_id,
                )
            )
            deals = list(deals_result.scalars().all())
            deal_ids = {deal.id for deal in deals}
            if deal_state.active_deal_id in deal_ids:
                deal_state.active_deal_id = None
            for deal in deals:
                await db.delete(deal)
            await db.delete(vehicle)
            await db.flush()
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

    if "phase" in extraction:
        deal = await get_active_deal(deal_state, db)
        if deal:
            phase_val = extraction["phase"]
            if deal.phase == phase_val:
                logger.debug("Skipped deal phase update: deal=%s no changes", deal.id)
            else:
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
                logger.debug(
                    "Updated deal phase: deal=%s, phase=%s", deal.id, phase_val
                )
        else:
            logger.warning("update_phase: no active deal found")

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

    if "deal_comparison" in extraction:
        next_comparison = extraction["deal_comparison"]
        if _json_like_equal(deal_state.deal_comparison, next_comparison):
            logger.debug("Skipped deal comparison update: no changes")
        else:
            deal_state.deal_comparison = next_comparison
            applied_tools.append(
                {
                    "name": "update_deal_comparison",
                    "args": extraction["deal_comparison"],
                }
            )
            logger.debug("Updated deal comparison")

    return applied_tools


async def deal_state_to_dict(deal_state: DealState, db: AsyncSession) -> dict:
    """Convert deal state to dict for system prompt context."""
    vehicle_result = await db.execute(
        select(Vehicle).where(Vehicle.session_id == deal_state.session_id)
    )
    vehicles = list(vehicle_result.scalars().all())
    deal_result = await db.execute(
        select(Deal).where(Deal.session_id == deal_state.session_id)
    )
    deals = list(deal_result.scalars().all())

    vehicle_dicts = []
    for vehicle in vehicles:
        vehicle_dicts.append(await _build_prompt_vehicle_dict(vehicle, db))

    return {
        "buyer_context": deal_state.buyer_context,
        "active_deal_id": deal_state.active_deal_id,
        "vehicles": vehicle_dicts,
        "deals": [
            {
                "id": deal.id,
                "vehicle_id": deal.vehicle_id,
                "dealer_name": deal.dealer_name,
                "phase": deal.phase,
                "numbers": {
                    field: getattr(deal, field) for field in DEAL_NUMBER_FIELDS
                },
                "scorecard": {
                    "price": deal.score_price,
                    "financing": deal.score_financing,
                    "trade_in": deal.score_trade_in,
                    "fees": deal.score_fees,
                    "overall": deal.score_overall,
                },
                "health": {
                    "status": deal.health_status,
                    "summary": deal.health_summary,
                    "recommendation": deal.recommendation,
                },
                "red_flags": deal.red_flags or [],
                "information_gaps": deal.information_gaps or [],
            }
            for deal in deals
        ],
        "session_red_flags": deal_state.red_flags or [],
        "session_information_gaps": deal_state.information_gaps or [],
        "checklist": deal_state.checklist or [],
        "negotiation_context": deal_state.negotiation_context,
    }


async def build_deal_assessment_dict(deal: Deal, db: AsyncSession) -> dict:
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

    vehicle_result = await db.execute(
        select(Vehicle).where(Vehicle.id == deal.vehicle_id)
    )
    vehicle = vehicle_result.scalar_one_or_none()
    if vehicle:
        result["vehicle"] = await _build_assessment_vehicle_dict(vehicle, db)

    trade_in_result = await db.execute(
        select(Vehicle).where(
            Vehicle.session_id == deal.session_id,
            Vehicle.role == VehicleRole.TRADE_IN,
        )
    )
    trade_in = trade_in_result.scalar_one_or_none()
    if trade_in:
        result["trade_in_vehicle"] = await _build_assessment_vehicle_dict(trade_in, db)

    return result
