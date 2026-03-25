import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from app.core.deps import get_current_user, get_db
from app.models.deal_state import DealState
from app.models.enums import BuyerContext, MessageRole
from app.models.message import Message
from app.models.session import ChatSession
from app.models.user import User
from app.schemas.chat import ChatMessageRequest, MessageResponse
from app.services.claude import (
    build_messages,
    build_system_prompt,
    generate_quick_actions,
    stream_chat,
    stream_followup_text,
)
from app.services.post_chat_processing import update_session_metadata

logger = logging.getLogger(__name__)

router = APIRouter()


def _apply_tool_call(deal_state: DealState, tool_name: str, tool_data: dict) -> None:
    """Apply a tool call result to the deal state in-place."""
    if tool_name == "update_deal_numbers":
        for field in [
            "msrp",
            "invoice_price",
            "listing_price",
            "your_target",
            "walk_away_price",
            "current_offer",
            "monthly_payment",
            "apr",
            "loan_term_months",
            "down_payment",
            "trade_in_value",
        ]:
            if field in tool_data:
                setattr(deal_state, field, tool_data[field])

    elif tool_name == "update_deal_phase":
        if "phase" in tool_data:
            deal_state.phase = tool_data["phase"]

    elif tool_name == "update_scorecard":
        for field in [
            "score_price",
            "score_financing",
            "score_trade_in",
            "score_fees",
            "score_overall",
        ]:
            if field in tool_data:
                setattr(deal_state, field, tool_data[field])

    elif tool_name == "set_vehicle":
        field_map = {
            "year": "vehicle_year",
            "make": "vehicle_make",
            "model": "vehicle_model",
            "trim": "vehicle_trim",
            "vin": "vehicle_vin",
            "mileage": "vehicle_mileage",
            "color": "vehicle_color",
        }
        for src, dst in field_map.items():
            if src in tool_data:
                setattr(deal_state, dst, tool_data[src])

    elif tool_name == "update_checklist":
        if "items" in tool_data:
            deal_state.checklist = tool_data["items"]

    elif tool_name == "update_buyer_context":
        if "buyer_context" in tool_data:
            try:
                validated = BuyerContext(tool_data["buyer_context"])
            except ValueError:
                logger.warning(
                    "Invalid buyer_context from tool call: %s",
                    tool_data["buyer_context"],
                )
                return
            deal_state.buyer_context = validated

    elif tool_name == "update_quick_actions":
        # Quick actions are ephemeral UI state handled client-side only — no persistence needed.
        pass


def _deal_state_to_dict(ds: DealState) -> dict:
    """Convert deal state to dict for system prompt context."""
    return {
        "phase": ds.phase,
        "buyer_context": ds.buyer_context,
        "numbers": {
            "msrp": ds.msrp,
            "invoice_price": ds.invoice_price,
            "listing_price": ds.listing_price,
            "your_target": ds.your_target,
            "walk_away_price": ds.walk_away_price,
            "current_offer": ds.current_offer,
            "monthly_payment": ds.monthly_payment,
            "apr": ds.apr,
            "loan_term_months": ds.loan_term_months,
            "down_payment": ds.down_payment,
            "trade_in_value": ds.trade_in_value,
        },
        "vehicle": {
            "year": ds.vehicle_year,
            "make": ds.vehicle_make,
            "model": ds.vehicle_model,
            "trim": ds.vehicle_trim,
            "mileage": ds.vehicle_mileage,
        }
        if ds.vehicle_make
        else None,
        "scorecard": {
            "price": ds.score_price,
            "financing": ds.score_financing,
            "trade_in": ds.score_trade_in,
            "fees": ds.score_fees,
            "overall": ds.score_overall,
        },
        "checklist": ds.checklist or [],
    }


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
    deal_state_dict = _deal_state_to_dict(deal_state) if deal_state else None

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

        async for sse_event in stream_chat(system_prompt, messages):
            yield sse_event

            # Parse the event to capture text and tool calls for persistence
            if sse_event.startswith("event: done"):
                data_line = sse_event.split("data: ", 1)[1].split("\n")[0]
                done_data = json.loads(data_line)
                full_text = done_data.get("text", "")
                all_tool_calls = done_data.get("tool_calls", [])

        # Log what Claude returned
        logger.debug(
            "Claude response: text_length=%d, tool_calls=%s, session_id=%s",
            len(full_text),
            [tc["name"] for tc in all_tool_calls],
            session_id,
        )

        # Two-pass: if Claude responded with only tool calls and no text,
        # fire a lightweight follow-up to generate the text response
        if not full_text.strip() and all_tool_calls:
            logger.info(
                "Tool-only response detected, firing follow-up: session_id=%s",
                session_id,
            )
            try:
                async for sse_event in stream_followup_text(messages, all_tool_calls):
                    yield sse_event

                    if sse_event.startswith("event: followup_done"):
                        data_line = sse_event.split("data: ", 1)[1].split("\n")[0]
                        followup_data = json.loads(data_line)
                        full_text = followup_data.get("text", "")
            except Exception:
                logger.exception(
                    "Follow-up text generation failed: session_id=%s", session_id
                )

        # Generate quick actions if Claude didn't call update_quick_actions
        called_quick_actions = any(
            tc["name"] == "update_quick_actions" for tc in all_tool_calls
        )
        if not called_quick_actions:
            quick_actions = await generate_quick_actions(messages, full_text)
            if quick_actions:
                qa_tool_call = {
                    "name": "update_quick_actions",
                    "args": {"actions": quick_actions},
                }
                all_tool_calls.append(qa_tool_call)
                yield f"event: tool_result\ndata: {json.dumps({'tool': 'update_quick_actions', 'data': {'actions': quick_actions}})}\n\n"
                logger.debug(
                    "Generated quick actions: %s", [a["label"] for a in quick_actions]
                )

        # Persist assistant message
        assistant_msg = Message(
            session_id=session_id,
            role=MessageRole.ASSISTANT,
            content=full_text,
            tool_calls=all_tool_calls if all_tool_calls else None,
        )
        db.add(assistant_msg)

        # Apply tool calls to deal state
        if deal_state and all_tool_calls:
            for tc in all_tool_calls:
                logger.debug("Applying tool call: %s args=%s", tc["name"], tc["args"])
                _apply_tool_call(deal_state, tc["name"], tc["args"])

        # Update session metadata (preview + title)
        all_messages = [*history_dicts, {"role": "user", "content": body.content}]
        if full_text:
            all_messages.append({"role": "assistant", "content": full_text})
        await update_session_metadata(
            session=session,
            deal_state=deal_state,
            messages=all_messages,
            tool_calls=all_tool_calls,
            response_text=full_text,
            user_message=body.content,
        )

        # Update session timestamp
        session.updated_at = datetime.now(timezone.utc)

        db.commit()

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
