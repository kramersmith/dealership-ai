# ADR-0003: Single Mutable Deal State Row

**Status:** Accepted
**Date:** 2026-03
**Deciders:** Kramer Smith

## Context

The buyer app's dashboard displays a rich, persistent state for each chat session: deal phase, financial numbers (MSRP, offers, APR, payments), vehicle details, a scorecard with color-coded ratings, and a checklist. This state is updated incrementally by Claude's tool calls during conversation — for example, when a user says "they offered $34k", Claude calls `update_deal_numbers({ listing_price: 34000 })` and only that field changes.

The question is how to store and retrieve this state. The dashboard needs to load the current state quickly on session open, and updates happen frequently (potentially multiple tool calls per message). The state shape is well-defined: a fixed set of fields across five categories (phase, numbers, vehicle, scorecard, checklist).

## Decision

Use a single mutable `deal_states` row per chat session. The row is created when a session starts and updated in place whenever Claude makes a tool call. The schema has explicit columns for each field:

- **Phase:** `phase` (enum: research, initial_contact, test_drive, negotiation, financing, closing)
- **Numbers:** `msrp`, `invoice_price`, `listing_price`, `your_target`, `current_offer`, `monthly_payment`, `apr`, `loan_term_months`, `down_payment`, `trade_in_value`
- **Vehicle:** `year`, `make`, `model`, `trim`, `vin`, `mileage`, `color`
- **Scorecard:** `score_price`, `score_financing`, `score_trade_in`, `score_fees`, `score_overall` (red/yellow/green)
- **Checklist:** `checklist` (JSON array of `{label, done}`)

Each tool call results in a partial UPDATE — only the fields included in the tool call payload are modified. The frontend fetches the full row on session load and applies incremental updates from SSE `tool_result` events during conversation.

## Alternatives Considered

### Option A: Event-sourced history table
- Pros: Full audit trail of every change (who changed what, when). Enables "undo" or "replay" features. Can reconstruct state at any point in time. Natural fit for the tool-call-driven update pattern (each tool call is an event).
- Cons: Reads require replaying all events to compute current state (or maintaining a separate materialized view, which adds complexity). More complex queries for dashboard loading. Overkill for MVP where the current state is all that matters. Can be added later as a separate `deal_state_history` table without changing the current row pattern.

### Option B: JSON blob column (single column storing entire state)
- Pros: Flexible schema, easy to add new fields without migrations
- Cons: Cannot query or index individual fields. Partial updates require read-modify-write at the application level (risk of race conditions). Loses the clarity of explicit columns. Harder to validate at the database level.

### Option C: Normalized tables (separate tables for numbers, vehicle, scorecard, checklist)
- Pros: Proper relational modeling, each concern in its own table
- Cons: Dashboard load requires JOINing 4-5 tables on every session open. Tool call handlers need to know which table to update. Significant overhead for what is conceptually a single state object. The fields do not have independent lifecycles — they always belong to one session.

## Consequences

- **Positive:** Simple reads — one `SELECT * FROM deal_states WHERE session_id = ?` loads the entire dashboard state. No joins, no event replay.
- **Positive:** Explicit columns provide database-level type checking, indexing capability, and clear documentation of the state shape. Migrations enforce schema changes.
- **Positive:** Partial UPDATE statements are clean and efficient — `UPDATE deal_states SET listing_price = 34000 WHERE session_id = ?` touches only one field.
- **Negative:** No built-in history. If a user asks "what was the offer before they changed it?", the information is lost. The conversation history (messages table) provides an indirect audit trail, but reconstructing past state requires re-reading the conversation.
- **Negative:** Concurrent tool calls within the same response could theoretically race, though in practice Claude's tool calls within a single message are processed sequentially by the backend before streaming results.
- **Neutral:** If deal history becomes a product requirement, a `deal_state_snapshots` table can be added that captures the full state after each message. The current mutable row becomes a cache of the latest snapshot, preserving the simple read pattern.

## References

- [Architecture doc — deal_states schema](../architecture.md)
- [Backend plan — DealState model](../backend-plan.md)
- [Martin Fowler: Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)
