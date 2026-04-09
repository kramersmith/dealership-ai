# ADR-0021: Chat harness logging (full vs lite `chat_turn_summary`)

**Status:** Accepted  
**Date:** 2026-04  
**Deciders:** Engineering

## Context

Buyer chat turns need **structured, grep-friendly** logs for local development and coding-agent harnesses: user text, assistant text, tool calls, and insights panel cards (with VIN masking). Unbounded full payloads on every turn in **production** inflate retention, cost, and accidental-PII risk — similar to how CLI-style tools keep full API bodies behind opt-in debug or internal tiers.

## Decision

0. **Structured JSON logging + request correlation (foundation).** The backend emits **one JSON object per record** to stderr via `python-json-logger` (see `app/core/logging_setup.py`). A `RequestContextMiddleware` honors or generates **`X-Request-ID`** per HTTP request and binds `request_id` / `http_method` / `http_path` into contextvars so every log line within that request is correlated. An optional **`LOG_LOCAL_NDJSON_PATH`** file sink duplicates the same records to a clean file (no `docker compose` line prefix) for local development and coding-agent harnesses. Noisy third-party loggers (`anthropic`, `httpcore`, `httpx`) are capped via `LOG_THIRD_PARTY_LEVEL` (default `WARNING`) so `LOG_LEVEL=DEBUG` does not dump entire API bodies. These choices are the substrate the rest of the harness contract builds on.

1. **`chat_turn_summary` remains a single INFO line** whose `message` suffix is a JSON object (NDJSON record from the app’s JSON formatter).

2. **`harness_shape` field:** Every payload includes `"harness_shape": "full"` or `"lite"`.

3. **Default policy:**
   - If **`LOG_CHAT_HARNESS_FULL`** is **set** (true/false), it **wins**.
   - If **unset**, **`ENV=production`** (case-insensitive) → **lite**; any other `ENV` → **full**.

4. **Full payload:** `user_text`, `assistant_text`, `tool_calls`, optional `panel_cards` (sanitized per `docs/logging-guidelines.md`: VINs, emails, phone numbers, and secret-like values masked or redacted).

5. **Lite payload:** `user_preview`, `assistant_preview` (length cap `LOG_CHAT_HARNESS_PREVIEW_MAX_CHARS`), optional `panel_card_count` + `panel_card_kinds`; **no** full `tool_calls` or card bodies.

6. **`LOG_CHAT_HARNESS_VERBOSITY=verbose`:** Emit additional **DEBUG** lines (`chat_harness_verbose`) for compaction, step-loop tool payloads (masked), and panel metadata — without splitting the INFO summary into multiple INFO lines.

7. **Flush:** After writing `chat_turn_summary`, call **`flush_logging_handlers()`** so the line is less likely to be lost on abrupt process exit during local runs.

8. **Documentation:** `docs/logging-harness.md` holds the digest and operator notes; this ADR records the decision.

## Consequences

- **Positive:** Production logs stay smaller by default; dev/staging retain full harness fidelity without a second log system.
- **Positive:** Explicit override for staging-like environments that use `ENV=production` but need full logs (`LOG_CHAT_HARNESS_FULL=true`).
- **Negative:** Operators must know **lite vs full** when reading production logs; agents should key off `harness_shape`.
- **Verbose DEBUG** can duplicate large structures when both full INFO and verbose DEBUG are enabled — acceptable for deliberate troubleshooting.

## References

- `app/core/logging_setup.py` — JSON formatter, `RequestContextFilter`, optional `LOG_LOCAL_NDJSON_PATH` duplicate file sink (clean NDJSON for agents; avoids `docker compose logs` line prefixes), third-party logger capping
- `app/core/request_context.py` — `RequestContextMiddleware` + contextvars for `request_id` / `http_method` / `http_path`, `X-Request-ID` echo
- `app/core/log_redact.py` — VIN / email / phone / token masking and bounded previews (`mask_vins`, `sanitize_log_text`, `deep_sanitize_log_data`, `preview_chat_text`)
- `app/services/chat_harness_log.py` — payload builder and verbose helper
- `app/services/buyer_chat_stream.py` — turn pipeline, summary emission, verbose hooks
- `app/core/config.py` — `LOG_CHAT_HARNESS_*`, `LOG_THIRD_PARTY_LEVEL`, `LOG_LOCAL_NDJSON_PATH`, `chat_harness_includes_full_payload()`
- `docs/logging-harness.md` — operator and comparison notes
- `docs/logging-guidelines.md` — PII rules and JSON field schema
- `scripts/backend-log-slice.sh` — `logs/agent-latest.ndjson` symlink when `OUT` is set
