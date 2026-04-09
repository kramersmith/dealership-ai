# Logging Guidelines

**Last updated:** 2026-04-09

---

## Log Level Reference

| Level | When to use |
|-------|-------------|
| `CRITICAL` | System cannot continue (database unreachable, missing required config) |
| `ERROR` | Operation failed, needs investigation (Claude API failure, unhandled exception) |
| `WARNING` | Unexpected but recoverable (rate limit approached, fallback used, deprecated usage) |
| `INFO` | Normal operations worth noting (server start, user signup, session created, deal state updated) |
| `DEBUG` | App-internal diagnostics (e.g. per-tool keys, deal_state skips). **Not** full HTTP/Anthropic payloads — third-party SDK loggers are capped separately (see below). |

## Usage

- Use `INFO` for business events: user actions, deal milestones, tool call executions
- Use `INFO` for Claude usage accounting events: model, token counts, cache token counts, computed USD cost, latency, and session context
- Use `WARNING` for things that might need attention but aren't errors
- Use `ERROR` only for actual failures that prevent an operation from completing
- Use `DEBUG` for app-internal troubleshooting — never log sensitive data at any level
- **`LOG_THIRD_PARTY_LEVEL`** (default `WARNING`): caps `anthropic`, `httpcore`, and `httpx` so turning `LOG_LEVEL=DEBUG` does not dump entire prompts or request bodies to stderr. Set to `DEBUG` only when debugging transport/SDK issues.
- When logging upstream HTTP/SSE failures at `WARNING` or `ERROR`, log status/category and sanitized context — not raw proxy HTML, tracebacks, or opaque response bodies

## PII Prevention

Never log:
- Passwords or password hashes
- Full API keys (log last 4 chars only: `sk-...xxxx`)
- Full VINs in backend or browser logs (mask all but the last 6 characters when VIN-level correlation is required)
- Email addresses in bulk (individual user actions at INFO are acceptable)
- Financial details from deal sheets (log that analysis occurred, not the content)
- **Full** chat bodies only in **`chat_turn_summary`** when **`harness_shape` is `full`** (see [logging-harness.md](logging-harness.md), ADR-0021). Production defaults to **lite** previews. Do not enable full harness logging indirectly via third-party SDK DEBUG loggers

Frontend/browser logs follow the same PII rules. In particular, VIN-assist telemetry must redact VINs before writing to the console.

Allowed in Claude usage logs:
- Model name
- Token counts
- Cache token counts
- Computed cost and latency
- Session ID

Do not include raw prompt text, message bodies, or extracted financial line items in usage logs.

**Prompt cache break logs** (`Prompt cache break detected`) are INFO-level and must contain only SHA-256 hex digests and component labels (for example `system`, `tools`, `model`) — never raw system prompts, tool JSON, or message bodies.

## JSON log format (NDJSON)

The backend writes **one JSON object per line** to stderr (JSON Lines / NDJSON). The host or log product ingests stdout/stderr as usual. For **local development and coding agents**, optionally set **`LOG_LOCAL_NDJSON_PATH`** so the **same** records are also appended to a file (no Docker compose line prefix). Docker Compose enables this by default — see `docs/development.md`.

Stable fields (v1):

| Field | Description |
|--------|-------------|
| `timestamp` | When the record was created |
| `level` | `DEBUG` … `CRITICAL` |
| `name` | Logger name (Python module path) |
| `message` | Short message (see PII rules above) |
| `request_id` | HTTP correlation id (`-` outside a request) |
| `http_method` / `http_path` | Request line context (`-` when N/A) |
| `client_addr` / `request_line` / `status_code` | Populated on uvicorn access records; otherwise `-` |

Responses echo a validated **`X-Request-ID`** (and generate a fresh one when the inbound value is blank or unsafe), and CORS exposes it to browsers. Use that id to filter logs in your provider or via `make backend-log-slice` locally (see `docs/development.md`).

## Chat turn summary (buyer stream)

After a successful buyer chat turn commit, the backend logs an **INFO** line whose `message` starts with `chat_turn_summary` followed by a **JSON object**. See **[logging-harness.md](logging-harness.md)** and **ADR-0021** for full vs lite policy.

**Always present:** `event`, `session_id`, `user_chars`, `assistant_chars`, `tool_names`, `harness_shape` (`full` | `lite`).

**When `harness_shape` is `full` (typical non-production):** `user_text`, `assistant_text`, `tool_calls`, optional `panel_cards` — string fields are sanitized per the PII rules above, and secret-labeled keys are redacted.

**When `harness_shape` is `lite` (default for `ENV=production`):** `user_preview`, `assistant_preview` (bounded length), optional `panel_card_count` / `panel_card_kinds` — no full tool args or card bodies.

Optional **DEBUG** lines `chat_harness_verbose` when `LOG_CHAT_HARNESS_VERBOSITY=verbose` and root log level allows DEBUG.

Use with `request_id` correlation. Full `harness_shape` lines may be large; tail `logs/agent-latest.ndjson` after `make backend-log-slice OUT=...` (see `docs/development.md`).

## Configuration

Set via environment variable:
```
LOG_LEVEL=INFO     # development
LOG_LEVEL=WARNING  # production
ENV=production     # default lite chat_turn_summary unless LOG_CHAT_HARNESS_FULL=true
LOG_CHAT_HARNESS_VERBOSITY=verbose  # optional extra DEBUG harness lines
```

Harness-focused variables are documented in [logging-harness.md](logging-harness.md).
