"""Route-level tests for POST /api/chat/{session_id}/stop and panel-refresh."""

import pytest
from app.models.enums import MessageRole
from app.models.message import Message
from app.models.session import ChatSession
from app.services.turn_cancellation import turn_cancellation_registry

from tests.conftest import (
    auth_header,
    create_session_with_deal_state,
    create_user_and_token,
)


def test_stop_returns_not_found_when_no_active_turn(client, db):
    user, token = create_user_and_token(db)
    session, _ = create_session_with_deal_state(db, user)

    response = client.post(
        f"/api/chat/{session.id}/stop",
        json={"reason": "user_stop"},
        headers=auth_header(token),
    )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "not_found"
    assert data["cancelled"] is False


@pytest.mark.asyncio
async def test_stop_cancels_active_turn(client, db):
    user, token = create_user_and_token(db)
    session, _ = create_session_with_deal_state(db, user)

    # Manually register an active turn so we can cancel it.
    turn_state = await turn_cancellation_registry.start_turn(
        session_id=session.id,
        user_id=user.id,
    )
    try:
        response = client.post(
            f"/api/chat/{session.id}/stop",
            json={"turn_id": turn_state.turn_id, "reason": "user_stop"},
            headers=auth_header(token),
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "cancelled"
        assert data["cancelled"] is True
        assert data["turn_id"] == turn_state.turn_id
        assert turn_state.cancelled is True
    finally:
        await turn_cancellation_registry.end_turn(turn_state)


@pytest.mark.asyncio
async def test_stop_returns_turn_mismatch_for_wrong_turn_id(client, db):
    user, token = create_user_and_token(db)
    session, _ = create_session_with_deal_state(db, user)

    turn_state = await turn_cancellation_registry.start_turn(
        session_id=session.id,
        user_id=user.id,
    )
    try:
        response = client.post(
            f"/api/chat/{session.id}/stop",
            json={"turn_id": "wrong-turn-id", "reason": "user_stop"},
            headers=auth_header(token),
        )
        assert response.status_code == 409
    finally:
        await turn_cancellation_registry.end_turn(turn_state)


def test_stop_returns_404_for_invalid_session(client, db):
    _, token = create_user_and_token(db)

    response = client.post(
        "/api/chat/nonexistent-session/stop",
        json={"reason": "user_stop"},
        headers=auth_header(token),
    )
    assert response.status_code == 404


def test_panel_refresh_updates_session_usage_ledger(client, db, monkeypatch):
    user, token = create_user_and_token(db)
    session, _ = create_session_with_deal_state(db, user)
    assistant = Message(
        session_id=session.id,
        role=MessageRole.ASSISTANT,
        content="Latest assistant reply",
    )
    db.add(assistant)
    db.commit()
    db.refresh(session)

    async def _fake_generate(*_args, **_kwargs):
        return (
            [
                {
                    "kind": "phase",
                    "template": "briefing",
                    "title": "Status",
                    "content": {
                        "stance": "researching",
                        "situation": "Evaluating options.",
                    },
                    "priority": "high",
                }
            ],
            {
                "requests": 1,
                "input_tokens": 100,
                "output_tokens": 50,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 0,
                "total_tokens": 150,
            },
        )

    monkeypatch.setattr(
        "app.services.panel_update_service.generate_ai_panel_cards_with_usage",
        _fake_generate,
    )

    response = client.post(
        f"/api/chat/{session.id}/panel-refresh",
        headers=auth_header(token),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["assistant_message_id"] == assistant.id
    assert len(payload["cards"]) == 1

    db.expire_all()
    refreshed_session = db.query(ChatSession).filter(ChatSession.id == session.id).one()
    assert refreshed_session.usage is not None
    assert refreshed_session.usage["request_count"] == 1
    assert refreshed_session.usage["total_tokens"] == 150


def test_panel_refresh_returns_404_when_no_deal_state(client, db):
    """Panel refresh requires a deal state row; sessions without one get 404."""
    user, token = create_user_and_token(db)
    # Create a session WITHOUT deal state
    session = ChatSession(user_id=user.id, title="No deal")
    db.add(session)
    db.commit()
    db.refresh(session)

    response = client.post(
        f"/api/chat/{session.id}/panel-refresh",
        headers=auth_header(token),
    )
    assert response.status_code == 404


def test_panel_refresh_returns_409_when_no_assistant_message(client, db):
    """Panel refresh with deal state but no assistant messages returns 409."""
    user, token = create_user_and_token(db)
    session, _ = create_session_with_deal_state(db, user)
    # No assistant messages added

    response = client.post(
        f"/api/chat/{session.id}/panel-refresh",
        headers=auth_header(token),
    )
    assert response.status_code == 409
