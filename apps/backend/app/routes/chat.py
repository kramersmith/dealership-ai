import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

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
    stream_chat_loop,
)
from app.services.deal_state import deal_state_to_dict
from app.services.panel import generate_ai_panel_cards
from app.services.post_chat_processing import update_session_metadata

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/{session_id}/message")
async def send_message(
    session_id: str,
    body: ChatMessageRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Verify session belongs to user
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    logger.info("Chat message received: session_id=%s, user_id=%s", session_id, user.id)

    # Load message history BEFORE saving the new user message
    # (build_messages will append the current message separately)
    history = (
        db.query(Message)
        .filter(Message.session_id == session_id)
        .order_by(Message.created_at)
        .all()
    )
    history_dicts = [{"role": m.role, "content": m.content} for m in history]

    # Save user message
    user_msg = Message(
        session_id=session_id,
        role=MessageRole.USER,
        content=body.content,
        image_url=body.image_url,
    )
    db.add(user_msg)
    db.commit()

    # Load deal state
    deal_state = db.query(DealState).filter(DealState.session_id == session_id).first()
    deal_state_dict = deal_state_to_dict(deal_state, db) if deal_state else None

    # Load linked session context (if any)
    linked_messages = None
    if session.linked_session_ids:
        linked_msgs = (
            db.query(Message)
            .filter(Message.session_id.in_(session.linked_session_ids))
            .order_by(Message.created_at)
            .all()
        )
        linked_messages = [{"role": m.role, "content": m.content} for m in linked_msgs]

    # Build Claude request — system prompt is static, dynamic context goes in messages
    system_prompt = build_system_prompt()
    context_message = build_context_message(deal_state_dict, linked_messages)
    messages = build_messages(
        history_dicts, body.content, body.image_url, context_message
    )

    async def generate():
        result = ChatLoopResult()

        # ── Step loop: stream text + execute tools until done ──
        async for sse_event in stream_chat_loop(
            system_prompt, messages, CHAT_TOOLS, deal_state, db, result
        ):
            yield sse_event

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
                updated_state_dict = deal_state_to_dict(deal_state, db)
                ai_cards = await generate_ai_panel_cards(
                    updated_state_dict, result.full_text, all_messages
                )
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
        )
        db.add(assistant_msg)

        # Update session metadata (preview + title)
        try:
            await update_session_metadata(
                session=session,
                deal_state=deal_state,
                messages=all_messages,
                tool_calls=result.tool_calls,
                response_text=result.full_text,
                user_message=body.content,
                db=db,
            )
        except Exception:
            logger.exception(
                "Session metadata update failed: session_id=%s", session_id
            )

        # Update session timestamp
        session.updated_at = datetime.now(timezone.utc)

        try:
            db.commit()
        except Exception:
            logger.exception("Final db.commit failed: session_id=%s", session_id)
            db.rollback()
            yield f"event: error\ndata: {json.dumps({'message': 'Failed to save response. Please try again.'})}\n\n"
            return

        logger.info(
            "Chat response complete: session_id=%s, text_length=%d, tool_calls=%d",
            session_id,
            len(result.full_text),
            len(result.tool_calls),
        )

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.get("/{session_id}/messages", response_model=list[MessageResponse])
def get_messages(
    session_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    messages = (
        db.query(Message)
        .filter(Message.session_id == session_id)
        .order_by(Message.created_at)
        .all()
    )
    return messages
