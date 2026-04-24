"""Tests for deal recap, savings math, redaction, and recap routes."""

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from app.models.deal_timeline_event import DealTimelineEvent
from app.models.enums import VehicleRole
from app.models.enums_recap import TimelineEventSource
from app.schemas.recap import (
    DealRecapResponse,
    EmitDealRecapInput,
    RecapBeatLLM,
    RedactionProfile,
    SavingsSnapshotResponse,
    TimelineBeatResponse,
)
from app.services.recap.redaction import apply_redaction
from app.services.recap.savings_math import compute_savings_snapshot
from fastapi.testclient import TestClient

from tests.conftest import (
    auth_header,
    create_deal,
    create_session_with_deal_state,
    create_user_and_token,
    create_vehicle,
)


def test_visible_events_sort_mixed_naive_and_aware_datetimes():
    """Regression: naive vs aware occurred_at must not raise in _visible_events."""
    from app.services.recap.service import _visible_events

    ev_b = DealTimelineEvent(
        id="b",
        session_id="s",
        deal_id=None,
        recap_generation_id=None,
        user_message_id=None,
        assistant_message_id=None,
        occurred_at=datetime(2026, 1, 1, 0, 0, 0),
        kind="phase_change",
        payload={},
        source=TimelineEventSource.TOOL.value,
        supersedes_event_id=None,
        sort_order=0,
        idempotency_key=None,
    )
    ev_a = DealTimelineEvent(
        id="a",
        session_id="s",
        deal_id=None,
        recap_generation_id=None,
        user_message_id=None,
        assistant_message_id=None,
        occurred_at=datetime(2026, 1, 2, 0, 0, 0, tzinfo=timezone.utc),
        kind="phase_change",
        payload={},
        source=TimelineEventSource.TOOL.value,
        supersedes_event_id=None,
        sort_order=0,
        idempotency_key=None,
    )
    out = _visible_events([ev_a, ev_b], None)
    assert len(out) == 2
    assert out[0].id == "b"
    assert out[1].id == "a"


def test_savings_concession_when_meaningful():
    deal_state = {
        "deals": [
            {
                "id": "d1",
                "offer_history": {"first_offer": 40000.0},
                "numbers": {"current_offer": 37500.0},
            }
        ]
    }
    snap = compute_savings_snapshot(deal_state, active_deal_id="d1")
    assert snap.concession_vs_first_offer == 2500.0


def test_savings_suppressed_below_threshold():
    deal_state = {
        "deals": [
            {
                "id": "d1",
                "offer_history": {"first_offer": 40000.0},
                "numbers": {"current_offer": 39950.0},
            }
        ]
    }
    snap = compute_savings_snapshot(deal_state, active_deal_id="d1")
    assert snap.concession_vs_first_offer is None


def test_redaction_hides_dollar_amounts_in_beats_and_savings():
    recap = DealRecapResponse(
        session_id="s1",
        active_deal_id="d1",
        generation=None,
        beats=[
            TimelineBeatResponse(
                id="b1",
                session_id="s1",
                deal_id="d1",
                recap_generation_id=None,
                user_message_id=None,
                assistant_message_id=None,
                occurred_at=datetime(2026, 4, 21, 12, 0, tzinfo=timezone.utc),
                kind="test",
                payload={"world": "Saved $500 You paid $30,000.", "app": ""},
                source="model",
                supersedes_event_id=None,
                sort_order=0,
            )
        ],
        savings=SavingsSnapshotResponse(
            first_offer=40000,
            current_offer=39000,
            concession_vs_first_offer=1000,
            monthly_payment=None,
            apr_percent=5.0,
            loan_term_months=60,
            estimated_total_interest_delta_usd=800,
            assumptions=[],
        ),
    )
    public = apply_redaction(
        recap,
        RedactionProfile(
            hide_user_message_quotes=False,
            hide_dealer_name=False,
            hide_dollar_amounts=True,
        ),
    )
    assert "[amount redacted]" in public.beats[0].world
    assert public.savings.concession_vs_first_offer is None


@pytest.mark.asyncio
async def test_record_phase_change_idempotent(adb, async_buyer_user):
    from app.services.recap import timeline_recorder

    from tests.conftest import (
        async_create_deal,
        async_create_session_with_deal_state,
        async_create_vehicle,
    )

    session, _deal_state = await async_create_session_with_deal_state(
        adb, async_buyer_user
    )
    vehicle = await async_create_vehicle(
        adb, session.id, role=VehicleRole.PRIMARY, year=2024, make="X", model="Y"
    )
    deal = await async_create_deal(adb, session.id, vehicle.id, phase="research")
    await timeline_recorder.record_phase_change(
        adb,
        session_id=session.id,
        deal_id=deal.id,
        old_phase="research",
        new_phase="negotiation",
    )
    await adb.commit()
    await timeline_recorder.record_phase_change(
        adb,
        session_id=session.id,
        deal_id=deal.id,
        old_phase="research",
        new_phase="negotiation",
    )
    await adb.commit()
    from sqlalchemy import func, select

    cnt = await adb.execute(
        select(func.count())
        .select_from(DealTimelineEvent)
        .where(
            DealTimelineEvent.session_id == session.id,
            DealTimelineEvent.idempotency_key == f"phase:{deal.id}:negotiation",
        )
    )
    assert cnt.scalar_one() == 1


def test_get_recap_empty(client: TestClient, db):
    user, token = create_user_and_token(db)
    session, deal_state = create_session_with_deal_state(db, user)
    res = client.get(f"/api/deal/{session.id}/recap", headers=auth_header(token))
    assert res.status_code == 200
    data = res.json()
    assert data["session_id"] == session.id
    assert data["beats"] == []


def test_get_recap_omits_tool_timeline_rows(client: TestClient, db):
    """Tool hints (e.g. phase_change) stay in DB but are not buyer-facing recap beats."""
    user, token = create_user_and_token(db)
    session, deal_state = create_session_with_deal_state(db, user)
    db.add(
        DealTimelineEvent(
            id=str(uuid.uuid4()),
            session_id=session.id,
            deal_id=None,
            recap_generation_id=None,
            user_message_id=None,
            assistant_message_id=None,
            occurred_at=datetime.now(timezone.utc),
            kind="phase_change",
            payload={"title": "Deal phase updated", "narrative": "Internal hint"},
            source=TimelineEventSource.TOOL.value,
            supersedes_event_id=None,
            sort_order=0,
            idempotency_key=f"phase:{session.id}:closing",
        )
    )
    db.commit()

    res = client.get(f"/api/deal/{session.id}/recap", headers=auth_header(token))
    assert res.status_code == 200
    assert res.json()["beats"] == []


def test_post_timeline_user_event(client: TestClient, db):
    user, token = create_user_and_token(db)
    session, deal_state = create_session_with_deal_state(db, user)
    vehicle = create_vehicle(
        db, session.id, role=VehicleRole.PRIMARY, year=2024, make="A", model="B"
    )
    deal = create_deal(db, session.id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.add(deal_state)
    db.commit()

    res = client.post(
        f"/api/deal/{session.id}/recap/timeline-events",
        headers=auth_header(token),
        json={
            "kind": "user_note",
            "world": "Dealer waived doc fee after I asked.",
            "app": "",
        },
    )
    assert res.status_code == 200
    row = res.json()
    assert row["source"] == TimelineEventSource.USER.value
    assert row["kind"] == "user_note"

    recap = client.get(f"/api/deal/{session.id}/recap", headers=auth_header(token))
    assert len(recap.json()["beats"]) == 1


def test_post_timeline_user_beat_removal_hides_beat(client: TestClient, db):
    user, token = create_user_and_token(db)
    session, deal_state = create_session_with_deal_state(db, user)
    vehicle = create_vehicle(
        db, session.id, role=VehicleRole.PRIMARY, year=2024, make="A", model="B"
    )
    deal = create_deal(db, session.id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.add(deal_state)
    db.commit()

    note = client.post(
        f"/api/deal/{session.id}/recap/timeline-events",
        headers=auth_header(token),
        json={
            "kind": "user_note",
            "world": "Temporary beat to remove.",
            "app": "",
        },
    )
    assert note.status_code == 200
    beat_id = note.json()["id"]

    rem = client.post(
        f"/api/deal/{session.id}/recap/timeline-events",
        headers=auth_header(token),
        json={
            "kind": "user_beat_removal",
            "world": "",
            "app": "",
            "supersedes_event_id": beat_id,
        },
    )
    assert rem.status_code == 200
    assert rem.json()["kind"] == "user_beat_removal"
    assert rem.json()["payload"] == {"removed": True}

    recap = client.get(f"/api/deal/{session.id}/recap", headers=auth_header(token))
    assert recap.json()["beats"] == []


def test_post_timeline_user_beat_removal_unknown_beat_404(client: TestClient, db):
    user, token = create_user_and_token(db)
    session, deal_state = create_session_with_deal_state(db, user)
    res = client.post(
        f"/api/deal/{session.id}/recap/timeline-events",
        headers=auth_header(token),
        json={
            "kind": "user_beat_removal",
            "world": "",
            "app": "",
            "supersedes_event_id": str(uuid.uuid4()),
        },
    )
    assert res.status_code == 404


def test_user_beat_removal_then_regenerate_ok(client: TestClient, db):
    """FK from user tombstones to model rows must not break deleting old model beats."""
    user, token = create_user_and_token(db)
    session, deal_state = create_session_with_deal_state(db, user)
    vehicle = create_vehicle(
        db, session.id, role=VehicleRole.PRIMARY, year=2024, make="A", model="B"
    )
    deal = create_deal(db, session.id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.add(deal_state)
    db.commit()

    fake = EmitDealRecapInput(
        beats=[
            RecapBeatLLM(
                kind="outcome",
                world="First beat.",
                app="",
                user_message_id=None,
                assistant_message_id=None,
            ),
            RecapBeatLLM(
                kind="outcome",
                world="Second beat.",
                app="",
                user_message_id=None,
                assistant_message_id=None,
            ),
        ]
    )

    async def fake_llm(**kwargs):
        return fake, {"input_tokens": 1, "output_tokens": 1}

    with patch(
        "app.services.recap.service.run_recap_generation_llm",
        new=AsyncMock(side_effect=fake_llm),
    ):
        gen1 = client.post(
            f"/api/deal/{session.id}/recap/generate",
            headers=auth_header(token),
            json={"force": True},
        )
    assert gen1.status_code == 200
    beat_ids = [b["id"] for b in gen1.json()["beats"]]
    assert len(beat_ids) == 2

    rem = client.post(
        f"/api/deal/{session.id}/recap/timeline-events",
        headers=auth_header(token),
        json={
            "kind": "user_beat_removal",
            "world": "",
            "app": "",
            "supersedes_event_id": beat_ids[0],
        },
    )
    assert rem.status_code == 200

    with patch(
        "app.services.recap.service.run_recap_generation_llm",
        new=AsyncMock(side_effect=fake_llm),
    ):
        gen2 = client.post(
            f"/api/deal/{session.id}/recap/generate",
            headers=auth_header(token),
            json={"force": True},
        )
    assert gen2.status_code == 200


def test_share_preview_redaction(client: TestClient, db):
    user, token = create_user_and_token(db)
    session, deal_state = create_session_with_deal_state(db, user)
    vehicle = create_vehicle(
        db, session.id, role=VehicleRole.PRIMARY, year=2024, make="A", model="B"
    )
    deal = create_deal(db, session.id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.add(deal_state)
    db.commit()

    fake = EmitDealRecapInput(
        beats=[
            RecapBeatLLM(
                kind="outcome",
                world="We saved $400 on the doc fee.",
                app="",
                user_message_id=None,
                assistant_message_id=None,
            )
        ]
    )

    async def fake_llm(**kwargs):
        return fake, {"input_tokens": 1, "output_tokens": 1}

    with patch(
        "app.services.recap.service.run_recap_generation_llm",
        new=AsyncMock(side_effect=fake_llm),
    ):
        gen = client.post(
            f"/api/deal/{session.id}/recap/generate",
            headers=auth_header(token),
            json={"force": True},
        )
    assert gen.status_code == 200
    assert len(gen.json()["beats"]) >= 1

    prev = client.post(
        f"/api/deal/{session.id}/recap/share-preview",
        headers=auth_header(token),
        json={"redaction": {"hide_dollar_amounts": True}},
    )
    assert prev.status_code == 200
    joined = " ".join(
        (b.get("world") or "") + " " + (b.get("app") or "") for b in prev.json()["beats"]
    )
    assert "$" not in joined or "[amount redacted]" in joined


def test_redaction_hides_dealer_name_in_beats():
    recap = DealRecapResponse(
        session_id="s1",
        active_deal_id="d1",
        generation=None,
        beats=[
            TimelineBeatResponse(
                id="b1",
                session_id="s1",
                deal_id="d1",
                recap_generation_id=None,
                user_message_id=None,
                assistant_message_id=None,
                occurred_at=datetime(2026, 4, 21, 12, 0, tzinfo=timezone.utc),
                kind="test",
                payload={"world": "Met with Acme Motors sales manager.", "app": ""},
                source="model",
                supersedes_event_id=None,
                sort_order=0,
            )
        ],
        savings=SavingsSnapshotResponse(
            first_offer=None,
            current_offer=None,
            concession_vs_first_offer=None,
            monthly_payment=None,
            apr_percent=None,
            loan_term_months=None,
            estimated_total_interest_delta_usd=None,
            assumptions=["Acme Motors offered 0% APR."],
            disclaimer="Ask Acme Motors for final terms.",
        ),
    )
    public = apply_redaction(
        recap,
        RedactionProfile(
            hide_user_message_quotes=False,
            hide_dealer_name=True,
            hide_dollar_amounts=False,
        ),
        dealer_names=["Acme Motors"],
    )
    assert "Acme" not in public.beats[0].world
    assert "the dealership" in public.beats[0].world.lower()
    assert "Acme" not in " ".join(public.savings.assumptions)
    assert "Acme" not in public.savings.disclaimer


def test_redaction_hides_usd_word_amounts():
    recap = DealRecapResponse(
        session_id="s1",
        active_deal_id="d1",
        generation=None,
        beats=[
            TimelineBeatResponse(
                id="b1",
                session_id="s1",
                deal_id="d1",
                recap_generation_id=None,
                user_message_id=None,
                assistant_message_id=None,
                occurred_at=datetime(2026, 4, 21, 12, 0, tzinfo=timezone.utc),
                kind="test",
                payload={"world": "Quoted USD 500 doc fee.", "app": ""},
                source="model",
                supersedes_event_id=None,
                sort_order=0,
            )
        ],
        savings=SavingsSnapshotResponse(),
    )
    public = apply_redaction(
        recap,
        RedactionProfile(
            hide_user_message_quotes=False,
            hide_dealer_name=False,
            hide_dollar_amounts=True,
        ),
    )
    assert "USD" not in public.beats[0].world or "[amount redacted]" in public.beats[0].world


def test_generate_skips_llm_when_force_false_and_succeeded_exists(client: TestClient, db):
    user, token = create_user_and_token(db)
    session, deal_state = create_session_with_deal_state(db, user)
    vehicle = create_vehicle(
        db, session.id, role=VehicleRole.PRIMARY, year=2024, make="A", model="B"
    )
    deal = create_deal(db, session.id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.add(deal_state)
    db.commit()

    fake = EmitDealRecapInput(
        beats=[
            RecapBeatLLM(
                kind="outcome",
                world="One.",
                app="",
                user_message_id=None,
                assistant_message_id=None,
            )
        ]
    )

    async def fake_llm(**kwargs):
        return fake, {"input_tokens": 1, "output_tokens": 1}

    with patch(
        "app.services.recap.service.run_recap_generation_llm",
        new=AsyncMock(side_effect=fake_llm),
    ):
        first = client.post(
            f"/api/deal/{session.id}/recap/generate",
            headers=auth_header(token),
            json={"force": True},
        )
    assert first.status_code == 200

    async def should_not_run(**kwargs):
        raise AssertionError("LLM should not run when force is false and recap exists")

    with patch(
        "app.services.recap.service.run_recap_generation_llm",
        new=AsyncMock(side_effect=should_not_run),
    ):
        second = client.post(
            f"/api/deal/{session.id}/recap/generate",
            headers=auth_header(token),
            json={"force": False},
        )
    assert second.status_code == 200
    assert len(second.json()["beats"]) == 1


def test_generate_empty_beats_returns_422_and_preserves_beats(client: TestClient, db):
    user, token = create_user_and_token(db)
    session, deal_state = create_session_with_deal_state(db, user)
    vehicle = create_vehicle(
        db, session.id, role=VehicleRole.PRIMARY, year=2024, make="A", model="B"
    )
    deal = create_deal(db, session.id, vehicle.id)
    deal_state.active_deal_id = deal.id
    db.add(deal_state)
    db.commit()

    good = EmitDealRecapInput(
        beats=[
            RecapBeatLLM(
                kind="outcome",
                world="Kept beat.",
                app="",
                user_message_id=None,
                assistant_message_id=None,
            )
        ]
    )

    async def fake_good(**kwargs):
        return good, {"input_tokens": 1, "output_tokens": 1}

    with patch(
        "app.services.recap.service.run_recap_generation_llm",
        new=AsyncMock(side_effect=fake_good),
    ):
        gen1 = client.post(
            f"/api/deal/{session.id}/recap/generate",
            headers=auth_header(token),
            json={"force": True},
        )
    assert gen1.status_code == 200
    assert len(gen1.json()["beats"]) == 1

    empty = EmitDealRecapInput(beats=[])

    async def fake_empty(**kwargs):
        return empty, {"input_tokens": 1, "output_tokens": 1}

    with patch(
        "app.services.recap.service.run_recap_generation_llm",
        new=AsyncMock(side_effect=fake_empty),
    ):
        bad = client.post(
            f"/api/deal/{session.id}/recap/generate",
            headers=auth_header(token),
            json={"force": True},
        )
    assert bad.status_code == 422

    recap = client.get(f"/api/deal/{session.id}/recap", headers=auth_header(token))
    assert recap.status_code == 200
    assert len(recap.json()["beats"]) == 1
    assert "Kept beat" in recap.json()["beats"][0]["payload"]["world"]
