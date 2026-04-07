from __future__ import annotations

from datetime import datetime, timezone

from app.models.enums import VehicleRole


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


def primary_vehicle_model_year(
    prompt_deal_state: dict,
) -> int | None:
    """Model year for the active deal's vehicle, else first primary-role vehicle."""
    vehicles = prompt_deal_state.get("vehicles") or []
    if not vehicles:
        return None
    active_deal_id = prompt_deal_state.get("active_deal_id")
    deals = prompt_deal_state.get("deals") or []
    active_vehicle_id = None
    if active_deal_id and deals:
        for deal in deals:
            if isinstance(deal, dict) and deal.get("id") == active_deal_id:
                active_vehicle_id = deal.get("vehicle_id")
                break
    if active_vehicle_id:
        for v in vehicles:
            if isinstance(v, dict) and v.get("id") == active_vehicle_id:
                return _vehicle_year(v)
    for v in vehicles:
        if isinstance(v, dict) and v.get("role") == VehicleRole.PRIMARY.value:
            return _vehicle_year(v)
    if isinstance(vehicles[0], dict):
        return _vehicle_year(vehicles[0])
    return None


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
    return (
        f"Temporal hint: primary vehicle model year {model_year} "
        f"vs date above ⇒ ~{year_span} full "
        "calendar year(s) since that model year. "
        "Use for stated age (e.g. "
        f'"~{year_span}-year-old" or '
        f'"about {year_span} years since that model year") '
        "and for miles/year (odometer ÷ that span) unless the "
        "buyer gave an actual in-service or purchase date."
    )


def build_prompt_deal_state(deal_state_dict: dict | None) -> dict | None:
    """Return the source-of-truth subset of deal state used in model prompts."""
    if not deal_state_dict:
        return deal_state_dict

    prompt_state = dict(deal_state_dict)
    prompt_state.pop("ai_panel_cards", None)
    return prompt_state
