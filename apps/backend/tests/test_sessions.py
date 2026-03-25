from app.core.security import create_access_token, hash_password
from app.models.deal_state import DealState
from app.models.enums import BuyerContext, DealPhase, MessageRole, SessionType, UserRole
from app.models.message import Message
from app.models.session import ChatSession
from app.models.user import User


def _create_user_and_token(db) -> tuple[User, str]:
    """Create a test user and return (user, bearer_token)."""
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


def test_delete_session_cascades_to_messages_and_deal_state(client, db):
    """Deleting a session must also delete its messages and deal state."""
    _user, token = _create_user_and_token(db)
    headers = _auth_header(token)

    # Create a session (the endpoint also creates a DealState)
    resp = client.post(
        "/api/sessions",
        json={"session_type": SessionType.BUYER_CHAT},
        headers=headers,
    )
    assert resp.status_code == 201
    session_id = resp.json()["id"]

    # Add a message directly in the DB to simulate chat history
    msg = Message(
        session_id=session_id,
        role=MessageRole.USER,
        content="What is the MSRP?",
    )
    db.add(msg)
    db.commit()

    # Sanity: confirm child rows exist before deletion
    assert db.query(DealState).filter(DealState.session_id == session_id).count() == 1
    assert db.query(Message).filter(Message.session_id == session_id).count() == 1

    # Delete the session
    resp = client.delete(f"/api/sessions/{session_id}", headers=headers)
    assert resp.status_code == 204

    # Session itself is gone
    assert db.query(ChatSession).filter(ChatSession.id == session_id).first() is None
    # Child rows are also gone (the cascade fix)
    assert db.query(DealState).filter(DealState.session_id == session_id).count() == 0
    assert db.query(Message).filter(Message.session_id == session_id).count() == 0


def test_delete_session_returns_404_for_nonexistent(client, db):
    """Deleting a session that doesn't exist should return 404."""
    _, token = _create_user_and_token(db)
    headers = _auth_header(token)

    resp = client.delete("/api/sessions/nonexistent-id", headers=headers)
    assert resp.status_code == 404


def test_delete_session_cannot_delete_other_users_session(client, db):
    """A user cannot delete another user's session."""
    # Create first user and their session
    _user1, token1 = _create_user_and_token(db)

    resp = client.post(
        "/api/sessions",
        json={"session_type": SessionType.BUYER_CHAT},
        headers=_auth_header(token1),
    )
    assert resp.status_code == 201
    session_id = resp.json()["id"]

    # Create second user
    user2 = User(
        email="other@example.com",
        hashed_password=hash_password("password"),
        role=UserRole.BUYER,
        display_name="Other User",
    )
    db.add(user2)
    db.commit()
    db.refresh(user2)
    token2 = create_access_token({"sub": user2.id})

    # Second user tries to delete first user's session
    resp = client.delete(f"/api/sessions/{session_id}", headers=_auth_header(token2))
    assert resp.status_code == 404

    # Session still exists
    assert (
        db.query(ChatSession).filter(ChatSession.id == session_id).first() is not None
    )


# --- buyer_context tests ---


def test_create_session_with_buyer_context(client, db):
    """Creating a session with an explicit buyer_context stores it on the deal state."""
    _user, token = _create_user_and_token(db)
    headers = _auth_header(token)

    resp = client.post(
        "/api/sessions",
        json={
            "session_type": SessionType.BUYER_CHAT,
            "buyer_context": BuyerContext.AT_DEALERSHIP,
        },
        headers=headers,
    )
    assert resp.status_code == 201
    session_id = resp.json()["id"]

    deal_state = db.query(DealState).filter(DealState.session_id == session_id).first()
    assert deal_state is not None
    assert deal_state.buyer_context == BuyerContext.AT_DEALERSHIP


def test_create_session_without_buyer_context_defaults_to_researching(client, db):
    """When buyer_context is omitted, the deal state defaults to 'researching'."""
    _user, token = _create_user_and_token(db)
    headers = _auth_header(token)

    resp = client.post(
        "/api/sessions",
        json={"session_type": SessionType.BUYER_CHAT},
        headers=headers,
    )
    assert resp.status_code == 201
    session_id = resp.json()["id"]

    deal_state = db.query(DealState).filter(DealState.session_id == session_id).first()
    assert deal_state is not None
    assert deal_state.buyer_context == BuyerContext.RESEARCHING


def test_deal_state_response_includes_buyer_context(client, db):
    """The GET /api/deals/:session_id response includes buyer_context."""
    _user, token = _create_user_and_token(db)
    headers = _auth_header(token)

    # Create a session with a specific buyer_context
    resp = client.post(
        "/api/sessions",
        json={
            "session_type": SessionType.BUYER_CHAT,
            "buyer_context": BuyerContext.REVIEWING_DEAL,
        },
        headers=headers,
    )
    assert resp.status_code == 201
    session_id = resp.json()["id"]

    # Fetch the deal state via the API
    resp = client.get(f"/api/deal/{session_id}", headers=headers)
    assert resp.status_code == 200

    data = resp.json()
    assert "buyer_context" in data
    assert data["buyer_context"] == BuyerContext.REVIEWING_DEAL


# --- deal_summary tests ---


def test_session_response_includes_deal_summary(client, db):
    """Session list response includes deal_summary with vehicle and phase info."""
    user, token = _create_user_and_token(db)
    headers = _auth_header(token)

    resp = client.post(
        "/api/sessions",
        json={"session_type": SessionType.BUYER_CHAT},
        headers=headers,
    )
    assert resp.status_code == 201
    session_id = resp.json()["id"]

    # Populate deal state with vehicle info
    deal_state = db.query(DealState).filter(DealState.session_id == session_id).first()
    deal_state.vehicle_year = 2024
    deal_state.vehicle_make = "Honda"
    deal_state.vehicle_model = "Civic"
    deal_state.phase = DealPhase.NEGOTIATION
    deal_state.current_offer = 28500
    db.commit()

    # Fetch sessions list
    resp = client.get("/api/sessions", headers=headers)
    assert resp.status_code == 200
    sessions = resp.json()
    assert len(sessions) == 1

    summary = sessions[0]["deal_summary"]
    assert summary is not None
    assert summary["vehicle_year"] == 2024
    assert summary["vehicle_make"] == "Honda"
    assert summary["vehicle_model"] == "Civic"
    assert summary["phase"] == "negotiation"
    assert summary["current_offer"] == 28500


def test_session_response_includes_last_message_preview(client, db):
    """Session response includes last_message_preview field."""
    user, token = _create_user_and_token(db)
    headers = _auth_header(token)

    resp = client.post(
        "/api/sessions",
        json={"session_type": SessionType.BUYER_CHAT},
        headers=headers,
    )
    assert resp.status_code == 201
    session_id = resp.json()["id"]

    # Manually set the preview (normally done by post_chat_processing)
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    session.last_message_preview = "Here is your deal analysis..."
    db.commit()

    resp = client.get("/api/sessions", headers=headers)
    assert resp.status_code == 200
    assert resp.json()[0]["last_message_preview"] == "Here is your deal analysis..."


# --- search tests ---


def test_search_sessions_by_title(client, db):
    """Search query parameter filters sessions by title."""
    user, token = _create_user_and_token(db)
    headers = _auth_header(token)

    # Create two sessions with different titles
    session1 = ChatSession(user_id=user.id, title="2024 Honda Civic")
    session2 = ChatSession(user_id=user.id, title="2023 Toyota Camry")
    db.add_all([session1, session2])
    db.flush()
    db.add(DealState(session_id=session1.id))
    db.add(DealState(session_id=session2.id))
    db.commit()

    resp = client.get("/api/sessions?q=Honda", headers=headers)
    assert resp.status_code == 200
    results = resp.json()
    assert len(results) == 1
    assert results[0]["title"] == "2024 Honda Civic"


def test_search_sessions_by_message_content(client, db):
    """Search query parameter filters sessions by message content."""
    user, token = _create_user_and_token(db)
    headers = _auth_header(token)

    session = ChatSession(user_id=user.id, title="New Deal")
    db.add(session)
    db.flush()
    db.add(DealState(session_id=session.id))
    db.add(
        Message(
            session_id=session.id,
            role=MessageRole.USER,
            content="I want to buy a Ford F-150",
        )
    )
    db.commit()

    resp = client.get("/api/sessions?q=F-150", headers=headers)
    assert resp.status_code == 200
    results = resp.json()
    assert len(results) == 1
    assert results[0]["id"] == session.id


# --- auto_title tests ---


def test_manual_title_update_sets_auto_title_false(client, db):
    """PATCH with a title sets auto_title to False."""
    user, token = _create_user_and_token(db)
    headers = _auth_header(token)

    resp = client.post(
        "/api/sessions",
        json={"session_type": SessionType.BUYER_CHAT},
        headers=headers,
    )
    assert resp.status_code == 201
    session_id = resp.json()["id"]

    # Verify auto_title starts as True
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    assert session.auto_title is True

    # Update title manually
    resp = client.patch(
        f"/api/sessions/{session_id}",
        json={"title": "My Custom Title"},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["title"] == "My Custom Title"

    # Verify auto_title is now False
    db.refresh(session)
    assert session.auto_title is False
