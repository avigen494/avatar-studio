"""Users, workspaces and memberships."""
from __future__ import annotations

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import IdMixin, TimestampMixin

PLANS = ("free", "creator", "pro", "team")
ROLES = ("owner", "admin", "editor", "viewer")


class User(Base, IdMixin, TimestampMixin):
    __tablename__ = "users"

    # Clerk's user id (or "dev:<email>" in dev auth mode).
    external_id: Mapped[str] = mapped_column(String(191), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(320), index=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    avatar_url: Mapped[str | None] = mapped_column(String(1000))
    # v3 notifications: WhatsApp "video ready" messages, opt-in.
    phone: Mapped[str | None] = mapped_column(String(20))
    notify_whatsapp: Mapped[bool] = mapped_column(Boolean, default=False)

    memberships: Mapped[list["Membership"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Workspace(Base, IdMixin, TimestampMixin):
    __tablename__ = "workspaces"

    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    plan: Mapped[str] = mapped_column(String(20), default="free")
    # Hard rule 7: the "AI-assisted" label is per workspace, on by default on free.
    ai_label_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    watermark_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    max_avatars: Mapped[int] = mapped_column(Integer, default=1)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    brand_kit: Mapped[dict] = mapped_column(JSON, default=dict)
    glossary: Mapped[list] = mapped_column(JSON, default=list)

    memberships: Mapped[list["Membership"]] = relationship(back_populates="workspace", cascade="all, delete-orphan")


class Membership(Base, IdMixin, TimestampMixin):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id", name="uq_membership"),)

    workspace_id: Mapped[str] = mapped_column(String(32), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20), default="owner")

    workspace: Mapped[Workspace] = relationship(back_populates="memberships")
    user: Mapped[User] = relationship(back_populates="memberships")
