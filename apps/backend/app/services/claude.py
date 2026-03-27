import json
import logging
from collections.abc import AsyncGenerator

import anthropic

from app.core.config import settings
from app.models.enums import (
    BuyerContext,
    DealPhase,
    GapPriority,
    HealthStatus,
    RedFlagSeverity,
    ScoreStatus,
)

logger = logging.getLogger(__name__)

DEAL_TOOLS = [
    {
        "name": "update_deal_numbers",
        "description": (
            "Update the deal numbers dashboard when the user mentions prices, payments, rates, "
            "or financial terms. Call this whenever any financial figure is discussed or changes."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "msrp": {
                    "type": "number",
                    "description": "Manufacturer's suggested retail price",
                },
                "invoice_price": {
                    "type": "number",
                    "description": "Dealer invoice price",
                },
                "listing_price": {
                    "type": "number",
                    "description": "The price the vehicle is listed or advertised for, before negotiation or fees",
                },
                "your_target": {
                    "type": "number",
                    "description": "The buyer's target price",
                },
                "walk_away_price": {
                    "type": "number",
                    "description": "Price above which the buyer should walk away",
                },
                "current_offer": {
                    "type": "number",
                    "description": "The current price on the table (out-the-door, negotiated, or latest offer). Set this whenever the buyer mentions a specific price being offered.",
                },
                "monthly_payment": {
                    "type": "number",
                    "description": "Monthly payment amount",
                },
                "apr": {"type": "number", "description": "Annual percentage rate"},
                "loan_term_months": {
                    "type": "integer",
                    "description": "Loan term in months",
                },
                "down_payment": {
                    "type": "number",
                    "description": "Down payment amount",
                },
                "trade_in_value": {
                    "type": "number",
                    "description": "Trade-in vehicle value",
                },
            },
        },
    },
    {
        "name": "update_deal_phase",
        "description": "Update the current phase of the deal when the conversation indicates progression.",
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
        "description": "Update the red/yellow/green scorecard ratings based on how the deal is going for the buyer.",
        "input_schema": {
            "type": "object",
            "properties": {
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
        "name": "set_vehicle",
        "description": "Set or update the vehicle being discussed.",
        "input_schema": {
            "type": "object",
            "properties": {
                "year": {"type": "integer"},
                "make": {"type": "string"},
                "model": {"type": "string"},
                "trim": {"type": "string"},
                "vin": {"type": "string"},
                "mileage": {"type": "integer"},
                "color": {"type": "string"},
            },
            "required": ["make", "model"],
        },
    },
    {
        "name": "update_checklist",
        "description": "Update the buyer's checklist of things to verify/do at the dealership.",
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
        "name": "update_quick_actions",
        "description": (
            "Suggest 2-3 quick action buttons the buyer might want to tap next. "
            "Call this when the conversation context shifts or the previous suggestions "
            "are no longer relevant — not necessarily after every response. "
            "Order by relevance — most useful action first."
        ),
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
                                "description": "Button text, 2-5 words. Be specific and actionable, not generic.",
                                "maxLength": 30,
                            },
                            "prompt": {
                                "type": "string",
                                "description": "The full prompt sent when tapped",
                                "maxLength": 200,
                            },
                        },
                        "required": ["label", "prompt"],
                    },
                    "minItems": 2,
                    "maxItems": 3,
                },
            },
            "required": ["actions"],
        },
    },
    {
        "name": "update_buyer_context",
        "description": (
            "Update the buyer's situational context when it changes. For example, if the buyer "
            "mentions they just arrived at the dealership, or that they received a quote to review."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "buyer_context": {
                    "type": "string",
                    "enum": [c.value for c in BuyerContext],
                    "description": (
                        "researching: buyer is researching from home. "
                        "reviewing_deal: buyer has a quote or offer to analyze. "
                        "at_dealership: buyer is physically at the dealership right now."
                    ),
                },
            },
            "required": ["buyer_context"],
        },
    },
    {
        "name": "update_deal_health",
        "description": (
            "Update the overall deal health assessment. Call after any significant "
            "change to deal numbers, offers, or terms. Status must be grounded in "
            "the user's own data — never reference market prices you cannot verify."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": [s.value for s in HealthStatus],
                    "description": "Overall deal health signal",
                },
                "summary": {
                    "type": "string",
                    "description": (
                        "1-2 sentence explanation grounded in the user's data. "
                        "Example: 'Strong deal — offer is $1,200 below listing price' "
                        "or 'Concerning — APR of 7.9% on a 72-month term adds $4,200 "
                        "in interest'"
                    ),
                },
                "recommendation": {
                    "type": "string",
                    "description": (
                        "One concise action the buyer should take next, grounded in "
                        "their specific deal data. Examples: 'Counter at $31,500 — "
                        "the midpoint between their offer and your target', "
                        "'Ask them to break down the $895 doc fee', "
                        "'Get a pre-approval from your bank before accepting this APR'. "
                        "Must be specific and actionable, not generic advice."
                    ),
                },
            },
            "required": ["status", "summary", "recommendation"],
        },
    },
    {
        "name": "update_red_flags",
        "description": (
            "Surface concerns about the deal. Each flag must reference specific data "
            "from the conversation — never flag based on general market knowledge you "
            "cannot verify. Replaces the full list each time (pass empty array to clear). "
            "Common flags: monthly payment quoted without term length, fees that appeared "
            "unexpectedly, correlated trade-in/price changes, pressure tactics, numbers "
            "that changed from what was verbally agreed."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "flags": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {
                                "type": "string",
                                "description": (
                                    "Stable identifier, e.g. 'apr_high', 'hidden_doc_fee'"
                                ),
                            },
                            "severity": {
                                "type": "string",
                                "enum": [s.value for s in RedFlagSeverity],
                                "description": (
                                    "warning = be aware; critical = stop and address now"
                                ),
                            },
                            "message": {
                                "type": "string",
                                "description": "User-facing explanation, 1-2 sentences",
                            },
                        },
                        "required": ["id", "severity", "message"],
                    },
                    "description": "Full list of current flags (empty array to clear all)",
                },
            },
            "required": ["flags"],
        },
    },
    {
        "name": "update_information_gaps",
        "description": (
            "Identify missing information that would improve deal assessment quality. "
            "Always give your best advice with available data FIRST — then surface gaps "
            "as ways to sharpen the assessment. Never gate-keep help behind 'I need more "
            "information.' Replaces the full list each time. During research, always "
            "include pre-approval status as a high-priority gap with why it matters."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "gaps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {
                                "type": "string",
                                "description": (
                                    "What's missing, e.g. 'Credit score range'"
                                ),
                            },
                            "reason": {
                                "type": "string",
                                "description": (
                                    "Brief explanation of WHY this information would "
                                    "improve the assessment. E.g. 'Helps assess whether "
                                    "the APR they offer is competitive for your credit tier.'"
                                ),
                            },
                            "priority": {
                                "type": "string",
                                "enum": [p.value for p in GapPriority],
                            },
                        },
                        "required": ["label", "reason", "priority"],
                    },
                },
            },
            "required": ["gaps"],
        },
    },
]

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

SYSTEM_PROMPT = """You are a car buying advisor helping a buyer get the best deal. You are direct, concise, and tactical.

GROUNDING RULES (critical — violating these erodes user trust):
- NEVER state a specific market price as fact. You do not have real-time market data. Frame pricing relative to the user's own data: "Their offer is $3,000 above listing" NOT "The market price is $23,000."
- Red flags must reference specific data from the conversation. Good: "The APR of 7.9% on a 72-month term means $4,200 in interest." Bad: "This price is above average for your area."
- Always give your best assessment with available data FIRST, then surface information gaps as ways to sharpen the assessment. Never say "I need more information before I can help."
- Use blockquotes (> ) for negotiation scripts the buyer should say word-for-word.

Your job:
- Help buyers understand deal numbers, spot overcharges, and negotiate effectively
- Provide specific scripts in blockquotes they can use word-for-word
- Tell them when to walk away
- Analyze deal sheets, CARFAX reports, and financing terms

DEALER TACTICS TO RECOGNIZE:
- "Let me talk to my manager" — standard negotiation step. Flag as warning and coach buyer to prepare their next counter while waiting.
- Monthly payment focus — if the dealer leads with monthly instead of total price, flag it. They may be stretching the term to hide the real cost.
- Trade-in inflation — if trade-in value and vehicle price both increase, flag the net change. "They offered $2,000 more for your trade-in but raised the price by $1,500 — net improvement is only $500."
- Time pressure — if the buyer has been there 2+ hours or mentions feeling rushed, flag it as a tactic.
- F&I upsells — VIN etching, fabric protection, inflated warranty prices are high-margin items. Flag when mentioned. Remind buyer: "Everything in F&I is negotiable."

PHASE-SPECIFIC BEHAVIOR:
- When phase is financing: aggressively flag F&I add-ons, track how they change the total.
- When phase is closing: call update_checklist with post-purchase items (title arrival in 30 days, first statement review, trade-in payoff confirmation).
- During research: surface pre-approval as a high-priority information gap. Explain why: "Getting pre-approved forces the dealer to compete on price alone and gives you a rate floor."

RED FLAGS vs. INFORMATION GAPS (critical distinction):
- RED FLAGS = something is WRONG with the deal. A problem the buyer should act on.
  Examples: APR is unusually high, hidden fees appeared, dealer is using pressure tactics,
  monthly payment quoted without mentioning term length, numbers changed from verbal agreement.
  NEVER flag missing information as a red flag. "No vehicle selected" is NOT a red flag.
- INFORMATION GAPS = data that would IMPROVE the assessment. Things the buyer hasn't shared yet.
  Examples: credit score range, pre-approval status, year/mileage of the vehicle, budget.
  These are helpful to have, not problems to fix. Always include a suggested prompt the buyer
  can tap to provide the information.

TOOL USAGE — call proactively, multiple tools per response:
- set_vehicle: when user mentions year/make/model
- update_deal_numbers: when any financial figure is discussed
- update_deal_health: after ANY significant number/offer/term change — this is the buyer's #1 signal
- update_red_flags: ONLY for actual deal problems — not missing data (use update_information_gaps for that)
- update_information_gaps: what's missing that would sharpen the assessment. Include a tappable prompt for each gap.
- update_deal_phase / update_buyer_context: when situation changes
- update_scorecard: after assessing deal quality dimensions
- update_checklist: preparation/verification items
- update_quick_actions: on FIRST response and when context shifts. Labels: 2-5 words, specific, actionable. Order by relevance.

TOOL PRIORITY (most important first):
1. update_red_flags — surface actual deal problems immediately (NOT missing data)
2. update_deal_health — update after any significant change
3. update_information_gaps — identify missing data that would improve advice
4. update_deal_numbers — capture every financial figure
5. update_deal_phase / update_buyer_context — when situation changes
6. update_quick_actions — when context shifts (not every response)
7. update_scorecard / update_checklist — assessment details and action items

RESPONSE FORMAT (critical — buyers scan, they don't read essays):
- LEAD WITH THE CONCLUSION. First sentence = your assessment or answer. Never bury the point.
- Keep responses SHORT. 3-5 short paragraphs max. If the buyer is at the dealership, 1-2 paragraphs.
- Never "think out loud" or change your mind mid-response. Work out the math internally, then present the conclusion.
- Use bullet points for lists, not paragraphs.
- Put actionable scripts in blockquotes (> ).
- End with ONE clear next step, not multiple options.
- Text first, then tool calls.

{deal_state_context}
{linked_context}"""

FOLLOWUP_SYSTEM_PROMPT = """You are a car buying advisor. The user sent a message and you updated their dashboard with tool calls, but you did not include any text response. Now respond to the user with your analysis and advice based on what you just processed. Be direct and concise. Do not call any tools."""

QUICK_ACTIONS_PROMPT = """Based on the conversation so far, suggest 2-3 quick action buttons the buyer might want to tap next. Return a JSON array of objects with "label" (2-5 word button text, specific and actionable) and "prompt" (the full message sent when tapped). Order by relevance. Return ONLY the JSON array, no other text."""


def build_system_prompt(
    deal_state_dict: dict | None, linked_messages: list[dict] | None = None
) -> str:
    # Inject buyer context preamble
    context_preamble = ""
    if deal_state_dict:
        buyer_context = deal_state_dict.get("buyer_context", BuyerContext.RESEARCHING)
        preamble = CONTEXT_PREAMBLES.get(BuyerContext(buyer_context))
        if preamble:
            context_preamble = f"\nBuyer situation: {preamble}"

    deal_context = ""
    if deal_state_dict:
        # Lead with health/flags/gaps summary for attention priority
        health = deal_state_dict.get("health", {})
        health_status = health.get("status") if health else None
        health_summary = health.get("summary") if health else None
        red_flags = deal_state_dict.get("red_flags", [])
        info_gaps = deal_state_dict.get("information_gaps", [])
        critical_count = sum(
            1 for f in red_flags if f.get("severity") == RedFlagSeverity.CRITICAL
        )

        summary_lines = []
        if health_status:
            summary_lines.append(
                f"Deal health: {health_status}"
                + (f" — {health_summary}" if health_summary else "")
            )
        if red_flags:
            summary_lines.append(
                f"Active red flags: {len(red_flags)}"
                + (f" ({critical_count} critical)" if critical_count else "")
            )
        if info_gaps:
            summary_lines.append(f"Information gaps: {len(info_gaps)} remaining")

        state_summary = "\n".join(summary_lines)
        if state_summary:
            state_summary = f"\n{state_summary}"

        deal_context = (
            f"{state_summary}"
            f"\nCurrent deal state:\n```json\n"
            f"{json.dumps(deal_state_dict, indent=2, default=str)}\n```"
        )

    linked_context = ""
    if linked_messages:
        summaries = []
        for msg in linked_messages[-10:]:
            summaries.append(f"[{msg['role']}]: {msg['content'][:200]}")
        linked_context = "\nPrevious conversation context:\n" + "\n".join(summaries)

    return SYSTEM_PROMPT.format(
        deal_state_context=context_preamble + deal_context,
        linked_context=linked_context,
    )


def build_messages(
    history: list[dict], user_content: str, image_url: str | None = None
) -> list[dict]:
    """Build the messages array for Claude API from message history."""
    messages = []

    # Add history (last N messages)
    max_history = settings.CLAUDE_MAX_HISTORY
    for msg in history[-max_history:]:
        messages.append({"role": msg["role"], "content": msg["content"]})

    # Add current user message
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
    system_prompt: str,
    messages: list[dict],
) -> AsyncGenerator[str, None]:
    """Stream Claude response as SSE events.

    Yields SSE-formatted strings:
    - event: text\ndata: {"chunk": "..."}\n\n
    - event: tool_result\ndata: {"tool": "...", "data": {...}}\n\n
    - event: done\ndata: {}\n\n
    """
    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    full_text = ""
    tool_calls = []

    async with client.messages.stream(
        model=settings.CLAUDE_MODEL,
        max_tokens=settings.CLAUDE_MAX_TOKENS,
        system=system_prompt,
        tools=DEAL_TOOLS,  # type: ignore[arg-type]
        messages=messages,  # type: ignore[arg-type]
    ) as stream:
        current_tool_input = ""
        current_tool_name = ""

        async for event in stream:
            if event.type == "content_block_start":
                if hasattr(event.content_block, "type"):
                    if event.content_block.type == "tool_use":
                        current_tool_name = event.content_block.name
                        current_tool_input = ""

            elif event.type == "content_block_delta":
                if hasattr(event.delta, "type"):
                    if event.delta.type == "text_delta":
                        chunk = event.delta.text
                        full_text += chunk
                        yield f"event: text\ndata: {json.dumps({'chunk': chunk})}\n\n"
                    elif event.delta.type == "input_json_delta":
                        current_tool_input += event.delta.partial_json

            elif event.type == "content_block_stop":
                if current_tool_name and current_tool_input:
                    try:
                        tool_data = json.loads(current_tool_input)
                    except json.JSONDecodeError:
                        logger.warning(
                            "Malformed tool input JSON for tool %s, using empty dict",
                            current_tool_name,
                        )
                        tool_data = {}

                    tool_call = {"name": current_tool_name, "args": tool_data}
                    tool_calls.append(tool_call)
                    yield f"event: tool_result\ndata: {json.dumps({'tool': current_tool_name, 'data': tool_data})}\n\n"

                    current_tool_name = ""
                    current_tool_input = ""

    yield f"event: done\ndata: {json.dumps({'text': full_text, 'tool_calls': tool_calls})}\n\n"


async def stream_followup_text(
    messages: list[dict],
    tool_calls_summary: list[dict],
) -> AsyncGenerator[str, None]:
    """Generate a text-only follow-up when the primary response had tools but no text.

    This is a lightweight second pass — no tool definitions, just text generation.
    The messages include the original conversation plus a summary of what tools were called.
    """
    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    # Build a summary of what was processed
    tool_summary_parts = []
    for tc in tool_calls_summary:
        tool_summary_parts.append(f"{tc['name']}: {json.dumps(tc['args'])}")
    tool_summary = "\n".join(tool_summary_parts)

    # Add the tool-call context as an assistant+user turn so Claude knows what happened
    followup_messages = messages + [
        {"role": "assistant", "content": f"[I updated the dashboard: {tool_summary}]"},
        {
            "role": "user",
            "content": "Now give me your analysis and advice based on what I told you.",
        },
    ]

    full_text = ""
    async with client.messages.stream(
        model=settings.CLAUDE_MODEL,
        max_tokens=settings.CLAUDE_MAX_TOKENS,
        system=FOLLOWUP_SYSTEM_PROMPT,
        messages=followup_messages,  # type: ignore[arg-type]
    ) as stream:
        async for event in stream:
            if event.type == "content_block_delta":
                if hasattr(event.delta, "type") and event.delta.type == "text_delta":
                    chunk = event.delta.text
                    full_text += chunk
                    yield f"event: text\ndata: {json.dumps({'chunk': chunk})}\n\n"

    yield f"event: followup_done\ndata: {json.dumps({'text': full_text})}\n\n"


async def generate_quick_actions(
    messages: list[dict], assistant_text: str
) -> list[dict]:
    """Generate quick action suggestions based on conversation context.

    This is a non-streaming, lightweight call that returns structured data.
    Called when the primary response didn't include update_quick_actions.
    Uses the async client to avoid blocking the event loop.
    """
    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    # Trim assistant text to save tokens — Haiku only needs recent context
    trimmed_text = (
        assistant_text[-500:] if len(assistant_text) > 500 else assistant_text
    )

    context_messages = messages[-3:] + [
        {"role": "assistant", "content": trimmed_text},
        {"role": "user", "content": QUICK_ACTIONS_PROMPT},
    ]

    try:
        response = await client.messages.create(
            model=settings.CLAUDE_FAST_MODEL,
            max_tokens=256,
            messages=context_messages,  # type: ignore[arg-type]
        )
        # Extract text from response, handling different content block types
        text = ""
        for block in response.content:
            if hasattr(block, "text"):
                text = block.text.strip()
                break
        logger.debug(
            "Quick actions raw response: %s", text[:200] if text else "(empty)"
        )
        if not text:
            return []
        # Strip markdown code fences if Haiku wraps the JSON
        if text.startswith("```"):
            text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        actions = json.loads(text)
        if isinstance(actions, list):
            return [
                {"label": a["label"][:30], "prompt": a["prompt"][:200]}
                for a in actions[:3]
                if isinstance(a, dict) and a.get("label") and a.get("prompt")
            ]
    except Exception:
        logger.exception("Failed to generate quick actions")
    return []


ASSESS_DEAL_PROMPT = """You are a car deal assessment engine. Given the current deal state, provide:
1. An overall health status: "good", "fair", "concerning", or "bad"
2. A 1-2 sentence summary grounded in the data (never reference market prices you cannot verify)
3. One specific, actionable recommendation for what the buyer should do next based on their deal data
4. Any red flags — ONLY actual deal problems (high APR, hidden fees, pressure tactics, numbers that changed). Missing information is NOT a red flag.

Return ONLY a JSON object with this shape:
{
  "health": {"status": "good|fair|concerning|bad", "summary": "...", "recommendation": "..."},
  "flags": [{"id": "unique_id", "severity": "warning|critical", "message": "..."}]
}
The recommendation must be specific and actionable (e.g. "Counter at $31,500" not "Try negotiating").
Return empty flags array if no actual deal problems. Return ONLY the JSON, no other text."""


async def assess_deal_state(deal_state_dict: dict) -> dict:
    """Lightweight deal assessment via Haiku.

    Called when the primary model updated numbers but didn't call
    update_deal_health or update_red_flags. Returns a dict with
    optional 'health' and 'flags' keys.
    """
    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    state_json = json.dumps(deal_state_dict, indent=2, default=str)

    try:
        response = await client.messages.create(
            model=settings.CLAUDE_FAST_MODEL,
            max_tokens=512,
            messages=[
                {
                    "role": "user",
                    "content": f"Deal state:\n```json\n{state_json}\n```\n\n{ASSESS_DEAL_PROMPT}",
                }
            ],
        )
        text = ""
        for block in response.content:
            if hasattr(block, "text"):
                text = block.text.strip()
                break
        logger.debug(
            "Deal assessment raw response: %s", text[:200] if text else "(empty)"
        )
        if not text:
            return {}
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        result = json.loads(text)
        if not isinstance(result, dict):
            return {}
        # Validate health status
        health = result.get("health")
        if health and isinstance(health, dict):
            status = health.get("status")
            if status:
                try:
                    HealthStatus(status)
                except ValueError:
                    logger.warning(
                        "Assessment returned invalid health status: %s", status
                    )
                    result.pop("health", None)
            # Ensure recommendation is a string or absent
            rec = health.get("recommendation")
            if rec is not None and not isinstance(rec, str):
                logger.warning(
                    "Assessment returned non-string recommendation: %s",
                    type(rec).__name__,
                )
                health.pop("recommendation", None)
        # Validate red flags structure
        flags = result.get("flags")
        if flags is not None:
            if not isinstance(flags, list):
                result.pop("flags", None)
            else:
                validated_flags = []
                for f in flags:
                    if not isinstance(f, dict):
                        continue
                    if not all(k in f for k in ("id", "severity", "message")):
                        continue
                    try:
                        RedFlagSeverity(f["severity"])
                    except ValueError:
                        continue
                    validated_flags.append(f)
                result["flags"] = validated_flags
        return result
    except Exception:
        logger.exception("Failed to assess deal state")
        return {}
