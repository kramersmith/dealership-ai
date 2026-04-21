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


def test_normalize_panel_card_checklist_open_questions_only() -> None:
    normalized = normalize_panel_card(
        {
            "kind": "checklist",
            "content": {
                "open_questions": [
                    {"label": "  Cab style  ", "priority": "high"},
                ],
            },
            "priority": "normal",
        }
    )
    assert normalized is not None
    assert normalized["content"] == {
        "open_questions": [{"label": "Cab style", "priority": "high"}],
    }


def test_normalize_panel_card_checklist_merged_open_questions_and_items() -> None:
    normalized = normalize_panel_card(
        {
            "kind": "checklist",
            "content": {
                "open_questions": [{"label": "Lien docs"}],
                "items": [{"label": "OTD in writing", "done": True}],
            },
            "priority": "normal",
        }
    )
    assert normalized is not None
    assert normalized["content"]["open_questions"] == [{"label": "Lien docs"}]
    assert normalized["content"]["items"] == [{"label": "OTD in writing", "done": True}]


def test_canonicalize_merges_two_checklist_cards_after_migration() -> None:
    cards = [
        {
            "kind": "checklist",
            "template": "checklist",
            "title": "Checklist",
            "priority": "normal",
            "content": {
                "open_questions": [{"label": "Lien proof"}],
                "items": [{"label": "Get OTD in writing", "done": False}],
            },
        },
        {
            "kind": "checklist",
            "template": "checklist",
            "title": "Checklist",
            "priority": "high",
            "content": {
                "open_questions": [{"label": "Cab style"}],
                "items": [{"label": "Get OTD in writing", "done": True}],
            },
        },
    ]
    canonical = canonicalize_panel_cards(cards)
    assert len(canonical) == 1
    assert canonical[0]["kind"] == "checklist"
    assert canonical[0]["priority"] == "high"
    body = canonical[0]["content"]
    assert [r["label"] for r in body["open_questions"]] == ["Lien proof", "Cab style"]
    # First card wins duplicate playbook rows (same label).
    assert body["items"] == [{"label": "Get OTD in writing", "done": False}]


def test_canonicalize_merges_checklist_cards_case_insensitive_dedupe() -> None:
    """Duplicate labels across two checklist cards should dedupe case-insensitively,
    both within `items` and between `open_questions` and `items` (playbook wins)."""
    cards = [
        {
            "kind": "checklist",
            "template": "checklist",
            "title": "Checklist",
            "priority": "normal",
            "content": {
                "open_questions": [{"label": "Lien proof"}],
                "items": [{"label": "Get OTD in writing", "done": False}],
            },
        },
        {
            "kind": "checklist",
            "template": "checklist",
            "title": "Checklist",
            "priority": "normal",
            "content": {
                # Same label as first card's playbook, but cased differently — should be dropped.
                "open_questions": [
                    {"label": "GET OTD IN WRITING"},
                    {"label": "Cab style"},
                ],
                # Playbook duplicate with different casing — first card wins.
                "items": [{"label": "GET OTD IN WRITING", "done": True}],
            },
        },
    ]
    canonical = canonicalize_panel_cards(cards)
    assert len(canonical) == 1
    body = canonical[0]["content"]
    assert body["items"] == [{"label": "Get OTD in writing", "done": False}]
    # "GET OTD IN WRITING" open-question dropped because playbook covers it (case-insensitive).
    assert [r["label"] for r in body["open_questions"]] == ["Lien proof", "Cab style"]


def test_canonicalize_merges_checklist_cards_when_one_has_empty_content() -> None:
    """A checklist card with empty/invalid content should still be collapsed with a populated one
    without dropping the populated content or raising."""
    cards = [
        {
            "kind": "checklist",
            "template": "checklist",
            "title": "Checklist",
            "priority": "normal",
            "content": {},
        },
        {
            "kind": "checklist",
            "template": "checklist",
            "title": "Checklist",
            "priority": "high",
            "content": {
                "items": [{"label": "Confirm OTD", "done": False}],
            },
        },
    ]
    canonical = canonicalize_panel_cards(cards)
    assert len(canonical) == 1
    assert canonical[0]["priority"] == "high"
    assert canonical[0]["content"]["items"] == [{"label": "Confirm OTD", "done": False}]
    assert "open_questions" not in canonical[0]["content"]


def test_normalize_panel_card_checklist_neither_field_returns_none() -> None:
    normalized = normalize_panel_card(
        {
            "kind": "checklist",
            "content": {},
            "priority": "normal",
        }
    )
    assert normalized is None


def test_normalize_panel_card_checklist_invalid_types_return_none() -> None:
    # `items` and `open_questions` are not lists → treated as empty → no valid content → None.
    normalized = normalize_panel_card(
        {
            "kind": "checklist",
            "content": {"items": "not-a-list", "open_questions": 42},
            "priority": "normal",
        }
    )
    assert normalized is None


def test_normalize_panel_card_rejects_retired_what_still_needs_confirming_kind() -> (
    None
):
    """Historic panels persisted before ADR 0026's checklist merge had
    `kind: "what_still_needs_confirming"`. That kind is no longer valid, so
    re-normalization drops the card (acceptable for pre-production — persisted
    panels on `Message.panel_cards` are served as-is and not re-normalized on read)."""
    normalized = normalize_panel_card(
        {
            "kind": "what_still_needs_confirming",
            "template": "checklist",
            "title": "What Still Needs Confirming",
            "content": {"items": [{"label": "Confirm doc fee", "done": False}]},
            "priority": "normal",
        }
    )
    assert normalized is None
