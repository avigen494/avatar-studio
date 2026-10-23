"""Who is the platform admin? ADMIN_EMAILS, or the first user ever created."""
from __future__ import annotations

from fastapi import Depends
from sqlalchemy import select

from app.config import settings
from app.deps import ApiError, Ctx, get_ctx
from app.models.core import User


async def is_platform_admin(ctx: Ctx) -> bool:
    allowed = {e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()}
    if allowed:
        return ctx.user.email.lower() in allowed
    first = await ctx.db.scalar(select(User.id).order_by(User.created_at).limit(1))
    return first == ctx.user.id


async def require_admin(ctx: Ctx = Depends(get_ctx)) -> Ctx:
    if not await is_platform_admin(ctx):
        raise ApiError(403, "admin_only", "Only the platform admin can do that.")
    return ctx
