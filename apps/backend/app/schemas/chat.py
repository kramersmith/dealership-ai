from datetime import datetime
from typing import Literal

from pydantic import BaseModel, field_validator

from app.models.enums import ContextPressureLevel, MessageCompletionStatus, MessageRole


class PersistUserMessageRequest(BaseModel):
    """Persist a user message before streaming (e.g. VIN intercept — server owns truth)."""

    content: str
    image_url: str | None = None


class ChatMessageRequest(BaseModel):
    content: str
    image_url: str | None = None
    """When set, the stream updates this row instead of inserting a new user message."""
    existing_user_message_id: str | None = None


class InsightsFollowupRequest(BaseModel):
    assistant_message_id: str


class BranchMessageRequest(BaseModel):
    """New user text for the branch anchor row; triggers optional tail delete, always commerce reset + stream."""

    content: str
    image_url: str | None = None


class StopTurnRequest(BaseModel):
    turn_id: str | None = None
    reason: str = "user_stop"

    @field_validator("reason")
    @classmethod
    def reason_max_length(cls, v: str) -> str:
        if len(v) > 200:
            return v[:200]
        return v


class StopTurnResponse(BaseModel):
    status: Literal["cancelled", "already_cancelled", "not_found", "turn_mismatch"]
    turn_id: str | None = None
    cancelled: bool


class PanelRefreshResponse(BaseModel):
    cards: list[dict]
    assistant_message_id: str


class MessageResponse(BaseModel):
    id: str
    session_id: str
    role: MessageRole
    content: str
    image_url: str | None
    tool_calls: list[dict] | None
    panel_cards: list[dict] | None = None
    usage: dict[str, int] | None
    completion_status: MessageCompletionStatus = MessageCompletionStatus.COMPLETE
    interrupted_at: datetime | None = None
    interrupted_reason: str | None = None
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
