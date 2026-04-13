"""Session branch: truncate messages after anchor and reset commerce."""

import pytest
from app.models.deal import Deal
from app.models.enums import (
    BuyerContext,
    InsightsFollowupKind,
    InsightsFollowupStatus,
    InsightsFollowupStepStatus,
    MessageRole,
)
from app.models.insights_followup_job import InsightsFollowupJob
from app.models.message import Message
from app.models.vehicle import Vehicle
from app.services.session_branch import (
    BranchAnchorNotFoundError,
    BranchAnchorNotUserError,
    prepare_session_branch_from_user_message,
    reset_session_commerce_state,
)
from sqlalchemy import select

from tests.conftest import (
    async_create_deal,
    async_create_session_with_deal_state,
    async_create_user,
    async_create_vehicle,
)


@pytest.mark.asyncio
async def test_reset_session_commerce_state_preserves_buyer_context(adb):
    user = await async_create_user(adb)
    session, deal_state = await async_create_session_with_deal_state(adb, user)
    deal_state.buyer_context = BuyerContext.REVIEWING_DEAL
    vehicle = await async_create_vehicle(
        adb, session.id, make="Honda", model="Civic", year=2024
    )
    await async_create_deal(adb, session.id, vehicle.id, dealer_name="Acme")
    await adb.commit()

    await reset_session_commerce_state(session.id, adb)
    await adb.commit()

    await adb.refresh(deal_state)
    assert deal_state.buyer_context == BuyerContext.REVIEWING_DEAL
    assert deal_state.active_deal_id is None
    assert deal_state.ai_panel_cards == []

    vehicle_result = await adb.execute(
        select(Vehicle).where(Vehicle.session_id == session.id)
    )
    assert vehicle_result.scalars().first() is None
    deal_result = await adb.execute(select(Deal).where(Deal.session_id == session.id))
    assert deal_result.scalars().first() is None


@pytest.mark.asyncio
async def test_prepare_branch_deletes_tail_and_clears_session_fields(adb):
    user = await async_create_user(adb)
    session, _initial_deal_state = await async_create_session_with_deal_state(adb, user)
    session.compaction_state = {"rolling_summary": "old", "first_kept_message_id": "x"}
    session.usage = {"request_count": 5, "input_tokens": 100}

    anchor_user_message = Message(
        session_id=session.id, role=MessageRole.USER, content="one"
    )
    assistant_reply = Message(
        session_id=session.id, role=MessageRole.ASSISTANT, content="two"
    )
    trailing_user_message = Message(
        session_id=session.id,
        role=MessageRole.USER,
        content="three",
    )
    adb.add_all([anchor_user_message, assistant_reply, trailing_user_message])
    await adb.commit()
    await adb.refresh(anchor_user_message)
    await adb.refresh(assistant_reply)
    await adb.refresh(trailing_user_message)

    vehicle = await async_create_vehicle(adb, session.id, make="Toyota", model="Camry")
    await async_create_deal(adb, session.id, vehicle.id)
    await adb.commit()

    removed = await prepare_session_branch_from_user_message(
        adb,
        session,
        anchor_user_message.id,
    )
    assert removed == 2

    rows = (
        (
            await adb.execute(
                select(Message)
                .where(Message.session_id == session.id)
                .order_by(Message.created_at, Message.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].id == anchor_user_message.id

    await adb.refresh(session)
    assert session.compaction_state is None
    assert session.usage is None

    vehicle_result = await adb.execute(
        select(Vehicle).where(Vehicle.session_id == session.id)
    )
    assert vehicle_result.scalars().first() is None


@pytest.mark.asyncio
async def test_prepare_branch_deletes_followup_jobs_for_deleted_assistant_messages(adb):
    user = await async_create_user(adb)
    session, _initial_deal_state = await async_create_session_with_deal_state(adb, user)

    anchor_user_message = Message(
        session_id=session.id, role=MessageRole.USER, content="one"
    )
    assistant_reply = Message(
        session_id=session.id,
        role=MessageRole.ASSISTANT,
        content="two",
    )
    trailing_user_message = Message(
        session_id=session.id,
        role=MessageRole.USER,
        content="three",
    )
    adb.add_all([anchor_user_message, assistant_reply, trailing_user_message])
    await adb.commit()
    await adb.refresh(anchor_user_message)
    await adb.refresh(assistant_reply)

    followup_job = InsightsFollowupJob(
        session_id=session.id,
        assistant_message_id=assistant_reply.id,
        kind=InsightsFollowupKind.LINKED_RECONCILE_PANEL.value,
        status=InsightsFollowupStatus.SUCCEEDED.value,
        reconcile_status=InsightsFollowupStepStatus.SUCCEEDED.value,
        panel_status=InsightsFollowupStepStatus.SUCCEEDED.value,
        attempts=1,
    )
    adb.add(followup_job)
    await adb.commit()

    removed = await prepare_session_branch_from_user_message(
        adb,
        session,
        anchor_user_message.id,
    )

    assert removed == 2
    remaining_job = await adb.scalar(
        select(InsightsFollowupJob).where(InsightsFollowupJob.id == followup_job.id)
    )
    assert remaining_job is None


@pytest.mark.asyncio
async def test_prepare_branch_no_tail_still_clears_session_and_commerce(adb):
    user = await async_create_user(adb)
    session, deal_state = await async_create_session_with_deal_state(adb, user)
    deal_state.buyer_context = BuyerContext.REVIEWING_DEAL
    anchor_user_message = Message(
        session_id=session.id, role=MessageRole.USER, content="only"
    )
    adb.add(anchor_user_message)
    await adb.commit()
    await adb.refresh(anchor_user_message)

    session.compaction_state = {"k": "v"}
    session.usage = {"input_tokens": 1}
    await adb.commit()

    vehicle = await async_create_vehicle(adb, session.id, make="Toyota", model="Camry")
    await async_create_deal(adb, session.id, vehicle.id)
    await adb.commit()

    removed = await prepare_session_branch_from_user_message(
        adb,
        session,
        anchor_user_message.id,
    )
    assert removed == 0

    rows = (
        (
            await adb.execute(
                select(Message)
                .where(Message.session_id == session.id)
                .order_by(Message.created_at, Message.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1
    assert rows[0].id == anchor_user_message.id

    await adb.refresh(session)
    await adb.refresh(deal_state)
    assert session.compaction_state is None
    assert session.usage is None
    assert deal_state.buyer_context == BuyerContext.REVIEWING_DEAL

    vehicle_result = await adb.execute(
        select(Vehicle).where(Vehicle.session_id == session.id)
    )
    assert vehicle_result.scalars().first() is None


@pytest.mark.asyncio
async def test_prepare_branch_raises_when_anchor_not_found(adb):
    user = await async_create_user(adb)
    session, _initial_deal_state = await async_create_session_with_deal_state(adb, user)
    await adb.commit()

    with pytest.raises(BranchAnchorNotFoundError):
        await prepare_session_branch_from_user_message(
            adb, session, "00000000-0000-0000-0000-000000000000"
        )


@pytest.mark.asyncio
async def test_prepare_branch_raises_when_anchor_is_not_user_message(adb):
    user = await async_create_user(adb)
    session, _initial_deal_state = await async_create_session_with_deal_state(adb, user)
    user_message = Message(session_id=session.id, role=MessageRole.USER, content="hi")
    assistant_message = Message(
        session_id=session.id, role=MessageRole.ASSISTANT, content="hello"
    )
    adb.add_all([user_message, assistant_message])
    await adb.commit()
    await adb.refresh(assistant_message)

    with pytest.raises(BranchAnchorNotUserError):
        await prepare_session_branch_from_user_message(
            adb, session, assistant_message.id
        )


@pytest.mark.asyncio
async def test_prepare_branch_is_idempotent_when_called_twice(adb):
    """Second call with the same anchor (now the only surviving message) trims nothing more."""
    user = await async_create_user(adb)
    session, _initial_deal_state = await async_create_session_with_deal_state(adb, user)
    anchor_user_message = Message(
        session_id=session.id, role=MessageRole.USER, content="one"
    )
    assistant_reply = Message(
        session_id=session.id, role=MessageRole.ASSISTANT, content="two"
    )
    trailing_user_message = Message(
        session_id=session.id,
        role=MessageRole.USER,
        content="three",
    )
    adb.add_all([anchor_user_message, assistant_reply, trailing_user_message])
    await adb.commit()
    await adb.refresh(anchor_user_message)

    removed_first = await prepare_session_branch_from_user_message(
        adb,
        session,
        anchor_user_message.id,
    )
    assert removed_first == 2

    removed_second = await prepare_session_branch_from_user_message(
        adb, session, anchor_user_message.id
    )
    assert removed_second == 0

    rows = (
        (
            await adb.execute(
                select(Message)
                .where(Message.session_id == session.id)
                .order_by(Message.created_at, Message.id)
            )
        )
        .scalars()
        .all()
    )
    assert [message.id for message in rows] == [anchor_user_message.id]
