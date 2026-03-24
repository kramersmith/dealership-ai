import json
import logging
from collections.abc import AsyncGenerator

import anthropic

from app.core.config import settings
from app.models.enums import DealPhase, ScoreStatus

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
                "their_offer": {
                    "type": "number",
                    "description": "The dealer's current asking/offer price",
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
                    "description": "The current negotiation price on the table",
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
]

SYSTEM_PROMPT = """You are a car buying advisor helping a buyer get the best deal at a dealership. You are direct, concise, and tactical — not verbose.

Your job:
- Help the buyer understand deal numbers, spot overcharges, and negotiate effectively
- Provide specific scripts and talking points they can use word-for-word
- Tell them when to walk away
- Analyze deal sheets, CARFAX reports, and financing terms
- Keep advice practical and actionable

IMPORTANT — Tool usage:
- Whenever the user mentions a vehicle (year, make, model), call set_vehicle
- Whenever financial numbers are discussed (price, offer, APR, payment), call update_deal_numbers
- When the conversation indicates a phase change (arriving at dealer, test driving, negotiating, in F&I, signing), call update_deal_phase
- After assessing the deal quality, call update_scorecard with red/yellow/green ratings
- When you give advice about what to check/do, call update_checklist with relevant items
- Call tools proactively — don't wait to be asked
- You can call multiple tools in a single response

Keep responses concise — car advice doesn't need essays. Use short paragraphs and scripts the buyer can use immediately.

{deal_state_context}
{linked_context}"""


def build_system_prompt(
    deal_state_dict: dict | None, linked_messages: list[dict] | None = None
) -> str:
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
        deal_state_context=deal_context,
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
