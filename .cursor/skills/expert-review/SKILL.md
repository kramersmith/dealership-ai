---
name: expert-review
description: >-
  Multi-perspective expert review (default lenses: business, UI/UX, AI) with optional
  deliberation rounds and one consolidated plan. Use when the user says expert review,
  multi-agent review, business or UX or AI review, or asks for several reviewers to
  converge. Parent agent orchestrates Task subagents; subagents do not share a live
  message bus—use the relay pattern below to approximate dialogue.
---

# Expert review

## Goal

Review whatever the user names (code, design, doc, plan, ADR, PR scope, etc.) from **multiple expert angles**, optionally **deliberate** toward agreement, then present **one clear plan** to the user.

## Reality check (Cursor)

- **Task** subagents return to the **parent** chat only; they cannot DM each other.
- To simulate **experts talking to each other**, the parent must **pass prior rounds’ outputs** into the next prompt (relay / debate), or run a **merge** step that explicitly resolves conflicts.

Do not claim subagents chatted privately; describe the process accurately (e.g. “after each expert saw the others’ summaries…”).

## Default reviewer set (when user does not name people)

Use **three** subagents (or one Task with three forced sections if subagents are overkill):

| Role | Focus |
|------|--------|
| **Business** | Value, positioning, scope, stakeholders, risk/reward, GTM or ops impact, “should we ship this?” |
| **UI/UX** | Flows, clarity, accessibility, visual hierarchy, copy, consistency with patterns, friction |
| **AI** | Model/tool use, prompts, evals, safety, latency/cost, failure modes, data grounding, maintainability of AI surfaces |

If the user names **different** experts or adds a fourth angle, replace or extend the defaults accordingly.

## Workflow

### 1. Lock the artifact

From the user message, extract:

- **Subject**: what is being reviewed (paths, decision, question).
- **Constraints**: deadline, non-goals, “must not break X”.
- **Decision style**: recommendation only vs. pick one option vs. ship/no-ship.

If the subject is ambiguous, ask **one** short clarifying question, then proceed.

### 2. Round A — Independent reviews

For **each** expert (parallel **Task** calls when possible):

- Same brief: subject + constraints + links/snippets (or “read these paths”).
- Ask each for: **findings** (ordered by severity), **assumptions**, **questions**, **non-goals they’d protect**.

### 3. Round B — Deliberation (optional but recommended for “talk to each other”)

Choose **one** pattern:

**Relay (sequential)** — Expert 2’s prompt includes Expert 1’s summary; Expert 3’s includes 1+2. Last expert proposes **integration**.

**Rebuttal (parallel)** — After Round A, run one Task per expert with: *“Others claimed: [bulleted summaries]. Where do you agree, disagree, or refine? What single change to the emerging plan do you insist on?”*

**Facilitator (single Task)** — One subagent receives all Round A reports and produces: *areas of agreement*, *conflicts*, *resolved recommendation* with rationale.

Use **Relay** or **Rebuttal** when the user asked for dialogue; use **Facilitator** when speed matters.

### 4. Consolidate in main chat

Parent agent (you) produces the **user-facing plan** without dumping raw logs:

- Acknowledge tradeoffs explicitly.
- Prefer **numbered next steps** with owners or system areas (`backend`, `mobile`, `docs`).
- Call out **open questions** the user must answer.

## Output template (present this to the user)

Use this structure in the final message:

```markdown
## Expert review — [short subject]

### Context (1–2 lines)
What was reviewed and under which constraints.

### Consensus
- …

### Tensions / disagreements (if any)
- Expert A vs B: … → **Resolution for the plan**: …

### Recommended plan
1. …
2. …
3. …

### Risks if we do nothing
- …

### Open questions for you
- …
```

## Efficiency

- Prefer **parallel** Round A; keep each Task prompt **tight** (paths + question, not whole repo unless needed).
- If the subject is a **single small file**, one thorough pass may suffice—skip Round B unless the user wants debate.
- Cap deliberation: **one** relay or **one** rebuttal round unless the user asks for more.

## Triggers

- Phrases: **expert review**, **multi-agent review**, **get several opinions**, **red team**, **architecture review**, **deliberate**, **reviewers should talk it through**.
- User @-mentions multiple roles or teammates as reviewers.

## Anti-patterns

- Spawning subagents without a shared brief (they will duplicate or drift).
- Presenting three unrelated walls of text with no merged plan.
- Promising real-time peer-to-peer chat between subagents.
