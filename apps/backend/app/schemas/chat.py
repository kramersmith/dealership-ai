from datetime import datetime

from pydantic import BaseModel

from app.models.enums import MessageRole


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
    created_at: datetime

    class Config:
        from_attributes = True
