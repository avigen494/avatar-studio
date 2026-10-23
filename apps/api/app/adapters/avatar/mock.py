"""
Mock avatar engine - ffmpeg only.

Photo mode: the look image with a slow push-in, muxed with the speech audio.
Real-footage / mouth-only: the user's reference clip looped under the audio.
It produces a real MP4 with the right size, length and audio so every other
step (captions, watermark, share page, credits) can be exercised locally.
"""
from __future__ import annotations

from pathlib import Path

from app.adapters.avatar.base import AvatarEngine, ProgressFn, RenderRequest, RenderResult
from app.config import settings
from app.services.media import run


class MockAvatarEngine(AvatarEngine):
    name = "mock"

    def available(self) -> bool:
        return True

    def render(self, req: RenderRequest, out_dir: Path, progress: ProgressFn) -> RenderResult:
        out = out_dir / "raw.mp4"
        length = req.audio_duration_s
        if req.max_seconds:
            length = min(length, req.max_seconds)
        w, h = req.width, req.height
        progress(5, None)

        if req.reference_path and req.engine in ("infinitetalk_v2v", "latentsync"):
            source = ["-stream_loop", "-1", "-i", str(req.reference_path)]
            vf = f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},fps={req.fps}"
        elif req.look_path:
            source = ["-loop", "1", "-framerate", str(req.fps), "-i", str(req.look_path)]
            frames = max(int(length * req.fps), 1)
            # A gentle 4% push-in so a still photo does not look frozen.
            vf = (
                f"scale={w * 2}:{h * 2}:force_original_aspect_ratio=increase,crop={w * 2}:{h * 2},"
                f"zoompan=z='min(zoom+0.00025,1.04)':d={frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={w}x{h}:fps={req.fps},"
                f"format=yuv420p"
            )
        else:
            source = ["-f", "lavfi", "-i", f"color=c=0x1f2937:s={w}x{h}:r={req.fps}"]
            vf = "format=yuv420p"

        cmd = [settings.ffmpeg_bin, "-y", "-v", "error", *source, "-i", str(req.audio_path),
               "-t", f"{length:.2f}", "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
               "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", str(out)]
        run(cmd)
        progress(100, None)
        return RenderResult(video_path=out, engine=self.name)

    def train_style(self, footage: list[Path], out_dir: Path, progress: ProgressFn, extra: dict | None = None) -> Path:
        """No GPU here: write a small placeholder file so the rest of the flow can be exercised."""
        import json

        out = out_dir / "style.safetensors"
        meta = {"mock": True, "clips": [p.name for p in footage]}
        out.write_bytes(json.dumps(meta).encode())
        progress(100, None)
        return out

    def finish(self, video_path: Path, out_dir: Path, width: int, height: int, fps: int, progress: ProgressFn) -> Path:
        out = out_dir / "finished.mp4"
        run([settings.ffmpeg_bin, "-y", "-v", "error", "-i", str(video_path),
             "-vf", f"scale={width}:{height}:flags=lanczos,unsharp=5:5:0.6:5:5:0.0,fps={fps}",
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
             "-c:a", "copy", "-movflags", "+faststart", str(out)])
        progress(100, None)
        return out
