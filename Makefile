FRONTEND_DIR := apps/mobile
BACKEND_DIR := apps/backend

# Prefer venv python if it exists; else python3, else python
PYTHON := $(shell test -f .venv/bin/python && echo "$(CURDIR)/.venv/bin/python" || (command -v python3 >/dev/null 2>&1 && echo python3) || echo python)

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
	@echo "  install-frontend       Install frontend dependencies"
	@echo "  dev-frontend           Start Expo dev server (web)"
	@echo ""
	@echo "Backend:"
	@echo "  install-backend        Install backend dependencies"
	@echo "  dev-backend            Start FastAPI dev server (port 8001)"
	@echo "  lint-backend           Run Ruff linter"
	@echo "  format-backend         Format with Ruff"
	@echo "  isort-backend          Sort imports with Ruff"
	@echo "  typecheck-backend      Run MyPy"
	@echo "  migrations-backend     Generate new Alembic migration"
	@echo "  migrate-backend        Apply Alembic migrations"
	@echo "  migrate-backend-fresh  Reset to initial + migrate"
	@echo "  test-backend           Run all backend tests"
	@echo "  test-backend-specific  Run specific test (TEST='...')"
	@echo "    e.g. make test-backend-specific TEST='tests/test_auth.py::test_signup'"
	@echo "  test-backend-watch     Watch mode (pytest-watcher)"
	@echo "  check-backend          All backend checks (typecheck + lint + format + test)"
	@echo ""
	@echo "Docker:"
	@echo "  docker-up              Build & start full stack (frontend + backend + db)"
	@echo "  docker-down            Stop containers"
	@echo "  docker-logs            Follow logs"
	@echo "  docker-clean           Full cleanup (removes volumes)"
	@echo ""
	@echo "Combined:"
	@echo "  install-all            Install frontend + backend"
	@echo "  test-all               Run all tests"
	@echo "  check-all              All checks (lint + format + typecheck + test)"
	@echo "  check-static           Static checks only (no tests)"
	@echo "  clean                  Clean all build artifacts"

# ================================ Frontend ================================
install-frontend:
	cd $(FRONTEND_DIR) && npm install

dev-frontend:
	cd $(FRONTEND_DIR) && npx expo start --web

# ================================ Backend ================================
install-backend:
	cd $(BACKEND_DIR) && pip install -r requirements.txt

dev-backend:
	cd $(BACKEND_DIR) && uvicorn app.main:app --reload --port 8001

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
