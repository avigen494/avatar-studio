"""
Team workspaces: create and switch workspaces, invite members, change roles,
per-avatar access. Seats come from the plan (Team includes 15; extra seats are
billed on the subscription).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.db import get_db
from app.deps import ApiError, Ctx, IsAdmin, create_workspace_for, get_ctx
from app.models.avatars import Identity
from app.models.core import Membership, User, Workspace
from app.models.team import Invite
from app.schemas import IdentityOut, UserOut, WorkspaceOut
from app.services import billing, crypto
from app.services.serializers import identity_out

router = APIRouter(tags=["team"])

ROLES = ("owner", "admin", "editor", "viewer")


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class InviteIn(BaseModel):
    email: EmailStr
    role: str = Field(default="editor", pattern="^(admin|editor|viewer)$")


class InviteOut(BaseModel):
    id: str
    email: str
    role: str
    link: str
    expires_at: datetime
    expired: bool = False
    accepted_at: datetime | None
    invited_by: str | None


class InviteMeta(BaseModel):
    workspace: str
    role: str
    invited_by: str | None
    email: str
    expired: bool
    accepted: bool


class RolePatch(BaseModel):
    role: str = Field(pattern="^(owner|admin|editor|viewer)$")


class AccessIn(BaseModel):
    user_ids: list[str] = Field(default_factory=list, max_length=200)


class SeatsOut(BaseModel):
    members: int
    pending_invites: int
    limit: int
    plan: str


def _invite_link(token: str) -> str:
    return f"{settings.web_base_url}/invite/{token}"


async def _seats(db: AsyncSession, ws: Workspace) -> SeatsOut:
    members = await db.scalar(select(func.count(Membership.id)).where(Membership.workspace_id == ws.id)) or 0
    pending = await db.scalar(select(func.count(Invite.id)).where(Invite.workspace_id == ws.id, Invite.accepted_at.is_(None),
                                                                  Invite.expires_at > datetime.now(timezone.utc))) or 0
    sub = await db.run_sync(billing.current_subscription, ws.id)
    return SeatsOut(members=members, pending_invites=pending, limit=billing.seat_limit(ws, sub), plan=ws.plan)


# --- workspaces ----------------------------------------------------------------------
@router.post("/workspaces", response_model=WorkspaceOut, status_code=201)
async def create_workspace(body: WorkspaceCreate, ctx: Ctx = Depends(get_ctx)) -> WorkspaceOut:
    ws = await create_workspace_for(ctx.db, ctx.user, body.name.strip())
    await ctx.db.commit()
    return WorkspaceOut.model_validate(ws, from_attributes=True).model_copy(update={"role": "owner"})


@router.get("/workspaces/current/seats", response_model=SeatsOut)
async def seats(ctx: Ctx = Depends(get_ctx)) -> SeatsOut:
    return await _seats(ctx.db, ctx.workspace)


# --- invites -------------------------------------------------------------------------
@router.get("/workspaces/current/invites", response_model=list[InviteOut])
async def list_invites(ctx: Ctx = IsAdmin) -> list[InviteOut]:
    rows = (await ctx.db.scalars(select(Invite).where(Invite.workspace_id == ctx.workspace.id).order_by(Invite.created_at.desc()))).all()
    now = datetime.now(timezone.utc)
    return [InviteOut(id=i.id, email=i.email, role=i.role, link=_invite_link(i.token), expires_at=i.expires_at,
                      expired=i.expires_at < now, accepted_at=i.accepted_at, invited_by=i.invited_by) for i in rows]


@router.post("/workspaces/current/invites", response_model=InviteOut, status_code=201)
async def create_invite(body: InviteIn, ctx: Ctx = IsAdmin) -> InviteOut:
    ws = ctx.workspace
    s = await _seats(ctx.db, ws)
    if s.members + s.pending_invites >= s.limit:
        if ws.plan == "team":
            raise ApiError(402, "seat_limit", f"All {s.limit} seats are in use. Add seats under Plan & credits.")
        raise ApiError(402, "seat_limit", f"The {ws.plan.title()} plan includes {s.limit} member(s). Upgrade to Team to invite people.")
    email = body.email.lower()
    already = await ctx.db.scalar(select(Membership).join(User, User.id == Membership.user_id)
                                  .where(Membership.workspace_id == ws.id, func.lower(User.email) == email))
    if already:
        raise ApiError(409, "already_member", "That person is already a member.")
    inv = Invite(workspace_id=ws.id, email=email, role=body.role, token=crypto.new_token(24), invited_by=ctx.user.id,
                 expires_at=datetime.now(timezone.utc) + timedelta(days=7))
    ctx.db.add(inv)
    await ctx.db.commit()
    return InviteOut(id=inv.id, email=inv.email, role=inv.role, link=_invite_link(inv.token), expires_at=inv.expires_at,
                     accepted_at=None, invited_by=ctx.user.id)


@router.delete("/workspaces/current/invites/{invite_id}", status_code=204)
async def revoke_invite(invite_id: str, ctx: Ctx = IsAdmin) -> None:
    inv = await ctx.db.scalar(select(Invite).where(Invite.id == invite_id, Invite.workspace_id == ctx.workspace.id))
    if not inv:
        raise ApiError(404, "not_found", "Invite not found.")
    await ctx.db.delete(inv)
    await ctx.db.commit()


@router.get("/invites/{token}", response_model=InviteMeta)
async def invite_meta(token: str, db: AsyncSession = Depends(get_db)) -> InviteMeta:
    inv = await db.scalar(select(Invite).where(Invite.token == token))
    if not inv:
        raise ApiError(404, "not_found", "This invite link is not valid.")
    ws = await db.get(Workspace, inv.workspace_id)
    inviter = await db.get(User, inv.invited_by) if inv.invited_by else None
    return InviteMeta(workspace=ws.name if ws else "", role=inv.role, invited_by=inviter.name if inviter else None,
                      email=inv.email, expired=inv.expires_at < datetime.now(timezone.utc), accepted=inv.accepted_at is not None)


@router.post("/invites/{token}/accept", response_model=WorkspaceOut)
async def accept_invite(token: str, ctx: Ctx = Depends(get_ctx)) -> WorkspaceOut:
    inv = await ctx.db.scalar(select(Invite).where(Invite.token == token))
    if not inv:
        raise ApiError(404, "not_found", "This invite link is not valid.")
    if inv.accepted_at:
        raise ApiError(409, "used", "This invite was already used.")
    if inv.expires_at < datetime.now(timezone.utc):
        raise ApiError(410, "expired", "This invite has expired. Ask for a new one.")
    if inv.email.lower() != ctx.user.email.lower():
        raise ApiError(403, "wrong_account", f"This invite is for {inv.email}. Sign in with that email.")
    ws = await ctx.db.get(Workspace, inv.workspace_id)
    existing = await ctx.db.scalar(select(Membership).where(Membership.workspace_id == ws.id, Membership.user_id == ctx.user.id))
    if not existing:
        ctx.db.add(Membership(workspace_id=ws.id, user_id=ctx.user.id, role=inv.role))
    inv.accepted_at, inv.accepted_by = datetime.now(timezone.utc), ctx.user.id
    await ctx.db.commit()
    return WorkspaceOut.model_validate(ws, from_attributes=True).model_copy(update={"role": inv.role})


# --- members -------------------------------------------------------------------------
@router.patch("/workspaces/current/members/{user_id}", response_model=dict)
async def change_role(user_id: str, body: RolePatch, ctx: Ctx = IsAdmin) -> dict:
    m = await ctx.db.scalar(select(Membership).where(Membership.workspace_id == ctx.workspace.id, Membership.user_id == user_id))
    if not m:
        raise ApiError(404, "not_found", "That person is not a member.")
    if body.role == "owner" and ctx.role != "owner":
        raise ApiError(403, "forbidden", "Only an owner can make someone an owner.")
    if m.role == "owner" and body.role != "owner":
        owners = await ctx.db.scalar(select(func.count(Membership.id)).where(Membership.workspace_id == ctx.workspace.id, Membership.role == "owner"))
        if owners <= 1:
            raise ApiError(400, "last_owner", "A workspace needs at least one owner.")
    m.role = body.role
    await ctx.db.commit()
    return {"user_id": user_id, "role": m.role}


@router.delete("/workspaces/current/members/{user_id}", status_code=204)
async def remove_member(user_id: str, ctx: Ctx = IsAdmin) -> None:
    m = await ctx.db.scalar(select(Membership).where(Membership.workspace_id == ctx.workspace.id, Membership.user_id == user_id))
    if not m:
        raise ApiError(404, "not_found", "That person is not a member.")
    if m.role == "owner":
        owners = await ctx.db.scalar(select(func.count(Membership.id)).where(Membership.workspace_id == ctx.workspace.id, Membership.role == "owner"))
        if owners <= 1:
            raise ApiError(400, "last_owner", "A workspace needs at least one owner.")
    await ctx.db.delete(m)
    await ctx.db.commit()


@router.post("/workspaces/current/leave", status_code=204)
async def leave(ctx: Ctx = Depends(get_ctx)) -> None:
    m = await ctx.db.scalar(select(Membership).where(Membership.workspace_id == ctx.workspace.id, Membership.user_id == ctx.user.id))
    if m.role == "owner":
        owners = await ctx.db.scalar(select(func.count(Membership.id)).where(Membership.workspace_id == ctx.workspace.id, Membership.role == "owner"))
        if owners <= 1:
            raise ApiError(400, "last_owner", "Make someone else an owner before leaving.")
    await ctx.db.delete(m)
    await ctx.db.commit()


# --- per-avatar access -----------------------------------------------------------------
@router.put("/identities/{identity_id}/access", response_model=IdentityOut)
async def set_access(identity_id: str, body: AccessIn, ctx: Ctx = IsAdmin) -> IdentityOut:
    """Who may make videos with this avatar. Empty list = every editor in the workspace."""
    identity = await ctx.db.scalar(select(Identity).options(selectinload(Identity.looks))
                                   .where(Identity.id == identity_id, Identity.workspace_id == ctx.workspace.id))
    if not identity:
        raise ApiError(404, "not_found", "That avatar does not exist.")
    if body.user_ids:
        members = set((await ctx.db.scalars(select(Membership.user_id).where(Membership.workspace_id == ctx.workspace.id))).all())
        bad = [u for u in body.user_ids if u not in members]
        if bad:
            raise ApiError(400, "not_member", "Everyone on the list must be a member of this workspace.")
    identity.allowed_user_ids = body.user_ids
    await ctx.db.commit()
    return identity_out(identity)


def ensure_identity_access(ctx: Ctx, identity: Identity) -> None:
    """Hard rule for teams: per-avatar permission (PRD section 2, small team must-have)."""
    allowed = identity.allowed_user_ids or []
    if allowed and ctx.role not in ("owner", "admin") and ctx.user.id not in allowed:
        raise ApiError(403, "avatar_locked", "You do not have access to this avatar. Ask an admin.")
