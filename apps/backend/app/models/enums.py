from enum import StrEnum


class UserRole(StrEnum):
    BUYER = "buyer"
    DEALER = "dealer"


class InsightsUpdateMode(StrEnum):
    LIVE = "live"
    PAUSED = "paused"

    @classmethod
    def _missing_(cls, value):
        legacy_map = {
            "auto": cls.LIVE,
            "manual": cls.PAUSED,
        }
        if isinstance(value, str):
            return legacy_map.get(value.lower())
        return None


class InsightsFollowupKind(StrEnum):
    LINKED_RECONCILE_PANEL = "linked_reconcile_panel"


class InsightsFollowupStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class InsightsFollowupStepStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    SKIPPED = "skipped"
    CANCELLED = "cancelled"


class SessionType(StrEnum):
    BUYER_CHAT = "buyer_chat"
    DEALER_SIM = "dealer_sim"


class MessageRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class MessageCompletionStatus(StrEnum):
    # The assistant turn reached normal terminal completion (`done` SSE).
    COMPLETE = "complete"
    # User intentionally stopped generation before normal completion (`interrupted` SSE).
    INTERRUPTED = "interrupted"
    # The turn ended unsuccessfully due to a non-user failure path (`error` semantics).
    FAILED = "failed"


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
    CANDIDATE = "candidate"
    TRADE_IN = "trade_in"


class Difficulty(StrEnum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class NegotiationStance(StrEnum):
    RESEARCHING = "researching"
    PREPARING = "preparing"
    ENGAGING = "engaging"
    NEGOTIATING = "negotiating"
    HOLDING = "holding"
    WALKING = "walking"
    WAITING = "waiting"
    FINANCING = "financing"
    CLOSING = "closing"
    POST_PURCHASE = "post_purchase"


class AiCardTemplate(StrEnum):
    BRIEFING = "briefing"
    NUMBERS = "numbers"
    VEHICLE = "vehicle"
    WARNING = "warning"
    TIP = "tip"
    NOTES = "notes"
    CHECKLIST = "checklist"
    SUCCESS = "success"
    COMPARISON = "comparison"


class AiCardKind(StrEnum):
    VEHICLE = "vehicle"
    NUMBERS = "numbers"
    PHASE = "phase"
    WARNING = "warning"
    NOTES = "notes"
    COMPARISON = "comparison"
    CHECKLIST = "checklist"
    SUCCESS = "success"
    WHAT_CHANGED = "what_changed"
    WHAT_STILL_NEEDS_CONFIRMING = "what_still_needs_confirming"
    DEALER_READ = "dealer_read"
    YOUR_LEVERAGE = "your_leverage"
    NEXT_BEST_MOVE = "next_best_move"
    IF_YOU_SAY_YES = "if_you_say_yes"
    TRADE_OFF = "trade_off"
    SAVINGS_SO_FAR = "savings_so_far"


class AiCardPriority(StrEnum):
    CRITICAL = "critical"
    HIGH = "high"
    NORMAL = "normal"
    LOW = "low"


class IdentityConfirmationStatus(StrEnum):
    UNCONFIRMED = "unconfirmed"
    CONFIRMED = "confirmed"
    REJECTED = "rejected"


class IntelligenceProvider(StrEnum):
    NHTSA_VPIC = "nhtsa_vpic"
    VINAUDIT = "vinaudit"


class IntelligenceStatus(StrEnum):
    SUCCESS = "success"
    PARTIAL = "partial"


class ContextPressureLevel(StrEnum):
    OK = "ok"
    WARN = "warn"
    CRITICAL = "critical"
