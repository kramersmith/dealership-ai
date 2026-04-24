from fastapi import APIRouter

from app.routes.auth import router as auth_router
from app.routes.chat import router as chat_router
from app.routes.deals import router as deals_router
from app.routes.recap import router as recap_router
from app.routes.sessions import router as sessions_router
from app.routes.simulations import router as simulations_router

api_router = APIRouter()
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(sessions_router, prefix="/sessions", tags=["sessions"])
api_router.include_router(chat_router, prefix="/chat", tags=["chat"])
api_router.include_router(deals_router, prefix="/deal", tags=["deal"])
api_router.include_router(recap_router, prefix="/deal", tags=["deal"])
api_router.include_router(
    simulations_router, prefix="/simulations", tags=["simulations"]
)
