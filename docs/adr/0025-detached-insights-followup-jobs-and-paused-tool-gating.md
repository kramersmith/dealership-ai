# ADR-0025: Detached Insights Follow-Up Jobs and Paused Buyer-Tool Gating

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Backend + Mobile architecture owners

## Context

ADR-0012 established the chat-first completion boundary and ADR-0024 established centralized panel update policy. The current buyer-chat changes go further in two architectural ways that should not be retrofitted into those accepted ADRs:

1. Detached insights follow-up is now a first-class persisted execution pipeline, not just a transport-level follow-up event sequence.
2. Paused insights mode now affects both post-chat follow-up execution and the set of buyer chat tools exposed during the chat phase.

These changes add a new durable model (`insights_followup_jobs`), a shared reconcile-plus-panel execution path used by both automatic live follow-up and manual refresh, and a stricter paused-mode boundary for buyer turns.

Because accepted ADRs in this repository are immutable, these decisions need their own record instead of edits to ADR-0012 or ADR-0024.

## Decision

Adopt a durable detached follow-up pipeline with paused-mode buyer-tool gating:

1. **Persist follow-up jobs**
- Create an `insights_followup_jobs` table keyed by `(session_id, assistant_message_id, kind)`.
- Track overall job status plus per-step reconcile/panel status, attempts, usage, timestamps, and terminal error details.
- Reuse the same job row for idempotent repeat reads of a successful live follow-up, while allowing forced reruns from explicit refresh.

2. **Share one execution pipeline across live and manual refresh paths**
- `POST /api/chat/{session_id}/insights-followup` remains the detached live-mode command path for a persisted assistant row.
- `POST /api/chat/{session_id}/panel-refresh` reuses the same linked follow-up pipeline against the latest assistant row, but forces a rerun instead of short-circuiting on prior success.
- The pipeline order is: validate assistant anchor, optionally reconcile structured state, generate canonical panel cards, persist cards/usage/job state, then emit terminal follow-up output.

3. **Treat paused insights as a stricter policy boundary**
- In paused mode, normal buyer chat turns do not expose persistence-affecting buyer tools.
- In paused mode, the client skips the automatic detached follow-up request after chat `done`.
- Explicit panel refresh remains the canonical way to run reconcile/panel work while paused.

4. **Keep branch/reset semantics consistent with follow-up persistence**
- When branching from an earlier user message, delete follow-up jobs attached to assistant rows removed from the truncated tail so durable follow-up state does not outlive the timeline it belongs to.

## Alternatives Considered

### Option A: Keep detached follow-up as transport-only state with no persisted job model
- Pros: Smaller backend diff; fewer tables and migration concerns.
- Cons: Weak idempotence, poor visibility into retries/failures, and no durable anchor for refresh/replay semantics.

### Option B: Split live follow-up and manual refresh into separate implementations
- Pros: Each path can optimize for its own UX.
- Cons: Duplicated orchestration, higher drift risk, inconsistent persistence rules, and harder testing.

### Option C: Keep paused mode as client-only suppression of panel follow-up
- Pros: Minimal backend changes.
- Cons: Backend would still expose persistence-affecting buyer tools during paused turns, which violates the intended meaning of paused insights and produces structured-state drift the user did not ask for.

### Option D: Persist follow-up jobs, share one pipeline, and gate paused turns in the backend (chosen)
- Pros: Clearer contracts, durable follow-up semantics, stronger paused-mode guarantees, and better testability.
- Cons: Adds schema, migration, status bookkeeping, and branch-cleanup responsibilities.

## Consequences

- **Positive:** Detached follow-up work is durable, inspectable, and idempotent at the assistant-message level.
- **Positive:** Live follow-up and manual refresh now share one execution model, reducing divergence.
- **Positive:** Paused mode has real backend enforcement, not just client UX suppression.
- **Positive:** Branching from history now cleans up follow-up records that would otherwise refer to deleted assistant turns.
- **Negative:** Adds a new persisted model, migration, and more lifecycle bookkeeping.
- **Neutral:** ADR-0012 and ADR-0024 remain valid historical decisions; this ADR extends their operational design without rewriting them.

## References

- [ADR-0012: Two-Phase SSE Contract for Chat-First Panel Streaming](0012-two-phase-chat-panel-sse-contract.md)
- [ADR-0024: Centralized Panel Update Policy and User Settings](0024-panel-update-policy-and-user-settings.md)
- [Chat route SSE orchestration](../../apps/backend/app/routes/chat.py)
- [Detached insights follow-up service](../../apps/backend/app/services/insights_followup.py)
- [Panel update policy service](../../apps/backend/app/services/panel_update_service.py)
- [Session branch cleanup](../../apps/backend/app/services/session_branch.py)