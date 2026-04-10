import pytest
from app.services.turn_cancellation import (
    TurnAlreadyActiveError,
    TurnCancellationRegistry,
)


@pytest.mark.asyncio
async def test_turn_registry_start_cancel_end_happy_path() -> None:
    registry = TurnCancellationRegistry()

    state = await registry.start_turn(session_id="s1", user_id="u1")
    assert state.session_id == "s1"
    assert state.user_id == "u1"
    assert state.cancelled is False

    cancelled = await registry.cancel_turn(
        session_id="s1", user_id="u1", turn_id=state.turn_id
    )
    assert cancelled.outcome == "cancelled"
    assert cancelled.cancelled is True
    assert cancelled.turn_id == state.turn_id
    assert state.cancelled is True

    already = await registry.cancel_turn(
        session_id="s1", user_id="u1", turn_id=state.turn_id
    )
    assert already.outcome == "already_cancelled"
    assert already.cancelled is False
    assert already.turn_id == state.turn_id

    await registry.end_turn(state)
    not_found = await registry.cancel_turn(
        session_id="s1", user_id="u1", turn_id=state.turn_id
    )
    assert not_found.outcome == "not_found"
    assert not_found.cancelled is False


@pytest.mark.asyncio
async def test_turn_registry_rejects_second_active_turn_for_same_session() -> None:
    registry = TurnCancellationRegistry()
    state = await registry.start_turn(session_id="s1", user_id="u1")

    with pytest.raises(TurnAlreadyActiveError):
        await registry.start_turn(session_id="s1", user_id="u1")

    await registry.end_turn(state)


@pytest.mark.asyncio
async def test_turn_registry_turn_id_guard_and_user_isolation() -> None:
    registry = TurnCancellationRegistry()
    state = await registry.start_turn(session_id="s1", user_id="u1")

    wrong_turn = await registry.cancel_turn(
        session_id="s1", user_id="u1", turn_id="different-turn"
    )
    assert wrong_turn.outcome == "turn_mismatch"
    assert wrong_turn.turn_id == state.turn_id

    wrong_user = await registry.cancel_turn(
        session_id="s1", user_id="u2", turn_id=state.turn_id
    )
    assert wrong_user.outcome == "not_found"
