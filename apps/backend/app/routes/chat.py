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
from app.services.claude import build_messages, build_system_prompt, stream_chat

logger = logging.getLogger(__name__)

router = APIRouter()


def _apply_tool_call(deal_state: DealState, tool_name: str, tool_data: dict) -> None:
    """Apply a tool call result to the deal state in-place."""
    if tool_name == "update_deal_numbers":
        for field in [
            "msrp",
            "invoice_price",
            "their_offer",
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


def _deal_state_to_dict(ds: DealState) -> dict:
    """Convert deal state to dict for system prompt context."""
    return {
        "phase": ds.phase,
        "numbers": {
            "msrp": ds.msrp,
            "invoice_price": ds.invoice_price,
            "their_offer": ds.their_offer,
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

    # Save user message
    user_msg = Message(
        session_id=session_id,
        role=MessageRole.USER,
        content=body.content,
        image_url=body.image_url,
    )
    db.add(user_msg)
    db.commit()

    # Load message history
    history = (
        db.query(Message)
        .filter(Message.session_id == session_id)
        .order_by(Message.created_at)
        .all()
    )
    history_dicts = [{"role": m.role, "content": m.content} for m in history]

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
                _apply_tool_call(deal_state, tc["name"], tc["args"])

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
