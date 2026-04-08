# ADR-0018: Multi-vehicle panel presentation and chat-rendered comparison tables

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Engineering

## Context

ADR-0010 and the `multi-vehicle-support.md` plan established a data model in which
every shopping vehicle is `primary` and comparison lives as a `comparison` panel
card. The `insights-panel-state-first-redesign.md` plan listed `comparison` /
`trade_off` as first-class panel card kinds and capped the panel at 3–5 cards.

In practice, several issues emerged:

1. **VIN-assisted inserts are not real purchase intent.** When the user pastes a
   VIN (sometimes several), the backend needs to add a vehicle row before the
   buyer has committed to anything. Promoting those to `primary` immediately
   over-claims buyer intent and poisons `active_deal_id` logic.
2. **Comparison tables are bad panel cards.** Side-by-side tables want horizontal
   real estate the insights panel does not have; they were the worst-fitting
   card kind and repeatedly produced cramped or truncated output.
3. **A single global panel cap (5 cards) can't express "one vehicle card per
   vehicle under comparison"** without starving other card kinds.
4. **The model needs a stable place to express structured comparisons.** Chat,
   not the panel, is the natural home — it is wide, scrolls, and already renders
   markdown.

## Decision

### 1. Add `VehicleRole.CANDIDATE`

Introduce a third vehicle role alongside `primary` and `trade_in`. `CANDIDATE`
means "known to the session (e.g. via VIN intercept) but not yet the buyer's
committed pick." VIN-assisted upserts default to `CANDIDATE`. Promotion to
`PRIMARY` happens when Claude or the buyer signals commitment. Deal routing
treats `primary` and `candidate` as the unified **shopping** set via
`_SHOPPING_VEHICLE_ROLES` in `deals.py`. In user-facing chat and panel content,
`primary`/`candidate` are internal labels only — the system prompt and panel
prompt explicitly forbid surfacing them.

This supersedes the multi-vehicle plan's "no comparison role" decision: the
third role exists to track commitment state, not to tag comparison vehicles.

### 2. Remove `comparison` / `trade_off` from the insights panel

`stream_ai_panel_cards_with_usage` now post-filters both kinds out of the
canonical panel output, and the panel system prompt instructs Claude never to
emit them. Side-by-side comparisons belong in **chat** — Claude writes a
concise markdown table inline in its visible reply.

### 3. Introduce the `phase` panel card kind

A `phase` card renders the negotiation stance + situation strip that used to be
bolted onto the panel header. It is always first in the panel order. It is
**not** the deal pipeline phase (`deals[].phase`) — the panel prompt calls this
out explicitly so the model does not conflate them. Schema:
`{"stance": NegotiationStance, "situation": string}`.

### 4. Per-kind instance caps, no global panel cap

`canonicalize_panel_cards` now dedupes by a kind-specific identity
(`vehicle` uses VIN, falling back to YMM + mileage + color) and enforces per-
kind instance limits from `PANEL_KIND_MAX_INSTANCES`. `vehicle` allows up to 6
instances so each actively-compared truck gets its own card; every other kind
is capped at 1. There is no global panel length cap. ADR-0013 has been updated
to reflect this.

### 5. Single-focus enforcement

When there is a clear single focus (one shopping vehicle, or buyer explicitly
chose one via `_has_explicit_single_focus_signal`), the backend collapses
panel vehicle cards to the active vehicle. When 2+ vehicles are in play with
no explicit choice, all vehicle cards pass through and non-vehicle cards are
required to disambiguate scope in their labels.

### 6. Markdown comparison tables in chat

Chat bubbles render markdown tables through a new `ChatMarkdown` component
(`apps/mobile/components/chat/markdownRenderer.tsx`) that parses markdown
tables out of the stream and delegates to a shared `VehicleComparisonTable`
component for responsive horizontal scrolling with a sticky label column.
Narrow/mobile layout also switches assistant bubbles to an inline (no-bubble)
layout so tables can use the full content width.

The system prompt teaches the model when a table is worth it ("keep label
column compact, let value columns breathe, shorter labels win") and when to
fall back to bullets.

## Alternatives Considered

### Option A: Keep comparison as a panel card with horizontal scroll
- Pros: no chat complexity; comparisons stay structured.
- Cons: bad on mobile, clashes with single-column panel layout, and forces a
  global cap trade-off against other required cards.

### Option B: Keep role=primary for VIN-assisted inserts
- Pros: simpler role enum.
- Cons: falsely elevates VINs the buyer has not committed to, fights with
  `active_deal_id`, and makes it hard to distinguish "still shopping" from
  "picked this one" in tool policy and panel focus rules.

### Option C: Drop the panel cap entirely (no per-kind limits)
- Pros: most flexible.
- Cons: identity dedupe + per-kind caps are the minimum guardrails needed to
  keep the model from flooding the panel with duplicates.

## Consequences

- **Positive:** Panel stays single-column and readable; multi-vehicle buyers see
  one card per option; comparisons render with full width in chat; VIN pastes
  no longer prematurely commit the buyer; stance strip is a real panel card
  instead of a bolted-on header.
- **Negative:** Role enum has three values now; chat markdown renderer has to
  parse tables ahead of `react-native-markdown-display`; panel prompt has more
  rules to memorize.
- **Neutral:** `VehicleRole.CANDIDATE` adds one enum value and one serialized
  role string the frontend must accept. Plans in `docs/plans/` pre-date this
  ADR and should be read as historical direction.

## References

- `docs/plans/multi-vehicle-support.md`
- `docs/plans/insights-panel-state-first-redesign.md`
- ADR-0010 (multi-vehicle/deal architecture)
- ADR-0013 (canonical panel contract, updated here)
- `apps/backend/app/services/panel.py`
- `apps/backend/app/services/panel_cards.py`
- `apps/mobile/components/chat/markdownRenderer.tsx`
- `apps/mobile/components/shared/VehicleComparisonTable.tsx`
