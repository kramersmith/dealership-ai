# Development Guide

**Last updated:** 2026-03-26

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
| `CORS_ORIGINS` | `["http://localhost:8081"]` | Allowed CORS origins |
| `ANTHROPIC_API_KEY` | `` | Claude API key (required for chat) |
| `CLAUDE_MODEL` | `claude-sonnet-4-6` | Primary Claude model for chat |
| `CLAUDE_FAST_MODEL` | `claude-haiku-4-5-20251001` | Fast model for quick actions, titles, deal assessment |
| `CLAUDE_MAX_TOKENS` | `4096` | Max tokens per response |
| `CLAUDE_MAX_HISTORY` | `20` | Messages to include in context |
| `LOG_LEVEL` | `INFO` | Logging level |

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

### Database
- `make migrate-backend` — Apply Alembic migrations
- `make migrations-backend` — Auto-generate new migration
- `make migrate-backend-fresh` — Reset to initial + re-migrate

### Docker
- `make docker-up` — Build & start containers
- `make docker-down` — Stop containers
- `make docker-logs` — Follow logs
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

# Run a specific test
make test-backend-specific TEST='tests/test_auth.py'

# Watch mode
make test-backend-watch
```

Tests use an in-memory SQLite database with table recreation between tests.

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

Docker Compose runs:
- **frontend** on port 8081 (Expo web)
- **backend** on port 8001
- **PostgreSQL** on port 5433 (avoids conflict with other projects)

The frontend includes an `.npmrc` with `legacy-peer-deps=true` for Docker build compatibility.

### Seed Users

When `ENV=development` (the default), the backend automatically seeds two test users on startup via the lifespan handler:

| Email | Password | Role |
|-------|----------|------|
| `buyer@test.com` | `password` | buyer |
| `dealer@test.com` | `password` | dealer |

The login screen shows quick sign-in buttons for these accounts when running in dev mode (`__DEV__`).
