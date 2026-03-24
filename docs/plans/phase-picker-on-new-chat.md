# Feature: Ask Buyer Where They Are in the Process

**Status:** Planning
**Date:** 2026-03-24

## Problem

When a buyer starts a new chat, they land on a blank screen with no context. The AI doesn't know if they're researching from their couch or sitting across from a finance manager. The first few messages are wasted on discovery, and the system prompt, quick actions, and dashboard are all generic regardless of the buyer's situation.

## Goal

Ask the buyer where they are in the buying process before the chat begins, so the AI can tailor its advice, tone, and urgency from the very first message.

---

## What a Business Expert Would Contribute

A business expert (someone from car sales, consumer advocacy, or dealership operations) would challenge assumptions and sharpen the design. Here's what they'd focus on:

### Questions They'd Ask

1. **"Who is the user at each stage?"**
  - A researcher at home has time and low stress. They want data, comparisons, market pricing.
  - A buyer at the dealership is under pressure, possibly being watched. They need fast, tactical scripts.
  - These are almost different products. Does the AI's personality need to shift?
2. **"Do buyers actually know what stage they're in?"**
  - People don't think in phases. They think in situations: "I got a quote emailed to me", "The salesman just left to talk to his manager", "I'm looking at a Carfax."
  - Situation-based options ("I have a deal to review", "I'm at the dealership right now") may convert better than phase labels ("Research", "Negotiation").
3. **"What's the highest-value moment?"**
  - The dealership floor is where buyers lose the most money. If someone selects "I'm at the dealership", the AI should shift into a completely different mode: shorter responses, ready-to-use scripts, urgency awareness.
  - Is this the stage we should optimize for first?
4. **"What information does the AI need at each stage to be useful immediately?"**
  - Research: What car? New or used? Budget?
  - Got a quote: The numbers (MSRP, their offer, APR, monthly payment)
  - At dealership: What just happened? What did they say?
  - Post-purchase: Upload the contract, check for hidden fees
  - The follow-up question after stage selection matters as much as the stage itself.
5. **"Should the first AI message change based on selection?"**
  - A researcher should get: "What car are you looking at? I'll pull market data."
  - Someone at a dealership should get: "What's happening right now? I'll help you respond."
  - Generic "How can I help?" wastes the context we just collected.
6. **"What about returning users?"**
  - If someone has a previous session with a vehicle already set, should we offer to continue that deal?
  - "Pick up where you left off" vs. "Start fresh" could be more useful than asking the phase again.
7. **"Are 6 phases too many?"**
  - Current backend DealPhase enum: research, initial_contact, test_drive, negotiation, financing, closing.
  - A business expert would likely collapse these into 3-4 buyer-meaningful stages:
    - **Researching** — haven't talked to a dealer yet
    - **Have a deal/quote** — got numbers, need analysis
    - **At the dealership** — need real-time tactical help
    - **Already bought** — post-purchase review (v2?)
8. **"What's the competitive angle?"**
  - No app currently helps buyers *in real time at the dealership*. That's the killer feature.
  - The stage selector should make "I'm at the dealership" feel urgent and supported, not just another option.

### What They'd Validate or Push Back On

- Whether the DealPhase enum maps to how buyers actually think (probably not — it maps to how *dealers* think)
- Whether post-purchase review is worth including in v1
- Whether "test_drive" is a meaningfully different phase from "initial_contact" from the buyer's perspective
- The exact wording of each option — language matters enormously for conversion
- Whether the quick actions should change per stage (almost certainly yes)

---

## Proposed UX Flow

The phase picker is a **suggestion, not a gate**. Users can always skip it and jump straight into the chat.

1. User navigates to Chat (or taps +)
2. A new session is created immediately (phase defaults to `research`)
3. The chat screen shows a **welcome state** with:
   - Three situation cards: "Researching", "Have a deal to review", "At the dealership"
   - The chat input and camera/upload button visible below the cards
   - Subtle placeholder text in the input: "Or just tell me what's going on"
4. **Path A — tap a card:** A hardcoded greeting message appears instantly (no LLM call). Session is created with the selected `buyer_context`. The greeting is saved to message history so Claude has it as context when the user replies. Quick actions update to match the context.
5. **Path B — type a message or upload a photo:** Session is created with default `researching` context. AI infers the real context from the conversation using the `update_buyer_context` tool. Phase picker disappears once the first message is sent.
6. Either path leads to the same chat experience. The phase picker is just a fast-start shortcut.

### Why this works
- No friction: the user is never blocked from acting. Cards are helpers, not gates.
- Covers the "I don't know" case naturally — they just start talking or upload a photo.
- Matches the existing notes.md vision of "Prep mode" (researching) vs. "I'm here now" (at the dealership) as two entry points.
- Single-tap cards follow the Duolingo/Calm pattern (highest completion rates in mobile onboarding research).

---

## Technical Implementation

Guided by `docs/first-version-quality.md`: prefer the clean design over the quick fix. No overloading existing fields, no synthetic messages, no growing switch statements.

### Key Architectural Decision: BuyerContext vs DealPhase

The phase picker's concept of "situation" and the backend's `DealPhase` enum are **two different things**:

- **`DealPhase`** tracks where the *deal* is: research → initial_contact → test_drive → negotiation → financing → closing. The AI advances this via the existing `update_deal_phase` tool as the conversation progresses.
- **`BuyerContext`** (new) captures the buyer's *situation*: are they at home researching, reviewing a deal remotely, or physically at the dealership?

These are orthogonal. You can be researching at the dealership, or negotiating from your couch over email. Overloading `DealPhase` to carry both meanings would violate single responsibility and create confusing conditionals everywhere.

```
# New enum
class BuyerContext(StrEnum):
    RESEARCHING = "researching"
    REVIEWING_DEAL = "reviewing_deal"
    AT_DEALERSHIP = "at_dealership"
```

`buyer_context` is a new column on `DealState`, set at session creation (or inferred by the AI via a new `update_buyer_context` tool). The system prompt receives both: *"The buyer is at the dealership. The deal is in the negotiation phase."*

### Layer-by-Layer Implementation

#### 1. Backend — Data Model

| Change | File |
|--------|------|
| Add `BuyerContext` enum | `app/models/enums.py` |
| Add `buyer_context` column to DealState (default: `researching`) | `app/models/deal_state.py` |
| Add `buyer_context` to SessionCreate schema (optional) | `app/schemas/session.py` |
| Add `buyer_context` to DealStateResponse schema | `app/schemas/deal.py` |
| Apply `buyer_context` on session creation | `app/routes/sessions.py` |
| Alembic migration for new column | `alembic/versions/` |

#### 2. Backend — AI Integration

| Change | File |
|--------|------|
| Add `update_buyer_context` tool definition | `app/services/claude.py` |
| Add context-specific preambles to system prompt | `app/services/claude.py` |
| Include `buyer_context` in deal state dict passed to prompt | `app/routes/chat.py` |
| Handle `update_buyer_context` tool call | `app/routes/chat.py` |
| Add AI greeting endpoint (generates first message without user input) | `app/routes/chat.py` |

**System prompt preambles** — injected based on `buyer_context`:

```python
CONTEXT_PREAMBLES = {
    "researching": (
        "The buyer is researching from home. Be educational and thorough. "
        "Help them compare options, understand fair pricing, and prepare for the dealership."
    ),
    "reviewing_deal": (
        "The buyer has a deal or quote to review. Be analytical and direct. "
        "Focus on the numbers — what's fair, what's hidden, what to push back on."
    ),
    "at_dealership": (
        "The buyer is at the dealership RIGHT NOW. Be brief and tactical. "
        "Give ready-to-use scripts. Short responses only — they may be glancing at their phone. "
        "Tell them exactly what to say and when to walk away."
    ),
}
```

**Hardcoded greeting messages** — defined on the frontend and saved to the backend as the first assistant message when a card is tapped. No LLM call needed. The greeting appears instantly (no loading/streaming delay) and is persisted so Claude has it in the message history when the user replies. A simple `POST` to save the canned message — no new endpoint required.

```typescript
const GREETING_MESSAGES: Record<BuyerContext, string> = {
  researching:
    "What car are you looking at? Tell me the year, make, and model " +
    "and I'll help you understand fair pricing and what to watch for.",
  reviewing_deal:
    "Tell me the numbers — MSRP, their offer, monthly payment, APR — " +
    "or snap a photo of the deal sheet. I'll break down what's fair " +
    "and what to push back on.",
  at_dealership:
    "I'm here to help. What's happening right now? Tell me what they " +
    "just said or offered, and I'll tell you exactly how to respond.",
}
```

**`update_buyer_context` tool** — allows Claude to change the buyer context mid-conversation if it detects the situation has changed (e.g., buyer was researching but mentions they just arrived at the dealership). Same pattern as `update_deal_phase`.

#### 3. Frontend — Welcome State

| Change | File |
|--------|------|
| New `WelcomePrompts` component (buyer-chat-specific, not shared) | `components/chat/WelcomePrompts.tsx` |
| Replace auto-create with welcome state in chat screen | `app/(app)/chat.tsx` |
| Add `buyer_context` to createSession params | `stores/chatStore.ts` |
| Pass `buyer_context` to API | `lib/apiClient.ts` |
| Add `buyerContext` to deal store state | `stores/dealStore.ts` |
| Handle `update_buyer_context` tool call in deal store | `stores/dealStore.ts` |

**Welcome state** — not a modal. An inline conditional render in `chat.tsx`:

- When `activeSessionId === null` and screen is focused: render `WelcomePrompts` above the chat input
- `WelcomePrompts` shows three tappable cards + placeholder text "Or just tell me what's going on" in the input
- On card tap: create session with selected `buyer_context`, display hardcoded greeting instantly, save it as first assistant message
- On message/photo: create session with default `researching` context, send the user's message normally
- Welcome state disappears once a session exists

**`WelcomePrompts`** lives in `components/chat/` (not `components/shared/`) because it's specific to the buyer chat flow, not a reusable widget.

#### 4. Frontend — Quick Actions Per Context

| Change | File |
|--------|------|
| Make quick actions data-driven by buyer context | `components/dashboard/QuickActions.tsx` |
| Expand prompt mapping for new action IDs | `hooks/useChat.ts` |

**Quick actions config** — a map from `BuyerContext` to action definitions, replacing the hardcoded array:

```typescript
const ACTIONS_BY_CONTEXT: Record<string, QuickAction[]> = {
  researching: [
    { id: 'compare_prices', label: 'Compare Prices', Icon: BarChart },
    { id: 'new_or_used', label: 'New or Used?', Icon: HelpCircle },
    { id: 'whats_my_budget', label: "What's My Budget?", Icon: DollarSign },
  ],
  reviewing_deal: [
    { id: 'check_price', label: 'Check This Price', Icon: Search },
    { id: 'hidden_fees', label: 'What Fees Are Hidden?', Icon: AlertTriangle },
    { id: 'should_i_walk', label: 'Should I Walk?', Icon: DoorOpen },
  ],
  at_dealership: [
    { id: 'what_to_say', label: 'What Do I Say?', Icon: MessageSquare },
    { id: 'should_i_walk', label: 'Should I Walk?', Icon: DoorOpen },
    { id: 'pressuring_me', label: "They're Pressuring Me", Icon: ShieldAlert },
  ],
}
```

`QuickActions` receives `buyerContext` as a prop and looks up the actions. The `useChat` hook's prompt map expands to cover all action IDs. Same existing pattern — action ID → prompt string → sendMessage.

#### 5. Frontend — Dashboard Panel Ordering

| Change | File |
|--------|------|
| Reorder `dashboardWidgets` array based on `buyerContext` | `components/dashboard/DashboardPanel.tsx` |

Reorder, don't hide/show. All panels remain accessible; the most relevant one moves to the top:

- **Researching:** vehicle card → numbers → scorecard → checklist
- **Reviewing deal:** numbers → scorecard → vehicle card → checklist
- **At dealership:** scorecard → numbers → vehicle card → checklist

This is a small change to the existing `dashboardWidgets` array — sort based on a priority map keyed by `buyerContext`.

### Files Summary

| File | Action |
|------|--------|
| `apps/backend/app/models/enums.py` | Add `BuyerContext` enum |
| `apps/backend/app/models/deal_state.py` | Add `buyer_context` column |
| `apps/backend/app/schemas/session.py` | Add `buyer_context` to `SessionCreate` |
| `apps/backend/app/schemas/deal.py` | Add `buyer_context` to `DealStateResponse` |
| `apps/backend/app/routes/sessions.py` | Apply `buyer_context` on creation |
| `apps/backend/app/routes/chat.py` | Include context in prompt, handle tool call |
| `apps/backend/app/services/claude.py` | Add context preambles, `update_buyer_context` tool |
| `apps/backend/alembic/versions/` | Migration for `buyer_context` column |
| `apps/mobile/components/chat/WelcomePrompts.tsx` | **New** — situation cards for new sessions |
| `apps/mobile/app/(app)/chat.tsx` | Welcome state conditional render |
| `apps/mobile/stores/chatStore.ts` | `createSession` accepts `buyerContext` |
| `apps/mobile/stores/dealStore.ts` | Add `buyerContext`, handle `update_buyer_context` tool |
| `apps/mobile/lib/apiClient.ts` | Pass `buyer_context` to session creation + deal state mapping |
| `apps/mobile/components/dashboard/QuickActions.tsx` | Data-driven actions by context |
| `apps/mobile/hooks/useChat.ts` | Expand prompt mapping for new action IDs |
| `apps/mobile/components/dashboard/DashboardPanel.tsx` | Panel ordering by context |
| `apps/backend/tests/test_sessions.py` | Test session creation with `buyer_context` |

### What We're NOT Building

- No new database tables (just a column on existing `DealState`)
- No modal component (inline welcome state)
- No LLM call for the greeting (hardcoded per context, displayed instantly)
- No new greeting endpoint (save canned message via existing message persistence)
- No changes to SSE streaming or tool call infrastructure
- No changes to `DealPhase` enum (it stays as-is for deal progression)
- No discreet/compact mode (deferred)
- No "continue previous deal" (v2)
- No post-purchase review option (v2)

### Verification

1. New chat → welcome state with 3 cards and visible chat input
2. Tap "Researching" → session created with `buyer_context=researching`, AI sends research-oriented greeting, research quick actions shown
3. Tap "At the dealership" → session created with `buyer_context=at_dealership`, AI sends tactical greeting, dealership quick actions shown
4. Skip cards, type a message → session created with default context, AI infers and sets context via tool call
5. Skip cards, upload a photo → same as above
6. Dashboard panels reorder based on context
7. AI changes context mid-conversation when situation shifts (e.g., buyer arrives at dealership during a research session)
8. Existing sessions load normally (no welcome state)
9. Tap + button → welcome state appears for new session
10. `make check-all` passes
11. Backend tests cover session creation with buyer_context, AI greeting endpoint

---

## Research Findings

Based on consumer car-buying research (Cox Automotive 2025 Car Buyer Journey Study, Deloitte 2026 Global Automotive Consumer Study, FTC enforcement data, KBB/LendingTree regret surveys) and AI product onboarding analysis:

### The Real Buyer Journey (by the numbers)

- Total buying journey: ~14 hours across all stages
- 92% use digital channels before contacting a dealer
- 63% research on their phone **while physically at the dealership**
- Average dealership visit: 2-3 hours, more than half spent on negotiation or paperwork
- 40% of new car buyers report regrets; 60% of Gen Z buyers
- Average hidden fees per buyer: $640 (CoPilot study)
- FTC found 9 out of 10 buyers at some dealers paid more than advertised price

### Competitive Gap (confirmed)

No existing tool operates in real-time, at the dealership, on the buyer's phone, as an AI advisor. The landscape:
- **Pre-purchase tools** (TrueCar, Edmunds, KBB, CarGurus) stop being useful once you're at the dealer
- **AI negotiation agents** (CarEdge Pro) negotiate remotely, not in-person
- **Human concierge** (DealGuard) is phone-based and doesn't scale
- **Dealer-side AI** (Tekion, AutoCorp) is built for dealers, not buyers

The "AI in your pocket at the dealership" positioning is a genuine whitespace.

### AI Onboarding Patterns (what works)

- General-purpose AI (ChatGPT, Claude): zero onboarding, infer from usage
- Domain-specific AI (Grammarly, Duolingo, Headspace): light onboarding with 3-5 options per screen
- Duolingo and Calm both use exactly 4 options per onboarding screen (extensively A/B tested)
- Single-tap cards with auto-advance have the highest completion rates
- Proactive first message increases engagement 40-60% in domain-specific apps vs. blank input

### Phone Usage at the Dealership

- Openly used during wait times, walking the lot, in the parking lot
- Discreet usage needed during face-to-face negotiation and F&I
- The "bathroom break" pattern is real — buyers step away to check prices or call for advice
- Key insight: the dashboard must deliver value in a **5-second glance**

---

## Recommended Answers to Open Questions

Based on the research above, here's what we recommend for each open question. These are opinionated positions, not alternatives.

### 1. Stage Options & Labels

**Use 3 situation-based options, not phase labels.**

Buyers don't think in "phases" — they think in situations. The labels should describe what the buyer is doing right now, not where they are in a pipeline. Three options is the right number: low friction (one tap), covers the full journey, and each option maps to a meaningfully different AI behavior.

| Option | Label | Subtitle | Maps to DealPhase |
|--------|-------|----------|-------------------|
| 1 | **Researching** | "Looking at cars, comparing prices" | `research` |
| 2 | **Have a deal to review** | "Got a quote or offer I want to check" | `negotiation` |
| 3 | **At the dealership** | "I'm here right now and need help" | `negotiation` (with `at_dealership` flag) |

Why not 4? "Already bought / post-purchase" is a retention feature, not a first-session feature. It should come later (v2) and should be a separate entry point (e.g., "Review my contract" in sessions), not an onboarding option that dilutes the active-buying focus.

Why situation-based? "I have a deal to review" is immediately understandable. "Negotiation" requires the buyer to categorize themselves. Research on the Hick-Hyman Law shows that self-evident labels reduce decision time.

**Note:** The existing `DealPhase` enum (research, initial_contact, test_drive, negotiation, financing, closing) should remain as the backend's granular phase tracking — the AI will move through these as the conversation progresses. The picker sets the *starting point*, not the only phase.

### 2. AI Auto-Send a First Message?

**Yes. Proactive, phase-specific first message.**

Research shows domain-specific apps get 40-60% more engagement with a contextual greeting vs. a blank input. The greeting must be specific (not "How can I help?") and immediately useful.

| Phase | First Message | Follow-up Quick Actions |
|-------|---------------|------------------------|
| **Researching** | "What car are you looking at? Tell me the year, make, and model and I'll help you understand fair pricing and what to watch for." | "Compare prices" / "New or used?" / "What's my budget?" |
| **Have a deal** | "Tell me the numbers — MSRP, their offer, monthly payment, APR — or snap a photo of the deal sheet. I'll break down what's fair and what to push back on." | "Check this price" / "What fees are hidden?" / "Should I walk?" |
| **At the dealership** | "I'm here to help. What's happening right now? Tell me what they just said or offered, and I'll tell you exactly how to respond." | "What do I say?" / "Should I walk?" / "They're pressuring me" |

The first message should be 2-3 sentences max. It should (a) acknowledge the context, (b) tell the user exactly what to do next, and (c) set the tone.

### 3. AI Personality Shift Per Stage?

**Yes, meaningfully different.**

This is one of the most important product decisions. The three stages represent fundamentally different user needs:

| | Researching | Have a Deal | At the Dealership |
|---|---|---|---|
| **Tone** | Educational, thorough | Analytical, direct | Tactical, urgent |
| **Response length** | Medium-long (explanations welcome) | Medium (focused on numbers) | Short (scripts, not essays) |
| **Focus** | Market data, comparisons, what to look for | Number analysis, hidden fees, negotiation leverage | What to say next, when to walk, real-time coaching |
| **Personality** | "Knowledgeable friend" | "Sharp analyst" | "Coach in your corner" |

This maps to system prompt preambles, not separate models or characters. The base system prompt stays the same; a phase-specific paragraph adjusts the behavior.

### 4. Returning Users?

**Not for v1. Show the phase picker every time.**

"Continue previous deal" adds complexity (which session? what if the deal is done?) and the phase picker is fast enough (one tap) that it's not burdensome. This is a good v2 feature once we see usage patterns.

### 5. Quick Actions Per Phase?

**Yes, change them per phase.**

The current quick actions ("What Do I Say?", "Should I Walk?", "What Am I Forgetting?") are all dealership-oriented. They don't make sense during research. Phase-specific quick actions (shown in the table above) make each stage feel purpose-built.

### 6. Is "At the Dealership" the Killer Differentiator?

**Yes. It should get disproportionate polish.**

No competitor operates here. 63% of buyers use their phones at the dealership. The four-square worksheet, the F&I pressure — all happen here. This is where buyers lose the most money and where the app provides the most value.

Concrete implications:
- The "At the dealership" card in the picker should feel visually distinct — not just another option
- The AI's dealership mode should be noticeably different (shorter, more urgent, script-ready)
- The dashboard scorecard (green/yellow/red) must be readable in a 5-second glance
- Quick actions in this mode should be immediately actionable ("What do I say right now?")

### 7. Wrong Stage Selection — Failure Mode?

**The AI should auto-correct silently.**

The existing `update_deal_phase` tool already lets Claude change the phase mid-conversation. If someone selects "Researching" but starts describing a deal they're negotiating, Claude should call `update_deal_phase` to advance the phase and adapt its behavior. No need to ask the user to re-select.

This is the hybrid approach that research supports: explicit selection for initial context, auto-detection for ongoing adjustment.

### 8. Phase Picker as Suggestion, Not Gate

**Users can always skip the cards and just type or upload a photo.**

The phase cards are like ChatGPT's suggested prompts — helpful shortcuts, not mandatory steps. The chat input and camera button are always visible below the cards. Placeholder text ("Or just tell me what's going on") signals that typing is fine. When the user skips the cards:
- Session starts in `research` phase (safe default)
- AI infers the real phase from conversation context
- Phase picker disappears after the first message is sent

This handles the "I don't know" case naturally and avoids the freeze-on-options problem a business expert would flag.

### 9. Dashboard Panel Ordering Per Phase

**Reorder panels based on phase, don't hide/show them.**

All panels remain accessible; the most relevant one moves to the top:
- **Researching:** Vehicle card first (what car?), then numbers
- **Have a deal:** Numbers panel first (the deal specifics), then scorecard
- **At the dealership:** Scorecard first (green/yellow/red at a glance), then numbers

This makes the dashboard feel purpose-built for the selected situation without removing functionality. Small change, big perceived-quality impact.

### 10. System Prompt: Context, Not Tactics

**Tell Claude the buyer's situation. Don't teach it dealer tactics.**

Claude already knows about four-square worksheets, yo-yo financing, F&I pressure, etc. The system prompt just needs to communicate: "This buyer is at the dealership right now" or "This buyer is reviewing a deal they received." Claude will bring the right tactical knowledge to bear on its own. This keeps the prompt lean and avoids redundant instruction.

### 11. Timer Behavior

**The dealership timer (from notes.md / PRD) tracks how long the buyer has been at the dealership and flags when long waits may be a pressure tactic.** This is buyer-facing awareness, not a dealer training tool.

For the phase picker: selecting "At the dealership" could auto-start the timer. However, message timestamps may be equally useful — the AI can notice gaps ("you haven't messaged in 20 minutes, are they making you wait?") without needing a separate timer start action. Decision: defer to implementation; the timer infrastructure already exists and can be wired up either way.

