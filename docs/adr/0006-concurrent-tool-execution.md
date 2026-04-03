# ADR-0006: Priority-Based Concurrent Tool Execution

**Status:** Accepted
**Date:** 2026-03
**Deciders:** Kramer Smith

## Context

The chat step loop (`stream_chat_loop()` in `claude.py`) calls Claude with up to 17 operational tools. Claude frequently returns multiple `tool_use` blocks in a single response — for example, `set_vehicle`, `update_deal_numbers`, `update_scorecard`, `update_deal_health`, and `update_quick_actions` in one turn. Under the original sequential implementation, each tool was executed one at a time against the shared `AsyncSession`. This worked but introduced unnecessary latency: most tools update disjoint state (different DB rows or JSON columns) and have no data dependency on each other. A typical multi-tool response took the sum of all individual tool execution times rather than the maximum.

However, not all tools are independent. Some tools produce state that others depend on:

- **Structural tools** (`set_vehicle`, `remove_vehicle`) create or delete `Vehicle` rows. Other tools (e.g., `update_deal_numbers`) operate on deals linked to those vehicles. Running them concurrently would create race conditions where a deal references a vehicle that does not yet exist.
- **Context switches** (`create_deal`, `switch_active_deal`) change `deal_state.active_deal_id`. Many field-update tools resolve their target deal via `get_active_deal()`, so the active deal must be set before those tools run.

Additionally, SQLAlchemy's `AsyncSession` is not safe for concurrent use — multiple coroutines sharing a session leads to unpredictable state, interleaved transactions, and integrity errors.

## Decision

Execute tools in **priority-based batches** using `asyncio.gather()`, with each concurrent tool receiving an **isolated `AsyncSession`** from the session factory.

### Priority tiers

Tools are assigned a priority in `TOOL_PRIORITY` (`deal_state.py`). Lower numbers run first:

| Priority | Tools | Rationale |
|----------|-------|-----------|
| 0 | `set_vehicle`, `remove_vehicle` | Structural — create/delete entities that other tools reference |
| 1 | `create_deal`, `switch_active_deal` | Context switches — set `active_deal_id` used by field-update tools |
| 2 (default) | All other tools (`update_deal_numbers`, `update_scorecard`, `update_deal_health`, `update_deal_red_flags`, `update_checklist`, `update_quick_actions`, etc.) | Field updates — operate on disjoint state within an already-established deal |

`build_execution_plan()` groups tool blocks into ordered batches by priority. Batches execute sequentially (priority 0 completes before priority 1 starts). Within a batch, all tools run concurrently.

### Isolated session pattern

`_execute_tool_batch()` spawns one `asyncio.Task` per tool in a batch. Each task:

1. Opens a fresh `AsyncSession` from the session factory (`AsyncSessionLocal`)
2. Loads the `DealState` from the database within its own session
3. Calls `execute_tool()` with the isolated session
4. On success, commits the transaction immediately
5. On failure, rolls back only the failing tool's transaction — other tools' changes persist

This mirrors the pre-concurrency behavior where individual tool errors were already reported back to Claude without rolling back other tools. The caller refreshes the main session's `DealState` after all batches complete to pick up the committed changes.

### Result ordering

Results are yielded in the original batch order regardless of task completion order. `_execute_tool_batch()` uses `asyncio.as_completed()` internally but buffers results and yields them sequentially by index. This ensures deterministic SSE event ordering for the frontend.

## Alternatives Considered

### Option A: Sequential execution (status quo)

- Pros: Simple, no concurrency concerns, shared session works as-is
- Cons: Latency scales linearly with tool count. A 5-tool response takes 5x the single-tool time. With Claude regularly returning 4-8 tools per step, this added noticeable delay to the SSE stream — the user waited for all tools to complete before the next Claude call could begin.

### Option B: Fully parallel execution (no priority ordering)

- Pros: Maximum concurrency, simplest concurrent implementation
- Cons: Creates race conditions between dependent tools. A `create_deal` running concurrently with `update_deal_numbers` means the numbers update may target the wrong deal (or no deal) because `active_deal_id` has not been set yet. A `set_vehicle` running concurrently with `create_deal` means the deal may reference a vehicle row that does not exist yet. Fixing these ordering bugs at the individual tool level would scatter concurrency concerns across every tool handler.

### Option C: Queue-based execution with a worker pool

- Pros: Decouples tool submission from execution, natural backpressure, could be extended to cross-request parallelism
- Cons: Significant complexity for a problem that is bounded (max 5 steps per turn, max ~17 tools per step). Introduces a new infrastructure primitive (task queue) for what is fundamentally in-process parallelism within a single SSE response. The priority ordering would still need to be imposed on top of the queue, adding more coordination logic. Overkill for the current scale.

### Option D: Shared session with explicit locking

- Pros: No session-per-tool overhead, single transaction for atomicity
- Cons: SQLAlchemy `AsyncSession` is explicitly not safe for concurrent coroutine access. Even with manual locking, the ORM's identity map and dirty-tracking state would be corrupted by concurrent mutations. Would require rewriting the session layer or dropping to raw SQL.

## Consequences

- **Positive:** Tool execution within a batch runs in parallel, reducing per-step latency from the sum to the maximum of individual tool times. For a typical 5-tool batch, this is roughly a 3-4x speedup in the tool execution phase.
- **Positive:** Fault isolation — a failing tool rolls back only its own transaction. Other tools' committed changes persist, and the error is reported to Claude as a tool error for self-correction on the next step.
- **Positive:** Deterministic SSE event ordering despite concurrent execution, so the frontend receives tool results in a predictable sequence.
- **Positive:** The priority system is declarative — adding a new tool only requires adding an entry to `TOOL_PRIORITY` if it has ordering constraints; otherwise it defaults to the concurrent batch (priority 2).
- **Negative:** Each concurrent tool opens its own DB session and transaction. For a batch of N tools, this means N connections from the pool. With `CHAT_LOOP_MAX_STEPS = 5` and up to ~17 tools, the worst case is ~17 concurrent connections per request. In practice, priority batching limits concurrency to the largest single-priority batch (typically 5-10 tools at priority 2).
- **Negative:** Each tool loads its own copy of `DealState`, so intra-batch mutations to `DealState` fields (e.g., `checklist`, `red_flags`) are not visible to sibling tools in the same batch. This is acceptable because tools within a batch update disjoint fields by design. If a future tool needs to read another tool's output within the same step, it must be assigned a higher priority number to run in a later batch.
- **Negative:** The main session must be refreshed after batch execution to see committed changes, adding a conceptual indirection that developers must understand.
- **Neutral:** Test infrastructure accepts an injectable `session_factory` parameter on `stream_chat_loop()`, allowing tests to provide controlled session factories without hitting the global `AsyncSessionLocal`.

## References

- [Tool execution implementation](../../apps/backend/app/services/claude.py) — `_execute_tool_batch()`, `stream_chat_loop()`
- [Priority definitions and execution plan](../../apps/backend/app/services/deal_state.py) — `TOOL_PRIORITY`, `build_execution_plan()`, `execute_tool()`
- [Introducing commit](https://github.com) — `a4e4361 feat(chat): add async tool execution and retry UX`
- [SQLAlchemy async session docs](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html#using-asyncsession-with-concurrent-tasks)
