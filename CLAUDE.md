# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dealership AI is two separate AI-powered smartphone apps for the car buying experience — a buyer app and a dealer app. Monorepo with a FastAPI backend and React Native (Expo) frontend. This is a **pre-production first version** — not yet launched.

- **Buyer app** — helps buyers understand deals, spot unauthorized charges, negotiate effectively
- **Dealer app** — AI training simulations where salespeople practice against AI customer scenarios
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
- `make docker-up` — Full stack: backend + PostgreSQL

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
- Claude integration uses 5 tool definitions (update_deal_numbers, update_deal_phase, update_scorecard, set_vehicle, update_checklist) to drive the frontend dashboard
- Chat endpoint streams SSE events: `text` (conversation chunks), `tool_result` (dashboard updates), `done`
- SQLite for local dev, PostgreSQL via Docker for production
- JWT auth with Bearer tokens

### Frontend (`apps/mobile`)

React Native + Expo + Tamagui + Zustand:

- **Screens** (`app/`) — Expo Router file-based routing with `(buyer)` and `(dealer)` route groups
- **Components** (`components/`) — Chat (bubbles, input, voice), Dashboard (phase, numbers, scorecard, vehicle, checklist, timer, quick actions), Shared (cards, buttons, pills, menu)
- **Stores** (`stores/`) — Zustand: auth, chat, deal, simulation, theme
- **Hooks** (`hooks/`) — useChat (orchestrates messages + tool calls), useScreenWidth (responsive breakpoint)
- **Mock** (`mock/`) — Swappable mock API layer (one-line change in `lib/api.ts` to switch to real backend)

Key patterns:
- Facebook dark mode color palette with light mode support
- All colors centralized in `lib/colors.ts` — no hardcoded hex in components
- Mobile-first with responsive desktop layout (dashboard sidebar at ≥768px)
- Micro-interactions on all interactive elements (animations, feedback)
- Touch targets ≥44px on all interactive elements
- See `docs/ui-design-principles.md` for full guidelines

### Environment

Both apps use `.env` files (copy from `.env.example`). Key variables:
- Backend: `DATABASE_URL`, `SECRET_KEY`, `ANTHROPIC_API_KEY`, `CORS_ORIGINS`
- Frontend: Mock API by default, swap to real in `lib/api.ts`

## Commit Conventions

Use **conventional commits** (e.g. `feat(chat): ...`, `fix(dashboard): ...`). Keep messages descriptive.

## Quality Standards

When reviewing or finalizing changes, verify: correctness (edge cases, null safety), security (no injection, auth checks), code quality (DRY, single responsibility), test coverage for new behavior, error handling, and logging per `docs/logging-guidelines.md`.

## UI Standards

Mobile-first, touch targets ≥44px, no hover-only interactions, no hardcoded colors (use theme tokens or `lib/colors.ts`), micro-interactions on all interactive elements. See `docs/ui-design-principles.md`.

## Updating Documentation

When changes affect architecture, APIs, business rules, or setup, update relevant docs in `docs/`. Key docs:
- `docs/architecture.md` — Technical architecture
- `docs/notes.md` — Project vision and features
- `docs/development.md` — Setup guide and env vars
- `docs/operational-guidelines.md` — Ports, security, cost control
- `docs/logging-guidelines.md` — Log levels, PII rules
- `docs/ui-design-principles.md` — Frontend design standards
- `docs/backend-plan.md` — Backend implementation plan
