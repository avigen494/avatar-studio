"""
ffmpeg / ffprobe helpers shared by the worker and the verification job.

Everything shells out to the ffmpeg binary named in settings. Paths are
passed as plain arguments (never through a shell string) so spaces in
Windows paths are safe.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from app.config import settings


class MediaError(RuntimeError):
    pass


ASSETS = Path(__file__).resolve().parents[1] / "assets"
_FONT_CANDIDATES = [
    "C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/segoeui.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
]


def find_font() -> str | None:
    """A TrueType font for drawtext. Returned with the colon escaped for ffmpeg filters."""
    for cand in _FONT_CANDIDATES:
        if Path(cand).exists():
            return cand.replace(":", r"\:")
    return None


def _env() -> dict:
    """Give ffmpeg a fontconfig file so libass/drawtext do not crash on Windows."""
    env = dict(os.environ)
    env.setdefault("FONTCONFIG_FILE", str(ASSETS / "fonts.conf"))
    cache = Path(settings.work_dir) / "fontconfig-cache"
    cache.mkdir(parents=True, exist_ok=True)
    env.setdefault("FONTCONFIG_PATH", str(ASSETS))
    env.setdefault("XDG_CACHE_HOME", str(cache))
    return env


def run(cmd: list[str], cwd: Path | None = None) -> str:
    proc = subprocess.run(cmd, cwd=str(cwd) if cwd else None, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", env=_env())
    if proc.returncode != 0:
        tail = (proc.stderr or "")[-1500:]
        raise MediaError(f"{cmd[0]} failed ({proc.returncode}): {tail}")
    return proc.stdout


def probe(path: Path) -> dict:
    out = run([settings.ffprobe_bin, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)])
    return json.loads(out or "{}")


def duration_seconds(path: Path) -> float:
    """Container duration when present; otherwise decode the file to measure it (browser WebM)."""
    info = probe(path)
    fmt = info.get("format", {})
    try:
        dur = float(fmt.get("duration") or 0.0)
    except (TypeError, ValueError):
        dur = 0.0
    if dur > 0:
        return dur
    return _decoded_duration(path)


def _decoded_duration(path: Path) -> float:
    import re

    proc = subprocess.run([settings.ffmpeg_bin, "-v", "info", "-i", str(path), "-f", "null", "-"],
                          capture_output=True, text=True, encoding="utf-8", errors="replace", env=_env())
    times = re.findall(r"time=(\d+):(\d+):(\d+(?:\.\d+)?)", proc.stderr or "")
    if not times:
        return 0.0
    h, m, s = times[-1]
    return int(h) * 3600 + int(m) * 60 + float(s)


def has_streams(path: Path) -> tuple[bool, bool]:
    info = probe(path)
    kinds = {s.get("codec_type") for s in info.get("streams", [])}
    return "video" in kinds, "audio" in kinds


def dimensions(path: Path) -> tuple[int, int]:
    info = probe(path)
    for s in info.get("streams", []):
        if s.get("codec_type") == "video":
            return int(s.get("width") or 0), int(s.get("height") or 0)
    return 0, 0


def aspect_size(aspect: str, quality: str) -> tuple[int, int]:
    """Output size for an aspect + quality pair. Heights per PRD: 720p/1080p/4K."""
    height = {"720p": 720, "1080p": 1080, "4k": 2160}.get(quality, 720)
    if aspect == "9:16":
        return (height * 9 // 16) // 2 * 2, height
    if aspect == "1:1":
        return height, height
    return height * 16 // 9 // 2 * 2, height


def thumbnail(src: Path, dst: Path, at_seconds: float = 1.0) -> None:
    run([settings.ffmpeg_bin, "-y", "-v", "error", "-ss", f"{at_seconds:.2f}", "-i", str(src),
         "-frames:v", "1", "-vf", "scale=-2:480", str(dst)])


def silence_wav(dst: Path, seconds: float, sample_rate: int = 24000) -> None:
    run([settings.ffmpeg_bin, "-y", "-v", "error", "-f", "lavfi", "-i",
         f"anullsrc=r={sample_rate}:cl=mono", "-t", f"{max(seconds, 0.5):.2f}", str(dst)])


def to_wav(src: Path, dst: Path) -> None:
    run([settings.ffmpeg_bin, "-y", "-v", "error", "-i", str(src), "-ac", "1", "-ar", "24000", str(dst)])
