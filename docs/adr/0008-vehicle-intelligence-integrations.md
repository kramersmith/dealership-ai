# ADR-0008: Vehicle Intelligence External API Integrations

**Status:** Accepted
**Date:** 2026-03
**Deciders:** Kramer Smith

## Context

A core value proposition of Dealership AI is giving buyers objective, data-driven insight about the vehicle they are considering. To deliver this, the app needs three categories of vehicle data that cannot be generated internally:

1. **Vehicle specification decoding** -- given a VIN, resolve the exact year, make, model, trim, engine, drivetrain, body type, transmission, and fuel type.
2. **Title and history checks** -- flag salvage titles, total losses, theft records, and odometer issues so buyers can identify serious red flags before committing.
3. **Market valuation** -- provide a listing-based asking price estimate so buyers understand whether a dealer's price is competitive.

The only reliable input buyers can easily provide is a 17-character VIN (found on the vehicle, paperwork, or dealer listing). The system must translate that VIN into actionable intelligence across all three categories, handle partial or missing data gracefully, cache results to control costs, and store raw provider responses for auditability.

Constraints:
- Pre-production budget -- external API costs must be predictable and controllable.
- The app must function (with degraded vehicle intelligence) even if a paid provider key is not configured.
- Vehicle data changes over time (valuations shift, history records appear), so cached data must expire.
- Multiple intelligence records may exist per vehicle (e.g., a decode before and after a VIN correction), and the system must track each one independently.

## Decision

Use a **multi-provider integration strategy** with two external APIs behind a unified service layer (`vehicle_intelligence.py`), each provider covering a distinct data domain. Store intelligence results as separate, append-only database models linked to a parent `Vehicle` record via cascade relationships.

### Providers

| Provider | Data domain | API | Cost model |
|---|---|---|---|
| **NHTSA vPIC** | VIN decode (specs) | `DecodeVinValues/{vin}?format=json` | Free (US government) |
| **VinAudit** | Title/history check | `GET` with API key + VIN | Paid per-query |
| **VinAudit** | Market valuation | `GET` with API key + VIN | Paid per-query |

NHTSA vPIC is the sole decode provider. It is free, authoritative (maintained by the US DOT), and covers all vehicles sold in the US market. VinAudit provides both history and valuation through separate endpoints under a single API key.

### Data model

The `Vehicle` model holds user-facing fields (year, make, model, trim, VIN, mileage, color, engine) and owns three child collections via `cascade="all, delete-orphan"` relationships:

- **`VehicleDecode`** (`vehicle_decodes`) -- one row per decode attempt. Stores parsed fields (year, make, model, trim, engine, body_type, drivetrain, transmission, fuel_type) plus the full `raw_payload` JSON from NHTSA.
- **`VehicleHistoryReport`** (`vehicle_history_reports`) -- one row per history check. Stores structured boolean flags (`has_salvage`, `has_total_loss`, `has_theft_record`, `has_odometer_issue`), `title_brands` JSON array, and the full `raw_payload` from VinAudit.
- **`VehicleValuation`** (`vehicle_valuations`) -- one row per valuation fetch. Stores `amount` (float), `currency`, `valuation_label`, and the full `raw_payload` from VinAudit.

All three child models share a common column pattern:
- `provider` -- enum (`IntelligenceProvider`: `nhtsa_vpic` or `vinaudit`) identifying the source.
- `status` -- enum (`IntelligenceStatus`: `success` or `partial`) indicating data completeness.
- `vin` -- the normalized VIN this record was fetched for.
- `requested_at`, `fetched_at`, `expires_at` -- request lifecycle timestamps for cache control.
- `raw_payload` -- full JSON response preserved for debugging and future re-parsing.

### TTL-based caching

Each intelligence type has a distinct TTL reflecting how quickly the underlying data changes:

| Type | TTL | Rationale |
|---|---|---|
| Decode | 180 days | Vehicle specs are immutable; only re-fetch if NHTSA updates their database |
| History | 30 days | Title brands and incident records can change as reports are filed |
| Valuation | 2 days | Market prices fluctuate; stale valuations are misleading |

The service layer checks `expires_at` before calling the external API. If a fresh record exists for the same vehicle and VIN, the cached record is returned. A `force_refresh` parameter bypasses the cache when explicitly requested.

### Graceful degradation

- VIN decode (NHTSA) requires no API key and always works if the network is available.
- History and valuation (VinAudit) raise `ProviderConfigurationError` if `VINAUDIT_API_KEY` is not set, allowing the app to function without paid features configured.
- Each fetch sets `status` to `partial` if the response is incomplete (e.g., decode returns no make/model, valuation returns no amount), so the frontend can render partial data with appropriate caveats rather than failing entirely.

### Merge-back pattern

After a successful decode, the service merges decoded fields back into the parent `Vehicle` record (`_merge_decoded_fields`), filling in only fields that are currently null. This ensures the vehicle's user-facing display is always as complete as possible without overwriting data the user or AI has explicitly set.

### Identity confirmation flow

The `Vehicle` model tracks an `identity_confirmation_status` (`unconfirmed`, `confirmed`, `rejected`) so the user can verify that the decoded vehicle matches what they are actually looking at. This prevents incorrect VINs from silently populating deal data.

## Alternatives Considered

### Option A: Single provider for all vehicle data (e.g., Carfax, AutoCheck)
- Pros: One integration point, one API key, potentially richer combined data (full service history, accident details, ownership count).
- Cons: Significantly higher per-query cost ($0.50-$3+ per VIN lookup vs. free for decode). Creates total vendor lock-in -- if the provider changes pricing or terms, the entire vehicle intelligence feature is blocked. No free tier for development or low-budget operation. The app's MVP needs specs + red flags + valuation, not full Carfax-style reports.

### Option B: Web scraping from public sources (KBB, Edmunds, dealer listings)
- Pros: No API costs, potentially richer data (dealer reviews, feature descriptions, photos).
- Cons: Fragile -- scrapers break when sites change layout. Legally risky -- violates most sites' terms of service. Slow and unreliable. Cannot be cached cleanly because the data format is unpredictable. Not viable for a production app.

### Option C: Manual entry only (no external APIs)
- Pros: Zero external dependencies, zero API cost, no network latency.
- Cons: Defeats the core product value. Buyers do not know their vehicle's market value or title history. The AI cannot provide data-backed advice. Manual entry is error-prone (users misspell trims, guess at engine specs). The app becomes a generic chat interface with no vehicle intelligence advantage.

### Option D: Single intelligence table with a `type` discriminator column
- Pros: Simpler schema (one table instead of three), fewer migrations.
- Cons: Columns are fundamentally different across types -- decode has `engine`, `drivetrain`, `transmission`; history has `has_salvage`, `has_total_loss`; valuation has `amount`, `currency`. A single table would be mostly null columns, making queries confusing and validation impossible at the database level. Separate tables enforce the correct shape per intelligence type and allow independent indexing.

## Consequences

- **Positive:** Free VIN decode via NHTSA means the core vehicle identification feature has zero marginal cost. Buyers can decode unlimited VINs during research.
- **Positive:** The append-only model with `raw_payload` preservation means provider response format changes do not lose data -- stored records can be re-parsed if the extraction logic is updated.
- **Positive:** TTL-based caching with differentiated expiry windows balances data freshness against API cost. A vehicle decoded once will not be re-decoded for six months; valuations refresh every two days to stay current.
- **Positive:** Cascade delete-orphan on the Vehicle relationship ensures intelligence records are cleaned up automatically when a vehicle is removed, preventing orphaned data.
- **Positive:** The `status` enum (`success`/`partial`) and `identity_confirmation_status` give both the AI and the frontend clear signals about data quality, enabling appropriate hedging in advice and UI presentation.
- **Negative:** Two separate providers means two integration points to maintain. If VinAudit changes their API contract, both history and valuation break simultaneously (mitigated by storing raw payloads and using defensive extraction helpers like `_extract_bool` and `_extract_amount`).
- **Negative:** VinAudit is a paid service with per-query costs. Without rate limiting or budget caps (not yet implemented), a bug or abuse could generate unexpected charges.
- **Negative:** NHTSA vPIC only covers vehicles sold in the US market. International vehicles will return empty or partial decodes. This is acceptable for the MVP's US-focused scope.
- **Neutral:** The multi-table model means fetching a complete vehicle intelligence picture requires three queries (one per child table). The `get_latest_vehicle_intelligence` helper consolidates this, but it is still three round-trips to the database per call.

## References

- [Vehicle intelligence service](../../apps/backend/app/services/vehicle_intelligence.py)
- [Vehicle model](../../apps/backend/app/models/vehicle.py)
- [VehicleDecode model](../../apps/backend/app/models/vehicle_decode.py)
- [VehicleHistoryReport model](../../apps/backend/app/models/vehicle_history_report.py)
- [VehicleValuation model](../../apps/backend/app/models/vehicle_valuation.py)
- [Intelligence enums](../../apps/backend/app/models/enums.py) -- `IntelligenceProvider`, `IntelligenceStatus`, `IdentityConfirmationStatus`
- [NHTSA vPIC API documentation](https://vpic.nhtsa.dot.gov/api/)
- [VinAudit API](https://www.vinaudit.com/api)
- Originating commit: `f79084a feat(vehicles): vehicle intelligence system with NHTSA VIN decode, expandable vehicle card, and VIN assist chat flow`
