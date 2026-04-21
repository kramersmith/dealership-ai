from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.models.enums import (
    NUMBER_HIGHLIGHT_VALUES,
    AiCardKind,
    AiCardPriority,
    AiCardTemplate,
    NegotiationStance,
)


@dataclass(frozen=True)
class PanelCardSpec:
    kind: AiCardKind
    template: AiCardTemplate
    title: str


PANEL_CARD_SPECS: dict[AiCardKind, PanelCardSpec] = {
    AiCardKind.VEHICLE: PanelCardSpec(
        kind=AiCardKind.VEHICLE,
        template=AiCardTemplate.VEHICLE,
        title="Vehicle",
    ),
    AiCardKind.NUMBERS: PanelCardSpec(
        kind=AiCardKind.NUMBERS,
        template=AiCardTemplate.NUMBERS,
        title="Numbers",
    ),
    AiCardKind.PHASE: PanelCardSpec(
        kind=AiCardKind.PHASE,
        template=AiCardTemplate.BRIEFING,
        title="Status",
    ),
    AiCardKind.WARNING: PanelCardSpec(
        kind=AiCardKind.WARNING,
        template=AiCardTemplate.WARNING,
        title="Warning",
    ),
    AiCardKind.NOTES: PanelCardSpec(
        kind=AiCardKind.NOTES,
        template=AiCardTemplate.NOTES,
        title="Notes",
    ),
    AiCardKind.COMPARISON: PanelCardSpec(
        kind=AiCardKind.COMPARISON,
        template=AiCardTemplate.COMPARISON,
        title="Comparison",
    ),
    AiCardKind.CHECKLIST: PanelCardSpec(
        kind=AiCardKind.CHECKLIST,
        template=AiCardTemplate.CHECKLIST,
        title="Checklist",
    ),
    AiCardKind.SUCCESS: PanelCardSpec(
        kind=AiCardKind.SUCCESS,
        template=AiCardTemplate.SUCCESS,
        title="Success",
    ),
    AiCardKind.WHAT_CHANGED: PanelCardSpec(
        kind=AiCardKind.WHAT_CHANGED,
        template=AiCardTemplate.NUMBERS,
        title="What Changed",
    ),
    AiCardKind.WHAT_STILL_NEEDS_CONFIRMING: PanelCardSpec(
        kind=AiCardKind.WHAT_STILL_NEEDS_CONFIRMING,
        template=AiCardTemplate.CHECKLIST,
        title="What Still Needs Confirming",
    ),
    AiCardKind.DEALER_READ: PanelCardSpec(
        kind=AiCardKind.DEALER_READ,
        template=AiCardTemplate.BRIEFING,
        title="Dealer Read",
    ),
    AiCardKind.YOUR_LEVERAGE: PanelCardSpec(
        kind=AiCardKind.YOUR_LEVERAGE,
        template=AiCardTemplate.TIP,
        title="Your Leverage",
    ),
    AiCardKind.NEXT_BEST_MOVE: PanelCardSpec(
        kind=AiCardKind.NEXT_BEST_MOVE,
        template=AiCardTemplate.BRIEFING,
        title="Next Best Move",
    ),
    AiCardKind.IF_YOU_SAY_YES: PanelCardSpec(
        kind=AiCardKind.IF_YOU_SAY_YES,
        template=AiCardTemplate.WARNING,
        title="If You Say Yes",
    ),
    AiCardKind.TRADE_OFF: PanelCardSpec(
        kind=AiCardKind.TRADE_OFF,
        template=AiCardTemplate.COMPARISON,
        title="Trade-Off",
    ),
    AiCardKind.SAVINGS_SO_FAR: PanelCardSpec(
        kind=AiCardKind.SAVINGS_SO_FAR,
        template=AiCardTemplate.SUCCESS,
        title="Savings So Far",
    ),
}

VALID_PANEL_CARD_KINDS = {kind.value for kind in PANEL_CARD_SPECS}
VALID_PANEL_CARD_TEMPLATES = {template.value for template in AiCardTemplate}
VALID_PANEL_CARD_PRIORITIES = {priority.value for priority in AiCardPriority}

PANEL_CARD_PRIORITY_ORDER = {
    AiCardPriority.CRITICAL.value: 0,
    AiCardPriority.HIGH.value: 1,
    AiCardPriority.NORMAL.value: 2,
    AiCardPriority.LOW.value: 3,
}

PANEL_CARD_KIND_ORDER = {
    kind.value: index
    for index, kind in enumerate(
        [
            AiCardKind.PHASE,
            AiCardKind.WARNING,
            AiCardKind.IF_YOU_SAY_YES,
            AiCardKind.NUMBERS,
            AiCardKind.WHAT_CHANGED,
            AiCardKind.DEALER_READ,
            AiCardKind.NEXT_BEST_MOVE,
            AiCardKind.YOUR_LEVERAGE,
            AiCardKind.NOTES,
            AiCardKind.TRADE_OFF,
            AiCardKind.COMPARISON,
            AiCardKind.VEHICLE,
            AiCardKind.WHAT_STILL_NEEDS_CONFIRMING,
            AiCardKind.CHECKLIST,
            AiCardKind.SAVINGS_SO_FAR,
            AiCardKind.SUCCESS,
        ]
    )
}

# Max instances per kind after identity dedupe. No global panel length cap.
# Most kinds dedupe to a single identity (`kind` only); `vehicle` uses VIN / YMM+mileage+color.
PANEL_KIND_MAX_INSTANCES: dict[str, int] = {
    AiCardKind.VEHICLE.value: 6,
}
DEFAULT_PANEL_KIND_MAX_INSTANCES = 1

REQUIRED_PANEL_CARD_KINDS: tuple[str, ...] = (
    AiCardKind.VEHICLE.value,
    AiCardKind.CHECKLIST.value,
    AiCardKind.PHASE.value,
    AiCardKind.NUMBERS.value,
    AiCardKind.NOTES.value,
)

_NEGOTIATION_STANCE_VALUES = {stance.value for stance in NegotiationStance}

_NUMBER_FIELD_LABELS: dict[str, str] = {
    "msrp": "MSRP",
    "invoice_price": "Invoice",
    "listing_price": "Listing",
    "your_target": "Your target",
    "walk_away_price": "Walk-away max",
    "current_offer": "Current offer",
    "monthly_payment": "Monthly payment",
    "apr": "APR",
    "loan_term_months": "Loan term (mo)",
    "down_payment": "Down payment",
    "trade_in_value": "Trade-in",
}


def _as_string(value: Any) -> str | None:
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return None


def _normalize_string_list(
    value: Any, *, max_items: int | None = None
) -> list[str] | None:
    if not isinstance(value, list):
        return None

    normalized: list[str] = []
    for item in value:
        normalized_item = _as_string(item)
        if normalized_item:
            normalized.append(normalized_item)

    if max_items is not None:
        normalized = normalized[:max_items]

    return normalized


def _normalize_number_row(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None

    label = _as_string(value.get("label"))
    display_value = _as_string(value.get("value"))
    if not label or not display_value:
        return None

    normalized: dict[str, Any] = {
        "label": label,
        "value": display_value,
    }

    field = _as_string(value.get("field"))
    if field:
        normalized["field"] = field

    highlight = _as_string(value.get("highlight"))
    if highlight in NUMBER_HIGHLIGHT_VALUES:
        normalized["highlight"] = highlight

    if isinstance(value.get("secondary"), bool):
        normalized["secondary"] = value["secondary"]

    return normalized


def _normalize_numbers_content(content: Any) -> dict[str, Any] | None:
    if not isinstance(content, dict):
        return None

    rows = content.get("rows")
    groups = content.get("groups")

    if isinstance(groups, list):
        normalized_groups: list[dict[str, Any]] = []
        for group in groups:
            if not isinstance(group, dict):
                continue
            key = _as_string(group.get("key"))
            raw_rows = group.get("rows")
            if not key or not isinstance(raw_rows, list):
                continue
            normalized_rows = [
                normalized_row
                for item in raw_rows
                if (normalized_row := _normalize_number_row(item)) is not None
            ]
            if normalized_rows:
                normalized_groups.append({"key": key, "rows": normalized_rows})
        if normalized_groups:
            normalized: dict[str, Any] = {"groups": normalized_groups}
            summary = _as_string(content.get("summary"))
            if summary:
                normalized["summary"] = summary
            return normalized

    if isinstance(rows, list):
        normalized_rows = [
            normalized_row
            for item in rows
            if (normalized_row := _normalize_number_row(item)) is not None
        ]
        if normalized_rows:
            normalized = {"rows": normalized_rows}
            summary = _as_string(content.get("summary"))
            if summary:
                normalized["summary"] = summary
            return normalized

    return None


def _normalize_body_content(content: Any) -> dict[str, Any] | None:
    if not isinstance(content, dict):
        return None

    body = _as_string(content.get("body"))
    if not body:
        return None

    normalized: dict[str, Any] = {"body": body}
    bullets = _normalize_string_list(content.get("bullets"), max_items=4)
    if bullets:
        normalized["bullets"] = bullets
    return normalized


def _normalize_warning_content(content: Any) -> dict[str, Any] | None:
    if not isinstance(content, dict):
        return None

    message = _as_string(content.get("message"))
    if not message:
        return None

    severity = _as_string(content.get("severity"))
    normalized: dict[str, Any] = {
        "message": message,
        "severity": severity if severity in {"critical", "warning"} else "warning",
    }

    action = _as_string(content.get("action"))
    if action:
        normalized["action"] = action

    consequences = _normalize_string_list(content.get("consequences"), max_items=4)
    if consequences:
        normalized["consequences"] = consequences

    return normalized


def _normalize_notes_content(content: Any) -> dict[str, Any] | None:
    if not isinstance(content, dict):
        return None

    items = _normalize_string_list(content.get("items"), max_items=5)
    if not items:
        return None

    return {"items": items}


def _normalize_phase_content(content: Any) -> dict[str, Any] | None:
    """Negotiation stance + situation line (same contract as negotiation_context strip)."""
    if not isinstance(content, dict):
        return None

    stance = _as_string(content.get("stance"))
    situation = _as_string(content.get("situation"))
    if not situation:
        return None
    if stance not in _NEGOTIATION_STANCE_VALUES:
        stance = NegotiationStance.RESEARCHING.value
    return {"stance": stance, "situation": situation}


def _normalize_checklist_content(content: Any) -> dict[str, Any] | None:
    if not isinstance(content, dict):
        return None

    items = content.get("items")
    if not isinstance(items, list):
        return None

    normalized_items: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        label = _as_string(item.get("label"))
        if not label:
            continue
        normalized_item: dict[str, Any] = {
            "label": label,
            "done": bool(item.get("done", False)),
        }
        detail = _as_string(item.get("detail"))
        if detail:
            normalized_item["detail"] = detail
        priority = _as_string(item.get("priority"))
        if priority in {"high", "medium", "low"}:
            normalized_item["priority"] = priority
        normalized_items.append(normalized_item)

    if not normalized_items:
        return None

    return {"items": normalized_items}


def _normalize_success_content(content: Any) -> dict[str, Any] | None:
    if not isinstance(content, dict):
        return None

    body = _as_string(content.get("body"))
    headline = _as_string(content.get("headline"))
    amount = _as_string(content.get("amount"))
    detail = _as_string(content.get("detail"))

    if not any((body, headline, amount, detail)):
        return None

    normalized: dict[str, Any] = {}
    if body:
        normalized["body"] = body
    if headline:
        normalized["headline"] = headline
    if amount:
        normalized["amount"] = amount
    if detail:
        normalized["detail"] = detail

    if "body" not in normalized:
        composed_parts = [part for part in (headline, detail) if part]
        if amount:
            composed_parts.insert(0, amount)
        normalized["body"] = "\n\n".join(composed_parts)

    return normalized


def _normalize_comparison_highlight(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None

    label = _as_string(value.get("label"))
    raw_values = value.get("values")
    if not label or not isinstance(raw_values, list):
        return None

    normalized_values: list[dict[str, Any]] = []
    for row in raw_values:
        if not isinstance(row, dict):
            continue
        deal_id = _as_string(row.get("deal_id")) or _as_string(row.get("dealId"))
        display_value = _as_string(row.get("value"))
        if not deal_id or not display_value:
            continue
        normalized_values.append(
            {
                "deal_id": deal_id,
                "value": display_value,
                "is_winner": bool(row.get("is_winner", row.get("isWinner", False))),
            }
        )

    if not normalized_values:
        return None

    normalized: dict[str, Any] = {
        "label": label,
        "values": normalized_values,
    }
    note = _as_string(value.get("note"))
    if note:
        normalized["note"] = note
    return normalized


def _normalize_comparison_content(content: Any) -> dict[str, Any] | None:
    if not isinstance(content, dict):
        return None

    summary = _as_string(content.get("summary"))
    recommendation = _as_string(content.get("recommendation"))
    best_deal_id = _as_string(content.get("best_deal_id")) or _as_string(
        content.get("bestDealId")
    )
    raw_highlights = content.get("highlights")

    if not isinstance(raw_highlights, list):
        return None

    highlights = [
        normalized_highlight
        for item in raw_highlights
        if (normalized_highlight := _normalize_comparison_highlight(item)) is not None
    ]
    if not highlights:
        return None

    normalized: dict[str, Any] = {"highlights": highlights}
    if summary:
        normalized["summary"] = summary
    if recommendation:
        normalized["recommendation"] = recommendation
    if best_deal_id:
        normalized["best_deal_id"] = best_deal_id
    return normalized


def _normalize_vehicle_content(content: Any) -> dict[str, Any] | None:
    if not isinstance(content, dict):
        return None

    vehicle = content.get("vehicle")
    if not isinstance(vehicle, dict):
        return None

    make = _as_string(vehicle.get("make"))
    model = _as_string(vehicle.get("model"))
    if not make or not model:
        return None

    normalized_vehicle: dict[str, Any] = {
        "make": make,
        "model": model,
    }

    year = vehicle.get("year")
    if isinstance(year, int):
        normalized_vehicle["year"] = year

    for key in ("trim", "cab_style", "bed_length", "engine", "color", "vin", "role"):
        value = _as_string(vehicle.get(key))
        if value:
            normalized_vehicle[key] = value

    mileage = vehicle.get("mileage")
    if isinstance(mileage, int):
        normalized_vehicle["mileage"] = mileage

    normalized: dict[str, Any] = {"vehicle": normalized_vehicle}
    risk_flags = _normalize_string_list(content.get("risk_flags"), max_items=5)
    if risk_flags:
        normalized["risk_flags"] = risk_flags
    return normalized


def normalize_panel_card(raw_card: Any) -> dict[str, Any] | None:
    if not isinstance(raw_card, dict):
        return None

    kind_value = _as_string(raw_card.get("kind"))
    if not kind_value:
        legacy_template = _as_string(raw_card.get("template")) or _as_string(
            raw_card.get("type")
        )
        if legacy_template in {
            AiCardTemplate.VEHICLE.value,
            AiCardTemplate.NUMBERS.value,
            AiCardTemplate.WARNING.value,
            AiCardTemplate.NOTES.value,
            AiCardTemplate.CHECKLIST.value,
            AiCardTemplate.COMPARISON.value,
            AiCardTemplate.SUCCESS.value,
        }:
            kind_value = legacy_template

    if kind_value not in VALID_PANEL_CARD_KINDS:
        return None

    spec = PANEL_CARD_SPECS[AiCardKind(kind_value)]
    raw_content = raw_card.get("content")

    if spec.kind in {
        AiCardKind.NUMBERS,
        AiCardKind.WHAT_CHANGED,
    }:
        content = _normalize_numbers_content(raw_content)
    elif spec.kind in {
        AiCardKind.DEALER_READ,
        AiCardKind.YOUR_LEVERAGE,
        AiCardKind.NEXT_BEST_MOVE,
    }:
        content = _normalize_body_content(raw_content)
    elif spec.kind in {
        AiCardKind.WARNING,
        AiCardKind.IF_YOU_SAY_YES,
    }:
        content = _normalize_warning_content(raw_content)
    elif spec.kind == AiCardKind.NOTES:
        content = _normalize_notes_content(raw_content)
    elif spec.kind in {
        AiCardKind.CHECKLIST,
        AiCardKind.WHAT_STILL_NEEDS_CONFIRMING,
    }:
        content = _normalize_checklist_content(raw_content)
    elif spec.kind in {
        AiCardKind.SUCCESS,
        AiCardKind.SAVINGS_SO_FAR,
    }:
        content = _normalize_success_content(raw_content)
    elif spec.kind in {
        AiCardKind.COMPARISON,
        AiCardKind.TRADE_OFF,
    }:
        content = _normalize_comparison_content(raw_content)
    elif spec.kind == AiCardKind.VEHICLE:
        content = _normalize_vehicle_content(raw_content)
    elif spec.kind == AiCardKind.PHASE:
        content = _normalize_phase_content(raw_content)
    else:
        content = None

    if content is None:
        return None

    priority_value = _as_string(raw_card.get("priority"))
    if priority_value not in VALID_PANEL_CARD_PRIORITIES:
        priority_value = AiCardPriority.NORMAL.value

    return {
        "kind": spec.kind.value,
        "template": spec.template.value,
        "title": spec.title,
        "content": content,
        "priority": priority_value,
    }


def _panel_card_dedupe_rank(card: dict[str, Any], index: int) -> tuple[int, int, int]:
    priority = _as_string(card.get("priority"))
    priority_rank = (
        PANEL_CARD_PRIORITY_ORDER[priority]
        if priority in PANEL_CARD_PRIORITY_ORDER
        else PANEL_CARD_PRIORITY_ORDER[AiCardPriority.NORMAL.value]
    )

    severity_rank = 1
    if card.get("kind") in {
        AiCardKind.WARNING.value,
        AiCardKind.IF_YOU_SAY_YES.value,
    }:
        severity_rank = (
            0 if card.get("content", {}).get("severity") == "critical" else 1
        )

    return priority_rank, severity_rank, index


def _panel_card_dedupe_identity(card: dict[str, Any]) -> str | None:
    kind = _as_string(card.get("kind"))
    if kind not in VALID_PANEL_CARD_KINDS:
        return None

    if kind == AiCardKind.VEHICLE.value:
        content = card.get("content")
        vehicle = content.get("vehicle") if isinstance(content, dict) else None
        if isinstance(vehicle, dict):
            vin = _as_string(vehicle.get("vin"))
            if vin:
                return f"{kind}:{vin}"

            role = _as_string(vehicle.get("role"))
            make = _as_string(vehicle.get("make"))
            model = _as_string(vehicle.get("model"))
            year = vehicle.get("year")
            if role or make or model or isinstance(year, int):
                mileage_key = ""
                raw_mileage = vehicle.get("mileage")
                if isinstance(raw_mileage, (int, float)):
                    mileage_key = str(int(raw_mileage))
                color = _as_string(vehicle.get("color"))
                return (
                    f"{kind}:{role or ''}:{year or ''}:{make or ''}:{model or ''}:"
                    f"{mileage_key}:{color or ''}"
                )

    return kind


def _per_kind_instance_cap(kind: str | None) -> int:
    if not kind:
        return DEFAULT_PANEL_KIND_MAX_INSTANCES
    return PANEL_KIND_MAX_INSTANCES.get(kind, DEFAULT_PANEL_KIND_MAX_INSTANCES)


def canonicalize_panel_cards(cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Deduplicate by identity, sort by kind/priority, then apply per-kind instance caps."""
    if not cards:
        return []

    best_by_identity: dict[str, tuple[tuple[int, int, int], int, dict[str, Any]]] = {}
    for index, card in enumerate(cards):
        dedupe_identity = _panel_card_dedupe_identity(card)
        if dedupe_identity is None:
            continue

        rank = _panel_card_dedupe_rank(card, index)
        existing = best_by_identity.get(dedupe_identity)
        if existing is None or rank < existing[0]:
            best_by_identity[dedupe_identity] = (rank, index, card)

    canonical_cards = [entry[2] for entry in best_by_identity.values()]
    canonical_cards.sort(
        key=lambda card: (
            PANEL_CARD_KIND_ORDER.get(card["kind"], len(PANEL_CARD_KIND_ORDER)),
            (
                PANEL_CARD_PRIORITY_ORDER[priority]
                if (priority := _as_string(card.get("priority")))
                in PANEL_CARD_PRIORITY_ORDER
                else PANEL_CARD_PRIORITY_ORDER[AiCardPriority.NORMAL.value]
            ),
        )
    )

    kind_counts: dict[str, int] = {}
    capped: list[dict[str, Any]] = []
    for card in canonical_cards:
        kind = _as_string(card.get("kind"))
        limit = _per_kind_instance_cap(kind)
        used = kind_counts.get(kind or "", 0)
        if used >= limit:
            continue
        kind_counts[kind or ""] = used + 1
        capped.append(card)
    return capped


def sanitize_panel_cards(raw_cards: Any) -> list[dict[str, Any]]:
    """Normalize persisted cards into the authoritative backend contract."""
    if not isinstance(raw_cards, list):
        return []

    normalized_cards = [
        normalized_card
        for raw_card in raw_cards
        if (normalized_card := normalize_panel_card(raw_card)) is not None
    ]
    return canonicalize_panel_cards(normalized_cards)
