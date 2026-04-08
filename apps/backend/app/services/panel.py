from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Any, cast

from app.core.config import settings
from app.models.enums import AiCardKind, VehicleRole
from app.services.claude import (
    build_prompt_deal_state,
    build_temporal_hint_line,
    create_anthropic_client,
    current_utc_date_iso,
    empty_usage_summary,
    get_escalated_max_tokens,
    merge_usage_summary,
    summarize_usage,
)
from app.services.panel_cards import canonicalize_panel_cards, normalize_panel_card
from app.services.prompt_cache_signature import (
    DEFAULT_PROMPT_CACHE_BETAS,
    build_panel_static_prompt_cache_snapshot,
    log_prompt_cache_break,
    prompt_cache_components_changed,
)
from app.services.usage_tracking import (
    UsageRecorder,
    build_request_usage,
    log_request_usage,
)

logger = logging.getLogger(__name__)

# ─── Panel configuration constants ───

PANEL_GENERATOR_MAX_TOKENS = 4096
PANEL_RECENT_MESSAGES = 1
PANEL_MESSAGE_TRUNCATION = 300
PANEL_ASSISTANT_TRUNCATION = 220


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

        for character in chunk:
            if not self._started:
                if character.isspace():
                    continue
                if character == "[":
                    self._started = True
                continue

            if self._ended:
                continue

            if not self._collecting:
                if character.isspace() or character == ",":
                    continue
                if character == "]":
                    self._ended = True
                    continue
                if character == "{":
                    self._collecting = True
                    self._depth = 1
                    self._in_string = False
                    self._escape = False
                    self._buffer = "{"
                continue

            self._buffer += character

            if self._in_string:
                if self._escape:
                    self._escape = False
                elif character == "\\":
                    self._escape = True
                elif character == '"':
                    self._in_string = False
                continue

            if character == '"':
                self._in_string = True
            elif character == "{":
                self._depth += 1
            elif character == "}":
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
        validated = normalize_panel_card(raw_card)
        if validated:
            cards.append(validated)
    return cards


def _build_panel_request_messages(
    *,
    prompt_deal_state: dict[str, Any],
    conversation_context: str,
    assistant_text: str,
) -> list[dict[str, Any]]:
    today_iso = current_utc_date_iso()
    temporal = build_temporal_hint_line(prompt_deal_state, today_iso)
    temporal_block = f"{temporal}\n\n" if temporal else ""
    return [
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
                        f"Current date (UTC): {today_iso}. "
                        'Authoritative "now" for any time-sensitive card copy.\n\n'
                        f"{temporal_block}"
                        "Deal state:\n```json\n"
                        f"{json.dumps(prompt_deal_state, indent=2, default=str)}\n"
                        "```\n\n"
                        "Recent conversation (fallback only):\n"
                        f"{conversation_context}\n\n"
                        "Latest assistant response (fallback only):\n"
                        f"{assistant_text[:PANEL_ASSISTANT_TRUNCATION]}"
                    ),
                },
            ],
        }
    ]


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

        next_max_tokens = get_escalated_max_tokens(current_max_tokens)
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


def _is_active_comparison_context(deal_state_dict: dict[str, Any]) -> bool:
    negotiation_context = deal_state_dict.get("negotiation_context")
    if not isinstance(negotiation_context, dict):
        return False
    situation = negotiation_context.get("situation")
    if not isinstance(situation, str):
        return False
    lowered = situation.lower()
    return "compar" in lowered


def _shopping_vehicles(deal_state_dict: dict[str, Any]) -> list[dict[str, Any]]:
    vehicles = deal_state_dict.get("vehicles")
    if not isinstance(vehicles, list):
        return []
    shopping: list[dict[str, Any]] = []
    for vehicle in vehicles:
        if not isinstance(vehicle, dict):
            continue
        role = vehicle.get("role")
        if role in {VehicleRole.PRIMARY.value, VehicleRole.CANDIDATE.value}:
            shopping.append(vehicle)
    return shopping


def _has_explicit_single_focus_signal(deal_state_dict: dict[str, Any]) -> bool:
    negotiation_context = deal_state_dict.get("negotiation_context")
    if not isinstance(negotiation_context, dict):
        return False
    situation = negotiation_context.get("situation")
    if not isinstance(situation, str):
        return False
    lowered = situation.lower()
    focus_markers = (
        "picked",
        "chose",
        "decided",
        "going with",
        "go with",
        "best for me",
        "settled on",
        "selected",
        "moving forward with",
        "focus on",
        "not considering",
        "no longer considering",
    )
    return any(marker in lowered for marker in focus_markers)


def _active_vehicle_for_panel_focus(
    deal_state_dict: dict[str, Any],
) -> dict[str, Any] | None:
    active_deal_id = deal_state_dict.get("active_deal_id")
    if not isinstance(active_deal_id, str) or not active_deal_id:
        return None

    deals = deal_state_dict.get("deals")
    if not isinstance(deals, list):
        return None
    active_vehicle_id = None
    for deal in deals:
        if not isinstance(deal, dict):
            continue
        if deal.get("id") == active_deal_id:
            vehicle_id = deal.get("vehicle_id")
            if isinstance(vehicle_id, str) and vehicle_id:
                active_vehicle_id = vehicle_id
            break
    if not active_vehicle_id:
        return None

    vehicles = deal_state_dict.get("vehicles")
    if not isinstance(vehicles, list):
        return None
    for vehicle in vehicles:
        if isinstance(vehicle, dict) and vehicle.get("id") == active_vehicle_id:
            return vehicle
    return None


def _vehicle_card_matches_active_focus(
    card_vehicle: dict[str, Any], active_vehicle: dict[str, Any]
) -> bool:
    card_vin = card_vehicle.get("vin")
    active_vin = active_vehicle.get("vin")
    if isinstance(card_vin, str) and isinstance(active_vin, str):
        return card_vin.strip().upper() == active_vin.strip().upper()
    if isinstance(active_vin, str) and active_vin.strip():
        # We know the active VIN; non-matching/empty card VIN should not be treated as focused.
        return False

    # Fallback when VIN is unavailable: require key identity fields (plus engine when present).
    for key in ("year", "make", "model"):
        if card_vehicle.get(key) != active_vehicle.get(key):
            return False
    card_engine = card_vehicle.get("engine")
    active_engine = active_vehicle.get("engine")
    if isinstance(card_engine, str) and isinstance(active_engine, str):
        if card_engine.strip().lower() != active_engine.strip().lower():
            return False
    return True


def _enforce_single_vehicle_focus_for_panel_cards(
    cards: list[dict[str, Any]], deal_state_dict: dict[str, Any]
) -> list[dict[str, Any]]:
    if _is_active_comparison_context(deal_state_dict):
        return cards

    # Only collapse to one vehicle when buyer intent clearly moved to a single option.
    # If multiple shopping vehicles are still in play without an explicit choice signal,
    # keep all vehicle cards so the panel can remain specific by vehicle.
    if len(
        _shopping_vehicles(deal_state_dict)
    ) > 1 and not _has_explicit_single_focus_signal(deal_state_dict):
        return cards

    active_vehicle = _active_vehicle_for_panel_focus(deal_state_dict)
    if not isinstance(active_vehicle, dict):
        return cards

    focused_cards: list[dict[str, Any]] = []
    for card in cards:
        if card.get("kind") != AiCardKind.VEHICLE.value:
            focused_cards.append(card)
            continue
        content = card.get("content")
        vehicle = content.get("vehicle") if isinstance(content, dict) else None
        if isinstance(vehicle, dict) and _vehicle_card_matches_active_focus(
            vehicle, active_vehicle
        ):
            focused_cards.append(card)
    return focused_cards


GENERATE_AI_PANEL_PROMPT = """You are generating the Insights Panel for a car-buying app.

The panel is NOT a recap of the latest assistant reply. It is the buyer's working memory.

PRIMARY GOAL:
Generate a concise set of cards (often 3–7) that help the buyer answer these questions at a glance:
- What is true now?
- What changed?
- What is dangerous?
- What still needs confirmation?
- What should I do next?
- What is worth remembering?

SOURCE OF TRUTH ORDER:
1. negotiation_context
2. structured deal state (numbers, vehicle, deal pipeline phase, comparison, checklist, red flags, information gaps)
3. recent conversation as fallback only
4. latest assistant response as fallback only

CRITICAL RULES:
- The user message begins with **Current date (UTC)** — treat it as authoritative "now" for any time-relative card copy (deadlines, "soon"/"recent", warranty or promo windows, lease pacing, loan term remaining, event ordering, vehicle age from model year). Do not assume another calendar year or month.
- Do NOT paraphrase the latest assistant reply unless something needs to stay visible across turns.
- Never contradict the assistant's advice.
- Every card must add distinct value. No duplicates.
- Narrative body text must be 1-2 sentences max.
- Prefer persistent state over fresh prose.
- Stable cards should preserve structure across turns.
- Use the exact card kinds below. Do not invent new kinds.
- Do not return a title or render template. The backend assigns canonical titles and templates.
- Do NOT emit `comparison` or `trade_off` cards. Side-by-side tables belong in chat, not the insights panel.
- Vehicle role tags like `primary` and `candidate` are internal. Do not surface those literal labels in card body text, notes, checklist items, or number labels.
- `active_deal_id` is the current focus. For non-vehicle cards, prioritize only the active deal/vehicle unless the user explicitly asks to keep comparing options.
- When there are multiple shopping vehicles but one active focus, treat non-active vehicles as parked context (fallback only), not as inputs for primary numbers/leverage/next-step cards.
- When 2+ shopping vehicles are still active and the buyer has NOT explicitly chosen one, avoid ambiguous wording. For every non-vehicle card, explicitly indicate scope (for example: vehicle name/year/color/VIN suffix, or "across both options"). Do not leave cards ambiguous about which vehicle they refer to.

Return ONLY a JSON array of card objects. Each card has:
- "kind": one of the exact kinds below
- "content": kind-specific content object
- "priority": "critical", "high", "normal", or "low"

EXACT CARD KINDS:

vehicle
- Use when a specific vehicle has been identified and it adds context.
- Schema: {"vehicle": {"year": 2024, "make": "Ford", "model": "F-250", "trim": "XLT", "cab_style": "SuperCrew", "bed_length": "8 ft", "engine": "7.3L V8", "mileage": 15000, "color": "White", "vin": "1FT...", "role": "primary|candidate|trade_in"}, "risk_flags": ["High Mileage"]}
- When 2+ vehicles are being actively compared, emit one separate vehicle card per compared vehicle. Do not collapse multiple VINs into one vehicle card.

phase
- The negotiation stance strip: mirrors `negotiation_context.stance` and `negotiation_context.situation` when present; otherwise infer a stance and one short situation line from buyer_context and deal state.
- This is NOT the deal pipeline phase (`deals[].phase`). It is the buyer's current negotiation posture and what is happening now.
- Schema: {"stance": "researching|preparing|engaging|negotiating|holding|walking|waiting|financing|closing|post_purchase", "situation": "One concise sentence (about 8–18 words) describing the moment."}
- Emit at most one `phase` card.

numbers
- Use for: current deal state.
- Labels must be short.
- Schema: {"rows": [{"label": "Field", "value": "$32,000", "field": "current_offer", "highlight": "good|bad|neutral"}]}
- Groups allowed: {"groups": [{"key": "pricing", "rows": [...]}, {"key": "financing", "rows": [...]}]}
- If the card compares multiple vehicles or deals, use `groups` and make each group key an explicit option label (vehicle/deal/dealer/VIN suffix). Never emit repeated unlabeled row blocks.
- Default to active-deal numbers. Only include multi-vehicle groups when the user is actively comparing in this turn.
- When 2+ shopping vehicles are active and no explicit single-choice signal exists, prefer grouped rows keyed by explicit vehicle labels so the buyer can see which truck each number belongs to.

what_changed
- Use only when something materially changed since the prior state.
- Same schema as `numbers`.
- Prefer concrete deltas over explanation.

warning
- Use for: an active risk that stands on its own.
- Schema: {"severity": "critical|warning", "message": "The concern", "action": "Optional — what to do"}

if_you_say_yes
- Use for: the consequence of agreeing right now.
- Same schema as `warning`.
- Focus on what the buyer would be accepting.

notes
- Use for: durable facts the buyer should not have to remember alone.
- Facts only. No generic encouragement. No mind-reading. No recap.
- High bar for inclusion. Max 5 items.
- Good notes: first offer, pre-approval, dealer promises, unresolved payoff, verbal commitments.
- Schema: {"items": ["First offer: $31,900", "Trade-in payoff still unconfirmed"]}

what_still_needs_confirming
- Use for: unresolved facts the buyer must verify before progressing.
- Schema: {"items": [{"label": "Item description", "done": false}]}
- Items should usually remain undone.

checklist
- Use for: concrete tasks and verification steps.
- Schema: {"items": [{"label": "Item description", "done": false}]}

dealer_read
- Schema: {"body": "1-2 sentences. Supports **markdown**.", "bullets": ["Optional supporting signal"]}

next_best_move
- Schema: {"body": "1-2 sentences. Supports **markdown**.", "bullets": ["Optional supporting point"]}

your_leverage
- Schema: {"body": "1-2 sentences. Supports **markdown**.", "bullets": ["Optional supporting point"]}

success
- Use for: a meaningful win or milestone.
- Schema: {"body": "A measurable win. Supports **markdown**.", "headline": "Optional short line", "amount": "$2,400", "detail": "Optional detail"}

savings_so_far
- Use only when the savings are real and grounded in actual deal numbers.
- Schema: {"body": "A measurable win. Supports **markdown**.", "headline": "Optional short line", "amount": "$2,400", "detail": "Optional detail"}

NEGOTIATION CONTEXT RULES:
If negotiation_context exists, it is the strongest source of truth.
- Emit a `phase` card from `stance` + `situation` whenever both are meaningful (usually always for active buyer sessions).
- When **2+ shopping vehicles** are in deal state and the buyer is comparing, `situation` must reflect **both options or the main trade-off** — not only the active deal's last CARFAX line. If `negotiation_context.situation` is missing or clearly single-vehicle while multiple deals have material flags/health, infer one comparison-scoped sentence from structured deal state.
- Use key_numbers to drive the Numbers card.
- Use scripts to strengthen next_best_move when exact wording matters.
- Use pending_actions to drive what_still_needs_confirming or checklist.
- Use leverage to drive your_leverage.
- The situation field should also inform dealer_read or next_best_move when those cards add distinct value beyond the phase strip.

DEAL PIPELINE PHASE (structured `deals[].phase` enum: research, initial_contact, test_drive, negotiation, financing, closing — not the panel `phase` card):
- research / initial_contact: emphasize vehicle, numbers, checklist, notes.
- test_drive / negotiation: numbers, what_changed, warning, next_best_move, your_leverage, notes.
- financing: numbers, warning, if_you_say_yes, what_still_needs_confirming, notes.
- closing: numbers, what_still_needs_confirming, notes, savings_so_far, success.

INCLUSION RULES:
- Include a vehicle card when a specific vehicle has been identified and it adds context.
- When 2+ vehicles are being compared and each one matters, include a separate vehicle card for each compared vehicle.
- If deal state lists multiple shopping vehicles (primary/candidate), emit one vehicle card per listed vehicle — do not omit the non-active option when the buyer is still comparing.
- Include a numbers card when meaningful financial data exists.
- Include what_changed only for real deltas.
- Include notes only when there are durable facts worth preserving.
- Include savings_so_far only when the savings are real and grounded.
- Use at most one of dealer_read or next_best_move unless both are clearly needed.
- Do not create cards that only restate each other in different words.

ORDER:
- phase (always first — negotiation stance / situation strip)
- warning / if_you_say_yes
- numbers / what_changed
- dealer_read / next_best_move / your_leverage
- notes
- vehicle
- what_still_needs_confirming / checklist
- savings_so_far / success

Return ONLY the JSON array."""


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
    panel_prompt_cache: dict[str, Any] | None = None,
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

    panel_static_snap = build_panel_static_prompt_cache_snapshot(
        static_panel_prompt=GENERATE_AI_PANEL_PROMPT,
        model=settings.CLAUDE_MODEL,
        betas=DEFAULT_PROMPT_CACHE_BETAS,
    )
    if panel_prompt_cache is not None:
        prior_panel = panel_prompt_cache.get("prior")
        if isinstance(prior_panel, dict):
            cache_changed = prompt_cache_components_changed(
                prior_panel, panel_static_snap
            )
            if cache_changed:
                log_prompt_cache_break(
                    logger,
                    session_id=session_id,
                    phase="panel",
                    step=None,
                    prior=prior_panel,
                    current=panel_static_snap,
                    changed_components=cache_changed,
                )
                panel_prompt_cache["breaks_delta"] = (
                    panel_prompt_cache.get("breaks_delta", 0) + 1
                )
        panel_prompt_cache["last"] = panel_static_snap

    prompt_deal_state = build_prompt_deal_state(deal_state_dict) or {}
    conversation_context = _build_conversation_context(
        messages,
        assistant_text,
        msg_truncation=PANEL_MESSAGE_TRUNCATION,
        include_assistant=False,
    )
    panel_messages = _build_panel_request_messages(
        prompt_deal_state=prompt_deal_state,
        conversation_context=conversation_context,
        assistant_text=assistant_text,
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
        streamed_text_chunks: list[str] = []

        try:
            started_at = time.monotonic()
            stream_call = client.messages.stream(
                model=settings.CLAUDE_MODEL,
                max_tokens=current_max_tokens,
                messages=cast(Any, panel_messages),
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
                        streamed_text_chunks.append(text_chunk)
                        for raw_card in parser.feed(text_chunk):
                            validated = normalize_panel_card(raw_card)
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
                next_max_tokens = get_escalated_max_tokens(current_max_tokens)
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

            final_cards = _extract_cards_from_text("".join(streamed_text_chunks))
            if final_cards:
                if final_cards != cards:
                    logger.info(
                        "AI panel reconciliation adjusted final cards from %d streamed to %d canonical",
                        len(cards),
                        len(final_cards),
                    )
                cards = final_cards

            break

        except Exception:
            if emitted_this_attempt > 0:
                logger.warning(
                    "Panel stream failed after emitting %d cards; returning partial panel",
                    emitted_this_attempt,
                )
                break

            try:
                started_at = time.monotonic()
                response = await _create_panel_message_with_retry(
                    client,
                    model=settings.CLAUDE_MODEL,
                    max_tokens=current_max_tokens,
                    messages=panel_messages,
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

    canonical_cards = canonicalize_panel_cards(cards)
    canonical_cards = [
        card
        for card in canonical_cards
        if card.get("kind")
        not in {AiCardKind.COMPARISON.value, AiCardKind.TRADE_OFF.value}
    ]
    canonical_cards = _enforce_single_vehicle_focus_for_panel_cards(
        canonical_cards, deal_state_dict
    )
    if canonical_cards != cards:
        logger.info(
            "AI panel canonicalization adjusted final cards from %d to %d: %s",
            len(cards),
            len(canonical_cards),
            [card["kind"] for card in canonical_cards],
        )
        cards = canonical_cards

    logger.info(
        "AI panel streamed %d cards: %s",
        len(cards),
        [card["kind"] for card in cards],
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
