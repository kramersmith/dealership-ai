from datetime import datetime

from pydantic import BaseModel

from app.models.enums import ContextPressureLevel, MessageRole


class ChatMessageRequest(BaseModel):
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
