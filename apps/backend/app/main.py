import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import all models so Base.metadata knows about them
import app.models as _models  # noqa: F401
from app.core.config import settings
from app.db.base import Base
from app.db.seed import seed_users
from app.db.session import SessionLocal, engine
from app.routes import api_router

logging.basicConfig(level=getattr(logging, settings.LOG_LEVEL))
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None]:
    """Create tables and seed dev data on startup.

    create_all is safe against existing tables (no-ops if they exist).
    Alembic migrations should be used for schema changes in production.
    If the schema has changed and you have an existing dev database,
    delete it and restart to pick up the new columns.
    """
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables ensured")

    db = SessionLocal()
    try:
        seed_users(db)
    finally:
        db.close()

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
    )

    # Routes
    application.include_router(api_router, prefix=settings.API_PREFIX)

    # Health check
    @application.get("/health")
    def health():
        return {"status": "ok"}

    return application


app = create_app()
