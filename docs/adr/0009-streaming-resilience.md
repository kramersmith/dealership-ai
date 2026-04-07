# ADR-0009: Streaming Resilience — Watchdog, Retry, and Non-Streaming Fallback

**Status:** Accepted
**Date:** 2026-03
**Deciders:** Kramer Smith

## Context

The chat experience streams Claude API responses to the client via Server-Sent Events (SSE). In production, SSE streams from the Anthropic API can stall or fail mid-response for several reasons:

- **Idle stalls** — the API opens the connection successfully (HTTP 200) but stops emitting events partway through a response, with no error or close signal. The client sees a spinner that never resolves.
- **Transient errors during streaming** — `overloaded_error` and `rate_limit_error` can arrive inside an already-open SSE stream. The Anthropic SDK retries 429/529 errors at the HTTP level (before the stream opens), but cannot retry errors that arrive after the 200 response has started.
- **Connection drops** — network interruptions or load balancer timeouts sever the stream mid-response.

These failures are particularly damaging for the app's UX because the buyer is in a time-sensitive conversation (potentially at a dealership), and a hung response with no recovery path erodes trust. The backend must handle these transparently so the user sees either a successful response or a clear retry, never an indefinite hang.

## Decision

Implement a three-layer streaming resilience strategy in `stream_step_with_retry()` in `claude/streaming.py`:

### Layer 1: Idle Timeout Watchdog

Each event from the Anthropic stream is awaited with `asyncio.wait_for()` using a configurable idle timeout (`CLAUDE_STREAM_IDLE_TIMEOUT`, default 30 seconds). If no event arrives within the timeout window, the stream is considered stalled and abandoned. This catches the silent-stall failure mode that no error handler would otherwise detect.

### Layer 2: Stream-Level Retry with Backoff

On stall detection, connection error, or transient API error (`overloaded_error`, `rate_limit_error`) received inside a stream, the system retries the entire Claude API call up to `CLAUDE_STREAM_MAX_RETRIES` times (default 2 retries, so 3 total attempts). Backoff is linear: 1 second after the first failure, 2 seconds after the second.

On each retry, the function yields a `("retry", {...})` event. The SSE layer in `stream_chat_loop()` forwards this to the client as an `event: retry` SSE message with a `reset_text: true` flag. The client (in `apiClient.ts`) clears the accumulated assistant text and calls `onChunk('')` to reset the streaming bubble, so partial garbage from the failed stream is discarded before the fresh attempt begins. The chatStore exposes an `isRetrying` flag for UI feedback.

All step-level accumulators (partial text, tool use blocks) are also reset server-side on retry, since partial data from an interrupted stream is unreliable.

### Layer 3: Non-Streaming Fallback

If all stream retries are exhausted, the system falls back to a synchronous (non-streaming) `client.messages.create()` call with the same parameters. The response is converted into synthetic stream events (`SyntheticTextEvent`, `SyntheticToolStartEvent`, `SyntheticToolJsonEvent`, `SyntheticBlockStopEvent`) that match the duck-typed attributes accessed by `stream_chat_loop()`. This means the rest of the pipeline — text accumulation, tool execution, SSE emission — works identically regardless of whether the response came from a stream or the fallback.

If the non-streaming fallback also fails, the original stream error is re-raised and surfaces as an SSE error event to the client.

### Configuration

All parameters are exposed as environment variables via Pydantic Settings (`config.py`):

| Setting | Default | Purpose |
|---|---|---|
| `CLAUDE_STREAM_IDLE_TIMEOUT` | 30s | Max seconds between stream events before declaring a stall |
| `CLAUDE_STREAM_MAX_RETRIES` | 2 | Stream-level retries (distinct from SDK-level retries) |
| `CLAUDE_API_TIMEOUT` | 120s | Overall API request timeout |
| `CLAUDE_SDK_MAX_RETRIES` | 3 | SDK-level retries for HTTP 429/529 before stream opens |

## Alternatives Considered

### Option A: No retry — fail fast and surface the error

- Pros: Simplest implementation. No risk of duplicate side effects. The client handles the error.
- Cons: Silent stalls would hang indefinitely without the watchdog (there is no error to surface). Even with a timeout, failing on the first stall is a poor experience when a retry would succeed. The buyer has no recourse other than re-sending their message manually, which may lose conversational context in the SSE flow.

### Option B: Client-side retry only

- Pros: Keeps the backend stateless with respect to retries. The frontend can show a retry button and re-issue the entire SSE request.
- Cons: The client cannot detect a stalled stream — it only knows the connection is open. A timeout heuristic on the client would need to be longer than the server-side one (adding latency). Re-issuing the full SSE request is heavier than retrying just the Claude API call (it repeats auth, session lookup, message building). Partial text from the stalled stream would need client-side cleanup, duplicating logic that belongs in the streaming layer. Does not address the mid-stream transient error case at all.

### Option C: WebSocket with heartbeat protocol

- Pros: Bidirectional communication allows the server to send explicit heartbeat frames, and the client can detect missing heartbeats definitively. Enables server-initiated push beyond the chat context.
- Cons: Significant architectural change — the entire chat streaming layer is built on SSE, which is simpler to implement, debug, and deploy (works through HTTP proxies and CDNs without special configuration). WebSocket connections are harder to load-balance and do not automatically reconnect. The idle stall problem is at the Anthropic API layer, not the server-to-client layer, so heartbeats would only mask the issue rather than resolve it. Overkill for the current single-backend architecture.

## Consequences

- **Positive:** Silent stream stalls are detected within 30 seconds instead of hanging indefinitely. The 30-second window is generous enough to avoid false positives during slow tool-use responses while being short enough to feel responsive.
- **Positive:** Transient Anthropic API issues (overload, rate limits during stream) are recovered automatically. With 2 retries and linear backoff, most intermittent failures resolve without user awareness.
- **Positive:** The non-streaming fallback provides a last-resort path that sacrifices the streaming UX (text arrives all at once) but still delivers a complete response. The synthetic event wrappers mean no code changes are needed downstream.
- **Positive:** The client receives explicit `retry` SSE events with `reset_text` flags, enabling clean UI transitions (clear partial text, show retry indicator) rather than leaving stale partial content on screen.
- **Positive:** All timeout and retry parameters are configurable via environment variables, allowing tuning without code changes.
- **Negative:** Stream retries replay the full Claude API call, which means the same prompt is billed again. With a max of 2 retries, the worst case is 3x the token cost for a single step. This is acceptable because stalls are infrequent and the alternative (user-visible failure) is worse.
- **Negative:** The synthetic event classes (`SyntheticTextEvent`, etc.) are duck-typed wrappers that must stay in sync with the attributes accessed by `stream_chat_loop()`. If the event processing logic changes, these wrappers could silently break. Mitigated by colocating them in `streaming.py` next to `stream_step_with_retry()`.
- **Neutral:** The retry/fallback logic is entirely server-side and invisible to the client beyond the `retry` SSE event. The client does not need to implement its own timeout or retry logic for stream failures.

## References

- [Streaming resilience implementation](../../apps/backend/app/services/claude/streaming.py) — `stream_step_with_retry()`, synthetic event classes
- [Backend config](../../apps/backend/app/core/config.py) — `CLAUDE_STREAM_*` settings
- [Frontend SSE retry handling](../../apps/mobile/lib/apiClient.ts) — `retry` event processing with `reset_text`
- [Anthropic SDK streaming docs](https://docs.anthropic.com/en/api/streaming)
