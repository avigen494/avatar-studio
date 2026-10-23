"""
Outbound events (webhooks).

emit() records one WebhookDelivery per active webhook that subscribes to the
event. The worker's housekeeping loop posts them with an HMAC signature and
retries on a backoff schedule. Everything is per workspace.

Signature header:  X-AvatarStudio-Signature: t=<unix>,v1=<hex hmac_sha256(secret, f"{t}.{body}")>
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.team import Webhook, WebhookDelivery

log = logging.getLogger("events")

EVENTS = (
    "video.succeeded", "video.failed", "video.cancelled", "preview.ready",
    "identity.verified", "identity.rejected", "style.ready", "style.failed", "look.generated", "test.ping",
)
BACKOFF_MINUTES = (1, 5, 30, 120, 720)  # 5 attempts over about 14 hours
MAX_ATTEMPTS = len(BACKOFF_MINUTES) + 1


def _now() -> datetime:
    return datetime.now(timezone.utc)


def emit(db: Session, workspace_id: str, event: str, data: dict) -> int:
    """Queue the event for every matching webhook. Returns how many deliveries were created."""
    hooks = db.scalars(select(Webhook).where(Webhook.workspace_id == workspace_id, Webhook.active.is_(True))).all()
    n = 0
    for h in hooks:
        if h.events and event not in h.events:
            continue
        db.add(WebhookDelivery(workspace_id=workspace_id, webhook_id=h.id, event=event,
                               payload={"event": event, "created_at": _now().isoformat(), "data": data},
                               status="pending", attempts=0, next_attempt_at=_now()))
        n += 1
    if n:
        db.flush()
    return n


def sign(secret: str, body: bytes, ts: int | None = None) -> str:
    ts = ts or int(time.time())
    mac = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={ts},v1={mac}"


def verify(secret: str, body: bytes, header: str, tolerance: int = 300) -> bool:
    """For customers' servers (also used by the n8n node and the docs example)."""
    parts = dict(p.split("=", 1) for p in header.split(",") if "=" in p)
    try:
        ts = int(parts.get("t", "0"))
    except ValueError:
        return False
    if abs(time.time() - ts) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))


def deliver_due(db: Session, limit: int = 20) -> int:
    """Post pending deliveries whose time has come. Called by the worker loop."""
    rows = db.scalars(select(WebhookDelivery).where(WebhookDelivery.status == "pending",
                                                    WebhookDelivery.next_attempt_at <= _now())
                      .order_by(WebhookDelivery.next_attempt_at).limit(limit)).all()
    done = 0
    for d in rows:
        hook = db.get(Webhook, d.webhook_id)
        if not hook or not hook.active:
            d.status, d.last_error = "failed", "Webhook removed or paused"
            continue
        body = json.dumps(d.payload, separators=(",", ":"), ensure_ascii=False).encode()
        headers = {"Content-Type": "application/json", "User-Agent": "AvatarStudio-Webhooks/1.0",
                   "X-AvatarStudio-Event": d.event, "X-AvatarStudio-Delivery": d.id,
                   "X-AvatarStudio-Signature": sign(hook.secret, body)}
        d.attempts += 1
        started = time.time()
        try:
            with httpx.Client(timeout=10, follow_redirects=False) as client:
                r = client.post(hook.url, content=body, headers=headers)
            d.last_status_code = r.status_code
            log.info("webhook %s %s -> %s in %.1fs (attempt %d)", d.id, d.event, r.status_code, time.time() - started, d.attempts)
            if 200 <= r.status_code < 300:
                d.status, d.delivered_at, d.last_error = "delivered", _now(), None
                done += 1
                continue
            d.last_error = f"HTTP {r.status_code}: {r.text[:200]}"
        except httpx.HTTPError as e:
            d.last_status_code = None
            d.last_error = f"{type(e).__name__}: {str(e)[:200]}"
            log.warning("webhook %s %s failed after %.1fs: %s", d.id, d.event, time.time() - started, d.last_error)
        if d.attempts >= MAX_ATTEMPTS:
            d.status = "failed"
        else:
            d.next_attempt_at = _now() + timedelta(minutes=BACKOFF_MINUTES[min(d.attempts - 1, len(BACKOFF_MINUTES) - 1)])
    db.commit()
    return done


def video_payload(video) -> dict:
    from app.services.serializers import video_out

    v = video_out(video).model_dump(mode="json")
    keys = ("id", "title", "status", "stage", "error_message", "duration_s", "estimated_credits", "charged_credits",
            "language", "aspect", "quality", "output_url", "output_captioned_url", "srt_url", "thumbnail_url",
            "preview_url", "share_url", "project_id", "identity_id", "voice_id", "created_at", "completed_at")
    return {k: v.get(k) for k in keys}
