"""
Voice engine interface (hard rule 10: engines are adapters behind one
interface). A voice engine does three things: list library voices, clone a
voice from a sample, and synthesise speech to a file.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class LibraryVoice:
    external_id: str
    name: str
    language: str = "en"
    gender: str | None = None
    style: str | None = None
    supports_delivery_tags: bool = False


@dataclass
class SynthesisRequest:
    text: str
    external_voice_id: str | None
    language: str = "en"
    style: str = "neutral"
    api_key: str | None = None  # BYO key overrides the platform key
    extra: dict = field(default_factory=dict)


@dataclass
class SynthesisResult:
    path: Path
    duration_s: float
    engine: str
    content_type: str = "audio/wav"


class VoiceEngine(ABC):
    name: str = "base"
    supports_delivery_tags: bool = False

    @abstractmethod
    def available(self) -> bool: ...

    @abstractmethod
    def list_library(self) -> list[LibraryVoice]: ...

    @abstractmethod
    def clone(self, name: str, sample_path: Path, api_key: str | None = None) -> str:
        """Create a voice from a sample. Returns the engine's voice id."""

    @abstractmethod
    def synthesize(self, req: SynthesisRequest, out_dir: Path) -> SynthesisResult: ...
