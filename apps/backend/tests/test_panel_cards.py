from app.services.panel_cards import (
    PANEL_KIND_MAX_INSTANCES,
    canonicalize_panel_cards,
    normalize_panel_card,
)


def test_canonicalize_panel_cards_preserves_multiple_vehicle_cards() -> None:
    cards = [
        {
            "kind": "numbers",
            "template": "numbers",
            "title": "Numbers",
            "priority": "normal",
            "content": {"rows": [{"label": "MSRP", "value": "$51,680"}]},
        },
        {
            "kind": "vehicle",
            "template": "vehicle",
            "title": "Vehicle",
            "priority": "normal",
            "content": {
                "vehicle": {
                    "year": 2026,
                    "make": "FORD",
                    "model": "F-250",
                    "vin": "1FTBF2BA4TEC99136",
                    "role": "primary",
                }
            },
        },
        {
            "kind": "vehicle",
            "template": "vehicle",
            "title": "Vehicle",
            "priority": "normal",
            "content": {
                "vehicle": {
                    "year": 2026,
                    "make": "FORD",
                    "model": "F-250",
                    "vin": "1FTBF2AT3TED05981",
                    "role": "candidate",
                }
            },
        },
    ]

    canonical = canonicalize_panel_cards(cards)

    assert [card["kind"] for card in canonical] == ["numbers", "vehicle", "vehicle"]
    assert [
        card["content"]["vehicle"]["vin"]
        for card in canonical
        if card["kind"] == "vehicle"
    ] == [
        "1FTBF2BA4TEC99136",
        "1FTBF2AT3TED05981",
    ]


def test_canonicalize_panel_cards_no_global_cap_full_strip_plus_two_vehicles() -> None:
    """No total-card slice: phase/warning/numbers/etc. plus two vehicles all fit."""
    cards = [
        {
            "kind": "phase",
            "template": "briefing",
            "title": "Status",
            "priority": "normal",
            "content": {"stance": "preparing", "situation": "Comparing two trucks."},
        },
        {
            "kind": "warning",
            "template": "warning",
            "title": "Warning",
            "priority": "high",
            "content": {"severity": "warning", "message": "Open recalls"},
        },
        {
            "kind": "numbers",
            "template": "numbers",
            "title": "Numbers",
            "priority": "normal",
            "content": {"rows": [{"label": "Listing", "value": "$34,000"}]},
        },
        {
            "kind": "your_leverage",
            "template": "tip",
            "title": "Leverage",
            "priority": "normal",
            "content": {"body": "Use CARFAX value."},
        },
        {
            "kind": "notes",
            "template": "notes",
            "title": "Notes",
            "priority": "low",
            "content": {"items": ["Texas truck"]},
        },
        {
            "kind": "checklist",
            "template": "checklist",
            "title": "Checklist",
            "priority": "normal",
            "content": {"items": [{"label": "PPI", "done": False}]},
        },
        {
            "kind": "vehicle",
            "template": "vehicle",
            "title": "Vehicle",
            "priority": "normal",
            "content": {
                "vehicle": {
                    "year": 2022,
                    "make": "Ford",
                    "model": "F-250",
                    "mileage": 175000,
                    "color": "Black",
                    "role": "primary",
                }
            },
        },
        {
            "kind": "vehicle",
            "template": "vehicle",
            "title": "Vehicle",
            "priority": "normal",
            "content": {
                "vehicle": {
                    "year": 2021,
                    "make": "Ford",
                    "model": "F-250",
                    "mileage": 141786,
                    "color": "Red",
                    "role": "candidate",
                }
            },
        },
    ]

    canonical = canonicalize_panel_cards(cards)
    assert len(canonical) == 8
    assert len([card for card in canonical if card["kind"] == "vehicle"]) == 2


def test_canonicalize_panel_cards_per_kind_cap_on_vehicle() -> None:
    """At most PANEL_KIND_MAX_INSTANCES['vehicle'] distinct vehicle cards."""
    limit = PANEL_KIND_MAX_INSTANCES["vehicle"]
    cards = [
        {
            "kind": "vehicle",
            "template": "vehicle",
            "title": "Vehicle",
            "priority": "normal",
            "content": {
                "vehicle": {
                    "year": 2020,
                    "make": "Ford",
                    "model": "F-250",
                    "vin": f"1FTBX{i:02d}TESTVIN99",
                    "role": "candidate",
                }
            },
        }
        for i in range(limit + 2)
    ]
    canonical = canonicalize_panel_cards(cards)
    assert len([card for card in canonical if card["kind"] == "vehicle"]) == limit


def test_normalize_panel_card_phase_requires_situation() -> None:
    assert (
        normalize_panel_card(
            {"kind": "phase", "content": {"stance": "preparing"}, "priority": "normal"}
        )
        is None
    )

    normalized = normalize_panel_card(
        {
            "kind": "phase",
            "content": {
                "stance": "preparing",
                "situation": "Buyer going to dealership tomorrow for a test drive.",
            },
            "priority": "normal",
        }
    )
    assert normalized is not None
    assert normalized["kind"] == "phase"
    assert normalized["content"] == {
        "stance": "preparing",
        "situation": "Buyer going to dealership tomorrow for a test drive.",
    }


def test_normalize_panel_card_phase_invalid_stance_defaults_to_researching() -> None:
    normalized = normalize_panel_card(
        {
            "kind": "phase",
            "content": {"stance": "not_a_stance", "situation": "Still at the desk."},
            "priority": "high",
        }
    )
    assert normalized is not None
    assert normalized["content"]["stance"] == "researching"
    assert normalized["content"]["situation"] == "Still at the desk."
