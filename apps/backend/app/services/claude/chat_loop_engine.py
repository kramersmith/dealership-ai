from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import anthropic

from app.core.config import settings
from app.services.claude import streaming as claude_streaming
from app.services.claude.context_message import build_context_message
from app.services.claude.errors import (
    is_anthropic_low_credit_error,
    user_visible_message_for_anthropic_error,
)
from app.services.claude.messages import (
    move_message_cache_breakpoint,
    replace_context_message,
)
from app.services.claude.prompt_static import (
    CONTINUATION_AFTER_STATE_EXTRACTION_SYSTEM,
    CONTINUATION_AFTER_TOOL_ONLY_SYSTEM,
    CONTINUATION_TEXT_ONLY_SYSTEM,
    DASHBOARD_RECONCILE_AFTER_ASSESSMENT_TOOLS,
    POST_EXTRACTION_ASSESSMENT_NUDGE,
    POST_TOOL_CONTINUATION_REMINDER,
    POST_TOOL_TEASER_RECOVERY_SYSTEM,
    SESSION_SCOPED_DASHBOARD_TOOLS,
    STATE_EXTRACTION_TOOLS,
    STEP_AFTER_TOOL_ONLY_NUDGE,
    TEXT_ONLY_RECOVERY_TOOL_NAMES,
)
from app.services.claude.recovery import generate_text_only_recovery_response
from app.services.claude.text_dedupe import (
    normalize_step_text_for_dedupe,
    promises_substantive_followup_after_tools,
    strip_redundant_continuation_opener,
)
from app.services.claude.tool_policy import chat_tool_choice_for_step
from app.services.claude.tool_runner import execute_tool_batch
from app.services.claude.usage_stats import (
    get_escalated_max_tokens,
    merge_usage_summary,
    summarize_usage,
)
from app.services.tool_validation import ToolValidationError
from app.services.turn_context import TurnContext

if TYPE_CHECKING:
    from app.services.claude.chat_loop import ChatLoopResult

logger = logging.getLogger(__name__)

# Minimum char length for a post-tool continuation to be considered substantive.
# Below this threshold, the step is treated as "too thin" and teaser recovery fires.
_THIN_CONTINUATION_CHAR_THRESHOLD = 120


@dataclass
class _PrevStepState:
    """Tracks prior-step outcomes that drive tool policy decisions."""

    had_tool_errors: bool = True
    had_visible_assistant_text: bool = False
    tools_were_dashboard_only: bool = False
    had_state_extraction_tools: bool = False
    had_any_tools: bool = False
    tool_names: frozenset[str] = field(default_factory=frozenset)

    def update(
        self,
        *,
        had_tool_errors: bool,
        step_text: str,
        tool_use_blocks: list[dict],
    ) -> None:
        """Recompute step-derived flags used by the next step."""
        tool_names = frozenset(b["name"] for b in tool_use_blocks)
        self.had_tool_errors = had_tool_errors
        self.had_visible_assistant_text = bool(step_text.strip())
        self.tools_were_dashboard_only = bool(tool_use_blocks) and (
            tool_names <= SESSION_SCOPED_DASHBOARD_TOOLS
        )
        self.had_state_extraction_tools = bool(tool_use_blocks) and bool(
            tool_names & STATE_EXTRACTION_TOOLS
        )
        self.had_any_tools = bool(tool_use_blocks)
        self.tool_names = tool_names


@dataclass
class _StepPromptConfig:
    """Resolved tool choice and system prompt for a single step."""

    tool_choice_param: dict
    step_system: list[dict]


@dataclass
class _ToolExecutionState:
    """Mutable accumulator for tool_result blocks and error state."""

    tool_result_content: list[dict] = field(default_factory=list)
    had_tool_errors: bool = False


@dataclass
class _StepIterationResult:
    """Captures parsed artifacts returned by one streaming step."""

    stop_reason: str | None = None
    step_text: str = ""
    tool_use_blocks: list[dict] = field(default_factory=list)
    assistant_content_blocks: list[dict] = field(default_factory=list)
    json_error_blocks: list[dict] = field(default_factory=list)


@dataclass
class _CacheState:
    """Carries cache fingerprints and dedupe state across steps."""

    last_chat_cache_snapshot: dict[str, str] | None = None
    last_appended_step_text_normalized: str = ""


def _build_step_prompt_config(
    *,
    step: int,
    system_prompt: list[dict],
    prev_step: _PrevStepState,
) -> _StepPromptConfig:
    """Build per-step prompt/tool policy from previous-step state."""
    step_tool_policy = chat_tool_choice_for_step(
        step,
        prev_step_had_tool_errors=prev_step.had_tool_errors,
        prev_step_had_visible_assistant_text=prev_step.had_visible_assistant_text,
        prev_step_tools_were_dashboard_only=prev_step.tools_were_dashboard_only,
        prev_step_tool_names=prev_step.tool_names,
    )
    tool_choice_param = step_tool_policy.tool_choice
    if tool_choice_param["type"] == "none":
        if not prev_step.had_visible_assistant_text:
            step_system = [*system_prompt, *CONTINUATION_AFTER_TOOL_ONLY_SYSTEM]
        elif prev_step.had_state_extraction_tools:
            step_system = [*system_prompt, *CONTINUATION_AFTER_STATE_EXTRACTION_SYSTEM]
        else:
            step_system = [*system_prompt, *CONTINUATION_TEXT_ONLY_SYSTEM]
        return _StepPromptConfig(
            tool_choice_param=tool_choice_param, step_system=step_system
        )

    step_system = system_prompt
    if step_tool_policy.inject_dashboard_reconcile_nudge:
        step_system = [*step_system, *DASHBOARD_RECONCILE_AFTER_ASSESSMENT_TOOLS]
    elif step_tool_policy.inject_post_extraction_assessment_nudge:
        step_system = [*step_system, *POST_EXTRACTION_ASSESSMENT_NUDGE]
    elif (
        step == 1
        and not prev_step.had_visible_assistant_text
        and not prev_step.had_tool_errors
    ):
        step_system = [*step_system, *STEP_AFTER_TOOL_ONLY_NUDGE]
    return _StepPromptConfig(
        tool_choice_param=tool_choice_param, step_system=step_system
    )


def _merge_step_text_with_dedupe(
    *,
    step: int,
    result: ChatLoopResult,
    step_text: str,
    last_appended_step_text_normalized: str,
    prev_step: _PrevStepState,
) -> tuple[str, str, str]:
    """Normalize and append step text while removing duplicate continuations."""
    pre_step_full_text = result.full_text
    if (
        step >= 1
        and prev_step.had_any_tools
        and prev_step.had_visible_assistant_text
        and step_text.strip()
    ):
        stripped = strip_redundant_continuation_opener(result.full_text, step_text)
        if stripped != step_text:
            logger.info(
                "Step %d: removed redundant continuation opener (%d -> %d chars)",
                step,
                len(step_text),
                len(stripped),
            )
            step_text = stripped

    normalized_step_text = normalize_step_text_for_dedupe(step_text)
    is_duplicate_step_text = (
        bool(normalized_step_text)
        and normalized_step_text == last_appended_step_text_normalized
    )
    if is_duplicate_step_text:
        logger.info(
            "Step %d emitted duplicate text after tool execution; skipping aggregation",
            step,
        )
        return pre_step_full_text, step_text, last_appended_step_text_normalized

    if step_text and result.full_text and not result.full_text.endswith(("\n", " ")):
        result.full_text += "\n\n"
    result.full_text += step_text
    if normalized_step_text:
        last_appended_step_text_normalized = normalized_step_text
    return pre_step_full_text, step_text, last_appended_step_text_normalized


def _append_json_error_tool_results(
    *,
    step: int,
    json_error_blocks: list[dict],
    assistant_content_blocks: list[dict],
    tool_exec_state: _ToolExecutionState,
) -> list[str]:
    """Convert malformed tool JSON blocks into tool_error/tool_result events."""
    sse_events: list[str] = []
    for err_block in json_error_blocks:
        tool_exec_state.had_tool_errors = True
        error_msg = f"Tool '{err_block['name']}' received malformed JSON input"
        tool_exec_state.tool_result_content.append(
            {
                "type": "tool_result",
                "tool_use_id": err_block["id"],
                "is_error": True,
                "content": error_msg,
            }
        )
        # Include the broken tool_use so every tool_result has a matching tool_use.
        assistant_content_blocks.append(
            {
                "type": "tool_use",
                "id": err_block["id"],
                "name": err_block["name"],
                "input": {},
            }
        )
        logger.warning("Step %d: malformed tool JSON for [%s]", step, err_block["name"])
        sse_events.append(
            f"event: tool_error\ndata: {json.dumps({'tool': err_block['name'], 'error': 'Malformed tool input'})}\n\n"
        )
    return sse_events


async def _execute_tool_calls(
    *,
    step: int,
    tool_use_blocks: list[dict],
    turn_context: TurnContext,
    session_factory,
    result: ChatLoopResult,
    is_cancelled,
    tool_exec_state: _ToolExecutionState,
) -> AsyncGenerator[str, None]:
    """Execute planned tool batches and emit SSE tool events."""
    from app.services.deal_state import build_execution_plan

    if turn_context.deal_state:
        execution_plan = build_execution_plan(tool_use_blocks)
        for batch in execution_plan:
            if is_cancelled and is_cancelled():
                result.interrupted = True
                result.interrupted_reason = "user_stop"
                logger.info("Chat loop interrupted before tool batch at step %d", step)
                return
            async for tool_block, outcome in execute_tool_batch(
                batch,
                turn_context,
                session_factory,
            ):
                tool_name = tool_block["name"]
                tool_id = tool_block["id"]
                logger.debug(
                    "Step %d: completed tool [%s] keys=%s",
                    step,
                    tool_name,
                    list(tool_block["input"].keys()),
                )

                if isinstance(outcome, Exception):
                    tool_exec_state.had_tool_errors = True
                    if isinstance(outcome, ToolValidationError):
                        error_msg = f"Tool '{tool_name}' validation failed: {outcome}"
                    else:
                        error_msg = f"Tool '{tool_name}' failed: {outcome}"
                    tool_exec_state.tool_result_content.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": tool_id,
                            "is_error": True,
                            "content": error_msg,
                        }
                    )
                    yield f"event: tool_error\ndata: {json.dumps({'tool': tool_name, 'error': str(outcome)})}\n\n"
                    continue

                applied = outcome
                result.tool_calls.extend(applied)
                for tool_call in applied:
                    yield f"event: tool_result\ndata: {json.dumps({'tool': tool_call['name'], 'data': tool_call['args']})}\n\n"

                tool_exec_state.tool_result_content.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_id,
                        "content": json.dumps({"status": "ok"}),
                    }
                )
                if is_cancelled and is_cancelled():
                    result.interrupted = True
                    result.interrupted_reason = "user_stop"
                    logger.info(
                        "Chat loop interrupted after tool [%s] at step %d",
                        tool_name,
                        step,
                    )
                    return
        return

    for tool_block in tool_use_blocks:
        tool_name = tool_block["name"]
        tool_exec_state.had_tool_errors = True
        error_msg = (
            f"Tool '{tool_name}' cannot execute: no deal state exists for this session"
        )
        logger.warning("Step %d: tool [%s] called but no deal_state", step, tool_name)
        tool_exec_state.tool_result_content.append(
            {
                "type": "tool_result",
                "tool_use_id": tool_block["id"],
                "is_error": True,
                "content": error_msg,
            }
        )
        yield f"event: tool_error\ndata: {json.dumps({'tool': tool_name, 'error': 'No deal state available'})}\n\n"


async def _append_tool_results_to_messages(
    *,
    messages: list[dict],
    assistant_content_blocks: list[dict],
    tool_result_content: list[dict],
    turn_context: TurnContext,
    linked_messages: list[dict] | None,
) -> None:
    """Persist assistant/tool result content and refresh context message."""
    from app.services.deal_state import deal_state_to_dict

    messages.append({"role": "assistant", "content": assistant_content_blocks})
    if tool_result_content:
        tool_result_content.append(
            {
                "type": "text",
                "text": POST_TOOL_CONTINUATION_REMINDER,
                "cache_control": {"type": "ephemeral"},
            }
        )
        messages.append({"role": "user", "content": tool_result_content})

    if turn_context.deal_state is not None:
        await turn_context.db.refresh(turn_context.deal_state)
        updated_state_dict = await deal_state_to_dict(
            turn_context.deal_state, turn_context.db
        )
        updated_context_message = build_context_message(
            updated_state_dict, linked_messages
        )
        replace_context_message(messages, updated_context_message)


async def _stream_step_with_retries(
    *,
    step: int,
    client,
    system_prompt: list[dict],
    step_system: list[dict],
    messages: list[dict],
    cached_tools: list[dict],
    tool_choice_param: dict,
    turn_context: TurnContext,
    result: ChatLoopResult,
    cache_state: _CacheState,
    is_cancelled,
    out: _StepIterationResult,
) -> AsyncGenerator[str, None]:
    """Run one step with max-token retries and stream incremental SSE events."""
    from app.services.prompt_cache_signature import (
        CHAT_STABLE_CACHE_KEYS,
        DEFAULT_PROMPT_CACHE_BETAS,
        build_chat_stable_cache_snapshot,
        log_prompt_cache_break,
        prompt_cache_components_changed,
    )

    current_max_tokens = settings.CLAUDE_MAX_TOKENS
    truncation_retry_count = 0

    while True:
        step_text = ""
        tool_use_blocks: list[dict] = []  # {id, name, input}
        assistant_content_blocks: list[dict] = []  # raw content blocks for messages
        current_tool_id: str | None = None
        current_tool_name: str | None = None
        current_tool_input_json = ""
        json_error_blocks: list[dict] = []

        try:
            stop_reason = None
            cache_snap = build_chat_stable_cache_snapshot(
                base_system=system_prompt,
                tools=cached_tools,
                model=settings.CLAUDE_MODEL,
                betas=DEFAULT_PROMPT_CACHE_BETAS,
            )
            cache_changed = prompt_cache_components_changed(
                cache_state.last_chat_cache_snapshot,
                cache_snap,
                component_keys=CHAT_STABLE_CACHE_KEYS,
            )
            if cache_state.last_chat_cache_snapshot is not None and cache_changed:
                sid = turn_context.session.id if turn_context.session else None
                log_prompt_cache_break(
                    logger,
                    session_id=sid,
                    phase="chat",
                    step=step,
                    prior=cache_state.last_chat_cache_snapshot,
                    current=cache_snap,
                    changed_components=cache_changed,
                )
                result.prompt_cache_breaks += 1
            cache_state.last_chat_cache_snapshot = cache_snap
            result.prompt_cache_chat_last = cache_snap

            async for event_type, event_data in claude_streaming.stream_step_with_retry(
                client,
                model=settings.CLAUDE_MODEL,
                max_tokens=current_max_tokens,
                system=step_system,
                messages=messages,
                tools=cached_tools,
                tool_choice=tool_choice_param,
                is_cancelled=is_cancelled,
            ):
                if event_type == "retry":
                    retry_payload = dict(event_data)
                    retry_payload.setdefault("reset_text", True)
                    yield f"event: retry\ndata: {json.dumps(retry_payload)}\n\n"
                    step_text = ""
                    tool_use_blocks = []
                    assistant_content_blocks = []
                    current_tool_id = None
                    current_tool_name = None
                    current_tool_input_json = ""
                    json_error_blocks = []
                    continue

                if event_type == "final_message":
                    usage = event_data.usage
                    stop_reason = event_data.stop_reason
                    merge_usage_summary(result.usage_summary, summarize_usage(usage))
                    logger.info(
                        "Cache [chat_loop step=%d]: creation=%d read=%d uncached=%d stop=%s max_tokens=%d",
                        step,
                        getattr(usage, "cache_creation_input_tokens", 0) or 0,
                        getattr(usage, "cache_read_input_tokens", 0) or 0,
                        usage.input_tokens,
                        stop_reason,
                        current_max_tokens,
                    )
                    continue

                event = event_data
                if event.type == "content_block_start":
                    if (
                        hasattr(event.content_block, "type")
                        and event.content_block.type == "tool_use"
                    ):
                        current_tool_id = event.content_block.id
                        current_tool_name = event.content_block.name
                        current_tool_input_json = ""
                elif event.type == "content_block_delta":
                    if hasattr(event.delta, "type"):
                        if event.delta.type == "text_delta":
                            chunk = event.delta.text
                            step_text += chunk
                            yield f"event: text\ndata: {json.dumps({'chunk': chunk})}\n\n"
                        elif event.delta.type == "input_json_delta":
                            current_tool_input_json += event.delta.partial_json
                elif event.type == "content_block_stop":
                    if current_tool_name and current_tool_input_json:
                        try:
                            tool_input = json.loads(current_tool_input_json)
                            if isinstance(tool_input, dict):
                                tool_use_blocks.append(
                                    {
                                        "id": current_tool_id,
                                        "name": current_tool_name,
                                        "input": tool_input,
                                    }
                                )
                                assistant_content_blocks.append(
                                    {
                                        "type": "tool_use",
                                        "id": current_tool_id,
                                        "name": current_tool_name,
                                        "input": tool_input,
                                    }
                                )
                        except json.JSONDecodeError:
                            logger.warning(
                                "Step %d: tool [%s] returned invalid JSON",
                                step,
                                current_tool_name,
                            )
                            json_error_blocks.append(
                                {"id": current_tool_id, "name": current_tool_name}
                            )
                        current_tool_id = None
                        current_tool_name = None
                        current_tool_input_json = ""

            if stop_reason == "max_tokens" and current_tool_name:
                logger.warning(
                    "Step %d: tool [%s] was truncated at max_tokens=%d",
                    step,
                    current_tool_name,
                    current_max_tokens,
                )
                json_error_blocks.append(
                    {"id": current_tool_id, "name": current_tool_name}
                )

            if step_text:
                assistant_content_blocks.insert(0, {"type": "text", "text": step_text})

        except claude_streaming.StreamInterruptedError:
            if (
                step_text
                and result.full_text
                and not result.full_text.endswith(("\n", " "))
            ):
                result.full_text += "\n\n"
            result.full_text += step_text
            result.interrupted = True
            result.interrupted_reason = "user_stop"
            logger.info("Chat loop interrupted during step %d", step)
            return
        except anthropic.APIStatusError as exc:
            if is_anthropic_low_credit_error(exc):
                logger.error(
                    "Chat loop step %d failed: Anthropic credits/billing "
                    "(status_code=%s, request_id=%s)",
                    step,
                    getattr(exc, "status_code", "(unknown)"),
                    exc.request_id or "(unknown)",
                )
            else:
                logger.error(
                    "Chat loop step %d failed: Anthropic API status error "
                    "(status_code=%s, request_id=%s)",
                    step,
                    getattr(exc, "status_code", "(unknown)"),
                    exc.request_id or "(unknown)",
                )
            result.failed = True
            user_msg = user_visible_message_for_anthropic_error(exc)
            yield f"event: error\ndata: {json.dumps({'message': user_msg})}\n\n"
            return
        except Exception:
            logger.exception("Chat loop step %d failed", step)
            result.failed = True
            yield 'event: error\ndata: {"message": "AI response failed. Please try again."}\n\n'
            return

        if stop_reason == "max_tokens":
            next_max_tokens = get_escalated_max_tokens(current_max_tokens)
            if (
                truncation_retry_count < settings.CLAUDE_MAX_TOKENS_RETRIES
                and next_max_tokens > current_max_tokens
            ):
                truncation_retry_count += 1
                logger.warning(
                    "Chat loop step %d hit max_tokens at %d, retrying with %d (%d/%d)",
                    step,
                    current_max_tokens,
                    next_max_tokens,
                    truncation_retry_count,
                    settings.CLAUDE_MAX_TOKENS_RETRIES,
                )
                yield f"event: retry\ndata: {json.dumps({'attempt': truncation_retry_count, 'reason': 'max_tokens', 'reset_text': True, 'max_tokens': next_max_tokens})}\n\n"
                current_max_tokens = next_max_tokens
                continue
            logger.warning(
                "Chat loop step %d exhausted max_tokens retries at budget=%d",
                step,
                current_max_tokens,
            )

        out.stop_reason = stop_reason
        out.step_text = step_text
        out.tool_use_blocks = tool_use_blocks
        out.assistant_content_blocks = assistant_content_blocks
        out.json_error_blocks = json_error_blocks
        return


async def _try_teaser_followup_recovery(
    *,
    step: int,
    system_prompt: list[dict],
    messages: list[dict],
    result: ChatLoopResult,
    pre_step_full_text: str,
    step_text: str,
    prev_step: _PrevStepState,
    client,
) -> None:
    """Recover with a fuller answer when post-tool continuation is too thin."""
    continuation_too_thin = (
        not step_text.strip()
        or len(step_text.strip()) < _THIN_CONTINUATION_CHAR_THRESHOLD
    )
    if not (
        step >= 1
        and prev_step.had_state_extraction_tools
        and prev_step.had_visible_assistant_text
        and continuation_too_thin
        and promises_substantive_followup_after_tools(pre_step_full_text)
    ):
        return
    logger.info(
        "Step %d: empty/short continuation after state extraction with teaser prose; "
        "forcing follow-up text recovery",
        step,
    )
    recovery_system_prompt = [*system_prompt, *POST_TOOL_TEASER_RECOVERY_SYSTEM]
    recovery = await generate_text_only_recovery_response(
        client,
        system=recovery_system_prompt,
        messages=messages,
    )
    if recovery is not None and recovery["text"].strip():
        merge_usage_summary(result.usage_summary, recovery["usage_summary"])
        result.full_text = pre_step_full_text
        recovery_body = recovery["text"].strip()
        if result.full_text and not result.full_text.endswith(("\n", " ")):
            result.full_text += "\n\n"
        result.full_text += recovery_body


async def _try_ancillary_tools_text_recovery(
    *,
    step: int,
    system_prompt: list[dict],
    messages: list[dict],
    result: ChatLoopResult,
    step_text: str,
    tool_use_blocks: list[dict],
    tool_exec_state: _ToolExecutionState,
    json_error_blocks: list[dict],
    client,
    emit_done_event: bool,
) -> str | None:
    """Force a final text-only reply after ancillary tool-only steps."""
    should_force_text_recovery = (
        not step_text.strip()
        and bool(tool_use_blocks)
        and not tool_exec_state.had_tool_errors
        and not json_error_blocks
        and {tool_block["name"] for tool_block in tool_use_blocks}
        <= TEXT_ONLY_RECOVERY_TOOL_NAMES
    )
    if not should_force_text_recovery:
        return None
    logger.info(
        "Step %d completed with ancillary tools only; forcing final text recovery",
        step,
    )
    recovery_system_prompt = [
        *system_prompt,
        {
            "type": "text",
            "text": (
                "RECOVERY MODE: Ancillary tool updates are already complete. "
                "Do not call tools. Reply directly to the buyer with one complete final answer."
            ),
        },
    ]
    recovery = await generate_text_only_recovery_response(
        client,
        system=recovery_system_prompt,
        messages=messages,
    )
    if recovery is None:
        return None
    merge_usage_summary(result.usage_summary, recovery["usage_summary"])
    result.full_text = recovery["text"]
    result.completed = True
    logger.info(
        "Chat loop fast recovery complete after ancillary tools: text_length=%d, tool_calls=%d",
        len(result.full_text),
        len(result.tool_calls),
    )
    if emit_done_event:
        return f"event: done\ndata: {json.dumps({'text': result.full_text})}\n\n"
    return ""


async def _final_max_steps_recovery(
    *,
    max_steps: int,
    system_prompt: list[dict],
    messages: list[dict],
    result: ChatLoopResult,
    client,
    emit_done_event: bool,
) -> list[str]:
    """Run final text-only recovery after exhausting max step budget."""
    logger.warning(
        "Chat loop hit max steps (%d), attempting final text-only recovery",
        max_steps,
    )
    recovery_system_prompt = [
        *system_prompt,
        {
            "type": "text",
            "text": (
                "RECOVERY MODE: Any necessary tool updates are already complete. "
                "Do not call tools. Reply directly to the buyer with one complete final answer. "
                "Rewrite the answer from scratch as a full response, not a continuation or explanation of tool usage."
            ),
        },
    ]
    recovery = await generate_text_only_recovery_response(
        client,
        system=recovery_system_prompt,
        messages=messages,
    )
    result.completed = True
    if recovery is not None:
        merge_usage_summary(result.usage_summary, recovery["usage_summary"])
        result.full_text = recovery["text"]
        logger.info(
            "Chat loop recovery complete after max steps: text_length=%d, tool_calls=%d",
            len(result.full_text),
            len(result.tool_calls),
        )
        if not emit_done_event:
            return []
        return [
            f"event: retry\ndata: {json.dumps({'attempt': 1, 'reason': 'max_steps_recovery', 'reset_text': True})}\n\n",
            f"event: done\ndata: {json.dumps({'text': result.full_text})}\n\n",
        ]
    logger.warning("Chat loop max-step recovery failed, emitting partial response")
    if emit_done_event:
        return [f"event: done\ndata: {json.dumps({'text': result.full_text})}\n\n"]
    return []


async def run_chat_loop_engine(
    *,
    client,
    system_prompt: list[dict],
    messages: list[dict],
    tools: list[dict],
    turn_context: TurnContext,
    result: ChatLoopResult,
    max_steps: int,
    session_factory,
    emit_done_event: bool = True,
    linked_messages: list[dict] | None = None,
    prompt_cache_prior_chat: dict[str, str] | None = None,
    is_cancelled=None,
) -> AsyncGenerator[str, None]:
    """Orchestrate multi-step chat/tool loop and emit SSE lifecycle events."""
    # Add cache_control to the last tool so the entire tool list is cached
    cached_tools = (
        [*tools[:-1], {**tools[-1], "cache_control": {"type": "ephemeral"}}]
        if tools
        else []
    )
    cache_state = _CacheState(last_chat_cache_snapshot=prompt_cache_prior_chat)
    prev_step = _PrevStepState()

    for step in range(max_steps):
        if is_cancelled and is_cancelled():
            result.interrupted = True
            result.interrupted_reason = "user_stop"
            logger.info("Chat loop interrupted before step %d", step)
            return
        turn_context = turn_context.for_step(step)
        # Notify frontend that a new step is starting (after tool execution)
        # so it can show a thinking indicator during multi-step loops.
        if step > 0:
            yield f"event: step\ndata: {json.dumps({'step': step})}\n\n"

        step_prompt_config = _build_step_prompt_config(
            step=step,
            system_prompt=system_prompt,
            prev_step=prev_step,
        )
        tool_choice_param = step_prompt_config.tool_choice_param
        step_system = step_prompt_config.step_system

        step_result = _StepIterationResult()
        async for sse_event in _stream_step_with_retries(
            step=step,
            client=client,
            system_prompt=system_prompt,
            step_system=step_system,
            messages=messages,
            cached_tools=cached_tools,
            tool_choice_param=tool_choice_param,
            turn_context=turn_context,
            result=result,
            cache_state=cache_state,
            is_cancelled=is_cancelled,
            out=step_result,
        ):
            yield sse_event
        if result.interrupted or result.failed:
            return

        stop_reason = step_result.stop_reason
        step_text = step_result.step_text
        tool_use_blocks = step_result.tool_use_blocks
        assistant_content_blocks = step_result.assistant_content_blocks
        json_error_blocks = step_result.json_error_blocks

        (
            pre_step_full_text,
            step_text,
            cache_state.last_appended_step_text_normalized,
        ) = _merge_step_text_with_dedupe(
            step=step,
            result=result,
            step_text=step_text,
            last_appended_step_text_normalized=cache_state.last_appended_step_text_normalized,
            prev_step=prev_step,
        )

        # If no tool calls, we're done — emit done event
        if stop_reason == "end_turn" or (not tool_use_blocks and not json_error_blocks):
            await _try_teaser_followup_recovery(
                step=step,
                system_prompt=system_prompt,
                messages=messages,
                result=result,
                pre_step_full_text=pre_step_full_text,
                step_text=step_text,
                prev_step=prev_step,
                client=client,
            )

            result.completed = True
            if emit_done_event:
                yield f"event: done\ndata: {json.dumps({'text': result.full_text})}\n\n"
            logger.info(
                "Chat loop complete: steps=%d, text_length=%d, tool_calls=%d",
                step + 1,
                len(result.full_text),
                len(result.tool_calls),
            )
            return

        tool_exec_state = _ToolExecutionState()
        for sse_event in _append_json_error_tool_results(
            step=step,
            json_error_blocks=json_error_blocks,
            assistant_content_blocks=assistant_content_blocks,
            tool_exec_state=tool_exec_state,
        ):
            yield sse_event

        async for sse_event in _execute_tool_calls(
            step=step,
            tool_use_blocks=tool_use_blocks,
            turn_context=turn_context,
            session_factory=session_factory,
            result=result,
            is_cancelled=is_cancelled,
            tool_exec_state=tool_exec_state,
        ):
            yield sse_event
        if result.interrupted:
            return

        await _append_tool_results_to_messages(
            messages=messages,
            assistant_content_blocks=assistant_content_blocks,
            tool_result_content=tool_exec_state.tool_result_content,
            turn_context=turn_context,
            linked_messages=linked_messages,
        )

        done_event = await _try_ancillary_tools_text_recovery(
            step=step,
            system_prompt=system_prompt,
            messages=messages,
            result=result,
            step_text=step_text,
            tool_use_blocks=tool_use_blocks,
            tool_exec_state=tool_exec_state,
            json_error_blocks=json_error_blocks,
            client=client,
            emit_done_event=emit_done_event,
        )
        if done_event is not None:
            if done_event:
                yield done_event
            return

        prev_step.update(
            had_tool_errors=tool_exec_state.had_tool_errors,
            step_text=step_text,
            tool_use_blocks=tool_use_blocks,
        )

        # Move the cache breakpoint to the last message so the next step's
        # API call caches everything up to this point (two-breakpoint caching).
        move_message_cache_breakpoint(messages)

    for sse_event in await _final_max_steps_recovery(
        max_steps=max_steps,
        system_prompt=system_prompt,
        messages=messages,
        result=result,
        client=client,
        emit_done_event=emit_done_event,
    ):
        yield sse_event
