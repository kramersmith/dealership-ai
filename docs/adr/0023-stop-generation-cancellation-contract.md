# ADR 0023: Stop Generation Cancellation Contract

**Status:** Accepted  
**Date:** 2026-04  
**Deciders:** Engineering

## Context

Buyer and dealer chat surfaces stream assistant text and post-`done` panel updates over SSE. Users need a reliable "Stop generation" control that:

- works consistently across all streaming chat surfaces,
- preserves partial assistant output when interrupted,
- avoids stale panel writes and ambiguous terminal states,
- keeps queue and timeline behavior deterministic.

Connection-drop-only cancellation was not enough for product-grade semantics because it does not provide explicit user-intent outcomes or durable state contracts.

## Decision

Introduce a first-class turn cancellation contract spanning backend routes, SSE events, and frontend state machines.

### 1) Active turn ownership

- Backend tracks one active cancellable turn per session in an explicit in-memory registry.
- Each turn has a `turn_id` emitted via a new `turn_started` SSE event.
- Client stores `turn_id` and uses it for guarded stop requests and stale-event protection.

### 2) Explicit stop endpoint

- Add `POST /api/chat/{session_id}/stop` with optional `turn_id`.
- Outcomes are explicit (`cancelled`, `already_cancelled`, `not_found`, `turn_mismatch`) instead of overloading generic errors.

### 3) Terminal event semantics

- Exactly one turn terminal path for chat text phase: `done`, `interrupted`, or fatal `error`.
- New `interrupted` SSE event carries partial text and reason when the turn stops before `done`.
- For panel phase, add `panel_interrupted` (distinct from `panel_error`) when stop occurs after `done` during panel generation.

### 4) Persistence contract

- Assistant message rows gain explicit completion metadata:
  - `completion_status` (`complete`, `interrupted`, `failed`)
  - `interrupted_at`
  - `interrupted_reason`
- Interrupted turns persist the partial assistant content as canonical message content.
- Tool writes that already committed remain committed; no rollback is attempted.

### 5) Frontend behavior contract

- Stop is modeled as user intent, not a failure.
- Partial text is preserved and labeled as interrupted.
- Panel stop keeps the last stable panel snapshot and exposes a non-blocking interruption notice.
- Queue dispatch remains FIFO and safe after interruption (no queue wipe shortcuts).

## Alternatives Considered

### A) Client-only abort (XHR cancellation) with no backend contract
- Pros: minimal implementation effort
- Cons: race-prone, ambiguous persistence, no explicit terminal semantics

### B) Treat stop as generic stream error
- Pros: reuses existing error channel
- Cons: wrong UX semantics; user intent indistinguishable from failures

### C) Connection close as implicit stop signal only
- Pros: simple transport-level behavior
- Cons: no explicit turn identity, weak stale-event guarding, poor observability

## Consequences

- **Positive:** deterministic stop behavior, auditable message completion state, cleaner UX semantics, safer panel/queue interactions.
- **Negative:** broader surface-area changes (schemas, routes, stream parser, store state machine, tests).
- **Neutral:** cancellation registry is in-memory for now; future multi-worker deployments can swap implementation behind the same contract.

## References

- `apps/backend/app/services/turn_cancellation.py`
- `apps/backend/app/routes/chat.py`
- `apps/backend/app/services/buyer_chat_stream.py`
- `apps/backend/app/services/claude/chat_loop.py`
- `apps/mobile/lib/apiClient.ts`
- `apps/mobile/stores/chatStore.ts`
