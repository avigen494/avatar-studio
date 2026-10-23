"""ElevenLabs adapter: library, instant clone, text-to-speech. BYO key supported."""
from __future__ import annotations

from pathlib import Path

import httpx

from app.adapters.voice.base import LibraryVoice, SynthesisRequest, SynthesisResult, VoiceEngine
from app.config import settings
from app.services.runtime_config import cfg
from app.services.media import duration_seconds, to_wav

BASE = "https://api.elevenlabs.io/v1"


class ElevenLabsError(RuntimeError):
    """ElevenLabs' own message, in plain words, instead of a bare HTTP status."""


def raise_for_status(r: httpx.Response) -> None:
    if r.status_code < 400:
        return
    message = None
    try:
        detail = r.json().get("detail")
        if isinstance(detail, dict):
            message = detail.get("message") or detail.get("status")
        elif isinstance(detail, str):
            message = detail
    except ValueError:
        pass
    hints = {
        "payment_issue": "ElevenLabs says your subscription has a failed or incomplete payment. Settle the latest invoice on elevenlabs.io, then try again.",
        "quota_exceeded": "Your ElevenLabs character quota for this cycle is used up.",
        "missing_permissions": "This ElevenLabs key is missing the text-to-speech permission. Create a key with full access.",
        "invalid_api_key": "ElevenLabs rejected the key.",
        "detected_unusual_activity": "ElevenLabs blocked this free account for unusual activity. A paid plan or a different network fixes it.",
    }
    code = None
    try:
        code = (r.json().get("detail") or {}).get("status")
    except Exception:  # noqa: BLE001
        code = None
    text = hints.get(code) or message or f"ElevenLabs returned HTTP {r.status_code}."
    raise ElevenLabsError(text)


class ElevenLabsVoiceEngine(VoiceEngine):
    name = "elevenlabs"
    supports_delivery_tags = True  # v3 models understand [pause] style tags

    def _key(self, override: str | None = None) -> str:
        key = override or cfg("elevenlabs_api_key")
        if not key:
            raise RuntimeError("ElevenLabs is not configured. Add ELEVENLABS_API_KEY or import your own key.")
        return key

    def available(self) -> bool:
        return bool(cfg("elevenlabs_api_key"))

    def list_library(self, api_key: str | None = None) -> list[LibraryVoice]:
        if not (api_key or cfg("elevenlabs_api_key")):
            return []
        with httpx.Client(timeout=30) as client:
            r = client.get(f"{BASE}/voices", headers={"xi-api-key": self._key(api_key)})
            raise_for_status(r)
        voices = []
        for v in r.json().get("voices", []):
            labels = v.get("labels") or {}
            lang = labels.get("language", "en")
            voices.append(LibraryVoice(
                external_id=v["voice_id"], name=v.get("name", "Voice"),
                language="hi" if str(lang).startswith("hi") else "en",
                gender=labels.get("gender"), style=labels.get("use_case") or labels.get("description"),
                supports_delivery_tags=True,
            ))
        return voices

    def clone(self, name: str, sample_path: Path, api_key: str | None = None) -> str:
        with httpx.Client(timeout=120) as client, open(sample_path, "rb") as f:
            r = client.post(
                f"{BASE}/voices/add",
                headers={"xi-api-key": self._key(api_key)},
                data={"name": name, "description": "Avatar Studio clone"},
                files={"files": (sample_path.name, f, "audio/mpeg")},
            )
            raise_for_status(r)
        return r.json()["voice_id"]

    def synthesize(self, req: SynthesisRequest, out_dir: Path) -> SynthesisResult:
        model_id = req.extra.get("model_id") or settings.elevenlabs_model_id
        payload = {
            "text": req.text,
            "model_id": model_id,
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.8, "style": 0.2, "use_speaker_boost": True},
        }
        raw = out_dir / "voice.mp3"
        with httpx.Client(timeout=300) as client:
            r = client.post(
                f"{BASE}/text-to-speech/{req.external_voice_id}",
                headers={"xi-api-key": self._key(req.api_key), "accept": "audio/mpeg"},
                params={"output_format": "mp3_44100_128"},
                json=payload,
            )
            raise_for_status(r)
            raw.write_bytes(r.content)
        out = out_dir / "voice.wav"
        to_wav(raw, out)
        return SynthesisResult(path=out, duration_s=duration_seconds(out), engine=self.name)
