"""Log redaction helpers."""

from app.core.log_redact import (
    chat_text_for_full_log,
    deep_sanitize_log_data,
    mask_vins,
    preview_chat_text,
    sanitize_log_text,
)


def test_mask_vins_keeps_last_six() -> None:
    vin = "1HGBH41JXMN109186"
    assert mask_vins(f"VIN {vin} end") == "VIN ***109186 end"


def test_preview_collapses_whitespace_and_truncates() -> None:
    long_text = "word " * 80
    preview_text = preview_chat_text(long_text, max_chars=40)
    assert len(preview_text) <= 40
    assert preview_text.endswith("…")
    assert "\n" not in preview_chat_text("a\n\nb")


def test_chat_text_for_full_log_preserves_newlines_and_masks_vin() -> None:
    vin = "1HGBH41JXMN109186"
    raw_text = f"Line1\nVIN {vin}\nLine3"
    masked_text = chat_text_for_full_log(raw_text)
    assert "Line1\n" in masked_text
    assert vin not in masked_text
    assert "***109186" in masked_text


def test_sanitize_log_text_masks_email_phone_and_bearer_token() -> None:
    raw_text = "Email buyer@example.com call 415-555-0199 auth Bearer abc.DEF-123"
    sanitized_text = sanitize_log_text(raw_text)
    assert "buyer@example.com" not in sanitized_text
    assert "415-555-0199" not in sanitized_text
    assert "abc.DEF-123" not in sanitized_text
    assert "[redacted-email]" in sanitized_text
    assert "[redacted-phone]" in sanitized_text
    assert "Bearer [redacted]" in sanitized_text


def test_preview_chat_text_empty_and_short() -> None:
    assert preview_chat_text("") == ""
    assert preview_chat_text("short text") == "short text"


def test_preview_chat_text_handles_tiny_max_chars() -> None:
    assert preview_chat_text("abcdef", max_chars=1) == "…"
    assert preview_chat_text("abcdef", max_chars=0) == ""


def test_mask_vins_is_case_insensitive_and_uppercases_output() -> None:
    # Lowercase VIN should still be detected and masked with uppercase-derived suffix.
    masked_text = mask_vins("vin 1hgbh41jxmn109186 here")
    assert "1hgbh41jxmn109186" not in masked_text
    assert "***109186" in masked_text


def test_deep_sanitize_log_data_handles_tuples_and_passthrough_primitives() -> None:
    vin = "1HGBH41JXMN109186"
    data = (vin, 42, None, True, [vin, {"v": vin}])
    masked_data = deep_sanitize_log_data(data)
    assert isinstance(masked_data, tuple)
    assert masked_data[0] == "***109186"
    assert masked_data[1] == 42
    assert masked_data[2] is None
    assert masked_data[3] is True
    assert masked_data[4][0] == "***109186"
    assert masked_data[4][1]["v"] == "***109186"


def test_deep_sanitize_log_data_redacts_sensitive_keys() -> None:
    data = {
        "authorization": "Bearer secret-token",
        "nested": {
            "api_key": "sk-test-secret-value",
            "contact": "buyer@example.com",
        },
    }
    sanitized_data = deep_sanitize_log_data(data)
    assert sanitized_data["authorization"] == "[redacted]"
    assert sanitized_data["nested"]["api_key"] == "[redacted]"
    assert sanitized_data["nested"]["contact"] == "[redacted-email]"


def test_deep_sanitize_log_data_nested_strings() -> None:
    vin = "1HGBH41JXMN109186"
    data = {
        "cards": [
            {
                "kind": "vehicle",
                "content": {"vehicle": {"vin": vin, "make": "Ford"}},
            }
        ],
        "note": f"see {vin}",
    }
    masked_data = deep_sanitize_log_data(data)
    assert masked_data["cards"][0]["content"]["vehicle"]["vin"] == "***109186"
    assert vin not in masked_data["cards"][0]["content"]["vehicle"]["vin"]
    assert "***109186" in masked_data["note"]
    assert masked_data["cards"][0]["content"]["vehicle"]["make"] == "Ford"
