"""Voice engine registry. Pick by name; 'auto' picks the best available."""
from __future__ import annotations

from app.adapters.voice.base import LibraryVoice, SynthesisRequest, SynthesisResult, VoiceEngine
from app.adapters.voice.elevenlabs import ElevenLabsVoiceEngine
from app.adapters.voice.mock import MockVoiceEngine
from app.adapters.voice.sapi import SapiVoiceEngine
from app.adapters.voice.sarvam import SarvamVoiceEngine
from app.config import settings
from app.services.runtime_config import cfg

_ENGINES: dict[str, VoiceEngine] = {
    "elevenlabs": ElevenLabsVoiceEngine(),
    "sarvam": SarvamVoiceEngine(),
    "sapi": SapiVoiceEngine(),
    "mock": MockVoiceEngine(),
}


def get_voice_engine(name: str) -> VoiceEngine:
    if name in _ENGINES:
        return _ENGINES[name]
    raise KeyError(f"Unknown voice engine: {name}")


def default_voice_engine_name() -> str:
    pref = cfg("voice_engine_default") or settings.voice_engine_default
    if pref != "auto":
        return pref
    for name in ("elevenlabs", "sarvam", "sapi", "mock"):
        if _ENGINES[name].available():
            return name
    return "mock"


def all_library_voices() -> list[tuple[str, LibraryVoice]]:
    out: list[tuple[str, LibraryVoice]] = []
    for name in ("elevenlabs", "sarvam", "sapi", "mock"):
        eng = _ENGINES[name]
        if not eng.available():
            continue
        if name == "mock" and len(out) > 0:
            continue  # only show mock voices when nothing else exists
        try:
            out.extend((name, v) for v in eng.list_library())
        except Exception:
            continue
    return out


__all__ = [
    "VoiceEngine", "LibraryVoice", "SynthesisRequest", "SynthesisResult",
    "get_voice_engine", "default_voice_engine_name", "all_library_voices",
]
