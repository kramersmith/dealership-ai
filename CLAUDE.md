# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dealership AI is a single AI-powered smartphone app for the car buying experience with role-based features. Monorepo with a FastAPI backend and React Native (Expo) frontend. This is a **pre-production first version** — not yet launched.

- **Buyer features** — helps buyers understand deals, spot unauthorized charges, negotiate effectively
- **Dealer features** — AI training simulations where salespeople practice against AI customer scenarios
- **Backend** — FastAPI with Claude API integration, SSE streaming, JWT auth

## Development Philosophy

Prioritize clean architecture, maintainability, and correctness over speed or convenience:

- Never patch around architectural flaws — fix the underlying design, even if it means a rewrite.
- Prefer explicit tables/columns over overloading existing fields.
- If existing code is the wrong abstraction, refactor it as part of the change.
- No "we'll fix this later" — pay the cost to do it right now.
- Endpoints and payloads should match the domain.

See `docs/first-version-quality.md` for the full decision framework.

## Commands

All commands run from the repo root via Make. The Makefile auto-detects the `.venv` Python.

### Development Servers
- `make dev-frontend` — Expo dev server (web)
- `make dev-backend` — FastAPI with reload (port 8001)
- `make docker-up` — Full stack: frontend + backend + PostgreSQL

### Testing
- `make test-backend` — Run all backend tests
- `make test-backend-specific TEST='tests/test_auth.py::test_signup'` — Single test
- `make test-backend-watch` — Watch mode

### Linting / Formatting / Type Checking
- `make lint-backend` / `make format-backend` — Ruff
- `make isort-backend` — Sort imports via Ruff
- `make typecheck-backend` — MyPy
- `make check-all` — Full suite: lint + format + typecheck + tests
- `make check-static` — Static checks only (no tests)

### Database
- `make migrate-backend` — Apply Alembic migrations
- `make migrations-backend` — Auto-generate new migration

## Architecture

### Backend (`apps/backend`)

FastAPI app with layered architecture:

- **Routes** (`app/routes/`) — Endpoint definitions: auth, sessions, chat (SSE streaming), deals, simulations
- **Schemas** (`app/schemas/`) — Pydantic models for request/response validation
- **Services** (`app/services/`) — Business logic: Claude API integration split across three modules — chat turn loop with 17 operational tools (`claude.py`: `stream_chat_loop()`, message building, system prompt, context preambles, CHAT_TOOLS, ChatLoopResult), AI panel card generation (`panel.py`: `generate_ai_panel_cards()`, conversation context building, panel prompt, card validation), and standalone deal analysis (`deal_analysis.py`: `analyze_deal()`, analyst tool definition). Also: SSE streaming, deal state logic (`deal_state.py`: apply_extraction, execute_tool, deal_state_to_dict, build_deal_assessment_dict), post-chat processing (preview + title updates), title generation (deterministic vehicle titles + Haiku LLM fallback), vehicle intelligence (`vehicle_intelligence.py`: NHTSA vPIC VIN decode, VinAudit history/valuation integration)
- **Models** (`app/models/`) — SQLAlchemy ORM: User, ChatSession, Message, DealState, Vehicle (with cascade delete-orphan relationships to VehicleDecode, VehicleHistoryReport, VehicleValuation), Deal, Simulation
- **Core** (`app/core/`) — Config (Pydantic Settings), security (JWT + bcrypt), deps (FastAPI DI)

Key patterns:
- Claude integration uses two models: `claude-sonnet-4-6` (`CLAUDE_MODEL`) for primary chat with 17 operational tools and AI panel generation, and `claude-haiku-4-5-20251001` (`CLAUDE_FAST_MODEL`) for lightweight tasks like session title generation
- Turn loop architecture: call Claude with tools → stream text + accumulate tool_use blocks → execute tools (apply to DB, emit SSE events) → append tool results as messages → call Claude again → repeat until text-only response or max 5 turns. Implemented in `stream_chat_loop()` in `claude.py`.
- After the turn loop, a separate panel generation call (`generate_ai_panel_cards()` in `panel.py`) produces AI insight cards using the updated deal state
- Standalone deal analysis (`analyze_deal()` in `deal_analysis.py`) provides on-demand deal re-assessment outside the chat loop
- Chat endpoint streams SSE events: `text` (conversation chunks), `tool_result` (deal state updates from tool execution + panel cards), `done`
- Backend enums (`app/models/enums.py`): UserRole, SessionType, MessageRole, DealPhase, ScoreStatus, BuyerContext, HealthStatus, RedFlagSeverity, GapPriority, VehicleRole, Difficulty, NegotiationStance, AiCardType, AiCardPriority, IdentityConfirmationStatus, IntelligenceProvider, IntelligenceStatus (all `StrEnum`)
- Lifespan handler (not `on_event`) creates tables and seeds dev users on startup
- Seed users in development: `buyer@test.com` and `dealer@test.com` (password: `password`)
- SQLite for local dev, PostgreSQL via Docker for production
- JWT auth with Bearer tokens

### Frontend (`apps/mobile`)

React Native + Expo + Tamagui + Zustand:

- **Screens** (`app/`) — Expo Router file-based routing with a single `(app)` route group (role-gated screens)
- **Components** (`components/`) — Chat (bubbles, input, voice, ContextPicker (situation cards + VIN submit flow), CopyableBlock, QuotedCardPreview, VinAssistCard, VinInterceptModal), Chats (SessionCard with phase dot, preview, deal summary), Insights Panel (`insights-panel/`: AI-driven card-based layout with AiCard base renderer + reply button, CardReplyInput, CardTitle (shared uppercase muted label), SituationBar (negotiation context display), ThinkingIndicator (pulsing indicator during AI processing), BriefingCard, NumbersCard, AiVehicleCard (expandable container with Specs/Title Check/Market Value sections, VIN prompt), VehicleIntelligencePanel, WarningCard, TipCard, SuccessCard, AiChecklistCard (read-only with progress bar), AiComparisonCard, CompactPhaseIndicator, PanelMarkdown, QuickActions), Shared (AppCard with compact prop, ScreenHeader (animated header with ScrambleText title + icon slots), HeaderIconButton, HoverLiftFrame (desktop hover lift effect), ScrambleText (character-by-character text reveal animation), buttons, pills, menu)
- **Stores** (`stores/`) — Zustand: auth, chat, deal, simulation, theme
- **Hooks** (`hooks/`) — useChat (orchestrates messages + tool calls with event-based SSE parsing and optimistic rollback), useEditableField (inline editing with debounced backend sync), useScreenWidth (responsive breakpoint), useIconEntrance (animated icon transitions between screens), useDesktopChatTransition (desktop-specific animated chat/insights panel transitions with fade/slide), useSlideIn (reusable slide-in animation)
- **API** (`lib/`) — API client connecting to the FastAPI backend (no mock layer), `snakeToCamel` utility for mapping backend snake_case fields to frontend camelCase, `dealComputations.ts` for derived deal metrics (savings, `computeOfferDelta`, `getNextActionRecommendation`), vehicle intelligence API functions (upsert-from-vin, decode-vin, confirm-identity, check-history, get-valuation), `headerTitles.ts` (vehicle-aware header title resolution with decode/session/fallback priority), `dev/mockPanelUpdates.ts` (dev-only mock tool calls for testing panel animations)

Key patterns:
- ContextPicker component (`components/chat/ContextPicker.tsx`, renamed from WelcomePrompts) shows 3 situation cards when starting a new buyer chat session; user can skip by typing directly. Also supports a VIN submit flow for quick vehicle identification.
- Buyer context (researching, reviewing_deal, at_dealership) drives static fallback quick actions, system prompt preamble, and hardcoded greeting messages
- InsightsPanel renders AI-generated cards (`ai_panel_cards` on deal state) with card types: briefing, numbers, vehicle, warning, tip, checklist, success, comparison — replacing the previous fixed-widget tiered layout. SituationBar displays the negotiation context (stance + situation) above cards when present.
- Card design standardization: all cards use a shared CardTitle component (uppercase muted label, optional icon and right content). Status cards (briefing high/critical, success) use top accent bars instead of left borders.
- Card reply system: every insight card has a MessageCircle reply icon that opens a CardReplyInput slide-in drawer; submitting sends a chat message with quoted card context (`QuotedCard` type on Message, rendered as `QuotedCardPreview` in chat bubbles). `chatStore.sendMessage` accepts an optional `quotedCard` param.
- AiVehicleCard is an expandable container (RN primitives, Tamagui workaround) with collapsible Specs, Title Check, and Market Value sections powered by vehicle intelligence data. Shows a VIN prompt when no VIN is available. Uses contextual title labels based on buyer situation. Vehicle identity confirmation flow (confirmed/rejected status) triggers panel card refresh and title update.
- AiChecklistCard is read-only (no toggle interaction) with a progress bar. Inline editing on dealer name only — corrections sent as structured payloads to `PATCH /api/deal/{session_id}` with automatic Haiku re-assessment.
- Negotiation context: `NegotiationContext` type with stance, situation, key numbers, scripts, pending actions, and leverage. Displayed via SituationBar in InsightsPanel. DealStore handles `update_negotiation_context` tool calls from the backend situation assessor.
- DealStore: handles backend-emitted `create_deal` events for deal/vehicle creation; no longer auto-creates deals client-side. Manages vehicle intelligence state (decode, history, valuation) and VIN assist flow (VIN detection in chat, inline decode/confirm).
- VIN Assist: chatStore detects VINs in user messages, triggers VinInterceptModal for inline decode/confirm flow. VinAssistCard renders in-chat VIN decode results. `chatStore.submitVinFromPanel` allows VIN submission from the insights panel/ContextPicker.
- Quick actions are dynamically generated by Claude via the `update_quick_actions` tool; static context-based fallbacks show before the first AI exchange and when dynamic actions go stale
- AuthGuard component (`components/shared/AuthGuard.tsx`) protects the `(app)` route group
- RoleGuard component (`components/shared/RoleGuard.tsx`) gates individual screens by role (buyer/dealer)
- Role is set at registration and cannot be changed in production (role switching is dev-only via `__DEV__`)
- Chats list screen (`/(app)/chats`) is the buyer home screen with search, Active/Past sections, SessionCard components, pull-to-refresh, ContextPicker empty state, and single-session fast-path
- `APP_NAME` constant ('DealershipAI') and other constants (`WEB_FONT_FAMILY`, `TIMER_TIPS`, `SCORE_DESCRIPTIONS`, `MAX_INSIGHTS_PREVIEW_ITEMS`) in `lib/constants.ts`
- Quick sign-in buttons on login screen for seed users (dev only via `__DEV__`)
- Markdown rendering in assistant chat bubbles via `react-native-markdown-display` (user messages render as plain text)
- Facebook dark mode color palette with light mode support
- Tamagui theme system with centralized tokens (`lib/theme/tokens.ts`) and theme definitions (`lib/theme/themes.ts`) — no hardcoded hex in components. Semantic sub-themes (`danger`, `warning`, `success`) for status surfaces. Components use `useTheme()` or `<Theme name="...">` wrappers.
- Mobile-first with responsive desktop layout (insights sidebar at ≥768px)
- Micro-interactions on all interactive elements (animations, feedback)
- Touch targets ≥44px on all interactive elements
- See `docs/ui-design-principles.md` for full guidelines

### Environment

Both apps use `.env` files (copy from `.env.example`). Key variables:
- Backend: `DATABASE_URL`, `SECRET_KEY`, `ANTHROPIC_API_KEY`, `CLAUDE_FAST_MODEL`, `CORS_ORIGINS`, `VINAUDIT_API_KEY`, `NHTSA_VPIC_BASE_URL`, `VINAUDIT_HISTORY_URL`, `VINAUDIT_VALUATION_URL`
- Frontend: Connects to real FastAPI backend

## Commit Conventions

Use **conventional commits** (e.g. `feat(chat): ...`, `fix(dashboard): ...`). Keep messages descriptive.

## Quality Standards

When reviewing or finalizing changes, verify: correctness (edge cases, null safety), security (no injection, auth checks), code quality (DRY, single responsibility), test coverage for new behavior, error handling, and logging per `docs/logging-guidelines.md`.

## UI Standards

Mobile-first, touch targets ≥44px, no hover-only interactions, no hardcoded colors (use Tamagui theme tokens from `lib/theme/tokens.ts` or semantic sub-themes), micro-interactions on all interactive elements. See `docs/ui-design-principles.md`.

## Updating Documentation

When changes affect architecture, APIs, business rules, or setup, update relevant docs in `docs/`. Key docs:
- `docs/architecture.md` — Technical architecture
- `docs/TRD.md` — Technical requirements document
- `docs/PRD.md` — Product requirements document
- `docs/business-rules.md` — Business rules reference
- `docs/backend-endpoints.md` — API endpoint reference
- `docs/development.md` — Setup guide and env vars
- `docs/operational-guidelines.md` — Ports, security, cost control
- `docs/logging-guidelines.md` — Log levels, PII rules
- `docs/ui-design-principles.md` — Frontend design standards
- `docs/notes.md` — Project vision and features
- `docs/backend-plan.md` — Backend implementation plan (historical)
