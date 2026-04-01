from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # Vehicle intelligence providers
    NHTSA_VPIC_BASE_URL: str = "https://vpic.nhtsa.dot.gov/api/vehicles"
    VINAUDIT_API_KEY: str = ""
    VINAUDIT_HISTORY_URL: str = (
        "https://marketvalue.vinaudit.com/getvehiclehistoryreport.php"
    )
    VINAUDIT_VALUATION_URL: str = "https://marketvalue.vinaudit.com/getmarketvalue.php"

    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()
