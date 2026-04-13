"""Security-focused route tests for insights follow-up and panel refresh."""

from app.core.security import create_access_token, hash_password
from app.models.enums import MessageRole, UserRole
from app.models.message import Message
from app.models.user import User

from tests.conftest import (
    auth_header,
    create_session_with_deal_state,
    create_user_and_token,
)


def _create_other_user_token(db) -> str:
    other = User(
        email="other@example.com",
        hashed_password=hash_password("password"),
        role=UserRole.BUYER,
        display_name="Other",
    )
    db.add(other)
    db.commit()
    db.refresh(other)
    return create_access_token({"sub": other.id})


def test_insights_followup_rejects_other_users_session(client, db):
    owner, _owner_token = create_user_and_token(db)
    session, _deal_state = create_session_with_deal_state(db, owner)
    assistant = Message(
        session_id=session.id,
        role=MessageRole.ASSISTANT,
        content="assistant reply",
    )
    db.add(assistant)
    db.commit()
    db.refresh(assistant)

    other_token = _create_other_user_token(db)

    response = client.post(
        f"/api/chat/{session.id}/insights-followup",
        json={"assistant_message_id": assistant.id},
        headers=auth_header(other_token),
    )

    assert response.status_code == 404


def test_insights_followup_rejects_assistant_message_from_different_session(client, db):
    user, token = create_user_and_token(db)
    session_one, _deal_state_one = create_session_with_deal_state(db, user)
    session_two, _deal_state_two = create_session_with_deal_state(db, user)
    assistant = Message(
        session_id=session_two.id,
        role=MessageRole.ASSISTANT,
        content="assistant reply",
    )
    db.add(assistant)
    db.commit()
    db.refresh(assistant)

    response = client.post(
        f"/api/chat/{session_one.id}/insights-followup",
        json={"assistant_message_id": assistant.id},
        headers=auth_header(token),
    )

    assert response.status_code == 404


def test_insights_followup_rejects_non_latest_assistant_message(client, db):
    user, token = create_user_and_token(db)
    session, _deal_state = create_session_with_deal_state(db, user)
    older_assistant = Message(
        session_id=session.id,
        role=MessageRole.ASSISTANT,
        content="older assistant reply",
    )
    newer_assistant = Message(
        session_id=session.id,
        role=MessageRole.ASSISTANT,
        content="newer assistant reply",
    )
    db.add_all([older_assistant, newer_assistant])
    db.commit()
    db.refresh(older_assistant)
    db.refresh(newer_assistant)

    response = client.post(
        f"/api/chat/{session.id}/insights-followup",
        json={"assistant_message_id": older_assistant.id},
        headers=auth_header(token),
    )

    assert response.status_code == 409
    assert response.json() == {
        "detail": "Insights follow-up can only run for the latest assistant message in this session"
    }


def test_panel_refresh_rejects_other_users_session(client, db):
    owner, _owner_token = create_user_and_token(db)
    session, _deal_state = create_session_with_deal_state(db, owner)

    other_token = _create_other_user_token(db)

    response = client.post(
        f"/api/chat/{session.id}/panel-refresh",
        headers=auth_header(other_token),
    )

    assert response.status_code == 404
