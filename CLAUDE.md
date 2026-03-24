# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Dealership AI** — two completely separate AI-powered smartphone apps for the car buying experience:
- **Customer app** — helps buyers understand deals, spot unauthorized charges, avoid manipulation, and negotiate effectively. Consumer subscription.
- **Dealer app** — helps salespeople handle objections, capture customer intelligence, and close deals. Dealer subscription.

**These are independent products with no individual data sharing.** A buyer's conversation, strategy, walk-away price, and deal data are never visible to the dealership, and vice versa. The only cross-pollination is anonymized aggregate analytics. Marketed to each side as a way to get a leg up on the other.

Supports dealership purchases (new and used — features adapt accordingly), leases (dedicated mode for lease-specific math), and private party sales. Core differentiator: real-time, in-person showroom-floor AI. No competitor addresses in-person showroom interactions; all existing tools are post-deal, VoIP-based, or contact-center-focused.

## Current State

This project is in the **research and planning phase** — no source code, build system, or dependencies exist yet.

### Key artifacts
- `notes.md` — project vision, features, architecture, legal requirements, business model, and analytics strategy
- `user-stories.md` — user stories organized by persona (buyer, salesperson, manager, compliance officer) and deal phase
- `mvp.md` — MVP scope candidates and open questions
- `user-research.md` — real-world validation from founder's truck purchase using ChatGPT as a live buying assistant
- `research.json` — comprehensive research output (2.2 MB) covering feasibility, technical requirements, legal analysis, market context, and competitor landscape
- `chatgpt-convo.txt` — raw conversation transcript from the real deal session

## Interaction Modes

1. **Voice mode** — talk to the AI instead of typing. Useful while driving, walking the lot, or when typing isn't discreet. MVP feature.
2. **Chat mode** — text-based AI assistant. Universal fallback — no consent issues, no hardware, works everywhere. MVP feature.
3. **Record and analyze** — customer records conversation from their phone; AI processes audio for key moments (verbal agreements, F&I disclosures, pressure tactics, contradictions with paperwork). Requires consent.
4. **Audio mode** — full real-time conversation processing with on-premise hardware. Future phase for dealer-side features.

## Customer App — Persistent UI

The customer app is not just a chatbot. Alongside the chat, persistent UI elements keep the buyer grounded: deal phase indicator, numbers dashboard (target/walk-away/current offer/OTD), active checklist, vehicle card, negotiation scorecard with red/yellow/green indicators, quick action buttons, and dealership timer. Design principle: everything the customer needs to stay rational should be visible without asking.

## Build Priority

### Phase 1 — MVP
- **Buyer app:** Deal Decoder (photo upload) + voice mode + chat mode + persistent UI + core customer tools (negotiation coach, APR validator, walk-away advisor, vehicle analyzer, deal benchmark, checklists)
- **Dealer app:** AI training simulations (salespeople practice against AI-generated customer scenarios)

### Phase 2 — Record and analyze + expanded dealer app
Add audio recording to buyer app. Expand dealer app with Objection Coach, Intel Logger. Begin analytics collection.

### Phase 3 — Full audio features (dealer-side hardware)
On-premise hardware (beamforming mics, edge gateway). Real-time ASR pipeline. F&I Scanner. Manager Tools.

## Architecture

- **MVP:** Smartphone apps → cloud LLM + multimodal vision for document/photo analysis
- **Audio features:** Phone mic → cloud ASR (Deepgram Nova-3 or AssemblyAI Universal-2) → NLP pipeline
- **Future edge:** NVIDIA Jetson AGX Orin + beamforming mics for dealer-side real-time features only
- **Integrations:** DMS (Dealertrack, RouteOne), CRM (VinSolutions, DealerSocket), OCR, market data (transaction prices, credit union rates, OEM incentives — sources TBD)

## Analytics & Learning

Both apps collect anonymized deal outcome data to make the AI smarter over time: tactic effectiveness, callback rates after walk-aways, dealer-specific patterns, regional financing markup trends. This is a competitive moat — more deals = better advice. Privacy: all buyer data anonymized, opt-in, no cross-referencing individual buyer/dealer data, dealer data stays within their organization.

## Legal & Compliance (Critical)

**Consent is a hard prerequisite for any audio feature.** All audio features must implement a geo-aware consent flow.

- California and Illinois require **all-party consent** for recording
- Illinois BIPA classifies voiceprints as biometric identifiers — **written consent + retention schedule** required
- Default to all-party consent in ambiguous jurisdictions
- GLBA Safeguards apply — encryption + access controls required
- TCPA/CCPA marketing opt-ins captured separately from recording consent
- All AI output requires advisory disclaimers (not legal, financial, or professional advice)
- Liability positioned as informational, not advisory — needs legal review across states
