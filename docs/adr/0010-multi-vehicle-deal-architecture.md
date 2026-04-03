# ADR-0010: Multi-Vehicle / Multi-Deal Architecture Within a Single Session

**Status:** Accepted
**Date:** 2026-03
**Deciders:** Kramer Smith

## Context

[ADR-0003](0003-single-mutable-deal-state.md) established a single mutable `deal_states` row per chat session, with vehicle details and financial numbers stored as flat columns directly on that row. This worked for the initial prototype but hit a wall as the product matured:

1. **Multiple vehicles per session.** A buyer may be comparing a 2024 RAV4 at one dealer against a 2024 CR-V at another. They may also have a trade-in. The flat column model (`year`, `make`, `model` on `deal_states`) can only represent one vehicle at a time.
2. **Multiple deals per session.** Each vehicle-at-a-dealer is a distinct negotiation with its own phase, financial numbers, scorecard, and health assessment. Flattening these onto a single row means the user cannot switch between deals without losing state.
3. **Vehicle intelligence.** VIN decoding (NHTSA vPIC), history reports (VinAudit), and market valuations attach to a specific vehicle, not to a session. A vehicle needs to be a first-class entity with its own identity lifecycle (unconfirmed, confirmed, rejected) and child records.
4. **AI tool design.** Claude's tools need to create deals, switch the active deal, set or remove vehicles, and update deal-specific numbers — all within a single conversation. The flat model required awkward overloading of tool semantics.

The question: how to extend the data model so a single chat session can track multiple vehicles and multiple deals while preserving the simple mutable-state read pattern from ADR-0003.

## Decision

Decompose the flat `deal_states` row into three entities with clear ownership boundaries:

### Entity Model

```
ChatSession (1)
  └── DealState (1)          — session-level container
        ├── active_deal_id   — FK pointer to the currently displayed Deal
        ├── buyer_context     — researching | reviewing_deal | at_dealership
        ├── red_flags[]       — session-level (not deal-specific) red flags
        ├── information_gaps[] — session-level gaps
        ├── checklist[]
        ├── ai_panel_cards[]  — persisted AI insight cards
        ├── negotiation_context — AI-maintained situational awareness
        ├── deal_comparison   — AI-generated cross-deal comparison
        └── timer_started_at

ChatSession (1)
  └── Vehicle (0..N)          — session-scoped, role-tagged
        ├── role              — primary | trade_in (VehicleRole enum)
        ├── year, make, model, trim, vin, mileage, color, engine
        ├── identity_confirmation_status — unconfirmed | confirmed | rejected
        └── cascade children:
              ├── VehicleDecode (0..N)          — NHTSA vPIC results
              ├── VehicleHistoryReport (0..N)   — VinAudit history
              └── VehicleValuation (0..N)       — VinAudit market value

ChatSession (1)
  └── Deal (0..N)             — one per vehicle-at-dealer negotiation
        ├── vehicle_id        — FK to Vehicle
        ├── dealer_name
        ├── phase             — research → initial_contact → ... → closing (DealPhase enum)
        ├── numbers           — msrp, invoice_price, listing_price, your_target, walk_away_price,
        │                       current_offer, monthly_payment, apr, loan_term_months,
        │                       down_payment, trade_in_value
        ├── scorecard         — score_price, score_financing, score_trade_in, score_fees, score_overall
        ├── health            — health_status, health_summary, recommendation
        ├── red_flags[]       — deal-specific red flags
        ├── information_gaps[] — deal-specific gaps
        ├── offer history     — first_offer, pre_fi_price, savings_estimate
        └── comparison        — per-deal AI comparison data
```

All three tables (`deal_states`, `vehicles`, `deals`) are keyed to `session_id`. `DealState` remains a single row per session (1:1 with `ChatSession`). `Vehicle` and `Deal` are 0..N per session.

### Key Design Decisions

**Active deal pointer.** `DealState.active_deal_id` is a nullable FK to `deals.id` (with `use_alter=True` to break the circular dependency). The insights panel always renders the active deal. Claude switches it via `switch_active_deal`. When no deals exist, `active_deal_id` is `NULL`.

**Vehicle roles.** The `VehicleRole` enum (`primary`, `trade_in`) tags each vehicle's purpose. Only one trade-in vehicle is allowed per session — `set_vehicle` with `role=trade_in` replaces any existing trade-in (delete + create). Primary vehicles are unlimited.

**Auto-deal creation.** When the first primary vehicle is created in a session that has no deals, a `Deal` row is automatically created and linked, and `active_deal_id` is set. This preserves the zero-config experience for single-deal conversations.

**Cascade deletion.** Removing a vehicle (`remove_vehicle` tool) deletes all associated `Deal` rows and clears `active_deal_id` if it pointed to one of them. Vehicle intelligence children (`VehicleDecode`, `VehicleHistoryReport`, `VehicleValuation`) use SQLAlchemy `cascade="all, delete-orphan"` on the `Vehicle` relationship.

**Scoped ownership.** All queries in `deal_state.py` enforce `session_id` scoping — `_get_session_vehicle()` and `_get_session_deal()` verify that a vehicle or deal belongs to the requesting session before any mutation. This prevents cross-session data leaks even if an AI tool hallucinates an ID.

**Deal-level vs. session-level data.** Financial numbers, scorecard, health, phase, and deal-specific red flags/gaps live on `Deal`. Buyer context, checklist, timer, AI panel cards, negotiation context, and session-wide red flags/gaps remain on `DealState`. This split reflects the domain: a buyer's context and checklist span their entire car-buying journey, while numbers and scores are per-negotiation.

**Tool routing with optional `deal_id`.** Most deal-mutating tools (e.g., `update_deal_numbers`, `update_scorecard`) accept an optional `deal_id`. If omitted, they target the active deal via `get_active_deal()`. This keeps simple single-deal conversations ergonomic while supporting explicit multi-deal targeting.

**Tool execution priority.** Tools are classified by priority (`TOOL_PRIORITY` in `deal_state.py`): structural tools (`set_vehicle`, `remove_vehicle`) at priority 0, context switches (`create_deal`, `switch_active_deal`) at priority 1, and all field-update tools at priority 2. Within a priority tier, tools execute concurrently via `asyncio.gather()` with isolated database sessions. This ordering ensures a vehicle exists before a deal references it, and a deal is active before field updates target it.

### Red flags and information gaps: two-tier model

Red flags and information gaps exist at both levels:
- **Session-level** (`DealState.red_flags`, `DealState.information_gaps`) — buyer-wide concerns (e.g., "You haven't been pre-approved for financing")
- **Deal-level** (`Deal.red_flags`, `Deal.information_gaps`) — negotiation-specific concerns (e.g., "This dealer added a $2,000 paint protection fee")

Separate tools (`update_session_red_flags` vs. `update_deal_red_flags`, `update_session_information_gaps` vs. `update_deal_information_gaps`) let Claude target the appropriate scope.

## Alternatives Considered

### Option A: One deal per session (keep ADR-0003 as-is)

- Pros: Simplest model. No relational complexity. No need for `active_deal_id` switching.
- Cons: Forces users to create a new chat session for every vehicle or dealer they want to compare. Loses conversational context across deals. Makes cross-deal comparison impossible within a single conversation. Does not match how real car buying works — buyers frequently compare options in one sitting.

### Option B: Separate "deal sessions" linked by a parent group

- Pros: Each deal is fully isolated with its own conversation history. No risk of cross-deal data corruption.
- Cons: Breaks the conversational model — the AI loses context when switching sessions. Users must navigate between multiple chats to compare. Vehicle data (especially trade-in) must be duplicated across sessions. The frontend session list becomes confusing with grouped sub-sessions.

### Option C: Full CQRS / event-sourced deal state

- Pros: Complete audit trail of every state change. Enables undo/replay. Cleanly separates read and write models.
- Cons: Massive implementation overhead for a pre-production app. Reads require event replay or a separate materialized view. The mutable-row pattern from ADR-0003 has proven sufficient — the conversation history in the `messages` table already provides an indirect audit trail. CQRS can be layered on later if deal history becomes a product requirement.

## Consequences

- **Positive:** A single conversation can now track a complete car-buying journey: comparing multiple vehicles, negotiating with multiple dealers, and managing a trade-in — all with full AI context.
- **Positive:** Vehicle intelligence (VIN decode, history, valuation) attaches to the vehicle entity, not the session. Data survives deal creation/deletion and is reusable across deals sharing the same vehicle.
- **Positive:** The `active_deal_id` pointer preserves the simple read pattern from ADR-0003 — the frontend still loads one deal's state for the insights panel, just via a join rather than a flat row.
- **Positive:** Auto-deal creation on first vehicle means single-deal conversations (the majority case) require zero extra steps from the user or AI.
- **Positive:** Session-scoped ownership queries prevent cross-session data access, maintaining security even with AI-generated IDs.
- **Negative:** More complex data model — three tables instead of one, with FK relationships and cascade behavior to reason about.
- **Negative:** Tool execution ordering matters. Structural tools must complete before field updates. The priority-based execution plan (`build_execution_plan()`) handles this, but adds conceptual complexity.
- **Negative:** The `active_deal_id` FK with `use_alter=True` creates a circular dependency between `deal_states` and `deals` at the schema level, requiring careful migration ordering.
- **Neutral:** The single-row mutable pattern from ADR-0003 is preserved for `DealState` itself — it just holds less data now, with vehicle and deal details moved to their own tables.

## References

- [ADR-0003: Single Mutable Deal State Row](0003-single-mutable-deal-state.md) — predecessor decision
- [Backend models: DealState](../../apps/backend/app/models/deal_state.py)
- [Backend models: Vehicle](../../apps/backend/app/models/vehicle.py)
- [Backend models: Deal](../../apps/backend/app/models/deal.py)
- [Backend service: deal_state.py](../../apps/backend/app/services/deal_state.py) — tool execution, extraction routing, state serialization
- Key commit: `e0c3ac5 feat(deals): multi-vehicle/deal data architecture with AI-driven insights panel`
