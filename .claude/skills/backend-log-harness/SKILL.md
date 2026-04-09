---
name: backend-log-harness
description: >-
  Reads and interprets Dealership AI backend NDJSON logs for debugging chat turns,
  tools, and insights panel output. Use when the user asks about logs, chat_turn_summary,
  request_id correlation, Docker logging, insights panel verification, or local harness
  debugging. Triggers - "backend logs", "chat_turn_summary", "log slice", "insights panel logs".
---

# Backend log harness (NDJSON)

## Hard rule: do not use raw terminal / docker compose logs for parsing

`docker compose logs` prefixes every line with `service_name  | `. That prefix **breaks** JSON Lines (NDJSON). Do not grep or `Read` terminal captures as the primary source when a clean file exists.

## Where to read logs (in order)

1. **`apps/backend/logs/backend.ndjson`** (recommended under Docker Compose)  
   - Set via **`LOG_LOCAL_NDJSON_PATH`** (default in `docker-compose.yml`: `logs/backend.ndjson` inside the backend container → **`apps/backend/logs/backend.ndjson`** on the host).  
   - Each line is a **single JSON object** with `timestamp`, `level`, `name`, `message`, `request_id`, HTTP fields, etc.

2. **`make backend-log-slice`** (filtered excerpt from the Docker backend container)  
   - Strips the compose prefix; requires `jq`.  
   - Example: `make backend-log-slice REQUEST_ID="<from X-Request-ID>" OUT=logs/agent-last-query.ndjson`  
   - Updates symlink **`logs/agent-latest.ndjson`** → the `OUT` file path when `OUT` is set.

3. **Local uvicorn** (`make dev-backend`): set `LOG_LOCAL_NDJSON_PATH=logs/backend.ndjson` in `apps/backend/.env` so the same file path is populated.

Use the **Read** tool on the file path. Ask the user to reproduce if the file is missing or stale.

## Correlation

- Browser / client: **`X-Request-ID`** on the chat request.  
- Log records: **`request_id`** (same value during that HTTP request).  
- Filter: `grep '"request_id": "THE-ID"' apps/backend/logs/backend.ndjson` or use `backend-log-slice`.

## Chat turn outcome — `chat_turn_summary`

After a successful buyer turn commit, an **INFO** record from `app.services.buyer_chat_stream` has `message` starting with **`chat_turn_summary `** followed by a **JSON object** (stringified inside `message`).

Parse that trailing JSON. Important fields:

| Field | Meaning |
|--------|---------|
| `harness_shape` | `"full"` or `"lite"` |
| `session_id` | Chat session UUID |
| `user_text` / `assistant_text` | Present when `full` (sanitized per logging guidelines: VINs/emails/phones/secret-like tokens masked) |
| `user_preview` / `assistant_preview` | Present when `lite` (bounded length) |
| `tool_names` | Deduped tool names for the turn |
| `tool_calls` | Full tool list when `full` (includes `update_insights_panel`) |
| `panel_cards` | Full persisted panel when `full` and panel ran |

When **`ENV=production`** and `LOG_CHAT_HARNESS_FULL` is unset, summaries default to **lite** (no full `panel_cards` bodies — only `panel_card_kinds` / `panel_card_count` if the panel ran).

## Insights panel — verifying content in logs

**Yes, when `harness_shape` is `full`.**

- **`panel_cards`**: canonical array of cards (`kind`, `template`, `title`, `content`, `priority`). Compare card `content` (e.g. `phase.stance` / `phase.situation`, `warning.message`, `numbers.rows`, `vehicle`, checklist items) to what the user and assistant said.  
- **Duplicate source**: in `tool_calls`, find **`update_insights_panel`** → `args.cards` — same payload the client receives for the panel tool event.

**When `harness_shape` is `lite`**, you only get **`panel_card_kinds`** and **`panel_card_count`**, not bodies — not enough to verify copy; need full harness or DB/UI.

Optional extra DEBUG: set **`LOG_CHAT_HARNESS_VERBOSITY=verbose`** and **`LOG_LEVEL=DEBUG`** for `chat_harness_verbose` lines (compaction / step_loop / panel metadata).

## Docs

- `docs/logging-harness.md` — agent workflow, comparison with CLI-style logging  
- `docs/logging-guidelines.md` — PII, field schema  
- `docs/development.md` — `backend-log-slice`, env vars  
- ADR `docs/adr/0021-chat-harness-logging.md` — full vs lite policy
