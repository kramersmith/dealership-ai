# Vehicle Data APIs Research

> Researched 2026-03-31. Evaluating APIs for VIN decoding, market valuation, and vehicle history to power AI deal analysis.

## Recommended Stack (No Sales Calls Required)

### 1. NHTSA vPIC — VIN Decoding

- **Cost:** Free (U.S. government service)
- **Sign-up:** None required — no account, no API key
- **Docs:** [https://vpic.nhtsa.dot.gov/api/](https://vpic.nhtsa.dot.gov/api/)
- **Format:** JSON, XML, or CSV

**Key endpoints:**


| Endpoint                                                          | Description                                |
| ----------------------------------------------------------------- | ------------------------------------------ |
| `GET /vehicles/DecodeVinValues/{vin}?format=json`                 | Flat key-value VIN decode (~140 variables) |
| `GET /vehicles/DecodeVin/{vin}?format=json`                       | Full VIN decode (structured)               |
| `POST /vehicles/DecodeVINValuesBatch/`                            | Batch decode up to 50 VINs                 |
| `GET /vehicles/GetModelsForMakeYear/make/{make}/modelyear/{year}` | Models by make/year                        |


**Data returned:** Make, model, year, trim, manufacturer, body type, engine specs (cylinders, displacement, HP), drivetrain, fuel type, GVWR, doors, vehicle type, plant info, and ~140 total variables.

**Rate limits:** Automated traffic control, no published hard limits. Batch endpoint limited to 50 VINs per request.

**Verdict:** No-brainer first integration. Free, instant, rich vehicle spec data from VIN.

---

### 2. VinAudit — Vehicle History + Market Value

- **Cost:** ~$0.25–1.00 per report (volume discounts available)
- **Sign-up:** Form submission (name, business, email) — not instant but no sales call
- **Docs:** [https://www.vinaudit.com/vehicle-data-api](https://www.vinaudit.com/vehicle-data-api)
- **Format:** JSON
- **Auth:** API key as query parameter (`key=YOUR_API_KEY`)
- **Data source:** NMVTIS-approved provider (same federal database CARFAX pulls from)

**Key endpoints (base: `https://api.vinaudit.com/query.php`):**


| Endpoint (`report=`) | Description                                                               |
| -------------------- | ------------------------------------------------------------------------- |
| `history`            | Title records, accidents, theft, salvage, lien/impound, insurance losses  |
| `marketvalue`        | Low/average/high market value based on actual sales data                  |
| `specs`              | Dimensions, engine type, fuel economy                                     |
| `ownershipcost`      | 5-year projected cost (fuel, maintenance, insurance, taxes, depreciation) |


**Verdict:** Strong fit for "is this price fair?" and "clean title?" features. Per-report pricing is straightforward. History + market value combo is the core of our deal assessment.

---

### 3. Marketcheck — Comparable Listings + Market Trends

- **Cost:** Subscription-based ($0.20–8.00 per 100 calls depending on endpoint). Opaque pricing — likely need a quote for production.
- **Sign-up:** Self-serve developer portal, free samples for evaluation
- **Docs:** [https://docs.marketcheck.com/docs](https://docs.marketcheck.com/docs)
- **Format:** JSON
- **Auth:** API key as query parameter or OAuth
- **Coverage:** ~6.2M used/certified + ~6.6M new listings from 44,000+ U.S. dealers

**Key endpoints (base: `https://api.marketcheck.com/v2`):**


| Endpoint                                            | Description                        |
| --------------------------------------------------- | ---------------------------------- |
| `GET /search/car/active`                            | Search active listings by criteria |
| `GET /predict/car/us/marketcheck_price`             | Price prediction/valuation         |
| `GET /predict/car/us/marketcheck_price/comparables` | Price with comparable vehicles     |
| `GET /averages`                                     | Price/mileage averages             |
| `GET /trends`                                       | Market trends                      |
| `GET /depreciation`                                 | Depreciation data                  |
| `GET /history/{vin}`                                | Online listing history             |


**Verdict:** Best for "here's what similar cars are selling for" features. Adds comparables and market context. Worth pursuing after NHTSA + VinAudit are integrated.

---

## Other Notable APIs


| API                         | Pricing                   | Highlights                                                                  |
| --------------------------- | ------------------------- | --------------------------------------------------------------------------- |
| **CarAPI** (carapi.app)     | $199/yr (1,500 calls/day) | Trim/specs database (1990–2026), self-serve, free tier for 2020 Ford/Toyota |
| **Auto.dev**                | $0.004/call (Starter); $299+/mo (Growth) | Specs + listings only. No vehicle history, no market valuation. Tiny company (~6 employees, Seed-stage), no developer community. Not recommended. |
| **CarsXE** (api.carsxe.com) | TBD                       | VIN decode, market values, vehicle history, 50+ countries                   |
| **Cardog** (cardog.app)     | 100 free calls/month      | VIN decode + recall status, good for prototyping                            |


---

## APIs Requiring Sales Calls (Future Consideration)


| API           | Owner          | What They Offer                                                                                                   |
| ------------- | -------------- | ----------------------------------------------------------------------------------------------------------------- |
| **KBB**       | Cox Automotive | Industry-standard vehicle valuations. Requires commercial licensing, annual contract, typically $thousands/month. |
| **CARFAX**    | IHS Markit     | Vehicle history reports (accidents, title, service). Business partnership required.                               |
| **AutoCheck** | Experian       | CARFAX competitor. Commercial licensing, sometimes easier access.                                                 |


These make sense once the app has traction and revenue to justify the licensing cost.

---

## Recommended Integration Order


| Priority | Need                                     | API                   | Cost             |
| -------- | ---------------------------------------- | --------------------- | ---------------- |
| 1        | VIN decode (auto-fill vehicle details)   | NHTSA vPIC            | Free             |
| 2        | Market valuation ("is this price fair?") | VinAudit Market Value | ~$0.25–1/query   |
| 3        | Vehicle history ("clean title?")         | VinAudit History      | ~$0.25–1/report  |
| 4        | Comparable listings                      | Marketcheck           | Subscription TBD |


### How This Feeds the AI

- **VIN decode** — buyer enters a VIN, vehicle details auto-populate (no manual entry)
- **Market value** — AI can say "this car's fair market value is $X, you're being asked to pay $Y"
- **Vehicle history** — AI can flag "2 prior accidents reported, use this as leverage"
- **Comparables** — AI can say "3 similar cars within 20 miles are listed for $2K less"

