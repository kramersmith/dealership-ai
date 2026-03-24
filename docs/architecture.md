# Dealership AI MVP — Technical Architecture Plan

## Context
Greenfield build of a unified AI-powered smartphone app for the car buying experience, serving both buyers and dealers within a single app with role-based access. Solo developer, tight budget, targeting iOS/Android/web. Stack: React Native (Expo) → FastAPI → Claude API (claude-sonnet-4-6) → PostgreSQL.

The key architectural challenge: the persistent UI (dashboard, scorecard, checklist, vehicle card) must update automatically from the LLM conversation. When a user says "they're offering $34k", the numbers dashboard updates live.

**Solution: Claude's tool_use feature.** Claude returns structured tool calls (e.g. `update_deal_numbers({ their_offer: 34000 })`) alongside conversational text. The backend executes the tool calls (updates DB), streams both text and tool results to the client via SSE, and the frontend updates the Zustand store → dashboard re-renders.

---

## Monorepo Structure

```
dealership-ai/
├── Makefile                     # Unified dev commands
├── docker-compose.yml           # Frontend + backend + PostgreSQL
├── CLAUDE.md                    # AI assistant guidance
├── apps/
│   ├── mobile/                  # Expo app (iOS + Android + Web)
│   │   ├── app/                 # Expo Router file-based routing
│   │   │   ├── (app)/           # Unified route group (AuthGuard protected)
│   │   │   │   ├── _layout.tsx  # AuthGuard wrapper for all app routes
│   │   │   │   ├── chat.tsx     # Main chat screen (buyer, RoleGuard)
│   │   │   │   ├── sessions.tsx # Session list (buyer, RoleGuard)
│   │   │   │   ├── simulations.tsx # Scenario list (dealer, RoleGuard)
│   │   │   │   ├── sim/[id].tsx # Simulation chat (dealer, RoleGuard)
│   │   │   │   └── settings.tsx # Shared settings
│   │   │   ├── (auth)/
│   │   │   │   ├── login.tsx    # Login with quick sign-in buttons (__DEV__ only)
│   │   │   │   └── register.tsx # Registration with "Buying"/"Selling" role selection
│   │   │   └── _layout.tsx      # Root layout
│   │   ├── components/
│   │   │   ├── chat/            # ChatBubble, ChatInput, VoiceButton, WelcomePrompts
│   │   │   ├── dashboard/       # DealPhase, NumbersDash, Checklist,
│   │   │   │                    # VehicleCard, Scorecard, Timer
│   │   │   └── shared/          # Button, Card, Modal, AuthGuard, RoleGuard
│   │   ├── hooks/
│   │   │   ├── useChat.ts       # SSE streaming + state (event-based parsing)
│   │   │   └── useScreenWidth.ts # Responsive breakpoint hook
│   │   ├── stores/              # Zustand: auth, chat, deal, simulation, theme
│   │   └── lib/
│   │       ├── apiClient.ts     # HTTP client for FastAPI backend
│   │       ├── colors.ts        # Centralized color palette
│   │       ├── constants.ts     # Buyer context defaults, widget ordering, deal phases
│   │       └── types.ts
│   │
│   └── backend/                 # FastAPI backend
│       ├── app/
│       │   ├── main.py          # FastAPI app with lifespan handler
│       │   ├── core/            # Config, security (JWT + bcrypt), deps
│       │   ├── db/              # Session, base, seed users
│       │   ├── models/          # SQLAlchemy ORM + enums (StrEnum)
│       │   ├── schemas/         # Pydantic request/response
│       │   ├── routes/          # auth, chat, sessions, deals, simulations
│       │   └── services/
│       │       ├── claude.py    # Claude API + tool definitions + SSE streaming
│       │       └── simulation.py # Dealer training AI logic
│       ├── alembic/             # DB migrations
│       └── tests/               # Including test_seed.py, test_sessions.py
│
├── docs/                        # All documentation
└── .claude/skills/              # Claude Code skills (pre-commit, update-docs)
```

---

## Database Schema (SQLite dev / PostgreSQL prod)

**users** — (id, email, hashed_password, role [UserRole enum: buyer/dealer], display_name, created_at)

**chat_sessions** — (id, user_id, title, session_type [SessionType enum: buyer_chat/dealer_sim], linked_session_ids JSON, timestamps). Cascade deletes: deleting a session removes its messages, deal_state, and simulation.

**messages** — (id, session_id, role [MessageRole enum: user/assistant/system], content, image_url, tool_calls JSON, created_at)

**deal_states** — one mutable row per session, the persistent UI state:
- Buyer context: BuyerContext enum (researching, reviewing_deal, at_dealership) — set at session creation, updatable mid-conversation
- Phase: DealPhase enum (research → initial_contact → test_drive → negotiation → financing → closing)
- Numbers: msrp, invoice_price, their_offer, your_target, walk_away_price, current_offer, monthly_payment, apr, loan_term_months, down_payment, trade_in_value
- Vehicle: year, make, model, trim, vin, mileage, color
- Scorecard: score_price, score_financing, score_trade_in, score_fees, score_overall (ScoreStatus enum: red/yellow/green)
- Checklist: JSON array of {label, done}
- Timer: timer_started_at

**simulations** — (id, session_id, scenario_type, difficulty [Difficulty enum: easy/medium/hard], ai_persona JSON, score, feedback, completed_at)

### Backend Enums (`app/models/enums.py`)

All domain values use Python `StrEnum` for type safety:

| Enum | Values |
|------|--------|
| `UserRole` | `buyer`, `dealer` |
| `SessionType` | `buyer_chat`, `dealer_sim` |
| `MessageRole` | `user`, `assistant`, `system` |
| `DealPhase` | `research`, `initial_contact`, `test_drive`, `negotiation`, `financing`, `closing` |
| `ScoreStatus` | `red`, `yellow`, `green` |
| `BuyerContext` | `researching`, `reviewing_deal`, `at_dealership` |
| `Difficulty` | `easy`, `medium`, `hard` |

### Seed Users (Development Only)

On startup (via lifespan handler), when `ENV=development`, the backend seeds two test users:

| Email | Password | Role |
|-------|----------|------|
| `buyer@test.com` | `password` | buyer |
| `dealer@test.com` | `password` | dealer |

These are used with the quick sign-in buttons on the login screen (visible only in `__DEV__` mode).

---

## FastAPI Routes

```
POST   /chat/{session_id}/message    # Send message → SSE stream (text + tool_result events)
POST   /chat/{session_id}/photo      # Upload deal sheet → Claude vision analysis
GET    /chat/{session_id}/messages    # Message history

GET    /sessions                      # List sessions
POST   /sessions                      # Create session
GET    /sessions/{id}                 # Get session + deal_state
PATCH  /sessions/{id}                 # Update title, link sessions
DELETE /sessions/{id}                 # Delete

GET    /deal/{session_id}             # Get current deal state

GET    /simulations/scenarios         # List scenario templates
POST   /simulations                   # Start simulation
POST   /simulations/{id}/message      # Chat in simulation (SSE)
POST   /simulations/{id}/complete     # End + score
```

---

## Core Architecture: Claude Tool Use → Dashboard Updates

**6 tools registered with every Claude call:**
1. `update_deal_numbers` — prices, payments, rates (all fields optional, only update what changed)
2. `update_deal_phase` — progression through deal phases
3. `update_scorecard` — red/yellow/green ratings
4. `set_vehicle` — year, make, model, trim, vin, mileage
5. `update_checklist` — array of {label, done} items
6. `update_buyer_context` — change the buyer's situational context mid-conversation (researching, reviewing_deal, at_dealership)

**Streaming flow:**
1. Client POSTs message
2. Backend loads history + linked session context, calls Claude with tools (system prompt includes a context-aware preamble based on the session's `buyer_context`)
3. Claude streams text + tool_use blocks
4. Backend streams SSE events: `event: text` (chat chunks) + `event: tool_result` (structured data)
5. Backend persists messages and executes tool calls (UPDATE deal_states)
6. Frontend `useChat` hook uses event-based SSE parsing to dispatch tool results to Zustand store → dashboard components re-render
7. On send failure, optimistic messages are rolled back from the chat store

**New session flow (buyer):**
1. Chat screen shows WelcomePrompts — three situation cards: "Researching", "Have a deal to review", "At the dealership"
2. User taps a card (or skips by typing/uploading directly, which defaults to `researching`)
3. Frontend calls `POST /api/sessions` with the selected `buyer_context`
4. A hardcoded greeting message (per context) is injected client-side — no LLM call needed
5. Quick actions, dashboard panel ordering, and system prompt preamble all adapt to the selected context

**Photo analysis:** Client uploads image → sends URL to backend → Claude vision extracts all numbers/details → calls multiple tools → dashboard populates in one shot.

**Dealer simulations:** Same chat infrastructure, different system prompt (Claude plays a customer persona with hidden budget/goals). Uses a `score_salesperson` tool at completion.

---

## Key Decisions

- **SSE over WebSockets** — simpler, maps directly to Claude's streaming API, no connection upgrade issues on Railway/Fly
- **Zustand over Redux** — minimal boilerplate, perfect for this scope
- **Single mutable deal_states row over event log** — simpler reads for MVP, can add history table later
- **Claude Sonnet 4.6** (`claude-sonnet-4-6`) — balances cost and quality for MVP, with max_tokens: 1024 and history truncated to last 20 messages
- **Cost control** — track token usage per user, enforce daily limits

---

## Implementation Order

| Phase | What | Days |
|-------|------|------|
| 0 | Project scaffolding (Expo, FastAPI, PostgreSQL, env) | 1 |
| 1 | Auth + session CRUD | 2-3 |
| 2 | **Core chat loop** — text chat, Claude with tools, SSE streaming, NumbersDashboard + DealPhaseIndicator updating live | 4-7 |
| 3 | Remaining dashboard UI — scorecard, vehicle card, checklist, timer, quick actions, session linking | 8-10 |
| 4 | Photo upload (Claude vision) + voice input (expo-speech-recognition) | 11-13 |
| 5 | Dealer training simulations | 14-16 |
| 6 | Polish + deploy (error handling, rate limiting, Railway, EAS builds, Vercel) | 17-20 |

**Phase 2 is the milestone:** text "They offered $34k for a 2024 Camry" and watch the dashboard update live.

---

## Verification

- **Phase 0:** Expo app loads on simulator, FastAPI returns 200, database connection succeeds
- **Phase 2:** Send a chat message → see streamed response + dashboard numbers update. This is the core proof of concept.
- **Phase 4:** Take a photo of a deal sheet → see vehicle card, numbers, scorecard, and checklist all populate
- **Phase 5:** Start a dealer simulation → have a back-and-forth with AI customer → get scored
- **Phase 6:** App runs on physical iOS/Android device via TestFlight/internal testing, web version accessible via URL
