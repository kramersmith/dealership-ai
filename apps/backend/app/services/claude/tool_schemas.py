from __future__ import annotations

from app.models.enums import (
    BuyerContext,
    DealPhase,
    GapPriority,
    HealthStatus,
    NegotiationStance,
    NumberHighlight,
    RedFlagSeverity,
    ScoreStatus,
    VehicleRole,
)

CHAT_ONLY_TOOL_NAMES: frozenset[str] = frozenset()

# ─── Operational tool schemas for the chat step loop ───
# Each tool maps 1:1 to what apply_extraction() handles in deal_state.py
# and what the frontend processes via dealStore.applyToolCall().

CHAT_TOOLS: list[dict] = [
    {
        "name": "set_vehicle",
        "description": (
            "Create or update a vehicle the buyer is considering. Call when the buyer names a vehicle by "
            "year/make/model/trim or supplies a VIN. Pass vehicle_id to update an existing vehicle with "
            "new details; omit vehicle_id to create a new vehicle. When the buyer later supplies specs — "
            "trim ('Lariat'), engine ('7.3 V8 gas', '6.7 Power Stroke diesel'), cab_style, bed_length, "
            "color, or corrected mileage — pass vehicle_id along with only the new/changed fields so "
            "those specs land on the vehicle record. When the buyer gives a VIN alone, persist the VIN "
            "only — do not infer year, make, model, trim, or engine from it. Do not call for casual "
            "mentions ('my neighbor has a Tesla') or for vehicles the assistant suggested but the buyer "
            "has not confirmed."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "vehicle_id": {
                    "type": "string",
                    "description": "Existing vehicle ID to update. Omit to add new.",
                },
                "role": {
                    "type": "string",
                    "enum": [r.value for r in VehicleRole],
                    "description": "Required for new vehicles.",
                },
                "year": {"type": "integer"},
                "make": {"type": "string"},
                "model": {"type": "string"},
                "trim": {"type": "string"},
                "cab_style": {"type": "string"},
                "bed_length": {"type": "string"},
                "vin": {"type": "string"},
                "mileage": {"type": "integer"},
                "color": {"type": "string"},
                "engine": {"type": "string"},
            },
        },
    },
    {
        "name": "create_deal",
        "description": (
            "Create a deal (vehicle + dealer + negotiation context) or update an existing deal's dealer "
            "name or phase. set_vehicle auto-creates a deal the first time it runs for a primary or "
            "candidate vehicle, so normally you don't need this. Call this explicitly when the same "
            "vehicle is being shopped at a different dealer, or when updating dealer_name or phase on an "
            "existing deal."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "deal_id": {
                    "type": "string",
                    "description": "Existing deal ID to update. Omit to create new.",
                },
                "vehicle_id": {"type": "string"},
                "dealer_name": {"type": "string"},
                "phase": {
                    "type": "string",
                    "enum": [p.value for p in DealPhase],
                },
                "make_active": {
                    "type": "boolean",
                    "description": (
                        "If true (default), this deal becomes the active deal in the UI. "
                        "Omit or false only when the tool runner supplies it for auto-created "
                        "companion deals."
                    ),
                },
            },
        },
    },
    {
        "name": "update_deal_numbers",
        "description": (
            "Update the typed financial fields on the active deal (or specified deal_id). Call whenever "
            "the buyer states a listing/asking price, current offer, MSRP, APR, loan term, monthly payment, "
            "down payment, or trade-in value. Only include fields that changed. listing_price and "
            "current_offer are pre-tax/pre-fee — never the financed total (e.g. '$35,900 with taxes included' "
            "on a $34k listing means listing_price=34000, not 35900). "
            "For the buyer's own target or walk-away price, use set_buyer_targets instead. "
            "For fees, add-ons, warranty cost, tax, or rebates, use update_deal_custom_numbers instead."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "deal_id": {
                    "type": "string",
                    "description": "Defaults to active deal if omitted.",
                },
                "msrp": {"type": "number"},
                "invoice_price": {"type": "number"},
                "listing_price": {
                    "type": "number",
                    "description": "Advertised price BEFORE taxes/fees. NOT the financed total.",
                },
                "current_offer": {
                    "type": "number",
                    "description": "Current negotiated price BEFORE taxes/fees. NOT the financed total.",
                },
                "monthly_payment": {"type": "number"},
                "apr": {"type": "number"},
                "loan_term_months": {"type": "integer"},
                "down_payment": {"type": "number"},
                "trade_in_value": {"type": "number"},
            },
        },
    },
    {
        "name": "set_buyer_targets",
        "description": (
            "Persist the buyer's stated negotiation targets — their target price (what they'd like to "
            "pay) and/or walk-away price (the max they'll go to). Call ONLY when the buyer has explicitly "
            "stated these numbers in their own words ('my target is $X', 'I want to pay around $X', "
            "'I'll walk at $Y', 'my max is $Y'). Do not call from your own recommendations in the reply "
            "text — recommending a target or walk-away in chat does not authorize you to persist it. "
            "Include only the field(s) the buyer actually stated."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "deal_id": {
                    "type": "string",
                    "description": "Defaults to active deal if omitted.",
                },
                "your_target": {"type": "number"},
                "walk_away_price": {"type": "number"},
            },
        },
    },
    {
        "name": "update_deal_custom_numbers",
        "description": (
            "Replace the full list of deal-specific custom number rows for the Numbers panel card. "
            "Use this for deal figures that do not fit the typed fields in update_deal_numbers: "
            "doc fees, dealer prep/add-ons, GAP insurance, extended warranty cost, registration/title, "
            "tax totals, trade-in payoff, warranty remaining, dealer discount, rebates, AND market "
            "reference values the buyer cites or pastes (CARFAX retail value, KBB / Edmunds estimates, "
            "appraisal numbers, comparable listings) so the buyer can see asking-vs-retail side by side "
            "on the Numbers card. "
            'Format the value as a display string (e.g. "$1,995", "72 mo", "6.25%") — the '
            "renderer does not reformat it. Use highlight='bad' for fabricated/predatory charges "
            "(e.g. dealer prep fee), 'good' for favorable figures (e.g. rebates), 'neutral' otherwise. "
            "Send every row every time — this replaces the list."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "deal_id": {
                    "type": "string",
                    "description": "Defaults to active deal if omitted.",
                },
                "rows": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {
                                "type": "string",
                                "description": "Short label (e.g. 'Doc fee', 'Dealer prep fee').",
                            },
                            "value": {
                                "type": "string",
                                "description": "Pre-formatted display string (e.g. '$1,995').",
                            },
                            "highlight": {
                                "type": "string",
                                "enum": [v.value for v in NumberHighlight],
                            },
                        },
                        "required": ["label", "value"],
                    },
                },
            },
            "required": ["rows"],
        },
    },
    {
        "name": "update_deal_phase",
        "description": (
            "Advance the deal's pipeline phase. Call when the beat moves the deal forward — research → "
            "initial_contact, test_drive → negotiation, negotiation → financing, financing → closing, or "
            "the buyer explicitly walks away. Do not regress the phase backward."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "phase": {
                    "type": "string",
                    "enum": [p.value for p in DealPhase],
                },
            },
            "required": ["phase"],
        },
    },
    {
        "name": "update_scorecard",
        "description": (
            "Update deal quality scores (price, financing, trade_in, fees, overall — each green/yellow/red). "
            "Call whenever deal numbers, red flags, or information gaps shift materially. Batch with "
            "update_deal_health so the dashboard stays consistent. Only include scores that changed."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "deal_id": {"type": "string"},
                "score_price": {
                    "type": "string",
                    "enum": [s.value for s in ScoreStatus],
                },
                "score_financing": {
                    "type": "string",
                    "enum": [s.value for s in ScoreStatus],
                },
                "score_trade_in": {
                    "type": "string",
                    "enum": [s.value for s in ScoreStatus],
                },
                "score_fees": {
                    "type": "string",
                    "enum": [s.value for s in ScoreStatus],
                },
                "score_overall": {
                    "type": "string",
                    "enum": [s.value for s in ScoreStatus],
                },
            },
        },
    },
    {
        "name": "update_deal_health",
        "description": (
            "Update the overall deal health assessment (status + summary + recommendation). Call whenever "
            "numbers, flags, or gaps shift — health needs to stay current with the rest of the dashboard. "
            "Ground summary and recommendation in the buyer's actual data; recommendation should be specific "
            "('Counter at $31,500'), not generic ('Try negotiating'). When the buyer has pasted CARFAX, "
            "AutoCheck, or dealer history text in chat, treat that as history evidence — don't claim history "
            "is missing just because the API's intelligence.history_report is empty."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "deal_id": {
                    "type": "string",
                    "description": "Defaults to active deal if omitted.",
                },
                "status": {
                    "type": "string",
                    "enum": [h.value for h in HealthStatus],
                },
                "summary": {
                    "type": "string",
                    "description": "1-2 sentence assessment grounded in the buyer's actual data.",
                },
                "recommendation": {
                    "type": "string",
                    "description": "One specific, actionable next step.",
                },
            },
            "required": ["status", "summary", "recommendation"],
        },
    },
    {
        "name": "update_deal_red_flags",
        "description": (
            "Replace the full list of deal-specific red flags (send every flag every time). Call when a new "
            "problem surfaces (unusually high APR, fabricated/hidden fee, dealer pressure tactic, a number "
            "that changed from earlier, pasted history revealing a concern) or when a prior flag no longer "
            "applies and should be removed. Each flag must reference specific data from the conversation — "
            "not generic warnings. Missing information is never a red flag — use update_deal_information_gaps "
            "for that."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "deal_id": {"type": "string"},
                "flags": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "severity": {
                                "type": "string",
                                "enum": [s.value for s in RedFlagSeverity],
                            },
                            "message": {"type": "string"},
                        },
                        "required": ["id", "severity", "message"],
                    },
                },
            },
        },
    },
    {
        "name": "update_session_red_flags",
        "description": (
            "Replace the full list of buyer-level red flags that aren't tied to one specific deal "
            "(stretched-term borrowing pattern, broad pressure behavior, identity doc mismatches, etc.). "
            "Call when the session-level pattern changes. For deal-specific problems, use "
            "update_deal_red_flags instead."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "flags": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "severity": {
                                "type": "string",
                                "enum": [s.value for s in RedFlagSeverity],
                            },
                            "message": {"type": "string"},
                        },
                        "required": ["id", "severity", "message"],
                    },
                },
            },
        },
    },
    {
        "name": "update_deal_information_gaps",
        "description": (
            "Replace the full list of deal-specific missing information (send every gap every time). "
            "Information gaps are data that would improve the assessment — asking price, mileage, engine, "
            "trim, pre-approval status, dealer name, etc. Call when a gap opens, a gap fills, or the buyer "
            "narrows/resolves the underlying question. Missing info is a gap, not a red flag. "
            "The insights panel shows gaps in the same Checklist card as playbook steps (merged display); "
            "avoid duplicating the same line in update_checklist — keep unknowns here and actionable steps there."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "deal_id": {"type": "string"},
                "gaps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string"},
                            "reason": {"type": "string"},
                            "priority": {
                                "type": "string",
                                "enum": [p.value for p in GapPriority],
                            },
                        },
                        "required": ["label", "reason", "priority"],
                    },
                },
            },
        },
    },
    {
        "name": "update_session_information_gaps",
        "description": (
            "Replace the full list of session-level missing information (credit range, budget, buyer "
            "context that spans deals). Call when session-level data arrives, or when a stale gap is "
            "satisfied by structured state (e.g. listing_price is now set, so 'we need a listing price' "
            "can be removed). For deal-specific gaps, use update_deal_information_gaps."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "gaps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string"},
                            "reason": {"type": "string"},
                            "priority": {
                                "type": "string",
                                "enum": [p.value for p in GapPriority],
                            },
                        },
                        "required": ["label", "reason", "priority"],
                    },
                },
            },
        },
    },
    {
        "name": "update_deal_comparison",
        "description": (
            "Update the side-by-side comparison between 2+ deals when the comparison frame has materially "
            "changed (new numbers on one side, a new red flag, a new trade-off). Use highlights to surface "
            "the decisive differences per row and mark which deal wins each row. Do not call when only one "
            "deal is in play."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "recommendation": {"type": "string"},
                "best_deal_id": {"type": "string"},
                "highlights": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string"},
                            "values": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "deal_id": {"type": "string"},
                                        "value": {"type": "string"},
                                        "is_winner": {"type": "boolean"},
                                    },
                                    "required": ["deal_id", "value", "is_winner"],
                                },
                            },
                            "note": {"type": "string"},
                        },
                        "required": ["label", "values"],
                    },
                },
            },
        },
    },
    {
        "name": "update_negotiation_context",
        "description": (
            "Session-scoped negotiation context for the buyer-visible stance + situation strip above the "
            "insights panel (not tied to active_deal_id). Call this on EVERY turn where the buyer "
            "narrated a moment of the negotiation — what the dealer said or did, the buyer's response, "
            "a new concern, an emerging next step — even if no hard fact (price, VIN, mileage) changed. "
            "The beat itself is the update: situation must match the current moment, not the prior turn. "
            "Also update when offers, location, pasted history (CARFAX/AutoCheck), mileage pace, "
            "commercial use, recalls/liens, or next checks change. When 2+ shopping vehicles/deals are "
            "in play and you update assessment on any deal, refresh this in the same batch so situation "
            "describes the comparison frame, not only the last single-vehicle summary. Preserve fields "
            "that still apply; refresh situation, key_numbers, and pending_actions so the strip matches "
            "the conversation."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "situation": {
                    "type": "string",
                    "description": (
                        "ONE short sentence (max ~18 words) of what is happening RIGHT NOW. If comparing "
                        "multiple vehicles, name both sides or the decisive trade-off so the strip matches chat."
                    ),
                },
                "stance": {
                    "type": "string",
                    "enum": [s.value for s in NegotiationStance],
                    "description": "The buyer's current negotiation stance.",
                },
                "key_numbers": {
                    "type": "array",
                    "description": "The 2-4 most important numbers for the current moment.",
                    "maxItems": 4,
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string"},
                            "value": {"type": "string"},
                            "note": {"type": ["string", "null"]},
                        },
                        "required": ["label", "value"],
                    },
                },
                "scripts": {
                    "type": "array",
                    "description": "Word-for-word things the buyer should say. Max 3.",
                    "maxItems": 3,
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string"},
                            "text": {"type": "string"},
                        },
                        "required": ["label", "text"],
                    },
                },
                "pending_actions": {
                    "type": "array",
                    "description": "What the buyer should do or wait for. Max 5.",
                    "maxItems": 5,
                    "items": {
                        "type": "object",
                        "properties": {
                            "action": {"type": "string"},
                            "detail": {"type": ["string", "null"]},
                            "done": {"type": "boolean", "default": False},
                        },
                        "required": ["action"],
                    },
                },
                "leverage": {
                    "type": "array",
                    "description": "Concrete advantages the buyer has. Max 3.",
                    "maxItems": 3,
                    "items": {"type": "string"},
                },
            },
            "required": ["situation", "stance"],
        },
    },
    {
        "name": "update_checklist",
        "description": (
            "Replace the full buyer checklist (send every item). Call this on any turn where a task was "
            "implicitly completed, a new task emerged from the conversation, or an existing item would "
            "now be out of date — not only when pasted history reports arrive. Mark history-report "
            "tasks done when the buyer pasted CARFAX/AutoCheck or equivalent for the focused vehicle — "
            "not only after the in-app VIN history check. The checklist renders directly to the panel, "
            "so staleness is visible; refresh it whenever the to-do list would no longer match the state "
            "of the negotiation. Information gaps use update_deal_information_gaps / update_session_information_gaps; "
            "the panel merges gaps and checklist into one card for the buyer, but these tools stay separate — "
            "dedupe conceptually so the same line is not maintained in both."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string"},
                            "done": {"type": "boolean"},
                        },
                        "required": ["label", "done"],
                    },
                },
            },
            "required": ["items"],
        },
    },
    {
        "name": "update_buyer_context",
        "description": (
            "Update the buyer's situation context when it shifts between researching (from home), "
            "reviewing_deal (considering a specific offer), or at_dealership (on-site). The greeting, "
            "stance defaults, and advice intensity all key off this."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "buyer_context": {
                    "type": "string",
                    "enum": [c.value for c in BuyerContext],
                },
            },
            "required": ["buyer_context"],
        },
    },
    {
        "name": "switch_active_deal",
        "description": (
            "Switch which deal is the active focus. Call when the buyer explicitly picks one option among "
            "known vehicles ('I prefer the Tacoma', 'I'll go with that one', 'the red truck is out'), or "
            "references a specific VIN/deal as their choice. Do not call while the buyer is still actively "
            "comparing."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "deal_id": {"type": "string"},
            },
            "required": ["deal_id"],
        },
    },
    {
        "name": "remove_vehicle",
        "description": (
            "Remove a vehicle and its associated deals from the session. Call only when the buyer "
            "explicitly asks to drop a vehicle from their consideration set ('forget about the F-150', "
            "'I'm no longer looking at the Silverado'). Never call unilaterally to 'clean up' vehicles."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "vehicle_id": {"type": "string"},
            },
            "required": ["vehicle_id"],
        },
    },
]


def get_buyer_chat_tools(
    *,
    allow_persistence_affecting_tools: bool = True,
    allow_chat_only_tools: bool = True,
) -> list[dict]:
    """Return the buyer chat tool set allowed for this turn.

    Paused insights mode blocks tools that persist structured deal or panel-related
    state, while leaving room for explicitly chat-only tools.
    """
    if allow_persistence_affecting_tools and allow_chat_only_tools:
        return CHAT_TOOLS
    if allow_persistence_affecting_tools:
        return [tool for tool in CHAT_TOOLS if tool["name"] not in CHAT_ONLY_TOOL_NAMES]
    if allow_chat_only_tools:
        return [tool for tool in CHAT_TOOLS if tool["name"] in CHAT_ONLY_TOOL_NAMES]
    return []
