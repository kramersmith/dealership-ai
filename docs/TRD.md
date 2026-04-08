# Technical Requirements Document: Dealership AI

**Last updated: 2026-04-08**

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [User Roles & Access](#3-user-roles--access)
4. [Authentication & Security](#4-authentication--security)
5. [API Contract](#5-api-contract)
6. [Core Business Rules](#6-core-business-rules)
7. [Data Model](#7-data-model)
8. [External Integrations](#8-external-integrations)
9. [Application Lifecycle](#9-application-lifecycle)
10. [Scheduled Jobs](#10-scheduled-jobs)

---

## 1. Overview

Dealership AI is a monorepo containing a unified AI-powered smartphone application for the car buying experience, with role-based access for two user types: a **buyer experience** that helps consumers understand deals, spot unauthorized charges, and negotiate effectively, and a **dealer experience** that provides AI training simulations where salespeople practice against AI customer personas. Both experiences live within a single app, with the user's role (selected at registration) determining which screens are accessible.

### Tech Stack


| Layer            | Technology                                             |
| ---------------- | ------------------------------------------------------ |
| Frontend         | React Native + Expo + Tamagui + Zustand                |
| Backend          | FastAPI + SQLAlchemy + Alembic                         |
| Database (dev)   | SQLite                                                 |
| Database (prod)  | PostgreSQL 15                                          |
| AI               | Anthropic Claude API — Sonnet 4.6 (primary) + Haiku 4.5 (fast tasks) — with tool use |
| Authentication   | JWT (HS256) + bcrypt                                   |
| Streaming        | Server-Sent Events (SSE)                               |
| Containerization | Docker Compose                                         |


### Repository Structure

```
dealership-ai/
├── apps/
│   ├── backend/          # FastAPI application
│   │   ├── app/
│   │   │   ├── core/     # Config, security, dependency injection
│   │   │   ├── db/       # Database engine, base model
│   │   │   ├── models/   # SQLAlchemy ORM models
│   │   │   ├── routes/   # API endpoint definitions
│   │   │   ├── schemas/  # Pydantic request/response models
│   │   │   └── services/ # Business logic (Claude integration, deal state, tool validation, extraction)
│   │   └── migrations/   # Alembic database migrations
│   └── mobile/           # Expo React Native application
│       ├── app/          # Expo Router file-based routing
│       ├── components/   # Chat, Chats (session list), Insights Panel, Shared UI
│       ├── hooks/        # useChat, useScreenWidth, useIconEntrance
│       ├── lib/          # Theme (tokens + themes), API client
│       └── stores/       # Zustand state management
├── docs/                 # Project documentation
├── docker-compose.yml
└── Makefile
```

---

## 2. Architecture

```mermaid
graph TB
    subgraph Client["Client (Expo :8081)"]
        Screens["Screens<br/>(Expo Router)"]
        Stores["Stores<br/>(Zustand)"]
        Hooks["Hooks<br/>(useChat)"]
        Components["Components<br/>(Chat / Insights)"]
        Screens <--> Stores <--> Hooks
        Screens --- Components
    end

    Client -->|"HTTP + SSE"| Backend

    subgraph Backend["FastAPI Backend (:8001)"]
        Routes["Routes Layer<br/>/api/auth · /api/sessions · /api/chat<br/>/api/deal · /api/simulations"]
        Services["Services Layer<br/>Claude integration (step loop, SSE streaming, usage tracking)<br/>Deal state logic · Post-chat processing · Title generation"]
        Data["Data Layer<br/>SQLAlchemy ORM · Alembic Migrations · Pydantic"]
        Routes --> Services --> Data
    end

    Data --> SQLite["SQLite (dev)"]
    Data --> PostgreSQL["PostgreSQL 15 (:5433)"]
    Services -->|"Streaming API"| Claude["Anthropic Claude API<br/>(Sonnet 4.6)"]
```

### Request Flow: Chat Message with Tool Use

1. Client sends `POST /api/chat/{session_id}/message` with user text (and optional image URL). For gated VIN intercept flows the client may first call `POST /api/chat/{session_id}/user-message` to pre-persist the user message row (so it appears in `GET /messages` while decode/confirm runs), then invoke `/message` with `existing_user_message_id` to resume streaming on that row — see ADR 0019.
2. Backend loads persisted message history for the session, deal state, and (if configured) linked-session messages **before** saving the new user turn.
3. Inside the SSE stream, **optional auto context compaction** may run first when a heuristic input-token estimate crosses a policy threshold (see ADR 0017): the backend can call the primary model (`CLAUDE_MODEL`) to refresh a rolling summary, update `ChatSession.compaction_state`, persist a `Message(role=system)` notice, emit `compaction_started` / `compaction_done` or `compaction_error`, and refresh history for projection.
4. Backend persists the new user message, constructs a `TurnContext` (session, deal state, DB session), and builds the Claude message list: projected dialogue (rolling-summary prefix when present, then up to `CLAUDE_MAX_HISTORY` user/assistant turns) plus the new user turn. A per-turn context message — deal state, context-aware preamble based on `buyer_context`, negotiation context summary, linked session context, and current UTC date for temporal grounding — is merged into the user message as content blocks (no synthetic assistant reply). The system prompt stays stable and cacheable across turns.
5. Backend opens a streaming connection to the Claude API (Sonnet) with the current tool set.
6. Claude streams back text chunks and tool calls.
7. Backend relays SSE events to the client as the turn progresses:
    - `event: compaction_started` / `event: compaction_done` / `event: compaction_error` -- optional context compaction lifecycle **before** chat streaming when auto-compaction runs
    - `event: text` -- conversation text chunks
    - `event: tool_result` -- dashboard state updates (numbers, phase, scorecard, vehicle, checklist, quick actions, deal health, red flags, information gaps, negotiation context)
    - `event: retry` -- stream recovery or `max_tokens` replay signal, including `reset_text` when the client should discard partial text
    - `event: step` -- step-loop progress for multi-step turns
    - `event: error` -- unrecoverable API failure with a safe user-visible message
    - `event: done` -- chat text completion payload (input can unblock immediately)
    - `event: panel_started` / `event: panel_card` / `event: panel_done` / `event: panel_error` -- asynchronous panel lifecycle events after `done`
8. If the step loop raises an unrecoverable error (e.g. Anthropic billing, authentication), the backend emits an `error` SSE event with a safe user-visible message and deletes the orphan user message to prevent duplicate history on retry. Known API errors are mapped to specific but non-leaking messages.
9. If a Claude step ends with `stop_reason == "max_tokens"`, the backend retries with a larger bounded token budget before giving up. Step-control logic bounds tool rounds per buyer message (step 0 = auto, step 1 = conditional based on errors/text visibility, step 2+ = text-only) to prevent model self-dialogue loops. Tool inputs undergo semantic validation (`tool_validation.py`) before database application; invalid inputs are returned as `is_error` tool results for model self-correction.
10. **Server-side quick actions:** If Claude didn't call `update_quick_actions`, the backend generates suggestions via Haiku (`CLAUDE_FAST_MODEL`) and emits them as a `tool_result` SSE event.
11. After the step loop completes, the backend emits `done`, then starts a separate panel streaming phase that emits `panel_started`, incremental `panel_card` events, and terminal `panel_done` or `panel_error`.
12. On stream completion, backend persists the assistant message, including tool calls and aggregated per-turn usage metadata (chat phase + panel phase), applies tool call results to `deal_states`, and folds the turn's usage into the session-level usage ledger.
13. **Post-chat processing:** After tool calls are applied, `update_session_metadata()` updates the session's `last_message_preview` (truncated assistant response) and auto-generates a title when `auto_title` is true — deterministic vehicle title if `set_vehicle` was called, otherwise LLM-generated via Haiku on the first exchange.
14. Client Zustand stores update in real time as SSE events arrive. Tool result callbacks are deferred until after the `done` event so the UI finalizes the reply before insights update. The frontend `snakeToCamel` utility converts backend snake_case field names to camelCase for Zustand stores.
15. The `done` event carries chat text and chat-phase usage. Panel-phase usage is emitted on `panel_done` and merged into the persisted assistant usage summary.

---

## 3. User Roles & Access


| Role     | Description                                       | Access                                                                     |
| -------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| `buyer`  | Car buyer using the deal advisor                  | Own sessions (buyer_chat), own deal states, chat with AI advisor           |
| `dealer` | Dealership salesperson using training simulations | Own sessions (dealer_sim), simulation scenarios, practice with AI personas |


### Access Control Rules

- Role is set at signup (user selects "Buying" or "Selling" during registration) and stored on the `users` record (`buyer` or `dealer`).
- All session, message, deal, and chat endpoints enforce **user-scoped access**: a user can only read/modify their own sessions (`ChatSession.user_id == current_user.id`).
- **Role enforcement on session creation**: buyers can only create `buyer_chat` sessions; dealers can only create `dealer_sim` sessions. Returns `403 Forbidden` on mismatch.
- **Role enforcement on simulations**: only dealers can access the `/api/simulations/scenarios` endpoint. Returns `403 Forbidden` for buyers.
- **Linked session ownership validation**: when updating `linked_session_ids`, the backend verifies all linked sessions belong to the current user. Returns `403 Forbidden` if any linked session is not owned.
- There is no admin role in the current version.
- Role switching is available only in development mode (`__DEV__`).
- Session type is determined at creation: `buyer_chat` for buyers, `dealer_sim` for dealers.

---

## 4. Authentication & Security

### Authentication Flow

1. **Signup** (`POST /api/auth/signup`): Accepts email, password, role, optional display name. Returns a JWT access token.
2. **Login** (`POST /api/auth/login`): Accepts email and password. Returns a JWT access token.
3. **Authenticated requests**: Include `Authorization: Bearer <token>` header. The `get_current_user` dependency decodes the token and loads the user.

### Token Specification


| Parameter      | Value                             |
| -------------- | --------------------------------- |
| Algorithm      | HS256                             |
| Signing key    | `SECRET_KEY` environment variable |
| Payload claim  | `sub` = user UUID                 |
| Default expiry | 480 minutes (8 hours)             |
| Library        | python-jose                       |


### Password Handling

- Passwords hashed with **bcrypt** (via the `bcrypt` Python package).
- Salt generated per password (`bcrypt.gensalt()`).
- Plaintext passwords never stored or logged.

### CORS

- Allowed origins configured via `CORS_ORIGINS` environment variable.
- Defaults: `http://localhost:8081`, `http://localhost:19006`.

### Environment Secrets


| Variable            | Purpose                    | Required   |
| ------------------- | -------------------------- | ---------- |
| `SECRET_KEY`        | JWT signing key            | Yes        |
| `ANTHROPIC_API_KEY` | Claude API access          | Yes        |
| `DATABASE_URL`      | Database connection string | Yes (prod) |


---

## 5. API Contract

### Route Summary


| Method   | Endpoint                          | Auth | Description                         |
| -------- | --------------------------------- | ---- | ----------------------------------- |
| `POST`   | `/api/auth/signup`                | No   | Create account, return token        |
| `POST`   | `/api/auth/login`                 | No   | Authenticate, return token          |
| `GET`    | `/api/sessions`                   | Yes  | List user's sessions (optional `?q=` search) |
| `POST`   | `/api/sessions`                   | Yes  | Create session + deal state (with optional buyer_context) |
| `GET`    | `/api/sessions/{session_id}`      | Yes  | Get single session                  |
| `PATCH`  | `/api/sessions/{session_id}`      | Yes  | Update title or linked sessions     |
| `DELETE` | `/api/sessions/{session_id}`      | Yes  | Delete session                      |
| `POST`   | `/api/chat/{session_id}/message`  | Yes  | Send message, receive SSE stream    |
| `GET`    | `/api/chat/{session_id}/messages` | Yes  | Message history plus `context_pressure` (estimated next-turn input vs budget) |
| `GET`    | `/api/deal/{session_id}`          | Yes  | Get deal state for session          |
| `PATCH`  | `/api/deal/{session_id}`          | Yes  | User corrections → Sonnet re-assessment |
| `GET`    | `/api/simulations/scenarios`      | Yes  | List available simulation scenarios |


### SSE Event Format

All chat responses stream as `text/event-stream` with these event types:

```
event: text
data: {"chunk": "Here's what I think about..."}

event: tool_result
data: {"tool": "update_deal_numbers", "data": {"msrp": 35000, "listing_price": 33500}}

event: compaction_started
data: {"reason": "input_budget", "estimated_input_tokens": 195000, "input_budget": 180000}

event: compaction_done
data: {"first_kept_message_id": "uuid-of-first-verbatim-turn"}

event: compaction_error
data: {"message": "Context summarization failed; continuing without compacting.", "detail": "OptionalErrorClassName"}

event: retry
data: {"attempt": 1, "reason": "max_tokens", "reset_text": true, "max_tokens": 8192}

event: error
data: {"message": "AI response failed. Please try again."}

event: done
data: {"text": "Full response text...", "usage": {"requests": 1, "inputTokens": 1240, "outputTokens": 188, "cacheCreationInputTokens": 0, "cacheReadInputTokens": 620, "totalTokens": 1428}}

event: panel_started
data: {"attempt": 1, "max_tokens": 2048}

event: panel_card
data: {"index": 0, "attempt": 1, "card": {"type": "briefing", "title": "Hold Firm", "content": {"body": "Their latest counter is still above your target."}, "priority": "high"}}

event: panel_done
data: {"cards": [{"type": "briefing", "title": "Hold Firm", "content": {"body": "Their latest counter is still above your target."}, "priority": "high"}], "usage": {"requests": 1, "inputTokens": 120, "outputTokens": 40, "cacheCreationInputTokens": 0, "cacheReadInputTokens": 60, "totalTokens": 160}}
```

The `done` event marks chat text completion only. Panel generation continues in the same SSE stream and is represented by `panel_*` events. The final persisted assistant usage summary includes both chat-phase and panel-phase usage.

For detailed endpoint schemas (request/response bodies, status codes), see the Pydantic schemas in `apps/backend/app/schemas/`.

---

## 6. Core Business Rules

### Deal Phases

A deal progresses through an ordered set of phases. Claude advances the phase via the `update_deal_phase` tool based on conversation context.


| Phase             | Description                             |
| ----------------- | --------------------------------------- |
| `research`        | Initial research, gathering information |
| `initial_contact` | First interaction with dealership       |
| `test_drive`      | Vehicle test drive                      |
| `negotiation`     | Price and terms negotiation             |
| `financing`       | F&I (Finance & Insurance) stage         |
| `closing`         | Final paperwork and signing             |


### Scorecard Ratings

Each deal dimension is rated on a three-level scale reflecting how the deal is going for the buyer:


| Rating   | Meaning                      |
| -------- | ---------------------------- |
| `green`  | Favorable for the buyer      |
| `yellow` | Caution, could be better     |
| `red`    | Unfavorable, needs attention |


Scorecard dimensions: **price**, **financing**, **trade_in**, **fees**, **overall**.

### Claude Tool Definitions

The AI advisor uses 10 tools to drive the frontend dashboard and quick actions in real time:


| Tool                     | Purpose                                    | Required Fields                  |
| ------------------------ | ------------------------------------------ | -------------------------------- |
| `update_deal_numbers`    | Update financial figures on the dashboard  | None (all optional)              |
| `update_deal_phase`      | Advance deal to a new phase                | `phase`                          |
| `update_scorecard`       | Set red/yellow/green ratings               | None (all optional)              |
| `set_vehicle`            | Set or update the vehicle under discussion | `make`, `model`                  |
| `update_checklist`       | Update buyer's action item checklist       | `items` (array of {label, done}) |
| `update_quick_actions`   | Suggest 2-3 dynamic quick action buttons   | `actions` (array of {label, prompt}) |
| `update_buyer_context`   | Change buyer's situational context mid-conversation | `buyer_context` |
| `update_deal_health`     | Overall deal health assessment (status + summary + recommendation) | `status`, `summary`, `recommendation` |
| `update_red_flags`       | Surface specific deal problems with severity | `flags` (array of {id, severity, message}) |
| `update_information_gaps` | Identify missing data to improve assessment | `gaps` (array of {label, reason, priority}) |


### Session Linking

Sessions can reference other sessions via `linked_session_ids` (JSON array). When a linked session exists, the backend includes the last 10 messages from linked sessions as context in the Claude system prompt. This supports continuity across multiple dealership visits or conversations.

### Message History Limits

- Full transcripts remain in the database. For each model request, the backend sends a **projection**: an optional rolling-summary prefix (from `ChatSession.compaction_state` when compaction has run) plus at most the **last 20 user/assistant turns** from the logical tail (`CLAUDE_MAX_HISTORY`). Auto-compaction folds older dialogue into the rolling summary when a heuristic input estimate crosses configured thresholds (ADR 0017).
- `GET /api/chat/{session_id}/messages` returns the same projection inputs as metadata: `context_pressure` (`level`, `estimated_input_tokens`, `input_budget`) for buyer-chat UX (warn vs critical vs ok).
- Claude `max_tokens` per response: **4096** (configurable via `CLAUDE_MAX_TOKENS`).

### Simulation Scenarios

Dealer training scenarios are currently hardcoded (4 scenarios). Each defines:

- An AI persona with name, budget, personality, target vehicle, and specific challenges.
- A difficulty level: `easy`, `medium`, or `hard`.

---

## 7. Data Model

### Entity Relationship Diagram

```mermaid
erDiagram
    users ||--o{ chat_sessions : "has many"
    chat_sessions ||--o{ messages : "has many"
    chat_sessions ||--o| deal_states : "has one"
    chat_sessions ||--o{ vehicles : "has many"
    chat_sessions ||--o{ deals : "has many"
    chat_sessions ||--o| simulations : "has one"
    vehicles ||--o{ deals : "linked via"
    deal_states ||--o| deals : "active deal"

    users {
        string id PK
        string email UK "indexed"
        string hashed_password
        string role "buyer | dealer"
        string display_name
        datetime created_at
    }

    chat_sessions {
        string id PK
        string user_id FK
        string title
        boolean auto_title "true if not manually renamed"
        string last_message_preview
        string session_type "buyer_chat | dealer_sim"
        json linked_session_ids
        json usage "cumulative session usage ledger"
        json compaction_state "rolling summary + tail pointer; nullable"
        datetime created_at
        datetime updated_at
    }

    messages {
        string id PK
        string session_id FK
        string role "user | assistant | system"
        text content
        string image_url
        json tool_calls
        json usage
        datetime created_at
    }

    vehicles {
        string id PK
        string session_id FK
        string role "primary | trade_in"
        int year
        string make
        string model
        string trim
        string vin
        int mileage
        string color
        string engine
        datetime created_at
        datetime updated_at
    }

    deals {
        string id PK
        string session_id FK
        string vehicle_id FK
        string dealer_name
        string phase "research...closing"
        float msrp
        float invoice_price
        float listing_price
        float your_target
        float walk_away_price
        float current_offer
        float monthly_payment
        float apr
        int loan_term_months
        float down_payment
        float trade_in_value
        string score_price
        string score_financing
        string score_trade_in
        string score_fees
        string score_overall
        string health_status "good | fair | concerning | bad"
        string health_summary
        string recommendation
        json red_flags "array of {id, severity, message}"
        json information_gaps "array of {label, reason, priority}"
        float first_offer
        float pre_fi_price
        float savings_estimate
        json comparison "AI-generated deal comparison"
        datetime created_at
        datetime updated_at
    }

    deal_states {
        string id PK
        string session_id FK "unique"
        string buyer_context "researching | reviewing_deal | at_dealership"
        string active_deal_id FK "which deal the panel shows"
        json red_flags "session-level flags"
        json information_gaps "session-level gaps"
        json checklist
        datetime timer_started_at
        json ai_panel_cards "AI-generated card objects"
        json negotiation_context "stance, situation, key numbers, scripts, pending actions, leverage"
        json deal_comparison "AI-generated, spans deals"
        datetime updated_at
    }

    simulations {
        string id PK
        string session_id FK "unique"
        string scenario_type
        string difficulty
        json ai_persona
        int score
        text feedback
        datetime completed_at
        datetime created_at
    }
```

### Table Definitions

#### `users`


| Column            | Type     | Constraints                 | Notes               |
| ----------------- | -------- | --------------------------- | ------------------- |
| `id`              | String   | PK, default UUID            |                     |
| `email`           | String   | Unique, Not Null, Indexed   |                     |
| `hashed_password` | String   | Not Null                    | bcrypt hash         |
| `role`            | String   | Not Null, default `"buyer"` | `buyer` or `dealer` |
| `display_name`    | String   | Nullable                    |                     |
| `created_at`      | DateTime | default now(UTC)            |                     |


#### `chat_sessions`


| Column                 | Type     | Constraints                       | Notes                        |
| ---------------------- | -------- | --------------------------------- | ---------------------------- |
| `id`                   | String   | PK, default UUID                  |                              |
| `user_id`              | String   | FK -> users.id, Not Null, Indexed |                              |
| `title`                | String   | Not Null, default "New Deal"      |                              |
| `auto_title`           | Boolean  | Not Null, default `true`          | False when user manually renames |
| `last_message_preview` | String   | Not Null, default `""`            | Truncated last assistant message (max 120 chars) |
| `session_type`         | String   | Not Null, default "buyer_chat"    | `buyer_chat` or `dealer_sim` |
| `linked_session_ids`   | JSON     | default empty list                | Array of session UUIDs       |
| `usage`                | JSON     | Nullable                          | Cumulative per-session usage ledger with per-model totals and USD cost |
| `compaction_state`     | JSON     | Nullable                          | Rolling summary, first kept message id, version, failure counters (context compaction); see ADR 0017 |
| `created_at`           | DateTime | default now(UTC)                  |                              |
| `updated_at`           | DateTime | default now(UTC), on update       |                              |


#### `messages`


| Column       | Type     | Constraints                               | Notes                            |
| ------------ | -------- | ----------------------------------------- | -------------------------------- |
| `id`         | String   | PK, default UUID                          |                                  |
| `session_id` | String   | FK -> chat_sessions.id, Not Null, Indexed |                                  |
| `role`       | String   | Not Null                                  | `user`, `assistant`, or `system` (system = e.g. compaction notices) |
| `content`    | Text     | Not Null                                  |                                  |
| `image_url`  | String   | Nullable                                  | URL for image analysis           |
| `tool_calls` | JSON     | Nullable                                  | Array of {name, args} objects    |
| `usage`      | JSON     | Nullable                                  | Aggregated token usage for assistant messages |
| `created_at` | DateTime | default now(UTC)                          |                                  |


#### `vehicles`


| Column    | Type     | Constraints                               | Notes                    |
| --------- | -------- | ----------------------------------------- | ------------------------ |
| `id`      | String   | PK, default UUID                          |                          |
| `session_id` | String | FK -> chat_sessions.id, Not Null, Indexed |                          |
| `role`    | String   | Not Null, default "primary"               | `primary` or `trade_in`  |
| `year`    | Integer  | Nullable                                  |                          |
| `make`    | String   | Nullable                                  |                          |
| `model`   | String   | Nullable                                  |                          |
| `trim`    | String   | Nullable                                  |                          |
| `vin`     | String   | Nullable                                  |                          |
| `mileage` | Integer  | Nullable                                  |                          |
| `color`   | String   | Nullable                                  |                          |
| `engine`  | String   | Nullable                                  |                          |
| `created_at` | DateTime | default now(UTC)                        |                          |
| `updated_at` | DateTime | default now(UTC), on update             |                          |


#### `deals`


| Column             | Type     | Constraints                               | Notes                       |
| ------------------ | -------- | ----------------------------------------- | --------------------------- |
| `id`               | String   | PK, default UUID                          |                             |
| `session_id`       | String   | FK -> chat_sessions.id, Not Null, Indexed |                             |
| `vehicle_id`       | String   | FK -> vehicles.id, Not Null, Indexed      |                             |
| `dealer_name`      | String   | Nullable                                  | Dealer identification       |
| `phase`            | String   | Not Null, default "research"              | See deal phases             |
| `msrp`             | Float    | Nullable                                  |                             |
| `invoice_price`    | Float    | Nullable                                  |                             |
| `listing_price`    | Float    | Nullable                                  |                             |
| `your_target`      | Float    | Nullable                                  |                             |
| `walk_away_price`  | Float    | Nullable                                  |                             |
| `current_offer`    | Float    | Nullable                                  |                             |
| `monthly_payment`  | Float    | Nullable                                  |                             |
| `apr`              | Float    | Nullable                                  |                             |
| `loan_term_months` | Integer  | Nullable                                  |                             |
| `down_payment`     | Float    | Nullable                                  |                             |
| `trade_in_value`   | Float    | Nullable                                  |                             |
| `score_price`      | String   | Nullable                                  | `red`, `yellow`, or `green` |
| `score_financing`  | String   | Nullable                                  | `red`, `yellow`, or `green` |
| `score_trade_in`   | String   | Nullable                                  | `red`, `yellow`, or `green` |
| `score_fees`       | String   | Nullable                                  | `red`, `yellow`, or `green` |
| `score_overall`    | String   | Nullable                                  | `red`, `yellow`, or `green` |
| `health_status`    | String   | Nullable                                  | `good`, `fair`, `concerning`, `bad` |
| `health_summary`   | String   | Nullable                                  | 1-2 sentence explanation    |
| `recommendation`   | String   | Nullable                                  | AI-generated next-action recommendation |
| `red_flags`        | JSON     | default empty list                        | Array of {id, severity, message} |
| `information_gaps` | JSON     | default empty list                        | Array of {label, reason, priority} |
| `first_offer`      | Float    | Nullable                                  | Snapshot of first current_offer |
| `pre_fi_price`     | Float    | Nullable                                  | Price before F&I stage      |
| `savings_estimate` | Float    | Nullable                                  | Estimated buyer savings     |
| `comparison`       | JSON     | Nullable                                  | AI-generated deal comparison data |
| `created_at`       | DateTime | default now(UTC)                          |                             |
| `updated_at`       | DateTime | default now(UTC), on update               |                             |


#### `deal_states`


| Column             | Type     | Constraints                             | Notes                       |
| ------------------ | -------- | --------------------------------------- | --------------------------- |
| `id`               | String   | PK, default UUID                        |                             |
| `session_id`       | String   | FK -> chat_sessions.id, Unique, Indexed | One deal state per session  |
| `buyer_context`    | String   | Not Null, default "researching"         | `researching`, `reviewing_deal`, or `at_dealership` |
| `active_deal_id`   | String   | FK -> deals.id, Nullable                | Which deal the panel is currently showing |
| `red_flags`        | JSON     | default empty list                      | Session-level flags (e.g., "Not pre-approved") |
| `information_gaps` | JSON     | default empty list                      | Session-level gaps          |
| `checklist`        | JSON     | default empty list                      | Array of {label, done}      |
| `timer_started_at` | DateTime | Nullable                                | Negotiation timer           |
| `ai_panel_cards`   | JSON     | default empty list                      | AI-generated card objects for InsightsPanel |
| `negotiation_context` | JSON  | Nullable                                | AI-maintained situational awareness (stance, situation, key numbers, scripts, pending actions, leverage) |
| `deal_comparison`  | JSON     | Nullable                                | AI-generated comparison spanning deals |
| `updated_at`       | DateTime | default now(UTC), on update             |                             |


#### `simulations`


| Column          | Type     | Constraints                             | Notes                                            |
| --------------- | -------- | --------------------------------------- | ------------------------------------------------ |
| `id`            | String   | PK, default UUID                        |                                                  |
| `session_id`    | String   | FK -> chat_sessions.id, Unique, Indexed | One simulation per session                       |
| `scenario_type` | String   | Not Null                                |                                                  |
| `difficulty`    | String   | Not Null, default "medium"              | `easy`, `medium`, or `hard`                      |
| `ai_persona`    | JSON     | Not Null                                | {name, budget, personality, vehicle, challenges} |
| `score`         | Float    | Nullable                                | Performance score after completion               |
| `feedback`      | Text     | Nullable                                | AI-generated feedback                            |
| `completed_at`  | DateTime | Nullable                                |                                                  |
| `created_at`    | DateTime | default now(UTC)                        |                                                  |


### Key Relationships

- **User -> ChatSession**: One-to-many. A user owns many sessions.
- **ChatSession -> Message**: One-to-many. A session contains an ordered sequence of messages. **Cascade delete**: messages are deleted when the session is deleted.
- **ChatSession -> DealState**: One-to-one. Each session has exactly one deal state (created when the session is created). **Cascade delete**: deal state is deleted when the session is deleted.
- **ChatSession -> Vehicle**: One-to-many. A session can have multiple vehicles (primary + trade-in). **Cascade delete**: vehicles are deleted when the session is deleted.
- **ChatSession -> Deal**: One-to-many. A session can have multiple deals (e.g., same vehicle at two dealers). **Cascade delete**: deals are deleted when the session is deleted.
- **Vehicle -> Deal**: One-to-many. Each deal is linked to a specific vehicle.
- **DealState -> Deal**: Many-to-one optional. `active_deal_id` points to the deal currently shown in the panel.
- **ChatSession -> Simulation**: One-to-one. A dealer_sim session has one simulation record. **Cascade delete**: simulation is deleted when the session is deleted.

### ID Strategy

All primary keys are UUIDv4 strings, generated at the application layer via `uuid.uuid4()`.

---

## 8. External Integrations

### Anthropic Claude API


| Parameter      | Value                  |
| -------------- | ---------------------- |
| Primary model  | `claude-sonnet-4-6` (`CLAUDE_MODEL`)    |
| Fast model     | `claude-haiku-4-5-20251001` (`CLAUDE_FAST_MODEL`) — quick action generation and session title generation (not used for context compaction summarization) |
| Max tokens     | 4096 (configurable via `CLAUDE_MAX_TOKENS`)    |
| Tool use       | 10 tool definitions (primary model only)   |
| Streaming      | Yes (messages.stream)  |
| Image input    | Supported (URL-based)  |
| Client library | `anthropic` Python SDK |


The primary integration uses the Anthropic async client for both streaming and non-streaming calls. Text deltas and tool call results are relayed to the frontend as SSE events in real time. **Context compaction** (when enabled) uses the same primary model (`CLAUDE_MODEL`) for summarization, separate from the chat step loop, and may precede chat streaming in the same SSE response (ADR 0017). The backend uses a bounded multi-step loop: when a step finishes with tool calls, those results are appended back into the transcript and Claude is called again until the turn reaches a text completion or the retry or step budget is exhausted. If a step is truncated at `max_tokens`, the backend retries with an escalated bounded token budget. After the step loop completes, `done` is emitted immediately for chat-first responsiveness, then AI panel generation runs asynchronously in the same SSE stream via `panel_started` / `panel_card` / `panel_done` / `panel_error`. Session title generation uses Haiku. Session-bound re-analysis via `analyze_deal()` uses Sonnet. Persisted assistant usage aggregates chat and panel phases. Prompt cache break detection (`prompt_cache_signature.py`) fingerprints system prompt, tools, and model via SHA-256 and logs INFO-level cache breaks across turns; break counts and last-known fingerprints are persisted on `SessionUsageSummary`.

### No Other External Integrations (v1)

The first version has no integrations with vehicle pricing APIs, CARFAX, credit bureaus, or payment processors. All deal analysis is performed by Claude based on user-provided information.

---

## 9. Application Lifecycle

### Backend Startup (Lifespan Handler)

The FastAPI application uses an `asynccontextmanager` lifespan handler (not the deprecated `on_event("startup")` pattern) to perform startup tasks:

1. **Create database tables** -- `Base.metadata.create_all()` ensures all tables exist (no-op if they already exist).
2. **Seed development users** -- When `ENV=development` (the default), two test users are created:

| Email | Password | Role |
|-------|----------|------|
| `buyer@test.com` | `password` | buyer |
| `dealer@test.com` | `password` | dealer |

Seeding is idempotent (skips existing users) and only runs in development mode.

### Frontend Auth Guards and Role Guards

The `AuthGuard` component (`components/shared/AuthGuard.tsx`) wraps the unified `(app)` route group layout. It checks for an authenticated user in the auth store and redirects to the login screen if no valid session exists. This ensures all app routes (except auth screens) require authentication.

The `RoleGuard` component (`components/shared/RoleGuard.tsx`) is used within individual screens to enforce role-based access. If the user's role does not match the required role, `RoleGuard` redirects to the appropriate default screen for their actual role (e.g., a buyer trying to access simulations is redirected to chat). This replaces the previous architecture of separate `(buyer)` and `(dealer)` route groups.

The login screen displays quick sign-in buttons for the seed user accounts when running in development mode (`__DEV__`).

The registration screen asks "Are you buying or selling?" and presents "Buying" and "Selling" buttons for role selection.

### Backend Enums

All domain string values are defined as Python `StrEnum` types in `app/models/enums.py` for type safety and consistency:

| Enum | Values |
|------|--------|
| `UserRole` | `buyer`, `dealer` |
| `SessionType` | `buyer_chat`, `dealer_sim` |
| `MessageRole` | `user`, `assistant`, `system` |
| `DealPhase` | `research`, `initial_contact`, `test_drive`, `negotiation`, `financing`, `closing` |
| `ScoreStatus` | `red`, `yellow`, `green` |
| `BuyerContext` | `researching`, `reviewing_deal`, `at_dealership` |
| `HealthStatus` | `good`, `fair`, `concerning`, `bad` |
| `RedFlagSeverity` | `warning`, `critical` |
| `GapPriority` | `high`, `medium`, `low` |
| `VehicleRole` | `primary`, `candidate`, `trade_in` |
| `Difficulty` | `easy`, `medium`, `hard` |
| `NegotiationStance` | `researching`, `preparing`, `engaging`, `negotiating`, `holding`, `walking`, `waiting`, `financing`, `closing`, `post_purchase` |
| `AiCardKind` (panel-facing subset) | `phase`, `briefing`, `numbers`, `vehicle`, `warning`, `tip`, `checklist`, `success`, `notes` (note: `comparison` / `trade_off` are defined in the enum but no longer emitted to the panel — they render as markdown tables in chat per ADR 0018) |
| `AiCardPriority` | `critical`, `high`, `normal`, `low` |

### Frontend Patterns

- **snake_case to camelCase mapping**: The `snakeToCamel` utility (`lib/utils.ts`) converts backend snake_case keys to frontend camelCase, replacing hand-mapped field assignments in the deal store.
- **Markdown rendering**: Assistant chat bubbles render content as Markdown via `react-native-markdown-display`, supporting bold, italic, lists, code blocks, blockquotes, and links. User messages render as plain text.
- **Optimistic message rollback**: When sending a chat message, the user message is added to the store optimistically. If the backend request fails, the message is removed from the store.
- **Duplicate user message prevention**: Message history is loaded before the new user turn is persisted; optional compaction may persist a system notice first, then the user message is saved so the current turn is not duplicated in the constructed Claude context.
- **Event-based SSE parsing**: The `useChat` hook parses SSE streams, dispatching `compaction_*`, `text`, `tool_result`, `retry`, `step`, `done`, and panel lifecycle events to store handlers. Message list fetches receive `context_pressure` alongside `messages` for UI context warnings.
- **Error handling in stores and auth screens**: All Zustand stores and auth screens include try/catch error handling with user-facing error state.
- **Chats list as buyer home screen**: The `/(app)/chats` screen is the buyer's landing page, showing sessions in Active/Past sections with search, pull-to-refresh, and SessionCard components displaying phase dot, message preview, and deal summary line.
- **Auto-generated session titles**: Sessions receive automatic titles — deterministic vehicle titles when a vehicle is set, LLM-generated via Haiku as a fallback. Manual renames via PATCH set `auto_title=false`, preventing further auto-updates.
- **Animated icon transitions**: The `useIconEntrance` hook provides animated entrance effects for navigation icons (e.g., settings gear, back button) when transitioning between screens.

---

## 10. Scheduled Jobs

There are no scheduled jobs, cron tasks, or background workers in the current version. All processing is synchronous and request-driven:

- Chat responses stream in real time during the HTTP request lifecycle.
- Deal state updates are applied inline after the Claude stream completes.
- Database writes happen within the request transaction.

Future versions may introduce background jobs for tasks such as session summarization, usage analytics, or simulation scoring pipelines.

---

## Port Reference


| Service    | Port | Notes                           |
| ---------- | ---- | ------------------------------- |
| Frontend   | 8081 | Expo dev server (web)           |
| Backend    | 8001 | FastAPI with uvicorn            |
| PostgreSQL | 5433 | Mapped from container port 5432 |


