from unittest.mock import patch

from app.core.security import verify_password
from app.db.seed import SEED_USERS, seed_users
from app.models.user import User


def test_seed_users_creates_all_users(db):
    seed_users(db)

    users = db.query(User).all()
    assert len(users) == len(SEED_USERS)

    emails = {u.email for u in users}
    for expected in SEED_USERS:
        assert expected["email"] in emails


def test_seed_users_sets_correct_fields(db):
    seed_users(db)

    for expected in SEED_USERS:
        user = db.query(User).filter(User.email == expected["email"]).first()
        assert user is not None
        assert user.role == expected["role"]
        assert user.display_name == expected["display_name"]
        assert verify_password(expected["password"], user.hashed_password)


def test_seed_users_is_idempotent(db):
    seed_users(db)
    seed_users(db)

    users = db.query(User).all()
    assert len(users) == len(SEED_USERS)


def test_seed_users_skips_existing_without_overwrite(db):
    seed_users(db)
    original_user = db.query(User).filter(User.email == SEED_USERS[0]["email"]).first()
    original_id = original_user.id

    seed_users(db)

    same_user = db.query(User).filter(User.email == SEED_USERS[0]["email"]).first()
    assert same_user.id == original_id


@patch("app.db.seed.settings")
def test_seed_users_skipped_in_production(mock_settings, db):
    mock_settings.ENV = "production"
    seed_users(db)

    users = db.query(User).all()
    assert len(users) == 0
