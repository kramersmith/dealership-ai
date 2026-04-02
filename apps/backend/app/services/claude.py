from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator
from typing import TYPE_CHECKING

import anthropic

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from app.models.deal_state import DealState

from app.core.config import settings
from app.models.enums import (
    BuyerContext,
    DealPhase,
    GapPriority,
    HealthStatus,
    NegotiationStance,
    RedFlagSeverity,
    ScoreStatus,
)

logger = logging.getLogger(__name__)

# ─── Context message configuration ───

LINKED_CONTEXT_MAX_MESSAGES = 10
LINKED_CONTEXT_MESSAGE_TRUNCATION = 200

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

TOOL USAGE:
- You have tools to track deal data as the conversation progresses. Call them ALONGSIDE your text response when information changes.
- Extract facts only from USER messages. Never persist data from your own suggestions or assistant responses.
- Only call tools when data has actually changed or is newly mentioned. Omit unchanged fields.
- You may call multiple tools in a single response. Do NOT narrate tool usage to the user — just respond naturally.
- For update_negotiation_context: update when the buyer's situation meaningfully changes (new offer, arrived at dealership, walked out, etc.). Preserve information from the previous context that is still relevant.

ASSESSMENT TOOLS — WHEN TO CALL:
Assessment tools (update_deal_health, update_scorecard, update_deal_red_flags, update_deal_information_gaps) keep the buyer's dashboard accurate. Call them whenever your assessment changes — do not wait for a "perfect" moment.
- After extracting or updating deal numbers (price, APR, fees, trade-in) → update_deal_health + update_scorecard
- When you identify a problem in the deal → update_deal_red_flags (and remove flags that no longer apply)
- When new data fills a gap or reveals a new one → update_deal_information_gaps
- When any of the above change meaningfully → update_deal_health to keep the summary current
- Health summary must reference the buyer's actual data. Recommendation must be specific ("Counter at $31,500") not generic ("Try negotiating").
- If a tool call fails, read the error and adjust your input — do not retry with the same arguments.

QUICK ACTIONS:
- Always call update_quick_actions with 2-3 contextually relevant suggestions at the end of every response.
- Quick actions should reflect the natural next step in the conversation, not repeat what was just discussed.

CRITICAL RULES FOR FINANCIAL NUMBERS:
- listing_price = the advertised/sticker price BEFORE taxes, fees, or financing
- current_offer = the dealer's current ask or negotiated price BEFORE taxes and fees
- NEVER confuse the financed total (price + taxes + fees) with listing_price or current_offer
- If buyer says "$35,900 with taxes included" and listing was $34,000, then listing_price=34000, NOT 35900

VEHICLE EXTRACTION RULES:
- Only create vehicles from user-provided information, not assistant suggestions
- Do NOT create vehicles from casual mentions ("my neighbor got a Tesla")
- If the user only supplied a VIN, you may extract the VIN itself, but do NOT infer or persist year/make/model/trim/engine from that VIN

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


# ─── Operational tool schemas for the chat turn loop ───
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


class ChatLoopResult:
    """Mutable container for collecting turn loop results.

    Populated by stream_chat_loop() so the caller can access
    full_text and tool_calls after iteration completes.
    """

    def __init__(self) -> None:
        self.full_text: str = ""
        self.tool_calls: list[dict] = []


# Maximum turns in the chat loop to prevent runaway tool chains
CHAT_LOOP_MAX_TURNS = 5


async def stream_chat_loop(  # noqa: C901 — turn loop has inherent complexity
    system_prompt: list[dict],
    messages: list[dict],
    tools: list[dict],
    deal_state: DealState | None,
    db: Session,
    result: ChatLoopResult,
    max_turns: int = CHAT_LOOP_MAX_TURNS,
) -> AsyncGenerator[str, None]:
    """Turn loop: call Claude with tools, execute tool calls, repeat until text response.

    Streams SSE events as they arrive:
    - event: text — conversation text chunks (streamed live)
    - event: tool_result — tool execution results (emitted after each tool)
    - event: done — final text when loop completes

    Populates `result` with accumulated full_text and all tool_calls.
    """
    from app.services.deal_state import execute_tool

    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    # Add cache_control to the last tool so the entire tool list is cached
    cached_tools = [*tools[:-1], {**tools[-1], "cache_control": {"type": "ephemeral"}}]

    for turn in range(max_turns):
        turn_text = ""
        tool_use_blocks: list[dict] = []  # {id, name, input}
        assistant_content_blocks: list[dict] = []  # raw content blocks for messages

        # Track streaming state for tool_use accumulation
        current_tool_id: str | None = None
        current_tool_name: str | None = None
        current_tool_input_json = ""
        json_error_blocks: list[dict] = []  # tool_use blocks with malformed JSON

        try:
            async with client.messages.stream(
                model=settings.CLAUDE_MODEL,
                max_tokens=settings.CLAUDE_MAX_TOKENS,
                system=system_prompt,  # type: ignore[arg-type]
                messages=messages,  # type: ignore[arg-type]
                tools=cached_tools,  # type: ignore[arg-type]
                tool_choice={"type": "auto"},
            ) as stream:
                async for event in stream:
                    if event.type == "content_block_start":
                        if hasattr(event.content_block, "type"):
                            if event.content_block.type == "text":
                                pass  # text accumulates via deltas
                            elif event.content_block.type == "tool_use":
                                current_tool_id = event.content_block.id
                                current_tool_name = event.content_block.name
                                current_tool_input_json = ""

                    elif event.type == "content_block_delta":
                        if hasattr(event.delta, "type"):
                            if event.delta.type == "text_delta":
                                chunk = event.delta.text
                                turn_text += chunk
                                yield f"event: text\ndata: {json.dumps({'chunk': chunk})}\n\n"
                            elif event.delta.type == "input_json_delta":
                                current_tool_input_json += event.delta.partial_json

                    elif event.type == "content_block_stop":
                        if current_tool_name and current_tool_input_json:
                            try:
                                tool_input = json.loads(current_tool_input_json)
                                if isinstance(tool_input, dict):
                                    tool_use_blocks.append(
                                        {
                                            "id": current_tool_id,
                                            "name": current_tool_name,
                                            "input": tool_input,
                                        }
                                    )
                                    assistant_content_blocks.append(
                                        {
                                            "type": "tool_use",
                                            "id": current_tool_id,
                                            "name": current_tool_name,
                                            "input": tool_input,
                                        }
                                    )
                            except json.JSONDecodeError:
                                logger.warning(
                                    "Turn %d: tool [%s] returned invalid JSON",
                                    turn,
                                    current_tool_name,
                                )
                                json_error_blocks.append(
                                    {"id": current_tool_id, "name": current_tool_name}
                                )
                            current_tool_id = None
                            current_tool_name = None
                            current_tool_input_json = ""

                # Capture text as a content block if present
                if turn_text:
                    assistant_content_blocks.insert(
                        0, {"type": "text", "text": turn_text}
                    )

                # Log cache usage
                final_message = await stream.get_final_message()
                usage = final_message.usage
                stop_reason = final_message.stop_reason
                logger.info(
                    "Cache [chat_loop turn=%d]: creation=%d read=%d uncached=%d stop=%s",
                    turn,
                    getattr(usage, "cache_creation_input_tokens", 0) or 0,
                    getattr(usage, "cache_read_input_tokens", 0) or 0,
                    usage.input_tokens,
                    stop_reason,
                )

        except Exception:
            logger.exception("Chat loop turn %d failed", turn)
            yield f"event: error\ndata: {json.dumps({'message': 'AI response failed. Please try again.'})}\n\n"
            return

        # Accumulate text across turns
        result.full_text += turn_text

        # If no tool calls, we're done — emit done event
        if stop_reason == "end_turn" or not tool_use_blocks:
            yield f"event: done\ndata: {json.dumps({'text': result.full_text})}\n\n"
            logger.info(
                "Chat loop complete: turns=%d, text_length=%d, tool_calls=%d",
                turn + 1,
                len(result.full_text),
                len(result.tool_calls),
            )
            return

        # Execute tool calls and emit SSE events
        tool_result_content: list[dict] = []

        # Send error tool_results for any tool_use blocks with malformed JSON
        for err_block in json_error_blocks:
            error_msg = f"Tool '{err_block['name']}' received malformed JSON input"
            tool_result_content.append(
                {
                    "type": "tool_result",
                    "tool_use_id": err_block["id"],
                    "is_error": True,
                    "content": error_msg,
                }
            )
            # Include the broken tool_use in assistant content so the message
            # history stays valid (every tool_result needs a matching tool_use)
            assistant_content_blocks.append(
                {
                    "type": "tool_use",
                    "id": err_block["id"],
                    "name": err_block["name"],
                    "input": {},
                }
            )
            yield f"event: tool_error\ndata: {json.dumps({'tool': err_block['name'], 'error': 'Malformed tool input'})}\n\n"

        for tool_block in tool_use_blocks:
            tool_name = tool_block["name"]
            tool_input = tool_block["input"]
            tool_id = tool_block["id"]

            logger.debug(
                "Turn %d: executing tool [%s] keys=%s",
                turn,
                tool_name,
                list(tool_input.keys()),
            )

            # Execute the tool against deal state
            if deal_state:
                try:
                    applied = execute_tool(tool_name, tool_input, deal_state, db)
                    result.tool_calls.extend(applied)
                    for tool_call in applied:
                        yield f"event: tool_result\ndata: {json.dumps({'tool': tool_call['name'], 'data': tool_call['args']})}\n\n"
                except Exception as exc:
                    logger.exception(
                        "Turn %d: tool [%s] execution failed", turn, tool_name
                    )
                    # Send detailed error back to Claude so it can adapt
                    error_msg = f"Tool '{tool_name}' failed: {exc}"
                    tool_result_content.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_id,
                            "is_error": True,
                            "content": error_msg,
                        }
                    )
                    yield f"event: tool_error\ndata: {json.dumps({'tool': tool_name, 'error': str(exc)})}\n\n"
                    continue
            else:
                error_msg = f"Tool '{tool_name}' cannot execute: no deal state exists for this session"
                logger.warning(
                    "Turn %d: tool [%s] called but no deal_state", turn, tool_name
                )
                tool_result_content.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_id,
                        "is_error": True,
                        "content": error_msg,
                    }
                )
                yield f"event: tool_error\ndata: {json.dumps({'tool': tool_name, 'error': 'No deal state available'})}\n\n"
                continue

            # Build success tool_result for Claude
            tool_result_content.append(
                {
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": json.dumps({"status": "ok"}),
                }
            )

        # Append assistant response + all tool results in a single user message
        messages.append({"role": "assistant", "content": assistant_content_blocks})
        if tool_result_content:
            messages.append({"role": "user", "content": tool_result_content})

    # Max turns exceeded — emit whatever we have
    logger.warning("Chat loop hit max turns (%d), emitting partial response", max_turns)
    yield f"event: done\ndata: {json.dumps({'text': result.full_text})}\n\n"


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
