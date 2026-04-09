from __future__ import annotations

import re
from datetime import datetime, timezone

from app.models.enums import VehicleRole

_MODEL_YEAR_IN_TEXT = re.compile(r"\b(19[89]\d|20\d{2})\b")
_MILEAGE_EXPLICIT = re.compile(r"(?i)\b(\d{1,3}(?:,\d{3})+|\d{5,7})\s*(?:miles|mi)\b")
_MILEAGE_K_MILES = re.compile(r"(?i)\b(\d{2,3})k\s+miles\b")


def current_utc_date_iso() -> str:
    """Return today's UTC date (ISO) for temporal grounding."""
    return datetime.now(timezone.utc).date().isoformat()


def calendar_years_since_model_year(model_year: int, as_of_iso: str) -> int | None:
    """Whole calendar years from model year to as_of year.

    Returns min 1 for same-year model year.
    """
    try:
        ref_year = int(as_of_iso.split("-", 1)[0])
    except (ValueError, IndexError):
        return None
    if model_year > ref_year:
        return None
    return max(1, ref_year - model_year)


def _vehicle_year(vehicle: dict) -> int | None:
    """Extract integer model year from a vehicle dict, or None."""
    year = vehicle.get("year")
    return int(year) if isinstance(year, int) else None


def _vehicle_mileage(vehicle: dict) -> int | None:
    mileage = vehicle.get("mileage")
    if isinstance(mileage, int) and mileage > 0:
        return mileage
    return None


def _select_primary_vehicle(prompt_deal_state: dict) -> dict | None:
    """Return the active deal's vehicle dict, else the first primary-role vehicle, else the first."""
    vehicles = prompt_deal_state.get("vehicles") or []
    if not vehicles:
        return None
    active_deal_id = prompt_deal_state.get("active_deal_id")
    deals = prompt_deal_state.get("deals") or []
    active_vehicle_id: str | None = None
    if active_deal_id and deals:
        for deal in deals:
            if isinstance(deal, dict) and deal.get("id") == active_deal_id:
                active_vehicle_id = deal.get("vehicle_id")
                break
    if active_vehicle_id:
        for vehicle in vehicles:
            if isinstance(vehicle, dict) and vehicle.get("id") == active_vehicle_id:
                return vehicle
    for vehicle in vehicles:
        if (
            isinstance(vehicle, dict)
            and vehicle.get("role") == VehicleRole.PRIMARY.value
        ):
            return vehicle
    first_vehicle = vehicles[0]
    return first_vehicle if isinstance(first_vehicle, dict) else None


def primary_vehicle_mileage(
    prompt_deal_state: dict,
) -> int | None:
    """Odometer for the active deal's vehicle, else first primary-role vehicle."""
    vehicle = _select_primary_vehicle(prompt_deal_state)
    return _vehicle_mileage(vehicle) if vehicle else None


def primary_vehicle_model_year(
    prompt_deal_state: dict,
) -> int | None:
    """Model year for the active deal's vehicle, else first primary-role vehicle."""
    vehicle = _select_primary_vehicle(prompt_deal_state)
    return _vehicle_year(vehicle) if vehicle else None


def _annualized_miles_clause(odometer: int, year_span: int) -> str:
    approx = round(odometer / year_span)
    return (
        f"Computed annualized miles: {odometer:,} ÷ {year_span} ≈ {approx:,} mi/yr — "
        "use this divisor and figure in visible chat and in tools; do not substitute "
        "a different year count."
    )


def build_temporal_hint_line(
    prompt_deal_state: dict | None, today_iso: str
) -> str | None:
    """Model-year age hint line for chat and panel prompts."""
    if not prompt_deal_state:
        return None
    model_year = primary_vehicle_model_year(prompt_deal_state)
    year_span = (
        calendar_years_since_model_year(model_year, today_iso)
        if model_year is not None
        else None
    )
    if model_year is None or year_span is None:
        return None
    odometer = primary_vehicle_mileage(prompt_deal_state)
    base = (
        f"Temporal hint: primary vehicle model year {model_year} "
        f"vs date above ⇒ ~{year_span} full "
        "calendar year(s) since that model year. "
        "Use for stated age (e.g. "
        f'"~{year_span}-year-old" or '
        f'"about {year_span} years since that model year") '
        "and for miles/year (odometer ÷ that span) unless the "
        "buyer gave an actual in-service or purchase date."
    )
    if odometer is not None:
        return base + " " + _annualized_miles_clause(odometer, year_span)
    return base


def parse_model_year_from_user_text(text: str) -> int | None:
    """Best-effort model year for provisional temporal grounding."""
    for match in _MODEL_YEAR_IN_TEXT.finditer(text):
        candidate_year = int(match.group(1))
        if 1980 <= candidate_year <= 2039:
            return candidate_year
    return None


def parse_mileage_from_user_text(text: str) -> int | None:
    """Best-effort odometer from the current user message (avoids bare '34k' prices)."""
    explicit_match = _MILEAGE_EXPLICIT.search(text)
    if explicit_match:
        return int(explicit_match.group(1).replace(",", ""))
    thousands_miles_match = _MILEAGE_K_MILES.search(text)
    if thousands_miles_match:
        return int(thousands_miles_match.group(1)) * 1000
    return None


def build_temporal_hint_line_from_user_text(
    user_text: str | None, today_iso: str
) -> str | None:
    """When deal state has no vehicle yet, infer model-year span + miles/yr from user text."""
    if not user_text or not user_text.strip():
        return None
    model_year = parse_model_year_from_user_text(user_text)
    odometer = parse_mileage_from_user_text(user_text)
    if model_year is None or odometer is None:
        return None
    year_span = calendar_years_since_model_year(model_year, today_iso)
    if year_span is None:
        return None
    return (
        "Temporal hint (from this user message): "
        f"model year {model_year} vs date above ⇒ ~{year_span} full calendar year(s) "
        "since that model year. " + _annualized_miles_clause(odometer, year_span)
    )


def build_prompt_deal_state(deal_state_dict: dict | None) -> dict | None:
    """Return the source-of-truth subset of deal state used in model prompts."""
    if not deal_state_dict:
        return deal_state_dict

    prompt_state = dict(deal_state_dict)
    prompt_state.pop("ai_panel_cards", None)
    return prompt_state
