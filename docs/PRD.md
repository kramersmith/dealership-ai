# Product Requirements Document: Dealership AI

**Last updated:** 2026-03-26

---

## Table of Contents

- [1. Overview & Vision](#1-overview--vision)
- [2. Target Users & Personas](#2-target-users--personas)
- [3. User Journeys](#3-user-journeys)
- [4. Feature Catalog](#4-feature-catalog)
- [5. Success Metrics](#5-success-metrics)
- [6. Out-of-Scope / Roadmap](#6-out-of-scope--roadmap)

---

## 1. Overview & Vision

### Problem

The car buying process is built on information asymmetry. Dealers control pricing, financing, and add-on structures that most buyers do not understand. The result: an average overcharge of $2,000 per transaction, 68-80% of customers charged for unconsented add-ons (per FTC settlements), and 76% of buyers who do not trust dealerships to be honest about pricing.

In March 2026, the FTC warned 97 auto dealer groups about deceptive pricing practices. Despite regulatory attention, no consumer tool exists for real-time assistance during in-person dealership visits. All existing products are post-deal, VoIP-based, or dealer-centric.

On the dealer side, 75% of salespeople know only one closing technique. Coaching lifts close rates 7-30%, but traditional training (ride-alongs, role-plays) is expensive and unscalable.

### Vision

Dealership AI is a real-time AI co-pilot that turns information asymmetry into buyer advantage, while giving salespeople scalable AI training to improve their skills.

A single smartphone app serves both sides of the transaction with role-based access:

- **Buyer experience** — an AI advisor that helps buyers understand deals, spot unauthorized charges, and negotiate with confidence, right from the showroom floor.
- **Dealer experience** — AI-powered training simulations where salespeople practice against realistic customer scenarios to sharpen objection handling and close rates.

Users select their role ("Buying" or "Selling") at registration, which determines the screens and features available to them. There is no individual data sharing between roles. A buyer's conversation, strategy, and deal data are never visible to the dealership, and vice versa.

### Founder Validation

The concept was validated during a real truck purchase in March 2026. The AI caught a 9.99% interest rate markup on an 800 credit score (saving $2,000-$3,000), identified vehicle history red flags (coil/plug patterns, catalytic converter work, auction cycling), and provided walk-away coaching that countered sunk-cost pressure after a 3-hour drive.

### Core Differentiator

Real-time, in-person, showroom-floor AI. No competitor operates in this space. All existing tools (Gong, Balto, Cresta, Tekion, AutoFi, RouteOne) are built for VoIP contact centers, post-deal analysis, or dealer-side workflows.

---

## 2. Target Users & Personas

### Persona 1: Car Buyer (Primary)

**Profile:** Any consumer purchasing or leasing a vehicle from a dealership or private party. Ranges from first-time buyers with no knowledge of deal structures to experienced buyers who want data-backed confirmation.

**Pain points:**
- Cannot parse bundled deal numbers (payment, price, trade-in, interest are obscured)
- Does not know if the offered interest rate is fair for their credit profile
- Feels pressured by time tactics, sunk cost, and information asymmetry
- Cannot identify unauthorized add-ons or charges in F&I
- Has no real-time support during the negotiation itself

**Goals:**
- Understand every number on the deal sheet in plain English
- Know their target price, walk-away price, and whether to accept or counter
- Catch overcharges and unauthorized add-ons before signing
- Negotiate from a position of knowledge, not anxiety

**Context of use:** On their phone at the dealership — in the parking lot, on the showroom floor, in the F&I office, or while waiting. Also used the night before for pre-visit preparation.

### Persona 2: Car Salesperson

**Profile:** Dealership sales staff, from new hires to experienced reps. Works on the showroom floor and needs to handle objections, build rapport, and close deals daily.

**Pain points:**
- Limited training beyond initial onboarding
- No way to practice objection handling without a live customer
- Feedback on lost deals is anecdotal, not systematic
- Manager ride-alongs are infrequent and time-consuming

**Goals:**
- Practice against realistic AI customer scenarios on their own time
- Improve objection handling for common situations (price, rate, trade-in, competing offers)
- Build confidence before facing real customers
- Track improvement over time

**Context of use:** On their phone during downtime at the dealership, between customers, or at home.

### Persona 3: Sales Manager

**Profile:** Manages a team of salespeople at a dealership or dealer group. Responsible for training, floor management, and close rates.

**Pain points:**
- Training is expensive and inconsistent across the team
- Cannot observe every deal or provide real-time coaching
- New hires take months to ramp
- No data on where individual reps struggle

**Goals:**
- Provide scalable, consistent training across the team
- Identify skill gaps for individual reps
- Reduce new-hire ramp time
- Improve team close rates measurably

**Context of use:** Reviews simulation results and team performance. Assigns specific training scenarios.

---

## 3. User Journeys

### Journey 1: Pre-Visit Preparation (Buyer)

1. Buyer opens the app and sees three situation cards: "Researching", "Have a deal to review", "At the dealership". Selects "Researching" (or skips by typing directly).
2. A context-appropriate greeting appears instantly (no LLM call). Tells the AI what vehicle they are considering, their budget, and financing situation.
3. AI populates the vehicle card and sets target/walk-away prices on the dashboard.
4. AI generates a pre-visit checklist: get pre-approval, check market value, review vehicle history, prepare questions.
5. Buyer reviews the game plan and checklist. Dashboard shows deal phase as "Researching."
6. Session persists — buyer picks it up at the dealership the next day.

### Journey 2: At the Dealership (Buyer)

1. Buyer arrives at the dealership and opens their existing session (or starts a new session and selects "At the dealership" from the welcome prompts).
2. Dashboard reorders to prioritize scorecard and numbers. Quick actions show dealership-specific options ("What Do I Say?", "Should I Walk?", "They're Pressuring Me"). Checklist updates with on-site items.
3. Buyer chats with the AI as the deal progresses: "They're offering $34,000" or "The rate they quoted is 7.5%."
4. AI automatically updates the numbers dashboard, scorecard (green/yellow/red), and checklist via tool calls.
5. Buyer uses quick actions: "What do I say?", "Should I walk?", or "Analyze this photo."
6. Buyer photographs the deal sheet. AI decodes it, populates all dashboard fields, and flags discrepancies.
7. Timer tracks time at the dealership. AI alerts if wait time suggests a pressure tactic.
8. When the deal reaches F&I, the phase updates and the checklist surfaces F&I-specific items (verify APR, decline unnecessary add-ons, confirm numbers match verbal agreement).

### Journey 3: Deal Decoder Photo Upload (Buyer)

1. Buyer is handed a buyer's order, F&I worksheet, or payment breakdown.
2. Taps "Analyze this photo" quick action and photographs the document.
3. AI processes the image using multimodal vision, extracts all numbers and terms.
4. AI explains the deal in plain English: vehicle price, trade-in credit, taxes, fees, add-ons, monthly payment breakdown.
5. Dashboard updates in one shot: vehicle card, numbers, scorecard, checklist.
6. AI flags anything concerning: unauthorized add-ons, inflated fees, rate markup, numbers that do not match verbal agreements.

### Journey 4: Walk-Away Decision (Buyer)

1. Buyer has been negotiating for hours and feels pressure to close.
2. Asks the AI: "Should I walk?"
3. AI evaluates the deal against market data, the buyer's targets, and the current offer.
4. AI provides a clear recommendation (walk or stay) with reasoning, and coaches through emotional pressure (sunk cost, time invested, salesperson tactics).
5. If the buyer walks, the session persists. When the dealer calls back days later, the buyer reopens the session with full context.

### Journey 5: Training Simulation (Salesperson)

1. Salesperson opens the app (with a dealer role account) and browses available training scenarios.
2. Selects a scenario (e.g., "Buyer says the dealer across town offered $2k less" or "Handle the interest rate objection").
3. AI plays a realistic customer with a hidden persona, budget, and objections.
4. Salesperson practices the conversation in chat.
5. At the end of the simulation, AI scores the performance and provides specific feedback on what worked, what did not, and what to try differently.

### Journey 6: Multiple Active Deals (Buyer)

1. Buyer is shopping two dealers for the same vehicle.
2. Creates separate sessions for each dealer.
3. Links the sessions so the AI has context from both negotiations.
4. AI can compare offers across dealers: "Dealer A is $1,200 lower on price but Dealer B has a better rate."
5. Buyer switches between sessions as needed, each with its own dashboard state.

---

## 4. Feature Catalog

### Phase 1 — MVP (Current Build)

#### 4.1 AI Chat Advisor (Buyer)

**Description:** Text-based AI assistant powered by Claude that provides real-time deal analysis, negotiation coaching, and car buying guidance. The AI understands deal context and proactively updates the dashboard as the conversation progresses.

**Implementation status:** Built. Chat screen with message streaming via SSE, voice input button, and tool-call-driven dashboard updates.

**Key behaviors:**
- Conversational AI that understands car buying context
- Streams responses in real time via SSE (text chunks + tool results), with two-pass follow-up for tool-only responses
- Assistant messages render as Markdown (bold, lists, code blocks, links) via `react-native-markdown-display`; user messages render as plain text
- Automatically calls tools to update the persistent dashboard when deal information changes
- Server-side quick action generation via Haiku when Claude doesn't suggest them
- Maintains conversation history within a session (last 20 messages sent to Claude)
- Voice input via device speech-to-text
- Context-aware system prompt preambles adapt AI tone and advice style based on buyer context (researching, reviewing a deal, at the dealership)

#### 4.2 Persistent Dashboard (Buyer)

**Description:** A set of dashboard components that display the current state of the deal alongside the chat. Updated automatically by the AI through structured tool calls, so the buyer always sees their deal status without having to ask.

**Implementation status:** Built. All insights components implemented with collapsible panel (`InsightsPanel`), responsive desktop sidebar layout at 768px+ breakpoints. Panel ordering and quick actions adapt to the buyer's situational context.

**Components:**

| Component | Purpose | Tool |
|-----------|---------|------|
| Deal Phase Indicator | Shows current stage: Researching, At Dealership, Negotiating, F&I, Signing, Post-Purchase | `update_deal_phase` |
| Deal Health Card | Overall deal health assessment (good/fair/concerning/bad) with summary | `update_deal_health` |
| Red Flags Card | Specific deal problems with severity (warning/critical), dismissible per session | `update_red_flags` |
| Key Numbers | Financial figures with inline editing — listing price, MSRP, target, walk-away, current offer, monthly payment, APR | `update_deal_numbers` |
| Information Gaps Card | Missing data that would improve assessment, with priority and tappable prompts | `update_information_gaps` |
| Savings Summary | Estimated buyer savings (shown in closing phase) | N/A (derived from first_offer vs current_offer) |
| Vehicle Card | Year, make, model, trim, VIN, mileage, color with inline editing | `set_vehicle` |
| Negotiation Scorecard | Red/yellow/green ratings for price, financing, trade-in, fees, and overall deal quality | `update_scorecard` |
| Active Checklist | Phase-appropriate to-do items that update as the deal progresses | `update_checklist` |
| Dealership Timer | Tracks time at the dealership; surfaces awareness cues about wait-time tactics | N/A (client-side) |
| Quick Actions | LLM-generated contextual prompts (2-3 buttons) that update as conversation shifts; static fallbacks shown before first AI exchange or when dynamic actions go stale | `update_quick_actions` |

**Data-driven panel composition:** The InsightsPanel uses `getPanelWidgets()` to determine which widgets to show based on available deal data (e.g., DealHealthCard appears when both an offer and target exist; RedFlagsCard only when there are undismissed flags). This replaced the previous static context-based widget ordering (`WIDGET_ORDER_BY_CONTEXT`).

**Inline editing:** Users can tap to correct AI-extracted values on KeyNumbers and VehicleCard. Corrections are debounced and synced to the backend via `PATCH /api/deal/{session_id}`, which triggers a Haiku re-assessment of deal health and red flags.

#### 4.3 Session Management (Buyer)

**Description:** Create, list, search, switch between, and delete chat sessions. The chats list is the buyer's home screen, showing sessions organized into Active and Past sections with search, pull-to-refresh, and rich session cards.

**Implementation status:** Built. Chats list screen (`/(app)/chats`) as buyer home, session creation, session switching, session deletion, search, auto-titling, message previews.

**Key behaviors:**
- Each session has its own deal state (dashboard, messages, vehicle) and buyer context
- Sessions persist across app closures
- Sessions can be linked to share context (e.g., researching the same vehicle at two dealers)
- **Auto-generated titles**: Sessions are titled automatically — deterministic vehicle titles (e.g., "2024 Toyota Camry LE") when a vehicle is set via `set_vehicle`, or LLM-generated via Haiku on the first exchange. Manual renames disable auto-titling.
- **Message previews**: Each session shows a truncated preview of the last assistant message (max 120 characters)
- **Deal summary on cards**: Session cards display a phase dot, vehicle info, current offer or listing price, and overall score status
- **Search**: The `?q=` parameter on the sessions endpoint searches by title and message content
- **Sectioned list**: Sessions are organized into Active (sessions with recent activity) and Past sections
- Buyer context (researching, reviewing deal, at dealership) is set at session creation and can be updated mid-conversation by the AI via `update_buyer_context` tool
- **Single-session fast-path**: If the buyer has only one session, they are navigated directly to it

#### 4.4 Deal Decoder (Buyer)

**Description:** Photo upload of dealer paperwork (buyer's orders, F&I worksheets, payment breakdowns) for AI analysis using multimodal vision. The AI extracts all numbers, explains the deal in plain English, and populates the dashboard in one shot.

**Implementation status:** Quick action button built; photo upload endpoint defined in API spec. Claude vision integration planned for backend.

**Key behaviors:**
- Snap a photo of any dealer document
- AI extracts prices, payments, rates, fees, add-ons, and terms
- Dashboard updates from a single photo (vehicle card, numbers, scorecard, checklist)
- Flags unauthorized charges, inflated fees, and discrepancies

#### 4.5 Authentication

**Description:** JWT-based authentication with signup, login, and token refresh.

**Implementation status:** Built. Auth screens (login, register), backend auth routes, JWT token management with Bearer tokens, bcrypt password hashing.

#### 4.6 AI Training Simulations (Dealer)

**Description:** AI-powered customer scenarios where salespeople practice objection handling and closing techniques. The AI plays a realistic customer persona with hidden motivations, budget constraints, and objections.

**Implementation status:** Screens built (simulation list, individual simulation chat). Backend simulation routes and scoring defined. AI persona and scoring logic planned.

**Key behaviors:**
- Browse scenario templates by type and difficulty
- Chat-based simulation with AI customer persona
- Performance scoring at completion
- Specific feedback on objection handling, rapport building, and closing technique

#### 4.7 Theme Support

**Description:** Dark mode (default) and light mode with a Facebook-inspired dark color palette.

**Implementation status:** Built. Tamagui theme system with centralized tokens (`lib/theme/tokens.ts`), dark/light theme definitions (`lib/theme/themes.ts`), and semantic sub-themes (`danger`, `warning`, `success`) for status surfaces. Theme store with toggle, no hardcoded hex values in components. Components use `useTheme()` or `<Theme name="...">` wrappers.

### Phase 1 — Technical Infrastructure (Current Build)

#### 4.8 Backend API

**Description:** FastAPI backend with layered architecture (routes, schemas, services, models, core).

**Implementation status:** Built. Auth, sessions, chat (SSE streaming), deals, and simulations routes all implemented.

**Key details:**
- Claude API integration with two models: Sonnet (primary, with 10 tool definitions) and Haiku (fast, for quick action generation, session titles, and deal assessment safety net)
- Two-pass response architecture: tool-only responses trigger a follow-up text generation call
- SSE streaming: `text` (conversation chunks), `tool_result` (dashboard updates), `followup_done` (two-pass text), `done` events
- SQLite for local development, PostgreSQL via Docker for production
- Alembic database migrations
- Pydantic request/response validation
- CORS configuration for frontend origins

---

## 5. Success Metrics

### Product Metrics

| Metric | Definition | Target (Phase 1) |
|--------|-----------|-------------------|
| **Buyer activation** | % of signups who complete at least one chat session | >60% |
| **Session depth** | Average messages per session | >10 |
| **Dashboard engagement** | % of sessions where at least 3 dashboard components are populated | >50% |
| **Deal Decoder usage** | % of sessions that include at least one photo upload | >30% |
| **Return usage** | % of users who return for a second session within 30 days | >40% |
| **Simulation completion** | % of started simulations completed to scoring | >70% |

### Outcome Metrics

| Metric | Definition | Measurement |
|--------|-----------|-------------|
| **Buyer savings** | Dollar difference between initial dealer offer and final price for app-assisted deals | User-reported via post-deal survey |
| **Overcharge detection** | Number of unauthorized charges or fee discrepancies flagged per session | Tracked via `update_scorecard` tool calls with red ratings |
| **Rate markup detection** | Instances where AI identifies APR significantly above expected rate for credit profile | Tracked via chat analysis |
| **Simulation score improvement** | Average score increase across a salesperson's first 5 vs. last 5 simulations | Tracked in simulation scoring |
| **Willingness to pay** | % of users who indicate they would pay for the service | User survey during MVP testing |

### Technical Metrics

| Metric | Definition | Target |
|--------|-----------|--------|
| **Chat response latency** | Time from message send to first SSE text chunk | <2s p95 |
| **Dashboard update latency** | Time from tool call to frontend re-render | <500ms p95 |
| **Photo analysis time** | Time from photo upload to dashboard population | <10s p95 |
| **API availability** | Uptime of backend services | >99% |

---

## 6. Out-of-Scope / Roadmap

### Out of Scope for Phase 1

These capabilities are explicitly excluded from the current MVP. They require additional infrastructure, legal review, or user validation that is not yet complete.

| Capability | Reason for exclusion |
|------------|---------------------|
| Audio recording and analysis | Requires geo-aware consent flows, BIPA compliance in IL, all-party consent in CA. Legal infrastructure not yet built. |
| Real-time audio processing (live objection coach) | Requires <300ms latency, beamforming hardware, speaker diarization. Phase 3+. |
| CRM integrations (VinSolutions, DealerSocket) | Requires dealer partnerships and API access. Phase 3+. |
| Market data integrations (transaction prices, credit union rates) | Data source partnerships not yet established. |
| Push notifications (dealer callback alerts, refinance reminders) | Requires notification infrastructure and trigger logic. Phase 2+. |
| Manager tools (live floor dashboard, T.O. alerts) | Builds on real-time audio pipeline. Phase 3+. |
| Wearable integration (Apple Watch) | Future UX exploration. |
| AR vehicle overlay | Experimental. No timeline. |

### Phase 2 Roadmap

**Target:** After MVP validation with real buyers and the founder's salesman contact.

| Feature | Description |
|---------|-------------|
| **Record and analyze mode** | Buyer records dealership conversation from their phone. AI processes audio to extract verbal price agreements, F&I disclosures, add-on pitches, pressure tactics, and contradictions with paperwork. Requires consent flow implementation. |
| **Dealer app launch** | Training simulations available to dealer subscribers. Scenario library expansion. Team management for sales managers. |
| **Onboarding flows** | ~~Two entry points: "Prep mode" and "I'm here now".~~ **Shipped in Phase 1** as buyer context selection (ContextPicker with three situation cards). |
| **Post-deal features** | Contract review (photo upload of final contract, AI cross-checks against verbal agreements), post-purchase checklist, refinance timing reminders. |
| **Analytics foundation** | Begin tracking deal outcomes, tactic effectiveness, and pattern recognition for AI improvement. |

### Phase 3+ Roadmap

| Feature | Description |
|---------|-------------|
| **Live objection coach** (Dealer) | Real-time audio processing with <300ms latency. Detects spoken objections and displays proven responses. Requires edge hardware (beamforming mics, NVIDIA Jetson). |
| **F&I compliance monitor** (Buyer) | Listens to F&I conversation in real time, flags unauthorized or undisclosed charges against spoken consent. Highest legal complexity. |
| **Customer intel logger** (Dealer) | Captures buyer signals and preferences during conversation, auto-writes structured data to dealer CRM. |
| **Manager tools** | Live conversation summaries, "get manager" one-tap T.O. with context, floor traffic analytics. |
| **Lender partnerships** | Direct credit union integrations for instant in-app pre-qualification. |
| **Competitive intelligence** | Anonymized, aggregated market insights for dealers (common objections, competitor comparisons, pricing trends). |
| **Deal score and savings tracker** | Post-purchase deal rating vs. market, lifetime savings tracking. Shareable for viral growth. |
| **"Beat this deal" broadcaster** | Buyer sends current offer to competing dealers. Inverts the power dynamic. |
| **Total cost of ownership** | Projected fuel, insurance, maintenance, and depreciation over ownership period alongside purchase price. |

### Long-Term Vision

- Compliance audit trail for regulatory protection (timestamped records of every disclosure and consent)
- Data licensing of anonymized market intelligence to OEMs, lenders, and analysts
- Language translation for multilingual buyer support
- "Decode this" social feature for viral distribution (anonymous deal sheet analysis)
- Model-specific buyer guides for SEO-driven acquisition
