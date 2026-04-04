# ADR-0012: Two-Phase SSE Contract for Chat-First Panel Streaming

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Kramer Smith

## Context

The chat endpoint already used SSE transport (ADR-0002), but its event contract treated `done` as the terminal event for the full assistant turn. Panel generation then arrived as a late `tool_result` update, creating ambiguous semantics and brittle client assumptions.

At the same time, product requirements prioritize dealership-time responsiveness: users must get chat text and re-enabled input immediately, without waiting for panel generation.

We needed a contract that preserves chat-first latency while keeping panel updates explicit, deterministic, and testable.

## Decision

Adopt a two-phase SSE event contract on `POST /api/chat/{session_id}/message`:

1. **Chat phase**
- Stream `text`, `tool_result`, `retry`, and `step` during step-loop execution.
- Emit `done` immediately when chat text completes. `done` now means "chat text complete" (not "entire turn complete").
- `done.usage` contains chat-phase usage only.

2. **Panel phase**
- After `done`, emit explicit panel lifecycle events:
  - `panel_started`
  - `panel_card` (incremental card arrivals)
  - `panel_done` (canonical cards + panel-phase usage) or `panel_error`
- Persist canonical `ai_panel_cards` only at panel phase completion.
- Persisted assistant message usage remains the full turn aggregate (chat + panel).

This is a contract change, not a transport change. SSE remains the transport per ADR-0002.

## Alternatives Considered

### Option A: Keep `done` as terminal full-turn event
- Pros: Simple terminal semantics; no post-`done` events.
- Cons: Forces users to wait for panel generation before input unblocks, degrading dealership-time chat responsiveness.

### Option B: Keep post-`done` panel updates via generic `tool_result` only
- Pros: Minimal backend/frontend changes.
- Cons: Ambiguous protocol; difficult to reason about completion and failure; brittle client code and tests.

### Option C: Emit explicit panel lifecycle events after `done` (chosen)
- Pros: Preserves chat-first responsiveness while making post-`done` phase explicit and testable.
- Pros: Clear error handling (`panel_error`) and completion semantics (`panel_done`).
- Cons: Introduces additional SSE event types and client handling paths.

## Consequences

- **Positive:** Chat latency is prioritized; users can continue typing as soon as `done` arrives.
- **Positive:** Panel updates feel responsive via incremental `panel_card` events.
- **Positive:** Event semantics are explicit, reducing coupling and improving testability.
- **Negative:** `done` no longer means full-turn completion; clients must handle panel phase separately.
- **Neutral:** Usage reporting is split by phase in-stream (`done` vs `panel_done`) while persistence remains full-turn aggregate.

## References

- [ADR-0002: SSE over WebSockets for Streaming](0002-sse-over-websockets.md)
- [ADR-0007: AI-Generated Panel Cards](0007-ai-generated-panel-cards.md)
- [Chat route SSE orchestration](../../apps/backend/app/routes/chat.py)
- [Panel streaming service](../../apps/backend/app/services/panel.py)
- [Backend endpoint SSE docs](../backend-endpoints.md)
