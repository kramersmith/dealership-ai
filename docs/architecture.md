# Dealership AI MVP — Technical Architecture Plan

## Context
Greenfield build of two AI-powered smartphone apps (buyer + dealer) for the car buying experience. Solo developer, tight budget, targeting iOS/Android/web. Stack: React Native (Expo) → FastAPI → Claude API → PostgreSQL (Supabase).

The key architectural challenge: the persistent UI (dashboard, scorecard, checklist, vehicle card) must update automatically from the LLM conversation. When a user says "they're offering $34k", the numbers dashboard updates live.

**Solution: Claude's tool_use feature.** Claude returns structured tool calls (e.g. `update_deal_numbers({ their_offer: 34000 })`) alongside conversational text. The backend executes the tool calls (updates DB), streams both text and tool results to the client via SSE, and the frontend updates the Zustand store → dashboard re-renders.

---

## Monorepo Structure

```
dealership-ai/
├── apps/
│   └── mobile/                  # Expo app (iOS + Android + Web)
│       ├── app/                 # Expo Router file-based routing
│       │   ├── (buyer)/         # Buyer tab group
│       │   │   ├── chat.tsx     # Main chat screen
│       │   │   ├── sessions.tsx # Session list
│       │   │   └── settings.tsx
│       │   ├── (dealer)/        # Dealer tab group
│       │   │   ├── simulations.tsx
│       │   │   └── sim/[id].tsx
│       │   ├── (auth)/
│       │   │   ├── login.tsx
│       │   │   └── register.tsx
│       │   └── _layout.tsx      # Root layout (auth gate)
│       ├── components/
│       │   ├── chat/            # ChatBubble, ChatInput, VoiceButton
│       │   ├── dashboard/       # DealPhase, NumbersDash, Checklist,
│       │   │                    # VehicleCard, Scorecard, Timer
│       │   └── shared/          # Button, Card, Modal
│       ├── hooks/
│       │   ├── useChat.ts       # SSE streaming + state
│       │   ├── useDashboard.ts
│       │   ├── useVoice.ts      # Speech-to-text wrapper
│       │   └── useSession.ts
│       ├── stores/
│       │   └── chatStore.ts     # Zustand store
│       └── lib/
│           ├── supabase.ts
│           ├── api.ts
│           └── types.ts
│
├── packages/
│   └── shared/                  # Shared types/constants
│
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app
│   │   ├── config.py            # Settings
│   │   ├── deps.py              # Dependency injection
│   │   ├── models/              # SQLAlchemy: user, session, message, deal_state, simulation
│   │   ├── schemas/             # Pydantic request/response
│   │   ├── routes/              # auth, chat, sessions, deals, simulations
│   │   ├── services/
│   │   │   ├── claude.py        # Claude API + tool definitions + SSE streaming
│   │   │   ├── deal_analyzer.py # Photo → deal sheet parsing
│   │   │   └── simulation.py    # Dealer training AI logic
│   │   └── claude_tools/        # Tool schemas for Claude
│   ├── alembic/                 # DB migrations
│   └── tests/
│
└── .env.example
```

---

## Database Schema (PostgreSQL via Supabase)

**profiles** — extends Supabase auth.users (id, role [buyer/dealer], display_name)

**sessions** — (id, user_id, title, session_type [buyer_chat/dealer_sim], linked_session_ids UUID[], timestamps)

**messages** — (id, session_id, role [user/assistant/system], content, image_url, created_at)

**deal_states** — one mutable row per session, the persistent UI state:
- Phase: research → initial_contact → test_drive → negotiation → financing → closing
- Numbers: msrp, invoice_price, their_offer, your_target, current_offer, monthly_payment, apr, loan_term_months, down_payment, trade_in_value
- Vehicle: year, make, model, trim, vin, mileage, color
- Scorecard: score_price, score_financing, score_trade_in, score_fees, score_overall (red/yellow/green)
- Checklist: JSONB array of {label, done}
- Timer: timer_started_at

**simulations** — (id, session_id, scenario_type, difficulty, ai_persona JSONB, score, feedback, completed_at)

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

**5 tools registered with every Claude call:**
1. `update_deal_numbers` — prices, payments, rates (all fields optional, only update what changed)
2. `update_deal_phase` — progression through deal phases
3. `update_scorecard` — red/yellow/green ratings
4. `set_vehicle` — year, make, model, trim, vin, mileage
5. `update_checklist` — array of {label, done} items

**Streaming flow:**
1. Client POSTs message
2. Backend loads history + linked session context, calls Claude with tools
3. Claude streams text + tool_use blocks
4. Backend streams SSE events: `event: text` (chat chunks) + `event: tool_result` (structured data)
5. Backend persists messages and executes tool calls (UPDATE deal_states)
6. Frontend `useChat` hook dispatches tool results to Zustand store → dashboard components re-render

**Photo analysis:** Client uploads to Supabase Storage → sends URL to backend → Claude vision extracts all numbers/details → calls multiple tools → dashboard populates in one shot.

**Dealer simulations:** Same chat infrastructure, different system prompt (Claude plays a customer persona with hidden budget/goals). Uses a `score_salesperson` tool at completion.

---

## Key Decisions

- **SSE over WebSockets** — simpler, maps directly to Claude's streaming API, no connection upgrade issues on Railway/Fly
- **Zustand over Redux** — minimal boilerplate, perfect for this scope
- **Single mutable deal_states row over event log** — simpler reads for MVP, can add history table later
- **Claude Sonnet over Opus** — balances cost and quality for MVP, with max_tokens: 1024 and history truncated to last 20 messages
- **Cost control** — track token usage per user, enforce daily limits

---

## Implementation Order

| Phase | What | Days |
|-------|------|------|
| 0 | Project scaffolding (Expo, FastAPI, Supabase, env) | 1 |
| 1 | Auth + session CRUD | 2-3 |
| 2 | **Core chat loop** — text chat, Claude with tools, SSE streaming, NumbersDashboard + DealPhaseIndicator updating live | 4-7 |
| 3 | Remaining dashboard UI — scorecard, vehicle card, checklist, timer, quick actions, session linking | 8-10 |
| 4 | Photo upload (Supabase Storage + Claude vision) + voice input (expo-speech-recognition) | 11-13 |
| 5 | Dealer training simulations | 14-16 |
| 6 | Polish + deploy (error handling, rate limiting, Railway, EAS builds, Vercel) | 17-20 |

**Phase 2 is the milestone:** text "They offered $34k for a 2024 Camry" and watch the dashboard update live.

---

## Verification

- **Phase 0:** Expo app loads on simulator, FastAPI returns 200, Supabase connection succeeds
- **Phase 2:** Send a chat message → see streamed response + dashboard numbers update. This is the core proof of concept.
- **Phase 4:** Take a photo of a deal sheet → see vehicle card, numbers, scorecard, and checklist all populate
- **Phase 5:** Start a dealer simulation → have a back-and-forth with AI customer → get scored
- **Phase 6:** App runs on physical iOS/Android device via TestFlight/internal testing, web version accessible via URL
