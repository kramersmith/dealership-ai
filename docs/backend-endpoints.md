# Backend API Endpoints

Last updated: 2026-03-31 (vehicle intelligence endpoints added)

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

The response is a stream of Server-Sent Events. The core events are `text`, `tool_result`, and terminal `done`, with additional recovery/status events such as `retry`, `step`, and `tool_error`.

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

**`done` event** — Final event with complete response:
```
event: done
data: {"text": "Based on the numbers you've shared, this is a fair deal.", "usage": {"requests": 2, "inputTokens": 1240, "outputTokens": 188, "cacheCreationInputTokens": 0, "cacheReadInputTokens": 620, "totalTokens": 1428}}
```

**Side effects:**
- Message history is loaded before the user message is saved (prevents duplicate user messages in Claude context)
- User message is persisted before streaming begins
- The step loop may execute multiple model requests before the terminal `done` event; the `usage` payload reflects the full assistant response, not just the final step
- If Claude doesn't call `update_quick_actions`, the backend generates quick actions via Haiku (`CLAUDE_FAST_MODEL`) and emits them as a `tool_result` event
- Assistant message (with tool calls and any follow-up text) is persisted after streaming completes
- Tool call results are applied to the session's deal state
- Post-chat processing updates `last_message_preview` and auto-generates a session title (deterministic vehicle title or LLM fallback via Haiku) when `auto_title` is true
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
    "usage": {
      "requests": 2,
      "inputTokens": 1240,
      "outputTokens": 188,
      "cacheCreationInputTokens": 0,
      "cacheReadInputTokens": 620,
      "totalTokens": 1428
    },
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

Create or find a vehicle by VIN. If a vehicle with the given VIN already exists in the session, returns it and sets it as the active deal. Otherwise creates a new vehicle, auto-creates a deal, and decodes the VIN via NHTSA vPIC.

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
