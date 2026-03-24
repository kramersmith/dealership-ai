import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.db.base import Base
from app.db.session import engine
from app.routes import api_router

# Import all models so Base.metadata knows about them
import app.models  # noqa: F401

logging.basicConfig(level=getattr(logging, settings.LOG_LEVEL))
logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    application = FastAPI(
        title="Dealership AI",
        version="0.1.0",
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

# Create tables for SQLite dev (Alembic handles this in production)
if settings.DATABASE_URL.startswith("sqlite"):
    Base.metadata.create_all(bind=engine)
    logger.info("SQLite tables created")
