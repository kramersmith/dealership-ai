import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import InsightsUpdateMode
from app.models.user import User
from app.models.user_settings import UserSettings
from app.schemas.auth import UserSettingsResponse

logger = logging.getLogger(__name__)


def _build_default_user_settings(user_id: str) -> UserSettings:
    return UserSettings(
        user_id=user_id,
        insights_update_mode=InsightsUpdateMode.LIVE,
    )


async def get_or_create_user_settings(
    db: AsyncSession,
    user: User | None = None,
    *,
    user_id: str | None = None,
) -> UserSettings:
    resolved_user_id = user.id if user is not None else user_id
    if resolved_user_id is None:
        raise ValueError("Either user or user_id is required")

    result = await db.execute(
        select(UserSettings).where(UserSettings.user_id == resolved_user_id)
    )
    settings_row = result.scalar_one_or_none()
    if settings_row is not None:
        return settings_row

    settings_row = _build_default_user_settings(user_id=resolved_user_id)
    db.add(settings_row)
    await db.flush()
    logger.info("Created default user settings: user_id=%s", resolved_user_id)
    return settings_row


def to_user_settings_response(settings_row: UserSettings) -> UserSettingsResponse:
    return UserSettingsResponse(
        insights_update_mode=InsightsUpdateMode(settings_row.insights_update_mode),
    )
