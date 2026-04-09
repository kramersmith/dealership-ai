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
| `DEBUG` | Detailed diagnostic info (full Claude request/response, SQL queries, SSE event details) |

## Usage

- Use `INFO` for business events: user actions, deal milestones, tool call executions
- Use `INFO` for Claude usage accounting events: model, token counts, cache token counts, computed USD cost, latency, and session context
- Use `WARNING` for things that might need attention but aren't errors
- Use `ERROR` only for actual failures that prevent an operation from completing
- Use `DEBUG` for development troubleshooting — never log sensitive data at any level
- When logging upstream HTTP/SSE failures at `WARNING` or `ERROR`, log status/category and sanitized context — not raw proxy HTML, tracebacks, or opaque response bodies

## PII Prevention

Never log:
- Passwords or password hashes
- Full API keys (log last 4 chars only: `sk-...xxxx`)
- Full VINs in backend or browser logs (mask all but the last 6 characters when VIN-level correlation is required)
- Email addresses in bulk (individual user actions at INFO are acceptable)
- Financial details from deal sheets (log that analysis occurred, not the content)
- Chat message content at INFO level (log at DEBUG only)

Frontend/browser logs follow the same PII rules. In particular, VIN-assist telemetry must redact VINs before writing to the console.

Allowed in Claude usage logs:
- Model name
- Token counts
- Cache token counts
- Computed cost and latency
- Session ID

Do not include raw prompt text, message bodies, or extracted financial line items in usage logs.

**Prompt cache break logs** (`Prompt cache break detected`) are INFO-level and must contain only SHA-256 hex digests and component labels (for example `system`, `tools`, `model`) — never raw system prompts, tool JSON, or message bodies.

## Configuration

Set via environment variable:
```
LOG_LEVEL=INFO     # development
LOG_LEVEL=WARNING  # production
```
