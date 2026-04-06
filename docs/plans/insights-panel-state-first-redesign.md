# Insights Panel State-First Redesign

Created: 2026-04-04

## Goal

Make the Insights Panel the buyer's working memory, not a recap of the latest assistant reply.

The panel should answer:
1. What is true now?
2. What changed?
3. What is dangerous?
4. What still needs confirmation?
5. What should I do next?
6. What is worth remembering?

## Core Rules

- Prefer structured state over recent conversation.
- Do not paraphrase the latest assistant response unless something needs to stay visible.
- Show 3 to 5 cards at a time, not the full library.
- Stable cards should preserve state across turns.
- Volatile cards should react only to meaningful changes.
- The panel should reduce cognitive load, not add more reading.

## Backbone

The panel should revolve around five jobs:
- Numbers
- What Changed
- Warning
- Next Best Move
- Notes

Everything else supports those jobs.

## Final Card Inventory

### True templates

- Vehicle
- Numbers
- Warning
- Notes
- Comparison
- Checklist
- Success

### Content modes inside templates

- What Changed
- What Still Needs Confirming
- Dealer Read
- Your Leverage
- Next Best Move
- If You Say Yes
- Trade-Off
- Savings So Far

## Exact Card Names

- Vehicle
- Numbers
- Warning
- Notes
- Comparison
- Checklist
- Success
- What Changed
- What Still Needs Confirming
- Dealer Read
- Your Leverage
- Next Best Move
- If You Say Yes
- Trade-Off
- Savings So Far

## Key Definitions

### Notes

Purpose:
Durable facts the buyer should not have to remember alone.

Rules:
- facts only
- short bullets
- max 3 to 5 notes
- persist until resolved or replaced
- high bar for inclusion

Examples:
- First offer: $31,900
- 5.4% credit union pre-approval
- Dealer said doc fee may be removable
- Trade-in payoff still unconfirmed

### Dealer Read

Purpose:
Interpret likely dealership intent from observed behavior.

Rules:
- always grounded in something observable
- use uncertainty language like "likely" or "probably"
- never fake mind-reading

### What Changed

Purpose:
Show the meaningful delta since the last negotiation state.

Examples:
- price moved
- term changed
- fee appeared
- trade-in changed
- add-on added or removed

### If You Say Yes

Purpose:
Show the consequence of accepting now.

Best phase:
F&I and closing

### Savings So Far

Purpose:
Show measurable progress late in the flow.

Rules:
- late-stage only
- only when grounded in real numbers
- not for early motivational theater

## When Cards Appear

### Research

Prefer:
- Vehicle
- Numbers
- Checklist
- Notes

Allow when relevant:
- Comparison
- What Still Needs Confirming
- Next Best Move

Usually avoid:
- Dealer Read
- What Changed
- If You Say Yes
- Savings So Far

### Negotiation

Prefer:
- Numbers
- Warning
- What Changed
- Your Leverage
- Next Best Move
- Notes

Allow when relevant:
- Dealer Read
- What Still Needs Confirming
- Comparison
- Trade-Off

### F&I

Prefer:
- Numbers
- Warning
- If You Say Yes
- What Still Needs Confirming
- Notes

Allow when relevant:
- What Changed
- Trade-Off
- Next Best Move
- Savings So Far

### Closing

Prefer:
- Numbers
- What Still Needs Confirming
- Notes
- Savings So Far
- Success

Allow when relevant:
- Warning
- If You Say Yes
- Checklist
- Trade-Off

## Business Priorities

Highest business value:
1. What Changed
2. What Still Needs Confirming
3. Warning
4. Numbers
5. Notes

These are the cards most likely to prevent mistakes, build trust, and make the product feel worth using.

## V1 Recommendation

Ship first:
- Vehicle
- Numbers
- Warning
- What Changed
- What Still Needs Confirming
- Next Best Move
- Your Leverage
- Notes
- Comparison
- Savings So Far

Add later:
- Dealer Read
- If You Say Yes
- Trade-Off
- Checklist
- Success

## Implementation Direction

- Keep the current full-card replacement and SSE flow initially.
- Rework generation so cards are driven primarily by structured state and negotiation context.
- Use existing templates first; only add a new Notes template if the current system cannot express it cleanly.
- Treat Notes as the strongest candidate for a genuinely new card type.

## Success Criteria

The redesign is successful if:
- the panel stops repeating the latest assistant reply
- the panel preserves important context across turns
- the user can quickly see what changed in the deal
- late-stage cards clarify consequences and savings
- Notes behaves like durable memory, not a junk drawer
