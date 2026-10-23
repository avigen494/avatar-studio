from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select

from app.adapters.storage import get_storage
from app.adapters.voice import SynthesisRequest, all_library_voices, default_voice_engine_name, get_voice_engine
from app.adapters.voice.elevenlabs import ElevenLabsVoiceEngine
from app.deps import ApiError, CanEdit, Ctx, get_ctx
from app.models.voices import Voice
from app.schemas import LibraryVoiceOut, VoiceAdopt, VoiceClone, VoiceImportKey, VoiceOut, VoicePatch, VoicePreviewIn
from app.services import crypto
from app.services.serializers import voice_out

router = APIRouter(prefix="/voices", tags=["voices"])

SAMPLE_TEXT = {
    "en": "Hi, this is my voice on Avatar Studio. Short sentences, clear words, ready for your next video.",
    "hi": "नमस्ते, यह मेरी आवाज़ है। छोटे वाक्य, साफ़ शब्द, आपके अगले वीडियो के लिए तैयार।",
    "hinglish": "Hi, yeh meri awaaz hai Avatar Studio par. Chhote sentences, clear words, aapke next video ke liye ready.",
}


async def _get(ctx: Ctx, voice_id: str) -> Voice:
    voice = await ctx.db.scalar(select(Voice).where(Voice.id == voice_id, Voice.workspace_id == ctx.workspace.id))
    if not voice:
        raise ApiError(404, "not_found", "That voice does not exist.")
    return voice


async def _clear_default(ctx: Ctx) -> None:
    for v in (await ctx.db.scalars(select(Voice).where(Voice.workspace_id == ctx.workspace.id, Voice.is_default))).all():
        v.is_default = False


@router.get("", response_model=list[VoiceOut])
async def list_voices(ctx: Ctx = Depends(get_ctx)) -> list[VoiceOut]:
    rows = (await ctx.db.scalars(
        select(Voice).where(Voice.workspace_id == ctx.workspace.id).order_by(Voice.is_default.desc(), Voice.created_at)
    )).all()
    return [voice_out(v) for v in rows]


@router.get("/library", response_model=list[LibraryVoiceOut])
async def library(language: str | None = None, ctx: Ctx = Depends(get_ctx)) -> list[LibraryVoiceOut]:
    """Voices from every configured engine, with the engine shown per voice."""
    items = await run_in_threadpool(all_library_voices)
    out = [
        LibraryVoiceOut(engine=eng, external_voice_id=v.external_id, name=v.name, language=v.language,
                        gender=v.gender, style=v.style)
        for eng, v in items
    ]
    if language:
        out = [o for o in out if o.language == language]
    return out


@router.post("", response_model=VoiceOut, status_code=201)
async def adopt(body: VoiceAdopt, ctx: Ctx = CanEdit) -> VoiceOut:
    """Add a library voice to this workspace."""
    try:
        engine = get_voice_engine(body.engine)
    except KeyError:
        raise ApiError(400, "unknown_engine", "That voice engine is not available.")
    first = not await ctx.db.scalar(select(Voice.id).where(Voice.workspace_id == ctx.workspace.id))
    voice = Voice(workspace_id=ctx.workspace.id, name=body.name, engine=body.engine, source="library",
                  external_voice_id=body.external_voice_id, language=body.language, gender=body.gender,
                  style=body.style, is_default=first, supports_delivery_tags=engine.supports_delivery_tags)
    ctx.db.add(voice)
    await ctx.db.commit()
    return voice_out(voice)


@router.post("/clone", response_model=VoiceOut, status_code=201)
async def clone(body: VoiceClone, ctx: Ctx = CanEdit) -> VoiceOut:
    storage = get_storage()
    if not body.sample_key.startswith(f"ws/{ctx.workspace.id}/") or not storage.exists(body.sample_key):
        raise ApiError(400, "upload_missing", "The voice sample was not uploaded. Try again.")
    engine_name = "elevenlabs" if get_voice_engine("elevenlabs").available() else "mock"
    engine = get_voice_engine(engine_name)

    def _do() -> str:
        with tempfile.TemporaryDirectory() as tmp:
            local = storage.get_to_file(body.sample_key, Path(tmp) / Path(body.sample_key).name)
            return engine.clone(body.name, local)

    try:
        external_id = await run_in_threadpool(_do)
    except Exception as e:  # engine errors are shown in plain words
        raise ApiError(502, "clone_failed", f"Could not clone the voice: {str(e)[:200]}")

    first = not await ctx.db.scalar(select(Voice.id).where(Voice.workspace_id == ctx.workspace.id))
    voice = Voice(workspace_id=ctx.workspace.id, name=body.name.strip(), engine=engine_name, source="clone",
                  external_voice_id=external_id, language=body.language, is_default=first,
                  supports_delivery_tags=engine.supports_delivery_tags, sample_key=body.sample_key)
    ctx.db.add(voice)
    await ctx.db.commit()
    return voice_out(voice)


@router.post("/import-key", response_model=list[VoiceOut], status_code=201)
async def import_key(body: VoiceImportKey, ctx: Ctx = CanEdit) -> list[VoiceOut]:
    """Bring your own ElevenLabs key: we list its voices and store the key encrypted."""
    engine = ElevenLabsVoiceEngine()
    try:
        voices = await run_in_threadpool(engine.list_library, body.api_key)
    except Exception:
        raise ApiError(400, "bad_key", "ElevenLabs did not accept that key.")
    enc = crypto.encrypt(body.api_key)
    existing = {
        v.external_voice_id: v for v in (await ctx.db.scalars(
            select(Voice).where(Voice.workspace_id == ctx.workspace.id, Voice.engine == "elevenlabs")
        )).all()
    }
    first = not await ctx.db.scalar(select(Voice.id).where(Voice.workspace_id == ctx.workspace.id))
    created: list[Voice] = []
    for lv in voices:
        if lv.external_id in existing:
            existing[lv.external_id].byo_key_encrypted = enc
            created.append(existing[lv.external_id])
            continue
        v = Voice(workspace_id=ctx.workspace.id, name=lv.name, engine="elevenlabs", source="byo_key",
                  external_voice_id=lv.external_id, language=lv.language, gender=lv.gender, style=lv.style,
                  byo_key_encrypted=enc, supports_delivery_tags=True, is_default=first and not created)
        ctx.db.add(v)
        created.append(v)
    await ctx.db.commit()
    return [voice_out(v) for v in created]


@router.patch("/{voice_id}", response_model=VoiceOut)
async def patch(voice_id: str, body: VoicePatch, ctx: Ctx = CanEdit) -> VoiceOut:
    voice = await _get(ctx, voice_id)
    if body.name:
        voice.name = body.name.strip()
    if body.language:
        voice.language = body.language
    if body.is_default:
        await _clear_default(ctx)
        voice.is_default = True
    await ctx.db.commit()
    return voice_out(voice)


@router.delete("/{voice_id}", status_code=204)
async def delete(voice_id: str, ctx: Ctx = CanEdit) -> None:
    voice = await _get(ctx, voice_id)
    await ctx.db.delete(voice)
    await ctx.db.commit()


@router.post("/{voice_id}/preview", response_model=VoiceOut)
async def preview(voice_id: str, body: VoicePreviewIn, ctx: Ctx = CanEdit) -> VoiceOut:
    """Synthesise a short sample so the user can hear the voice before using it."""
    voice = await _get(ctx, voice_id)
    lang = body.language or voice.language
    text = (body.text or SAMPLE_TEXT.get(lang, SAMPLE_TEXT["en"]))[:300]
    engine = get_voice_engine(voice.engine)
    api_key = crypto.decrypt(voice.byo_key_encrypted) if voice.byo_key_encrypted else None
    key = f"ws/{ctx.workspace.id}/voices/{voice.id}/sample.wav"

    def _do() -> None:
        with tempfile.TemporaryDirectory() as tmp:
            res = engine.synthesize(SynthesisRequest(text=text, external_voice_id=voice.external_voice_id,
                                                     language=lang, api_key=api_key), Path(tmp))
            get_storage().put_file(key, res.path, "audio/wav")

    try:
        await run_in_threadpool(_do)
    except Exception as e:
        raise ApiError(502, "preview_failed", f"Could not play that voice: {str(e)[:200]}")
    voice.sample_key = key
    await ctx.db.commit()
    return voice_out(voice)


@router.get("/engines/default")
async def default_engine(ctx: Ctx = Depends(get_ctx)) -> dict:
    return {"engine": default_voice_engine_name()}
