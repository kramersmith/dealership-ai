from app.models.enums import InsightsUpdateMode

from tests.conftest import auth_header, create_user_and_token


def test_login_returns_user_settings(client, db):
    _, _token = create_user_and_token(db)

    response = client.post(
        "/api/auth/login",
        json={"email": "test@example.com", "password": "password"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["settings"] == {
        "insights_update_mode": "live",
    }


def test_signup_returns_user_settings(client, db):
    response = client.post(
        "/api/auth/signup",
        json={
            "email": "newuser@example.com",
            "password": "password",
            "role": "buyer",
        },
    )
    assert response.status_code == 201
    payload = response.json()
    assert "settings" in payload
    assert payload["settings"] == {
        "insights_update_mode": "live",
    }


def test_get_settings_returns_defaults_for_new_user(client, db):
    _, token = create_user_and_token(db)

    response = client.get("/api/auth/settings", headers=auth_header(token))
    assert response.status_code == 200
    assert response.json() == {
        "insights_update_mode": "live",
    }


def test_user_settings_can_be_updated(client, db):
    _, token = create_user_and_token(db)

    initial = client.get("/api/auth/settings", headers=auth_header(token))
    assert initial.status_code == 200
    assert initial.json() == {
        "insights_update_mode": "live",
    }

    updated = client.patch(
        "/api/auth/settings",
        json={"insights_update_mode": "paused"},
        headers=auth_header(token),
    )
    assert updated.status_code == 200
    assert updated.json() == {
        "insights_update_mode": "paused",
    }

    verify = client.get("/api/auth/settings", headers=auth_header(token))
    assert verify.status_code == 200
    assert verify.json() == {
        "insights_update_mode": "paused",
    }


def test_patch_settings_rejects_invalid_enum_value(client, db):
    _, token = create_user_and_token(db)

    response = client.patch(
        "/api/auth/settings",
        json={"insights_update_mode": "invalid_value"},
        headers=auth_header(token),
    )
    assert response.status_code == 422


def test_patch_settings_accepts_legacy_auto_value(client, db):
    """Legacy 'auto' value should map to 'live' via InsightsUpdateMode._missing_."""
    _, token = create_user_and_token(db)

    response = client.patch(
        "/api/auth/settings",
        json={"insights_update_mode": "auto"},
        headers=auth_header(token),
    )
    assert response.status_code == 200
    assert response.json()["insights_update_mode"] == "live"


def test_patch_settings_accepts_legacy_manual_value(client, db):
    """Legacy 'manual' value should map to 'paused' via InsightsUpdateMode._missing_."""
    _, token = create_user_and_token(db)

    response = client.patch(
        "/api/auth/settings",
        json={"insights_update_mode": "manual"},
        headers=auth_header(token),
    )
    assert response.status_code == 200
    assert response.json()["insights_update_mode"] == "paused"


def test_get_settings_requires_auth(client, db):
    response = client.get("/api/auth/settings")
    assert response.status_code in (401, 403)


def test_patch_settings_requires_auth(client, db):
    response = client.patch(
        "/api/auth/settings",
        json={"insights_update_mode": "paused"},
    )
    assert response.status_code in (401, 403)


# ─── InsightsUpdateMode enum unit tests ───


def test_insights_update_mode_missing_maps_auto_to_live():
    assert InsightsUpdateMode("auto") == InsightsUpdateMode.LIVE


def test_insights_update_mode_missing_maps_manual_to_paused():
    assert InsightsUpdateMode("manual") == InsightsUpdateMode.PAUSED


def test_insights_update_mode_direct_values():
    assert InsightsUpdateMode("live") == InsightsUpdateMode.LIVE
    assert InsightsUpdateMode("paused") == InsightsUpdateMode.PAUSED


def test_insights_update_mode_rejects_unknown():
    try:
        InsightsUpdateMode("unknown_value")
        assert False, "Should have raised ValueError"
    except ValueError:
        pass
