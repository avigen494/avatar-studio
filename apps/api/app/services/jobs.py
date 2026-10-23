"""Enqueue background jobs. The worker (app/worker) picks them up."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.videos import Job


async def enqueue(db: AsyncSession, workspace_id: str, job_type: str, payload: dict | None = None,
                  video_id: str | None = None) -> Job:
    job = Job(workspace_id=workspace_id, type=job_type, payload=payload or {}, video_id=video_id, status="queued")
    db.add(job)
    await db.flush()
    return job
