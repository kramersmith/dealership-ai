from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from app.services.title_generator import (
    MAX_TITLE_LENGTH,
    build_vehicle_title,
    generate_session_title,
)


def test_build_vehicle_title_full_info():
    """Full vehicle info produces 'Year Make Model Trim' title."""
    result = build_vehicle_title(
        {"year": 2024, "make": "Honda", "model": "Civic", "trim": "EX"}
    )
    assert result == "2024 Honda Civic EX"


def test_build_vehicle_title_no_trim():
    """Missing trim omits it from the title."""
    result = build_vehicle_title(
        {"year": 2024, "make": "Honda", "model": "Civic", "trim": None}
    )
    assert result == "2024 Honda Civic"


def test_build_vehicle_title_no_year():
    """Missing year omits it from the title."""
    result = build_vehicle_title(
        {"year": None, "make": "Honda", "model": "Civic", "trim": None}
    )
    assert result == "Honda Civic"


def test_build_vehicle_title_make_only():
    """Only make produces a single-word title."""
    result = build_vehicle_title(
        {"year": None, "make": "Tesla", "model": None, "trim": None}
    )
    assert result == "Tesla"


def test_build_vehicle_title_no_vehicle():
    """No vehicle dict returns None."""
    result = build_vehicle_title(None)
    assert result is None


def test_build_vehicle_title_no_make():
    """Vehicle with no make returns None."""
    result = build_vehicle_title(
        {"year": 2024, "make": None, "model": "Civic", "trim": None}
    )
    assert result is None


def test_build_vehicle_title_truncation():
    """Long titles are truncated to 40 characters."""
    result = build_vehicle_title(
        {
            "year": 2024,
            "make": "Mercedes-Benz",
            "model": "GLE-Class",
            "trim": "AMG GLE 63 S 4MATIC+",
        }
    )
    assert result is not None
    assert len(result) <= 40


# --- generate_session_title (async, mocked Anthropic) ---


@pytest.mark.asyncio
async def test_generate_session_title_returns_title():
    """generate_session_title returns a trimmed title from the LLM response."""
    mock_block = MagicMock()
    mock_block.text = "  Honda Civic Deal  "
    mock_response = MagicMock()
    mock_response.content = [mock_block]

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_response)

    with patch(
        "app.services.title_generator.create_anthropic_client",
        return_value=mock_client,
    ):
        result = await generate_session_title(
            [
                {"role": "user", "content": "I want to buy a Honda Civic"},
                {
                    "role": "assistant",
                    "content": "Great choice! The Civic is reliable.",
                },
            ]
        )

    assert result == "Honda Civic Deal"
    mock_client.messages.create.assert_called_once()


@pytest.mark.asyncio
async def test_generate_session_title_empty_messages():
    """generate_session_title returns None for empty message list."""
    result = await generate_session_title([])
    assert result is None


@pytest.mark.asyncio
async def test_generate_session_title_no_valid_messages():
    """generate_session_title returns None when no user/assistant messages exist."""
    result = await generate_session_title(
        [
            {"role": "system", "content": "You are an assistant."},
        ]
    )
    assert result is None


@pytest.mark.asyncio
async def test_generate_session_title_strips_quotes():
    """generate_session_title strips surrounding quotes from LLM output."""
    mock_block = MagicMock()
    mock_block.text = '"Financing Options"'
    mock_response = MagicMock()
    mock_response.content = [mock_block]

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_response)

    with patch(
        "app.services.title_generator.create_anthropic_client",
        return_value=mock_client,
    ):
        result = await generate_session_title(
            [
                {"role": "user", "content": "Tell me about financing"},
            ]
        )

    assert result == "Financing Options"


@pytest.mark.asyncio
async def test_generate_session_title_truncates_long_output():
    """generate_session_title truncates titles exceeding MAX_TITLE_LENGTH."""
    mock_block = MagicMock()
    mock_block.text = "A" * 60
    mock_response = MagicMock()
    mock_response.content = [mock_block]

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_response)

    with patch(
        "app.services.title_generator.create_anthropic_client",
        return_value=mock_client,
    ):
        result = await generate_session_title(
            [
                {"role": "user", "content": "Something"},
            ]
        )

    assert result is not None
    assert len(result) <= MAX_TITLE_LENGTH


@pytest.mark.asyncio
async def test_generate_session_title_returns_none_on_api_error():
    """generate_session_title returns None when the API call fails."""
    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(side_effect=Exception("API error"))

    with patch(
        "app.services.title_generator.create_anthropic_client",
        return_value=mock_client,
    ):
        result = await generate_session_title(
            [
                {"role": "user", "content": "Hello"},
            ]
        )

    assert result is None


@pytest.mark.asyncio
async def test_generate_session_title_uses_last_three_messages():
    """generate_session_title only sends the last 3 messages for context."""
    mock_block = MagicMock()
    mock_block.text = "Deal Title"
    mock_response = MagicMock()
    mock_response.content = [mock_block]

    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_response)

    messages = [
        {"role": "user", "content": "Message 1"},
        {"role": "assistant", "content": "Reply 1"},
        {"role": "user", "content": "Message 2"},
        {"role": "assistant", "content": "Reply 2"},
        {"role": "user", "content": "Message 3"},
    ]

    with patch(
        "app.services.title_generator.create_anthropic_client",
        return_value=mock_client,
    ):
        result = await generate_session_title(messages)

    assert result == "Deal Title"
    # Verify the call was made — the context_messages should be from last 3
    call_args = mock_client.messages.create.call_args
    sent_messages = call_args.kwargs.get("messages") or call_args[1].get("messages")
    # Last 3 messages + 1 system prompt for title generation = filtered user/assistant + prompt
    # The context messages from the last 3 (msg 2 reply, msg 3) plus the title prompt
    user_assistant_in_call = [
        m for m in sent_messages if m["content"] != sent_messages[-1]["content"]
    ]
    assert len(user_assistant_in_call) <= 3
