from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.log_redact import DEFAULT_PREVIEW_MAX_CHARS

ChatHarnessVerbosity = Literal["normal", "verbose"]
_HARNESS_VERBOSITY_NORMAL: ChatHarnessVerbosity = "normal"
_HARNESS_VERBOSITY_VERBOSE: ChatHarnessVerbosity = "verbose"

# Backend root = directory that contains the `app/` package (…/apps/backend).
# Avoid cwd-relative ".env" so Docker / uvicorn always load the same file as compose `env_file`.
_BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent
_ENV_FILE = _BACKEND_ROOT / ".env"


class Settings(BaseSettings):
    ENV: str = "development"
    LOG_LEVEL: str = "INFO"
    # Cap anthropic/httpcore/httpx noise; set DEBUG only when debugging transport/SDK.
    LOG_THIRD_PARTY_LEVEL: str = "WARNING"
    # Chat harness (see docs/logging-harness.md, docs/adr/0021-chat-harness-logging.md).
    # When unset, full payloads run for non-production ENV; production uses lite unless true.
    LOG_CHAT_HARNESS_FULL: bool | None = None
    LOG_CHAT_HARNESS_VERBOSITY: ChatHarnessVerbosity = _HARNESS_VERBOSITY_NORMAL
    LOG_CHAT_HARNESS_PREVIEW_MAX_CHARS: int = DEFAULT_PREVIEW_MAX_CHARS
    # Duplicate NDJSON log records to this path (plain JSON lines; no Docker prefix).
    # Relative paths resolve against the process cwd (typically apps/backend).
    LOG_LOCAL_NDJSON_PATH: str = ""
    API_PREFIX: str = "/api"
    DATABASE_URL: str = "sqlite:///./dealership.db"
    SECRET_KEY: str = "dev-secret"  # SECURITY: must override via env var in production
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 8  # 8h default
    CORS_ORIGINS: list[str] = ["http://localhost:8081", "http://localhost:19006"]

    # Claude API
    ANTHROPIC_API_KEY: str = ""
    CLAUDE_MODEL: str = "claude-sonnet-4-6"
    CLAUDE_FAST_MODEL: str = "claude-haiku-4-5-20251001"
    CLAUDE_MAX_TOKENS: int = 4096
    CLAUDE_MAX_HISTORY: int = 20  # messages to include in context

    # Custom context compaction (see docs/adr/0017-context-compaction-custom.md)
    CLAUDE_COMPACTION_ENABLED: bool = True
    # Opus/Sonnet 4.6 support up to ~1M tokens on the API; this is our *policy* budget for
    # compaction triggers and UI pressure — not the model maximum (tune via env if needed).
    CLAUDE_CONTEXT_INPUT_BUDGET: int = 180_000
    CLAUDE_COMPACTION_WARN_BUFFER_TOKENS: int = 20_000
    CLAUDE_COMPACTION_AUTO_BUFFER_TOKENS: int = 13_000
    CLAUDE_COMPACTION_VERBATIM_MESSAGES: int = 8
    CLAUDE_COMPACTION_SUMMARY_MAX_TOKENS: int = 2048
    CLAUDE_COMPACTION_MAX_CONSECUTIVE_FAILURES: int = 3
    CLAUDE_COMPACTION_PTL_MAX_RETRIES: int = 3
    CLAUDE_COMPACTION_STATIC_OVERHEAD_TOKENS: int = (
        12_000  # system + tools + context estimate
    )
    CLAUDE_MAX_TOKENS_RETRIES: int = 1  # retries after stop_reason=max_tokens
    CLAUDE_MAX_TOKENS_ESCALATION_FACTOR: int = 2  # per-retry budget multiplier
    CLAUDE_MAX_TOKENS_CAP: int = 8192  # hard cap for escalated budgets

    # Streaming resilience
    CLAUDE_STREAM_IDLE_TIMEOUT: int = 30  # seconds before stream considered stalled
    CLAUDE_STREAM_MAX_RETRIES: int = 2  # stream-level retries (not SDK retries)
    CLAUDE_API_TIMEOUT: int = 120  # overall API request timeout (seconds)
    CLAUDE_SDK_MAX_RETRIES: int = 3  # SDK-level retries for 429/529

    # Vehicle intelligence providers
    NHTSA_VPIC_BASE_URL: str = "https://vpic.nhtsa.dot.gov/api/vehicles"
    VINAUDIT_API_KEY: str = ""
    VINAUDIT_HISTORY_URL: str = (
        "https://marketvalue.vinaudit.com/getvehiclehistoryreport.php"
    )
    VINAUDIT_VALUATION_URL: str = "https://marketvalue.vinaudit.com/getmarketvalue.php"

    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
    )

    @field_validator("LOG_CHAT_HARNESS_VERBOSITY", mode="before")
    @classmethod
    def _normalize_harness_verbosity(cls, value: object) -> object:
        # Treat unset/empty env var as the default; any other value is validated
        # against the Literal below and raises on typos so misconfig is visible.
        if value is None or value == "":
            return _HARNESS_VERBOSITY_NORMAL
        if isinstance(value, str):
            normalized = value.lower().strip()
            return normalized or _HARNESS_VERBOSITY_NORMAL
        return value

    @field_validator("LOG_CHAT_HARNESS_PREVIEW_MAX_CHARS", mode="before")
    @classmethod
    def _normalize_preview_max_chars(cls, value: object) -> int:
        if value in (None, ""):
            return DEFAULT_PREVIEW_MAX_CHARS
        if not isinstance(value, (str, int, float)):
            return DEFAULT_PREVIEW_MAX_CHARS
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return DEFAULT_PREVIEW_MAX_CHARS
        if parsed < 1:
            return DEFAULT_PREVIEW_MAX_CHARS
        return parsed

    def chat_harness_includes_full_payload(self) -> bool:
        if self.LOG_CHAT_HARNESS_FULL is not None:
            return self.LOG_CHAT_HARNESS_FULL
        return (self.ENV or "").lower() != "production"

    def chat_harness_is_verbose(self) -> bool:
        return self.LOG_CHAT_HARNESS_VERBOSITY == _HARNESS_VERBOSITY_VERBOSE


settings = Settings()
