# Insights follow-up model eval — running notes

Goal: figure out whether we can replace Sonnet with Haiku (or Haiku + Opus advisor) in the insights follow-up pipeline (reconcile + panel generation) to cut latency and cost without degrading structured deal state or panel quality.

## How to read / update this doc

- **Append** new findings and decisions under the log; do not overwrite older entries. The history of why a decision flipped is the important part.
- When a scenario produces new data, add a dated entry under "Eval runs" with the variant table and the one-sentence takeaway.
- When we make a call that sticks (e.g. "drop this variant", "ship this for panel-only"), add a bullet under "Decisions" with a date and a one-line reason.
- Keep "Open questions" short — questions that have been answered should move into "Decisions" or get deleted.

## Related code

- Orchestration: `apps/backend/app/services/insights_followup.py`, `insights_followup_shadow.py`
- Variant + advisor config: `apps/backend/app/services/claude/advisor_config.py`, `app/core/config.py`
- Log entry: search `shadow_comparison` in NDJSON / `docker logs dealership-ai-backend-1`
- Client UI: `apps/mobile/components/insights-panel/{InsightsPanel,ShadowVariantSection,VariantMetricsStrip}.tsx`

## Current config (2026-04-17)

```python
# apps/backend/app/core/config.py
CLAUDE_INSIGHTS_SHADOW_HAIKU_PLAIN_ENABLED: bool = True   # Sonnet vs Haiku (plain) shadow
CLAUDE_INSIGHTS_SHADOW_HAIKU_ADVISOR_ENABLED: bool = False  # turned off, see 2026-04-17 decision
```

Dev toggle in Settings → "Show insights shadow comparison" renders per-variant metrics strips in the InsightsPanel.

---

## Decisions

- **2026-04-17 — Drop Haiku + Opus advisor for panel generation.** Two turns, two failure modes: turn 1 panel took 62s and cost $0.45 for the advisor alone (4192 advisor output tokens vs Anthropic's documented 400–700 typical); turn 2 panel took 97s, cost $0.79, emitted **zero** cards because the advisor's 8318-token dump broke the executor's JSON output. Advisor is the wrong tool for well-defined JSON formatting — it's designed for open-ended agentic planning.
- **2026-04-17 — Frontend metric strips report combined (reconcile + panel) tokens, not panel-only.** Originally the chip strip showed panel-only tokens alongside total duration + total cost, which was misleading. Backend now emits `total_input_tokens` / `total_output_tokens` / `total_advisor_call_count` and the strip uses those. `tools×N` always renders (including zero) so Haiku's zero-tool reconcile pattern stays visible.

## Eval runs

### Turn 1 — 2026-04-17 — "I like the 7.3 godzilla."

Three-way (Sonnet vs Haiku-plain vs Haiku+advisor).

| Variant | Reconcile | Panel | Total | Cost | Cards |
|---|---|---|---|---|---|
| Sonnet (prod) | 5.8s, 2 tools | 8.2s | 14.1s | $0.052 | 5 |
| Haiku (plain) | 1.8s, **0 tools** | 4.4s | 6.2s | $0.015 | 5 |
| Haiku + Opus adv | 2.4s, 0 tools | **62.4s** | 64.8s | **$0.337** | 6 (invalid JSON, stream-parser salvaged) |

Reconcile tools:
- Sonnet: `update_session_information_gaps`, `update_negotiation_context`
- Both Haiku variants: `[]`

**Takeaway:** Haiku-plain is fast and cheap but skipped reconcile entirely. Haiku+advisor blew up on panel.

### Turn 2 — 2026-04-17 — (vehicle added to conversation: 2022 Ford F-250)

Three-way.

| Variant | Reconcile | Panel | Total | Cost | Cards |
|---|---|---|---|---|---|
| Sonnet (prod) | 17.2s, 4 tools | 18.6s | 35.9s | $0.090 | 8 |
| Haiku (plain) | 13.8s, 2 tools | 10.5s | 24.3s | $0.032 | 8 |
| Haiku + Opus adv | 7.3s, 2 tools | **97.8s** | **105.1s** | **$0.655** | **0 (JSON parse fully failed)** |

Reconcile tools:
- Sonnet: `set_vehicle`, `update_deal_information_gaps`, `update_deal_numbers`, `update_deal_red_flags`
- Haiku (plain): `update_deal_health`, `update_negotiation_context`
- Haiku + Opus adv: `update_deal_health`, `update_scorecard`

**Takeaway:** Haiku called tools this turn but avoided structural ones (no `set_vehicle`, no `update_deal_numbers`). Haiku's panel vehicle card is missing the `candidate` role tag in its identity (`vehicle:|2022|Ford|F-250` vs prod's `vehicle:candidate|2022|Ford|F-250`) — downstream consequence of skipping `set_vehicle`. Haiku+advisor confirmed broken: 0 cards, $0.79.

### Turn 3 — 2026-04-17 — (follow-up after dropping Haiku+advisor)

Two-way (Sonnet vs Haiku-plain).

| Variant | Reconcile | Panel | Total | Cost | Cards |
|---|---|---|---|---|---|
| Sonnet (prod) | 31.9s, 2 tools | 20.9s | 52.7s | $0.112 | 9 |
| Haiku (plain) | 4.1s, **0 tools** | 10.7s | 14.8s | $0.023 | 7 |

Reconcile tools:
- Sonnet: `update_deal_information_gaps`, `update_negotiation_context`
- Haiku: `[]`

Panel diff:
- Prod-only: `checklist`, `next_best_move`, `vehicle:candidate|2022|Ford|F-250`
- Haiku-only: `vehicle:|2022|Ford|F-250`
- Intersection: 6/9

**Takeaway:** Haiku-plain reconcile regressed to zero tool calls again. Pattern across the three turns: Haiku called 0, 2, 0 reconcile tools vs Sonnet's 2, 4, 2. Haiku reconcile is **not currently trustworthy for structural state updates**. Haiku panel remains decent — 7/9 cards, most identities match.

## Open questions

- Does a directive ("you MUST call X when condition Y") reconcile prompt close Haiku's tool-call gap? Haiku 4.5 follows explicit rule checklists much better than judgment calls.
- Does enabling Haiku's extended-thinking on reconcile improve tool selection? (Haiku supports it; Opus 4.6/4.7 don't.)
- Is panel-only replacement (Sonnet reconcile → Haiku panel) meaningful? Back-of-envelope: ~19% per-turn speed win, negligible cost change — reconcile is the dominant cost in this pipeline, so swapping panel alone is unspectacular.
- Why is Sonnet reconcile slow (17–32s with only 2–4 tool calls)? Probably generating internal reasoning prose before emitting tool_use blocks. Would tightening `_FOLLOWUP_RECONCILE_SYSTEM` to forbid preamble prose recover meaningful time?

## Next steps (proposed, not committed)

1. Try the "directive checklist" reconcile prompt on Haiku. Run 5–10 varied turns (VIN entry, price negotiation, trade-in, branch-from-edit). Re-evaluate tool-call coverage.
2. Separately, tighten `_FOLLOWUP_RECONCILE_SYSTEM` for *all* variants to discourage preamble prose. This likely speeds up Sonnet reconcile too, without any model swap.
3. If step 1 closes the gap: Haiku becomes a real full-replacement candidate. If it doesn't: ship Haiku-for-panel-only and move on.

---

## Reframe — 2026-04-17 (afternoon)

**Status:** reverted all shadow/advisor code (`insights_followup_shadow.py`, `advisor_config.py`, shadow flags in `config.py`, frontend variant strips, dev toggle). Only this notes file remains. The three-turn eval did its job — it forced a harder question than "which model for reconcile" and the answer changes the plan.

### The framing we were missing

The reconcile pass re-reads the conversation to extract facts the main chat pass already knew while generating its reply. When the assistant writes "Got it — they're at $45k with a $2000 doc fee on the 2022 RAV4 (VIN 2T3...)", the model that wrote that sentence already parsed the VIN, priced the deal, and decided whether it was a red flag. The second pass is reconstructing a decision the first pass made. That's the waste — assuming the first pass reliably made the decision, which is the open question.

Important context a fresh-eyes proposal missed: **our main chat pass already has the full ~16-tool schema and a step loop that can call structural tools during the turn.** Reconcile was added *on top* of that. So the architectural question isn't "merge two passes" — structurally we already have a unified pass available. The real question is narrower:

> **Why does the main chat, given the same tools, reliably under-call them — such that we felt we needed a second pass to clean up?**

If the main pass genuinely under-attends to structure, the fix is prompt/schema-level, not architectural. If reconcile is mostly redoing work the main pass already did, the fix is to delete reconcile. We don't know which mode we're in. Everything else depends on that answer.

### Things that are clearly right regardless of the bigger decision

- **Panel-from-state is rendering, not generation.** Most cards (vehicle, numbers, red flags, briefing) are derivable from deal state without an LLM. Cards that need genuine synthesis (next-best-move phrasing, stance copy) can fire in parallel with the main reply using a cheap model and arrive late within the 5–10s panel budget.
- **Deterministic pre-extraction as hints, not decisions.** VIN regex, dollar-amount extraction with label context ("they offered", "doc fee"), and YMM NER are high-precision. Inject candidates into the primary call's context as hints; the model still decides whether they're offers, hypotheticals, or noise. Cheap accuracy win on mechanical-but-high-stakes updates.
- **Route by turn shape.** Conversational turns ("what should I ask about warranty?") don't need the full tool schema loaded and shouldn't pay the latency or tool-bias cost. A cheap classifier or keyword check (VIN? dollar amount? dealer name? situation change?) decides whether the turn is conversational or structural.

### Where the "merge the passes" proposal was too clean

The claim that "tools must be emitted after reply text, not before, or TTFB dies" isn't how Anthropic's API actually works. Content blocks arrive in whatever order the model chooses; prompting can't force ordering. What works — and what our stack already does — is stream text blocks to the client as they arrive and buffer `tool_use` blocks for post-turn processing. So TTFB isn't threatened by the merge. The bottleneck isn't streaming; it's model behavior on structural tool calls.

### The diagnostic we need next

Before any architecture change, answer: **how often does reconcile emit updates the main chat pass didn't reflect?** For each turn, compare main-chat tool calls vs. reconcile tool calls and classify reconcile's updates:

- (a) **Already emitted by main chat** → reconcile is duplicating → delete reconcile, tighten main prompt.
- (b) **Genuinely new and correct** → main pass is under-attending → fix at prompt/schema level on main chat, not architecture.
- (c) **Genuinely new but wrong/redundant** → reconcile is actively harmful.

If (a) dominates, the fix is architectural. If (b) dominates, the fix is prompt-level on the main pass. Either outcome beats the current pipeline, but only (a) is "delete reconcile."

### DEBUG logging plan

Before collecting more eval turns, instrument each stage boundary so we can see where wall-clock actually goes. The three-turn table says "reconcile: 17–32s, 2–4 tools" — that's not precise enough to fix anything. We need to know whether time is in model generation, tool execution, serialization, or waiting on cache.

**Main chat turn**
- Per step: time from step start to first text token (per-step TTFB).
- Per step: time in model call vs. time in tool execution.
- Per step: tool_use blocks emitted (names + arg sizes).
- Turn total: user message received → `done` emitted.

**Reconcile pass (follow-up job)**
- Time from job start to first model token.
- Time in model call vs. tool execution.
- Tool_use blocks emitted (names + arg sizes).
- Any preamble-text token count before first tool_use (confirms/refutes the "Sonnet emits prose before tools" hypothesis).

**Panel generation**
- Time from reconcile end to panel model call start.
- Panel model call duration.
- Time parsing/validating card JSON (and any retries on truncation).

**Cross-cutting**
- Prompt cache read/write bytes per call (already in `SessionUsageSummary` — surface per-stage in logs).
- Total turn wall-clock broken down by stage: main chat / reconcile / panel / overhead.
- All logs tagged with `request_id` + `session_id` so a single turn can be reconstructed from the NDJSON.

Goal: turn the current vague breakdown into a per-stage profile so the next eval turns tell us exactly where to cut.

### Instrumentation landed — 2026-04-17 (afternoon)

Stage-boundary timing logs are in. All prefixed `TIMING[...]` at INFO so they land in `apps/backend/logs/backend.ndjson` without changing log level. Grep the NDJSON with `jq 'select(.message | startswith("TIMING"))'` or just `grep TIMING` a slice file.

**Main chat turn** (`apps/backend/app/services/claude/chat_loop_engine.py`)
- `TIMING[chat.turn.start]` / `TIMING[chat.turn.end]` — turn wall-clock with outcome (`complete` / `ancillary_recovery` / `max_steps_recovery` / `interrupted` / `failed`).
- `TIMING[chat.step.ttfb]` — first text token latency per step.
- `TIMING[chat.step.first_tool]` — time to first `tool_use` block + preamble text char count (tests the "Sonnet emits prose before tools" hypothesis).
- `TIMING[chat.step]` — end-of-step summary: model_duration_ms, ttfb_ms, first_tool_after_ms, preamble_text_chars, text_chars, tool_use_count, tool_names, stop_reason.
- `TIMING[chat.step.tool_batch]` — per-batch tool-execution duration + tool names.
- `TIMING[chat.step.tool_exec_total]` — total tool-execution time for the step.

**Insights follow-up** (`apps/backend/app/services/insights_followup.py`)
- `TIMING[followup.start]` — job kickoff with session + assistant_message_id.
- `TIMING[followup.preamble]` — preamble load + `panel_started` emission time.
- `TIMING[followup.reconcile.start]` / `.first_event` / `.first_tool` / `.end` — reconcile model call start-to-end with first-event and first-tool latencies; `.end` also logs `tool_names`.
- `TIMING[followup.panel.start]` — panel kickoff + gap after reconcile ended.
- `TIMING[followup.panel.end]` — panel wall-clock + final card count.
- `TIMING[followup.total]` — full breakdown: total_ms / preamble_ms / reconcile_ms / panel_ms / reconcile_tools / cards.

**Panel generation** (`apps/backend/app/services/panel.py`)
- `TIMING[panel.stream.ttfb]` — Claude first-text latency per attempt.
- `TIMING[panel.stream.end]` — streaming model call duration + streamed cards + text bytes.
- `TIMING[panel.canonicalize]` — cards_in vs cards_out + canonicalization duration (confirms whether canonicalization is meaningful wall-clock — expected to be trivial).

Existing `Cache [chat_loop step=%d]` and `Cache [panel]` logs still emit per-call cache creation/read/uncached bytes. Pair those with the `TIMING[*]` entries to see cache hit vs. miss alongside duration.

**How to read a turn:** filter the NDJSON for a single `request_id` (main chat) or `session_id` (follow-up), then sort by timestamp — the TIMING lines reconstruct the full per-stage profile. The `TIMING[followup.total]` one-liner gives the at-a-glance breakdown; the per-step lines let you dig in when a specific stage blows up.

---

## Instrumented six-turn eval — 2026-04-17 (afternoon)

Ran six varied turns through the real API (buyer seed user, live mode, fresh session) with the new TIMING instrumentation. Cleared the NDJSON before running so all data below is from one session: `79515a96-c9ab-40a9-aca2-be0e5e45ea80`.

### Per-turn breakdown

| # | Turn | Main ms | Main tools | Recon ms | Recon tools | Panel ms | Followup total | End-to-end |
|---|---|---|---|---|---|---|---|---|
| 1 | vin_entry | 14.5s | 2 | 14.9s | 3 | 9.8s | 24.7s | 39.2s |
| 2 | price_nego | 14.1s | 2 | 13.4s | 2 | 15.3s | 28.7s | 42.8s |
| 3 | trade_in | **35.0s** | 7 | 10.8s | 1 | **27.2s** | 38.0s | **73.0s** |
| 4 | conversational | 12.7s | **0** | 18.1s | 2 | 24.4s | 42.5s | 55.2s |
| 5 | stance_shift | 10.3s | **0** | 19.2s | 2 | 22.9s | 42.2s | 52.5s |
| 6 | red_flag | 30.7s | 4 | 12.6s | 1 | 23.7s | 36.3s | 67.0s |

### Main-vs-reconcile overlap diagnostic

Per-turn classification against the (a)/(b)/(c) framework:

- **Turn 1 (vin_entry)** — main: `set_vehicle, update_deal_numbers`. Reconcile added: `update_checklist, update_session_information_gaps, update_negotiation_context`. **Mode b: 3 genuine adds.**
- **Turn 2 (price_nego)** — main: `update_deal_numbers, update_session_information_gaps`. Reconcile added: `update_deal_red_flags, update_scorecard`. **Mode b: 2 adds.**
- **Turn 3 (trade_in)** — main: 7 tools including `set_vehicle`. Reconcile called `set_vehicle` again. **Mode a: duplicate.**
- **Turn 4 (conversational)** — main: **0 tools**. Reconcile did: `update_checklist, update_session_information_gaps`. **Mode b: main did nothing structural.**
- **Turn 5 (stance_shift)** — main: **0 tools, missed a stance shift entirely.** Reconcile caught it: `update_deal_phase, update_negotiation_context`. **Mode b: critical miss.**
- **Turn 6 (red_flag)** — main: 4 tools. Reconcile added: `update_session_information_gaps`. **Mode b: 1 add.**

**Verdict: mostly mode (b) with one (a).** The earlier sharper framing "reconcile is waste because the first pass already knew" is refuted: the main pass systematically misses specific tool categories (`update_checklist`, `update_session_information_gaps`, `update_negotiation_context`) and whole turn types (stance/situation shifts with no vehicle or number signal). Reconcile is doing real, non-duplicative work most of the time.

### Findings that change the plan

1. **Main chat emits preamble prose before tools, not reconcile.** Earlier 2-turn sample suggested reconcile was preamble-free (confirmed here too — 0 preamble chars across all 6 reconciles). But main chat does the preamble-prose thing — main step-1 on trade_in: 1341 preamble chars before 11.2s to first tool. Main step-0 on red_flag: 1293 preamble, 9.7s to first tool. The "reasoning aloud before tool use" pattern lives on the main pass, which matters because preamble on the main pass is also the user-facing reply, so just suppressing it isn't free.
2. **Reconcile violates its "no text" rule 100% of the time.** Terminal reconcile step emitted 197, 412, 964, 1524, 1055, 782 chars of text across the six turns despite the prompt explicitly forbidding it. That's roughly 3–11s of wasted generation *per turn*; across six turns, ~18s of pure overhead.
3. **Panel is the dominant wall-clock cost on 4 of 6 turns.** 9.8–27.2s to stream 2.7k–6k chars of JSON. Canonicalization is <1ms. The entire panel cost is model generation of card JSON.
4. **Main chat on structural turns is not cheap.** Turn 3 was 35s for main alone (step 1: 26.7s to emit 5 tools serially). Turn 6 was 30.7s (step 0: 24s for 5 tools with 1293-char preamble). When main DOES call multiple tools, it pays a serial-emission cost similar to reconcile's.

### Where the wall-clock actually goes

Across all 6 turns, total seconds by stage:

- **Main chat: 117s (32%)**
- **Reconcile: 89s (24%)**
- **Panel: 123s (34%)**
- Other: ~4s

Panel alone ≈ reconcile + main-chat preamble prose combined.

### Revised priority stack (supersedes the earlier "Revised next steps")

1. **Panel → templated rendering (biggest single lever).** 123s of LLM work across 6 turns for something that's mostly derivable from deal state. Any card that's just rendering structured fields should not involve a model call. Reserve LLM synthesis for genuinely generative cards (`next_best_move`, `dealer_read`), and fire those in parallel with the main reply using a cheap model.
2. **Stop reconcile from emitting terminal text (easy win).** 18s of pointless prose across 6 turns — more than one full panel stream. Prompt clearly isn't enough; consider `stop_sequences`, a hard tool-call-only step budget, or a post-hoc drop of the terminal text.
3. **Directive checklists on main chat for the systematic misses.** The categories main reliably skips are `update_checklist`, `update_session_information_gaps`, `update_negotiation_context` — and whole stance-only turns. Close those gaps at the prompt level so reconcile can shrink to a safety net over time.
4. **Suppress preamble prose on main chat before tool emission.** 10+ seconds on structural turns. Tricky because conversational turns legitimately need prose-first; the fix has to be turn-aware. Not worth attacking until steps 1–3 land.
5. **Leave tool execution and panel canonicalization alone.** Tool exec is ~56ms across a whole turn; canonicalization is <1ms. Optimizing either is wasted effort.

### Takeaway

The eval finally has ground truth on where the time goes. The single biggest discovery is that panel is a bigger problem than reconcile. The second-biggest is that main chat is hybrid — it calls tools sometimes, misses them consistently in specific categories, and wastes ~10s of preamble prose on structural turns. Reconcile is neither pure waste nor fully load-bearing; it's a safety net covering real gaps in main chat, plus ~3s/turn of overhead from unwanted trailing prose.

---

## Panel card audit — 2026-04-17 (afternoon)

Before committing to priority 1 (panel → templated rendering), walked each of the 14 card kinds in `panel.py:GENERATE_AI_PANEL_PROMPT` against the `deal_state_to_dict` output and the tool schemas in `claude/tool_schemas.py` to verify the "mostly derivable from state" claim.

### Pure render (no LLM) — 10 kinds

| Card kind | Source data | Notes |
|---|---|---|
| **vehicle** | `vehicles[]` | All fields already stored. `risk_flags` rule-computed (e.g. high mileage per model-year age). |
| **phase** (stance strip) | `negotiation_context.stance` + `.situation` | Direct pass-through. Situation is already a one-sentence string. |
| **numbers** | `deals[].numbers` + `deals[].scorecard` | Label map (field → display name); `highlight` from scorecard thresholds. |
| **warning** | `red_flags[]` (`{id, severity, message}`) | Schema already matches. `action` field rarely used; extend red_flag schema if ever needed. |
| **checklist** (`open_questions`) | `information_gaps[]` (`{label, reason, priority}`) | Map `label` + optional `priority` (no `done`; merged into the same `checklist` card as playbook `items`). |
| **checklist** | `deal_state.checklist[]` (`{label, done}`) | Identity mapping. |
| **your_leverage** | `negotiation_context.leverage[]` (array of short strings) | Wrap strings as bullets. |
| **success** | `deals[].numbers` (MSRP − current_offer, trade-in uplift) | Compute. |
| **savings_so_far** | Same as success, cumulative | Compute. |
| **notes** | `first_offer`, `information_gaps`, `dealer_name`, pre-approval fields | Mostly pure render; verbal commitments would need a dedicated capture tool (rare, defer). |

### Needs synthesis (LLM) — 3 kinds

| Card kind | Why |
|---|---|
| **dealer_read** | Narrative read of the dealer's behavior. |
| **next_best_move** | Recommendation phrasing (bullets could template from `negotiation_context.pending_actions`; body is synthesis). |
| **if_you_say_yes** | Consequence reasoning. |

### Needs small schema addition — 1 kind

| Card kind | Addition |
|---|---|
| **what_changed** | Prior-numbers snapshot per deal per turn. Once stored, pure render. Defer to follow-up change. |

### Feasibility verdict

The "panel is mostly a rendering problem" claim **holds up**. 10 of 14 card kinds (71%) are pure render against existing deal state. The 3 that genuinely need synthesis are the most narrative-heavy — worth keeping an LLM call for, but with a drastically smaller prompt and output.

### Implementation shape (committed plan)

1. **Write a pure-render card builder** (`build_rendered_panel_cards(deal_state_dict) -> list[dict]`) producing the 10 render-able kinds. Feed through existing `canonicalize_panel_cards` + `_enforce_single_vehicle_focus_for_panel_cards` pipeline unchanged.
2. **Shrink the LLM panel call** to only generate the 3 narrative kinds (`dealer_read`, `next_best_move`, `if_you_say_yes`). Prompt drops all structured-card specs → projected 500–1000-char output instead of 3–6k.
3. **Merge** rendered + synthesized cards before canonicalization.
4. **Defer `what_changed`** — needs a small schema addition to snapshot prior deal numbers per turn. Ship as a follow-up once the main change lands.
5. **Defer parallelism** — run the narrative call inside the existing follow-up pipeline first; parallelize with main chat only after the main win is validated.

### Projected wall-clock impact (vs. 6-turn baseline)

- Current panel stream: **9.8–27.2s** (avg ~20.5s across 6 turns)
- Templated render: **~0 ms**
- Narrow synthesis call (3 cards, small prompt): projected **2–5s** (panel TTFB baseline was ~1.5s; output ~1/6 the current size)
- Projected per-turn win: **15–20s** shaved off panel stage

### Risks

- **Style drift** on structured cards. Mitigate: the render-only kinds already use structured data where phrasing is mostly labels/values.
- **Edge cases in templating** (multi-vehicle scope, dedupe, ordering). Mitigate: reuse `canonicalize_panel_cards` + `_enforce_single_vehicle_focus_for_panel_cards` unchanged; builder just produces candidates.
- **`what_changed` temporarily drops out.** Deferred. Low-risk; it's already the least common card kind.

---

## Panel templating — implementation + results — 2026-04-17 (evening)

Shipped on the same day as the audit. Same 6-turn eval script re-run against the same seed user, live mode, fresh session. Identical inputs as the prior "Instrumented six-turn eval" run above.

### What changed

- New `apps/backend/app/services/panel_card_builder.py` — `build_rendered_panel_cards(deal_state_dict)` produces the 10 render-only kinds deterministically from deal state.
- `GENERATE_AI_PANEL_PROMPT` → `GENERATE_AI_PANEL_SYNTHESIS_PROMPT` (renamed + shrunk). Prompt now describes only `dealer_read`, `next_best_move`, `if_you_say_yes`; drops the full card catalog, ordering rules, inclusion rules, and negotiation-context mapping rules. Prompt is a fraction of its prior size.
- `stream_ai_panel_cards_with_usage` builds rendered cards first (logged as `TIMING[panel.render]`), runs the synthesis LLM call with the shrunken prompt, then merges rendered + synthesized before canonicalization + single-focus enforcement. Client-visible SSE contract unchanged (`panel_started` / `panel_done` / `panel_error`).
- `deal_state_to_dict` now includes `deals[].offer_history = {first_offer, pre_fi_price}` — additive; doesn't change any tool schemas or existing prompt references.
- 18 new unit tests for the builder (`tests/test_panel_card_builder.py`). Total backend suite: 519 tests, all passing.

### Measured wins (before vs after, identical 6-turn script)

| Metric (sum across 6 turns) | Before | After | Δ | Δ% |
|---|---:|---:|---:|---:|
| **Panel LLM stream** | 123.4s | 46.5s | −76.9s | **−62%** |
| **Panel output (text chars)** | 28,534 | 8,265 | −20,269 | **−71%** |
| **Follow-up total** | 212.5s | 113.4s | −99.2s | **−47%** |
| Rendered-card build | — | ≈0ms (6 turns) | — | — |

Per-turn follow-up totals (before → after):

| # | Turn | Before | After | Δ |
|---|---|---:|---:|---:|
| 1 | vin_entry | 24.7s | **16.7s** | −32% |
| 2 | price_nego | 28.7s | **23.2s** | −19% |
| 3 | trade_in | 38.0s | **26.4s** | −30% |
| 4 | conversational | 42.5s | **10.7s** | **−75%** |
| 5 | stance_shift | 42.2s | **21.1s** | −50% |
| 6 | red_flag | 36.3s | **15.2s** | −58% |

### What the LLM emits now

Synthesis call produced 2–3 cards per turn across the six — always the three intended kinds, never a duplicate of a rendered kind. Rendered-card counts per turn: 4, 10, 11, 11, 11, 11 (turn 1 has minimal deal state). Canonicalize + per-kind caps trim to 6–10 final cards, matching the pre-change distribution.

### Quality spot-check (turn 6 — red_flag)

Final panel had all eight kinds expected for an active-negotiation turn with a red flag surfacing:

- `[RENDER] phase` — "Dealer misrepresented accident history — CARFAX shows 2023 rear-end collision..."
- `[RENDER] warning` (critical) — "$1,995 'dealer prep' fee is a fabricated charge..."
- `[SYNTH] if_you_say_yes` (critical) — "Agreeing now means accepting a $62,500 price on an accident-damaged truck..."
- `[RENDER] numbers` (high) — 3 rows with price/financing highlights
- `[SYNTH] dealer_read` — "This dealer has shown a pattern of deception — verbally denying a documented accident..."
- `[SYNTH] next_best_move` (high) — "Walk out — but before you leave, say: \"The CARFAX shows a rear-end collision in 2023...\""
- `[RENDER] your_leverage` — "Dealer verbally misrepresented accident history — strong walkaway justification"
- `[RENDER] vehicle` — 2023 Ford F-250 Super Duty, VIN first 10 chars shown
- `[RENDER] checklist` — `open_questions` and/or `items` as applicable
- `[RENDER] checklist` — 6 items

Quality parity with prior LLM-only output on every render-able kind; synthesis kinds retain their narrative punch.

### Bugs caught during the spot-check

- **Notes card was rendering information_gaps as if they were known facts.** Gap labels like "Year, trim & engine" appeared in the notes card on a turn with no structured deal data — but gaps are unknowns, not durable facts. Fixed: notes card now holds only dealer identity and offer-history facts (first_offer / pre_fi_price). Unknowns surface under the merged `checklist` card as `open_questions`. Test added.

### What stays deferred

- `what_changed` card — needs a prior-numbers snapshot in `DealState` to compute deltas. Ship as a small follow-up change.
- Parallelizing synthesis with the main chat call — the current change runs synthesis inside the follow-up pipeline (same as before). The main wall-clock win from parallelism is on top of this change; next priority.
- Swapping the synthesis model to Haiku — the prompt is now small enough that a Haiku eval is worth running. Current run still uses Sonnet to control for quality against the before baseline.

### Takeaway

Priority 1 from the post-eval plan landed and delivered on the projection. The follow-up pipeline is now **47% faster** end-to-end on identical inputs, with **no quality regression observed** on the six-turn spot check. The panel LLM call now does 71% less work — which is the actual mechanism. Rendered-card build is free.

Remaining priorities from the earlier plan still stand:
- Stop reconcile from emitting terminal text (priority 2 — unchanged).
- Directive checklists on main chat for systematic misses (priority 3 — unchanged).
- `what_changed` render + parallelize synthesis + Haiku swap eval as follow-ups.

---

## Reconcile removal + complete-reply-first — 2026-04-19

Shipped two connected changes that collapse the pipeline from three LLM calls per turn to one LLM call plus one narrow synthesis call. Reconcile is removed entirely (not just flag-gated).

### What changed

**1. Reconcile removed.** The reconcile pass is gone. Main chat is the sole source of structured state updates. Removal driven by evaluation: a reconcile-off experiment showed the follow-up pipeline runs in ~8s (vs ~19s with reconcile), and prompt tightening on main chat closed the structural-coverage gap that reconcile was compensating for.

Before:
```
user message → main chat (reply + some tools)
             → reconcile pass (audit + cleanup tools)
             → panel synthesis + render
```

After:
```
user message → main chat (reply + all structural tools)
             → panel synthesis + render
```

**2. Main-chat prompt tightened to cover the reconcile gap.** Three additions to `SYSTEM_PROMPT_STATIC`:

- **PER-TURN STRUCTURED STATE CHECK** — explicit directive to call `update_negotiation_context`, `update_checklist`, and `update_deal_phase` on every turn where the buyer narrated a moment of the negotiation, even when no hard fact (price, VIN, mileage) changed. The beat itself is the update.
- **VIN-MUST rule** — when the user provides a VIN, main chat MUST call `set_vehicle` in the same turn (previously optional).
- Tool descriptions for `update_negotiation_context` and `update_checklist` tightened to say "call on beat moves" in the tool spec itself.

**3. Complete-reply-first + step-loop short-circuit.** Tools are fire-and-forget; their results aren't surfaced back to the model. So the model is now instructed to write its entire user-facing reply BEFORE emitting tool_use blocks, and the step loop treats the turn as complete when step 0 has substantive pre-tool text AND tools. No continuation (step 1) runs.

- Prompt: replaced the "CHAT-FIRST" + "Multi-step (text → tools → more text)" guidance with "COMPLETE-REPLY-FIRST" — write the full reply, then tools at the end.
- Step loop (`chat_loop_engine.run_chat_loop_engine`): after tool execution, if `step_text >= 150 chars` with no tool errors, emit `done` and return. New TIMING outcome `reply_with_tools` for log visibility.

### Measured results (six-turn eval, identical script)

**Main-chat turn shape:** all 6 turns ran in **1 step, outcome=`reply_with_tools`**. Previously averaged ~2 steps per structural turn.

| # | Turn | Main ms | Steps | Pre-tool text | Tools | Follow-up | Total |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 | vin_entry | 6.6s | 1 | 645 chars | 2 | 6.8s | **13.6s** |
| 2 | price_nego | 10.2s | 1 | 1134 chars | 2 | 7.1s | **17.3s** |
| 3 | trade_in | 11.1s | 1 | 1159 chars | 1 | 7.4s | **18.5s** |
| 4 | conversational | 31.6s | 1 | 1621 chars | 7 | 12.1s | 43.7s |
| 5 | stance_shift | 18.2s | 1 | 1298 chars | 2 | 8.2s | 26.4s |
| 6 | red_flag | 22.8s | 1 | 1382 chars | 4 | 11.4s | 34.2s |

**End-to-end wins vs original reconcile-on baseline (same 6 turns):**

| Metric | Reconcile on | Reconcile off + CRF | Δ |
|---|---:|---:|---:|
| Main chat avg | 19.5s | **16.8s** | −14% |
| Reconcile avg | 11.1s | **0s** (deleted) | −100% |
| Panel stream avg | 7.7s | 8.8s | ~same |
| Follow-up total avg | 18.9s | **8.9s** | **−53%** |
| End-to-end (main + FU) avg | 38.4s | **25.7s** | **−33%** |
| Steps per turn avg | 2.0 | **1.0** | one-shot turns |

### UX shape change

The mid-stream pause is gone. Before: reply text started streaming, cut off mid-thought for 5–10s while tool_use blocks serialized, then resumed with a continuation. After: reply streams to completion uninterrupted, then a post-reply pause while tool_use blocks serialize (invisible — feels like the reply finished and the panel is catching up), then `done` fires and the panel updates.

The "pause" moved from mid-stream (reads as a stall) to after the reply (reads as natural post-processing).

### What was deleted

- `CLAUDE_RECONCILE_ENABLED` setting (`app/core/config.py`).
- `CLAUDE_RECONCILE_ENABLED=false` env override (`docker-compose.yml`).
- The reconcile block inside `stream_linked_insights_followup` (`insights_followup.py`) along with its local helpers: `_FOLLOWUP_RECONCILE_TRIGGER`, `_FOLLOWUP_RECONCILE_SYSTEM`, `_build_followup_reconcile_messages`, and the associated TIMING logs and job-state transitions.
- Unused imports that were only reconcile-related (`stream_chat_loop`, `build_messages`, `build_system_prompt`, `get_buyer_chat_tools`, `ChatLoopResult`, `TurnContext` in that file).
- Tests that asserted reconcile-before-panel behavior.

`InsightsFollowupJob.reconcile_status` column is retained (to avoid a migration) and always set to `SKIPPED` at job creation. Can be removed in a follow-up migration if we want to clean up the schema.

### Remaining follow-ups

- `what_changed` card — still needs a prior-numbers snapshot on `DealState`.
- Haiku swap eval for the now-small synthesis call.
- Parallelize synthesis with main chat (would save the sequential 8s panel stage).
- VIN-only vehicle card: the rendered builder currently requires make/model, so the panel is thin on a VIN-only first turn — needs a small fallback that renders a vehicle card from the VIN alone.





### Revised next steps (supersedes the "Next steps" list above)

1. **Add stage-boundary DEBUG logs** as specified above. No architectural change yet. No model swap yet.
2. **Collect ~10 varied eval turns** with the instrumented pipeline: VIN entry, price negotiation, trade-in, conversational-only (no structural signal), branch-from-edit, stance-change only, red-flag surface. Mix of turn shapes is the point.
3. **Run the main-vs-reconcile overlap diagnostic** on the collected turns. Classify each reconcile update as (a) / (b) / (c) per above.
4. **Branch on the (a)/(b)/(c) split:**
   - (a) dominates → delete reconcile, tighten main-chat system prompt for structural attention, re-eval.
   - (b) dominates → fix main chat at prompt/schema level (directive checklists for high-stakes tools, maybe tool_choice forcing on detected signals), keep reconcile as a shrinking safety net.
   - (c) appears at all → reconcile is emitting wrong updates; fix its tool selection before doing anything else.
5. **Independent, ship anytime:** move panel rendering to deterministic state → cards templating where possible; keep LLM generation only for genuinely synthesized fields.
6. **Independent, ship anytime:** add the deterministic pre-extraction hints layer for the main chat call (VIN, dollar amounts with label context, YMM).

Steps 5 and 6 are safe wins regardless of how the diagnostic lands. Step 1 blocks 2–4.

---

## Prompt simplification pass — 2026-04-20

After the reconcile-off + complete-reply-first + custom_numbers feature + tool-emission investigation, the system prompt had accreted heavily. A series of defensive additions over a day's iteration left us with ~33KB of prompt text with duplicated rules, dead reconcile-era recovery code, and a heavy reliance on CAPS/MUST emphasis. On cold-start "kitchen sink" turns Sonnet 4.6 was emitting only 1 tool; Opus 4.7 handled those turns cleanly. The user rejected using Opus — the framing was "lesser-model-first" (like mobile-first development): if Sonnet can't do it, our prompt architecture isn't optimized. Opus would paper over the problem rather than fix it.

This pass was the response: a research-guided simplification aiming to cut noise, move triggers into tool descriptions, and match established best practices.

### Research that shaped the approach

Two authoritative sources reshaped the plan away from "add more rules":

1. **Anthropic's official guidance** ([best-practices doc](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering/claude-prompting-best-practices), [implement-tool-use](https://platform.claude.com/docs/en/docs/build-with-claude/tool-use/implement-tool-use)):
   - Tool descriptions are "by far the most important factor in tool performance" — 3–4+ sentences minimum, each carrying explicit when-to-call triggers.
   - **Contradiction to common wisdom:** aggressive "CRITICAL / MUST / NEVER" language on Claude 4.5+/4.6/4.7 causes *overtriggering*. The exact guidance: *"If your prompts were designed to reduce undertriggering on tools or skills, these models may now overtrigger. The fix is to dial back any aggressive language."* Our recent prompt additions had gone the opposite direction.
   - Use 3–5 positive examples in `<example>` XML tags instead of paragraphs of negative rules.
   - Order: role → static framing → tool-use policy → behavioral rules → examples.
   - Anthropic publishes a canonical parallel-tool-calls block worth using verbatim.

2. **Reference architecture** (`reference-ai-harness` — Claude Code itself):
   - Tool descriptions are 200–400 words with explicit "when to use" sections.
   - System prompt is lean and role-focused.
   - No separate "continuation after tools" prompts; flat architecture, one prompt doing the job.
   - Parallel-tool-calls block used verbatim from Anthropic.

### What shipped

**File changes:**
- `prompt_static.py`: **32,903 → 19,773 chars (−40%)**. Role-first, three `<example>` blocks (cold-start structural, stance-shift, conversational), Anthropic's canonical parallel-tool-calls phrasing verbatim, CAPS/MUST emphasis stripped throughout. Deleted the dead reconcile-era recovery prompts: `DASHBOARD_RECONCILE_AFTER_ASSESSMENT_TOOLS`, `POST_EXTRACTION_ASSESSMENT_NUDGE`, `STEP_AFTER_TOOL_ONLY_NUDGE`.
- `tool_schemas.py`: 12 previously-weak tool descriptions rewritten to carry explicit when-to-call triggers. Neutral phrasing ("Call when…"), not imperatives. Kept the three tools whose descriptions were already strong (`update_negotiation_context`, `update_checklist`, `update_deal_custom_numbers`).
- `tool_policy.py`: simplified from ~80 lines of conditional injection flags to ~15 lines: step 0 = `auto`, step ≥ 1 = `none`. Removed `inject_dashboard_reconcile_nudge` and `inject_post_extraction_assessment_nudge`.
- `chat_loop_engine.py`: dropped three dead injection branches from `_build_step_prompt_config` and the corresponding imports.
- `tests/test_ai_pipeline.py`: 11 obsolete tool-policy tests replaced with 2 matching the simplified policy.
- Snapshot regenerated.

**Test suite:** 519 passing (was 527 — dropped 8 tests that exercised retired tool-policy branches).

### Before/after (same 6-turn eval script, identical inputs)

| # | Turn | Prior eval tools applied | Post-simplification tools applied | Delta |
|---|---|---:|---|---|
| 1 | vin_entry | 4 (set_veh, neg_ctx, checklist, info_gaps) | 2 (set_veh, sess_gaps) | conservative |
| 2 | price_nego | 2 (numbers, custom) | **8** (numbers, custom, red_flags, health, scorecard, neg_ctx, checklist, sess_gaps) | **+6** |
| 3 | trade_in | 1 (set_veh) | 2 (set_veh, sess_gaps) | +1 |
| 4 | conversational | 8 (over-called) | **0** (correct — no structural content) | **calibrated** |
| 5 | stance_shift | 3 (neg_ctx, checklist, phase) | 4 (health, neg_ctx, checklist, phase) | +1 |
| 6 | red_flag | 5 (red_flags, health, scorecard, neg_ctx, checklist) | 5 (same shape) | stable |

**Aggregate:**
- Main chat avg: **18.8s** (was 22.5s pre-simplification).
- Follow-up avg: 8.9s (unchanged).
- Steps per turn: **1.0** (complete-reply-first holds).
- Outcomes: 5× `reply_with_tools`, 1× `complete` (turn 4 had no tool calls — natural exit).

### What changed in model behavior

**Both directions improved (calibration, not just volume):**

- **Turn 2 (fees-heavy) went from 2 tools to 8 tools.** The dial-back on CAPS/MUST + tighter tool descriptions nailed this. Full structural coverage including the critical dealer-prep red flag.
- **Turn 4 (conversational) went from 8 tools to 0.** The model correctly recognized no structural change and emitted no tools. The prior prompt's aggressive language had been driving over-emission on pure-conversation turns.
- **Cold-start structural turns (1, 3) stayed conservative** — 2 tools each. The "1-tool-on-cold-start" Sonnet pattern is model-level, not prompt-level; this pass didn't close it and didn't make it worse.

### What the research corroborated empirically

- Anthropic's guidance that aggressive "MUST" language causes overtriggering on Claude 4.5+ models was directly observable: removing it dropped over-emission on conversational turns to zero.
- Tool descriptions carrying the when-to-call load (not the system prompt) was the load-bearing lever: Turn 2's jump from 2 → 8 tools happened because `update_deal_custom_numbers`, `update_deal_red_flags`, `update_deal_health`, etc. each now tell the model when to fire, rather than competing with rules in the system prompt.
- The reference-ai-harness pattern of flat architecture + role-first prompt + concrete examples is a working model, not aspirational; we adopted the same shape and saw calibration improve.

### Known remaining limitations

- Cold-start kitchen-sink turns (user dumps vehicle + prices + fees in a single turn-1 message with no warm deal state) still emit only 1–2 tools. This is a Sonnet-level conservatism the simplification did not fully resolve. Real-world users typically go through the VIN intercept flow on the frontend and don't hit this directly; the eval script bypasses the intercept to simulate the worst case.
- Tool consolidation (deferred Step 5 from the plan) not attempted. Candidates for future work: fold `update_deal_red_flags` + `update_session_red_flags` into a single `update_red_flags(scope)`, and `update_scorecard` + `update_deal_health` into `assess_deal(...)`.

### Takeaway

The lesser-model-first discipline worked. A 40% leaner prompt with neutral tone, concrete examples, and load-bearing tool descriptions outperformed the rule-heavy version across the eval: same or better tool emission on every turn where structural updates mattered, zero over-emission on conversational turns, no regressions in latency or reliability. The main lesson was that our direction over the past day had been actively counterproductive — adding aggressive rules to fix specific misses triggered Anthropic's documented overtriggering behavior on Claude 4.5+/4.6+, creating the erratic pattern we were trying to fix.
