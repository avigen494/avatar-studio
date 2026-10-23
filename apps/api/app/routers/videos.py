"""
Videos: estimate, create, preview (free), generate (charged on success),
cancel, share, download.

The order of checks before a render is queued is the product contract:
  1. the avatar can render (consent verified for real people)
  2. the script passes the guardrails
  3. the estimate is shown and the balance covers it
Only then does a job go on the queue. Nothing is charged here - the worker
charges after success.
"""
from __future__ import annotations

from datetime import datetime, timezone

import csv
import io

from fastapi import APIRouter, Depends, File, Form, Header, Query, UploadFile
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.adapters.storage import get_storage
from app.deps import ApiError, CanEdit, Ctx, get_ctx
from app.models.avatars import Identity, Look
from app.models.videos import Job, Reaction, Video
from app.models.voices import Voice
from app.schemas import (
    BatchIn, BatchItem, BatchOut, BatchRowOut, EstimateIn, EstimateOut, GuardrailOut, ShareIn, VideoCreate, VideoList,
    VideoOut, VideoPatch,
)
from app.services import credits, crypto
from app.services.estimate import estimate_video, resolve_engine
from app.services.guardrails import check_script
from app.services.jobs import enqueue
from app.routers.team import ensure_identity_access
from app.services.serializers import video_out

router = APIRouter(prefix="/videos", tags=["videos"])


async def _video(ctx: Ctx, video_id: str) -> Video:
    v = await ctx.db.scalar(select(Video).where(Video.id == video_id, Video.workspace_id == ctx.workspace.id))
    if not v:
        raise ApiError(404, "not_found", "That video does not exist.")
    return v


async def _identity(ctx: Ctx, identity_id: str) -> Identity:
    i = await ctx.db.scalar(
        select(Identity).options(selectinload(Identity.looks))
        .where(Identity.id == identity_id, Identity.workspace_id == ctx.workspace.id)
    )
    if not i:
        raise ApiError(404, "not_found", "That avatar does not exist.")
    return i


def _blockers(identity: Identity | None, hits) -> list[str]:
    out = []
    if identity is not None:
        if identity.kind == "real_person" and identity.consent_status != "verified":
            out.append("This avatar needs a verified consent recording before it can render.")
        if identity.status != "ready":
            out.append("This avatar is still being set up.")
        if identity.kind == "real_person" and not identity.reference_key and not identity.looks:
            out.append("Add a photo or a recording to this avatar first.")
    out.extend(h.message for h in hits)
    return out


async def _estimate(ctx: Ctx, script: str, language: str, engine_mode: str, quality: str,
                    identity: Identity | None) -> EstimateOut:
    engine = resolve_engine(engine_mode, identity.kind if identity else "real_person",
                            bool(identity and identity.reference_key))
    est = estimate_video(script, language, engine, quality)
    hits = check_script(script, identity.name if identity else None)
    balance = await ctx.db.run_sync(credits.balance, ctx.workspace.id)
    return EstimateOut(
        **est.to_dict(), balance=balance, can_afford=balance >= est.credits,
        guardrails=[GuardrailOut(category=h.category, excerpt=h.excerpt, message=h.message) for h in hits],
        blockers=_blockers(identity, hits),
    )


@router.post("/estimate", response_model=EstimateOut)
async def estimate(body: EstimateIn, ctx: Ctx = Depends(get_ctx)) -> EstimateOut:
    identity = await _identity(ctx, body.identity_id) if body.identity_id else None
    return await _estimate(ctx, body.script, body.language, body.engine_mode, body.quality, identity)


@router.get("", response_model=VideoList)
async def list_videos(
    ctx: Ctx = Depends(get_ctx), status: str | None = None, project_id: str | None = None,
    q: str | None = None, limit: int = Query(default=30, ge=1, le=100), cursor: str | None = None,
) -> VideoList:
    stmt = select(Video).where(Video.workspace_id == ctx.workspace.id)
    if status:
        stmt = stmt.where(Video.status == status)
    if project_id:
        stmt = stmt.where(Video.project_id == project_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(Video.title.ilike(like) | Video.script.ilike(like))
    if cursor:
        try:
            stmt = stmt.where(Video.created_at < datetime.fromisoformat(cursor))
        except ValueError:
            pass
    rows = (await ctx.db.scalars(stmt.order_by(Video.created_at.desc()).limit(limit + 1))).all()
    next_cursor = rows[limit - 1].created_at.isoformat() if len(rows) > limit else None
    return VideoList(items=[video_out(v) for v in rows[:limit]], next_cursor=next_cursor)


async def _create_one(ctx: Ctx, body: VideoCreate, idempotency_key: str | None = None) -> Video:
    if idempotency_key:
        existing = await ctx.db.scalar(select(Video).where(Video.workspace_id == ctx.workspace.id,
                                                           Video.idempotency_key == idempotency_key))
        if existing:
            return existing
    identity = await _identity(ctx, body.identity_id)
    ensure_identity_access(ctx, identity)
    voice = await ctx.db.scalar(select(Voice).where(Voice.id == body.voice_id, Voice.workspace_id == ctx.workspace.id))
    if not voice:
        raise ApiError(404, "not_found", "That voice does not exist.")
    look_id = body.look_id
    if look_id and not any(l.id == look_id for l in identity.looks):
        raise ApiError(404, "not_found", "That look does not belong to this avatar.")
    if not look_id:
        default = next((l for l in identity.looks if l.is_default), identity.looks[0] if identity.looks else None)
        look_id = default.id if default else None
    engine = resolve_engine(body.engine_mode, identity.kind, bool(identity.reference_key))
    est = estimate_video(body.script, body.language, engine, body.quality)
    title = (body.title or "").strip() or _title_from(body.script)
    video = Video(
        workspace_id=ctx.workspace.id, project_id=body.project_id, identity_id=identity.id, look_id=look_id,
        voice_id=voice.id, created_by=ctx.user.id, title=title, script=body.script.strip(), language=body.language,
        engine_mode=body.engine_mode, resolved_engine=engine, motion=body.motion.model_dump(), aspect=body.aspect,
        quality=body.quality, captions=body.captions, voice_style=body.voice_style, idempotency_key=idempotency_key,
        estimated_seconds=est.seconds, estimated_credits=est.credits, status="draft",
    )
    ctx.db.add(video)
    await ctx.db.flush()
    return video


async def _queue(ctx: Ctx, video: Video) -> list[str]:
    """Generate without the HTTP layer: returns blockers (empty = queued)."""
    identity = await _identity(ctx, video.identity_id)
    hits = check_script(video.script, identity.name)
    blockers = _blockers(identity, hits)
    if blockers:
        return blockers
    video.resolved_engine = resolve_engine(video.engine_mode, identity.kind, bool(identity.reference_key))
    est = estimate_video(video.script, video.language, video.resolved_engine, video.quality)
    video.estimated_seconds, video.estimated_credits = est.seconds, est.credits
    video.status, video.stage, video.progress, video.eta_seconds, video.error_message = "queued", "Queued", 0, None, None
    await enqueue(ctx.db, ctx.workspace.id, "render", {"video_id": video.id}, video_id=video.id)
    return []


@router.post("/batch", response_model=BatchOut, status_code=201)
async def create_batch(body: BatchIn, ctx: Ctx = CanEdit) -> BatchOut:
    """Many personalised videos from one template (PRD job 5). Credits are checked for the whole batch first."""
    rows: list[BatchRowOut] = []
    videos: list[Video] = []
    for i, item in enumerate(body.items):
        data = item.model_dump()
        data["identity_id"] = item.identity_id or body.identity_id
        data["voice_id"] = item.voice_id or body.voice_id
        data["project_id"] = item.project_id or body.project_id
        if not data["identity_id"] or not data["voice_id"]:
            rows.append(BatchRowOut(index=i, video_id=None, status="failed", error="identity_id and voice_id are required."))
            continue
        try:
            v = await _create_one(ctx, VideoCreate(**{k: data[k] for k in VideoCreate.model_fields}), item.idempotency_key)
            videos.append(v)
            rows.append(BatchRowOut(index=i, video_id=v.id, status="draft", estimated_credits=v.estimated_credits))
        except ApiError as e:
            rows.append(BatchRowOut(index=i, video_id=None, status="failed", error=e.detail.get("message")))
    total = sum(v.estimated_credits for v in videos)
    balance = await ctx.db.run_sync(credits.balance, ctx.workspace.id)
    queued = 0
    if body.generate:
        if total > balance:
            await ctx.db.commit()
            raise ApiError(402, "insufficient_credits",
                           f"This batch needs {total} credits and you have {balance}. Nothing was queued; the drafts were kept.",
                           needed=total, available=balance)
        for row in rows:
            if not row.video_id:
                continue
            v = next(x for x in videos if x.id == row.video_id)
            if v.status in ("queued", "rendering", "succeeded"):
                row.status = v.status
                continue
            blockers = await _queue(ctx, v)
            if blockers:
                row.status, row.error = "blocked", blockers[0]
            else:
                row.status = "queued"
                queued += 1
    await ctx.db.commit()
    return BatchOut(created=len(videos), queued=queued, failed=sum(1 for r in rows if r.status in ("failed", "blocked")),
                    total_credits=total, balance_after=balance - (total if body.generate else 0), rows=rows)


@router.post("/batch/csv", response_model=BatchOut, status_code=201)
async def create_batch_csv(
    file: UploadFile = File(...), identity_id: str | None = Form(default=None), voice_id: str | None = Form(default=None),
    project_id: str | None = Form(default=None), generate: bool = Form(default=True), language: str = Form(default="en"),
    aspect: str = Form(default="9:16"), quality: str = Form(default="720p"), ctx: Ctx = CanEdit,
) -> BatchOut:
    """
    CSV columns: script (required), title, language, aspect, quality, identity_id, voice_id, idempotency_key,
    expression, gesture, gaze. Up to 100 rows. Column names are case-insensitive.
    """
    raw = (await file.read()).decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(raw))
    items: list[BatchItem] = []
    for n, row in enumerate(reader):
        if n >= 100:
            raise ApiError(400, "too_many_rows", "A CSV batch can have up to 100 rows.")
        r = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
        if not r.get("script"):
            continue
        motion = {k: r[k] for k in ("expression", "gesture", "gaze") if r.get(k)}
        items.append(BatchItem(
            script=r["script"], title=r.get("title") or None, language=r.get("language") or language,
            aspect=r.get("aspect") or aspect, quality=r.get("quality") or quality,
            identity_id=r.get("identity_id") or None, voice_id=r.get("voice_id") or None,
            idempotency_key=r.get("idempotency_key") or None, motion=motion or {"expression": "calm", "gesture": "none", "gaze": "camera"},
        ))
    if not items:
        raise ApiError(400, "empty_csv", "The CSV has no rows with a script column.")
    body = BatchIn(items=items, identity_id=identity_id, voice_id=voice_id, project_id=project_id, generate=generate)
    return await create_batch(body, ctx)


@router.post("", response_model=VideoOut, status_code=201)
async def create_video(body: VideoCreate, ctx: Ctx = CanEdit,
                       idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")) -> VideoOut:
    video = await _create_one(ctx, body, idempotency_key)
    await ctx.db.commit()
    return video_out(video)


def _title_from(script: str) -> str:
    words = script.strip().split()
    return (" ".join(words[:7]) + ("…" if len(words) > 7 else "")) or "Untitled video"


@router.get("/{video_id}", response_model=VideoOut)
async def get_video(video_id: str, ctx: Ctx = Depends(get_ctx)) -> VideoOut:
    video = await _video(ctx, video_id)
    rows = (await ctx.db.execute(
        select(Reaction.emoji, func.count(Reaction.id)).where(Reaction.video_id == video.id).group_by(Reaction.emoji)
    )).all()
    return video_out(video, {e: int(c) for e, c in rows})


@router.patch("/{video_id}", response_model=VideoOut)
async def patch_video(video_id: str, body: VideoPatch, ctx: Ctx = CanEdit) -> VideoOut:
    video = await _video(ctx, video_id)
    if video.status in ("queued", "rendering"):
        raise ApiError(409, "busy", "Wait for the current render to finish or cancel it first.")
    data = body.model_dump(exclude_unset=True)
    if "motion" in data and data["motion"] is not None:
        data["motion"] = body.motion.model_dump()
    for k, v in data.items():
        setattr(video, k, v)
    identity = await _identity(ctx, video.identity_id)
    video.resolved_engine = resolve_engine(video.engine_mode, identity.kind, bool(identity.reference_key))
    est = estimate_video(video.script, video.language, video.resolved_engine, video.quality)
    video.estimated_seconds, video.estimated_credits = est.seconds, est.credits
    if video.status in ("succeeded", "failed", "cancelled") and ("script" in data or "voice_id" in data):
        video.status = "draft"  # edits after a render make a new draft
        video.preview_status = "none"
    await ctx.db.commit()
    return video_out(video)


@router.delete("/{video_id}", status_code=204)
async def delete_video(video_id: str, ctx: Ctx = CanEdit) -> None:
    video = await _video(ctx, video_id)
    if video.status in ("queued", "rendering"):
        raise ApiError(409, "busy", "Cancel the render before deleting this video.")
    prefix = video.storage_prefix
    await ctx.db.delete(video)
    await ctx.db.commit()
    get_storage().delete_prefix(prefix)


@router.post("/{video_id}/preview", response_model=VideoOut, status_code=202)
async def preview(video_id: str, ctx: Ctx = CanEdit) -> VideoOut:
    """Free 15-second 480p preview (hard rule 5). Never charged."""
    video = await _video(ctx, video_id)
    identity = await _identity(ctx, video.identity_id)
    ensure_identity_access(ctx, identity)
    hits = check_script(video.script, identity.name)
    blockers = _blockers(identity, hits)
    if blockers:
        raise ApiError(422, "blocked", blockers[0], blockers=blockers)
    if video.preview_status in ("queued", "rendering"):
        return video_out(video)
    video.preview_status = "queued"
    await enqueue(ctx.db, ctx.workspace.id, "preview", {"video_id": video.id}, video_id=video.id)
    await ctx.db.commit()
    return video_out(video)


@router.post("/{video_id}/generate", response_model=VideoOut, status_code=202)
async def generate(video_id: str, ctx: Ctx = CanEdit) -> VideoOut:
    video = await _video(ctx, video_id)
    if video.status in ("queued", "rendering"):
        raise ApiError(409, "busy", "This video is already rendering.")
    identity = await _identity(ctx, video.identity_id)
    ensure_identity_access(ctx, identity)
    hits = check_script(video.script, identity.name)
    blockers = _blockers(identity, hits)
    if blockers:
        raise ApiError(422, "blocked", blockers[0], blockers=blockers)

    video.resolved_engine = resolve_engine(video.engine_mode, identity.kind, bool(identity.reference_key))
    est = estimate_video(video.script, video.language, video.resolved_engine, video.quality)
    video.estimated_seconds, video.estimated_credits = est.seconds, est.credits
    try:
        await ctx.db.run_sync(credits.ensure_can_afford, ctx.workspace.id, est.credits)
    except credits.InsufficientCredits as e:
        raise ApiError(402, "insufficient_credits", str(e), needed=e.needed, available=e.available)

    video.status = "queued"
    video.stage, video.progress, video.eta_seconds, video.error_message = "Queued", 0, None, None
    video.output_key = video.output_captioned_key = video.srt_key = None
    video.charged_credits = 0
    video.completed_at = None
    await enqueue(ctx.db, ctx.workspace.id, "render", {"video_id": video.id}, video_id=video.id)
    await ctx.db.commit()
    return video_out(video)


@router.post("/{video_id}/cancel", response_model=VideoOut)
async def cancel(video_id: str, ctx: Ctx = CanEdit) -> VideoOut:
    """Cancel a queued or running render. Never charged (hard rule 3)."""
    video = await _video(ctx, video_id)
    jobs = (await ctx.db.scalars(
        select(Job).where(Job.video_id == video.id, Job.type.in_(["render", "preview"]), Job.status.in_(["queued", "running"]))
    )).all()
    for job in jobs:
        if job.status == "queued":
            job.status = "cancelled"
            job.finished_at = datetime.now(timezone.utc)
        else:
            job.cancel_requested = True
    if video.status == "queued":
        video.status = "cancelled"
        video.stage = "Cancelled"
    elif video.status == "rendering":
        video.stage = "Cancelling"
    if video.preview_status == "queued":
        video.preview_status = "none"
    await ctx.db.commit()
    return video_out(video)


@router.post("/{video_id}/duplicate", response_model=VideoOut, status_code=201)
async def duplicate(video_id: str, ctx: Ctx = CanEdit) -> VideoOut:
    """'Make another with this script' from the video page."""
    src = await _video(ctx, video_id)
    copy = Video(
        workspace_id=src.workspace_id, project_id=src.project_id, identity_id=src.identity_id, look_id=src.look_id,
        voice_id=src.voice_id, created_by=ctx.user.id, title=f"{src.title} (copy)", script=src.script,
        language=src.language, engine_mode=src.engine_mode, resolved_engine=src.resolved_engine, motion=src.motion,
        aspect=src.aspect, quality=src.quality, captions=src.captions, voice_style=src.voice_style,
        estimated_seconds=src.estimated_seconds, estimated_credits=src.estimated_credits, status="draft",
    )
    ctx.db.add(copy)
    await ctx.db.commit()
    return video_out(copy)


@router.post("/{video_id}/share", response_model=VideoOut)
async def share(video_id: str, body: ShareIn, ctx: Ctx = CanEdit) -> VideoOut:
    video = await _video(ctx, video_id)
    if body.enabled and video.status != "succeeded":
        raise ApiError(409, "not_ready", "Finish the render before sharing.")
    video.share_enabled = body.enabled
    if body.enabled and not video.share_token:
        video.share_token = crypto.new_token()
    if body.password is not None:
        video.share_password_hash = crypto.hash_password(body.password) if body.password else None
    await ctx.db.commit()
    return video_out(video)


@router.get("/{video_id}/download")
async def download(video_id: str, captions: bool = False, srt: bool = False, ctx: Ctx = Depends(get_ctx)):
    video = await _video(ctx, video_id)
    key = video.srt_key if srt else (video.output_captioned_key if captions else video.output_key)
    if not key:
        raise ApiError(404, "not_ready", "That file is not ready yet.")
    name = "".join(c for c in video.title if c.isalnum() or c in " -_").strip() or "video"
    ext = ".srt" if srt else ".mp4"
    return RedirectResponse(get_storage().download_url(key, 600, f"{name}{ext}"), status_code=307)
