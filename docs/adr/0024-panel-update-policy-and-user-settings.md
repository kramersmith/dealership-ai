# ADR-0024: Centralized Panel Update Policy and User Settings

**Status:** Accepted
**Date:** 2026-04
**Deciders:** Backend + Mobile architecture owners

## Context

Insights panel behavior needed to support two new user controls:

1. Desktop users can collapse/expand the panel and have that state remembered.
2. Users can choose live panel updates on each turn or paused refresh-only mode.

Before this ADR, panel update behavior was implicit in chat streaming code paths and UI booleans. Policy and execution concerns were spread across multiple modules, making future behavior changes error-prone.

## Decision

We introduced a first-class persisted user settings contract for panel update mode plus centralized panel update policy/orchestration:

- Persist `insights_update_mode` in dedicated `user_settings` storage instead of ad-hoc fields.
- Keep desktop panel collapse state as a client-local UI preference rather than a server-synced account setting.
- Expose authenticated settings endpoints:
  - `GET /api/auth/settings`
  - `PATCH /api/auth/settings`
- Include settings in auth bootstrap payloads (`/auth/login`, `/auth/signup`) so clients hydrate behavior immediately.
- Centralize policy + execution entry points in `panel_update_service`:
  - policy resolution (`live` vs `paused`)
  - explicit paused-mode refresh command path (`/chat/{id}/panel-refresh`)
- Make normal chat turns policy-aware:
  - `live`: run panel generation lifecycle after `done`
  - `paused`: skip turn-triggered panel generation entirely

## Alternatives Considered

### Option A: Keep policy in route/store conditionals
- Pros: smaller diff
- Cons: hidden coupling, duplicated logic, hard to test, difficult future extension

### Option B: Client-only suppression of panel updates
- Pros: minimal backend changes
- Cons: still incurs backend panel cost/latency and violates explicit user policy intent

## Consequences

- **Positive:** Single policy source of truth; cleaner backend/frontend contracts; better testability.
- **Positive:** Paused mode now truly prevents live panel generation work on normal sends.
- **Positive:** Desktop panel shell preference no longer triggers auth/settings writes on each toggle.
- **Negative:** Added schema + migration + settings API surface area.
- **Neutral:** Existing explicit `panel-refresh` endpoint remains and now serves as the canonical paused update path.

## References

- `app/services/panel_update_service.py`
- `app/routes/auth.py`
- `app/routes/chat.py`
- `app/services/buyer_chat_stream.py`
