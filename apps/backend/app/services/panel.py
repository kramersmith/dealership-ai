from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Any

from app.core.config import settings
from app.models.enums import AiCardPriority, AiCardType
from app.services.claude import (
    _get_escalated_max_tokens,
    create_anthropic_client,
    empty_usage_summary,
    merge_usage_summary,
    summarize_usage,
)
from app.services.usage_tracking import (
    UsageRecorder,
    build_request_usage,
    log_request_usage,
)

logger = logging.getLogger(__name__)

# ─── Panel configuration constants ───

PANEL_GENERATOR_MAX_TOKENS = 2048
PANEL_RECENT_MESSAGES = 2
PANEL_MESSAGE_TRUNCATION = 300
PANEL_ASSISTANT_TRUNCATION = 500

# Valid card types and priorities for AI panel validation
VALID_PANEL_CARD_TYPES = {t.value for t in AiCardType}
VALID_PANEL_CARD_PRIORITIES = {p.value for p in AiCardPriority}


@dataclass
class PanelStreamEvent:
    type: str
    data: dict[str, Any]


class _JsonArrayObjectStreamParser:
    """Incrementally parse top-level JSON objects inside a JSON array stream."""

    def __init__(self) -> None:
        self._started = False
        self._ended = False
        self._collecting = False
        self._depth = 0
        self._in_string = False
        self._escape = False
        self._buffer = ""

    @property
    def ended(self) -> bool:
        return self._ended

    def feed(self, chunk: str) -> list[dict]:
        objects: list[dict] = []

        for ch in chunk:
            if not self._started:
                if ch.isspace():
                    continue
                if ch == "[":
                    self._started = True
                continue

            if self._ended:
                continue

            if not self._collecting:
                if ch.isspace() or ch == ",":
                    continue
                if ch == "]":
                    self._ended = True
                    continue
                if ch == "{":
                    self._collecting = True
                    self._depth = 1
                    self._in_string = False
                    self._escape = False
                    self._buffer = "{"
                continue

            self._buffer += ch

            if self._in_string:
                if self._escape:
                    self._escape = False
                elif ch == "\\":
                    self._escape = True
                elif ch == '"':
                    self._in_string = False
                continue

            if ch == '"':
                self._in_string = True
            elif ch == "{":
                self._depth += 1
            elif ch == "}":
                self._depth -= 1
                if self._depth == 0:
                    try:
                        parsed = json.loads(self._buffer)
                        if isinstance(parsed, dict):
                            objects.append(parsed)
                    except json.JSONDecodeError:
                        logger.warning("Skipped malformed panel card object")
                    finally:
                        self._collecting = False
                        self._buffer = ""

        return objects


def _validate_panel_card(card: Any) -> dict | None:
    if not isinstance(card, dict):
        return None
    if card.get("type") not in VALID_PANEL_CARD_TYPES:
        return None
    if not card.get("title"):
        return None
    if not isinstance(card.get("content"), dict):
        return None
    if card.get("priority") not in VALID_PANEL_CARD_PRIORITIES:
        card["priority"] = AiCardPriority.NORMAL
    return card


def _extract_cards_from_text(text: str) -> list[dict]:
    if not text:
        return []

    parsed_text = text.strip()
    if parsed_text.startswith("```"):
        parsed_text = parsed_text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

    try:
        raw_cards = json.loads(parsed_text)
    except json.JSONDecodeError:
        logger.warning("AI panel response was not valid JSON")
        return []

    if not isinstance(raw_cards, list):
        logger.warning("AI panel response is not a list: %s", type(raw_cards).__name__)
        return []

    cards: list[dict] = []
    for raw_card in raw_cards:
        validated = _validate_panel_card(raw_card)
        if validated:
            cards.append(validated)
    return cards


async def _create_panel_message_with_retry(
    client,
    *,
    model: str,
    messages: list[dict],
    max_tokens: int,
):
    current_max_tokens = max_tokens

    for attempt in range(settings.CLAUDE_MAX_TOKENS_RETRIES + 1):
        response = await client.messages.create(
            model=model,
            max_tokens=current_max_tokens,
            messages=messages,
        )
        stop_reason = getattr(response, "stop_reason", None)
        usage = response.usage
        logger.info(
            "Cache [panel]: creation=%d read=%d uncached=%d stop=%s max_tokens=%d",
            getattr(usage, "cache_creation_input_tokens", 0) or 0,
            getattr(usage, "cache_read_input_tokens", 0) or 0,
            usage.input_tokens,
            stop_reason,
            current_max_tokens,
        )

        if stop_reason != "max_tokens":
            return response

        next_max_tokens = _get_escalated_max_tokens(current_max_tokens)
        if (
            attempt >= settings.CLAUDE_MAX_TOKENS_RETRIES
            or next_max_tokens <= current_max_tokens
        ):
            logger.warning(
                "AI panel generation exhausted max_tokens retries at budget=%d",
                current_max_tokens,
            )
            return response

        logger.warning(
            "AI panel generation hit max_tokens at %d, retrying with %d (%d/%d)",
            current_max_tokens,
            next_max_tokens,
            attempt + 1,
            settings.CLAUDE_MAX_TOKENS_RETRIES,
        )
        current_max_tokens = next_max_tokens


def _build_conversation_context(
    messages: list[dict],
    assistant_text: str,
    recent_count: int = PANEL_RECENT_MESSAGES,
    msg_truncation: int = PANEL_MESSAGE_TRUNCATION,
    assistant_truncation: int = PANEL_ASSISTANT_TRUNCATION,
    include_assistant: bool = True,
) -> str:
    """Build conversation context string from recent messages."""

    def _message_text(content: Any) -> str:
        if isinstance(content, list):
            text_parts = [
                part["text"]
                for part in content
                if isinstance(part, dict) and part.get("text")
            ]
            return " ".join(text_parts) if text_parts else "(image)"
        if isinstance(content, str):
            return content
        return str(content)

    recent = messages[-recent_count:]
    context_parts = []
    for msg in recent:
        content = _message_text(msg["content"])
        context_parts.append(f"[{msg['role']}]: {content[:msg_truncation]}")

    assistant_already_in_recent = any(
        msg.get("role") == "assistant"
        and _message_text(msg.get("content", "")).strip() == assistant_text.strip()
        for msg in recent
    )
    if include_assistant:
        if not assistant_already_in_recent:
            context_parts.append(
                f"[assistant]: {assistant_text[:assistant_truncation]}"
            )
    return "\n".join(context_parts)


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
    *,
    usage_recorder: UsageRecorder | None = None,
    session_id: str | None = None,
) -> list[dict]:
    cards, _usage_summary = await generate_ai_panel_cards_with_usage(
        deal_state_dict,
        assistant_text,
        messages,
        usage_recorder=usage_recorder,
        session_id=session_id,
    )
    return cards


async def stream_ai_panel_cards_with_usage(
    deal_state_dict: dict,
    assistant_text: str,
    messages: list[dict],
    *,
    usage_recorder: UsageRecorder | None = None,
    session_id: str | None = None,
) -> AsyncGenerator[PanelStreamEvent, None]:
    """Stream AI panel cards incrementally and emit lifecycle events.

    Events:
    - panel_started: panel generation started for an attempt
    - panel_card: validated card parsed from stream
    - panel_done: complete panel payload + usage summary
    - panel_error: terminal failure
    """
    client = create_anthropic_client()
    usage_summary = empty_usage_summary()

    state_json = json.dumps(deal_state_dict, indent=2, default=str)
    conversation_context = _build_conversation_context(
        messages,
        assistant_text,
        recent_count=PANEL_RECENT_MESSAGES,
        msg_truncation=PANEL_MESSAGE_TRUNCATION,
        assistant_truncation=PANEL_ASSISTANT_TRUNCATION,
    )

    current_max_tokens = PANEL_GENERATOR_MAX_TOKENS
    cards: list[dict] = []

    for attempt in range(settings.CLAUDE_MAX_TOKENS_RETRIES + 1):
        yield PanelStreamEvent(
            type="panel_started",
            data={"attempt": attempt + 1, "max_tokens": current_max_tokens},
        )

        parser = _JsonArrayObjectStreamParser()
        emitted_this_attempt = 0

        try:
            started_at = time.monotonic()
            stream_call = client.messages.stream(
                model=settings.CLAUDE_MODEL,
                max_tokens=current_max_tokens,
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
            if hasattr(stream_call, "__await__"):
                stream_call = await stream_call

            async with stream_call as stream:
                async for event in stream:
                    if (
                        event.type == "content_block_delta"
                        and getattr(event.delta, "type", None) == "text_delta"
                    ):
                        text_chunk = getattr(event.delta, "text", None)
                        if not isinstance(text_chunk, str):
                            continue
                        for raw_card in parser.feed(text_chunk):
                            validated = _validate_panel_card(raw_card)
                            if not validated:
                                continue
                            cards.append(validated)
                            emitted_this_attempt += 1
                            yield PanelStreamEvent(
                                type="panel_card",
                                data={
                                    "index": len(cards) - 1,
                                    "card": validated,
                                    "attempt": attempt + 1,
                                },
                            )

                final_message = await stream.get_final_message()

            request_summary = summarize_usage(final_message.usage)
            merge_usage_summary(usage_summary, request_summary)
            request_usage = build_request_usage(
                model=settings.CLAUDE_MODEL,
                usage_summary=request_summary,
                latency_ms=int((time.monotonic() - started_at) * 1000),
            )
            log_request_usage(
                logger,
                request_usage,
                context="panel_generation",
                session_id=session_id,
            )
            if usage_recorder:
                usage_recorder(request_usage)

            stop_reason = getattr(final_message, "stop_reason", None)
            logger.info(
                "Cache [panel]: creation=%d read=%d uncached=%d stop=%s max_tokens=%d",
                getattr(final_message.usage, "cache_creation_input_tokens", 0) or 0,
                getattr(final_message.usage, "cache_read_input_tokens", 0) or 0,
                getattr(final_message.usage, "input_tokens", 0) or 0,
                stop_reason,
                current_max_tokens,
            )

            if stop_reason == "max_tokens":
                next_max_tokens = _get_escalated_max_tokens(current_max_tokens)
                if (
                    emitted_this_attempt == 0
                    and attempt < settings.CLAUDE_MAX_TOKENS_RETRIES
                    and next_max_tokens > current_max_tokens
                ):
                    logger.warning(
                        "AI panel stream hit max_tokens before emitting cards at %d, retrying with %d (%d/%d)",
                        current_max_tokens,
                        next_max_tokens,
                        attempt + 1,
                        settings.CLAUDE_MAX_TOKENS_RETRIES,
                    )
                    current_max_tokens = next_max_tokens
                    continue
                logger.warning(
                    "AI panel stream ended at max_tokens after emitting %d cards",
                    emitted_this_attempt,
                )

            break

        except Exception:
            if emitted_this_attempt > 0:
                logger.warning(
                    "Panel stream failed after emitting %d cards; returning partial panel",
                    emitted_this_attempt,
                )
                break
            # Gracefully fall back when streaming is unavailable or fails.
            try:
                started_at = time.monotonic()
                response = await _create_panel_message_with_retry(
                    client,
                    model=settings.CLAUDE_MODEL,
                    max_tokens=current_max_tokens,
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

                request_summary = summarize_usage(response.usage)
                merge_usage_summary(usage_summary, request_summary)
                request_usage = build_request_usage(
                    model=settings.CLAUDE_MODEL,
                    usage_summary=request_summary,
                    latency_ms=int((time.monotonic() - started_at) * 1000),
                )
                log_request_usage(
                    logger,
                    request_usage,
                    context="panel_generation",
                    session_id=session_id,
                )
                if usage_recorder:
                    usage_recorder(request_usage)

                fallback_text = ""
                for block in response.content:
                    if hasattr(block, "text"):
                        fallback_text = block.text
                        break

                for card in _extract_cards_from_text(fallback_text):
                    cards.append(card)
                    yield PanelStreamEvent(
                        type="panel_card",
                        data={
                            "index": len(cards) - 1,
                            "card": card,
                            "attempt": attempt + 1,
                        },
                    )
                break
            except Exception:
                logger.exception(
                    "Failed to stream AI panel cards (attempt %d)", attempt + 1
                )
                if attempt >= settings.CLAUDE_MAX_TOKENS_RETRIES:
                    yield PanelStreamEvent(
                        type="panel_error",
                        data={
                            "message": "Panel generation failed",
                            "attempt": attempt + 1,
                        },
                    )
                    return

    logger.info(
        "AI panel streamed %d cards: %s",
        len(cards),
        [c["type"] for c in cards],
    )
    yield PanelStreamEvent(
        type="panel_done",
        data={
            "cards": cards,
            "usage_summary": usage_summary,
        },
    )


async def generate_ai_panel_cards_with_usage(
    deal_state_dict: dict,
    assistant_text: str,
    messages: list[dict],
    *,
    usage_recorder: UsageRecorder | None = None,
    session_id: str | None = None,
) -> tuple[list[dict], dict[str, int]]:
    """Generate AI panel cards based on deal state and conversation context.

    Called after the main Claude response to populate the AI-driven panel.
    Uses Sonnet with prompt caching — the large static panel prompt (~2,500 tokens)
    is cached across calls, making subsequent calls fast and cheap.
    """
    usage_summary = empty_usage_summary()
    cards: list[dict] = []

    async for event in stream_ai_panel_cards_with_usage(
        deal_state_dict,
        assistant_text,
        messages,
        usage_recorder=usage_recorder,
        session_id=session_id,
    ):
        if event.type == "panel_card":
            cards.append(event.data["card"])
        elif event.type == "panel_done":
            usage_summary = event.data.get("usage_summary", usage_summary)
            cards = event.data.get("cards", cards)
            return cards, usage_summary
        elif event.type == "panel_error":
            return [], usage_summary

    return cards, usage_summary
