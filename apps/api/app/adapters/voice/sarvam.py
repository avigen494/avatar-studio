"""Sarvam AI adapter for Hindi and Hinglish speech (Bulbul model)."""
from __future__ import annotations

import base64
from pathlib import Path

import httpx

from app.adapters.voice.base import LibraryVoice, SynthesisRequest, SynthesisResult, VoiceEngine
from app.config import settings
from app.services.runtime_config import cfg
from app.services.media import duration_seconds, to_wav

BASE = "https://api.sarvam.ai"
SPEAKERS = [
    ("anushka", "Anushka", "female"), ("abhilash", "Abhilash", "male"), ("manisha", "Manisha", "female"),
    ("vidya", "Vidya", "female"), ("arya", "Arya", "female"), ("karun", "Karun", "male"), ("hitesh", "Hitesh", "male"),
]
LANG_CODES = {"hi": "hi-IN", "hinglish": "hi-IN", "en": "en-IN"}


class SarvamVoiceEngine(VoiceEngine):
    name = "sarvam"

    def available(self) -> bool:
        return bool(cfg("sarvam_api_key"))

    def list_library(self) -> list[LibraryVoice]:
        if not self.available():
            return []
        out = []
        for sid, name, gender in SPEAKERS:
            out.append(LibraryVoice(sid, f"{name} (Hindi)", "hi", gender, "natural"))
            out.append(LibraryVoice(f"{sid}:hinglish", f"{name} (Hinglish)", "hinglish", gender, "natural"))
        return out

    def clone(self, name: str, sample_path: Path, api_key: str | None = None) -> str:
        raise NotImplementedError("Sarvam does not offer voice cloning here. Use ElevenLabs for clones.")

    def synthesize(self, req: SynthesisRequest, out_dir: Path) -> SynthesisResult:
        speaker = (req.external_voice_id or "anushka").split(":")[0]
        # Sarvam accepts up to ~500 characters per call; split on sentences and join.
        chunks = _split(req.text, 450)
        parts: list[Path] = []
        with httpx.Client(timeout=120) as client:
            for i, chunk in enumerate(chunks):
                r = client.post(
                    f"{BASE}/text-to-speech",
                    headers={"api-subscription-key": req.api_key or cfg("sarvam_api_key") or ""},
                    json={
                        "inputs": [chunk],
                        "target_language_code": LANG_CODES.get(req.language, "hi-IN"),
                        "speaker": speaker,
                        "model": "bulbul:v2",
                        "pace": 1.0,
                        "speech_sample_rate": 22050,
                        "enable_preprocessing": True,
                    },
                )
                r.raise_for_status()
                audio_b64 = r.json()["audios"][0]
                p = out_dir / f"sarvam_{i}.wav"
                p.write_bytes(base64.b64decode(audio_b64))
                parts.append(p)
        out = out_dir / "voice.wav"
        if len(parts) == 1:
            to_wav(parts[0], out)
        else:
            from app.services.media import run

            lst = out_dir / "sarvam_concat.txt"
            lst.write_text("\n".join(f"file '{p.name}'" for p in parts), encoding="utf-8")
            run([settings.ffmpeg_bin, "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
                 "-ac", "1", "-ar", "24000", str(out)], cwd=out_dir)
        return SynthesisResult(path=out, duration_s=duration_seconds(out), engine=self.name)


def _split(text: str, limit: int) -> list[str]:
    import re

    sentences = re.split(r"(?<=[.!?।])\s+", text.strip())
    chunks, cur = [], ""
    for s in sentences:
        if len(cur) + len(s) + 1 > limit and cur:
            chunks.append(cur.strip())
            cur = s
        else:
            cur = f"{cur} {s}".strip()
    if cur:
        chunks.append(cur)
    return chunks or [text]
