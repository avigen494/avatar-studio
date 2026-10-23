"""Public share page endpoints. No sign-in. Loads under a second on 4G."""
from __future__ import annotations

import hashlib

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import ApiError
from app.models.core import User
from app.models.videos import Reaction, Video
from app.schemas import ReactIn, ShareMeta, ShareView, UnlockIn
from app.services import crypto
from app.services.serializers import url_for

router = APIRouter(prefix="/share", tags=["share"])


async def _video(db: AsyncSession, token: str) -> Video:
    v = await db.scalar(select(Video).where(Video.share_token == token, Video.share_enabled.is_(True)))
    if not v or v.status != "succeeded":
        raise ApiError(404, "not_found", "This video is not available.")
    return v


async def _creator(db: AsyncSession, v: Video) -> str:
    if v.created_by:
        u = await db.get(User, v.created_by)
        if u and u.name:
            return u.name
    return "Avatar Studio creator"


@router.get("/{token}", response_model=ShareMeta)
async def meta(token: str, db: AsyncSession = Depends(get_db)) -> ShareMeta:
    v = await _video(db, token)
    return ShareMeta(title=v.title, creator=await _creator(db, v), needs_password=bool(v.share_password_hash),
                     ai_labelled=v.ai_labelled, watermarked=v.watermarked, summary=v.summary)


@router.post("/{token}/view", response_model=ShareView)
async def view(token: str, body: UnlockIn, db: AsyncSession = Depends(get_db)) -> ShareView:
    v = await _video(db, token)
    if v.share_password_hash and not (body.password and crypto.check_password(body.password, v.share_password_hash)):
        raise ApiError(401, "password_required", "This video needs a password.")
    v.views += 1
    rows = (await db.execute(
        select(Reaction.emoji, func.count(Reaction.id)).where(Reaction.video_id == v.id).group_by(Reaction.emoji)
    )).all()
    await db.commit()
    return ShareView(
        title=v.title, creator=await _creator(db, v), summary=v.summary, transcript=v.transcript,
        duration_s=v.duration_s, aspect=v.aspect, video_url=url_for(v.output_key),
        captioned_url=url_for(v.output_captioned_key), thumbnail_url=url_for(v.thumbnail_key), views=v.views,
        reactions={e: int(c) for e, c in rows}, ai_labelled=v.ai_labelled, watermarked=v.watermarked,
    )


@router.post("/{token}/react", response_model=dict[str, int])
async def react(token: str, body: ReactIn, request: Request, db: AsyncSession = Depends(get_db)) -> dict[str, int]:
    v = await _video(db, token)
    ip = request.client.host if request.client else "unknown"
    viewer = hashlib.sha256(f"{ip}:{request.headers.get('user-agent', '')}".encode()).hexdigest()[:32]
    existing = await db.scalar(
        select(Reaction).where(Reaction.video_id == v.id, Reaction.viewer_hash == viewer, Reaction.emoji == body.emoji)
    )
    if existing:
        await db.delete(existing)  # tap again to remove
    else:
        db.add(Reaction(workspace_id=v.workspace_id, video_id=v.id, emoji=body.emoji, viewer_hash=viewer))
    await db.flush()
    rows = (await db.execute(
        select(Reaction.emoji, func.count(Reaction.id)).where(Reaction.video_id == v.id).group_by(Reaction.emoji)
    )).all()
    await db.commit()
    return {e: int(c) for e, c in rows}
