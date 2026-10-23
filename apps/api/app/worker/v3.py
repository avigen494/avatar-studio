"""
v3 jobs: Translate (dub + optional lip-sync) and AI Clipping.

Translate: P4 translation with the workspace glossary -> a new video in the
target language, rendered through the normal chain (mouth-only engine when
lip-sync is requested so the original footage is kept). 6 credits per minute,
charged on success of the rendered video (the render job charges it).

Clipping: transcribe (STT adapter) -> P9 picks clips -> ffmpeg cuts each one,
reframes to 9:16 and burns captions -> each clip becomes a Video row with
status succeeded. 1 credit per source minute, charged once on success.
"""
from __future__ import annotations

import json
import logging
import math
import shutil
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.adapters import llm
from app.adapters.storage import get_storage
from app.adapters.stt import get_stt
from app.config import settings
from app.models.core import Workspace
from app.models.videos import Job, Video
from app.services import captions as caps
from app.services import credits, events, media
from app.worker.pipeline import RenderFailed, _encode_with_overlays, _ffmpeg_overlay_filters, finish_job

log = logging.getLogger("worker.v3")
CLIP_CREDITS_PER_SOURCE_MINUTE = 1
LANG_NAMES = {"en": "English", "hi": "Hindi", "hinglish": "Hinglish", "ta": "Tamil", "te": "Telugu", "bn": "Bengali",
              "mr": "Marathi", "gu": "Gujarati", "kn": "Kannada", "ml": "Malayalam", "pa": "Punjabi", "ur": "Urdu",
              "es": "Spanish", "fr": "French", "de": "German", "pt": "Portuguese", "ar": "Arabic", "id": "Indonesian"}


def translate_script(script: str, source: str, target: str, glossary: list[dict] | None) -> str:
    terms = ", ".join(g.get("term", "") for g in (glossary or []) if g.get("term")) or "none"
    res = llm.complete("translate", {"source_language": LANG_NAMES.get(source, source), "target_language": LANG_NAMES.get(target, target),
                                     "glossary_terms": terms, "script": script}, tier="sonnet", max_tokens=4096)
    if res.refused or not res.text.strip():
        raise RenderFailed("The translation was declined. Try a different script.")
    return res.text.strip()


def run_clip(db: Session, job: Job) -> None:
    storage = get_storage()
    work = Path(settings.work_dir) / job.id
    work.mkdir(parents=True, exist_ok=True)
    p = job.payload
    source: Video | None = None
    try:
        source = db.get(Video, p.get("video_id"))
        if not source or source.workspace_id != job.workspace_id:
            raise RenderFailed("That video no longer exists.")
        key = p.get("source_key") or source.output_key
        if not key:
            raise RenderFailed("Finish the render before clipping.")
        workspace = db.get(Workspace, job.workspace_id)
        count = int(p.get("count") or 3)
        min_s, max_s = int(p.get("min_seconds") or 15), int(p.get("max_seconds") or 60)

        job.stage, job.progress = "Transcribing", 10
        db.commit()
        src = storage.get_to_file(key, work / "source.mp4")
        duration = media.duration_seconds(src)
        cost = max(1, math.ceil(duration / 60 * CLIP_CREDITS_PER_SOURCE_MINUTE))
        have = credits.balance(db, job.workspace_id)
        if have < cost:
            raise RenderFailed(f"Clipping this {duration / 60:.1f}-minute video costs {cost} credits and you have {have}. Nothing was charged.")
        wav = work / "source.wav"
        media.to_wav(src, wav)
        transcript = get_stt().transcribe(wav, source.language, known_text=source.transcript or source.script)
        sentences = transcript.sentences()
        if len(sentences) < 2:
            raise RenderFailed("We could not get a transcript with enough sentences to pick clips from. "
                               "Connect ElevenLabs (speech-to-text) in Settings → Connections for uploaded videos.")

        job.stage, job.progress = "Picking clips", 35
        db.commit()
        lines = "\n".join(f"[{s:.1f}-{e:.1f}] {t}" for s, e, t in sentences)
        picks = _pick(lines, sentences, count, min_s, max_s, duration)

        job.stage, job.progress = "Cutting", 50
        db.commit()
        created: list[str] = []
        brand = workspace.brand_kit or {}
        watermark = bool(workspace.watermark_enabled and workspace.plan == "free")
        for i, c in enumerate(picks, 1):
            start, end = float(c["start_s"]), float(c["end_s"])
            raw = work / f"clip_{i}_raw.mp4"
            # Cut, then reframe to 9:16 around the centre (presenter videos are centred).
            media.run([settings.ffmpeg_bin, "-y", "-v", "error", "-ss", f"{start:.2f}", "-to", f"{end:.2f}", "-i", str(src),
                       "-vf", "crop=min(iw\\,ih*9/16):ih,scale=720:1280", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
                       "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(raw)])
            clip_words = [w for w in transcript.words if w.start >= start - 0.05 and w.end <= end + 0.05]
            text = " ".join(w.text for w in clip_words) or c.get("hook", "")
            cues = caps.timings(text, end - start)
            srt = work / f"clip_{i}.srt"
            srt.write_text(caps.to_srt(cues), encoding="utf-8")
            out = work / f"clip_{i}.mp4"
            try:
                _encode_with_overlays(raw, out, _ffmpeg_overlay_filters(720, watermark, bool(workspace.ai_label_enabled), srt.name, brand), work)
            except media.MediaError:
                shutil.copyfile(raw, out)
            thumb = work / f"clip_{i}.jpg"
            media.thumbnail(out, thumb, min(1.0, (end - start) / 2))

            clip = Video(workspace_id=job.workspace_id, project_id=source.project_id, identity_id=source.identity_id,
                         look_id=source.look_id, voice_id=source.voice_id, created_by=source.created_by,
                         title=(c.get("title") or f"Clip {i}")[:200], script=text, language=source.language,
                         engine_mode=source.engine_mode, resolved_engine="clip", motion=source.motion, aspect="9:16",
                         quality="720p", captions=True, status="succeeded", stage="Done", progress=100,
                         estimated_seconds=int(end - start), estimated_credits=0, charged_credits=0,
                         duration_s=round(end - start, 2), transcript=text, summary=c.get("reason"),
                         watermarked=watermark, ai_labelled=bool(workspace.ai_label_enabled),
                         completed_at=datetime.now(timezone.utc), source_video_id=source.id, kind="clip")
            db.add(clip)
            db.flush()
            prefix = clip.storage_prefix
            storage.put_file(f"{prefix}/final.mp4", raw, "video/mp4")
            storage.put_file(f"{prefix}/final_captions.mp4", out, "video/mp4")
            storage.put_file(f"{prefix}/captions.srt", srt, "text/plain")
            storage.put_file(f"{prefix}/thumb.jpg", thumb, "image/jpeg")
            clip.output_key, clip.output_captioned_key = f"{prefix}/final.mp4", f"{prefix}/final_captions.mp4"
            clip.srt_key, clip.thumbnail_key = f"{prefix}/captions.srt", f"{prefix}/thumb.jpg"
            created.append(clip.id)
            job.progress = 50 + int(45 * i / len(picks))
            db.commit()

        credits.charge(db, job.workspace_id, cost, source.id, job.id, f"Clipping · {source.title[:50]} · {len(created)} clips")
        events.emit(db, job.workspace_id, "video.succeeded", {"clips": created, "source_video_id": source.id, "event_detail": "clipping"})
        db.commit()
        finish_job(db, job, "succeeded", result={"clip_ids": created, "credits": cost})
    except RenderFailed as e:
        db.rollback()
        finish_job(db, db.get(Job, job.id), "failed", str(e))
    except Exception as e:  # noqa: BLE001
        log.exception("clip job crashed")
        db.rollback()
        finish_job(db, db.get(Job, job.id), "failed", f"Clipping failed on our side ({type(e).__name__}). Nothing was charged.")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _pick(lines: str, sentences: list[tuple[float, float, str]], count: int, min_s: int, max_s: int, duration: float) -> list[dict]:
    """P9 via Claude when available; otherwise an even spread of sentence-aligned windows."""
    if llm.available():
        try:
            out = llm.complete_json("clipping", {"count": count, "min_seconds": min_s, "max_seconds": max_s, "transcript": lines}, tier="sonnet")
            clips = [c for c in out.get("clips", []) if 0 <= float(c["start_s"]) < float(c["end_s"]) <= duration + 0.5]
            if clips:
                return clips[:count]
        except Exception as e:  # noqa: BLE001
            log.warning("P9 picker failed, using the even spread: %s", e)
    picks: list[dict] = []
    n = max(1, len(sentences))
    step = max(1, n // count)
    i = 0
    while i < n and len(picks) < count:
        start = sentences[i][0]
        j = i
        while j + 1 < n and sentences[j][1] - start < min_s:
            j += 1
        while j + 1 < n and sentences[j + 1][1] - start <= max_s and sentences[j][1] - start < (min_s + max_s) / 2:
            j += 1
        end = min(sentences[j][1], start + max_s)
        if end - start >= min(min_s, duration):
            picks.append({"title": sentences[i][2][:40].rsplit(" ", 1)[0] if len(sentences[i][2]) > 40 else sentences[i][2],
                          "start_s": round(start, 2), "end_s": round(end, 2), "hook": sentences[i][2],
                          "reason": "An evenly spaced section that starts on a sentence."})
        i = max(j + 1, i + step)
    return picks
