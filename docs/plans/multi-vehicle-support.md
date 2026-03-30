# Multi-Vehicle & Multi-Deal Support

## Problem Statement

Users naturally do these things during car-buying conversations:

1. **Compare vehicles**: "What about the Tacoma vs the F-150?" — currently `set_vehicle` silently overwrites, and vehicle #1's data is permanently lost from the panel
2. **Mention trade-ins with details**: "My trade-in is a 2019 Civic with 45k miles" — the system only captures a dollar amount (`trade_in_value`), losing the vehicle identity (year/make/model/mileage) that would help assess fair trade-in value
3. **Switch focus**: "Actually, let me go back to the Accord" — impossible today because the data was overwritten
4. **Negotiate the same vehicle at multiple dealers**: "Dealer A quoted $42k, Dealer B said $39.6k" — a single session should handle multiple deals, not require separate linked sessions
5. **Expect vehicle-aware advice**: Trade-in year/make/model/mileage affects fair value assessment; knowing both vehicles and multiple dealer offers helps the AI give better advice

### Current Architecture

- **Data model**: One `DealState` row per session with 7 flat `vehicle_*` columns (year, make, model, trim, vin, mileage, color). Trade-in is a single `trade_in_value` float. All financial numbers are session-level.
- **Claude tool**: `set_vehicle` overwrites all vehicle fields. No role concept, no confirmation before switching.
- **System prompt**: No instructions about vehicle comparison, switching, or trade-in vehicle identity.
- **Frontend**: `DealState.vehicle: Vehicle | null` (singular). `VehicleCard` renders one vehicle. `KeyNumbers` shows trade-in as a dollar amount only.
- **Title generation**: Deterministic from the single vehicle's year/make/model/trim.
- **ADR-0003**: Chose single mutable row for simplicity. No mention of multi-vehicle or multi-deal as a concern.

### Impact

- Silent data loss when users naturally compare vehicles
- Can't handle same vehicle at different dealers in one conversation
- Trade-in vehicle identity lost — can't assess if trade-in offer is fair based on year/make/model/mileage
- AI can't reference previous vehicles in the conversation because they're gone from the deal state
- Session title overwrites when a second vehicle is mentioned
- Financial numbers are wrong when switching between vehicles/dealers (numbers from deal A show on deal B)

---

## Proposed Solution

### Two Parallel Tracks

This plan has two components that are being developed together:

1. **Deal-level data architecture** — normalize vehicles and deals so the backend can track multiple vehicles and multiple dealer offers per session
2. **AI-driven InsightsPanel** — give the AI agent control over what appears in the panel, replacing the current rigid widget-per-tool-call approach

These are complementary: the data architecture gives the AI the structured data it needs; the AI-driven panel gives it the freedom to present that data contextually.

To evaluate the AI-driven panel approach, we'll build it side-by-side with the current structured panel and compare them in real usage before committing.

---

## Part 1: Deal-Level Data Architecture

### Core Concept

**A deal is a vehicle + its financial context.** A session is a conversation container that can hold multiple deals.

#### Vehicle Table

Represents a car involved in the session:

| Role | Meaning | Max per session |
|------|---------|-----------------|
| `primary` | A vehicle being actively considered for purchase | unlimited |
| `trade_in` | The buyer's current vehicle | 1 |

No "comparison" role. Every vehicle under consideration is `primary`. "Active deal" is a UI concept, not a data model concept.

#### Deal Table

Ties a vehicle to a specific offer/negotiation. One vehicle can have multiple deals (same F-150 at Dealer A vs Dealer B). Each deal has:
- FK to vehicle
- All financial numbers (msrp, listing_price, current_offer, your_target, walk_away_price, monthly_payment, apr, loan_term_months, down_payment, trade_in_value)
- Scorecard (price, financing, trade_in, fees, overall)
- Health assessment (status, summary, recommendation)
- Red flags
- Offer history (first_offer, pre_fi_price, savings_estimate)
- Dealer name / label (optional: "Dealer A", "AutoNation Honda", etc.)

#### Session-Level State (stays on DealState)

- Phase, buyer context
- Information gaps (about what the buyer doesn't know — session-level)
- Checklist
- Timer
- Active deal ID (which deal the panel is currently showing)

#### Trade-In Vehicle

- Stored as a Vehicle with role `trade_in`
- Trade-in *value* lives on each Deal (different dealers offer different amounts)
- Trade-in vehicle identity (year/make/model/mileage) shared across deals — same car regardless of dealer

#### Key Design Decisions

- **Demotion, not deletion** — old data preserved, no silent overwrites
- **Claude must confirm before switching active deal** — prevents confusion
- **Trade-in value is per-deal** — Dealer A: $15k, Dealer B: $17k for the same car
- **One trade-in vehicle per session** — the buyer has one car to trade

---

## Part 2: AI-Driven InsightsPanel

### The Shift

The current panel is a **dashboard** — structured tool calls map to fixed widgets, and everything with data is shown. The proposed panel is an **AI-curated briefing** — the agent decides what's important right now and surfaces it contextually.

### Why

- A research-phase user doesn't need a scorecard
- A user at the dealership doesn't need the vehicle card — they're looking at the car
- A user comparing two dealers needs the comparison front and center, not buried below numbers
- The AI knows the context. A human advisor wouldn't show the same printout every time.

### Side-by-Side Test

To evaluate this before committing, we build both panels and show them simultaneously:

```
┌──────────────┬─────────────────┬──────────────┐
│  Structured  │                 │  AI-Driven   │
│  Panel       │     Chat        │  Panel       │
│  (current)   │                 │  (new)       │
│              │                 │              │
│  Fixed       │                 │  Agent       │
│  widgets     │                 │  decides     │
│  data-driven │                 │  everything  │
└──────────────┴─────────────────┴──────────────┘
```

- **Left panel**: Current structured InsightsPanel (unchanged)
- **Center**: Chat
- **Right panel**: AI-driven panel populated via new tool
- **Breakpoint**: Three-column layout at ≥1200px. Below that, toggle or show only one panel.
- Same conversation feeds both panels — compare in real time

### AI Panel Tool

The AI populates the right panel via an `update_insights_panel` tool call. It sends an ordered array of cards, each using a fixed template type. The AI controls *what cards appear*, *in what order*, and *what content fills them*. The frontend controls *how each card type looks*.

```python
{
    "name": "update_insights_panel",
    "description": "Update the AI-driven insights panel with cards relevant to the current situation. Call after every response. You control which cards appear, their order, and content. Show only what matters right now — don't show everything just because data exists.",
    "input_schema": {
        "properties": {
            "cards": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {
                            "enum": ["briefing", "numbers", "comparison", "vehicle", "warning", "tip", "checklist"],
                            "description": "Card template to render"
                        },
                        "title": { "type": "string" },
                        "content": { "type": "object", "description": "Card-type-specific structured content" },
                        "priority": {
                            "enum": ["critical", "high", "normal", "low"],
                            "description": "Visual weight — critical gets danger styling, high gets emphasis"
                        }
                    },
                    "required": ["type", "title", "content"]
                }
            }
        },
        "required": ["cards"]
    }
}
```

### Card Types

Each card type has a designed, responsive template. The AI fills in the content.

| Card Type | Purpose | Content Shape |
|-----------|---------|---------------|
| `briefing` | Contextual advice — the "advisor whisper" | `{ body: string }` (markdown) |
| `numbers` | Key financial figures | `{ rows: [{ label, value, highlight?, note? }] }` |
| `vehicle` | Vehicle details | `{ vehicle: {...}, risk_flags?: string[] }` |
| `warning` | Red flags / urgent items | `{ severity: "critical" \| "warning", message: string, action?: string }` |
| `comparison` | Deal comparison (Approach C) | `{ summary, recommendation, highlights: [{ label, deal_a, deal_b, winner, note? }] }` |
| `tip` | Phase-appropriate guidance | `{ body: string, icon?: string }` |
| `checklist` | Action items | `{ items: [{ label, done }] }` |

### What Makes This a Useful Test

- Same data flows to both panels — direct comparison of what each approach surfaces
- Reveals failure modes: Does the AI forget important data? Change layout too aggressively? Get stuck repeating the same cards?
- Reveals strengths: Does the AI-driven panel surface contextual insights the structured panel can't? Does it adapt to phase changes?
- Measures cost: Additional output tokens per response for the panel tool call
- Informs the final decision: keep structured, keep AI-driven, or merge (AI briefing card + structured data below)

### AI Panel System Prompt Guidance

The AI needs instructions for how to populate the panel:

- **Call `update_insights_panel` after every response** — the panel should always reflect the current state
- **Show only what matters right now** — research phase: briefing + vehicle. Negotiation: numbers + warnings + tip. Comparing: comparison card + briefing.
- **Prioritize actionability** — "Counter at $40,600" > "Current offer is $41,200"
- **Don't repeat the chat** — the panel supplements the conversation, it doesn't echo it
- **Adapt to phase and context** — at_dealership gets brief, tactical cards. researching gets educational, thorough cards.
- **Current panel state is passed in context** — avoid rebuilding identical panels; update only what changed

---

## InsightsPanel Modes (Applies to Both Panels)

Regardless of which panel approach wins, the user needs these capabilities:

### Mode 1: Active Deal (default)

Full detail view of the deal the AI is currently focused on. This is 90% of the time.

### Mode 2: Viewing Another Deal

User taps a deal in the comparison card or a deal switcher to see its full details. Same layout, different data. Clear indicator: "Viewing: Dealer A's F-150" with a way to return.

"Active" = what the AI is focused on in conversation. "Viewing" = UI-only state, doesn't change the AI's context.

### Mode 3: Comparison View

Structured comparison of 2+ deals. Uses the comparison card (Approach C: fixed layout, AI-driven content). Can be expanded from the comparison summary card or triggered explicitly.

### Mobile Preview (Collapsed Panel)

- **One deal**: Current behavior (health + offer + flags)
- **Two+ deals**: Comparison headline — "2 deals · Dealer B saves $2,400"

---

## Edge Cases & AI Behavior Rules

Solved at the system prompt / Claude behavior layer, not the data model:

| Scenario | AI Behavior |
|----------|-------------|
| **Casual vehicle mention** ("my neighbor got a Tesla") | Do NOT create a vehicle record. Only create vehicles when the user expresses purchase intent or trade-in intent. |
| **AI suggests vehicles** ("for $35k you could get...") | Do NOT create vehicle records from your own suggestions. Only from user-provided information. |
| **Trim upgrade at dealer** (XLT → Lariat) | Create as a new deal — different vehicle, different price. Flag the price jump. |
| **Deal falls through** | Mark the deal as inactive or remove it. Conversation history retains context. |
| **Vehicle mentioned for someone else** ("helping my son") | Suggest starting a new session. Different buyer/deal. |
| **Post-test-drive rejection** ("hated the Tacoma") | Remove the vehicle/deal to keep the panel focused. |
| **Deal sheet with multiple vehicles** | Extract both purchase vehicle and trade-in in one pass — multiple tool calls in one response. |
| **Same vehicle at different dealers** | Create separate deals on the same vehicle. Each deal has its own numbers, health, and red flags. |

---

## Decisions

1. **Red flags: split between deal-level and session-level.** Deal-specific flags ("Dealer A adding undisclosed fees") live on the Deal. Buyer-level flags ("You haven't been pre-approved") live on DealState (session). The structured panel renders both, sourced from the appropriate level. The AI-driven panel does whatever it thinks is best — it's a separate experiment.

2. **Comparison card appears automatically when 2+ deals exist.** Frontend-triggered, not dependent on the AI calling a tool. The structured panel always shows it. The AI-driven panel can show its own comparison card via the tool.

3. **Deal labels: AI auto-labels from conversation context.** When the user mentions a dealer name ("I'm at AutoNation Honda"), Claude sets it as the deal label. Fallback to generic labels ("Deal 1", "Deal 2") when no name is mentioned. Labels are stored on the Deal model and editable by the user via inline editing (same pattern as vehicle field corrections).

4. **Trade-in value assessment: yes.** With trade-in vehicle details (year/make/model/mileage) now captured, the AI should proactively assess whether each dealer's trade-in offer is fair. This is a key differentiator — the AI can say "Your 2019 Civic with 45k miles typically trades for $16-18k. Dealer A's offer of $14k is below market."

5. **Phase is per-deal.** You can be in "negotiation" with Dealer A and "research" on a new vehicle simultaneously. Phase moves to the Deal table. DealState (session-level) no longer has a phase field.

6. **Migration: delete DB and recreate.** Pre-launch, no production data to preserve. `create_all()` picks up the new models.

7. **Information gaps: hybrid.** Deal-specific gaps ("What's the invoice price?") live on the Deal. Buyer-level gaps ("Have you been pre-approved?") live on DealState (session). The AI populates whichever is appropriate based on the gap's nature. Frontend merges both lists for display.

8. **AI panel token cost: no optimization constraint.** Use as many tokens as needed for accuracy. Measure during testing but don't pre-optimize.

9. **AI panel state: pass current panel back in context.** The current panel cards (compact representation: card types + titles + key values, not full rendered content) are included in the system prompt so Claude can diff rather than rebuild from scratch. This improves accuracy and consistency — the AI knows what it already showed and can make targeted updates. Worth the context tokens for the accuracy gain.

10. **Three-column layout: test-only, no breakpoint concerns.** Developer testing on a wide monitor (≥1200px). No need to handle tablet or mobile for the test layout — that's a concern for whichever panel approach wins.

---

## Additional Decisions

11. **Structured panel also gets multi-deal support.** Both panels get deal-switching and comparison so the test is a fair comparison of presentation approach, not feature availability.

12. **AI panel inline editing: card-type-native.** Editing is a property of the card type, not something the AI controls. `numbers` card rows can include an optional `field` identifier (e.g., `"current_offer"`, `"apr"`) — the frontend uses this to route corrections to the same PATCH endpoint as the structured panel. `vehicle` cards support the same field-level editing. `checklist` cards support toggle. Commentary cards (`briefing`, `tip`, `warning`, `comparison`) are read-only. The AI doesn't need to think about editability — it just populates content; the card template handles the rest.

13. **AI panel state is persisted.** Cards are stored in the DB (JSON column on DealState or a dedicated table) so they survive page refresh. On reload, the frontend renders the last persisted cards. They update on the next message when Claude calls `update_insights_panel`.
