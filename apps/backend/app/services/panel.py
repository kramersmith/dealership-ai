from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Any, Callable, cast

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
from app.services.panel_card_builder import build_rendered_panel_cards
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


class PanelGenerationInterrupted(RuntimeError):
    """Raised when panel generation is interrupted by user stop."""


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
                    "text": GENERATE_AI_PANEL_SYNTHESIS_PROMPT,
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


GENERATE_AI_PANEL_SYNTHESIS_PROMPT = """You are generating the three NARRATIVE cards for a car-buying Insights Panel.

The panel's vehicle, numbers, warning, checklist, notes, savings, what-still-needs-confirming, your-leverage, and stance cards are already rendered deterministically from structured deal state. Your only job is these three narrative kinds — the ones that require judgment or prose the renderer cannot produce.

SOURCE OF TRUTH ORDER:
1. negotiation_context
2. structured deal state (numbers, scorecard, health, red_flags, information_gaps, phase)
3. recent conversation (fallback only)
4. latest assistant response (fallback only)

CRITICAL RULES:
- The user message begins with **Current date (UTC)** — treat it as authoritative "now" for any time-relative copy.
- Emit ONLY these three kinds. Omit the kind if no card of that kind would genuinely help the buyer right now. Returning fewer than three (or zero) is fine.
- Never contradict the assistant's advice.
- Narrative body text must be 1-2 sentences max.
- Do not invent new kinds or return title/template — the backend assigns those.
- Vehicle role tags like `primary` and `candidate` are internal. Do not surface them in copy.
- `active_deal_id` is the current focus. When multiple shopping vehicles are active and the buyer has NOT picked one, disambiguate scope in the body (name the vehicle or say "across both options").

THE THREE KINDS:

dealer_read
- A read on *this* specific dealer's posture, motivations, and likely next moves — based on something concrete tying the buyer to a particular dealer or deal: a named dealer, a quoted offer, a fee the dealer added, a specific truck at a specific lot, or a dealer interaction the buyer narrated. Use hedged language ("likely", "probably", "expect them to") — don't claim to read minds.
- Do NOT fire during the research phase. If the buyer is still researching — no named dealer, no active deal with offer numbers, no specific vehicle at a specific dealer, no dealer quote or move — there is no "this dealer" to read. Generic "here's how dealerships work" commentary is not a dealer_read; that belongs in the reply text or the checklist, not as a panel card.
- Signals that a read IS appropriate: buyer has a named dealer or dealer location, the deal has a current_offer or listing_price tied to a specific dealer, the buyer is at or scheduled at a named dealership, the buyer has described a dealer behavior (fee floated, pressure tactic, concession, email/call content).
- Signals that a read is NOT appropriate: buyer_context = researching with no deal numbers, stance = researching or preparing with no named dealer, the whole message is comparison-shopping or education.
- Schema: {"body": "1-2 sentences. Supports **markdown**.", "bullets": ["Optional supporting signal"]}

next_best_move
- The single best action the buyer should take next. If `negotiation_context.pending_actions` has a top action, use it; if `negotiation_context.scripts` has a script for this moment, weave it in.
- Schema: {"body": "1-2 sentences. Supports **markdown**.", "bullets": ["Optional supporting point"]}

if_you_say_yes
- Use ONLY when there is a real offer on the table and agreeing has meaningful consequences. Focus on what the buyer would be accepting.
- Schema: {"severity": "critical|warning", "message": "The concern", "action": "Optional — what to do"}

PRIORITY:
- dealer_read: "normal"
- next_best_move: "high" during negotiation/financing/closing, otherwise "normal"
- if_you_say_yes: "high" by default; "critical" when the risk is severe and immediate

Each card in the output has "kind", "content", "priority". Return ONLY a JSON array."""


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
    is_cancelled: Callable[[], bool] | None = None,
) -> AsyncGenerator[PanelStreamEvent, None]:
    """Stream AI panel from Claude internally; SSE consumers see lifecycle only.

    Events (client-visible contract):
    - panel_started: panel generation started for an attempt
    - panel_done: complete canonical panel + usage summary (no per-card SSE)
    - panel_error: terminal failure
    """
    client = create_anthropic_client()
    usage_summary = empty_usage_summary()

    render_start_ts = time.monotonic()
    rendered_cards = build_rendered_panel_cards(deal_state_dict)
    logger.info(
        "TIMING[panel.render] session_id=%s duration_ms=%d rendered_cards=%d kinds=%s",
        session_id,
        int((time.monotonic() - render_start_ts) * 1000),
        len(rendered_cards),
        [card["kind"] for card in rendered_cards],
    )

    panel_static_snap = build_panel_static_prompt_cache_snapshot(
        static_panel_prompt=GENERATE_AI_PANEL_SYNTHESIS_PROMPT,
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
        if is_cancelled and is_cancelled():
            raise PanelGenerationInterrupted(
                "Panel generation interrupted before start"
            )
        yield PanelStreamEvent(
            type="panel_started",
            data={"attempt": attempt + 1, "max_tokens": current_max_tokens},
        )

        parser = _JsonArrayObjectStreamParser()
        emitted_this_attempt = 0
        streamed_text_chunks: list[str] = []
        first_text_ts: float | None = None

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
                    if is_cancelled and is_cancelled():
                        raise PanelGenerationInterrupted(
                            "Panel generation interrupted during stream"
                        )
                    if (
                        event.type == "content_block_delta"
                        and getattr(event.delta, "type", None) == "text_delta"
                    ):
                        text_chunk = getattr(event.delta, "text", None)
                        if not isinstance(text_chunk, str):
                            continue
                        if first_text_ts is None:
                            first_text_ts = time.monotonic()
                            logger.info(
                                "TIMING[panel.stream.ttfb] session_id=%s attempt=%d "
                                "ttfb_ms=%d",
                                session_id,
                                attempt + 1,
                                int((first_text_ts - started_at) * 1000),
                            )
                        streamed_text_chunks.append(text_chunk)
                        for raw_card in parser.feed(text_chunk):
                            validated = normalize_panel_card(raw_card)
                            if not validated:
                                continue
                            cards.append(validated)
                            emitted_this_attempt += 1

                final_message = await stream.get_final_message()
            stream_end_ts = time.monotonic()
            logger.info(
                "TIMING[panel.stream.end] session_id=%s attempt=%d duration_ms=%d "
                "cards_streamed=%d text_chars=%d",
                session_id,
                attempt + 1,
                int((stream_end_ts - started_at) * 1000),
                emitted_this_attempt,
                sum(len(chunk) for chunk in streamed_text_chunks),
            )

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

        except PanelGenerationInterrupted:
            raise
        except Exception:
            if emitted_this_attempt > 0:
                logger.warning(
                    "Panel stream failed after emitting %d cards; returning partial panel",
                    emitted_this_attempt,
                )
                break

            try:
                if is_cancelled and is_cancelled():
                    raise PanelGenerationInterrupted(
                        "Panel generation interrupted before fallback"
                    )
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
                break
            except PanelGenerationInterrupted:
                raise
            except Exception:
                logger.exception(
                    "Failed to stream AI panel cards (attempt %d)", attempt + 1
                )
                if attempt >= settings.CLAUDE_MAX_TOKENS_RETRIES:
                    # Graceful degradation: the three narrative (synthesis)
                    # card kinds are unavailable, but the deterministically
                    # rendered cards are already built from structured state
                    # and still useful to the buyer. Fall through to the
                    # canonicalize + panel_done path with an empty synthesis
                    # list rather than emitting panel_error and dropping the
                    # rendered cards the user paid nothing to compute.
                    logger.warning(
                        "AI panel synthesis exhausted retries; delivering %d "
                        "rendered cards without narrative synthesis",
                        len(rendered_cards),
                    )
                    cards = []
                    break

    canon_start_ts = time.monotonic()
    # Merge rendered cards (from structured state) with synthesized cards (from
    # the LLM). The synthesis prompt is restricted to three narrative kinds
    # (dealer_read, next_best_move, if_you_say_yes) that the renderer does not
    # produce, so in normal operation there is no kind overlap. Rendered cards
    # are listed first: on the unlikely chance the LLM emits a rendered kind,
    # identity-dedupe in canonicalize_panel_cards keeps the first-seen card at
    # equal rank, so the deterministic rendered card wins over LLM drift.
    rendered_normalized = [
        normalized_card
        for raw in rendered_cards
        if (normalized_card := normalize_panel_card(raw)) is not None
    ]
    merged_cards = [*rendered_normalized, *cards]
    canonical_cards = canonicalize_panel_cards(merged_cards)
    canonical_cards = [
        card
        for card in canonical_cards
        if card.get("kind")
        not in {AiCardKind.COMPARISON.value, AiCardKind.TRADE_OFF.value}
    ]
    canonical_cards = _enforce_single_vehicle_focus_for_panel_cards(
        canonical_cards, deal_state_dict
    )
    logger.info(
        "TIMING[panel.canonicalize] session_id=%s duration_ms=%d "
        "rendered=%d synthesized=%d cards_out=%d",
        session_id,
        int((time.monotonic() - canon_start_ts) * 1000),
        len(rendered_normalized),
        len(cards),
        len(canonical_cards),
    )
    logger.info(
        "AI panel canonicalization: rendered=%d synthesized=%d final=%d: %s",
        len(rendered_normalized),
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
        if event.type == "panel_done":
            usage_summary = event.data.get("usage_summary", usage_summary)
            cards = event.data.get("cards", cards)
            return cards, usage_summary
        if event.type == "panel_error":
            return [], usage_summary

    return cards, usage_summary
