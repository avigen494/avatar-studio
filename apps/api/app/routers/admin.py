"""
Settings > Connections. Admin-only, except /config/public which the web app
reads on load to learn the auth mode and the Clerk publishable key.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.config import settings
from app.db import get_db
from app.deps import ApiError, Ctx, get_ctx
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.platform import PlatformSetting
from app.services import connections
from app.services.admin import is_platform_admin, require_admin
from app.services.runtime_config import KEYS, cfg, masked, record_test, refresh, set_values, source_of

router = APIRouter(tags=["admin"])


class FieldOut(BaseModel):
    key: str
    label: str
    help: str
    placeholder: str
    secret: bool
    choices: list[str] | None
    value: str | None          # full value for non-secrets, masked for secrets
    is_set: bool
    source: str                # db | env | default | none


class ServiceOut(BaseModel):
    id: str
    name: str
    purpose: str
    docs_url: str
    required_for: str
    warning: str | None = None
    fields: list[FieldOut]
    connected: bool
    last_test_ok: bool | None = None
    last_test_message: str | None = None
    last_tested_at: datetime | None = None


class SaveIn(BaseModel):
    values: dict[str, str | None]


class TestOut(BaseModel):
    ok: bool
    message: str


@router.get("/config/public")
async def public_config(db: AsyncSession = Depends(get_db)) -> dict:
    """What the browser needs before sign-in. Never contains secrets."""

    async def live(key: str) -> bool:
        # A key counts as live when it is set and its last test (if any) passed.
        if not cfg(key):
            return False
        row = await db.get(PlatformSetting, key)
        return not (row and row.last_test_ok is False)

    return {
        "auth_mode": cfg("auth_mode") or "dev",
        "clerk_publishable_key": cfg("clerk_publishable_key") or "",
        "api_base_url": settings.api_base_url,
        "avatar_engine": cfg("avatar_engine_backend") or "mock",
        "voice_engines": [n for n in ("elevenlabs", "sarvam") if await live(f"{n}_api_key")],
        "script_helper": await live("anthropic_api_key"),
        "look_generator": await live("fal_api_key"),
    }


@router.get("/admin/whoami")
async def whoami(ctx: Ctx = Depends(get_ctx)) -> dict:
    return {"is_admin": await is_platform_admin(ctx)}


async def _service_out(ctx: Ctx, svc: connections.Service) -> ServiceOut:
    fields = []
    for f in svc.fields:
        spec = KEYS[f.key]
        val = cfg(f.key)
        fields.append(FieldOut(
            key=f.key, label=f.label, help=f.help, placeholder=f.placeholder, secret=spec.secret,
            choices=list(spec.choices) if spec.choices else None,
            value=masked(val) if spec.secret else val, is_set=bool(val), source=source_of(f.key),
        ))
    rows = [await ctx.db.get(PlatformSetting, k) for k in svc.keys]
    tested = [r for r in rows if r and r.last_tested_at]
    last = max(tested, key=lambda r: r.last_tested_at) if tested else None
    secret_keys = [f.key for f in svc.fields if KEYS[f.key].secret]
    connected = all(cfg(k) for k in secret_keys) if secret_keys else True
    if svc.id == "r2":
        connected = (cfg("storage_backend") or "local") == "local" or all(cfg(k) for k in svc.keys)
    if svc.id == "clerk":
        connected = (cfg("auth_mode") or "dev") == "dev" or bool(cfg("clerk_publishable_key") and cfg("clerk_issuer"))
    return ServiceOut(
        id=svc.id, name=svc.name, purpose=svc.purpose, docs_url=svc.docs_url, required_for=svc.required_for,
        warning=svc.extra.get("warning"), fields=fields, connected=connected,
        last_test_ok=last.last_test_ok if last else None, last_test_message=last.last_test_message if last else None,
        last_tested_at=last.last_tested_at if last else None,
    )


@router.get("/admin/connections", response_model=list[ServiceOut])
async def list_connections(ctx: Ctx = Depends(require_admin)) -> list[ServiceOut]:
    refresh(force=True)
    return [await _service_out(ctx, s) for s in connections.SERVICES]


@router.put("/admin/connections/{service_id}", response_model=ServiceOut)
async def save_connection(service_id: str, body: SaveIn, ctx: Ctx = Depends(require_admin)) -> ServiceOut:
    svc = connections.SERVICE_BY_ID.get(service_id)
    if not svc:
        raise ApiError(404, "not_found", "Unknown service.")
    allowed = set(svc.keys)
    bad = [k for k in body.values if k not in allowed]
    if bad:
        raise ApiError(400, "bad_field", f"{bad[0]} does not belong to {svc.name}.")
    # A masked secret sent back unchanged means "keep what is saved".
    values = {k: v for k, v in body.values.items() if not (KEYS[k].secret and v and "…" in v)}
    try:
        await ctx.db.run_sync(set_values, values, ctx.user.id)
    except ValueError as e:
        raise ApiError(400, "bad_value", str(e))
    await ctx.db.commit()
    refresh(force=True)  # the cache reads committed rows only
    return await _service_out(ctx, svc)


@router.post("/admin/connections/{service_id}/test", response_model=TestOut)
async def test_connection(service_id: str, ctx: Ctx = Depends(require_admin)) -> TestOut:
    svc = connections.SERVICE_BY_ID.get(service_id)
    if not svc:
        raise ApiError(404, "not_found", "Unknown service.")
    refresh(force=True)
    ok, message = await run_in_threadpool(connections.test_service, service_id)
    await ctx.db.run_sync(record_test, svc.keys, ok, message)
    await ctx.db.commit()
    return TestOut(ok=ok, message=message)
