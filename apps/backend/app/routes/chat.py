import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import StreamingResponse

from app.core.deps import get_current_user, get_db
from app.models.deal_state import DealState
from app.models.enums import MessageRole
from app.models.message import Message
from app.models.session import ChatSession
from app.models.user import User
from app.schemas.chat import (
    BranchMessageRequest,
    ChatMessageRequest,
    ContextPressureResponse,
    MessageResponse,
    MessagesListResponse,
    PersistUserMessageRequest,
)
from app.services.buyer_chat_stream import stream_buyer_chat_turn
from app.services.claude import build_context_message, build_system_prompt
from app.services.compaction import compute_session_context_pressure
from app.services.deal_state import deal_state_to_dict
from app.services.session_branch import (
    BranchAnchorNotFoundError,
    BranchAnchorNotUserError,
    prepare_session_branch_from_user_message,
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
        linked_rows = list(linked_result.scalars().all())
        linked_messages = [
            {"role": message.role, "content": message.content}
            for message in linked_rows
        ]

    return deal_state, deal_state_dict, linked_messages


async def _load_session_or_404(
    session_id: str, user: User, db: AsyncSession
) -> ChatSession:
    """Load the caller's chat session or raise 404."""
    session_result = await db.execute(
        select(ChatSession).where(
            ChatSession.id == session_id,
            ChatSession.user_id == user.id,
        )
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


async def _load_session_history(session_id: str, db: AsyncSession) -> list[Message]:
    """Return all messages for a session ordered by creation."""
    history_result = await db.execute(
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.created_at, Message.id)
    )
    return list(history_result.scalars().all())


async def _stream_buyer_turn_response(
    *,
    db: AsyncSession,
    session: ChatSession,
    session_id: str,
    body_content: str,
    body_image_url: str | None,
    resumed_user_row: Message | None,
    include_timeline_fork_reminder: bool,
) -> StreamingResponse:
    """Build shared chat-turn context and return an SSE StreamingResponse."""
    history = await _load_session_history(session_id, db)
    deal_state, deal_state_dict, linked_messages = await _load_deal_and_linked_context(
        session, db
    )
    system_prompt = build_system_prompt()

    async def generate():
        async for chunk in stream_buyer_chat_turn(
            db=db,
            session=session,
            session_id=session_id,
            content=body_content,
            image_url=body_image_url,
            resumed_user_row=resumed_user_row,
            history=history,
            deal_state=deal_state,
            deal_state_dict=deal_state_dict,
            linked_messages=linked_messages,
            system_prompt=system_prompt,
            include_timeline_fork_reminder=include_timeline_fork_reminder,
        ):
            yield chunk

    return StreamingResponse(generate(), media_type="text/event-stream")


def _message_response_from_model(message: Message) -> MessageResponse:
    return MessageResponse(
        id=message.id,
        session_id=message.session_id,
        role=MessageRole(message.role),
        content=message.content,
        image_url=message.image_url,
        tool_calls=message.tool_calls,
        usage=message.usage,
        created_at=message.created_at,
    )


@router.post("/{session_id}/message")
async def send_message(
    session_id: str,
    body: ChatMessageRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await _load_session_or_404(session_id, user, db)
    logger.info("Chat message received: session_id=%s, user_id=%s", session_id, user.id)

    resumed_user_row: Message | None = None
    if body.existing_user_message_id:
        history = await _load_session_history(session_id, db)
        row_result = await db.execute(
            select(Message).where(
                Message.id == body.existing_user_message_id,
                Message.session_id == session_id,
                Message.role == MessageRole.USER,
            )
        )
        resumed_user_row = row_result.scalar_one_or_none()
        if not resumed_user_row:
            raise HTTPException(
                status_code=404,
                detail="User message not found for this session",
            )
        latest_message = history[-1] if history else None
        if latest_message is None or latest_message.id != body.existing_user_message_id:
            raise HTTPException(
                status_code=409,
                detail=(
                    "existing_user_message_id can only resume the latest user message; "
                    "use the branch endpoint to edit earlier history"
                ),
            )

    return await _stream_buyer_turn_response(
        db=db,
        session=session,
        session_id=session_id,
        body_content=body.content,
        body_image_url=body.image_url,
        resumed_user_row=resumed_user_row,
        include_timeline_fork_reminder=False,
    )


@router.post("/{session_id}/messages/{message_id}/branch")
async def branch_from_user_message(
    session_id: str,
    message_id: str,
    body: BranchMessageRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Truncate timeline after this user message, reset commerce state, stream new reply."""
    session = await _load_session_or_404(session_id, user, db)

    try:
        messages_removed = await prepare_session_branch_from_user_message(
            db, session, message_id
        )
    except BranchAnchorNotFoundError as error:
        raise HTTPException(
            status_code=404, detail="Message not found for this session"
        ) from error
    except BranchAnchorNotUserError as error:
        raise HTTPException(
            status_code=422,
            detail="Branch anchor must be a user message",
        ) from error

    await db.refresh(session)

    resumed_result = await db.execute(
        select(Message).where(
            Message.id == message_id,
            Message.session_id == session_id,
            Message.role == MessageRole.USER,
        )
    )
    resumed_user_row = resumed_result.scalar_one_or_none()
    if not resumed_user_row:
        raise HTTPException(status_code=404, detail="User message not found")

    logger.info(
        "Chat branch stream: session_id=%s user_id=%s anchor_message_id=%s messages_removed=%s",
        session_id,
        user.id,
        message_id,
        messages_removed,
    )

    return await _stream_buyer_turn_response(
        db=db,
        session=session,
        session_id=session_id,
        body_content=body.content,
        body_image_url=body.image_url,
        resumed_user_row=resumed_user_row,
        include_timeline_fork_reminder=True,
    )


@router.post("/{session_id}/user-message", response_model=MessageResponse)
async def persist_user_message(
    session_id: str,
    body: PersistUserMessageRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Persist a user message without running the assistant (VIN intercept, etc.)."""
    await _load_session_or_404(session_id, user, db)

    user_message = Message(
        session_id=session_id,
        role=MessageRole.USER,
        content=body.content,
        image_url=body.image_url,
    )
    db.add(user_message)
    await db.commit()
    await db.refresh(user_message)
    logger.info(
        "User message persisted (pre-stream): session_id=%s message_id=%s",
        session_id,
        user_message.id,
    )
    return _message_response_from_model(user_message)


@router.get("/{session_id}/messages", response_model=MessagesListResponse)
async def get_messages(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    session = await _load_session_or_404(session_id, user, db)

    messages_result = await db.execute(
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.created_at)
    )
    message_rows = list(messages_result.scalars().all())

    _, deal_state_dict, linked_messages = await _load_deal_and_linked_context(
        session, db
    )

    context_message = build_context_message(deal_state_dict, linked_messages)
    pressure = compute_session_context_pressure(
        message_rows, session.compaction_state, context_message, linked_messages
    )
    return MessagesListResponse(
        messages=[_message_response_from_model(message) for message in message_rows],
        context_pressure=ContextPressureResponse(**pressure),
    )
