"""Canonical recap beat payload keys + migration from legacy title/narrative."""

from __future__ import annotations

WORLD_KEY = "world"
APP_KEY = "app"
LEGACY_TITLE = "title"
LEGACY_NARRATIVE = "narrative"


def read_world_app(payload: object) -> tuple[str, str]:
    """Return (world, app) from canonical or legacy timeline event payload."""
    if not isinstance(payload, dict):
        return "", ""
    pl = payload
    w = str(pl.get(WORLD_KEY, "")).strip()[:4000]
    a = str(pl.get(APP_KEY, "")).strip()[:4000]
    if w or a:
        return w, a
    t = str(pl.get(LEGACY_TITLE, "")).strip()
    n = str(pl.get(LEGACY_NARRATIVE, "")).strip()
    if not t and not n:
        return "", ""
    if t and n:
        return f"{t} {n}".strip()[:4000], ""
    return (t or n)[:4000], ""
