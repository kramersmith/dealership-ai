from __future__ import annotations

from app.core.config import settings
from app.services.claude.prompt_static import SYSTEM_PROMPT_STATIC


def _cacheable_text(value: object) -> bool:
    return isinstance(value, str) and value != ""


def _cacheable_block(block: object) -> bool:
    if not isinstance(block, dict):
        return False
    if block.get("type") != "text":
        return True
    return _cacheable_text(block.get("text"))


def _set_cache_control_on_last_cacheable_block(blocks: list[dict]) -> list[dict]:
    for idx in range(len(blocks) - 1, -1, -1):
        block = blocks[idx]
        if not _cacheable_block(block):
            continue
        blocks[idx] = {**block, "cache_control": {"type": "ephemeral"}}
        break
    return blocks


def replace_context_message(
    messages: list[dict],
    context_message: dict | None,
) -> None:
    """Replace the current-turn synthetic context block in-place if present."""
    context_text = context_message.get("content") if context_message else None
    if not isinstance(context_text, str):
        return

    for message in messages:
        if message.get("role") != "user":
            continue
        content = message.get("content")
        if not isinstance(content, list) or not content:
            continue
        first_block = content[0]
        if (
            isinstance(first_block, dict)
            and first_block.get("type") == "text"
            and isinstance(first_block.get("text"), str)
            and first_block["text"].startswith("<system-reminder>")
        ):
            content[0] = {**first_block, "text": context_text}
            return


def move_message_cache_breakpoint(messages: list[dict]) -> None:
    """Move the cache breakpoint to the last message in the array.

    Called after each step appends tool results so the next step's API call
    caches the entire conversation prefix (two-breakpoint caching). Only one
    message-level breakpoint is maintained to stay within the Anthropic API's
    4-breakpoint limit (system + tools + 1 message).
    """
    # Strip existing message-level cache_control
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and "cache_control" in block:
                    del block["cache_control"]

    if not messages:
        return

    # Add breakpoint to the last content block of the last message
    last_msg = messages[-1]
    content = last_msg.get("content")
    if _cacheable_text(content):
        last_msg["content"] = [
            {"type": "text", "text": content, "cache_control": {"type": "ephemeral"}}
        ]
    elif isinstance(content, list) and content:
        last_msg["content"] = _set_cache_control_on_last_cacheable_block(content)


def build_system_prompt() -> list[dict]:
    """Build system prompt as a single static cached block.

    The system prompt is entirely static — no per-session or per-turn content.
    Dynamic context (deal state, negotiation context, buyer situation) is
    injected as a context message via build_context_message() so the system
    prompt stays cacheable across turns.
    """
    return [
        {
            "type": "text",
            "text": SYSTEM_PROMPT_STATIC,
            "cache_control": {"type": "ephemeral"},
        }
    ]


def build_messages(
    history: list[dict],
    user_content: str,
    image_url: str | None = None,
    context_message: dict | None = None,
    compaction_prefix: list[dict] | None = None,
) -> list[dict]:
    """Build the messages array for Claude API from message history.

    Conversation history comes first (stable, cacheable prefix) with a cache
    breakpoint on the last history message. Dynamic context and the new user
    message come after the breakpoint (uncached, change every turn/request).

    Optional ``compaction_prefix`` (e.g. rolling summary wrapped in
    system-reminder) is prepended before history and is not given the history
    cache breakpoint.
    """
    messages: list[dict] = []

    if compaction_prefix:
        for block in compaction_prefix:
            messages.append({"role": block["role"], "content": block["content"]})

    # History FIRST — stable prefix, cacheable across turns/requests
    max_history = settings.CLAUDE_MAX_HISTORY
    history_slice = history[-max_history:]
    for i, msg in enumerate(history_slice):
        entry: dict = {"role": msg["role"], "content": msg["content"]}
        # Cache breakpoint on the last history message
        if i == len(history_slice) - 1:
            if _cacheable_text(entry["content"]):
                entry["content"] = [
                    {
                        "type": "text",
                        "text": entry["content"],
                        "cache_control": {"type": "ephemeral"},
                    }
                ]
            elif isinstance(entry["content"], list):
                entry["content"] = _set_cache_control_on_last_cacheable_block(
                    entry["content"]
                )
        messages.append(entry)

    # New user message (uncached — changes every turn/request)
    context_text = context_message.get("content") if context_message else None

    if image_url:
        content_blocks: list[dict] = []
        if isinstance(context_text, str):
            content_blocks.append({"type": "text", "text": context_text})
        content_blocks.extend(
            [
                {
                    "type": "image",
                    "source": {"type": "url", "url": image_url},
                },
                {"type": "text", "text": user_content},
            ]
        )
        messages.append(
            {
                "role": "user",
                "content": content_blocks,
            }
        )
    elif isinstance(context_text, str):
        messages.append(
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": context_text},
                    {"type": "text", "text": user_content},
                ],
            }
        )
    else:
        messages.append({"role": "user", "content": user_content})

    return messages
