"""Tests for the execute_tool dispatcher and analyze_deal."""

from unittest.mock import AsyncMock, MagicMock, patch

from app.models.deal import Deal
from app.models.deal_state import DealState
from app.models.enums import BuyerContext, DealPhase, VehicleRole
from app.models.vehicle import Vehicle
from app.services.deal_state import execute_tool
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
        deal_state,
        adb,
    )

    # Should return tool calls including set_vehicle and possibly create_deal
    tool_names = [tc["name"] for tc in result]
    assert "set_vehicle" in tool_names
    # Auto-create deal for first primary vehicle
    assert "create_deal" in tool_names

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
        deal_state,
        adb,
    )

    tool_names = [tc["name"] for tc in result]
    assert "update_deal_numbers" in tool_names
    assert deal.listing_price == 34000
    assert deal.current_offer == 33500


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
    result = await execute_tool("update_negotiation_context", context, deal_state, adb)

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
        deal_state,
        adb,
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
        deal_state,
        adb,
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

    result = await execute_tool("nonexistent_tool", {}, deal_state, adb)
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
