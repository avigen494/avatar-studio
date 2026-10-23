"""
Render quality gate (consistency).

After the avatar engine returns a video and before anything is published or
charged, we check that the face in the output is the face in the reference.

  GpuFaceChecker    InsightFace on the RunPod image (task "quality_check"):
                    cosine similarity between sampled output frames and the
                    reference clip or photo. Real identity check.
  LocalFrameChecker No GPU: a cheap frame-similarity proxy (greyscale
                    correlation on 32x32 thumbnails via ffmpeg). It cannot
                    judge identity, but it catches black frames, wrong content
                    and broken encodes, and it lets the gate run in dev/tests.

The pipeline retries once with a new seed when the gate fails, then fails the
render with a plain message and charges nothing.
"""
from __future__ import annotations

import logging
import math
import subprocess
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path

from app.config import settings
from app.services.runtime_config import cfg

log = logging.getLogger("quality")

DEFAULT_FACE_THRESHOLD = 0.45     # InsightFace cosine similarity; same person is typically > 0.5
DEFAULT_FRAME_THRESHOLD = 0.25    # correlation proxy; unrelated images sit near 0


@dataclass
class QualityResult:
    ok: bool
    score: float | None
    method: str
    threshold: float
    detail: str = ""


class QualityChecker(ABC):
    name = "base"

    @abstractmethod
    def available(self) -> bool: ...

    @abstractmethod
    def check(self, output_video: Path, reference: Path, work: Path) -> QualityResult: ...


# --- local proxy ---------------------------------------------------------------------
def _thumb_vector(path: Path, work: Path, at: float | None, size: int = 32) -> list[float]:
    """Greyscale 32x32 pixels of one frame, as floats. Works for images and videos."""
    out = work / f"q_{path.stem}_{int((at or 0) * 100)}.gray"
    cmd = [settings.ffmpeg_bin, "-y", "-v", "error"]
    if at is not None:
        cmd += ["-ss", f"{at:.2f}"]
    cmd += ["-i", str(path), "-frames:v", "1", "-vf", f"scale={size}:{size}:force_original_aspect_ratio=increase,crop={size}:{size},format=gray",
            "-f", "rawvideo", str(out)]
    subprocess.run(cmd, check=True, capture_output=True)
    data = out.read_bytes()
    return [b / 255.0 for b in data[: size * size]]


def _correlation(a: list[float], b: list[float]) -> float:
    n = min(len(a), len(b))
    if n == 0:
        return 0.0
    ma, mb = sum(a[:n]) / n, sum(b[:n]) / n
    cov = sum((a[i] - ma) * (b[i] - mb) for i in range(n))
    va = math.sqrt(sum((a[i] - ma) ** 2 for i in range(n))) or 1e-9
    vb = math.sqrt(sum((b[i] - mb) ** 2 for i in range(n))) or 1e-9
    return max(-1.0, min(1.0, cov / (va * vb)))


class LocalFrameChecker(QualityChecker):
    name = "frame_similarity"

    def available(self) -> bool:
        return True

    def check(self, output_video: Path, reference: Path, work: Path) -> QualityResult:
        from app.services.media import duration_seconds

        threshold = float(cfg("quality_frame_threshold") or DEFAULT_FRAME_THRESHOLD)
        try:
            is_video = reference.suffix.lower() in (".mp4", ".mov", ".webm", ".mkv")
            ref_vec = _thumb_vector(reference, work, 1.0 if is_video else None)
            if max(ref_vec) - min(ref_vec) < 0.05:
                # A flat reference (plain colour, test image) has nothing to compare against.
                return QualityResult(True, None, self.name, threshold, "reference has no detail; proxy check skipped")
            dur = max(duration_seconds(output_video), 0.5)
            points = [dur * f for f in (0.15, 0.5, 0.85)]
            outs = [_thumb_vector(output_video, work, t) for t in points]
            flat = all(max(v) - min(v) < 0.02 for v in outs)  # black or frozen-colour frames
            scores = [_correlation(v, ref_vec) for v in outs]
            score = round(min(scores), 3)
            ok = score >= threshold and not flat
            detail = "flat or black frames" if flat else f"min frame correlation {score:.2f} over 3 samples"
            return QualityResult(ok, score, self.name, threshold, detail)
        except Exception as e:  # noqa: BLE001  the proxy must never block a render by crashing
            log.warning("local quality check skipped: %s", e)
            return QualityResult(True, None, self.name, threshold, f"skipped ({type(e).__name__})")


class GpuFaceChecker(QualityChecker):
    name = "face_match"

    def available(self) -> bool:
        from app.adapters.avatar.runpod import RunPodAvatarEngine

        return RunPodAvatarEngine().available()

    def check(self, output_video: Path, reference: Path, work: Path) -> QualityResult:
        from app.adapters.avatar.runpod import RunPodAvatarEngine
        from app.adapters.storage import get_storage

        threshold = float(cfg("quality_face_threshold") or DEFAULT_FACE_THRESHOLD)
        engine = RunPodAvatarEngine()
        storage = get_storage()
        scratch = f"tmp/quality/{output_video.stem}-{id(self)}"
        try:
            out_url = engine._stage(output_video, f"{scratch}/output.mp4")
            ref_url = engine._stage(reference, f"{scratch}/reference{reference.suffix}")
            result = engine._submit_and_wait({"task": "quality_check", "output_url": out_url, "reference_url": ref_url,
                                              "threshold": threshold, "expected_seconds": 45}, lambda *_: None)
        except Exception as e:  # noqa: BLE001  fall back to the local proxy rather than block
            log.warning("GPU quality check unavailable (%s); using the local proxy", e)
            return LocalFrameChecker().check(output_video, reference, work)
        finally:
            storage.delete_prefix(scratch)
        score = result.get("similarity")
        ok = bool(result.get("ok"))
        return QualityResult(ok, round(float(score), 3) if score is not None else None, self.name, threshold,
                             str(result.get("reason") or ""))


def get_quality_checker() -> QualityChecker:
    gpu = GpuFaceChecker()
    return gpu if gpu.available() else LocalFrameChecker()


def gate_enabled() -> bool:
    return (cfg("quality_gate") or "on").lower() != "off"


def max_retries() -> int:
    try:
        return max(0, min(3, int(cfg("quality_retries") or 1)))
    except ValueError:
        return 1
