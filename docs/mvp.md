# MVP — Minimum Viable Product

## Goal
Define the smallest thing we can ship to prove demand before investing in audio pipelines, hardware, CRM integrations, or legal infrastructure.

## Technical Stack
- **Frontend:** React Native + Expo (iOS, Android, and web from one codebase)
- **Backend:** FastAPI (Python)
- **Database:** PostgreSQL via Supabase (free tier — includes auth, storage, realtime)
- **AI:** Claude API (vision for photo analysis, structured reasoning for everything else, pay-per-use)
- **Voice mode:** On-device speech-to-text → text to Claude (no separate ASR service needed)
- **Hosting:** FastAPI on Railway or Fly.io (free tier), Expo web on Vercel (free tier)

## Open Questions
- Which side do we launch first — buyer app, dealer app, or both? (Leaning toward two separate products — see notes.md Business Model)
- Is Deal Decoder with photo upload + chat mode enough to prove demand?
- What does "proving demand" look like — downloads, engagement, willingness to pay, retention?
- Do we launch as a mobile app, web app, or both?
- Free tier vs. paid from day one?
- What markets/states do we target first to minimize legal complexity?
- When do we start collecting analytics — from day one, or after core features are proven?
- Data sources for real transaction prices, credit union rates, OEM incentives — TBD
- Buyer retention model — people buy cars every 3-7 years; what keeps them engaged between purchases? (Subscription vs. pay-per-use, help friends/family, refinance monitoring, service visit analysis, trade-in timing) — TBD

## Candidates for MVP Scope
*(to be narrowed down)*

**Lowest complexity (no audio, no integrations):**
- Voice mode — talk to the AI instead of typing (uses phone speech-to-text, no recording consent needed)
- Deal Decoder — photo upload + chat mode
- Competitive comparison assistant (chat-based)
- Deal structuring suggestions (chat-based)
- "Is this a good deal?" benchmark (chat-based)
- CARFAX / vehicle history analyzer (VIN or manual vehicle details)
- APR/rate validator (chat-based)
- Negotiation coach (chat-based scripts)
- Walk-away advisor (chat-based)
- Pre-visit game plan generator (chat-based)
- "What am I forgetting?" checklist (chat-based)
- Vehicle comparison tool (chat-based)
- Post-purchase checklist (chat-based)

**Lowest complexity — persistent UI (alongside chat):**
- Deal phase indicator (Researching → At Dealership → Negotiating → F&I → Signing → Post-Purchase)
- Your numbers dashboard (target price, walk-away price, current offer, OTD calculation)
- Active checklist (phase-appropriate, auto-updating)
- Vehicle card (specs, price, risk flags, market comparison)
- Negotiation scorecard (visual progress: their price → current offer → your target)
- Red/yellow/green deal status indicators (price, rate, terms)
- Quick action buttons (Analyze photo, What do I say?, Should I walk?)
- Dealership timer + wait-time awareness cues

**Medium complexity (still no audio):**
- Trade-in estimator (photo upload)
- Inventory matching (requires dealer inventory data)
- Incentive/rebate finder (requires OEM incentive data)
- Contract review before signing (photo upload + cross-check against deal state)
- Record and analyze mode (requires consent flow, phone mic audio → cloud ASR)
- Basic analytics collection (deal outcomes, tactic effectiveness — opt-in)

**Higher complexity (audio or integrations required):**
- Live Objection Coach
- Customer Intel Logger
- F&I Add-on Scanner
- Manager Tools
- Full analytics & learning pipeline (cross-side intelligence, dealer-specific patterns)
- Dealer app (separate product — Objection Coach, Intel Logger, Manager Tools, dealer analytics)

**Dealer MVP (lowest complexity):**
- AI training simulations — salespeople practice against AI-generated customer scenarios (no audio needed, chat/voice based)

## Notes
- Chat mode + photo upload is the path of least resistance — no consent issues, no hardware, works everywhere
- The salesman who expressed interest (March 2026) could be an early tester
- The persistent UI elements are what differentiate this from "just chatting with ChatGPT" — they provide always-visible context that keeps the buyer grounded and rational
- Most of the lowest-complexity features were validated in a real deal session (see user-research.md)
