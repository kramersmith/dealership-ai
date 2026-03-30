"""Tests for the split extraction subagents and merge logic."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.services.claude import merge_extraction_results

# ─── merge_extraction_results ───


def test_merge_empty_inputs():
    """Empty facts and analysis produce empty result."""
    assert merge_extraction_results({}, {}) == {}


def test_merge_facts_only():
    """Factual data is included when analysis is empty."""
    facts = {
        "vehicle": {"make": "Ford", "model": "F-250", "role": "primary"},
        "numbers": {"listing_price": 34000, "current_offer": 33500},
        "phase": "negotiation",
    }
    result = merge_extraction_results(facts, {})
    assert result["vehicle"]["make"] == "Ford"
    assert result["numbers"]["listing_price"] == 34000
    assert result["phase"] == "negotiation"
    assert "health" not in result
    assert "deal_red_flags" not in result


def test_merge_analysis_only():
    """Analysis data is included when facts are empty."""
    analysis = {
        "health": {"status": "concerning", "summary": "Test", "recommendation": "Do X"},
        "deal_red_flags": {
            "flags": [{"id": "rf1", "severity": "warning", "message": "Flag"}]
        },
    }
    result = merge_extraction_results({}, analysis)
    assert result["health"]["status"] == "concerning"
    assert len(result["deal_red_flags"]["flags"]) == 1
    assert "vehicle" not in result
    assert "numbers" not in result


def test_merge_combines_both():
    """Facts and analysis are merged without overlap."""
    facts = {
        "numbers": {"listing_price": 34000},
        "buyer_context": "at_dealership",
        "quick_actions": [{"label": "Test", "prompt": "Test prompt"}],
    }
    analysis = {
        "health": {"status": "fair", "summary": "OK", "recommendation": "Wait"},
        "scorecard": {"score_price": "yellow"},
        "session_red_flags": {"flags": []},
    }
    result = merge_extraction_results(facts, analysis)

    # Facts
    assert result["numbers"]["listing_price"] == 34000
    assert result["buyer_context"] == "at_dealership"
    assert len(result["quick_actions"]) == 1

    # Analysis
    assert result["health"]["status"] == "fair"
    assert result["scorecard"]["score_price"] == "yellow"
    assert result["session_red_flags"]["flags"] == []


def test_merge_all_fact_keys():
    """All factual extractor keys are passed through."""
    facts = {
        "vehicle": {"make": "Toyota", "model": "Camry", "role": "primary"},
        "deal": {"vehicle_id": "v1", "dealer_name": "AutoNation"},
        "numbers": {"msrp": 30000},
        "phase": "research",
        "buyer_context": "researching",
        "checklist": {"items": [{"label": "Test", "done": False}]},
        "quick_actions": [{"label": "Q", "prompt": "P"}],
        "switch_active_deal_id": "d1",
        "remove_vehicle_id": "v2",
    }
    result = merge_extraction_results(facts, {})
    for key in facts:
        assert key in result, f"Missing key: {key}"


def test_merge_all_analysis_keys():
    """All analyst keys are passed through (comparison maps to deal_comparison)."""
    analysis = {
        "health": {"status": "good", "summary": "Great", "recommendation": "Continue"},
        "scorecard": {"score_overall": "green"},
        "deal_red_flags": {"flags": []},
        "session_red_flags": {"flags": []},
        "deal_information_gaps": {"gaps": []},
        "session_information_gaps": {"gaps": []},
        "comparison": {
            "summary": "A is better",
            "recommendation": "Go with A",
            "best_deal_id": "d1",
            "highlights": [],
        },
    }
    result = merge_extraction_results({}, analysis)
    # Direct keys
    for key in (
        "health",
        "scorecard",
        "deal_red_flags",
        "session_red_flags",
        "deal_information_gaps",
        "session_information_gaps",
    ):
        assert key in result, f"Missing key: {key}"
    # "comparison" from analyst maps to "deal_comparison" for _apply_extraction
    assert "deal_comparison" in result
    assert result["deal_comparison"]["summary"] == "A is better"


def test_merge_comparison_maps_to_deal_comparison():
    """Analyst 'comparison' key is remapped to 'deal_comparison' for _apply_extraction."""
    analysis = {
        "comparison": {
            "summary": "Dealer A is cheaper",
            "recommendation": "Go with Dealer A",
            "best_deal_id": "d1",
            "highlights": [
                {
                    "label": "Price",
                    "values": [{"deal_id": "d1", "value": "$28k", "is_winner": True}],
                }
            ],
        },
    }
    result = merge_extraction_results({}, analysis)
    assert "comparison" not in result  # Raw key should NOT appear
    assert "deal_comparison" in result  # Remapped key should appear
    assert result["deal_comparison"]["best_deal_id"] == "d1"


def test_merge_ignores_unknown_keys():
    """Unknown keys in facts or analysis are not passed through."""
    facts = {"numbers": {"listing_price": 30000}, "unknown_key": "value"}
    analysis = {
        "health": {"status": "good", "summary": "OK", "recommendation": "X"},
        "bogus": 42,
    }
    result = merge_extraction_results(facts, analysis)
    assert "unknown_key" not in result
    assert "bogus" not in result


# ─── extract_deal_facts (mocked API) ───


@pytest.mark.asyncio
@patch("app.services.claude.anthropic.AsyncAnthropic")
async def test_extract_deal_facts_returns_tool_input(mock_anthropic_class):
    """extract_deal_facts returns the tool input from the API response."""
    from app.services.claude import extract_deal_facts

    tool_result = {"numbers": {"listing_price": 34000}, "phase": "negotiation"}
    mock_tool_block = MagicMock()
    mock_tool_block.type = "tool_use"
    mock_tool_block.name = "extract_deal_facts"
    mock_tool_block.input = tool_result

    mock_response = MagicMock()
    mock_response.content = [mock_tool_block]

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_response)
    mock_anthropic_class.return_value = mock_client

    result = await extract_deal_facts(
        {"buyer_context": "researching", "vehicles": [], "deals": []},
        [{"role": "user", "content": "test"}],
        "test response",
    )
    assert result == tool_result


@pytest.mark.asyncio
@patch("app.services.claude.anthropic.AsyncAnthropic")
async def test_extract_deal_facts_no_tool_call(mock_anthropic_class):
    """extract_deal_facts returns empty dict if model doesn't call tool."""
    from app.services.claude import extract_deal_facts

    mock_text_block = MagicMock()
    mock_text_block.type = "text"
    mock_text_block.text = "No changes detected."

    mock_response = MagicMock()
    mock_response.content = [mock_text_block]

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_response)
    mock_anthropic_class.return_value = mock_client

    result = await extract_deal_facts(
        {"buyer_context": "researching", "vehicles": [], "deals": []},
        [{"role": "user", "content": "test"}],
        "test response",
    )
    assert result == {}


@pytest.mark.asyncio
@patch("app.services.claude.anthropic.AsyncAnthropic")
async def test_extract_deal_facts_handles_api_error(mock_anthropic_class):
    """extract_deal_facts returns empty dict on API exception."""
    from app.services.claude import extract_deal_facts

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(side_effect=Exception("API error"))
    mock_anthropic_class.return_value = mock_client

    result = await extract_deal_facts(
        {"buyer_context": "researching", "vehicles": [], "deals": []},
        [{"role": "user", "content": "test"}],
        "test response",
    )
    assert result == {}


# ─── analyze_deal (mocked API) ───


@pytest.mark.asyncio
@patch("app.services.claude.anthropic.AsyncAnthropic")
async def test_analyze_deal_returns_tool_input(mock_anthropic_class):
    """analyze_deal returns the tool input from the API response."""
    from app.services.claude import analyze_deal

    tool_result = {
        "health": {"status": "concerning", "summary": "Test", "recommendation": "Act"},
        "deal_red_flags": {
            "flags": [{"id": "rf1", "severity": "warning", "message": "Flag"}]
        },
    }
    mock_tool_block = MagicMock()
    mock_tool_block.type = "tool_use"
    mock_tool_block.name = "analyze_deal"
    mock_tool_block.input = tool_result

    mock_response = MagicMock()
    mock_response.content = [mock_tool_block]

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_response)
    mock_anthropic_class.return_value = mock_client

    result = await analyze_deal(
        {"buyer_context": "at_dealership", "vehicles": [], "deals": []},
        [{"role": "user", "content": "test"}],
        "test response",
    )
    assert result == tool_result


@pytest.mark.asyncio
@patch("app.services.claude.anthropic.AsyncAnthropic")
async def test_analyze_deal_no_tool_call(mock_anthropic_class):
    """analyze_deal returns empty dict if model doesn't call tool."""
    from app.services.claude import analyze_deal

    mock_text_block = MagicMock()
    mock_text_block.type = "text"
    mock_text_block.text = "No assessment changes needed."

    mock_response = MagicMock()
    mock_response.content = [mock_text_block]

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_response)
    mock_anthropic_class.return_value = mock_client

    result = await analyze_deal(
        {"buyer_context": "researching", "vehicles": [], "deals": []},
        [{"role": "user", "content": "test"}],
        "test response",
    )
    assert result == {}


@pytest.mark.asyncio
@patch("app.services.claude.anthropic.AsyncAnthropic")
async def test_analyze_deal_handles_api_error(mock_anthropic_class):
    """analyze_deal returns empty dict on API exception."""
    from app.services.claude import analyze_deal

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(side_effect=Exception("API error"))
    mock_anthropic_class.return_value = mock_client

    result = await analyze_deal(
        {"buyer_context": "researching", "vehicles": [], "deals": []},
        [{"role": "user", "content": "test"}],
        "test response",
    )
    assert result == {}
