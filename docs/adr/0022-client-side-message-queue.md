# ADR-0022: Client-side message queue for buyer chat

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Engineering

## Context

The buyer chat UI blocked the composer while the AI was processing a response. Users who wanted to send follow-up messages while waiting for a reply had to wait for the full turn (text streaming, panel generation) to complete. This created a friction point, especially during multi-step conversations where the user knows what they want to say next.

The backend processes one turn per session at a time (server-side serialization via the SSE stream), so concurrent sends are not possible. The frontend needs a client-side queue that accepts messages immediately and dispatches them sequentially after each turn completes.

## Decision

Introduce a FIFO message queue in the Zustand chat store (`queueBySession`), keyed by session ID. When the user sends a message while the AI is processing, the message is enqueued with status `queued` rather than rejected. A dispatch loop (`_recheckQueueDispatch`) picks the next queued item after the current turn completes and feeds it through the existing `_sendMessageImmediate` path.

Key design choices:

- **Queue items are separate from messages.** `ChatQueueItem` tracks dispatch lifecycle (queued, dispatching, active, paused_vin, failed, cancelled, sent) independently of the `Message` model. Optimistic user messages are inserted into the messages array only at dispatch time, not at enqueue time.
- **Preview cards above the composer** show up to 3 queued messages so the user knows what is pending, without polluting the chat transcript.
- **Failure classification** (`recoverable`, `session_blocking`, `validation_blocking`) determines whether the queue continues dispatching after a failure. Session-blocking errors (auth, 404) halt the queue; recoverable errors skip to the next item.
- **Branch edit guard.** Timeline forking (edit-from-here) is blocked while the queue has pending items, because branch resets the conversation state and queued messages would target stale context.
- **Stall recovery** (`recoverQueueStall`) resets a stuck dispatch state and re-queues the item.
- **Backward compatibility.** Callers that omit the `source` parameter fall through to immediate send (no queue), preserving existing behavior for internal flows like `resumePendingSend`.

## Alternatives Considered

### Option A: Disable composer during AI processing (status quo)
- Pros: Simple, no queue state to manage
- Cons: Poor UX, blocks multi-message intent, frustrates fast typists

### Option B: Server-side queue
- Pros: Durable, survives page refresh
- Cons: Requires backend changes, adds latency, over-engineered for a single-user chat session

### Option C: Optimistic messages in the transcript at enqueue time
- Pros: User sees their messages in the chat immediately
- Cons: Creates confusing interleaving when replies arrive out of order; harder to cancel/reorder; complicates the already-complex optimistic message lifecycle

## Consequences

- **Positive:** Users can type follow-up messages without waiting. Queue preview cards provide visibility. Existing send paths are minimally changed (source parameter opt-in).
- **Negative:** Additional state surface in the chat store (`queueBySession`, `activeQueueItemId`, `isQueueDispatching`, `queueDispatchGeneration`, `lastQueueEvent`). Queue lifecycle must be cleaned up on session switch, deletion, and branch.
- **Neutral:** No backend changes required. Queue is ephemeral (lost on page refresh), which is acceptable for a chat UI.

## References

- `apps/mobile/stores/chatStore.ts` — queue types, dispatch loop, failure classification
- `apps/mobile/hooks/useChat.ts` — queue state selectors exposed to UI
- `apps/mobile/app/(app)/chat.tsx` — QueuePreviewCard component, composer always-enabled
