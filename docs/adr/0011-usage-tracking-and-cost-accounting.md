# ADR-0011: Multi-Level Usage Tracking and Cost Accounting

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Kramer Smith

## Context

The backend makes multiple Claude API calls per user interaction: the step loop may invoke the model several times (up to 5 steps per turn), panel generation runs a separate call after the step loop, and lightweight tasks like title generation use a different (cheaper) model. Without tracking, there is no visibility into per-session or per-turn costs, no way to detect runaway usage, and cost analysis requires cross-referencing the Anthropic billing dashboard with application logs.

Key drivers:

- **Cost visibility** — understand the real cost of each user turn and session, broken down by model
- **Cache effectiveness** — Claude's prompt caching (cache creation and cache read tokens) materially changes the cost profile; tracking these separately is necessary for optimization
- **Multi-model accounting** — the app uses `claude-sonnet-4-6` for primary chat and panel generation, and `claude-haiku-4-5-20251001` for title generation and deal re-assessment; costs differ by an order of magnitude
- **Debugging** — correlating token counts with specific turns helps diagnose unexpectedly long or expensive interactions
- **Future enforcement** — per-session cost data is the foundation for quotas or spending alerts, even though enforcement is not implemented yet

## Decision

Implement a three-level usage tracking system entirely within the application, with costs calculated from hardcoded per-model pricing and persisted as JSON on existing database models.

### Level 1: Per-request (`RequestUsage`)

Each Claude API call produces a `RequestUsage` dataclass containing model name, token counts (input, output, cache creation, cache read, total), request count, latency, and calculated USD cost. Built by `build_request_usage()` in `usage_tracking.py` from the SDK's raw usage object.

### Level 2: Per-turn aggregation (`ChatLoopResult.usage_summary`)

Within a single user turn, the step loop in `stream_chat_loop()` accumulates usage across all steps via `merge_usage_summary()`. Each step's `final_message` event contributes its tokens to a running total dict:

```python
{
    "requests": 3,           # number of Claude API calls in this turn
    "input_tokens": 15420,
    "output_tokens": 1893,
    "cache_creation_input_tokens": 4096,
    "cache_read_input_tokens": 11200,
    "total_tokens": 17313     # input_tokens + output_tokens
}
```

After the step loop completes, panel generation usage is merged into the same summary. The combined total is persisted on the `Message` model's `usage` JSON column and sent to the frontend via the SSE `done` event (in camelCase).

### Level 3: Per-session cumulative (`SessionUsageSummary`)

The `ChatSession` model stores a cumulative `usage` JSON column. On each turn, the session summary is loaded via `SessionUsageSummary.from_dict()`, updated with the turn's aggregated usage via `add_request()`, and written back. The session summary includes both aggregate totals and a `per_model` breakdown:

```python
{
    "request_count": 12,
    "input_tokens": 89340,
    "output_tokens": 7421,
    "cache_creation_input_tokens": 4096,
    "cache_read_input_tokens": 72800,
    "total_tokens": 96761,
    "total_cost_usd": 0.412350,
    "per_model": {
        "claude-sonnet-4-6": {
            "request_count": 10,
            "input_tokens": 87200,
            "output_tokens": 7100,
            "cache_creation_input_tokens": 4096,
            "cache_read_input_tokens": 72800,
            "total_tokens": 94300,
            "total_cost_usd": 0.405120
        },
        "claude-haiku-4-5-20251001": {
            "request_count": 2,
            "input_tokens": 2140,
            "output_tokens": 321,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
            "total_tokens": 2461,
            "total_cost_usd": 0.002996
        }
    }
}
```

The session summary is returned to the frontend as `sessionUsage` on the SSE `done` event and on session detail endpoints.

### Cost calculation

Costs are computed in `calculate_request_cost_usd()` using `Decimal` arithmetic for precision. Per-model pricing is hardcoded in a `MODEL_PRICING` dict with four rates per model (input, output, cache read, cache creation), all expressed as cost per million tokens. The final USD value is rounded to 6 decimal places (`0.000001`).

### `UsageRecorder` callback pattern

Functions that make Claude calls outside the step loop (title generation, deal analysis) accept a `usage_recorder: UsageRecorder` callback -- a callable that takes a `RequestUsage`. The chat route passes `session_usage.add_request` as the callback, so auxiliary calls automatically accumulate into the session total without coupling the service functions to session-level state.

## Alternatives Considered

### Option A: External billing/metering service (e.g., Lago, Stripe Billing)
- Pros: Purpose-built for usage-based billing, handles invoicing, supports complex pricing tiers, audit trail
- Cons: Significant integration overhead for a pre-production app with no paying users. Adds an external dependency and potential point of failure on every API call. The app needs cost visibility for development and optimization, not billing -- an external service solves a problem that does not exist yet.

### Option B: No application-level tracking (rely on Anthropic dashboard)
- Pros: Zero implementation cost, always accurate (source of truth)
- Cons: No per-session or per-turn granularity -- the Anthropic dashboard shows aggregate API key usage, not correlated to individual users or conversations. Cannot power frontend cost display. Cannot detect expensive sessions or optimize cache hit rates at the application level. Debugging cost spikes requires log correlation with timestamps.

### Option C: Per-user quotas with hard enforcement
- Pros: Prevents runaway costs, enables freemium/paid tiers
- Cons: Premature for a pre-production app with no pricing model. Quota enforcement adds complexity to every API call path (check balance, handle insufficient balance, race conditions with concurrent requests). The current tracking architecture is the necessary prerequisite -- quotas can be layered on top of `SessionUsageSummary` data when needed.

## Consequences

- **Positive:** Full cost visibility per turn and per session, broken down by model, available in both the database and the frontend without external dependencies.
- **Positive:** Cache token tracking (creation vs. read) enables data-driven optimization of prompt caching strategy -- the team can measure cache hit rates and tune system prompt structure accordingly.
- **Positive:** The `UsageRecorder` callback pattern keeps service functions decoupled from session state while ensuring all Claude calls contribute to session totals.
- **Positive:** `Decimal`-based cost calculation avoids floating-point drift across many small additions within a session.
- **Negative:** Model pricing is hardcoded in `MODEL_PRICING`. When Anthropic changes prices, the dict must be updated manually. Stale pricing produces incorrect cost calculations (though token counts remain accurate).
- **Negative:** No cross-session or per-user aggregation yet. Answering "how much has this user spent total?" requires summing session-level data at query time.
- **Negative:** The per-turn usage on the SSE `done` event does not include panel generation costs (panel runs after `done` is emitted). The persisted `Message.usage` does include panel costs. This asymmetry is documented in code but could confuse frontend consumers.
- **Neutral:** Usage JSON is denormalized onto `Message` and `ChatSession` rows rather than stored in a dedicated table. This is appropriate for the current read patterns (display usage alongside the entity) but would need restructuring for analytics queries across many sessions.

## References

- [Usage tracking service](../../apps/backend/app/services/usage_tracking.py) — `RequestUsage`, `ModelUsageSummary`, `SessionUsageSummary`, `MODEL_PRICING`, cost calculation
- [Chat step loop](../../apps/backend/app/services/claude.py) — `summarize_usage()`, `merge_usage_summary()`, `ChatLoopResult.usage_summary`
- [Chat route](../../apps/backend/app/routes/chat.py) — session usage lifecycle, SSE `done` event, message persistence
- [Message model](../../apps/backend/app/models/message.py) — `usage` JSON column
- [ChatSession model](../../apps/backend/app/models/session.py) — `usage` JSON column
- [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing)
