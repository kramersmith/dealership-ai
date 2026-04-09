---
name: backend-log-harness
description: >-
  Reads Dealership AI backend NDJSON logs to debug chat turns, tool calls, and insights
  panel payloads. Use when the user mentions backend logs, chat_turn_summary, request_id,
  docker logs, log slice, verifying the insights panel, or harness debugging. Do not use
  raw docker compose terminal output as the primary log source.
---

# Backend log harness (NDJSON)

## Do not use raw `docker compose logs` / IDE terminal as the primary source

Compose prefixes lines with `service  | `, which **invalidates** NDJSON. Prefer files below.

## Read these paths (in order)

1. **`apps/backend/logs/backend.ndjson`** — clean JSON Lines; written when **`LOG_LOCAL_NDJSON_PATH`** is set (default in repo `docker-compose.yml`; optional in `apps/backend/.env` for `make dev-backend`).

2. **`make backend-log-slice REQUEST_ID=… OUT=logs/…`** — strips prefix; then read `OUT` or **`logs/agent-latest.ndjson`**.

Use **`Read`** on the file path after the user reproduces.

## Correlation

- **`X-Request-ID`** (network tab) ↔ log field **`request_id`**.

## `chat_turn_summary`

Locate **INFO** log lines where **`message`** starts with **`chat_turn_summary `**; the remainder is a JSON object (parse it).

- **`harness_shape`**: `full` vs `lite`.  
- **Full**: includes **`user_text`**, **`assistant_text`**, **`tool_calls`**, and usually **`panel_cards`** when the panel ran; string fields are sanitized per the logging guidelines (VINs/emails/phones/secret-like tokens masked).

## Insights panel content in logs

**With `harness_shape: full` — yes.** Inspect:

- **`panel_cards`**: full card objects; **`content`** holds the body (phase strip, warning text, numbers rows, vehicle specs, checklist items, etc.).
- **`tool_calls`** entry **`update_insights_panel`** → **`args.cards`**: same cards the SSE path persists.

**With `lite`**, only **`panel_card_kinds`** / **`panel_card_count`** — not enough to verify panel copy end-to-end.

## References

`docs/logging-harness.md`, `docs/logging-guidelines.md`, `docs/development.md`, `docs/adr/0021-chat-harness-logging.md`
