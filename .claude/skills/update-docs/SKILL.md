---
name: update-docs
description: Updates project documentation to reflect the current codebase. Use when changes affect architecture, APIs, business rules, setup, env vars, UI patterns, or logging. Trigger phrases - "update docs", "update documentation", "sync docs".
---

# Update Docs

Update `docs/TRD.md`, `docs/PRD.md`, `docs/business-rules.md`, `docs/backend-endpoints.md`, `docs/diagrams/site-map-and-flows.md`, `docs/architecture.md`, `docs/development.md`, `docs/operational-guidelines.md`, `docs/logging-guidelines.md`, `docs/ui-design-principles.md`, `docs/backend-plan.md`, `docs/notes.md`, `CLAUDE.md`, `docs/adr/`, and all relevant docs in `docs/` so they accurately reflect the current codebase. Run this when you've made changes that affect architecture, APIs, business rules, data model, integrations, product-facing features, local setup, dev tooling, ops (logging, metrics), or UI patterns.

Note: Not all changes will affect every doc. Only update docs that are impacted.

## Steps

1. **Read the current docs** (`docs/TRD.md`, `docs/PRD.md`, `docs/business-rules.md`, `docs/backend-endpoints.md`, `docs/diagrams/site-map-and-flows.md`, `docs/architecture.md`, `docs/development.md`, `docs/operational-guidelines.md`, `docs/logging-guidelines.md`, `docs/ui-design-principles.md`, `docs/backend-plan.md`, `docs/notes.md`, `CLAUDE.md`, `docs/adr/README.md`) and your recent changes (e.g. `git diff` or conversation context). Skip files that do not exist.
2. **Identify what changed** — endpoints, business logic, models, integrations, auth/roles, user flows, features, local setup, env vars, dev commands, architecture decisions, logging config.
3. **Edit the TRD** to match reality. Update existing sections in place; preserve structure and style.
4. **Edit business-rules.md** when deal phases, scoring, AI tools, session rules, simulation rules, or auth rules change.
5. **Edit the PRD** when product-facing changes occur — new/removed flows, features, personas, copy. PRD describes *what* and *why*; TRD describes *how*. Do not duplicate technical detail from TRD.
6. **Edit backend-endpoints.md** when APIs change — new/removed endpoints, request/response changes.
7. **Edit diagrams/site-map-and-flows.md** when routes, screen structure, or key user flows change.
8. **Edit each other impacted doc** to match reality.
9. **Be accurate** — only document what the code does. Verify against the relevant files.
10. **Update "Last updated"** at the top (current month, e.g. `2026-03`).
11. **TOC maintenance** — For any large doc (100+ lines) that was edited, verify it has a Table of Contents and that the TOC reflects the current section structure.
12. **ADR evaluation (required)** — Read `docs/adr/README.md` to see existing ADRs. Explicitly evaluate whether the changes involve a significant architectural decision. ADR-worthy changes include: new integration patterns, new data models or storage strategies, major refactors (replacing one architecture with another), new resilience/retry strategies, new external API integrations, new real-time communication patterns, new AI pipeline architectures. If an ADR is needed, create it using `docs/adr/0000-template.md` (increment the number) and add it to the `docs/adr/README.md` index. If no ADR is needed, state why in your summary.

## Section mapping — TRD

| Change type | TRD section |
|-------------|-------------|
| New/removed endpoints, route changes | §5 API Contract (+ backend-endpoints.md) |
| Business rules (deal phases, scoring, tools) | §6 Core Business Rules (summary; details in business-rules.md) |
| New/removed tables, models | §7 Data Model |
| New external services | §8 External Integrations |
| Auth, roles, permissions | §3, §4 |
| Tech stack, architecture | §1 Overview, §2 Architecture |

## Section mapping — PRD

| Change type | PRD section |
|-------------|-------------|
| New/removed user flows or screens | §4 Feature Catalog, §3 User Journeys |
| New personas or role capabilities | §2 Target Users & Personas |
| Product copy, value props | §1 Overview & Vision |
| New success metrics | §5 Success Metrics |
| Scope changes, roadmap items | §6 Out-of-Scope / Roadmap |

## Section mapping — business-rules.md

| Change type | business-rules.md section |
|-------------|---------------------------|
| Deal lifecycle changes | §1 Deal Phases |
| Scoring algorithm changes | §2 Deal Scoring |
| Session type or history limit changes | §3 Chat Sessions |
| Claude tool definition changes | §4 AI Tool Definitions |
| Simulation scenario changes | §5 Simulations |
| Auth or role changes | §6 Authentication |
| Claude model or config changes | §7 Claude API |

## Section mapping — backend-endpoints.md

| Change type | backend-endpoints.md section |
|-------------|------------------------------|
| New/removed endpoint | Add/remove endpoint section |
| Request/response body change | Update endpoint details |
| Auth requirement change | Update auth column |
| New route group | Add new section |

## Section mapping — diagrams/site-map-and-flows.md

| Change type | site-map-and-flows.md section |
|-------------|-------------------------------|
| New/removed route or screen | Site Map diagram |
| Role-based screen changes | Tab/Screen Structure table |
| Key user flow change | User Flows diagrams |
| New significant flow | Add new User Flow section |

## Section mapping — architecture.md

| Change type | architecture.md section |
|-------------|------------------------|
| New/removed endpoints, route changes | API / Routes |
| New/removed tables, models | Data Model |
| New external services | External Integrations |
| Auth, roles, permissions | Auth / Security |
| Tech stack changes | Overview / Stack |
| Claude API integration changes | Claude Integration |

## Section mapping — development.md

| Change type | development.md section |
|-------------|------------------------|
| New env vars, removed vars | Environment Variables |
| New Makefile targets, removed targets | Development Commands |
| Prerequisites (Node, Python, etc.) | Prerequisites |
| Local setup steps | Local Setup |
| Docker setup | Docker Development |
| Migration workflow | Database Migrations |
| Test commands | Testing |

## Section mapping — operational-guidelines.md

| Change type | operational-guidelines.md section |
|-------------|----------------------------------|
| Port changes, CORS config | Ports & Networking |
| Auth config, token settings | Security |
| Cost controls, API limits | Cost Control |
| New ops env var | Environment summary |

## Section mapping — logging-guidelines.md

| Change type | logging-guidelines.md section |
|-------------|-------------------------------|
| LOG_LEVEL, new env vars | Config section |
| New log levels, level usage | Log Level Reference |
| PII rules, redaction policy | PII rules |

## Section mapping — ui-design-principles.md

| Change type | ui-design-principles.md section |
|-------------|--------------------------------|
| New component patterns | Component Standards |
| Color/theme changes | Colors & Theming |
| Layout changes | Layout & Responsive |
| Animation/interaction changes | Micro-interactions |
| Touch target changes | Touch Targets |

## Section mapping — CLAUDE.md

| Change type | CLAUDE.md section |
|-------------|-------------------|
| New commands or Makefile targets | Commands |
| Architecture changes | Architecture |
| New env vars | Environment |
| New conventions or patterns | Relevant section |

## Section mapping — ADRs

| Change type | Action |
|-------------|--------|
| Major architectural decision | Add ADR in `docs/adr/NNNN-title.md` using `0000-template.md`. Increment NNNN. Add to index in `docs/adr/README.md`. |
| ADR superseded by new decision | Update old ADR status to "Superseded by [ADR-YYYY](...)". Add new ADR. |
| ADR needs correction | Edit in place; keep Status and Date. |

## Large docs (TOC required)

Docs with 100+ lines must have a Table of Contents near the top. TOCs use Markdown links to section headings.

- `docs/TRD.md`
- `docs/PRD.md`
- `docs/business-rules.md`
- `docs/backend-endpoints.md`
- `docs/development.md`

## Output

After updating, briefly summarize what you changed in each doc (as applicable).
