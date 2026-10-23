"""
Platform-level tables.

PlatformSetting is the one deliberate exception to "every table has a
workspace_id": these are deployment-wide service keys (ElevenLabs, RunPod,
R2, ...) that the platform admin manages from Settings > Connections. Values
are encrypted at rest. EngineTrial backs the Stage 0 Engine Lab.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import IdMixin, TimestampMixin, UTCDateTime, WorkspaceScoped, utcnow


class PlatformSetting(Base):
    __tablename__ = "platform_settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value_encrypted: Mapped[str] = mapped_column(Text)
    is_secret: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_by: Mapped[str | None] = mapped_column(String(32))
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utcnow, onupdate=utcnow)
    last_test_ok: Mapped[bool | None] = mapped_column(Boolean)
    last_test_message: Mapped[str | None] = mapped_column(String(500))
    last_tested_at: Mapped[datetime | None] = mapped_column(UTCDateTime())


TRIAL_STATUSES = ("queued", "running", "succeeded", "failed")


class EngineTrial(Base, IdMixin, TimestampMixin, WorkspaceScoped):
    """One Stage 0 run: one engine, one fixed input set, timing, cost and panel scores."""

    __tablename__ = "engine_trials"

    name: Mapped[str] = mapped_column(String(120))
    engine: Mapped[str] = mapped_column(String(40))  # wan_s2v | infinitetalk | infinitetalk_v2v | latentsync | heygen_v | mock
    gpu: Mapped[str] = mapped_column(String(40), default="")
    status: Mapped[str] = mapped_column(String(20), default="queued")
    script: Mapped[str] = mapped_column(Text, default="")
    voice_id: Mapped[str | None] = mapped_column(String(32))
    look_key: Mapped[str | None] = mapped_column(String(500))
    reference_key: Mapped[str | None] = mapped_column(String(500))
    aspect: Mapped[str] = mapped_column(String(10), default="9:16")
    steps: Mapped[int] = mapped_column(Integer, default=20)
    output_key: Mapped[str | None] = mapped_column(String(500))
    thumbnail_key: Mapped[str | None] = mapped_column(String(500))
    duration_s: Mapped[float | None] = mapped_column(Float)
    wall_seconds: Mapped[float | None] = mapped_column(Float)
    gpu_seconds: Mapped[float | None] = mapped_column(Float)
    cost_inr: Mapped[float | None] = mapped_column(Float)
    vram_gb: Mapped[float | None] = mapped_column(Float)
    error: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str] = mapped_column(Text, default="")
    is_benchmark: Mapped[bool] = mapped_column(Boolean, default=False)  # the HeyGen reference clip
    # [{"rater": "A", "lipsync": 4, "motion": 3, "identity": 5, "overall": 4, "guessed_heygen": false}]
    scores: Mapped[list] = mapped_column(JSON, default=list)
    # Golden regression set: trials kept as the baseline; reruns point back at their golden parent.
    is_golden: Mapped[bool] = mapped_column(Boolean, default=False)
    golden_of: Mapped[str | None] = mapped_column(String(32), index=True)
    quality_score: Mapped[float | None] = mapped_column(Float)
    quality_method: Mapped[str | None] = mapped_column(String(30))
    seed: Mapped[int | None] = mapped_column(Integer)
    engine_version: Mapped[str | None] = mapped_column(String(80))
