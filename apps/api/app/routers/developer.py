"""Developer surface: API keys and webhooks (PRD user type 3: n8n / Zapier / API)."""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, HttpUrl
from sqlalchemy import select

from app.config import settings
from app.deps import AdminOrKeyWrite, ApiError, Ctx, IsAdmin, get_ctx
from app.models.team import ApiKey, Webhook, WebhookDelivery
from app.services import crypto, events

router = APIRouter(tags=["developer"])

SCOPES = ("read", "write")
KEY_PREFIX = "ask_live_"


class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    scopes: list[str] = Field(default_factory=lambda: ["read", "write"])


class ApiKeyOut(BaseModel):
    id: str
    name: str
    prefix: str
    scopes: list[str]
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None
    key: str | None = None  # full key, shown once at creation


class WebhookIn(BaseModel):
    url: HttpUrl
    events: list[str] = Field(default_factory=list)
    description: str = Field(default="", max_length=200)
    active: bool = True


class WebhookOut(BaseModel):
    id: str
    url: str
    events: list[str]
    active: bool
    description: str
    secret: str
    created_at: datetime


class DeliveryOut(BaseModel):
    id: str
    event: str
    status: str
    attempts: int
    last_status_code: int | None
    last_error: str | None
    next_attempt_at: datetime | None
    delivered_at: datetime | None
    created_at: datetime
    payload: dict


def hash_key(full: str) -> str:
    return hashlib.sha256(full.encode()).hexdigest()


# --- API keys ----------------------------------------------------------------------
@router.get("/api-keys", response_model=list[ApiKeyOut])
async def list_keys(ctx: Ctx = IsAdmin) -> list[ApiKeyOut]:
    rows = (await ctx.db.scalars(select(ApiKey).where(ApiKey.workspace_id == ctx.workspace.id).order_by(ApiKey.created_at.desc()))).all()
    return [ApiKeyOut(id=k.id, name=k.name, prefix=k.prefix, scopes=k.scopes or [], created_at=k.created_at,
                      last_used_at=k.last_used_at, revoked_at=k.revoked_at) for k in rows]


@router.post("/api-keys", response_model=ApiKeyOut, status_code=201)
async def create_key(body: ApiKeyCreate, ctx: Ctx = IsAdmin) -> ApiKeyOut:
    if ctx.workspace.plan not in ("pro", "team") and settings.env == "prod":
        raise ApiError(402, "plan_required", "API access is included in Pro and Team.")
    bad = [s for s in body.scopes if s not in SCOPES]
    if bad:
        raise ApiError(400, "bad_scope", f"Unknown scope {bad[0]}. Use read and/or write.")
    full = KEY_PREFIX + crypto.new_token(24).replace("-", "x").replace("_", "y")
    key = ApiKey(workspace_id=ctx.workspace.id, name=body.name.strip(), prefix=full[:12], key_hash=hash_key(full),
                 scopes=sorted(set(body.scopes)), created_by=ctx.user.id)
    ctx.db.add(key)
    await ctx.db.commit()
    return ApiKeyOut(id=key.id, name=key.name, prefix=key.prefix, scopes=key.scopes, created_at=key.created_at,
                     last_used_at=None, revoked_at=None, key=full)


@router.delete("/api-keys/{key_id}", status_code=204)
async def revoke_key(key_id: str, ctx: Ctx = IsAdmin) -> None:
    key = await ctx.db.scalar(select(ApiKey).where(ApiKey.id == key_id, ApiKey.workspace_id == ctx.workspace.id))
    if not key:
        raise ApiError(404, "not_found", "That key does not exist.")
    key.revoked_at = datetime.now(timezone.utc)
    await ctx.db.commit()


# --- webhooks ----------------------------------------------------------------------
@router.get("/webhooks/events")
async def list_events(ctx: Ctx = Depends(get_ctx)) -> dict:
    return {"events": list(events.EVENTS), "signature_header": "X-AvatarStudio-Signature",
            "how_to_verify": "hex(hmac_sha256(secret, f'{t}.{raw_body}')) must equal v1; reject if |now - t| > 300 s."}


@router.get("/webhooks", response_model=list[WebhookOut])
async def list_webhooks(ctx: Ctx = AdminOrKeyWrite) -> list[WebhookOut]:
    rows = (await ctx.db.scalars(select(Webhook).where(Webhook.workspace_id == ctx.workspace.id).order_by(Webhook.created_at))).all()
    return [WebhookOut(id=w.id, url=w.url, events=w.events or [], active=w.active, description=w.description,
                       secret=w.secret, created_at=w.created_at) for w in rows]


@router.post("/webhooks", response_model=WebhookOut, status_code=201)
async def create_webhook(body: WebhookIn, ctx: Ctx = AdminOrKeyWrite) -> WebhookOut:
    bad = [e for e in body.events if e not in events.EVENTS]
    if bad:
        raise ApiError(400, "bad_event", f"Unknown event {bad[0]}.")
    url = str(body.url)
    if settings.env == "prod" and url.startswith("http://"):
        raise ApiError(400, "https_required", "Webhook URLs must use https.")
    count = len((await ctx.db.scalars(select(Webhook.id).where(Webhook.workspace_id == ctx.workspace.id))).all())
    if count >= 10:
        raise ApiError(400, "too_many", "You can have up to 10 webhooks.")
    w = Webhook(workspace_id=ctx.workspace.id, url=url, secret="whsec_" + crypto.new_token(24), events=body.events,
                active=body.active, description=body.description.strip())
    ctx.db.add(w)
    await ctx.db.commit()
    return WebhookOut(id=w.id, url=w.url, events=w.events, active=w.active, description=w.description, secret=w.secret,
                      created_at=w.created_at)


@router.get("/webhooks/{webhook_id}", response_model=WebhookOut)
async def get_webhook(webhook_id: str, ctx: Ctx = AdminOrKeyWrite) -> WebhookOut:
    w = await ctx.db.scalar(select(Webhook).where(Webhook.id == webhook_id, Webhook.workspace_id == ctx.workspace.id))
    if not w:
        raise ApiError(404, "not_found", "That webhook does not exist.")
    return WebhookOut(id=w.id, url=w.url, events=w.events or [], active=w.active, description=w.description, secret=w.secret,
                      created_at=w.created_at)


@router.patch("/webhooks/{webhook_id}", response_model=WebhookOut)
async def update_webhook(webhook_id: str, body: WebhookIn, ctx: Ctx = AdminOrKeyWrite) -> WebhookOut:
    w = await ctx.db.scalar(select(Webhook).where(Webhook.id == webhook_id, Webhook.workspace_id == ctx.workspace.id))
    if not w:
        raise ApiError(404, "not_found", "That webhook does not exist.")
    w.url, w.events, w.active, w.description = str(body.url), body.events, body.active, body.description.strip()
    await ctx.db.commit()
    return WebhookOut(id=w.id, url=w.url, events=w.events, active=w.active, description=w.description, secret=w.secret,
                      created_at=w.created_at)


@router.delete("/webhooks/{webhook_id}", status_code=204)
async def delete_webhook(webhook_id: str, ctx: Ctx = AdminOrKeyWrite) -> None:
    w = await ctx.db.scalar(select(Webhook).where(Webhook.id == webhook_id, Webhook.workspace_id == ctx.workspace.id))
    if not w:
        raise ApiError(404, "not_found", "That webhook does not exist.")
    await ctx.db.delete(w)
    await ctx.db.commit()


@router.post("/webhooks/{webhook_id}/test", response_model=DeliveryOut)
async def test_webhook(webhook_id: str, ctx: Ctx = AdminOrKeyWrite) -> DeliveryOut:
    """Send a test.ping right now and report the response."""
    w = await ctx.db.scalar(select(Webhook).where(Webhook.id == webhook_id, Webhook.workspace_id == ctx.workspace.id))
    if not w:
        raise ApiError(404, "not_found", "That webhook does not exist.")
    d = WebhookDelivery(workspace_id=ctx.workspace.id, webhook_id=w.id, event="test.ping",
                        payload={"event": "test.ping", "data": {"workspace_id": ctx.workspace.id, "hello": "from Avatar Studio"}},
                        status="pending", attempts=0, next_attempt_at=datetime.now(timezone.utc))
    ctx.db.add(d)
    await ctx.db.commit()
    await run_in_threadpool(_deliver_now, d.id)
    await ctx.db.refresh(d)
    return _delivery_out(d)


def _deliver_now(delivery_id: str) -> None:
    from app.worker.db import SyncSession

    with SyncSession() as db:
        events.deliver_due(db, limit=50)


def _delivery_out(d: WebhookDelivery) -> DeliveryOut:
    return DeliveryOut(id=d.id, event=d.event, status=d.status, attempts=d.attempts, last_status_code=d.last_status_code,
                       last_error=d.last_error, next_attempt_at=d.next_attempt_at, delivered_at=d.delivered_at,
                       created_at=d.created_at, payload=d.payload or {})


@router.get("/webhooks/{webhook_id}/deliveries", response_model=list[DeliveryOut])
async def deliveries(webhook_id: str, ctx: Ctx = AdminOrKeyWrite, limit: int = 50) -> list[DeliveryOut]:
    rows = (await ctx.db.scalars(select(WebhookDelivery).where(WebhookDelivery.webhook_id == webhook_id,
                                                               WebhookDelivery.workspace_id == ctx.workspace.id)
                                 .order_by(WebhookDelivery.created_at.desc()).limit(min(limit, 200)))).all()
    return [_delivery_out(d) for d in rows]


@router.post("/webhooks/deliveries/{delivery_id}/replay", response_model=DeliveryOut)
async def replay(delivery_id: str, ctx: Ctx = AdminOrKeyWrite) -> DeliveryOut:
    d = await ctx.db.scalar(select(WebhookDelivery).where(WebhookDelivery.id == delivery_id, WebhookDelivery.workspace_id == ctx.workspace.id))
    if not d:
        raise ApiError(404, "not_found", "That delivery does not exist.")
    d.status, d.attempts, d.next_attempt_at, d.last_error = "pending", 0, datetime.now(timezone.utc), None
    await ctx.db.commit()
    await run_in_threadpool(_deliver_now, d.id)
    await ctx.db.refresh(d)
    return _delivery_out(d)
