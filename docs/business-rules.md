# Business Rules

Last updated: 2026-03

## Table of Contents

1. [Deal Phases](#deal-phases)
2. [Deal Scoring](#deal-scoring)
3. [Chat Sessions](#chat-sessions)
4. [AI Tool Definitions](#ai-tool-definitions)
5. [Simulations](#simulations)
6. [Authentication](#authentication)
7. [Claude API](#claude-api)

---

## Deal Phases

Every deal progresses through a lifecycle of phases. The AI updates the phase automatically via the `update_deal_phase` tool as the conversation indicates progression.

| Phase | Description |
|---|---|
| `research` | Default starting phase. Buyer is gathering information, comparing vehicles. |
| `initial_contact` | Buyer has arrived at or contacted the dealership. |
| `test_drive` | Buyer is test driving or has just completed a test drive. |
| `negotiation` | Active price negotiation between buyer and dealer. |
| `financing` | Financing terms, F&I products, and paperwork under discussion. |
| `closing` | Final signatures, delivery, and deal completion. |

Phase transitions are driven by conversational context. The AI calls `update_deal_phase` whenever the conversation indicates a shift (e.g., mentioning arriving at the dealer triggers `initial_contact`, discussing APR or loan terms triggers `financing`).

The default phase for new sessions is `research`.

---

## Deal Scoring

The AI evaluates how the deal is going for the buyer across five dimensions. Each dimension receives a traffic-light rating:

| Rating | Meaning |
|---|---|
| `green` | Favorable for the buyer |
| `yellow` | Acceptable but could be better |
| `red` | Unfavorable, buyer should push back or walk away |

### Score Dimensions

| Dimension | Field | What It Measures |
|---|---|---|
| Price | `score_price` | How the vehicle price compares to market value, invoice, and fair deal ranges |
| Financing | `score_financing` | APR, loan term, and monthly payment quality relative to buyer's creditworthiness |
| Trade-In | `score_trade_in` | Whether the trade-in offer is fair based on market value |
| Fees | `score_fees` | Whether dealer fees and add-ons are reasonable or inflated |
| Overall | `score_overall` | Holistic assessment of the entire deal |

Scores are updated via the `update_scorecard` tool. The AI calls this after assessing deal quality, typically when new financial figures are discussed.

---

## Chat Sessions

### Session Types

| Type | Purpose |
|---|---|
| `buyer_chat` | Buyer-facing deal advisor session. AI helps the buyer negotiate and understand the deal. |
| `dealer_sim` | Dealer training simulation. AI role-plays as a buyer persona for salesperson practice. |

### Default Titles

When no title is provided at creation:
- `buyer_chat` sessions default to "New Deal"
- `dealer_sim` sessions default to "New Simulation"

### Linked Sessions

Sessions can be linked to other sessions via `linked_session_ids`. When a session has linked sessions, the last 10 messages from those linked sessions are included in the system prompt as prior conversation context (truncated to 200 characters per message). This allows continuity across related conversations.

### Message History Limits

The Claude API context window includes the most recent **20 messages** from the current session (`CLAUDE_MAX_HISTORY = 20`). Older messages are persisted in the database but not sent to the AI.

### Message Structure

Each message stores:
- `role` — `user` or `assistant`
- `content` — The message text
- `image_url` — Optional image attachment (e.g., photo of a deal sheet)
- `tool_calls` — For assistant messages, the list of tool calls made (name + args)

---

## AI Tool Definitions

The AI has 5 tools that drive the frontend dashboard. Tools are called proactively by the AI during conversation -- the user does not need to request them.

### 1. `update_deal_numbers`

Updates the financial dashboard when prices, payments, rates, or financial terms are discussed.

**Fields** (all optional):

| Field | Type | Description |
|---|---|---|
| `msrp` | number | Manufacturer's suggested retail price |
| `invoice_price` | number | Dealer invoice price |
| `their_offer` | number | Dealer's current asking/offer price |
| `your_target` | number | Buyer's target price |
| `walk_away_price` | number | Price above which the buyer should walk away |
| `current_offer` | number | Current negotiation price on the table |
| `monthly_payment` | number | Monthly payment amount |
| `apr` | number | Annual percentage rate |
| `loan_term_months` | integer | Loan term in months |
| `down_payment` | number | Down payment amount |
| `trade_in_value` | number | Trade-in vehicle value |

**Trigger:** Whenever any financial figure is discussed or changes in conversation.

### 2. `update_deal_phase`

Updates the current phase of the deal.

**Fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `phase` | string | Yes | One of: `research`, `initial_contact`, `test_drive`, `negotiation`, `financing`, `closing` |

**Trigger:** When the conversation indicates progression to a new deal phase.

### 3. `update_scorecard`

Updates the red/yellow/green scorecard ratings.

**Fields** (all optional):

| Field | Type | Values |
|---|---|---|
| `score_price` | string | `red`, `yellow`, `green` |
| `score_financing` | string | `red`, `yellow`, `green` |
| `score_trade_in` | string | `red`, `yellow`, `green` |
| `score_fees` | string | `red`, `yellow`, `green` |
| `score_overall` | string | `red`, `yellow`, `green` |

**Trigger:** After assessing deal quality, typically when new financial figures are discussed.

### 4. `set_vehicle`

Sets or updates the vehicle being discussed.

**Fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `make` | string | Yes | Vehicle manufacturer |
| `model` | string | Yes | Vehicle model |
| `year` | integer | No | Model year |
| `trim` | string | No | Trim level |
| `vin` | string | No | Vehicle identification number |
| `mileage` | integer | No | Odometer reading |
| `color` | string | No | Exterior color |

**Trigger:** Whenever the user mentions a vehicle (year, make, model).

### 5. `update_checklist`

Updates the buyer's checklist of things to verify or do at the dealership.

**Fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `items` | array | Yes | Array of checklist items, each with `label` (string) and `done` (boolean) |

**Trigger:** When the AI gives advice about what to check or do. Replaces the entire checklist on each call.

### Tool Application Order

When the AI returns multiple tool calls in a single response, they are applied sequentially to the deal state and each emits a separate `tool_result` SSE event to the frontend.

---

## Simulations

Dealer training simulations allow salespeople to practice against AI customer personas. Scenarios are currently hardcoded (MVP) and will move to a database in a future version.

### Scenarios

Each scenario has:
- **id** — Unique identifier (e.g., `scenario-1`)
- **title** — Short name (e.g., "Price Negotiation")
- **description** — What the scenario tests
- **difficulty** — `easy`, `medium`, or `hard`
- **ai_persona** — The AI buyer character:
  - `name` — Character name
  - `budget` — Maximum the character will spend
  - `personality` — Behavioral description
  - `vehicle` — What the character wants to buy
  - `challenges` — List of specific negotiation challenges

### Current Scenarios

| ID | Title | Difficulty | Persona | Key Challenge |
|---|---|---|---|---|
| `scenario-1` | Price Negotiation | medium | Mike ($28k budget) | Has competing offer, focused on OTD price |
| `scenario-2` | Trade-In Pushback | easy | Sarah ($35k budget) | Emotionally attached to trade-in, thinks it's worth more |
| `scenario-3` | F&I Gauntlet | hard | James ($42k budget) | Declines all F&I products, knows dealer costs |
| `scenario-4` | The Walk-Away | hard | David ($31k budget) | Ready to leave, won't respond to urgency tactics |

---

## Authentication

### Roles

| Role | Description |
|---|---|
| `buyer` | Default role. Access to buyer chat sessions and deal analysis. |
| `dealer` | Access to dealer training simulations. |

Role is selected at registration via "Buying" / "Selling" buttons (mapping to `buyer` / `dealer`) and defaults to `buyer` if not specified. Role switching is available only in development mode (`__DEV__`).

### Role Enforcement

- **Session creation**: The backend enforces that buyers can only create `buyer_chat` sessions and dealers can only create `dealer_sim` sessions. Mismatched requests return `403 Forbidden`.
- **Simulation access**: Only dealers can access the `/api/simulations/scenarios` endpoint. Buyers receive `403 Forbidden`.
- **Linked session ownership**: When linking sessions, the backend verifies all linked session IDs belong to the current user. Linking to another user's session returns `403 Forbidden`.
- **Frontend role guards**: The `RoleGuard` component redirects users to their role-appropriate default screen if they attempt to access a screen meant for the other role.

### JWT Tokens

- Algorithm: HS256
- Expiry: **8 hours** (`ACCESS_TOKEN_EXPIRE_MINUTES = 480`)
- Payload: `sub` (user ID) + `exp` (expiration timestamp)
- Transport: `Authorization: Bearer <token>` header
- Password hashing: bcrypt

### User Fields

- `email` — Unique, validated as email format
- `password` — Hashed with bcrypt, never stored in plain text
- `role` — `buyer` or `dealer`
- `display_name` — Optional display name

---

## Claude API

### Configuration

| Setting | Value | Description |
|---|---|---|
| `CLAUDE_MODEL` | `claude-sonnet-4-6` | Claude model used for all AI interactions |
| `CLAUDE_MAX_TOKENS` | `1024` | Maximum tokens per response |
| `CLAUDE_MAX_HISTORY` | `20` | Messages included in context window |

### Streaming

Chat responses are streamed via Server-Sent Events (SSE) with three event types:

| Event | Data | Description |
|---|---|---|
| `text` | `{"chunk": "..."}` | Incremental text from the AI response |
| `tool_result` | `{"tool": "...", "data": {...}}` | A tool call result for dashboard updates |
| `done` | `{"text": "...", "tool_calls": [...]}` | Final event with complete text and all tool calls |

### Cost Controls

- Max tokens capped at 1024 per response
- Message history limited to 20 messages to control context size
- Linked session context limited to last 10 messages, each truncated to 200 characters
