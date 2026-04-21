"""Tests for the execute_tool dispatcher and analyze_deal."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.models.deal import Deal
from app.models.deal_state import DealState
from app.models.enums import BuyerContext, DealPhase, HealthStatus, VehicleRole
from app.models.vehicle import Vehicle
from app.services.deal_state import execute_tool
from app.services.tool_validation import ToolValidationError
from app.services.turn_context import TurnContext
from sqlalchemy import select

# ─── execute_tool: standard tools ───


async def test_execute_tool_set_vehicle(adb, async_buyer_user):
    """set_vehicle creates a new vehicle via apply_extraction."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=async_buyer_user.id, title="Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()

    result = await execute_tool(
        "set_vehicle",
        {"role": "primary", "make": "Toyota", "model": "Camry", "year": 2024},
        TurnContext.create(session=session, deal_state=deal_state, db=adb),
    )

    # Should return tool calls including set_vehicle and possibly create_deal
    tool_names = [tc["name"] for tc in result]
    assert "set_vehicle" in tool_names
    # Auto-create deal for first primary vehicle
    assert "create_deal" in tool_names
    create_tc = next(tc for tc in result if tc["name"] == "create_deal")
    assert create_tc["args"].get("make_active") is True

    # Verify vehicle was created in DB
    vehicle = (
        await adb.execute(select(Vehicle).where(Vehicle.session_id == session.id))
    ).scalar_one_or_none()
    assert vehicle is not None
    assert vehicle.make == "Toyota"
    assert vehicle.model == "Camry"


async def test_execute_tool_update_deal_numbers(adb, async_buyer_user):
    """update_deal_numbers updates financial figures on the active deal."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=async_buyer_user.id, title="Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()

    vehicle = Vehicle(session_id=session.id, role=VehicleRole.PRIMARY)
    adb.add(vehicle)
    await adb.flush()
    deal = Deal(session_id=session.id, vehicle_id=vehicle.id)
    adb.add(deal)
    await adb.flush()
    deal_state.active_deal_id = deal.id

    result = await execute_tool(
        "update_deal_numbers",
        {"listing_price": 34000, "current_offer": 33500},
        TurnContext.create(session=session, deal_state=deal_state, db=adb),
    )

    tool_names = [tc["name"] for tc in result]
    assert "update_deal_numbers" in tool_names
    assert deal.listing_price == 34000
    assert deal.current_offer == 33500


async def test_execute_tool_set_buyer_targets_updates_target_and_walkaway(
    adb, async_buyer_user
):
    """set_buyer_targets writes buyer target fields only; applied_tools reports set_buyer_targets."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=async_buyer_user.id, title="Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()

    vehicle = Vehicle(session_id=session.id, role=VehicleRole.PRIMARY)
    adb.add(vehicle)
    await adb.flush()
    deal = Deal(
        session_id=session.id,
        vehicle_id=vehicle.id,
        listing_price=40000,
        current_offer=39500,
    )
    adb.add(deal)
    await adb.flush()
    deal_state.active_deal_id = deal.id

    result = await execute_tool(
        "set_buyer_targets",
        {"your_target": 36000, "walk_away_price": 37500},
        TurnContext.create(session=session, deal_state=deal_state, db=adb),
    )

    tool_names = [tc["name"] for tc in result]
    assert "set_buyer_targets" in tool_names
    assert deal.your_target == 36000
    assert deal.walk_away_price == 37500
    # Pre-existing dealer-side fields must NOT be touched by set_buyer_targets.
    assert deal.listing_price == 40000
    assert deal.current_offer == 39500


async def test_execute_tool_set_buyer_targets_rejects_out_of_range(
    adb, async_buyer_user
):
    """set_buyer_targets shares update_deal_numbers validation (range, type)."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=async_buyer_user.id, title="Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()

    vehicle = Vehicle(session_id=session.id, role=VehicleRole.PRIMARY)
    adb.add(vehicle)
    await adb.flush()
    deal = Deal(session_id=session.id, vehicle_id=vehicle.id)
    adb.add(deal)
    await adb.flush()
    deal_state.active_deal_id = deal.id

    with pytest.raises(ToolValidationError, match="cannot be negative"):
        await execute_tool(
            "set_buyer_targets",
            {"your_target": -1000},
            TurnContext.create(session=session, deal_state=deal_state, db=adb),
        )


async def test_execute_tool_set_buyer_targets_errors_without_active_deal(
    adb, async_buyer_user
):
    """set_buyer_targets is deal-scoped — no active deal is a validation error."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=async_buyer_user.id, title="Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()

    with pytest.raises(ToolValidationError, match="no target deal"):
        await execute_tool(
            "set_buyer_targets",
            {"your_target": 30000},
            TurnContext.create(session=session, deal_state=deal_state, db=adb),
        )


async def test_execute_tool_rejects_negative_listing_price(adb, async_buyer_user):
    """Negative deal numbers fail semantic validation before DB write."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=async_buyer_user.id, title="Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()

    vehicle = Vehicle(session_id=session.id, role=VehicleRole.PRIMARY)
    adb.add(vehicle)
    await adb.flush()
    deal = Deal(session_id=session.id, vehicle_id=vehicle.id)
    adb.add(deal)
    await adb.flush()
    deal_state.active_deal_id = deal.id

    with pytest.raises(ToolValidationError, match="cannot be negative"):
        await execute_tool(
            "update_deal_numbers",
            {"listing_price": -100},
            TurnContext.create(session=session, deal_state=deal_state, db=adb),
        )


async def test_execute_tool_rejects_phase_regression(adb, async_buyer_user):
    """Phase cannot move backward relative to persisted deal phase."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=async_buyer_user.id, title="Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()

    vehicle = Vehicle(session_id=session.id, role=VehicleRole.PRIMARY)
    adb.add(vehicle)
    await adb.flush()
    deal = Deal(
        session_id=session.id,
        vehicle_id=vehicle.id,
        phase=DealPhase.NEGOTIATION,
    )
    adb.add(deal)
    await adb.flush()
    deal_state.active_deal_id = deal.id

    with pytest.raises(ToolValidationError, match="cannot move backward"):
        await execute_tool(
            "update_deal_phase",
            {"phase": DealPhase.INITIAL_CONTACT},
            TurnContext.create(session=session, deal_state=deal_state, db=adb),
        )


async def test_execute_tool_rejects_health_without_numbers(adb, async_buyer_user):
    """Health assessment requires at least one extracted number on the deal."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=async_buyer_user.id, title="Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()

    vehicle = Vehicle(session_id=session.id, role=VehicleRole.PRIMARY)
    adb.add(vehicle)
    await adb.flush()
    deal = Deal(session_id=session.id, vehicle_id=vehicle.id)
    adb.add(deal)
    await adb.flush()
    deal_state.active_deal_id = deal.id

    with pytest.raises(ToolValidationError, match="Set at least one deal number"):
        await execute_tool(
            "update_deal_health",
            {
                "status": "good",
                "summary": "Looks fine",
                "recommendation": "Keep negotiating",
            },
            TurnContext.create(session=session, deal_state=deal_state, db=adb),
        )


async def test_execute_tool_update_deal_health_with_vehicle_mileage_only(
    adb, async_buyer_user
):
    """Health may reflect pasted history when odometer is known but no dollar fields yet."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=async_buyer_user.id, title="Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()

    vehicle = Vehicle(
        session_id=session.id, role=VehicleRole.CANDIDATE, mileage=141_786
    )
    adb.add(vehicle)
    await adb.flush()
    deal = Deal(session_id=session.id, vehicle_id=vehicle.id)
    adb.add(deal)
    await adb.flush()
    deal_state.active_deal_id = deal.id

    result = await execute_tool(
        "update_deal_health",
        {
            "status": "concerning",
            "summary": "CARFAX shows auction churn; asking price still unknown.",
            "recommendation": "Get listing price and a PPI before committing.",
        },
        TurnContext.create(session=session, deal_state=deal_state, db=adb),
    )
    assert any(tc["name"] == "update_deal_health" for tc in result)
    assert deal.health_status == HealthStatus.CONCERNING


async def test_execute_tool_update_deal_health_with_numbers(adb, async_buyer_user):
    """Health tool succeeds when the deal has numeric context."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=async_buyer_user.id, title="Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()

    vehicle = Vehicle(session_id=session.id, role=VehicleRole.PRIMARY)
    adb.add(vehicle)
    await adb.flush()
    deal = Deal(
        session_id=session.id,
        vehicle_id=vehicle.id,
        listing_price=30000,
    )
    adb.add(deal)
    await adb.flush()
    deal_state.active_deal_id = deal.id

    result = await execute_tool(
        "update_deal_health",
        {
            "status": "good",
            "summary": "Below listing",
            "recommendation": "Counter slightly lower",
        },
        TurnContext.create(session=session, deal_state=deal_state, db=adb),
    )
    assert any(tc["name"] == "update_deal_health" for tc in result)
    assert deal.health_status == HealthStatus.GOOD


async def test_execute_tool_negotiation_context(adb, async_buyer_user):
    """update_negotiation_context applies directly to deal_state."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=async_buyer_user.id, title="Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()

    context = {"stance": "firm", "situation": "Waiting for callback"}
    result = await execute_tool(
        "update_negotiation_context",
        context,
        TurnContext.create(session=session, deal_state=deal_state, db=adb),
    )

    assert len(result) == 1
    assert result[0]["name"] == "update_negotiation_context"
    assert deal_state.negotiation_context == context


async def test_execute_tool_scalar_phase(adb, async_buyer_user):
    """update_deal_phase updates the active deal's phase."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=async_buyer_user.id, title="Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()

    vehicle = Vehicle(session_id=session.id, role=VehicleRole.PRIMARY)
    adb.add(vehicle)
    await adb.flush()
    deal = Deal(session_id=session.id, vehicle_id=vehicle.id)
    adb.add(deal)
    await adb.flush()
    deal_state.active_deal_id = deal.id

    result = await execute_tool(
        "update_deal_phase",
        {"phase": DealPhase.NEGOTIATION},
        TurnContext.create(session=session, deal_state=deal_state, db=adb),
    )

    tool_names = [tc["name"] for tc in result]
    assert "update_deal_phase" in tool_names
    assert deal.phase == DealPhase.NEGOTIATION


async def test_execute_tool_scalar_buyer_context(adb, async_buyer_user):
    """update_buyer_context updates the deal_state buyer context."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=async_buyer_user.id, title="Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()

    result = await execute_tool(
        "update_buyer_context",
        {"buyer_context": "at_dealership"},
        TurnContext.create(session=session, deal_state=deal_state, db=adb),
    )

    tool_names = [tc["name"] for tc in result]
    assert "update_buyer_context" in tool_names
    assert deal_state.buyer_context == BuyerContext.AT_DEALERSHIP


async def test_execute_tool_unknown_tool(adb, async_buyer_user):
    """Unknown tool name returns empty list."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=async_buyer_user.id, title="Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()

    result = await execute_tool(
        "nonexistent_tool",
        {},
        TurnContext.create(session=session, deal_state=deal_state, db=adb),
    )
    assert result == []


async def test_execute_tool_returns_empty_when_deal_state_none(adb):
    """execute_tool returns empty list when context.deal_state is None."""
    result = await execute_tool(
        "update_deal_numbers",
        {"listing_price": 30000},
        TurnContext.create(session=None, deal_state=None, db=adb),
    )
    assert result == []


# ─── analyze_deal (mocked API) ───


@patch("app.services.deal_analysis.create_anthropic_client")
async def test_analyze_deal_returns_tool_input(mock_create_client):
    """analyze_deal returns the tool input from the API response."""
    from app.services.deal_analysis import analyze_deal

    tool_result = {
        "health": {"status": "concerning", "summary": "Test", "recommendation": "Act"},
        "deal_red_flags": {
            "flags": [{"id": "rf1", "severity": "warning", "message": "Flag"}]
        },
    }
    mock_tool_block = MagicMock()
    mock_tool_block.type = "tool_use"
    mock_tool_block.name = "analyze_deal"
    mock_tool_block.input = tool_result

    mock_response = MagicMock()
    mock_response.content = [mock_tool_block]
    mock_response.usage = MagicMock(
        cache_creation_input_tokens=0,
        cache_read_input_tokens=0,
        input_tokens=100,
    )

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_response)
    mock_create_client.return_value = mock_client

    result = await analyze_deal(
        {"buyer_context": "at_dealership", "vehicles": [], "deals": []},
        [{"role": "user", "content": "test"}],
        "test response",
    )
    assert result == tool_result


@patch("app.services.deal_analysis.create_anthropic_client")
async def test_analyze_deal_no_tool_call(mock_create_client):
    """analyze_deal returns empty dict if model doesn't call tool."""
    from app.services.deal_analysis import analyze_deal

    mock_text_block = MagicMock()
    mock_text_block.type = "text"
    mock_text_block.text = "No assessment changes needed."

    mock_response = MagicMock()
    mock_response.content = [mock_text_block]
    mock_response.usage = MagicMock(
        cache_creation_input_tokens=0,
        cache_read_input_tokens=0,
        input_tokens=100,
    )

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_response)
    mock_create_client.return_value = mock_client

    result = await analyze_deal(
        {"buyer_context": "researching", "vehicles": [], "deals": []},
        [{"role": "user", "content": "test"}],
        "test response",
    )
    assert result == {}


@patch("app.services.deal_analysis.create_anthropic_client")
async def test_analyze_deal_handles_api_error(mock_create_client):
    """analyze_deal returns empty dict on API exception."""
    from app.services.deal_analysis import analyze_deal

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(side_effect=Exception("API error"))
    mock_create_client.return_value = mock_client

    result = await analyze_deal(
        {"buyer_context": "researching", "vehicles": [], "deals": []},
        [{"role": "user", "content": "test"}],
        "test response",
    )
    assert result == {}


# ─── tool_validation unit tests (pure, no DB) ───


def test_validate_deal_numbers_rejects_apr_over_max():
    """APR above 35 is rejected."""
    from app.services.tool_validation import _validate_update_deal_numbers

    with pytest.raises(ToolValidationError, match="apr must be between"):
        _validate_update_deal_numbers({"apr": 40.0})


def test_validate_deal_numbers_rejects_negative_apr():
    """Negative APR is rejected."""
    from app.services.tool_validation import _validate_update_deal_numbers

    with pytest.raises(ToolValidationError, match="apr must be between"):
        _validate_update_deal_numbers({"apr": -1.0})


def test_validate_deal_numbers_accepts_valid_apr():
    """Valid APR within range passes."""
    from app.services.tool_validation import _validate_update_deal_numbers

    _validate_update_deal_numbers({"apr": 4.9})  # should not raise


def test_validate_deal_numbers_rejects_loan_term_too_high():
    """Loan term above 120 months is rejected."""
    from app.services.tool_validation import _validate_update_deal_numbers

    with pytest.raises(ToolValidationError, match="loan_term_months must be between"):
        _validate_update_deal_numbers({"loan_term_months": 240})


def test_validate_deal_numbers_rejects_loan_term_zero():
    """Loan term of 0 is rejected."""
    from app.services.tool_validation import _validate_update_deal_numbers

    with pytest.raises(ToolValidationError, match="loan_term_months must be between"):
        _validate_update_deal_numbers({"loan_term_months": 0})


def test_validate_deal_numbers_rejects_loan_term_bool():
    """Boolean loan_term_months is rejected (bool is subclass of int)."""
    from app.services.tool_validation import _validate_update_deal_numbers

    with pytest.raises(ToolValidationError, match="must be an integer"):
        _validate_update_deal_numbers({"loan_term_months": True})


def test_validate_deal_numbers_rejects_unrealistically_large_price():
    """Prices above 50M are rejected."""
    from app.services.tool_validation import _validate_update_deal_numbers

    with pytest.raises(ToolValidationError, match="unrealistically large"):
        _validate_update_deal_numbers({"listing_price": 100_000_000})


def test_validate_deal_numbers_rejects_string_money_field():
    """String value for a money field is rejected."""
    from app.services.tool_validation import _validate_update_deal_numbers

    with pytest.raises(ToolValidationError, match="must be a number"):
        _validate_update_deal_numbers({"msrp": "thirty thousand"})


def test_validate_deal_numbers_skips_deal_id_and_none():
    """deal_id and None values are skipped without error."""
    from app.services.tool_validation import _validate_update_deal_numbers

    _validate_update_deal_numbers(
        {"deal_id": "some-id", "listing_price": None, "msrp": 30000}
    )  # should not raise


# ─── active-deal resolution invariants ───


async def test_get_active_deal_falls_back_to_sole_deal(adb, async_buyer_user):
    """When active_deal_id is None but exactly one deal exists, promote it."""
    from app.models.session import ChatSession
    from app.services.deal_state import get_active_deal

    session = ChatSession(user_id=async_buyer_user.id, title="Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()
    vehicle = Vehicle(session_id=session.id, role=VehicleRole.PRIMARY)
    adb.add(vehicle)
    await adb.flush()
    deal = Deal(session_id=session.id, vehicle_id=vehicle.id)
    adb.add(deal)
    await adb.flush()
    # Intentionally leave active_deal_id unset — this is the bug scenario.
    assert deal_state.active_deal_id is None

    resolved = await get_active_deal(deal_state, adb)

    assert resolved is not None
    assert resolved.id == deal.id
    # Promotion persists so subsequent calls don't re-run the fallback scan.
    assert deal_state.active_deal_id == deal.id


async def test_get_active_deal_returns_none_when_multiple_deals_unambiguated(
    adb, async_buyer_user
):
    """With 2+ deals and no active set, caller must pick — don't auto-promote."""
    from app.models.session import ChatSession
    from app.services.deal_state import get_active_deal

    session = ChatSession(user_id=async_buyer_user.id, title="Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()
    vehicle1 = Vehicle(session_id=session.id, role=VehicleRole.PRIMARY)
    vehicle2 = Vehicle(session_id=session.id, role=VehicleRole.CANDIDATE)
    adb.add_all([vehicle1, vehicle2])
    await adb.flush()
    adb.add_all(
        [
            Deal(session_id=session.id, vehicle_id=vehicle1.id),
            Deal(session_id=session.id, vehicle_id=vehicle2.id),
        ]
    )
    await adb.flush()

    resolved = await get_active_deal(deal_state, adb)

    assert resolved is None
    assert deal_state.active_deal_id is None  # not auto-picked


async def test_set_vehicle_promotes_new_deal_when_active_is_unset(
    adb, async_buyer_user
):
    """If active_deal_id is None when a second deal is created, promote it."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=async_buyer_user.id, title="Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()
    # Simulate the broken state: a deal exists but is not active.
    orphan_vehicle = Vehicle(session_id=session.id, role=VehicleRole.PRIMARY)
    adb.add(orphan_vehicle)
    await adb.flush()
    orphan_deal = Deal(session_id=session.id, vehicle_id=orphan_vehicle.id)
    adb.add(orphan_deal)
    await adb.flush()
    assert deal_state.active_deal_id is None

    # Add a second vehicle via set_vehicle — its auto-created deal should be
    # promoted to active so the invariant holds.
    result = await execute_tool(
        "set_vehicle",
        {"role": "candidate", "make": "Ford", "model": "F-250", "year": 2024},
        TurnContext.create(session=session, deal_state=deal_state, db=adb),
    )
    create_call = next(call for call in result if call["name"] == "create_deal")
    assert create_call["args"]["make_active"] is True
    assert deal_state.active_deal_id == create_call["args"]["deal_id"]


async def test_remove_vehicle_promotes_sole_remaining_deal(adb, async_buyer_user):
    """After removing the active vehicle, sole remaining deal auto-promotes."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=async_buyer_user.id, title="Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()
    v_active = Vehicle(session_id=session.id, role=VehicleRole.PRIMARY)
    v_keep = Vehicle(session_id=session.id, role=VehicleRole.CANDIDATE)
    adb.add_all([v_active, v_keep])
    await adb.flush()
    d_active = Deal(session_id=session.id, vehicle_id=v_active.id)
    d_keep = Deal(session_id=session.id, vehicle_id=v_keep.id)
    adb.add_all([d_active, d_keep])
    await adb.flush()
    deal_state.active_deal_id = d_active.id

    await execute_tool(
        "remove_vehicle",
        {"vehicle_id": v_active.id},
        TurnContext.create(session=session, deal_state=deal_state, db=adb),
    )

    assert deal_state.active_deal_id == d_keep.id


async def test_update_deal_custom_numbers_replaces_custom_numbers_list(
    adb, async_buyer_user
):
    """update_deal_custom_numbers replaces the full custom_numbers list on the active deal."""
    from app.models.session import ChatSession
    from sqlalchemy import select

    session = ChatSession(user_id=async_buyer_user.id, title="Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()
    vehicle = Vehicle(session_id=session.id, role=VehicleRole.PRIMARY)
    adb.add(vehicle)
    await adb.flush()
    deal = Deal(session_id=session.id, vehicle_id=vehicle.id)
    adb.add(deal)
    await adb.flush()
    deal_state.active_deal_id = deal.id

    rows = [
        {"label": "Doc fee", "value": "$899", "highlight": "neutral"},
        {"label": "Dealer prep fee", "value": "$1,995", "highlight": "bad"},
    ]
    result = await execute_tool(
        "update_deal_custom_numbers",
        {"rows": rows},
        TurnContext.create(session=session, deal_state=deal_state, db=adb),
    )

    assert [call["name"] for call in result] == ["update_deal_custom_numbers"]
    assert result[0]["args"]["rows"] == rows

    refreshed = (await adb.execute(select(Deal).where(Deal.id == deal.id))).scalar_one()
    assert refreshed.custom_numbers == rows

    # Subsequent call with a different list replaces rather than appending.
    next_rows = [{"label": "Tax", "value": "$3,200"}]
    await execute_tool(
        "update_deal_custom_numbers",
        {"rows": next_rows},
        TurnContext.create(session=session, deal_state=deal_state, db=adb),
    )
    refreshed = (await adb.execute(select(Deal).where(Deal.id == deal.id))).scalar_one()
    # "Tax" entry survives; highlight wasn't passed so it's not on the row.
    assert refreshed.custom_numbers == [{"label": "Tax", "value": "$3,200"}]


async def test_update_deal_custom_numbers_errors_without_active_deal(
    adb, async_buyer_user
):
    """Deal-scoped validation blocks custom-numbers update when no deal is resolvable."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=async_buyer_user.id, title="Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()

    with pytest.raises(ToolValidationError, match="no target deal"):
        await execute_tool(
            "update_deal_custom_numbers",
            {"rows": [{"label": "Doc fee", "value": "$899"}]},
            TurnContext.create(session=session, deal_state=deal_state, db=adb),
        )


async def test_deal_scoped_tool_errors_when_no_deal_exists(adb, async_buyer_user):
    """All deal-scoped tools must surface a ToolValidationError, not silent no-op."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=async_buyer_user.id, title="Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()
    # No deals in this session at all.

    for tool_name, tool_input in (
        ("update_deal_numbers", {"current_offer": 30000}),
        ("update_deal_red_flags", {"flags": []}),
        (
            "update_deal_information_gaps",
            {"gaps": [{"label": "x", "reason": "y", "priority": "high"}]},
        ),
        (
            "update_scorecard",
            {
                "price": "green",
                "financing": "green",
                "trade_in": "green",
                "fees": "green",
            },
        ),
    ):
        with pytest.raises(ToolValidationError, match="no target deal"):
            await execute_tool(
                tool_name,
                tool_input,
                TurnContext.create(session=session, deal_state=deal_state, db=adb),
            )
