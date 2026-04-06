from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from typing import Any

import anthropic
from sqlalchemy import select

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
from app.services.tool_validation import ToolValidationError
from app.services.turn_context import TurnContext

logger = logging.getLogger(__name__)


def create_anthropic_client() -> anthropic.AsyncAnthropic:
    """Create an Anthropic client with consistent resilience settings."""
    return anthropic.AsyncAnthropic(
        api_key=settings.ANTHROPIC_API_KEY,
        max_retries=settings.CLAUDE_SDK_MAX_RETRIES,
        timeout=settings.CLAUDE_API_TIMEOUT,
    )


def _normalize_step_text_for_dedupe(text: str) -> str:
    """Normalize whitespace so identical step prose can be compared reliably."""
    return " ".join(text.split())


def _current_utc_date_iso() -> str:
    """Return today's UTC date for per-turn temporal grounding."""
    return datetime.now(timezone.utc).date().isoformat()


def build_prompt_deal_state(deal_state_dict: dict | None) -> dict | None:
    """Return the source-of-truth subset of deal state used in model prompts."""
    if not deal_state_dict:
        return deal_state_dict

    prompt_state = dict(deal_state_dict)
    prompt_state.pop("ai_panel_cards", None)
    return prompt_state


# ─── Context message configuration ───

LINKED_CONTEXT_MAX_MESSAGES = 10
LINKED_CONTEXT_MESSAGE_TRUNCATION = 200
POST_TOOL_CONTINUATION_REMINDER = (
    "<system-reminder>"
    "Tool results above reflect committed state updates. "
    "If the user's request is already answerable, reply directly to the user in your next message. "
    "Do not make another tool-only pass just to add quick actions. "
    "If the buyer only shared subjective impressions (looks clean, feels fine) and nothing structural changed, "
    "reply in text only — no update_quick_actions. "
    "Do not invent new user facts, vehicles, or numbers — only persist what appears in prior USER-role messages. "
    "Never write dialogue as if you are the buyer (e.g. 'I'm looking at a 2025…') unless quoting their exact words. "
    "If nothing real changed, end with a brief text reply and no further tools. "
    "If any remaining tool updates are still genuinely needed, include them alongside the final user-facing answer."
    "</system-reminder>"
)
TEXT_ONLY_RECOVERY_TOOL_NAMES = frozenset(
    {"update_quick_actions", "update_session_information_gaps"}
)

# Successful step whose tools are all session/dashboard updates (no vehicle/deal extraction)
# → next step is text-only, even when the model emitted tools before any visible prose.
_SESSION_SCOPED_DASHBOARD_TOOLS = frozenset(
    {
        "update_quick_actions",
        "update_session_information_gaps",
        "update_buyer_context",
        "update_checklist",
        "update_negotiation_context",
        "update_session_red_flags",
    }
)

# Vehicle/deal/numbers tools — step 0 often stops streaming after tool_use while the prose is still incomplete.
_STATE_EXTRACTION_TOOLS = frozenset(
    {
        "set_vehicle",
        "create_deal",
        "update_deal_numbers",
        "update_deal_phase",
        "switch_active_deal",
        "remove_vehicle",
    }
)

# After tools run, discourage endless tool_use + self-dialogue loops (Sonnet can roleplay the user).
_CONTINUATION_TEXT_ONLY_SYSTEM: list[dict] = [
    {
        "type": "text",
        "text": (
            "CONTINUATION (after tool results): Tools already updated state. "
            "Reply to the buyer as 'you'. Do not speak in the buyer's voice or fabricate details they never gave. "
            "If your prior message already answered them, add at most one short sentence — do not repeat long advice, "
            "headings, or bullet lists. This turn should normally be plain text only."
        ),
    }
]

# Step 0 had prose + vehicle/deal/number tools; visible text is often only an opener before tool_use stops the stream.
_CONTINUATION_AFTER_STATE_EXTRACTION_SYSTEM: list[dict] = [
    {
        "type": "text",
        "text": (
            "CONTINUATION (after tool results): State is updated. This turn is plain text only — no tools. "
            "If your prior message was only a short opener, ended mid-thought (e.g. trailing 'Here's the situation:' or "
            "similar), or did not yet deliver bullets/scripts/next steps, **continue and finish** now: stay concise but "
            "give the buyer the full takeaway they need. Do not re-paste your entire prior message. "
            "If you already gave a complete answer before tools, add at most one short sentence. Reply as 'you' using "
            "only facts the buyer stated."
        ),
    }
]

# Prior step was tool_use blocks only — the buyer has not seen assistant text yet.
_CONTINUATION_AFTER_TOOL_ONLY_SYSTEM: list[dict] = [
    {
        "type": "text",
        "text": (
            "CONTINUATION: Your previous assistant turn contained only tool calls — the buyer has not seen any reply "
            "from you yet for this message. Write the full user-visible answer now: lead with the conclusion, use 'you', "
            "keep it concise, include blockquote scripts where helpful. Do not call tools. Do not invent facts the "
            "buyer did not state."
        ),
    }
]

# Step 1 still has tool_choice auto (e.g. to run assessment after extraction) — nudge prose when step 0 was tool-only.
_STEP_AFTER_TOOL_ONLY_NUDGE: list[dict] = [
    {
        "type": "text",
        "text": (
            "STEP NOTE: Your previous assistant turn for this buyer message had tool calls but no visible text — "
            "the buyer has not read a reply from you yet on this message. Lead this turn with a clear, substantive "
            "answer; you may still call tools in the same turn if state or assessment updates are still needed. "
            "Do not send another tools-only turn. Skip update_quick_actions unless the current buttons are clearly wrong."
        ),
    }
]


def _chat_tool_choice_for_step(
    step: int,
    *,
    prev_step_had_tool_errors: bool,
    prev_step_had_visible_assistant_text: bool,
    prev_step_tools_were_dashboard_only: bool,
) -> dict[str, str]:
    """Bound tool rounds per buyer message to prevent model self-dialogue loops."""
    if step == 0:
        return {"type": "auto"}
    if step >= 2:
        return {"type": "none"}
    if not prev_step_had_tool_errors and (
        prev_step_had_visible_assistant_text or prev_step_tools_were_dashboard_only
    ):
        return {"type": "none"}
    return {"type": "auto"}


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
- Never write your visible reply as if you are the buyer (first-person buying voice like "I'm looking at…", "I have a trade-in…") unless you are quoting their exact USER message. Address the buyer as "you". Inventing "user" facts in assistant text and then saving them with tools corrupts the session.

Your job:
- Help buyers understand deal numbers, spot overcharges, and negotiate effectively
- Provide specific scripts in blockquotes they can use word-for-word
- Tell them when to walk away
- Analyze deal sheets, CARFAX reports, and financing terms

TOOL USAGE:
- CHAT-FIRST: The product shows your written reply to the buyer before it refreshes the insights side panel from tool updates. Always include clear user-visible prose in the same assistant turn as tools — lead with at least a sentence or two they can read immediately, then call tools; avoid a tools-only first turn.
- You have tools to track deal data as the conversation progresses. Call them ALONGSIDE your text response when information changes.
- Extract facts only from USER messages. Never persist data from your own suggestions or assistant responses.
- Never fabricate a fake user statement in your assistant message and then extract it — if the buyer has not provided a vehicle, price, or trade-in, ask them or leave deal state unchanged.
- Only call tools when data has actually changed or is newly mentioned. Omit unchanged fields.
- You may call multiple tools in a single response. Do NOT narrate tool usage to the user — just respond naturally.
- Always include at least a short user-visible answer (one or more sentences) in the same turn as your tools whenever you call tools — never send a tools-only assistant message with no text for the buyer to read.
- Prefer one batched tool pass per buyer message whenever possible.
- If one user message updates multiple parts of state, emit all relevant tools in the SAME response: extraction, assessment updates, negotiation context, checklist updates, and quick actions.
- Do not spread obvious updates across multiple tool-only follow-up turns if you already have enough information to update everything now.
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
- Call update_quick_actions with 2-3 relevant suggestions when your reply also updates deal state or when next-step buttons should clearly change. If the buyer only adds subjective color (condition, worry, mood) and existing actions still fit the conversation, answer in **text only** and skip tools.
- Do not call update_quick_actions as the **only** tool just to rotate buttons when structured deal state is unchanged — reserve single-tool quick-action updates for replacing clearly wrong or stale buttons.
- After tool results are returned for that same buyer message (a continuation turn), do NOT call update_quick_actions again unless the suggested actions are genuinely wrong or stale — prefer a short text-only wrap-up instead.
- Quick actions should reflect the natural next step in the conversation, not repeat what was just discussed.
- When structured deal state already satisfies a session_information_gaps item (e.g. listing_price is set, vehicle year/make/model/trim are in state), call update_session_information_gaps in the same pass to remove or replace those stale entries so the dashboard matches reality.

CRITICAL RULES FOR FINANCIAL NUMBERS:
- listing_price = the advertised/sticker price BEFORE taxes, fees, or financing
- current_offer = the dealer's current ask or negotiated price BEFORE taxes and fees
- NEVER confuse the financed total (price + taxes + fees) with listing_price or current_offer
- If buyer says "$35,900 with taxes included" and listing was $34,000, then listing_price=34000, NOT 35900
- When the buyer states an asking or listing price in plain language (e.g. "for 34k", "$34,000", "they're asking 40"), call update_deal_numbers in the **same** tool batch as the vehicle when both appear in one user message: use listing_price for sticker/advertised/asking figures; use current_offer only if they clearly mean the dealer's current negotiated offer to them.

VEHICLE EXTRACTION RULES:
- Only create vehicles from user-provided information, not assistant suggestions
- Do NOT create vehicles from casual mentions ("my neighbor got a Tesla")
- If the user only supplied a VIN, you may extract the VIN itself, but do NOT infer or persist year/make/model/trim/engine/cab_style/bed_length from that VIN

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
                    "enum": ["primary", "trade_in"],
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


class ChatLoopResult:
    """Mutable container for collecting step loop results.

    Populated by stream_chat_loop() so the caller can access
    full_text and tool_calls after iteration completes.
    """

    def __init__(self) -> None:
        self.full_text: str = ""
        self.tool_calls: list[dict] = []
        self.completed: bool = False
        self.failed: bool = False
        self.usage_summary: dict[str, int] = empty_usage_summary()


# Maximum steps (LLM call → tool execution cycles) per turn
CHAT_LOOP_MAX_STEPS = 5


def empty_usage_summary() -> dict[str, int]:
    return {
        "requests": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "total_tokens": 0,
    }


def summarize_usage(usage: Any) -> dict[str, int]:
    input_tokens = getattr(usage, "input_tokens", 0) or 0
    output_tokens = getattr(usage, "output_tokens", 0) or 0
    cache_creation_input_tokens = getattr(usage, "cache_creation_input_tokens", 0) or 0
    cache_read_input_tokens = getattr(usage, "cache_read_input_tokens", 0) or 0
    return {
        "requests": 1,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_creation_input_tokens": cache_creation_input_tokens,
        "cache_read_input_tokens": cache_read_input_tokens,
        "total_tokens": input_tokens + output_tokens,
    }


def merge_usage_summary(total: dict[str, int], delta: dict[str, int]) -> None:
    for key in (
        "requests",
        "input_tokens",
        "output_tokens",
        "cache_creation_input_tokens",
        "cache_read_input_tokens",
    ):
        total[key] += delta.get(key, 0)
    total["total_tokens"] = total["input_tokens"] + total["output_tokens"]


def _get_escalated_max_tokens(current_max_tokens: int) -> int:
    """Return the next bounded max_tokens budget for truncation retries."""
    factor = max(settings.CLAUDE_MAX_TOKENS_ESCALATION_FACTOR, 1)
    proposed = max(current_max_tokens + 1, current_max_tokens * factor)
    cap = max(settings.CLAUDE_MAX_TOKENS_CAP, current_max_tokens)
    return min(proposed, cap)


async def _stream_step_with_retry(  # noqa: C901
    client: anthropic.AsyncAnthropic,
    *,
    model: str,
    max_tokens: int,
    system: list[dict],
    messages: list[dict],
    tools: list[dict] | None = None,
    tool_choice: dict | None = None,
    idle_timeout: int = settings.CLAUDE_STREAM_IDLE_TIMEOUT,
    max_retries: int = settings.CLAUDE_STREAM_MAX_RETRIES,
) -> AsyncGenerator[tuple[str, Any], None]:
    """Stream a single step with idle-timeout watchdog and retry.

    Yields (event_type, event_data) tuples from the Anthropic stream.
    On stream stall or connection error: retries up to max_retries times.
    On exhausted retries: falls back to a non-streaming API call.

    Event types yielded:
    - ("stream_event", event) — raw Anthropic stream event
    - ("final_message", message) — the final Message object (usage, stop_reason)
    - ("retry", {"attempt": N, "reason": str}) — retry notification for SSE
    """
    last_error: Exception | None = None

    for attempt in range(1 + max_retries):
        try:
            stream_kwargs: dict[str, Any] = {
                "model": model,
                "max_tokens": max_tokens,
                "system": system,
                "messages": messages,
            }
            if tools is not None:
                stream_kwargs["tools"] = tools
            if tool_choice is not None:
                stream_kwargs["tool_choice"] = tool_choice

            async with client.messages.stream(
                **stream_kwargs,
            ) as stream:
                stream_iter = stream.__aiter__()
                while True:
                    try:
                        event = await asyncio.wait_for(
                            stream_iter.__anext__(), timeout=idle_timeout
                        )
                        yield ("stream_event", event)
                    except StopAsyncIteration:
                        break
                    except asyncio.TimeoutError:
                        logger.warning(
                            "Stream stalled (no events for %ds), attempt %d/%d",
                            idle_timeout,
                            attempt + 1,
                            1 + max_retries,
                        )
                        raise  # break out of stream context to retry

                # Stream completed successfully — get final message
                final_message = await stream.get_final_message()
                yield ("final_message", final_message)
                return

        except asyncio.TimeoutError:
            last_error = asyncio.TimeoutError(f"Stream idle for {idle_timeout}s")
            reason = "stream_stall"
        except anthropic.APIConnectionError as exc:
            last_error = exc
            reason = "connection_error"
            logger.warning(
                "Stream connection error, attempt %d/%d: %s",
                attempt + 1,
                1 + max_retries,
                exc,
            )
        except anthropic.APIStatusError as exc:
            # HTTP-level 429/529 are retried by the SDK before the stream opens.
            # But transient errors (overloaded, rate_limit) can also arrive INSIDE
            # an already-open SSE stream — the SDK can't retry those because the
            # HTTP response was already 200. Retry them at the stream level.
            body = getattr(exc, "body", None)
            error_type = (
                body.get("error", {}).get("type", "") if isinstance(body, dict) else ""
            )
            if error_type in ("overloaded_error", "rate_limit_error"):
                last_error = exc
                reason = "api_overloaded"
                logger.warning(
                    "Transient API error during stream (%s), attempt %d/%d",
                    error_type,
                    attempt + 1,
                    1 + max_retries,
                )
            else:
                raise

        # Emit retry event (unless this was the last attempt)
        if attempt < max_retries:
            yield ("retry", {"attempt": attempt + 1, "reason": reason})
            backoff = (attempt + 1) * 1.0  # 1s, 2s
            await asyncio.sleep(backoff)

    # All stream retries exhausted — fall back to non-streaming
    logger.warning("Stream retries exhausted, falling back to non-streaming API call")
    try:
        create_kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": messages,
        }
        if tools is not None:
            create_kwargs["tools"] = tools
        if tool_choice is not None:
            create_kwargs["tool_choice"] = tool_choice

        response = await client.messages.create(  # type: ignore[call-overload]
            **create_kwargs,
        )
        # Convert non-streaming response to the same event shape
        for block in response.content:
            if block.type == "text":
                yield ("stream_event", _SyntheticTextEvent(block.text))
            elif block.type == "tool_use":
                yield ("stream_event", _SyntheticToolStartEvent(block.id, block.name))
                yield ("stream_event", _SyntheticToolJsonEvent(json.dumps(block.input)))
                yield ("stream_event", _SyntheticBlockStopEvent())
        yield ("final_message", response)

    except Exception:
        # Non-streaming fallback also failed — re-raise
        logger.exception("Non-streaming fallback failed")
        raise last_error or Exception("All retry attempts failed")  # noqa: B904


# Synthetic event wrappers for non-streaming fallback — minimal duck-typed objects
# that match the attributes accessed in stream_chat_loop's event processing.


class _SyntheticTextEvent:
    type = "content_block_delta"

    def __init__(self, text: str) -> None:
        self.delta = type("Delta", (), {"type": "text_delta", "text": text})()


class _SyntheticToolStartEvent:
    type = "content_block_start"

    def __init__(self, tool_id: str, name: str) -> None:
        self.content_block = type(
            "CB", (), {"type": "tool_use", "id": tool_id, "name": name}
        )()


class _SyntheticToolJsonEvent:
    type = "content_block_delta"

    def __init__(self, json_str: str) -> None:
        self.delta = type(
            "Delta", (), {"type": "input_json_delta", "partial_json": json_str}
        )()


class _SyntheticBlockStopEvent:
    type = "content_block_stop"


async def _execute_tool_batch(
    batch: list[dict],
    turn_context: TurnContext,
    session_factory,
) -> AsyncGenerator[tuple[dict, list[dict] | Exception], None]:
    """Execute a priority batch concurrently with isolated DB sessions.

    Tools within a batch are classified as independent by build_execution_plan().
    Each tool runs in its own session and transaction:
    - On success, changes are committed immediately.
    - On failure, only the failing tool rolls back; other tools' changes persist.

    This is intentional — independent tools update disjoint state (e.g.,
    update_deal_numbers and update_quick_actions). Partial commits on failure
    match the pre-concurrency behavior where individual tool errors were already
    reported back to Claude without rolling back other tools.

    The caller (chat.py) refreshes the main session after all batches complete
    to pick up committed changes via db.refresh(deal_state).

    Results are yielded in original batch order regardless of completion order.
    """
    from app.models.deal_state import DealState
    from app.services.deal_state import execute_tool

    async def _run_one(
        index: int, block: dict
    ) -> tuple[int, dict, list[dict] | Exception]:
        async with session_factory() as tool_db:
            try:
                if turn_context.deal_state is None:
                    raise RuntimeError("Deal state no longer exists")
                result = await tool_db.execute(
                    select(DealState).where(DealState.id == turn_context.deal_state.id)
                )
                tool_deal_state = result.scalar_one_or_none()
                if tool_deal_state is None:
                    raise RuntimeError("Deal state no longer exists")
                tool_context = turn_context.for_db_session(
                    tool_db,
                    deal_state=tool_deal_state,
                )
                applied = await execute_tool(
                    block["name"],
                    block["input"],
                    tool_context,
                )
                await tool_db.commit()
                return index, block, applied
            except ToolValidationError as exc:
                await tool_db.rollback()
                logger.warning(
                    "Step %d: tool [%s] validation failed: %s",
                    turn_context.step,
                    block["name"],
                    exc,
                )
                return index, block, exc
            except Exception as exc:
                await tool_db.rollback()
                logger.exception(
                    "Step %d: tool [%s] execution failed",
                    turn_context.step,
                    block["name"],
                )
                return index, block, exc

    tasks = [
        asyncio.create_task(_run_one(index, block)) for index, block in enumerate(batch)
    ]
    ready: dict[int, tuple[dict, list[dict] | Exception]] = {}
    next_index = 0

    for task in asyncio.as_completed(tasks):
        index, block, outcome = await task
        ready[index] = (block, outcome)
        while next_index in ready:
            yield ready.pop(next_index)
            next_index += 1


async def _generate_text_only_recovery_response(
    client: anthropic.AsyncAnthropic,
    *,
    system: list[dict],
    messages: list[dict],
) -> dict[str, Any] | None:
    current_max_tokens = settings.CLAUDE_MAX_TOKENS
    truncation_retry_count = 0
    usage_summary = empty_usage_summary()

    while True:
        recovery_text = ""
        stop_reason = None

        try:
            async for event_type, event_data in _stream_step_with_retry(
                client,
                model=settings.CLAUDE_MODEL,
                max_tokens=current_max_tokens,
                system=system,
                messages=messages,
            ):
                if event_type == "retry":
                    recovery_text = ""
                    continue

                if event_type == "final_message":
                    stop_reason = event_data.stop_reason
                    merge_usage_summary(
                        usage_summary,
                        summarize_usage(event_data.usage),
                    )
                    logger.info(
                        "Cache [chat_loop recovery]: creation=%d read=%d uncached=%d stop=%s max_tokens=%d",
                        getattr(event_data.usage, "cache_creation_input_tokens", 0)
                        or 0,
                        getattr(event_data.usage, "cache_read_input_tokens", 0) or 0,
                        event_data.usage.input_tokens,
                        stop_reason,
                        current_max_tokens,
                    )
                    continue

                event = event_data
                if (
                    event.type == "content_block_delta"
                    and getattr(event.delta, "type", None) == "text_delta"
                ):
                    recovery_text += event.delta.text

        except Exception:
            logger.exception("Chat loop recovery response failed")
            return None

        if stop_reason == "max_tokens":
            next_max_tokens = _get_escalated_max_tokens(current_max_tokens)
            if (
                truncation_retry_count < settings.CLAUDE_MAX_TOKENS_RETRIES
                and next_max_tokens > current_max_tokens
            ):
                truncation_retry_count += 1
                logger.warning(
                    "Chat loop recovery hit max_tokens at %d, retrying with %d (%d/%d)",
                    current_max_tokens,
                    next_max_tokens,
                    truncation_retry_count,
                    settings.CLAUDE_MAX_TOKENS_RETRIES,
                )
                current_max_tokens = next_max_tokens
                continue

            logger.warning(
                "Chat loop recovery exhausted max_tokens retries at budget=%d",
                current_max_tokens,
            )

        stripped_text = recovery_text.strip()
        if stripped_text:
            return {
                "text": stripped_text,
                "usage_summary": usage_summary,
            }
        return None


def _replace_context_message(
    messages: list[dict],
    context_message: dict | None,
) -> None:
    """Replace the current-turn synthetic context block in-place if present."""
    context_text = context_message.get("content") if context_message else None
    if not isinstance(context_text, str):
        return

    for message in messages:
        if message.get("role") != "user":
            continue
        content = message.get("content")
        if not isinstance(content, list) or not content:
            continue
        first_block = content[0]
        if (
            isinstance(first_block, dict)
            and first_block.get("type") == "text"
            and isinstance(first_block.get("text"), str)
            and first_block["text"].startswith("<system-reminder>")
        ):
            content[0] = {**first_block, "text": context_text}
            return


async def stream_chat_loop(  # noqa: C901 — step loop has inherent complexity
    system_prompt: list[dict],
    messages: list[dict],
    tools: list[dict],
    turn_context: TurnContext,
    result: ChatLoopResult,
    max_steps: int = CHAT_LOOP_MAX_STEPS,
    session_factory=None,
    emit_done_event: bool = True,
    linked_messages: list[dict] | None = None,
) -> AsyncGenerator[str, None]:
    """Step loop: call Claude with tools, execute tool calls, repeat until text response.

    Streams SSE events as they arrive:
    - event: text — conversation text chunks (streamed live)
    - event: tool_result — tool execution results (emitted after each tool)
    - event: done — final text when loop completes

    Populates `result` with accumulated full_text and all tool_calls.
    """
    from app.services.deal_state import build_execution_plan, deal_state_to_dict

    if session_factory is None:
        from app.db.session import AsyncSessionLocal

        session_factory = AsyncSessionLocal

    client = create_anthropic_client()

    # Add cache_control to the last tool so the entire tool list is cached
    cached_tools = [*tools[:-1], {**tools[-1], "cache_control": {"type": "ephemeral"}}]
    last_appended_step_text_normalized = ""
    prev_step_tool_errors = True
    prev_step_had_visible_assistant_text = False
    prev_step_tools_were_dashboard_only = False
    prev_step_had_state_extraction_tools = False

    for step in range(max_steps):
        turn_context = turn_context.for_step(step)
        # Notify frontend that a new step is starting (after tool execution)
        # so it can show a thinking indicator during multi-step loops.
        if step > 0:
            yield f"event: step\ndata: {json.dumps({'step': step})}\n\n"

        tool_choice_param = _chat_tool_choice_for_step(
            step,
            prev_step_had_tool_errors=prev_step_tool_errors,
            prev_step_had_visible_assistant_text=prev_step_had_visible_assistant_text,
            prev_step_tools_were_dashboard_only=prev_step_tools_were_dashboard_only,
        )
        if tool_choice_param["type"] == "none":
            if not prev_step_had_visible_assistant_text:
                step_system = [*system_prompt, *_CONTINUATION_AFTER_TOOL_ONLY_SYSTEM]
            elif prev_step_had_state_extraction_tools:
                step_system = [
                    *system_prompt,
                    *_CONTINUATION_AFTER_STATE_EXTRACTION_SYSTEM,
                ]
            else:
                step_system = [*system_prompt, *_CONTINUATION_TEXT_ONLY_SYSTEM]
        else:
            step_system = system_prompt
            if (
                step == 1
                and not prev_step_had_visible_assistant_text
                and not prev_step_tool_errors
            ):
                step_system = [*step_system, *_STEP_AFTER_TOOL_ONLY_NUDGE]

        current_max_tokens = settings.CLAUDE_MAX_TOKENS
        truncation_retry_count = 0

        while True:
            step_text = ""
            tool_use_blocks: list[dict] = []  # {id, name, input}
            assistant_content_blocks: list[dict] = []  # raw content blocks for messages

            # Track streaming state for tool_use accumulation
            current_tool_id: str | None = None
            current_tool_name: str | None = None
            current_tool_input_json = ""
            json_error_blocks: list[dict] = []  # tool_use blocks with malformed JSON

            try:
                stop_reason = None
                async for event_type, event_data in _stream_step_with_retry(
                    client,
                    model=settings.CLAUDE_MODEL,
                    max_tokens=current_max_tokens,
                    system=step_system,
                    messages=messages,
                    tools=cached_tools,
                    tool_choice=tool_choice_param,
                ):
                    if event_type == "retry":
                        retry_payload = dict(event_data)
                        retry_payload.setdefault("reset_text", True)
                        yield f"event: retry\ndata: {json.dumps(retry_payload)}\n\n"
                        # Reset step accumulators — partial data from retried streams is unreliable
                        step_text = ""
                        tool_use_blocks = []
                        assistant_content_blocks = []
                        current_tool_id = None
                        current_tool_name = None
                        current_tool_input_json = ""
                        json_error_blocks = []
                        continue

                    if event_type == "final_message":
                        usage = event_data.usage
                        stop_reason = event_data.stop_reason
                        merge_usage_summary(
                            result.usage_summary, summarize_usage(usage)
                        )
                        logger.info(
                            "Cache [chat_loop step=%d]: creation=%d read=%d uncached=%d stop=%s max_tokens=%d",
                            step,
                            getattr(usage, "cache_creation_input_tokens", 0) or 0,
                            getattr(usage, "cache_read_input_tokens", 0) or 0,
                            usage.input_tokens,
                            stop_reason,
                            current_max_tokens,
                        )
                        continue

                    # event_type == "stream_event"
                    event = event_data
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
                                step_text += chunk
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
                                    "Step %d: tool [%s] returned invalid JSON",
                                    step,
                                    current_tool_name,
                                )
                                json_error_blocks.append(
                                    {"id": current_tool_id, "name": current_tool_name}
                                )
                            current_tool_id = None
                            current_tool_name = None
                            current_tool_input_json = ""

                if stop_reason == "max_tokens" and current_tool_name:
                    logger.warning(
                        "Step %d: tool [%s] was truncated at max_tokens=%d",
                        step,
                        current_tool_name,
                        current_max_tokens,
                    )
                    json_error_blocks.append(
                        {"id": current_tool_id, "name": current_tool_name}
                    )

                # Capture text as a content block if present
                if step_text:
                    assistant_content_blocks.insert(
                        0, {"type": "text", "text": step_text}
                    )

            except Exception:
                logger.exception("Chat loop step %d failed", step)
                result.failed = True
                yield f"event: error\ndata: {json.dumps({'message': 'AI response failed. Please try again.'})}\n\n"
                return

            if stop_reason == "max_tokens":
                next_max_tokens = _get_escalated_max_tokens(current_max_tokens)
                if (
                    truncation_retry_count < settings.CLAUDE_MAX_TOKENS_RETRIES
                    and next_max_tokens > current_max_tokens
                ):
                    truncation_retry_count += 1
                    logger.warning(
                        "Chat loop step %d hit max_tokens at %d, retrying with %d (%d/%d)",
                        step,
                        current_max_tokens,
                        next_max_tokens,
                        truncation_retry_count,
                        settings.CLAUDE_MAX_TOKENS_RETRIES,
                    )
                    yield f"event: retry\ndata: {json.dumps({'attempt': truncation_retry_count, 'reason': 'max_tokens', 'reset_text': True, 'max_tokens': next_max_tokens})}\n\n"
                    current_max_tokens = next_max_tokens
                    continue

                logger.warning(
                    "Chat loop step %d exhausted max_tokens retries at budget=%d",
                    step,
                    current_max_tokens,
                )

            break

        # Accumulate text across steps — add paragraph break between steps
        # so multi-step text (step 0 text + tool execution + step 1 text)
        # doesn't run together without whitespace.
        normalized_step_text = _normalize_step_text_for_dedupe(step_text)
        is_duplicate_step_text = (
            bool(normalized_step_text)
            and normalized_step_text == last_appended_step_text_normalized
        )

        if is_duplicate_step_text:
            logger.info(
                "Step %d emitted duplicate text after tool execution; skipping aggregation",
                step,
            )
        else:
            if (
                step_text
                and result.full_text
                and not result.full_text.endswith(("\n", " "))
            ):
                result.full_text += "\n\n"
            result.full_text += step_text
            if normalized_step_text:
                last_appended_step_text_normalized = normalized_step_text

        # If no tool calls, we're done — emit done event
        if stop_reason == "end_turn" or (not tool_use_blocks and not json_error_blocks):
            result.completed = True
            if emit_done_event:
                yield f"event: done\ndata: {json.dumps({'text': result.full_text})}\n\n"
            logger.info(
                "Chat loop complete: steps=%d, text_length=%d, tool_calls=%d",
                step + 1,
                len(result.full_text),
                len(result.tool_calls),
            )
            return

        # Execute tool calls and emit SSE events
        tool_result_content: list[dict] = []
        had_tool_errors = False

        # Send error tool_results for any tool_use blocks with malformed JSON
        for err_block in json_error_blocks:
            had_tool_errors = True
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

        if turn_context.deal_state:
            execution_plan = build_execution_plan(tool_use_blocks)
            for batch in execution_plan:
                async for tool_block, outcome in _execute_tool_batch(
                    batch,
                    turn_context,
                    session_factory,
                ):
                    tool_name = tool_block["name"]
                    tool_id = tool_block["id"]
                    logger.debug(
                        "Step %d: completed tool [%s] keys=%s",
                        step,
                        tool_name,
                        list(tool_block["input"].keys()),
                    )

                    if isinstance(outcome, Exception):
                        had_tool_errors = True
                        if isinstance(outcome, ToolValidationError):
                            error_msg = (
                                f"Tool '{tool_name}' validation failed: {outcome}"
                            )
                        else:
                            error_msg = f"Tool '{tool_name}' failed: {outcome}"
                        tool_result_content.append(
                            {
                                "type": "tool_result",
                                "tool_use_id": tool_id,
                                "is_error": True,
                                "content": error_msg,
                            }
                        )
                        yield f"event: tool_error\ndata: {json.dumps({'tool': tool_name, 'error': str(outcome)})}\n\n"
                        continue

                    applied = outcome
                    result.tool_calls.extend(applied)
                    for tool_call in applied:
                        yield f"event: tool_result\ndata: {json.dumps({'tool': tool_call['name'], 'data': tool_call['args']})}\n\n"

                    tool_result_content.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_id,
                            "content": json.dumps({"status": "ok"}),
                        }
                    )
        else:
            for tool_block in tool_use_blocks:
                tool_name = tool_block["name"]
                had_tool_errors = True
                error_msg = f"Tool '{tool_name}' cannot execute: no deal state exists for this session"
                logger.warning(
                    "Step %d: tool [%s] called but no deal_state", step, tool_name
                )
                tool_result_content.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_block["id"],
                        "is_error": True,
                        "content": error_msg,
                    }
                )
                yield f"event: tool_error\ndata: {json.dumps({'tool': tool_name, 'error': 'No deal state available'})}\n\n"

        # Append assistant response + all tool results in a single user message
        messages.append({"role": "assistant", "content": assistant_content_blocks})
        if tool_result_content:
            tool_result_content.append(
                {
                    "type": "text",
                    "text": POST_TOOL_CONTINUATION_REMINDER,
                    "cache_control": {"type": "ephemeral"},
                }
            )
            messages.append({"role": "user", "content": tool_result_content})

        if turn_context.deal_state is not None:
            await turn_context.db.refresh(turn_context.deal_state)
            updated_state_dict = await deal_state_to_dict(
                turn_context.deal_state,
                turn_context.db,
            )
            updated_context_message = build_context_message(
                updated_state_dict,
                linked_messages,
            )
            _replace_context_message(messages, updated_context_message)

        should_force_text_recovery = (
            not step_text.strip()
            and bool(tool_use_blocks)
            and not had_tool_errors
            and not json_error_blocks
            and {tool_block["name"] for tool_block in tool_use_blocks}
            <= TEXT_ONLY_RECOVERY_TOOL_NAMES
        )
        if should_force_text_recovery:
            logger.info(
                "Step %d completed with ancillary tools only; forcing final text recovery",
                step,
            )
            recovery_system_prompt = [
                *system_prompt,
                {
                    "type": "text",
                    "text": (
                        "RECOVERY MODE: Ancillary tool updates are already complete. "
                        "Do not call tools. Reply directly to the buyer with one complete final answer."
                    ),
                },
            ]
            recovery = await _generate_text_only_recovery_response(
                client,
                system=recovery_system_prompt,
                messages=messages,
            )
            if recovery is not None:
                merge_usage_summary(result.usage_summary, recovery["usage_summary"])
                result.full_text = recovery["text"]
                result.completed = True
                if emit_done_event:
                    yield f"event: done\ndata: {json.dumps({'text': result.full_text})}\n\n"
                logger.info(
                    "Chat loop fast recovery complete after ancillary tools: text_length=%d, tool_calls=%d",
                    len(result.full_text),
                    len(result.tool_calls),
                )
                return

        prev_step_tool_errors = had_tool_errors
        prev_step_had_visible_assistant_text = bool(step_text.strip())
        prev_step_tools_were_dashboard_only = (
            bool(tool_use_blocks)
            and {b["name"] for b in tool_use_blocks} <= _SESSION_SCOPED_DASHBOARD_TOOLS
        )
        prev_step_had_state_extraction_tools = bool(tool_use_blocks) and bool(
            {b["name"] for b in tool_use_blocks} & _STATE_EXTRACTION_TOOLS
        )

        # Move the cache breakpoint to the last message so the next step's
        # API call caches everything up to this point (two-breakpoint caching).
        _move_message_cache_breakpoint(messages)

    # Max steps exceeded — try one final tools-disabled answer recovery.
    logger.warning(
        "Chat loop hit max steps (%d), attempting final text-only recovery",
        max_steps,
    )
    recovery_system_prompt = [
        *system_prompt,
        {
            "type": "text",
            "text": (
                "RECOVERY MODE: Any necessary tool updates are already complete. "
                "Do not call tools. Reply directly to the buyer with one complete final answer. "
                "Rewrite the answer from scratch as a full response, not a continuation or explanation of tool usage."
            ),
        },
    ]
    recovery = await _generate_text_only_recovery_response(
        client,
        system=recovery_system_prompt,
        messages=messages,
    )

    result.completed = True
    if recovery is not None:
        merge_usage_summary(result.usage_summary, recovery["usage_summary"])
        result.full_text = recovery["text"]
        if emit_done_event:
            yield f"event: retry\ndata: {json.dumps({'attempt': 1, 'reason': 'max_steps_recovery', 'reset_text': True})}\n\n"
            yield f"event: done\ndata: {json.dumps({'text': result.full_text})}\n\n"
        logger.info(
            "Chat loop recovery complete after max steps: text_length=%d, tool_calls=%d",
            len(result.full_text),
            len(result.tool_calls),
        )
        return

    logger.warning("Chat loop max-step recovery failed, emitting partial response")
    if emit_done_event:
        yield f"event: done\ndata: {json.dumps({'text': result.full_text})}\n\n"


def _move_message_cache_breakpoint(messages: list[dict]) -> None:
    """Move the cache breakpoint to the last message in the array.

    Called after each step appends tool results so the next step's API call
    caches the entire conversation prefix (two-breakpoint caching). Only one
    message-level breakpoint is maintained to stay within the Anthropic API's
    4-breakpoint limit (system + tools + 1 message).
    """
    # Strip existing message-level cache_control
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and "cache_control" in block:
                    del block["cache_control"]

    if not messages:
        return

    # Add breakpoint to the last content block of the last message
    last_msg = messages[-1]
    content = last_msg.get("content")
    if isinstance(content, str):
        last_msg["content"] = [
            {"type": "text", "text": content, "cache_control": {"type": "ephemeral"}}
        ]
    elif isinstance(content, list) and content:
        content[-1] = {**content[-1], "cache_control": {"type": "ephemeral"}}


def build_system_prompt() -> list[dict]:
    """Build system prompt as a single static cached block.

    The system prompt is entirely static — no per-session or per-turn content.
    Dynamic context (deal state, negotiation context, buyer situation) is
    injected as a context message via build_context_message() so the system
    prompt stays cacheable across turns.
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
    """Build a synthetic context message with dynamic state for the current turn.

    This is prepended to the messages array (not the system prompt) so the
    system prompt stays stable and cacheable across turns. Uses
    <system-reminder> tags following the reference architecture pattern.
    """
    context_parts: list[str] = [f"Current date (UTC): {_current_utc_date_iso()}."]

    prompt_deal_state = build_prompt_deal_state(deal_state_dict)

    if prompt_deal_state:
        buyer_context = prompt_deal_state.get("buyer_context", BuyerContext.RESEARCHING)
        preamble = CONTEXT_PREAMBLES.get(BuyerContext(buyer_context))
        if preamble:
            context_parts.append(f"Buyer situation: {preamble}")

        # Negotiation context summary for primary model awareness
        negotiation_context = prompt_deal_state.get("negotiation_context")
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
        active_deal_id = prompt_deal_state.get("active_deal_id")
        deals = prompt_deal_state.get("deals", [])
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

        session_red_flags = prompt_deal_state.get("session_red_flags", [])
        session_info_gaps = prompt_deal_state.get("session_information_gaps", [])

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
            f"{json.dumps(prompt_deal_state, indent=2, default=str)}\n```"
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
    message come after the breakpoint (uncached, change every turn/request).
    """
    messages: list[dict] = []

    # History FIRST — stable prefix, cacheable across turns/requests
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

    # New user message (uncached — changes every turn/request)
    context_text = context_message.get("content") if context_message else None

    if image_url:
        content_blocks: list[dict] = []
        if isinstance(context_text, str):
            content_blocks.append({"type": "text", "text": context_text})
        content_blocks.extend(
            [
                {
                    "type": "image",
                    "source": {"type": "url", "url": image_url},
                },
                {"type": "text", "text": user_content},
            ]
        )
        messages.append(
            {
                "role": "user",
                "content": content_blocks,
            }
        )
    elif isinstance(context_text, str):
        messages.append(
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": context_text},
                    {"type": "text", "text": user_content},
                ],
            }
        )
    else:
        messages.append({"role": "user", "content": user_content})

    return messages
