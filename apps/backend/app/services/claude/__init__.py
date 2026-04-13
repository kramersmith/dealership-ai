"""Anthropic Claude integration: chat step loop, prompts, tools, streaming."""

from __future__ import annotations

from app.services.claude.chat_loop import (
    ChatLoopResult,
    stream_chat_loop,
)
from app.services.claude.client import create_anthropic_client
from app.services.claude.context_message import build_context_message
from app.services.claude.errors import user_visible_message_for_anthropic_error
from app.services.claude.messages import (
    build_messages,
    build_system_prompt,
    move_message_cache_breakpoint,
)
from app.services.claude.prompt_deal_state import (
    build_prompt_deal_state,
    build_temporal_hint_line,
    calendar_years_since_model_year,
    current_utc_date_iso,
    primary_vehicle_model_year,
)
from app.services.claude.prompt_static import POST_TOOL_CONTINUATION_REMINDER
from app.services.claude.streaming import (
    SyntheticBlockStopEvent,
    SyntheticTextEvent,
    SyntheticToolJsonEvent,
    SyntheticToolStartEvent,
)
from app.services.claude.text_dedupe import strip_redundant_continuation_opener
from app.services.claude.tool_policy import chat_tool_choice_for_step
from app.services.claude.tool_runner import execute_tool_batch
from app.services.claude.tool_schemas import CHAT_TOOLS, get_buyer_chat_tools
from app.services.claude.usage_stats import (
    empty_usage_summary,
    get_escalated_max_tokens,
    merge_usage_summary,
    summarize_usage,
)

__all__ = [
    "CHAT_TOOLS",
    "ChatLoopResult",
    "POST_TOOL_CONTINUATION_REMINDER",
    "SyntheticBlockStopEvent",
    "SyntheticTextEvent",
    "SyntheticToolJsonEvent",
    "SyntheticToolStartEvent",
    "build_context_message",
    "build_messages",
    "build_prompt_deal_state",
    "build_system_prompt",
    "build_temporal_hint_line",
    "calendar_years_since_model_year",
    "chat_tool_choice_for_step",
    "create_anthropic_client",
    "current_utc_date_iso",
    "get_buyer_chat_tools",
    "empty_usage_summary",
    "execute_tool_batch",
    "get_escalated_max_tokens",
    "merge_usage_summary",
    "move_message_cache_breakpoint",
    "primary_vehicle_model_year",
    "stream_chat_loop",
    "strip_redundant_continuation_opener",
    "summarize_usage",
    "user_visible_message_for_anthropic_error",
]
