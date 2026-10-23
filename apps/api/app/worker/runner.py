"""
The worker loop.

Claims one queued job at a time with an atomic UPDATE (works on Postgres and
SQLite), runs it, and records the outcome. A crash mid-job leaves the job
"running"; on the next start, jobs locked by this worker id are re-queued so
nothing is lost and nothing is charged.
"""
from __future__ import annotations

import logging
import signal
import time
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.models.videos import Job, Video
from app.worker import pipeline
from app.worker.db import SyncSession

log = logging.getLogger("worker")
_stop = False


def _handle_stop(*_):
    global _stop
    _stop = True
    log.info("Stop requested; finishing the current job.")


def requeue_orphans(db: Session, worker_id: str) -> int:
    """Jobs this worker was running when it died go back to the queue."""
    rows = db.scalars(select(Job).where(Job.status == "running", Job.locked_by == worker_id)).all()
    for job in rows:
        job.status = "queued"
        job.locked_by = None
        job.locked_at = None
        job.stage = "Queued"
        job.progress = 0
        if job.video_id:
            video = db.get(Video, job.video_id)
            if video and job.type == "render":
                video.status, video.stage, video.progress = "queued", "Queued", 0
    db.commit()
    return len(rows)


def claim_next(db: Session, worker_id: str) -> Job | None:
    candidate = db.scalar(select(Job).where(Job.status == "queued").order_by(Job.created_at).limit(1))
    if not candidate:
        return None
    now = datetime.now(timezone.utc)
    result = db.execute(
        update(Job)
        .where(Job.id == candidate.id, Job.status == "queued")
        .values(status="running", locked_by=worker_id, locked_at=now, started_at=now, attempts=Job.attempts + 1)
    )
    db.commit()
    if result.rowcount != 1:
        return None  # another worker got it first
    db.expire_all()
    return db.get(Job, candidate.id)


def run_one(job_id: str) -> None:
    with SyncSession() as db:
        job = db.get(Job, job_id)
        if not job:
            return
        handler = pipeline.HANDLERS.get(job.type)
        if handler is None:
            pipeline.finish_job(db, job, "failed", f"Unknown job type {job.type}")
            return
        try:
            handler(db, job)
        except Exception as e:  # last line of defence; handlers normally catch their own errors
            log.exception("Job %s crashed", job.id)
            db.rollback()
            job = db.get(Job, job_id)
            if job and job.status == "running":
                pipeline.finish_job(db, job, "failed", f"Something went wrong: {str(e)[:300]}")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    worker_id = settings.worker_id
    signal.signal(signal.SIGINT, _handle_stop)
    signal.signal(signal.SIGTERM, _handle_stop)

    from app import models  # noqa: F401
    from app.db import Base
    from app.worker.db import sync_engine

    if settings.auto_create_tables:
        Base.metadata.create_all(sync_engine)

    with SyncSession() as db:
        n = requeue_orphans(db, worker_id)
        if n:
            log.info("Re-queued %d orphaned job(s).", n)

    from app.services.runtime_config import cfg

    log.info("Worker %s started. avatar_engine=%s storage=%s", worker_id, cfg("avatar_engine_backend") or "mock",
             cfg("storage_backend") or "local")
    last_housekeeping = 0.0
    while not _stop:
        if time.time() - last_housekeeping > 60:
            try:
                from app.services.billing import expire_lapsed

                with SyncSession() as db:
                    expire_lapsed(db)
            except Exception:  # noqa: BLE001
                log.exception("housekeeping failed")
            last_housekeeping = time.time()
        try:
            from app.services.events import deliver_due

            with SyncSession() as db:
                deliver_due(db)
        except Exception:  # noqa: BLE001
            log.exception("webhook delivery failed")
        with SyncSession() as db:
            job = claim_next(db, worker_id)
        if not job:
            time.sleep(settings.worker_poll_seconds)
            continue
        log.info("Running job %s (%s)", job.id, job.type)
        started = time.time()
        run_one(job.id)
        log.info("Job %s done in %.1fs", job.id, time.time() - started)


if __name__ == "__main__":
    main()
