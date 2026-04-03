# AI Pipeline Testing Guide

**Last updated:** 2026-04-03

---

## Table of Contents

- [1. What This Covers](#1-what-this-covers)
- [2. Why This Exists](#2-why-this-exists)
- [3. The Four Test Layers](#3-the-four-test-layers)
- [4. Important Files](#4-important-files)
- [5. Day-to-Day Workflow](#5-day-to-day-workflow)
- [6. Recording and Replaying Cassettes](#6-recording-and-replaying-cassettes)
- [7. Snapshot Updates](#7-snapshot-updates)
- [8. Current Limits](#8-current-limits)

---

## 1. What This Covers

This guide explains the backend tests for the AI pipeline: the chat step loop, tool execution, deal-state mutation, panel generation, and SSE streaming.

The goal is to make changes to the Claude harness safe to ship. Instead of relying on ad hoc manual testing, the backend now has deterministic tests, committed snapshots, and one replayable real-Claude cassette.

---

## 2. Why This Exists

The AI pipeline is the most fragile part of the backend because it combines several moving pieces in one request:

1. Build Claude input from message history and deal state.
2. Stream Claude output.
3. Accumulate tool calls.
4. Execute tools and persist results.
5. Generate panel cards.
6. Stream SSE events to the frontend in the order the UI expects.

Without tests, regressions are easy to introduce:

- a tool schema can drift
- the SSE event order can change
- malformed tool JSON can skip the error path
- a route can emit `done` before panel generation finishes
- a prompt change can silently change panel output quality

The current test setup exists to catch those failures early.

---

## 3. The Four Test Layers

### Layer 1: Fake-model pipeline tests

These tests never call Anthropic. They use a small helper in `tests/test_ai_pipeline.py` called `FakeClaudeResponse` to simulate streamed text and `tool_use` blocks.

This covers:

- single-step and multi-step loop behavior
- tool execution failures
- malformed tool JSON
- retry event handling
- max-step partial completion
- SSE ordering from the step loop itself

These tests are fast and should be the first line of defense.

They now also cover truncation recovery: when a step ends with `stop_reason == "max_tokens"`, the harness retries with a larger token budget and emits a retry event that tells the client to clear the partial streamed text before rendering the replacement attempt.

### Layer 2: Snapshot tests

These tests compare structured outputs against committed files so accidental drift is obvious in diff review.

Current snapshots include:

- tool schema contract
- normalized fake-pipeline state after a multi-tool run
- panel card output shape

If a tool definition or output contract changes intentionally, the snapshot needs to be updated in the same change.

### Layer 3: VCR cassette integration test

This is a real Claude request recorded once and then replayed locally and in CI.

The cassette file lives at:

- `apps/backend/tests/cassettes/test_ai_pipeline/test_generate_ai_panel_cards_vcr_smoke.yaml`

What “record the first cassette” means:

1. Run the VCR-marked test once with a valid `ANTHROPIC_API_KEY`.
2. `pytest-recording` saves the real HTTP request and response to YAML.
3. Later runs replay that saved interaction instead of hitting the API again.

After the first recording, the test is fast, deterministic, and free to replay.

### Layer 4: Route-level SSE tests

These hit the real FastAPI chat route with an async test client and verify the event sequence the frontend depends on.

Current route coverage includes:

- `text` events before panel updates
- `tool_result` events before terminal `done`
- failure short-circuiting without persisting an empty assistant message
- retry/reset behavior for replayed attempts after truncation or stream recovery

---

## 4. Important Files

### Test code

- `apps/backend/tests/test_ai_pipeline.py`
- `apps/backend/tests/test_concurrent_tools.py`
- `apps/backend/tests/test_extraction.py`

### Snapshot files

- `apps/backend/tests/snapshots/ai_pipeline/chat_tools_schema.json`
- `apps/backend/tests/snapshots/ai_pipeline/fake_pipeline_state.json`
- `apps/backend/tests/snapshots/ai_pipeline/panel_cards.json`

### Cassette files

- `apps/backend/tests/cassettes/test_ai_pipeline/test_generate_ai_panel_cards_vcr_smoke.yaml`

### Production seams these tests protect

- `apps/backend/app/services/claude.py`
- `apps/backend/app/services/deal_state.py`
- `apps/backend/app/services/panel.py`
- `apps/backend/app/routes/chat.py`

---

## 5. Day-to-Day Workflow

Most of the time you do not need live Claude access.

### Run the pipeline suite normally

```bash
cd apps/backend
../../.venv/bin/pytest tests/test_ai_pipeline.py --record-mode=none
```

`--record-mode=none` means replay only. If a cassette is missing, pytest fails instead of making a network call.

### Run the adjacent backend seam tests too

```bash
cd apps/backend
../../.venv/bin/pytest tests/test_ai_pipeline.py tests/test_concurrent_tools.py tests/test_extraction.py --record-mode=none
```

Use this when changing:

- `claude.py`
- `deal_state.py`
- `panel.py`
- `routes/chat.py`

---

## 6. Recording and Replaying Cassettes

### Replay an existing cassette

```bash
cd apps/backend
../../.venv/bin/pytest tests/test_ai_pipeline.py -k test_generate_ai_panel_cards_vcr_smoke --record-mode=none
```

### Record the cassette for the first time

```bash
cd apps/backend
../../.venv/bin/pytest tests/test_ai_pipeline.py -k test_generate_ai_panel_cards_vcr_smoke --record-mode=once
```

### Re-record after a prompt or model change

```bash
cd apps/backend
../../.venv/bin/pytest tests/test_ai_pipeline.py -k test_generate_ai_panel_cards_vcr_smoke --record-mode=rewrite
```

### Credential behavior

The backend settings object loads `.env`, so the VCR smoke test checks `settings.ANTHROPIC_API_KEY`, not just shell-exported env vars.

That means a valid key in `apps/backend/.env` is enough for recording.

### What gets stored

The cassette stores:

- the request body sent to Anthropic
- the response body returned by Anthropic
- selected HTTP headers and metadata

Auth headers are filtered, but the prompt and response content are intentionally preserved because the test is meant to catch output drift.

---

## 7. Snapshot Updates

Snapshot files should only change when behavior intentionally changes.

Examples:

- a tool definition changed on purpose
- the normalized pipeline result now includes a new tool call
- the mocked panel output contract changed

If a snapshot changes unexpectedly, treat that as a regression signal first and an update task second.

Current snapshot philosophy:

- schema snapshots catch tool definition drift
- pipeline-state snapshots catch orchestration drift
- panel-output snapshots catch structured rendering drift

---

## 8. Current Limits

The current setup is a strong baseline, but it is not complete.

Known gaps:

- only one real-Claude cassette is recorded today, for panel generation
- extraction cassettes are not recorded yet
- dynamic tool filtering and semantic result validators are planned but not implemented in production yet, so there is no coverage for them beyond the current architecture
- cassette scrubbing is basic; auth headers are filtered, but prompt/response content remains visible by design

If more Claude-facing paths become critical, add more cassettes instead of expanding one giant smoke test.