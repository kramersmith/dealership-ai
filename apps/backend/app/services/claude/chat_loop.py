from __future__ import annotations

from collections.abc import AsyncGenerator

from app.services.claude.chat_loop_engine import run_chat_loop_engine
from app.services.claude.client import create_anthropic_client
from app.services.claude.usage_stats import empty_usage_summary
from app.services.turn_context import TurnContext


class ChatLoopResult:
    """Mutable container for collecting step loop results.

    Populated by stream_chat_loop() so the caller can access
    full_text and tool_calls after iteration completes.
    """

    def __init__(self) -> None:
        self.full_text: str = ""
        self.tool_calls: list[dict] = []
        self.completed: bool = False
        self.failed: bool = False
        self.usage_summary: dict[str, int] = empty_usage_summary()
        self.prompt_cache_breaks: int = 0
        self.prompt_cache_chat_last: dict[str, str] | None = None
        self.interrupted: bool = False
        self.interrupted_reason: str | None = None


# Maximum steps (LLM call -> tool execution cycles) per turn
CHAT_LOOP_MAX_STEPS = 5


async def stream_chat_loop(
    system_prompt: list[dict],
    messages: list[dict],
    tools: list[dict],
    turn_context: TurnContext,
    result: ChatLoopResult,
    max_steps: int = CHAT_LOOP_MAX_STEPS,
    session_factory=None,
    emit_done_event: bool = True,
    linked_messages: list[dict] | None = None,
    prompt_cache_prior_chat: dict[str, str] | None = None,
    is_cancelled=None,
) -> AsyncGenerator[str, None]:
    """Step loop facade over chat loop engine."""
    if session_factory is None:
        from app.db.session import AsyncSessionLocal

        session_factory = AsyncSessionLocal

    client = create_anthropic_client()
    async for sse_event in run_chat_loop_engine(
        client=client,
        system_prompt=system_prompt,
        messages=messages,
        tools=tools,
        turn_context=turn_context,
        result=result,
        max_steps=max_steps,
        session_factory=session_factory,
        emit_done_event=emit_done_event,
        linked_messages=linked_messages,
        prompt_cache_prior_chat=prompt_cache_prior_chat,
        is_cancelled=is_cancelled,
    ):
        yield sse_event
