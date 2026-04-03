import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_password
from app.models.enums import UserRole
from app.models.user import User

logger = logging.getLogger(__name__)

# WARNING: These credentials are for local development only.
# Only seeded when ENV=development (the default).
SEED_USERS = [
    {
        "email": "buyer@test.com",
        "password": "password",
        "role": UserRole.BUYER,
        "display_name": "Test Buyer",
    },
    {
        "email": "dealer@test.com",
        "password": "password",
        "role": UserRole.DEALER,
        "display_name": "Test Dealer",
    },
]


async def seed_users(db: AsyncSession) -> None:
    if settings.ENV != "development":
        logger.debug("Skipping user seeding (ENV=%s)", settings.ENV)
        return

    try:
        for user_data in SEED_USERS:
            result = await db.execute(
                select(User).where(User.email == user_data["email"])
            )
            existing = result.scalar_one_or_none()
            if existing:
                logger.debug("Seed user already exists: %s", user_data["email"])
                continue
            user = User(
                email=user_data["email"],
                hashed_password=hash_password(user_data["password"]),
                role=user_data["role"],
                display_name=user_data["display_name"],
            )
            db.add(user)
            logger.info("Seeded user: %s (%s)", user_data["email"], user_data["role"])
        await db.commit()
        logger.info("User seeding completed successfully")
    except Exception:
        await db.rollback()
        logger.exception("Failed to seed users")
        raise
