# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Table of Contents

- [Project Overview](#project-overview)
- [Development Philosophy](#development-philosophy)
- [Commands](#commands)
- [Architecture](#architecture)
- [Environment](#environment)
- [Commit Conventions](#commit-conventions)
- [Quality Standards](#quality-standards)
- [UI Standards](#ui-standards)
- [Updating Documentation](#updating-documentation)

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
- `cd apps/mobile && npm test` — Run the focused mobile Vitest suite

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
- **Services** (`app/services/`) — Business logic: Claude API integration is the `claude/` package (`chat_loop.py`: `stream_chat_loop()`, `ChatLoopResult`; `chat_loop_engine.py`: `run_chat_loop_engine()` decomposed step loop with dataclass-driven state; `tool_schemas.py`: `CHAT_TOOLS`, `get_buyer_chat_tools()` for dynamic tool filtering by insights mode; `messages.py` / `context_message.py` / `prompt_static.py` / `prompt_deal_state.py`; `streaming.py`: `stream_step_with_retry`; `tool_runner.py`: `execute_tool_batch`; `usage_stats.py`, `errors.py`, `client.py`, `recovery.py`, `text_dedupe.py`, `tool_policy.py`). Shared buyer-turn chat streaming lives in `buyer_chat_stream.py` (`stream_buyer_chat_turn()` for `/message` + `/branch`), and branch preparation/reset logic lives in `session_branch.py` (`prepare_session_branch_from_user_message()`, `reset_session_commerce_state()`). Detached insights follow-up (`insights_followup.py`: `stream_linked_insights_followup()`, `run_linked_insights_followup_to_completion()`) drives reconcile + panel generation on a separate SSE endpoint with durable `InsightsFollowupJob` lifecycle. Turn cancellation registry (`turn_cancellation.py`: `TurnCancellationRegistry`, `TurnCancellationState`, `TurnAlreadyActiveError`) provides in-memory per-session active-turn tracking with cooperative cancellation; the `/stop` endpoint sets a cancel flag that the step loop checks between iterations. AI panel card generation (`panel.py`: `stream_ai_panel_cards_with_usage()`, `generate_ai_panel_cards()`, `generate_ai_panel_cards_with_usage()`, conversation context building, panel prompt, card validation), standalone deal analysis (`deal_analysis.py`: `analyze_deal()`, analyst tool definition), and usage/cost accounting (`usage_tracking.py`: per-request usage, per-model session totals, USD cost calculation, API payload formatting; `SessionUsageSummary` tracks prompt cache state across chat/panel phases via `prompt_cache_chat_last`, `prompt_cache_panel_last`, `prompt_cache_break_count`). Turn execution context (`turn_context.py`: `TurnContext` dataclass carrying session, deal state, DB session, and step number through the step loop and concurrent tool execution; immutable-update helpers `for_step()` and `for_db_session()`). Prompt cache fingerprinting (`prompt_cache_signature.py`: SHA-256 digests of system prompt, tools, model, betas for detecting cache breaks between turns). Panel update policy (`panel_update_service.py`: `PanelUpdatePolicy`, `resolve_panel_update_policy()` for per-user insights mode resolution, `refresh_panel_on_demand()` for explicit panel regeneration via the shared follow-up pipeline). User settings service (`user_settings.py`: `get_or_create_user_settings()`, `to_user_settings_response()`). Also: SSE streaming, deal state logic (`deal_state.py`: apply_extraction, execute_tool, deal_state_to_dict, build_deal_assessment_dict), post-chat processing (preview + title updates), title generation (deterministic vehicle titles + Haiku LLM fallback), vehicle intelligence (`vehicle_intelligence.py`: NHTSA vPIC VIN decode, VinAudit history/valuation integration)
- **Models** (`app/models/`) — SQLAlchemy ORM: User, UserSettings (one-to-one with User; `insights_update_mode`), ChatSession (including persisted cumulative `usage` JSON and optional `compaction_state` JSON for buyer context compaction), Message (including persisted assistant `usage` JSON, `completion_status`, `interrupted_at`, `interrupted_reason`), DealState, Vehicle (with cascade delete-orphan relationships to VehicleDecode, VehicleHistoryReport, VehicleValuation), Deal, InsightsFollowupJob (durable follow-up job rows keyed by `session_id` + `assistant_message_id` + `kind`; tracks overall status, per-step status, attempts, usage, timestamps), Simulation
- **Core** (`app/core/`) — Config (Pydantic Settings), security (JWT + bcrypt), deps (FastAPI DI)

Key patterns:
- Claude integration uses two models: `claude-sonnet-4-6` (`CLAUDE_MODEL`) for primary chat with 16 operational tools and AI panel generation, and `claude-haiku-4-5-20251001` (`CLAUDE_FAST_MODEL`) for lightweight tasks like session title generation
- Turn/step terminology: a **turn** is the full outer exchange (user sends message → assistant delivers final response). A **step** is one inner cycle within a turn (LLM call → tool execution → result appended). `stream_chat_loop()` iterates steps (max 5 per turn via `CHAT_LOOP_MAX_STEPS`).
- Step loop architecture: call Claude with tools → stream text + accumulate tool_use blocks → execute tools concurrently (apply to DB, emit SSE events) → append tool results as messages → call Claude again → repeat until text-only response or max steps reached. Implemented in `stream_chat_loop()` in `claude/chat_loop.py`. A `TurnContext` dataclass (`turn_context.py`) carries the session, deal state, DB session, and current step number through the loop; `stream_chat_loop()`, `execute_tool_batch()`, and `execute_tool()` all accept a `TurnContext` instead of separate `deal_state`/`db` parameters.
- Concurrent tool execution: tools are classified by priority (`TOOL_PRIORITY` in `deal_state.py`) — structural tools (set_vehicle, remove_vehicle) run first, context switches (create_deal, switch_active_deal) next, then field updates (default priority 2) run concurrently via `asyncio.gather()`, with `update_deal_health` at priority 3 so committed deal numbers are visible to semantic validators. Each concurrent tool gets an isolated `AsyncSession` (via `TurnContext.for_db_session()`) to avoid shared-session conflicts. Results are emitted as SSE events in original call order. Orchestrated by `build_execution_plan()` and `execute_tool_batch()` in `claude/tool_runner.py`.
- Chat tool semantic validation (`tool_validation.py`: `validate_tool_input()`, `ToolValidationError`) runs inside `execute_tool()` after JSON parse and before `apply_extraction()`; failures surface as `is_error` tool_results (Pydantic-AI-style model self-correction on the next step).
- Message construction: `build_context_message()` produces a per-turn context block (deal state, linked sessions, temporal grounding with the current UTC date). `build_messages()` merges this context into the user message as content blocks (no synthetic assistant reply), keeping the message history clean for caching. Three-breakpoint prompt caching: system prompt, last tool definition, and last message all carry `cache_control: {"type": "ephemeral"}`. `build_messages()` sets the initial message breakpoint on the last history message; `move_message_cache_breakpoint()` relocates it to the last tool_result after each step so subsequent steps cache-hit on the full conversation prefix.
- After the chat step loop, the backend persists the assistant row and emits `done` with `assistant_message_id`. Panel generation runs as a **detached follow-up** on a separate SSE endpoint (`POST /api/chat/{session_id}/insights-followup`); the client opens this second stream when `insights_update_mode=live`. The follow-up service (`insights_followup.py`) creates a durable `InsightsFollowupJob` row, runs an optional reconcile pass, then generates panel cards via `stream_ai_panel_cards_with_usage()` in `panel.py`. The **client-visible** SSE contract on the follow-up stream is `panel_started` / `panel_done` (atomic `cards` + `assistant_message_id`) / `panel_error` only — no `panel_card` events. Follow-up usage is merged into the persisted assistant row and session ledger; the final snapshot is written to `Message.panel_cards`. Panel `max_tokens` starts at 4096 and escalates to 8192 on bounded truncation retries.
- Canonical panel contract (`panel_cards.py`): per-kind instance caps instead of a global panel length cap — `vehicle` allows up to 6 instances (one card per shopping vehicle), every other kind caps at 1 via `DEFAULT_PANEL_KIND_MAX_INSTANCES`. Dedupe is identity-based: `vehicle` cards key on VIN (falling back to role + YMM + mileage + color), other kinds key on `kind` alone. Panel kinds `comparison` and `trade_off` are no longer emitted to the panel — side-by-side comparisons render as markdown tables in chat instead (ADR 0018). A new `AiCardKind.PHASE` card (`{stance, situation}`, rendered via the BRIEFING template with title "Status") is always first in the panel order and represents negotiation stance — distinct from `deals[].phase` (the pipeline phase). Panel single-focus enforcement (`panel.py`): when there is a single shopping vehicle or an explicit active-deal signal, panel vehicle cards collapse to the active vehicle; with 2+ shopping vehicles and no explicit choice, all vehicle cards pass through and non-vehicle cards must disambiguate scope in their labels.
- Standalone deal analysis (`analyze_deal()` in `deal_analysis.py`) provides on-demand deal re-assessment outside the chat loop
- Chat endpoint streams SSE events: `turn_started` (with `turn_id` for cancellation), `text` (conversation chunks), `tool_result` (deal state updates from step-loop tool execution), `retry` / `step` (recovery and multi-step progress), `error` (user-safe error message on API failure), `done` (final chat text + chat-phase usage + `assistant_message_id`), `interrupted` (partial text + reason when user stops generation), buyer compaction lifecycle (`compaction_started`, `compaction_done`, `compaction_error`). Panel lifecycle events (`panel_started`, `panel_done`, `panel_error`) are emitted on the separate detached follow-up endpoint (`POST /api/chat/{session_id}/insights-followup`). The `POST /api/chat/{session_id}/stop` endpoint cancels an active turn by setting a cooperative cancel flag; `POST /api/chat/{session_id}/panel-refresh` regenerates the insights panel without a new chat turn (used after an interrupted panel or in paused mode). The shared buyer-turn service can also emit a safe `error` after `done` if a later persistence/update step fails; the client keeps the delivered reply and surfaces the warning. Custom compaction: `compaction.py` (`run_auto_compaction_if_needed`, `project_for_model`, `compute_session_context_pressure`; ADR 0017).
- Backend enums (`app/models/enums.py`): UserRole, InsightsUpdateMode (`live` / `paused`), InsightsFollowupKind (`linked_reconcile_panel`), InsightsFollowupStatus (`pending` / `running` / `succeeded` / `failed` / `cancelled`), InsightsFollowupStepStatus (`pending` / `running` / `succeeded` / `failed` / `skipped` / `cancelled`), SessionType, MessageRole, MessageCompletionStatus (`complete` / `interrupted` / `failed`), DealPhase, ScoreStatus, BuyerContext, HealthStatus, RedFlagSeverity, GapPriority, VehicleRole (`primary` / `candidate` / `trade_in`), Difficulty, NegotiationStance, AiCardTemplate, AiCardKind (including `phase`), AiCardPriority, IdentityConfirmationStatus, IntelligenceProvider, IntelligenceStatus, ContextPressureLevel (all `StrEnum`). `VehicleRole.CANDIDATE` represents VIN-known vehicles the buyer has not committed to; `VIN-assisted upsert-from-vin` inserts CANDIDATE rows that do NOT steal active deal focus. Deal routing treats `primary` and `candidate` as the unified "shopping" set via `_SHOPPING_VEHICLE_ROLES` (ADR 0018).
- Pre-persisted user messages (`POST /api/chat/{session_id}/user-message`): persists the user message row without triggering a chat stream. Used by gated VIN intercept flows so the user's text is visible in `GET /messages` while decode/confirm runs. The subsequent `POST /message` call passes `existing_user_message_id` to resume streaming on the already-persisted row (updates its content instead of inserting a new one). `existing_user_message_id` only resumes the **latest** user row (returns 409 otherwise — older rows must use the branch endpoint). Pre-persisted rows are NOT deleted on stream failure (only newly inserted user rows are rolled back). See ADR 0019.
- Branch from a user message (`POST /api/chat/{session_id}/messages/{message_id}/branch`): edit-from-here flow. Anchor must be a `user` row in the session. The route delegates to `app/services/session_branch.py:prepare_session_branch_from_user_message`, which in a single committed transaction deletes any messages after the anchor in `(created_at, id)` order and **always** clears `compaction_state`, `usage`, and structured commerce state via `reset_session_commerce_state` (deletes deals/vehicles + clears session-level deal JSON; preserves `buyer_context`). It then runs the same SSE turn pipeline as `/message` (`app/services/buyer_chat_stream.py:stream_buyer_chat_turn`) with `resumed_user_row=<anchor>` and `include_timeline_fork_reminder=True`, which injects a one-line system reminder via `build_context_message` so the model treats the cleared structured state and possibly-retained transcript consistently. See ADR 0020.
- Lifespan handler (not `on_event`) creates tables and seeds dev users on startup
- Seed users in development: `buyer@test.com` and `dealer@test.com` (password: `password`)
- Async SQLAlchemy (`AsyncSession`, `async_sessionmaker`, `create_async_engine`) for all application DB access. Sync engine retained only for DDL (`create_all`) at startup and Alembic migrations. SQLite uses `aiosqlite` driver; PostgreSQL uses `psycopg` async mode. All service functions and route handlers are `async def`. Session factory: `AsyncSessionLocal` in `app/db/session.py`. DB queries use `select()` / `await db.execute()` pattern (not legacy `db.query()`).
- SQLite for local dev, PostgreSQL via Docker for production
- JWT auth with Bearer tokens

### Frontend (`apps/mobile`)

React Native + Expo + Tamagui + Zustand:

- **Screens** (`app/`) — Expo Router file-based routing with a single `(app)` route group (role-gated screens)
- **Components** (`components/`) — Chat (bubbles with FailedMessageFooter retry, input with stop generation button, voice, ContextPicker (situation cards + VIN submit flow), context pressure banner, `system`-role compaction notices in ChatBubble, CopyableBlock, QuotedCardPreview, QueuePreviewCard (shows queued messages above the input), VinAssistCard, MultiVinAssistCard (multi-VIN intercept flow), VinInterceptModal, `markdownRenderer.tsx` (chat markdown pipeline with GFM table support — parses markdown tables out of the stream and delegates to `VehicleComparisonTable` for responsive horizontal scrolling with sticky label column; falls back to `react-native-markdown-display` for non-table content), `vinAssistUtils.ts` (VIN detection + normalization helpers)), Chats (SessionCard with phase dot, preview, deal summary), Insights Panel (`insights-panel/`: AI-driven card-based layout with AiCard base renderer + reply button, CardReplyInput, CardTitle (shared uppercase muted label), SituationBar (negotiation context display), ThinkingIndicator (pulsing indicator during AI processing), DesktopInsightsDockControl (collapse/expand pill + collapsed-updating preview with live/paused label), panel interruption notice with refresh button, BriefingCard, NumbersCard, AiVehicleCard (expandable container with Specs/Title Check/Market Value sections, VIN prompt), VehicleIntelligencePanel, WarningCard, TipCard, SuccessCard, AiChecklistCard (read-only with progress bar), AiComparisonCard, CompactPhaseIndicator, PanelMarkdown), Shared (AppCard with compact prop, ScreenHeader (animated header with ScrambleText title + icon slots), HeaderIconButton, HoverLiftFrame (desktop hover lift effect), ScrambleText (character-by-character text reveal animation), `VehicleComparisonTable` (shared responsive comparison table used by chat markdown tables and the AiComparisonCard), buttons, pills, menu)
- **Stores** (`stores/`) — Zustand: auth, chat (with client-side message queue and turn cancellation state: `activeTurnId`, `isStopRequested`, `panelInterruptionNotice`), deal, simulation, theme, userSettings (persisted `InsightsUpdateMode` synced with backend via `GET/PATCH /auth/settings`; hydrated from login/signup token response)
- **Hooks** (`hooks/`) — useChat (orchestrates messages + tool calls with event-based SSE parsing including `turn_started`, `interrupted`, `panel_interrupted`, `compaction_*`, optimistic rollback; exposes `stopGeneration`), useEditableField (inline editing with debounced backend sync), useScreenWidth (responsive breakpoint), useIconEntrance (animated icon transitions between screens), useDesktopChatTransition (desktop-specific animated chat/insights panel transitions with fade/slide), useDesktopInsightsShell (desktop panel shell state machine: expanded/collapsed_updating/collapsed_idle/hidden with launcher animations), useDesktopPanelPreference (client-local `localStorage` persistence for desktop panel collapsed state — not server-synced), useSlideIn (reusable slide-in animation), useWebAriaHiddenFocusWorkaround (web a11y shim that blurs focus inside `aria-hidden` subtrees when RN Web Modal opens; pure DOM helper extracted to `lib/webAriaHiddenFocus.ts` for unit tests)
- **API** (`lib/`) — API client connecting to the FastAPI backend (no mock layer). `apiClient.ts` uses a shared `streamBuyerChatSse()` parser for both normal sends and branch sends, preserves structured 4xx detail when safe, hides raw 5xx/proxy bodies behind generic messages, and treats SSE `error` after `done` as a non-fatal warning. Also: `snakeToCamel` utility for mapping backend snake_case fields to frontend camelCase, `dealComputations.ts` for derived deal metrics (savings, `computeOfferDelta`, `getNextActionRecommendation`), vehicle intelligence API functions (upsert-from-vin, decode-vin, confirm-identity, check-history, get-valuation), `headerTitles.ts` (vehicle-aware header title resolution with decode/session/fallback priority), `dev/mockPanelUpdates.ts` (dev-only mock tool calls for testing panel animations), `webModalFocus.ts` / `webAriaHiddenFocus.ts` (web modal focus helpers)

Key patterns:
- ContextPicker component (`components/chat/ContextPicker.tsx`, renamed from WelcomePrompts) shows 3 situation cards when starting a new buyer chat session; user can skip by typing directly. Also supports a VIN submit flow for quick vehicle identification.
- Buyer context (researching, reviewing_deal, at_dealership) drives the system prompt preamble and hardcoded greeting messages
- InsightsPanel renders AI-generated cards (`ai_panel_cards` on deal state) from the backend-owned canonical panel contract (`kind`, `template`, `title`, `content`, `priority`) — replacing the previous fixed-widget tiered layout. SituationBar displays the negotiation context (stance + situation) above cards when present.
- Card design standardization: all cards use a shared CardTitle component (uppercase muted label, optional icon and right content). Status cards (briefing high/critical, success) use top accent bars instead of left borders.
- Card reply system: every insight card has a MessageCircle reply icon that opens a CardReplyInput slide-in drawer; submitting sends a chat message with quoted card context (`QuotedCard` type on Message, rendered as `QuotedCardPreview` in chat bubbles). `chatStore.sendMessage` accepts an optional `quotedCard` param and a `source` param (`QueueMessageSource`: `'typed'` | `'card_reply'` | `'retry'`).
- Message queue: users can send multiple messages while AI is processing — messages are queued client-side and dispatched FIFO. Queue state lives in chatStore (`ChatQueueItem`, `queueBySession`, `activeQueueItemId`, `isQueueDispatching`). `sendMessage` enqueues; `_sendMessageImmediate` (extracted from the former `sendMessage`) handles the actual send; `_recheckQueueDispatch` / `_runQueueItem` drive sequential dispatch. Management functions: `removeQueuedMessage`, `clearQueue`, `recoverQueueStall`. ChatInput remains enabled during sends. QueuePreviewCard in `chat.tsx` renders pending queue items above the input. ChatBubble shows "Queued" / "Sending now" status labels for queued messages. Branch edit is blocked when the queue has pending items (`canBranchEdit`). See ADR 0022.
- AiVehicleCard is an expandable container (RN primitives, Tamagui workaround) with collapsible Specs, Title Check, and Market Value sections powered by vehicle intelligence data. Shows a VIN prompt when no VIN is available. Uses contextual title labels based on buyer situation. Vehicle identity confirmation flow (confirmed/rejected status) triggers panel card refresh and title update.
- AiChecklistCard is read-only (no toggle interaction) with a progress bar. Inline editing on dealer name only — corrections sent as structured payloads to `PATCH /api/deal/{session_id}` with automatic Sonnet re-assessment (`analyze_deal()`).
- Negotiation context: `NegotiationContext` type with stance, situation, key numbers, scripts, pending actions, and leverage. Displayed via SituationBar in InsightsPanel. DealStore handles `update_negotiation_context` tool calls from the backend situation assessor.
- DealStore: handles backend-emitted `create_deal` events for deal/vehicle creation; no longer auto-creates deals client-side. Manages vehicle intelligence state (decode, history, valuation) and VIN assist flow (VIN detection in chat, inline decode/confirm). Recognizes `VehicleRole.CANDIDATE` alongside `primary` and `trade_in`.
- VIN Assist: chatStore detects VINs in user messages via `normalizeVinCandidates`, triggers VinInterceptModal (single VIN) or MultiVinAssistCard (multiple VINs) for inline decode/confirm flow. Multi-VIN flow pre-persists the user message through `apiClient.persistUserMessage` (`POST /chat/{id}/user-message`) so it appears in history while decode runs; `_pendingSend` with `sourceMessageId` tracks the paused send, and `resumePendingSend` finalizes the stream via `existing_user_message_id` once the user resolves the intercept. VinAssistCard renders in-chat VIN decode results. `chatStore.submitVinFromPanel` allows VIN submission from the insights panel/ContextPicker. See ADR 0018 / ADR 0019.
- Edit a user message (chat branch): `ChatBubble` shows an explicit "edit-from-here" affordance on tap-eligible (server-id) user rows; `chatStore.startEditUserMessage` / `cancelEditUserMessage` toggle `editingUserMessageId` (gated against client placeholders, in-flight sends, pending VIN intercepts, failed rows). `sendBranchFromEdit` rejects VINs in the edit text, optimistically truncates the local timeline to the anchor, replaces the anchor content, calls `useDealStore.resetDealState(activeSessionId, currentBuyerContext)` to mirror the backend's `reset_session_commerce_state` (preserve `buyer_context`), then calls `apiClient.branchFromUserMessage` (which posts to the new `/messages/{id}/branch` endpoint via the shared `streamBuyerChatSse` SSE parser). On success the post-stream hook re-fetches deal state; on failure the anchor is marked `failed` and `loadMessages(silent)` resyncs from the server (which is the source of truth — the prepare phase commits truncation before streaming). A confirm modal (web) / `Alert.alert` (native) explains the destructive scope before submission. See ADR 0020.
- Web modal focus handling: RN Web modals use `focusDomElementByIdsAfterModalShow()` to move focus into the modal portal after open, while `useWebAriaHiddenFocusWorkaround()` blurs focus left inside `aria-hidden` background content. This pattern is used for the buyer branch confirm modal, VIN intercept modal, mobile insights modal, and hamburger menu.
- Chat markdown: assistant bubbles render through `markdownRenderer.tsx` which extracts GFM tables and passes them through the shared `VehicleComparisonTable`. On narrow layouts assistant bubbles drop the bubble chrome so tables can use full content width. Comparison tables live in chat, not in the insights panel (ADR 0018).
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
- Backend: `DATABASE_URL`, `SECRET_KEY`, `ANTHROPIC_API_KEY`, `CLAUDE_FAST_MODEL`, `CLAUDE_CONTEXT_INPUT_BUDGET`, `CLAUDE_COMPACTION_*` (buyer context compaction; see ADR 0017), `CLAUDE_STREAM_IDLE_TIMEOUT`, `CLAUDE_STREAM_MAX_RETRIES`, `CLAUDE_API_TIMEOUT`, `CLAUDE_SDK_MAX_RETRIES`, `CLAUDE_MAX_TOKENS_RETRIES`, `CLAUDE_MAX_TOKENS_ESCALATION_FACTOR`, `CLAUDE_MAX_TOKENS_CAP`, `CORS_ORIGINS`, `VINAUDIT_API_KEY`, `NHTSA_VPIC_BASE_URL`, `VINAUDIT_HISTORY_URL`, `VINAUDIT_VALUATION_URL`, `LOG_LOCAL_NDJSON_PATH` (optional clean NDJSON file; see `docs/development.md`)
- Frontend: Connects to real FastAPI backend

**Backend logs for coding agents:** Do **not** use raw IDE terminal / `docker compose logs` output (compose prefixes break NDJSON). Prefer **`apps/backend/logs/backend.ndjson`** when using Docker Compose (enabled by default via `LOG_LOCAL_NDJSON_PATH`) or **`make backend-log-slice … OUT=logs/…`** — then read that file or `logs/agent-latest.ndjson`. See `docs/logging-harness.md`, `docs/buyer-chat-turn.md`, and `docs/development.md`. Follow **`.claude/skills/backend-log-harness/SKILL.md`** when debugging logs, `chat_turn_summary`, or insights panel payloads.

## Commit Conventions

Use **conventional commits** (e.g. `feat(chat): ...`, `fix(dashboard): ...`). Keep messages descriptive.

## Quality Standards

When reviewing or finalizing changes, verify: correctness (edge cases, null safety), security (no injection, auth checks), code quality (DRY, single responsibility), test coverage for new behavior, error handling, and logging per `docs/logging-guidelines.md`.

## UI Standards

Mobile-first, touch targets ≥44px, no hover-only interactions, no hardcoded colors (use Tamagui theme tokens from `lib/theme/tokens.ts` or semantic sub-themes), micro-interactions on all interactive elements. See `docs/ui-design-principles.md`.

## Updating Documentation

When changes affect architecture, APIs, business rules, or setup, update relevant docs in `docs/`. Key docs:
- `docs/buyer-chat-turn.md` — Buyer chat turn lifecycle (SSE order, step loop, panel, client flush)
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
