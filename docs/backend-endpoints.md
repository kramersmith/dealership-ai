# Backend API Endpoints

Last updated: 2026-04-10

Base URL: `/api`
Authentication: Bearer token in `Authorization` header (unless noted otherwise)

All responses may include a validated `X-Request-ID` header. Browser clients can read it because CORS exposes the header, and local debugging tools use it to filter structured backend logs.

## Table of Contents

1. [Auth](#auth)
2. [Sessions](#sessions)
3. [Chat](#chat)
4. [Deal](#deal)
5. [Simulations](#simulations)

---

## Auth

All auth endpoints are **public** (no authentication required).

### POST /api/auth/signup

Create a new user account.

**Auth required:** No

**Request body:**

```json
{
  "email": "user@example.com",
  "password": "string",
  "role": "buyer",
  "display_name": "string | null"
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `email` | string (email) | Yes | -- | User's email address |
| `password` | string | Yes | -- | Password (plain text, hashed server-side) |
| `role` | string | No | `"buyer"` | `"buyer"` or `"dealer"` |
| `display_name` | string | No | `null` | Optional display name |

**Response:** `201 Created`

```json
{
  "access_token": "eyJ...",
  "token_type": "bearer",
  "user_id": "uuid",
  "role": "buyer",
  "settings": {
    "insights_update_mode": "live"
  }
}
```

**Error responses:**

| Status | Detail |
|---|---|
| `400` | Email already registered |

---

### POST /api/auth/login

Authenticate an existing user.

**Auth required:** No

**Request body:**

```json
{
  "email": "user@example.com",
  "password": "string"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `email` | string (email) | Yes | User's email address |
| `password` | string | Yes | Password |

**Response:** `200 OK`

```json
{
  "access_token": "eyJ...",
  "token_type": "bearer",
  "user_id": "uuid",
  "role": "buyer",
  "settings": {
    "insights_update_mode": "live"
  }
}
```

**Error responses:**

| Status | Detail |
|---|---|
| `401` | Invalid credentials |

---

### GET /api/auth/settings

Get persisted user-level settings for insights behavior.

**Auth required:** Yes

**Response:** `200 OK`

```json
{
  "insights_update_mode": "live"
}
```

### PATCH /api/auth/settings

Update persisted user-level settings for insights behavior.

**Auth required:** Yes

**Request body:** (all fields optional)

```json
{
  "insights_update_mode": "paused"
}
```

**Response:** `200 OK`

```json
{
  "insights_update_mode": "paused"
}
```

---

## Sessions

All session endpoints require authentication.

### GET /api/sessions

List all sessions for the authenticated user, ordered by most recently updated. Optionally filter by search query.

**Auth required:** Yes

**Query parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `q` | string | No | Search sessions by title or message content (case-insensitive) |

**Request body:** None

**Response:** `200 OK`

```json
[
  {
    "id": "uuid",
    "title": "2024 Toyota Camry LE",
    "session_type": "buyer_chat",
    "linked_session_ids": [],
    "last_message_preview": "Based on the numbers you shared, this looks like a fair deal...",
    "usage": {
      "requestCount": 5,
      "inputTokens": 3120,
      "outputTokens": 544,
      "cacheCreationInputTokens": 620,
      "cacheReadInputTokens": 1120,
      "totalTokens": 3664,
      "totalCostUsd": 0.023846,
      "perModel": {
        "claude-sonnet-4-6": {
          "requestCount": 4,
          "inputTokens": 3000,
          "outputTokens": 520,
          "cacheCreationInputTokens": 620,
          "cacheReadInputTokens": 1120,
          "totalTokens": 3520,
          "totalCostUsd": 0.023086
        },
        "claude-haiku-4-5-20251001": {
          "requestCount": 1,
          "inputTokens": 120,
          "outputTokens": 24,
          "cacheCreationInputTokens": 0,
          "cacheReadInputTokens": 0,
          "totalTokens": 144,
          "totalCostUsd": 0.00076
        }
      }
    },
    "deal_summary": {
      "phase": "negotiation",
      "vehicle_year": 2024,
      "vehicle_make": "Toyota",
      "vehicle_model": "Camry",
      "vehicle_trim": "LE",
      "current_offer": 32500,
      "listing_price": 34000,
      "score_overall": "green"
    },
    "created_at": "2026-03-24T12:00:00Z",
    "updated_at": "2026-03-24T12:00:00Z"
  }
]
```

The `deal_summary` object is a lightweight projection of the session's deal state:

| Field | Type | Description |
|---|---|---|
| `phase` | string | Current deal phase |
| `vehicle_year` | integer | Vehicle year |
| `vehicle_make` | string | Vehicle make |
| `vehicle_model` | string | Vehicle model |
| `vehicle_trim` | string | Vehicle trim |
| `current_offer` | number | Current negotiation price |
| `listing_price` | number | Listing price |
| `score_overall` | string | Overall scorecard rating (`red`, `yellow`, `green`) |

All `deal_summary` fields are nullable. The `deal_summary` itself is `null` if no deal state exists.

The optional `usage` field is the cumulative per-session Claude usage ledger. It tracks request counts, token totals, cache token totals, computed USD cost, and a per-model breakdown across all Claude-backed work tied to the session.

---

### POST /api/sessions

Create a new chat session. Also creates a deal state linked to the session, optionally initialized with a buyer context.

**Auth required:** Yes

**Request body:**

```json
{
  "session_type": "buyer_chat",
  "title": "string | null",
  "buyer_context": "researching | reviewing_deal | at_dealership | null"
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `session_type` | string | No | `"buyer_chat"` | `"buyer_chat"` or `"dealer_sim"` |
| `title` | string | No | Auto-generated | Defaults to "New Deal" for buyer_chat, "New Simulation" for dealer_sim |
| `buyer_context` | string | No | `"researching"` | Buyer's situational context: `"researching"`, `"reviewing_deal"`, or `"at_dealership"` |

**Response:** `201 Created`

```json
{
  "id": "uuid",
  "title": "New Deal",
  "session_type": "buyer_chat",
  "linked_session_ids": [],
  "last_message_preview": "",
  "usage": null,
  "deal_summary": null,
  "created_at": "2026-03-24T12:00:00Z",
  "updated_at": "2026-03-24T12:00:00Z"
}
```

**Error responses:**

| Status | Detail |
|---|---|
| `403` | Role mismatch (e.g., buyer trying to create dealer_sim session) |

---

### GET /api/sessions/{session_id}

Get a single session by ID. Only returns sessions owned by the authenticated user.

**Auth required:** Yes

**Path parameters:**

| Param | Type | Description |
|---|---|---|
| `session_id` | string | Session UUID |

**Response:** `200 OK`

```json
{
  "id": "uuid",
  "title": "2024 Toyota Camry LE",
  "session_type": "buyer_chat",
  "linked_session_ids": [],
  "last_message_preview": "Based on the numbers you shared...",
  "usage": {
    "requestCount": 5,
    "inputTokens": 3120,
    "outputTokens": 544,
    "cacheCreationInputTokens": 620,
    "cacheReadInputTokens": 1120,
    "totalTokens": 3664,
    "totalCostUsd": 0.023846,
    "perModel": {
      "claude-sonnet-4-6": {
        "requestCount": 4,
        "inputTokens": 3000,
        "outputTokens": 520,
        "cacheCreationInputTokens": 620,
        "cacheReadInputTokens": 1120,
        "totalTokens": 3520,
        "totalCostUsd": 0.023086
      },
      "claude-haiku-4-5-20251001": {
        "requestCount": 1,
        "inputTokens": 120,
        "outputTokens": 24,
        "cacheCreationInputTokens": 0,
        "cacheReadInputTokens": 0,
        "totalTokens": 144,
        "totalCostUsd": 0.00076
      }
    }
  },
  "deal_summary": {
    "phase": "negotiation",
    "vehicle_year": 2024,
    "vehicle_make": "Toyota",
    "vehicle_model": "Camry",
    "vehicle_trim": "LE",
    "current_offer": 32500,
    "listing_price": 34000,
    "score_overall": "green"
  },
  "created_at": "2026-03-24T12:00:00Z",
  "updated_at": "2026-03-24T12:00:00Z"
}
```

**Error responses:**

| Status | Detail |
|---|---|
| `404` | Session not found |

---

### PATCH /api/sessions/{session_id}

Update a session's title or linked sessions. Only updates fields that are provided.

**Auth required:** Yes

**Path parameters:**

| Param | Type | Description |
|---|---|---|
| `session_id` | string | Session UUID |

**Request body:**

```json
{
  "title": "string | null",
  "linked_session_ids": ["uuid1", "uuid2"]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | No | New session title |
| `linked_session_ids` | array of strings | No | Session IDs to link for shared context |

When `title` is provided, the session's `auto_title` flag is set to `false`, preventing further automatic title updates.

**Response:** `200 OK`

```json
{
  "id": "uuid",
  "title": "Updated Title",
  "session_type": "buyer_chat",
  "linked_session_ids": ["uuid1", "uuid2"],
  "last_message_preview": "Here's what I found about...",
  "deal_summary": null,
  "created_at": "2026-03-24T12:00:00Z",
  "updated_at": "2026-03-24T12:00:00Z"
}
```

**Error responses:**

| Status | Detail |
|---|---|
| `403` | Cannot link to sessions you do not own |
| `404` | Session not found |

---

### DELETE /api/sessions/{session_id}

Delete a session and all related data (messages, deal state, simulation) via cascade. Only deletes sessions owned by the authenticated user.

**Auth required:** Yes

**Path parameters:**

| Param | Type | Description |
|---|---|---|
| `session_id` | string | Session UUID |

**Response:** `204 No Content`

**Error responses:**

| Status | Detail |
|---|---|
| `404` | Session not found |

---

## Chat

All chat endpoints require authentication.

### POST /api/chat/{session_id}/user-message

Persist a **user** message only — no assistant call. Used when the client must commit the user’s text to the database before a gated flow completes (e.g. **VIN intercept**: message must appear in `GET /messages` while decode/confirm runs).

**Auth required:** Yes

**Request body:**

```json
{
  "content": "Here are two VINs: ...",
  "image_url": null
}
```

**Response:** `200 OK` — single message object (same shape as entries in `GET /messages`).

**Error responses:**

| Status | Detail |
|---|---|
| `404` | Session not found |

---

### POST /api/chat/{session_id}/message

Send a message and receive a streaming AI response via Server-Sent Events.

**Auth required:** Yes

**Path parameters:**

| Param | Type | Description |
|---|---|---|
| `session_id` | string | Session UUID |

**Request body:**

```json
{
  "content": "What's a fair price for this car?",
  "image_url": "https://example.com/deal-sheet.jpg"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `content` | string | Yes | User's message text (for this turn; may include VIN appendix on resume) |
| `image_url` | string | No | URL of an image to include (e.g., deal sheet photo) |
| `existing_user_message_id` | string | No | If set, **updates** that existing user row’s `content` / `image_url` instead of inserting a new user message. Must belong to this session and must be the latest message row in the session. Used after `POST .../user-message` when resuming the stream (VIN intercept complete). Editing earlier history must use `POST .../messages/{message_id}/branch`. |

**Response:** `200 OK` — `text/event-stream`

The response is a stream of Server-Sent Events. When **auto context compaction** runs for this turn, `compaction_started`, `compaction_done`, or `compaction_error` are emitted **before** chat streaming. The backend emits `turn_started` first with a per-turn `turn_id`. Core chat events are `text`, `tool_result`, and terminal `done` **or** `interrupted`, with additional recovery/status events such as `retry`, `step`, and `tool_error`, and an `error` event for safe user-visible failures. The chat stream now ends at `done`: if `insights_update_mode = "live"`, the client starts a second SSE request to `POST /api/chat/{session_id}/insights-followup` using the `assistant_message_id` returned in `done`. If `insights_update_mode = "paused"`, the chat turn does not expose persistence-affecting buyer tools; only explicitly allowed chat-only tools remain available. If an `error` arrives **after** `done`, the reply text was already delivered and the client should surface the error as a warning rather than discard the reply.

**`turn_started` event** — Backend accepted the turn and assigned a cancellable `turn_id`:
```
event: turn_started
data: {"turn_id": "uuid"}
```

**`compaction_started` event** — Compaction began (heuristic input estimate crossed auto threshold):
```
event: compaction_started
data: {"reason": "input_budget", "estimated_input_tokens": 195000, "input_budget": 180000}
```

**`compaction_done` event** — Rolling summary updated; model-facing tail starts at `first_kept_message_id`:
```
event: compaction_done
data: {"first_kept_message_id": "uuid"}
```

**`compaction_error` event** — Summarization failed; the turn continues without compacting:
```
event: compaction_error
data: {"message": "Context summarization failed; continuing without compacting.", "detail": "APIStatusError"}
```

**`text` event** — Incremental text chunks from the AI:
```
event: text
data: {"chunk": "Based on the numbers you've shared, "}

event: text
data: {"chunk": "this is a fair deal."}
```

**`tool_result` event** — Dashboard updates from AI tool calls:
```
event: tool_result
data: {"tool": "update_deal_numbers", "data": {"msrp": 35000, "listing_price": 33500}}

event: tool_result
data: {"tool": "update_scorecard", "data": {"score_price": "green", "score_overall": "yellow"}}
```

**`done` event** — Chat text completion event (input can unblock immediately and the client can optionally start detached follow-up):
```
event: done
data: {"text": "Based on the numbers you've shared, this is a fair deal.", "assistant_message_id": "uuid-of-assistant-row", "usage": {"requests": 1, "inputTokens": 1240, "outputTokens": 188, "cacheCreationInputTokens": 0, "cacheReadInputTokens": 620, "totalTokens": 1428}}
```

**`interrupted` event** — User-requested stop before `done`; partial text is preserved:
```
event: interrupted
data: {"text": "Partial assistant text...", "reason": "user_stop", "assistant_message_id": "uuid", "usage": {"requests": 1, "inputTokens": 1200, "outputTokens": 80, "cacheCreationInputTokens": 0, "cacheReadInputTokens": 0, "totalTokens": 1280}}
```

**`error` event** — Safe user-visible failure. Before `done`, the stream terminates after this event. After `done`, it indicates a late persistence/update failure and the already-delivered reply should remain visible:
```
event: error
data: {"message": "AI response failed. Please try again."}
```

**Side effects:**
- Full message history is loaded before the user turn is applied (`existing_user_message_id` **excluded** from the compaction “prior” slice so the turn matches a fresh insert)
- Optional auto-compaction may run first inside the stream: can persist `Message(role=system)` notice, update `ChatSession.compaction_state`, and `commit` before the user row is created or updated
- Either a **new** user message is inserted after compaction side effects, or an **existing** user message is updated when `existing_user_message_id` is set; chat streaming then runs. Only **newly inserted** user messages are deleted on stream failure or failed step loop (retries after VIN resume do not delete the pre-persisted row; see ADR 0016 / ADR 0017)
- The step loop may execute multiple model requests before the `done` event; the `usage` payload on `done` reflects chat text generation only
- In `insights_update_mode = "paused"`, the backend withholds persistence-affecting buyer tools for the chat turn
- If a stop request lands before text completion, the stream terminates with `interrupted` (not `done`) and persists partial assistant output with interruption metadata
- The persisted assistant row exists before `done`; `assistant_message_id` in the `done` payload lets the client bind a later follow-up stream to that row
- Persisted assistant-message usage on the send path is chat-phase usage only. Later detached follow-up work merges additional usage into the same assistant row and the session usage ledger
- The backend may emit a safe `error` event after `done` if a later persistence step fails; clients should keep the delivered reply and show the warning
- After `done`, the client may open a detached follow-up stream to refresh the insights panel for the persisted assistant row (the reconcile LLM pass was removed per ADR 0026; panel-only generation now)
- Assistant message (with tool calls and chat-phase usage) is persisted before `done`; detached follow-up may later add `panel_cards` and merged usage to that same row
- Tool call results are applied to the session's deal state
- Post-chat processing updates `last_message_preview` and auto-generates a session title (deterministic vehicle title or LLM fallback via Haiku) when `auto_title` is true
- Session `updated_at` timestamp is refreshed

**Error responses:**

| Status | Detail |
|---|---|
| `404` | Session not found |
| `404` | `existing_user_message_id` not found or not a user message for this session |
| `409` | `existing_user_message_id` is not the latest message in the session; use the branch endpoint |
| `409` | A turn is already active for this session |

---

### POST /api/chat/{session_id}/insights-followup

Start a detached insights follow-up stream for a previously persisted assistant message.

This is the live-mode follow-up path triggered by the client after `POST .../message` or `POST .../messages/{message_id}/branch` returns `done`. It emits `panel_started` immediately so the UI can show panel activity while detached work is still running, then runs panel generation (deterministic render + narrow narrative synthesis — no reconcile LLM pass as of ADR 0026; `reconcile_status` is always `SKIPPED`), and persists a durable follow-up job row keyed by `(session_id, assistant_message_id, kind)`. In paused mode the mobile client skips this automatic request and users call `POST .../panel-refresh` explicitly.

**Auth required:** Yes

**Path parameters:**

| Param | Type | Description |
|---|---|---|
| `session_id` | string | Session UUID |

**Request body:**

```json
{
  "assistant_message_id": "uuid-of-assistant-row"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `assistant_message_id` | string | Yes | Persisted assistant message row this follow-up belongs to |

**Response:** `200 OK` — `text/event-stream`

**`panel_started` event** — Live follow-up processing began; the client can show panel activity immediately while panel generation continues:
```
event: panel_started
data: {}
```

**`panel_done` event** — Follow-up completed with canonical cards, panel-phase usage, and the assistant row id this snapshot belongs to:
```
event: panel_done
data: {"cards": [{"kind": "phase", "template": "briefing", "title": "Status", "content": {"stance": "researching", "situation": "at_dealership"}, "priority": "high"}], "usage": {"requests": 1, "inputTokens": 120, "outputTokens": 40, "cacheCreationInputTokens": 0, "cacheReadInputTokens": 60, "totalTokens": 160}, "assistant_message_id": "uuid-of-assistant-row"}
```

**`panel_error` event** — Follow-up failed after retries:
```
event: panel_error
data: {"message": "...", "attempt": 2}
```

**Side effects:**

- Creates or reuses an `insights_followup_jobs` row for the assistant message
- Emits `panel_started` before panel generation so the client can show “updating insights” earlier
- Persists the canonical card snapshot on `Message.panel_cards`
- Replaces `DealState.ai_panel_cards` with the same canonical snapshot
- Merges panel-phase usage into the assistant row usage and session-level usage ledger
- Emits the panel snapshot atomically; incremental `panel_card` SSE events are not part of this public contract

**Error responses:**

| Status | Detail |
|---|---|
| `404` | Session not found |
| `404` | Assistant message not found in this session |

---

### POST /api/chat/{session_id}/messages/{message_id}/branch

**Branch** the session from an existing **user** message: deletes any messages after that anchor when present; **always** clears `compaction_state` and `usage`, resets deals/vehicles and session-level deal JSON on `DealState` (preserves `buyer_context`); updates the anchor row’s `content` / `image_url`; then runs the same SSE chat stream as `POST .../message`.

**Auth required:** Yes

**Path parameters:**

| Param | Type | Description |
|---|---|---|
| `session_id` | string | Session UUID |
| `message_id` | string | Anchor message UUID — must be `role=user` in this session |

**Request body:**

```json
{
  "content": "Revised question…",
  "image_url": null
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `content` | string | Yes | New text for the anchor user message |
| `image_url` | string | No | Optional image URL |

**Response:** `200 OK` — `text/event-stream` (same chat SSE event families as `POST .../message`)

**Side effects (every request):**

- Rows after the anchor in `(created_at, id)` order are deleted when any exist (including `system` compaction notices).
- `compaction_state` and `usage` on the session are cleared; deals and vehicles for the session are removed and session-level deal fields on `DealState` are cleared (`buyer_context` kept), even when there is no tail to delete — so structured state matches a Cursor-style resubmit from this user turn.
- The model context includes a short branch reminder: structured records were cleared; the transcript may still mention earlier discussion; use current deal state and tools as authoritative.

**Checkpoint note:** This clears structured state to empty; it does **not** reconstruct deal rows as they were at a prior point in time (no per-message snapshots or tool replay).

**Error responses:**

| Status | Detail |
|---|---|
| `404` | Session not found, or anchor message not in session |
| `422` | Anchor is not a user message |

See [ADR 0020](adr/0020-chat-branch-from-user-message.md).

---

### POST /api/chat/{session_id}/stop

Request cancellation for the currently active turn in this session.

**Auth required:** Yes

**Request body:**

```json
{
  "turn_id": "uuid | null",
  "reason": "user_stop"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `turn_id` | string | No | Optional optimistic guard; if provided and mismatched, request returns `409` |
| `reason` | string | No | Cancellation reason (`user_stop` default) |

**Response:** `200 OK`

```json
{
  "status": "cancelled",
  "turn_id": "uuid",
  "cancelled": true
}
```

`status` is one of: `cancelled`, `already_cancelled`, `not_found`.

**Error responses:**

| Status | Detail |
|---|---|
| `404` | Session not found |
| `409` | Provided `turn_id` does not match the active turn |

---

### POST /api/chat/{session_id}/panel-refresh

Regenerate insights panel cards from the current structured deal state and latest persisted assistant message without creating a new chat turn.
This is the explicit command path used when `insights_update_mode` is `paused` and is also available on demand in `live` mode. Internally it reuses the shared linked follow-up pipeline for the latest assistant turn and forces a rerun even if a prior follow-up job already succeeded.

**Auth required:** Yes

**Request body:** none

**Response:** `200 OK`

```json
{
  "cards": [
    {
      "kind": "phase",
      "template": "briefing",
      "title": "Status",
      "content": { "stance": "researching", "situation": "..." },
      "priority": "high"
    }
  ],
  "assistant_message_id": "uuid"
}
```

**Error responses:**

| Status | Detail |
|---|---|
| `404` | Session not found |
| `404` | Deal state not found |
| `409` | No assistant message exists yet for this session |

---

### GET /api/chat/{session_id}/messages

Get the full message history for a session, ordered by creation time, plus **context pressure** for the next model turn (heuristic token estimate vs budget).

**Auth required:** Yes

**Path parameters:**

| Param | Type | Description |
|---|---|---|
| `session_id` | string | Session UUID |

**Response:** `200 OK`

```json
{
  "messages": [
    {
      "id": "uuid",
      "session_id": "uuid",
      "role": "user",
      "content": "I'm looking at a 2024 Camry",
      "image_url": null,
      "tool_calls": null,
      "usage": null,
      "created_at": "2026-03-24T12:00:00Z"
    },
    {
      "id": "uuid",
      "session_id": "uuid",
      "role": "assistant",
      "content": "Great choice. What's the asking price?",
      "image_url": null,
      "tool_calls": [
        {
          "name": "set_vehicle",
          "args": {"year": 2024, "make": "Toyota", "model": "Camry"}
        }
      ],
      "usage": {
        "requests": 2,
        "inputTokens": 1240,
        "outputTokens": 188,
        "cacheCreationInputTokens": 0,
        "cacheReadInputTokens": 620,
        "totalTokens": 1428
      },
      "completion_status": "complete",
      "interrupted_at": null,
      "interrupted_reason": null,
      "panel_cards": null,
      "created_at": "2026-03-24T12:00:01Z"
    }
  ],
  "context_pressure": {
    "level": "ok",
    "estimated_input_tokens": 42000,
    "input_budget": 180000
  }
}
```

Message-level `usage` remains per assistant turn. Assistant rows may include **`panel_cards`** (canonical snapshot after a successful panel phase, else `null`). Session-wide totals are exposed on the session resource. Stream usage is phase-specific (`done` for chat phase, `panel_done` for panel phase).

**Error responses:**

| Status | Detail |
|---|---|
| `404` | Session not found |

---

## Deal

All deal endpoints require authentication.

### GET /api/deal/{session_id}

Get the current deal state for a session.

**Auth required:** Yes

**Path parameters:**

| Param | Type | Description |
|---|---|---|
| `session_id` | string | Session UUID |

**Response:** `200 OK`

```json
{
  "session_id": "uuid",
  "buyer_context": "researching",
  "active_deal_id": "uuid | null",
  "vehicles": [
    {
      "id": "uuid",
      "role": "primary",
      "year": 2024,
      "make": "Toyota",
      "model": "Camry",
      "trim": "LE",
      "vin": null,
      "mileage": null,
      "color": null,
      "engine": null
    }
  ],
  "deals": [
    {
      "id": "uuid",
      "vehicle_id": "uuid",
      "dealer_name": "Acme Toyota",
      "phase": "research",
      "msrp": null,
      "listing_price": null,
      "current_offer": null,
      "health_status": null,
      "health_summary": null,
      "recommendation": null,
      "red_flags": [],
      "information_gaps": [],
      "score_price": null,
      "score_overall": null
    }
  ],
  "red_flags": [],
  "information_gaps": [],
  "checklist": [],
  "timer_started_at": null,
  "ai_panel_cards": [],
  "negotiation_context": null,
  "deal_comparison": null,
  "updated_at": "2026-03-24T12:00:00Z"
}
```

The response contains session-level state plus arrays of `vehicles` and `deals`. Each deal is linked to a vehicle via `vehicle_id`. The `active_deal_id` indicates which deal the panel is currently showing. The `negotiation_context` object (nullable) contains the AI-maintained situational awareness: `stance` (NegotiationStance enum value), `situation` (short description), `key_numbers` (array of label/value/note), `scripts` (array of label/text), `pending_actions` (array of action/detail/done), and `leverage` (array of strings).

**Error responses:**

| Status | Detail |
|---|---|
| `404` | Session not found |
| `404` | Deal state not found |

---

### PATCH /api/deal/{session_id}

Apply user-initiated corrections to vehicles and/or deals within a session. Corrections are scoped by entity ID. After applying corrections, the backend re-assesses the affected deal via Haiku and returns updated health status and red flags.

**Auth required:** Yes

**Path parameters:**

| Param | Type | Description |
|---|---|---|
| `session_id` | string | Session UUID |

**Request body:**

```json
{
  "vehicle_corrections": [
    {
      "vehicle_id": "uuid",
      "year": 2024,
      "make": "Toyota"
    }
  ],
  "deal_corrections": [
    {
      "deal_id": "uuid",
      "listing_price": 34000,
      "dealer_name": "Acme Toyota"
    }
  ]
}
```

Both `vehicle_corrections` and `deal_corrections` are optional arrays. Each correction object targets a specific entity by ID. Only provided fields are updated.

Correctable vehicle fields: `year`, `make`, `model`, `trim`, `vin`, `mileage`, `color`, `engine`.

Correctable deal fields: `dealer_name`, `msrp`, `invoice_price`, `listing_price`, `your_target`, `walk_away_price`, `current_offer`, `monthly_payment`, `apr`, `loan_term_months`, `down_payment`, `trade_in_value`.

**Response:** `200 OK`

```json
{
  "deal_id": "uuid",
  "health_status": "good",
  "health_summary": "Strong deal — offer is $1,200 below listing price",
  "recommendation": "Lock in this price and move to financing",
  "red_flags": []
}
```

| Field | Type | Description |
|---|---|---|
| `deal_id` | string | The deal that was re-assessed |
| `health_status` | string | Updated deal health: `good`, `fair`, `concerning`, `bad` (nullable) |
| `health_summary` | string | 1-2 sentence explanation (nullable) |
| `recommendation` | string | AI-generated next-action recommendation (nullable) |
| `red_flags` | array | Updated list of red flag objects: `{id, severity, message}` |

**Side effects:**
- Vehicle corrections propagate to linked deals for re-assessment
- If `current_offer` is set and `first_offer` is null, `first_offer` is snapshotted
- After applying corrections, `analyze_deal()` runs via Haiku to update health status, red flags, and recommendation on the first affected deal

**Error responses:**

| Status | Detail |
|---|---|
| `400` | No corrections provided |
| `404` | Session not found |
| `404` | Deal state not found |
| `404` | Vehicle or deal not found in this session |

---

### POST /api/deal/{session_id}/vehicles/upsert-from-vin

Create or find a shopping vehicle by VIN. Matches against both `primary` and `candidate` roles (the "shopping" set). If a vehicle with the given VIN already exists in the session, returns it (existing vehicles may still be the active deal). **New** vehicles are created with `role="candidate"` so that pasting a VIN does not prematurely commit the buyer — candidate inserts do NOT steal `active_deal_id` focus. Claude or the buyer can later promote a candidate to `primary` when commitment is signaled (ADR 0018). The VIN is decoded via NHTSA vPIC on first creation and a deal row is auto-created for the vehicle.

**Auth required:** Yes

**Request body:**

```json
{
  "vin": "1HGBH41JXMN109186"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `vin` | string | Yes | Vehicle VIN (1-20 chars, alphanumeric with optional spaces/dashes) |

**Response:** `200 OK` — `VehicleResponse` (includes `intelligence` sub-object)

**Error responses:**

| Status | Detail |
|---|---|
| `400` | Invalid VIN format |
| `404` | Session/deal state not found |

---

### GET /api/deal/{session_id}/vehicles/{vehicle_id}/intelligence

Get existing vehicle intelligence data (decode, history report, valuation) for a vehicle.

**Auth required:** Yes

**Response:** `200 OK`

```json
{
  "decode": { "id": "uuid", "provider": "nhtsa_vpic", "status": "success", "vin": "...", "year": 2024, "make": "Toyota", ... },
  "history_report": { "id": "uuid", "provider": "vinaudit", "status": "success", ... },
  "valuation": { "id": "uuid", "provider": "vinaudit", "status": "success", "amount": 28500, ... }
}
```

All three sub-objects are nullable (null if not yet fetched).

---

### POST /api/deal/{session_id}/vehicles/{vehicle_id}/decode-vin

Decode a VIN via NHTSA vPIC. Stores the decode result (including raw NHTSA payload) and updates the vehicle's specs.

**Auth required:** Yes

**Request body:**

```json
{
  "vin": "1HGBH41JXMN109186"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `vin` | string | No | VIN to decode (defaults to vehicle's stored VIN) |

**Response:** `200 OK` — `VehicleIntelligenceResponse`

**Error responses:**

| Status | Detail |
|---|---|
| `400` | Invalid VIN / decode error |
| `502` | External API failure |
| `503` | Provider not configured |

---

### POST /api/deal/{session_id}/vehicles/{vehicle_id}/confirm-identity

Confirm or reject a vehicle's decoded identity. Confirmation triggers AI panel card refresh and session title update.

**Auth required:** Yes

**Request body:**

```json
{
  "status": "confirmed"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | string | Yes | `"confirmed"` or `"rejected"` |

**Response:** `200 OK` — `VehicleResponse`

**Side effects:**
- Sets `identity_confirmation_status`, `identity_confirmed_at`, `identity_confirmation_source` on the vehicle
- Regenerates AI panel cards via Haiku
- Updates session title from confirmed vehicle identity

---

### POST /api/deal/{session_id}/vehicles/{vehicle_id}/check-history

Fetch vehicle history report via VinAudit. Returns title brand info, salvage/theft/odometer flags.

**Auth required:** Yes

**Request body:**

```json
{
  "vin": "1HGBH41JXMN109186"
}
```

**Response:** `200 OK` — `VehicleIntelligenceResponse`

**Error responses:**

| Status | Detail |
|---|---|
| `400` | Invalid VIN / lookup error |
| `502` | External API failure |
| `503` | Provider not configured (missing `VINAUDIT_API_KEY`) |

---

### POST /api/deal/{session_id}/vehicles/{vehicle_id}/get-valuation

Fetch market valuation via VinAudit. Returns estimated market asking price.

**Auth required:** Yes

**Request body:**

```json
{
  "vin": "1HGBH41JXMN109186"
}
```

**Response:** `200 OK` — `VehicleIntelligenceResponse`

**Error responses:**

| Status | Detail |
|---|---|
| `400` | Invalid VIN / valuation error |
| `502` | External API failure |
| `503` | Provider not configured (missing `VINAUDIT_API_KEY`) |

---

## Simulations

All simulation endpoints require authentication.

### GET /api/simulations/scenarios

List all available training scenarios.

**Auth required:** Yes

**Request body:** None

**Response:** `200 OK`

```json
[
  {
    "id": "scenario-1",
    "title": "Price Negotiation",
    "description": "A budget-conscious buyer pushes back hard on price. They have a competing offer.",
    "difficulty": "medium",
    "ai_persona": {
      "name": "Mike",
      "budget": 28000,
      "personality": "Analytical, calm, does research. Will walk away if numbers don't work.",
      "vehicle": "2024 Toyota Camry LE",
      "challenges": [
        "Has a lower offer from competitor",
        "Focused on OTD price",
        "Asks for fee breakdown"
      ]
    }
  }
]
```

The `ai_persona` object structure:

| Field | Type | Description |
|---|---|---|
| `name` | string | Character name |
| `budget` | number | Maximum spend |
| `personality` | string | Behavioral description |
| `vehicle` | string | Vehicle the persona wants |
| `challenges` | array of strings | Specific negotiation challenges |

Current available scenarios: `scenario-1` (Price Negotiation, medium), `scenario-2` (Trade-In Pushback, easy), `scenario-3` (F&I Gauntlet, hard), `scenario-4` (The Walk-Away, hard).

**Error responses:**

| Status | Detail |
|---|---|
| `403` | Only dealers can access training scenarios |
