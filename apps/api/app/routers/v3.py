"""v3 feature endpoints: Translate, AI Clipping, Video Agent planner, notifications, admin usage."""
from __future__ import annotations

import math

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.adapters import llm
from app.deps import ApiError, CanEdit, Ctx, get_ctx
from app.models.avatars import Identity
from app.models.videos import Job, Video
from app.models.voices import Voice
from app.schemas import VideoOut
from app.services import credits, usage
from app.services.admin import require_admin
from app.services.estimate import TRANSLATE_PER_MINUTE, estimate_seconds, estimate_video, resolve_engine
from app.services.guardrails import check_script
from app.services.jobs import enqueue
from app.services.serializers import video_out
from app.worker.v3 import CLIP_CREDITS_PER_SOURCE_MINUTE, LANG_NAMES, translate_script

router = APIRouter(tags=["v3"])

INDIAN_FIRST = ["hi", "hinglish", "ta", "te", "bn", "mr", "gu", "kn", "ml", "pa", "ur", "en", "es", "fr", "de", "pt", "ar", "id"]


# --- Translate -------------------------------------------------------------------------
class TranslateIn(BaseModel):
    languages: list[str] = Field(min_length=1, max_length=10)
    mode: str = Field(default="audio_only", pattern="^(audio_only|lip_sync)$")
    voice_id: str | None = None   # defaults to the source voice (multilingual on ElevenLabs/Sarvam)
    generate: bool = True


class TranslateOut(BaseModel):
    videos: list[VideoOut]
    credits_per_minute: int
    note: str


@router.get("/translate/languages")
async def translate_languages(ctx: Ctx = Depends(get_ctx)) -> list[dict]:
    return [{"code": c, "name": LANG_NAMES[c], "indian": c in INDIAN_FIRST[:11]} for c in INDIAN_FIRST]


@router.post("/videos/{video_id}/translate", response_model=TranslateOut, status_code=202)
async def translate(video_id: str, body: TranslateIn, ctx: Ctx = CanEdit) -> TranslateOut:
    """One new video per language. Translation uses P4 with the workspace glossary; the render charges on success."""
    src = await ctx.db.scalar(select(Video).where(Video.id == video_id, Video.workspace_id == ctx.workspace.id))
    if not src:
        raise ApiError(404, "not_found", "That video does not exist.")
    bad = [l for l in body.languages if l not in LANG_NAMES]
    if bad:
        raise ApiError(400, "bad_language", f"Unknown language {bad[0]}.")
    identity = await ctx.db.scalar(select(Identity).options(selectinload(Identity.looks))
                                   .where(Identity.id == src.identity_id, Identity.workspace_id == ctx.workspace.id))
    voice_id = body.voice_id or src.voice_id
    if not await ctx.db.scalar(select(Voice.id).where(Voice.id == voice_id, Voice.workspace_id == ctx.workspace.id)):
        raise ApiError(404, "not_found", "That voice does not exist.")
    engine_mode = "mouth_only" if body.mode == "lip_sync" and identity and identity.reference_key else src.engine_mode
    outs: list[Video] = []
    total = 0
    for lang in body.languages:
        if lang == src.language:
            continue
        try:
            text = await run_in_threadpool(translate_script, src.script, src.language, lang, ctx.workspace.glossary)
        except llm.LLMUnavailable as e:
            raise ApiError(503, "assistant_unavailable", str(e))
        hits = check_script(text, identity.name if identity else None)
        if hits:
            raise ApiError(422, "blocked", hits[0].message)
        engine = resolve_engine(engine_mode, identity.kind if identity else "real_person", bool(identity and identity.reference_key))
        est = estimate_video(text, lang if lang in ("en", "hi", "hinglish") else "en", engine, src.quality)
        # Translate price is a flat 6 credits per minute (PRD section 9), prorated like every other price.
        minutes = max(est.seconds, 1) / 60
        translate_credits = max(1, math.ceil(minutes * TRANSLATE_PER_MINUTE))
        v = Video(workspace_id=ctx.workspace.id, project_id=src.project_id, identity_id=src.identity_id, look_id=src.look_id,
                  voice_id=voice_id, created_by=ctx.user.id, title=f"{src.title} · {LANG_NAMES[lang]}", script=text,
                  language=lang if lang in ("en", "hi", "hinglish") else "en", engine_mode=engine_mode, resolved_engine=engine,
                  motion=src.motion, aspect=src.aspect, quality=src.quality, captions=src.captions, voice_style=src.voice_style,
                  estimated_seconds=est.seconds, estimated_credits=translate_credits, status="draft",
                  source_video_id=src.id, kind="translation")
        ctx.db.add(v)
        outs.append(v)
        total += translate_credits
    if not outs:
        raise ApiError(400, "same_language", "Pick a language different from the original.")
    await ctx.db.flush()
    if body.generate:
        try:
            await ctx.db.run_sync(credits.ensure_can_afford, ctx.workspace.id, total)
        except credits.InsufficientCredits as e:
            await ctx.db.commit()
            raise ApiError(402, "insufficient_credits", f"{e} The translated drafts were kept.", needed=e.needed, available=e.available)
        for v in outs:
            v.status, v.stage = "queued", "Queued"
            await enqueue(ctx.db, ctx.workspace.id, "render", {"video_id": v.id, "fixed_credits": v.estimated_credits}, video_id=v.id)
    await ctx.db.commit()
    return TranslateOut(videos=[video_out(v) for v in outs], credits_per_minute=TRANSLATE_PER_MINUTE,
                        note="Lip-sync keeps your real footage and redraws the mouth; audio-only re-renders with the new voice track.")


# --- Clipping --------------------------------------------------------------------------
class ClipIn(BaseModel):
    count: int = Field(default=3, ge=1, le=10)
    min_seconds: int = Field(default=15, ge=5, le=120)
    max_seconds: int = Field(default=60, ge=10, le=180)


class ClipStartOut(BaseModel):
    job_id: str
    credits: int
    message: str


@router.post("/videos/{video_id}/clip", response_model=ClipStartOut, status_code=202)
async def clip(video_id: str, body: ClipIn, ctx: Ctx = CanEdit) -> ClipStartOut:
    src = await ctx.db.scalar(select(Video).where(Video.id == video_id, Video.workspace_id == ctx.workspace.id))
    if not src:
        raise ApiError(404, "not_found", "That video does not exist.")
    if src.status != "succeeded" or not src.output_key:
        raise ApiError(409, "not_ready", "Finish the render before clipping.")
    if body.max_seconds <= body.min_seconds:
        raise ApiError(400, "bad_range", "Max seconds must be larger than min seconds.")
    minutes = max((src.duration_s or 60) / 60, 1 / 60)
    cost = max(1, int(-(-minutes // 1)) * CLIP_CREDITS_PER_SOURCE_MINUTE)
    try:
        await ctx.db.run_sync(credits.ensure_can_afford, ctx.workspace.id, cost)
    except credits.InsufficientCredits as e:
        raise ApiError(402, "insufficient_credits", str(e), needed=e.needed, available=e.available)
    job = await enqueue(ctx.db, ctx.workspace.id, "clip", {"video_id": src.id, **body.model_dump()})
    await ctx.db.commit()
    return ClipStartOut(job_id=job.id, credits=cost, message=f"Finding {body.count} clips. {cost} credit(s) are charged only on success.")


@router.get("/videos/{video_id}/derived", response_model=list[VideoOut])
async def derived_of(video_id: str, ctx: Ctx = Depends(get_ctx)) -> list[VideoOut]:
    """Clips and translations made from this video."""
    rows = (await ctx.db.scalars(select(Video).where(Video.workspace_id == ctx.workspace.id, Video.source_video_id == video_id)
                                 .order_by(Video.created_at.desc()).limit(100))).all()
    return [video_out(v) for v in rows]


@router.get("/jobs/{job_id}/status")
async def job_status(job_id: str, ctx: Ctx = Depends(get_ctx)) -> dict:
    j = await ctx.db.scalar(select(Job).where(Job.id == job_id, Job.workspace_id == ctx.workspace.id))
    if not j:
        raise ApiError(404, "not_found", "That job does not exist.")
    return {"id": j.id, "type": j.type, "status": j.status, "stage": j.stage, "progress": j.progress, "error": j.error, "result": j.result or {}}


# --- Video Agent planner (P5) ------------------------------------------------------------
class PlanIn(BaseModel):
    brief: str = Field(min_length=3, max_length=4000)
    target_seconds: int = Field(default=60, ge=20, le=600)
    identity_id: str | None = None
    voice_id: str | None = None


class PlanOut(BaseModel):
    plan: dict
    script: str
    seconds: int
    model: str


@router.post("/ai/plan", response_model=PlanOut)
async def plan_video(body: PlanIn, ctx: Ctx = CanEdit) -> PlanOut:
    """Video Agent: brief -> 6–12 scene plan (P5) -> the presenter lines joined into a script you can edit."""
    identity = await ctx.db.get(Identity, body.identity_id) if body.identity_id else None
    voice = await ctx.db.get(Voice, body.voice_id) if body.voice_id else None
    brand = ctx.workspace.brand_kit or {}
    summary = ", ".join(f"{k}: {v}" for k, v in brand.items() if k in ("primary_color", "caption_style")) or "none"
    try:
        plan = await run_in_threadpool(llm.complete_json, "planner", {
            "target_seconds": body.target_seconds, "brief": body.brief.strip(),
            "avatar_name": identity.name if identity else "the presenter", "voice_name": voice.name if voice else "default",
            "brand_summary": summary}, "sonnet")
    except llm.LLMUnavailable as e:
        raise ApiError(503, "assistant_unavailable", str(e))
    except ValueError:
        raise ApiError(502, "bad_plan", "The planner returned something we could not read. Try again.")
    scenes = plan.get("scenes") or []
    script = " ".join(s.get("voiceover", "").strip() for s in scenes if s.get("voiceover")).strip()
    hits = check_script(script, identity.name if identity else None)
    if hits:
        raise ApiError(422, "blocked", hits[0].message)
    return PlanOut(plan=plan, script=script, seconds=estimate_seconds(script, "en"), model="planner")


# --- Notifications (per user) -------------------------------------------------------------
class NotifyPrefs(BaseModel):
    phone: str | None = Field(default=None, pattern=r"^\+?[1-9]\d{7,14}$")
    notify_whatsapp: bool = False


@router.get("/me/notifications", response_model=NotifyPrefs)
async def get_notify(ctx: Ctx = Depends(get_ctx)) -> NotifyPrefs:
    return NotifyPrefs(phone=ctx.user.phone, notify_whatsapp=bool(ctx.user.notify_whatsapp))


@router.put("/me/notifications", response_model=NotifyPrefs)
async def set_notify(body: NotifyPrefs, ctx: Ctx = Depends(get_ctx)) -> NotifyPrefs:
    ctx.user.phone = ("+" + body.phone.lstrip("+")) if body.phone else None
    ctx.user.notify_whatsapp = bool(body.notify_whatsapp and body.phone)
    await ctx.db.commit()
    return NotifyPrefs(phone=ctx.user.phone, notify_whatsapp=ctx.user.notify_whatsapp)


# --- Admin usage dashboard ----------------------------------------------------------------
@router.get("/admin/usage")
async def admin_usage(days: int = 30, ctx: Ctx = Depends(require_admin)) -> dict:
    return await usage.overview(ctx.db, min(max(days, 1), 365))
