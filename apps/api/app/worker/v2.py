"""
v2 jobs: teach-my-style training and the look generator.

Both charge credits only on success, through the same credits.charge() as
renders, and both delete their working folder in `finally`.
"""
from __future__ import annotations

import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.adapters.avatar import get_avatar_engine
from app.adapters.image import LookRequest, get_image_engine
from app.adapters.storage import get_storage
from app.config import settings
from app.models.avatars import Identity, Look
from app.models.videos import Job
from app.services import credits, events, media
from app.services.estimate import NEW_LOOK_CREDITS, TRAIN_STYLE_CREDITS
from app.services.runtime_config import cfg
from app.worker.pipeline import RenderFailed, finish_job

log = logging.getLogger("worker.v2")
CAMERA_ANGLE_CREDITS = 6
MIN_FOOTAGE_SECONDS = 120  # PRD section 8: 2 to 10 minutes of footage


def _identity(db: Session, job: Job) -> Identity:
    identity = db.get(Identity, job.payload.get("identity_id"))
    if not identity or identity.workspace_id != job.workspace_id:
        raise RenderFailed("That avatar no longer exists.")
    return identity


def run_train_style(db: Session, job: Job) -> None:
    storage = get_storage()
    work = Path(settings.work_dir) / job.id
    work.mkdir(parents=True, exist_ok=True)
    identity_id = job.payload.get("identity_id")
    try:
        identity = _identity(db, job)
        identity.style_status = "training"
        db.commit()
        job.stage, job.progress = "Collecting footage", 5
        db.commit()

        from app.services.serializers import footage_entries

        keys = [identity.reference_key] if identity.reference_key else []
        keys += [e["key"] for e in footage_entries(identity)]
        if not keys:
            raise RenderFailed("Record or upload footage of yourself first.")
        local: list[Path] = []
        total = 0.0
        for i, key in enumerate(keys):
            p = storage.get_to_file(key, work / f"footage_{i}{Path(key).suffix or '.mp4'}")
            total += media.duration_seconds(p)
            local.append(p)
        if total < MIN_FOOTAGE_SECONDS:
            raise RenderFailed(f"Style training needs at least 2 minutes of footage; you have {total / 60:.1f} minutes. "
                               "Upload more clips under Avatars → Train my style.")

        have = credits.balance(db, job.workspace_id)
        if have < TRAIN_STYLE_CREDITS:
            raise RenderFailed(f"Style training costs {TRAIN_STYLE_CREDITS} credits and you have {have}. Nothing was charged.")

        engine = get_avatar_engine()

        def progress(pct: int, _eta) -> None:
            job.stage, job.progress = "Training", 10 + int(pct * 0.85)
            db.commit()

        style_path = engine.train_style(local, work, progress, extra={"identity_id": identity.id,
                                                                     "scratch_prefix": f"{identity.storage_prefix}/scratch"})
        key = f"{identity.storage_prefix}/style.safetensors"
        storage.put_file(key, style_path, "application/octet-stream")
        storage.delete_prefix(f"{identity.storage_prefix}/scratch")
        identity.style_key, identity.style_status = key, "ready"
        identity.style_trained_at = datetime.now(timezone.utc)
        identity.style_footage_seconds = round(total, 1)
        credits.charge(db, job.workspace_id, TRAIN_STYLE_CREDITS, None, job.id,
                       f"Teach my style · {identity.name} · {total / 60:.1f} min footage")
        events.emit(db, job.workspace_id, "style.ready", {"identity_id": identity.id, "name": identity.name})
        db.commit()
        finish_job(db, job, "succeeded", result={"style_key": key, "footage_seconds": total})
    except RenderFailed as e:
        _fail_style(db, job, identity_id, str(e))
    except Exception as e:  # noqa: BLE001
        log.exception("train_style crashed")
        _fail_style(db, job, identity_id, f"Training failed on our side ({type(e).__name__}). Nothing was charged.")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _fail_style(db: Session, job: Job, identity_id: str | None, message: str) -> None:
    db.rollback()
    job = db.get(Job, job.id)
    identity = db.get(Identity, identity_id) if identity_id else None
    if identity:
        identity.style_status = "ready" if identity.style_key else "failed"
        identity.style_error = message
        events.emit(db, job.workspace_id, "style.failed", {"identity_id": identity.id, "name": identity.name, "reason": message})
    finish_job(db, job, "failed", message)


def run_generate_look(db: Session, job: Job) -> None:
    storage = get_storage()
    work = Path(settings.work_dir) / job.id
    work.mkdir(parents=True, exist_ok=True)
    try:
        identity = _identity(db, job)
        p = job.payload
        mode = p.get("mode", "look")  # look | camera_angles
        cost = CAMERA_ANGLE_CREDITS if mode == "camera_angles" else NEW_LOOK_CREDITS
        have = credits.balance(db, job.workspace_id)
        if have < cost:
            raise RenderFailed(f"This costs {cost} credits and you have {have}. Nothing was charged.")

        ref = None
        if mode != "design":
            source_key = p.get("source_key") or identity.thumbnail_key
            if not source_key:
                raise RenderFailed("Add a photo of yourself first.")
            ref = storage.get_to_file(source_key, work / f"ref{Path(source_key).suffix or '.jpg'}")
            if Path(source_key).suffix.lower() in (".mp4", ".mov", ".webm"):
                frame = work / "ref.jpg"
                media.thumbnail(ref, frame, 1.0)
                ref = frame

        job.stage, job.progress = "Generating", 20
        db.commit()
        if mode == "design":
            text = p.get("prompt_text") or ""
            positive, _, negative = text.partition("\nNegative:")
            w, h = {"landscape": (1344, 768), "square": (1024, 1024)}.get(p.get("orientation"), (768, 1344))
            outs = get_image_engine().generate_from_text(positive.strip(), negative.strip(), 3, w, h, work, hint=identity.name)
            label = "Candidate"
        elif mode == "camera_angles":
            framings = ["close-up, slight left three-quarter angle", "medium shot, eye level, facing camera",
                        "medium shot, slight right three-quarter angle, looking at camera"]
            outs: list[Path] = []
            for i, fr in enumerate(framings):
                req = LookRequest(reference_path=ref, outfit="same outfit", setting="same background",
                                  lighting="same lighting", framing=fr, count=1)
                sub = work / f"angle_{i}"
                sub.mkdir()
                outs += get_image_engine().generate_looks(req, sub)
                job.progress = 20 + (i + 1) * 25
                db.commit()
            label = "Camera angle"
        else:
            req = LookRequest(reference_path=ref, outfit=p.get("outfit") or "same outfit",
                              setting=p.get("setting") or "same background",
                              lighting=p.get("lighting") or "soft natural light",
                              framing=p.get("framing") or "medium shot, facing camera", count=3)
            outs = get_image_engine().generate_looks(req, work)
            label = (p.get("name") or p.get("outfit") or "New look").strip()[:100]

        created = []
        has_default = any(l.is_default for l in identity.looks)
        for i, out in enumerate(outs, 1):
            key = f"{identity.storage_prefix}/looks/generated-{job.id}-{i}.jpg"
            storage.put_file(key, out, "image/jpeg")
            make_default = mode == "design" and not has_default and i == 1
            look = Look(workspace_id=job.workspace_id, identity_id=identity.id, name=f"{label} {i}", kind="generated",
                        media_key=key, prompt=p.get("prompt_text"), is_default=make_default)
            db.add(look)
            created.append(key)
            if make_default:
                identity.thumbnail_key = key
                has_default = True
        if mode == "design" and identity.status == "draft":
            identity.status = "ready"  # a designed avatar is ready once it has a face
        credits.charge(db, job.workspace_id, cost, None, job.id, f"{label} · {len(outs)} variants · {identity.name}")
        events.emit(db, job.workspace_id, "look.generated", {"identity_id": identity.id, "mode": mode, "look_keys": created})
        db.commit()
        finish_job(db, job, "succeeded", result={"look_keys": created, "credits": cost})
    except RenderFailed as e:
        db.rollback()
        finish_job(db, db.get(Job, job.id), "failed", str(e))
    except Exception as e:  # noqa: BLE001
        log.exception("generate_look crashed")
        db.rollback()
        finish_job(db, db.get(Job, job.id), "failed", f"Look generation failed ({type(e).__name__}). Nothing was charged.")
    finally:
        shutil.rmtree(work, ignore_errors=True)
