from unittest.mock import patch

from app.core.security import verify_password
from app.db.seed import SEED_USERS, seed_users
from app.models.user import User
from sqlalchemy import select


async def test_seed_users_creates_all_users(adb):
    await seed_users(adb)

    users = (await adb.execute(select(User))).scalars().all()
    assert len(users) == len(SEED_USERS)

    emails = {u.email for u in users}
    for expected in SEED_USERS:
        assert expected["email"] in emails


async def test_seed_users_sets_correct_fields(adb):
    await seed_users(adb)

    for expected in SEED_USERS:
        user = (
            await adb.execute(select(User).where(User.email == expected["email"]))
        ).scalar_one_or_none()
        assert user is not None
        assert user.role == expected["role"]
        assert user.display_name == expected["display_name"]
        assert verify_password(expected["password"], user.hashed_password)


async def test_seed_users_is_idempotent(adb):
    await seed_users(adb)
    await seed_users(adb)

    users = (await adb.execute(select(User))).scalars().all()
    assert len(users) == len(SEED_USERS)


async def test_seed_users_skips_existing_without_overwrite(adb):
    await seed_users(adb)
    original_user = (
        await adb.execute(select(User).where(User.email == SEED_USERS[0]["email"]))
    ).scalar_one_or_none()
    original_id = original_user.id

    await seed_users(adb)

    same_user = (
        await adb.execute(select(User).where(User.email == SEED_USERS[0]["email"]))
    ).scalar_one_or_none()
    assert same_user.id == original_id


@patch("app.db.seed.settings")
async def test_seed_users_skipped_in_production(mock_settings, adb):
    mock_settings.ENV = "production"
    await seed_users(adb)

    users = (await adb.execute(select(User))).scalars().all()
    assert len(users) == 0
