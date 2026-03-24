# Backend API Endpoints

Last updated: 2026-03-24

Base URL: `/api`
Authentication: Bearer token in `Authorization` header (unless noted otherwise)

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
  "role": "buyer"
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
  "role": "buyer"
}
```

**Error responses:**

| Status | Detail |
|---|---|
| `401` | Invalid credentials |

---

## Sessions

All session endpoints require authentication.

### GET /api/sessions

List all sessions for the authenticated user, ordered by most recently updated.

**Auth required:** Yes

**Request body:** None

**Response:** `200 OK`

```json
[
  {
    "id": "uuid",
    "title": "New Deal",
    "session_type": "buyer_chat",
    "linked_session_ids": [],
    "created_at": "2026-03-24T12:00:00Z",
    "updated_at": "2026-03-24T12:00:00Z"
  }
]
```

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
  "title": "New Deal",
  "session_type": "buyer_chat",
  "linked_session_ids": [],
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

**Response:** `200 OK`

```json
{
  "id": "uuid",
  "title": "Updated Title",
  "session_type": "buyer_chat",
  "linked_session_ids": ["uuid1", "uuid2"],
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
| `content` | string | Yes | User's message text |
| `image_url` | string | No | URL of an image to include (e.g., deal sheet photo) |

**Response:** `200 OK` — `text/event-stream`

The response is a stream of Server-Sent Events with three event types:

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
data: {"tool": "update_deal_numbers", "data": {"msrp": 35000, "their_offer": 33500}}

event: tool_result
data: {"tool": "update_scorecard", "data": {"score_price": "green", "score_overall": "yellow"}}
```

**`done` event** — Final event with complete response:
```
event: done
data: {"text": "Based on the numbers you've shared, this is a fair deal.", "tool_calls": [{"name": "update_deal_numbers", "args": {"msrp": 35000, "their_offer": 33500}}]}
```

**Side effects:**
- User message is persisted before streaming begins
- Assistant message (with tool calls) is persisted after streaming completes
- Tool call results are applied to the session's deal state
- Session `updated_at` timestamp is refreshed

**Error responses:**

| Status | Detail |
|---|---|
| `404` | Session not found |

---

### GET /api/chat/{session_id}/messages

Get the full message history for a session, ordered by creation time.

**Auth required:** Yes

**Path parameters:**

| Param | Type | Description |
|---|---|---|
| `session_id` | string | Session UUID |

**Response:** `200 OK`

```json
[
  {
    "id": "uuid",
    "session_id": "uuid",
    "role": "user",
    "content": "I'm looking at a 2024 Camry",
    "image_url": null,
    "tool_calls": null,
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
    "created_at": "2026-03-24T12:00:01Z"
  }
]
```

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
  "phase": "research",
  "buyer_context": "researching",
  "msrp": null,
  "invoice_price": null,
  "their_offer": null,
  "your_target": null,
  "walk_away_price": null,
  "current_offer": null,
  "monthly_payment": null,
  "apr": null,
  "loan_term_months": null,
  "down_payment": null,
  "trade_in_value": null,
  "vehicle_year": null,
  "vehicle_make": null,
  "vehicle_model": null,
  "vehicle_trim": null,
  "vehicle_vin": null,
  "vehicle_mileage": null,
  "vehicle_color": null,
  "score_price": null,
  "score_financing": null,
  "score_trade_in": null,
  "score_fees": null,
  "score_overall": null,
  "checklist": [],
  "timer_started_at": null,
  "updated_at": "2026-03-24T12:00:00Z"
}
```

**Error responses:**

| Status | Detail |
|---|---|
| `404` | Session not found |
| `404` | Deal state not found |

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
