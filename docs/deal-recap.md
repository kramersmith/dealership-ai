# Deal recap, timeline, and share-safe export

**Last updated:** 2026-04-22

Buyer-facing **deal recap** summarizes the session as an ordered **timeline** plus a **deterministic savings snapshot**. The **`POST …/recap/share-preview`** and **export** endpoints still accept a **`redaction`** profile and run **`apply_redaction`** for clients that want deterministic masking. On the **buyer mobile recap screen**, privacy switches **only** feed **`redaction`** into **`POST …/recap/generate`** (and “Save and regenerate”); **Share & export** calls share-preview with masking **off** so the shared file matches the persisted story on screen until the user regenerates with new model preferences.

## HTTP API (under `/api/deal`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/{session_id}/recap` | Read persisted beats + computed savings. |
| `POST` | `/{session_id}/recap/generate` | Build context pack → forced tool `emit_deal_recap` → validate anchors → persist `model` beats under a new `deal_recap_generations` row; removes prior generation’s `model` rows only. Body `force`: when `false` and a **succeeded** generation already exists, returns that recap **without** calling the model; when `true`, always regenerates. Optional body **`redaction`** (same shape as share-preview) is appended to the generation prompt so the model omits those details in new copy. If the model returns **zero** beats after validation, responds **422** (prior recap unchanged) and records a **failed** generation row. |
| `POST` | `/{session_id}/recap/timeline-events` | Append a **user** correction beat (`source=user`). |
| `POST` | `/{session_id}/recap/share-preview` | Return **public** recap DTO after deterministic redaction (including `hide_dealer_name` vs known `dealer_name` values on session deals). |
| `POST` | `/{session_id}/recap/export` | v1 returns JSON for client-side image/PDF; same redaction as share-preview. |

Auth: same session ownership checks as other deal routes.

## Persistence

- **`deal_recap_generations`** — one row per generate run (`usage`, `model`, `status`).
- **`deal_timeline_events`** — beats with `source` ∈ `model`, `user`, `tool`, optional `user_message_id` / `assistant_message_id`, `recap_generation_id` for model rows, `idempotency_key` for tool hints (partial unique index per session).

`GET` / share-preview return non-superseded **buyer-facing** beats: latest `model` generation plus all `user` rows. **`tool` rows** (e.g. `phase_change` hints from `timeline_recorder`) stay in the database for continuity but are **omitted from the API payload** so the recap reads like a story to retell, not an internal audit log (see `build_recap_response` in `app/services/recap/service.py`).

## LLM boundary

Generation runs **outside** the buyer chat SSE turn (separate `POST`), analogous to detached insights follow-up. `GET` never calls the model. **`redaction`** on generate is appended to the **LLM prompt** for that run. Share-preview/export **can** apply **`apply_redaction`** when a client passes flags; the mobile recap app passes **all-off** for share parity with **`GET /recap`**.

## Tool timeline hints

Phase changes append a **tool** timeline row (`idempotency_key=phase:{deal_id}:{phase}`) from `app/services/recap/timeline_recorder.py`, invoked when deal phase updates. Those rows are **not** returned on `GET /recap` or share-preview; recap copy comes from **model** generation (friend-shareable arc) and **user** corrections only.

## Mobile

Chat header includes **Deal recap** (history icon) when a session is active. When the buyer’s **last user message** looks like a purchase completion (heuristics in `lib/recapPurchasePrompt.ts`) or the active deal is in **`closing`** phase, a **dismissible banner** above the composer offers **Open recap** (same screen). Screen: `app/(app)/recap/[sessionId].tsx` — timeline and numbers from **`GET /recap`**; **AI recap preference** switches only for **Generate Recap** / **Save and regenerate**; **Share & export** uses share-preview with **no toggle masking** (matches on-screen persisted recap). Share/export disabled while timeline edit mode is open.

## Related code

- `app/services/recap/` — context pack, LLM tool, savings math, redaction, service orchestration.
- `app/routes/recap.py` — routes (included from `app/routes/__init__.py` under `/deal`).
- `app/schemas/recap.py` — request/response models.
