# ADR-0026: Panel templating + reconcile removal + complete-reply-first

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Backend

## Context

Following ADR-0025 (detached insights follow-up jobs), each buyer turn ran
three sequential LLM calls:

1. **Main chat** — user-facing reply + structural tool calls.
2. **Reconcile** — second pass that re-read the conversation and called
   cleanup tools (`update_negotiation_context`, `update_checklist`,
   `update_session_information_gaps`, etc.) the main pass had missed.
3. **Panel synthesis** — Sonnet call that generated the full 10–14-kind
   panel card JSON from scratch.

Two instrumented six-turn evals (see `docs/haiku-panel-eval.md`) showed:

- Panel generation was the dominant wall-clock cost (34% of total), and
  10 of 14 card kinds were **pure renders** of fields already on deal
  state — no model reasoning required. LLM-generated card JSON for those
  kinds was expensive re-serialization.
- Reconcile spent ~11s/turn calling tools and then emitted 200–1500 chars
  of trailing prose (which the prompt explicitly forbade). Its value was
  a *safety net* for specific tool categories the main chat reliably
  missed (`update_negotiation_context`, `update_checklist`,
  `update_deal_phase`) and stance-only turns where the main pass emitted
  zero tools.
- The main chat streamed reply text, then paused mid-stream for 5–10s
  while tool_use blocks serialized, then resumed in a second step with a
  continuation. The pause read as a stall to users.

Separately, Anthropic's published guidance ([implement-tool-use],
[best-practices]) says aggressive CAPS/MUST emphasis in system prompts
*overtriggers* on Claude 4.5+ models, and that tool performance is
dominated by tool-description quality — not by rules in the system
prompt. Our prompt had accreted in the opposite direction as defensive
patches, reaching ~33KB with duplicated rules and dead reconcile-era
recovery fragments.

## Decision

Three coupled changes, shipped together:

### 1. Reconcile pass removed

The reconcile LLM pass is deleted, not flag-gated. Main chat becomes the
sole source of structured state updates. The `InsightsFollowupJob.reconcile_status`
column is retained to avoid a migration and always set to `SKIPPED` at
job creation. `InsightsFollowupKind.LINKED_RECONCILE_PANEL` is kept for
the same reason — the name is historical.

To close the structural-coverage gap reconcile was compensating for, the
main-chat system prompt and the relevant tool descriptions gained
explicit when-to-call triggers — not as CAPS/MUST rules in the prompt,
but as neutral-toned sentences inside each tool's own `description`
field (where Anthropic's guidance says the load-bearing tool-use signal
lives).

### 2. Panel templating split

Panel generation is split into two mechanisms:

- **Deterministic render (no LLM)** — 10 of 14 card kinds are derivable
  from deal state alone: `phase`, `numbers`, `warning`,
  `what_still_needs_confirming`, `checklist`, `your_leverage`, `vehicle`,
  `success`, `savings_so_far`, `notes`. A new
  `apps/backend/app/services/panel_card_builder.py:build_rendered_panel_cards(deal_state_dict)`
  produces these cards as ~0ms pure dict construction.
- **Narrow narrative synthesis (LLM)** — only 3 kinds need genuine
  prose: `dealer_read`, `next_best_move`, `if_you_say_yes`. The
  `GENERATE_AI_PANEL_PROMPT` was renamed to
  `GENERATE_AI_PANEL_SYNTHESIS_PROMPT` and drastically shrunk (drops the
  full card catalog, ordering rules, inclusion rules, and negotiation
  context mapping — the renderer owns all of that).

Rendered + synthesized cards merge before the existing
`canonicalize_panel_cards` + `_enforce_single_vehicle_focus_for_panel_cards`
pipeline. The client-visible SSE contract (`panel_started` / `panel_done`
/ `panel_error` on the detached follow-up stream) is unchanged.

### 3. Complete-reply-first + step-loop short-circuit

Because tool results are fire-and-forget (not surfaced back to the
model), the turn no longer benefits from the classic text → tools → text
multi-step shape. The prompt now instructs the model to write its full
reply BEFORE emitting tool_use blocks, and
`chat_loop_engine.run_chat_loop_engine` short-circuits the turn when
step 0 produced substantive pre-tool text (≥150 chars) alongside tool
calls. A new TIMING outcome `reply_with_tools` tags these single-step
turns in logs.

Consequently, the tool policy (`tool_policy.py`) collapsed from ~80
lines of conditional injection flags to ~15 lines: step 0 uses
`auto`, step ≥ 1 forces `none` to guarantee a user-visible reply on the
rare continuations.

### 4. Prompt simplification (aligned with Anthropic guidance)

`prompt_static.py` shrank from 32,903 → 19,773 chars (−40%). Changes:
role-first framing, three positive `<example>` blocks (cold-start
structural, stance-shift, conversational), Anthropic's canonical
parallel-tool-calls block used verbatim, all CAPS/MUST emphasis
stripped, dead reconcile-era recovery prompts deleted
(`DASHBOARD_RECONCILE_AFTER_ASSESSMENT_TOOLS`,
`POST_EXTRACTION_ASSESSMENT_NUDGE`, `STEP_AFTER_TOOL_ONLY_NUDGE`).

### Related tool-scoping change

Buyer-stated targets (`your_target`, `walk_away_price`) moved out of
`update_deal_numbers` into a dedicated narrow-scope tool
`set_buyer_targets`. The tool description restricts it to explicit
buyer-stated numbers, preventing the model from persisting its own
recommended targets as buyer commitments. A new `custom_numbers` JSON
column on `Deal` (migration `0008_deal_custom_numbers.py`) backs a
companion `update_deal_custom_numbers` tool that replaces the full list
of free-form number rows (fees, add-ons, tax, rebates, retail
references) shown on the Numbers panel card.

## Alternatives Considered

### A. Keep reconcile, shrink its prompt
- Pros: Preserves safety net; smaller per-call cost.
- Cons: Still two model calls serialized. Eval showed reconcile's
  "genuine new tool calls" (mode b) were recoverable by tightening main
  chat's tool descriptions — the safety net was covering gaps the
  primary prompt could close directly.

### B. Haiku + Opus-advisor on reconcile/panel
- Pros: Cheaper nominal token cost.
- Cons: Empirically broken in eval — advisor produced 4k–8k output
  tokens for a JSON formatting task, cost $0.45–$0.79/turn, and broke
  the executor's JSON on one turn (zero cards emitted). See
  `docs/haiku-panel-eval.md` 2026-04-17 decision entry.

### C. Move all panel cards to deterministic render
- Pros: Zero LLM cost on panel.
- Cons: `dealer_read`, `next_best_move`, `if_you_say_yes` are genuine
  narrative synthesis — templating loses the prose quality users see as
  the panel's main value-add.

### D. Add more rules / CAPS directives to cover the reconcile gap
- Pros: Fast to write.
- Cons: Anthropic's published guidance says aggressive MUST language
  overtriggers on Claude 4.5+/4.6+. Empirically verified in this pass:
  removing CAPS emphasis dropped over-emission on conversational turns
  from 8 tools to 0, while adding when-to-call triggers *in tool
  descriptions* raised coverage on fees-heavy turns from 2 to 8.

## Consequences

### Positive

- **Follow-up pipeline −47% wall-clock** on the 6-turn eval (212.5s →
  113.4s). Panel LLM stream −62%. Panel output text −71%.
- **End-to-end −33%** when combined with complete-reply-first (38.4s →
  25.7s average turn).
- **Steps per turn: 1.0** (was 2.0 average). The mid-stream pause
  moved to post-reply where it reads as natural post-processing.
- **Prompt −40%** with same-or-better tool emission across all eval
  turns and zero over-emission on conversational turns.
- **Single source of truth** for structured state: main chat only.
  Removes the duplicate-tool-call category (mode-a reconciles).

### Negative

- **No reconcile safety net.** If the main pass misses a structural tool
  call, the gap is user-visible in the panel until the next turn. The
  prompt and tool-description changes closed the gap in eval, but
  unusual turn shapes could reopen it.
- **`what_changed` card is temporarily unavailable** — it needs a
  prior-numbers snapshot on `DealState` that doesn't exist yet.
- **Cold-start kitchen-sink turns** (user dumps vehicle + prices + fees
  in the first message with no warm deal state) still emit only 1–2
  tools on Sonnet. Real-world users go through VIN intercept; the eval
  script bypasses it.
- **`InsightsFollowupJob.reconcile_status`** column is now dead weight.
  Drop in a later migration.

### Neutral

- Client SSE contract unchanged. `panel_started` / `panel_done` still
  fire on the detached follow-up stream; clients see no protocol change.
- `InsightsFollowupKind.LINKED_RECONCILE_PANEL` kept for job-key
  stability despite the name no longer reflecting behavior.

## References

- `docs/haiku-panel-eval.md` — full eval narrative, decision history,
  and per-turn measurements.
- ADR-0007 — original AI-generated panel cards.
- ADR-0013 — canonical panel contract and per-kind instance caps
  (unchanged by this ADR; the renderer emits against the same contract).
- ADR-0025 — detached insights follow-up jobs. This ADR collapses the
  pipeline described there from reconcile + panel to panel-only.
- Anthropic docs: *Prompt engineering best practices*, *Implement tool
  use* — source for the overtriggering note, tool-description guidance,
  and the canonical parallel-tool-calls block.
