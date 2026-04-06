from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from app.models.enums import AiCardKind, AiCardPriority, AiCardTemplate


class AiPanelCardResponse(BaseModel):
    kind: AiCardKind
    template: AiCardTemplate
    title: str
    content: dict[str, Any]
    priority: AiCardPriority
