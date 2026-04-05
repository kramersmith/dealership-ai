from __future__ import annotations

from dataclasses import dataclass, replace
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.models.deal_state import DealState
    from app.models.session import ChatSession


@dataclass
class TurnContext:
    """Unified execution context for a chat turn and its inner steps.

    Carries the session, deal state, DB session, and current step number
    through the chat step loop and concurrent tool execution.
    """

    session: ChatSession | None
    deal_state: DealState | None
    db: AsyncSession
    step: int = 0

    @classmethod
    def create(
        cls,
        *,
        session: ChatSession | None,
        deal_state: DealState | None,
        db: AsyncSession,
    ) -> TurnContext:
        return cls(
            session=session,
            deal_state=deal_state,
            db=db,
            step=0,
        )

    def for_step(self, step: int) -> TurnContext:
        return replace(self, step=step)

    def for_db_session(
        self,
        db: AsyncSession,
        *,
        deal_state: DealState | None = None,
    ) -> TurnContext:
        next_deal_state = deal_state if deal_state is not None else self.deal_state
        return replace(
            self,
            db=db,
            deal_state=next_deal_state,
        )
