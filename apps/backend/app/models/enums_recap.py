"""Enums for deal recap / timeline (kept separate to avoid growing enums.py)."""

from enum import StrEnum


class TimelineEventSource(StrEnum):
    MODEL = "model"
    USER = "user"
    TOOL = "tool"
    SYSTEM = "system"
    MESSAGE_HOOK = "message_hook"


class DealRecapGenerationStatus(StrEnum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"
