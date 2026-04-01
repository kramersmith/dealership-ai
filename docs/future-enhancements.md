# Future Enhancements

**Created:** 2026-03-26

Enhancements beyond the current Insights Panel redesign. These are validated ideas that aren't needed for Phase 1 or Phase 2 but would strengthen the product over time.

---

### Deal Momentum / Offer History
Show how offers have moved over time: first offer → counter → current. Visual timeline or compact list showing the negotiation trajectory. Builds confidence that negotiation is working (or signals it's stalling).

### Multi-Dealer Comparison
Leverage linked sessions for side-by-side deal comparison. Frame as total cost (not just sticker price) including financing over the full term. Surface leverage tips: "Tell Dealer A you have a $25.5k offer."

### Vehicle Data API Integrations

Full research and analysis in `docs/research/vehicle-data-apis/`.

#### Phase 1: VIN Decode + Title Check + Market Value

**NHTSA vPIC — VIN Decoding (Free)**
- [ ] Add VIN input field to vehicle creation flow (manual entry + future camera/OCR)
- [ ] Backend service to call NHTSA vPIC `DecodeVinValues` endpoint
- [ ] Auto-populate vehicle details (year, make, model, trim, engine, drivetrain, body type) from VIN
- [ ] Cache decoded VIN data (TTL 30–365 days, data is static)
- [ ] Add free NHTSA Recalls check — display banner in Insights Panel if open recalls exist

**VinAudit — Vehicle History + Market Value (~$0.25–1/query)**
- [ ] Sign up for VinAudit API access (form submission, no sales call)
- [ ] Backend service for VinAudit history endpoint (title brands, total losses, odometer, theft)
- [ ] Backend service for VinAudit market value endpoint (low/avg/high)
- [ ] Store VinAudit report IDs — re-fetches with same ID are free
- [ ] Cache history reports (TTL 30–90 days)
- [ ] Feed market value data into AI deal assessment (e.g., "fair market value is $X, you're being asked $Y")
- [ ] Feed title/history data into AI red flag detection (e.g., "2 prior total loss events reported")
- [ ] UI: label as "Official US Title and Brand Check" — not "full history" (NMVTIS compliance)
- [ ] UI: display NMVTIS attribution: "Data provided by VinAudit from NMVTIS"
- [ ] UI: include link explaining what NMVTIS does and does not cover
- [ ] Handle NMVTIS maintenance windows (1am–2am ET daily) with graceful degradation
- [ ] Run 100-VIN bakeoff between VinAudit and ClearVin for coverage/latency comparison

**Backend Infrastructure**
- [ ] Redis cache layer in FastAPI keyed by VIN+provider+endpoint with configurable TTLs
- [ ] VIN normalization and request deduplication (collapse concurrent calls)
- [ ] Centralize compliance/attribution strings in backend responses
- [ ] Environment variables for API keys (`VINAUDIT_API_KEY`)

#### Phase 2: Market Intelligence

**MarketCheck — Comparable Listings + Trends (Subscription)**
- [ ] Evaluate MarketCheck pricing (free 500 calls, then $299–$749/mo + $0.07–$0.13/call)
- [ ] Backend service for comparable listings search
- [ ] Backend service for MarketCheck price prediction
- [ ] Gate valuation calls behind high-intent actions (save vehicle, start negotiation) to control costs
- [ ] Cache valuations (TTL 24–72 hours, stale-while-revalidate)
- [ ] Selective NeoVIN trim enrichment when vPIC trim is ambiguous or price variance >15%
- [ ] Feed comparables into AI: "3 similar cars within 20 miles listed for $2K less"
- [ ] UI: display "Estimated Market Value by MarketCheck" attribution
- [ ] Price tracking and alerts

#### Phase 3: Premium Data (Post-Traction)

**CARFAX Insights Card**
- [ ] CARFAX PDF upload flow — buyer uploads report (often provided free by dealer)
- [ ] AI parses PDF to extract accidents, service history, ownership count, title issues
- [ ] Cross-reference CARFAX data with deal numbers for leverage (e.g., "3 accidents — overpriced by $X")
- [ ] New `carfax` card type in Insights Panel
- [ ] Explore CARFAX affiliate link program for in-app report purchasing
- [ ] Future: CARFAX API partnership for native data access

**Enterprise Valuations**
- [ ] Black Book integration for wholesale/trade-in values
- [ ] Edmunds TMV for retail transaction-based pricing (negotiation anchors)

#### Valuation UX Guidance
- Label all pre-Phase 3 valuations as "Market Asking Price Estimate" (based on listing prices, not transaction prices)
- AI should explain typical discount range between asking and final sale prices
- Display confidence bands when listing price variance is high

### User Sophistication Detection
Adapt panel density and AI tone based on buyer experience level. A soft signal like "Is this your first time buying a car?" changes how the entire experience should feel. First-time buyers need more explanation and reassurance; experienced buyers want data density and less hand-holding.

### Shareable Deal Summary
Designed-for-sharing savings card for referral loops. After a deal completes, generate a visual summary card the buyer can share via text/social. "I saved $2,400 on my 2024 Civic with DealershipAI." This is the engineered viral moment.
