"""Tests for insights panel redesign: new tool calls, deal corrections, and assessment safety net."""

from unittest.mock import AsyncMock, patch

import pytest
from app.core.security import create_access_token, hash_password
from app.models.deal_state import DealState
from app.models.enums import (
    DealPhase,
    HealthStatus,
    UserRole,
)
from app.models.session import ChatSession
from app.models.user import User
from app.routes.chat import _apply_tool_call, _deal_state_to_dict

# ─── Helpers ───


def _create_user_and_token(db) -> tuple[User, str]:
    user = User(
        email="test@example.com",
        hashed_password=hash_password("password"),
        role=UserRole.BUYER,
        display_name="Test User",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": user.id})
    return user, token


def _auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _create_session_with_deal_state(db, user) -> tuple[ChatSession, DealState]:
    session = ChatSession(user_id=user.id, title="Test Deal")
    db.add(session)
    db.flush()
    deal_state = DealState(session_id=session.id)
    db.add(deal_state)
    db.commit()
    db.refresh(deal_state)
    return session, deal_state


# ─── _apply_tool_call: update_deal_health ───


def test_apply_tool_call_deal_health_valid(db):
    """update_deal_health sets health_status and health_summary on deal state."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    _apply_tool_call(
        deal_state,
        "update_deal_health",
        {"status": "good", "summary": "Offer is below your target"},
    )

    assert deal_state.health_status == HealthStatus.GOOD
    assert deal_state.health_summary == "Offer is below your target"


def test_apply_tool_call_deal_health_with_recommendation(db):
    """update_deal_health sets recommendation on deal state."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    _apply_tool_call(
        deal_state,
        "update_deal_health",
        {
            "status": "fair",
            "summary": "Offer is above target",
            "recommendation": "Counter at $31,500",
        },
    )

    assert deal_state.health_status == HealthStatus.FAIR
    assert deal_state.health_summary == "Offer is above target"
    assert deal_state.recommendation == "Counter at $31,500"


def test_apply_tool_call_deal_health_without_recommendation(db):
    """update_deal_health without recommendation leaves it unchanged."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    deal_state.recommendation = "Old recommendation"

    _apply_tool_call(
        deal_state,
        "update_deal_health",
        {"status": "good", "summary": "Great deal"},
    )

    assert deal_state.health_status == HealthStatus.GOOD
    # recommendation unchanged because it wasn't in tool_data
    assert deal_state.recommendation == "Old recommendation"


def test_apply_tool_call_deal_health_recommendation_overwrites(db):
    """update_deal_health with new recommendation overwrites old one."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    deal_state.recommendation = "Old recommendation"

    _apply_tool_call(
        deal_state,
        "update_deal_health",
        {
            "status": "concerning",
            "summary": "APR too high",
            "recommendation": "Get a pre-approval from your bank",
        },
    )

    assert deal_state.recommendation == "Get a pre-approval from your bank"


def test_apply_tool_call_deal_health_invalid_status(db):
    """update_deal_health with invalid status leaves health_status unchanged."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    deal_state.health_status = HealthStatus.FAIR
    _apply_tool_call(
        deal_state,
        "update_deal_health",
        {"status": "invalid_status", "summary": "Should not apply"},
    )

    # Status should remain unchanged because the invalid value triggers a return
    assert deal_state.health_status == HealthStatus.FAIR


def test_apply_tool_call_deal_health_partial_update(db):
    """update_deal_health with only summary preserves existing status."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    deal_state.health_status = HealthStatus.GOOD
    deal_state.health_summary = "Old summary"

    _apply_tool_call(
        deal_state,
        "update_deal_health",
        {"summary": "New summary only"},
    )

    assert deal_state.health_status == HealthStatus.GOOD
    assert deal_state.health_summary == "New summary only"


# ─── _apply_tool_call: update_red_flags ───


def test_apply_tool_call_red_flags(db):
    """update_red_flags replaces the full red flags list."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    flags = [
        {
            "id": "apr_high",
            "severity": "critical",
            "message": "APR of 9.5% is very high",
        },
        {
            "id": "hidden_fee",
            "severity": "warning",
            "message": "Unexpected doc fee of $800",
        },
    ]
    _apply_tool_call(deal_state, "update_red_flags", {"flags": flags})

    assert deal_state.red_flags == flags
    assert len(deal_state.red_flags) == 2


def test_apply_tool_call_red_flags_clear(db):
    """update_red_flags with empty array clears all flags."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    deal_state.red_flags = [{"id": "old", "severity": "warning", "message": "Old flag"}]
    _apply_tool_call(deal_state, "update_red_flags", {"flags": []})

    assert deal_state.red_flags == []


# ─── _apply_tool_call: update_information_gaps ───


def test_apply_tool_call_information_gaps(db):
    """update_information_gaps replaces the full gaps list."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    gaps = [
        {
            "label": "Credit score range",
            "reason": "Helps assess whether APR is competitive",
            "priority": "high",
        },
        {
            "label": "Pre-approval status",
            "reason": "Forces dealer to compete on price alone",
            "priority": "high",
        },
    ]
    _apply_tool_call(deal_state, "update_information_gaps", {"gaps": gaps})

    assert deal_state.information_gaps == gaps
    assert len(deal_state.information_gaps) == 2


def test_apply_tool_call_information_gaps_clear(db):
    """update_information_gaps with empty array clears gaps."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    deal_state.information_gaps = [
        {"label": "Old gap", "reason": "Old", "priority": "low"}
    ]
    _apply_tool_call(deal_state, "update_information_gaps", {"gaps": []})

    assert deal_state.information_gaps == []


# ─── _apply_tool_call: first_offer snapshot ───


def test_apply_tool_call_first_offer_snapshot(db):
    """First time current_offer is set, first_offer should be snapshotted."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    assert deal_state.first_offer is None
    assert deal_state.current_offer is None

    _apply_tool_call(deal_state, "update_deal_numbers", {"current_offer": 27500})

    assert deal_state.current_offer == 27500
    assert deal_state.first_offer == 27500


def test_apply_tool_call_first_offer_not_overwritten(db):
    """Subsequent current_offer updates don't overwrite first_offer."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    deal_state.current_offer = 27500
    deal_state.first_offer = 27500

    _apply_tool_call(deal_state, "update_deal_numbers", {"current_offer": 26000})

    assert deal_state.current_offer == 26000
    assert deal_state.first_offer == 27500  # Unchanged


# ─── _apply_tool_call: pre_fi_price snapshot ───


def test_apply_tool_call_pre_fi_price_snapshot(db):
    """When phase transitions to financing, pre_fi_price snapshots current_offer."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    deal_state.current_offer = 26000
    assert deal_state.pre_fi_price is None

    _apply_tool_call(deal_state, "update_deal_phase", {"phase": "financing"})

    assert deal_state.phase == DealPhase.FINANCING
    assert deal_state.pre_fi_price == 26000


def test_apply_tool_call_pre_fi_price_not_overwritten(db):
    """Second transition to financing doesn't overwrite pre_fi_price."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    deal_state.current_offer = 26000
    deal_state.pre_fi_price = 25000  # Already set from a prior transition

    _apply_tool_call(deal_state, "update_deal_phase", {"phase": "financing"})

    assert deal_state.pre_fi_price == 25000  # Unchanged


def test_apply_tool_call_pre_fi_price_no_snapshot_without_offer(db):
    """If current_offer is None when entering financing, pre_fi_price stays None."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    assert deal_state.current_offer is None

    _apply_tool_call(deal_state, "update_deal_phase", {"phase": "financing"})

    assert deal_state.pre_fi_price is None


# ─── _deal_state_to_dict ───


def test_deal_state_to_dict_includes_new_fields(db):
    """_deal_state_to_dict includes health, red_flags, and information_gaps."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    deal_state.health_status = "good"
    deal_state.health_summary = "Strong deal"
    deal_state.red_flags = [
        {"id": "test", "severity": "warning", "message": "Test flag"}
    ]
    deal_state.information_gaps = [
        {"label": "Credit", "reason": "Needed", "priority": "high"}
    ]
    db.commit()

    result = _deal_state_to_dict(deal_state)

    assert result["health"]["status"] == "good"
    assert result["health"]["summary"] == "Strong deal"
    assert len(result["red_flags"]) == 1
    assert result["red_flags"][0]["id"] == "test"
    assert len(result["information_gaps"]) == 1
    assert result["information_gaps"][0]["label"] == "Credit"


def test_deal_state_to_dict_empty_health(db):
    """_deal_state_to_dict returns null health fields when not set."""
    user, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)

    result = _deal_state_to_dict(deal_state)

    assert result["health"]["status"] is None
    assert result["health"]["summary"] is None
    assert result["red_flags"] == []
    assert result["information_gaps"] == []


# ─── PATCH /deal/{session_id} ───


@patch("app.routes.deals.assess_deal_state", new_callable=AsyncMock)
def test_patch_deal_corrects_number(mock_assess, client, db):
    """PATCH /deal/{session_id} applies number corrections."""
    mock_assess.return_value = {
        "health": {"status": "fair", "summary": "Offer is above target"},
        "flags": [],
    }

    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    session_id = deal_state.session_id

    resp = client.patch(
        f"/api/deal/{session_id}",
        json={"current_offer": 25000},
        headers=_auth_header(token),
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["health_status"] == "fair"
    assert data["health_summary"] == "Offer is above target"

    db.refresh(deal_state)
    assert deal_state.current_offer == 25000


@patch("app.routes.deals.assess_deal_state", new_callable=AsyncMock)
def test_patch_deal_corrects_vehicle(mock_assess, client, db):
    """PATCH /deal/{session_id} applies vehicle field corrections."""
    mock_assess.return_value = {"health": None, "flags": []}

    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    session_id = deal_state.session_id

    resp = client.patch(
        f"/api/deal/{session_id}",
        json={"vehicle_make": "Honda", "vehicle_model": "Civic"},
        headers=_auth_header(token),
    )

    assert resp.status_code == 200
    db.refresh(deal_state)
    assert deal_state.vehicle_make == "Honda"
    assert deal_state.vehicle_model == "Civic"


@patch("app.routes.deals.assess_deal_state", new_callable=AsyncMock)
def test_patch_deal_snapshots_first_offer(mock_assess, client, db):
    """PATCH with current_offer snapshots to first_offer when first_offer is null."""
    mock_assess.return_value = {}

    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    session_id = deal_state.session_id

    resp = client.patch(
        f"/api/deal/{session_id}",
        json={"current_offer": 28000},
        headers=_auth_header(token),
    )

    assert resp.status_code == 200
    db.refresh(deal_state)
    assert deal_state.current_offer == 28000
    assert deal_state.first_offer == 28000


@patch("app.routes.deals.assess_deal_state", new_callable=AsyncMock)
def test_patch_deal_empty_body_returns_400(mock_assess, client, db):
    """PATCH with no fields returns 400."""
    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    session_id = deal_state.session_id

    resp = client.patch(
        f"/api/deal/{session_id}",
        json={},
        headers=_auth_header(token),
    )

    assert resp.status_code == 400


def test_patch_deal_returns_404_for_nonexistent(client, db):
    """PATCH for nonexistent session returns 404."""
    _, token = _create_user_and_token(db)

    resp = client.patch(
        "/api/deal/nonexistent-id",
        json={"current_offer": 25000},
        headers=_auth_header(token),
    )

    assert resp.status_code == 404


@patch("app.routes.deals.assess_deal_state", new_callable=AsyncMock)
def test_patch_deal_other_user_returns_404(mock_assess, client, db):
    """PATCH on another user's session returns 404."""
    user1, _ = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user1)
    session_id = deal_state.session_id

    user2 = User(
        email="other@example.com",
        hashed_password=hash_password("password"),
        role=UserRole.BUYER,
        display_name="Other",
    )
    db.add(user2)
    db.commit()
    db.refresh(user2)
    token2 = create_access_token({"sub": user2.id})

    resp = client.patch(
        f"/api/deal/{session_id}",
        json={"current_offer": 25000},
        headers=_auth_header(token2),
    )

    assert resp.status_code == 404


@patch("app.routes.deals.assess_deal_state", new_callable=AsyncMock)
def test_patch_deal_applies_assessment_health(mock_assess, client, db):
    """PATCH applies the Haiku assessment health to deal state."""
    mock_assess.return_value = {
        "health": {"status": "concerning", "summary": "APR is very high"},
        "flags": [{"id": "apr_high", "severity": "critical", "message": "9.5% APR"}],
    }

    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    session_id = deal_state.session_id

    resp = client.patch(
        f"/api/deal/{session_id}",
        json={"apr": 9.5},
        headers=_auth_header(token),
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["health_status"] == "concerning"
    assert len(data["red_flags"]) == 1
    assert data["red_flags"][0]["id"] == "apr_high"

    db.refresh(deal_state)
    assert deal_state.health_status == "concerning"
    assert deal_state.red_flags == [
        {"id": "apr_high", "severity": "critical", "message": "9.5% APR"}
    ]


@patch("app.routes.deals.assess_deal_state", new_callable=AsyncMock)
def test_patch_deal_applies_assessment_recommendation(mock_assess, client, db):
    """PATCH applies the recommendation from Haiku assessment to deal state and response."""
    mock_assess.return_value = {
        "health": {
            "status": "fair",
            "summary": "Offer above target",
            "recommendation": "Counter at $28,000",
        },
        "flags": [],
    }

    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    session_id = deal_state.session_id

    resp = client.patch(
        f"/api/deal/{session_id}",
        json={"current_offer": 30000},
        headers=_auth_header(token),
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["recommendation"] == "Counter at $28,000"

    db.refresh(deal_state)
    assert deal_state.recommendation == "Counter at $28,000"


@patch("app.routes.deals.assess_deal_state", new_callable=AsyncMock)
def test_patch_deal_no_recommendation_preserves_existing(mock_assess, client, db):
    """PATCH without recommendation in assessment preserves existing recommendation."""
    mock_assess.return_value = {
        "health": {"status": "good", "summary": "Great deal"},
        "flags": [],
    }

    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    session_id = deal_state.session_id
    deal_state.recommendation = "Previous recommendation"
    db.commit()

    resp = client.patch(
        f"/api/deal/{session_id}",
        json={"current_offer": 25000},
        headers=_auth_header(token),
    )

    assert resp.status_code == 200
    data = resp.json()
    # Existing recommendation should be preserved (returned from deal_state)
    assert data["recommendation"] == "Previous recommendation"

    db.refresh(deal_state)
    assert deal_state.recommendation == "Previous recommendation"


# ─── assess_deal_state ───


@pytest.mark.asyncio
@patch("app.services.claude.anthropic.AsyncAnthropic")
async def test_assess_deal_state_parses_valid_json(mock_anthropic_class):
    """assess_deal_state parses valid JSON from Haiku response."""
    from app.services.claude import assess_deal_state

    mock_client = AsyncMock()
    mock_anthropic_class.return_value = mock_client

    mock_response = AsyncMock()
    mock_text_block = AsyncMock()
    mock_text_block.text = '{"health": {"status": "fair", "summary": "Offer is above target"}, "flags": []}'
    mock_response.content = [mock_text_block]
    mock_client.messages.create.return_value = mock_response

    result = await assess_deal_state({"current_offer": 27000, "your_target": 25000})

    assert result["health"]["status"] == "fair"
    assert result["flags"] == []


@pytest.mark.asyncio
@patch("app.services.claude.anthropic.AsyncAnthropic")
async def test_assess_deal_state_handles_code_fences(mock_anthropic_class):
    """assess_deal_state strips markdown code fences from response."""
    from app.services.claude import assess_deal_state

    mock_client = AsyncMock()
    mock_anthropic_class.return_value = mock_client

    mock_response = AsyncMock()
    mock_text_block = AsyncMock()
    mock_text_block.text = '```json\n{"health": {"status": "good", "summary": "Great deal"}, "flags": []}\n```'
    mock_response.content = [mock_text_block]
    mock_client.messages.create.return_value = mock_response

    result = await assess_deal_state({"current_offer": 25000})

    assert result["health"]["status"] == "good"


@pytest.mark.asyncio
@patch("app.services.claude.anthropic.AsyncAnthropic")
async def test_assess_deal_state_handles_empty_response(mock_anthropic_class):
    """assess_deal_state returns empty dict on empty response."""
    from app.services.claude import assess_deal_state

    mock_client = AsyncMock()
    mock_anthropic_class.return_value = mock_client

    mock_response = AsyncMock()
    mock_text_block = AsyncMock()
    mock_text_block.text = ""
    mock_response.content = [mock_text_block]
    mock_client.messages.create.return_value = mock_response

    result = await assess_deal_state({"current_offer": 25000})

    assert result == {}


@pytest.mark.asyncio
@patch("app.services.claude.anthropic.AsyncAnthropic")
async def test_assess_deal_state_handles_invalid_json(mock_anthropic_class):
    """assess_deal_state returns empty dict on invalid JSON."""
    from app.services.claude import assess_deal_state

    mock_client = AsyncMock()
    mock_anthropic_class.return_value = mock_client

    mock_response = AsyncMock()
    mock_text_block = AsyncMock()
    mock_text_block.text = "This is not valid JSON at all."
    mock_response.content = [mock_text_block]
    mock_client.messages.create.return_value = mock_response

    result = await assess_deal_state({"current_offer": 25000})

    assert result == {}


@pytest.mark.asyncio
@patch("app.services.claude.anthropic.AsyncAnthropic")
async def test_assess_deal_state_handles_api_error(mock_anthropic_class):
    """assess_deal_state returns empty dict on API exception."""
    from app.services.claude import assess_deal_state

    mock_client = AsyncMock()
    mock_anthropic_class.return_value = mock_client
    mock_client.messages.create.side_effect = Exception("API Error")

    result = await assess_deal_state({"current_offer": 25000})

    assert result == {}


# ─── GET /deal/{session_id} includes new fields ───


def test_get_deal_state_includes_new_fields(client, db):
    """GET /deal/{session_id} response includes health, red_flags, information_gaps."""
    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    session_id = deal_state.session_id

    deal_state.health_status = "concerning"
    deal_state.health_summary = "APR is high"
    deal_state.recommendation = "Get a pre-approval from your bank"
    deal_state.red_flags = [
        {"id": "apr_high", "severity": "critical", "message": "Very high APR"}
    ]
    deal_state.information_gaps = [
        {"label": "Credit", "reason": "Needed for APR assessment", "priority": "high"}
    ]
    deal_state.first_offer = 28000
    deal_state.pre_fi_price = 26000
    deal_state.savings_estimate = 2000
    db.commit()

    resp = client.get(f"/api/deal/{session_id}", headers=_auth_header(token))

    assert resp.status_code == 200
    data = resp.json()
    assert data["health_status"] == "concerning"
    assert data["health_summary"] == "APR is high"
    assert data["recommendation"] == "Get a pre-approval from your bank"
    assert len(data["red_flags"]) == 1
    assert data["red_flags"][0]["id"] == "apr_high"
    assert len(data["information_gaps"]) == 1
    assert data["information_gaps"][0]["label"] == "Credit"
    assert data["first_offer"] == 28000
    assert data["pre_fi_price"] == 26000
    assert data["savings_estimate"] == 2000


def test_get_deal_state_new_fields_default_empty(client, db):
    """GET /deal/{session_id} returns null/empty for new fields when not set."""
    user, token = _create_user_and_token(db)
    _, deal_state = _create_session_with_deal_state(db, user)
    session_id = deal_state.session_id

    resp = client.get(f"/api/deal/{session_id}", headers=_auth_header(token))

    assert resp.status_code == 200
    data = resp.json()
    assert data["health_status"] is None
    assert data["health_summary"] is None
    assert data["recommendation"] is None
    assert data["red_flags"] == []
    assert data["information_gaps"] == []
    assert data["first_offer"] is None
    assert data["pre_fi_price"] is None
    assert data["savings_estimate"] is None
