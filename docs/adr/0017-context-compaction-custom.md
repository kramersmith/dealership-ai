# ADR 0017: Custom context compaction (buyer chat)

## Status

Accepted

## Context

Long buyer chats risk exceeding effective context budgets and degrading quality. Anthropic offers server-side compaction in beta (`compact-2026-01-12`); we defer that until GA and implement **client-orchestrated summarization** using `CLAUDE_MODEL` (same as the main chat loop) for summary quality aligned with the assistant.

## Decision

1. **Compaction state** lives on `ChatSession.compaction_state` (JSON): `version`, `rolling_summary`, `first_kept_message_id`, `updated_at`, optional `consecutive_failures`.
2. **Model-facing history** is a **projection**: optional synthetic `user` message with `<system-reminder>` wrapping the rolling summary, then verbatim DB messages from `first_kept_message_id` onward (subject to `CLAUDE_MAX_HISTORY`).
3. **Full messages remain in the database**; we do not delete rolled-up rows.
4. **User-visible notice**: a persisted `Message` with `role=system` and plain-language copy when compaction runs in a turn.
5. **SSE**: `compaction_started`, `compaction_done`, `compaction_error` for in-flight UX.
6. **Context pressure** for the footer uses the same token estimate and thresholds as compaction (warn vs critical).
7. **Prompt cache** ([ADR 0015](0015-prompt-cache-break-detection.md)): compaction changes the message prefix; expect cache breaks across compaction boundaries. No silent baseline reset—fingerprinting continues to reflect real changes.
8. **Failures**: bounded PTL-style retries on the summarization call (shrink prefix). **Circuit breaker** after `CLAUDE_COMPACTION_MAX_CONSECUTIVE_FAILURES` consecutive failures—skip auto-compaction until manual state reset or a future turn policy.
9. **Chat failure after compaction**: we **do not** roll back `compaction_state` or the system notice when the step loop fails ([ADR 0016](0016-chat-error-resilience-and-orphan-cleanup.md) still removes the orphan **user** message only).

## Consequences

- Own summarization prompts, token heuristics, and retries.
- Compaction calls use the primary model (higher cost and latency per compaction than a small model, but better fidelity for dense deal/negotiation summaries).
- Revisit Anthropic server-side compaction when it leaves beta (see plan: `defer-anthropic-server-compaction`).
