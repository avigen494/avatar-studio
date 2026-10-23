"""Voices: cloned, designed, imported with the user's own key, or library."""
from __future__ import annotations

from sqlalchemy import Boolean, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import IdMixin, TimestampMixin, WorkspaceScoped

VOICE_ENGINES = ("elevenlabs", "sarvam", "sapi", "mock")
VOICE_SOURCES = ("clone", "library", "byo_key", "design")


class Voice(Base, IdMixin, TimestampMixin, WorkspaceScoped):
    __tablename__ = "voices"

    name: Mapped[str] = mapped_column(String(120))
    engine: Mapped[str] = mapped_column(String(20), default="mock")
    source: Mapped[str] = mapped_column(String(20), default="library")
    # The engine's own id for this voice (ElevenLabs voice_id, Sarvam speaker, SAPI name).
    external_voice_id: Mapped[str | None] = mapped_column(String(200))
    language: Mapped[str] = mapped_column(String(20), default="en")  # en | hi | hinglish
    gender: Mapped[str | None] = mapped_column(String(20))
    style: Mapped[str | None] = mapped_column(String(40))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="ready")  # ready | cloning | failed
    sample_key: Mapped[str | None] = mapped_column(String(500))
    # BYO ElevenLabs key, encrypted at rest with the app secret (hard rule 2 / PRD 7).
    byo_key_encrypted: Mapped[str | None] = mapped_column(Text)
    supports_delivery_tags: Mapped[bool] = mapped_column(Boolean, default=False)
