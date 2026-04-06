"""Fingerprints for Anthropic prompt-cache-relevant request slices.

Chat monitoring uses a **stable** slice (static system prompt + tools + model + betas)
so inner-step changes to continuation blocks or ``tool_choice`` do not emit break logs.
A full snapshot helper (including ``tool_choice``) remains for tests.

Out of scope: correlating breaks with cache-read token counts and a dedicated
``cache_control``-placement fingerprint.

Logs at INFO include only hashes and component names (see logging guidelines).
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

# Beta header names affecting the Messages API, when we pass them explicitly.
# Empty until the backend wires betas into the SDK; keeps hashing forward-compatible.
DEFAULT_PROMPT_CACHE_BETAS: tuple[str, ...] = ()

_COMPONENT_KEYS = ("system", "tools", "model", "betas", "tool_choice")

# Chat: only fingerprint slices that should stay fixed across inner steps and turns
# unless the deployment or tool registry changes. Per-step `tool_choice` and
# continuation system blocks are intentional and must not spam INFO break logs.
CHAT_STABLE_CACHE_KEYS = ("system", "tools", "model", "betas")


def strip_cache_control(value: Any) -> Any:
    """Recursively drop cache_control keys so content hashes stay stable."""
    if isinstance(value, dict):
        return {
            k: strip_cache_control(v) for k, v in value.items() if k != "cache_control"
        }
    if isinstance(value, list):
        return [strip_cache_control(v) for v in value]
    return value


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def sha256_hex(data: str) -> str:
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def _hash_payload(payload: Any) -> str:
    return sha256_hex(canonical_json(payload))


def build_chat_stable_cache_snapshot(
    *,
    base_system: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    model: str,
    betas: tuple[str, ...] | None = None,
) -> dict[str, str]:
    """Fingerprint cache-stable chat slices (base system + tools + model + betas).

    Uses the static ``build_system_prompt()`` output only — not per-step continuation
    blocks or ``tool_choice``, which the step loop varies on purpose.
    """
    betas = betas if betas is not None else DEFAULT_PROMPT_CACHE_BETAS
    stripped_system = strip_cache_control(base_system)
    stripped_tools = strip_cache_control(tools)
    sorted_betas = sorted(betas)

    parts = {
        "system": _hash_payload(stripped_system),
        "tools": _hash_payload(stripped_tools),
        "model": _hash_payload(model),
        "betas": _hash_payload(sorted_betas),
    }
    parts["combined"] = _hash_payload({k: parts[k] for k in CHAT_STABLE_CACHE_KEYS})
    return parts


def build_chat_prompt_cache_snapshot(
    *,
    system: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    model: str,
    tool_choice: dict[str, Any] | None,
    betas: tuple[str, ...] | None = None,
) -> dict[str, str]:
    """Full per-request fingerprint including tool_choice (tests / diagnostics)."""
    betas = betas if betas is not None else DEFAULT_PROMPT_CACHE_BETAS
    stripped_system = strip_cache_control(system)
    stripped_tools = strip_cache_control(tools)
    choice = tool_choice if tool_choice is not None else {}
    sorted_betas = sorted(betas)

    parts = {
        "system": _hash_payload(stripped_system),
        "tools": _hash_payload(stripped_tools),
        "model": _hash_payload(model),
        "betas": _hash_payload(sorted_betas),
        "tool_choice": _hash_payload(choice),
    }
    parts["combined"] = _hash_payload({k: parts[k] for k in _COMPONENT_KEYS})
    return parts


def build_panel_static_prompt_cache_snapshot(
    *,
    static_panel_prompt: str,
    model: str,
    betas: tuple[str, ...] | None = None,
) -> dict[str, str]:
    """Fingerprint static panel instructions + model (not per-request deal JSON)."""
    betas = betas if betas is not None else DEFAULT_PROMPT_CACHE_BETAS
    sorted_betas = sorted(betas)
    parts = {
        "system": _hash_payload(static_panel_prompt),
        "tools": _hash_payload([]),
        "model": _hash_payload(model),
        "betas": _hash_payload(sorted_betas),
        "tool_choice": _hash_payload({}),
    }
    parts["combined"] = _hash_payload({k: parts[k] for k in _COMPONENT_KEYS})
    return parts


def prompt_cache_components_changed(
    prior: dict[str, str] | None,
    current: dict[str, str],
    *,
    component_keys: tuple[str, ...] = _COMPONENT_KEYS,
) -> list[str]:
    """Return component names whose digests differ; ignores keys not in ``component_keys``."""
    if prior is None:
        return []
    changed: list[str] = []
    for key in component_keys:
        if prior.get(key) != current.get(key):
            changed.append(key)
    return changed


def is_prompt_cache_break(
    prior: dict[str, str] | None,
    current: dict[str, str],
    *,
    component_keys: tuple[str, ...] = _COMPONENT_KEYS,
) -> bool:
    return bool(
        prior is not None
        and prompt_cache_components_changed(
            prior, current, component_keys=component_keys
        )
    )


def log_prompt_cache_break(
    logger: logging.Logger,
    *,
    session_id: str | None,
    phase: str,
    step: int | None,
    prior: dict[str, str],
    current: dict[str, str],
    changed_components: list[str],
) -> None:
    """INFO: hashes and labels only — no prompt or tool body text."""
    parts: list[str] = [
        "Prompt cache break detected:",
        f"phase={phase}",
        f"session_id={session_id}",
        f"step={step}",
        f"components={','.join(changed_components)}",
        f"combined_prev={prior.get('combined', '')}",
        f"combined_curr={current.get('combined', '')}",
    ]
    for name in changed_components:
        parts.append(f"{name}_prev={prior.get(name, '')}")
        parts.append(f"{name}_curr={current.get(name, '')}")
    logger.info(" ".join(parts))
