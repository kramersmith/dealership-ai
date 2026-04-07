from __future__ import annotations

from app.models.enums import (
    BuyerContext,
    DealPhase,
    GapPriority,
    HealthStatus,
    NegotiationStance,
    RedFlagSeverity,
    ScoreStatus,
    VehicleRole,
)

# ─── Operational tool schemas for the chat step loop ───
# Each tool maps 1:1 to what apply_extraction() handles in deal_state.py
# and what the frontend processes via dealStore.applyToolCall().

CHAT_TOOLS: list[dict] = [
    {
        "name": "set_vehicle",
        "description": "Create or update a vehicle. Include vehicle_id to update existing, omit to create new. Only extract from user messages — never from assistant suggestions.",
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
        "description": "Create or update a deal. Only use when same vehicle is discussed at a DIFFERENT dealer.",
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
            },
        },
    },
    {
        "name": "update_deal_numbers",
        "description": "Update financial figures on the active deal (or specified deal_id). Only include fields that changed.",
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
                "your_target": {
                    "type": "number",
                    "description": "Buyer's ideal purchase price.",
                },
                "walk_away_price": {
                    "type": "number",
                    "description": "Max the buyer will pay.",
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
        "name": "update_deal_phase",
        "description": "Update the deal phase when it has progressed.",
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
        "description": "Update deal quality scores. Only include scores that changed.",
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
        "description": "Update the overall deal health assessment. Health summary must reference actual data, recommendation must be specific.",
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
        "description": "Replace the full list of deal-specific red flags. Missing info is NEVER a red flag — use information gaps for that.",
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
        "description": "Replace the full list of session/buyer-level red flags.",
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
        "description": "Replace the full list of deal-specific missing information.",
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
        "description": "Replace the full list of session-level missing information.",
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
        "description": "Update deal comparison when 2+ deals exist and comparison has materially changed.",
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
        "description": "Update the buyer's negotiation context. Only call when the situation has meaningfully changed (new offer, arrived at dealership, walked out, etc.). Preserve information from previous context that is still relevant.",
        "input_schema": {
            "type": "object",
            "properties": {
                "situation": {
                    "type": "string",
                    "description": "ONE short sentence (max 15 words) of what is happening RIGHT NOW.",
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
        "description": "Update the buyer's action item checklist.",
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
        "description": "Update the buyer's situation context when it changes.",
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
        "description": "Switch which deal is active. Only when user wants to discuss a different deal.",
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
        "description": "Remove a vehicle and its associated deals. Only when user explicitly asks to remove a vehicle.",
        "input_schema": {
            "type": "object",
            "properties": {
                "vehicle_id": {"type": "string"},
            },
            "required": ["vehicle_id"],
        },
    },
    {
        "name": "update_quick_actions",
        "description": "Update quick action button suggestions. Always call this with 2-3 contextually relevant suggestions.",
        "input_schema": {
            "type": "object",
            "properties": {
                "actions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {
                                "type": "string",
                                "description": "2-5 word button text.",
                            },
                            "prompt": {
                                "type": "string",
                                "description": "Full message sent when tapped.",
                            },
                        },
                        "required": ["label", "prompt"],
                    },
                },
            },
            "required": ["actions"],
        },
    },
]
