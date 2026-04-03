# Logging Guidelines

**Last updated:** 2026-04-03

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

## PII Prevention

Never log:
- Passwords or password hashes
- Full API keys (log last 4 chars only: `sk-...xxxx`)
- Email addresses in bulk (individual user actions at INFO are acceptable)
- Financial details from deal sheets (log that analysis occurred, not the content)
- Chat message content at INFO level (log at DEBUG only)

Allowed in Claude usage logs:
- Model name
- Token counts
- Cache token counts
- Computed cost and latency
- Session ID

Do not include raw prompt text, message bodies, or extracted financial line items in usage logs.

## Configuration

Set via environment variable:
```
LOG_LEVEL=INFO     # development
LOG_LEVEL=WARNING  # production
```
