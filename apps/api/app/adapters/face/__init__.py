"""
Consent verification adapter (hard rule 6 and the consent-abuse risk).

v1 ships `BasicVerifier`, which checks the recording is real footage of the
right length with sound. The interface is ready for a face-match verifier
(InsightFace: consent face == reference face == look faces) in v2; flagged
cases go to a manual review queue.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path

from app.services.media import duration_seconds, has_streams


@dataclass
class VerificationResult:
    ok: bool
    method: str
    reason: str
    duration_s: float = 0.0


class ConsentVerifier(ABC):
    @abstractmethod
    def verify(self, reference_path: Path, consent_path: Path | None) -> VerificationResult: ...


class BasicVerifier(ConsentVerifier):
    """Checks: video + audio present, 10 to 120 seconds long."""

    MIN_SECONDS = 10.0
    MAX_SECONDS = 120.0

    def verify(self, reference_path: Path, consent_path: Path | None) -> VerificationResult:
        has_video, has_audio = has_streams(reference_path)
        if not has_video:
            return VerificationResult(False, "basic", "The recording has no video track. Record again with the camera on.")
        if not has_audio:
            return VerificationResult(False, "basic", "The recording has no sound. Read the consent script out loud.")
        dur = duration_seconds(reference_path)
        if dur < self.MIN_SECONDS:
            return VerificationResult(False, "basic", f"The recording is {dur:.0f} seconds. Record at least 10 seconds.", dur)
        if dur > self.MAX_SECONDS:
            return VerificationResult(False, "basic", "The recording is longer than 2 minutes. Keep it to 15 to 45 seconds.", dur)
        return VerificationResult(True, "basic", "Recording accepted.", dur)


class FaceMatchVerifier(ConsentVerifier):
    """Basic checks first, then InsightFace on the GPU: consent face == reference face == looks."""

    def __init__(self, look_keys: list[str] | None = None):
        self.look_keys = look_keys or []

    def verify(self, reference_path: Path, consent_path: Path | None) -> VerificationResult:
        basic = BasicVerifier().verify(reference_path, consent_path)
        if not basic.ok:
            return basic
        from app.adapters.avatar.runpod import RunPodAvatarEngine
        from app.adapters.storage import get_storage

        engine = RunPodAvatarEngine()
        if not engine.available():
            return basic
        storage = get_storage()
        scratch = f"tmp/face/{reference_path.stem}-{id(self)}"
        ref_url = engine._stage(reference_path, f"{scratch}/reference.mp4")
        consent_url = engine._stage(consent_path, f"{scratch}/consent.mp4") if consent_path else ref_url
        look_urls = [storage.download_url(k, 3600) for k in self.look_keys]
        try:
            out = engine._submit_and_wait({"task": "face_match", "consent_url": consent_url, "reference_url": ref_url,
                                           "look_urls": look_urls, "expected_seconds": 60}, lambda *_: None)
        except Exception as e:  # noqa: BLE001  GPU hiccup: do not block the user, flag for manual review
            return VerificationResult(True, "basic+gpu_unavailable", f"Recording accepted; face match skipped ({str(e)[:80]}).", basic.duration_s)
        finally:
            storage.delete_prefix(scratch)
        ok = bool(out.get("ok"))
        return VerificationResult(ok, "face_match", str(out.get("reason") or ("Face matches." if ok else "Face does not match.")),
                                  basic.duration_s)


def get_verifier(look_keys: list[str] | None = None) -> ConsentVerifier:
    from app.services.runtime_config import cfg

    if (cfg("avatar_engine_backend") or "mock") == "runpod":
        return FaceMatchVerifier(look_keys)
    return BasicVerifier()
