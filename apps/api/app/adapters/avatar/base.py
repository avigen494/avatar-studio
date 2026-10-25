"""
Avatar engine interface.

An avatar engine turns (a look or reference clip) + (speech audio) + (a
motion prompt) into a raw talking-head video. The worker never knows which
engine it is talking to. Two backends in v1:

  MockAvatarEngine   - ffmpeg only; used for local dev and tests
  RunPodAvatarEngine - calls the GPU handler in apps/gpu on RunPod serverless
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

ProgressFn = Callable[[int, str | None], None]  # (percent 0-100, eta text or None)


@dataclass
class RenderRequest:
    engine: str                  # wan_s2v | infinitetalk | infinitetalk_v2v | latentsync | mock
    audio_path: Path
    audio_duration_s: float
    look_path: Path | None       # still image for photo mode
    reference_path: Path | None  # real footage for real_footage / mouth_only
    motion_prompt: str
    width: int
    height: int
    fps: int = 25
    max_seconds: float | None = None   # previews stop at 15 s
    quality_steps: int = 20
    extra: dict = field(default_factory=dict)


@dataclass
class RenderResult:
    video_path: Path
    engine: str
    gpu_seconds: float = 0.0
    cost_inr: float = 0.0
    engine_version: str | None = None  # image tag / model pin the GPU reported
    profile: dict | None = None  # per-stage timings the GPU worker reported (load, steps, save)


class AvatarEngine(ABC):
    name: str = "base"

    @abstractmethod
    def available(self) -> bool: ...

    @abstractmethod
    def render(self, req: RenderRequest, out_dir: Path, progress: ProgressFn) -> RenderResult: ...

    @abstractmethod
    def finish(self, video_path: Path, out_dir: Path, width: int, height: int, fps: int, progress: ProgressFn) -> Path:
        """Super-resolution / face restore / frame interpolation (step 6)."""

    @abstractmethod
    def train_style(self, footage: list[Path], out_dir: Path, progress: ProgressFn, extra: dict | None = None) -> Path:
        """Train the per-avatar style file (LoRA) from 2-10 minutes of footage. Returns the .safetensors path."""
