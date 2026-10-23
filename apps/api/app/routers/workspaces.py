from __future__ import annotations

import re

from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.deps import ApiError, Ctx, IsAdmin, get_ctx
from app.models.core import Membership, User
from app.schemas import MemberOut, UserOut, WorkspaceOut, WorkspacePatch
from app.services.serializers import url_for

router = APIRouter(prefix="/workspaces", tags=["workspaces"])

BRAND_KIT_KEYS = {"logo_key", "primary_color", "caption_style", "logo_position", "show_logo"}


def workspace_out(ws, role: str) -> WorkspaceOut:
    out = WorkspaceOut.model_validate(ws, from_attributes=True).model_copy(update={"role": role})
    out.brand_logo_url = url_for((ws.brand_kit or {}).get("logo_key"))
    return out


@router.get("/current", response_model=WorkspaceOut)
async def current(ctx: Ctx = Depends(get_ctx)) -> WorkspaceOut:
    return workspace_out(ctx.workspace, ctx.role)


@router.patch("/current", response_model=WorkspaceOut)
async def patch_current(body: WorkspacePatch, ctx: Ctx = IsAdmin) -> WorkspaceOut:
    ws = ctx.workspace
    if body.name is not None:
        ws.name = body.name.strip() or ws.name
    if body.ai_label_enabled is not None:
        # Free plans keep the label on (hard rule 7).
        ws.ai_label_enabled = True if ws.plan == "free" else body.ai_label_enabled
    if body.brand_kit is not None:
        kit = {k: v for k, v in body.brand_kit.items() if k in BRAND_KIT_KEYS}
        color = str(kit.get("primary_color") or "")
        if color and not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            raise ApiError(400, "bad_color", "Primary colour must look like #14b8a6.")
        logo = kit.get("logo_key")
        if logo and not str(logo).startswith(f"ws/{ws.id}/"):
            raise ApiError(400, "bad_logo", "Upload the logo first.")
        ws.brand_kit = {**(ws.brand_kit or {}), **kit}
    if body.glossary is not None:
        clean = []
        for g in body.glossary[:200]:
            term, pron = str(g.get("term", "")).strip()[:80], str(g.get("pronunciation", "")).strip()[:120]
            if term and pron:
                clean.append({"term": term, "pronunciation": pron})
        ws.glossary = clean
    await ctx.db.commit()
    return workspace_out(ws, ctx.role)


@router.get("/current/members", response_model=list[MemberOut])
async def members(ctx: Ctx = Depends(get_ctx)) -> list[MemberOut]:
    rows = (await ctx.db.execute(
        select(User, Membership.role).join(Membership, Membership.user_id == User.id)
        .where(Membership.workspace_id == ctx.workspace.id).order_by(Membership.created_at)
    )).all()
    return [MemberOut(user=UserOut.model_validate(u, from_attributes=True), role=r) for u, r in rows]
