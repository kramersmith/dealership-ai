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


class BuyerContext(StrEnum):
    RESEARCHING = "researching"
    REVIEWING_DEAL = "reviewing_deal"
    AT_DEALERSHIP = "at_dealership"


class HealthStatus(StrEnum):
    GOOD = "good"
    FAIR = "fair"
    CONCERNING = "concerning"
    BAD = "bad"


class RedFlagSeverity(StrEnum):
    WARNING = "warning"
    CRITICAL = "critical"


class GapPriority(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class VehicleRole(StrEnum):
    PRIMARY = "primary"
    TRADE_IN = "trade_in"


class Difficulty(StrEnum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class AiCardType(StrEnum):
    BRIEFING = "briefing"
    NUMBERS = "numbers"
    VEHICLE = "vehicle"
    WARNING = "warning"
    TIP = "tip"
    CHECKLIST = "checklist"
    SUCCESS = "success"
    COMPARISON = "comparison"


class AiCardPriority(StrEnum):
    CRITICAL = "critical"
    HIGH = "high"
    NORMAL = "normal"
    LOW = "low"
