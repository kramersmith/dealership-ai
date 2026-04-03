from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

# SQLite needs check_same_thread=False for multi-threaded access
connect_args = (
    {"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}
)

# Sync engine — used only for DDL (create_all) and Alembic migrations
sync_engine = create_engine(settings.DATABASE_URL, connect_args=connect_args)

# Async engine — all application database access
# Map sync DB URLs to async-capable driver variants
if settings.DATABASE_URL.startswith("sqlite"):
    _async_url = settings.DATABASE_URL.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
elif settings.DATABASE_URL.startswith("postgresql://"):
    _async_url = settings.DATABASE_URL.replace(
        "postgresql://", "postgresql+psycopg://", 1
    )
elif settings.DATABASE_URL.startswith("postgres://"):
    _async_url = settings.DATABASE_URL.replace(
        "postgres://", "postgresql+psycopg://", 1
    )
else:
    _async_url = settings.DATABASE_URL
async_engine = create_async_engine(_async_url, connect_args=connect_args)
AsyncSessionLocal = async_sessionmaker(
    bind=async_engine, class_=AsyncSession, expire_on_commit=False
)
