"""
Request dependencies: who is calling and which workspace they are in.

Two auth modes:
  dev   - trusts the X-Dev-User-Email header (local only, never in prod)
  clerk - verifies a Clerk session JWT (Authorization: Bearer <token>)

On a user's first request we create them, give them a workspace and the
free-plan credit grant. Every router then receives a `Ctx` with the user,
the workspace and their role, and every query is scoped by ctx.workspace.id.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

import httpx
import jwt
from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.models.core import Membership, User, Workspace
from app.services import credits
from app.services.runtime_config import cfg


@dataclass
class Ctx:
    user: User
    workspace: Workspace
    role: str
    db: AsyncSession
    auth_kind: str = "session"        # session | api_key
    scopes: tuple[str, ...] = ("read", "write")


class ApiError(HTTPException):
    """Error with a stable machine code and a plain-English message."""

    def __init__(self, status_code: int, code: str, message: str, **extra):
        super().__init__(status_code=status_code, detail={"code": code, "message": message, **extra})


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:40] or "studio"


# --- Clerk -----------------------------------------------------------------
@lru_cache(maxsize=4)
def _jwk_client_for(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(url, cache_keys=True)


def _jwk_client() -> jwt.PyJWKClient:
    url = cfg("clerk_jwks_url")
    issuer = cfg("clerk_issuer")
    if not url and issuer:
        url = issuer.rstrip("/") + "/.well-known/jwks.json"
    if not url:
        raise ApiError(503, "auth_not_configured", "Sign-in is not configured yet. Add the Clerk issuer in Connections.")
    return _jwk_client_for(url)


def _verify_clerk(token: str) -> dict:
    try:
        key = _jwk_client().get_signing_key_from_jwt(token).key
        return jwt.decode(
            token, key, algorithms=["RS256"],
            issuer=cfg("clerk_issuer"), options={"verify_aud": False, "verify_iss": bool(cfg("clerk_issuer"))},
            leeway=10,
        )
    except jwt.PyJWTError as e:
        raise ApiError(401, "invalid_token", "Your session has expired. Sign in again.") from e


async def _clerk_profile(user_id: str) -> tuple[str, str, str | None]:
    """Fetch email and name from Clerk's backend API (first sight only)."""
    secret = cfg("clerk_secret_key")
    if not secret:
        return f"{user_id}@unknown.local", "", None
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"https://api.clerk.com/v1/users/{user_id}",
                             headers={"Authorization": f"Bearer {secret}"})
    if r.status_code != 200:
        return f"{user_id}@unknown.local", "", None
    data = r.json()
    emails = {e["id"]: e["email_address"] for e in data.get("email_addresses", [])}
    email = emails.get(data.get("primary_email_address_id")) or next(iter(emails.values()), f"{user_id}@unknown.local")
    name = " ".join(x for x in [data.get("first_name"), data.get("last_name")] if x)
    return email, name, data.get("image_url")


# --- Resolution ------------------------------------------------------------
async def _identify(request: Request, authorization: str | None, dev_email: str | None) -> tuple[str, str, str, str | None]:
    """Returns (external_id, email, name, avatar_url)."""
    if (cfg("auth_mode") or "dev") == "dev":
        email = (dev_email or "").strip().lower()
        if not email:
            raise ApiError(401, "not_signed_in", "Sign in to continue.")
        name = email.split("@")[0].replace(".", " ").title()
        return f"dev:{email}", email, name, None

    if not authorization or not authorization.lower().startswith("bearer "):
        raise ApiError(401, "not_signed_in", "Sign in to continue.")
    claims = _verify_clerk(authorization.split(" ", 1)[1].strip())
    sub = claims.get("sub")
    if not sub:
        raise ApiError(401, "invalid_token", "Your session has expired. Sign in again.")
    email = claims.get("email") or ""
    name = claims.get("name") or ""
    if not email:
        email, name, _img = await _clerk_profile(sub)
        return sub, email, name, _img
    return sub, email, name, claims.get("picture")


async def _ensure_user(db: AsyncSession, external_id: str, email: str, name: str, avatar_url: str | None) -> User:
    user = await db.scalar(select(User).where(User.external_id == external_id))
    if user:
        if avatar_url and user.avatar_url != avatar_url:
            user.avatar_url = avatar_url
        return user
    user = User(external_id=external_id, email=email, name=name, avatar_url=avatar_url)
    try:
        async with db.begin_nested():
            db.add(user)
            await db.flush()
            await create_workspace_for(db, user, f"{name or email.split('@')[0]}'s studio")
        await db.commit()
        return user
    except IntegrityError:
        # A parallel first request created this user a moment ago; use that row.
        await db.rollback()
        existing = await db.scalar(select(User).where(User.external_id == external_id))
        if existing is None:
            raise
        return existing


async def create_workspace_for(db: AsyncSession, user: User, name: str) -> Workspace:
    base = slugify(name)
    slug = base
    n = 1
    while await db.scalar(select(Workspace.id).where(Workspace.slug == slug)):
        n += 1
        slug = f"{base}-{n}"
    ws = Workspace(name=name, slug=slug, plan="free", max_avatars=1)
    db.add(ws)
    await db.flush()
    db.add(Membership(workspace_id=ws.id, user_id=user.id, role="owner"))
    await db.run_sync(credits.grant, ws.id, settings.free_plan_credits, "Free plan welcome credits", "grant")
    await db.flush()
    return ws


async def _api_key_ctx(db: AsyncSession, token: str) -> Ctx:
    """Bearer ask_live_... keys act as an editor of their workspace, limited by scopes."""
    import hashlib
    from datetime import datetime, timezone

    from app.models.team import ApiKey

    key = await db.scalar(select(ApiKey).where(ApiKey.key_hash == hashlib.sha256(token.encode()).hexdigest()))
    if not key or key.revoked_at:
        raise ApiError(401, "invalid_api_key", "That API key is not valid.")
    workspace = await db.get(Workspace, key.workspace_id)
    user = await db.get(User, key.created_by) if key.created_by else None
    if user is None:
        user = await db.scalar(select(User).join(Membership, Membership.user_id == User.id)
                               .where(Membership.workspace_id == key.workspace_id).order_by(Membership.created_at))
    if workspace is None or user is None:
        raise ApiError(401, "invalid_api_key", "That API key is not valid.")
    key.last_used_at = datetime.now(timezone.utc)
    await db.commit()
    return Ctx(user=user, workspace=workspace, role="editor", db=db, auth_kind="api_key", scopes=tuple(key.scopes or []))


async def get_ctx(
    request: Request,
    db: AsyncSession = Depends(get_db),
    authorization: str | None = Header(default=None),
    x_dev_user_email: str | None = Header(default=None),
    x_workspace_id: str | None = Header(default=None),
) -> Ctx:
    if authorization and authorization.lower().startswith("bearer ask_"):
        return await _api_key_ctx(db, authorization.split(" ", 1)[1].strip())
    external_id, email, name, avatar_url = await _identify(request, authorization, x_dev_user_email)
    user = await _ensure_user(db, external_id, email, name, avatar_url)

    q = select(Membership).where(Membership.user_id == user.id)
    if x_workspace_id:
        q = q.where(Membership.workspace_id == x_workspace_id)
    membership = await db.scalar(q.order_by(Membership.created_at))
    if not membership:
        if x_workspace_id:
            raise ApiError(403, "not_a_member", "You are not a member of that workspace.")
        raise ApiError(403, "no_workspace", "You do not have a workspace yet.")
    workspace = await db.get(Workspace, membership.workspace_id)
    return Ctx(user=user, workspace=workspace, role=membership.role, db=db)


def require_role(*roles: str):
    async def _check(ctx: Ctx = Depends(get_ctx)) -> Ctx:
        if ctx.role not in roles:
            raise ApiError(status.HTTP_403_FORBIDDEN, "forbidden", "You do not have permission to do that.")
        if ctx.auth_kind == "api_key" and "write" not in ctx.scopes and set(roles) & {"owner", "admin", "editor"}:
            raise ApiError(status.HTTP_403_FORBIDDEN, "scope_required", "This API key is read-only.")
        return ctx

    return _check


async def _admin_or_key_write(ctx: Ctx = Depends(get_ctx)) -> Ctx:
    """Owners/admins, or an API key with the write scope (so n8n/Zapier can register webhooks)."""
    if ctx.auth_kind == "api_key":
        if "write" not in ctx.scopes:
            raise ApiError(status.HTTP_403_FORBIDDEN, "scope_required", "This API key is read-only.")
        return ctx
    if ctx.role not in ("owner", "admin"):
        raise ApiError(status.HTTP_403_FORBIDDEN, "forbidden", "You do not have permission to do that.")
    return ctx


CanEdit = Depends(require_role("owner", "admin", "editor"))
IsAdmin = Depends(require_role("owner", "admin"))
AdminOrKeyWrite = Depends(_admin_or_key_write)
