"""
Speech-to-text adapter for AI Clipping and transcripts.

  ElevenLabsSTT  Scribe v1 (word timestamps, 99 languages)
  MockSTT        no key: distributes the known script over the audio length
                 (used in dev and tests; for uploaded long videos it returns
                 an empty transcript, which the clipper reports plainly)
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from app.services.runtime_config import cfg


@dataclass
class Word:
    text: str
    start: float
    end: float


@dataclass
class Transcript:
    text: str
    words: list[Word] = field(default_factory=list)
    language: str | None = None

    def sentences(self) -> list[tuple[float, float, str]]:
        """(start, end, text) per sentence, split on . ! ? and the Hindi danda."""
        out: list[tuple[float, float, str]] = []
        cur: list[Word] = []
        for w in self.words:
            cur.append(w)
            if w.text.rstrip().endswith((".", "!", "?", "।")):
                out.append((cur[0].start, cur[-1].end, " ".join(x.text for x in cur).strip()))
                cur = []
        if cur:
            out.append((cur[0].start, cur[-1].end, " ".join(x.text for x in cur).strip()))
        return out


class STTEngine(ABC):
    name = "base"

    @abstractmethod
    def available(self) -> bool: ...

    @abstractmethod
    def transcribe(self, audio_path: Path, language: str | None = None, known_text: str | None = None) -> Transcript: ...


class ElevenLabsSTT(STTEngine):
    name = "elevenlabs"

    def available(self) -> bool:
        return bool(cfg("elevenlabs_api_key"))

    def transcribe(self, audio_path: Path, language: str | None = None, known_text: str | None = None) -> Transcript:
        from app.adapters.voice.elevenlabs import raise_for_status

        data = {"model_id": "scribe_v1", "timestamps_granularity": "word", "diarize": "false", "tag_audio_events": "false"}
        if language and language != "hinglish":
            data["language_code"] = {"en": "eng", "hi": "hin"}.get(language, language)
        with httpx.Client(timeout=600) as client, open(audio_path, "rb") as f:
            r = client.post("https://api.elevenlabs.io/v1/speech-to-text", headers={"xi-api-key": cfg("elevenlabs_api_key") or ""},
                            data=data, files={"file": (audio_path.name, f, "audio/wav")})
            raise_for_status(r)
        body = r.json()
        words = [Word(w["text"], float(w.get("start", 0)), float(w.get("end", 0)))
                 for w in body.get("words", []) if w.get("type", "word") == "word"]
        return Transcript(text=body.get("text", "").strip(), words=words, language=body.get("language_code"))


class MockSTT(STTEngine):
    name = "mock"

    def available(self) -> bool:
        return True

    def transcribe(self, audio_path: Path, language: str | None = None, known_text: str | None = None) -> Transcript:
        from app.services.media import duration_seconds

        if not known_text:
            return Transcript(text="", words=[])
        dur = max(duration_seconds(audio_path), 0.5)
        tokens = known_text.split()
        per = dur / max(len(tokens), 1)
        words = [Word(t, round(i * per, 3), round((i + 1) * per, 3)) for i, t in enumerate(tokens)]
        return Transcript(text=known_text, words=words, language=language)


def get_stt() -> STTEngine:
    el = ElevenLabsSTT()
    return el if el.available() else MockSTT()
