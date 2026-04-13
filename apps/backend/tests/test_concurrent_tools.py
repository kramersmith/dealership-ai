"""Tests for concurrent tool execution and step loop mechanics."""

from app.models.deal import Deal
from app.models.deal_state import DealState
from app.models.enums import HealthStatus, VehicleRole
from app.models.session import ChatSession
from app.models.user import User
from app.models.vehicle import Vehicle
from app.services.claude import ChatLoopResult, execute_tool_batch
from app.services.deal_state import build_execution_plan
from app.services.turn_context import TurnContext
from sqlalchemy import select

from tests.conftest import TestingAsyncSessionLocal

# ─── Multi-step text accumulation ───


def test_multi_step_text_adds_paragraph_break():
    """Text from consecutive steps gets a paragraph break if no trailing whitespace."""
    result = ChatLoopResult()
    result.full_text += "First step ends here"
    # Simulate the accumulation logic from stream_chat_loop
    step_text = "Second step starts here"
    if step_text and result.full_text and not result.full_text.endswith(("\n", " ")):
        result.full_text += "\n\n"
    result.full_text += step_text
    assert result.full_text == "First step ends here\n\nSecond step starts here"


def test_multi_step_text_no_double_break_when_trailing_newline():
    """No extra break added if previous step already ends with a newline."""
    result = ChatLoopResult()
    result.full_text += "First step ends here\n"
    step_text = "Second step starts here"
    if step_text and result.full_text and not result.full_text.endswith(("\n", " ")):
        result.full_text += "\n\n"
    result.full_text += step_text
    assert result.full_text == "First step ends here\nSecond step starts here"


def test_multi_step_text_no_break_on_empty_step():
    """Empty step text doesn't produce spurious whitespace."""
    result = ChatLoopResult()
    result.full_text += "First step"
    step_text = ""
    if step_text and result.full_text and not result.full_text.endswith(("\n", " ")):
        result.full_text += "\n\n"
    result.full_text += step_text
    assert result.full_text == "First step"


# ─── build_execution_plan (pure function) ───


def _block(name: str, tool_id: str = "t1") -> dict:
    return {"id": tool_id, "name": name, "input": {}}


def test_build_execution_plan_single_tool():
    blocks = [_block("update_deal_numbers")]
    plan = build_execution_plan(blocks)
    assert len(plan) == 1
    assert plan[0] == blocks


def test_build_execution_plan_all_same_priority():
    blocks = [
        _block("update_deal_numbers", "t1"),
        _block("update_checklist", "t2"),
        _block("update_deal_health", "t3"),
    ]
    plan = build_execution_plan(blocks)
    assert len(plan) == 2
    assert [b["name"] for b in plan[0]] == [
        "update_deal_numbers",
        "update_checklist",
    ]
    assert [b["name"] for b in plan[1]] == ["update_deal_health"]


def test_build_execution_plan_mixed_priorities():
    blocks = [
        _block("update_deal_numbers", "t1"),  # priority 2
        _block("set_vehicle", "t2"),  # priority 0
        _block("create_deal", "t3"),  # priority 1
        _block("update_checklist", "t4"),  # priority 2
    ]
    plan = build_execution_plan(blocks)
    assert len(plan) == 3
    # Priority 0 first
    assert [b["name"] for b in plan[0]] == ["set_vehicle"]
    # Priority 1 second
    assert [b["name"] for b in plan[1]] == ["create_deal"]
    # Priority 2 last, preserving original call order
    assert [b["name"] for b in plan[2]] == [
        "update_deal_numbers",
        "update_checklist",
    ]


def test_build_execution_plan_preserves_order_within_batch():
    blocks = [
        _block("update_checklist", "t1"),
        _block("update_deal_health", "t2"),
        _block("update_deal_numbers", "t3"),
    ]
    plan = build_execution_plan(blocks)
    assert len(plan) == 2
    assert [b["id"] for b in plan[0]] == ["t1", "t3"]
    assert [b["id"] for b in plan[1]] == ["t2"]


def test_build_execution_plan_empty_input():
    assert build_execution_plan([]) == []


# ─── execute_tool_batch (real async DB via shared test.db) ───


async def _setup_session_with_deal(adb) -> tuple[User, DealState, Deal]:
    """Create user → session → deal_state → vehicle → deal. Returns (user, deal_state, deal)."""
    from app.core.security import hash_password
    from app.models.enums import UserRole

    user = User(
        email="batch@test.com",
        hashed_password=hash_password("pw"),
        role=UserRole.BUYER,
        display_name="Batch",
    )
    adb.add(user)
    await adb.flush()
    session = ChatSession(user_id=user.id, title="Batch Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()
    vehicle = Vehicle(session_id=session.id, role=VehicleRole.PRIMARY)
    adb.add(vehicle)
    await adb.flush()
    deal = Deal(session_id=session.id, vehicle_id=vehicle.id)
    adb.add(deal)
    await adb.flush()
    deal_state.active_deal_id = deal.id
    await adb.commit()
    await adb.refresh(deal_state)
    await adb.refresh(deal)
    return user, deal_state, deal


async def test_execute_tool_batch_single_tool(adb):
    """Single tool executes and commits in isolated session."""
    _, deal_state, deal = await _setup_session_with_deal(adb)

    batch = [
        {
            "id": "t1",
            "name": "update_deal_numbers",
            "input": {"listing_price": 35000},
        }
    ]

    results = []
    turn_context = TurnContext.create(session=None, deal_state=deal_state, db=adb)
    async for block, outcome in execute_tool_batch(
        batch,
        turn_context.for_step(0),
        session_factory=TestingAsyncSessionLocal,
    ):
        results.append((block, outcome))

    assert len(results) == 1
    block, outcome = results[0]
    assert block["id"] == "t1"
    assert not isinstance(outcome, Exception)
    assert any(tc["name"] == "update_deal_numbers" for tc in outcome)

    # Verify committed to DB — query from our session (separate from tool's session)
    await adb.refresh(deal)
    assert deal.listing_price == 35000


async def test_execute_tool_batch_multiple_independent_tools(adb):
    """Multiple tools in a batch all succeed and commit."""
    _, deal_state, deal = await _setup_session_with_deal(adb)

    batch = [
        {
            "id": "t1",
            "name": "update_deal_numbers",
            "input": {"listing_price": 40000, "current_offer": 38000},
        },
        {
            "id": "t2",
            "name": "update_buyer_context",
            "input": {"buyer_context": "at_dealership"},
        },
        {
            "id": "t3",
            "name": "update_checklist",
            "input": {"items": [{"label": "Check VIN", "done": False}]},
        },
    ]

    results = []
    turn_context = TurnContext.create(session=None, deal_state=deal_state, db=adb)
    async for block, outcome in execute_tool_batch(
        batch,
        turn_context.for_step(0),
        session_factory=TestingAsyncSessionLocal,
    ):
        results.append((block, outcome))

    assert len(results) == 3
    # All succeeded
    for _, outcome in results:
        assert not isinstance(outcome, Exception)

    # Verify deal numbers committed
    await adb.refresh(deal)
    assert deal.listing_price == 40000
    assert deal.current_offer == 38000

    # Verify checklist committed
    await adb.refresh(deal_state)
    assert len(deal_state.checklist) == 1


async def test_execute_tool_batch_error_isolation(adb):
    """One tool fails but others' changes persist."""
    _, deal_state, deal = await _setup_session_with_deal(adb)

    batch = [
        {
            "id": "t1",
            "name": "update_deal_numbers",
            "input": {"listing_price": 42000},
        },
        {
            "id": "t2",
            "name": "switch_active_deal",
            "input": {"deal_id": "nonexistent-deal-id"},
        },
    ]

    results = []
    turn_context = TurnContext.create(session=None, deal_state=deal_state, db=adb)
    async for block, outcome in execute_tool_batch(
        batch,
        turn_context.for_step(0),
        session_factory=TestingAsyncSessionLocal,
    ):
        results.append((block, outcome))

    assert len(results) == 2
    # First tool succeeded
    _, outcome1 = results[0]
    assert not isinstance(outcome1, Exception)

    # Second tool may fail or return empty (switch_active_deal validates deal existence)
    # The key assertion: first tool's changes persisted despite second tool
    await adb.refresh(deal)
    assert deal.listing_price == 42000


async def test_execute_tool_batch_ordered_yielding(adb):
    """Results yield in original call order regardless of completion order."""
    _, deal_state, _ = await _setup_session_with_deal(adb)

    batch = [
        {
            "id": "t1",
            "name": "update_buyer_context",
            "input": {"buyer_context": "at_dealership"},
        },
        {"id": "t2", "name": "update_checklist", "input": {"items": []}},
        {"id": "t3", "name": "update_deal_numbers", "input": {"listing_price": 41000}},
    ]

    result_ids = []
    turn_context = TurnContext.create(session=None, deal_state=deal_state, db=adb)
    async for block, _ in execute_tool_batch(
        batch,
        turn_context.for_step(0),
        session_factory=TestingAsyncSessionLocal,
    ):
        result_ids.append(block["id"])

    # Must match original call order
    assert result_ids == ["t1", "t2", "t3"]


async def test_execute_tool_batch_health_runs_after_numbers_batch(adb):
    """Priority 3 health runs in a later batch so DB has committed numbers."""
    from app.services.deal_state import build_execution_plan

    _, deal_state, deal = await _setup_session_with_deal(adb)

    blocks = [
        {
            "id": "t1",
            "name": "update_deal_numbers",
            "input": {"listing_price": 31000},
        },
        {
            "id": "t2",
            "name": "update_deal_health",
            "input": {
                "status": "good",
                "summary": "Fair vs listing",
                "recommendation": "Ask about fees",
            },
        },
    ]
    plan = build_execution_plan(blocks)
    assert len(plan) == 2

    turn_ctx = TurnContext.create(session=None, deal_state=deal_state, db=adb).for_step(
        0
    )
    for batch in plan:
        async for block, outcome in execute_tool_batch(
            batch,
            turn_ctx,
            session_factory=TestingAsyncSessionLocal,
        ):
            assert not isinstance(outcome, Exception), (block, outcome)

    await adb.refresh(deal)
    assert deal.listing_price == 31000
    assert deal.health_status == HealthStatus.GOOD


# ─── Integration: batch sequencing ───


async def test_batches_execute_in_priority_order(adb):
    """Structural tools (priority 0) commit before field updates (priority 2) run."""
    # Set up session without a vehicle/deal — set_vehicle will create them
    from app.core.security import hash_password
    from app.models.enums import UserRole

    user = User(
        email="seq@test.com",
        hashed_password=hash_password("pw"),
        role=UserRole.BUYER,
        display_name="Seq",
    )
    adb.add(user)
    await adb.flush()
    session = ChatSession(user_id=user.id, title="Seq Test")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.commit()
    await adb.refresh(deal_state)

    # Batch 0: structural — creates vehicle + auto-deal
    batch_0 = [
        {
            "id": "t1",
            "name": "set_vehicle",
            "input": {"role": "primary", "make": "Honda", "model": "Civic"},
        }
    ]
    results_0 = []
    turn_context = TurnContext.create(session=None, deal_state=deal_state, db=adb)
    async for block, outcome in execute_tool_batch(
        batch_0,
        turn_context.for_step(0),
        session_factory=TestingAsyncSessionLocal,
    ):
        results_0.append((block, outcome))

    assert len(results_0) == 1
    _, outcome = results_0[0]
    assert not isinstance(outcome, Exception)
    tool_names = [tc["name"] for tc in outcome]
    assert "set_vehicle" in tool_names
    assert "create_deal" in tool_names

    # Refresh deal_state to see the auto-created active_deal_id
    await adb.refresh(deal_state)
    assert deal_state.active_deal_id is not None

    # Batch 2: field update — depends on deal existing from batch 0
    batch_2 = [
        {
            "id": "t2",
            "name": "update_deal_numbers",
            "input": {"listing_price": 25000},
        }
    ]
    results_2 = []
    turn_context = TurnContext.create(session=None, deal_state=deal_state, db=adb)
    async for block, outcome in execute_tool_batch(
        batch_2,
        turn_context.for_step(0),
        session_factory=TestingAsyncSessionLocal,
    ):
        results_2.append((block, outcome))

    assert len(results_2) == 1
    _, outcome = results_2[0]
    assert not isinstance(outcome, Exception)

    # Verify the deal (created by batch 0) was updated by batch 2
    deal_result = await adb.execute(
        select(Deal).where(Deal.id == deal_state.active_deal_id)
    )
    deal = deal_result.scalar_one()
    assert deal.listing_price == 25000
