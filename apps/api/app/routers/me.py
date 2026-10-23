from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select

from app.deps import Ctx, get_ctx
from app.models.avatars import Identity
from app.models.core import Membership, Workspace
from app.models.videos import Video
from app.models.voices import Voice
from app.schemas import MeOut, UserOut, WorkspaceOut
from app.services import credits
from app.routers.workspaces import workspace_out

router = APIRouter(tags=["me"])


@router.get("/me", response_model=MeOut)
async def me(ctx: Ctx = Depends(get_ctx)) -> MeOut:
    db, ws = ctx.db, ctx.workspace
    rows = (await db.execute(
        select(Workspace, Membership.role).join(Membership, Membership.workspace_id == Workspace.id)
        .where(Membership.user_id == ctx.user.id).order_by(Workspace.created_at)
    )).all()
    workspaces = [WorkspaceOut.model_validate(w, from_attributes=True).model_copy(update={"role": r}) for w, r in rows]
    balance = await db.run_sync(credits.balance, ws.id)

    # The home screen and onboarding use these to decide which step to show.
    identity_count = await db.scalar(select(func.count(Identity.id)).where(Identity.workspace_id == ws.id)) or 0
    ready_identity = await db.scalar(
        select(func.count(Identity.id)).where(Identity.workspace_id == ws.id, Identity.status == "ready")
    ) or 0
    voice_count = await db.scalar(select(func.count(Voice.id)).where(Voice.workspace_id == ws.id)) or 0
    video_count = await db.scalar(select(func.count(Video.id)).where(Video.workspace_id == ws.id)) or 0
    done_videos = await db.scalar(
        select(func.count(Video.id)).where(Video.workspace_id == ws.id, Video.status == "succeeded")
    ) or 0

    return MeOut(
        user=UserOut.model_validate(ctx.user, from_attributes=True),
        workspace=workspace_out(ws, ctx.role),
        workspaces=workspaces,
        credits=balance,
        onboarding={
            "has_avatar": identity_count > 0,
            "avatar_ready": ready_identity > 0,
            "has_voice": voice_count > 0,
            "has_video": video_count > 0,
            "has_finished_video": done_videos > 0,
            "complete": ready_identity > 0 and voice_count > 0 and done_videos > 0,
        },
    )
