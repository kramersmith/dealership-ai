# Dealership AI MVP — Technical Architecture Plan

## Context
Greenfield build of a unified AI-powered smartphone app for the car buying experience, serving both buyers and dealers within a single app with role-based access. Solo developer, tight budget, targeting iOS/Android/web. Stack: React Native (Expo) → FastAPI → Claude API (claude-sonnet-4-6) → PostgreSQL.

The key architectural challenge: the persistent UI (dashboard, scorecard, checklist, vehicle card) must update automatically from the LLM conversation. When a user says "they're offering $34k", the numbers dashboard updates live.

**Solution: Claude's tool_use feature.** Claude returns structured tool calls (e.g. `update_deal_numbers({ listing_price: 34000 })`) alongside conversational text. The backend executes the tool calls (updates DB), streams both text and tool results to the client via SSE, and the frontend updates the Zustand store → dashboard re-renders.

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
│   │   │   │   ├── chats.tsx   # Chats list / buyer home (buyer, RoleGuard)
│   │   │   │   ├── simulations.tsx # Scenario list (dealer, RoleGuard)
│   │   │   │   ├── sim/[id].tsx # Simulation chat (dealer, RoleGuard)
│   │   │   │   └── settings.tsx # Shared settings
│   │   │   ├── (auth)/
│   │   │   │   ├── login.tsx    # Login with quick sign-in buttons (__DEV__ only)
│   │   │   │   └── register.tsx # Registration with "Buying"/"Selling" role selection
│   │   │   └── _layout.tsx      # Root layout
│   │   ├── components/
│   │   │   ├── chat/            # ChatBubble (markdown rendering, QuotedCardPreview), ChatInput, VoiceButton, ContextPicker, CopyableBlock
│   │   │   ├── chats/           # SessionCard (phase dot, preview, deal summary)
│   │   │   ├── insights-panel/   # AI-driven InsightsPanel with card-based layout:
│   │   │   │                    # AiCard (base renderer + reply button), CardReplyInput,
│   │   │   │                    # CardTitle (shared label component), SituationBar
│   │   │   │                    # (negotiation context), BriefingCard, NumbersCard,
│   │   │   │                    # AiVehicleCard (RN primitives), WarningCard, TipCard,
│   │   │   │                    # SuccessCard, AiChecklistCard (read-only + progress bar),
│   │   │   │                    # AiComparisonCard, CompactPhaseIndicator,
│   │   │   │                    # PanelMarkdown, QuickActions
│   │   │   └── shared/          # Button, Card, Modal, AuthGuard, RoleGuard
│   │   ├── hooks/
│   │   │   ├── useChat.ts       # SSE streaming + state (event-based parsing)
│   │   │   ├── useEditableField.ts # Inline editing with debounced backend sync
│   │   │   ├── useAnimatedValue.ts # useIconEntrance (animated icon transitions)
│   │   │   └── useScreenWidth.ts # Responsive breakpoint hook
│   │   ├── stores/              # Zustand: auth, chat, deal, simulation, theme
│   │   └── lib/
│   │       ├── apiClient.ts     # HTTP client for FastAPI backend
│   │       ├── theme/
│   │       │   ├── tokens.ts    # Centralized color palette + token colors
│   │       │   └── themes.ts    # Dark/light themes + semantic sub-themes (danger, warning, success)
│   │       ├── constants.ts     # APP_NAME, WEB_FONT_FAMILY, buyer context defaults, deal phases, fallback quick actions, APR thresholds, TIMER_TIPS, SCORE_DESCRIPTIONS, MAX_INSIGHTS_PREVIEW_ITEMS, animation/layout constants
│   │       ├── dealComputations.ts # Derived deal metrics (savings, computeOfferDelta, getNextActionRecommendation)
│       ├── platform.ts      # Platform-specific constants (USE_NATIVE_DRIVER)
│   │       ├── utils.ts         # snakeToCamel, formatCurrency, formatPercent, etc.
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
│       │       ├── claude.py    # Claude API + two-pass extraction (factual extractor + analyst + situation assessor subagents) + SSE streaming
│       │       ├── deal_state.py # Deal state business logic (apply_extraction, deal_state_to_dict, build_deal_assessment_dict)
│       │       ├── post_chat_processing.py  # Preview + title updates after chat
│       │       ├── title_generator.py       # Deterministic vehicle titles + LLM fallback
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

**chat_sessions** — (id, user_id, title, auto_title, last_message_preview, session_type [SessionType enum: buyer_chat/dealer_sim], linked_session_ids JSON, timestamps). Cascade deletes: deleting a session removes its messages, deal_state, and simulation.

**messages** — (id, session_id, role [MessageRole enum: user/assistant/system], content, image_url, tool_calls JSON, created_at)

**vehicles** — (id, session_id, role [VehicleRole enum: primary/trade_in], year, make, model, trim, vin, mileage, color, engine, timestamps). Multiple vehicles per session, with role distinguishing primary vehicle from trade-in.

**deals** — one row per vehicle-deal combination within a session:
- Foreign keys: session_id, vehicle_id
- Dealer identification: dealer_name
- Phase: DealPhase enum (research → initial_contact → test_drive → negotiation → financing → closing)
- Numbers: msrp, invoice_price, listing_price, your_target, walk_away_price, current_offer, monthly_payment, apr, loan_term_months, down_payment, trade_in_value
- Price history: first_offer, pre_fi_price, savings_estimate
- Scorecard: score_price, score_financing, score_trade_in, score_fees, score_overall (ScoreStatus enum: red/yellow/green)
- Deal health: health_status (HealthStatus enum: good/fair/concerning/bad), health_summary, recommendation
- Red flags: JSON array of {id, severity, message} (RedFlagSeverity enum: warning/critical)
- Information gaps: JSON array of {label, reason, priority} (GapPriority enum: high/medium/low)
- Comparison: JSON (AI-generated deal comparison data)

**deal_states** — one mutable row per session, session-level state:
- Buyer context: BuyerContext enum (researching, reviewing_deal, at_dealership) — set at session creation, updatable mid-conversation
- Active deal: active_deal_id (FK to deals.id) — which deal the panel is currently showing
- Red flags: JSON array (session-level, e.g., "You haven't been pre-approved")
- Information gaps: JSON array (session-level)
- Checklist: JSON array of {label, done}
- Timer: timer_started_at
- AI panel cards: JSON array of AI-generated card objects for the InsightsPanel
- Deal comparison: JSON (AI-generated, session-level since it spans deals)
- Negotiation context: JSON (AI-maintained situational awareness — stance, situation summary, key numbers, scripts, pending actions, leverage)

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
| `HealthStatus` | `good`, `fair`, `concerning`, `bad` |
| `RedFlagSeverity` | `warning`, `critical` |
| `GapPriority` | `high`, `medium`, `low` |
| `VehicleRole` | `primary`, `trade_in` |
| `Difficulty` | `easy`, `medium`, `hard` |
| `NegotiationStance` | `researching`, `preparing`, `engaging`, `negotiating`, `holding`, `walking`, `waiting`, `financing`, `closing`, `post_purchase` |
| `AiCardType` | `briefing`, `numbers`, `vehicle`, `warning`, `tip`, `checklist`, `success`, `comparison` |
| `AiCardPriority` | `critical`, `high`, `normal`, `low` |

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

GET    /sessions                      # List sessions (optional ?q= search)
POST   /sessions                      # Create session
GET    /sessions/{id}                 # Get session + deal_state
PATCH  /sessions/{id}                 # Update title, link sessions
DELETE /sessions/{id}                 # Delete

GET    /deal/{session_id}             # Get current deal state
PATCH  /deal/{session_id}             # User corrections → re-assessment

GET    /simulations/scenarios         # List scenario templates
POST   /simulations                   # Start simulation
POST   /simulations/{id}/message      # Chat in simulation (SSE)
POST   /simulations/{id}/complete     # End + score
```

---

## Core Architecture: Two-Pass Extraction → AI Panel Cards

**Extraction architecture:** The backend uses a two-pass extraction approach with parallel subagents:
1. **Factual extractor** — extracts structured data (vehicle, deal numbers, scorecard, phase, buyer context, checklist, quick actions) from conversation
2. **Analyst subagent** — runs in parallel to generate deal health assessment, red flags, information gaps, and AI panel cards
3. **Situation assessor** — runs in parallel to maintain the buyer's negotiation context (stance, situation summary, key numbers, scripts, pending actions, leverage). Only updates when the situation meaningfully changes. Uses `auto` tool choice so it can skip updates for tangential exchanges.
4. Results are merged and applied to the database via `apply_extraction()` in `deal_state.py`. Negotiation context is applied separately and emitted as an `update_negotiation_context` tool_result SSE event.

**Deal state service** (`app/services/deal_state.py`):
- `apply_extraction()` — applies extracted data to Vehicle, Deal, and DealState models; auto-creates deals for new primary vehicles; returns tool calls for frontend
- `deal_state_to_dict()` — serializes deal state (with vehicles and deals) for the Claude system prompt
- `build_deal_assessment_dict()` — builds a dict from a Deal + its vehicles for Haiku re-assessment

**Streaming flow:**
1. Client POSTs message
2. Backend loads message history BEFORE saving the user message (avoids duplicate user messages in Claude context), then saves the user message
3. Backend loads deal state + linked session context, calls Claude with tools (system prompt includes a context-aware preamble based on the session's `buyer_context`)
4. Claude streams text + tool_use blocks
5. Backend streams SSE events: `event: text` (chat chunks) + `event: tool_result` (structured data including `create_deal` for backend-created deals)
6. **Two-pass follow-up:** If Claude responded with only tool calls and no text, a lightweight second call (no tools) generates the conversational response, streamed as `event: text` chunks with `event: followup_done` at completion
7. **Server-side quick actions:** If Claude didn't call `update_quick_actions`, the backend generates suggestions via Haiku (`CLAUDE_FAST_MODEL`) and emits them as a `tool_result` SSE event
8. **Two-pass extraction:** Factual extractor, analyst, and situation assessor subagents run in parallel via Haiku to extract structured data, generate AI panel cards, and maintain negotiation context
9. `apply_extraction()` persists results to Vehicle, Deal, and DealState tables and emits `tool_result` SSE events
10. **Post-chat processing:** `update_session_metadata()` updates `last_message_preview` and auto-generates a session title (deterministic vehicle title from `set_vehicle`, or LLM fallback via Haiku) when `auto_title` is true
11. Frontend `useChat` hook uses event-based SSE parsing to dispatch tool results to Zustand store → InsightsPanel re-renders with AI-generated cards. The `snakeToCamel` utility converts backend snake_case field names to frontend camelCase.
12. On send failure, optimistic messages are rolled back from the chat store

**New session flow (buyer):**
1. Buyer lands on the chats list (`/(app)/chats`), the buyer home screen. If no sessions exist, ContextPicker shows as an empty state with three situation cards: "Researching", "Have a deal to review", "At the dealership".
2. User taps a card (or skips by typing/uploading directly, which defaults to `researching`)
3. Frontend calls `POST /api/sessions` with the selected `buyer_context`
4. A hardcoded greeting message (per context) is injected client-side — no LLM call needed
5. Quick actions, dashboard panel ordering, and system prompt preamble all adapt to the selected context
6. If the buyer has only one session, the chats screen navigates directly to the chat (single-session fast-path)

**Photo analysis:** Client uploads image → sends URL to backend → Claude vision extracts all numbers/details → calls multiple tools → dashboard populates in one shot.

**Dealer simulations:** Same chat infrastructure, different system prompt (Claude plays a customer persona with hidden budget/goals). Uses a `score_salesperson` tool at completion.

---

## Key Decisions

- **SSE over WebSockets** — simpler, maps directly to Claude's streaming API, no connection upgrade issues on Railway/Fly
- **Zustand over Redux** — minimal boilerplate, perfect for this scope
- **Single mutable deal_states row over event log** — simpler reads for MVP, can add history table later
- **Claude Sonnet 4.6** (`claude-sonnet-4-6`) — primary model for chat, with max_tokens: 4096 and history truncated to last 20 messages. **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) — fast model for lightweight tasks (quick action generation, session title generation, deal assessment safety net)
- **Cost control** — track token usage per user, enforce daily limits

---

## Implementation Order

| Phase | What | Days |
|-------|------|------|
| 0 | Project scaffolding (Expo, FastAPI, PostgreSQL, env) | 1 |
| 1 | Auth + session CRUD | 2-3 |
| 2 | **Core chat loop** — text chat, Claude with tools, SSE streaming, NumbersSummary + DealPhaseIndicator updating live | 4-7 |
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
