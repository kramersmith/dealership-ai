from datetime import datetime

from pydantic import BaseModel

from app.models.enums import SessionType


class SessionCreate(BaseModel):
    session_type: SessionType = SessionType.BUYER_CHAT
    title: str | None = None


class SessionUpdate(BaseModel):
    title: str | None = None
    linked_session_ids: list[str] | None = None


class SessionResponse(BaseModel):
    id: str
    title: str
    session_type: SessionType
    linked_session_ids: list[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
