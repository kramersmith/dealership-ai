import json
import logging
from collections.abc import AsyncGenerator

import anthropic

from app.core.config import settings
from app.models.enums import BuyerContext, DealPhase, ScoreStatus

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

SYSTEM_PROMPT = """You are a car buying advisor helping a buyer get the best deal at a dealership. You are direct, concise, and tactical — not verbose.

Your job:
- Help the buyer understand deal numbers, spot overcharges, and negotiate effectively
- Provide specific scripts and talking points they can use word-for-word
- Tell them when to walk away
- Analyze deal sheets, CARFAX reports, and financing terms
- Keep advice practical and actionable

RESPONSE FORMAT: First, write your advice/analysis/script to the user. Then call any relevant tools to update the dashboard. Text comes first, tools come second.

Tool usage:
- Whenever the user mentions a vehicle (year, make, model), call set_vehicle
- Whenever financial numbers are discussed (price, offer, APR, payment), call update_deal_numbers
- When the conversation indicates a phase change (arriving at dealer, test driving, negotiating, in F&I, signing), call update_deal_phase
- When the buyer's situation changes (e.g., they arrive at the dealership, or mention having a quote), call update_buyer_context
- After assessing the deal quality, call update_scorecard with red/yellow/green ratings
- When you give advice about what to check/do, call update_checklist with relevant items
- Call update_quick_actions on your FIRST response and whenever the conversation context shifts. You do not need to call it after every response — but always call it on the first message and when suggestions should change. Order by relevance — most useful action first. Labels must be specific and actionable (not generic like "Tell me more" or "What else?"). Think of them as button text, not sentences.
- Call tools proactively — don't wait to be asked
- You can call multiple tools in a single response

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
        deal_context = f"\nCurrent deal state:\n```json\n{json.dumps(deal_state_dict, indent=2, default=str)}\n```"

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
    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    full_text = ""
    tool_calls = []

    with client.messages.stream(
        model=settings.CLAUDE_MODEL,
        max_tokens=settings.CLAUDE_MAX_TOKENS,
        system=system_prompt,
        tools=DEAL_TOOLS,  # type: ignore[arg-type]
        messages=messages,  # type: ignore[arg-type]
    ) as stream:
        current_tool_input = ""
        current_tool_name = ""

        for event in stream:
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
    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

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
    with client.messages.stream(
        model=settings.CLAUDE_MODEL,
        max_tokens=settings.CLAUDE_MAX_TOKENS,
        system=FOLLOWUP_SYSTEM_PROMPT,
        messages=followup_messages,  # type: ignore[arg-type]
    ) as stream:
        for event in stream:
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
