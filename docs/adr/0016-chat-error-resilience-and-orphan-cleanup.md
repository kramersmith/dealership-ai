# ADR-0016: Chat Error Resilience — API Error Mapping and Orphan Message Cleanup

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Kramer Smith

## Context

The chat endpoint persists the user message to the database before starting the Claude API stream. If the stream fails — due to an Anthropic API error (billing, authentication, server error) or an unhandled exception in the step loop — the user message remains in the database with no corresponding assistant reply. On retry, the frontend sends the same text again, and a second user message is persisted. After multiple retries, the message history accumulates duplicate user rows that pollute the conversation context sent to Claude on subsequent turns.

Additionally, when Anthropic API errors occur (e.g. "credit balance is too low", authentication failures), the raw error details were previously either swallowed (silent failure) or leaked to the client as unformatted exception text. The user saw either nothing or confusing internal error messages, with no clear signal to retry or escalate.

These two problems — orphan messages and opaque errors — compound: the user retries because the error is unclear, each retry creates another orphan, and the conversation degrades.

## Decision

### Orphan message cleanup

When the step loop fails (either via exception or `result.failed`), the chat route deletes the user message that was persisted before streaming began:

```python
try:
    async for sse_event in stream_chat_loop(...):
        yield sse_event
except Exception:
    logger.exception("Chat stream aborted: session_id=%s", session_id)
    await db.execute(delete(Message).where(Message.id == user_msg.id))
    await db.commit()
    raise
```

The delete is wrapped in its own try/except so that cleanup failures do not mask the original error. The same cleanup runs in the `result.failed` path (step loop returned gracefully but marked the result as failed).

This is safe because:
- The assistant message is only persisted after the generator completes successfully, so there is no risk of deleting a user message that has a corresponding assistant reply.
- Tool execution uses isolated `AsyncSession` instances (via `TurnContext.for_db_session()`), so the main DB session used for the delete is not contaminated by partial tool commits.
- The `user_msg.id` is obtained via `db.refresh(user_msg)` after the initial commit, ensuring a stable primary key for the delete.

### API error mapping

A new `_user_visible_message_for_anthropic_error()` function maps known `anthropic.APIStatusError` subclasses to safe, non-leaking user-visible messages:

| API condition | User-visible message |
|---|---|
| Low credit balance | "The assistant is temporarily unavailable due to API account limits. Try again later." |
| Authentication error | "The assistant is misconfigured. Please contact support." |
| All other API errors | "AI response failed. Please try again." |

The full error details (status code, request ID, organization ID) are logged server-side at ERROR level for operator diagnosis. The user never sees internal API details, error types, or billing information.

### SSE `error` event

API errors emit a new `event: error` SSE event with a `message` field containing the user-visible text. The stream terminates after this event. This gives the frontend a structured signal to display an error state and offer retry, rather than relying on connection drops or timeouts.

## Alternatives Considered

### Option A: Keep orphan messages and deduplicate on read

- Pros: No delete operations in the failure path, simpler error handling. Deduplication could use a "last N distinct messages" query.
- Cons: The orphan messages are already in the context window sent to Claude. Deduplication at read time is complex (what counts as a "duplicate" when the user legitimately sends the same text twice?). The orphans accumulate permanently, consuming storage and polluting any message history UI. The root cause (persisting before success is confirmed) is better fixed at the source.

### Option B: Persist the user message after streaming succeeds

- Pros: Eliminates orphans entirely — the message is only saved when the turn completes.
- Cons: If the server crashes mid-stream, the user's message is lost with no record. The message history would show a gap. More critically, the step loop's tool execution reads and modifies deal state in the database — the user message must be committed first so that the conversation history is consistent for tool result context and linked session queries during the turn.

### Option C: Soft-delete with a status flag

- Pros: Preserves an audit trail of failed attempts. Could be useful for debugging "why did this user's session break?"
- Cons: Adds a `status` column to the messages table and query complexity (`WHERE status != 'failed'`) to every message read path. The same diagnostic value is available from server logs (which already log the session ID, error, and stack trace). Orphan messages from failed turns have no user-facing value and should not be preserved.

## Consequences

- **Positive:** Retrying a failed message no longer accumulates duplicate user rows. The conversation history stays clean regardless of how many times the user retries.
- **Positive:** Users see clear, actionable error messages ("try again later" vs "please contact support") instead of opaque failures or silent hangs.
- **Positive:** The `error` SSE event gives the frontend a structured signal for error UI, consistent with the existing event-driven architecture.
- **Positive:** Operator logs include the full API error context (request ID, organization ID, status code) for diagnosis without leaking it to users.
- **Negative:** The delete operation runs inside a streaming generator's error path. If the database is unavailable when the delete is attempted, the orphan persists — but this is logged and the original error is still raised. In practice, if the DB is down, the turn would have failed earlier.
- **Negative:** Deleting the user message means there is no database record of the failed attempt. Server logs are the only record. This is acceptable for a pre-production app but would need reconsideration if audit trails become a requirement.
- **Neutral:** The error mapping is a simple function with a hardcoded condition list. New Anthropic error types will fall through to the generic "AI response failed" message, which is safe but uninformative. The function can be extended as new error types are encountered.

## References

- [Chat route](../../apps/backend/app/routes/chat.py) — orphan cleanup in `send_message()` generator
- [Error mapping](../../apps/backend/app/services/claude.py) — `_user_visible_message_for_anthropic_error()`, `_is_anthropic_low_credit_error()`
- [ADR-0009](0009-streaming-resilience.md) — streaming resilience (retry/fallback for transient errors; this ADR covers unrecoverable errors)
- [ADR-0002](0002-sse-over-websockets.md) — SSE architecture that the `error` event extends
