---
name: first-version-quality
description: Guides implementation toward the RIGHT way for early-stage apps. Prioritizes cleanliness, maintainability, and reliability over effort. Use when building first versions, greenfield features, or when the user says "do it right", "don't be afraid of rewrites", or prioritizes quality over speed.
---

# First-Version Quality: Build It Right

When implementing features for the first version of an app, **the amount of work is not a factor**. Prioritize the correct design over convenience.

## Core Principle

**Never optimize for "less work" or "quick fix" when a cleaner design would require more effort.** Massive rewrites are acceptable. Choose correctness, maintainability, and clean architecture.

## Decision Rules

Before proposing or implementing any design:

1. **Would a cleaner approach require a rewrite?** → Prefer the rewrite. Do not patch around existing structure.
2. **Is there a "quick" solution that papers over an architectural flaw?** → Reject it. Fix the underlying design.
3. **Should we add a new table/service/abstraction for clarity?** → Add it. Avoid cramming responsibility into the wrong place.
4. **Does the current code violate separation of concerns?** → Refactor. Do not bolt new behavior onto existing wrong boundaries.
5. **Is there technical debt we're about to add?** → Don't add it. Pay the cost to do it right now.

## What "Right" Means

| Priority | Definition |
|----------|------------|
| **Cleanliness** | Clear boundaries, single responsibility, no magic or hidden coupling |
| **Maintainability** | Easy to change later; obvious where to add behavior; tests are straightforward |
| **Reliability** | Correct behavior; handles edge cases; no shortcuts that sacrifice correctness |

## Implementation Guidelines

### Data Model

- Prefer explicit tables and columns over overloading existing fields.
- Add dedicated tables (e.g. `referrals`, `credits_transactions`) rather than repurposing generic ones.
- Design schemas for the domain; avoid denormalization unless proven necessary.

### API Design

- Endpoints and payloads should match the domain, not convenience.
- Avoid "god" endpoints that mix concerns; split when it improves clarity.
- Return types should be explicit and typed; avoid loosely-typed responses.

### Frontend–Backend Boundaries

- Services and hooks should consume clear contracts; avoid ad-hoc stitching.
- If the backend model doesn't match the frontend model, fix the backend or add a proper mapping layer—don't hack the frontend to adapt to a bad API.

### Refactors

- When touching a feature, consider whether the surrounding code should be refactored.
- If existing code is the wrong abstraction, refactor it as part of the change. Do not layer more hacks on top.

## Red Flags (Stop and Rethink)

- "We could just add a field here and skip the migration."
- "The quickest way is to..."
- "We'll fix this later."
- "We don't have time for a new table."
- Proposing mocks, stubs, or hardcoded values where real persistence/behavior belongs (unless explicitly labeled as temporary and tracked).

## When This Applies

- Building new features for the first time
- User says "do it the right way", "prioritize quality", or "don't be afraid of rewrites"
- Greenfield or early-stage product (pre–product-market fit, v1)
- Planning or implementing architecture, data models, or APIs

## When to Relax (Slightly)

- Production firefighting (fix the outage first, then refactor)
- User explicitly requests a minimal/ship-fast approach for a spike or prototype
- User overrides with "just get it working for now"
