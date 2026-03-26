# Insights Panel Redesign

**Created:** 2026-03-26

This document maps every meaningful situation a buyer encounters during the car-buying journey, identifies what information matters in each, and proposes how the Insights Panel should adapt. It incorporates UX, business strategy, and AI system design perspectives.

---

## The Core Problem

The current Insights Panel shows the same widgets regardless of context. A user researching "what car should I buy for $25k?" sees a grid of nine financial fields — all showing "—". This communicates nothing and makes the app feel like an empty dashboard rather than an intelligent advisor.

**Principle:** The panel should only show information that is *relevant right now* and *actionable*. Empty fields aren't just unhelpful — they add cognitive load at the exact moment a stressed buyer can least afford it.

---

## Strategic Context

### The Competitive Landscape

The real competitor is not ChatGPT — it's **going in blind.** Most buyers walk into a dealership with nothing: no prep, no strategy, no price research. They Google "is this a good price" in the bathroom while the salesperson "talks to their manager."

TrueCar, KBB, Edmunds, and CarGurus give price *data* but no real-time tactical support. General AI chatbots give advice but have no structured deal tracking, no situational awareness, and no persistence. The moat is the combination: **structured deal intelligence + real-time AI coaching + situational awareness.** None of the data providers do that. None of the chatbots do that.

### The Purchase Cycle Problem

People buy cars every 3-7 years. There is no daily-active-user flywheel. The app has to deliver so much value in a *single transaction* that the user tells everyone they know. The metric that matters is not engagement — it's **"I saved $X"** and the referral that follows. This shapes two design decisions:

1. The savings estimate should be a first-class element in the panel when a deal concludes. "You saved an estimated $2,400 compared to the dealer's first offer." That's the screenshot that gets texted to friends.
2. First-use trust is everything. A user who downloads the app at the dealership has to see value within 2-3 exchanges. A wall of empty dashes kills that trust instantly.

### User Sophistication Varies

A first-time buyer who's terrified behaves differently from an experienced buyer who wants data validation. The AI's tone, the panel's density, and the proactivity level should adapt. The current buyer context system (researching / reviewing / at dealership) captures *situation* but not *sophistication*. A future enhancement: a soft signal like "Is this your first time buying a car?" That single question would change how the entire experience should feel.

---

## AI System Design Constraints

### The Market Price Problem

Claude does not have real-time pricing data. When the AI says "that's above market value," it's making an educated guess based on training data that may be months or years old. If a red flag says "This is $2,000 over market" and it's wrong, the user loses trust *and* credibility with the dealer.

**Implications:**
- Until real pricing APIs are integrated (KBB, Edmunds, MarketCheck), the AI must frame guidance relative to the *user's own data* — "Their offer is $3,000 above listing" rather than "The market price is $23,000."
- Deal health and red flags should be grounded in verifiable facts from the conversation (offer vs. target, APR vs. typical ranges, fees that appeared unexpectedly) — not claims about market conditions the AI can't verify.
- The system prompt must explicitly instruct the AI to avoid stating specific market prices as fact.

### Information Gaps Are a First-Class Feature

One of the most valuable things the AI can do is identify what it *doesn't know yet*. "I'm missing 3 key pieces that would help me give you better advice: (1) your credit score range, (2) whether there are factory rebates, (3) the out-the-door price."

This should be a dedicated section in the panel — not just a chat response. "What We Still Need" with tappable items that generate prompts. This is the purest form of the proactive AI differentiator: the app knows what questions to ask even when the buyer doesn't.

### Red Flags Need Confidence Calibration

Red flags are the highest-value feature, but false positives destroy trust fast. If the app warns "the APR seems high" but the buyer has poor credit and it's actually a fair rate, the buyer loses faith in the whole system.

**Design rules for red flags:**
- Each flag must be grounded in concrete, verifiable data from the conversation — not the AI's general knowledge about what prices "should" be.
- Include severity levels: **warning** (something to be aware of) vs. **critical** (stop and address this now).
- Good example: "The monthly payment they quoted ($450) assumes a 72-month loan, but they haven't mentioned the term. Ask them to confirm." — Grounded in what the user reported, verifiable.
- Bad example: "This price is above average for your area." — Claude has no idea what current prices are in their area.

### Number Extraction Reliability

When a user says "they offered twenty-seven five with 2 grand down at 5.9 over 72 months," the AI needs to parse that into structured data. It usually will, but sometimes it'll get a number wrong. For high-stakes moments (an offer, a counter, final paperwork), the panel should briefly confirm extracted data: "I captured: $27,500, $2,000 down, 5.9% APR, 72 months — is that right?" This prevents silent errors from compounding through the deal assessment.

### System Prompt Priority Hierarchy

As new tools are added (red flags, information gaps, deal health), the system prompt needs a clear priority hierarchy so the AI knows what matters most:

1. **Red flags** — surface concerns immediately, never delay
2. **Deal health** — update the overall assessment after any significant change
3. **Information gaps** — identify missing data that would improve advice quality
4. **Deal numbers** — capture any financial figures mentioned
5. **Phase/context transitions** — update when the situation changes
6. **Quick actions** — suggest next steps when context shifts
7. **Checklist** — update preparation/verification items

### Context Window Management

Long negotiation sessions can span 50+ messages over several hours. The deal state summary injected into the system prompt must stay concise and prioritized. The AI should see: current deal health, active red flags, and information gaps at the top — not buried after 20 number fields. As the panel gets smarter, the deal state context section needs active curation, not just a JSON dump.

---

## Buyer Journey: All Situations

### Phase 1: Research

The buyer is at home, browsing, not yet committed to a vehicle or dealership.

#### 1A. No specific vehicle yet

> "What's a good car for $25k?"
> "Best SUVs for families?"
> "Should I buy new or used?"

**What the buyer needs:**
- Budget context (what their money can get them)
- General guidance on what to prioritize
- Direction toward narrowing down options

**What they DON'T need:**
- Deal numbers grid (nothing to show)
- Scorecard (no deal to score)
- Vehicle card (no vehicle yet)
- Checklist (nothing to check yet)

**Insights Panel:** Essentially empty. The chat IS the experience here. The panel should either not appear or show a subtle prompt: "Tell me about a specific vehicle and I'll start tracking your deal."

#### 1B. Specific vehicle identified

> "I'm looking at a 2019 Honda Civic"
> "What do you think about the Toyota RAV4?"

**What the buyer needs:**
- Vehicle summary (what they're looking at)
- Known issues / reliability concerns for that model
- What to look for when shopping for this specific vehicle
- Information gaps: "To help you further, I'd need to know: budget, new vs. used preference, planned usage"

**What they DON'T need:**
- Listing price, current offer, APR, monthly payment (no deal exists yet)
- Scorecard (nothing to score)
- Negotiation progress bar

**Insights Panel:** Vehicle card + information gaps ("What We Still Need") + preparation checklist. The AI should proactively surface model-specific concerns (e.g., "2007-2012 Altima CVT transmissions are a known failure point").

#### 1C. Listing/price found

> "I found one listed for $28,500 with 45k miles"
> "There's one on CarGurus for $22k"

**What the buyer needs:**
- Vehicle summary
- Listing price with AI-suggested target and walk-away prices
- Preparation checklist (what to verify before/during a visit)
- Information gaps: credit score, trade-in value, pre-approval status (with explanation of *why* pre-approval matters — this is the highest-leverage prep step most buyers skip)

**What they DON'T need:**
- Current offer, monthly payment, APR (no deal yet — these are dealer-side numbers)
- Full scorecard (no deal to score yet)

**Insights Panel:** Vehicle card + key numbers (listing + target + walk-away only) + information gaps + preparation checklist.

---

### Phase 2: At the Dealership

The buyer is physically present. They're under time pressure, socially pressured, and need fast, glanceable information.

#### 2A. Just arrived

> "I just got here"
> "I'm at the dealer"

**What the buyer needs:**
- Timer (track how long they've been there — dealers use time as a tactic)
- Reminders of what to check / what not to agree to
- Quick confidence boost: "You're prepared. Here's your plan."
- Any deal context carried over from research
- Information gaps: anything critical still missing before negotiation starts
- Pre-approval status: if the buyer hasn't mentioned a pre-approval, this is the last chance to surface it as a high-priority gap. "Having a pre-approved loan from your bank gives you a rate to beat and forces the dealer to compete on price alone."

**Insights Panel:** Timer (prominent) + checklist + vehicle card (if known) + information gaps (with pre-approval prominently flagged if missing). The panel should feel like a briefing, not a dashboard.

#### 2B. Test drive

> "I'm about to test drive it"
> "Just finished the test drive"

**What the buyer needs:**
- Test drive checklist (what to check: brakes, steering, road noise, electronics, AC, alignment)
- Reminder: "Don't discuss price until after the test drive"
- Timer (still running)

**Insights Panel:** Test drive checklist (phase-specific, ideally model-specific from the AI) + timer.

#### 2C. Receiving first offer

> "They're offering $27,000"
> "The salesperson said $450/month"

**What the buyer needs:**
- The offer in context: vs. listing, vs. target
- Deal health: clear signal — is this a reasonable starting point?
- Red flags (if any: e.g., "They led with monthly payment instead of total price — a common tactic to obscure the real cost")
- Number confirmation: "I captured $27,000 — is that the out-the-door price or just the vehicle?"
- What to say next (tactical script)

**What changes:** This is the first moment deal numbers become relevant. But even now, not ALL fields matter. The buyer needs to see: their offer vs. your target. APR and monthly payment may not be discussed yet.

**Insights Panel:** Deal health signal + key numbers (offer vs. target) + red flags (if any) + number confirmation.

#### 2D. Active negotiation

> "They came back at $26,500"
> "I countered with $25,000 and they said no"
> "Now they're saying $26,000 but adding a $500 doc fee"

**What the buyer needs:**
- Deal health: updated with each exchange
- Deal momentum: how the offers have moved (first offer → counter → current)
- Current position vs. target and walk-away
- Scorecard: how does each dimension look? (price, fees, trade-in, financing)
- Red flags: hidden fees, pressure tactics, bait-and-switch, numbers that changed
- Trade-in net change: if both trade-in value and vehicle price moved, show the NET improvement — not just the individual changes (see "Trade-In Tracking" section below)
- Scripts for the next counter

**Insights Panel:** This is where the FULL dashboard earns its place. Deal health + red flags + key numbers (including trade-in net change) + scorecard + momentum + checklist.

#### 2D-i. "Let me talk to my manager"

> "The salesperson went to talk to their manager"
> "I'm waiting while they check with management"
> "They've been gone for 15 minutes"

This is one of the most common and stressful moments in car buying. It's also a standard dealer tactic: the delay builds anxiety, the "manager approval" makes the buyer feel like the salesperson is fighting for them, and the buyer becomes more likely to accept whatever comes back.

**What the buyer needs:**
- Recognition that this is happening and that it's normal — "This is a standard part of the process. They may come back with a small concession designed to make you feel like you won."
- Time to prepare: "Decide your next counter NOW, before they return. If they come back above $X, say: '...'"
- Reinforcement of their position: the panel should show the current deal health and their target clearly so they don't lose their anchor under pressure

**Insights Panel behavior:** The AI should recognize "waiting for manager" language and surface a contextual tip — either as a red flag (warning severity: "The 'manager step' is a standard negotiation tactic — use this time to decide your next move") or as a chat response. The panel doesn't need a new widget for this; the existing red flags and quick actions can handle it. The key is that the AI is trained to catch this moment and respond proactively.

#### 2E. F&I (Finance & Insurance) office

> "I'm in the finance office now"
> "They're offering gap insurance for $800"
> "The finance manager wants me to buy an extended warranty"

**What the buyer needs:**
- F&I-specific warnings: what to expect, what to decline, what might be worth it
- Running total: how add-ons are changing the deal
- Red flags: common F&I profit centers (VIN etching, fabric protection, inflated warranty prices, payment packing)
- APR context: is the rate competitive given what the user has told us about their credit?
- The critical reminder: "Everything in F&I is negotiable. You can say no to all of it."

**Insights Panel:** F&I checklist + deal total tracker (how the price has grown from the agreed number) + red flags. The panel should *transform* for this phase — it's a completely different kind of decision-making.

#### 2F. Final review / signing

> "I'm about to sign the paperwork"
> "Can you check these final numbers?"

**What the buyer needs:**
- Final verification checklist: does the paperwork match what was verbally agreed?
- Total cost summary: out-the-door price, monthly, total cost over loan term
- Red flags: anything that changed from the negotiated deal
- Clear go/no-go signal: "This matches what you agreed to" or "STOP — the APR is different from what was discussed"
- Number confirmation prompt: critical to verify the final numbers are what was agreed

**Insights Panel:** Final checklist + deal summary + go/no-go signal.

---

### Phase 3: Post-Visit / Follow-Up

#### 3A. Left without buying (walking away)

> "I walked out"
> "I told them I'd think about it"

**What the buyer needs:**
- Reassurance that walking away was the right call (if it was)
- What to expect next (dealer may call back with a better offer within 24-48 hours)
- Deal summary to reference when comparing other dealers
- Strategy for the follow-up call

**Insights Panel:** Deal summary (frozen) + next steps guidance.

#### 3B. Got a deal sheet to review at home

> "They gave me this paperwork to look over" (photo upload)
> "Here are the numbers they sent me"

**What the buyer needs:**
- Line-by-line analysis of the deal sheet
- Hidden fees identification
- Comparison to what was verbally discussed (if tracked)
- Specific items to push back on
- Red flags from the paperwork

**Insights Panel:** Full numbers breakdown + red flags + counter-offer suggestions.

#### 3C. Comparing multiple dealers/offers

> "I got quotes from three dealers"
> "Dealer A is $26k, Dealer B is $25.5k but higher APR"

**What the buyer needs:**
- Comparison framed as total cost, not just sticker price (include financing costs over the full term)
- Leverage tips: "Tell Dealer A you have a $25.5k offer"
- Clear recommendation on which deal is better overall

**Insights Panel:** This is a current gap. Linked sessions could enable comparison views. For now: the AI references linked session context and surfaces comparisons in chat. Future: a dedicated comparison widget.

#### 3D. Deal completed

> "I signed! Got it for $25,500"

**What the buyer needs:**
- Savings summary: "You saved an estimated $X compared to their first offer"
- Deal recap: final terms in one place
- Post-purchase reminders: check the title in 30 days, review the first statement, etc.

**Insights Panel:** Savings summary (the referral-driving moment) + final deal recap + post-purchase checklist. The savings number is the single most shareable element in the entire app.

---

## Key Observations

### 1. The numbers grid should NOT be the default

The current 9-field grid assumes the buyer is in active negotiation. For research-phase users — likely the majority of early sessions — it's a wall of dashes. Show ONLY the fields that have values and are relevant to the current phase. A researching user should never see "Current Offer: —".

### 2. Deal health is the #1 insight

At every phase after the first offer, the buyer's primary question is: **"Is this a good deal?"** The panel should lead with a clear, single signal — not five separate indicators the buyer must mentally synthesize.

### 3. Red flags are the highest-value proactive insight — but must be grounded

The AI can detect things the buyer would miss. But every flag must be traceable to concrete data from the conversation, not the AI's general knowledge. False positives are worse than no flags at all.

### 4. Information gaps drive the conversation forward — but never gate-keep

"What We Still Need" is one of the strongest differentiators. But the AI must **always lead with its best assessment first**, then explain what would make it better. Never: "I need your credit score before I can help." Always: "At first glance, this looks like a fair deal — but I could give you a much sharper assessment if you can tell me your credit score range and whether you have a pre-approval." Each gap should be tappable, generating a prompt the user can send or use with the dealer.

### 5. The panel should tell a story, not display a dashboard

Instead of: "Here are 15 data points, figure out what matters."
It should be: "Here's what's happening with your deal, here's what's concerning, here's what to do next."

### 6. Phase transitions should transform the panel

The panel for a researcher should look completely different from the panel for someone in the F&I office. The widgets themselves should change, not just their order.

### 7. The savings moment is the viral loop

When the deal is done, showing "You saved an estimated $2,400" is the single most powerful driver of word-of-mouth. This is the screenshot that gets texted to friends. It should be prominent and shareable.

### 8. Number confirmation prevents compounding errors

When the AI extracts numbers from freeform text, it should confirm critical values before baking them into deal assessments. A wrong number silently propagated through red flags and deal health is worse than asking the user to confirm.

### 9. Total cost over loan term is the most important missing number

Dealers manipulate buyers by focusing on monthly payment and stretching the term. "$450/month" sounds reasonable until you realize that's 72 months at 6.9% = $32,400 total on a $27,000 car. Whenever monthly payment, APR, and loan term are known, the panel should always show the total cost over the life of the loan. This is a simple calculation but a powerful anti-manipulation tool. It should appear automatically — the AI doesn't need to call a tool for it; the frontend computes it from existing deal numbers.

### 10. Negotiation scripts deserve distinct visual treatment

The AI already generates "say this word-for-word" scripts, but they're buried in markdown chat bubbles. At the dealership, the buyer is glancing at their phone while a salesperson watches. Scripts need to be instantly findable and copyable — distinct styling, a copy button, maybe a dedicated "Scripts" section or at minimum a visually distinct block format in chat. This directly supports the core "at the dealership" use case.

### 11. Post-purchase isn't the end — it's the trust-building moment

After signing, buyers need reminders: check the title arrives within 30 days, verify the first loan statement matches agreed terms, confirm trade-in payoff was processed, review the deal for any post-sale regret. A post-purchase checklist keeps the app useful after the deal closes and reinforces trust — the app didn't just help you buy, it's watching your back afterward. This also creates a natural re-engagement touchpoint for the next purchase (years later) or referral.

### 12. Trade-in is a major manipulation vector

Dealers commonly inflate the trade-in value while hiding the cost in the new car's price. A buyer thinks they're getting $8,000 for their trade-in, but the dealer quietly raised the vehicle price by $2,000 to compensate. The net improvement is only $6,000 — but the buyer *feels* like they got a great trade-in deal.

The panel should track trade-in as a distinct, prominent number and — critically — show the **net deal change** whenever trade-in and purchase price move together. This is a Tier 1 (frontend-derived) computation: if trade-in went up $2,000 but price also went up $1,500, display "+$500 net improvement" rather than letting the buyer see two separate changes and feel good about a number that barely moved. The AI should also be trained to flag this pattern as a red flag: "They offered $2,000 more for your trade-in, but the vehicle price went up $1,500 at the same time — the net improvement is only $500."

### 13. Pre-approval is the #1 leverage tool most buyers don't know about

Having a pre-approved loan from a bank or credit union before visiting a dealership fundamentally changes the power dynamic. The buyer can negotiate on purchase price alone without the dealer bundling profit into financing. It also gives the buyer a rate to benchmark against — if the dealer can beat it, great; if not, the buyer already has their financing locked in.

This should be surfaced as a high-priority information gap during research and again at the "just arrived" phase if still missing. Not just "Do you have pre-approval?" but with the *why*: "Getting pre-approved before negotiating forces the dealer to compete on price alone and gives you a rate floor. Most credit unions offer this online in minutes."

---

## Two-Tier Intelligence Architecture

A critical design decision: **not every panel insight should depend on the AI calling a tool.** Tool call reliability decreases as the number of tools increases. With 10+ tools, the AI will sometimes forget to update deal health after numbers change, or miss a red flag it should have caught. A stale panel is worse than no panel.

The solution is two tiers of intelligence:

### Tier 1: Frontend-Derived (always fresh, zero latency)

These are computed locally from the structured deal state. They're always up-to-date because they react to data changes, not tool calls.

| Signal | Computation |
|--------|-------------|
| **Basic deal health** | offer < target → good, offer between target and walk-away → fair, offer > walk-away → bad |
| **Total cost over loan term** | monthly × term (adjusted for APR if needed) |
| **Trade-in net change** | delta of trade-in value minus delta of vehicle price when both change |
| **Number completeness** | which fields are null → baseline information gaps |
| **APR assessment** | compare against known thresholds (< 6.5% good, > 9% concerning) |

### Tier 2: AI-Assessed (richer, but may lag)

These require the AI's contextual understanding and can only come from tool calls.

| Signal | Why AI is needed |
|--------|-----------------|
| **Deal health summary** | The one-line explanation requires understanding the conversation context, not just numbers |
| **Red flags** | Pattern detection across multiple data points ("they quoted monthly without mentioning term") |
| **Contextual information gaps** | Knowing *which* missing pieces matter most given the current conversation |
| **Nuanced scorecard** | Evaluating trade-in fairness, fee reasonableness, financing quality |
| **Dealer tactic recognition** | Detecting "manager step," time pressure, bait-and-switch patterns |

### How They Work Together

The panel always shows Tier 1. When the AI calls a tool, Tier 2 enriches or overrides. If the AI forgets to call `update_deal_health`, the buyer still sees a basic green/yellow/red signal — it's just missing the explanatory sentence. This is dramatically better than a stale or empty widget.

### Backend Safety Net

If deal numbers changed but the AI didn't call `update_deal_health` or `update_red_flags`, the backend fires a lightweight assessment pass using the fast model (Haiku). This mirrors the existing pattern for quick actions — the backend catches what the primary model missed. The assessment pass evaluates the current deal state and emits tool_result SSE events for deal health and red flags.

---

## Proposed Panel Architecture

### Always Present (when relevant)
- **Deal Phase Indicator** — where you are in the process (vertical stepper)
- **Vehicle Card** — what you're looking at (only after vehicle identified)

### New Widgets Needed

#### 1. Deal Health Summary
Single overall signal (green/yellow/red) with a one-line explanation.
- "Strong deal — offer is $1,200 below listing price"
- "Fair — but the APR adds $1,800 over the loan term"
- "Concerning — three new fees appeared since the verbal agreement"

Grounded in the user's own deal data, not market claims. Replaces the scorecard as the *first thing you see*. Scorecard remains available for users who want the detailed breakdown.

#### 2. Red Flags
AI-detected concerns, each with a short explanation and severity (warning / critical).
- Prominent styling (danger theme for critical, warning theme for caution).
- Each flag tied to specific data from the conversation.
- Dismissable — user can acknowledge and move on.

#### 3. Information Gaps ("What We Still Need")
Missing data that would improve the AI's advice quality.
- Each gap is tappable — generates a prompt the user can send or use at the dealer.
- Prioritized: most impactful gaps first.
- Examples: "Credit score range," "Out-the-door price vs. vehicle price," "Loan term length."
- Gaps resolve automatically when the AI captures the information.

#### 4. Key Numbers (Compact)
Replaces the current 9-field grid. Shows ONLY populated, relevant fields.
- Research: listing price + suggested target + walk-away
- Negotiation: their offer + your target + walk-away (+ APR/monthly when discussed)
- F&I: agreed price + current total with add-ons + monthly + APR
- Adapts dynamically as information arrives.
- **Total cost over loan term**: auto-calculated by the frontend whenever monthly payment, APR, and loan term are all known. Shown prominently — this is the anti-manipulation number that dealers don't want buyers thinking about. No backend tool needed; pure frontend computation from existing deal numbers.

#### 5. Savings Summary (Post-Deal)
Shows estimated savings when a deal concludes.
- "Estimated savings: $2,400 vs. first offer"
- Could also show: total cost over loan term, effective monthly cost.
- Designed to be screenshot-worthy — this is the referral moment.

#### 6. Number Confirmation
Transient widget that appears when the AI extracts critical numbers.
- "I captured: $27,500 offer, 5.9% APR, 72 months. Correct?"
- Confirm / Edit buttons.
- Disappears after confirmation; numbers flow into deal state.

#### 7. Copyable Negotiation Scripts (Chat Enhancement)
Not a panel widget, but a chat-level feature that supports the panel's mission.
- When the AI generates a "say this" script, render it in a visually distinct block: different background, quotation styling, copy-to-clipboard button.
- At the dealership, the buyer needs to glance at their phone and read the exact words. Buried in a paragraph of markdown isn't good enough.
- Implementation: the AI wraps scripts in a specific format (e.g., a blockquote or a custom marker) that the frontend renders with special styling and a copy action.

#### 8. Post-Purchase Checklist
Appears when the deal phase transitions to "completed" (or the user indicates they signed).
- Auto-populated with standard post-purchase items: title arrival (30 days), first statement review, trade-in payoff confirmation, warranty documentation.
- Keeps the app useful after the deal closes — reinforces trust.
- The savings summary + post-purchase checklist together create the post-deal experience.

### Widgets to Rethink

- **NumbersSummary (current)** — Replace with Key Numbers (Compact). Current implementation shows every field always. Refactor to only render populated, phase-relevant fields.

- **NegotiationScorecard (current)** — Keep but deprioritize below Deal Health. The per-category breakdown is valuable for detail-oriented users but shouldn't be the primary signal.

### Context-Dependent Composition

#### Research — No Vehicle
- Panel hidden or shows a subtle prompt to describe a vehicle

#### Research — Vehicle Identified
1. Vehicle card
2. Information gaps
3. Preparation checklist

#### Research — Price Found
1. Vehicle card
2. Key numbers (listing + target + walk-away)
3. Information gaps
4. Preparation checklist

#### At Dealership — Pre-Offer
1. Timer
2. Vehicle card (if known)
3. Information gaps (critical items before negotiation)
4. Checklist (phase-specific)

#### Active Deal — Negotiating
1. Deal health
2. Red flags (if any)
3. Key numbers
4. Scorecard (detailed breakdown)
5. Checklist
6. Timer (if at dealership)

#### F&I Office
1. Timer
2. Red flags (F&I-specific warnings)
3. Key numbers (agreed price vs. current total with add-ons)
4. F&I checklist
5. Deal health

#### Final Review / Signing
1. Deal health (go/no-go signal)
2. Red flags (anything that changed)
3. Key numbers (final summary)
4. Final verification checklist

#### Deal Completed
1. Savings summary
2. Final deal recap
3. Post-purchase checklist

---

## Implementation Plan

This plan implements Phase 1 and Phase 2 in dependency order. Each step is a buildable unit — later steps depend on earlier ones, but each step results in a working system. All data model fields for both phases are created in Step 1 (single migration).

### Step 1: Backend — Data Model & Migration

Add new fields to the `DealState` ORM model and generate the Alembic migration. This includes all fields needed for both phases — adding them upfront avoids a second migration later.

**File: `apps/backend/app/models/enums.py`** — Add new enums:
```python
class HealthStatus(StrEnum):
    GOOD = "good"
    FAIR = "fair"
    CONCERNING = "concerning"
    BAD = "bad"

class RedFlagSeverity(StrEnum):
    WARNING = "warning"
    CRITICAL = "critical"

class GapPriority(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
```

**File: `apps/backend/app/models/deal_state.py`** — Add new columns:
```python
# Deal health (Tier 2 — AI-assessed)
health_status: Mapped[str | None] = mapped_column(String, nullable=True)
health_summary: Mapped[str | None] = mapped_column(String, nullable=True)

# Red flags (Tier 2 — AI-assessed)
# JSON: [{"id": str, "severity": "warning"|"critical", "message": str}]
red_flags: Mapped[list] = mapped_column(JSON, default=list)

# Information gaps (Tier 2 — AI-assessed)
# JSON: [{"label": str, "prompt": str, "priority": "high"|"medium"|"low"}]
information_gaps: Mapped[list] = mapped_column(JSON, default=list)

# Offer history — snapshots for savings and F&I tracking
# first_offer: captured when current_offer is first set (never overwritten)
first_offer: Mapped[float | None] = mapped_column(Float, nullable=True)
# pre_fi_price: snapshot of current_offer when phase transitions to financing
pre_fi_price: Mapped[float | None] = mapped_column(Float, nullable=True)

# Savings estimate (Tier 2 override — AI can set explicitly; Tier 1 computes
# from first_offer - current_offer as a fallback)
savings_estimate: Mapped[float | None] = mapped_column(Float, nullable=True)
```

**File: `apps/backend/app/routes/chat.py`** — Update `_apply_tool_call` for snapshot logic:
- When `update_deal_numbers` sets `current_offer` and `first_offer` is null, snapshot `current_offer` into `first_offer`.
- When `update_deal_phase` transitions to `financing` and `pre_fi_price` is null, snapshot `current_offer` into `pre_fi_price`.

**Run:** `make migrations-backend` then `make migrate-backend`

---

### Step 2: Backend — New Claude Tools

Add three new tool definitions to `DEAL_TOOLS` and wire them into `_apply_tool_call`.

**File: `apps/backend/app/services/claude.py`** — Add to `DEAL_TOOLS` array:

```python
{
    "name": "update_deal_health",
    "description": (
        "Update the overall deal health assessment. Call after any significant "
        "change to deal numbers, offers, or terms. Status must be grounded in "
        "the user's own data — never reference market prices you cannot verify."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "status": {
                "type": "string",
                "enum": ["good", "fair", "concerning", "bad"],
                "description": "Overall deal health signal",
            },
            "summary": {
                "type": "string",
                "description": (
                    "1-2 sentence explanation grounded in the user's data. "
                    "Example: 'Strong deal — offer is $1,200 below listing price' "
                    "or 'Concerning — APR of 7.9% on a 72-month term adds $4,200 in interest'"
                ),
            },
        },
        "required": ["status", "summary"],
    },
},
{
    "name": "update_red_flags",
    "description": (
        "Surface concerns about the deal. Each flag must reference specific data "
        "from the conversation — never flag something based on general market knowledge "
        "you cannot verify. Replaces the full list each time (pass empty array to clear). "
        "Common flags: monthly payment quoted without term length, fees that appeared "
        "unexpectedly, correlated trade-in/price changes, pressure tactics, numbers that "
        "changed from what was verbally agreed."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "flags": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {
                            "type": "string",
                            "description": "Stable identifier (e.g. 'apr_high', 'hidden_doc_fee')",
                        },
                        "severity": {
                            "type": "string",
                            "enum": ["warning", "critical"],
                            "description": "warning = be aware; critical = stop and address this now",
                        },
                        "message": {
                            "type": "string",
                            "description": "User-facing explanation, 1-2 sentences",
                        },
                    },
                    "required": ["id", "severity", "message"],
                },
                "description": "Full list of current flags (empty array to clear all)",
            },
        },
        "required": ["flags"],
    },
},
{
    "name": "update_information_gaps",
    "description": (
        "Identify missing information that would improve deal assessment quality. "
        "Always give your best advice with available data FIRST — then surface gaps "
        "as ways to sharpen the assessment. Never gate-keep help behind 'I need more "
        "information.' Replaces the full list each time. During research phase, always "
        "include pre-approval status as a high-priority gap with explanation of why it "
        "matters: 'Getting pre-approved forces the dealer to compete on price alone.'"
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "gaps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {
                            "type": "string",
                            "description": "What's missing (e.g. 'Credit score range')",
                        },
                        "prompt": {
                            "type": "string",
                            "description": "Suggested question to ask or message to send",
                        },
                        "priority": {
                            "type": "string",
                            "enum": ["high", "medium", "low"],
                        },
                    },
                    "required": ["label", "prompt", "priority"],
                },
            },
        },
        "required": ["gaps"],
    },
},
```

**File: `apps/backend/app/routes/chat.py`** — Add to `_apply_tool_call`:
```python
elif tool_name == "update_deal_health":
    if "status" in tool_data:
        try:
            deal_state.health_status = HealthStatus(tool_data["status"])
        except ValueError:
            logger.warning("Invalid health_status: %s", tool_data["status"])
            return
    if "summary" in tool_data:
        deal_state.health_summary = tool_data["summary"]

elif tool_name == "update_red_flags":
    if "flags" in tool_data:
        deal_state.red_flags = tool_data["flags"]

elif tool_name == "update_information_gaps":
    if "gaps" in tool_data:
        deal_state.information_gaps = tool_data["gaps"]
```

**File: `apps/backend/app/routes/chat.py`** — Update `_deal_state_to_dict` to include new fields:
```python
"health": {
    "status": ds.health_status,
    "summary": ds.health_summary,
},
"red_flags": ds.red_flags or [],
"information_gaps": ds.information_gaps or [],
```

**File: `apps/backend/app/schemas/deal.py`** — Update response schema to include new fields in the deal state response.

---

### Step 3: Backend — System Prompt Restructuring

Rewrite `SYSTEM_PROMPT` in `claude.py`. This is the highest-leverage single change — it controls all AI behavior.

**Prompt length discipline:** The expanded prompt (grounding rules, tool priority, dealer tactics, F&I instructions, context preambles) could exceed 2000 tokens. Long system prompts dilute instruction-following quality — the model pays most attention to the beginning and end (primacy/recency effects). Structure the prompt so:
- **Top:** Role identity + grounding rules (most critical — never violated)
- **Middle:** Tool descriptions + dealer tactics (reference material)
- **Bottom:** Tool priority hierarchy + response format rules (most recent in attention)

Keep each section concise. Use bullet points over paragraphs. The tool descriptions themselves (in `DEAL_TOOLS`) already carry detailed instructions — the system prompt should focus on behavioral rules that span across tools, not repeat per-tool detail.

**Key structural changes:**

1. **Tool priority hierarchy** — Add explicit section at the top:
```
TOOL PRIORITY (call in this order of importance):
1. update_red_flags — surface concerns IMMEDIATELY, never delay
2. update_deal_health — update after ANY significant number/term change
3. update_information_gaps — identify what's missing to improve advice
4. update_deal_numbers — capture every financial figure mentioned
5. update_deal_phase / update_buyer_context — when situation changes
6. update_quick_actions — when context shifts (not every response)
7. update_checklist — preparation/verification items
```

2. **Grounding rules** — Add explicit section:
```
GROUNDING RULES (critical — violating these erodes user trust):
- NEVER state a specific market price as fact. You do not have access to
  current market data. Frame all pricing relative to the user's own data:
  "Their offer is $3,000 above listing" NOT "The market price is $23,000."
- Red flags must reference specific data from the conversation.
  Good: "The APR of 7.9% on a 72-month term means $4,200 in interest."
  Bad: "This price is above average for your area."
- Always give your best assessment with available data FIRST, then surface
  information gaps as ways to improve the assessment. Never say "I need
  more information before I can help."
```

3. **Dealer tactic recognition** — Add to behavioral instructions:
```
DEALER TACTICS TO RECOGNIZE:
- "Let me talk to my manager" — a standard negotiation step. Surface as a
  warning-level red flag and coach the buyer to prepare their next counter.
- Monthly payment focus — if the dealer leads with monthly instead of total
  price, flag it. They may be stretching the term to hide the real cost.
- Trade-in inflation — if trade-in value and vehicle price both increase,
  flag the net change. "They offered $2,000 more for your trade-in but
  raised the price by $1,500 — net improvement is only $500."
- Time pressure — if the buyer has been there 2+ hours or mentions feeling
  rushed, flag it as a tactic.
- F&I upsells — VIN etching, fabric protection, inflated warranty prices
  are high-margin items. Flag them when mentioned.
```

4. **Deal state context restructuring** — Prioritize the `{deal_state_context}` template to lead with health, flags, and gaps rather than raw numbers:
```
Current deal health: {status} — {summary}
Active red flags: {count} ({critical_count} critical)
Information gaps: {count} remaining

[Then the full deal state JSON as before]
```

---

### Step 4: Backend — Assessment Safety Net

After the primary Claude response, if deal numbers changed but the AI didn't call `update_deal_health` or `update_red_flags`, fire a lightweight Haiku assessment pass. This mirrors the existing quick actions safety net pattern.

**File: `apps/backend/app/services/claude.py`** — Add new function:
```python
async def assess_deal_state(deal_state_dict: dict) -> dict:
    """Lightweight assessment of deal health and red flags via Haiku.

    Called when the primary model updated numbers but didn't call
    update_deal_health or update_red_flags. Returns a dict with
    optional 'health' and 'flags' keys.
    """
```

This function:
- Takes the current deal state dict
- Sends it to Haiku with a focused prompt asking for health status + red flags only
- Returns structured JSON that the chat route emits as `tool_result` SSE events

**File: `apps/backend/app/routes/chat.py`** — Add assessment trigger. Run **concurrently** with the existing quick actions generation and session metadata update to avoid adding latency:
```python
# After primary stream + followup:
numbers_changed = any(tc["name"] == "update_deal_numbers" for tc in all_tool_calls)
health_updated = any(tc["name"] == "update_deal_health" for tc in all_tool_calls)
flags_updated = any(tc["name"] == "update_red_flags" for tc in all_tool_calls)
needs_assessment = numbers_changed and (not health_updated or not flags_updated)

# Fire assessment, quick actions, and metadata update concurrently
tasks = []
if needs_assessment:
    tasks.append(assess_deal_state(deal_state_dict))
if not called_quick_actions:
    tasks.append(generate_quick_actions(messages, full_text))
# Gather results, yield SSE events, then persist
```

This ensures the assessment pass doesn't add serial latency — it runs in parallel with work that was already happening.

---

### Step 5: Frontend — Types & Constants

Update frontend types to match the new backend fields.

**File: `apps/mobile/lib/types.ts`** — Add new types and update DealState:
```typescript
// ─── Deal Health ───
export type HealthStatus = 'good' | 'fair' | 'concerning' | 'bad'

export interface DealHealth {
  status: HealthStatus
  summary: string
}

// ─── Red Flags ───
export type RedFlagSeverity = 'warning' | 'critical'

export interface RedFlag {
  id: string
  severity: RedFlagSeverity
  message: string
}

// ─── Information Gaps ───
export type GapPriority = 'high' | 'medium' | 'low'

export interface InformationGap {
  label: string
  prompt: string
  priority: GapPriority
}

// Update DealState — include all fields for both phases upfront:
export interface DealState {
  sessionId: string
  phase: DealPhase
  buyerContext: BuyerContext
  numbers: DealNumbers
  vehicle: Vehicle | null
  scorecard: Scorecard
  checklist: ChecklistItem[]
  timerStartedAt: string | null
  // Tier 2 — AI-assessed:
  health: DealHealth | null
  redFlags: RedFlag[]
  informationGaps: InformationGap[]
  // Offer history — for savings and F&I tracking:
  firstOffer: number | null
  preFiPrice: number | null
  savingsEstimate: number | null
}
```

**File: `apps/mobile/lib/types.ts`** — Update ToolCall name union:
```typescript
export interface ToolCall {
  name:
    | 'update_deal_numbers'
    | 'update_deal_phase'
    | 'update_scorecard'
    | 'set_vehicle'
    | 'update_checklist'
    | 'update_buyer_context'
    | 'update_quick_actions'
    | 'update_deal_health'
    | 'update_red_flags'
    | 'update_information_gaps'
  args: Record<string, any>
}
```

**File: `apps/mobile/lib/constants.ts`** — Add Tier 1 thresholds:
```typescript
/** APR thresholds for frontend-derived assessment */
export const APR_GOOD_THRESHOLD = 6.5
export const APR_CONCERNING_THRESHOLD = 9.0
```

Note: `APR_GOOD_THRESHOLD` and `APR_BAD_THRESHOLD` already exist in the codebase (used by NumbersSummary). Consolidate to the constants file if they're currently hardcoded in the component.

---

### Step 6: Frontend — Store & Tier 1 Computations

Update `dealStore` to handle new tool calls, and add Tier 1 computed selectors.

**File: `apps/mobile/stores/dealStore.ts`**

Update `resetDealState` to include all new fields:
```typescript
health: null,
redFlags: [],
informationGaps: [],
firstOffer: null,
preFiPrice: null,
savingsEstimate: null,
```

Add `dismissedFlagIds` to the store (not part of DealState — this is ephemeral UI state):
```typescript
dismissedFlagIds: Set<string>

dismissRedFlag: (id: string) => void
// Clears dismissed set when session changes (in setActiveSession/resetDealState)
```

When `update_red_flags` replaces the full list, the panel filters out flags whose `id` is in `dismissedFlagIds`. This prevents dismissed flags from reappearing when the AI re-sends the list. The set clears on session change.

Add new cases to `applyToolCall`:
```typescript
case 'update_deal_health': {
  set({
    dealState: {
      ...dealState,
      health: {
        status: toolCall.args.status,
        summary: toolCall.args.summary,
      },
    },
  })
  break
}
case 'update_red_flags': {
  set({
    dealState: { ...dealState, redFlags: toolCall.args.flags ?? [] },
  })
  break
}
case 'update_information_gaps': {
  set({
    dealState: { ...dealState, informationGaps: toolCall.args.gaps ?? [] },
  })
  break
}
```

**File: `apps/mobile/lib/dealComputations.ts`** — New file for Tier 1 logic:

```typescript
import type { DealNumbers, HealthStatus } from './types'
import { APR_GOOD_THRESHOLD, APR_CONCERNING_THRESHOLD } from './constants'

/** Tier 1: Derive basic deal health from numbers alone. */
export function computeBasicHealth(numbers: DealNumbers): HealthStatus | null {
  const { currentOffer, yourTarget, walkAwayPrice } = numbers
  if (currentOffer === null || yourTarget === null) return null
  if (currentOffer <= yourTarget) return 'good'
  if (walkAwayPrice !== null && currentOffer >= walkAwayPrice) return 'bad'
  return 'fair'
}

/** Tier 1: Total cost over loan lifetime. */
export function computeTotalLoanCost(numbers: DealNumbers): number | null {
  const { monthlyPayment, loanTermMonths } = numbers
  if (monthlyPayment === null || loanTermMonths === null) return null
  return monthlyPayment * loanTermMonths
}

/** Tier 1: Total interest paid over loan lifetime. */
export function computeTotalInterest(numbers: DealNumbers): number | null {
  const totalCost = computeTotalLoanCost(numbers)
  const { currentOffer, downPayment } = numbers
  if (totalCost === null || currentOffer === null) return null
  const principal = currentOffer - (downPayment ?? 0)
  if (principal <= 0) return null
  return totalCost - principal
}

/** Tier 1: APR assessment based on thresholds. */
export function assessApr(apr: number | null): 'good' | 'neutral' | 'concerning' | null {
  if (apr === null) return null
  if (apr <= APR_GOOD_THRESHOLD) return 'good'
  if (apr >= APR_CONCERNING_THRESHOLD) return 'concerning'
  return 'neutral'
}

/** Tier 1: Trade-in net change detection.
 *  Call with previous and current numbers to detect correlated changes. */
export function computeTradeInNetChange(
  prev: DealNumbers,
  curr: DealNumbers
): { tradeInDelta: number; priceDelta: number; netChange: number } | null {
  if (
    prev.tradeInValue === null || curr.tradeInValue === null ||
    prev.currentOffer === null || curr.currentOffer === null
  ) return null
  const tradeInDelta = curr.tradeInValue - prev.tradeInValue
  const priceDelta = curr.currentOffer - prev.currentOffer
  if (tradeInDelta === 0 && priceDelta === 0) return null
  return { tradeInDelta, priceDelta, netChange: tradeInDelta - priceDelta }
}

/** Tier 1: Identify which critical fields are missing. */
export function computeBaselineGaps(
  numbers: DealNumbers,
  hasVehicle: boolean,
  phase: string,
): string[] {
  const gaps: string[] = []
  if (!hasVehicle) gaps.push('Vehicle details')
  // Research phase: pre-approval is the highest-priority gap
  if (phase === 'research' || phase === 'initial_contact') {
    // Pre-approval is always surfaced — the AI adds the explanation via Tier 2
    gaps.push('Pre-approval status')
  }
  if (numbers.currentOffer !== null && numbers.yourTarget === null) {
    gaps.push('Your target price')
  }
  if (numbers.currentOffer !== null && numbers.walkAwayPrice === null) {
    gaps.push('Walk-away price')
  }
  return gaps
}

/** Tier 1: Compute savings from first offer vs. current offer.
 *  The AI can override with a more nuanced savings_estimate via Tier 2. */
export function computeSavings(
  firstOffer: number | null,
  currentOffer: number | null
): number | null {
  if (firstOffer === null || currentOffer === null) return null
  const savings = firstOffer - currentOffer
  return savings > 0 ? savings : null
}

/** Tier 1: Compute F&I markup — how much add-ons have increased the deal. */
export function computeFandIMarkup(
  preFiPrice: number | null,
  currentOffer: number | null
): number | null {
  if (preFiPrice === null || currentOffer === null) return null
  const markup = currentOffer - preFiPrice
  return markup > 0 ? markup : null
}
```

---

### Step 7: Frontend — API Client Mapping

Update `apiClient.ts` to map the new backend fields when loading deal state.

**File: `apps/mobile/lib/apiClient.ts`** — Update `getDealState` to include:
```typescript
health: ds.health_status
  ? { status: ds.health_status, summary: ds.health_summary ?? '' }
  : null,
redFlags: (ds.red_flags ?? []).map((f: any) => ({
  id: f.id,
  severity: f.severity,
  message: f.message,
})),
informationGaps: (ds.information_gaps ?? []).map((g: any) => ({
  label: g.label,
  prompt: g.prompt,
  priority: g.priority,
})),
firstOffer: ds.first_offer ?? null,
preFiPrice: ds.pre_fi_price ?? null,
savingsEstimate: ds.savings_estimate ?? null,
```

---

### Step 8: Frontend — New Insight Widgets

Build the new panel components. All follow the project's UI standards: Tamagui theme tokens (no hardcoded hex), touch targets ≥44px, micro-interactions on all interactive elements, mobile-first at 375px.

**File: `apps/mobile/components/insights/DealHealthCard.tsx`**

Displays the deal health signal. Uses the two-tier approach:
- If `dealState.health` exists (Tier 2), show the AI's status + summary.
- Otherwise, compute basic health via `computeBasicHealth()` (Tier 1) and show a generic summary (e.g., "Offer is below your target" / "Offer is above your walk-away price").
- Color: maps status to semantic sub-themes (`success` for good, `warning` for fair/concerning, `danger` for bad) via `<Theme name="...">` wrappers.
- Layout: status badge (colored pill with label) + summary text. Compact — one card, ~60px tall.
- **Micro-interaction:** When status changes, animate the color transition (fade between themes, 300ms). Use `useFadeIn` on mount.

**File: `apps/mobile/components/insights/RedFlagsCard.tsx`**

Displays AI-detected concerns:
- Accepts `flags: RedFlag[]` and `dismissedIds: Set<string>` — filters out dismissed flags before rendering.
- Each flag is a row: severity icon (Lucide `AlertTriangle` for warning, `AlertCircle` for critical) + message text + dismiss button (X, ≥44px touch target).
- Critical flags: `<Theme name="danger">` wrapper, prominent styling.
- Warning flags: `<Theme name="warning">` wrapper, softer styling.
- Sorted: critical flags first, then warnings.
- **Micro-interaction:** New flags slide in (`useSlideIn`). Dismiss animates out (fade + slide). Critical flags use a subtle pulse on first appearance to draw attention.
- Empty state: component returns `null` (never renders if no visible flags after filtering).

**File: `apps/mobile/components/insights/InformationGapsCard.tsx`**

Displays missing information with tappable prompts:
- Each gap is a tappable row (min height 44px): label + priority indicator + chevron.
- On tap: calls `onSendPrompt(gap.prompt)` which sends the prompt to chat. **Micro-interaction:** scale down (0.97) on press, spring back on release.
- Sorted by priority: high → medium → low.
- High-priority gaps get a `$brand` left border accent.
- **Interaction with quick actions:** When information gaps contain high-priority items, the panel suppresses quick actions to avoid competing "what to do next" sections (reduces cognitive load per UI principle #4).
- Empty state: component returns `null`.

**File: `apps/mobile/components/insights/KeyNumbers.tsx`**

Replaces `NumbersSummary`. Shows ONLY populated, relevant fields:
- Filters out null values — no more "—" cells.
- Shows total cost over loan term (computed via `computeTotalLoanCost`) when monthly + term are known.
- Shows total interest paid (computed via `computeTotalInterest`) as a secondary line — "You'll pay $X in interest."
- During F&I phase: shows F&I markup (computed via `computeFandIMarkup`) — "Add-ons have increased the deal by $X."
- Groups logically: pricing (listing, offer, target, walk-away), financing (APR, monthly, term, total cost), trade-in (value, net change).
- Only renders groups that have at least one populated field.
- **Micro-interaction:** Flash animation (existing pattern from `NumbersSummary`) when values change.
- Empty state: component returns `null`.

---

### Step 9: Frontend — Panel Composition Rewrite

Replace the current context-based widget ordering with data-driven composition.

**File: `apps/mobile/components/insights/InsightsPanel.tsx`** — Full rewrite.

The panel composition is driven by a pure function that examines the deal state and returns which widgets to render:

```typescript
// Include all widget types for both phases upfront — components that
// don't exist yet simply won't be rendered until their step lands.
type PanelWidget =
  | 'timer'
  | 'number_confirmation'  // Phase 2 — transient, renders above everything
  | 'savings_summary'      // Phase 2 — post-deal
  | 'deal_health'
  | 'red_flags'
  | 'key_numbers'
  | 'information_gaps'
  | 'vehicle'
  | 'scorecard'
  | 'checklist'

function getPanelWidgets(
  dealState: DealState,
  dismissedFlagIds: Set<string>,
  hasPendingConfirmation: boolean,
): PanelWidget[] {
  const hasVehicle = dealState.vehicle !== null
  const hasOffer = dealState.numbers.currentOffer !== null
  const hasAnyNumbers = Object.values(dealState.numbers).some((v) => v !== null)
  const hasScorecard = Object.values(dealState.scorecard).some((v) => v !== null)
  const visibleFlags = dealState.redFlags.filter((f) => !dismissedFlagIds.has(f.id))
  const hasGaps = dealState.informationGaps.length > 0
  const isTimerActive = dealState.timerStartedAt !== null
  const hasSavings = dealState.savingsEstimate !== null ||
    (dealState.firstOffer !== null && dealState.numbers.currentOffer !== null &&
     dealState.firstOffer > dealState.numbers.currentOffer)
  const isDealComplete = dealState.phase === 'closing'

  const widgets: PanelWidget[] = []

  // Number confirmation: transient, always first when pending (Phase 2)
  if (hasPendingConfirmation) widgets.push('number_confirmation')

  // Timer always first (after confirmation) if active
  if (isTimerActive) widgets.push('timer')

  // Savings summary: show when deal is complete and savings exist (Phase 2)
  if (isDealComplete && hasSavings) widgets.push('savings_summary')

  // Deal health: show when we have an offer (Tier 1 can compute even without AI)
  if (hasOffer) widgets.push('deal_health')

  // Red flags: show whenever visible flags exist (after filtering dismissed)
  if (visibleFlags.length > 0) widgets.push('red_flags')

  // Key numbers: show when any number exists
  if (hasAnyNumbers) widgets.push('key_numbers')

  // Information gaps: show when AI has identified gaps
  if (hasGaps) widgets.push('information_gaps')

  // Vehicle card: show when vehicle is identified
  if (hasVehicle) widgets.push('vehicle')

  // Scorecard: show when AI has assessed (deprioritized below deal health)
  if (hasScorecard) widgets.push('scorecard')

  // Checklist: show when items exist
  if (dealState.checklist.length > 0) widgets.push('checklist')

  return widgets
}
```

This approach:
- Is data-driven: shows widgets when there's data, hides when there isn't. No empty states.
- Naturally handles phase transitions: a research session starts with nothing, then vehicle appears, then numbers, then health/flags as the deal progresses.
- Priority order is fixed: health → flags → numbers → gaps → vehicle → scorecard → checklist. Timer always first.
- No hardcoded phase-to-widget mappings that break on edge cases.

The `InsightsPanel` component maps each `PanelWidget` to its React component, passing the relevant props. The `DealPhaseIndicator` renders above the widget list (always present when deal state exists).

---

### Step 10: Frontend — Wire Up Information Gap Taps

When a user taps an information gap, it sends the gap's prompt to the chat input.

**File: `apps/mobile/components/insights/InformationGapsCard.tsx`** — Accept `onSendPrompt: (prompt: string) => void` prop.

**File: `apps/mobile/components/insights/InsightsPanel.tsx`** — Accept `onSendPrompt` prop and pass it to `InformationGapsCard`.

**File: `apps/mobile/app/(app)/chat.tsx`** — Pass `handleQuickAction` (which already sends a prompt to chat) as the `onSendPrompt` prop to `InsightsPanel`.

**Quick actions suppression:** When information gaps contain any high-priority items, suppress quick actions in the chat footer. Information gaps are higher value (they improve assessment quality); showing both creates competing "what to do next" sections — cognitive load per UI principle #4. The logic in `chat.tsx`'s `showQuickActions` computation should add: `&& !hasHighPriorityGaps`.

---

### Step 11: Frontend — Copyable Blockquotes in Chat

When the AI generates a "say this word-for-word" script, it should render with distinct visual treatment and a copy button. The buyer at a dealership needs to glance at their phone and read exact words.

**Approach:** Rather than using a fragile marker format that depends on the AI formatting it exactly right, render ALL blockquotes in assistant messages with copy-to-clipboard functionality. In a car-buying context, blockquotes are almost always negotiation scripts or dealer quotes — the copy button adds value universally. No special AI formatting required, no parsing fragility.

**File: `apps/mobile/components/chat/markdownStyles.ts`** — The blockquote style already exists. No change needed to styling — just to rendering behavior.

**File: `apps/mobile/components/chat/ChatBubble.tsx`** — Use the `rules` prop on `react-native-markdown-display` to override the `blockquote` renderer with a custom component that wraps the blockquote content in a `CopyableBlock`:

**File: `apps/mobile/components/chat/CopyableBlock.tsx`** — New component:
- Wraps children in the existing blockquote styling (brand left border, subtle background).
- Adds a copy button (top-right corner): taps to `Clipboard.setStringAsync(text)`.
- Brief "Copied" feedback (text change or checkmark, 1.5s, then reverts).
- Copy button touch target ≥44px.
- **Micro-interaction:** Copy button shows a brief scale pulse (1.0 → 1.1 → 1.0) on tap.

**Also update `StreamingBubble.tsx`** — same blockquote rule override so scripts are copyable during streaming too.

---

### Step 12: Frontend — Number Confirmation Flow

When the AI extracts critical numbers, display a transient confirmation widget so the user can verify BEFORE the numbers are applied to deal state. This prevents Tier 1 computations, deal health, and red flags from firing on potentially wrong data.

**Approach:** When `update_deal_numbers` includes high-stakes fields (`currentOffer`, `apr`, `loanTermMonths`, `monthlyPayment`), store them in a `pendingNumbers` state instead of applying them to `dealState`. The panel shows a confirmation widget. On confirm, merge into deal state. On dismiss, discard.

**File: `apps/mobile/stores/dealStore.ts`** — Add:
```typescript
pendingNumbers: Partial<DealNumbers> | null

confirmPendingNumbers: () => void   // merge into dealState.numbers, clear pending
dismissPendingNumbers: () => void   // discard, clear pending
```

Update `applyToolCall('update_deal_numbers')`:
- Check if the incoming args include any high-stakes field.
- If yes: store ALL incoming number updates in `pendingNumbers` (not just the high-stakes ones — they're a single atomic update). Non-high-stakes-only updates still apply immediately.
- If no high-stakes fields: apply directly as before.

`confirmPendingNumbers()` merges `pendingNumbers` into `dealState.numbers` and clears the pending state. This triggers Tier 1 recomputation naturally.

`dismissPendingNumbers()` clears `pendingNumbers` without applying. The numbers are discarded — the user can correct them via chat.

**File: `apps/mobile/components/insights/NumberConfirmation.tsx`** — New transient widget:
- Shows the pending values: "I captured: $27,500 offer, 5.9% APR, 72 months"
- Two buttons (≥44px touch targets): "Correct" (confirm) / "Edit" (dismiss + prompt user to resend)
- **Micro-interaction:** Slides in from top on appear, fades out on dismiss.
- Renders at the top of the panel (via `getPanelWidgets` returning `'number_confirmation'` first).

**File: `apps/mobile/components/insights/InsightsPanel.tsx`** — Maps `'number_confirmation'` to `NumberConfirmation` component, passing `pendingNumbers`, `confirmPendingNumbers`, and `dismissPendingNumbers` from the store.

---

### Step 13: Frontend — Savings Summary Widget

When a deal concludes, show the estimated savings — the referral-driving moment.

**Trigger:** The deal phase transitions to `closing` and savings can be computed.

**Two-tier savings:**
- Tier 1: `computeSavings(dealState.firstOffer, dealState.numbers.currentOffer)` — always available when both values exist (since `firstOffer` is snapshotted in Step 1).
- Tier 2: `dealState.savingsEstimate` — AI can override with a more nuanced figure that accounts for financing savings, avoided fees, etc.
- Display: use Tier 2 if set, otherwise Tier 1.

**File: `apps/mobile/components/insights/SavingsSummary.tsx`** — New component:
- Prominent card: `<Theme name="success">` wrapper, large savings number, clean but not gaudy.
- Layout: "Estimated Savings" label + large formatted dollar amount + one-line context ("vs. dealer's first offer").
- Designed to be screenshot-worthy — clean, branded, shareable.
- **Micro-interaction:** Fade-in + subtle scale-up (1.0 → 1.02 → 1.0) on first render — the celebratory moment.
- Only renders when savings > 0 (via `getPanelWidgets` check).

**File: `apps/mobile/lib/dealComputations.ts`** — Add Tier 1 savings fallback:
```typescript
/** Tier 1: Estimate savings from first offer vs. final offer.
 *  The AI can override with a more nuanced estimate via Tier 2. */
export function computeSavingsEstimate(
  firstOffer: number | null,
  finalOffer: number | null
): number | null {
  if (firstOffer === null || finalOffer === null) return null
  const savings = firstOffer - finalOffer
  return savings > 0 ? savings : null
}
```

**Panel composition:** `SavingsSummary` renders after timer (if active) and before deal health when phase is `closing` and savings exist. Handled by `getPanelWidgets`.

---

### Step 14: Frontend — Post-Purchase Checklist

After signing, auto-populate a checklist with standard post-purchase items.

**Approach:** When the deal phase transitions to `closing`, the AI calls `update_checklist` with post-purchase items. As a fallback, the frontend can populate a default set if the AI doesn't.

**File: `apps/mobile/lib/constants.ts`** — Add default post-purchase items:
```typescript
export const POST_PURCHASE_CHECKLIST: ChecklistItem[] = [
  { label: 'Title arrives within 30 days', done: false },
  { label: 'Review first loan statement — verify terms match', done: false },
  { label: 'Confirm trade-in payoff was processed', done: false },
  { label: 'Save all signed documents', done: false },
  { label: 'Check for any post-sale charges', done: false },
]
```

The system prompt (Step 3) instructs the AI to call `update_checklist` with post-purchase items when the phase transitions to `closing`. The frontend falls back to `POST_PURCHASE_CHECKLIST` if the AI's checklist is empty at that phase.

---

### Step 15: Backend + Frontend — F&I Panel Transformation

The F&I (Finance & Insurance) office is a different kind of decision-making. The panel should adapt.

**System prompt (Step 3):** Add F&I-specific instructions:
```
When the buyer enters the F&I office (phase: financing):
- Surface red flags for common F&I profit centers: extended warranties at
  inflated prices, GAP insurance (often cheaper from your insurance company),
  VIN etching, fabric/paint protection, tire-and-wheel packages.
- Remind the buyer: "Everything in F&I is negotiable. You can say no to all of it."
- Track how add-ons are changing the total: the agreed price vs. the new total.
- Call update_red_flags aggressively in this phase — most F&I products have
  extreme markups.
```

**File: `apps/mobile/lib/dealComputations.ts`** — Add:
```typescript
/** Tier 1: Compute how much F&I add-ons have increased the deal.
 *  Requires tracking the price at negotiation end vs. current. */
export function computeFandIMarkup(
  agreedPrice: number | null,
  currentTotal: number | null
): number | null {
  if (agreedPrice === null || currentTotal === null) return null
  const markup = currentTotal - agreedPrice
  return markup > 0 ? markup : null
}
```

Note: this requires knowing the "agreed price" before F&I. The simplest approach: when phase transitions to `financing`, snapshot `currentOffer` as the pre-F&I baseline. This could be a new field (`pre_fi_price`) or derived from deal history.

**Panel composition:** During the `financing` phase, the panel leads with red flags (F&I warnings are the highest value here) and shows the F&I markup prominently in KeyNumbers ("Agreed: $27,000 → Current total: $29,200 — $2,200 in add-ons").

---

### Implementation Sequence

Execute in this order — each step builds on the previous:

| Order | Step | Layer | What it does |
|-------|------|-------|--------------|
| | **Phase 1** | | |
| 1 | Data model + migration | Backend | Schema foundation |
| 2 | New Claude tools | Backend | AI can emit health/flags/gaps |
| 3 | System prompt rewrite | Backend | AI behavior + grounding rules + F&I + dealer tactics |
| 4 | Assessment safety net | Backend | Haiku catches missed tool calls |
| 5 | Frontend types + constants | Frontend | Type foundation |
| 6 | Store + Tier 1 computations | Frontend | State management + derived signals |
| 7 | API client mapping | Frontend | Backend ↔ frontend data flow |
| 8 | New insight widgets | Frontend | DealHealthCard, RedFlagsCard, InfoGapsCard, KeyNumbers |
| 9 | Panel composition rewrite | Frontend | Data-driven widget selection |
| 10 | Gap tap → chat integration | Frontend | Information gaps are actionable |
| | **Phase 2** | | |
| 11 | Copyable scripts | Frontend | ScriptBlock component + markdown integration |
| 12 | Number confirmation | Frontend | Transient confirmation widget for extracted numbers |
| 13 | Savings summary | Frontend | Post-deal savings display |
| 14 | Post-purchase checklist | Frontend | Auto-populated checklist after signing |
| 15 | F&I transformation | Both | F&I-specific prompt rules + markup tracking + panel adaptation |

**Dependencies:**
- Steps 1-4 (backend) deploy independently. Frontend continues working with existing widgets.
- Steps 5-7 (frontend plumbing) are prerequisite to all UI steps.
- Steps 8-10 land together (Phase 1 visible change).
- Steps 11-15 (Phase 2) each stand alone — can ship incrementally after Phase 1.
- Step 15 touches both backend (system prompt additions) and frontend (markup computation + panel logic).

---

## Implementation Priority

### Phase 1: High Impact — Required for Differentiation
1. **Two-tier intelligence architecture** — implement frontend-derived signals (basic deal health, total cost, trade-in net change, APR assessment, number completeness) so the panel is never stale. Backend safety net via Haiku assessment pass when the primary model misses tool calls.
2. **AI grounding guardrails** — update system prompt to prevent market price hallucination, encode tool priority hierarchy, instruct "lead with value then ask for more" behavior, and train dealer tactic recognition (manager step, trade-in inflation, time pressure). This is a current trust issue.
3. **Context-aware number display** — stop showing empty fields; show only populated, phase-relevant numbers. Include auto-calculated total cost over loan term and trade-in net change.
4. **Deal Health summary widget** — the single most important at-a-glance signal. Tier 1 provides basic green/yellow/red from numbers; Tier 2 adds the AI's explanatory sentence.
5. **Red Flags widget + backend tool** — highest-value proactive insight. Includes dealer tactic detection and trade-in/price correlation flagging.
6. **Information Gaps widget + backend tool** — strongest "intelligent advisor" differentiator. Pre-approval surfaced as high-priority gap during research with explanation of *why* it matters.
7. **Phase-specific panel composition** — different widgets for different phases (not just reordering)

### Phase 2: Medium Impact — Strong UX Improvement
8. **Copyable negotiation scripts** — distinct visual treatment in chat with copy-to-clipboard for "say this" scripts
9. **Number confirmation flow** — prevent silent errors in deal assessment
10. **Savings summary widget** — the referral-driving moment when a deal concludes
11. **Post-purchase checklist** — keeps the app useful after signing, reinforces trust
12. **F&I-specific panel transformation** — dedicated experience for the finance office

See `docs/future-enhancements.md` for Phase 3 items.

---

## Amendments

### Amendment 1: Information Gaps — Informational, Not Actionable (2026-03-26)

**What changed:** The `InformationGapsCard` no longer sends a chat prompt when tapped. Instead, each gap shows a `reason` field explaining WHY the information would improve the assessment. Tapping a gap expands to reveal the reason. The `prompt` field was replaced with `reason` in the tool definition, types, and API mapping.

**Why:** The original "tap to send a prompt" design had three problems identified by business analysis:

1. **Conflated two intents** — "tell me why this matters" vs. "I want to provide this info" are different actions. The buyer might want to understand why before deciding to share.
2. **Hidden action with consequences** — tapping unexpectedly sent a message, triggering an AI response and costing time/tokens for information that should be static.
3. **Broke reading flow** — the user was scanning the insights panel; tapping yanked them to the chat for information that could have been shown inline.

**The new approach:** Gaps are informational — they educate the buyer about what data would help and why. The buyer provides the information naturally in chat on their own terms, not via a hidden trigger.

**Downstream effects:**
- `onSendPrompt` prop removed from `InsightsPanel` and `InformationGapsCard`
- Quick actions are no longer suppressed when high-priority gaps exist (gaps and quick actions no longer compete since gaps are passive)
- Backend `update_information_gaps` tool schema changed: `prompt` → `reason`
- Frontend `InformationGap` type changed: `prompt` → `reason`
