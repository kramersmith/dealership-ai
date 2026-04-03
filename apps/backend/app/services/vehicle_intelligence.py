import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.enums import IntelligenceProvider, IntelligenceStatus
from app.models.vehicle import Vehicle
from app.models.vehicle_decode import VehicleDecode
from app.models.vehicle_history_report import VehicleHistoryReport
from app.models.vehicle_valuation import VehicleValuation
from app.schemas.deal import (
    VehicleDecodeResponse,
    VehicleHistoryReportResponse,
    VehicleIntelligenceResponse,
    VehicleValuationResponse,
)

logger = logging.getLogger(__name__)

DECODE_TTL = timedelta(days=180)
HISTORY_TTL = timedelta(days=30)
VALUATION_TTL = timedelta(days=2)

VIN_LENGTH = 17
VIN_INVALID_CHARS = ("I", "O", "Q")


class VehicleIntelligenceError(Exception):
    pass


class ProviderConfigurationError(VehicleIntelligenceError):
    pass


@dataclass
class LatestVehicleIntelligence:
    decode: VehicleDecode | None
    history_report: VehicleHistoryReport | None
    valuation: VehicleValuation | None


def normalize_vin(vin: str) -> str:
    normalized = "".join(ch for ch in vin.upper().strip() if ch.isalnum())
    if len(normalized) != VIN_LENGTH:
        raise VehicleIntelligenceError(f"VIN must be {VIN_LENGTH} characters")
    if any(ch in normalized for ch in VIN_INVALID_CHARS):
        raise VehicleIntelligenceError("VIN contains invalid characters")
    return normalized


def _is_fresh(expires_at: datetime | None) -> bool:
    if expires_at is None:
        return False
    # SQLite stores datetimes without timezone info; treat naive as UTC.
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at > datetime.now(timezone.utc)


async def _latest(db: AsyncSession, model_cls, *filters):
    result = await db.execute(
        select(model_cls)
        .where(*filters)
        .order_by(model_cls.fetched_at.desc().nullslast(), model_cls.created_at.desc())
    )
    return result.scalar_one_or_none()


async def get_latest_vehicle_intelligence(
    vehicle_id: str, db: AsyncSession
) -> LatestVehicleIntelligence:
    return LatestVehicleIntelligence(
        decode=await _latest(db, VehicleDecode, VehicleDecode.vehicle_id == vehicle_id),
        history_report=await _latest(
            db,
            VehicleHistoryReport,
            VehicleHistoryReport.vehicle_id == vehicle_id,
        ),
        valuation=await _latest(
            db, VehicleValuation, VehicleValuation.vehicle_id == vehicle_id
        ),
    )


async def build_vehicle_intelligence_response(
    vehicle_id: str, db: AsyncSession
) -> VehicleIntelligenceResponse:
    latest = await get_latest_vehicle_intelligence(vehicle_id, db)
    return VehicleIntelligenceResponse(
        decode=VehicleDecodeResponse.model_validate(latest.decode)
        if latest.decode
        else None,
        history_report=VehicleHistoryReportResponse.model_validate(
            latest.history_report
        )
        if latest.history_report
        else None,
        valuation=VehicleValuationResponse.model_validate(latest.valuation)
        if latest.valuation
        else None,
    )


def _merge_decoded_fields(vehicle: Vehicle, decode: VehicleDecode) -> None:
    vehicle.vin = decode.vin
    if vehicle.year is None and decode.year is not None:
        vehicle.year = decode.year
    if not vehicle.make and decode.make:
        vehicle.make = decode.make
    if not vehicle.model and decode.model:
        vehicle.model = decode.model
    if not vehicle.trim and decode.trim:
        vehicle.trim = decode.trim
    if not vehicle.engine and decode.engine:
        vehicle.engine = decode.engine


def _pick(payload: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = payload.get(key)
        if value not in (None, "", "Not Applicable", "0"):
            return str(value)
    return None


def _parse_int(value: Any) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


async def _fetch_json(url: str, params: dict[str, Any]) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20.0) as client:
        try:
            response = await client.get(url, params=params)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            logger.error(
                "vehicle_intelligence.http_error status=%s body=%s",
                exc.response.status_code,
                exc.response.text[:500],
            )
            raise VehicleIntelligenceError(
                f"Provider returned HTTP {exc.response.status_code}"
            ) from None
        except httpx.RequestError as exc:
            logger.error(
                "vehicle_intelligence.request_error type=%s",
                type(exc).__name__,
            )
            raise VehicleIntelligenceError(
                f"Provider request failed: {type(exc).__name__}"
            ) from None
        return response.json()


async def fetch_vpic_decode(vin: str) -> dict[str, Any]:
    payload = await _fetch_json(
        f"{settings.NHTSA_VPIC_BASE_URL}/DecodeVinValues/{vin}", {"format": "json"}
    )
    results = payload.get("Results") or []
    if not results:
        raise VehicleIntelligenceError("VIN decode returned no results")
    return results[0]


async def fetch_vinaudit_history(vin: str) -> dict[str, Any]:
    if not settings.VINAUDIT_API_KEY:
        raise ProviderConfigurationError("VINAUDIT_API_KEY is not configured")
    return await _fetch_json(
        settings.VINAUDIT_HISTORY_URL,
        {"key": settings.VINAUDIT_API_KEY, "vin": vin, "format": "json"},
    )


async def fetch_vinaudit_valuation(vin: str) -> dict[str, Any]:
    if not settings.VINAUDIT_API_KEY:
        raise ProviderConfigurationError("VINAUDIT_API_KEY is not configured")
    return await _fetch_json(
        settings.VINAUDIT_VALUATION_URL,
        {"key": settings.VINAUDIT_API_KEY, "vin": vin, "format": "json"},
    )


async def decode_vin(
    vehicle: Vehicle,
    db: AsyncSession,
    vin: str | None = None,
    force_refresh: bool = False,
) -> VehicleDecode:
    normalized_vin = normalize_vin(vin or vehicle.vin or "")
    latest = await _latest(
        db,
        VehicleDecode,
        VehicleDecode.vehicle_id == vehicle.id,
        VehicleDecode.vin == normalized_vin,
    )
    if latest and not force_refresh and _is_fresh(latest.expires_at):
        _merge_decoded_fields(vehicle, latest)
        return latest

    requested_at = datetime.now(timezone.utc)
    payload = await fetch_vpic_decode(normalized_vin)
    fetched_at = datetime.now(timezone.utc)

    # Build a rich engine description from individual NHTSA fields
    displacement = _pick(payload, "DisplacementL")
    cylinders = _pick(payload, "EngineCylinders")
    horsepower = _pick(payload, "EngineHP")
    engine_parts = []
    if displacement:
        engine_parts.append(f"{displacement}L")
    if cylinders:
        config = _pick(payload, "EngineConfiguration")
        if config and config.startswith("V"):
            engine_parts.append(f"V{cylinders}")
        elif config and config.startswith("In-Line"):
            engine_parts.append(f"I{cylinders}")
        else:
            engine_parts.append(f"{cylinders}-cyl")
    if horsepower:
        engine_parts.append(f"({horsepower} HP)")
    engine_str = (
        " ".join(engine_parts)
        if engine_parts
        else _pick(payload, "EngineModel", "EngineConfiguration")
    )

    decode = VehicleDecode(
        vehicle_id=vehicle.id,
        provider=IntelligenceProvider.NHTSA_VPIC,
        status=IntelligenceStatus.SUCCESS
        if _pick(payload, "Make", "Model")
        else IntelligenceStatus.PARTIAL,
        vin=normalized_vin,
        year=_parse_int(payload.get("ModelYear")),
        make=_pick(payload, "Make"),
        model=_pick(payload, "Model"),
        trim=_pick(payload, "Trim", "Series"),
        engine=engine_str,
        body_type=_pick(payload, "BodyClass"),
        drivetrain=_pick(payload, "DriveType"),
        transmission=_pick(payload, "TransmissionStyle", "TransmissionSpeeds"),
        fuel_type=_pick(payload, "FuelTypePrimary"),
        source_summary="NHTSA vPIC decoded vehicle specs",
        raw_payload=payload,
        requested_at=requested_at,
        fetched_at=fetched_at,
        expires_at=fetched_at + DECODE_TTL,
    )
    db.add(decode)
    _merge_decoded_fields(vehicle, decode)
    logger.info(
        "vehicle_intelligence.decode.completed vehicle_id=%s vin=%s",
        vehicle.id,
        normalized_vin,
    )
    return decode


def _extract_title_brands(payload: dict[str, Any]) -> list[str]:
    possible = (
        payload.get("titleBrands")
        or payload.get("title_brands")
        or payload.get("brands")
    )
    if isinstance(possible, list):
        return [str(item) for item in possible if item]
    if isinstance(possible, str) and possible.strip():
        return [brand.strip() for brand in possible.split(",") if brand.strip()]
    return []


def _extract_bool(payload: dict[str, Any], *keys: str) -> bool:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"1", "true", "yes", "y"}:
                return True
            if normalized in {"0", "false", "no", "n", ""}:
                return False
    return False


async def check_history(
    vehicle: Vehicle,
    db: AsyncSession,
    vin: str | None = None,
    force_refresh: bool = False,
) -> VehicleHistoryReport:
    normalized_vin = normalize_vin(vin or vehicle.vin or "")
    latest = await _latest(
        db,
        VehicleHistoryReport,
        VehicleHistoryReport.vehicle_id == vehicle.id,
        VehicleHistoryReport.vin == normalized_vin,
    )
    if latest and not force_refresh and _is_fresh(latest.expires_at):
        return latest

    requested_at = datetime.now(timezone.utc)
    payload = await fetch_vinaudit_history(normalized_vin)
    fetched_at = datetime.now(timezone.utc)
    brands = _extract_title_brands(payload)
    report = VehicleHistoryReport(
        vehicle_id=vehicle.id,
        provider=IntelligenceProvider.VINAUDIT,
        status=IntelligenceStatus.SUCCESS if payload else IntelligenceStatus.PARTIAL,
        vin=normalized_vin,
        title_brands=brands,
        title_brand_count=len(brands),
        has_salvage=_extract_bool(payload, "salvage", "salvageRecord", "hasSalvage"),
        has_total_loss=_extract_bool(
            payload, "totalLoss", "total_loss", "hasTotalLoss"
        ),
        has_theft_record=_extract_bool(
            payload, "theftRecord", "activeTheft", "hasTheftRecord"
        ),
        has_odometer_issue=_extract_bool(
            payload, "odometerIssue", "odometer_problem", "hasOdometerIssue"
        ),
        source_summary="VinAudit official title and brand check",
        coverage_notes=payload.get("coverage_notes")
        or "NMVTIS-style title and brand coverage; not full service history.",
        raw_payload=payload,
        requested_at=requested_at,
        fetched_at=fetched_at,
        expires_at=fetched_at + HISTORY_TTL,
    )
    db.add(report)
    logger.info(
        "vehicle_intelligence.history.completed vehicle_id=%s vin=%s",
        vehicle.id,
        normalized_vin,
    )
    return report


def _extract_amount(payload: dict[str, Any]) -> float | None:
    for key in ("market_value", "marketValue", "price", "value", "average_price"):
        value = payload.get(key)
        if value in (None, ""):
            continue
        try:
            return float(str(value))
        except (TypeError, ValueError):
            continue
    return None


async def get_valuation(
    vehicle: Vehicle,
    db: AsyncSession,
    vin: str | None = None,
    force_refresh: bool = False,
) -> VehicleValuation:
    normalized_vin = normalize_vin(vin or vehicle.vin or "")
    latest = await _latest(
        db,
        VehicleValuation,
        VehicleValuation.vehicle_id == vehicle.id,
        VehicleValuation.vin == normalized_vin,
    )
    if latest and not force_refresh and _is_fresh(latest.expires_at):
        return latest

    requested_at = datetime.now(timezone.utc)
    payload = await fetch_vinaudit_valuation(normalized_vin)
    fetched_at = datetime.now(timezone.utc)
    valuation = VehicleValuation(
        vehicle_id=vehicle.id,
        provider=IntelligenceProvider.VINAUDIT,
        status=IntelligenceStatus.SUCCESS
        if _extract_amount(payload) is not None
        else IntelligenceStatus.PARTIAL,
        vin=normalized_vin,
        amount=_extract_amount(payload),
        currency=str(payload.get("currency") or "USD"),
        valuation_label="Market Asking Price Estimate",
        source_summary=payload.get("source_summary")
        or "VinAudit listing-based market asking price estimate",
        raw_payload=payload,
        requested_at=requested_at,
        fetched_at=fetched_at,
        expires_at=fetched_at + VALUATION_TTL,
    )
    db.add(valuation)
    logger.info(
        "vehicle_intelligence.valuation.completed vehicle_id=%s vin=%s",
        vehicle.id,
        normalized_vin,
    )
    return valuation
