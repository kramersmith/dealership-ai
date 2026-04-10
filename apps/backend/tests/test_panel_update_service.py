"""Unit tests for panel update policy resolution."""

import pytest
from app.models.enums import InsightsUpdateMode
from app.models.user_settings import UserSettings
from app.services.panel_update_service import (
    PanelUpdatePolicy,
    resolve_panel_update_policy,
)

from tests.conftest import async_create_user


@pytest.mark.asyncio
async def test_resolve_policy_defaults_to_live_for_new_user(adb):
    user = await async_create_user(adb)
    policy = await resolve_panel_update_policy(adb, user=user)
    assert policy.mode == InsightsUpdateMode.LIVE
    assert policy.live_updates_enabled is True


@pytest.mark.asyncio
async def test_resolve_policy_returns_paused_when_setting_is_paused(adb):
    user = await async_create_user(adb)
    settings_row = UserSettings(
        user_id=user.id,
        insights_update_mode=InsightsUpdateMode.PAUSED.value,
    )
    adb.add(settings_row)
    await adb.flush()

    policy = await resolve_panel_update_policy(adb, user=user)
    assert policy.mode == InsightsUpdateMode.PAUSED
    assert policy.live_updates_enabled is False


@pytest.mark.asyncio
async def test_resolve_policy_by_user_id(adb):
    user = await async_create_user(adb)
    policy = await resolve_panel_update_policy(adb, user_id=user.id)
    assert policy.mode == InsightsUpdateMode.LIVE
    assert policy.live_updates_enabled is True


@pytest.mark.asyncio
async def test_resolve_policy_raises_when_neither_user_nor_user_id(adb):
    with pytest.raises(ValueError, match="Either user or user_id is required"):
        await resolve_panel_update_policy(adb)


def test_panel_update_policy_dataclass():
    live = PanelUpdatePolicy(mode=InsightsUpdateMode.LIVE)
    assert live.live_updates_enabled is True

    paused = PanelUpdatePolicy(mode=InsightsUpdateMode.PAUSED)
    assert paused.live_updates_enabled is False
