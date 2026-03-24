# User Research & Real-World Validation

## Real Deal Session — March 20, 2026

Founder used ChatGPT as a live buying assistant during a real truck purchase (2022 F-250 Lariat, 175k miles). The full conversation is in `chatgpt-convo.txt`. Key takeaways below.

---

## How the AI Was Actually Used (Chronologically)

### Pre-visit (night before)
- General negotiation tips and tactics
- Vehicle-specific risk analysis (mileage, engine type, commercial use)
- CARFAX interpretation — flagging service patterns, auction history, maintenance gaps
- Compared two trucks using CARFAX data alone
- Financing education — credit union vs. Capital One, pre-approval strategy
- What to bring to the dealership checklist

### At the dealership (real-time, over several hours)
- "I just arrived, give me a rundown" — quick tactical refresher
- Inspection and test drive guidance
- Real-time negotiation coaching: "He doesn't want to lower" → exact script for what to say next
- "I walked out, now I'm in my car" → guidance on whether to go back in or leave
- "They just called me" → how to counter their offer
- Deal sheet photo analysis — caught 9.99% APR markup on an 800 credit score
- Finance office coaching — declining add-ons, GAP analysis, warranty evaluation
- Emotional support against sunk cost fallacy ("I drove 3 hours to get here")
- Payment method advice (warned against CC via Cash App)
- Post-purchase checklist (verify numbers, plan refinance, maintenance baseline)

---

## Key Product Insights

### The session validates core features
- **Deal Decoder** — the finance office deal sheet analysis was one of the highest-value moments. The 9.99% → 7.99% rate reduction happened because AI caught the markup. Photo upload of deal sheets is essential.
- **Negotiation Coach (buyer side)** — real-time "send me what they say, I'll tell you what to say" was the killer use case. This happened repeatedly over hours during an active deal.
- **CARFAX/vehicle analysis** — comparing two trucks by their service history, auction path, and maintenance patterns was high-value pre-deal research.
- **Financing comparison** — rate benchmarking against credit score + vehicle profile caught a ~$2k-$3k overcharge in interest.

### UX observations
- The back-and-forth happened via text over **5+ hours** during an active deal — the app needs to be quick, glanceable, low-friction
- Customer was often in a parking lot or sitting across from a salesperson — needs to feel like texting a friend, not using a complex tool
- ChatGPT was effective but extremely verbose — a purpose-built app should deliver the same guidance in 1/3 the words
- The most valuable moments were **instant validation** ("is this number fair?") and **exact scripts** ("say this, then stop talking")
- Emotional coaching was surprisingly important — countering sunk cost fallacy, pressure tactics, and end-of-day urgency

### Features this session would have used
- Photo upload of deal sheet → instant rate/price analysis
- "Is this a good deal?" benchmark with real transaction data
- Financing comparison (dealer rate vs. credit union rates for this credit profile)
- Real-time negotiation coach with suggested responses
- "What am I forgetting?" checklist tailored to the specific deal
- Contract review before signing (cross-check verbal agreement vs. paperwork)

### What ChatGPT got wrong or could improve
- Too verbose — every response had 10+ sections with emoji headers
- Repeated the same advice multiple times across messages
- Kept offering "send me X and I'll help" instead of proactively asking the right questions
- Didn't have access to real-time market data, actual credit union rates, or live inventory
- Could not see the deal sheet photo (text-only conversation)
- No persistent UI — target price, walk-away price, current offer, and deal phase had to be re-stated in every message. A numbers dashboard and negotiation scorecard would have eliminated this.
- No record and analyze — customer had to manually type what the salesperson said. Recording the conversation would have let the AI process it directly.
- No outcome tracking — the AI couldn't learn from this deal to improve advice for the next buyer at this dealership

---

## Validated Pain Points

1. **Rate markup** — dealer approved at ~6% range, presented 9.99%. Customer would have signed without AI catching it. (~$2k-$3k saved)
2. **Add-on pressure in F&I** — warranty, GAP, protection packages pushed aggressively. AI coaching helped decline.
3. **Sunk cost pressure** — 3-hour drive created strong emotional pull to accept a bad deal. AI provided rational counterweight.
4. **Tire/windshield condition** — used as negotiation leverage after AI suggested it. Resulted in dealer concession.
5. **CARFAX interpretation** — customer couldn't assess risk from raw service history. AI identified repeated coil/plug replacements, catalytic converter work, and auction cycling as red flags.
6. **Payment vs. price confusion** — dealer pushed monthly payment framing. AI kept focus on OTD price.
