from enum import StrEnum


class UserRole(StrEnum):
    BUYER = "buyer"
    DEALER = "dealer"


class SessionType(StrEnum):
    BUYER_CHAT = "buyer_chat"
    DEALER_SIM = "dealer_sim"


class MessageRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class DealPhase(StrEnum):
    RESEARCH = "research"
    INITIAL_CONTACT = "initial_contact"
    TEST_DRIVE = "test_drive"
    NEGOTIATION = "negotiation"
    FINANCING = "financing"
    CLOSING = "closing"


class ScoreStatus(StrEnum):
    RED = "red"
    YELLOW = "yellow"
    GREEN = "green"


class Difficulty(StrEnum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"
