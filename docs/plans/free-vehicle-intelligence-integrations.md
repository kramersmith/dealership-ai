# Plan: Add Free Government Vehicle Intelligence Integrations

## Context

We want to enrich the vehicle card with more data to help buyers evaluate deals. All 4 new integrations use free, no-auth government APIs — no cost. They complement the existing VIN decode (NHTSA vPIC), history (VinAudit), and valuation (VinAudit) integrations.

**New data sources:**
1. **NHTSA Recalls** — recall campaigns for make/model/year
2. **NHTSA Complaints** — consumer complaints with crash/fire/injury counts
3. **NHTSA Safety Ratings** — NCAP crash test star ratings
4. **EPA Fuel Economy** — MPG, annual fuel cost, CO2 emissions

**Key difference from existing integrations:** These use make/model/year (not VIN directly), so they depend on a successful VIN decode first.

---

## Implementation Phases

### Phase 1: Backend Data Layer

**`apps/backend/app/models/enums.py`** — Add to `IntelligenceProvider`:
- `NHTSA_RECALLS = "nhtsa_recalls"`
- `NHTSA_COMPLAINTS = "nhtsa_complaints"`  
- `NHTSA_SAFETY = "nhtsa_safety"`
- `EPA_FUEL_ECONOMY = "epa_fuel_economy"`

**`apps/backend/app/core/config.py`** — Add base URLs (no API keys):
```
NHTSA_RECALLS_BASE_URL = "https://api.nhtsa.gov/recalls/recallsByVehicle"
NHTSA_COMPLAINTS_BASE_URL = "https://api.nhtsa.gov/complaints/complaintsByVehicle"
NHTSA_SAFETY_BASE_URL = "https://api.nhtsa.gov/SafetyRatings"
EPA_FUEL_ECONOMY_BASE_URL = "https://www.fueleconomy.gov/ws/rest"
```

**Create 4 new model files** (following `vehicle_history_report.py` / `vehicle_valuation.py` pattern — id, vehicle_id FK, provider, status, vin, raw_payload JSON, timestamps):

| File | Table | Domain Fields |
|------|-------|---------------|
| `vehicle_recalls.py` | `vehicle_recalls` | `make`, `model`, `year`, `recall_count`, `recalls` (JSON list), `has_park_it` (bool — critical safety flag) |
| `vehicle_complaints.py` | `vehicle_complaints` | `make`, `model`, `year`, `complaint_count`, `crash_count`, `fire_count`, `injury_count`, `top_components` (JSON), `complaints` (JSON list) |
| `vehicle_safety_rating.py` | `vehicle_safety_ratings` | `make`, `model`, `year`, `overall_rating`, `frontal_crash_rating`, `side_crash_rating`, `rollover_rating` (all int|None) |
| `vehicle_fuel_economy.py` | `vehicle_fuel_economy` | `make`, `model`, `year`, `epa_vehicle_id`, `city_mpg`, `highway_mpg`, `combined_mpg`, `annual_fuel_cost`, `fuel_economy_score`, `co2_tailpipe_gpm`, `you_save_spend`, `fuel_type` |

**`apps/backend/app/models/vehicle.py`** — Add 4 cascade relationships + TYPE_CHECKING imports.

**`apps/backend/app/models/__init__.py`** — Register new models.

---

### Phase 2: Backend Service Layer

**`apps/backend/app/services/vehicle_intelligence.py`**

Add TTL constants:
- `RECALLS_TTL = timedelta(days=7)`
- `COMPLAINTS_TTL = timedelta(days=30)`  
- `SAFETY_RATING_TTL = timedelta(days=180)`
- `FUEL_ECONOMY_TTL = timedelta(days=365)`

Add `_get_vehicle_identity(vehicle, db)` helper — extracts make/model/year from Vehicle fields, falling back to latest decode if vehicle fields are empty (identity not yet confirmed).

Add 4 HTTP fetch functions:
- `fetch_nhtsa_recalls(make, model, year)` — single GET with query params
- `fetch_nhtsa_complaints(make, model, year)` — single GET with query params
- `fetch_nhtsa_safety_rating(make, model, year)` — GET with URL path params
- `fetch_epa_fuel_economy(make, model, year, trim)` — multi-step: models → fuzzy match → options → pick trim → vehicle data

EPA fuzzy matching helpers:
- `_normalize_for_match(name)` — lowercase, strip non-alphanumeric
- `_match_epa_model(nhtsa_model, epa_models_data)` — exact → substring → first fallback
- `_pick_epa_vehicle_id(options_data, trim)` — trim match → first fallback

Add 4 main service functions following `check_history()` pattern:
- `get_recalls(vehicle, db, vin=None, force_refresh=False)` — accept `vin` kwarg for wrapper compatibility but use make/model/year from `_get_vehicle_identity()`
- `get_complaints(vehicle, db, vin=None, force_refresh=False)`
- `get_safety_rating(vehicle, db, vin=None, force_refresh=False)`
- `get_fuel_economy(vehicle, db, vin=None, force_refresh=False)`

Each: check cache freshness → fetch from API → extract/aggregate fields → persist model → return.

Expand `LatestVehicleIntelligence` dataclass + `get_latest_vehicle_intelligence()` + `build_vehicle_intelligence_response()` with the 4 new types.

Add `auto_fetch_free_intelligence(vehicle, db)` — runs all 4 via `asyncio.gather(return_exceptions=True)`, logs individual failures.

---

### Phase 3: Backend API Layer

**`apps/backend/app/schemas/deal.py`** — Add 4 response schemas (`VehicleRecallsResponse`, `VehicleComplaintsResponse`, `VehicleSafetyRatingResponse`, `VehicleFuelEconomyResponse`). Expand `VehicleIntelligenceResponse` with 4 new optional fields.

**`apps/backend/app/routes/deals.py`** — Add 4 POST endpoints:
- `POST /{session_id}/vehicles/{vehicle_id}/get-recalls`
- `POST /{session_id}/vehicles/{vehicle_id}/get-complaints`
- `POST /{session_id}/vehicles/{vehicle_id}/get-safety-rating`
- `POST /{session_id}/vehicles/{vehicle_id}/get-fuel-economy`

All use existing `_run_intelligence_action()` wrapper (service functions accept unused `vin` kwarg for compatibility). No request body needed — data comes from existing decode.

Add auto-fetch call in `decode_vehicle_vin()` route: after successful decode + commit, fire `auto_fetch_free_intelligence()` wrapped in try/except so decode response still returns even if auto-fetch fails. This means the decode response will include recalls/complaints/safety/fuel data when they load fast enough.

---

### Phase 4: Frontend

**`apps/mobile/lib/types.ts`** — Add 4 interfaces (`VehicleRecalls`, `VehicleComplaints`, `VehicleSafetyRating`, `VehicleFuelEconomy`). Expand `VehicleIntelligence` with new fields. Expand `IntelligenceAction` union type.

**`apps/mobile/lib/apiClient.ts`** — Add 4 mapper functions + 4 API methods. Update `mapVehicleIntelligence()`.

**`apps/mobile/stores/dealStore.ts`** — Add 4 store methods using existing `runIntelligenceAction()` pattern.

**`apps/mobile/components/insights-panel/AiVehicleCard.tsx`** — Add 4 new expandable sections:
- **RecallsSection** — count, "Park It" danger warning, recall list (component + summary + remedy)
- **ComplaintsSection** — count, crash/fire/injury totals, top components
- **SafetyRatingSection** — star ratings (overall/frontal/side/rollover)
- **FuelEconomySection** — combined/city/highway MPG, annual fuel cost, 5-year savings

All sections show "Decode VIN first" if no decode exists. Auto-fetched data appears automatically after decode.

---

### Phase 5: Testing

**Backend tests** (`apps/backend/tests/`):
- EPA fuzzy matching unit tests (exact, substring, fallback, empty)
- Service function tests: cached return, expired fetch, no-decode error, field extraction
- Auto-fetch tests: continues on individual failure, fires after decode
- Route integration tests

---

## Implementation Order

1. Models + enums + config (foundation)
2. Service layer — NHTSA Recalls first (simplest), then Complaints, Safety Ratings, EPA (most complex)
3. Schemas + routes
4. Frontend types + client + store
5. UI sections in AiVehicleCard
6. Auto-fetch wiring
7. Tests throughout

## Verification

- `make test-backend` passes
- `make check-static` passes  
- Docker up → decode a VIN → verify all 4 new data types appear in intelligence response
- Check AiVehicleCard shows new sections with real data
- Test EPA fuzzy matching with tricky model names (F-150, Civic Sedan, etc.)
- Verify auto-fetch fires after decode and individual failures don't block others
