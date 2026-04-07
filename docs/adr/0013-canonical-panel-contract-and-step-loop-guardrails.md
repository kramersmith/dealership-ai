# ADR-0013: Canonical Panel Contract and Step-Loop Guardrails

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Kramer Smith

## Context

ADR-0005 established the turn/step chat loop, ADR-0007 established AI-generated panel cards, and ADR-0012 established the two-phase SSE contract for chat-first panel streaming.

After those decisions shipped, the implementation evolved in ways that materially changed the operational contract:

1. The original panel-card contract in ADR-0007 described a model-selected `type` with freeform titles and frontend rendering directly on that `type`. That was sufficient for the first panel launch, but it proved too loose for a state-first panel that must behave like durable buyer working memory rather than a recap of the latest answer.
2. The step loop in ADR-0005 allowed multi-step continuation, but later optimizations showed that generic early-exit heuristics can easily undermine the reason the loop exists. A broad "finish after any successful text + tools step" optimization caused real structural turns to terminate after `set_vehicle`, before price extraction, assessment updates, or gap updates could happen.
3. Prompt-state hygiene became more important as the system accumulated richer structured state. Persisted `ai_panel_cards` are derivative UI output, not source-of-truth business state. When serialized back into model context, they can contradict the underlying deal state and create stale or circular reasoning.
4. After tool execution, the model's next step must see the newly committed state, not the synthetic context block from the start of the turn. Otherwise the model reasons from stale prompt state even though the database has already been updated.

These issues created a real regression risk: future contributors could read the older ADRs and "restore" behavior that is now known to be incorrect.

## Decision

Adopt a stricter state-first contract for panel generation and a narrower set of allowed step-loop recovery heuristics.

### 1. Canonical panel card contract

The model no longer owns the final panel-card identity contract.

Instead, the backend now treats model panel output as an intermediate suggestion that must be normalized into an authoritative card schema:

- `kind` — exact product-facing card identity
- `template` — frontend render container
- `title` — canonical backend-assigned title
- `content` — validated, kind-specific payload
- `priority` — rendering emphasis

The backend owns canonicalization, validation, deduplication, ordering, and final card capping. The frontend renders the canonical contract, not the model's raw output.

This supersedes the payload-contract portion of ADR-0007. ADR-0007 remains correct about using a separate post-chat panel generation phase, but it no longer describes the authoritative card schema.

### 2. Panel cards are derived state, not prompt state

`ai_panel_cards` must be excluded from both chat-loop context serialization and panel-generation prompt state.

The source of truth for model reasoning is:

- structured deal state
- negotiation context
- recent conversation context
- latest assistant text as fallback only for panel generation

Persisted panel cards are derivative UI output. They may be useful for rendering and quoted follow-ups, but they must not be treated as canonical conversational state for future model calls.

### 3. Synthetic turn context must refresh after committed tool batches

The synthetic `<system-reminder>` context block injected into the current turn is allowed, but it must be rebuilt from freshly persisted deal state after each committed tool batch.

This preserves one of the key benefits of the step loop: later steps reason over the state that earlier steps actually committed.

### 4. Step-loop recovery heuristics must be narrow and non-destructive

The step loop must continue after successful structural or state-mutating tool steps unless the model has genuinely completed the turn.

Allowed recovery heuristics are intentionally narrow:

- ancillary tool-only follow-up passes may be short-circuited into a forced text-only recovery when the remaining tool work is limited to non-critical UI helpers such as `update_quick_actions`
- max-step exhaustion may attempt one final tools-disabled recovery answer before falling back to partial text

Disallowed heuristic:

- do not terminate the loop merely because a step streamed text and successfully executed tools

The reason is architectural, not cosmetic: structural extraction turns often require one step to create or select the right entities and another step to persist dependent numbers, scores, warnings, or gaps.

## Alternatives Considered

### Option A: Keep the ADR-0007 freeform panel contract
- Pros: Simple model-to-frontend pipeline. Lower backend normalization complexity.
- Cons: Weak contract boundaries. Freeform titles and type selection make it easy for the panel to drift away from product-defined card identity, duplicate cards, or regress when prompts change. Frontend behavior becomes more tightly coupled to prompt wording.

### Option B: Treat persisted panel cards as valid prompt context
- Pros: Gives the model visibility into what the user currently sees in the panel.
- Cons: Re-injects derivative UI output as if it were source-of-truth state. Encourages stale or circular reasoning and lets outdated card text contradict structured deal data.

### Option C: Aggressively optimize the step loop to finish after any successful text + tools step
- Pros: Fewer model calls on some turns. Lower cost and latency in the happy path.
- Cons: Breaks the core reason for adopting the step loop in ADR-0005. Structural and dependent updates often need another step. Real regressions showed this can terminate the turn after `set_vehicle` while skipping numbers, assessment, and gap updates.

### Option D: Canonical backend panel contract plus narrow recovery heuristics (chosen)
- Pros: Keeps panel behavior aligned with product intent, protects frontend rendering from prompt drift, preserves multi-step extraction correctness, and still allows targeted latency improvements for ancillary follow-up passes.
- Cons: More backend logic. The older ADR record becomes incomplete unless explicitly superseded.

## Consequences

- **Positive:** The Insights Panel is anchored to structured state and product-defined card identities rather than prompt-era freeform output.
- **Positive:** Backend canonicalization makes panel behavior more stable across prompt changes and model variance.
- **Positive:** Excluding `ai_panel_cards` from prompt state reduces stale-context and self-contradiction failures.
- **Positive:** Refreshing the synthetic context block after tool commits preserves the integrity of the multi-step loop from ADR-0005.
- **Positive:** Narrow recovery heuristics retain the latency benefits of quick text recovery without sacrificing structural extraction correctness.
- **Negative:** The backend now owns more of the panel contract and step-loop safety logic, which increases implementation complexity.
- **Negative:** ADR-0007 and ADR-0005 are no longer sufficient on their own to understand the current implementation; they must be read together with this ADR.
- **Neutral:** The frontend may still accept legacy panel payloads during transition, but the authoritative persisted and streamed contract is canonical `kind/template/title/content/priority`.

## References

- [ADR-0005: Turn/step chat loop](0005-turn-step-chat-loop.md)
- [ADR-0007: AI-generated panel cards](0007-ai-generated-panel-cards.md)
- [ADR-0012: Two-phase chat/panel SSE contract](0012-two-phase-chat-panel-sse-contract.md)
- [Panel card canonicalization service](../../apps/backend/app/services/panel_cards.py)
- [Chat loop prompt-state handling](../../apps/backend/app/services/claude/chat_loop.py) (context: [`context_message.py`](../../apps/backend/app/services/claude/context_message.py), [`prompt_deal_state.py`](../../apps/backend/app/services/claude/prompt_deal_state.py))
- [Panel generation service](../../apps/backend/app/services/panel.py)
- [Typed panel-card schema](../../apps/backend/app/schemas/panel_cards.py)
- [Insights Panel card contract docs](../insights-panel-cards.md)