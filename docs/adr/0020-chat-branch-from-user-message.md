# ADR-0020: Branch chat timeline from a user message

**Status:** Accepted  
**Date:** 2026-04  
**Deciders:** Engineering

## Context

Buyers sometimes want to **rewrite an earlier user message** and **discard later turns**, similar to “edit from here” in coding assistants. The existing `POST /chat/{session_id}/message` flow with `existing_user_message_id` ([ADR 0019](0019-pre-persisted-user-messages-for-vin-intercept.md)) **updates** a user row but does **not** remove subsequent messages, so the model would still see a contradictory history.

## Decision

1. **Dedicated endpoint:** `POST /api/chat/{session_id}/messages/{message_id}/branch` with body `{ content, image_url? }`. The path `message_id` must be a **user** message in that session.

2. **Prepare phase (single transaction, committed before SSE):**
   - Delete every `Message` row **after** the anchor in `(created_at, id)` order when any exist (including `system` compaction notices).
   - **Always:** set `ChatSession.compaction_state` and `ChatSession.usage` to `None`; run `reset_session_commerce_state` (clear deals, vehicles, and session-level deal JSON on `DealState`, **preserve** `buyer_context`). This applies even when the anchor is the last message row (no tail), so branch matches a Cursor-style resubmit: structured DB state is not left stale for the next stream.

3. **Stream phase:** Reuse the same buyer chat turn pipeline as normal send (`app/services/buyer_chat_stream.py`), with `resumed_user_row` = anchor and `include_timeline_fork_reminder=True` on every branch (injects a line into `build_context_message` so the model treats cleared structured state + possibly-retained transcript consistently).

4. **VIN intercept:** Unchanged — still `POST .../user-message` + `POST .../message` with `existing_user_message_id`. Branch is a separate command and must not overload ADR 0019 semantics.

**Tradeoff:** Clearing structured state is **not** a true rewind to “deal as of before this user message” (that would need snapshots or replaying tool effects). Prior chat text may still describe vehicles or numbers while `DealState` is empty until tools run again — the reminder addresses that. Editing an unreplied last user message after a long thread still clears **all** session deals/vehicles for consistency with the tail-delete path.

## Consequences

- **Positive:** Clear domain boundary; server-authoritative history; every branch leaves structured commerce empty before the stream, aligned with resubmit semantics.
- **Negative:** Two write/stream entry points for chat (`/message` and `/messages/{id}/branch`); clients must pick the correct one. Branch with no message tail still wipes deals/vehicles from earlier turns.
- **Retry:** If the stream fails after prepare committed, the DB already reflects the branch (including cleared commerce); retrying branch does not double-delete messages (tail may already be gone) but prepare still runs the same idempotent clears.

## References

- `app/services/session_branch.py` — `prepare_session_branch_from_user_message`, `reset_session_commerce_state`
- `app/services/buyer_chat_stream.py` — shared SSE turn
- `app/routes/chat.py` — `branch_from_user_message`
- [ADR 0019](0019-pre-persisted-user-messages-for-vin-intercept.md)
