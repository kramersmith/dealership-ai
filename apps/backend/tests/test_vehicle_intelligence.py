"""Tests for vehicle intelligence service — VIN normalization, decode, history, valuation."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from app.models.vehicle_decode import VehicleDecode
from app.models.vehicle_history_report import VehicleHistoryReport
from app.models.vehicle_valuation import VehicleValuation
from app.services.vehicle_intelligence import (
    ProviderConfigurationError,
    VehicleIntelligenceError,
    _extract_amount,
    _extract_bool,
    _extract_title_brands,
    _is_fresh,
    _merge_decoded_fields,
    _parse_int,
    _pick,
    build_vehicle_intelligence_response,
    check_history,
    decode_vin,
    get_valuation,
    normalize_vin,
)

from tests.conftest import (
    async_create_session_with_deal_state,
    async_create_user_and_token,
    async_create_vehicle,
    auth_header,
    create_session_with_deal_state,
    create_user_and_token,
    create_vehicle,
)

# ─── normalize_vin ───


def test_normalize_vin_valid():
    """A valid 17-character VIN is returned uppercased."""
    assert normalize_vin("1hgcm82633a004352") == "1HGCM82633A004352"


def test_normalize_vin_strips_whitespace():
    """Leading/trailing whitespace is stripped."""
    assert normalize_vin("  1HGCM82633A004352  ") == "1HGCM82633A004352"


def test_normalize_vin_strips_non_alphanumeric():
    """Dashes and other non-alphanumeric characters are removed."""
    assert normalize_vin("1HG-CM82-633A-004352") == "1HGCM82633A004352"


def test_normalize_vin_rejects_short():
    """VINs shorter than 17 characters raise an error."""
    with pytest.raises(VehicleIntelligenceError, match="17 characters"):
        normalize_vin("1HGCM826")


def test_normalize_vin_rejects_long():
    """VINs longer than 17 characters raise an error."""
    with pytest.raises(VehicleIntelligenceError, match="17 characters"):
        normalize_vin("1HGCM82633A004352X")


def test_normalize_vin_rejects_letter_i():
    """VINs containing 'I' are invalid (ambiguous with '1')."""
    with pytest.raises(VehicleIntelligenceError, match="invalid characters"):
        normalize_vin("1HGCM82633I004352")


def test_normalize_vin_rejects_letter_o():
    """VINs containing 'O' are invalid (ambiguous with '0')."""
    with pytest.raises(VehicleIntelligenceError, match="invalid characters"):
        normalize_vin("1HGCM82633O004352")


def test_normalize_vin_rejects_letter_q():
    """VINs containing 'Q' are invalid (ambiguous with '0')."""
    with pytest.raises(VehicleIntelligenceError, match="invalid characters"):
        normalize_vin("1HGCM82633Q004352")


def test_normalize_vin_empty_string():
    """Empty string raises an error."""
    with pytest.raises(VehicleIntelligenceError, match="17 characters"):
        normalize_vin("")


# ─── _is_fresh ───


def test_is_fresh_none_returns_false():
    assert _is_fresh(None) is False


def test_is_fresh_future_returns_true():
    future = datetime.now(timezone.utc) + timedelta(hours=1)
    assert _is_fresh(future) is True


def test_is_fresh_past_returns_false():
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    assert _is_fresh(past) is False


# ─── _pick ───


def test_pick_returns_first_valid_key():
    payload = {"a": None, "b": "Honda"}
    assert _pick(payload, "a", "b") == "Honda"


def test_pick_skips_not_applicable():
    payload = {"a": "Not Applicable", "b": "V6"}
    assert _pick(payload, "a", "b") == "V6"


def test_pick_skips_zero_string():
    payload = {"a": "0", "b": "4"}
    assert _pick(payload, "a", "b") == "4"


def test_pick_skips_empty_string():
    payload = {"a": "", "b": "Sedan"}
    assert _pick(payload, "a", "b") == "Sedan"


def test_pick_returns_none_when_all_invalid():
    payload = {"a": None, "b": ""}
    assert _pick(payload, "a", "b") is None


def test_pick_converts_int_to_str():
    payload = {"hp": 300}
    assert _pick(payload, "hp") == "300"


# ─── _parse_int ───


def test_parse_int_valid():
    assert _parse_int("2024") == 2024


def test_parse_int_none():
    assert _parse_int(None) is None


def test_parse_int_empty():
    assert _parse_int("") is None


def test_parse_int_invalid():
    assert _parse_int("abc") is None


def test_parse_int_float_string():
    assert _parse_int("3.5") is None


# ─── _extract_title_brands ───


def test_extract_title_brands_list():
    assert _extract_title_brands({"titleBrands": ["Clean", "Rebuilt"]}) == [
        "Clean",
        "Rebuilt",
    ]


def test_extract_title_brands_comma_string():
    assert _extract_title_brands({"brands": "Clean, Rebuilt"}) == ["Clean", "Rebuilt"]


def test_extract_title_brands_empty():
    assert _extract_title_brands({}) == []


def test_extract_title_brands_filters_none_items():
    assert _extract_title_brands({"titleBrands": ["Clean", None, "Rebuilt"]}) == [
        "Clean",
        "Rebuilt",
    ]


def test_extract_title_brands_snake_case_key():
    assert _extract_title_brands({"title_brands": ["Salvage"]}) == ["Salvage"]


# ─── _extract_bool ───


def test_extract_bool_true_bool():
    assert _extract_bool({"salvage": True}, "salvage") is True


def test_extract_bool_false_bool():
    assert _extract_bool({"salvage": False}, "salvage") is False


def test_extract_bool_string_yes():
    assert _extract_bool({"salvage": "yes"}, "salvage") is True


def test_extract_bool_string_no():
    assert _extract_bool({"salvage": "no"}, "salvage") is False


def test_extract_bool_int_one():
    assert _extract_bool({"salvage": 1}, "salvage") is True


def test_extract_bool_int_zero():
    assert _extract_bool({"salvage": 0}, "salvage") is False


def test_extract_bool_missing_key():
    assert _extract_bool({}, "salvage") is False


def test_extract_bool_falls_through_keys():
    assert _extract_bool({"hasSalvage": True}, "salvage", "hasSalvage") is True


# ─── _extract_amount ───


def test_extract_amount_market_value():
    assert _extract_amount({"market_value": 25000}) == 25000.0


def test_extract_amount_string_value():
    assert _extract_amount({"price": "18500.50"}) == 18500.50


def test_extract_amount_none_value():
    assert _extract_amount({}) is None


def test_extract_amount_skips_empty_string():
    assert _extract_amount({"market_value": "", "price": 12000}) == 12000.0


def test_extract_amount_invalid_string():
    assert _extract_amount({"market_value": "N/A"}) is None


# ─── _merge_decoded_fields ───


def test_merge_decoded_fields_fills_blanks(db):
    """Decoded fields are merged into vehicle when vehicle fields are empty."""
    user, _ = create_user_and_token(db)
    session, _ = create_session_with_deal_state(db, user)
    vehicle = create_vehicle(db, session.id, vin="1HGCM82633A004352")
    decode = VehicleDecode(
        vehicle_id=vehicle.id,
        provider="nhtsa_vpic",
        status="success",
        vin="1HGCM82633A004352",
        year=2022,
        make="Honda",
        model="Civic",
        trim="EX",
        engine="2.0L I4",
    )

    _merge_decoded_fields(vehicle, decode)

    assert vehicle.year == 2022
    assert vehicle.make == "Honda"
    assert vehicle.model == "Civic"
    assert vehicle.trim == "EX"
    assert vehicle.engine == "2.0L I4"


def test_merge_decoded_fields_does_not_overwrite_existing(db):
    """Existing vehicle fields are not overwritten by decoded fields."""
    user, _ = create_user_and_token(db)
    session, _ = create_session_with_deal_state(db, user)
    vehicle = create_vehicle(
        db, session.id, vin="1HGCM82633A004352", make="HONDA", model="CIVIC"
    )
    decode = VehicleDecode(
        vehicle_id=vehicle.id,
        provider="nhtsa_vpic",
        status="success",
        vin="1HGCM82633A004352",
        year=2022,
        make="Honda",
        model="Civic",
        trim="EX",
    )

    _merge_decoded_fields(vehicle, decode)

    assert vehicle.make == "HONDA"
    assert vehicle.model == "CIVIC"
    assert vehicle.trim == "EX"


# ─── build_vehicle_intelligence_response ───


async def test_build_vehicle_intelligence_response_empty(adb):
    """Returns empty response when no intelligence records exist."""
    user, _ = await async_create_user_and_token(adb)
    session, _ = await async_create_session_with_deal_state(adb, user)
    vehicle = await async_create_vehicle(adb, session.id, vin="1HGCM82633A004352")
    await adb.commit()

    result = await build_vehicle_intelligence_response(vehicle.id, adb)

    assert result.decode is None
    assert result.history_report is None
    assert result.valuation is None


async def test_build_vehicle_intelligence_response_with_records(adb):
    """Returns populated response when intelligence records exist."""
    user, _ = await async_create_user_and_token(adb)
    session, _ = await async_create_session_with_deal_state(adb, user)
    vehicle = await async_create_vehicle(adb, session.id, vin="1HGCM82633A004352")
    adb.add(
        VehicleDecode(
            vehicle_id=vehicle.id,
            provider="nhtsa_vpic",
            status="success",
            vin="1HGCM82633A004352",
            make="Honda",
        )
    )
    adb.add(
        VehicleHistoryReport(
            vehicle_id=vehicle.id,
            provider="vinaudit",
            status="success",
            vin="1HGCM82633A004352",
        )
    )
    adb.add(
        VehicleValuation(
            vehicle_id=vehicle.id,
            provider="vinaudit",
            status="success",
            vin="1HGCM82633A004352",
            amount=20000,
        )
    )
    await adb.commit()

    result = await build_vehicle_intelligence_response(vehicle.id, adb)

    assert result.decode is not None
    assert result.decode.provider == "nhtsa_vpic"
    assert result.history_report is not None
    assert result.history_report.provider == "vinaudit"
    assert result.valuation is not None
    assert result.valuation.amount == 20000


# ─── decode_vin (service function) ───


async def test_decode_vin_returns_cached_when_fresh(adb):
    """decode_vin returns an existing VehicleDecode when it is still fresh."""
    user, _ = await async_create_user_and_token(adb)
    session, _ = await async_create_session_with_deal_state(adb, user)
    vehicle = await async_create_vehicle(adb, session.id, vin="1HGCM82633A004352")
    existing = VehicleDecode(
        vehicle_id=vehicle.id,
        provider="nhtsa_vpic",
        status="success",
        vin="1HGCM82633A004352",
        year=2022,
        make="Honda",
        model="Civic",
        fetched_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(days=90),
    )
    adb.add(existing)
    await adb.commit()
    await adb.refresh(existing)

    result = await decode_vin(vehicle, adb, vin="1HGCM82633A004352")

    assert result.id == existing.id
    assert vehicle.make == "Honda"


async def test_decode_vin_fetches_when_expired(adb):
    """decode_vin calls the NHTSA API when the cached decode is expired."""
    user, _ = await async_create_user_and_token(adb)
    session, _ = await async_create_session_with_deal_state(adb, user)
    vehicle = await async_create_vehicle(adb, session.id, vin="1HGCM82633A004352")
    expired = VehicleDecode(
        vehicle_id=vehicle.id,
        provider="nhtsa_vpic",
        status="success",
        vin="1HGCM82633A004352",
        fetched_at=datetime.now(timezone.utc) - timedelta(days=200),
        expires_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    adb.add(expired)
    await adb.commit()

    fake_payload = {
        "Make": "Honda",
        "Model": "Civic",
        "ModelYear": "2022",
        "Trim": "EX",
        "BodyClass": "Sedan",
        "DriveType": "FWD",
        "DisplacementL": "2.0",
        "EngineCylinders": "4",
        "EngineConfiguration": "In-Line",
        "EngineHP": "158",
        "FuelTypePrimary": "Gasoline",
    }
    with patch(
        "app.services.vehicle_intelligence.fetch_vpic_decode",
        new=AsyncMock(return_value=fake_payload),
    ):
        result = await decode_vin(vehicle, adb, vin="1HGCM82633A004352")

    assert result.id != expired.id
    assert result.make == "Honda"
    assert result.model == "Civic"
    assert result.engine == "2.0L I4 (158 HP)"
    assert vehicle.make == "Honda"


async def test_decode_vin_force_refresh_bypasses_cache(adb):
    """decode_vin fetches fresh data when force_refresh=True even if cache is valid."""
    user, _ = await async_create_user_and_token(adb)
    session, _ = await async_create_session_with_deal_state(adb, user)
    vehicle = await async_create_vehicle(adb, session.id, vin="1HGCM82633A004352")
    fresh = VehicleDecode(
        vehicle_id=vehicle.id,
        provider="nhtsa_vpic",
        status="success",
        vin="1HGCM82633A004352",
        make="Honda",
        fetched_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(days=90),
    )
    adb.add(fresh)
    await adb.commit()
    await adb.refresh(fresh)

    fake_payload = {"Make": "Honda", "Model": "Civic", "ModelYear": "2022"}
    with patch(
        "app.services.vehicle_intelligence.fetch_vpic_decode",
        new=AsyncMock(return_value=fake_payload),
    ) as mock_fetch:
        result = await decode_vin(
            vehicle, adb, vin="1HGCM82633A004352", force_refresh=True
        )

    mock_fetch.assert_called_once_with("1HGCM82633A004352")
    assert result.id != fresh.id


# ─── check_history (service function) ───


async def test_check_history_returns_cached_when_fresh(adb):
    """check_history returns an existing report when it is still fresh."""
    user, _ = await async_create_user_and_token(adb)
    session, _ = await async_create_session_with_deal_state(adb, user)
    vehicle = await async_create_vehicle(adb, session.id, vin="1HGCM82633A004352")
    existing = VehicleHistoryReport(
        vehicle_id=vehicle.id,
        provider="vinaudit",
        status="success",
        vin="1HGCM82633A004352",
        title_brands=["Clean"],
        fetched_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(days=15),
    )
    adb.add(existing)
    await adb.commit()
    await adb.refresh(existing)

    result = await check_history(vehicle, adb, vin="1HGCM82633A004352")

    assert result.id == existing.id


async def test_check_history_fetches_when_no_cache(adb):
    """check_history calls VinAudit API when no cached report exists."""
    user, _ = await async_create_user_and_token(adb)
    session, _ = await async_create_session_with_deal_state(adb, user)
    vehicle = await async_create_vehicle(adb, session.id, vin="1HGCM82633A004352")
    await adb.commit()

    fake_payload = {
        "titleBrands": ["Clean"],
        "salvage": False,
        "totalLoss": False,
        "theftRecord": False,
        "odometerIssue": False,
    }
    with patch(
        "app.services.vehicle_intelligence.fetch_vinaudit_history",
        new=AsyncMock(return_value=fake_payload),
    ):
        result = await check_history(vehicle, adb, vin="1HGCM82633A004352")

    assert result.provider == "vinaudit"
    assert result.status == "success"
    assert result.title_brands == ["Clean"]
    assert result.has_salvage is False


async def test_check_history_raises_when_no_api_key(adb):
    """check_history raises ProviderConfigurationError when VINAUDIT_API_KEY is empty."""
    user, _ = await async_create_user_and_token(adb)
    session, _ = await async_create_session_with_deal_state(adb, user)
    vehicle = await async_create_vehicle(adb, session.id, vin="1HGCM82633A004352")
    await adb.commit()

    with patch("app.services.vehicle_intelligence.settings") as mock_settings:
        mock_settings.VINAUDIT_API_KEY = ""
        mock_settings.VINAUDIT_HISTORY_URL = "https://example.com"
        with pytest.raises(ProviderConfigurationError, match="VINAUDIT_API_KEY"):
            await check_history(vehicle, adb, vin="1HGCM82633A004352")


# ─── get_valuation (service function) ───


async def test_get_valuation_returns_cached_when_fresh(adb):
    """get_valuation returns an existing valuation when it is still fresh."""
    user, _ = await async_create_user_and_token(adb)
    session, _ = await async_create_session_with_deal_state(adb, user)
    vehicle = await async_create_vehicle(adb, session.id, vin="1HGCM82633A004352")
    existing = VehicleValuation(
        vehicle_id=vehicle.id,
        provider="vinaudit",
        status="success",
        vin="1HGCM82633A004352",
        amount=25000,
        fetched_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    adb.add(existing)
    await adb.commit()
    await adb.refresh(existing)

    result = await get_valuation(vehicle, adb, vin="1HGCM82633A004352")

    assert result.id == existing.id
    assert result.amount == 25000


async def test_get_valuation_fetches_when_no_cache(adb):
    """get_valuation calls VinAudit API when no cached valuation exists."""
    user, _ = await async_create_user_and_token(adb)
    session, _ = await async_create_session_with_deal_state(adb, user)
    vehicle = await async_create_vehicle(adb, session.id, vin="1HGCM82633A004352")
    await adb.commit()

    fake_payload = {"market_value": 22500, "currency": "USD"}
    with patch(
        "app.services.vehicle_intelligence.fetch_vinaudit_valuation",
        new=AsyncMock(return_value=fake_payload),
    ):
        result = await get_valuation(vehicle, adb, vin="1HGCM82633A004352")

    assert result.provider == "vinaudit"
    assert result.status == "success"
    assert result.amount == 22500
    assert result.currency == "USD"


async def test_get_valuation_partial_when_no_amount(adb):
    """get_valuation sets status to 'partial' when the payload has no recognizable amount."""
    user, _ = await async_create_user_and_token(adb)
    session, _ = await async_create_session_with_deal_state(adb, user)
    vehicle = await async_create_vehicle(adb, session.id, vin="1HGCM82633A004352")
    await adb.commit()

    fake_payload = {"error": "insufficient data"}
    with patch(
        "app.services.vehicle_intelligence.fetch_vinaudit_valuation",
        new=AsyncMock(return_value=fake_payload),
    ):
        result = await get_valuation(vehicle, adb, vin="1HGCM82633A004352")

    assert result.status == "partial"
    assert result.amount is None


# ─── Route: check-history ───


def test_check_history_route_returns_intelligence(client, db):
    """POST check-history endpoint calls service and returns intelligence response."""
    user, token = create_user_and_token(db)
    session, _ = create_session_with_deal_state(db, user)
    vehicle = create_vehicle(db, session.id, vin="1HGCM82633A004352")
    db.commit()

    async def fake_check_history(vehicle_arg, db_arg, vin=None):
        db_arg.add(
            VehicleHistoryReport(
                vehicle_id=vehicle_arg.id,
                provider="vinaudit",
                status="success",
                vin=vin or vehicle_arg.vin,
                title_brands=["Clean"],
                has_salvage=False,
            )
        )

    with patch(
        "app.routes.deals.check_history",
        new=AsyncMock(side_effect=fake_check_history),
    ):
        response = client.post(
            f"/api/deal/{session.id}/vehicles/{vehicle.id}/check-history",
            headers=auth_header(token),
            json={"vin": "1HGCM82633A004352"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["history_report"]["provider"] == "vinaudit"


def test_check_history_route_503_on_provider_error(client, db):
    """POST check-history returns 503 when provider is not configured."""
    user, token = create_user_and_token(db)
    session, _ = create_session_with_deal_state(db, user)
    vehicle = create_vehicle(db, session.id, vin="1HGCM82633A004352")
    db.commit()

    with patch(
        "app.routes.deals.check_history",
        new=AsyncMock(
            side_effect=ProviderConfigurationError("VINAUDIT_API_KEY is not configured")
        ),
    ):
        response = client.post(
            f"/api/deal/{session.id}/vehicles/{vehicle.id}/check-history",
            headers=auth_header(token),
            json={"vin": "1HGCM82633A004352"},
        )

    assert response.status_code == 503


# ─── Route: get-valuation ───


def test_get_valuation_route_returns_intelligence(client, db):
    """POST get-valuation endpoint calls service and returns intelligence response."""
    user, token = create_user_and_token(db)
    session, _ = create_session_with_deal_state(db, user)
    vehicle = create_vehicle(db, session.id, vin="1HGCM82633A004352")
    db.commit()

    async def fake_get_valuation(vehicle_arg, db_arg, vin=None):
        db_arg.add(
            VehicleValuation(
                vehicle_id=vehicle_arg.id,
                provider="vinaudit",
                status="success",
                vin=vin or vehicle_arg.vin,
                amount=19500,
            )
        )

    with patch(
        "app.routes.deals.get_valuation",
        new=AsyncMock(side_effect=fake_get_valuation),
    ):
        response = client.post(
            f"/api/deal/{session.id}/vehicles/{vehicle.id}/get-valuation",
            headers=auth_header(token),
            json={"vin": "1HGCM82633A004352"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["valuation"]["amount"] == 19500


def test_get_valuation_route_503_on_provider_error(client, db):
    """POST get-valuation returns 503 when provider is not configured."""
    user, token = create_user_and_token(db)
    session, _ = create_session_with_deal_state(db, user)
    vehicle = create_vehicle(db, session.id, vin="1HGCM82633A004352")
    db.commit()

    with patch(
        "app.routes.deals.get_valuation",
        new=AsyncMock(
            side_effect=ProviderConfigurationError("VINAUDIT_API_KEY is not configured")
        ),
    ):
        response = client.post(
            f"/api/deal/{session.id}/vehicles/{vehicle.id}/get-valuation",
            headers=auth_header(token),
            json={"vin": "1HGCM82633A004352"},
        )

    assert response.status_code == 503


# ─── Route: upsert-from-vin edge cases ───


def test_upsert_vehicle_from_vin_invalid_vin(client, db):
    """POST upsert-from-vin returns 400 for an invalid VIN."""
    user, token = create_user_and_token(db)
    session, _ = create_session_with_deal_state(db, user)
    db.commit()

    response = client.post(
        f"/api/deal/{session.id}/vehicles/upsert-from-vin",
        headers=auth_header(token),
        json={"vin": "ABC12"},
    )

    assert response.status_code == 400


def test_upsert_vehicle_from_vin_returns_existing_when_same_vin(client, db):
    """POST upsert-from-vin returns existing vehicle when VIN already exists in session."""
    user, token = create_user_and_token(db)
    session, deal_state = create_session_with_deal_state(db, user)
    vehicle = create_vehicle(db, session.id, vin="1HGCM82633A004352")
    from app.models.deal import Deal

    deal = Deal(session_id=session.id, vehicle_id=vehicle.id)
    db.add(deal)
    db.flush()
    deal_state.active_deal_id = deal.id
    db.commit()

    response = client.post(
        f"/api/deal/{session.id}/vehicles/upsert-from-vin",
        headers=auth_header(token),
        json={"vin": "1HGCM82633A004352"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == vehicle.id


# ─── Route: decode-vin error handling ───


def test_decode_vin_route_400_on_intelligence_error(client, db):
    """POST decode-vin returns 400 when the service raises VehicleIntelligenceError."""
    user, token = create_user_and_token(db)
    session, _ = create_session_with_deal_state(db, user)
    vehicle = create_vehicle(db, session.id, vin="1HGCM82633A004352")
    db.commit()

    with patch(
        "app.routes.deals.decode_vin",
        new=AsyncMock(side_effect=VehicleIntelligenceError("Bad VIN")),
    ):
        response = client.post(
            f"/api/deal/{session.id}/vehicles/{vehicle.id}/decode-vin",
            headers=auth_header(token),
            json={"vin": "1HGCM82633A004352"},
        )

    assert response.status_code == 400


def test_decode_vin_route_503_on_provider_error(client, db):
    """POST decode-vin returns 503 when the provider is not configured."""
    user, token = create_user_and_token(db)
    session, _ = create_session_with_deal_state(db, user)
    vehicle = create_vehicle(db, session.id, vin="1HGCM82633A004352")
    db.commit()

    with patch(
        "app.routes.deals.decode_vin",
        new=AsyncMock(side_effect=ProviderConfigurationError("NHTSA unreachable")),
    ):
        response = client.post(
            f"/api/deal/{session.id}/vehicles/{vehicle.id}/decode-vin",
            headers=auth_header(token),
            json={"vin": "1HGCM82633A004352"},
        )

    assert response.status_code == 503


# ─── Route: confirm-identity rejection ───


def test_confirm_vehicle_identity_rejected_clears_fields(client, db):
    """POST confirm-identity with status=rejected clears confirmation fields."""
    user, token = create_user_and_token(db)
    session, deal_state = create_session_with_deal_state(db, user)
    vehicle = create_vehicle(
        db,
        session.id,
        vin="1HGCM82633A004352",
        identity_confirmation_status="confirmed",
        identity_confirmation_source="user_confirmed_decode",
    )
    from app.models.deal import Deal
    from app.models.message import Message

    deal = Deal(session_id=session.id, vehicle_id=vehicle.id)
    db.add(deal)
    db.flush()
    deal_state.active_deal_id = deal.id
    db.add(
        Message(
            session_id=session.id,
            role="assistant",
            content="Checking this vehicle.",
        )
    )
    db.commit()

    with patch(
        "app.routes.deals.generate_ai_panel_cards",
        new=AsyncMock(return_value=[]),
    ):
        response = client.post(
            f"/api/deal/{session.id}/vehicles/{vehicle.id}/confirm-identity",
            headers=auth_header(token),
            json={"status": "rejected"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["identity_confirmation_status"] == "rejected"
    assert payload["identity_confirmed_at"] is None
    assert payload["identity_confirmation_source"] is None
