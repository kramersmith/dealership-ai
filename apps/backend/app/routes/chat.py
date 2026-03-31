import asyncio
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
    analyze_deal,
    assess_situation,
    build_messages,
    build_system_prompt,
    extract_deal_facts,
    generate_ai_panel_cards,
    merge_extraction_results,
    stream_chat,
)
from app.services.deal_state import apply_extraction, deal_state_to_dict
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

    # Build Claude request
    system_prompt = build_system_prompt(deal_state_dict, linked_messages)
    messages = build_messages(history_dicts, body.content, body.image_url)

    async def generate():
        full_text = ""
        all_tool_calls = []

        # ── Stage 1: Stream text (no tools) ──
        logger.debug("Stage 1: Streaming text response, session_id=%s", session_id)
        try:
            async for sse_event in stream_chat(system_prompt, messages):
                yield sse_event

                # Parse the done event to capture the full text
                if sse_event.startswith("event: done"):
                    try:
                        data_line = sse_event.split("data: ", 1)[1].split("\n")[0]
                        done_data = json.loads(data_line)
                        full_text = done_data.get("text", "")
                    except (IndexError, json.JSONDecodeError):
                        logger.exception(
                            "Failed to parse done event: session_id=%s",
                            session_id,
                        )
        except Exception:
            logger.exception("Stage 1 streaming failed: session_id=%s", session_id)
            yield f"event: error\ndata: {json.dumps({'message': 'AI response failed. Please try again.'})}\n\n"
            return

        logger.debug(
            "Stage 1 complete: text_length=%d, session_id=%s",
            len(full_text),
            session_id,
        )

        # Build full message list for extraction and panel generation
        all_messages = [*history_dicts, {"role": "user", "content": body.content}]
        if full_text:
            all_messages.append({"role": "assistant", "content": full_text})

        # ── Stage 2: Extract data + analyze deal (parallel subagents) ──
        if deal_state_dict:
            logger.debug(
                "Stage 2: Running factual extractor + analyst + situation assessor in parallel, session_id=%s",
                session_id,
            )
            results = await asyncio.gather(
                extract_deal_facts(deal_state_dict, all_messages, full_text),
                analyze_deal(deal_state_dict, all_messages, full_text),
                assess_situation(deal_state_dict, all_messages, full_text),
                return_exceptions=True,
            )

            facts: dict = {}
            analysis: dict = {}
            situation: dict = {}

            if isinstance(results[0], Exception):
                logger.exception(
                    "Factual extraction failed: session_id=%s",
                    session_id,
                    exc_info=results[0],
                )
            elif isinstance(results[0], dict):
                facts = results[0]
                logger.debug(
                    "Factual extractor keys: %s, session_id=%s",
                    list(facts.keys()) if facts else "(empty)",
                    session_id,
                )

            if isinstance(results[1], Exception):
                logger.exception(
                    "Deal analysis failed: session_id=%s",
                    session_id,
                    exc_info=results[1],
                )
            elif isinstance(results[1], dict):
                analysis = results[1]
                logger.debug(
                    "Analyst keys: %s, session_id=%s",
                    list(analysis.keys()) if analysis else "(empty)",
                    session_id,
                )

            if isinstance(results[2], Exception):
                logger.exception(
                    "Situation assessment failed: session_id=%s",
                    session_id,
                    exc_info=results[2],
                )
            elif isinstance(results[2], dict):
                situation = results[2]
                if situation:
                    logger.debug(
                        "Situation assessor stance=%s, session_id=%s",
                        situation.get("stance"),
                        session_id,
                    )

            # Merge results and apply to DB
            extraction = merge_extraction_results(facts, analysis)
            if extraction:
                try:
                    applied_tools = apply_extraction(deal_state, extraction, db)
                    all_tool_calls.extend(applied_tools)
                    for tool_call in applied_tools:
                        yield f"event: tool_result\ndata: {json.dumps({'tool': tool_call['name'], 'data': tool_call['args']})}\n\n"
                    logger.info(
                        "Stage 2 complete: applied %d tool calls (facts=%d, analysis=%d), session_id=%s",
                        len(applied_tools),
                        len(facts),
                        len(analysis),
                        session_id,
                    )
                except Exception:
                    logger.exception(
                        "Stage 2 extraction apply failed: session_id=%s",
                        session_id,
                    )
            else:
                logger.debug(
                    "Stage 2: No extraction data returned, session_id=%s",
                    session_id,
                )

            # Apply situation context (separate from extraction pipeline)
            if situation:
                deal_state.negotiation_context = situation
                situation_tool_call = {
                    "name": "update_negotiation_context",
                    "args": situation,
                }
                all_tool_calls.append(situation_tool_call)
                yield f"event: tool_result\ndata: {json.dumps({'tool': 'update_negotiation_context', 'data': situation})}\n\n"
                logger.info(
                    "Situation context updated: stance=%s, session_id=%s",
                    situation.get("stance"),
                    session_id,
                )

        # ── Stage 3: Generate panel cards using updated deal state ──
        if deal_state:
            logger.debug(
                "Stage 3: Generating AI panel cards, session_id=%s", session_id
            )
            try:
                # Rebuild deal state dict after extraction so panel sees updated data
                updated_state_dict = deal_state_to_dict(deal_state, db)
                ai_cards = await generate_ai_panel_cards(
                    updated_state_dict, full_text, all_messages
                )
                if ai_cards:
                    deal_state.ai_panel_cards = ai_cards
                    panel_tool_call = {
                        "name": "update_insights_panel",
                        "args": {"cards": ai_cards},
                    }
                    all_tool_calls.append(panel_tool_call)
                    yield f"event: tool_result\ndata: {json.dumps({'tool': 'update_insights_panel', 'data': {'cards': ai_cards}})}\n\n"
                    logger.info(
                        "Stage 3 complete: generated %d AI panel cards, session_id=%s",
                        len(ai_cards),
                        session_id,
                    )
                else:
                    logger.debug(
                        "Stage 3: No AI panel cards generated, session_id=%s",
                        session_id,
                    )
            except Exception:
                logger.exception(
                    "Stage 3 AI panel generation failed: session_id=%s", session_id
                )
        else:
            logger.debug("Stage 3 skipped: no deal state, session_id=%s", session_id)

        # Persist assistant message
        assistant_msg = Message(
            session_id=session_id,
            role=MessageRole.ASSISTANT,
            content=full_text,
            tool_calls=all_tool_calls if all_tool_calls else None,
        )
        db.add(assistant_msg)

        # Update session metadata (preview + title)
        try:
            await update_session_metadata(
                session=session,
                deal_state=deal_state,
                messages=all_messages,
                tool_calls=all_tool_calls,
                response_text=full_text,
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
            len(full_text),
            len(all_tool_calls),
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
