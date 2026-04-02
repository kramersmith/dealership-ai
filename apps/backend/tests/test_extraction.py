"""Tests for the execute_tool dispatcher and analyze_deal."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.models.deal import Deal
from app.models.deal_state import DealState
from app.models.enums import BuyerContext, DealPhase, VehicleRole
from app.models.vehicle import Vehicle
from app.services.deal_state import execute_tool

# ─── execute_tool: standard tools ───


def test_execute_tool_set_vehicle(db, buyer_user):
    """set_vehicle creates a new vehicle via apply_extraction."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=buyer_user.id, title="Test")
    db.add(session)
    db.flush()
    deal_state = DealState(session_id=session.id)
    db.add(deal_state)
    db.flush()

    result = execute_tool(
        "set_vehicle",
        {"role": "primary", "make": "Toyota", "model": "Camry", "year": 2024},
        deal_state,
        db,
    )

    # Should return tool calls including set_vehicle and possibly create_deal
    tool_names = [tc["name"] for tc in result]
    assert "set_vehicle" in tool_names
    # Auto-create deal for first primary vehicle
    assert "create_deal" in tool_names

    # Verify vehicle was created in DB
    vehicle = db.query(Vehicle).filter(Vehicle.session_id == session.id).first()
    assert vehicle is not None
    assert vehicle.make == "Toyota"
    assert vehicle.model == "Camry"


def test_execute_tool_update_deal_numbers(db, buyer_user):
    """update_deal_numbers updates financial figures on the active deal."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=buyer_user.id, title="Test")
    db.add(session)
    db.flush()
    deal_state = DealState(session_id=session.id)
    db.add(deal_state)
    db.flush()

    vehicle = Vehicle(session_id=session.id, role=VehicleRole.PRIMARY)
    db.add(vehicle)
    db.flush()
    deal = Deal(session_id=session.id, vehicle_id=vehicle.id)
    db.add(deal)
    db.flush()
    deal_state.active_deal_id = deal.id

    result = execute_tool(
        "update_deal_numbers",
        {"listing_price": 34000, "current_offer": 33500},
        deal_state,
        db,
    )

    tool_names = [tc["name"] for tc in result]
    assert "update_deal_numbers" in tool_names
    assert deal.listing_price == 34000
    assert deal.current_offer == 33500


def test_execute_tool_negotiation_context(db, buyer_user):
    """update_negotiation_context applies directly to deal_state."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=buyer_user.id, title="Test")
    db.add(session)
    db.flush()
    deal_state = DealState(session_id=session.id)
    db.add(deal_state)
    db.flush()

    context = {"stance": "firm", "situation": "Waiting for callback"}
    result = execute_tool("update_negotiation_context", context, deal_state, db)

    assert len(result) == 1
    assert result[0]["name"] == "update_negotiation_context"
    assert deal_state.negotiation_context == context


def test_execute_tool_scalar_phase(db, buyer_user):
    """update_deal_phase updates the active deal's phase."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=buyer_user.id, title="Test")
    db.add(session)
    db.flush()
    deal_state = DealState(session_id=session.id)
    db.add(deal_state)
    db.flush()

    vehicle = Vehicle(session_id=session.id, role=VehicleRole.PRIMARY)
    db.add(vehicle)
    db.flush()
    deal = Deal(session_id=session.id, vehicle_id=vehicle.id)
    db.add(deal)
    db.flush()
    deal_state.active_deal_id = deal.id

    result = execute_tool(
        "update_deal_phase",
        {"phase": DealPhase.NEGOTIATION},
        deal_state,
        db,
    )

    tool_names = [tc["name"] for tc in result]
    assert "update_deal_phase" in tool_names
    assert deal.phase == DealPhase.NEGOTIATION


def test_execute_tool_scalar_buyer_context(db, buyer_user):
    """update_buyer_context updates the deal_state buyer context."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=buyer_user.id, title="Test")
    db.add(session)
    db.flush()
    deal_state = DealState(session_id=session.id)
    db.add(deal_state)
    db.flush()

    result = execute_tool(
        "update_buyer_context",
        {"buyer_context": "at_dealership"},
        deal_state,
        db,
    )

    tool_names = [tc["name"] for tc in result]
    assert "update_buyer_context" in tool_names
    assert deal_state.buyer_context == BuyerContext.AT_DEALERSHIP


def test_execute_tool_unknown_tool(db, buyer_user):
    """Unknown tool name returns empty list."""
    from app.models.session import ChatSession

    session = ChatSession(user_id=buyer_user.id, title="Test")
    db.add(session)
    db.flush()
    deal_state = DealState(session_id=session.id)
    db.add(deal_state)
    db.flush()

    result = execute_tool("nonexistent_tool", {}, deal_state, db)
    assert result == []


# ─── analyze_deal (mocked API) ───


@pytest.mark.asyncio
@patch("app.services.deal_analysis.anthropic.AsyncAnthropic")
async def test_analyze_deal_returns_tool_input(mock_anthropic_class):
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
    mock_anthropic_class.return_value = mock_client

    result = await analyze_deal(
        {"buyer_context": "at_dealership", "vehicles": [], "deals": []},
        [{"role": "user", "content": "test"}],
        "test response",
    )
    assert result == tool_result


@pytest.mark.asyncio
@patch("app.services.deal_analysis.anthropic.AsyncAnthropic")
async def test_analyze_deal_no_tool_call(mock_anthropic_class):
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
    mock_anthropic_class.return_value = mock_client

    result = await analyze_deal(
        {"buyer_context": "researching", "vehicles": [], "deals": []},
        [{"role": "user", "content": "test"}],
        "test response",
    )
    assert result == {}


@pytest.mark.asyncio
@patch("app.services.deal_analysis.anthropic.AsyncAnthropic")
async def test_analyze_deal_handles_api_error(mock_anthropic_class):
    """analyze_deal returns empty dict on API exception."""
    from app.services.deal_analysis import analyze_deal

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(side_effect=Exception("API error"))
    mock_anthropic_class.return_value = mock_client

    result = await analyze_deal(
        {"buyer_context": "researching", "vehicles": [], "deals": []},
        [{"role": "user", "content": "test"}],
        "test response",
    )
    assert result == {}
