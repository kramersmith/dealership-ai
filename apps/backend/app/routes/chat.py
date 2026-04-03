import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import StreamingResponse

from app.core.config import settings
from app.core.deps import get_current_user, get_db
from app.models.deal_state import DealState
from app.models.enums import MessageRole
from app.models.message import Message
from app.models.session import ChatSession
from app.models.user import User
from app.schemas.chat import ChatMessageRequest, MessageResponse
from app.services.claude import (
    CHAT_TOOLS,
    ChatLoopResult,
    build_context_message,
    build_messages,
    build_system_prompt,
    merge_usage_summary,
    stream_chat_loop,
)
from app.services.deal_state import deal_state_to_dict
from app.services.panel import generate_ai_panel_cards_with_usage
from app.services.post_chat_processing import update_session_metadata
from app.services.usage_tracking import (
    SessionUsageSummary,
    build_request_usage,
    session_usage_payload,
)

logger = logging.getLogger(__name__)

router = APIRouter()


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

    # Load message history BEFORE saving the new user message
    # (build_messages will append the current message separately)
    history_result = await db.execute(
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.created_at)
    )
    history = list(history_result.scalars().all())
    history_dicts = [{"role": m.role, "content": m.content} for m in history]

    # Save user message
    user_msg = Message(
        session_id=session_id,
        role=MessageRole.USER,
        content=body.content,
        image_url=body.image_url,
    )
    db.add(user_msg)
    await db.commit()

    # Load deal state
    deal_state_result = await db.execute(
        select(DealState).where(DealState.session_id == session_id)
    )
    deal_state = deal_state_result.scalar_one_or_none()
    deal_state_dict = await deal_state_to_dict(deal_state, db) if deal_state else None

    # Load linked session context (if any)
    linked_messages = None
    if session.linked_session_ids:
        linked_result = await db.execute(
            select(Message)
            .where(Message.session_id.in_(session.linked_session_ids))
            .order_by(Message.created_at)
        )
        linked_msgs = list(linked_result.scalars().all())
        linked_messages = [{"role": m.role, "content": m.content} for m in linked_msgs]

    # Build Claude request — system prompt is static, dynamic context goes in messages
    system_prompt = build_system_prompt()
    context_message = build_context_message(deal_state_dict, linked_messages)
    messages = build_messages(
        history_dicts, body.content, body.image_url, context_message
    )

    async def generate():
        result = ChatLoopResult()
        session_usage = SessionUsageSummary.from_dict(session.usage)

        # ── Step loop: stream text + execute tools until done ──
        async for sse_event in stream_chat_loop(
            system_prompt,
            messages,
            CHAT_TOOLS,
            deal_state,
            db,
            result,
            emit_done_event=False,
        ):
            yield sse_event

        if result.failed:
            logger.warning("Step loop failed: session_id=%s", session_id)
            return

        logger.debug(
            "Step loop complete: text_length=%d, tool_calls=%d, session_id=%s",
            len(result.full_text),
            len(result.tool_calls),
            session_id,
        )

        # Build full message list for panel generation and metadata
        all_messages = [*history_dicts, {"role": "user", "content": body.content}]
        if result.full_text:
            all_messages.append({"role": "assistant", "content": result.full_text})

        # ── Panel generation: generate AI insight cards ──
        if deal_state:
            logger.debug("Generating AI panel cards, session_id=%s", session_id)
            try:
                await db.refresh(deal_state)
                updated_state_dict = await deal_state_to_dict(deal_state, db)
                (
                    ai_cards,
                    panel_usage_summary,
                ) = await generate_ai_panel_cards_with_usage(
                    updated_state_dict,
                    result.full_text,
                    all_messages,
                    session_id=session_id,
                )
                merge_usage_summary(result.usage_summary, panel_usage_summary)
                if ai_cards:
                    deal_state.ai_panel_cards = ai_cards
                    panel_tool_call = {
                        "name": "update_insights_panel",
                        "args": {"cards": ai_cards},
                    }
                    result.tool_calls.append(panel_tool_call)
                    yield f"event: tool_result\ndata: {json.dumps({'tool': 'update_insights_panel', 'data': {'cards': ai_cards}})}\n\n"
                    logger.info(
                        "Generated %d AI panel cards, session_id=%s",
                        len(ai_cards),
                        session_id,
                    )
            except Exception:
                logger.exception(
                    "AI panel generation failed: session_id=%s", session_id
                )

        # Persist assistant message
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
            yield f"event: error\ndata: {json.dumps({'message': 'Failed to save response. Please try again.'})}\n\n"
            return

        yield f"event: done\ndata: {json.dumps({'text': result.full_text, 'usage': _message_usage_payload(result.usage_summary), 'sessionUsage': session_usage_payload(session.usage)})}\n\n"

        logger.info(
            "Chat response complete: session_id=%s, text_length=%d, tool_calls=%d",
            session_id,
            len(result.full_text),
            len(result.tool_calls),
        )

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.get("/{session_id}/messages", response_model=list[MessageResponse])
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
    return list(messages_result.scalars().all())
