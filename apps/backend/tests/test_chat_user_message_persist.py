"""Persisted user message (VIN intercept) and stream resume via existing_user_message_id."""

from app.models.enums import MessageRole
from app.models.message import Message

from tests.conftest import (
    auth_header,
    create_session_with_deal_state,
    create_user_and_token,
)


def test_persist_user_message_then_list_includes_it(client, db):
    user, token = create_user_and_token(db)
    session, _initial_deal = create_session_with_deal_state(db, user)

    response = client.post(
        f"/api/chat/{session.id}/user-message",
        json={"content": "Compare VINs 1HGBH41JXMN109186 and 2HGFC2F59KH123456"},
        headers=auth_header(token),
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["role"] == "user"
    assert "1HGBH41JXMN109186" in data["content"]
    persisted_message_id = data["id"]

    listed = client.get(
        f"/api/chat/{session.id}/messages",
        headers=auth_header(token),
    )
    assert listed.status_code == 200
    messages = listed.json()["messages"]
    assert any(message["id"] == persisted_message_id for message in messages)


def test_message_stream_rejects_unknown_existing_user_message_id(client, db):
    user, token = create_user_and_token(db)
    session, _initial_deal = create_session_with_deal_state(db, user)

    response = client.post(
        f"/api/chat/{session.id}/message",
        json={
            "content": "hi",
            "existing_user_message_id": "00000000-0000-0000-0000-000000000000",
        },
        headers=auth_header(token),
    )
    assert response.status_code == 404


def test_message_stream_rejects_non_latest_existing_user_message_id(client, db):
    user, token = create_user_and_token(db)
    session, _initial_deal = create_session_with_deal_state(db, user)

    persisted_user = Message(
        session_id=session.id,
        role=MessageRole.USER,
        content="Original message",
    )
    assistant_reply = Message(
        session_id=session.id,
        role=MessageRole.ASSISTANT,
        content="Assistant reply",
    )
    db.add_all([persisted_user, assistant_reply])
    db.commit()
    db.refresh(persisted_user)

    response = client.post(
        f"/api/chat/{session.id}/message",
        json={
            "content": "Edited message",
            "existing_user_message_id": persisted_user.id,
        },
        headers=auth_header(token),
    )

    assert response.status_code == 409
    assert "branch endpoint" in response.json()["detail"].lower()


def test_get_messages_returns_plain_persisted_assistant_message(client, db):
    user, token = create_user_and_token(db)
    session, _initial_deal = create_session_with_deal_state(db, user)
    assistant_msg = Message(
        session_id=session.id,
        role=MessageRole.ASSISTANT,
        content="Here is the side-by-side breakdown.",
    )
    db.add(assistant_msg)
    db.commit()

    listed = client.get(
        f"/api/chat/{session.id}/messages",
        headers=auth_header(token),
    )
    assert listed.status_code == 200
    messages = listed.json()["messages"]
    assistant = next(message for message in messages if message["role"] == "assistant")
    assert assistant["content"] == "Here is the side-by-side breakdown."
    assert "comparison_table" not in assistant
    assert "presentation_blocks" not in assistant
