# ADR-0015: Prompt Cache Break Detection via Request Fingerprinting

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Kramer Smith

## Context

Claude's prompt caching significantly reduces cost and latency when the system prompt, tools, and model remain stable across turns within a session. However, the application has no visibility into whether cache breaks are occurring. A cache break — where a previously cached request prefix is invalidated — means the API re-processes and re-bills the full input rather than reading from cache. This can happen silently when:

- The system prompt text changes (e.g. a code deployment alters prompt wording)
- Tool definitions change (new tools added, schema modified)
- The model identifier changes (configuration update or A/B test)
- Beta headers change

Without detection, cost regressions from cache breaks are only visible days later in aggregate Anthropic billing, with no way to attribute them to specific sessions or deployments.

The step loop already varies `tool_choice` and appends continuation system blocks on inner steps — these are intentional per-step changes and must not trigger break alerts.

## Decision

Introduce a SHA-256 fingerprinting module (`prompt_cache_signature.py`) that hashes cache-relevant request components and detects when they change between turns or phases.

### Fingerprint composition

Each snapshot is a dict of component hashes:

```python
{
    "system": sha256(canonical_json(strip_cache_control(system_prompt))),
    "tools": sha256(canonical_json(strip_cache_control(tools))),
    "model": sha256(canonical_json(model)),
    "betas": sha256(canonical_json(sorted(betas))),
    "combined": sha256(canonical_json({system, tools, model, betas})),
}
```

Key design choices:
- **`cache_control` keys are stripped** before hashing so that cache placement metadata (which varies between steps) does not affect the content fingerprint.
- **Canonical JSON** (`sort_keys=True`, deterministic separators) ensures identical content always produces the same hash regardless of Python dict ordering.
- **Component-level hashes** enable pinpointing which specific component changed, not just that something changed.

### Two fingerprint scopes

1. **Chat stable slice** (`build_chat_stable_cache_snapshot`): hashes only the base system prompt, tools, model, and betas — not `tool_choice` or continuation system blocks that the step loop intentionally varies. Used for cross-turn break detection in the chat phase.

2. **Panel static slice** (`build_panel_static_prompt_cache_snapshot`): hashes the static panel prompt, model, and betas. Panel requests have no tools, so the tools hash is a constant (empty list).

A full-request snapshot (`build_chat_prompt_cache_snapshot`) including `tool_choice` exists for tests and diagnostics but is not used in production break detection.

### Detection and logging

`prompt_cache_components_changed()` compares two snapshots and returns the list of changed component names. When a break is detected, `log_prompt_cache_break()` emits an INFO log containing only SHA-256 hex digests and component labels — never raw prompt text, tool JSON, or message bodies — per logging guidelines.

### Persistence

Break counts and last-known fingerprints (chat and panel) are persisted on `SessionUsageSummary` via three new fields: `prompt_cache_chat_last`, `prompt_cache_panel_last`, `prompt_cache_break_count`. These serialize into the existing `ChatSession.usage` JSON column under a `prompt_cache` key.

## Alternatives Considered

### Option A: Infer breaks from cache token counts

- Pros: Uses data already available in the API response (`cache_creation_input_tokens` vs `cache_read_input_tokens`). No new module needed.
- Cons: Cache token counts are noisy — a cache read of zero could mean TTL expiration, a cold start, or an actual prompt change. Cannot distinguish "expected miss" (first turn in a session) from "unexpected break" (deployment changed the prompt). Cannot identify which component changed. Requires heuristics that would generate false positives.

### Option B: String comparison of raw prompts

- Pros: Exact diff of what changed, useful for debugging.
- Cons: System prompts and tool definitions are large (several KB). Storing and comparing raw text per turn is expensive in memory and log volume. Logging raw prompt text violates PII/sensitivity guidelines. Serialization differences (key ordering, whitespace) would cause false positives without normalization — at which point you're essentially building the canonical-JSON-then-hash approach anyway.

### Option C: No detection — rely on Anthropic dashboard metrics

- Pros: Zero implementation cost.
- Cons: Anthropic's dashboard shows aggregate cache metrics per API key, not per session or per deployment. A prompt change that breaks cache for all sessions would appear as a gradual cost increase over hours, with no link to the specific code change. By the time it's noticed in billing, the damage is done. The whole point is early detection correlated with application-level context (session ID, phase, step).

## Consequences

- **Positive:** Cache breaks are detected within the same turn they occur, with session-level attribution. Operators can correlate breaks with deployments via the session ID and step number in the log.
- **Positive:** Component-level granularity ("system prompt changed" vs "tools changed" vs "model changed") narrows the investigation from "something broke caching" to "here's what changed."
- **Positive:** Persisted break counts on `SessionUsageSummary` enable aggregate analysis (e.g. "how many sessions experienced breaks after deploy X?") without log scraping.
- **Positive:** The stable-slice approach avoids false positives from intentional per-step variation (`tool_choice`, continuation blocks), which was the main risk of naive comparison.
- **Negative:** The fingerprint only detects changes to components the application controls. External cache invalidation (Anthropic TTL expiration, infrastructure changes) is invisible to this system. Cache token counts in usage data remain the only signal for those cases.
- **Negative:** Fingerprints add a small amount of computation per step (JSON serialization + SHA-256). In practice this is sub-millisecond and negligible compared to the API call latency.
- **Neutral:** The module is read-only observability — it detects and logs breaks but does not prevent or correct them. Prevention would require prompt stability guarantees at the deployment level, which is out of scope.

## References

- [Prompt cache signature module](../../apps/backend/app/services/prompt_cache_signature.py)
- [Usage tracking](../../apps/backend/app/services/usage_tracking.py) — `SessionUsageSummary` prompt cache fields
- [Chat step loop integration](../../apps/backend/app/services/claude.py) — `stream_chat_loop()` fingerprint calls
- [Panel integration](../../apps/backend/app/services/panel.py) — `stream_ai_panel_cards_with_usage()` fingerprint calls
- [Logging guidelines](../../docs/logging-guidelines.md) — prompt cache break log rules
- [ADR-0011](0011-usage-tracking-and-cost-accounting.md) — usage tracking foundation this extends
