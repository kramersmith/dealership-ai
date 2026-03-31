# Operational Guidelines

**Last updated:** 2026-03-31

---

## Table of Contents

- [1. API Ports](#1-api-ports)
- [2. Environment Variables](#2-environment-variables)
- [3. Security](#3-security)
- [4. Logging](#4-logging)
- [5. Claude API Cost Control](#5-claude-api-cost-control)

---

## 1. API Ports

| Service | Port | Notes |
|---------|------|-------|
| Backend (FastAPI) | 8001 | Avoids conflict with fueldash on 8000 |
| PostgreSQL | 5433 | Avoids conflict with fueldash on 5432 |
| Frontend (Expo) | 8081 | Default Expo port |

## 2. Environment Variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `DATABASE_URL` | No | SQLite | PostgreSQL in Docker |
| `SECRET_KEY` | Yes (prod) | `dev-secret` | Must change in production |
| `ANTHROPIC_API_KEY` | Yes | `` | Required for chat functionality |
| `CLAUDE_MODEL` | No | `claude-sonnet-4-6` | Claude model for AI interactions |
| `CORS_ORIGINS` | No | localhost origins | Explicit HTTPS in production |
| `ENV` | No | `development` | Controls seed users and dev features |
| `LOG_LEVEL` | No | `INFO` | See logging-guidelines.md |

## 3. Security

### Production Requirements

- `SECRET_KEY` must not be `dev-secret`
- `CORS_ORIGINS` must be explicit HTTPS origins (no wildcards)
- `ANTHROPIC_API_KEY` must be set

### HTTP Security Headers (future)

When deploying:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security` (HTTPS only)

### Authentication

- JWT-based with Bearer tokens
- Tokens signed with `SECRET_KEY`
- Default expiry: 8 hours
- All routes except `/api/auth/*` and `/health` require authentication
- Frontend uses AuthGuard component on the unified `(app)` route group, with RoleGuard on individual screens for role-based access

### Seed Users (Development Only)

When `ENV=development`, the backend seeds two test accounts on startup via the lifespan handler:
- `buyer@test.com` / `password` (role: buyer)
- `dealer@test.com` / `password` (role: dealer)

The login screen shows quick sign-in buttons for these accounts in dev mode (`__DEV__`). These credentials must never be used in production.

## 4. Logging

See `docs/logging-guidelines.md` for log level reference, PII rules, and configuration.

## 5. Claude API Cost Control

- Default model: `claude-sonnet-4-6` (balances cost and quality)
- Max tokens per response: 4096
- Message history truncated to last 20 messages per request
- Deal assessment safety net: 512 max tokens (Haiku fast model)
- Situation assessment: 1024 max tokens (Haiku fast model)
- Future: per-user daily token limits, usage tracking table
