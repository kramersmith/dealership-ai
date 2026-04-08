from __future__ import annotations

from typing import NamedTuple

from app.services.claude.prompt_static import STATE_EXTRACTION_TOOLS

# Deal-level assessment tools that should normally pair with update_deal_health in the same turn.
# When the model emits visible text + these tools but skips health, step 1 may run one reconciliation
# tool round (see chat_loop + DASHBOARD_RECONCILE_AFTER_ASSESSMENT_TOOLS in prompt_static).
_DEAL_ASSESSMENT_TOOLS_REQUIRING_HEALTH = frozenset(
    {"update_deal_red_flags", "update_deal_information_gaps"}
)

# If step 0 ran extraction/structural tools but skipped structured assessment, step 1 may run tools
# again so pasted CARFAX etc. can land on the right deal (see POST_EXTRACTION_ASSESSMENT_NUDGE).
_STRUCTURED_ASSESSMENT_CONTEXT_TOOLS = frozenset(
    {
        "update_deal_red_flags",
        "update_deal_information_gaps",
        "update_deal_health",
        "update_scorecard",
        "update_negotiation_context",
        "update_checklist",
        "update_session_red_flags",
        "update_session_information_gaps",
        "update_deal_comparison",
    }
)


class ChatToolChoiceResult(NamedTuple):
    """Step tool-policy decision.

    Attributes:
        tool_choice: Anthropic tool_choice param for this step (``auto``/``none``).
        inject_dashboard_reconcile_nudge: When True, append
            DASHBOARD_RECONCILE_AFTER_ASSESSMENT_TOOLS to the system prompt for this step.
        inject_post_extraction_assessment_nudge: When True, append
            POST_EXTRACTION_ASSESSMENT_NUDGE (catch-up assessment after set_vehicle, etc.).
    """

    tool_choice: dict[str, str]
    inject_dashboard_reconcile_nudge: bool = False
    inject_post_extraction_assessment_nudge: bool = False


def chat_tool_choice_for_step(
    step: int,
    *,
    prev_step_had_tool_errors: bool,
    prev_step_had_visible_assistant_text: bool,
    prev_step_tools_were_dashboard_only: bool,
    prev_step_tool_names: frozenset[str] | None = None,
) -> ChatToolChoiceResult:
    """Bound tool rounds per buyer message to prevent model self-dialogue loops."""
    names = prev_step_tool_names or frozenset()

    if step == 0:
        return ChatToolChoiceResult({"type": "auto"})
    if step >= 2:
        return ChatToolChoiceResult({"type": "none"})
    if not prev_step_had_tool_errors and (
        prev_step_had_visible_assistant_text or prev_step_tools_were_dashboard_only
    ):
        if (
            prev_step_had_visible_assistant_text
            and not prev_step_tools_were_dashboard_only
            and (names & _DEAL_ASSESSMENT_TOOLS_REQUIRING_HEALTH)
            and "update_deal_health" not in names
        ):
            return ChatToolChoiceResult({"type": "auto"}, True)
        if (
            prev_step_had_visible_assistant_text
            and not prev_step_tools_were_dashboard_only
            and (names & STATE_EXTRACTION_TOOLS)
            and names.isdisjoint(_STRUCTURED_ASSESSMENT_CONTEXT_TOOLS)
        ):
            return ChatToolChoiceResult({"type": "auto"}, False, True)
        return ChatToolChoiceResult({"type": "none"})
    return ChatToolChoiceResult({"type": "auto"})
