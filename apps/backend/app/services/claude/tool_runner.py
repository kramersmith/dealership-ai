from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncGenerator

from sqlalchemy import select

from app.services.tool_validation import ToolValidationError
from app.services.turn_context import TurnContext

logger = logging.getLogger(__name__)


async def execute_tool_batch(
    batch: list[dict],
    turn_context: TurnContext,
    session_factory,
) -> AsyncGenerator[tuple[dict, list[dict] | Exception], None]:
    """Execute a priority batch concurrently with isolated DB sessions.

    Tools within a batch are classified as independent by build_execution_plan().
    Each tool runs in its own session and transaction:
    - On success, changes are committed immediately.
    - On failure, only the failing tool rolls back; other tools' changes persist.

    This is intentional — independent tools update disjoint state (e.g.,
    update_deal_numbers and update_checklist). Partial commits on failure
    match the pre-concurrency behavior where individual tool errors were already
    reported back to Claude without rolling back other tools.

    The caller (chat.py) refreshes the main session after all batches complete
    to pick up committed changes via db.refresh(deal_state).

    Results are yielded in original batch order regardless of completion order.
    """
    from app.models.deal_state import DealState
    from app.services.deal_state import execute_tool

    async def _run_one(
        index: int, block: dict
    ) -> tuple[int, dict, list[dict] | Exception]:
        async with session_factory() as tool_db:
            try:
                if turn_context.deal_state is None:
                    raise RuntimeError("Deal state no longer exists")
                result = await tool_db.execute(
                    select(DealState).where(DealState.id == turn_context.deal_state.id)
                )
                tool_deal_state = result.scalar_one_or_none()
                if tool_deal_state is None:
                    raise RuntimeError("Deal state no longer exists")
                tool_context = turn_context.for_db_session(
                    tool_db,
                    deal_state=tool_deal_state,
                )
                applied = await execute_tool(
                    block["name"],
                    block["input"],
                    tool_context,
                )
                await tool_db.commit()
                return index, block, applied
            except ToolValidationError as exc:
                await tool_db.rollback()
                logger.warning(
                    "Step %d: tool [%s] validation failed: %s",
                    turn_context.step,
                    block["name"],
                    exc,
                )
                return index, block, exc
            except Exception as exc:
                await tool_db.rollback()
                logger.exception(
                    "Step %d: tool [%s] execution failed",
                    turn_context.step,
                    block["name"],
                )
                return index, block, exc

    tasks = [
        asyncio.create_task(_run_one(index, block)) for index, block in enumerate(batch)
    ]
    ready: dict[int, tuple[dict, list[dict] | Exception]] = {}
    next_index = 0

    for task in asyncio.as_completed(tasks):
        index, block, outcome = await task
        ready[index] = (block, outcome)
        while next_index in ready:
            yield ready.pop(next_index)
            next_index += 1
