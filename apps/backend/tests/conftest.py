import pytest
import pytest_asyncio
from app.core.deps import get_db
from app.core.security import create_access_token, hash_password
from app.db.base import Base
from app.main import app
from app.models.deal import Deal
from app.models.deal_state import DealState
from app.models.enums import UserRole, VehicleRole
from app.models.session import ChatSession
from app.models.user import User
from app.models.vehicle import Vehicle
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

# ── Sync engine + session (DDL, pure model tests, route test setup) ──
TEST_DATABASE_URL = "sqlite:///./test.db"
sync_engine = create_engine(
    TEST_DATABASE_URL, connect_args={"check_same_thread": False}
)
SyncSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=sync_engine)

# ── Async engine + session (real async paths matching production) ──
TEST_ASYNC_URL = "sqlite+aiosqlite:///./test.db"
async_engine = create_async_engine(
    TEST_ASYNC_URL, connect_args={"check_same_thread": False}
)
TestingAsyncSessionLocal = async_sessionmaker(
    bind=async_engine, class_=AsyncSession, expire_on_commit=False
)


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=sync_engine)
    yield
    Base.metadata.drop_all(bind=sync_engine)


@pytest.fixture
def db():
    """Sync session for pure model tests and route test setup/assertions."""
    session = SyncSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest_asyncio.fixture
async def adb():
    """Real async session matching production AsyncSessionLocal."""
    async with TestingAsyncSessionLocal() as session:
        yield session


@pytest.fixture
def buyer_user(db):
    """Sync buyer user for route tests using the client fixture."""
    user = User(
        email="buyer@test.com",
        hashed_password=hash_password("password"),
        role=UserRole.BUYER,
        display_name="Test Buyer",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest_asyncio.fixture
async def async_buyer_user(adb):
    """Async buyer user for service tests using the adb fixture."""
    user = User(
        email="buyer@test.com",
        hashed_password=hash_password("password"),
        role=UserRole.BUYER,
        display_name="Test Buyer",
    )
    adb.add(user)
    await adb.commit()
    await adb.refresh(user)
    return user


@pytest.fixture
def client(db):
    """TestClient with get_db overridden to yield a real async session."""

    async def override_get_db():
        async with TestingAsyncSessionLocal() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    from fastapi.testclient import TestClient

    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ── Shared test helpers (sync) ──
# Used across test_deal_insights, test_vehicle_intelligence, test_sessions, etc.


def create_user_and_token(db) -> tuple[User, str]:
    user = User(
        email="test@example.com",
        hashed_password=hash_password("password"),
        role=UserRole.BUYER,
        display_name="Test User",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": user.id})
    return user, token


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def create_session_with_deal_state(db, user) -> tuple[ChatSession, DealState]:
    session = ChatSession(user_id=user.id, title="Test Deal")
    db.add(session)
    db.flush()
    deal_state = DealState(session_id=session.id)
    db.add(deal_state)
    db.commit()
    db.refresh(session)
    db.refresh(deal_state)
    return session, deal_state


def create_vehicle(
    db, session_id: str, role: str = VehicleRole.PRIMARY, **kwargs
) -> Vehicle:
    vehicle = Vehicle(session_id=session_id, role=role, **kwargs)
    db.add(vehicle)
    db.commit()
    db.refresh(vehicle)
    return vehicle


def create_deal(db, session_id: str, vehicle_id: str, **kwargs) -> Deal:
    deal = Deal(session_id=session_id, vehicle_id=vehicle_id, **kwargs)
    db.add(deal)
    db.commit()
    db.refresh(deal)
    return deal


# ── Shared test helpers (async) ──


async def async_create_user(adb) -> User:
    user = User(
        email="test@example.com",
        hashed_password=hash_password("password"),
        role=UserRole.BUYER,
        display_name="Test User",
    )
    adb.add(user)
    await adb.flush()
    await adb.refresh(user)
    return user


async def async_create_user_and_token(adb) -> tuple[User, str]:
    user = await async_create_user(adb)
    token = create_access_token({"sub": user.id})
    return user, token


async def async_create_session_with_deal_state(
    adb, user
) -> tuple[ChatSession, DealState]:
    session = ChatSession(user_id=user.id, title="Test Deal")
    adb.add(session)
    await adb.flush()
    deal_state = DealState(session_id=session.id)
    adb.add(deal_state)
    await adb.flush()
    return session, deal_state


async def async_create_vehicle(
    adb, session_id: str, role: str = VehicleRole.PRIMARY, **kwargs
) -> Vehicle:
    vehicle = Vehicle(session_id=session_id, role=role, **kwargs)
    adb.add(vehicle)
    await adb.flush()
    return vehicle


async def async_create_deal(adb, session_id: str, vehicle_id: str, **kwargs) -> Deal:
    deal = Deal(session_id=session_id, vehicle_id=vehicle_id, **kwargs)
    adb.add(deal)
    await adb.flush()
    return deal
