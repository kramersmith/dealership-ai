from datetime import datetime

from pydantic import BaseModel


class SessionCreate(BaseModel):
    session_type: str = "buyer_chat"
    title: str | None = None


class SessionUpdate(BaseModel):
    title: str | None = None
    linked_session_ids: list[str] | None = None


class SessionResponse(BaseModel):
    id: str
    title: str
    session_type: str
    linked_session_ids: list[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
