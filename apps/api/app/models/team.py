"""Team invites, API keys and webhooks (v3)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import IdMixin, TimestampMixin, UTCDateTime, WorkspaceScoped


class Invite(Base, IdMixin, TimestampMixin, WorkspaceScoped):
    __tablename__ = "invites"

    email: Mapped[str] = mapped_column(String(320), index=True)
    role: Mapped[str] = mapped_column(String(20), default="editor")
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    invited_by: Mapped[str | None] = mapped_column(String(32))
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime())
    accepted_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    accepted_by: Mapped[str | None] = mapped_column(String(32))


class ApiKey(Base, IdMixin, TimestampMixin, WorkspaceScoped):
    __tablename__ = "api_keys"

    name: Mapped[str] = mapped_column(String(120))
    prefix: Mapped[str] = mapped_column(String(12), index=True)   # first chars shown in the UI
    key_hash: Mapped[str] = mapped_column(String(64), unique=True)  # sha256 of the full key
    scopes: Mapped[list] = mapped_column(JSON, default=list)       # ["videos:write", "videos:read", ...]
    created_by: Mapped[str | None] = mapped_column(String(32))
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


class Webhook(Base, IdMixin, TimestampMixin, WorkspaceScoped):
    __tablename__ = "webhooks"

    url: Mapped[str] = mapped_column(String(1000))
    secret: Mapped[str] = mapped_column(String(64))
    events: Mapped[list] = mapped_column(JSON, default=list)  # [] = all
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    description: Mapped[str] = mapped_column(String(200), default="")


class WebhookDelivery(Base, IdMixin, TimestampMixin, WorkspaceScoped):
    __tablename__ = "webhook_deliveries"

    webhook_id: Mapped[str] = mapped_column(String(32), index=True)
    event: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | delivered | failed
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    last_status_code: Mapped[int | None] = mapped_column(Integer)
    last_error: Mapped[str | None] = mapped_column(Text)
    delivered_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
