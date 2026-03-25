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
- **Services** (`app/services/`) — Business logic: Claude API integration with tool definitions, SSE streaming
- **Models** (`app/models/`) — SQLAlchemy ORM: User, ChatSession, Message, DealState, Simulation
- **Core** (`app/core/`) — Config (Pydantic Settings), security (JWT + bcrypt), deps (FastAPI DI)

Key patterns:
- Claude integration uses two models: `claude-sonnet-4-6` (`CLAUDE_MODEL`) for primary chat with 7 tool definitions, and `claude-haiku-4-5-20251001` (`CLAUDE_FAST_MODEL`) for lightweight tasks like quick action generation
- Two-pass response architecture: if the primary Claude response contains only tool calls and no text, a follow-up text-only call generates the conversational response
- Server-side quick actions: if Claude doesn't call `update_quick_actions`, the backend generates suggestions via Haiku (`CLAUDE_FAST_MODEL`) and emits them as a `tool_result` SSE event
- Chat endpoint streams SSE events: `text` (conversation chunks), `tool_result` (dashboard updates), `followup_done` (text from two-pass follow-up), `done`
- Backend enums (`app/models/enums.py`): UserRole, SessionType, MessageRole, DealPhase, ScoreStatus, BuyerContext, Difficulty (all `StrEnum`)
- Lifespan handler (not `on_event`) creates tables and seeds dev users on startup
- Seed users in development: `buyer@test.com` and `dealer@test.com` (password: `password`)
- SQLite for local dev, PostgreSQL via Docker for production
- JWT auth with Bearer tokens

### Frontend (`apps/mobile`)

React Native + Expo + Tamagui + Zustand:

- **Screens** (`app/`) — Expo Router file-based routing with a single `(app)` route group (role-gated screens)
- **Components** (`components/`) — Chat (bubbles, input, voice, WelcomePrompts), Insights (phase, numbers, scorecard, vehicle, checklist, timer, quick actions), Shared (cards, buttons, pills, menu)
- **Stores** (`stores/`) — Zustand: auth, chat, deal, simulation, theme
- **Hooks** (`hooks/`) — useChat (orchestrates messages + tool calls with event-based SSE parsing and optimistic rollback), useScreenWidth (responsive breakpoint)
- **API** (`lib/`) — API client connecting to the FastAPI backend (no mock layer), `snakeToCamel` utility for mapping backend snake_case fields to frontend camelCase

Key patterns:
- WelcomePrompts component (`components/chat/WelcomePrompts.tsx`) shows 3 situation cards when starting a new buyer chat session; user can skip by typing directly
- Buyer context (researching, reviewing_deal, at_dealership) drives static fallback quick actions, insights panel ordering, system prompt preamble, and hardcoded greeting messages
- Quick actions are dynamically generated by Claude via the `update_quick_actions` tool; static context-based fallbacks show before the first AI exchange and when dynamic actions go stale
- AuthGuard component (`components/shared/AuthGuard.tsx`) protects the `(app)` route group
- RoleGuard component (`components/shared/RoleGuard.tsx`) gates individual screens by role (buyer/dealer)
- Role is set at registration and cannot be changed in production (role switching is dev-only via `__DEV__`)
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
- Backend: `DATABASE_URL`, `SECRET_KEY`, `ANTHROPIC_API_KEY`, `CLAUDE_FAST_MODEL`, `CORS_ORIGINS`
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
