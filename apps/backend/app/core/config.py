from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Backend root = directory that contains the `app/` package (…/apps/backend).
# Avoid cwd-relative ".env" so Docker / uvicorn always load the same file as compose `env_file`.
_BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent
_ENV_FILE = _BACKEND_ROOT / ".env"


class Settings(BaseSettings):
    ENV: str = "development"
    LOG_LEVEL: str = "INFO"
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


settings = Settings()
