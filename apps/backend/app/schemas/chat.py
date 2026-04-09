from datetime import datetime

from pydantic import BaseModel

from app.models.enums import ContextPressureLevel, MessageRole


class PersistUserMessageRequest(BaseModel):
    """Persist a user message before streaming (e.g. VIN intercept — server owns truth)."""

    content: str
    image_url: str | None = None


class ChatMessageRequest(BaseModel):
    content: str
    image_url: str | None = None
    """When set, the stream updates this row instead of inserting a new user message."""
    existing_user_message_id: str | None = None


class BranchMessageRequest(BaseModel):
    """New user text for the branch anchor row; triggers optional tail delete, always commerce reset + stream."""

    content: str
    image_url: str | None = None


class MessageResponse(BaseModel):
    id: str
    session_id: str
    role: MessageRole
    content: str
    image_url: str | None
    tool_calls: list[dict] | None
    usage: dict[str, int] | None
    created_at: datetime

    class Config:
        from_attributes = True


class ContextPressureResponse(BaseModel):
    level: ContextPressureLevel
    estimated_input_tokens: int
    input_budget: int


class MessagesListResponse(BaseModel):
    messages: list[MessageResponse]
    context_pressure: ContextPressureResponse
