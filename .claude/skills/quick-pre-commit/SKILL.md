---
name: quick-pre-commit
description: Fast, token-efficient pre-commit workflow. Consolidates reviews into fewer parallel agents, skips redundant re-reviews, and scopes doc updates. Use when the user says "quick pre-commit", "qpc", "fast pre-commit", or wants a lightweight pre-commit check.
---

# Quick Pre-Commit

A streamlined pre-commit workflow optimized for speed and token efficiency. Same quality bar as the full workflow, fewer round-trips.

**Core principles:**
- **Consolidate reviews** — related checks run in the same subagent, not 11 separate ones.
- **Gather context once** — the parent runs `git diff` and `git status` once and passes output to all subagents.
- **No redundant re-reviews** — Stage 1 reviews thoroughly once. No Gate 3 "final sweep."
- **Scoped doc updates** — only read/update docs affected by the diff.
- **Each subagent uses `subagent_type: "general-purpose"`.**

**Communication:** Announce each stage. Summarize Stage 1 results before proceeding to Stage 2.

---

## Before Starting

Gather this context **once** in the parent — do NOT have subagents re-gather it:

1. `git diff` (staged + unstaged)
2. `git status`
3. List of changed files with their paths
4. User's original request or plan context (from conversation)
5. Plan path(s) if found in `docs/plans/`

Pass all of this as context to every Stage 1 subagent.

---

## Stage 1: Parallel Review (4 agents, NO TESTS)

Launch ALL four subagents in a **single message**. Each reviews code and makes fixes but **must NOT run any test commands**.

Include in every subagent prompt:
- The git diff and status output gathered above
- The changed file list
- Workspace path
- User request/plan context
- "Return a summary: PASS or FAIL, any violations found, any fixes made."

---

### Agent A: Logic & Safety

**Covers:** Correctness, Error Handling, Security

- Logic correct for all inputs; edge cases (empty, boundary, invalid) handled
- No null/undefined access without guards; no race conditions or off-by-one errors
- Errors caught and handled — no silent failures; helpful user messages where applicable
- No SQL injection (parameterized queries), no XSS (escaped output), no auth bypass
- Sensitive data not logged or exposed in responses

List violations with `file:line`. Fix them. **Loop until clean.**

---

### Agent B: Structure & Style

**Covers:** Code Quality, DRY, Variable Names, Enums

- No duplicated logic; extract shared behavior
- Clear structure; single responsibility; no unnecessary coupling
- No magic numbers — named constants where appropriate
- Enums created when they should be; existing Enums used (no string literals); no orphaned Enums
- No single-letter names (except loop indices) or cryptic abbreviations; names convey intent

List violations with `file:line`. Fix them. **Loop until clean.**

---

### Agent C: Frontend Quality

**Covers:** UI Design Principles, Theme Compliance

**Only runs if the diff includes frontend files (`apps/mobile/`).** If no frontend changes, skip this agent entirely.

Read `docs/ui-design-principles.md`, `apps/mobile/lib/theme/tokens.ts`, and `apps/mobile/lib/theme/themes.ts`. Then verify:

- Mobile-first; touch targets >=44px; no hover-only actions
- Cognitive load minimized; clear hierarchy
- Micro-interactions appropriate and subtle
- No imports from `@/lib/colors`; no `SCORE_COLORS`
- Tamagui props use `$token` references — not raw hex
- `palette.*` only in non-Tamagui contexts (StyleSheet, RN Animated, RN Modal)
- Semantic surfaces use sub-themes (`<Theme name="danger">` etc.)
- No hardcoded hex (except `#ffffff`/`white` for text on brand backgrounds, `rgba()` for overlays)
- `useTheme()` only when feeding values to non-Tamagui elements

List violations with `file:line`. Fix them. **Loop until clean.**

---

### Agent D: Architecture & Coverage

**Covers:** Plan Compliance, First-Version Quality, Tests Exist, Logging, ADR Check

- Check `docs/plans/` for a matching plan. Compare changes against plan or user request — identify gaps.
- Read `docs/first-version-quality.md` — no quick fixes, no patches, clean architecture, no tech debt
- Every new/changed behavior has corresponding tests; tests assert real behavior (DO NOT RUN tests)
- Read `docs/logging-guidelines.md` — correct log levels, `logger.exception()` in except blocks, PII safe, `logging.getLogger(__name__)`, format args not f-strings
- **ADR check:** Read `docs/adr/README.md` for existing ADRs. Evaluate whether the changes introduce a significant architectural decision (new integration patterns, data model changes, major refactors, new resilience strategies, new external APIs, new communication patterns). If so, write an ADR using `docs/adr/0000-template.md` and update the README index.

Write missing tests. List violations with `file:line`. Fix them. **Loop until clean.**

---

## Stage 2: Sequential Gates (after Stage 1 completes)

Run **one at a time, in order**. Each must pass before the next starts.

---

### Gate 1: Static Checks

- Run **`make check-static`** (lint + format + isort + typecheck).
- If frontend files changed: also run `cd apps/mobile && npx tsc --noEmit`.
- Fix violations. **Loop until all pass.**

---

### Gate 2: Tests

- Run `make test-backend`.
- Fix failures. **Loop until all pass.**

---

### Gate 3: Update Docs (scoped)

Review the diff and the list below. Only read and update docs that are **actually affected** by the changes. Always consider every doc — but don't load ones that clearly aren't relevant.

**Full doc list to consider:**
`docs/TRD.md`, `docs/PRD.md`, `docs/business-rules.md`, `docs/backend-endpoints.md`, `docs/diagrams/site-map-and-flows.md`, `docs/architecture.md`, `docs/buyer-chat-turn.md`, `docs/development.md`, `docs/operational-guidelines.md`, `docs/logging-guidelines.md`, `docs/logging-harness.md`, `docs/ui-design-principles.md`, `docs/backend-plan.md`, `docs/notes.md`, `CLAUDE.md`, `docs/adr/README.md`

**Quick relevance guide:**
| Change type | Likely affected docs |
|-------------|---------------------|
| New/changed endpoints | backend-endpoints.md, TRD §5, architecture.md |
| New/changed models | TRD §7, architecture.md |
| Business rule changes | business-rules.md, TRD §6 |
| New screens/routes | PRD §4, site-map-and-flows.md |
| Auth/role changes | TRD §3-4, business-rules.md §6 |
| Env vars / setup | development.md, operational-guidelines.md |
| Claude API / tool changes | business-rules.md §4/§7, architecture.md |
| Buyer chat SSE, turn/step, panel timing, client flush | buyer-chat-turn.md, architecture.md |
| `chat_turn_summary` / NDJSON harness | logging-harness.md, logging-guidelines.md |
| UI pattern changes | ui-design-principles.md |
| Logging changes | logging-guidelines.md |
| New Makefile targets | development.md, CLAUDE.md |
| Major architectural decisions | Add ADR in `docs/adr/` |

Update "Last updated" and TOCs where edited. Summarize what was changed.

---

### Gate 4: Commit Message

1. Run `git diff` to see all changes since last commit.
2. Generate a conventional commit message (`feat`/`fix`/`chore`/etc.) that is descriptive.
3. No double quotes in the message.

**Output:** The commit message, ready to use.

---

## Checklist

```
Quick Pre-Commit:

Stage 1 — Parallel Review (no tests):
- [ ] Agent A: Logic & Safety (correctness, errors, security)
- [ ] Agent B: Structure & Style (quality, DRY, names, enums)
- [ ] Agent C: Frontend Quality (UI principles, theme) [skip if no frontend changes]
- [ ] Agent D: Architecture & Coverage (plan, first-version quality, tests, logging, ADR check)

Stage 2 — Sequential Gates:
- [ ] Gate 1: Static checks (make check-static + tsc)
- [ ] Gate 2: Tests (make test-backend)
- [ ] Gate 3: Update docs (scoped)
- [ ] Gate 4: Commit message
```
