from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

TurnPhase = Literal["chat", "panel", "done"]
CancelOutcome = Literal[
    "cancelled",
    "already_cancelled",
    "not_found",
    "turn_mismatch",
]


class TurnAlreadyActiveError(RuntimeError):
    """Raised when a session already has an active turn."""


@dataclass(slots=True)
class TurnCancellationState:
    turn_id: str
    session_id: str
    user_id: str
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    phase: TurnPhase = "chat"
    cancelled: bool = False
    cancel_reason: str | None = None
    done_emitted: bool = False
    panel_started: bool = False

    def request_cancel(self, reason: str = "user_stop") -> bool:
        if self.cancelled:
            return False
        self.cancelled = True
        self.cancel_reason = reason
        return True

    def is_cancelled(self) -> bool:
        return self.cancelled


@dataclass(slots=True)
class CancelTurnResult:
    outcome: CancelOutcome
    turn_id: str | None = None
    cancelled: bool = False


class TurnCancellationRegistry:
    """In-memory active-turn cancellation registry keyed by session_id."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._active_by_session: dict[str, TurnCancellationState] = {}

    async def start_turn(
        self, *, session_id: str, user_id: str
    ) -> TurnCancellationState:
        async with self._lock:
            existing = self._active_by_session.get(session_id)
            if existing is not None:
                raise TurnAlreadyActiveError(
                    f"Session {session_id} already has active turn {existing.turn_id}"
                )
            state = TurnCancellationState(
                turn_id=str(uuid.uuid4()),
                session_id=session_id,
                user_id=user_id,
            )
            self._active_by_session[session_id] = state
            return state

    async def end_turn(self, state: TurnCancellationState) -> None:
        async with self._lock:
            current = self._active_by_session.get(state.session_id)
            if current and current.turn_id == state.turn_id:
                self._active_by_session.pop(state.session_id, None)

    async def cancel_turn(
        self,
        *,
        session_id: str,
        user_id: str,
        turn_id: str | None = None,
        reason: str = "user_stop",
    ) -> CancelTurnResult:
        async with self._lock:
            state = self._active_by_session.get(session_id)
            if state is None or state.user_id != user_id:
                return CancelTurnResult(
                    outcome="not_found", turn_id=None, cancelled=False
                )
            if turn_id and state.turn_id != turn_id:
                return CancelTurnResult(
                    outcome="turn_mismatch",
                    turn_id=state.turn_id,
                    cancelled=False,
                )
            if state.cancelled:
                return CancelTurnResult(
                    outcome="already_cancelled",
                    turn_id=state.turn_id,
                    cancelled=False,
                )
            state.request_cancel(reason)
            return CancelTurnResult(
                outcome="cancelled",
                turn_id=state.turn_id,
                cancelled=True,
            )


turn_cancellation_registry = TurnCancellationRegistry()
