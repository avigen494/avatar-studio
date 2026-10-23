from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.adapters.storage import get_storage
from app.deps import ApiError, CanEdit, Ctx, get_ctx
from app.models.avatars import Identity, Look
from app.schemas import (
    DesignIn, FootageIn, IdentityCreate, IdentityJobOut, IdentityOut, IdentityPatch, JobStartOut, LookCreate,
    LookGenerateIn, LookOut, LookPackOut, LookPatch, ReferenceIn,
)
from app.services.look_packs import PACKS, PACK_BY_ID
from app.models.videos import Job
from app.services import credits, media
from app.services.estimate import NEW_LOOK_CREDITS, TRAIN_STYLE_CREDITS
from app.services.jobs import enqueue
from app.services.prompts import render as render_prompt
from app.services.serializers import identity_out, look_out

CAMERA_ANGLE_CREDITS = 6

router = APIRouter(prefix="/identities", tags=["identities"])


async def _get(ctx: Ctx, identity_id: str) -> Identity:
    identity = await ctx.db.scalar(
        select(Identity).options(selectinload(Identity.looks))
        .where(Identity.id == identity_id, Identity.workspace_id == ctx.workspace.id)
    )
    if not identity:
        raise ApiError(404, "not_found", "That avatar does not exist.")
    return identity


@router.get("/look-packs", response_model=list[LookPackOut])
async def look_packs(ctx: Ctx = Depends(get_ctx)) -> list[LookPackOut]:
    """Preset outfit + setting combos for Indian niches (PRD section 13)."""
    return [LookPackOut(**p) for p in PACKS]


@router.get("", response_model=list[IdentityOut])
async def list_identities(ctx: Ctx = Depends(get_ctx)) -> list[IdentityOut]:
    rows = (await ctx.db.scalars(
        select(Identity).options(selectinload(Identity.looks))
        .where(Identity.workspace_id == ctx.workspace.id).order_by(Identity.created_at)
    )).all()
    return [identity_out(i) for i in rows]


@router.post("", response_model=IdentityOut, status_code=201)
async def create_identity(body: IdentityCreate, ctx: Ctx = CanEdit) -> IdentityOut:
    count = await ctx.db.scalar(select(func.count(Identity.id)).where(Identity.workspace_id == ctx.workspace.id)) or 0
    if count >= ctx.workspace.max_avatars:
        raise ApiError(402, "avatar_limit", f"Your plan includes {ctx.workspace.max_avatars} avatar(s). Upgrade to add more.")
    identity = Identity(workspace_id=ctx.workspace.id, name=body.name.strip(), kind=body.kind, design=body.design)
    if body.kind == "designed":
        identity.consent_status = "verified"  # no real person involved
        identity.consent_method = "not_required"
    ctx.db.add(identity)
    await ctx.db.commit()
    return identity_out(identity, [])


@router.get("/{identity_id}", response_model=IdentityOut)
async def get_identity(identity_id: str, ctx: Ctx = Depends(get_ctx)) -> IdentityOut:
    return identity_out(await _get(ctx, identity_id))


@router.patch("/{identity_id}", response_model=IdentityOut)
async def patch_identity(identity_id: str, body: IdentityPatch, ctx: Ctx = CanEdit) -> IdentityOut:
    identity = await _get(ctx, identity_id)
    if body.name:
        identity.name = body.name.strip()
    await ctx.db.commit()
    return identity_out(identity)


@router.delete("/{identity_id}", status_code=204)
async def delete_identity(identity_id: str, ctx: Ctx = CanEdit) -> None:
    identity = await _get(ctx, identity_id)
    prefix = identity.storage_prefix
    await ctx.db.delete(identity)
    await ctx.db.commit()
    # PRD 7: a deleted avatar deletes its clip, looks and style file.
    get_storage().delete_prefix(prefix)


@router.post("/{identity_id}/reference", response_model=IdentityOut)
async def set_reference(identity_id: str, body: ReferenceIn, ctx: Ctx = CanEdit) -> IdentityOut:
    """
    Attach the 15-second recording. The teleprompter script doubles as the
    consent statement, so one clip is both the motion reference and the
    consent recording unless a separate consent clip is given.
    """
    identity = await _get(ctx, identity_id)
    if identity.kind != "real_person":
        raise ApiError(400, "not_real_person", "Designed avatars do not need a recording.")
    storage = get_storage()
    if not body.key.startswith(f"ws/{ctx.workspace.id}/") or not storage.exists(body.key):
        raise ApiError(400, "upload_missing", "The recording was not uploaded. Try again.")
    if not body.consent_text_read:
        raise ApiError(400, "consent_required", "Read the consent line on screen while recording.")
    identity.reference_key = body.key
    identity.consent_key = body.consent_key or body.key
    identity.status = "verifying"
    identity.consent_status = "pending"
    identity.consent_notes = None
    await enqueue(ctx.db, ctx.workspace.id, "verify_identity", {"identity_id": identity.id})
    await ctx.db.commit()
    return identity_out(identity)


@router.post("/{identity_id}/looks", response_model=LookOut, status_code=201)
async def add_look(identity_id: str, body: LookCreate, ctx: Ctx = CanEdit) -> LookOut:
    identity = await _get(ctx, identity_id)
    storage = get_storage()
    if not body.key.startswith(f"ws/{ctx.workspace.id}/") or not storage.exists(body.key):
        raise ApiError(400, "upload_missing", "The photo was not uploaded. Try again.")
    is_first = len(identity.looks) == 0
    look = Look(workspace_id=ctx.workspace.id, identity_id=identity.id, name=body.name.strip() or "Look",
                kind=body.kind, media_key=body.key, is_default=is_first)
    ctx.db.add(look)
    # Photo mode is available the moment a look exists (first video in under
    # 10 minutes while the clip trains, PRD section 1).
    if identity.status == "draft":
        identity.status = "ready"
    if not identity.thumbnail_key and body.kind == "photo":
        identity.thumbnail_key = body.key
    await ctx.db.commit()
    return look_out(look)


@router.patch("/{identity_id}/looks/{look_id}", response_model=LookOut)
async def rename_look(identity_id: str, look_id: str, body: LookPatch, ctx: Ctx = CanEdit) -> LookOut:
    identity = await _get(ctx, identity_id)
    look = next((l for l in identity.looks if l.id == look_id), None)
    if not look:
        raise ApiError(404, "not_found", "That look does not exist.")
    look.name = body.name.strip()
    await ctx.db.commit()
    return look_out(look)


@router.delete("/{identity_id}/looks/{look_id}", status_code=204)
async def delete_look(identity_id: str, look_id: str, ctx: Ctx = CanEdit) -> None:
    identity = await _get(ctx, identity_id)
    look = next((l for l in identity.looks if l.id == look_id), None)
    if not look:
        raise ApiError(404, "not_found", "That look does not exist.")
    key = look.media_key
    was_default = look.is_default
    await ctx.db.delete(look)
    await ctx.db.flush()
    if was_default:
        remaining = [l for l in identity.looks if l.id != look_id]
        if remaining:
            remaining[0].is_default = True
    await ctx.db.commit()
    get_storage().delete(key)


# --- v2: footage, teach-my-style, look generator ---------------------------------
@router.post("/{identity_id}/footage", response_model=IdentityOut, status_code=201)
async def add_footage(identity_id: str, body: FootageIn, ctx: Ctx = CanEdit) -> IdentityOut:
    """Extra clips (2-10 minutes total) for style training."""
    identity = await _get(ctx, identity_id)
    storage = get_storage()
    if not body.key.startswith(f"ws/{ctx.workspace.id}/") or not storage.exists(body.key):
        raise ApiError(400, "upload_missing", "The clip was not uploaded. Try again.")
    from app.services.serializers import footage_entries

    entries = footage_entries(identity)
    if all(e["key"] != body.key for e in entries):
        seconds = await run_in_threadpool(_measure, body.key)
        entries.append({"key": body.key, "seconds": seconds})
    identity.footage_keys = entries
    await ctx.db.commit()
    return identity_out(identity)


def _measure(key: str) -> float | None:
    """Length of an uploaded clip, measured once so the training sheet is exact later."""
    import tempfile
    from pathlib import Path

    try:
        with tempfile.TemporaryDirectory() as tmp:
            p = get_storage().get_to_file(key, Path(tmp) / Path(key).name)
            return round(media.duration_seconds(p), 1)
    except Exception:  # noqa: BLE001
        return None


@router.delete("/{identity_id}/footage", response_model=IdentityOut)
async def remove_footage(identity_id: str, body: FootageIn, ctx: Ctx = CanEdit) -> IdentityOut:
    from app.services.serializers import footage_entries

    identity = await _get(ctx, identity_id)
    identity.footage_keys = [e for e in footage_entries(identity) if e["key"] != body.key]
    await ctx.db.commit()
    get_storage().delete(body.key)
    return identity_out(identity)


@router.post("/{identity_id}/train-style", response_model=JobStartOut, status_code=202)
async def train_style(identity_id: str, ctx: Ctx = CanEdit) -> JobStartOut:
    """Teach it my style: one-time per-avatar training, 40 credits, charged on success."""
    identity = await _get(ctx, identity_id)
    if identity.kind != "real_person":
        raise ApiError(400, "not_real_person", "Style training is for real-person avatars.")
    if identity.consent_status != "verified":
        raise ApiError(422, "blocked", "Verify the consent recording before training.")
    if identity.style_status in ("queued", "training"):
        raise ApiError(409, "busy", "Training is already running.")
    if not identity.reference_key and not identity.footage_keys:
        raise ApiError(422, "blocked", "Record or upload footage first.")
    try:
        await ctx.db.run_sync(credits.ensure_can_afford, ctx.workspace.id, TRAIN_STYLE_CREDITS)
    except credits.InsufficientCredits as e:
        raise ApiError(402, "insufficient_credits", str(e), needed=e.needed, available=e.available)
    identity.style_status, identity.style_error = "queued", None
    job = await enqueue(ctx.db, ctx.workspace.id, "train_style", {"identity_id": identity.id})
    await ctx.db.commit()
    return JobStartOut(job_id=job.id, credits=TRAIN_STYLE_CREDITS,
                       message=f"Training started. {TRAIN_STYLE_CREDITS} credits are charged only when it finishes.")


@router.post("/{identity_id}/looks/generate", response_model=JobStartOut, status_code=202)
async def generate_looks(identity_id: str, body: LookGenerateIn, ctx: Ctx = CanEdit) -> JobStartOut:
    """New look from a prompt (3 variants, 2 credits) or 3 camera angles (6 credits)."""
    identity = await _get(ctx, identity_id)
    cost = CAMERA_ANGLE_CREDITS if body.mode == "camera_angles" else NEW_LOOK_CREDITS
    if body.pack_id:
        pack = PACK_BY_ID.get(body.pack_id)
        if not pack:
            raise ApiError(404, "not_found", "That look pack does not exist.")
        entry = pack["looks"][min(body.pack_index or 0, len(pack["looks"]) - 1)]
        body = body.model_copy(update={"name": body.name or entry["name"], "outfit": entry["outfit"],
                                       "setting": entry["setting"], "lighting": entry["lighting"], "framing": entry["framing"]})
    source_key = None
    if body.source_look_id:
        look = next((l for l in identity.looks if l.id == body.source_look_id), None)
        if not look:
            raise ApiError(404, "not_found", "That look does not exist.")
        source_key = look.media_key
    else:
        default = next((l for l in identity.looks if l.is_default and l.kind != "video"), None) or \
                  next((l for l in identity.looks if l.kind != "video"), None)
        source_key = default.media_key if default else (identity.thumbnail_key or identity.reference_key)
    if not source_key:
        raise ApiError(422, "blocked", "Add a photo of yourself first.")
    try:
        await ctx.db.run_sync(credits.ensure_can_afford, ctx.workspace.id, cost)
    except credits.InsufficientCredits as e:
        raise ApiError(402, "insufficient_credits", str(e), needed=e.needed, available=e.available)
    prompt_text = render_prompt("look", {"outfit": body.outfit, "setting": body.setting, "lighting": body.lighting,
                                         "framing": body.framing})
    job = await enqueue(ctx.db, ctx.workspace.id, "generate_look", {
        "identity_id": identity.id, "mode": body.mode, "name": body.name, "outfit": body.outfit, "setting": body.setting,
        "lighting": body.lighting, "framing": body.framing, "source_key": source_key, "prompt_text": prompt_text,
    })
    await ctx.db.commit()
    what = "3 camera angles" if body.mode == "camera_angles" else "3 variants"
    return JobStartOut(job_id=job.id, credits=cost, message=f"Making {what}. {cost} credits are charged only on success.")


@router.post("/{identity_id}/design", response_model=JobStartOut, status_code=202)
async def design_avatar(identity_id: str, body: DesignIn, ctx: Ctx = CanEdit) -> JobStartOut:
    """Design with AI: three candidate portraits for a designed avatar (2 credits on success)."""
    identity = await _get(ctx, identity_id)
    if identity.kind != "designed":
        raise ApiError(400, "not_designed", "Design with AI is for designed avatars. Real people record a clip or upload a photo.")
    try:
        await ctx.db.run_sync(credits.ensure_can_afford, ctx.workspace.id, NEW_LOOK_CREDITS)
    except credits.InsufficientCredits as e:
        raise ApiError(402, "insufficient_credits", str(e), needed=e.needed, available=e.available)
    identity.design = body.model_dump()
    prompt_text = render_prompt("design", body.model_dump())
    job = await enqueue(ctx.db, ctx.workspace.id, "generate_look", {
        "identity_id": identity.id, "mode": "design", "prompt_text": prompt_text,
        "orientation": body.orientation, "name": "Candidate",
    })
    await ctx.db.commit()
    return JobStartOut(job_id=job.id, credits=NEW_LOOK_CREDITS,
                       message=f"Designing 3 candidates. {NEW_LOOK_CREDITS} credits are charged only on success.")


@router.get("/{identity_id}/jobs", response_model=list[IdentityJobOut])
async def identity_jobs(identity_id: str, ctx: Ctx = Depends(get_ctx)) -> list[IdentityJobOut]:
    """Recent training / look jobs for this avatar (for progress on the avatar page)."""
    identity = await _get(ctx, identity_id)
    rows = (await ctx.db.scalars(
        select(Job).where(Job.workspace_id == ctx.workspace.id, Job.type.in_(["train_style", "generate_look"]))
        .order_by(Job.created_at.desc()).limit(20)
    )).all()
    return [IdentityJobOut(id=j.id, type=j.type, status=j.status, stage=j.stage, progress=j.progress, error=j.error,
                           created_at=j.created_at, result=j.result or {})
            for j in rows if j.payload.get("identity_id") == identity.id]


@router.post("/{identity_id}/looks/{look_id}/default", response_model=IdentityOut)
async def set_default_look(identity_id: str, look_id: str, ctx: Ctx = CanEdit) -> IdentityOut:
    identity = await _get(ctx, identity_id)
    found = False
    for l in identity.looks:
        l.is_default = l.id == look_id
        found = found or l.is_default
    if not found:
        raise ApiError(404, "not_found", "That look does not exist.")
    await ctx.db.commit()
    return identity_out(identity)
