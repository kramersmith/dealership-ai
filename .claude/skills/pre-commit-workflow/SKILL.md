---
name: pre-commit-workflow
description: Orchestrates the full pre-commit checklist—parallel review phases, then sequential gates (tests, linters, docs, commit message). Use when the user says "pre-commit", "ready to commit", "run pre-commit", "pre-commit workflow", "before committing", or wants to finalize changes for commit.
---

# Pre-Commit Workflow

Orchestrates a phased workflow before committing. **This is the final check. No shortcuts.**

**Core principles:**
- **Do not skip checks.** Every check must pass before committing.
- **No quick verifications.** Every check requires full execution. Never say "looks fine", "no major issues", or "passing" without actually performing the work. Read the referenced docs/files, run the checks, inspect changed code.
- **Maximize parallelism.** Launch all independent review checks as parallel subagents in Stage 1. Only Stage 2+ runs sequentially after Stage 1 completes.
- **No tests until Stage 2.** Review subagents in Stage 1 must NOT run any test commands. They review code, read files, and make fixes — but never execute tests.
- **Each check runs in a subagent.** Use the `Agent` tool with `subagent_type: "general-purpose"`. The subagent has no access to parent context — include all necessary context in the prompt (user request, git diff, changed files, workspace path).

**Communication:** Announce each stage. When Stage 1 subagents complete, summarize results before proceeding to Stage 2.

---

## Subagent Execution

**Before starting**, gather context to pass to each subagent:
1. User's original request or plan (from conversation)
2. **Plan discovery**: Plan path(s) if found — check `docs/plans/` (workspace).
3. Workspace path (current project root)

**For each subagent:**
1. Call the `Agent` tool with:
   - `subagent_type`: `"general-purpose"`
   - `description`: Short check name (e.g. "Check: Correctness")
   - `prompt`: Check instructions (see below), plus: "Workspace: [path]. User request/plan from conversation: [brief context]. Run `git diff` and `git status` to see changes. Execute this check fully. Loop until no violations remain. Make fixes directly in the codebase. Do NOT run any test commands. Return a summary: PASS or FAIL, any violations found, any fixes made."
2. If FAIL or fixes were made and fixes may affect other checks: re-run affected checks.

## Trigger Phrases

- "pre-commit", "ready to commit", "run pre-commit", "pre-commit workflow"
- "before committing", "finalize for commit", "get ready to commit"

---

## Stage 1: Parallel Review Checks (NO TESTS)

Launch ALL of the following as parallel subagents in a single message. Each subagent reviews code and makes fixes but **must NOT run any test commands** (`make test-*`, `pytest`, `vitest`, etc.).

If any subagent makes fixes, re-run any other checks that may be affected by those fixes.

---

### Check 1: User Intent / Plan Compliance

**Goal:** Find the plan that was used (if any) and ensure the changes adhere to it.

- Check `docs/plans/` for plan files whose scope matches the changes.
- If a plan exists: compare implemented changes against it. Identify gaps.
- If no plan: fall back to the user's original request. Identify gaps.
- Fix violations. **Loop until clean.**

---

### Check 2: First-Version Quality

**Goal:** Ensure changes adhere to `docs/first-version-quality.md`.

Read `docs/first-version-quality.md` and verify:
- No quick fixes or patches; clean architecture
- Single responsibility; no cramming into wrong abstractions
- No technical debt added; no "we'll fix this later"
- Correctness and maintainability over convenience

List violations with `file:line`. Fix them. **Loop until clean.**

---

### Check 3: UI Design Principles

**Goal:** Ensure changes adhere to `docs/ui-design-principles.md`.

Read `docs/ui-design-principles.md` and verify:
- Mobile-first; touch targets >=44px
- No hover-only actions; tap/click must work
- Cognitive load minimized; clear hierarchy and patterns
- Micro-interactions appropriate and subtle
- Halo effect: polish empty/error states and first impressions

List violations with `file:line`. Fix them. **Loop until clean.**

---

### Check 4: Code Quality — Clean, DRY, Maintainable

**Goal:** Ensure code is maintainable — clean, DRY, and easy to evolve.

**Maintainability:**
- No duplicated logic; extract shared behavior
- Clear structure; single responsibility
- No magic numbers; named constants where appropriate
- No unnecessary coupling or hidden dependencies

**Enums:**
- Enums created when they should have been
- Existing Enums used; no string literals where an Enum exists
- No orphaned or redundant Enum definitions

List violations with `file:line`. Fix them. **Loop until clean.**

---

### Check 5: Correctness

**Goal:** Logic correct; edge cases handled; no null/undefined access; no race conditions.

- Logic is correct for all inputs
- Edge cases (empty, boundary, invalid) handled
- No null/undefined access without guards
- No race conditions or timing bugs
- No off-by-one errors

List violations with `file:line`. Fix them. **Loop until clean.**

---

### Check 6: Security

**Goal:** No SQL injection, XSS, auth bypass; sensitive data not exposed.

- No raw SQL with user input; use parameterized queries
- No unescaped user content in HTML; XSS prevention
- Auth checks present where required; no bypass paths
- Sensitive data not logged or exposed in responses

List violations with `file:line`. Fix them. **Loop until clean.**

---

### Check 7: Tests Exist (DO NOT RUN TESTS)

**Goal:** New/changed behavior has tests; tests are meaningful.

- Every new or changed behavior has corresponding tests
- Tests assert real behavior, not tautologies
- Tests are readable and maintainable
- New logic has sufficient coverage; critical paths exercised

**Write missing tests. Do NOT execute them.** They will be verified in Stage 2.

List violations with `file:line`. Fix them. **Loop until clean.**

---

### Check 8: Error Handling

**Goal:** Errors handled; no silent failures.

- Errors are caught and handled appropriately
- User sees helpful messages where applicable
- No swallowed exceptions or silent failures
- Logging where useful for debugging

List violations with `file:line`. Fix them. **Loop until clean.**

---

### Check 9: Logging

**Goal:** Ensure logs adhere to `docs/logging-guidelines.md`.

Read `docs/logging-guidelines.md` and verify:
- **Log levels used correctly:** CRITICAL (system unusable); ERROR (operation failed); WARNING (recoverable); INFO (business events); DEBUG (internal state)
- **`logger.exception()`** in `except` blocks for stack traces
- **PII safe:** Never log passwords, tokens, API keys; redact email/phone
- **Logger usage:** `logging.getLogger(__name__)`; format args (`%s`) not f-strings

List violations with `file:line`. Fix them. **Loop until clean.**

---

### Check 10: Variable Names

**Goal:** No short/cryptic names; prefer descriptive.

- No single-letter names (except loop indices) or cryptic abbreviations
- Names convey intent and purpose

List violations with `file:line`. Fix them. **Loop until clean.**

---

## Stage 2: Sequential Gates (after Stage 1 completes)

These run **one at a time, in order**. Each must pass before the next starts.

---

### Gate 1: Linters, Sorters, Typechecks

**Goal:** All static checks pass.

- Run **`make check-static`** (lint + format + isort + typecheck only, no tests).
- Also run frontend TypeScript check: `cd apps/mobile && npx tsc --noEmit`
- Fix any violations.
- **Loop until all checks pass.**

---

### Gate 2: All Tests Pass

**Goal:** Every test in the project passes.

- Run `make test-backend`.
- Fix failures and re-run once more if needed.
- **Loop until all tests pass.**

---

### Gate 3: Final Checklist

**Goal:** One final sweep after all fixes from earlier stages.

| Category | Check |
|----------|-------|
| **Correctness** | Logic correct; edge cases handled; no null/undefined access |
| **Security** | No injection, XSS, auth bypass; sensitive data not exposed |
| **Maintainability** | Clean structure; single responsibility; no magic numbers; Enums correct |
| **Tests** | New/changed behavior has tests; tests are meaningful |
| **Variable names** | No short/cryptic names |
| **Error handling** | Errors handled; no silent failures |
| **First-version-quality** | Clean architecture, no technical debt (`docs/first-version-quality.md`) |
| **UI design principles** | Mobile-first, touch >=44px, no hover-only (see `docs/ui-design-principles.md`) |
| **Logging** | Correct levels, PII safe, structured (see `docs/logging-guidelines.md`) |

**Loop until no violations remain.**

---

### Gate 4: Update Docs

**Execute** the full update-docs workflow.

1. Read `docs/TRD.md`, `docs/PRD.md`, `docs/business-rules.md`, `docs/backend-endpoints.md`, `docs/diagrams/site-map-and-flows.md`, `docs/architecture.md`, `docs/development.md`, `docs/operational-guidelines.md`, `docs/logging-guidelines.md`, `docs/ui-design-principles.md`, `docs/backend-plan.md`, `docs/notes.md`, `CLAUDE.md`, `docs/adr/README.md` and recent changes (`git diff`). Skip files that do not exist.
2. Identify what changed (endpoints, models, flows, setup, env vars, business rules, etc.).
3. Update each impacted doc per the section mappings in the update-docs skill.
4. Update "Last updated" and TOCs where edited.
5. Summarize what was changed.

---

### Gate 5: Conventional Commit Message

1. Run `git diff` to see all changes since last commit.
2. Generate a conventional commit message (feat/fix/chore/etc.) that is descriptive.
3. Ensure special characters will not break the commit message. NEVER put double quotes in the commit message.

**Output:** The commit message, ready to use.

---

## Checklist (Track Progress)

```
Pre-Commit Workflow:

Stage 1 — Parallel Review (no tests):
- [ ] Check 1: User intent / plan compliance
- [ ] Check 2: First-version quality
- [ ] Check 3: UI design principles
- [ ] Check 4: Code quality (DRY, maintainable, Enums)
- [ ] Check 5: Correctness
- [ ] Check 6: Security
- [ ] Check 7: Tests exist and cover new behavior (DO NOT RUN)
- [ ] Check 8: Error handling
- [ ] Check 9: Logging
- [ ] Check 10: Variable names

Stage 2 — Sequential Gates:
- [ ] Gate 1: Linters, sorters, typechecks (make check-static + tsc)
- [ ] Gate 2: All tests pass (make test-backend)
- [ ] Gate 3: Final checklist — one more pass
- [ ] Gate 4: Update docs
- [ ] Gate 5: Conventional commit message
```

---

## Red Flags

- **Running tests in Stage 1** — Forbidden. Stage 1 subagents review and fix code only.
- **Skipping checks** — All checks and gates are required.
- **Running Stage 2 before Stage 1 completes** — Gates depend on all review fixes being done.
- **Claiming compliance without verification** — Run checks; read changed files. Never declare passing without doing the work.
- **Running `make check-all`** — Includes tests (slow). Use `make check-static` for Gate 1.
- **Vague commit message** — Must be descriptive and conventional.
