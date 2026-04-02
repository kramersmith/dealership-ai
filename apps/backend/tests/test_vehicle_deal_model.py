"""Tests for the multi-vehicle/multi-deal data model: Vehicle, Deal, cascade deletes."""

from app.core.security import hash_password
from app.models.deal import Deal
from app.models.deal_state import DealState
from app.models.enums import (
    DealPhase,
    IntelligenceProvider,
    IntelligenceStatus,
    UserRole,
    VehicleRole,
)
from app.models.session import ChatSession
from app.models.user import User
from app.models.vehicle import Vehicle
from app.models.vehicle_decode import VehicleDecode
from app.models.vehicle_history_report import VehicleHistoryReport
from app.models.vehicle_valuation import VehicleValuation

# ─── Helpers ───


def _create_user(db) -> User:
    user = User(
        email="test@example.com",
        hashed_password=hash_password("password"),
        role=UserRole.BUYER,
        display_name="Test User",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _create_session_with_deal_state(db, user) -> tuple[ChatSession, DealState]:
    session = ChatSession(user_id=user.id, title="Test Deal")
    db.add(session)
    db.flush()
    deal_state = DealState(session_id=session.id)
    db.add(deal_state)
    db.commit()
    db.refresh(session)
    db.refresh(deal_state)
    return session, deal_state


def _create_vehicle(
    db, session_id: str, role: str = VehicleRole.PRIMARY, **kwargs
) -> Vehicle:
    vehicle = Vehicle(session_id=session_id, role=role, **kwargs)
    db.add(vehicle)
    db.commit()
    db.refresh(vehicle)
    return vehicle


def _create_deal(db, session_id: str, vehicle_id: str, **kwargs) -> Deal:
    deal = Deal(session_id=session_id, vehicle_id=vehicle_id, **kwargs)
    db.add(deal)
    db.commit()
    db.refresh(deal)
    return deal


# ─── Vehicle creation ───


def test_create_primary_vehicle(db):
    """A primary vehicle can be created and linked to a session."""
    user = _create_user(db)
    session, _ = _create_session_with_deal_state(db, user)

    vehicle = _create_vehicle(
        db,
        session.id,
        role=VehicleRole.PRIMARY,
        year=2024,
        make="Honda",
        model="Civic",
        trim="EX",
    )

    assert vehicle.id is not None
    assert vehicle.session_id == session.id
    assert vehicle.role == VehicleRole.PRIMARY
    assert vehicle.year == 2024
    assert vehicle.make == "Honda"
    assert vehicle.model == "Civic"
    assert vehicle.trim == "EX"


def test_create_trade_in_vehicle(db):
    """A trade-in vehicle can be created with mileage."""
    user = _create_user(db)
    session, _ = _create_session_with_deal_state(db, user)

    vehicle = _create_vehicle(
        db,
        session.id,
        role=VehicleRole.TRADE_IN,
        year=2018,
        make="Toyota",
        model="Camry",
        mileage=85000,
    )

    assert vehicle.role == VehicleRole.TRADE_IN
    assert vehicle.mileage == 85000


def test_create_vehicle_with_all_fields(db):
    """Vehicle supports all optional fields: vin, mileage, color."""
    user = _create_user(db)
    session, _ = _create_session_with_deal_state(db, user)

    vehicle = _create_vehicle(
        db,
        session.id,
        role=VehicleRole.PRIMARY,
        year=2024,
        make="Ford",
        model="F-150",
        trim="Lariat",
        vin="1FTEW1EP5LFA12345",
        mileage=0,
        color="Blue",
    )

    assert vehicle.vin == "1FTEW1EP5LFA12345"
    assert vehicle.mileage == 0
    assert vehicle.color == "Blue"


def test_multiple_vehicles_per_session(db):
    """A session can have both a primary vehicle and a trade-in."""
    user = _create_user(db)
    session, _ = _create_session_with_deal_state(db, user)

    primary = _create_vehicle(
        db, session.id, role=VehicleRole.PRIMARY, make="Honda", model="Civic"
    )
    trade_in = _create_vehicle(
        db, session.id, role=VehicleRole.TRADE_IN, make="Toyota", model="Corolla"
    )

    vehicles = db.query(Vehicle).filter(Vehicle.session_id == session.id).all()
    assert len(vehicles) == 2
    roles = {v.role for v in vehicles}
    assert roles == {VehicleRole.PRIMARY, VehicleRole.TRADE_IN}
    assert primary.id != trade_in.id


# ─── Deal creation ───


def test_create_deal_with_vehicle_fk(db):
    """A deal is linked to a vehicle via FK."""
    user = _create_user(db)
    session, _ = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, session.id, make="Honda", model="Civic")

    deal = _create_deal(db, session.id, vehicle.id)

    assert deal.id is not None
    assert deal.session_id == session.id
    assert deal.vehicle_id == vehicle.id
    assert deal.phase == DealPhase.RESEARCH


def test_deal_defaults(db):
    """New deals have sensible defaults: research phase, no financial data."""
    user = _create_user(db)
    session, _ = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, session.id, make="Honda", model="Civic")

    deal = _create_deal(db, session.id, vehicle.id)

    assert deal.phase == DealPhase.RESEARCH
    assert deal.msrp is None
    assert deal.current_offer is None
    assert deal.apr is None
    assert deal.health_status is None
    assert deal.red_flags == []
    assert deal.information_gaps == []
    assert deal.first_offer is None
    assert deal.pre_fi_price is None
    assert deal.savings_estimate is None


def test_deal_with_financial_data(db):
    """A deal can store all financial fields."""
    user = _create_user(db)
    session, _ = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, session.id, make="Honda", model="Civic")

    deal = _create_deal(
        db,
        session.id,
        vehicle.id,
        msrp=35000,
        current_offer=32000,
        apr=4.5,
        loan_term_months=60,
        down_payment=5000,
        dealer_name="Metro Honda",
    )

    assert deal.msrp == 35000
    assert deal.current_offer == 32000
    assert deal.apr == 4.5
    assert deal.loan_term_months == 60
    assert deal.down_payment == 5000
    assert deal.dealer_name == "Metro Honda"


def test_multiple_deals_for_same_vehicle(db):
    """Same vehicle can have multiple deals (e.g., different dealers)."""
    user = _create_user(db)
    session, _ = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, session.id, make="Honda", model="Civic")

    deal1 = _create_deal(
        db, session.id, vehicle.id, dealer_name="Dealer A", current_offer=30000
    )
    deal2 = _create_deal(
        db, session.id, vehicle.id, dealer_name="Dealer B", current_offer=29500
    )

    deals = db.query(Deal).filter(Deal.vehicle_id == vehicle.id).all()
    assert len(deals) == 2
    assert {d.dealer_name for d in deals} == {"Dealer A", "Dealer B"}
    assert deal1.id != deal2.id


# ─── DealState.active_deal_id tracking ───


def test_deal_state_active_deal_id_tracking(db):
    """active_deal_id on DealState points to the currently focused deal."""
    user = _create_user(db)
    session, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, session.id, make="Honda", model="Civic")

    deal1 = _create_deal(db, session.id, vehicle.id, dealer_name="Dealer A")
    deal_state.active_deal_id = deal1.id
    db.commit()
    db.refresh(deal_state)

    assert deal_state.active_deal_id == deal1.id

    deal2 = _create_deal(db, session.id, vehicle.id, dealer_name="Dealer B")
    deal_state.active_deal_id = deal2.id
    db.commit()
    db.refresh(deal_state)

    assert deal_state.active_deal_id == deal2.id


def test_deal_state_active_deal_id_starts_null(db):
    """New DealState has no active deal."""
    user = _create_user(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    assert deal_state.active_deal_id is None


# ─── Cascade deletes ───


def test_cascade_delete_session_removes_vehicles(db):
    """Deleting a session cascades to its vehicles."""
    user = _create_user(db)
    session, _ = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, session.id, make="Honda", model="Civic")
    vehicle_id = vehicle.id

    db.delete(session)
    db.commit()

    assert db.query(Vehicle).filter(Vehicle.id == vehicle_id).first() is None


def test_cascade_delete_session_removes_deals(db):
    """Deleting a session cascades to its deals."""
    user = _create_user(db)
    session, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, session.id, make="Honda", model="Civic")
    deal = _create_deal(db, session.id, vehicle.id)
    deal_id = deal.id

    # Must clear active_deal_id to avoid FK constraint issue on delete
    deal_state.active_deal_id = None
    db.commit()

    db.delete(session)
    db.commit()

    assert db.query(Deal).filter(Deal.id == deal_id).first() is None


def test_cascade_delete_session_removes_vehicles_and_deals(db):
    """Full cascade: deleting a session removes deal_state, vehicles, and deals."""
    user = _create_user(db)
    session, deal_state = _create_session_with_deal_state(db, user)
    session_id = session.id

    v1 = _create_vehicle(db, session_id, role=VehicleRole.PRIMARY, make="Honda")
    _create_vehicle(db, session_id, role=VehicleRole.TRADE_IN, make="Toyota")
    _create_deal(db, session_id, v1.id, dealer_name="Dealer A")
    _create_deal(db, session_id, v1.id, dealer_name="Dealer B")

    # Clear active deal FK before delete
    deal_state.active_deal_id = None
    db.commit()

    db.delete(session)
    db.commit()

    assert db.query(DealState).filter(DealState.session_id == session_id).count() == 0
    assert db.query(Vehicle).filter(Vehicle.session_id == session_id).count() == 0
    assert db.query(Deal).filter(Deal.session_id == session_id).count() == 0


# ─── Deal health and red flags on Deal model ───


def test_deal_health_fields(db):
    """Deal stores health_status, health_summary, recommendation."""
    user = _create_user(db)
    session, _ = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, session.id, make="Honda", model="Civic")
    deal = _create_deal(db, session.id, vehicle.id)

    deal.health_status = "good"
    deal.health_summary = "Below market price"
    deal.recommendation = "Accept the offer"
    db.commit()
    db.refresh(deal)

    assert deal.health_status == "good"
    assert deal.health_summary == "Below market price"
    assert deal.recommendation == "Accept the offer"


def test_deal_red_flags_and_info_gaps(db):
    """Deal stores red_flags and information_gaps as JSON arrays."""
    user = _create_user(db)
    session, _ = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, session.id, make="Honda", model="Civic")
    deal = _create_deal(db, session.id, vehicle.id)

    deal.red_flags = [
        {"id": "apr_high", "severity": "critical", "message": "9.5% APR is very high"}
    ]
    deal.information_gaps = [
        {"label": "Credit score", "reason": "Needed", "priority": "high"}
    ]
    db.commit()
    db.refresh(deal)

    assert len(deal.red_flags) == 1
    assert deal.red_flags[0]["id"] == "apr_high"
    assert len(deal.information_gaps) == 1
    assert deal.information_gaps[0]["label"] == "Credit score"


# ─── DealState session-level fields ───


def test_deal_state_session_level_fields(db):
    """DealState stores session-level fields: red_flags, information_gaps, checklist, ai_panel_cards."""
    user = _create_user(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    deal_state.red_flags = [
        {"id": "no_preapproval", "severity": "warning", "message": "Not pre-approved"}
    ]
    deal_state.information_gaps = [
        {"label": "Budget", "reason": "Needed", "priority": "medium"}
    ]
    deal_state.checklist = [{"label": "Get pre-approved", "done": False}]
    deal_state.ai_panel_cards = [{"type": "hero", "data": {}}]
    db.commit()
    db.refresh(deal_state)

    assert len(deal_state.red_flags) == 1
    assert len(deal_state.information_gaps) == 1
    assert len(deal_state.checklist) == 1
    assert len(deal_state.ai_panel_cards) == 1


def test_deal_state_deal_comparison(db):
    """DealState stores deal_comparison as JSON."""
    user = _create_user(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    deal_state.deal_comparison = {
        "deals": ["deal1", "deal2"],
        "winner": "deal1",
        "reasoning": "Lower APR",
    }
    db.commit()
    db.refresh(deal_state)

    assert deal_state.deal_comparison["winner"] == "deal1"


# ─── Vehicle intelligence cascade deletes ───


def test_cascade_delete_vehicle_removes_decodes(db):
    """Deleting a vehicle cascades to its VehicleDecode children (delete-orphan)."""
    user = _create_user(db)
    session, _ = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(
        db, session.id, make="Honda", model="Civic", vin="1HGBH41JXMN109186"
    )

    decode = VehicleDecode(
        vehicle_id=vehicle.id,
        provider=IntelligenceProvider.NHTSA_VPIC,
        status=IntelligenceStatus.SUCCESS,
        vin="1HGBH41JXMN109186",
        year=2024,
        make="Honda",
        model="Civic",
    )
    db.add(decode)
    db.commit()
    decode_id = decode.id

    assert (
        db.query(VehicleDecode).filter(VehicleDecode.id == decode_id).first()
        is not None
    )

    db.delete(vehicle)
    db.commit()

    assert db.query(VehicleDecode).filter(VehicleDecode.id == decode_id).first() is None


def test_cascade_delete_vehicle_removes_history_reports(db):
    """Deleting a vehicle cascades to its VehicleHistoryReport children."""
    user = _create_user(db)
    session, _ = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(
        db, session.id, make="Honda", model="Civic", vin="1HGBH41JXMN109186"
    )

    report = VehicleHistoryReport(
        vehicle_id=vehicle.id,
        provider=IntelligenceProvider.VINAUDIT,
        status=IntelligenceStatus.SUCCESS,
        vin="1HGBH41JXMN109186",
    )
    db.add(report)
    db.commit()
    report_id = report.id

    db.delete(vehicle)
    db.commit()

    assert (
        db.query(VehicleHistoryReport)
        .filter(VehicleHistoryReport.id == report_id)
        .first()
        is None
    )


def test_cascade_delete_vehicle_removes_valuations(db):
    """Deleting a vehicle cascades to its VehicleValuation children."""
    user = _create_user(db)
    session, _ = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(
        db, session.id, make="Honda", model="Civic", vin="1HGBH41JXMN109186"
    )

    valuation = VehicleValuation(
        vehicle_id=vehicle.id,
        provider=IntelligenceProvider.VINAUDIT,
        status=IntelligenceStatus.SUCCESS,
        vin="1HGBH41JXMN109186",
        amount=25000.0,
    )
    db.add(valuation)
    db.commit()
    valuation_id = valuation.id

    db.delete(vehicle)
    db.commit()

    assert (
        db.query(VehicleValuation).filter(VehicleValuation.id == valuation_id).first()
        is None
    )


def test_cascade_delete_session_removes_vehicle_intelligence(db):
    """Full cascade: deleting a session removes vehicles and their intelligence children."""
    user = _create_user(db)
    session, _ = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(
        db, session.id, make="Honda", model="Civic", vin="1HGBH41JXMN109186"
    )

    decode = VehicleDecode(
        vehicle_id=vehicle.id,
        provider=IntelligenceProvider.NHTSA_VPIC,
        status=IntelligenceStatus.SUCCESS,
        vin="1HGBH41JXMN109186",
    )
    report = VehicleHistoryReport(
        vehicle_id=vehicle.id,
        provider=IntelligenceProvider.VINAUDIT,
        status=IntelligenceStatus.SUCCESS,
        vin="1HGBH41JXMN109186",
    )
    valuation = VehicleValuation(
        vehicle_id=vehicle.id,
        provider=IntelligenceProvider.VINAUDIT,
        status=IntelligenceStatus.SUCCESS,
        vin="1HGBH41JXMN109186",
        amount=25000.0,
    )
    db.add_all([decode, report, valuation])
    db.commit()

    session_id = session.id
    db.delete(session)
    db.commit()

    assert db.query(Vehicle).filter(Vehicle.session_id == session_id).count() == 0
    assert (
        db.query(VehicleDecode).filter(VehicleDecode.vehicle_id == vehicle.id).count()
        == 0
    )
    assert (
        db.query(VehicleHistoryReport)
        .filter(VehicleHistoryReport.vehicle_id == vehicle.id)
        .count()
        == 0
    )
    assert (
        db.query(VehicleValuation)
        .filter(VehicleValuation.vehicle_id == vehicle.id)
        .count()
        == 0
    )
