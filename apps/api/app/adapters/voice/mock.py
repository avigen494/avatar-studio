"""
Mock voice: silent audio of the right length. Used in tests and when no
engine is configured, so the whole render chain can still run end to end.
"""
from __future__ import annotations

from pathlib import Path

from app.adapters.voice.base import LibraryVoice, SynthesisRequest, SynthesisResult, VoiceEngine
from app.services.estimate import estimate_seconds
from app.services.media import silence_wav


class MockVoiceEngine(VoiceEngine):
    name = "mock"

    def available(self) -> bool:
        return True

    def list_library(self) -> list[LibraryVoice]:
        return [
            LibraryVoice("mock-en-f", "Sample voice (English)", "en", "female", "warm"),
            LibraryVoice("mock-hi-m", "Sample voice (Hindi)", "hi", "male", "neutral"),
        ]

    def clone(self, name: str, sample_path: Path, api_key: str | None = None) -> str:
        return f"mock-clone-{abs(hash(name)) % 10_000}"

    def synthesize(self, req: SynthesisRequest, out_dir: Path) -> SynthesisResult:
        seconds = estimate_seconds(req.text, req.language)
        out = out_dir / "voice.wav"
        silence_wav(out, seconds)
        return SynthesisResult(path=out, duration_s=float(seconds), engine=self.name)
