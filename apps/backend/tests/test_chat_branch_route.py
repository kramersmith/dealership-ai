"""HTTP behavior for POST /chat/{session_id}/messages/{message_id}/branch (no Claude stream)."""

from unittest.mock import patch

from app.core.security import create_access_token, hash_password
from app.models.enums import (
    InsightsFollowupKind,
    InsightsFollowupStatus,
    InsightsFollowupStepStatus,
    MessageRole,
    UserRole,
)
from app.models.insights_followup_job import InsightsFollowupJob
from app.models.message import Message
from app.models.user import User

from tests.conftest import (
    auth_header,
    create_session_with_deal_state,
    create_user_and_token,
)


async def _noop_stream(**_kwargs):
    if False:
        yield ""


def test_branch_rejects_non_user_anchor(client, db):
    user, token = create_user_and_token(db)
    session, _initial_deal = create_session_with_deal_state(db, user)
    user_message = Message(session_id=session.id, role=MessageRole.USER, content="hi")
    assistant_message = Message(
        session_id=session.id,
        role=MessageRole.ASSISTANT,
        content="yo",
    )
    db.add_all([user_message, assistant_message])
    db.commit()
    db.refresh(assistant_message)

    with patch(
        "app.routes.chat.stream_buyer_chat_turn",
        side_effect=_noop_stream,
    ) as mock_stream:
        response = client.post(
            f"/api/chat/{session.id}/messages/{assistant_message.id}/branch",
            json={"content": "edited"},
            headers=auth_header(token),
        )

    assert response.status_code == 422
    assert "user message" in response.json()["detail"].lower()
    mock_stream.assert_not_called()


def test_branch_unknown_message_returns_404(client, db):
    user, token = create_user_and_token(db)
    session, _initial_deal = create_session_with_deal_state(db, user)

    with patch(
        "app.routes.chat.stream_buyer_chat_turn",
        side_effect=_noop_stream,
    ) as mock_stream:
        response = client.post(
            f"/api/chat/{session.id}/messages/00000000-0000-0000-0000-000000000001/branch",
            json={"content": "x"},
            headers=auth_header(token),
        )

    assert response.status_code == 404
    mock_stream.assert_not_called()


def test_branch_requires_authentication(client, db):
    user, _token = create_user_and_token(db)
    session, _initial_deal = create_session_with_deal_state(db, user)
    user_message = Message(session_id=session.id, role=MessageRole.USER, content="hi")
    db.add(user_message)
    db.commit()
    db.refresh(user_message)

    with patch(
        "app.routes.chat.stream_buyer_chat_turn",
        side_effect=_noop_stream,
    ) as mock_stream:
        response = client.post(
            f"/api/chat/{session.id}/messages/{user_message.id}/branch",
            json={"content": "edited"},
        )

    assert response.status_code in (401, 403)
    mock_stream.assert_not_called()


def test_branch_rejects_other_users_session(client, db):
    owner, _owner_token = create_user_and_token(db)
    session, _initial_deal = create_session_with_deal_state(db, owner)
    user_message = Message(session_id=session.id, role=MessageRole.USER, content="hi")
    db.add(user_message)
    db.commit()
    db.refresh(user_message)

    other = User(
        email="other@example.com",
        hashed_password=hash_password("password"),
        role=UserRole.BUYER,
        display_name="Other",
    )
    db.add(other)
    db.commit()
    db.refresh(other)
    other_token = create_access_token({"sub": other.id})

    with patch(
        "app.routes.chat.stream_buyer_chat_turn",
        side_effect=_noop_stream,
    ) as mock_stream:
        response = client.post(
            f"/api/chat/{session.id}/messages/{user_message.id}/branch",
            json={"content": "edited"},
            headers=auth_header(other_token),
        )

    assert response.status_code == 404
    mock_stream.assert_not_called()


def test_branch_success_truncates_tail_and_starts_stream(client, db):
    user, token = create_user_and_token(db)
    session, _initial_deal = create_session_with_deal_state(db, user)

    anchor_user_message = Message(
        session_id=session.id, role=MessageRole.USER, content="one"
    )
    assistant_reply = Message(
        session_id=session.id,
        role=MessageRole.ASSISTANT,
        content="answer",
    )
    trailing_user_message = Message(
        session_id=session.id,
        role=MessageRole.USER,
        content="two",
    )
    db.add_all([anchor_user_message, assistant_reply, trailing_user_message])
    db.commit()
    db.refresh(anchor_user_message)

    anchor_id = anchor_user_message.id
    assistant_reply_id = assistant_reply.id
    trailing_id = trailing_user_message.id

    captured: dict = {}

    async def _capture_stream(**kwargs):
        # Snapshot identifying fields while the route's DB session is still open;
        # the ORM rows become detached/expired once the request returns.
        captured["content"] = kwargs.get("content")
        captured["include_timeline_fork_reminder"] = kwargs.get(
            "include_timeline_fork_reminder"
        )
        resumed = kwargs.get("resumed_user_row")
        captured["resumed_user_row_id"] = resumed.id if resumed is not None else None
        captured["history_ids"] = [message.id for message in kwargs.get("history", [])]
        yield 'event: done\ndata: {"text": "ok"}\n\n'

    with patch(
        "app.routes.chat.stream_buyer_chat_turn",
        side_effect=_capture_stream,
    ) as mock_stream:
        response = client.post(
            f"/api/chat/{session.id}/messages/{anchor_id}/branch",
            json={"content": "edited one"},
            headers=auth_header(token),
        )

    assert response.status_code == 200
    mock_stream.assert_called_once()
    # The route forwards the edited content and marks this as a branch turn.
    assert captured["content"] == "edited one"
    assert captured["include_timeline_fork_reminder"] is True
    assert captured["resumed_user_row_id"] == anchor_id
    assert captured["history_ids"] == [anchor_id]

    # Tail messages removed by prepare_session_branch_from_user_message.
    remaining_ids = {
        message_id
        for (message_id,) in db.query(Message.id)
        .filter(Message.session_id == session.id)
        .all()
    }
    assert anchor_id in remaining_ids
    assert assistant_reply_id not in remaining_ids
    assert trailing_id not in remaining_ids


def test_branch_success_deletes_followup_jobs_for_removed_assistant_messages(
    client, db
):
    user, token = create_user_and_token(db)
    session, _initial_deal = create_session_with_deal_state(db, user)

    anchor_user_message = Message(
        session_id=session.id, role=MessageRole.USER, content="one"
    )
    assistant_reply = Message(
        session_id=session.id,
        role=MessageRole.ASSISTANT,
        content="answer",
    )
    trailing_user_message = Message(
        session_id=session.id,
        role=MessageRole.USER,
        content="two",
    )
    db.add_all([anchor_user_message, assistant_reply, trailing_user_message])
    db.commit()
    db.refresh(anchor_user_message)
    db.refresh(assistant_reply)

    followup_job = InsightsFollowupJob(
        session_id=session.id,
        assistant_message_id=assistant_reply.id,
        kind=InsightsFollowupKind.LINKED_RECONCILE_PANEL.value,
        status=InsightsFollowupStatus.SUCCEEDED.value,
        reconcile_status=InsightsFollowupStepStatus.SUCCEEDED.value,
        panel_status=InsightsFollowupStepStatus.SUCCEEDED.value,
        attempts=1,
    )
    db.add(followup_job)
    db.commit()
    followup_job_id = followup_job.id

    async def _capture_stream(**_kwargs):
        yield 'event: done\ndata: {"text": "ok"}\n\n'

    with patch(
        "app.routes.chat.stream_buyer_chat_turn",
        side_effect=_capture_stream,
    ):
        response = client.post(
            f"/api/chat/{session.id}/messages/{anchor_user_message.id}/branch",
            json={"content": "edited one"},
            headers=auth_header(token),
        )

    assert response.status_code == 200
    assert (
        db.query(InsightsFollowupJob)
        .filter(InsightsFollowupJob.id == followup_job_id)
        .one_or_none()
        is None
    )
