# Operational Guidelines

**Last updated:** 2026-04-09

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
| `CLAUDE_MODEL` | No | `claude-sonnet-4-6` | Claude model for AI interactions (also used for context compaction summarization when enabled) |
| `CLAUDE_FAST_MODEL` | No | `claude-haiku-4-5-20251001` | Fast Claude model for lightweight tasks |
| `CLAUDE_COMPACTION_ENABLED` | No | `true` | Disable with `false` to turn off auto context compaction |
| `CLAUDE_CONTEXT_INPUT_BUDGET` | No | `180000` | Policy input-token budget for compaction triggers and UI pressure |
| `CLAUDE_COMPACTION_WARN_BUFFER_TOKENS` | No | `20000` | Warn tier for `context_pressure` |
| `CLAUDE_COMPACTION_AUTO_BUFFER_TOKENS` | No | `13000` | Auto-compact threshold buffer |
| `CLAUDE_COMPACTION_VERBATIM_MESSAGES` | No | `8` | Verbatim tail size after a compaction fold |
| `CLAUDE_STREAM_IDLE_TIMEOUT` | No | `30` | Idle timeout before retrying stalled Claude streams |
| `CLAUDE_STREAM_MAX_RETRIES` | No | `2` | Stream retry budget before non-streaming fallback |
| `CLAUDE_API_TIMEOUT` | No | `120` | Anthropic API timeout in seconds |
| `CLAUDE_SDK_MAX_RETRIES` | No | `3` | Anthropic SDK retry budget for retryable transport failures |
| `CLAUDE_MAX_TOKENS_RETRIES` | No | `1` | Bounded retry count for `max_tokens` truncation |
| `CLAUDE_MAX_TOKENS_ESCALATION_FACTOR` | No | `2` | Retry multiplier for truncation recovery |
| `CLAUDE_MAX_TOKENS_CAP` | No | `8192` | Hard cap for truncation retry budgets |
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

Operational policy for chat/API errors:
- User-visible errors may preserve explicit structured 4xx detail returned by our own backend when that detail is safe and actionable.
- User-visible errors must never expose raw 5xx bodies, proxy HTML, traceback text, or upstream service payloads. Return a generic safe message instead.
- Browser-side diagnostic logging follows the same PII rules as backend logging, including VIN masking.

## 5. Claude API Cost Control

- Default model: `claude-sonnet-4-6` (balances cost and quality)
- Fast model: `claude-haiku-4-5-20251001` for titles and other lightweight tasks
- Max tokens per response: 4096
- Model-facing history is a projected tail (last 20 user/assistant turns) plus optional rolling summary; full history stays in the database. Compaction uses the primary model when it runs (see `docs/adr/0017-context-compaction-custom.md`)
- Bounded `max_tokens` retries use configurable escalation rather than silently truncating responses
- Per-turn assistant usage is persisted on messages, and cumulative per-session usage is persisted on `ChatSession.usage` with per-model token and cost totals
- Pricing is tracked server-side from a fixed backend pricing table for deterministic accounting; it is not fetched dynamically at runtime
- Prompt cache break detection fingerprints stable request components (system prompt, tools, model) via SHA-256; break counts are persisted on the session usage ledger for cost diagnostics
