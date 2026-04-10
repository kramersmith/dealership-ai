from __future__ import annotations

import json
import logging
from collections.abc import AsyncGenerator

import anthropic

from app.core.config import settings
from app.services.claude import streaming as claude_streaming
from app.services.claude.client import create_anthropic_client
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
    empty_usage_summary,
    get_escalated_max_tokens,
    merge_usage_summary,
    summarize_usage,
)
from app.services.tool_validation import ToolValidationError
from app.services.turn_context import TurnContext

logger = logging.getLogger(__name__)


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


# Maximum steps (LLM call → tool execution cycles) per turn
CHAT_LOOP_MAX_STEPS = 5


async def stream_chat_loop(  # noqa: C901 — step loop has inherent complexity
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
    """Step loop: call Claude with tools, execute tool calls, repeat until text response.

    Streams SSE events as they arrive:
    - event: text — conversation text chunks (streamed live)
    - event: tool_result — tool execution results (emitted after each tool)
    - event: done — final text when loop completes

    Populates `result` with accumulated full_text and all tool_calls.
    """
    from app.services.deal_state import build_execution_plan, deal_state_to_dict
    from app.services.prompt_cache_signature import (
        CHAT_STABLE_CACHE_KEYS,
        DEFAULT_PROMPT_CACHE_BETAS,
        build_chat_stable_cache_snapshot,
        log_prompt_cache_break,
        prompt_cache_components_changed,
    )

    if session_factory is None:
        from app.db.session import AsyncSessionLocal

        session_factory = AsyncSessionLocal

    client = create_anthropic_client()

    # Add cache_control to the last tool so the entire tool list is cached
    cached_tools = [*tools[:-1], {**tools[-1], "cache_control": {"type": "ephemeral"}}]
    last_chat_cache_snapshot: dict[str, str] | None = prompt_cache_prior_chat
    last_appended_step_text_normalized = ""
    prev_step_tool_errors = True
    prev_step_had_visible_assistant_text = False
    prev_step_tools_were_dashboard_only = False
    prev_step_had_state_extraction_tools = False
    prev_step_had_any_tools = False
    prev_step_tool_names: frozenset[str] = frozenset()

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

        step_tool_policy = chat_tool_choice_for_step(
            step,
            prev_step_had_tool_errors=prev_step_tool_errors,
            prev_step_had_visible_assistant_text=prev_step_had_visible_assistant_text,
            prev_step_tools_were_dashboard_only=prev_step_tools_were_dashboard_only,
            prev_step_tool_names=prev_step_tool_names,
        )
        tool_choice_param = step_tool_policy.tool_choice
        if tool_choice_param["type"] == "none":
            if not prev_step_had_visible_assistant_text:
                step_system = [*system_prompt, *CONTINUATION_AFTER_TOOL_ONLY_SYSTEM]
            elif prev_step_had_state_extraction_tools:
                step_system = [
                    *system_prompt,
                    *CONTINUATION_AFTER_STATE_EXTRACTION_SYSTEM,
                ]
            else:
                step_system = [*system_prompt, *CONTINUATION_TEXT_ONLY_SYSTEM]
        else:
            step_system = system_prompt
            if step_tool_policy.inject_dashboard_reconcile_nudge:
                step_system = [
                    *step_system,
                    *DASHBOARD_RECONCILE_AFTER_ASSESSMENT_TOOLS,
                ]
            elif step_tool_policy.inject_post_extraction_assessment_nudge:
                step_system = [*step_system, *POST_EXTRACTION_ASSESSMENT_NUDGE]
            elif (
                step == 1
                and not prev_step_had_visible_assistant_text
                and not prev_step_tool_errors
            ):
                step_system = [*step_system, *STEP_AFTER_TOOL_ONLY_NUDGE]

        current_max_tokens = settings.CLAUDE_MAX_TOKENS
        truncation_retry_count = 0

        while True:
            step_text = ""
            tool_use_blocks: list[dict] = []  # {id, name, input}
            assistant_content_blocks: list[dict] = []  # raw content blocks for messages

            # Track streaming state for tool_use accumulation
            current_tool_id: str | None = None
            current_tool_name: str | None = None
            current_tool_input_json = ""
            json_error_blocks: list[dict] = []  # tool_use blocks with malformed JSON

            try:
                stop_reason = None
                cache_snap = build_chat_stable_cache_snapshot(
                    base_system=system_prompt,
                    tools=cached_tools,
                    model=settings.CLAUDE_MODEL,
                    betas=DEFAULT_PROMPT_CACHE_BETAS,
                )
                cache_changed = prompt_cache_components_changed(
                    last_chat_cache_snapshot,
                    cache_snap,
                    component_keys=CHAT_STABLE_CACHE_KEYS,
                )
                if last_chat_cache_snapshot is not None and cache_changed:
                    sid = turn_context.session.id if turn_context.session else None
                    log_prompt_cache_break(
                        logger,
                        session_id=sid,
                        phase="chat",
                        step=step,
                        prior=last_chat_cache_snapshot,
                        current=cache_snap,
                        changed_components=cache_changed,
                    )
                    result.prompt_cache_breaks += 1
                last_chat_cache_snapshot = cache_snap
                result.prompt_cache_chat_last = cache_snap

                async for (
                    event_type,
                    event_data,
                ) in claude_streaming.stream_step_with_retry(
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
                        # Reset step accumulators — partial data from retried streams is unreliable
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
                        merge_usage_summary(
                            result.usage_summary, summarize_usage(usage)
                        )
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

                    # event_type == "stream_event"
                    event = event_data
                    if event.type == "content_block_start":
                        if hasattr(event.content_block, "type"):
                            if event.content_block.type == "text":
                                pass  # text accumulates via deltas
                            elif event.content_block.type == "tool_use":
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

                # Capture text as a content block if present
                if step_text:
                    assistant_content_blocks.insert(
                        0, {"type": "text", "text": step_text}
                    )

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
                    org = exc.response.headers.get("anthropic-organization-id")
                    logger.error(
                        "Chat loop step %d failed: Anthropic credits/billing "
                        "(anthropic_organization_id=%s, request_id=%s)",
                        step,
                        org or "(unknown)",
                        exc.request_id or "(unknown)",
                    )
                else:
                    logger.exception("Chat loop step %d failed", step)
                result.failed = True
                user_msg = user_visible_message_for_anthropic_error(exc)
                yield f"event: error\ndata: {json.dumps({'message': user_msg})}\n\n"
                return
            except Exception:
                logger.exception("Chat loop step %d failed", step)
                result.failed = True
                yield f"event: error\ndata: {json.dumps({'message': 'AI response failed. Please try again.'})}\n\n"
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

            break

        pre_step_full_text = result.full_text

        if (
            step >= 1
            and prev_step_had_any_tools
            and prev_step_had_visible_assistant_text
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

        # Accumulate text across steps — add paragraph break between steps
        # so multi-step text (step 0 text + tool execution + step 1 text)
        # doesn't run together without whitespace.
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
        else:
            if (
                step_text
                and result.full_text
                and not result.full_text.endswith(("\n", " "))
            ):
                result.full_text += "\n\n"
            result.full_text += step_text
            if normalized_step_text:
                last_appended_step_text_normalized = normalized_step_text

        # If no tool calls, we're done — emit done event
        if stop_reason == "end_turn" or (not tool_use_blocks and not json_error_blocks):
            continuation_too_thin = (
                not step_text.strip() or len(step_text.strip()) < 120
            )
            if (
                step >= 1
                and prev_step_had_state_extraction_tools
                and prev_step_had_visible_assistant_text
                and continuation_too_thin
                and promises_substantive_followup_after_tools(pre_step_full_text)
            ):
                logger.info(
                    "Step %d: empty/short continuation after state extraction with teaser prose; "
                    "forcing follow-up text recovery",
                    step,
                )
                recovery_system_prompt = [
                    *system_prompt,
                    *POST_TOOL_TEASER_RECOVERY_SYSTEM,
                ]
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

        # Execute tool calls and emit SSE events
        tool_result_content: list[dict] = []
        had_tool_errors = False

        # Send error tool_results for any tool_use blocks with malformed JSON
        for err_block in json_error_blocks:
            had_tool_errors = True
            error_msg = f"Tool '{err_block['name']}' received malformed JSON input"
            tool_result_content.append(
                {
                    "type": "tool_result",
                    "tool_use_id": err_block["id"],
                    "is_error": True,
                    "content": error_msg,
                }
            )
            # Include the broken tool_use in assistant content so the message
            # history stays valid (every tool_result needs a matching tool_use)
            assistant_content_blocks.append(
                {
                    "type": "tool_use",
                    "id": err_block["id"],
                    "name": err_block["name"],
                    "input": {},
                }
            )
            yield f"event: tool_error\ndata: {json.dumps({'tool': err_block['name'], 'error': 'Malformed tool input'})}\n\n"

        if turn_context.deal_state:
            execution_plan = build_execution_plan(tool_use_blocks)
            for batch in execution_plan:
                if is_cancelled and is_cancelled():
                    result.interrupted = True
                    result.interrupted_reason = "user_stop"
                    logger.info(
                        "Chat loop interrupted before tool batch at step %d", step
                    )
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
                        had_tool_errors = True
                        if isinstance(outcome, ToolValidationError):
                            error_msg = (
                                f"Tool '{tool_name}' validation failed: {outcome}"
                            )
                        else:
                            error_msg = f"Tool '{tool_name}' failed: {outcome}"
                        tool_result_content.append(
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

                    tool_result_content.append(
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
        else:
            for tool_block in tool_use_blocks:
                tool_name = tool_block["name"]
                had_tool_errors = True
                error_msg = f"Tool '{tool_name}' cannot execute: no deal state exists for this session"
                logger.warning(
                    "Step %d: tool [%s] called but no deal_state", step, tool_name
                )
                tool_result_content.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_block["id"],
                        "is_error": True,
                        "content": error_msg,
                    }
                )
                yield f"event: tool_error\ndata: {json.dumps({'tool': tool_name, 'error': 'No deal state available'})}\n\n"

        # Append assistant response + all tool results in a single user message
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
                turn_context.deal_state,
                turn_context.db,
            )
            updated_context_message = build_context_message(
                updated_state_dict,
                linked_messages,
            )
            replace_context_message(messages, updated_context_message)

        should_force_text_recovery = (
            not step_text.strip()
            and bool(tool_use_blocks)
            and not had_tool_errors
            and not json_error_blocks
            and {tool_block["name"] for tool_block in tool_use_blocks}
            <= TEXT_ONLY_RECOVERY_TOOL_NAMES
        )
        if should_force_text_recovery:
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
            if recovery is not None:
                merge_usage_summary(result.usage_summary, recovery["usage_summary"])
                result.full_text = recovery["text"]
                result.completed = True
                if emit_done_event:
                    yield f"event: done\ndata: {json.dumps({'text': result.full_text})}\n\n"
                logger.info(
                    "Chat loop fast recovery complete after ancillary tools: text_length=%d, tool_calls=%d",
                    len(result.full_text),
                    len(result.tool_calls),
                )
                return

        prev_step_tool_errors = had_tool_errors
        prev_step_had_visible_assistant_text = bool(step_text.strip())
        prev_step_tools_were_dashboard_only = (
            bool(tool_use_blocks)
            and {b["name"] for b in tool_use_blocks} <= SESSION_SCOPED_DASHBOARD_TOOLS
        )
        prev_step_had_state_extraction_tools = bool(tool_use_blocks) and bool(
            {b["name"] for b in tool_use_blocks} & STATE_EXTRACTION_TOOLS
        )
        prev_step_had_any_tools = bool(tool_use_blocks)
        prev_step_tool_names = frozenset(b["name"] for b in tool_use_blocks)

        # Move the cache breakpoint to the last message so the next step's
        # API call caches everything up to this point (two-breakpoint caching).
        move_message_cache_breakpoint(messages)

    # Max steps exceeded — try one final tools-disabled answer recovery.
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
        if emit_done_event:
            yield f"event: retry\ndata: {json.dumps({'attempt': 1, 'reason': 'max_steps_recovery', 'reset_text': True})}\n\n"
            yield f"event: done\ndata: {json.dumps({'text': result.full_text})}\n\n"
        logger.info(
            "Chat loop recovery complete after max steps: text_length=%d, tool_calls=%d",
            len(result.full_text),
            len(result.tool_calls),
        )
        return

    logger.warning("Chat loop max-step recovery failed, emitting partial response")
    if emit_done_event:
        yield f"event: done\ndata: {json.dumps({'text': result.full_text})}\n\n"
