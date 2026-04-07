from __future__ import annotations


def chat_tool_choice_for_step(
    step: int,
    *,
    prev_step_had_tool_errors: bool,
    prev_step_had_visible_assistant_text: bool,
    prev_step_tools_were_dashboard_only: bool,
) -> dict[str, str]:
    """Bound tool rounds per buyer message to prevent model self-dialogue loops."""
    if step == 0:
        return {"type": "auto"}
    if step >= 2:
        return {"type": "none"}
    if not prev_step_had_tool_errors and (
        prev_step_had_visible_assistant_text or prev_step_tools_were_dashboard_only
    ):
        return {"type": "none"}
    return {"type": "auto"}
