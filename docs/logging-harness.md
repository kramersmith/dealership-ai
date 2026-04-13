# Logging harness (buyer chat turns)

**Last updated:** 2026-04-09

This document compares our backend harness logging with a common “CLI debug file” style (opt-in, session-scoped text logs) and documents knobs for agents and operators. For field-level PII rules and JSON log shape, see [logging-guidelines.md](logging-guidelines.md). For when `chat_turn_summary` fires relative to compaction, the step loop, `done`, and panel streaming, see [buyer-chat-turn.md](buyer-chat-turn.md).

## Reading logs as a coding agent

1. **Prefer a file, not the terminal.** `docker compose logs` adds a `service |` prefix to every line, which is **not** valid NDJSON when copied as-is.
2. **Default with Compose:** Open **`apps/backend/logs/backend.ndjson`** (written when `LOG_LOCAL_NDJSON_PATH` is set; default in `docker-compose.yml`). Use the Read tool on that path after the user reproduces an issue.
3. **Filtered excerpt:** `make backend-log-slice REQUEST_ID=… OUT=logs/agent-last-query.ndjson` — then read `OUT` or the **`logs/agent-latest.ndjson`** symlink.

---

## Purpose

- **Agent/harness use:** Reconstruct what the user sent, what the assistant returned, which tools ran, and what the insights panel contained — correlated with `X-Request-ID` / `request_id`.
- **Production:** Keep NDJSON volume and retention manageable via **lite** summaries by default when `ENV=production`.

---

## Comparison: reference CLI style vs dealership-ai

- **Reference pattern (e.g. Claude Code–style tools):** Debug lines are **off** until `DEBUG`, `--debug`, `--debug-file`, or an internal tier. Full API message arrays are often **not** retained in hooks for typical users. Output is commonly a **session-scoped text file** plus a **`latest`** symlink.
- **Dealership-ai:** Structured **NDJSON on stderr** from the FastAPI app. Each successful buyer turn emits **`chat_turn_summary`** at **INFO** with either a **full** or **lite** payload (see ADR-0021). Optional **DEBUG** lines when **`LOG_CHAT_HARNESS_VERBOSITY=verbose`**.

**Dimensions (bullets, no table):**

- **Consumer:** Humans/agents filter NDJSON (`make backend-log-slice`, `jq`, `grep chat_turn_summary`) vs tailing a dedicated debug file.
- **Gating:** `ENV` + `LOG_CHAT_HARNESS_FULL` + `LOG_LEVEL` vs CLI/env debug flags.
- **Correlation:** HTTP `request_id` on every log record vs session id in filenames.
- **Stable path:** `logs/agent-latest.ndjson` symlink updated when `backend-log-slice` writes `OUT=` (see [development.md](development.md)).

---

## `chat_turn_summary` shapes

Always includes: `event`, `session_id`, `user_chars`, `assistant_chars`, `tool_names`, **`harness_shape`** (`full` | `lite`).

**Full (`harness_shape: full`):**

- `user_text`, `assistant_text` — full messages sanitized per `docs/logging-guidelines.md`.
- `tool_calls` — full list for the turn with recursive string sanitization and secret-key redaction.
- `panel_cards` — when the panel completed: full card objects, sanitized the same way.

**Lite (`harness_shape: lite`):**

- `user_preview`, `assistant_preview` — single-line excerpts capped by `LOG_CHAT_HARNESS_PREVIEW_MAX_CHARS` (default 240).
- `panel_card_count`, `panel_card_kinds` when a panel ran — no full card bodies or tool argument payloads.

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `ENV` | When `production` and `LOG_CHAT_HARNESS_FULL` is **unset**, summaries default to **lite**. Non-production defaults to **full**. |
| `LOG_CHAT_HARNESS_FULL` | Explicit override: `true` / `false`. When set, overrides the `ENV` default. |
| `LOG_CHAT_HARNESS_VERBOSITY` | `normal` (default) or `verbose`. **verbose** adds extra **DEBUG** lines (`chat_harness_verbose` JSON) for compaction, step-loop tools, and panel kinds. |
| `LOG_CHAT_HARNESS_PREVIEW_MAX_CHARS` | Max length for lite previews (default 240). |

---

## Verbose DEBUG events

When `LOG_CHAT_HARNESS_VERBOSITY=verbose`, look for log lines where `message` contains `chat_harness_verbose` and a JSON object with:

- `tag`: `compaction` | `step_loop` | `panel`
- `session_id` and tag-specific fields (e.g. `tool_calls` for `step_loop`, `kinds` for `panel`).

Requires `LOG_LEVEL=DEBUG` (or root level low enough) for DEBUG records to appear.

---

## Design tension

- **Privacy / volume:** Reference stacks often hide full payloads unless debug or internal tier; we mirror that in **production** via **lite** `chat_turn_summary`.
- **Reproducibility:** Non-production and explicit `LOG_CHAT_HARNESS_FULL=true` keep **full** payloads for harness work.

---

## Inspiration checklist (from reference patterns)

1. Tiered verbosity: `LOG_CHAT_HARNESS_VERBOSITY` (normal vs verbose DEBUG).
2. Prod vs dev payload: `ENV` + `LOG_CHAT_HARNESS_FULL` (see ADR-0021).
3. Stable artifact: `logs/agent-latest.ndjson` symlink after `backend-log-slice` with `OUT=`.
4. Crash safety: `flush_logging_handlers()` after emitting `chat_turn_summary`.

---

## Teaser one-pager for teammates

1. Full vs lite: see **`harness_shape`** on `chat_turn_summary`.
2. Correlate with **`X-Request-ID`** and `make backend-log-slice`.
3. Deep dive: this doc + [ADR-0021](adr/0021-chat-harness-logging.md).
