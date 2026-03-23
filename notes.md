# AI Car Buying App — Project Notes

## Last updated: March 23, 2026

---

## Concept
An AI-powered app for the car buying experience with two user types:
- **Customer (buyer)** — helps them understand the deal, spot unauthorized charges, and avoid manipulation
- **Salesperson (dealer)** — helps them handle objections in real time and capture customer intelligence

Core differentiator: **real-time, in-person, showroom-floor AI**. No competitor does this. All existing tools are post-deal, VoIP-based, or contact-center-focused.

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

### Hardware (per install)
- Beamforming microphone arrays (Shure MXA or Sennheiser TCC)
- Lapel mics for salespeople
- On-site edge gateway: NVIDIA Jetson AGX Orin-class

### Software stack
- **ASR:** Start with Deepgram Nova-3 or AssemblyAI Universal-2; migrate to fine-tuned Whisper for edge
- **Target accuracy:** >90% WER with domain tuning (general ASR hits 70–85% in showroom noise)
- **Architecture:** Edge-first hybrid — raw audio stays on-premise, cloud handles async LLM, storage, CRM sync
- Speaker diarization + NER + intent classification + confidence gating

### Key integrations
- DMS: Dealertrack, RouteOne
- CRM: VinSolutions, DealerSocket
- OCR for contract parsing

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

### Two product suites
- **Compliance Suite** (F&I Scanner + Deal Decoder): per-store monthly SaaS, tiered by deal volume
- **Sales Performance Suite** (Live Coach + Intel Logger): per-seat/month + hardware bundle add-ons

### Primary B2B buyers
- Dealer principals and group owners
- General sales managers
- Compliance officers (especially in large dealer groups)

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
- **Week 0–2:** Consent assets, hardware install, baseline metrics
- **Week 3–8:** Audio/data collection, model fine-tuning, hit <10% WER and <300ms p95
- **Week 9–12:** Live A/B tests, compliance audits, measure close rate lift and F&I dispute reduction
- **Go/no-go:** Evaluate KPIs, then scale to dealer group or OEM network

---

## Sources
- FTC: https://www.ftc.gov/news-events/news/press-releases/2026/03/ftc-warns-97-auto-dealership-groups-about-deceptive-pricing
- CA recording law: https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=632.&lawCode=PEN
- IL recording law / BIPA: https://illinois-auto-dealer-news.thenewslinkgroup.org/counselors-corner-legal-pitfalls-of-recording-vehicle-purchase-or-lease-transactions/
- TX recording law: https://guides.sll.texas.gov/recording-laws/audio-recording
- ASR benchmarks: https://www.assemblyai.com/blog/how-accurate-speech-to-text
- Leader Automotive FTC settlement: https://www.ftc.gov/news-events/news/press-releases/2024/12/ftc-illinois-take-action-against-leader-automotive-group-overcharging-deceiving-consumers-through