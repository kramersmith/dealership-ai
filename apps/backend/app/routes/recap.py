"""Deal recap and share-safe preview (scoped under /api/deal)."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.routes.deals import _get_deal_state_or_404
from app.schemas.recap import (
    DealRecapPublicResponse,
    DealRecapResponse,
    DealRecapSharePreviewRequest,
    RecapGenerateRequest,
    TimelineBeatResponse,
    TimelineEventCreateRequest,
)
from app.services.recap.service import (
    add_user_timeline_event,
    build_recap_response,
    build_share_preview,
    export_public_recap_stub,
    generate_recap,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/{session_id}/recap", response_model=DealRecapResponse)
async def get_deal_recap(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, deal_state = await _get_deal_state_or_404(session_id, user, db)
    return await build_recap_response(db, session_id=session_id, deal_state=deal_state)


@router.post("/{session_id}/recap/generate", response_model=DealRecapResponse)
async def post_deal_recap_generate(
    session_id: str,
    body: RecapGenerateRequest | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, deal_state = await _get_deal_state_or_404(session_id, user, db)
    try:
        return await generate_recap(
            db,
            session_id=session_id,
            user=user,
            deal_state=deal_state,
            body=body,
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("deal recap generate failed session_id=%s", session_id)
        raise HTTPException(
            status_code=502,
            detail="Recap generation failed. Try again later.",
        ) from None


@router.post(
    "/{session_id}/recap/timeline-events",
    response_model=TimelineBeatResponse,
)
async def post_timeline_event(
    session_id: str,
    body: TimelineEventCreateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, deal_state = await _get_deal_state_or_404(session_id, user, db)
    return await add_user_timeline_event(
        db,
        session_id=session_id,
        _user=user,
        deal_state=deal_state,
        body=body,
    )


@router.post(
    "/{session_id}/recap/share-preview", response_model=DealRecapPublicResponse
)
async def post_recap_share_preview(
    session_id: str,
    body: DealRecapSharePreviewRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, deal_state = await _get_deal_state_or_404(session_id, user, db)
    return await build_share_preview(
        db, session_id=session_id, deal_state=deal_state, body=body
    )


@router.post("/{session_id}/recap/export")
async def post_recap_export(
    session_id: str,
    body: DealRecapSharePreviewRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _, deal_state = await _get_deal_state_or_404(session_id, user, db)
    public = await build_share_preview(
        db, session_id=session_id, deal_state=deal_state, body=body
    )
    return export_public_recap_stub(body, public)
