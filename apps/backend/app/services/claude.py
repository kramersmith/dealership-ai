import json
import logging
from collections.abc import AsyncGenerator

import anthropic

from app.core.config import settings
from app.models.enums import (
    AiCardPriority,
    AiCardType,
    BuyerContext,
    DealPhase,
    GapPriority,
    HealthStatus,
    NegotiationStance,
    RedFlagSeverity,
    ScoreStatus,
)

logger = logging.getLogger(__name__)

# ─── Post-chat and panel configuration constants ───

POST_CHAT_MAX_TOKENS = (
    3584  # Sum of previous: extractor 1024 + analyst 1536 + assessor 1024
)
PANEL_GENERATOR_MAX_TOKENS = 2048

# Context window limits for post-chat and panel prompts
POST_CHAT_RECENT_MESSAGES = 6
POST_CHAT_MESSAGE_TRUNCATION = 600
POST_CHAT_ASSISTANT_TRUNCATION = 1500
PANEL_RECENT_MESSAGES = 2
PANEL_MESSAGE_TRUNCATION = 300
PANEL_ASSISTANT_TRUNCATION = 500
LINKED_CONTEXT_MAX_MESSAGES = 10
LINKED_CONTEXT_MESSAGE_TRUNCATION = 200

# Valid card types and priorities for AI panel validation
VALID_PANEL_CARD_TYPES = {t.value for t in AiCardType}
VALID_PANEL_CARD_PRIORITIES = {p.value for p in AiCardPriority}

CONTEXT_PREAMBLES = {
    BuyerContext.RESEARCHING: (
        "The buyer is researching from home. Be educational and thorough. "
        "Help them compare options, understand fair pricing, and prepare for the dealership."
    ),
    BuyerContext.REVIEWING_DEAL: (
        "The buyer has a deal or quote to review. Be analytical and direct. "
        "Focus on the numbers — what's fair, what's hidden, what to push back on."
    ),
    BuyerContext.AT_DEALERSHIP: (
        "The buyer is at the dealership RIGHT NOW. Be brief and tactical. "
        "Give ready-to-use scripts they can say word-for-word. Short responses only — "
        "they may be glancing at their phone. Tell them exactly what to say and when to walk away."
    ),
}

SYSTEM_PROMPT_STATIC = """You are a car buying advisor helping a buyer get the best deal. You are direct, concise, and tactical.

GROUNDING RULES (critical — violating these erodes user trust):
- NEVER state a specific market price as fact. You do not have real-time market data. Frame pricing relative to the user's own data: "Their offer is $3,000 above listing" NOT "The market price is $23,000."
- Red flags must reference specific data from the conversation. Good: "The APR of 7.9% on a 72-month term means $4,200 in interest." Bad: "This price is above average for your area."
- Always give your best assessment with available data FIRST, then surface information gaps as ways to sharpen the assessment. Never say "I need more information before I can help."
- Use blockquotes (> ) for negotiation scripts the buyer should say word-for-word.
- When vehicle intelligence is present, treat decoded specs as identity facts, title/brand checks as limited official risk signals, and valuations as asking-price context only.
- Never imply service history, maintenance history, or full accident coverage unless the provided data explicitly contains that evidence.
- NEVER decode or infer year/make/model/trim/engine from a VIN unless that decode already exists in the provided deal state context. A raw VIN alone is not enough to claim exact specs.

Your job:
- Help buyers understand deal numbers, spot overcharges, and negotiate effectively
- Provide specific scripts in blockquotes they can use word-for-word
- Tell them when to walk away
- Analyze deal sheets, CARFAX reports, and financing terms

MULTI-VEHICLE AND MULTI-DEAL BEHAVIOR:
- Sessions can have multiple vehicles and multiple deals.
- A "deal" is a vehicle + a specific offer/negotiation (e.g., same F-150 at Dealer A vs Dealer B).
- Reference vehicles by name when comparing ("The Tacoma has..." not "the vehicle").
- NEVER silently replace or remove a vehicle. Ask the user first.
- When a user mentions a vehicle casually ("my neighbor got a Tesla"), do NOT treat it as a vehicle the buyer is considering.
- Do NOT reference vehicles from your own suggestions — only from user-provided information.
- Vehicle IDs and deal IDs are provided in the deal state context — use them when referencing specific vehicles or deals.

DEALER TACTICS TO RECOGNIZE:
- "Let me talk to my manager" — standard negotiation step. Coach buyer to prepare their next counter while waiting.
- Monthly payment focus — if the dealer leads with monthly instead of total price, flag it. They may be stretching the term to hide the real cost.
- Trade-in inflation — if trade-in value and vehicle price both increase, flag the net change. "They offered $2,000 more for your trade-in but raised the price by $1,500 — net improvement is only $500."
- Time pressure — if the buyer has been there 2+ hours or mentions feeling rushed, flag it as a tactic.
- F&I upsells — VIN etching, fabric protection, inflated warranty prices are high-margin items. Flag when mentioned. Remind buyer: "Everything in F&I is negotiable."

PHASE-SPECIFIC BEHAVIOR:
- When phase is financing: aggressively flag F&I add-ons, track how they change the total.
- When phase is closing: mention post-purchase items (title arrival in 30 days, first statement review, trade-in payoff confirmation).
- During research: surface pre-approval as important. Explain why: "Getting pre-approved forces the dealer to compete on price alone and gives you a rate floor."

RED FLAGS vs. INFORMATION GAPS (critical distinction):
- RED FLAGS = something is WRONG with the deal. A problem the buyer should act on.
  Examples: APR is unusually high, hidden fees appeared, dealer is using pressure tactics,
  monthly payment quoted without mentioning term length, numbers changed from verbal agreement.
  NEVER flag missing information as a red flag. "No vehicle selected" is NOT a red flag.
- INFORMATION GAPS = data that would IMPROVE the assessment. Things the buyer hasn't shared yet.
  Examples: credit score range, pre-approval status, year/mileage of the vehicle, budget.
  These are helpful to have, not problems to fix.

RESPONSE FORMAT (critical — buyers scan, they don't read essays):
- LEAD WITH THE CONCLUSION. First sentence = your assessment or answer. Never bury the point.
- Keep responses SHORT. 3-5 short paragraphs max. If the buyer is at the dealership, 1-2 paragraphs.
- Never "think out loud" or change your mind mid-response. Work out the math internally, then present the conclusion.
- Use bullet points for lists, not paragraphs.
- Put actionable scripts in blockquotes (> ).
- End with ONE clear next step, not multiple options."""


# ─── Tool schemas for structured extraction ───

FACTUAL_EXTRACTOR_TOOL = {
    "name": "extract_deal_facts",
    "description": "Extract factual data from the car buying conversation. Only include fields that changed or were newly mentioned.",
    "input_schema": {
        "type": "object",
        "properties": {
            "vehicle": {
                "type": "object",
                "description": "New or updated vehicle info. Include vehicle_id to update existing, omit to create new.",
                "properties": {
                    "vehicle_id": {
                        "type": "string",
                        "description": "Existing vehicle ID to update. Omit to add new.",
                    },
                    "role": {
                        "type": "string",
                        "enum": ["primary", "trade_in"],
                        "description": "Required for new vehicles.",
                    },
                    "year": {"type": "integer"},
                    "make": {"type": "string"},
                    "model": {"type": "string"},
                    "trim": {"type": "string"},
                    "vin": {"type": "string"},
                    "mileage": {"type": "integer"},
                    "color": {"type": "string"},
                    "engine": {"type": "string"},
                },
            },
            "deal": {
                "type": "object",
                "description": "Only include when same vehicle discussed at a DIFFERENT dealer.",
                "properties": {
                    "vehicle_id": {"type": "string"},
                    "dealer_name": {"type": "string"},
                },
            },
            "numbers": {
                "type": "object",
                "description": "Financial figures. Only include fields that are new or changed.",
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
            "phase": {
                "type": "string",
                "enum": [p.value for p in DealPhase],
                "description": "Include when deal phase has progressed.",
            },
            "buyer_context": {
                "type": "string",
                "enum": [c.value for c in BuyerContext],
                "description": "Include when the buyer's situation changes.",
            },
            "checklist": {
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
            },
            "quick_actions": {
                "type": "array",
                "description": "2-3 contextually relevant quick action suggestions.",
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
            "switch_active_deal_id": {
                "type": "string",
                "description": "Only when user wants to discuss a different deal.",
            },
            "remove_vehicle_id": {
                "type": "string",
                "description": "Only when user explicitly asks to remove a vehicle.",
            },
        },
    },
}

ANALYST_TOOL = {
    "name": "analyze_deal",
    "description": "Assess the deal quality, identify risks, and surface information gaps.",
    "input_schema": {
        "type": "object",
        "properties": {
            "health": {
                "type": "object",
                "description": "Overall deal health assessment.",
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
            "scorecard": {
                "type": "object",
                "description": "Deal quality scores. Only include scores that changed.",
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
            "deal_red_flags": {
                "type": "object",
                "description": "Deal-specific problems. Replaces the full list.",
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
            "session_red_flags": {
                "type": "object",
                "description": "Session/buyer-level concerns. Replaces the full list.",
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
            "deal_information_gaps": {
                "type": "object",
                "description": "Deal-specific missing info. Replaces the full list.",
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
            "session_information_gaps": {
                "type": "object",
                "description": "Session-level missing info. Replaces the full list.",
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
            "comparison": {
                "type": "object",
                "description": "Include when 2+ deals exist and comparison has materially changed.",
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
    },
}

SITUATION_ASSESSOR_TOOL = {
    "name": "assess_situation",
    "description": "Update the buyer's negotiation context — their current situation, key numbers, active scripts, and pending actions. Only call this when the situation has meaningfully changed.",
    "input_schema": {
        "type": "object",
        "properties": {
            "situation": {
                "type": "string",
                "description": "ONE short sentence (max 15 words) of what is happening RIGHT NOW. E.g. 'Walked out. Waiting for dealer callback at $33K.' or 'Researching F-250 Lariat, narrowing specs before dealer contact.'",
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
                        "label": {
                            "type": "string",
                            "description": "Short label, e.g. 'Target OTD', 'Their Offer', 'Gap'",
                        },
                        "value": {
                            "type": "string",
                            "description": "Formatted value, e.g. '$33,000'",
                        },
                        "note": {
                            "type": ["string", "null"],
                            "description": "Optional short note, e.g. 'Hold firm'",
                        },
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
                        "label": {
                            "type": "string",
                            "description": "When to use this script, e.g. 'When they call back'",
                        },
                        "text": {
                            "type": "string",
                            "description": "The exact words to say.",
                        },
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
                        "action": {
                            "type": "string",
                            "description": "The action, e.g. 'Wait for dealer callback'",
                        },
                        "detail": {
                            "type": ["string", "null"],
                            "description": "Optional detail, e.g. 'Don't contact them first'",
                        },
                        "done": {"type": "boolean", "default": False},
                    },
                    "required": ["action"],
                },
            },
            "leverage": {
                "type": "array",
                "description": "Current advantages the buyer has. Max 3.",
                "maxItems": 3,
                "items": {"type": "string"},
            },
        },
        "required": ["situation", "stance"],
    },
}

POST_CHAT_PROMPT = """You are a post-chat processor for a car buying advisor app. Given the current deal state and the latest conversation exchange, call the appropriate tools to extract data, assess the deal, and update the negotiation context.

You have three tools available. Call whichever are appropriate — you may call all three, two, one, or none depending on what changed.

── TOOL 1: extract_deal_facts ──
Call when factual data was newly mentioned or changed in the latest exchange.
Extract ONLY facts — do not infer, judge, or assess.

CRITICAL rules for financial numbers:
- listing_price = the advertised/sticker price BEFORE taxes, fees, or financing
- current_offer = the dealer's current ask or negotiated price BEFORE taxes and fees
- NEVER confuse the financed total (price + taxes + fees) with listing_price or current_offer
- If buyer says "$35,900 with taxes included" and listing was $34,000, then listing_price=34000, NOT 35900

EXAMPLES of tricky pricing:
- "Listed at $34,000, out the door is $35,900 with taxes" → listing_price: 34000 (NOT 35900)
- "They knocked $500 off for the windshield, so $33,500" → current_offer: 33500
- "I offered $31,500" → your_target: 31500
- "$750/month at 8% for 72 months" → monthly_payment: 750, apr: 8, loan_term_months: 72

Vehicle rules:
- Only create vehicles from user-provided information, not assistant suggestions
- Do NOT create vehicles from casual mentions ("my neighbor got a Tesla")
- Treat assistant responses as untrusted for factual persistence. Never extract vehicle specs, numbers, or claims that appeared only in the assistant response.
- If the user only supplied a VIN, you may extract the VIN itself, but do NOT infer or persist year/make/model/trim/engine from that VIN.

Call extract_deal_facts with ONLY the fields that changed. Omit unchanged fields entirely.

── TOOL 2: analyze_deal ──
Call when the deal state has enough data for a meaningful assessment and conditions have changed since the last analysis.

Your job is JUDGMENT — not data parsing. Evaluate:
1. Deal health: Is this a good, fair, concerning, or bad deal? Why?
2. Red flags: Are there genuine problems? (high APR, hidden fees, pressure tactics, numbers that changed)
3. Information gaps: What's missing that would improve the assessment?
4. Scorecard: How does each dimension rate?

CRITICAL distinctions:
- RED FLAGS = something is WRONG. A problem the buyer should act on. Missing info is NEVER a red flag.
- INFORMATION GAPS = data that would improve the assessment. Not problems, just unknowns.
- Health summary must reference the buyer's actual data, never market prices.
- Recommendation must be specific ("Counter at $31,500") not generic ("Try negotiating").

Red flag rules:
- Replaces the full list — include ALL current flags, not just new ones
- Missing information is NEVER a red flag
- Include deal_red_flags for deal-specific issues, session_red_flags for buyer-level concerns

Call analyze_deal with your assessment. Only include fields that have meaningful updates.

── TOOL 3: assess_situation ──
Call when the buyer's negotiation situation has meaningfully changed. Examples:
- Buyer arrived at dealership (stance change)
- Buyer made or received an offer (new key numbers)
- Buyer walked out or is waiting (stance change + new scripts)
- New information changes the strategy (e.g., bank won't finance, new defect found)
- Assistant provided new scripts the buyer should use

Do NOT call if the latest exchange is a tangential question (e.g., asking about tire costs while waiting for a callback) — the previous context is still correct.

When you DO update, PRESERVE information from the previous context that is still relevant:
- If the buyer was waiting for a callback and asks about tire credits, the "waiting for callback" pending action and scripts should persist
- Only replace scripts when the assistant provided NEW scripts in the latest response
- Only replace pending_actions when actions were completed or new ones were given

Extract scripts from the assistant's blockquoted text (lines starting with > in the response).

key_numbers should reflect what matters NOW — not all deal numbers. During active negotiation: target, their offer, gap. During financing: APR, monthly, total interest. During research: budget, fair price range.

leverage should capture concrete advantages, not generic advice. Good: "Car listed 45 days", "Pre-approved at 4.9%". Bad: "You have leverage"."""


def _build_conversation_context(
    messages: list[dict],
    assistant_text: str,
    recent_count: int = POST_CHAT_RECENT_MESSAGES,
    msg_truncation: int = POST_CHAT_MESSAGE_TRUNCATION,
    assistant_truncation: int = POST_CHAT_ASSISTANT_TRUNCATION,
    include_assistant: bool = True,
) -> str:
    """Build conversation context string from recent messages."""
    recent = messages[-recent_count:]
    context_parts = []
    for msg in recent:
        content = msg["content"]
        if isinstance(content, list):
            text_parts = [
                part["text"]
                for part in content
                if isinstance(part, dict) and part.get("text")
            ]
            content = " ".join(text_parts) if text_parts else "(image)"
        context_parts.append(f"[{msg['role']}]: {content[:msg_truncation]}")
    if include_assistant:
        context_parts.append(f"[assistant]: {assistant_text[:assistant_truncation]}")
    return "\n".join(context_parts)


async def process_post_chat(
    deal_state_dict: dict,
    messages: list[dict],
    assistant_text: str,
) -> AsyncGenerator[tuple[str, dict], None]:
    """Single streamed Sonnet call for all post-chat extraction and analysis.

    Yields (tool_name, tool_input) tuples as each tool_use block completes
    during streaming. The caller processes results incrementally.
    """
    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    state_json = json.dumps(deal_state_dict, indent=2, default=str)
    conversation_context = _build_conversation_context(messages, assistant_text)

    # Add cache_control to the last tool to cache all 3 tool schemas as one prefix
    tools: list[dict] = [
        FACTUAL_EXTRACTOR_TOOL,
        ANALYST_TOOL,
        {**SITUATION_ASSESSOR_TOOL, "cache_control": {"type": "ephemeral"}},
    ]

    try:
        async with client.messages.stream(
            model=settings.CLAUDE_MODEL,
            max_tokens=POST_CHAT_MAX_TOKENS,
            tools=tools,  # type: ignore[arg-type]
            tool_choice={"type": "auto"},
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": POST_CHAT_PROMPT,
                            "cache_control": {"type": "ephemeral"},
                        },
                        {
                            "type": "text",
                            "text": (
                                f"Current deal state:\n```json\n{state_json}\n```\n\n"
                                f"Conversation:\n{conversation_context}"
                            ),
                        },
                    ],
                }
            ],
        ) as stream:
            # Track tool_use blocks as they stream in
            current_tool_name: str | None = None
            current_tool_input_json = ""
            tools_called: list[str] = []

            async for event in stream:
                if event.type == "content_block_start":
                    if (
                        hasattr(event.content_block, "type")
                        and event.content_block.type == "tool_use"
                    ):
                        current_tool_name = event.content_block.name
                        current_tool_input_json = ""

                elif event.type == "content_block_delta":
                    if (
                        hasattr(event.delta, "type")
                        and event.delta.type == "input_json_delta"
                    ):
                        current_tool_input_json += event.delta.partial_json

                elif event.type == "content_block_stop":
                    if current_tool_name and current_tool_input_json:
                        try:
                            tool_input = json.loads(current_tool_input_json)
                            if isinstance(tool_input, dict):
                                tools_called.append(current_tool_name)
                                logger.debug(
                                    "Post-chat tool [%s] keys: %s",
                                    current_tool_name,
                                    list(tool_input.keys()),
                                )
                                yield (current_tool_name, tool_input)
                            else:
                                logger.warning(
                                    "Post-chat tool [%s] returned non-dict: %s",
                                    current_tool_name,
                                    type(tool_input).__name__,
                                )
                        except json.JSONDecodeError:
                            logger.warning(
                                "Post-chat tool [%s] returned invalid JSON",
                                current_tool_name,
                            )
                    current_tool_name = None
                    current_tool_input_json = ""

            # Log cache usage from the final message
            final_message = await stream.get_final_message()
            usage = final_message.usage
            logger.info(
                "Cache [post_chat]: creation=%d read=%d uncached=%d",
                getattr(usage, "cache_creation_input_tokens", 0) or 0,
                getattr(usage, "cache_read_input_tokens", 0) or 0,
                usage.input_tokens,
            )

            logger.info(
                "Post-chat complete: tools_called=%s",
                tools_called if tools_called else "(none)",
            )

    except Exception:
        logger.exception("Post-chat processing failed")


def merge_extraction_results(facts: dict, analysis: dict) -> dict:
    """Merge factual extraction and analyst results into a single extraction dict.

    This produces the same format that _apply_extraction in chat.py expects.
    """
    merged = {}

    # From factual extractor
    for key in (
        "vehicle",
        "deal",
        "numbers",
        "phase",
        "buyer_context",
        "checklist",
        "quick_actions",
        "switch_active_deal_id",
        "remove_vehicle_id",
    ):
        if key in facts:
            merged[key] = facts[key]

    # From analyst
    for key in (
        "health",
        "scorecard",
        "deal_red_flags",
        "session_red_flags",
        "deal_information_gaps",
        "session_information_gaps",
    ):
        if key in analysis:
            merged[key] = analysis[key]

    # Map analyst "comparison" to "deal_comparison" (what _apply_extraction expects)
    if "comparison" in analysis:
        merged["deal_comparison"] = analysis["comparison"]

    return merged


async def analyze_deal(
    deal_state_dict: dict,
    messages: list[dict],
    assistant_text: str,
) -> dict:
    """Standalone deal analysis for re-assessment (e.g., after inline corrections).

    Used by the deals PATCH endpoint. Uses Sonnet with cached tool definition
    for consistency with the post-chat pipeline.
    """
    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    state_json = json.dumps(deal_state_dict, indent=2, default=str)
    conversation_context = _build_conversation_context(messages, assistant_text)

    try:
        response = await client.messages.create(  # type: ignore[call-overload]
            model=settings.CLAUDE_MODEL,
            max_tokens=1536,
            tools=[
                {**ANALYST_TOOL, "cache_control": {"type": "ephemeral"}},
            ],
            tool_choice={"type": "auto"},
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Current deal state:\n```json\n{state_json}\n```\n\n"
                        f"Conversation:\n{conversation_context}\n\n"
                        "Assess the deal quality, identify risks, and surface information gaps. "
                        "Health summary must reference the buyer's actual data. "
                        "Recommendation must be specific. Missing info is NEVER a red flag."
                    ),
                }
            ],
        )

        # Log cache usage
        usage = response.usage
        logger.info(
            "Cache [analyze_deal]: creation=%d read=%d uncached=%d",
            getattr(usage, "cache_creation_input_tokens", 0) or 0,
            getattr(usage, "cache_read_input_tokens", 0) or 0,
            usage.input_tokens,
        )

        for block in response.content:
            if block.type == "tool_use" and block.name == "analyze_deal":
                result = block.input
                logger.debug(
                    "Analyst returned keys: %s",
                    list(result.keys()) if result else "(empty)",
                )
                return result if isinstance(result, dict) else {}

        logger.debug("Analyst did not call tool — no assessment changes")
        return {}

    except Exception:
        logger.exception("Deal analysis failed")
        return {}


def build_system_prompt() -> list[dict]:
    """Build system prompt as a single static cached block.

    The system prompt is entirely static — no per-session or per-turn content.
    Dynamic context (deal state, negotiation context, buyer situation) is
    injected as a context message via build_context_message() to preserve
    cache hits across turns.
    """
    return [
        {
            "type": "text",
            "text": SYSTEM_PROMPT_STATIC,
            "cache_control": {"type": "ephemeral"},
        }
    ]


def build_context_message(
    deal_state_dict: dict | None, linked_messages: list[dict] | None = None
) -> dict | None:
    """Build a synthetic context message with dynamic per-turn state.

    This is prepended to the messages array (not the system prompt) so the
    system prompt stays stable and cacheable across turns. Uses
    <system-reminder> tags following the reference architecture pattern.
    """
    context_parts: list[str] = []

    if deal_state_dict:
        buyer_context = deal_state_dict.get("buyer_context", BuyerContext.RESEARCHING)
        preamble = CONTEXT_PREAMBLES.get(BuyerContext(buyer_context))
        if preamble:
            context_parts.append(f"Buyer situation: {preamble}")

        # Negotiation context summary for primary model awareness
        negotiation_context = deal_state_dict.get("negotiation_context")
        if negotiation_context and isinstance(negotiation_context, dict):
            stance = negotiation_context.get("stance", "")
            situation = negotiation_context.get("situation", "")
            if stance and situation:
                context_parts.append(f"Negotiation status: [{stance}] {situation}")
            pending_actions = negotiation_context.get("pending_actions", [])
            pending_summary = ", ".join(
                item["action"]
                for item in pending_actions
                if isinstance(item, dict) and not item.get("done")
            )
            if pending_summary:
                context_parts.append(f"Pending actions: {pending_summary}")

        # Health/flags summary from active deal
        active_deal_id = deal_state_dict.get("active_deal_id")
        deals = deal_state_dict.get("deals", [])
        active_deal = None
        if active_deal_id and deals:
            for deal in deals:
                if deal.get("id") == active_deal_id:
                    active_deal = deal
                    break

        health = active_deal.get("health", {}) if active_deal else {}
        health_status = health.get("status") if health else None
        health_summary = health.get("summary") if health else None
        deal_red_flags = active_deal.get("red_flags", []) if active_deal else []
        deal_info_gaps = active_deal.get("information_gaps", []) if active_deal else []

        session_red_flags = deal_state_dict.get("session_red_flags", [])
        session_info_gaps = deal_state_dict.get("session_information_gaps", [])

        all_red_flags = deal_red_flags + session_red_flags
        all_info_gaps = deal_info_gaps + session_info_gaps

        critical_count = sum(
            1 for f in all_red_flags if f.get("severity") == RedFlagSeverity.CRITICAL
        )

        summary_lines = []
        if health_status:
            summary_lines.append(
                f"Deal health: {health_status}"
                + (f" — {health_summary}" if health_summary else "")
            )
        if all_red_flags:
            summary_lines.append(
                f"Active red flags: {len(all_red_flags)}"
                + (f" ({critical_count} critical)" if critical_count else "")
            )
        if all_info_gaps:
            summary_lines.append(f"Information gaps: {len(all_info_gaps)} remaining")

        if summary_lines:
            context_parts.append("\n".join(summary_lines))

        context_parts.append(
            f"Current deal state:\n```json\n"
            f"{json.dumps(deal_state_dict, indent=2, default=str)}\n```"
        )

    if linked_messages:
        summaries = []
        for msg in linked_messages[-LINKED_CONTEXT_MAX_MESSAGES:]:
            content = msg["content"]
            if isinstance(content, list):
                text_parts = [
                    part["text"]
                    for part in content
                    if isinstance(part, dict) and part.get("text")
                ]
                content = " ".join(text_parts) if text_parts else "(image)"
            summaries.append(
                f"[{msg['role']}]: {content[:LINKED_CONTEXT_MESSAGE_TRUNCATION]}"
            )
        context_parts.append("Previous conversation context:\n" + "\n".join(summaries))

    if not context_parts:
        return None

    context_text = (
        "<system-reminder>\n"
        + "\n".join(context_parts)
        + "\n\nIMPORTANT: This context reflects the current deal state. "
        "Use it to inform your response but do not repeat it back to the user."
        "\n</system-reminder>"
    )
    return {"role": "user", "content": context_text}


def build_messages(
    history: list[dict],
    user_content: str,
    image_url: str | None = None,
    context_message: dict | None = None,
) -> list[dict]:
    """Build the messages array for Claude API from message history.

    Conversation history comes first (stable, cacheable prefix) with a cache
    breakpoint on the last history message. Dynamic context and the new user
    message come after the breakpoint (uncached, change every turn).
    """
    messages: list[dict] = []

    # History FIRST — stable prefix, cacheable across turns
    max_history = settings.CLAUDE_MAX_HISTORY
    history_slice = history[-max_history:]
    for i, msg in enumerate(history_slice):
        entry: dict = {"role": msg["role"], "content": msg["content"]}
        # Cache breakpoint on the last history message
        if i == len(history_slice) - 1:
            if isinstance(entry["content"], str):
                entry["content"] = [
                    {
                        "type": "text",
                        "text": entry["content"],
                        "cache_control": {"type": "ephemeral"},
                    }
                ]
            elif isinstance(entry["content"], list):
                last_block = {
                    **entry["content"][-1],
                    "cache_control": {"type": "ephemeral"},
                }
                entry["content"] = [*entry["content"][:-1], last_block]
        messages.append(entry)

    # Dynamic context AFTER history — changes every turn, not cached
    if context_message:
        messages.append(context_message)
        # Claude requires alternating user/assistant
        messages.append(
            {"role": "assistant", "content": "Understood. I have the current context."}
        )

    # New user message (uncached — changes every turn)
    if image_url:
        messages.append(
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "url", "url": image_url},
                    },
                    {"type": "text", "text": user_content},
                ],
            }
        )
    else:
        messages.append({"role": "user", "content": user_content})

    return messages


async def stream_chat(
    system_prompt: list[dict],
    messages: list[dict],
) -> AsyncGenerator[str, None]:
    """Stream Claude response as SSE events with prompt caching.

    system_prompt is a list of content blocks (static block with cache_control,
    dynamic block without). Top-level cache_control enables automatic multi-turn
    conversation caching — the cache breakpoint advances through the growing
    message history each turn.

    Yields SSE-formatted strings:
    - event: text\\ndata: {"chunk": "..."}\\n\\n
    - event: done\\ndata: {"text": "..."}\\n\\n
    """
    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    full_text = ""

    async with client.messages.stream(
        model=settings.CLAUDE_MODEL,
        max_tokens=settings.CLAUDE_MAX_TOKENS,
        system=system_prompt,  # type: ignore[arg-type]
        messages=messages,  # type: ignore[arg-type]
    ) as stream:
        async for event in stream:
            if event.type == "content_block_delta":
                if hasattr(event.delta, "type") and event.delta.type == "text_delta":
                    chunk = event.delta.text
                    full_text += chunk
                    yield f"event: text\ndata: {json.dumps({'chunk': chunk})}\n\n"

        # Log cache usage
        final_message = await stream.get_final_message()
        usage = final_message.usage
        logger.info(
            "Cache [main_chat]: creation=%d read=%d uncached=%d",
            getattr(usage, "cache_creation_input_tokens", 0) or 0,
            getattr(usage, "cache_read_input_tokens", 0) or 0,
            usage.input_tokens,
        )

    yield f"event: done\ndata: {json.dumps({'text': full_text})}\n\n"


GENERATE_AI_PANEL_PROMPT = """You are an AI insights panel generator for a car buying advisor app. Given the current deal state and the assistant's latest response, generate a set of cards for the buyer's insights panel.

The panel is a live dashboard the buyer glances at — show the most important information RIGHT NOW.

CRITICAL RULES:
- NEVER contradict the assistant's advice. The panel structures and supplements the chat response — it does not give independent opinions or alternative strategies.
- Body text must be 1-2 SENTENCES max. Not paragraphs. The chat has the detail — the panel is a glanceable summary.
- Cards must not repeat each other. Each card should convey a distinct piece of information.

Return ONLY a JSON array of card objects. Each card has:
- "type": one of "briefing", "numbers", "vehicle", "warning", "tip", "checklist", "success", "comparison"
- "title": short card title (2-5 words)
- "content": card-type-specific content object (schemas below)
- "priority": "critical", "high", "normal", or "low"

CARD TYPES — each renders with a distinct visual template:

briefing — Status updates, assessments, next steps, strategy advice.
  Visual: Blue left accent border (high/critical) or plain card (normal/low). NEVER red.
  Use for: "where we are", "what's happening", "what to do next"
  Schema: {"body": "1-2 sentences. Supports **markdown**."}

warning — Genuine problems or dealer tactics that could hurt the buyer.
  Visual: Red border + AlertCircle (critical), Yellow border + AlertTriangle (warning).
  Use for: Suspicious charges, scam tactics, hidden fees, missing info creating financial risk, pressure tactics ("let me talk to my manager"), monthly payment misdirection, F&I upsells.
  NOT for: Status updates, negotiation progress, next steps, general advice.
  Test: "Could this hurt the buyer — financially, tactically, or informationally?" If no, use briefing.
  Schema: {"severity": "critical|warning", "message": "The concern", "action": "Optional — what to do"}

numbers — Financial data display with labeled rows.
  Visual: Uppercase section label, label-value rows. Values highlighted good (green), bad (red), or neutral.
  Labels must be SHORT (2-4 words max). Good: "Listing Price", "Your Target", "Gap". Bad: "Fair Range (Gas, 2017-2020, 80-140k mi)" — too long, will wrap on mobile.
  Schema: {"rows": [{"label": "Field", "value": "$32,000", "field": "current_offer", "highlight": "good|bad|neutral"}]}
  Editable fields (include "field"): msrp, invoice_price, listing_price, your_target, walk_away_price, current_offer, monthly_payment, apr, loan_term_months, down_payment, trade_in_value
  Groups: {"groups": [{"key": "pricing", "rows": [...]}, {"key": "financing", "rows": [...]}]}
  IMPORTANT: Use the actual numbers from the deal state. Do NOT confuse listing_price (advertised price before taxes/fees) with financed totals (price + taxes + fees). Labels must accurately describe what the number represents.

vehicle — Vehicle information with specs and risk flags.
  Visual: Uppercase contextual label (title), bold vehicle name, specs, danger-colored risk flags.
  Title should be a short contextual label (2-4 words) that matches the buyer's situation:
  - Researching/shopping: "Target Vehicle", "Searching For"
  - Evaluating a specific vehicle: "Under Consideration", "Candidate"
  - Found a specific listing: "At [Dealer Name]", "[City] Listing"
  - Actively negotiating/bought: "Your Vehicle", "Your Deal"
  - Trade-in: "Trade-In"
  - Comparing multiple: "Option A", "Option B"
  NEVER use "Your Vehicle" when the buyer is still searching — that implies ownership. NOT the vehicle name (that's in content).
  risk_flags should be genuine concerns about the vehicle — not open preferences. If the buyer says "I'm open to diesel or gas", that is NOT a risk flag. Risk flags are for actual problems: high mileage, accident history, missing records, mechanical concerns.
  Schema: {"vehicle": {"year": 2024, "make": "Ford", "model": "F-250", "trim": "XLT", "engine": "7.3L V8", "mileage": 15000, "color": "White", "vin": "1FT...", "role": "primary|trade_in"}, "risk_flags": ["High Mileage"]}

tip — Tactical advice and helpful context.
  Visual: Lightbulb icon in blue, title + body.
  Schema: {"body": "Helpful advice. Supports **markdown**."}

checklist — Action items with checkboxes.
  Visual: Uppercase section label, progress counter, checkbox rows.
  Schema: {"items": [{"label": "Item description", "done": false}]}

success — Celebrate a win: savings achieved, deal closed, milestone reached.
  Visual: Green left border + CheckCircle icon in green. The "referral screenshot" card.
  Use sparingly — only for genuine, measurable wins.
  Schema: {"body": "You saved an estimated **$2,400** compared to the dealer's first offer."}

comparison — Side-by-side deal comparison when 2+ deals exist.
  Visual: Uppercase section label, summary, highlight rows with winner in green, recommendation at bottom.
  Use when: Buyer is comparing the same vehicle at different dealers or different vehicles.
  Schema: {"summary": "Brief comparison", "recommendation": "Which to choose", "best_deal_id": "id", "highlights": [{"label": "Price", "values": [{"deal_id": "id", "value": "$28,500", "is_winner": true}], "note": "Optional"}]}

PRIORITY — controls emphasis within a card's template:
- "critical": Red styling ONLY on warning cards. All other types treat this as "high" (blue).
- "high": Important — next steps, key insights. Blue accent on briefings.
- "normal": Supplementary context. No accent.
- "low": Nice-to-know background details.

PHASE-AWARE COMPOSITION:
- Research (at home): 4-6 cards, thorough. Vehicle + briefing + numbers + tip + checklist.
- At dealership (negotiation): 3-4 cards MAX. Short text. Briefing (with script) + numbers + warning (if applicable).
- Financing/F&I: Warnings dominate (flag upsells). Numbers show total cost impact. 3-4 cards.
- Closing: Success card (if savings), numbers (final summary), checklist (post-purchase). 2-4 cards.

CARD STABILITY — maintain continuity for data cards:
- Vehicle, numbers, checklist: keep the same structure across exchanges, update values.
- Briefing, warning, tip, success: regenerate based on latest context.

EXAMPLES:

Early research panel:
[
  {"type": "vehicle", "title": "Target Vehicle", "content": {"vehicle": {"year": 2024, "make": "Toyota", "model": "Camry", "trim": "SE"}, "risk_flags": []}, "priority": "normal"},
  {"type": "briefing", "title": "Getting Started", "content": {"body": "Good choice on the Camry SE. Next step: get pre-approved from your bank before visiting dealers."}, "priority": "high"},
  {"type": "tip", "title": "Pre-Approval Advantage", "content": {"body": "A bank pre-approval forces the dealer to compete on price alone and gives you a rate floor."}, "priority": "normal"},
  {"type": "checklist", "title": "Research Checklist", "content": {"items": [{"label": "Get pre-approved financing", "done": false}, {"label": "Check KBB/Edmunds fair purchase price", "done": false}]}, "priority": "normal"}
]

Active negotiation at dealership:
[
  {"type": "warning", "title": "Monthly Payment Misdirection", "content": {"severity": "warning", "message": "Dealer switched from total price to monthly payment. They may be stretching the term to hide the real cost.", "action": "Redirect: 'What's the out-the-door price? I'll worry about monthly later.'"}, "priority": "critical"},
  {"type": "briefing", "title": "Hold at $28,500", "content": {"body": "Their counter of $30,200 is $1,700 above your target. You have leverage — the car has been listed 45 days."}, "priority": "high"},
  {"type": "numbers", "title": "Price Gap", "content": {"rows": [{"label": "Your Offer", "value": "$28,500", "highlight": "good"}, {"label": "Their Counter", "value": "$30,200", "highlight": "bad"}, {"label": "Gap", "value": "$1,700", "highlight": "bad"}]}, "priority": "high"}
]

DON'T DO THIS:
- {"type": "warning", "title": "Price Negotiation in Progress"} — This is a status update, not a warning. Use briefing.
- {"type": "briefing", "priority": "critical"} — Critical on a briefing renders as blue (same as high), not red. If you need red, use warning.
- {"type": "warning", "title": "Next Steps"} — Next steps are advice, not a problem. Use briefing or tip.

NEGOTIATION CONTEXT:
If the deal state contains a "negotiation_context" object, it represents the AI advisor's maintained understanding of the buyer's current situation. This context PERSISTS across conversation turns — it is the ground truth for where things stand.

CRITICAL: Your cards must ALWAYS reflect the negotiation context when present:
- The briefing card should reflect the "situation" field — what is happening right now
- If "scripts" are present, include a dedicated briefing card (title: the script label) with the script text in a blockquote-style body. Scripts are word-for-word things the buyer should say.
- If "pending_actions" are present, include them as a checklist card
- If "key_numbers" are present, use them to build the numbers card (they represent what matters NOW, not all deal numbers)
- If "leverage" points are present, include a tip card surfacing the buyer's advantages

The negotiation context takes PRECEDENCE over your own interpretation of the truncated conversation. Do NOT generate cards that ignore or contradict it. If the context says the buyer is waiting for a callback with specific scripts, those scripts MUST appear in the panel even if the latest message was about something else.

RULES:
- ALWAYS include a vehicle card if a vehicle has been identified
- ALWAYS include a briefing card with your current assessment
- Include numbers when financial data exists
- Body text: 1-2 sentences max. The chat has the detail.
- Order: warnings > success > briefings > numbers > comparison > vehicle > tips > checklist
- Do NOT repeat the chat response — supplement with structured data
- Checklist items MUST have text labels

Return ONLY the JSON array, no other text."""


async def generate_ai_panel_cards(
    deal_state_dict: dict,
    assistant_text: str,
    messages: list[dict],
) -> list[dict]:
    """Generate AI panel cards based on deal state and conversation context.

    Called after the main Claude response to populate the AI-driven panel.
    Uses Sonnet with prompt caching — the large static panel prompt (~2,500 tokens)
    is cached across calls, making subsequent calls fast and cheap.
    """
    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    state_json = json.dumps(deal_state_dict, indent=2, default=str)
    conversation_context = _build_conversation_context(
        messages,
        assistant_text,
        recent_count=PANEL_RECENT_MESSAGES,
        msg_truncation=PANEL_MESSAGE_TRUNCATION,
        assistant_truncation=PANEL_ASSISTANT_TRUNCATION,
    )

    try:
        response = await client.messages.create(
            model=settings.CLAUDE_MODEL,
            max_tokens=PANEL_GENERATOR_MAX_TOKENS,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": GENERATE_AI_PANEL_PROMPT,
                            "cache_control": {"type": "ephemeral"},
                        },
                        {
                            "type": "text",
                            "text": (
                                f"Deal state:\n```json\n{state_json}\n```\n\n"
                                f"Recent conversation:\n{conversation_context}"
                            ),
                        },
                    ],
                }
            ],
        )
        # Log cache usage
        usage = response.usage
        logger.info(
            "Cache [panel]: creation=%d read=%d uncached=%d",
            getattr(usage, "cache_creation_input_tokens", 0) or 0,
            getattr(usage, "cache_read_input_tokens", 0) or 0,
            usage.input_tokens,
        )

        text = ""
        for block in response.content:
            if hasattr(block, "text"):
                text = block.text.strip()
                break

        logger.debug("AI panel raw response: %s", text[:200] if text else "(empty)")

        if not text:
            return []

        # Strip markdown code fences if present
        if text.startswith("```"):
            text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

        cards = json.loads(text)
        if not isinstance(cards, list):
            logger.warning("AI panel response is not a list: %s", type(cards).__name__)
            return []

        # Validate card structure
        validated = []
        for card in cards:
            if not isinstance(card, dict):
                continue
            if card.get("type") not in VALID_PANEL_CARD_TYPES:
                continue
            if not card.get("title"):
                continue
            if not isinstance(card.get("content"), dict):
                continue
            # Default priority to normal
            if card.get("priority") not in VALID_PANEL_CARD_PRIORITIES:
                card["priority"] = "normal"
            validated.append(card)

        logger.info(
            "AI panel generated %d cards: %s",
            len(validated),
            [c["type"] for c in validated],
        )
        return validated

    except Exception:
        logger.exception("Failed to generate AI panel cards")
        return []
