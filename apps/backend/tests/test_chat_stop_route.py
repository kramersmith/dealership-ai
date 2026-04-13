"""Route-level tests for POST /api/chat/{session_id}/stop and panel-refresh."""

from types import SimpleNamespace

import pytest
from app.models.enums import (
    InsightsUpdateMode,
    InsightsFollowupStatus,
    InsightsFollowupStepStatus,
    MessageRole,
)
from app.models.insights_followup_job import InsightsFollowupJob
from app.models.message import Message
from app.models.session import ChatSession
from app.models.user_settings import UserSettings
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

    async def _fake_stream(*_args, **_kwargs):
        yield SimpleNamespace(
            type="panel_started", data={"attempt": 1, "max_tokens": 4096}
        )
        yield SimpleNamespace(
            type="panel_done",
            data={
                "cards": [
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
                "usage_summary": {
                    "requests": 1,
                    "input_tokens": 100,
                    "output_tokens": 50,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 0,
                    "total_tokens": 150,
                },
            },
        )

    async def _fake_reconcile_noop(*args, **kwargs):
        result = args[4]
        result.completed = True
        if False:
            yield ""

    monkeypatch.setattr(
        "app.services.insights_followup.stream_chat_loop", _fake_reconcile_noop
    )
    monkeypatch.setattr(
        "app.services.insights_followup.stream_ai_panel_cards_with_usage",
        _fake_stream,
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

    job = (
        db.query(InsightsFollowupJob)
        .filter(InsightsFollowupJob.session_id == session.id)
        .one()
    )
    assert job.status == InsightsFollowupStatus.SUCCEEDED.value
    assert job.attempts == 1


def test_panel_refresh_reruns_even_after_prior_followup_success(
    client, db, monkeypatch
):
    user, token = create_user_and_token(db)
    session, _ = create_session_with_deal_state(db, user)
    assistant = Message(
        session_id=session.id,
        role=MessageRole.ASSISTANT,
        content="Latest assistant reply",
        panel_cards=[
            {
                "kind": "phase",
                "template": "briefing",
                "title": "Old Status",
                "content": {"stance": "researching", "situation": "Old."},
                "priority": "high",
            }
        ],
    )
    db.add(assistant)
    db.commit()
    db.refresh(session)
    db.refresh(assistant)

    job = InsightsFollowupJob(
        session_id=session.id,
        assistant_message_id=assistant.id,
        status=InsightsFollowupStatus.SUCCEEDED.value,
        attempts=1,
        panel_status=InsightsFollowupStepStatus.SUCCEEDED.value,
        reconcile_status=InsightsFollowupStepStatus.SKIPPED.value,
        usage={"requests": 1, "totalTokens": 10},
    )
    db.add(job)
    db.commit()

    async def _fake_stream(*_args, **_kwargs):
        yield SimpleNamespace(
            type="panel_started", data={"attempt": 2, "max_tokens": 4096}
        )
        yield SimpleNamespace(
            type="panel_done",
            data={
                "cards": [
                    {
                        "kind": "phase",
                        "template": "briefing",
                        "title": "New Status",
                        "content": {
                            "stance": "negotiating",
                            "situation": "Dealer moved on price.",
                        },
                        "priority": "high",
                    }
                ],
                "usage_summary": {
                    "requests": 1,
                    "input_tokens": 25,
                    "output_tokens": 15,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 0,
                    "total_tokens": 40,
                },
            },
        )

    async def _fake_reconcile_noop(*args, **kwargs):
        result = args[4]
        result.completed = True
        if False:
            yield ""

    monkeypatch.setattr(
        "app.services.insights_followup.stream_chat_loop", _fake_reconcile_noop
    )
    monkeypatch.setattr(
        "app.services.insights_followup.stream_ai_panel_cards_with_usage",
        _fake_stream,
    )

    response = client.post(
        f"/api/chat/{session.id}/panel-refresh",
        headers=auth_header(token),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["cards"][0]["title"] == "New Status"

    db.expire_all()
    refreshed_job = (
        db.query(InsightsFollowupJob)
        .filter(InsightsFollowupJob.session_id == session.id)
        .one()
    )
    refreshed_assistant = db.query(Message).filter(Message.id == assistant.id).one()
    assert refreshed_job.status == InsightsFollowupStatus.SUCCEEDED.value
    assert refreshed_job.attempts == 2
    assert refreshed_assistant.panel_cards[0]["title"] == "New Status"
    assert refreshed_assistant.tool_calls == [
        {
            "name": "update_insights_panel",
            "args": {"cards": payload["cards"]},
        }
    ]


def test_panel_refresh_still_runs_when_user_mode_is_paused(client, db, monkeypatch):
    user, token = create_user_and_token(db)
    session, _ = create_session_with_deal_state(db, user)
    db.add(
        UserSettings(
            user_id=user.id,
            insights_update_mode=InsightsUpdateMode.PAUSED.value,
        )
    )
    assistant = Message(
        session_id=session.id,
        role=MessageRole.ASSISTANT,
        content="Latest assistant reply",
    )
    db.add(assistant)
    db.commit()
    db.refresh(session)
    db.refresh(assistant)

    async def _fake_stream(*_args, **_kwargs):
        yield SimpleNamespace(
            type="panel_started", data={"attempt": 1, "max_tokens": 4096}
        )
        yield SimpleNamespace(
            type="panel_done",
            data={
                "cards": [
                    {
                        "kind": "phase",
                        "template": "briefing",
                        "title": "Paused Refresh",
                        "content": {
                            "stance": "researching",
                            "situation": "Manual refresh while paused.",
                        },
                        "priority": "high",
                    }
                ],
                "usage_summary": {
                    "requests": 1,
                    "input_tokens": 18,
                    "output_tokens": 9,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 0,
                    "total_tokens": 27,
                },
            },
        )

    async def _fake_reconcile_noop(*args, **kwargs):
        result = args[4]
        result.completed = True
        if False:
            yield ""

    monkeypatch.setattr(
        "app.services.insights_followup.stream_chat_loop", _fake_reconcile_noop
    )
    monkeypatch.setattr(
        "app.services.insights_followup.stream_ai_panel_cards_with_usage",
        _fake_stream,
    )

    response = client.post(
        f"/api/chat/{session.id}/panel-refresh",
        headers=auth_header(token),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["assistant_message_id"] == assistant.id
    assert payload["cards"][0]["title"] == "Paused Refresh"


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
