import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.logging_setup import configure_logging
from app.core.request_context import RequestContextMiddleware

configure_logging(
    settings.LOG_LEVEL,
    third_party_level_name=settings.LOG_THIRD_PARTY_LEVEL,
    local_ndjson_path=settings.LOG_LOCAL_NDJSON_PATH.strip() or None,
)

# Import all models so Base.metadata knows about them
import app.models as _models  # noqa: E402,F401
from app.db.base import Base  # noqa: E402
from app.db.seed import seed_users  # noqa: E402
from app.db.session import AsyncSessionLocal, sync_engine  # noqa: E402
from app.routes import api_router  # noqa: E402

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
    """Create tables and seed dev data on startup.

    create_all is safe against existing tables (no-ops if they exist).
    Alembic migrations should be used for schema changes in production.
    If the schema has changed and you have an existing dev database,
    delete it and restart to pick up the new columns.
    """
    Base.metadata.create_all(bind=sync_engine)
    logger.info("Database tables ensured")

    if not (settings.ANTHROPIC_API_KEY or "").strip():
        logger.warning(
            "ANTHROPIC_API_KEY is empty — Claude requests will fail. "
            "For Docker, set the key in apps/backend/.env (see docker-compose env_file)."
        )
    elif settings.LOG_LEVEL == "DEBUG" and len(settings.ANTHROPIC_API_KEY) >= 8:
        logger.debug(
            "ANTHROPIC_API_KEY loaded (suffix …%s)",
            settings.ANTHROPIC_API_KEY[-4:],
        )

    async with AsyncSessionLocal() as db:
        await seed_users(db)

    yield


def create_app() -> FastAPI:
    application = FastAPI(
        title="Dealership AI",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=f"{settings.API_PREFIX}/docs",
        openapi_url=f"{settings.API_PREFIX}/openapi.json",
    )

    # CORS
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )

    application.add_middleware(RequestContextMiddleware)

    # Routes
    application.include_router(api_router, prefix=settings.API_PREFIX)

    # Health check
    @application.get("/health")
    def health():
        return {"status": "ok"}

    return application


app = create_app()
