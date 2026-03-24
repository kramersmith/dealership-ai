# Dealership AI — Backend, Docs & Tooling Plan

## Context
Add a FastAPI backend with real Claude LLM integration, full Makefile commands, docker-compose, and documentation system to the dealership-ai monorepo. Follow the fueldash project patterns exactly.

---

## Monorepo Structure

```
dealership-ai/
├── Makefile                    # Unified commands (matches fueldash)
├── docker-compose.yml          # frontend + backend + postgres
├── CLAUDE.md                   # Project guidance (updated)
├── apps/
│   ├── mobile/                 # Existing Expo frontend
│   └── backend/                # NEW: FastAPI backend
│       ├── Dockerfile
│       ├── requirements.txt
│       ├── .env.example
│       ├── alembic/
│       │   ├── alembic.ini
│       │   ├── env.py
│       │   └── versions/
│       │       └── 0001_initial.py
│       ├── app/
│       │   ├── main.py
│       │   ├── core/
│       │   │   ├── config.py
│       │   │   ├── deps.py
│       │   │   └── security.py
│       │   ├── db/
│       │   │   ├── session.py
│       │   │   └── base.py
│       │   ├── models/
│       │   │   ├── user.py
│       │   │   ├── session.py
│       │   │   ├── message.py
│       │   │   ├── deal_state.py
│       │   │   └── simulation.py
│       │   ├── schemas/
│       │   │   ├── auth.py
│       │   │   ├── chat.py
│       │   │   ├── session.py
│       │   │   ├── deal.py
│       │   │   └── simulation.py
│       │   ├── routes/
│       │   │   ├── __init__.py
│       │   │   ├── auth.py
│       │   │   ├── chat.py
│       │   │   ├── sessions.py
│       │   │   ├── deals.py
│       │   │   └── simulations.py
│       │   └── services/
│       │       ├── claude.py
│       │       └── simulation.py
│       └── tests/
│           └── conftest.py
└── docs/
    ├── notes.md                 # Existing: project vision
    ├── user-stories.md          # Existing
    ├── mvp.md                   # Existing
    ├── architecture.md          # Existing: technical arch
    ├── one-pager.md             # Existing
    ├── user-research.md         # Existing
    ├── ui-design-principles.md  # Existing
    ├── first-version-quality.md # Existing
    ├── backend-plan.md          # This file
    ├── development.md           # NEW: setup guide
    ├── backend-endpoints.md     # NEW: API reference
    ├── operational-guidelines.md # NEW: rate limits, metrics
    └── logging-guidelines.md    # NEW: log levels, PII
```

---

## Makefile (complete — all fueldash commands)

```makefile
FRONTEND_DIR := apps/mobile
BACKEND_DIR := apps/backend

PYTHON := $(shell test -f .venv/bin/python && echo "$(CURDIR)/.venv/bin/python" \
  || (command -v python3 >/dev/null 2>&1 && echo python3) || echo python)

.PHONY: help install-frontend dev-frontend install-backend dev-backend \
  lint-backend format-backend isort-backend typecheck-backend \
  migrations-backend migrate-backend migrate-backend-fresh \
  test-backend test-backend-specific test-backend-watch \
  check-backend install-all test-all check-all check-static \
  clean-frontend clean-backend clean \
  docker-up docker-down docker-logs docker-clean

# ================================ Help ================================
help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "Frontend:"
	@echo "  install-frontend    Install frontend dependencies"
	@echo "  dev-frontend        Start Expo dev server (web)"
	@echo ""
	@echo "Backend:"
	@echo "  install-backend     Install backend dependencies"
	@echo "  dev-backend         Start FastAPI dev server (port 8001)"
	@echo "  lint-backend        Run Ruff linter"
	@echo "  format-backend      Format with Ruff"
	@echo "  isort-backend       Sort imports with Ruff"
	@echo "  typecheck-backend   Run MyPy"
	@echo "  migrations-backend  Generate new Alembic migration"
	@echo "  migrate-backend     Apply Alembic migrations"
	@echo "  migrate-backend-fresh  Reset to initial + migrate"
	@echo "  test-backend        Run all backend tests"
	@echo "  test-backend-specific  Run specific test (TEST='...')"
	@echo "  test-backend-watch  Watch mode (pytest-watcher)"
	@echo "  check-backend       All backend checks"
	@echo ""
	@echo "Docker:"
	@echo "  docker-up           Build & start containers"
	@echo "  docker-down         Stop containers"
	@echo "  docker-logs         Follow logs"
	@echo "  docker-clean        Full cleanup (removes volumes)"
	@echo ""
	@echo "Combined:"
	@echo "  install-all         Install frontend + backend"
	@echo "  test-all            Run all tests"
	@echo "  check-all           All checks (lint + format + typecheck + test)"
	@echo "  check-static        Static checks only (no tests)"
	@echo "  clean               Clean all build artifacts"

# ================================ Frontend ================================
install-frontend:
	cd $(FRONTEND_DIR) && npm install

dev-frontend:
	cd $(FRONTEND_DIR) && npx expo start --web

# ================================ Backend ================================
install-backend:
	cd $(BACKEND_DIR) && pip install -r requirements.txt

dev-backend:
	cd $(BACKEND_DIR) && uvicorn app.main:app --reload

lint-backend:
	$(PYTHON) -m ruff check $(BACKEND_DIR)

format-backend:
	$(PYTHON) -m ruff format $(BACKEND_DIR)
	$(PYTHON) -m ruff check --fix $(BACKEND_DIR)

isort-backend:
	$(PYTHON) -m ruff check --select I --fix $(BACKEND_DIR)

typecheck-backend:
	cd $(BACKEND_DIR) && $(PYTHON) -m mypy . --exclude 'conftest\.py' --exclude 'tests/conftest\.py'

migrations-backend:
	cd $(BACKEND_DIR) && alembic revision --autogenerate -m "Add new table"

migrate-backend:
	cd $(BACKEND_DIR) && $(PYTHON) -m alembic upgrade head

migrate-backend-fresh:
	cd $(BACKEND_DIR) && $(PYTHON) -m alembic downgrade 0001_initial && $(PYTHON) -m alembic upgrade head

test-backend:
	cd $(BACKEND_DIR) && $(PYTHON) -m pytest

test-backend-specific:
ifndef TEST
	$(error Missing TEST selector. Example: make test-backend-specific TEST='tests/test_auth.py::test_signup')
endif
	cd $(BACKEND_DIR) && $(PYTHON) -m pytest $(TEST)

test-backend-watch:
	cd $(BACKEND_DIR) && $(PYTHON) -m pytest_watcher tests --now

check-backend: typecheck-backend lint-backend isort-backend format-backend test-backend

# ================================ All ================================
install-all: install-frontend install-backend

test-all: test-backend

check-all: check-backend

check-static: lint-backend format-backend isort-backend typecheck-backend

clean-frontend:
	rm -rf "$(FRONTEND_DIR)/node_modules" "$(FRONTEND_DIR)/dist"

clean-backend:
	rm -rf "$(BACKEND_DIR)/__pycache__" "$(BACKEND_DIR)/.pytest_cache" "$(BACKEND_DIR)/.mypy_cache" "$(BACKEND_DIR)/.ruff_cache"
	find "$(BACKEND_DIR)" -type d -name "__pycache__" -prune -exec rm -rf {} +

clean: clean-frontend clean-backend

# ================================ Docker ================================
docker-up:
	docker compose up --build

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

docker-clean:
	docker compose down -v
	docker system prune -a
```

---

## Docker Compose

> **Note:** The actual `docker-compose.yml` has been updated since this plan was written. The current version includes a frontend service and uses port 8001 for backend, 5433 for PostgreSQL. See the actual file for the definitive configuration.

```yaml
services:
  frontend:
    build:
      context: ./apps/mobile
    ports:
      - "8081:8081"
    depends_on:
      - backend

  backend:
    build:
      context: ./apps/backend
    ports:
      - "8001:8001"
    env_file:
      - ./apps/backend/.env
    environment:
      - DATABASE_URL=postgresql+psycopg://dealership:dealership@db:5432/dealership
      - SECRET_KEY=change-me
      - CORS_ORIGINS=["http://localhost:8081","http://localhost:19006"]
    command: uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
    depends_on:
      - db

  db:
    image: postgres:15
    environment:
      POSTGRES_USER: dealership
      POSTGRES_PASSWORD: dealership
      POSTGRES_DB: dealership
    ports:
      - "5433:5432"
    volumes:
      - dealership_db:/var/lib/postgresql/data

volumes:
  dealership_db:
```

---

## Backend Config

```python
class Settings(BaseSettings):
    ENV: str = "development"
    LOG_LEVEL: str = "INFO"
    API_PREFIX: str = "/api"
    DATABASE_URL: str = "sqlite:///./dealership.db"
    SECRET_KEY: str = "dev-secret"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 8
    CORS_ORIGINS: list[str] = ["http://localhost:8081", "http://localhost:19006"]

    # Claude API
    ANTHROPIC_API_KEY: str = ""
    CLAUDE_MODEL: str = "claude-sonnet-4-6"
    CLAUDE_MAX_TOKENS: int = 1024
    CLAUDE_MAX_HISTORY: int = 20

    model_config = SettingsConfigDict(env_file=".env")
```

---

## Database Schema

**User** — id, email, hashed_password, role (buyer/dealer), display_name, created_at

**ChatSession** — id, user_id (FK), title, session_type (buyer_chat/dealer_sim), linked_session_ids (JSON), created_at, updated_at

**Message** — id, session_id (FK), role (user/assistant/system), content, image_url, tool_calls (JSON), created_at

**DealState** — id, session_id (FK, unique), phase, all number fields, vehicle fields, score fields, checklist (JSON), timer_started_at, updated_at

**Simulation** — id, session_id (FK, unique), scenario_type, difficulty, ai_persona (JSON), score, feedback, completed_at

---

## Routes

```
POST   /api/auth/signup
POST   /api/auth/login
POST   /api/auth/refresh

GET    /api/sessions
POST   /api/sessions
GET    /api/sessions/{id}
PATCH  /api/sessions/{id}
DELETE /api/sessions/{id}

POST   /api/chat/{session_id}/message    # SSE stream
GET    /api/chat/{session_id}/messages

GET    /api/deal/{session_id}

GET    /api/simulations/scenarios
POST   /api/simulations
POST   /api/simulations/{id}/message     # SSE stream
```

---

## Claude Integration

5 tools: update_deal_numbers, update_deal_phase, update_scorecard, set_vehicle, update_checklist

SSE streaming: text chunks + tool_result events + done event

System prompt: role definition + current deal state JSON + tool instructions + linked session context

---

## Documentation to Create

### docs/development.md
- Prerequisites (Node 18+, Python 3.11+, PostgreSQL 15)
- Repository structure
- Local setup (frontend, backend, venv)
- Environment variables (frontend + backend)
- Development commands (all Makefile targets)
- Database migrations
- Testing
- Linting & formatting
- Docker development

### docs/backend-endpoints.md
- Complete API reference with all routes
- Request/response schemas
- Auth requirements per endpoint

### docs/operational-guidelines.md
- Rate limiting policy
- Environment variables reference
- HTTP security headers
- Logging config pointer
- Custom metrics (future)

### docs/logging-guidelines.md
- Log level reference (CRITICAL → DEBUG)
- Structured logging config
- PII prevention rules
- Log injection guidance

---

## CLAUDE.md Update

Rewrite to match fueldash style:
- Project overview (two apps, pre-production)
- Development philosophy (reference first-version-quality.md)
- All Make commands with descriptions
- Architecture (backend layered, frontend React Native)
- Environment setup
- Commit conventions (conventional commits)
- Quality standards
- Documentation update references

---

## Implementation Order

| Phase | What |
|-------|------|
| 1 | Makefile, docker-compose.yml, .env.example |
| 2 | Backend scaffolding: requirements.txt, Dockerfile, main.py, config.py, session.py, base.py, deps.py, security.py |
| 3 | Models + Alembic migrations |
| 4 | Auth routes (signup, login, refresh) |
| 5 | Session routes (CRUD) |
| 6 | Claude service (tools, streaming, system prompt) |
| 7 | Chat route (SSE endpoint) |
| 8 | Deal state + simulation routes |
| 9 | docs/development.md, docs/backend-endpoints.md |
| 10 | docs/operational-guidelines.md, docs/logging-guidelines.md |
| 11 | Update CLAUDE.md |
| 12 | Frontend: apiClient.ts connected to real backend (mock layer removed) |
| 13 | End-to-end test |

---

## Verification

- `make install-backend` succeeds
- `make dev-backend` starts on :8001
- `make docker-up` starts frontend + postgres + backend
- `make migrate-backend` creates tables
- `make lint-backend` / `make format-backend` / `make typecheck-backend` pass
- `make test-backend` passes
- POST /api/auth/signup creates user
- POST /api/auth/login returns JWT
- POST /api/chat/{id}/message streams SSE with text + tool_result events
- Frontend sends message → real Claude response → dashboard updates live
