from __future__ import annotations

from typing import NamedTuple


class ChatToolChoiceResult(NamedTuple):
    """Step tool-policy decision.

    Attributes:
        tool_choice: Anthropic tool_choice param for this step (``auto``/``none``).
    """

    tool_choice: dict[str, str]


def chat_tool_choice_for_step(
    step: int,
    *,
    prev_step_had_tool_errors: bool,
    prev_step_had_visible_assistant_text: bool,
    prev_step_tools_were_dashboard_only: bool,
    prev_step_tool_names: frozenset[str] | None = None,
) -> ChatToolChoiceResult:
    """Bound tool rounds per buyer message to prevent model self-dialogue loops.

    With complete-reply-first + step-loop short-circuit, most turns complete in
    a single step. Step 1 only runs when step 0 was thin or tool-only, and in
    that case we force text-only (tool_choice=none) to prevent the model from
    emitting another tool round instead of a user-visible reply.
    """
    del (
        prev_step_had_tool_errors,
        prev_step_had_visible_assistant_text,
        prev_step_tools_were_dashboard_only,
        prev_step_tool_names,
    )
    if step == 0:
        return ChatToolChoiceResult({"type": "auto"})
    return ChatToolChoiceResult({"type": "none"})
