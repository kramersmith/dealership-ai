"""Bounded LLM call to emit structured deal recap beats (tool-forced JSON)."""

from __future__ import annotations

import logging
import time
from typing import Any

from app.core.config import settings
from app.models.enums import MessageRole
from app.schemas.recap import EmitDealRecapInput, RecapBeatLLM, RedactionProfile
from app.services.claude import (
    create_anthropic_client,
    current_utc_date_iso,
    summarize_usage,
)
from app.services.usage_tracking import (
    UsageRecorder,
    build_request_usage,
    log_request_usage,
)

logger = logging.getLogger(__name__)

_EMIT_DEAL_RECAP_TOOL: dict[str, Any] = {
    "name": "emit_deal_recap",
    "description": (
        "Emit an ordered deal recap timeline: the buyer's private, skimmable story of the session—accurate enough "
        "to rely on. Each beat splits **world** (off-app: lot, dealer, drive) vs **app** (what Dealership AI actually "
        "did in chat/tools). Ground every claim in deal JSON and/or bracketed chat message ids; do not invent facts; "
        "no internal CRM slug text in buyer-facing copy."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "beats": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "kind": {
                            "type": "string",
                            "description": "Short internal slug (e.g. quote, walkout, callback) — never echo this slug in world or app copy.",
                        },
                        "world": {
                            "type": "string",
                            "description": (
                                "Off-app beat: what changed in the real world (information, leverage, risk, or next "
                                "step at the lot or in conversation). Plain English; use \"\" only if this beat is "
                                "entirely in-app."
                            ),
                        },
                        "app": {
                            "type": "string",
                            "description": (
                                "In-app value only: what Dealership AI demonstrably did (numbers, comparisons, "
                                "assistant/tool-backed lines). Not generic cheerleading. Use \"\" if no app beat."
                            ),
                        },
                        "user_message_id": {"type": "string"},
                        "assistant_message_id": {"type": "string"},
                        "occurred_at_iso": {
                            "type": "string",
                            "description": "Optional ISO-8601 timestamp for ordering",
                        },
                    },
                    "required": ["kind", "world", "app"],
                },
            }
        },
        "required": ["beats"],
    },
}


def _llm_redaction_instructions(profile: RedactionProfile | None) -> str:
    """Extra user-prompt constraints so regenerated beats match share-style toggles."""
    if profile is None:
        return ""
    parts: list[str] = []
    if profile.hide_user_message_quotes:
        parts.append(
            "- **Chat privacy:** Do not quote or closely paraphrase private buyer chat lines in **world** or **app**. "
            "Summarize what happened in your own words; avoid replaying DM-style wording."
        )
    if profile.hide_dealer_name:
        parts.append(
            "- **Dealer identity:** Do not name the dealership or salesperson; use generic phrasing "
            '(e.g. "the dealership", "the salesperson").'
        )
    if profile.hide_dollar_amounts:
        parts.append(
            "- **Dollar amounts:** Do not state specific dollar amounts, monthly payment figures, or APR percentages "
            "in **world**/**app** beat text. Describe moves qualitatively (e.g. \"they moved on price\", "
            '"the payment fit the budget") without numbers.'
        )
    if not parts:
        return ""
    return (
        "\n\n**Buyer share-style preferences (apply to every beat; full recap is still grounded in inputs):**\n"
        + "\n".join(parts)
        + "\n"
    )


async def run_recap_generation_llm(
    *,
    deal_state_json: str,
    messages_block: str,
    usage_recorder: UsageRecorder | None = None,
    session_id: str | None = None,
    buyer_timeline_hints: str = "",
    redaction: RedactionProfile | None = None,
) -> tuple[EmitDealRecapInput, dict[str, Any] | None]:
    """Returns validated beats and raw usage dict (for persistence)."""
    client = create_anthropic_client()
    convo = f"Conversation (message ids in brackets):\n{messages_block}\n"
    if buyer_timeline_hints.strip():
        convo = (
            convo
            + buyer_timeline_hints.strip()
            + "\n\n**Buyer-written notes above take priority** when they conflict with your first draft—keep them "
            "unless they clearly contradict something stated in the chat or deal JSON you can cite. Prefer "
            "reconciling into a single accurate beat over discarding the buyer's wording.\n"
        )
    user_prompt = (
        f"Current date (UTC): {current_utc_date_iso()}.\n\n"
        "**Job:** Write the buyer's **private timeline** of this deal—accurate enough to rely on, **skimmable in "
        "about a minute** (they may re-read alone or share with family). This is not marketing copy.\n\n"
        "Each beat has **no title**—only two strings (at least one non-empty per beat):\n"
        "- **world**: What happened **off the app**—lot, drive, dealer/buyer conversation, what someone said or saw, "
        "prices the buyer typed. Each beat should make clear **what changed** in the real world: new information, "
        "shifted leverage, new risk, or a concrete next step—not a flat 'and then' unless the chat is truly thin. "
        "1–4 tight sentences. Use \"\" if this beat is **only** in-app.\n"
        "- **app**: **Only** value Dealership AI **demonstrably** added in this session—computed numbers, pulled "
        "records, assistant or tool-backed warnings or comparisons. Refer to the product as \"the app\" or "
        "\"Dealership AI\". No generic pep talk. 1–4 sentences. Use \"\" if there was no in-app beat for this moment.\n"
        "\n"
        "**Attribution:** Never say the app \"found\", \"noticed\", \"surfaced\", or \"flagged\" a physical defect, "
        "dealer quote, or buyer observation unless that exact claim appears in an **assistant message or tool "
        "output** in the chat. Buyer walkaround notes and dealer statements stay in **world**.\n"
        "**Coverage:** When the chat or deal JSON supports it, the full list should read as a **short story** with "
        "arcs such as: why they're there → what they learned about the vehicle or numbers → what shifted → where "
        "things stand now (or what's still open). Do not skip major turns implied by inputs just to shorten the "
        "list. Aim for roughly **6–12 beats** on a typical session unless the session is genuinely short.\n"
        "**Tone & audience:** Second person where it reads naturally; plain English (~middle-school reading level); "
        "no dealer or finance jargon unless the buyer used it; no shame, pressure, or fake enthusiasm.\n"
        "**Trust & limits:** No promises of outcomes, no legal or tax or financing advice, no medical claims. If "
        "something is unknown from inputs, **omit it or say it's unclear**—do not guess.\n"
        "**Numbers:** Do not invent dollar amounts or outcomes. Any beat that states a **dollar amount** should lean "
        "on specific deal JSON fields and/or chat lines you can tie to message ids; set user_message_id or "
        "assistant_message_id when the beat leans on specific messages.\n"
        "Avoid stiff CRM-style labels in **world** unless the buyer literally said those words.\n"
        "Ground every beat in the deal JSON and/or the bracketed chat ids.\n"
        "Output ONLY via the emit_deal_recap tool; beats chronological; use occurred_at_iso when clear.\n\n"
        + _llm_redaction_instructions(redaction)
        + f"Deal state JSON:\n```json\n{deal_state_json}\n```\n\n"
        + convo
    )

    started = time.monotonic()
    response = await client.messages.create(  # type: ignore[call-overload]
        model=settings.CLAUDE_MODEL,
        max_tokens=4096,
        tools=[{**_EMIT_DEAL_RECAP_TOOL, "cache_control": {"type": "ephemeral"}}],
        tool_choice={"type": "tool", "name": "emit_deal_recap"},
        messages=[{"role": "user", "content": user_prompt}],
    )

    usage = response.usage
    request_usage = build_request_usage(
        model=settings.CLAUDE_MODEL,
        usage_summary=summarize_usage(usage),
        latency_ms=int((time.monotonic() - started) * 1000),
    )
    log_request_usage(
        logger,
        request_usage,
        context="deal_recap_generate",
        session_id=session_id,
    )
    if usage_recorder:
        usage_recorder(request_usage)

    usage_dict: dict[str, Any] = {
        "input_tokens": getattr(usage, "input_tokens", 0),
        "output_tokens": getattr(usage, "output_tokens", 0),
        "cache_creation_input_tokens": getattr(usage, "cache_creation_input_tokens", 0)
        or 0,
        "cache_read_input_tokens": getattr(usage, "cache_read_input_tokens", 0) or 0,
    }

    for block in response.content:
        if block.type == "tool_use" and block.name == "emit_deal_recap":
            raw = block.input
            if not isinstance(raw, dict):
                return EmitDealRecapInput(beats=[]), usage_dict
            try:
                parsed = EmitDealRecapInput.model_validate(raw)
                return parsed, usage_dict
            except Exception:
                logger.exception(
                    "emit_deal_recap tool input failed Pydantic validation"
                )
                return EmitDealRecapInput(beats=[]), usage_dict

    logger.warning("emit_deal_recap tool was not returned")
    return EmitDealRecapInput(beats=[]), usage_dict


def validate_beats_message_ids(
    *,
    beats: list[RecapBeatLLM],
    message_ids_in_session: set[str],
    message_role_by_id: dict[str, str],
) -> list[RecapBeatLLM]:
    """Strip invalid message anchors; enforce role match."""
    cleaned: list[RecapBeatLLM] = []
    for beat in beats:
        uid = beat.user_message_id
        aid = beat.assistant_message_id
        if uid and uid not in message_ids_in_session:
            uid = None
        elif uid and message_role_by_id.get(uid) != MessageRole.USER.value:
            uid = None
        if aid and aid not in message_ids_in_session:
            aid = None
        elif aid and message_role_by_id.get(aid) != MessageRole.ASSISTANT.value:
            aid = None
        cleaned.append(
            beat.model_copy(
                update={"user_message_id": uid, "assistant_message_id": aid}
            )
        )
    return cleaned
