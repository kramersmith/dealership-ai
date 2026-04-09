"""SSE stream for a single buyer chat turn (step loop, done, panel, persistence).

Shared by ``POST /chat/.../message`` and ``POST /chat/.../messages/.../branch``.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.deal_state import DealState
from app.models.enums import MessageRole
from app.models.message import Message
from app.models.session import ChatSession
from app.services.chat_harness_log import (
    log_chat_harness_verbose_event,
    log_chat_turn_summary,
)
from app.services.claude import (
    CHAT_TOOLS,
    ChatLoopResult,
    build_context_message,
    build_messages,
    merge_usage_summary,
    stream_chat_loop,
)
from app.services.compaction import project_for_model, run_auto_compaction_if_needed
from app.services.deal_state import deal_state_to_dict
from app.services.panel import stream_ai_panel_cards_with_usage
from app.services.post_chat_processing import update_session_metadata
from app.services.turn_context import TurnContext
from app.services.usage_tracking import (
    SessionUsageSummary,
    build_request_usage,
)

logger = logging.getLogger(__name__)


def _message_usage_payload(summary: dict[str, int]) -> dict[str, int]:
    return {
        "requests": summary.get("requests", 0),
        "inputTokens": summary.get("input_tokens", 0),
        "outputTokens": summary.get("output_tokens", 0),
        "cacheCreationInputTokens": summary.get("cache_creation_input_tokens", 0),
        "cacheReadInputTokens": summary.get("cache_read_input_tokens", 0),
        "totalTokens": summary.get("total_tokens", 0),
    }


def _error_sse(message: str) -> str:
    return f"event: error\ndata: {json.dumps({'message': message})}\n\n"


async def stream_buyer_chat_turn(
    *,
    db: AsyncSession,
    session: ChatSession,
    session_id: str,
    content: str,
    image_url: str | None,
    resumed_user_row: Message | None,
    history: list[Message],
    deal_state: DealState | None,
    deal_state_dict: dict | None,
    linked_messages: list[dict] | None,
    system_prompt: list[dict[str, Any]],
    include_timeline_fork_reminder: bool = False,
) -> AsyncIterator[str]:
    """Run compaction, user row upsert, chat loop, panel, and final commit; yield SSE chunks."""
    result = ChatLoopResult()
    session_usage = SessionUsageSummary.from_dict(session.usage)
    turn_context = TurnContext.create(
        session=session,
        deal_state=deal_state,
        db=db,
    )

    resumed_user_id = resumed_user_row.id if resumed_user_row else None

    def _without_resumed_user(message_rows: list[Message]) -> list[Message]:
        if not resumed_user_id:
            return message_rows
        return [message for message in message_rows if message.id != resumed_user_id]

    context_message = build_context_message(
        deal_state_dict,
        linked_messages,
        include_timeline_fork_reminder=include_timeline_fork_reminder,
        user_turn_text=content,
    )

    history_local = _without_resumed_user(history)

    compaction_result = await run_auto_compaction_if_needed(
        session,
        history_local,
        content,
        image_url,
        context_message,
        linked_messages,
    )
    for chunk in compaction_result.sse_chunks:
        yield chunk

    log_chat_harness_verbose_event(
        "compaction",
        {
            "session_id": session_id,
            "persisted": bool(
                compaction_result.updated_state is not None
                or compaction_result.system_notice_content
            ),
            "has_updated_state": compaction_result.updated_state is not None,
            "system_notice_chars": len(compaction_result.system_notice_content or ""),
            "compaction_sse_chunks": len(compaction_result.sse_chunks),
        },
    )

    if compaction_result.updated_state is not None:
        session.compaction_state = compaction_result.updated_state
    if compaction_result.system_notice_content:
        notice = Message(
            session_id=session_id,
            role=MessageRole.SYSTEM,
            content=compaction_result.system_notice_content,
        )
        db.add(notice)
    if (
        compaction_result.updated_state is not None
        or compaction_result.system_notice_content
    ):
        try:
            await db.commit()
        except Exception:
            logger.exception("Compaction persistence failed: session_id=%s", session_id)
            await db.rollback()
            yield _error_sse(
                "We hit a problem preparing this chat turn. Please try again."
            )
            return
        refreshed = await db.execute(
            select(Message)
            .where(Message.session_id == session_id)
            .order_by(Message.created_at, Message.id)
        )
        history_local = _without_resumed_user(list(refreshed.scalars().all()))

    user_created_this_request = resumed_user_row is None

    user_message_id: str | None = None

    if resumed_user_row is not None:
        user_message = resumed_user_row
        user_message.content = content
        user_message.image_url = image_url
    else:
        user_message = Message(
            session_id=session_id,
            role=MessageRole.USER,
            content=content,
            image_url=image_url,
        )
        db.add(user_message)

    try:
        await db.commit()
        await db.refresh(user_message)
        user_message_id = user_message.id
    except Exception:
        logger.exception(
            "User message persistence failed: session_id=%s resumed=%s",
            session_id,
            resumed_user_row is not None,
        )
        await db.rollback()
        yield _error_sse("We could not save your message. Please try again.")
        return

    prefix, tail = project_for_model(history_local, session.compaction_state)
    messages = build_messages(
        tail,
        content,
        image_url,
        context_message,
        compaction_prefix=prefix or None,
    )

    async def _remove_orphan_user_message(reason: str) -> None:
        if not user_created_this_request or user_message_id is None:
            return
        try:
            await db.execute(delete(Message).where(Message.id == user_message_id))
            await db.commit()
        except Exception:
            logger.exception(
                "Failed to remove orphan user message (%s): session_id=%s",
                reason,
                session_id,
            )

    try:
        async for sse_event in stream_chat_loop(
            system_prompt,
            messages,
            CHAT_TOOLS,
            turn_context,
            result,
            emit_done_event=False,
            linked_messages=linked_messages,
            prompt_cache_prior_chat=session_usage.prompt_cache_chat_last,
        ):
            yield sse_event
    except Exception:
        logger.exception("Chat stream aborted: session_id=%s", session_id)
        await _remove_orphan_user_message("stream abort")
        raise

    session_usage.prompt_cache_chat_last = result.prompt_cache_chat_last
    session_usage.prompt_cache_break_count += result.prompt_cache_breaks

    if result.failed:
        logger.error("Step loop failed: session_id=%s", session_id)
        await _remove_orphan_user_message("failed step loop")
        return

    logger.debug(
        "Step loop complete: text_length=%d, tool_calls=%d, session_id=%s",
        len(result.full_text),
        len(result.tool_calls),
        session_id,
    )
    log_chat_harness_verbose_event(
        "step_loop",
        lambda: {
            "session_id": session_id,
            "text_length": len(result.full_text),
            "tool_call_rows": len(result.tool_calls),
            "tool_calls": result.tool_calls,
        },
    )

    updated_state_dict = None
    final_panel_cards: list[dict] | None = None
    if deal_state:
        try:
            await db.refresh(deal_state)
            updated_state_dict = await deal_state_to_dict(deal_state, db)
        except Exception:
            logger.exception(
                "Deal state refresh failed before panel generation: session_id=%s",
                session_id,
            )

    assistant_message = Message(
        session_id=session_id,
        role=MessageRole.ASSISTANT,
        content=result.full_text,
        tool_calls=result.tool_calls if result.tool_calls else None,
        usage=_message_usage_payload(result.usage_summary),
    )
    db.add(assistant_message)

    try:
        await db.commit()
        await db.refresh(assistant_message)
    except Exception:
        logger.exception("Assistant message persist failed: session_id=%s", session_id)
        await db.rollback()
        await _remove_orphan_user_message("assistant persist failure")
        await db.refresh(session)
        yield _error_sse("We could not save the assistant response. Please try again.")
        return

    yield f"event: done\ndata: {json.dumps({'text': result.full_text, 'usage': _message_usage_payload(result.usage_summary)})}\n\n"

    all_messages = [
        {"role": message.role, "content": message.content}
        for message in [*history_local, user_message, assistant_message]
        if message.role in (MessageRole.USER, MessageRole.ASSISTANT)
    ]

    if deal_state and updated_state_dict is not None:
        logger.debug("Streaming AI panel cards, session_id=%s", session_id)
        panel_started = False
        panel_finished = False
        panel_completed = False
        try:
            panel_usage_summary: dict[str, int] | None = None
            latest_cards: list[dict] = []

            panel_prompt_cache: dict = {
                "prior": session_usage.prompt_cache_panel_last,
                "breaks_delta": 0,
            }
            async for panel_event in stream_ai_panel_cards_with_usage(
                updated_state_dict or {},
                result.full_text,
                all_messages,
                session_id=session_id,
                panel_prompt_cache=panel_prompt_cache,
            ):
                if panel_event.type == "panel_started":
                    panel_started = True
                    yield f"event: panel_started\ndata: {json.dumps(panel_event.data)}\n\n"
                elif panel_event.type == "panel_done":
                    panel_finished = True
                    panel_completed = True
                    latest_cards = panel_event.data.get("cards", latest_cards)
                    panel_usage_summary = panel_event.data.get("usage_summary")
                    payload = {
                        "cards": latest_cards,
                        "usage": _message_usage_payload(panel_usage_summary or {}),
                        "assistant_message_id": assistant_message.id,
                    }
                    yield f"event: panel_done\ndata: {json.dumps(payload)}\n\n"
                elif panel_event.type == "panel_error":
                    panel_finished = True
                    yield f"event: panel_error\ndata: {json.dumps(panel_event.data)}\n\n"

            if panel_usage_summary:
                merge_usage_summary(result.usage_summary, panel_usage_summary)

            session_usage.prompt_cache_panel_last = panel_prompt_cache.get("last")
            session_usage.prompt_cache_break_count += panel_prompt_cache.get(
                "breaks_delta", 0
            )

            if panel_completed:
                deal_state.ai_panel_cards = latest_cards
                final_panel_cards = latest_cards
                assistant_message.panel_cards = latest_cards
                panel_tool_call = {
                    "name": "update_insights_panel",
                    "args": {"cards": latest_cards},
                }
                result.tool_calls.append(panel_tool_call)
                logger.info(
                    "Persisted %d AI panel cards, session_id=%s",
                    len(latest_cards),
                    session_id,
                )
                log_chat_harness_verbose_event(
                    "panel",
                    {
                        "session_id": session_id,
                        "card_count": len(latest_cards),
                        "kinds": [card.get("kind") for card in latest_cards],
                    },
                )
        except Exception:
            logger.exception("AI panel generation failed: session_id=%s", session_id)
            if panel_started and not panel_finished:
                yield 'event: panel_error\ndata: {"message": "Panel generation failed"}\n\n'

    assistant_message.tool_calls = result.tool_calls if result.tool_calls else None
    assistant_message.usage = _message_usage_payload(result.usage_summary)

    try:
        if result.usage_summary.get("requests", 0) > 0:
            session_usage.add_request(
                build_request_usage(
                    model=settings.CLAUDE_MODEL,
                    usage_summary=result.usage_summary,
                )
            )
        await update_session_metadata(
            session=session,
            deal_state=deal_state,
            messages=all_messages,
            tool_calls=result.tool_calls,
            response_text=result.full_text,
            user_message=content,
            db=db,
            usage_recorder=session_usage.add_request,
        )
    except Exception:
        logger.exception("Session metadata update failed: session_id=%s", session_id)

    session.usage = session_usage.to_dict()
    session.updated_at = datetime.now(timezone.utc)

    try:
        await db.commit()
    except Exception:
        logger.exception("Final db.commit failed: session_id=%s", session_id)
        await db.rollback()
        yield _error_sse(
            "Your reply was delivered, but we could not save the latest chat updates. Refresh if anything looks out of date."
        )
        return

    logger.info(
        "Chat response complete: session_id=%s, text_length=%d, tool_calls=%d",
        session_id,
        len(result.full_text),
        len(result.tool_calls),
    )
    # Harness logging is observability only — never let a serialization,
    # redaction, or handler-flush error break an otherwise-successful chat
    # turn. The turn has already been persisted and streamed by this point.
    try:
        log_chat_turn_summary(
            session_id=session_id,
            user_text=content,
            assistant_text=result.full_text,
            tool_calls=result.tool_calls,
            final_panel_cards=final_panel_cards,
        )
    except Exception:
        logger.exception("chat_turn_summary emission failed: session_id=%s", session_id)
