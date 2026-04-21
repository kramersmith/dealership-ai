# Insights Panel Card System

**Last updated:** 2026-04-20

This document defines the exact card kinds, render templates, priorities, and visual rules used by the AI-generated Insights Panel. Panel cards come from two sources merged before canonicalization: deterministic rendering from deal state for most kinds, and a narrow Sonnet synthesis for the three genuinely narrative kinds. The backend canonicalizes the union into a typed panel-card contract; the frontend renders them with fixed templates described here.

---

## How It Works (ADR 0026)

1. The user chats with the AI advisor (Sonnet streams text). Main chat is the sole source of structured state updates via tool calls.
2. After the assistant reply is persisted, a detached follow-up runs panel generation:
   - **Deterministic render** — `panel_card_builder.py:build_rendered_panel_cards(deal_state_dict)` produces ~10 card kinds (`phase`, `numbers`, `warning`, `what_still_needs_confirming`, `checklist`, `your_leverage`, `vehicle`, `success`, `savings_so_far`, `notes`) from deal state with no LLM.
   - **Narrow narrative synthesis** — a Sonnet call produces only the 3 genuinely narrative kinds: `dealer_read`, `next_best_move`, `if_you_say_yes`.
3. Rendered + synthesized cards merge and flow through `canonicalize_panel_cards` + `_enforce_single_vehicle_focus_for_panel_cards`. On synthesis retry exhaustion the rendered cards are still delivered.
4. The frontend renders each card using the templates below.
5. The backend canonicalizes each card into `kind`, `template`, `title`, `content`, and `priority`.
6. The frontend controls **how** each template looks.

> The reconcile LLM pass was removed in ADR 0026. Panel kinds `comparison` and `trade_off` are no longer emitted — side-by-side comparisons render as markdown tables in chat (ADR 0018). The `phase` kind (stance + situation) is always first in the panel order.

## Contract

Each persisted panel card now has:

- `kind`: the exact product-facing card identity
- `template`: the render container used by the frontend
- `title`: canonical title assigned by the backend
- `content`: validated card payload
- `priority`: `critical`, `high`, `normal`, or `low`

The model no longer invents freeform titles or chooses arbitrary templates.

### Exact Card Kinds

- `phase` (stance strip — always first; rendered via `briefing` template with title "Status")
- `vehicle`
- `numbers`
- `warning`
- `notes`
- `comparison` (no longer emitted to the panel — renders as markdown table in chat per ADR 0018)
- `checklist`
- `success`
- `what_changed`
- `what_still_needs_confirming`
- `dealer_read`
- `your_leverage`
- `next_best_move`
- `if_you_say_yes`
- `trade_off` (no longer emitted to the panel — renders as markdown table in chat per ADR 0018)
- `savings_so_far`

### Render Templates

- `vehicle`
- `numbers`
- `warning`
- `notes`
- `comparison`
- `checklist`
- `success`
- `briefing`
- `tip`

### Core Principles

- **The panel supplements the chat — it never contradicts it.** The chat response is the advisor's voice. The panel structures that advice into glanceable cards. If Sonnet says "wait in the parking lot," the panel must not say "leave now."
- **Body text: 1-2 sentences max.** The chat has the detail. The panel is a summary the buyer glances at, not a second essay.
- **No redundancy between cards.** Each card conveys a distinct piece of information. Two cards saying the same thing in different words wastes the buyer's attention.

---

## Card Types

### briefing

**Purpose:** Status updates, assessments, next steps, strategy advice. The default card for conveying information.

**When to use:** "Where we are", "what's happening", "what to do next". Any insight or assessment that isn't a warning, tip, or data display.

**Visual template:**
- Standard card background
- Left accent border in blue (`$brand`) when priority is `critical` or `high`; no border for `normal`/`low`
- Title: 14px, semibold
- Body: 13px markdown text

**Content schema:**
```json
{"body": "1-2 sentence insight or assessment. Supports **markdown**."}
```

**Priority behavior:**
| Priority | Left border | Notes |
|----------|-------------|-------|
| `critical` / `high` | 3px blue | Use for important assessments and next steps |
| `normal` | None | Supplementary context |
| `low` | None | Background information |

> Briefing cards never use red/danger styling. If something is dangerous, use a `warning` card instead.

---

### warning

**Purpose:** Genuine problems or dealer tactics that could cost the buyer money, put them at risk, or disadvantage them in the negotiation.

**When to use:**
- Dealer red flags (suspicious charges, hidden fees, numbers that changed from verbal agreement)
- Scam tactics or deceptive practices
- Missing critical information that creates financial risk (unknown APR on a financed deal)
- Dealer pressure tactics ("let me talk to my manager", time pressure, monthly payment misdirection)
- **NOT** for status updates, negotiation progress, next steps, or general advice

**Visual template:**
- Standard card background
- Left accent border in the severity color
- Icon: AlertCircle (critical) or AlertTriangle (warning) in the severity color
- Title: 14px, semibold, standard text color
- Body: 13px markdown text, standard text color (readable, not colored)
- Optional action section below a divider

**Content schema:**
```json
{
  "severity": "critical|warning",
  "message": "Description of the concern. Supports **markdown**.",
  "action": "Optional — what to do about it"
}
```

**Severity behavior:**
| Severity | Border | Icon | Color |
|----------|--------|------|-------|
| `critical` | 3px red | AlertCircle | `$danger` (red) |
| `warning` | 2px yellow | AlertTriangle | `$warning` (yellow) |

> **Test:** Before using a warning card, ask: "Could this hurt the buyer — financially, tactically, or informationally?" If no, use a briefing or tip instead.

---

### numbers

**Purpose:** Financial data display with labeled rows.

**When to use:** When there are concrete dollar amounts, rates, or terms to show. Price comparisons, payment breakdowns, cost analysis.

**Visual template:**
- Standard card background
- Uppercase section label: 12px, semibold, muted color
- Rows: label on left (13px muted), value on right (14px bold)
- Values can be highlighted green (good), red (bad), or neutral
- Editable fields show a pencil icon; user can tap to correct values

**Content schema:**
```json
{
  "rows": [
    {"label": "Field Name", "value": "$32,000", "highlight": "good|bad|neutral"},
    {"label": "Editable Field", "value": "$28,000", "field": "current_offer", "highlight": "neutral"}
  ]
}
```

Rows can also be grouped:
```json
{
  "groups": [
    {"key": "pricing", "rows": [...]},
    {"key": "financing", "rows": [...]}
  ]
}
```

**Editable fields** (include `"field"` key): `msrp`, `invoice_price`, `listing_price`, `your_target`, `walk_away_price`, `current_offer`, `monthly_payment`, `apr`, `loan_term_months`, `down_payment`, `trade_in_value`

---

### vehicle

**Purpose:** Vehicle information card with key specs and risk flags.

**When to use:** When a vehicle has been identified. Always include one if the buyer is discussing a specific vehicle.

**Visual template:**
- Standard card background
- Uppercase section label: 12px, semibold, muted color
- Vehicle summary line: 16px bold (Year Make Model Trim)
- Engine, mileage, color: 13px muted
- VIN: 12px monospace, muted
- Risk flags: red badge pills below the vehicle info

**Content schema:**
```json
{
  "vehicle": {
    "year": 2024,
    "make": "Ford",
    "model": "F-250",
    "trim": "Lariat",
    "engine": "7.3L Godzilla V8",
    "mileage": 15000,
    "color": "White",
    "vin": "1FT8W3BT..."
  },
  "risk_flags": ["High Mileage", "Commercial Title History"]
}
```

> Risk flags on the vehicle card are vehicle-specific concerns (mileage, title, mechanical). Deal-level concerns (pricing, financing) belong in warning cards.

---

### tip

**Purpose:** Tactical advice, negotiation tips, or helpful context.

**When to use:** When there's actionable advice for the current phase that doesn't fit in a briefing. Tips are forward-looking ("here's what to do") while briefings are assessment-oriented ("here's where you stand").

**Visual template:**
- Standard card background
- Lightbulb icon in blue (`$brand`)
- Title: 14px, semibold
- Body: 13px markdown text

**Content schema:**
```json
{"body": "Helpful advice for the current phase. Supports **markdown**."}
```

---

### comparison

**Purpose:** Side-by-side deal comparison when the buyer is evaluating the same vehicle at multiple dealers or comparing different vehicles.

**When to use:** When 2+ deals exist and the buyer is deciding between them. The AI highlights key differences and makes a recommendation.

**Visual template:**
- Standard card background
- Uppercase section label: 12px, semibold, muted color
- Summary: 13px body text
- Highlight rows: label (12px muted) with side-by-side values (14px bold for winner, 14px normal for others)
- Deal IDs below values: 12px muted
- Optional notes per highlight: 12px muted italic
- Recommendation section at bottom with success theme, separated by divider

**Content schema:**
```json
{
  "summary": "Brief overall comparison, 1-2 sentences",
  "recommendation": "Actionable recommendation",
  "best_deal_id": "ID of the best deal",
  "highlights": [
    {
      "label": "Price",
      "values": [
        {"deal_id": "dealer-a-id", "value": "$28,500", "is_winner": true},
        {"deal_id": "dealer-b-id", "value": "$30,200", "is_winner": false}
      ],
      "note": "Optional context"
    }
  ]
}
```

---

### checklist

**Purpose:** Action items the buyer should complete.

**When to use:** When there are concrete steps the buyer needs to take. Phase-specific checklists, pre-visit prep, negotiation steps.

**Visual template:**
- Standard card background
- Uppercase section label: 12px, semibold, muted color
- Progress counter (e.g., "2/5") aligned right of label
- Checkbox rows: 22px checkbox + 13px label text
- Done items: strikethrough text, muted color, filled checkbox

**Content schema:**
```json
{
  "items": [
    {"label": "Get out-the-door price in writing", "done": false},
    {"label": "Complete test drive", "done": true}
  ]
}
```

---

### success

**Purpose:** Celebrate a win — savings achieved, deal closed, or a milestone reached. This is the "referral screenshot" moment.

**When to use:** When the buyer has achieved a measurable savings, closed a deal, or reached a significant milestone worth celebrating. Use sparingly — only for genuine wins, not participation trophies.

**Visual template:**
- Standard card background
- Left accent border in green (`$positive`), 3px
- CheckCircle icon in green (`$positive`)
- Title: 14px, semibold
- Body: 13px markdown text

**Content schema:**
```json
{"body": "You saved an estimated **$2,400** compared to the dealer's first offer."}
```

> This card is the one buyers screenshot and text to friends. Make the savings number prominent and the message concrete.

---

## Priority Levels

Priority controls emphasis within a card's template. It does NOT change the card type's visual language.

| Priority | Meaning | Usage |
|----------|---------|-------|
| `critical` | Requires immediate attention | Only for warnings about genuine risk. All other card types treat `critical` as `high`. |
| `high` | Important, should be noticed | Key insights, next steps, active negotiation points |
| `normal` | Supplementary | Context, background data, supporting information |
| `low` | Nice-to-know | Background details the user may not need right now |

> **Key rule:** `critical` priority triggers danger/red styling ONLY on `warning` cards. All other card types treat `critical` the same as `high`. If you want red, use a warning card — not a critical briefing.

---

## Phase-Aware Composition

The panel should feel different at each stage of the buying journey. The AI regenerates all cards each exchange, but should follow these composition guidelines.

### Research (at home, browsing)

The buyer is exploring options, not under pressure. Panel should educate and organize.

- **Typical cards:** vehicle + briefing + numbers (if available) + tip + checklist
- **Card count:** 4-6 (more detail is fine — buyer has time to read)
- **Tone:** Informational, thorough
- **Body text:** Can be 2 sentences — buyer is reading at leisure

### Initial Contact / Test Drive (at or near dealership)

The buyer is engaging with the dealer. Panel should prepare them tactically.

- **Typical cards:** briefing + vehicle + numbers + checklist + tip
- **Card count:** 4-5
- **Tone:** Tactical, preparatory
- **Body text:** 1-2 sentences

### Negotiation (at dealership, actively negotiating)

The buyer is glancing at their phone under the table. Every word must earn its place.

- **Typical cards:** briefing (with script) + numbers + warning (if applicable) + checklist
- **Card count:** 3-4 max — brevity is critical
- **Tone:** Direct, script-oriented
- **Body text:** 1 sentence max. Use bold for key numbers.
- **Warnings dominate** when present — push to top

### Financing / F&I (at dealership, in the finance office)

The buyer faces a barrage of upsells. Panel should be a shield.

- **Typical cards:** warning (F&I upsells) + numbers (total cost breakdown) + briefing + checklist
- **Card count:** 3-4
- **Tone:** Protective, cost-focused
- **Body text:** Short. Focus on total cost impact.

### Closing (signing paperwork)

The buyer is about to sign. Panel should confirm the deal and surface post-purchase items.

- **Typical cards:** success (if savings achieved) + numbers (final deal summary) + checklist (post-purchase)
- **Card count:** 2-4
- **Tone:** Confirmatory, forward-looking

---

## Card Stability

The AI regenerates all cards each exchange. However, some cards should **persist** across exchanges (same content, same position) while others should **refresh**:

| Card Type | Behavior | Rationale |
|-----------|----------|-----------|
| vehicle | Persist | Vehicle specs rarely change. Seeing the same card in the same spot provides an anchor. |
| numbers | Persist (update values) | Financial data updates but the structure stays. Users expect numbers in the same place. |
| checklist | Persist (update done states) | Checklist items carry over. Don't regenerate from scratch each time. |
| briefing | Refresh | Assessment changes with each exchange. Always reflects current state. |
| warning | Refresh | Warnings appear/disappear as risks change. |
| tip | Refresh | Tips are contextual to the latest exchange. |
| success | Refresh | Appears when a milestone is reached, may not persist. |

> The AI should maintain continuity for data cards. If the last panel had a numbers card with "Price Gap Analysis", the next panel should update its values, not replace it with a completely different numbers card (unless the focus has materially changed).

---

## Card Ordering

Cards are rendered top-to-bottom in the order the AI returns them. Order by importance:

1. Warning cards (critical first, then warning severity)
2. Success cards (when applicable)
3. Briefing cards (current assessment / next step)
4. Numbers cards
5. Comparison cards (when multiple deals exist)
6. Vehicle cards
7. Tip cards
8. Checklist cards

---

## Panel Rules

- **3-6 cards** per panel (3-4 at the dealership)
- **Always include** a vehicle card if a vehicle has been identified
- **Always include** a briefing card with the current assessment
- **Include numbers** when financial data exists
- **Include warnings** only for genuine risks or harmful tactics
- **Include success** only for measurable wins
- **Don't repeat** the chat response — the panel supplements with structured data
- **Keep body text concise** — 1-2 sentences max. The chat has the detail.
- **Checklist items** must have text labels (not empty strings)

---

## Visual Families

The card types fall into two visual families:

**Content cards** (briefing, warning, tip, success):
- Icon or left accent border for visual signal
- 14px semibold title
- 13px markdown body text

**Data cards** (numbers, vehicle, comparison, checklist):
- 12px uppercase section label
- Structured data below (rows, specs, checkboxes, highlights)

This distinction helps users scan the panel quickly: content cards = "read this", data cards = "reference this".
