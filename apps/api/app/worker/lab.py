"""Engine Lab job: render one trial on one named engine and record timing and cost."""
from __future__ import annotations

import logging
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.adapters.avatar import RenderRequest, get_avatar_engine
from app.adapters.storage import get_storage
from app.config import settings
from app.models.platform import EngineTrial
from app.models.videos import Job
from app.models.voices import Voice
from app.services import media
from app.services.prompts import build_motion_prompt
from app.services.runtime_config import cfg
from app.worker.pipeline import RenderFailed, _synthesize, finish_job

log = logging.getLogger("worker.lab")


def run_engine_trial(db: Session, job: Job) -> None:
    storage = get_storage()
    work = Path(settings.work_dir) / job.id
    work.mkdir(parents=True, exist_ok=True)
    trial = db.get(EngineTrial, job.payload.get("trial_id"))
    if not trial or trial.workspace_id != job.workspace_id:
        finish_job(db, job, "failed", "Trial not found.")
        return
    started = time.time()
    try:
        trial.status, trial.error = "running", None
        db.commit()
        voice = db.get(Voice, trial.voice_id) if trial.voice_id else None
        if not voice:
            raise RenderFailed("Pick a voice for the trial.")
        audio_path, audio_s = _synthesize(voice, trial.script, "en", "neutral", work)

        look_path = reference_path = None
        if trial.look_key:
            look_path = storage.get_to_file(trial.look_key, work / f"look{Path(trial.look_key).suffix}")
        if trial.reference_key:
            reference_path = storage.get_to_file(trial.reference_key, work / "reference.mp4")
        if trial.engine in ("wan_s2v", "infinitetalk", "mock") and not look_path and reference_path:
            look_path = work / "look.jpg"
            media.thumbnail(reference_path, look_path, 1.0)
        if trial.engine in ("infinitetalk_v2v", "latentsync") and not reference_path:
            raise RenderFailed("This engine needs the real clip.")

        width, height = media.aspect_size(trial.aspect, "720p")
        backend = "mock" if trial.engine == "mock" else (cfg("avatar_engine_backend") or "mock")
        engine = get_avatar_engine(backend)
        if backend == "runpod" and not engine.available():
            raise RenderFailed("RunPod is not connected. Add the API key and endpoint in Connections.")

        def progress(pct: int, _eta) -> None:
            job.progress = pct
            job.stage = f"{trial.engine} {pct}%"
            db.commit()

        seed = trial.seed or 20261016
        req = RenderRequest(
            engine=trial.engine, audio_path=audio_path, audio_duration_s=audio_s, look_path=look_path,
            reference_path=reference_path, motion_prompt=build_motion_prompt("calm", "none", "camera"),
            width=width, height=height, fps=25, quality_steps=trial.steps,
            extra={"scratch_prefix": f"ws/{trial.workspace_id}/lab/{trial.id}/scratch", "seed": seed},
        )
        result = engine.render(req, work, progress)
        wall = time.time() - started
        trial.seed = seed
        trial.engine_version = result.engine_version
        if result.profile:
            # Keep the GPU's own timing breakdown with the trial so speed work is measured, not guessed.
            import json as _json

            summary = _json.dumps(result.profile, separators=(",", ":"))[:1500]
            trial.notes = ((trial.notes or "").rstrip() + "\n\nGPU timing: " + summary).strip()
        ref_for_check = reference_path or look_path
        if ref_for_check is not None:
            from app.adapters.quality import get_quality_checker

            q = get_quality_checker().check(result.video_path, ref_for_check, work)
            trial.quality_score, trial.quality_method = q.score, q.method
        duration = media.duration_seconds(result.video_path)
        gpu_s = result.gpu_seconds or (wall if backend == "runpod" else 0.0)
        price = float(cfg("gpu_price_inr_per_hour") or 95)
        cost = round(gpu_s / 3600 * price, 2) if gpu_s else 0.0

        thumb = work / "thumb.jpg"
        media.thumbnail(result.video_path, thumb, min(1.0, duration / 2))
        prefix = f"ws/{trial.workspace_id}/lab/{trial.id}"
        storage.put_file(f"{prefix}/output.mp4", result.video_path, "video/mp4")
        storage.put_file(f"{prefix}/thumb.jpg", thumb, "image/jpeg")
        storage.delete_prefix(f"{prefix}/scratch")
        trial.output_key, trial.thumbnail_key = f"{prefix}/output.mp4", f"{prefix}/thumb.jpg"
        trial.duration_s, trial.wall_seconds, trial.gpu_seconds, trial.cost_inr = round(duration, 2), round(wall, 1), round(gpu_s, 1), cost
        trial.gpu = cfg("gpu_name") or "" if backend == "runpod" else "local ffmpeg"
        trial.status = "succeeded"
        db.commit()
        finish_job(db, job, "succeeded", result={"trial_id": trial.id, "wall_seconds": wall, "cost_inr": cost})
    except RenderFailed as e:
        _fail(db, job, trial.id, str(e))
    except media.MediaError as e:
        log.error("ffmpeg error in trial %s: %s", trial.id, e)
        _fail(db, job, trial.id, f"ffmpeg failed: {str(e)[-300:]}")
    except Exception as e:  # noqa: BLE001
        log.exception("trial %s crashed", trial.id)
        _fail(db, job, trial.id, f"{type(e).__name__}: {str(e)[:4500]}")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _fail(db: Session, job: Job, trial_id: str, message: str) -> None:
    db.rollback()
    job = db.get(Job, job.id)
    trial = db.get(EngineTrial, trial_id)
    if trial:
        trial.status, trial.error = "failed", message
        trial.updated_at = datetime.now(timezone.utc)
    finish_job(db, job, "failed", message)
