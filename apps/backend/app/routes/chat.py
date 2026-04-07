import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import StreamingResponse

from app.core.config import settings
from app.core.deps import get_current_user, get_db
from app.models.deal_state import DealState
from app.models.enums import MessageRole
from app.models.message import Message
from app.models.session import ChatSession
from app.models.user import User
from app.schemas.chat import (
    ChatMessageRequest,
    ContextPressureResponse,
    MessageResponse,
    MessagesListResponse,
)
from app.services.claude import (
    CHAT_TOOLS,
    ChatLoopResult,
    build_context_message,
    build_messages,
    build_system_prompt,
    merge_usage_summary,
    stream_chat_loop,
)
from app.services.compaction import (
    compute_session_context_pressure,
    project_for_model,
    run_auto_compaction_if_needed,
)
from app.services.deal_state import deal_state_to_dict
from app.services.panel import stream_ai_panel_cards_with_usage
from app.services.post_chat_processing import update_session_metadata
from app.services.turn_context import TurnContext
from app.services.usage_tracking import (
    SessionUsageSummary,
    build_request_usage,
)

logger = logging.getLogger(__name__)

router = APIRouter()


async def _load_deal_and_linked_context(
    session: ChatSession,
    db: AsyncSession,
) -> tuple[DealState | None, dict | None, list[dict] | None]:
    """Load deal state dict and linked session messages for context building."""
    deal_state_result = await db.execute(
        select(DealState).where(DealState.session_id == session.id)
    )
    deal_state = deal_state_result.scalar_one_or_none()
    deal_state_dict = await deal_state_to_dict(deal_state, db) if deal_state else None

    linked_messages = None
    if session.linked_session_ids:
        linked_result = await db.execute(
            select(Message)
            .where(Message.session_id.in_(session.linked_session_ids))
            .order_by(Message.created_at)
        )
        linked_msgs = list(linked_result.scalars().all())
        linked_messages = [{"role": m.role, "content": m.content} for m in linked_msgs]

    return deal_state, deal_state_dict, linked_messages


def _message_usage_payload(summary: dict[str, int]) -> dict[str, int]:
    return {
        "requests": summary.get("requests", 0),
        "inputTokens": summary.get("input_tokens", 0),
        "outputTokens": summary.get("output_tokens", 0),
        "cacheCreationInputTokens": summary.get("cache_creation_input_tokens", 0),
        "cacheReadInputTokens": summary.get("cache_read_input_tokens", 0),
        "totalTokens": summary.get("total_tokens", 0),
    }


@router.post("/{session_id}/message")
async def send_message(
    session_id: str,
    body: ChatMessageRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Verify session belongs to user
    session_result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == user.id,
        )
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    logger.info("Chat message received: session_id=%s, user_id=%s", session_id, user.id)

    # Load message history before the new user turn (compaction + projection use this)
    history_result = await db.execute(
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.created_at)
    )
    history = list(history_result.scalars().all())

    deal_state, deal_state_dict, linked_messages = await _load_deal_and_linked_context(
        session, db
    )

    system_prompt = build_system_prompt()
    context_message = build_context_message(deal_state_dict, linked_messages)

    async def generate():
        result = ChatLoopResult()
        session_usage = SessionUsageSummary.from_dict(session.usage)
        turn_context = TurnContext.create(
            session=session,
            deal_state=deal_state,
            db=db,
        )

        history_local = history

        compaction_result = await run_auto_compaction_if_needed(
            session,
            history_local,
            body.content,
            body.image_url,
            context_message,
            linked_messages,
        )
        for chunk in compaction_result.sse_chunks:
            yield chunk

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
            await db.commit()
            refreshed = await db.execute(
                select(Message)
                .where(Message.session_id == session_id)
                .order_by(Message.created_at)
            )
            history_local = list(refreshed.scalars().all())

        user_msg = Message(
            session_id=session_id,
            role=MessageRole.USER,
            content=body.content,
            image_url=body.image_url,
        )
        db.add(user_msg)
        await db.commit()
        await db.refresh(user_msg)

        prefix, tail = project_for_model(history_local, session.compaction_state)
        messages = build_messages(
            tail,
            body.content,
            body.image_url,
            context_message,
            compaction_prefix=prefix or None,
        )

        async def _remove_orphan_user_message(reason: str) -> None:
            """Delete the user message when the step loop fails before persisting an assistant reply."""
            try:
                await db.execute(delete(Message).where(Message.id == user_msg.id))
                await db.commit()
            except Exception:
                logger.exception(
                    "Failed to remove orphan user message (%s): session_id=%s",
                    reason,
                    session_id,
                )

        # ── Step loop: stream text + execute tools until done ──
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

        # ── Emit done immediately so the frontend can unblock input ──
        # Usage here reflects the step loop only (panel generation costs
        # are added to the persisted message but not to this SSE event).
        yield f"event: done\ndata: {json.dumps({'text': result.full_text, 'usage': _message_usage_payload(result.usage_summary)})}\n\n"

        panel_history = await db.execute(
            select(Message)
            .where(Message.session_id == session_id)
            .order_by(Message.created_at)
        )
        panel_rows = list(panel_history.scalars().all())
        all_messages = [
            {"role": m.role, "content": m.content}
            for m in panel_rows
            if m.role in (MessageRole.USER, MessageRole.ASSISTANT)
        ]
        if result.full_text:
            all_messages.append({"role": "assistant", "content": result.full_text})

        # ── Panel generation: stream AI insight cards asynchronously ──
        # Runs after done so chat remains responsive while panel updates stream in.
        if deal_state:
            logger.debug("Streaming AI panel cards, session_id=%s", session_id)
            panel_started = False
            panel_finished = False
            panel_completed = False
            try:
                await db.refresh(deal_state)
                updated_state_dict = await deal_state_to_dict(deal_state, db)
                panel_usage_summary: dict[str, int] | None = None
                latest_cards: list[dict] = []

                panel_prompt_cache: dict = {
                    "prior": session_usage.prompt_cache_panel_last,
                    "breaks_delta": 0,
                }
                async for panel_event in stream_ai_panel_cards_with_usage(
                    updated_state_dict,
                    result.full_text,
                    all_messages,
                    session_id=session_id,
                    panel_prompt_cache=panel_prompt_cache,
                ):
                    if panel_event.type == "panel_started":
                        panel_started = True
                        yield f"event: panel_started\ndata: {json.dumps(panel_event.data)}\n\n"
                    elif panel_event.type == "panel_card":
                        latest_cards.append(panel_event.data["card"])
                        yield f"event: panel_card\ndata: {json.dumps(panel_event.data)}\n\n"
                    elif panel_event.type == "panel_done":
                        panel_finished = True
                        panel_completed = True
                        latest_cards = panel_event.data.get("cards", latest_cards)
                        panel_usage_summary = panel_event.data.get("usage_summary")
                        payload = {
                            "cards": latest_cards,
                            "usage": _message_usage_payload(panel_usage_summary or {}),
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
            except Exception:
                logger.exception(
                    "AI panel generation failed: session_id=%s", session_id
                )
                if panel_started and not panel_finished:
                    yield 'event: panel_error\ndata: {"message": "Panel generation failed"}\n\n'

        # Persist assistant message (includes full usage with panel costs)
        assistant_msg = Message(
            session_id=session_id,
            role=MessageRole.ASSISTANT,
            content=result.full_text,
            tool_calls=result.tool_calls if result.tool_calls else None,
            usage=_message_usage_payload(result.usage_summary),
        )
        db.add(assistant_msg)

        # Update session metadata (preview + title)
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
                user_message=body.content,
                db=db,
                usage_recorder=session_usage.add_request,
            )
        except Exception:
            logger.exception(
                "Session metadata update failed: session_id=%s", session_id
            )

        session.usage = session_usage.to_dict()

        # Update session timestamp
        session.updated_at = datetime.now(timezone.utc)

        try:
            await db.commit()
        except Exception:
            logger.exception("Final db.commit failed: session_id=%s", session_id)
            await db.rollback()
            return

        logger.info(
            "Chat response complete: session_id=%s, text_length=%d, tool_calls=%d",
            session_id,
            len(result.full_text),
            len(result.tool_calls),
        )

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.get("/{session_id}/messages", response_model=MessagesListResponse)
async def get_messages(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session_result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == user.id,
        )
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    messages_result = await db.execute(
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.created_at)
    )
    rows = list(messages_result.scalars().all())

    _, deal_state_dict, linked_messages = await _load_deal_and_linked_context(
        session, db
    )

    context_message = build_context_message(deal_state_dict, linked_messages)
    pressure = compute_session_context_pressure(
        rows, session.compaction_state, context_message, linked_messages
    )
    return MessagesListResponse(
        messages=[MessageResponse.model_validate(m) for m in rows],
        context_pressure=ContextPressureResponse(**pressure),
    )
