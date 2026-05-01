"""Tests for app.core.security — covers PyJWT migration (was python-jose).

Verifies create_access_token / decode_access_token round-trip, expiry, and
tampering rejection. Earlier the same surface lived on python-jose; we want a
direct unit test so the migration cannot silently regress.
"""

from datetime import timedelta

from app.core.security import create_access_token, decode_access_token


def test_decode_access_token_round_trip():
    token = create_access_token({"sub": "user-123"})
    payload = decode_access_token(token)
    assert payload is not None
    assert payload["sub"] == "user-123"
    assert "exp" in payload


def test_decode_access_token_returns_none_for_expired_token():
    # Negative delta → already expired at issue time.
    token = create_access_token(
        {"sub": "user-123"}, expires_delta=timedelta(seconds=-1)
    )
    assert decode_access_token(token) is None


def test_decode_access_token_returns_none_for_tampered_token():
    token = create_access_token({"sub": "user-123"})
    # Flip a character in the signature segment to invalidate the HMAC.
    head, payload, sig = token.split(".")
    tampered_sig = ("A" if sig[0] != "A" else "B") + sig[1:]
    tampered = f"{head}.{payload}.{tampered_sig}"
    assert decode_access_token(tampered) is None


def test_decode_access_token_returns_none_for_garbage():
    assert decode_access_token("not-a-jwt") is None
    assert decode_access_token("") is None
