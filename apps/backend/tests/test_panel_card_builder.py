"""Unit tests for the pure-render panel card builder."""

from __future__ import annotations

from app.models.enums import (
    AiCardKind,
    AiCardPriority,
    DealPhase,
    NegotiationStance,
    RedFlagSeverity,
    VehicleRole,
)
from app.services.panel_card_builder import build_rendered_panel_cards


def _deal_state(**overrides):
    """Return a minimal valid deal_state_dict; caller overrides targeted fields."""
    base = {
        "buyer_context": "reviewing_deal",
        "active_deal_id": "deal-1",
        "vehicles": [],
        "deals": [],
        "session_red_flags": [],
        "session_information_gaps": [],
        "checklist": [],
        "negotiation_context": None,
    }
    base.update(overrides)
    return base


def _kinds(cards):
    return [card["kind"] for card in cards]


# ─── empty state ───


def test_empty_deal_state_returns_no_cards():
    assert build_rendered_panel_cards(_deal_state()) == []


# ─── phase card ───


def test_phase_card_from_negotiation_context():
    cards = build_rendered_panel_cards(
        _deal_state(
            negotiation_context={
                "stance": NegotiationStance.NEGOTIATING.value,
                "situation": "Dealer just countered at $45k with a $2k doc fee.",
                "leverage": [],
            }
        )
    )
    phase_cards = [card for card in cards if card["kind"] == AiCardKind.PHASE.value]
    assert len(phase_cards) == 1
    assert phase_cards[0]["content"]["stance"] == NegotiationStance.NEGOTIATING.value
    assert "countered" in phase_cards[0]["content"]["situation"]


def test_phase_card_skipped_when_missing_stance_or_situation():
    cards = build_rendered_panel_cards(
        _deal_state(negotiation_context={"stance": "", "situation": ""})
    )
    assert AiCardKind.PHASE.value not in _kinds(cards)


# ─── warning cards ───


def test_warning_cards_emit_one_per_flag_with_severity_priority():
    deal = {
        "id": "deal-1",
        "numbers": {},
        "scorecard": {},
        "health": {},
        "red_flags": [
            {
                "id": "rf1",
                "severity": RedFlagSeverity.CRITICAL.value,
                "message": "Title branded salvage",
            },
            {
                "id": "rf2",
                "severity": RedFlagSeverity.WARNING.value,
                "message": "Doc fee $1,995 is high",
            },
        ],
        "information_gaps": [],
    }
    cards = build_rendered_panel_cards(_deal_state(deals=[deal]))
    warnings = [card for card in cards if card["kind"] == AiCardKind.WARNING.value]
    assert len(warnings) == 2
    # Critical one gets CRITICAL priority; warning one gets HIGH.
    priorities = {card["content"]["severity"]: card["priority"] for card in warnings}
    assert priorities["critical"] == AiCardPriority.CRITICAL.value
    assert priorities["warning"] == AiCardPriority.HIGH.value


def test_session_red_flags_also_render():
    cards = build_rendered_panel_cards(
        _deal_state(
            session_red_flags=[
                {
                    "id": "srf1",
                    "severity": "critical",
                    "message": "Identity doc mismatch",
                },
            ],
        )
    )
    warnings = [card for card in cards if card["kind"] == AiCardKind.WARNING.value]
    assert len(warnings) == 1
    assert warnings[0]["content"]["message"] == "Identity doc mismatch"


# ─── numbers card ───


def test_numbers_card_includes_populated_fields_in_order_with_highlight():
    deal = {
        "id": "deal-1",
        "phase": DealPhase.NEGOTIATION.value,
        "numbers": {
            "msrp": 58900.0,
            "listing_price": None,
            "current_offer": 62500.0,
            "your_target": 57000.0,
            "walk_away_price": None,
            "trade_in_value": 21000.0,
            "down_payment": None,
            "monthly_payment": 899.0,
            "apr": 6.25,
            "loan_term_months": 72,
            "invoice_price": None,
        },
        "scorecard": {"price": "red", "financing": "yellow", "trade_in": "green"},
        "health": {},
        "red_flags": [],
        "information_gaps": [],
        "offer_history": {"first_offer": None, "pre_fi_price": None},
    }
    cards = build_rendered_panel_cards(_deal_state(deals=[deal]))
    numbers_cards = [card for card in cards if card["kind"] == AiCardKind.NUMBERS.value]
    assert len(numbers_cards) == 1
    rows = numbers_cards[0]["content"]["rows"]
    field_order = [row["field"] for row in rows]
    # Only non-null fields in display order.
    assert field_order == [
        "msrp",
        "current_offer",
        "your_target",
        "trade_in_value",
        "monthly_payment",
        "apr",
        "loan_term_months",
    ]
    by_field = {row["field"]: row for row in rows}
    assert by_field["current_offer"]["value"] == "$62,500"
    assert by_field["current_offer"]["highlight"] == "bad"  # scorecard.price == red
    assert by_field["trade_in_value"]["highlight"] == "good"
    assert by_field["monthly_payment"]["highlight"] == "neutral"
    assert by_field["apr"]["value"] == "6.25%"
    assert by_field["loan_term_months"]["value"] == "72 mo"
    # Priority HIGH in negotiation phase.
    assert numbers_cards[0]["priority"] == AiCardPriority.HIGH.value


def test_numbers_card_appends_custom_numbers_after_core_rows():
    """Custom rows from update_deal_custom_numbers render alongside typed fields."""
    deal = {
        "id": "deal-1",
        "phase": DealPhase.NEGOTIATION.value,
        "numbers": {
            "msrp": 58900.0,
            "current_offer": 62500.0,
            "listing_price": None,
            "your_target": None,
            "walk_away_price": None,
            "trade_in_value": None,
            "down_payment": None,
            "monthly_payment": None,
            "apr": None,
            "loan_term_months": None,
            "invoice_price": None,
        },
        "scorecard": {},
        "health": {},
        "red_flags": [],
        "information_gaps": [],
        "offer_history": {"first_offer": None, "pre_fi_price": None},
        "custom_numbers": [
            {"label": "Doc fee", "value": "$899", "highlight": "neutral"},
            {"label": "Dealer prep fee", "value": "$1,995", "highlight": "bad"},
        ],
    }
    cards = build_rendered_panel_cards(_deal_state(deals=[deal]))
    numbers_cards = [card for card in cards if card["kind"] == AiCardKind.NUMBERS.value]
    assert len(numbers_cards) == 1
    rows = numbers_cards[0]["content"]["rows"]
    labels = [row["label"] for row in rows]
    # Core rows first, extras after, in order.
    assert labels == ["MSRP", "Current offer", "Doc fee", "Dealer prep fee"]
    prep = next(row for row in rows if row["label"] == "Dealer prep fee")
    assert prep["value"] == "$1,995"
    assert prep["highlight"] == "bad"
    # Extra rows don't have a `field` key (core-only).
    assert "field" not in prep


def test_custom_numbers_reject_malformed_rows():
    """Rows missing label or value (or with non-string types) are dropped silently."""
    deal = {
        "id": "deal-1",
        "phase": DealPhase.NEGOTIATION.value,
        "numbers": {"current_offer": 40000.0},
        "scorecard": {},
        "health": {},
        "red_flags": [],
        "information_gaps": [],
        "offer_history": {"first_offer": None, "pre_fi_price": None},
        "custom_numbers": [
            {"label": "Doc fee", "value": "$899"},  # keep
            {"label": "", "value": "$1,000"},  # drop — empty label
            {"label": "Bad row", "value": None},  # drop — non-string value
            {
                "label": "Invalid highlight",
                "value": "$500",
                "highlight": "purple",
            },  # keep, drop highlight
        ],
    }
    cards = build_rendered_panel_cards(_deal_state(deals=[deal]))
    numbers = next(card for card in cards if card["kind"] == AiCardKind.NUMBERS.value)
    labels = [row["label"] for row in numbers["content"]["rows"]]
    assert "Doc fee" in labels
    assert "Invalid highlight" in labels
    assert "Bad row" not in labels
    invalid = next(
        row for row in numbers["content"]["rows"] if row["label"] == "Invalid highlight"
    )
    assert "highlight" not in invalid


def test_numbers_card_skipped_when_all_fields_null():
    deal = {
        "id": "deal-1",
        "phase": DealPhase.RESEARCH.value,
        "numbers": {
            field: None
            for field in (
                "msrp",
                "listing_price",
                "current_offer",
                "your_target",
                "walk_away_price",
                "trade_in_value",
                "down_payment",
                "monthly_payment",
                "apr",
                "loan_term_months",
                "invoice_price",
                "invoice_price",
            )
        },
        "scorecard": {},
        "health": {},
        "red_flags": [],
        "information_gaps": [],
        "offer_history": {"first_offer": None, "pre_fi_price": None},
    }
    cards = build_rendered_panel_cards(_deal_state(deals=[deal]))
    assert AiCardKind.NUMBERS.value not in _kinds(cards)


# ─── your_leverage ───


def test_leverage_card_renders_bullets_from_negotiation_context():
    cards = build_rendered_panel_cards(
        _deal_state(
            negotiation_context={
                "stance": NegotiationStance.NEGOTIATING.value,
                "situation": "Comparing dealer prices.",
                "leverage": [
                    "Pre-approved financing",
                    "Walk-away alternative at competing dealer",
                ],
            }
        )
    )
    leverage = [
        card for card in cards if card["kind"] == AiCardKind.YOUR_LEVERAGE.value
    ]
    assert len(leverage) == 1
    content = leverage[0]["content"]
    assert content["body"] == "Pre-approved financing"
    assert content["bullets"] == ["Walk-away alternative at competing dealer"]


def test_leverage_card_skipped_when_empty_list():
    cards = build_rendered_panel_cards(
        _deal_state(
            negotiation_context={
                "stance": NegotiationStance.RESEARCHING.value,
                "situation": "Just looking.",
                "leverage": [],
            }
        )
    )
    assert AiCardKind.YOUR_LEVERAGE.value not in _kinds(cards)


# ─── notes card ───


def test_notes_card_holds_only_durable_known_facts():
    """Notes must be KNOWN durable facts; unknowns belong in what_still_needs_confirming."""
    deal = {
        "id": "deal-1",
        "dealer_name": "Sunrise Ford",
        "phase": DealPhase.NEGOTIATION.value,
        "numbers": {"current_offer": 62500.0},
        "scorecard": {},
        "health": {},
        "red_flags": [],
        "information_gaps": [
            # High-priority unknowns must NOT flow into notes — they're gaps, not facts.
            {"label": "Verify payoff amount", "reason": "", "priority": "high"},
        ],
        "offer_history": {"first_offer": 64500.0, "pre_fi_price": 63000.0},
    }
    cards = build_rendered_panel_cards(_deal_state(deals=[deal]))
    notes = [card for card in cards if card["kind"] == AiCardKind.NOTES.value]
    assert len(notes) == 1
    items = notes[0]["content"]["items"]
    assert items == [
        "Dealer: Sunrise Ford",
        "First offer: $64,500",
        "Pre-F&I price: $63,000",
    ]
    # Gap label must not appear in notes.
    assert "Verify payoff amount" not in items


def test_first_offer_note_suppressed_when_no_movement():
    deal = {
        "id": "deal-1",
        "phase": DealPhase.NEGOTIATION.value,
        "numbers": {"current_offer": 62500.0},
        "scorecard": {},
        "health": {},
        "red_flags": [],
        "information_gaps": [],
        "offer_history": {"first_offer": 62500.0, "pre_fi_price": None},
    }
    cards = build_rendered_panel_cards(_deal_state(deals=[deal]))
    notes = [card for card in cards if card["kind"] == AiCardKind.NOTES.value]
    assert notes == []


# ─── vehicle cards ───


def test_vehicle_cards_emit_one_per_shopping_vehicle_with_risk_flags():
    vehicles = [
        {
            "id": "v-candidate-old",
            "role": VehicleRole.CANDIDATE.value,
            "year": 2015,
            "make": "Ford",
            "model": "F-250",
            "trim": "Platinum",
            "mileage": 180000,
            "color": "White",
            "vin": "1FT8W3DT0FEC12345",
        },
        {
            "id": "v-primary-new",
            "role": VehicleRole.PRIMARY.value,
            "year": 2024,
            "make": "Ford",
            "model": "F-250",
            "mileage": 8000,
            "vin": "1FT8W3DT8NEE99999",
        },
    ]
    cards = build_rendered_panel_cards(_deal_state(vehicles=vehicles))
    vehicle_cards = [card for card in cards if card["kind"] == AiCardKind.VEHICLE.value]
    assert len(vehicle_cards) == 2
    by_vin = {card["content"]["vehicle"]["vin"]: card for card in vehicle_cards}
    old = by_vin["1FT8W3DT0FEC12345"]
    assert "risk_flags" in old["content"]
    assert any("High mileage" in flag for flag in old["content"]["risk_flags"])
    new = by_vin["1FT8W3DT8NEE99999"]
    assert "risk_flags" not in new["content"]


def test_trade_in_vehicle_also_renders():
    vehicles = [
        {
            "id": "v-ti",
            "role": VehicleRole.TRADE_IN.value,
            "year": 2018,
            "make": "Chevrolet",
            "model": "Silverado 1500",
            "mileage": 85000,
        },
    ]
    cards = build_rendered_panel_cards(_deal_state(vehicles=vehicles))
    assert (
        len([card for card in cards if card["kind"] == AiCardKind.VEHICLE.value]) == 1
    )


# ─── what_still_needs_confirming ───


def test_confirming_card_includes_deal_and_session_gaps_deduped():
    deal = {
        "id": "deal-1",
        "phase": DealPhase.NEGOTIATION.value,
        "numbers": {},
        "scorecard": {},
        "health": {},
        "red_flags": [],
        "information_gaps": [
            {
                "label": "Confirm doc fee is not itemized",
                "reason": "",
                "priority": "high",
            },
        ],
        "offer_history": {"first_offer": None, "pre_fi_price": None},
    }
    cards = build_rendered_panel_cards(
        _deal_state(
            deals=[deal],
            session_information_gaps=[
                {
                    "label": "Confirm doc fee is not itemized",
                    "reason": "",
                    "priority": "high",
                },  # duplicate
                {
                    "label": "Confirm pre-approval terms",
                    "reason": "",
                    "priority": "medium",
                },
            ],
        )
    )
    confirming = [
        card
        for card in cards
        if card["kind"] == AiCardKind.WHAT_STILL_NEEDS_CONFIRMING.value
    ]
    assert len(confirming) == 1
    labels = [item["label"] for item in confirming[0]["content"]["items"]]
    assert labels == [
        "Confirm doc fee is not itemized",
        "Confirm pre-approval terms",
    ]  # deduped


# ─── checklist ───


def test_checklist_card_pass_through_with_done_state():
    cards = build_rendered_panel_cards(
        _deal_state(
            checklist=[
                {"label": "Pull VIN history", "done": True},
                {"label": "Verify warranty coverage", "done": False},
            ]
        )
    )
    checklist = [card for card in cards if card["kind"] == AiCardKind.CHECKLIST.value]
    assert len(checklist) == 1
    items = checklist[0]["content"]["items"]
    assert items == [
        {"label": "Pull VIN history", "done": True},
        {"label": "Verify warranty coverage", "done": False},
    ]


# ─── savings_so_far ───


def test_savings_card_only_when_concession_is_meaningful():
    deal = {
        "id": "deal-1",
        "phase": DealPhase.NEGOTIATION.value,
        "numbers": {"current_offer": 62500.0},
        "scorecard": {},
        "health": {},
        "red_flags": [],
        "information_gaps": [],
        "offer_history": {"first_offer": 64500.0, "pre_fi_price": None},
    }
    cards = build_rendered_panel_cards(_deal_state(deals=[deal]))
    savings = [
        card for card in cards if card["kind"] == AiCardKind.SAVINGS_SO_FAR.value
    ]
    assert len(savings) == 1
    assert "$2,000" in savings[0]["content"]["headline"]
    assert "$64,500" in savings[0]["content"]["body"]
    assert "$62,500" in savings[0]["content"]["body"]


def test_savings_card_suppressed_when_delta_under_threshold():
    deal = {
        "id": "deal-1",
        "phase": DealPhase.NEGOTIATION.value,
        "numbers": {"current_offer": 62500.0},
        "scorecard": {},
        "health": {},
        "red_flags": [],
        "information_gaps": [],
        "offer_history": {"first_offer": 62550.0, "pre_fi_price": None},
    }
    cards = build_rendered_panel_cards(_deal_state(deals=[deal]))
    assert AiCardKind.SAVINGS_SO_FAR.value not in _kinds(cards)


# ─── active-deal selection ───


def test_non_active_deal_is_ignored_for_active_deal_cards():
    active = {
        "id": "deal-active",
        "phase": DealPhase.NEGOTIATION.value,
        "numbers": {"current_offer": 40000.0},
        "scorecard": {"price": "green"},
        "health": {},
        "red_flags": [],
        "information_gaps": [],
        "offer_history": {"first_offer": 42000.0, "pre_fi_price": None},
    }
    stale = {
        "id": "deal-stale",
        "phase": DealPhase.NEGOTIATION.value,
        "numbers": {"current_offer": 99999.0},
        "scorecard": {"price": "red"},
        "health": {},
        "red_flags": [
            {"id": "rf-stale", "severity": "critical", "message": "Stale deal flag"},
        ],
        "information_gaps": [],
        "offer_history": {"first_offer": None, "pre_fi_price": None},
    }
    cards = build_rendered_panel_cards(
        _deal_state(active_deal_id="deal-active", deals=[active, stale])
    )
    # Numbers card should reflect active deal, not stale.
    numbers = [card for card in cards if card["kind"] == AiCardKind.NUMBERS.value]
    assert numbers[0]["content"]["rows"][0]["value"] == "$40,000"
    # Warnings come only from active deal + session; stale deal flag is ignored.
    warnings = [card for card in cards if card["kind"] == AiCardKind.WARNING.value]
    assert all(card["content"]["message"] != "Stale deal flag" for card in warnings)
