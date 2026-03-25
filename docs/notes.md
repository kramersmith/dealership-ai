# AI Car Buying App — Project Notes

## Last updated: March 25, 2026

---

## Concept
A unified AI-powered smartphone app for the car buying experience, with role-based access for two user types:
- **Buyer experience** — helps buyers understand deals, spot unauthorized charges, avoid manipulation, and negotiate effectively. Consumer subscription.
- **Dealer experience** — helps salespeople handle objections in real time, capture customer intelligence, and close deals. Dealer subscription.

Users select their role at registration ("Buying" or "Selling"). The app shows role-appropriate screens via RoleGuard components. **There is no individual data sharing between roles.** A buyer's conversation, strategy, walk-away price, and deal data are never visible to the dealership, and vice versa. The only cross-pollination is anonymized aggregate analytics (e.g. market-level trends). Marketed to each side as a way to get a leg up on the other.

Core differentiator: **real-time, in-person, showroom-floor AI**. No competitor does this. All existing tools are post-deal, VoIP-based, or contact-center-focused.

### Transaction types
- **Dealership purchases** (new and used) — primary use case. Features adapt based on new vs. used: new car deals emphasize MSRP/invoice, manufacturer incentives, and F&I; used car deals emphasize vehicle history, condition assessment, and fair market value.
- **Leases** — dedicated mode for lease-specific math: money factor, residual value, MSD, acquisition fee, disposition fee. Most buyers don't understand lease structure at all.
- **Private party sales** — the vehicle analyzer, "is this a good deal?" benchmark, CARFAX tool, and financing features work for private sales too. Expands addressable market beyond dealerships.

### Device
- Smartphone app for both sides — customers use their own phone, salespeople most likely use their own as well (though dealerships could provide company phones)

### Interaction modes
- **Voice mode** — talk to the AI instead of typing. Useful while driving to the dealer, walking the lot, or when you can't be seen typing. MVP feature.
- **Chat mode** — text-based AI assistant. Universal fallback — no consent issues, works everywhere. Features like Deal Decoder (photo upload), inventory matching, deal structuring, and competitive comparisons work fully in chat mode without any audio dependency. MVP feature.
- **Record and analyze** — customer records the conversation from their phone; AI processes the audio to extract key moments: verbal price agreements, F&I disclosures, add-on pitches, pressure tactics, and anything that contradicts the paperwork. Available to both buyer and dealer sides. Same consent requirements as other audio features apply.
- **Audio mode** — full real-time conversation processing (where recording consent is obtained). Future phase for dealer-side features with on-premise hardware.

### Customer app UI — persistent context alongside chat
The chat is for back-and-forth; the surrounding UI keeps the customer grounded and rational without having to ask.

- **Deal phase indicator** — Researching → At Dealership → Negotiating Price → F&I Office → Signing → Post-Purchase. Each phase auto-surfaces relevant tips and checklists.
- **Your numbers dashboard** — listing price, MSRP, target price, walk-away price, current offer, monthly payment, APR. APR thresholds use named constants (`APR_GOOD_THRESHOLD`, `APR_BAD_THRESHOLD`) for color-coding.
- **Active checklist** — phase-appropriate to-do items that update as you progress. Pre-visit: got pre-approval? checked market value? At dealer: inspected vehicle? test drove? got OTD sheet? F&I: declined add-ons? verified APR? numbers match verbal agreement? Items check off as you go.
- **Vehicle card** — the vehicle you're looking at: year, make, model, trim, mileage, price. Risk flags from CARFAX/vehicle analysis. Market comparison. Swap between vehicles if comparing multiple.
- **Negotiation scorecard** — their starting price → current offer → your target as a visual progress bar. Rate: offered vs. expected. Simple red/yellow/green status on price, rate, and terms.
- **Quick action buttons** — LLM-generated contextual action buttons (2-3 at a time) that update dynamically as the conversation shifts, via the `update_quick_actions` tool. Static fallback actions (per buyer context) show before the first AI exchange or when dynamic actions go stale. Hidden until the first real AI exchange. Disabled during streaming. Staleness threshold: hidden after 3 AI responses without an update (4 for static fallbacks). Data-driven via `FALLBACK_QUICK_ACTIONS` constant for fallbacks.
- **Timer / awareness cues** — how long you've been at the dealership (awareness, not pressure). Reminder if you've been waiting a long time ("they may be using wait time as a tactic").

Design principle: **everything the customer needs to stay rational and informed should be visible without asking for it.**

### Onboarding — buyer context selection (BUILT)
When starting a new chat, the buyer sees three situation cards (WelcomePrompts component):
- **"Researching"** — comparing cars and prices from home. AI is educational and thorough. Dashboard prioritizes vehicle card and numbers.
- **"Have a deal to review"** — buyer has a quote or offer. AI is analytical and direct. Dashboard prioritizes numbers and scorecard.
- **"At the dealership"** — buyer is there right now. AI is brief and tactical with ready-to-use scripts. Dashboard prioritizes scorecard and numbers.

The buyer can skip the cards entirely by typing or uploading directly (defaults to "researching"). Each context gets a hardcoded greeting message (no LLM call), context-specific quick actions, and a system prompt preamble that shapes the AI's tone. The AI can change the context mid-conversation via the `update_buyer_context` tool if the buyer's situation changes.

### Notifications and follow-up
- When a dealer calls or texts after a walk-away, the app should surface a push notification with context: where the deal left off, suggested response, and current recommendation (accept/counter/decline).
- Post-deal notifications: refinance timing reminders, recall alerts, maintenance milestones.

### Session / deal management (BUILT)
- **Chats list as buyer home screen** — the `/(app)/chats` screen is the buyer's landing page, showing all sessions organized into Active and Past sections with search, pull-to-refresh, and rich SessionCard components (phase dot, message preview, deal summary).
- **Auto-generated session titles** — sessions receive automatic titles: deterministic vehicle titles (e.g., "2024 Toyota Camry LE") when a vehicle is set, or LLM-generated via Haiku as a fallback after the first exchange. Manual renames disable auto-titling.
- **"New chat" feature** — start a fresh conversation for a new vehicle or dealer. Users can choose to add previous chats as context (e.g. "I already analyzed this vehicle last night" or "here's what happened at the first dealer").
- Multiple active deals supported — shopping two dealers at once is common.
- Deal history persists — dealer calls a week later, user can pick up where they left off.

---

## Four Priority Features

### 1. Deal Decoder *(build first)*
- Parses bundled deal numbers and explains them in plain English
- Separates payment, price, trade-in, and interest
- **Photo upload:** customers snap photos of dealer paperwork (buyer's orders, F&I worksheets, lease sheets, payment breakdowns) for AI analysis
  - High feasibility — existing multimodal models handle document photo analysis well; works on any smartphone with no custom hardware
  - Low legal risk — no audio recording or consent issues; customer voluntarily uploads their own documents
  - PII handling required — documents may contain SSN, financial data; need clear data policy (ephemeral processing vs. encrypted storage); GLBA may apply
  - Advisory disclaimer required — output cannot be positioned as financial or legal advice
  - Strong effectiveness — meets customers where they are (already taking photos of paperwork); immediate tangible value; potential free/freemium entry point
  - Key validation step: test real-world dealer documents against existing vision models to gauge extraction accuracy before building
- No audio recording required — lowest legal risk
- Gap: all existing tools (Tekion, AutoFi, RouteOne) are dealer-centric; no independent buyer-facing tool exists

### 2. Live Objection Coach *(build second)*
- Listens to in-person conversation in real time
- Detects spoken objections and displays proven responses to the salesperson
- Target latency: <300ms p95
- Gap: Gong, Balto, Cresta all built for VoIP contact centers — nothing for in-person showroom

### 3. Customer Intel Logger *(build third)*
- Captures buyer signals and preferences during conversation
- Auto-writes structured data to dealer CRM (VinSolutions, DealerSocket)
- Gap: all automotive CRMs require manual entry; no automated in-person capture exists
- Structured leads close 15% higher than unstructured

### 4. F&I Add-on Scanner *(build fourth)*
- Listens to finance office conversation in real time
- Flags unauthorized or undisclosed charges against spoken consent
- Highest customer impact (~$2,000 avg overcharge prevented)
- Gap: all existing compliance tools (ComplyAuto, Dealertrack) are post-deal only
- Build last due to highest legal complexity

### Manager Tools *(cross-cutting, builds on features 2 & 3)*
- **Live conversation summary for managers** — real-time digest of active deals on the floor: buyer objections, preferences, where the deal stands, what the customer is stuck on. Gives managers context before a T.O. so they arrive already informed.
- **"Get manager" button** — one-tap alert from salesperson to manager, delivered with the conversation summary attached. Eliminates the dead time of physically finding a manager and the "let me go talk to my manager" moment buyers dislike.
- Feasibility: both are downstream outputs of the same real-time conversation pipeline the Objection Coach and Intel Logger already require — no major new technical requirements
- Legality: inherits consent from the audio features; no new legal surface
- Effectiveness: manager T.O.s are one of the highest-leverage moments in a deal; arming them with context before they engage should improve close rates and help managers prioritize across multiple active deals

### Buyer Communication Insights *(cross-cutting, builds on features 2 & 3)*
- Infer buyer communication style, decision-making patterns, and emotional drivers from conversation data (e.g. "price-driven and analytical" vs. "emotionally attached to the vehicle, needs reassurance")
- Help salesperson/manager adapt their approach to the individual buyer in real time
- Feasibility: another analysis layer on the existing conversation pipeline — no new hardware or infrastructure needed
- Legality: **requires careful scoping**
  - Must be framed as "communication style insights" or "buyer preference signals" — not "psychological profiling"
  - BIPA risk if classifying traits from voice patterns (tone, cadence, stress) — may exceed recording consent scope
  - FTC Section 5 risk if framed as manipulation rather than communication adaptation
  - Discrimination risk if profiling correlates with protected characteristics — fair lending and civil rights exposure, especially in F&I
  - Emerging state legislation around AI-driven profiling in sales contexts
- Effectiveness: high potential — good salespeople already read and adapt to customers intuitively; AI assistance could close the gap for less experienced reps. Key question: does AI-assisted insight meaningfully outperform experienced intuition, and is the incremental lift worth the legal/reputational risk?

### Additional AI Features *(brainstorm — needs feasibility/legality/effectiveness analysis)*

**Pre-visit:**
- **Inventory matching** — customer describes what they want (budget, needs, preferences) and AI recommends specific vehicles from the dealer's live inventory. Saves the "let me show you what we have" wandering.
- **Trade-in estimator** — customer uploads photos of their current vehicle and AI gives a preliminary value range using market data (KBB, Manheim auction prices). Sets expectations before they walk in.

**On the floor:**
- **Competitive comparison assistant** — when a buyer mentions a competing vehicle or dealer offer, AI pulls real-time specs, pricing, and incentive comparisons so the salesperson can respond immediately instead of guessing.
- **Incentive/rebate finder** — cross-references buyer profile (zip code, credit tier, military/student status, loyalty) against current OEM incentives to surface money the buyer didn't know they qualified for. Builds trust and lowers the effective price.
- **Deal structuring suggestions** — given the buyer's stated budget and the vehicle price, AI suggests multiple deal structures (lease vs. finance, different terms, money down scenarios) that hit the buyer's payment target.
- **Language translation** — real-time translation for non-English-speaking buyers. The audio pipeline is already there; high value in markets with large multilingual populations.
- **Credit pre-qualification guidance** — based on what the buyer shares conversationally (income, employment, credit range), AI suggests which lenders and programs they're likely to qualify for, so the salesperson steers toward realistic vehicles and avoids the "let me run your credit" awkwardness too early.

**F&I office:**
- **Product recommendation engine** — instead of the standard menu-sell of every add-on, AI recommends F&I products that actually make sense for the buyer's situation (e.g. GAP for negative equity, extended warranty for high-mileage drivers). Could increase attach rates while reducing the "hard sell everything" dynamic that triggers FTC scrutiny.

**Post-sale:**
- **Follow-up intelligence** — after the deal, AI generates a personalized follow-up plan: service reminders, lease-end timing, equity alerts when market conditions favor a trade-up. Keeps the customer in the dealer's ecosystem.
- **CSI score predictor** — based on the conversation, predict the customer's likely satisfaction survey score and flag deals at risk of a bad review so the dealer can intervene before the survey goes out. CSI scores directly affect OEM allocation, so this has real financial impact.

**Compliance:**
- **Red flag identity verification** — flag inconsistencies between what the buyer says and what's on their documents, helping comply with the FTC Red Flags Rule for identity theft prevention.

**Customer tools:**
- **"Is this a good deal?" benchmark** — customer enters vehicle, mileage, and price; AI compares against recent actual transaction data (not listing prices) to show where the deal falls in their market.
- **Negotiation coach** — real-time chat guidance on what to say next, what to push back on, when to walk away. The buyer's equivalent of the salesperson's Objection Coach.
- **Financing comparison** — customer inputs the dealer's offered rate/terms and AI compares against current credit union, bank, and manufacturer incentive rates they may qualify for.
- **"What am I forgetting?" checklist** — AI-generated checklist based on the specific deal: gap insurance pricing elsewhere? Warranty manufacturer-backed or third-party? Trade-in payoff confirmed? Especially valuable for first-time buyers.
- **Contract review before signing** — photo upload of the final contract, AI cross-checks against what was verbally agreed to during the deal. Catches last-minute changes to terms, added products, or different numbers.
- **CARFAX / vehicle history analyzer** — enter a VIN, vehicle details (year/make/model/trim/mileage/condition), or upload a CARFAX report; AI interprets service patterns, flags red flags (repeated repairs, auction cycling, missing maintenance), and assesses overall risk. Validated: founder used this to compare two trucks and the AI caught coil/plug replacement patterns, catalytic converter work, and auction cycling as risk signals.
- **APR/rate validator** — input credit score + vehicle details + dealer's offered rate; AI tells you if you're being marked up and what rate you should realistically expect given your profile and the vehicle. Validated: caught a 9.99% markup on an 800 credit score — saved ~$2k-$3k.
- **Walk-away advisor** — based on deal parameters (price, condition, mileage, market data), AI explicitly recommends "walk" or "stay" and coaches through emotional pressure (sunk cost, time invested, salesperson tactics). Validated: this was the single most valuable function during a real deal — countered a 3-hour drive sunk cost and end-of-day pressure.
- **Pre-visit game plan** — input the vehicle, budget, trade-in situation, and financing status; AI generates a complete strategy: target price, walk-away price, negotiation phases, inspection checklist, and suggested scripts.
- **Post-purchase checklist** — after the deal, AI generates action items: verify contract matches verbal agreement, refinance timeline and target rate, immediate maintenance needs based on vehicle history, tire/windshield/recall status.
- **Vehicle comparison tool** — compare two or more vehicles side-by-side using CARFAX data, price, mileage, maintenance history, and risk assessment to decide which to pursue.

**Dealer tools:**
- **Lead scoring/prioritization** — based on conversation signals, predict which customers on the lot are most likely to buy today vs. just browsing. Helps managers allocate closers to the hottest deals.
- **Desking assistant** — salesperson inputs deal parameters and AI instantly generates multiple desk scenarios (payment options, term variations, trade adjustments) formatted for the customer pencil. Speeds up back-and-forth between desk and floor.

**Both sides:**
- **Deal timeline tracker** — shows both parties where they are in the process, what's left, and estimated time remaining. Reduces the "I've been here for 4 hours" frustration that kills CSI scores and buyer goodwill.

**Training:**
- **AI training simulations** — salespeople practice against AI-generated customer scenarios ("handle this objection about the interest rate", "this buyer says the dealer across town offered $2k less"). Cheaper and more scalable than ride-alongs or role-plays. MVP feature for dealer app.
- **Deal replay and coaching** — after a lost deal, AI analyzes the conversation and identifies where the sale went sideways: missed buying signals, objections handled poorly, price presented too early. Turns every interaction into a training opportunity without a manager having to sit in.

**Buyer power features:**
- **"Beat this deal" broadcaster** — buyer sends their current offer to other dealers in the area and lets them compete. Flips the power dynamic entirely.
- **Total cost of ownership calculator** — not just the purchase price, but projected fuel, insurance, maintenance, and depreciation over the ownership period. "This truck costs $34k to buy but $58k to own for 5 years."
- **Insurance quote integration** — get insurance quotes inside the app before signing. Dealers rush this step and buyers often don't realize what insurance will cost until after.
- **Aftermarket warranty marketplace** — instead of just declining the dealer's warranty, compare third-party warranty options at real prices. Turns a "no" into an informed decision.
- **PPI booking** — book a pre-purchase inspection with a nearby mechanic directly from the app. One of the most common pieces of advice buyers skip because it's friction.
- **"Beat my rate" for financing** — after the dealer offers a rate, the app checks partner credit unions and lenders for better rates. Not just education — actual instant pre-qualification.

**Dealer power features:**
- **AI-generated follow-up messages** — personalized based on the actual conversation. "Hey Mike, I know you were concerned about the mileage — here's the extended service history I mentioned."
- **Competitive intelligence dashboard** — anonymized and aggregated: "buyers in your market are most commonly comparing you to [competitor dealer]", "the most cited reason for walking this month is price."
- **Automated BDC responses** — AI handles initial internet lead responses with context-aware personalization instead of generic templates.

**Viral / growth features:**
- **"Decode this" social feature** — users share a photo of their deal sheet, the AI decodes it publicly (anonymized). Taps into the "did I get screwed?" content that already gets massive engagement on TikTok/Reddit.
- **Deal score** — after a purchase, rate how good your deal was vs. other buyers of the same vehicle in your market. "You scored in the top 15% of F-250 Lariat deals this month." Shareable.
- **Savings tracker** — lifetime savings from using the app. "You've saved $4,200 across 2 deals." Retention hook and social proof.
- **Model-specific buyer guides** — known issues, fair prices, what to check for each vehicle. SEO content that drives app downloads.

**Platform plays:**
- **Lender partnerships** — direct integration with credit unions for instant in-app pre-qualification. Not "go apply somewhere" but "you're approved at 5.2% right now."
- **Mechanic network** — partner with inspection services (Lemon Squad, mobile mechanics) for one-tap PPI booking.
- **Data licensing** — anonymized market intelligence sold to OEMs, lenders, or automotive analysts. Additional revenue stream from the data moat.

**UX innovations:**
- **Wearable integration** — Apple Watch notifications for salespeople. Glanceable objection responses without pulling out a phone.
- **AR vehicle overlay** — point camera at a car on the lot, get instant market data, known issues, and fair price range overlaid.

**Stretch goals:**
- **Floor traffic analytics** — track conversations, average deal time, conversion funnel stage per customer. Real-time showroom activity dashboard for managers.
- **Pricing intelligence** — monitor local market pricing (competing dealers, online listings) and alert when the dealer's pricing is out of range on specific units.

**Far future:**
- **Compliance audit trail** — automatically document every disclosure, consent, and customer interaction for regulatory protection. Complete timestamped record if FTC or state AG investigates.

---

## Analytics & Learning

The AI should get smarter over time based on real deal outcomes. This is also a competitive moat — the more deals flow through the app, the better the advice gets, and no competitor can replicate that dataset from scratch.

### Buyer-side analytics
- **Outcome tracking** — did the dealer call back after a walk-away? How long did it take? Final price vs. initial offer vs. AI's recommended target. Final APR vs. first offered rate. Did they refinance later?
- **Tactic effectiveness** — which negotiation scripts led to price movement? Did walking away result in a callback? Did mentioning CARFAX findings move the price? Did pre-approval change the dealer's offered rate?
- **Pattern recognition** — callback rates by dealer, region, vehicle type. Average markup by dealership (with enough users). Common F&I add-on patterns. Which dealerships negotiate vs. hold firm. Time-of-day and day-of-week effects.
- **What the AI learns** — when to recommend walking vs. staying (calibrated by actual outcomes). More accurate "fair price" ranges from real transactions. Dealer-specific intelligence ("this dealer typically calls back within 2 hours"). Regional financing markup patterns.

### Dealer-side analytics
- **Sales effectiveness** — which objection responses led to closes vs. lost deals? Average time-to-close by salesperson, vehicle type, customer profile. Where in the process deals fall apart most often.
- **F&I performance** — which products get accepted vs. declined, and at what price points? Optimal pricing for attachment rates.
- **Manager insights** — T.O. effectiveness and optimal timing. Salesperson performance patterns by deal phase. Who needs coaching where.
- **Customer intelligence** — which communication styles/approaches work for different buyer types? Lead quality signals that predict a close. Customer sentiment trends (arriving more informed, more resistant, more price-anchored?).
- **Lost deal analysis** — common reasons, patterns by vehicle type or price range. Recoverable vs. unrecoverable deals.

### Cross-side intelligence (anonymized)
- Both apps generate data from both sides of the same interaction type — powerful in aggregate
- "Buyers who walk away from this price range on this vehicle type come back X% of the time"
- Market-level insights for dealers: "buyers in your market are increasingly arriving with pre-approval", "most common objection this month is X"

### Privacy considerations
- All buyer analytics anonymized — no PII tied to analytics
- Users opt in and understand what's being captured
- Dealer-specific intelligence is sensitive — need to assess legal exposure of surfacing it to buyers
- Individual salesperson performance data needs role-based access (managers see team, salespeople see own)
- No cross-referencing buyer app data with dealer app data at the individual level
- Dealer data stays within that dealership/group — not shared with competitors

---

## Market Context
- FTC warned 97 auto dealer groups about deceptive pricing — March 2026
- FTC CARS Rule vacated Jan 2025, withdrawn Feb 2026 — but Section 5 enforcement continues
- 68–80% of customers charged for unconsented add-ons in recent FTC settlements
- ~$2,000 average overcharge per transaction
- 76% of buyers don't trust dealerships to be honest about pricing
- 75% of salespeople only know one close; coaching lifts close rates 7–30%

---

## Technical Architecture

### Primary platform — smartphone app (MVP and beyond)
- Both buyer and dealer apps run on users' own smartphones
- Chat mode + photo upload requires no special hardware — cloud-based LLM processing only
- Record and analyze mode uses the phone's microphone — audio sent to cloud ASR for processing
- OCR / multimodal vision models for document and deal sheet photo analysis

### Audio processing (for record/analyze and real-time features)
- **ASR:** Start with Deepgram Nova-3 or AssemblyAI Universal-2; migrate to fine-tuned Whisper for edge
- **Target accuracy:** >90% WER with domain tuning (general ASR hits 70–85% in showroom noise)
- Speaker diarization + NER + intent classification + confidence gating

### Edge hardware (future — dealer-side audio features only)
- Beamforming microphone arrays (Shure MXA or Sennheiser TCC) — for showroom-wide audio capture
- Lapel mics for salespeople
- On-site edge gateway: NVIDIA Jetson AGX Orin-class
- Edge-first hybrid architecture — raw audio stays on-premise, cloud handles async LLM, storage, CRM sync
- Only required for Live Objection Coach, Customer Intel Logger, F&I Scanner at scale

### Key integrations
- DMS: Dealertrack, RouteOne
- CRM: VinSolutions, DealerSocket
- OCR for contract/document parsing
- Market data: real transaction prices, credit union rates, OEM incentives (sources TBD)

---

## Legal & Compliance

### Recording consent by state
| State | Requirement | Key law |
|-------|-------------|---------|
| California | All-party | Penal Code §632 |
| Illinois | All-party | 720 ILCS 5/14-2 |
| Illinois (biometrics) | Written release | BIPA 740 ILCS 14 |
| Texas | One-party | Penal Code §16.02 |

### Critical requirements
- **Geo-aware consent flow** — detect state, trigger correct consent before any audio capture
- **BIPA compliance** — voiceprints are biometric identifiers in IL; written consent + retention schedule required
- **Default to all-party** in ambiguous situations
- **GLBA Safeguards** — conversations contain NPI; encryption + access controls required
- **TCPA/CCPA** — marketing opt-ins captured separately from recording consent
- **Advisory disclaimers** on Deal Decoder output (not legal/financial advice)
- Maintain auditable chain-of-custody for all recordings and consent receipts

---

## Business Model

### Two role-based experiences in one app
- **Buyer experience** — buyer-side features (Deal Decoder, F&I Scanner, competitive comparisons, etc.). Consumer subscription.
- **Dealer experience** — salesperson/manager-side features (Objection Coach, Intel Logger, Manager Tools, etc.). Dealer subscription.
- Marketed to each side as a way to get a leg up on the other — creates natural demand from both directions

### Liability
- AI output positioned as informational, not advisory — liability stays with the user
- Advisory disclaimers required on all analysis (not legal, financial, or professional advice)
- Needs legal review to confirm this holds up across states

### Go-to-market
- Early signal is strong — pitched to a salesman during a truck purchase (March 2026) and got immediate interest
- First-to-market advantage in the in-person showroom AI space
- Competitive moat TBD — need to think through defensibility once the market is proven

### ROI levers
- Risk reduction: mitigate FTC fines, chargebacks, refunds
- Revenue: 7–30% conversion lift, faster new rep ramp, automated CRM entry

---

## Recommended Build Sequence
1. **Deal Decoder** — no recording, high buyer value, low legal risk; ship while building legal infra
2. **Live Objection Coach** — medium legal risk; requires consent flow and hardware
3. **Customer Intel Logger** — medium legal risk; requires CRM integrations
4. **F&I Add-on Scanner** — highest impact but highest legal complexity; build last

---

## Key Risks
| Risk | Severity | Mitigation |
|------|----------|------------|
| CA/IL all-party consent violations | Critical | Geo-detect + consent-first architecture |
| BIPA violations (IL) | Critical | Written consent + retention policy before any IL capture |
| ASR accuracy in noisy rooms | High | Beamforming hardware + domain-tuned models |
| Rep resistance to coaching | High | Bone-conduction earpiece, configurable prompt density, frame as personal assistant |
| GLBA/TCPA/CCPA exposure | High | Separate consent flows, data retention policies, DSAR templates |

---

## Pilot Plan

### Phase 1 — MVP (chat-based buyer app, no audio)
- Ship Deal Decoder + chat mode + persistent UI
- Test with real buyers (founder + early testers including salesman contact from March 2026)
- Measure: downloads, engagement, willingness to pay, deal outcomes
- No hardware, no consent complexity, no integrations

### Phase 2 — Record and analyze + dealer app
- Add record and analyze mode to buyer app (requires consent flow)
- Launch dealer app with core features (Objection Coach, Intel Logger in chat mode first)
- Begin analytics collection from both sides

### Phase 3 — Full audio features (dealer-side hardware)
- Hardware install: beamforming mics, edge gateway
- Audio/data collection, model fine-tuning, hit <10% WER and <300ms p95
- Live A/B tests, compliance audits, measure close rate lift and F&I dispute reduction
- Go/no-go: evaluate KPIs, then scale to dealer group or OEM network

---

## Sources
- FTC: https://www.ftc.gov/news-events/news/press-releases/2026/03/ftc-warns-97-auto-dealership-groups-about-deceptive-pricing
- CA recording law: https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=632.&lawCode=PEN
- IL recording law / BIPA: https://illinois-auto-dealer-news.thenewslinkgroup.org/counselors-corner-legal-pitfalls-of-recording-vehicle-purchase-or-lease-transactions/
- TX recording law: https://guides.sll.texas.gov/recording-laws/audio-recording
- ASR benchmarks: https://www.assemblyai.com/blog/how-accurate-speech-to-text
- Leader Automotive FTC settlement: https://www.ftc.gov/news-events/news/press-releases/2024/12/ftc-illinois-take-action-against-leader-automotive-group-overcharging-deceiving-consumers-through