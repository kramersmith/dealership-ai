"""Assemble a bounded text context pack for deal recap LLM."""

from __future__ import annotations

import json
from dataclasses import dataclass

from app.core.config import settings
from app.models.enums import MessageRole
from app.models.message import Message

# Policy: keep recap generation bounded.
_MAX_MESSAGES = 40
_USER_CONTENT_MAX = 1200
_ASSISTANT_CONTENT_MAX = 800


@dataclass
class ContextPack:
    """Serialized inputs for recap generation."""

    deal_state_json: str
    messages_block: str


def build_messages_block(messages: list[Message]) -> str:
    """Last N messages, truncated, with stable ids for anchoring."""
    tail = messages[-_MAX_MESSAGES:] if len(messages) > _MAX_MESSAGES else messages
    lines: list[str] = []
    for message in tail:
        role = message.role
        mid = message.id
        created = message.created_at.isoformat()
        if role == MessageRole.USER.value:
            text = message.content[:_USER_CONTENT_MAX]
            if len(message.content) > _USER_CONTENT_MAX:
                text += "\n…(truncated)"
        elif role == MessageRole.ASSISTANT.value:
            text = message.content[:_ASSISTANT_CONTENT_MAX]
            if len(message.content) > _ASSISTANT_CONTENT_MAX:
                text += "\n…(truncated)"
        else:
            text = message.content[:300]
        lines.append(f"[{mid}] {created} {role}:\n{text}")
    return "\n\n---\n\n".join(lines)


def build_context_pack(
    deal_state_dict: dict,
    messages: list[Message],
) -> ContextPack:
    deal_json = json.dumps(deal_state_dict, indent=2, default=str)
    # Hard cap deal JSON size (truncate string — rare)
    max_deal = settings.CLAUDE_CONTEXT_INPUT_BUDGET // 4
    if len(deal_json) > max_deal:
        deal_json = deal_json[:max_deal] + "\n…(deal JSON truncated)"
    return ContextPack(
        deal_state_json=deal_json,
        messages_block=build_messages_block(messages),
    )
