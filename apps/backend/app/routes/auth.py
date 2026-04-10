import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db
from app.core.security import create_access_token, hash_password, verify_password
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    SignupRequest,
    TokenResponse,
    UpdateUserSettingsRequest,
    UserSettingsResponse,
)
from app.services.user_settings import (
    get_or_create_user_settings,
    to_user_settings_response,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post(
    "/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED
)
async def signup(body: SignupRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    existing = result.scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        role=body.role,
        display_name=body.display_name,
    )
    db.add(user)
    await db.flush()
    settings_row = await get_or_create_user_settings(db, user)
    await db.commit()
    await db.refresh(user)
    await db.refresh(settings_row)

    token = create_access_token(data={"sub": user.id})
    logger.info("User signed up: user_id=%s, role=%s", user.id, user.role)
    return TokenResponse(
        access_token=token,
        user_id=user.id,
        role=UserRole(user.role),
        settings=to_user_settings_response(settings_row),
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.hashed_password):
        logger.warning("Failed login attempt for email: %s", body.email)
        raise HTTPException(status_code=401, detail="Invalid credentials")

    settings_row = await get_or_create_user_settings(db, user)
    await db.commit()
    await db.refresh(settings_row)

    token = create_access_token(data={"sub": user.id})
    logger.info("User logged in: user_id=%s", user.id)
    return TokenResponse(
        access_token=token,
        user_id=user.id,
        role=UserRole(user.role),
        settings=to_user_settings_response(settings_row),
    )


@router.get("/settings", response_model=UserSettingsResponse)
async def get_settings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    settings_row = await get_or_create_user_settings(db, user)
    await db.commit()
    await db.refresh(settings_row)
    return to_user_settings_response(settings_row)


@router.patch("/settings", response_model=UserSettingsResponse)
async def update_settings(
    body: UpdateUserSettingsRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    settings_row = await get_or_create_user_settings(db, user)

    if body.insights_update_mode is not None:
        settings_row.insights_update_mode = body.insights_update_mode.value

    await db.commit()
    await db.refresh(settings_row)
    logger.info(
        "User settings updated: user_id=%s, insights_update_mode=%s",
        user.id,
        settings_row.insights_update_mode,
    )
    return to_user_settings_response(settings_row)
