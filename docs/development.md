# Development Guide

**Last updated:** 2026-04-09

---

## Table of Contents

- [1. Prerequisites](#1-prerequisites)
- [2. Repository Structure](#2-repository-structure)
- [3. Local Setup](#3-local-setup)
- [4. Environment Variables](#4-environment-variables)
- [5. Development Commands](#5-development-commands)
- [6. Database Migrations](#6-database-migrations)
- [7. Testing](#7-testing)
- [8. Linting & Formatting](#8-linting--formatting)
- [9. Docker Development](#9-docker-development)
  - [Backend logs for debugging](#backend-logs-for-debugging)

---

## 1. Prerequisites

- Node.js 18+
- Python 3.11+
- PostgreSQL 15 (or use SQLite for local dev)

## 2. Repository Structure

```
dealership-ai/
├── Makefile                 # Unified dev commands
├── docker-compose.yml       # PostgreSQL + backend
├── CLAUDE.md                # AI assistant guidance
├── apps/
│   ├── mobile/              # React Native + Expo (iOS/Android/Web)
│   └── backend/             # FastAPI + SQLAlchemy
├── docs/                    # All documentation
└── .venv/                   # Python virtual environment
```

## 3. Local Setup

### Backend

```bash
# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies
make install-backend

# Copy env file
cp apps/backend/.env.example apps/backend/.env
# Edit .env — add your ANTHROPIC_API_KEY

# Start dev server (port 8001)
make dev-backend
```

The backend uses SQLite by default for local development. No PostgreSQL setup needed unless you want to use Docker.

If you pull schema changes (e.g. new columns such as `chat_sessions.compaction_state`) and keep an existing SQLite file, `create_all` will not alter tables — remove `dealership.db` or apply an `ALTER TABLE` manually for that column.

### Frontend

```bash
make install-frontend

# Start Expo dev server (web)
make dev-frontend
```

## 4. Environment Variables

### Backend (`apps/backend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite:///./dealership.db` | Database connection string |
| `SECRET_KEY` | `dev-secret` | JWT signing key (change in production) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `480` | JWT token expiry (8 hours) |
| `CORS_ORIGINS` | `["http://localhost:8081","http://localhost:19006"]` | Allowed CORS origins |
| `ANTHROPIC_API_KEY` | `` | Claude API key (required for chat) |
| `CLAUDE_MODEL` | `claude-sonnet-4-6` | Primary Claude model for chat |
| `CLAUDE_FAST_MODEL` | `claude-haiku-4-5-20251001` | Fast model for titles and lightweight deal-assessment tasks |
| `CLAUDE_MAX_TOKENS` | `4096` | Max tokens per response |
| `CLAUDE_MAX_HISTORY` | `20` | Messages to include in context |
| `CLAUDE_COMPACTION_ENABLED` | `true` | Auto-summarize older turns when context estimate exceeds budget |
| `CLAUDE_CONTEXT_INPUT_BUDGET` | `180000` | Effective input token budget for compaction / pressure |
| `CLAUDE_COMPACTION_WARN_BUFFER_TOKENS` | `20000` | Warn when estimated input ≥ budget minus this |
| `CLAUDE_COMPACTION_AUTO_BUFFER_TOKENS` | `13000` | Auto-compact when estimated input ≥ budget minus this |
| `CLAUDE_COMPACTION_VERBATIM_MESSAGES` | `8` | User/assistant turns kept verbatim after compaction |
| `CLAUDE_COMPACTION_SUMMARY_MAX_TOKENS` | `2048` | Compaction summary max output tokens (`CLAUDE_MODEL`) |
| `CLAUDE_COMPACTION_MAX_CONSECUTIVE_FAILURES` | `3` | Circuit breaker — skip auto-compaction after this many failures |
| `CLAUDE_COMPACTION_PTL_MAX_RETRIES` | `3` | Retries when summarizer hits prompt-too-long |
| `CLAUDE_COMPACTION_STATIC_OVERHEAD_TOKENS` | `12000` | Estimated system + tools + overhead in pressure math |
| `CLAUDE_MAX_TOKENS_RETRIES` | `1` | Retry count when Claude stops at `max_tokens` |
| `CLAUDE_MAX_TOKENS_ESCALATION_FACTOR` | `2` | Multiplier for each truncation retry budget |
| `CLAUDE_MAX_TOKENS_CAP` | `8192` | Hard cap for escalated retry budgets |
| `CLAUDE_STREAM_IDLE_TIMEOUT` | `30` | Idle timeout in seconds before retrying a stalled Claude stream |
| `CLAUDE_STREAM_MAX_RETRIES` | `2` | Stream-level retry count before falling back to non-streaming Claude calls |
| `CLAUDE_API_TIMEOUT` | `120` | Anthropic API timeout in seconds |
| `CLAUDE_SDK_MAX_RETRIES` | `3` | Anthropic SDK retry count for transport-level retryable failures |
| `LOG_LEVEL` | `INFO` | Logging level |
| `LOG_THIRD_PARTY_LEVEL` | `WARNING` | Caps Anthropic/httpcore/httpx verbosity (`DEBUG` only when debugging SDK transport) |
| `LOG_CHAT_HARNESS_FULL` | *(unset)* | Overrides full vs lite `chat_turn_summary`; unset means full outside production and lite in production |
| `LOG_CHAT_HARNESS_VERBOSITY` | `normal` | Set to `verbose` for extra DEBUG harness lines (requires `LOG_LEVEL=DEBUG`) |
| `LOG_CHAT_HARNESS_PREVIEW_MAX_CHARS` | `240` | Max length for lite `chat_turn_summary` previews |
| `LOG_LOCAL_NDJSON_PATH` | *(empty)* | Duplicate NDJSON logs to a local file for Docker and agent workflows |
| `NHTSA_VPIC_BASE_URL` | `https://vpic.nhtsa.dot.gov/api/vehicles` | NHTSA vPIC API base URL |
| `VINAUDIT_API_KEY` | `` | VinAudit API key (required for history/valuation) |
| `VINAUDIT_HISTORY_URL` | `https://marketvalue.vinaudit.com/getvehiclehistoryreport.php` | VinAudit history report URL |
| `VINAUDIT_VALUATION_URL` | `https://marketvalue.vinaudit.com/getmarketvalue.php` | VinAudit valuation URL |

### Frontend

The frontend connects directly to the FastAPI backend. The API base URL is configured in `lib/apiClient.ts`.

## 5. Development Commands

All commands run from the repo root via Make.

### Development Servers
- `make dev-frontend` — Expo dev server (web)
- `make dev-backend` — FastAPI with reload (port 8001)
- `make docker-up` — Full stack: frontend + backend + PostgreSQL

### Install
- `make install-frontend` — npm install
- `make install-backend` — pip install
- `make install-all` — Both

### Backend Quality
- `make lint-backend` — Ruff linter
- `make format-backend` — Ruff formatter
- `make isort-backend` — Sort imports
- `make typecheck-backend` — MyPy
- `make check-backend` — All checks (typecheck + lint + format + test)
- `make check-static` — Static checks only (no tests)

### Testing
- `make test-backend` — Run all backend tests
- `make test-backend-specific TEST='tests/test_auth.py::test_signup'` — Single test
- `make test-backend-watch` — Watch mode
- `cd apps/mobile && npm test` — Run the focused mobile Vitest suite for API-client and store behavior

### Database
- `make migrate-backend` — Apply Alembic migrations
- `make migrations-backend` — Auto-generate new migration
- `make migrate-backend-fresh` — Reset to initial + re-migrate

### Docker
- `make docker-up` — Build & start containers
- `make docker-down` — Stop containers
- `make docker-logs` — Follow logs
- `make backend-log-slice` — Bounded NDJSON excerpt from backend container logs (requires `jq`); see [Backend logs for debugging](#backend-logs-for-debugging)
- `make docker-clean` — Full cleanup (removes volumes)

### Cleanup
- `make clean` — Remove all build artifacts

## 6. Database Migrations

The backend uses Alembic for database migrations.

```bash
# Generate a new migration after model changes
make migrations-backend

# Apply all pending migrations
make migrate-backend

# Reset and re-apply all migrations
make migrate-backend-fresh
```

For local SQLite development, tables are auto-created on startup. Migrations are primarily for PostgreSQL in Docker/production.

## 7. Testing

```bash
# Run all backend tests
make test-backend

# Run mobile/frontend unit tests
cd apps/mobile && npm test

# Run a specific test
make test-backend-specific TEST='tests/test_auth.py'

# Watch mode
make test-backend-watch
```

Tests use an in-memory SQLite database with table recreation between tests.

AI pipeline testing has its own guide covering fake-model tests, snapshots, SSE coverage, and VCR cassette recording/replay:

- `docs/ai-pipeline-testing.md`

Session-level usage tracking is persisted on `ChatSession.usage` and surfaced through session responses. Chat stream events report phase-specific usage (`done` for chat phase, `panel_done` for panel phase), while per-turn assistant usage remains on message history as `usage`.

Useful commands for that workflow:

```bash
# Replay the recorded Claude cassette without network access
cd apps/backend
../../.venv/bin/pytest tests/test_ai_pipeline.py --record-mode=none

# Re-record the Claude cassette after a prompt/model change
cd apps/backend
../../.venv/bin/pytest tests/test_ai_pipeline.py -k test_generate_ai_panel_cards_vcr_smoke --record-mode=rewrite
```

## 8. Linting & Formatting

Backend uses Ruff for linting and formatting:

```bash
make lint-backend      # Check for issues
make format-backend    # Auto-fix formatting
make isort-backend     # Sort imports
make typecheck-backend # MyPy type checking
```

## 9. Docker Development

```bash
# Start frontend + backend + PostgreSQL
make docker-up

# Follow logs
make docker-logs

# Stop
make docker-down

# Full cleanup (removes database volume)
make docker-clean
```

### Backend logs for debugging

Logs are **JSON Lines** (one object per line). See `docs/logging-guidelines.md` for the field schema and PII rules.

**Primary artifact for agents (avoid terminal captures):** Raw `docker compose logs` prefixes each line with the service name, which **breaks one-line JSON**. Do not ask coding agents to read logs from the terminal for analysis.

1. **Live file (recommended for Docker Compose):** With the default stack, compose sets **`LOG_LOCAL_NDJSON_PATH=logs/backend.ndjson`** so the process writes the **same** NDJSON records to **`apps/backend/logs/backend.ndjson`** on your machine (plain JSON per line, no prefix). On startup the backend writes one **`Local NDJSON log sink ready`** line so the file reappears after you delete it. **Do not set `LOG_LOCAL_NDJSON_PATH=` empty in `apps/backend/.env`**—that overrides compose and disables the file sink (you would only see JSON on stderr).

2. **Bounded slice:** Use `make backend-log-slice` when you need rows for a specific **`request_id`** or smaller excerpt.

**Coding agents and large logs:** Do not paste unbounded `docker compose logs` output into a chat. Prefer **`apps/backend/logs/backend.ndjson`** or a **small, filtered slice**:

```bash
# After reproducing under docker compose — copy X-Request-ID from the browser Network tab
make backend-log-slice REQUEST_ID="<paste-id>" OUT=logs/agent-last-query.ndjson

# Optional filters: LEVEL=ERROR LIMIT=500 SERVICE=backend
```

The script updates a stable symlink **`logs/agent-latest.ndjson`** to the file you pass as **`OUT`** (absolute path), so you can always `tail -f logs/agent-latest.ndjson` or `@`-reference that path after a slice.

The `logs/` directory is gitignored. Attach or `@`-reference the slice file or `logs/agent-latest.ndjson` instead of an entire log history.

Pretty-print one line locally ([`logging-guidelines.md`](logging-guidelines.md) describes fields). Example — last `chat_turn_summary` for a request id (after slicing):

```bash
grep chat_turn_summary logs/agent-last-query.ndjson | tail -1
```

Docker Compose runs:
- **frontend** on port 8081 (Expo web)
- **backend** on port 8001
- **PostgreSQL** on port 5433 (avoids conflict with other projects)

The frontend includes an `.npmrc` with `legacy-peer-deps=true` for Docker build compatibility.

### Anthropic API key (Docker)

Compose injects environment from **`apps/backend/.env` only** (not a `.env` at the repository root). Use the exact name `ANTHROPIC_API_KEY=sk-ant-...` with **no** surrounding quotes on the value.

After changing the key:

```bash
make docker-down
make docker-up
```

Verify the container sees a non-empty key (output should be `set`):

```bash
docker compose exec backend python -c "from app.core.config import settings; print('set' if settings.ANTHROPIC_API_KEY.strip() else 'EMPTY')"
```

If that prints `EMPTY`, the file path is wrong, the variable name is misspelled, or the line is commented out. With `LOG_LEVEL=DEBUG` in Compose, startup logs include `ANTHROPIC_API_KEY loaded (suffix …xxxx)` so you can confirm the running process picked up the new key (last four characters only).

If the key is set but the API still returns “credit balance is too low”, confirm in [Anthropic Console](https://console.anthropic.com/) that **Workspaces → API keys** shows the same key, billing is active for that organization, and a few minutes have passed after purchase.

### Seed Users

When `ENV=development` (the default), the backend automatically seeds two test users on startup via the lifespan handler:

| Email | Password | Role |
|-------|----------|------|
| `buyer@test.com` | `password` | buyer |
| `dealer@test.com` | `password` | dealer |

The login screen shows quick sign-in buttons for these accounts when running in dev mode (`__DEV__`).
