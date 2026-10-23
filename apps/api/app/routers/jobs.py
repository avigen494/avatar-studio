from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.deps import ApiError, Ctx, get_ctx
from app.models.videos import Job
from app.schemas import JobOut

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("/{job_id}", response_model=JobOut)
async def get_job(job_id: str, ctx: Ctx = Depends(get_ctx)) -> JobOut:
    job = await ctx.db.scalar(select(Job).where(Job.id == job_id, Job.workspace_id == ctx.workspace.id))
    if not job:
        raise ApiError(404, "not_found", "That job does not exist.")
    return JobOut.model_validate(job)


@router.get("", response_model=list[JobOut])
async def list_jobs(ctx: Ctx = Depends(get_ctx), status: str | None = None, limit: int = 50) -> list[JobOut]:
    stmt = select(Job).where(Job.workspace_id == ctx.workspace.id)
    if status:
        stmt = stmt.where(Job.status == status)
    rows = (await ctx.db.scalars(stmt.order_by(Job.created_at.desc()).limit(min(limit, 200)))).all()
    return [JobOut.model_validate(j) for j in rows]
