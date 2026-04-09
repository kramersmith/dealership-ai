# ADR-0019: Pre-persisted user messages for gated pre-stream flows (VIN intercept)

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Engineering

## Context

The original chat send flow was: frontend shows an optimistic user message,
posts to `POST /chat/{session_id}/message`, the backend inserts the user
message row, and the SSE stream runs Claude. On stream failure the backend
deletes that user row so retries do not duplicate history (ADR-0016).

VIN intercept broke this model. When the user types a VIN (or several), we
now pause the assistant call until the buyer has decoded and confirmed (or
skipped) each VIN. During that pause the user's message must be:

1. **Visible in chat** (the VIN assist chrome hangs off the user bubble).
2. **Owned by the server** (a page reload or cross-device view must show the
   same message — a client-only optimistic row would be lost).
3. **The same row the assistant later replies to**, so the final `messages`
   array has one user turn followed by one assistant turn — not two user
   turns if the client retries.
4. **Not silently deleted on stream failure after resume**, because the user
   already spent time confirming VINs against it.

Option C was explored at the planning level: keep the optimistic client row
and insert a fresh backend row on resume. That design fails requirement (2)
and (3) and creates ID reconciliation headaches in the store.

## Decision

### 1. New endpoint: `POST /chat/{session_id}/user-message`

Persists a user message (`content`, optional `image_url`) **without** running
the assistant. Returns the canonical `MessageResponse`. Auth-gated like the
rest of the chat routes.

### 2. `ChatMessageRequest.existing_user_message_id`

`POST /chat/{session_id}/message` now accepts an optional
`existing_user_message_id`. When set:

- The streaming handler loads the row, asserts it belongs to this session and
  has `role=USER`, and treats it as "already persisted" instead of inserting
  a new row.
- `content` / `image_url` on the existing row are updated in-place (the
  resumed message body is the VIN-decode-enriched text).
- History loading and compaction's "prior slice" both **exclude** the
  pre-persisted row (`_without_resumed_user`) so projection/compaction sees
  the same shape as a fresh insert.
- `_remove_orphan_user_message` is a no-op when the user row was not created
  inside this request — retries after a VIN resume must not delete the row
  the buyer confirmed VINs against. Only newly-inserted user rows are still
  cleaned up on step-loop failure (ADR-0016 continues to apply to them).

### 3. Frontend flow

`apps/mobile/stores/chatStore.ts`:

- `sendMessage` runs `normalizeVinCandidates` first. If any VIN matches, it
  calls `api.persistUserMessage`, swaps the placeholder for the canonical row
  from the server, creates `VinAssistItem` rows keyed by `sourceMessageId`,
  and returns early after stashing `_pendingSend`.
- `resumePendingSend` gathers every `VinAssistItem` for the source message,
  builds a decode appendix (`[VIN … decoded: …]` / skipped / rejected), and
  calls `sendMessage` with `_skipVinIntercept=true` and the persisted
  `existingUserMessageId`.
- The XHR-based `sendMessage` in `apiClient.ts` includes
  `existing_user_message_id` in the request body when provided.
- The single-VIN `VinAssistCard` and the new `MultiVinAssistCard` both hang
  off the user message by `sourceMessageId` and drive the per-VIN state
  machine (detected → decoding → decoded → confirmed / rejected / skipped).
  Resume is only triggered once every VIN in the group is terminal.

### 4. `submitVinFromPanel` uses the same endpoint

VIN submission from the Insights Panel also persists the user message
server-side and then auto-decodes, instead of the old client-optimistic path.

## Alternatives Considered

### Option A: Keep optimistic-only user row until resume
- Pros: no new endpoint.
- Cons: row is lost on reload/cross-device; ID changes after resume require
  reconciliation; breaks "server owns chat history" invariant.

### Option B: Send user + assistant in one request, have the server hold the
assistant call until the client sends a "vin_decisions" side-channel
- Pros: single call.
- Cons: server must hold the stream open while the user reads decodes;
  timeouts, retries, and cost accounting all get messy. Keeping the stream
  stateless is simpler.

## Consequences

- **Positive:** chat history is authoritative from the first frame; reload
  during VIN confirmation is safe; assistant turn is guaranteed to reply to
  the same row the buyer saw; multi-VIN pastes work end-to-end.
- **Negative:** two chat-write endpoints instead of one; orphan-cleanup logic
  must distinguish "created this request" vs "pre-persisted." Both are
  covered by tests (`test_chat_user_message_persist.py`).
- **Neutral:** `_pendingSend` now carries `sourceMessageId` so resume can
  correctly reconcile with the persisted row even if other VIN assists from
  earlier messages are still on screen.

## References

- `apps/backend/app/routes/chat.py` (`persist_user_message`,
  `send_message`, `_without_resumed_user`, `_remove_orphan_user_message`)
- `apps/backend/app/schemas/chat.py` (`PersistUserMessageRequest`,
  `ChatMessageRequest.existing_user_message_id`)
- `apps/mobile/stores/chatStore.ts`
  (`sendMessage`, `resumePendingSend`, `submitVinFromPanel`)
- `apps/mobile/components/chat/MultiVinAssistCard.tsx`
- `docs/backend-endpoints.md`
- ADR-0016 (chat error resilience — still covers newly-inserted user rows)
- ADR-0020 (timeline branch from a user message — separate from this resume path; do not overload `existing_user_message_id` for fork semantics)
