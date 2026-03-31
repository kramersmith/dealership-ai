"""Tests for multi-vehicle/multi-deal extraction, deal corrections, and assessment safety net."""

from unittest.mock import AsyncMock, patch

from app.core.security import create_access_token, hash_password
from app.models.deal import Deal
from app.models.deal_state import DealState
from app.models.enums import (
    DealPhase,
    HealthStatus,
    UserRole,
    VehicleRole,
)
from app.models.session import ChatSession
from app.models.user import User
from app.models.vehicle import Vehicle
from app.services.deal_state import apply_extraction, deal_state_to_dict

# ─── Helpers ───


def _create_user_and_token(db) -> tuple[User, str]:
    user = User(
        email="test@example.com",
        hashed_password=hash_password("password"),
        role=UserRole.BUYER,
        display_name="Test User",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": user.id})
    return user, token


def _auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _create_session_with_deal_state(db, user) -> tuple[ChatSession, DealState]:
    session = ChatSession(user_id=user.id, title="Test Deal")
    db.add(session)
    db.flush()
    deal_state = DealState(session_id=session.id)
    db.add(deal_state)
    db.flush()
    return session, deal_state


def _create_vehicle(
    db, session_id: str, role: str = VehicleRole.PRIMARY, **kwargs
) -> Vehicle:
    vehicle = Vehicle(session_id=session_id, role=role, **kwargs)
    db.add(vehicle)
    db.flush()
    return vehicle


def _create_deal(db, session_id: str, vehicle_id: str, **kwargs) -> Deal:
    deal = Deal(session_id=session_id, vehicle_id=vehicle_id, **kwargs)
    db.add(deal)
    db.flush()
    return deal


def _find_tool(applied: list[dict], name: str) -> dict | None:
    """Find a tool call by name in the applied tools list."""
    for tool_call in applied:
        if tool_call["name"] == name:
            return tool_call
    return None


# ─── apply_extraction: vehicle ───


def test_apply_extraction_vehicle_creates_vehicle_and_deal(db):
    """Vehicle extraction creates a Vehicle row and auto-creates a Deal when no deals exist."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    applied = apply_extraction(
        deal_state,
        {
            "vehicle": {
                "role": VehicleRole.PRIMARY,
                "year": 2024,
                "make": "Honda",
                "model": "Civic",
                "trim": "EX",
            }
        },
        db,
    )

    assert len(applied) >= 1
    tool_call = _find_tool(applied, "set_vehicle")
    assert tool_call is not None
    assert "vehicle_id" in tool_call["args"]

    vehicle = (
        db.query(Vehicle).filter(Vehicle.id == tool_call["args"]["vehicle_id"]).first()
    )
    assert vehicle is not None
    assert vehicle.year == 2024
    assert vehicle.make == "Honda"
    assert vehicle.model == "Civic"
    assert vehicle.trim == "EX"
    assert vehicle.role == VehicleRole.PRIMARY

    # Auto-created deal
    deal = db.query(Deal).filter(Deal.session_id == deal_state.session_id).first()
    assert deal is not None
    assert deal.vehicle_id == vehicle.id
    assert deal_state.active_deal_id == deal.id


def test_apply_extraction_vehicle_trade_in(db):
    """Vehicle extraction with trade_in role creates a trade-in without auto-creating a deal."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    applied = apply_extraction(
        deal_state,
        {
            "vehicle": {
                "role": VehicleRole.TRADE_IN,
                "year": 2018,
                "make": "Toyota",
                "model": "Camry",
                "mileage": 85000,
            }
        },
        db,
    )

    tool_call = _find_tool(applied, "set_vehicle")
    assert tool_call is not None

    vehicle = (
        db.query(Vehicle).filter(Vehicle.id == tool_call["args"]["vehicle_id"]).first()
    )
    assert vehicle is not None
    assert vehicle.role == VehicleRole.TRADE_IN
    assert vehicle.mileage == 85000

    # No deal should be auto-created for trade-in
    deals = db.query(Deal).filter(Deal.session_id == deal_state.session_id).all()
    assert len(deals) == 0


def test_apply_extraction_vehicle_updates_existing(db):
    """Vehicle extraction with vehicle_id updates an existing vehicle."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(
        db, deal_state.session_id, make="Honda", model="Civic", trim="LX"
    )

    applied = apply_extraction(
        deal_state,
        {"vehicle": {"vehicle_id": vehicle.id, "trim": "EX-L", "color": "Blue"}},
        db,
    )

    tool_call = _find_tool(applied, "set_vehicle")
    assert tool_call is not None
    assert tool_call["args"]["vehicle_id"] == vehicle.id

    assert vehicle.trim == "EX-L"
    assert vehicle.color == "Blue"
    # Unchanged fields preserved
    assert vehicle.make == "Honda"
    assert vehicle.model == "Civic"


def test_apply_extraction_vehicle_no_auto_deal_when_deals_exist(db):
    """Vehicle extraction does not auto-create a deal when deals already exist."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    _create_deal(db, deal_state.session_id, vehicle.id)

    applied = apply_extraction(
        deal_state,
        {
            "vehicle": {
                "role": VehicleRole.PRIMARY,
                "make": "Ford",
                "model": "F-150",
            }
        },
        db,
    )

    tool_call = _find_tool(applied, "set_vehicle")
    assert tool_call is not None
    assert "vehicle_id" in tool_call["args"]

    # Should still be only 1 deal (no auto-create)
    deals = db.query(Deal).filter(Deal.session_id == deal_state.session_id).all()
    assert len(deals) == 1


def test_apply_extraction_vehicle_replaces_trade_in(db):
    """Vehicle extraction with trade_in role replaces an existing trade-in."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    old_trade_in = _create_vehicle(
        db,
        deal_state.session_id,
        role=VehicleRole.TRADE_IN,
        make="Toyota",
        model="Corolla",
    )
    old_id = old_trade_in.id

    applied = apply_extraction(
        deal_state,
        {
            "vehicle": {
                "role": VehicleRole.TRADE_IN,
                "make": "Honda",
                "model": "Accord",
            }
        },
        db,
    )

    tool_call = _find_tool(applied, "set_vehicle")
    assert tool_call is not None

    # Old trade-in should be deleted
    assert db.query(Vehicle).filter(Vehicle.id == old_id).first() is None
    # New trade-in exists
    new_vehicle = (
        db.query(Vehicle).filter(Vehicle.id == tool_call["args"]["vehicle_id"]).first()
    )
    assert new_vehicle is not None
    assert new_vehicle.make == "Honda"
    assert new_vehicle.model == "Accord"
    assert new_vehicle.role == VehicleRole.TRADE_IN


# ─── apply_extraction: deal ───


def test_apply_extraction_create_deal(db):
    """Deal extraction creates a Deal for an existing vehicle and sets active_deal_id."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")

    applied = apply_extraction(
        deal_state,
        {"deal": {"vehicle_id": vehicle.id, "dealer_name": "Metro Honda"}},
        db,
    )

    tool_call = _find_tool(applied, "create_deal")
    assert tool_call is not None
    assert "deal_id" in tool_call["args"]

    deal = db.query(Deal).filter(Deal.id == tool_call["args"]["deal_id"]).first()
    assert deal is not None
    assert deal.vehicle_id == vehicle.id
    assert deal.dealer_name == "Metro Honda"
    assert deal_state.active_deal_id == deal.id


def test_apply_extraction_create_deal_without_vehicle_id(db):
    """Deal extraction without vehicle_id produces no create_deal tool call."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    applied = apply_extraction(deal_state, {"deal": {}}, db)

    # No tool call emitted — missing vehicle_id means nothing was created
    tool_call = _find_tool(applied, "create_deal")
    assert tool_call is None
    deals = db.query(Deal).filter(Deal.session_id == deal_state.session_id).all()
    assert len(deals) == 0


# ─── apply_extraction: numbers ───


def test_apply_extraction_numbers(db):
    """Numbers extraction updates the active Deal."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.flush()

    applied = apply_extraction(
        deal_state,
        {"numbers": {"msrp": 35000, "current_offer": 32000, "apr": 4.5}},
        db,
    )

    tool_call = _find_tool(applied, "update_deal_numbers")
    assert tool_call is not None

    assert deal.msrp == 35000
    assert deal.current_offer == 32000
    assert deal.apr == 4.5


def test_apply_extraction_numbers_no_deal(db):
    """Numbers extraction with no active deal produces no tool call."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    applied = apply_extraction(
        deal_state,
        {"numbers": {"current_offer": 25000}},
        db,
    )

    tool_call = _find_tool(applied, "update_deal_numbers")
    assert tool_call is None


# ─── apply_extraction: first_offer snapshot ───


def test_apply_extraction_first_offer_snapshot(db):
    """First time current_offer is set on a Deal, first_offer is snapshotted."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.flush()

    assert deal.first_offer is None
    assert deal.current_offer is None

    apply_extraction(deal_state, {"numbers": {"current_offer": 27500}}, db)

    assert deal.current_offer == 27500
    assert deal.first_offer == 27500


def test_apply_extraction_first_offer_not_overwritten(db):
    """Subsequent current_offer updates don't overwrite first_offer."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(
        db, deal_state.session_id, vehicle.id, current_offer=27500, first_offer=27500
    )
    deal_state.active_deal_id = deal.id
    db.flush()

    apply_extraction(deal_state, {"numbers": {"current_offer": 26000}}, db)

    assert deal.current_offer == 26000
    assert deal.first_offer == 27500  # Unchanged


# ─── apply_extraction: deal phase / pre_fi_price snapshot ───


def test_apply_extraction_pre_fi_price_snapshot(db):
    """When phase transitions to financing via deal extraction, pre_fi_price snapshots current_offer."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id, current_offer=26000)
    deal_state.active_deal_id = deal.id
    db.flush()

    assert deal.pre_fi_price is None

    apply_extraction(
        deal_state,
        {"deal": {"deal_id": deal.id, "phase": "financing"}},
        db,
    )

    assert deal.phase == DealPhase.FINANCING
    assert deal.pre_fi_price == 26000


def test_apply_extraction_pre_fi_price_not_overwritten(db):
    """Second transition to financing doesn't overwrite pre_fi_price."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(
        db, deal_state.session_id, vehicle.id, current_offer=26000, pre_fi_price=25000
    )
    deal_state.active_deal_id = deal.id
    db.flush()

    apply_extraction(
        deal_state,
        {"deal": {"deal_id": deal.id, "phase": "financing"}},
        db,
    )

    assert deal.pre_fi_price == 25000  # Unchanged


def test_apply_extraction_pre_fi_price_no_snapshot_without_offer(db):
    """If current_offer is None when entering financing, pre_fi_price stays None."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.flush()

    assert deal.current_offer is None

    apply_extraction(
        deal_state,
        {"deal": {"deal_id": deal.id, "phase": "financing"}},
        db,
    )

    assert deal.pre_fi_price is None


# ─── apply_extraction: health ───


def test_apply_extraction_deal_health_valid(db):
    """Health extraction sets health_status and health_summary on the Deal."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.flush()

    applied = apply_extraction(
        deal_state,
        {"health": {"status": "good", "summary": "Offer is below your target"}},
        db,
    )

    tool_call = _find_tool(applied, "update_deal_health")
    assert tool_call is not None

    assert deal.health_status == HealthStatus.GOOD
    assert deal.health_summary == "Offer is below your target"


def test_apply_extraction_deal_health_with_recommendation(db):
    """Health extraction sets recommendation on the Deal."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.flush()

    apply_extraction(
        deal_state,
        {
            "health": {
                "status": "fair",
                "summary": "Offer is above target",
                "recommendation": "Counter at $31,500",
            }
        },
        db,
    )

    assert deal.health_status == HealthStatus.FAIR
    assert deal.health_summary == "Offer is above target"
    assert deal.recommendation == "Counter at $31,500"


def test_apply_extraction_deal_health_without_recommendation(db):
    """Health extraction without recommendation leaves it unchanged."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal.recommendation = "Old recommendation"
    deal_state.active_deal_id = deal.id
    db.flush()

    apply_extraction(
        deal_state,
        {"health": {"status": "good", "summary": "Great deal"}},
        db,
    )

    assert deal.health_status == HealthStatus.GOOD
    assert deal.recommendation == "Old recommendation"


def test_apply_extraction_deal_health_recommendation_overwrites(db):
    """Health extraction with new recommendation overwrites old one."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal.recommendation = "Old recommendation"
    deal_state.active_deal_id = deal.id
    db.flush()

    apply_extraction(
        deal_state,
        {
            "health": {
                "status": "concerning",
                "summary": "APR too high",
                "recommendation": "Get a pre-approval from your bank",
            }
        },
        db,
    )

    assert deal.recommendation == "Get a pre-approval from your bank"


def test_apply_extraction_deal_health_invalid_status(db):
    """Health extraction with invalid status leaves health_status unchanged."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal.health_status = HealthStatus.FAIR
    deal_state.active_deal_id = deal.id
    db.flush()

    applied = apply_extraction(
        deal_state,
        {"health": {"status": "invalid_status", "summary": "Should not apply"}},
        db,
    )

    assert deal.health_status == HealthStatus.FAIR
    # No update_deal_health tool call should be emitted for invalid status
    tool_call = _find_tool(applied, "update_deal_health")
    assert tool_call is None


def test_apply_extraction_deal_health_no_deal(db):
    """Health extraction with no active deal produces no tool call."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    applied = apply_extraction(
        deal_state,
        {"health": {"status": "good", "summary": "Test"}},
        db,
    )

    tool_call = _find_tool(applied, "update_deal_health")
    assert tool_call is None


# ─── apply_extraction: deal_red_flags ───


def test_apply_extraction_deal_red_flags(db):
    """Deal red flags extraction replaces the full red flags list on the Deal."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.flush()

    flags = [
        {
            "id": "apr_high",
            "severity": "critical",
            "message": "APR of 9.5% is very high",
        },
        {
            "id": "hidden_fee",
            "severity": "warning",
            "message": "Unexpected doc fee of $800",
        },
    ]
    applied = apply_extraction(deal_state, {"deal_red_flags": flags}, db)

    tool_call = _find_tool(applied, "update_deal_red_flags")
    assert tool_call is not None

    assert deal.red_flags == flags
    assert len(deal.red_flags) == 2


def test_apply_extraction_deal_red_flags_dict_wrapped(db):
    """Deal red flags extraction handles dict-wrapped format from analyst ({"flags": [...]})."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.flush()

    flags = [
        {"id": "apr_high", "severity": "critical", "message": "APR is 9.5%"},
    ]
    applied = apply_extraction(deal_state, {"deal_red_flags": {"flags": flags}}, db)

    tool_call = _find_tool(applied, "update_deal_red_flags")
    assert tool_call is not None
    assert deal.red_flags == flags


def test_apply_extraction_deal_red_flags_clear(db):
    """Deal red flags extraction with empty array clears all deal flags."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal.red_flags = [{"id": "old", "severity": "warning", "message": "Old flag"}]
    deal_state.active_deal_id = deal.id
    db.flush()

    apply_extraction(deal_state, {"deal_red_flags": []}, db)

    assert deal.red_flags == []


# ─── apply_extraction: session_red_flags ───


def test_apply_extraction_session_red_flags(db):
    """Session red flags extraction sets flags on DealState (session-level)."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    flags = [
        {"id": "no_preapproval", "severity": "warning", "message": "Not pre-approved"}
    ]
    applied = apply_extraction(deal_state, {"session_red_flags": flags}, db)

    tool_call = _find_tool(applied, "update_session_red_flags")
    assert tool_call is not None
    assert deal_state.red_flags == flags


# ─── apply_extraction: deal_information_gaps ───


def test_apply_extraction_deal_information_gaps(db):
    """Deal information gaps extraction replaces the full gaps list on the Deal."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.flush()

    gaps = [
        {
            "label": "Credit score range",
            "reason": "Helps assess whether APR is competitive",
            "priority": "high",
        },
        {
            "label": "Pre-approval status",
            "reason": "Forces dealer to compete on price alone",
            "priority": "high",
        },
    ]
    applied = apply_extraction(deal_state, {"deal_information_gaps": gaps}, db)

    tool_call = _find_tool(applied, "update_deal_information_gaps")
    assert tool_call is not None

    assert deal.information_gaps == gaps
    assert len(deal.information_gaps) == 2


def test_apply_extraction_deal_information_gaps_clear(db):
    """Deal information gaps extraction with empty array clears gaps."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal.information_gaps = [{"label": "Old gap", "reason": "Old", "priority": "low"}]
    deal_state.active_deal_id = deal.id
    db.flush()

    apply_extraction(deal_state, {"deal_information_gaps": []}, db)

    assert deal.information_gaps == []


# ─── apply_extraction: session_information_gaps ───


def test_apply_extraction_session_information_gaps(db):
    """Session information gaps extraction sets gaps on DealState (session-level)."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    gaps = [{"label": "Budget", "reason": "Needed for analysis", "priority": "medium"}]
    applied = apply_extraction(deal_state, {"session_information_gaps": gaps}, db)

    tool_call = _find_tool(applied, "update_session_information_gaps")
    assert tool_call is not None
    assert deal_state.information_gaps == gaps


# ─── apply_extraction: switch_active_deal ───


def test_apply_extraction_switch_active_deal(db):
    """Switch active deal extraction sets active_deal_id on the DealState."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal1 = _create_deal(db, deal_state.session_id, vehicle.id, dealer_name="A")
    deal2 = _create_deal(db, deal_state.session_id, vehicle.id, dealer_name="B")

    deal_state.active_deal_id = deal1.id
    db.flush()

    applied = apply_extraction(deal_state, {"switch_active_deal_id": deal2.id}, db)

    tool_call = _find_tool(applied, "switch_active_deal")
    assert tool_call is not None
    assert deal_state.active_deal_id == deal2.id


# ─── apply_extraction: remove_vehicle ───


def test_apply_extraction_remove_vehicle_cascades_to_deals(db):
    """Remove vehicle extraction deletes the vehicle and all its deals."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.flush()

    vehicle_id = vehicle.id
    deal_id = deal.id

    applied = apply_extraction(deal_state, {"remove_vehicle_id": vehicle_id}, db)

    tool_call = _find_tool(applied, "remove_vehicle")
    assert tool_call is not None

    assert db.query(Vehicle).filter(Vehicle.id == vehicle_id).first() is None
    assert db.query(Deal).filter(Deal.id == deal_id).first() is None
    assert deal_state.active_deal_id is None


def test_apply_extraction_remove_vehicle_nonexistent(db):
    """Remove vehicle extraction with nonexistent ID produces no tool call."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    applied = apply_extraction(deal_state, {"remove_vehicle_id": "nonexistent"}, db)

    tool_call = _find_tool(applied, "remove_vehicle")
    assert tool_call is None


# ─── apply_extraction: deal_comparison ───


def test_apply_extraction_deal_comparison(db):
    """Deal comparison extraction persists comparison to DealState."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    comparison = {"deals": ["d1", "d2"], "winner": "d1"}
    applied = apply_extraction(deal_state, {"deal_comparison": comparison}, db)

    tool_call = _find_tool(applied, "update_deal_comparison")
    assert tool_call is not None
    assert deal_state.deal_comparison == comparison


# ─── apply_extraction: checklist ───


def test_apply_extraction_checklist(db):
    """Checklist extraction persists items to DealState."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    items = [
        {"label": "Get pre-approved", "done": False},
        {"label": "Check credit score", "done": True},
    ]
    applied = apply_extraction(deal_state, {"checklist": items}, db)

    tool_call = _find_tool(applied, "update_checklist")
    assert tool_call is not None
    assert deal_state.checklist == items


def test_apply_extraction_checklist_string_input(db):
    """Checklist extraction handles a JSON string and parses it into a list."""
    import json

    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    items = [
        {"label": "Get pre-approved", "done": False},
        {"label": "Check credit score", "done": True},
    ]
    # Pass checklist as a JSON string instead of a list
    applied = apply_extraction(deal_state, {"checklist": json.dumps(items)}, db)

    tool_call = _find_tool(applied, "update_checklist")
    assert tool_call is not None
    assert deal_state.checklist == items


# ─── apply_extraction: buyer_context ───


def test_apply_extraction_buyer_context(db):
    """Buyer context extraction updates buyer_context on DealState."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    applied = apply_extraction(deal_state, {"buyer_context": "at_dealership"}, db)

    tool_call = _find_tool(applied, "update_buyer_context")
    assert tool_call is not None
    assert deal_state.buyer_context == "at_dealership"


def test_apply_extraction_buyer_context_invalid(db):
    """Buyer context extraction with invalid value produces no tool call."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    applied = apply_extraction(deal_state, {"buyer_context": "invalid"}, db)

    tool_call = _find_tool(applied, "update_buyer_context")
    assert tool_call is None
    assert deal_state.buyer_context == "researching"  # Default unchanged


# ─── apply_extraction: scorecard ───


def test_apply_extraction_scorecard(db):
    """Scorecard extraction updates score fields on the Deal."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.flush()

    applied = apply_extraction(
        deal_state,
        {"scorecard": {"price": "green", "financing": "yellow", "overall": "green"}},
        db,
    )

    tool_call = _find_tool(applied, "update_scorecard")
    assert tool_call is not None

    assert deal.score_price == "green"
    assert deal.score_financing == "yellow"
    assert deal.score_overall == "green"


# ─── apply_extraction: quick_actions ───


def test_apply_extraction_quick_actions(db):
    """Quick actions extraction emits tool call without persisting to DB."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    actions = [
        {
            "label": "What's a fair price?",
            "message": "What's a fair price for this car?",
        },
        {"label": "Check APR", "message": "Is my APR competitive?"},
    ]
    applied = apply_extraction(deal_state, {"quick_actions": actions}, db)

    tool_call = _find_tool(applied, "update_quick_actions")
    assert tool_call is not None
    assert tool_call["args"]["actions"] == actions


# ─── apply_extraction: multiple keys at once ───


def test_apply_extraction_multiple_keys(db):
    """Extraction with multiple keys applies all of them."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.flush()

    applied = apply_extraction(
        deal_state,
        {
            "numbers": {"msrp": 35000, "current_offer": 32000},
            "health": {"status": "good", "summary": "Strong deal"},
            "checklist": [{"label": "Get pre-approved", "done": False}],
        },
        db,
    )

    assert _find_tool(applied, "update_deal_numbers") is not None
    assert _find_tool(applied, "update_deal_health") is not None
    assert _find_tool(applied, "update_checklist") is not None

    assert deal.msrp == 35000
    assert deal.current_offer == 32000
    assert deal.health_status == HealthStatus.GOOD
    assert deal_state.checklist == [{"label": "Get pre-approved", "done": False}]


def test_apply_extraction_empty_dict(db):
    """Extraction with empty dict returns empty list."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    applied = apply_extraction(deal_state, {}, db)

    assert applied == []


def test_apply_extraction_unknown_keys_ignored(db):
    """Extraction with unknown keys silently ignores them."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    applied = apply_extraction(
        deal_state,
        {"totally_unknown_key": {"foo": "bar"}},
        db,
    )

    assert applied == []


# ─── deal_state_to_dict ───


def test_deal_state_to_dict_with_vehicles_and_deals(db):
    """deal_state_to_dict includes vehicles, deals, and session-level fields."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(
        db, deal_state.session_id, make="Honda", model="Civic", year=2024
    )
    deal = _create_deal(
        db,
        deal_state.session_id,
        vehicle.id,
        current_offer=30000,
        health_status="good",
        health_summary="Strong deal",
    )
    deal_state.active_deal_id = deal.id
    deal_state.red_flags = [
        {"id": "session_flag", "severity": "warning", "message": "Test"}
    ]
    db.commit()

    result = deal_state_to_dict(deal_state, db)

    assert result["buyer_context"] == "researching"
    assert result["active_deal_id"] == deal.id
    assert len(result["vehicles"]) == 1
    assert result["vehicles"][0]["make"] == "Honda"
    assert result["vehicles"][0]["year"] == 2024
    assert len(result["deals"]) == 1
    assert result["deals"][0]["numbers"]["current_offer"] == 30000
    assert result["deals"][0]["health"]["status"] == "good"
    assert result["deals"][0]["health"]["summary"] == "Strong deal"
    assert result["session_red_flags"] == [
        {"id": "session_flag", "severity": "warning", "message": "Test"}
    ]


def test_deal_state_to_dict_empty(db):
    """deal_state_to_dict returns empty lists when no vehicles or deals."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    result = deal_state_to_dict(deal_state, db)

    assert result["active_deal_id"] is None
    assert result["vehicles"] == []
    assert result["deals"] == []
    assert result["session_red_flags"] == []
    assert result["session_information_gaps"] == []
    assert result["checklist"] == []
    assert result["ai_panel_cards"] == []


def test_deal_state_to_dict_deal_red_flags_and_gaps(db):
    """deal_state_to_dict includes deal-level red_flags and information_gaps."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal.red_flags = [{"id": "test", "severity": "warning", "message": "Test flag"}]
    deal.information_gaps = [
        {"label": "Credit", "reason": "Needed", "priority": "high"}
    ]
    db.commit()

    result = deal_state_to_dict(deal_state, db)

    assert len(result["deals"]) == 1
    assert len(result["deals"][0]["red_flags"]) == 1
    assert result["deals"][0]["red_flags"][0]["id"] == "test"
    assert len(result["deals"][0]["information_gaps"]) == 1
    assert result["deals"][0]["information_gaps"][0]["label"] == "Credit"


def test_deal_state_to_dict_includes_negotiation_context(db):
    """deal_state_to_dict includes negotiation_context when set."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    negotiation_context = {
        "stance": "negotiating",
        "situation": "Waiting for dealer counter-offer at $33K.",
        "key_numbers": [{"label": "Target", "value": "$33,000"}],
    }
    deal_state.negotiation_context = negotiation_context
    db.commit()

    result = deal_state_to_dict(deal_state, db)

    assert result["negotiation_context"] == negotiation_context


def test_deal_state_to_dict_negotiation_context_none(db):
    """deal_state_to_dict returns None for negotiation_context when not set."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    result = deal_state_to_dict(deal_state, db)

    assert result["negotiation_context"] is None


# ─── PATCH /deal/{session_id} with new format ───


@patch("app.routes.deals.analyze_deal", new_callable=AsyncMock)
def test_patch_deal_corrects_deal_number(mock_extract, client, db):
    """PATCH /deal/{session_id} applies deal number corrections with deal_corrections format."""
    mock_extract.return_value = {
        "health": {"status": "fair", "summary": "Offer is above target"},
        "deal_red_flags": [],
    }

    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.commit()
    session_id = deal_state.session_id

    resp = client.patch(
        f"/api/deal/{session_id}",
        json={"deal_corrections": [{"deal_id": deal.id, "current_offer": 25000}]},
        headers=_auth_header(token),
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["deal_id"] == deal.id
    assert data["health_status"] == "fair"
    assert data["health_summary"] == "Offer is above target"

    db.refresh(deal)
    assert deal.current_offer == 25000


@patch("app.routes.deals.analyze_deal", new_callable=AsyncMock)
def test_patch_deal_corrects_vehicle(mock_extract, client, db):
    """PATCH /deal/{session_id} applies vehicle field corrections."""
    mock_extract.return_value = {}

    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Hondaa", model="Civc")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.commit()
    session_id = deal_state.session_id

    resp = client.patch(
        f"/api/deal/{session_id}",
        json={
            "vehicle_corrections": [
                {"vehicle_id": vehicle.id, "make": "Honda", "model": "Civic"}
            ]
        },
        headers=_auth_header(token),
    )

    assert resp.status_code == 200
    db.refresh(vehicle)
    assert vehicle.make == "Honda"
    assert vehicle.model == "Civic"


@patch("app.routes.deals.analyze_deal", new_callable=AsyncMock)
def test_patch_deal_snapshots_first_offer(mock_extract, client, db):
    """PATCH with current_offer snapshots to first_offer when first_offer is null."""
    mock_extract.return_value = {}

    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.commit()
    session_id = deal_state.session_id

    resp = client.patch(
        f"/api/deal/{session_id}",
        json={"deal_corrections": [{"deal_id": deal.id, "current_offer": 28000}]},
        headers=_auth_header(token),
    )

    assert resp.status_code == 200
    db.refresh(deal)
    assert deal.current_offer == 28000
    assert deal.first_offer == 28000


@patch("app.routes.deals.analyze_deal", new_callable=AsyncMock)
def test_patch_deal_empty_body_returns_400(mock_extract, client, db):
    """PATCH with no corrections returns 400."""
    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    session_id = deal_state.session_id

    resp = client.patch(
        f"/api/deal/{session_id}",
        json={},
        headers=_auth_header(token),
    )

    assert resp.status_code == 400


def test_patch_deal_returns_404_for_nonexistent(client, db):
    """PATCH for nonexistent session returns 404."""
    _, token = _create_user_and_token(db)

    resp = client.patch(
        "/api/deal/nonexistent-id",
        json={"deal_corrections": [{"deal_id": "x", "current_offer": 25000}]},
        headers=_auth_header(token),
    )

    assert resp.status_code == 404


@patch("app.routes.deals.analyze_deal", new_callable=AsyncMock)
def test_patch_deal_other_user_returns_404(mock_extract, client, db):
    """PATCH on another user's session returns 404."""
    user1, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user1)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    session_id = deal_state.session_id

    user2 = User(
        email="other@example.com",
        hashed_password=hash_password("password"),
        role=UserRole.BUYER,
        display_name="Other",
    )
    db.add(user2)
    db.commit()
    db.refresh(user2)
    token2 = create_access_token({"sub": user2.id})

    resp = client.patch(
        f"/api/deal/{session_id}",
        json={"deal_corrections": [{"deal_id": deal.id, "current_offer": 25000}]},
        headers=_auth_header(token2),
    )

    assert resp.status_code == 404


@patch("app.routes.deals.analyze_deal", new_callable=AsyncMock)
def test_patch_deal_applies_assessment_health(mock_extract, client, db):
    """PATCH applies the Haiku assessment health to the Deal."""
    mock_extract.return_value = {
        "health": {"status": "concerning", "summary": "APR is very high"},
        "deal_red_flags": [
            {"id": "apr_high", "severity": "critical", "message": "9.5% APR"}
        ],
    }

    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.commit()
    session_id = deal_state.session_id

    resp = client.patch(
        f"/api/deal/{session_id}",
        json={"deal_corrections": [{"deal_id": deal.id, "apr": 9.5}]},
        headers=_auth_header(token),
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["deal_id"] == deal.id
    assert data["health_status"] == "concerning"
    assert len(data["red_flags"]) == 1
    assert data["red_flags"][0]["id"] == "apr_high"

    db.refresh(deal)
    assert deal.health_status == "concerning"
    assert deal.red_flags == [
        {"id": "apr_high", "severity": "critical", "message": "9.5% APR"}
    ]


@patch("app.routes.deals.analyze_deal", new_callable=AsyncMock)
def test_patch_deal_applies_assessment_recommendation(mock_extract, client, db):
    """PATCH applies the recommendation from Haiku assessment to the Deal."""
    mock_extract.return_value = {
        "health": {
            "status": "fair",
            "summary": "Offer above target",
            "recommendation": "Counter at $28,000",
        },
        "deal_red_flags": [],
    }

    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.commit()
    session_id = deal_state.session_id

    resp = client.patch(
        f"/api/deal/{session_id}",
        json={"deal_corrections": [{"deal_id": deal.id, "current_offer": 30000}]},
        headers=_auth_header(token),
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["recommendation"] == "Counter at $28,000"

    db.refresh(deal)
    assert deal.recommendation == "Counter at $28,000"


@patch("app.routes.deals.analyze_deal", new_callable=AsyncMock)
def test_patch_deal_no_recommendation_preserves_existing(mock_extract, client, db):
    """PATCH without recommendation in assessment preserves existing recommendation."""
    mock_extract.return_value = {
        "health": {"status": "good", "summary": "Great deal"},
        "deal_red_flags": [],
    }

    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal.recommendation = "Previous recommendation"
    deal_state.active_deal_id = deal.id
    db.commit()
    session_id = deal_state.session_id

    resp = client.patch(
        f"/api/deal/{session_id}",
        json={"deal_corrections": [{"deal_id": deal.id, "current_offer": 25000}]},
        headers=_auth_header(token),
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["recommendation"] == "Previous recommendation"

    db.refresh(deal)
    assert deal.recommendation == "Previous recommendation"


@patch("app.routes.deals.analyze_deal", new_callable=AsyncMock)
def test_patch_deal_vehicle_correction_triggers_linked_deal_assessment(
    mock_extract, client, db
):
    """PATCH with vehicle correction re-assesses linked deals."""
    mock_extract.return_value = {
        "health": {"status": "good", "summary": "Good deal on corrected vehicle"},
        "deal_red_flags": [],
    }

    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Hondaa", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id, current_offer=25000)
    deal_state.active_deal_id = deal.id
    db.commit()
    session_id = deal_state.session_id

    resp = client.patch(
        f"/api/deal/{session_id}",
        json={"vehicle_corrections": [{"vehicle_id": vehicle.id, "make": "Honda"}]},
        headers=_auth_header(token),
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["deal_id"] == deal.id
    assert data["health_status"] == "good"

    db.refresh(vehicle)
    assert vehicle.make == "Honda"

    mock_extract.assert_called_once()


# ─── GET /deal/{session_id} ───


def test_get_deal_state_includes_vehicles_and_deals(client, db):
    """GET /deal/{session_id} response includes vehicles, deals, and session-level fields."""
    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    session_id = deal_state.session_id

    vehicle = _create_vehicle(
        db, session_id, make="Honda", model="Civic", year=2024, trim="EX"
    )
    deal = _create_deal(
        db,
        session_id,
        vehicle.id,
        current_offer=28000,
        health_status="concerning",
        health_summary="APR is high",
        recommendation="Get a pre-approval from your bank",
    )
    deal.red_flags = [
        {"id": "apr_high", "severity": "critical", "message": "Very high APR"}
    ]
    deal.information_gaps = [
        {"label": "Credit", "reason": "Needed for APR assessment", "priority": "high"}
    ]
    deal.first_offer = 28000
    deal.pre_fi_price = 26000
    deal.savings_estimate = 2000
    deal_state.active_deal_id = deal.id
    deal_state.red_flags = [
        {"id": "session_flag", "severity": "warning", "message": "Session flag"}
    ]
    db.commit()

    resp = client.get(f"/api/deal/{session_id}", headers=_auth_header(token))

    assert resp.status_code == 200
    data = resp.json()
    assert data["session_id"] == session_id
    assert data["active_deal_id"] == deal.id
    assert len(data["vehicles"]) == 1
    assert data["vehicles"][0]["make"] == "Honda"
    assert data["vehicles"][0]["year"] == 2024
    assert len(data["deals"]) == 1
    d = data["deals"][0]
    assert d["current_offer"] == 28000
    assert d["health_status"] == "concerning"
    assert d["health_summary"] == "APR is high"
    assert d["recommendation"] == "Get a pre-approval from your bank"
    assert len(d["red_flags"]) == 1
    assert d["red_flags"][0]["id"] == "apr_high"
    assert len(d["information_gaps"]) == 1
    assert d["first_offer"] == 28000
    assert d["pre_fi_price"] == 26000
    assert d["savings_estimate"] == 2000
    # Session-level red flags
    assert len(data["red_flags"]) == 1
    assert data["red_flags"][0]["id"] == "session_flag"


def test_get_deal_state_empty_session(client, db):
    """GET /deal/{session_id} returns empty lists when no vehicles or deals."""
    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    session_id = deal_state.session_id

    resp = client.get(f"/api/deal/{session_id}", headers=_auth_header(token))

    assert resp.status_code == 200
    data = resp.json()
    assert data["active_deal_id"] is None
    assert data["vehicles"] == []
    assert data["deals"] == []
    assert data["red_flags"] == []
    assert data["information_gaps"] == []
    assert data["checklist"] == []
    assert data["ai_panel_cards"] == []


# ─── PATCH /deal/{session_id}: error cases ───


@patch("app.routes.deals.analyze_deal", new_callable=AsyncMock)
def test_patch_deal_nonexistent_vehicle_returns_404(mock_analyze, client, db):
    """PATCH with a vehicle_id that doesn't exist in the session returns 404."""
    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    session_id = deal_state.session_id

    resp = client.patch(
        f"/api/deal/{session_id}",
        json={
            "vehicle_corrections": [{"vehicle_id": "nonexistent-id", "make": "Honda"}]
        },
        headers=_auth_header(token),
    )

    assert resp.status_code == 404
    assert "Vehicle" in resp.json()["detail"]


@patch("app.routes.deals.analyze_deal", new_callable=AsyncMock)
def test_patch_deal_nonexistent_deal_returns_404(mock_analyze, client, db):
    """PATCH with a deal_id that doesn't exist in the session returns 404."""
    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    session_id = deal_state.session_id

    resp = client.patch(
        f"/api/deal/{session_id}",
        json={
            "deal_corrections": [{"deal_id": "nonexistent-id", "current_offer": 25000}]
        },
        headers=_auth_header(token),
    )

    assert resp.status_code == 404
    assert "Deal" in resp.json()["detail"]


@patch("app.routes.deals.analyze_deal", new_callable=AsyncMock)
def test_patch_deal_reassessment_failure_returns_200(mock_analyze, client, db):
    """PATCH succeeds even when re-assessment raises — corrections still saved."""
    mock_analyze.side_effect = Exception("API error")

    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.commit()
    session_id = deal_state.session_id

    resp = client.patch(
        f"/api/deal/{session_id}",
        json={"deal_corrections": [{"deal_id": deal.id, "current_offer": 25000}]},
        headers=_auth_header(token),
    )

    # Corrections saved, empty assessment returned
    assert resp.status_code == 200
    db.refresh(deal)
    assert deal.current_offer == 25000


@patch("app.routes.deals.analyze_deal", new_callable=AsyncMock)
def test_patch_deal_vehicle_correction_no_linked_deals(mock_analyze, client, db):
    """PATCH with vehicle correction but no linked deals returns empty response."""
    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, deal_state.session_id, make="Honda", model="Civic")
    db.commit()
    session_id = deal_state.session_id

    resp = client.patch(
        f"/api/deal/{session_id}",
        json={"vehicle_corrections": [{"vehicle_id": vehicle.id, "make": "Toyota"}]},
        headers=_auth_header(token),
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["deal_id"] == ""
    assert data["health_status"] is None


# ─── build_deal_assessment_dict ───


def test_build_deal_assessment_dict_includes_vehicle(db):
    """build_deal_assessment_dict includes primary vehicle details."""
    from app.services.deal_state import build_deal_assessment_dict

    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(
        db, deal_state.session_id, make="Honda", model="Civic", year=2024, trim="EX"
    )
    deal = _create_deal(
        db, deal_state.session_id, vehicle.id, msrp=30000, current_offer=28000
    )
    db.flush()

    result = build_deal_assessment_dict(deal, db)

    assert result["msrp"] == 30000
    assert result["current_offer"] == 28000
    assert result["vehicle"]["make"] == "Honda"
    assert result["vehicle"]["year"] == 2024
    assert "trade_in_vehicle" not in result


def test_build_deal_assessment_dict_includes_trade_in(db):
    """build_deal_assessment_dict includes trade-in vehicle when present."""
    from app.services.deal_state import build_deal_assessment_dict

    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(
        db, deal_state.session_id, make="Honda", model="Civic", year=2024
    )
    _create_vehicle(
        db,
        deal_state.session_id,
        role=VehicleRole.TRADE_IN,
        make="Toyota",
        model="Corolla",
        year=2019,
        mileage=45000,
    )
    deal = _create_deal(db, deal_state.session_id, vehicle.id)
    db.flush()

    result = build_deal_assessment_dict(deal, db)

    assert result["vehicle"]["make"] == "Honda"
    assert result["trade_in_vehicle"]["make"] == "Toyota"
    assert result["trade_in_vehicle"]["year"] == 2019
    assert result["trade_in_vehicle"]["mileage"] == 45000


# ─── apply_extraction: auto-deal emits create_deal tool call ───


def test_apply_extraction_auto_deal_emits_create_deal(db):
    """Auto-created deal emits a create_deal tool call before set_vehicle."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    applied = apply_extraction(
        deal_state,
        {
            "vehicle": {
                "role": VehicleRole.PRIMARY,
                "make": "Honda",
                "model": "Civic",
            }
        },
        db,
    )

    create_deal_tc = _find_tool(applied, "create_deal")
    assert create_deal_tc is not None
    assert "deal_id" in create_deal_tc["args"]
    assert "vehicle_id" in create_deal_tc["args"]

    # create_deal should come before set_vehicle
    create_idx = next(i for i, t in enumerate(applied) if t["name"] == "create_deal")
    set_idx = next(i for i, t in enumerate(applied) if t["name"] == "set_vehicle")
    assert create_idx < set_idx
