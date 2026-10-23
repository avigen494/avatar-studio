"""Projects, videos, jobs and share-page reactions."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import IdMixin, TimestampMixin, UTCDateTime, WorkspaceScoped

VIDEO_STATUSES = ("draft", "queued", "rendering", "succeeded", "failed", "cancelled")
ENGINE_MODES = ("auto", "photo", "real_footage", "mouth_only")
ASPECTS = ("9:16", "16:9", "1:1")
QUALITIES = ("720p", "1080p", "4k")
LANGUAGES = ("en", "hi", "hinglish")
JOB_TYPES = ("render", "preview", "verify_identity", "train_style", "generate_look", "clone_voice", "engine_trial", "clip")
JOB_STATUSES = ("queued", "running", "succeeded", "failed", "cancelled")
# The stage names shown on the Rendering screen (PRD section 5).
RENDER_STAGES = ("Queued", "Voice", "Avatar", "Sharpen", "Captions", "Done")


class Project(Base, IdMixin, TimestampMixin, WorkspaceScoped):
    __tablename__ = "projects"

    name: Mapped[str] = mapped_column(String(120))


class Video(Base, IdMixin, TimestampMixin, WorkspaceScoped):
    __tablename__ = "videos"

    project_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("projects.id", ondelete="SET NULL"), index=True)
    identity_id: Mapped[str] = mapped_column(String(32), ForeignKey("identities.id", ondelete="CASCADE"), index=True)
    look_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("looks.id", ondelete="SET NULL"))
    voice_id: Mapped[str] = mapped_column(String(32), ForeignKey("voices.id", ondelete="RESTRICT"))
    created_by: Mapped[str | None] = mapped_column(String(32))
    # Idempotency-Key header on POST /videos: the same key returns the same video (per workspace).
    idempotency_key: Mapped[str | None] = mapped_column(String(120), index=True)
    # Clips and translations point back at the video they were made from.
    source_video_id: Mapped[str | None] = mapped_column(String(32), index=True)
    kind: Mapped[str] = mapped_column(String(20), default="video")  # video | clip | translation

    title: Mapped[str] = mapped_column(String(200), default="Untitled video")
    script: Mapped[str] = mapped_column(Text)
    language: Mapped[str] = mapped_column(String(20), default="en")
    engine_mode: Mapped[str] = mapped_column(String(20), default="auto")
    resolved_engine: Mapped[str | None] = mapped_column(String(40))
    motion: Mapped[dict] = mapped_column(JSON, default=dict)  # {expression, gesture, gaze}
    aspect: Mapped[str] = mapped_column(String(10), default="9:16")
    quality: Mapped[str] = mapped_column(String(10), default="720p")
    captions: Mapped[bool] = mapped_column(Boolean, default=True)
    voice_style: Mapped[str] = mapped_column(String(20), default="neutral")

    # Hard rule 4: estimate shown before Generate; hard rule 3: charge on success only.
    estimated_seconds: Mapped[int] = mapped_column(Integer, default=0)
    estimated_credits: Mapped[int] = mapped_column(Integer, default=0)
    charged_credits: Mapped[int] = mapped_column(Integer, default=0)

    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    stage: Mapped[str] = mapped_column(String(40), default="Queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    eta_seconds: Mapped[int | None] = mapped_column(Integer)
    error_message: Mapped[str | None] = mapped_column(Text)

    # Outputs
    output_key: Mapped[str | None] = mapped_column(String(500))
    output_captioned_key: Mapped[str | None] = mapped_column(String(500))
    srt_key: Mapped[str | None] = mapped_column(String(500))
    thumbnail_key: Mapped[str | None] = mapped_column(String(500))
    preview_key: Mapped[str | None] = mapped_column(String(500))
    preview_status: Mapped[str] = mapped_column(String(20), default="none")  # none | queued | rendering | ready | failed
    preview_progress: Mapped[int] = mapped_column(Integer, default=0)
    duration_s: Mapped[float | None] = mapped_column(Float)
    transcript: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(String(400))
    watermarked: Mapped[bool] = mapped_column(Boolean, default=False)
    ai_labelled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Quality gate result and the seed that produced the accepted render.
    quality_score: Mapped[float | None] = mapped_column(Float)
    quality_method: Mapped[str | None] = mapped_column(String(30))
    render_seed: Mapped[int | None] = mapped_column(Integer)
    render_attempts: Mapped[int] = mapped_column(Integer, default=0)
    engine_version: Mapped[str | None] = mapped_column(String(80))

    # Share page
    share_token: Mapped[str | None] = mapped_column(String(40), unique=True, index=True)
    share_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    share_password_hash: Mapped[str | None] = mapped_column(String(200))
    views: Mapped[int] = mapped_column(Integer, default=0)

    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    jobs: Mapped[list["Job"]] = relationship(back_populates="video", cascade="all, delete-orphan")

    @property
    def storage_prefix(self) -> str:
        return f"ws/{self.workspace_id}/videos/{self.id}"


class Job(Base, IdMixin, TimestampMixin, WorkspaceScoped):
    """
    One unit of background work. The worker claims queued jobs with an atomic
    UPDATE so two workers never run the same job. Postgres and SQLite both
    support that pattern, which is why the queue lives in the database.
    """

    __tablename__ = "jobs"

    type: Mapped[str] = mapped_column(String(30), index=True)
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    video_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("videos.id", ondelete="CASCADE"), index=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    stage: Mapped[str] = mapped_column(String(40), default="Queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    eta_seconds: Mapped[int | None] = mapped_column(Integer)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_by: Mapped[str | None] = mapped_column(String(80))
    locked_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    error: Mapped[str | None] = mapped_column(Text)
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    video: Mapped[Video | None] = relationship(back_populates="jobs")


class Reaction(Base, IdMixin, TimestampMixin, WorkspaceScoped):
    __tablename__ = "reactions"

    video_id: Mapped[str] = mapped_column(String(32), ForeignKey("videos.id", ondelete="CASCADE"), index=True)
    emoji: Mapped[str] = mapped_column(String(16))
    viewer_hash: Mapped[str | None] = mapped_column(String(64))
