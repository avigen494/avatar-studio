"""Turn ORM rows into API responses, adding signed media URLs."""
from __future__ import annotations

from app.adapters.storage import get_storage
from app.config import settings
from app.models.avatars import Identity, Look
from app.models.videos import Video
from app.models.voices import Voice
from app.schemas import FootageOut, IdentityOut, LookOut, VideoOut, VoiceOut

URL_TTL = 3600


def url_for(key: str | None, filename: str | None = None) -> str | None:
    if not key:
        return None
    return get_storage().download_url(key, URL_TTL, filename)


def look_out(look: Look) -> LookOut:
    return LookOut(
        id=look.id, identity_id=look.identity_id, name=look.name, kind=look.kind, is_default=look.is_default,
        media_url=url_for(look.media_key), thumbnail_url=url_for(look.thumbnail_key or look.media_key),
        created_at=look.created_at,
    )


def footage_entries(identity: Identity) -> list[dict]:
    """Normalise footage_keys: plain strings (older rows) or {"key", "seconds"} dicts."""
    out = []
    for item in identity.footage_keys or []:
        if isinstance(item, str):
            out.append({"key": item, "seconds": None})
        elif isinstance(item, dict) and item.get("key"):
            out.append({"key": item["key"], "seconds": item.get("seconds")})
    return out


def identity_out(identity: Identity, looks: list[Look] | None = None) -> IdentityOut:
    looks = looks if looks is not None else list(identity.looks)
    footage = footage_entries(identity)
    known = [f["seconds"] for f in footage if f["seconds"]]
    total = (identity.reference_duration_s or 0) + sum(known)
    return IdentityOut(
        id=identity.id, name=identity.name, kind=identity.kind, status=identity.status,
        consent_status=identity.consent_status, consent_method=identity.consent_method,
        consent_notes=identity.consent_notes, style_status=identity.style_status,
        style_error=identity.style_error, style_trained_at=identity.style_trained_at,
        style_footage_seconds=identity.style_footage_seconds, footage_count=len(footage),
        footage_seconds_total=round(total, 1) if (footage or identity.reference_duration_s) else None,
        footage=[FootageOut(key=f["key"], url=url_for(f["key"]), seconds=f["seconds"]) for f in footage],
        reference_duration_s=identity.reference_duration_s,
        reference_url=url_for(identity.reference_key), thumbnail_url=url_for(identity.thumbnail_key),
        can_render=identity.can_render, render_seed=identity.render_seed, allowed_user_ids=list(identity.allowed_user_ids or []),
        looks=[look_out(l) for l in looks], created_at=identity.created_at,
    )


def voice_out(voice: Voice) -> VoiceOut:
    return VoiceOut(
        id=voice.id, name=voice.name, engine=voice.engine, source=voice.source, language=voice.language,
        gender=voice.gender, style=voice.style, is_default=voice.is_default, status=voice.status,
        external_voice_id=voice.external_voice_id,
        sample_url=url_for(voice.sample_key), supports_delivery_tags=voice.supports_delivery_tags,
        has_byo_key=bool(voice.byo_key_encrypted),
    )


def video_out(video: Video, reactions: dict[str, int] | None = None) -> VideoOut:
    safe_title = "".join(c for c in video.title if c.isalnum() or c in " -_").strip() or "video"
    return VideoOut(
        id=video.id, project_id=video.project_id, identity_id=video.identity_id, look_id=video.look_id,
        voice_id=video.voice_id, title=video.title, script=video.script, language=video.language,
        engine_mode=video.engine_mode, resolved_engine=video.resolved_engine, motion=video.motion or {},
        aspect=video.aspect, quality=video.quality, captions=video.captions, voice_style=video.voice_style,
        estimated_seconds=video.estimated_seconds, estimated_credits=video.estimated_credits,
        charged_credits=video.charged_credits, status=video.status, stage=video.stage, progress=video.progress,
        eta_seconds=video.eta_seconds, error_message=video.error_message, duration_s=video.duration_s,
        transcript=video.transcript, summary=video.summary, watermarked=video.watermarked,
        ai_labelled=video.ai_labelled, quality_score=video.quality_score, quality_method=video.quality_method,
        render_seed=video.render_seed, render_attempts=video.render_attempts or 0, engine_version=video.engine_version,
        preview_status=video.preview_status, preview_progress=video.preview_progress,
        kind=video.kind or "video", source_video_id=video.source_video_id,
        reactions=reactions or {}, share_enabled=video.share_enabled,
        share_token=video.share_token if video.share_enabled else None,
        share_has_password=bool(video.share_password_hash), views=video.views,
        output_url=url_for(video.output_key, f"{safe_title}.mp4"),
        output_captioned_url=url_for(video.output_captioned_key, f"{safe_title}-captions.mp4"),
        srt_url=url_for(video.srt_key, f"{safe_title}.srt"),
        thumbnail_url=url_for(video.thumbnail_key), preview_url=url_for(video.preview_key),
        share_url=f"{settings.web_base_url}/s/{video.share_token}" if video.share_enabled and video.share_token else None,
        created_at=video.created_at, completed_at=video.completed_at,
    )
