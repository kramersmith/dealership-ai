"""Tests for post_chat_processing — preview and title updates with multi-vehicle/deal architecture."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.core.security import hash_password
from app.models.deal import Deal
from app.models.deal_state import DealState
from app.models.enums import UserRole, VehicleRole
from app.models.session import ChatSession
from app.models.user import User
from app.models.vehicle import Vehicle
from app.services.post_chat_processing import (
    DEFAULT_BUYER_TITLE,
    DEFAULT_DEALER_TITLE,
    PREVIEW_MAX_LENGTH,
    _truncate,
    _update_preview,
    update_session_metadata,
)

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
    session = ChatSession(user_id=user.id, title=DEFAULT_BUYER_TITLE, auto_title=True)
    db.add(session)
    db.flush()
    deal_state = DealState(session_id=session.id)
    db.add(deal_state)
    db.commit()
    db.refresh(session)
    db.refresh(deal_state)
    return session, deal_state


def _create_vehicle(db, session_id: str, **kwargs) -> Vehicle:
    vehicle = Vehicle(session_id=session_id, role=VehicleRole.PRIMARY, **kwargs)
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


# --- _truncate ---


def test_truncate_short_string():
    """Strings within max_length are returned unchanged."""
    assert _truncate("hello", 10) == "hello"


def test_truncate_exact_length():
    """Strings exactly at max_length are returned unchanged."""
    assert _truncate("1234567890", 10) == "1234567890"


def test_truncate_long_string():
    """Strings exceeding max_length are truncated with ellipsis."""
    result = _truncate("12345678901", 10)
    assert len(result) == 10
    assert result.endswith("\u2026")
    assert result == "123456789\u2026"


# --- _update_preview ---


def test_update_preview_from_assistant_response():
    """Preview is set from the assistant response text."""
    session = MagicMock()
    _update_preview(
        session, "Here is my analysis of the deal.", "Tell me about this car"
    )
    assert session.last_message_preview == "Here is my analysis of the deal."


def test_update_preview_falls_back_to_user_message():
    """When response_text is empty, preview falls back to 'You: <user_message>'."""
    session = MagicMock()
    _update_preview(session, "", "What is the MSRP?")
    assert session.last_message_preview == "You: What is the MSRP?"


def test_update_preview_empty_response_whitespace_only():
    """Whitespace-only response text falls back to user message."""
    session = MagicMock()
    _update_preview(session, "   ", "Check this deal")
    assert session.last_message_preview == "You: Check this deal"


def test_update_preview_truncates_long_response():
    """Long response text is truncated to PREVIEW_MAX_LENGTH."""
    session = MagicMock()
    long_text = "A" * 200
    _update_preview(session, long_text, "user msg")
    assert len(session.last_message_preview) <= PREVIEW_MAX_LENGTH
    assert session.last_message_preview.endswith("\u2026")


def test_update_preview_no_update_when_both_empty():
    """When both response and user message are empty, preview is not set."""

    class FakeSession:
        pass

    session = FakeSession()
    _update_preview(session, "", "")
    # Neither branch assigns last_message_preview when both inputs are empty
    assert not hasattr(session, "last_message_preview")


# --- _update_title via update_session_metadata (with db parameter) ---


@pytest.mark.asyncio
async def test_title_updated_from_vehicle_tool_call(db):
    """When set_vehicle tool was called, title is set from Vehicle in DB."""
    user = _create_user(db)
    session, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(
        db,
        session.id,
        year=2024,
        make="Honda",
        model="Civic",
        trim="EX",
    )
    deal = _create_deal(db, session.id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.commit()

    tool_calls = [{"name": "set_vehicle", "args": {}}]
    messages = [{"role": "user", "content": "I want a Honda Civic"}]

    await update_session_metadata(
        session=session,
        deal_state=deal_state,
        messages=messages,
        tool_calls=tool_calls,
        response_text="Great choice!",
        user_message="I want a Honda Civic",
        db=db,
    )

    assert session.title == "2024 Honda Civic EX"


@pytest.mark.asyncio
async def test_title_not_updated_when_auto_title_false(db):
    """When auto_title is False (user set manual title), title is not changed."""
    user = _create_user(db)
    session, deal_state = _create_session_with_deal_state(db, user)
    session.auto_title = False
    session.title = "My Custom Title"
    vehicle = _create_vehicle(db, session.id, year=2024, make="Honda", model="Civic")
    deal = _create_deal(db, session.id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.commit()

    tool_calls = [{"name": "set_vehicle", "args": {}}]
    messages = [{"role": "user", "content": "Honda Civic"}]

    await update_session_metadata(
        session=session,
        deal_state=deal_state,
        messages=messages,
        tool_calls=tool_calls,
        response_text="Sure!",
        user_message="Honda Civic",
        db=db,
    )

    assert session.title == "My Custom Title"


@pytest.mark.asyncio
@patch(
    "app.services.post_chat_processing.generate_session_title", new_callable=AsyncMock
)
async def test_title_llm_fallback_when_still_default(mock_generate, db):
    """When title is still default and no vehicle tool called, LLM generates title."""
    mock_generate.return_value = "Financing Question"

    user = _create_user(db)
    session, deal_state = _create_session_with_deal_state(db, user)

    messages = [
        {"role": "user", "content": "How does financing work?"},
        {"role": "assistant", "content": "Let me explain financing options."},
    ]

    await update_session_metadata(
        session=session,
        deal_state=deal_state,
        messages=messages,
        tool_calls=[],
        response_text="Let me explain financing options.",
        user_message="How does financing work?",
        db=db,
    )

    mock_generate.assert_called_once_with(messages)
    assert session.title == "Financing Question"


@pytest.mark.asyncio
@patch(
    "app.services.post_chat_processing.generate_session_title", new_callable=AsyncMock
)
async def test_title_not_regenerated_when_already_non_default(mock_generate, db):
    """LLM title generation is skipped when title is already non-default."""
    user = _create_user(db)
    session, deal_state = _create_session_with_deal_state(db, user)
    session.title = "2024 Honda Civic"  # Already set by vehicle tool
    db.commit()

    messages = [{"role": "user", "content": "What about the trim levels?"}]

    await update_session_metadata(
        session=session,
        deal_state=deal_state,
        messages=messages,
        tool_calls=[],
        response_text="There are several trims.",
        user_message="What about the trim levels?",
        db=db,
    )

    mock_generate.assert_not_called()
    assert session.title == "2024 Honda Civic"


@pytest.mark.asyncio
@patch(
    "app.services.post_chat_processing.generate_session_title", new_callable=AsyncMock
)
async def test_dealer_sim_default_title_triggers_llm(mock_generate, db):
    """Dealer simulation default title also triggers LLM fallback."""
    mock_generate.return_value = "Price Negotiation Sim"

    user = _create_user(db)
    session, deal_state = _create_session_with_deal_state(db, user)
    session.title = DEFAULT_DEALER_TITLE
    db.commit()

    messages = [{"role": "user", "content": "I want to practice negotiating price"}]

    await update_session_metadata(
        session=session,
        deal_state=deal_state,
        messages=messages,
        tool_calls=[],
        response_text="Let's start the simulation.",
        user_message="I want to practice negotiating price",
        db=db,
    )

    mock_generate.assert_called_once()
    assert session.title == "Price Negotiation Sim"


@pytest.mark.asyncio
async def test_title_from_vehicle_without_trim(db):
    """Vehicle title without trim omits it (e.g., '2024 Honda Civic')."""
    user = _create_user(db)
    session, deal_state = _create_session_with_deal_state(db, user)
    vehicle = _create_vehicle(db, session.id, year=2024, make="Honda", model="Civic")
    deal = _create_deal(db, session.id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.commit()

    tool_calls = [{"name": "set_vehicle", "args": {}}]
    messages = [{"role": "user", "content": "Honda Civic"}]

    await update_session_metadata(
        session=session,
        deal_state=deal_state,
        messages=messages,
        tool_calls=tool_calls,
        response_text="Sure!",
        user_message="Honda Civic",
        db=db,
    )

    assert session.title == "2024 Honda Civic"


@pytest.mark.asyncio
@patch(
    "app.services.post_chat_processing.generate_session_title", new_callable=AsyncMock
)
async def test_title_vehicle_tool_called_but_no_vehicle_make_falls_back_to_llm(
    mock_generate, db
):
    """When set_vehicle is called but vehicle has no make, falls back to LLM."""
    mock_generate.return_value = "Car Shopping Help"

    user = _create_user(db)
    session, deal_state = _create_session_with_deal_state(db, user)
    # Vehicle with no make (incomplete data)
    vehicle = _create_vehicle(db, session.id, year=2024)
    deal = _create_deal(db, session.id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.commit()

    tool_calls = [{"name": "set_vehicle", "args": {}}]
    messages = [{"role": "user", "content": "Help me buy a car"}]

    await update_session_metadata(
        session=session,
        deal_state=deal_state,
        messages=messages,
        tool_calls=tool_calls,
        response_text="Sure!",
        user_message="Help me buy a car",
        db=db,
    )

    mock_generate.assert_called_once()
    assert session.title == "Car Shopping Help"


@pytest.mark.asyncio
async def test_title_no_deal_state_skips_vehicle_title(db):
    """When deal_state is None, vehicle-based title is skipped."""
    user = _create_user(db)
    session = ChatSession(user_id=user.id, title=DEFAULT_BUYER_TITLE, auto_title=True)
    db.add(session)
    db.commit()
    db.refresh(session)

    tool_calls = [{"name": "set_vehicle", "args": {}}]
    messages = [{"role": "user", "content": "Honda Civic"}]

    # deal_state=None should not crash, just skip vehicle title
    with patch(
        "app.services.post_chat_processing.generate_session_title",
        new_callable=AsyncMock,
        return_value="Honda Civic Discussion",
    ):
        await update_session_metadata(
            session=session,
            deal_state=None,
            messages=messages,
            tool_calls=tool_calls,
            response_text="Sure!",
            user_message="Honda Civic",
            db=db,
        )

    assert session.title == "Honda Civic Discussion"
