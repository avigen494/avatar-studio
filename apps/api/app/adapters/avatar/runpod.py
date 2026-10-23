"""
RunPod serverless adapter.

The GPU side is apps/gpu/handler.py. The contract is one JSON job:

  input:  { task: "render" | "finish", engine, audio_url, image_url?, video_url?,
            prompt, width, height, fps, max_seconds?, steps, upload_url }
  output: { video_url, gpu_seconds }

Inputs are given to the GPU as short-lived signed URLs and the GPU uploads
its result straight to storage with a presigned PUT, so no user media ever
passes through the API box or stays on the GPU (PRD section 7).
"""
from __future__ import annotations

import time
from pathlib import Path

import httpx

from app.adapters.avatar.base import AvatarEngine, ProgressFn, RenderRequest, RenderResult
from app.adapters.storage import get_storage
from app.config import settings
from app.services.runtime_config import cfg


class RunPodError(RuntimeError):
    pass


class RunPodAvatarEngine(AvatarEngine):
    name = "runpod"

    @property
    def base(self) -> str:
        return f"https://api.runpod.ai/v2/{cfg('runpod_endpoint_id')}"

    @property
    def headers(self) -> dict:
        return {"Authorization": f"Bearer {cfg('runpod_api_key')}", "Content-Type": "application/json"}

    def available(self) -> bool:
        return bool(cfg("runpod_api_key") and cfg("runpod_endpoint_id"))

    # -- helpers -----------------------------------------------------------
    def _stage(self, local: Path, key: str) -> str:
        storage = get_storage()
        storage.put_file(key, local)
        return storage.download_url(key, expires_in=3600)

    def _submit_and_wait(self, payload: dict, progress: ProgressFn) -> dict:
        with httpx.Client(timeout=60) as client:
            r = client.post(f"{self.base}/run", headers=self.headers, json={"input": payload})
            r.raise_for_status()
            job_id = r.json()["id"]
            started = time.time()
            while True:
                time.sleep(settings.runpod_poll_seconds)
                s = client.get(f"{self.base}/status/{job_id}", headers=self.headers)
                s.raise_for_status()
                data = s.json()
                status = data.get("status")
                if status == "COMPLETED":
                    return data.get("output") or {}
                if status in ("FAILED", "CANCELLED", "TIMED_OUT"):
                    raise RunPodError(data.get("error") or f"GPU job {status.lower()}")
                elapsed = time.time() - started
                if elapsed > settings.runpod_timeout_seconds:
                    client.post(f"{self.base}/cancel/{job_id}", headers=self.headers)
                    raise RunPodError("GPU job took too long and was stopped. You were not charged.")
                pct = min(95, int(elapsed / max(payload.get("expected_seconds", 300), 30) * 100))
                progress(pct, None)

    def render(self, req: RenderRequest, out_dir: Path, progress: ProgressFn) -> RenderResult:
        storage = get_storage()
        scratch = req.extra["scratch_prefix"]  # ws/<ws>/videos/<id>/scratch
        audio_url = self._stage(req.audio_path, f"{scratch}/voice.wav")
        payload = {
            "task": "render",
            "engine": req.engine,
            "audio_url": audio_url,
            "prompt": req.motion_prompt,
            "width": req.width,
            "height": req.height,
            "fps": req.fps,
            "steps": req.quality_steps,
            "max_seconds": req.max_seconds,
            "expected_seconds": int(req.audio_duration_s * 12),
            "style_url": None,
            "seed": req.extra.get("seed"),
        }
        if req.look_path:
            payload["image_url"] = self._stage(req.look_path, f"{scratch}/look{req.look_path.suffix}")
        if req.reference_path:
            payload["video_url"] = self._stage(req.reference_path, f"{scratch}/reference.mp4")
        if req.extra.get("style_key"):
            payload["style_url"] = storage.download_url(req.extra["style_key"], expires_in=3600)
        out_key = f"{scratch}/raw.mp4"
        payload["upload_url"] = storage.presign_upload(out_key, "video/mp4").url

        output = self._submit_and_wait(payload, progress)
        local = out_dir / "raw.mp4"
        storage.get_to_file(out_key, local)
        res = RenderResult(video_path=local, engine=req.engine, gpu_seconds=float(output.get("gpu_seconds") or 0))
        res.engine_version = output.get("image_tag")
        return res

    def train_style(self, footage: list[Path], out_dir: Path, progress: ProgressFn, extra: dict | None = None) -> Path:
        storage = get_storage()
        scratch = (extra or {}).get("scratch_prefix") or f"tmp/train/{int(time.time() * 1000)}"
        urls = [self._stage(p, f"{scratch}/clip_{i}{p.suffix}") for i, p in enumerate(footage)]
        out_key = f"{scratch}/style.safetensors"
        payload = {
            "task": "train_style", "footage_urls": urls, "steps": 1500, "rank": 32,
            "upload_url": storage.presign_upload(out_key, "application/octet-stream").url,
            "expected_seconds": 5400,
        }
        self._submit_and_wait(payload, progress)
        local = out_dir / "style.safetensors"
        storage.get_to_file(out_key, local)
        return local

    def finish(self, video_path: Path, out_dir: Path, width: int, height: int, fps: int, progress: ProgressFn) -> Path:
        storage = get_storage()
        scratch = f"tmp/finish/{int(time.time() * 1000)}"
        in_url = self._stage(video_path, f"{scratch}/in.mp4")
        out_key = f"{scratch}/out.mp4"
        payload = {
            "task": "finish", "video_url": in_url, "width": width, "height": height, "fps": fps,
            "upload_url": storage.presign_upload(out_key, "video/mp4").url, "expected_seconds": 240,
        }
        self._submit_and_wait(payload, progress)
        local = out_dir / "finished.mp4"
        storage.get_to_file(out_key, local)
        storage.delete_prefix(scratch)
        return local
