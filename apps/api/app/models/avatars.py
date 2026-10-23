"""
Identities (avatars) and their looks.

An identity is one real person (or one designed character). It owns a
reference clip, a consent recording, optional looks and a style file. All of
that lives under r2://ws/{workspace}/identities/{identity}/ (PRD section 7).
"""
from __future__ import annotations

from datetime import datetime

import random

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import IdMixin, TimestampMixin, UTCDateTime, WorkspaceScoped

IDENTITY_KINDS = ("real_person", "designed")
IDENTITY_STATUSES = ("draft", "verifying", "ready", "failed")
CONSENT_STATUSES = ("missing", "pending", "verified", "rejected")
STYLE_STATUSES = ("none", "queued", "training", "ready", "failed")


class Identity(Base, IdMixin, TimestampMixin, WorkspaceScoped):
    __tablename__ = "identities"

    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(20), default="real_person")
    status: Mapped[str] = mapped_column(String(20), default="draft")

    # 15-second reference clip: motion + consent in one take.
    reference_key: Mapped[str | None] = mapped_column(String(500))
    reference_duration_s: Mapped[float | None] = mapped_column(Float)
    thumbnail_key: Mapped[str | None] = mapped_column(String(500))

    # Hard rule 6: no real-person render without verified consent.
    consent_status: Mapped[str] = mapped_column(String(20), default="missing")
    consent_key: Mapped[str | None] = mapped_column(String(500))
    consent_method: Mapped[str | None] = mapped_column(String(40))
    consent_verified_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    consent_notes: Mapped[str | None] = mapped_column(String(1000))

    # Per-avatar style file (LoRA) - v2. Trained once from 2-10 minutes of footage.
    style_status: Mapped[str] = mapped_column(String(20), default="none")
    style_key: Mapped[str | None] = mapped_column(String(500))
    style_trained_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    style_footage_seconds: Mapped[float | None] = mapped_column(Float)
    style_error: Mapped[str | None] = mapped_column(String(500))
    # Extra footage clips uploaded for training (storage keys).
    footage_keys: Mapped[list] = mapped_column(JSON, default=list)

    # For designed avatars: the "Design with AI" form answers.
    design: Mapped[dict] = mapped_column(JSON, default=dict)
    # Team permission: user ids allowed to use this avatar. Empty = every editor.
    allowed_user_ids: Mapped[list] = mapped_column(JSON, default=list)
    # Consistency: every render of this avatar starts from the same seed (retries step it by one).
    render_seed: Mapped[int] = mapped_column(Integer, default=lambda: random.randint(1, 2_000_000_000))

    looks: Mapped[list["Look"]] = relationship(back_populates="identity", cascade="all, delete-orphan")

    @property
    def storage_prefix(self) -> str:
        return f"ws/{self.workspace_id}/identities/{self.id}"

    @property
    def can_render(self) -> bool:
        if self.kind == "designed":
            return self.status == "ready"
        return self.status == "ready" and self.consent_status == "verified"


class Look(Base, IdMixin, TimestampMixin, WorkspaceScoped):
    __tablename__ = "looks"

    identity_id: Mapped[str] = mapped_column(String(32), ForeignKey("identities.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120), default="Default")
    kind: Mapped[str] = mapped_column(String(20), default="photo")  # photo | video | generated
    media_key: Mapped[str] = mapped_column(String(500))
    thumbnail_key: Mapped[str | None] = mapped_column(String(500))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    prompt: Mapped[str | None] = mapped_column(String(2000))

    identity: Mapped[Identity] = relationship(back_populates="looks")
