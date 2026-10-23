from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select

from app.deps import ApiError, CanEdit, Ctx, get_ctx
from app.models.videos import Project, Video
from app.schemas import ProjectIn, ProjectOut

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectOut])
async def list_projects(ctx: Ctx = Depends(get_ctx)) -> list[ProjectOut]:
    rows = (await ctx.db.execute(
        select(Project, func.count(Video.id), func.coalesce(func.sum(Video.charged_credits), 0))
        .outerjoin(Video, Video.project_id == Project.id)
        .where(Project.workspace_id == ctx.workspace.id)
        .group_by(Project.id).order_by(Project.created_at.desc())
    )).all()
    return [ProjectOut(id=p.id, name=p.name, created_at=p.created_at, video_count=int(c), credits_used=int(s))
            for p, c, s in rows]


@router.post("", response_model=ProjectOut, status_code=201)
async def create_project(body: ProjectIn, ctx: Ctx = CanEdit) -> ProjectOut:
    p = Project(workspace_id=ctx.workspace.id, name=body.name.strip())
    ctx.db.add(p)
    await ctx.db.commit()
    return ProjectOut(id=p.id, name=p.name, created_at=p.created_at)


@router.patch("/{project_id}", response_model=ProjectOut)
async def rename_project(project_id: str, body: ProjectIn, ctx: Ctx = CanEdit) -> ProjectOut:
    p = await ctx.db.scalar(select(Project).where(Project.id == project_id, Project.workspace_id == ctx.workspace.id))
    if not p:
        raise ApiError(404, "not_found", "That project does not exist.")
    p.name = body.name.strip()
    await ctx.db.commit()
    return ProjectOut(id=p.id, name=p.name, created_at=p.created_at)


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: str, ctx: Ctx = CanEdit) -> None:
    p = await ctx.db.scalar(select(Project).where(Project.id == project_id, Project.workspace_id == ctx.workspace.id))
    if not p:
        raise ApiError(404, "not_found", "That project does not exist.")
    await ctx.db.delete(p)  # videos keep existing; project_id becomes NULL
    await ctx.db.commit()
