"""
How a video is made (PRD section 6). Eight steps, charge at the end.

  1 Validate      consent gate, guardrails, inputs present            (VPS, seconds)
  2 Estimate      recompute credits, confirm the balance covers it    (VPS)
  3 Voice         text-to-speech, optional delivery tags (P3)         (VPS)
  4 Prepare       motion prompt (P2), fetch look / reference clip     (VPS)
  5 Avatar        talking-head render on the GPU                      (GPU, minutes)
  6 Sharpen       super-resolution / face restore / fps               (GPU; skipped for previews)
  7 Captions      SRT, burned-in copy, watermark, AI label, thumbnail (CPU)
  8 Publish       upload outputs, mark succeeded, CHARGE              (VPS)

If anything fails between 4 and 8, the job is marked failed, the user is told
why in plain words, and no credits move. A preview runs the same chain at
480p for 15 seconds, skips step 6 and never charges. The working folder is
deleted in a `finally` block (PRD section 7).
"""
from __future__ import annotations

import logging
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters import llm
from app.adapters.avatar import RenderRequest, engine_name_for, get_avatar_engine
from app.adapters.face import get_verifier
from app.adapters.notify import notify_user
from app.adapters.quality import gate_enabled, get_quality_checker, max_retries
from app.adapters.storage import get_storage
from app.adapters.voice import SynthesisRequest, get_voice_engine
from app.config import settings
from app.models.avatars import Identity, Look
from app.models.core import Workspace
from app.models.videos import Job, Video
from app.models.voices import Voice
from app.services import captions as caps
from app.services import events
from app.services import glossary
from app.services import credits, crypto, media
from app.services.estimate import estimate_video, resolve_engine
from app.services.guardrails import check_script
from app.services.prompts import build_motion_prompt
from app.services.runtime_config import cfg

log = logging.getLogger("worker.pipeline")


class Cancelled(Exception):
    pass


class RenderFailed(Exception):
    """A failure with a message safe to show the user."""


# --- bookkeeping ---------------------------------------------------------------
def finish_job(db: Session, job: Job, status: str, error: str | None = None, result: dict | None = None) -> None:
    job.status = status
    job.error = error
    job.finished_at = datetime.now(timezone.utc)
    job.progress = 100 if status == "succeeded" else job.progress
    if result:
        job.result = result
    db.commit()


class Progress:
    """Writes stage/progress/ETA to the job and (for renders) the video row."""

    def __init__(self, db: Session, job: Job, video: Video | None, expected_total_s: float, mirror_to_video: bool):
        self.db, self.job, self.video = db, job, video
        self.expected = max(expected_total_s, 10)
        self.started = time.time()
        self.mirror = mirror_to_video

    def set(self, stage: str, percent: int, eta: int | None = None) -> None:
        percent = max(0, min(100, int(percent)))
        if eta is None:
            eta = int(max(self.expected * (1 - percent / 100), 0))
        self.job.stage, self.job.progress, self.job.eta_seconds = stage, percent, eta
        if self.video is not None:
            if self.mirror:
                self.video.stage, self.video.progress, self.video.eta_seconds = stage, percent, eta
            else:
                self.video.preview_progress = percent
        self.db.commit()

    def sub(self, stage: str, lo: int, hi: int):
        """Progress callback for an engine: maps 0-100 onto [lo, hi]."""

        def cb(pct: int, _eta: str | None) -> None:
            self.set(stage, lo + (hi - lo) * max(0, min(100, pct)) / 100)
            self.check_cancel()

        return cb

    def check_cancel(self) -> None:
        self.db.refresh(self.job, attribute_names=["cancel_requested"])
        if self.job.cancel_requested:
            raise Cancelled()


# --- render / preview ----------------------------------------------------------
def _load(db: Session, job: Job) -> tuple[Video, Identity, Look | None, Voice, Workspace]:
    video = db.get(Video, job.payload.get("video_id") or job.video_id)
    if not video or video.workspace_id != job.workspace_id:
        raise RenderFailed("This video no longer exists.")
    identity = db.get(Identity, video.identity_id)
    if not identity or identity.workspace_id != job.workspace_id:
        raise RenderFailed("The avatar for this video was deleted.")
    voice = db.get(Voice, video.voice_id)
    if not voice or voice.workspace_id != job.workspace_id:
        raise RenderFailed("The voice for this video was deleted.")
    look = db.get(Look, video.look_id) if video.look_id else None
    if look is None:
        look = db.scalar(select(Look).where(Look.identity_id == identity.id).order_by(Look.is_default.desc(), Look.created_at))
    workspace = db.get(Workspace, job.workspace_id)
    return video, identity, look, voice, workspace


def _preview_script(script: str, language: str) -> str:
    """Enough words to fill the free preview window, cut at a sentence end."""
    from app.services.estimate import WPM_BY_LANGUAGE

    wpm = WPM_BY_LANGUAGE.get(language, settings.words_per_minute)
    budget = int(settings.preview_max_seconds / 60 * wpm * 1.15)
    words = script.split()
    if len(words) <= budget:
        return script
    cut = " ".join(words[:budget])
    for mark in (". ", "! ", "? ", "। "):
        idx = cut.rfind(mark)
        if idx > len(cut) * 0.5:
            return cut[: idx + 1]
    return cut


def _synthesize(voice: Voice, text: str, language: str, style: str, work: Path,
                glossary_terms: list[dict] | None = None) -> tuple[Path, float]:
    text = glossary.apply(text, glossary_terms)  # pronunciations for speech only
    engine = get_voice_engine(voice.engine)
    if not engine.available():
        raise RenderFailed(f"The voice engine '{voice.engine}' is not set up on this server.")
    # P3 delivery tags, only for engines that understand them.
    if voice.supports_delivery_tags and llm.available():
        try:
            tagged = llm.complete("delivery", {"script": text, "style": style}, tier="haiku", max_tokens=2048)
            if not tagged.refused and tagged.text:
                text = tagged.text
        except llm.LLMUnavailable:
            pass
    api_key = crypto.decrypt(voice.byo_key_encrypted) if voice.byo_key_encrypted else None
    try:
        res = engine.synthesize(SynthesisRequest(text=text, external_voice_id=voice.external_voice_id,
                                                 language=language, style=style, api_key=api_key), work)
    except Exception as e:
        raise RenderFailed(f"The voice could not be generated: {str(e)[:200]}") from e
    if res.duration_s <= 0.3:
        raise RenderFailed("The voice came back empty. Try a different voice.")
    return res.path, res.duration_s


def _ass_colour(hex_colour: str | None) -> str | None:
    """#RRGGBB -> &HBBGGRR& as libass wants it."""
    if not hex_colour or len(hex_colour) != 7:
        return None
    r, g, b = hex_colour[1:3], hex_colour[3:5], hex_colour[5:7]
    return f"&H00{b}{g}{r}&"


def _ffmpeg_overlay_filters(width: int, watermark: bool, ai_label: bool, srt_name: str | None,
                            brand: dict | None = None, logo_name: str | None = None) -> str:
    """Build the -vf chain for step 7. Fonts come from the system via fontconfig."""
    brand = brand or {}
    parts: list[str] = []
    if srt_name:
        size = 20 if width < 800 else 28
        style = f"FontName=Arial,FontSize={size},Outline=2,Shadow=0,MarginV=48,Bold=1"
        colour = _ass_colour(brand.get("primary_color")) if brand.get("caption_style") == "brand" else None
        if colour:
            style += f",PrimaryColour={colour}"
        parts.append(f"subtitles={srt_name}:force_style='{style}'")
    fs = max(14, width // 36)
    font = media.find_font()
    font_arg = f"fontfile='{font}':" if font else ""
    if watermark:
        parts.append(f"drawtext={font_arg}text='Made with Avatar Studio':fontcolor=white@0.85:fontsize={fs}:box=1:boxcolor=black@0.35:boxborderw=8:x=w-tw-16:y=16")
    if ai_label:
        parts.append(f"drawtext={font_arg}text='AI-assisted':fontcolor=white@0.85:fontsize={fs}:box=1:boxcolor=black@0.35:boxborderw=6:x=16:y=16")
    return ",".join(parts)


def _encode_with_overlays(src: Path, dst: Path, vf: str, work: Path, logo_name: str | None = None) -> None:
    """One encode pass: optional brand logo (bottom-right, 14% of width) then the filter chain."""
    cmd = [settings.ffmpeg_bin, "-y", "-v", "error", "-i", str(src)]
    if logo_name:
        cmd += ["-i", logo_name]
        # scale2ref: first input (logo) is "main", second (video) is the reference whose width is iw. 14% of video width, logo aspect kept.
        graph = "[1:v][0:v]scale2ref=w=iw*0.14:h=ow/mdar[logo][base];[base][logo]overlay=W-w-24:H-h-24:format=auto[v0]"
        if vf:
            graph += f";[v0]{vf}[vout]"
            cmd += ["-filter_complex", graph, "-map", "[vout]", "-map", "0:a?"]
        else:
            cmd += ["-filter_complex", graph, "-map", "[v0]", "-map", "0:a?"]
    elif vf:
        cmd += ["-vf", vf]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "copy",
            "-movflags", "+faststart", str(dst)]
    media.run(cmd, cwd=work)


def run_render(db: Session, job: Job, is_preview: bool = False) -> None:
    storage = get_storage()
    work = Path(settings.work_dir) / job.id
    work.mkdir(parents=True, exist_ok=True)
    video: Video | None = None
    try:
        video, identity, look, voice, workspace = _load(db, job)
        if is_preview:
            video.preview_status = "rendering"
        else:
            video.status, video.error_message = "rendering", None
        db.commit()

        # Expected wall time drives the ETA: mock renders take seconds, GPU minutes.
        gpu = (cfg("avatar_engine_backend") or "mock") == "runpod"
        est_seconds = video.estimated_seconds if not is_preview else settings.preview_max_seconds
        expected = 15 + est_seconds * (10 if gpu else 0.6)
        prog = Progress(db, job, video, expected, mirror_to_video=not is_preview)

        # 1 Validate --------------------------------------------------------------
        prog.set("Voice", 2)
        if identity.kind == "real_person" and identity.consent_status != "verified":
            raise RenderFailed("This avatar needs a verified consent recording before it can render.")
        hits = check_script(video.script, identity.name)
        if hits:
            raise RenderFailed(hits[0].message)
        if not look and not identity.reference_key:
            raise RenderFailed("Add a photo or a recording to this avatar first.")

        # 2 Estimate --------------------------------------------------------------
        engine_mode = resolve_engine(video.engine_mode, identity.kind, bool(identity.reference_key))
        est = estimate_video(video.script, video.language, engine_mode, video.quality)
        # Translations carry a flat price (6 credits per minute) set by the API.
        fixed = job.payload.get("fixed_credits")
        charge_credits = int(fixed) if fixed is not None else est.credits
        if not is_preview:
            video.resolved_engine = engine_mode
            video.estimated_seconds, video.estimated_credits = est.seconds, charge_credits
            have = credits.balance(db, video.workspace_id)
            if have < charge_credits:
                raise RenderFailed(f"You need {charge_credits} credits for this video and have {have}. Nothing was charged.")
        db.commit()

        # 3 Voice -----------------------------------------------------------------
        text = _preview_script(video.script, video.language) if is_preview else video.script
        audio_path, audio_s = _synthesize(voice, text, video.language, video.voice_style, work, workspace.glossary)
        if is_preview:
            audio_s = min(audio_s, settings.preview_max_seconds)
        prog.set("Voice", 20)
        prog.check_cancel()

        # 4 Prepare ---------------------------------------------------------------
        motion = video.motion or {}
        motion_prompt = build_motion_prompt(motion.get("expression", "calm"), motion.get("gesture", "none"),
                                            motion.get("gaze", "camera"))
        look_path = reference_path = None
        if look:
            look_path = storage.get_to_file(look.media_key, work / f"look{Path(look.media_key).suffix}")
            if look.kind == "video":
                reference_path, look_path = look_path, None
        if identity.reference_key and engine_mode in ("real_footage", "mouth_only"):
            reference_path = storage.get_to_file(identity.reference_key, work / "reference.mp4")
        if engine_mode in ("real_footage", "mouth_only") and not reference_path:
            engine_mode = "photo"
        if engine_mode == "photo" and not look_path and reference_path:
            # No photo but a clip exists: grab a frame to use as the look.
            look_path = work / "look.jpg"
            media.thumbnail(reference_path, look_path, 1.0)

        quality = "480p" if is_preview else video.quality
        if is_preview:
            height = settings.preview_height
            width = {"9:16": height * 9 // 16 // 2 * 2, "1:1": height, "16:9": height * 16 // 9 // 2 * 2}[video.aspect]
        else:
            width, height = media.aspect_size(video.aspect, "720p")  # engines render at 720p; step 6 upsizes
        prog.set("Avatar", 25)

        # 5 Avatar ----------------------------------------------------------------
        engine = get_avatar_engine()
        if not engine.available():
            raise RenderFailed("The render engine is not set up on this server yet.")
        base_seed = int(identity.render_seed or 1)
        req = RenderRequest(
            engine=engine_name_for(engine_mode) if engine.name != "mock" else ("infinitetalk_v2v" if reference_path and engine_mode != "photo" else "mock"),
            audio_path=audio_path, audio_duration_s=audio_s, look_path=look_path, reference_path=reference_path,
            motion_prompt=motion_prompt, width=width, height=height, fps=25,
            max_seconds=settings.preview_max_seconds if is_preview else None,
            quality_steps=40 if video.quality == "4k" else 20,
            extra={"scratch_prefix": f"{video.storage_prefix}/scratch", "style_key": identity.style_key, "seed": base_seed},
        )
        # Render, then the quality gate: the output face must match the reference. A failed
        # check re-renders with the next seed; after the retries we fail without charging.
        checker = get_quality_checker()
        reference_for_check = reference_path or look_path
        attempts_allowed = 1 + (max_retries() if gate_enabled() and not is_preview else 0)
        gate = None
        result = None
        for attempt in range(1, attempts_allowed + 1):
            req.extra["seed"] = base_seed + attempt - 1
            result = engine.render(req, work, prog.sub("Avatar", 25, 68))
            prog.check_cancel()
            if not gate_enabled() or is_preview or reference_for_check is None:
                break
            prog.set("Avatar", 69)
            gate = checker.check(result.video_path, reference_for_check, work)
            log.info("quality gate attempt %d: %s score=%s ok=%s (%s)", attempt, gate.method, gate.score, gate.ok, gate.detail)
            if gate.ok:
                break
            if attempt < attempts_allowed:
                shutil.move(result.video_path, work / f"rejected_{attempt}.mp4")
        video.render_attempts = attempt
        video.render_seed = req.extra["seed"]
        if gate is not None:
            video.quality_score, video.quality_method = gate.score, gate.method
            db.commit()  # keep the score, seed and attempt count even when we fail below
            if not gate.ok:
                raise RenderFailed("The render did not look enough like you, even after a retry, so we did not keep it. "
                                   "Nothing was charged. A clearer, front-facing photo or clip usually fixes this.")
        if result.engine_version:
            video.engine_version = result.engine_version
        raw = result.video_path
        prog.check_cancel()

        # 6 Sharpen ---------------------------------------------------------------
        final_w, final_h = media.aspect_size(video.aspect, quality if not is_preview else "720p")
        if is_preview:
            prog.set("Sharpen", 72)
            finished = raw
        elif video.quality in ("1080p", "4k"):
            finished = engine.finish(raw, work, final_w, final_h, 30 if video.quality == "4k" else 25,
                                     prog.sub("Sharpen", 70, 80))
        else:
            prog.set("Sharpen", 78)
            finished = raw
        prog.check_cancel()

        # 7 Captions, watermark, label, thumbnail ---------------------------------
        prog.set("Captions", 82)
        out_w, _ = media.dimensions(finished)
        duration = media.duration_seconds(finished)
        cues = caps.timings(text, duration)
        srt_path = work / "captions.srt"
        srt_path.write_text(caps.to_srt(cues), encoding="utf-8")

        watermark = bool(workspace.watermark_enabled and workspace.plan == "free")
        ai_label = bool(workspace.ai_label_enabled)
        brand = workspace.brand_kit or {}
        logo_name = None
        if brand.get("show_logo") and brand.get("logo_key") and workspace.plan != "free" and not is_preview:
            try:
                logo_path = storage.get_to_file(brand["logo_key"], work / f"logo{Path(brand['logo_key']).suffix}")
                logo_name = logo_path.name
            except Exception:  # noqa: BLE001
                logo_name = None
        plain_out = work / "final.mp4"
        try:
            _encode_with_overlays(finished, plain_out, _ffmpeg_overlay_filters(out_w, watermark, ai_label, None, brand),
                                  work, logo_name)
        except media.MediaError as e:
            log.warning("Overlay pass failed (%s); shipping the clean file", str(e)[:200])
            shutil.copyfile(finished, plain_out)
            watermark = ai_label = False
        prog.set("Captions", 88)
        captioned_out: Path | None = None
        if video.captions and cues:
            captioned_out = work / "final_captions.mp4"
            try:
                _encode_with_overlays(finished, captioned_out,
                                      _ffmpeg_overlay_filters(out_w, watermark, ai_label, srt_path.name, brand),
                                      work, logo_name)
            except media.MediaError as e:
                log.warning("Caption burn-in failed: %s", str(e)[:300])
                captioned_out = None
        thumb = work / "thumb.jpg"
        media.thumbnail(plain_out, thumb, min(1.0, duration / 2))
        prog.set("Captions", 94)
        prog.check_cancel()

        # 8 Publish and charge ----------------------------------------------------
        prefix = video.storage_prefix
        if is_preview:
            key = f"{prefix}/preview.mp4"
            storage.put_file(key, captioned_out or plain_out, "video/mp4")
            video.preview_key = key
            video.preview_status = "ready"
            video.preview_progress = 100
            if not video.thumbnail_key:
                storage.put_file(f"{prefix}/thumb.jpg", thumb, "image/jpeg")
                video.thumbnail_key = f"{prefix}/thumb.jpg"
            db.commit()
            events.emit(db, video.workspace_id, "preview.ready", events.video_payload(video))
            finish_job(db, job, "succeeded", result={"preview_key": key, "seconds": round(duration, 1)})
            prog.set("Done", 100, 0)
            return

        storage.put_file(f"{prefix}/final.mp4", plain_out, "video/mp4")
        storage.put_file(f"{prefix}/captions.srt", srt_path, "text/plain")
        storage.put_file(f"{prefix}/thumb.jpg", thumb, "image/jpeg")
        if captioned_out:
            storage.put_file(f"{prefix}/final_captions.mp4", captioned_out, "video/mp4")
        video.output_key = f"{prefix}/final.mp4"
        video.output_captioned_key = f"{prefix}/final_captions.mp4" if captioned_out else None
        video.srt_key = f"{prefix}/captions.srt"
        video.thumbnail_key = f"{prefix}/thumb.jpg"
        video.duration_s = round(duration, 2)
        video.transcript = video.script
        video.watermarked, video.ai_labelled = watermark, ai_label
        video.resolved_engine = engine_mode
        video.summary = _summary(video.script)

        # The only place a charge is written. Idempotent per job.
        entry = credits.charge(db, video.workspace_id, charge_credits, video.id, job.id,
                               f"{video.title[:60]} · {est.seconds}s · {engine_mode} · {video.quality}")
        video.charged_credits = abs(entry.amount) if entry else 0
        video.status, video.completed_at, video.error_message = "succeeded", datetime.now(timezone.utc), None
        events.emit(db, video.workspace_id, "video.succeeded", events.video_payload(video))
        db.commit()
        notify_user(db, video.created_by, "video_ready", [video.title[:60]], f"{settings.web_base_url}/videos/{video.id}")
        storage.delete_prefix(f"{prefix}/scratch")
        finish_job(db, job, "succeeded", result={"output_key": video.output_key, "credits": video.charged_credits,
                                                 "gpu_seconds": result.gpu_seconds, "quality_score": video.quality_score,
                                                 "quality_method": video.quality_method, "seed": video.render_seed,
                                                 "attempts": video.render_attempts})
        prog.set("Done", 100, 0)

    except Cancelled:
        db.rollback()
        job = db.get(Job, job.id)
        video = db.get(Video, job.video_id) if job.video_id else None
        if video is not None:
            if is_preview:
                video.preview_status = "none"
            else:
                video.status, video.stage, video.progress, video.eta_seconds = "cancelled", "Cancelled", 0, None
                events.emit(db, video.workspace_id, "video.cancelled", events.video_payload(video))
        finish_job(db, job, "cancelled", "Cancelled by you. Nothing was charged.")
    except RenderFailed as e:
        _fail(db, job, is_preview, str(e))
    except media.MediaError as e:
        log.error("ffmpeg error in job %s: %s", job.id, e)
        _fail(db, job, is_preview, "The video could not be put together. Nothing was charged. Try again in a minute.")
    except Exception as e:  # noqa: BLE001
        log.exception("Unexpected error in job %s", job.id)
        _fail(db, job, is_preview, f"Something went wrong on our side ({type(e).__name__}). Nothing was charged.")
    finally:
        # Hard rule 2: the worker never keeps user media between jobs.
        shutil.rmtree(work, ignore_errors=True)


def _fail(db: Session, job: Job, is_preview: bool, message: str) -> None:
    db.rollback()
    job = db.get(Job, job.id)
    video = db.get(Video, job.video_id) if job.video_id else None
    if video is not None:
        if is_preview:
            video.preview_status = "failed"
        else:
            video.status, video.stage, video.error_message = "failed", "Failed", message
            video.eta_seconds = None
            events.emit(db, video.workspace_id, "video.failed", events.video_payload(video))
            notify_user(db, video.created_by, "video_failed", [video.title[:60], message[:120]])
    finish_job(db, job, "failed", message)


def _summary(script: str) -> str | None:
    try:
        res = llm.complete("summary", {"transcript": script[:6000]}, tier="haiku", max_tokens=120)
        return None if res.refused else res.text[:400]
    except Exception:
        return None


# --- identity verification -----------------------------------------------------
def run_verify_identity(db: Session, job: Job) -> None:
    storage = get_storage()
    work = Path(settings.work_dir) / job.id
    work.mkdir(parents=True, exist_ok=True)
    try:
        identity = db.get(Identity, job.payload.get("identity_id"))
        if not identity or identity.workspace_id != job.workspace_id:
            finish_job(db, job, "failed", "Avatar not found.")
            return
        if not identity.reference_key:
            finish_job(db, job, "failed", "No recording to verify.")
            return
        job.stage, job.progress = "Checking recording", 20
        db.commit()
        ref = storage.get_to_file(identity.reference_key, work / "reference.mp4")
        consent = None
        if identity.consent_key and identity.consent_key != identity.reference_key:
            consent = storage.get_to_file(identity.consent_key, work / "consent.mp4")
        look_keys = [l.media_key for l in db.scalars(select(Look).where(Look.identity_id == identity.id)).all() if l.kind == "photo"]
        result = get_verifier(look_keys).verify(ref, consent)
        identity.consent_method = result.method
        identity.consent_notes = result.reason
        identity.reference_duration_s = round(result.duration_s, 2) if result.duration_s else None
        if result.ok:
            identity.consent_status = "verified"
            identity.consent_verified_at = datetime.now(timezone.utc)
            identity.status = "ready"
            thumb = work / "thumb.jpg"
            try:
                media.thumbnail(ref, thumb, 1.0)
                key = f"{identity.storage_prefix}/thumbnail.jpg"
                storage.put_file(key, thumb, "image/jpeg")
                identity.thumbnail_key = key
            except media.MediaError:
                pass
            events.emit(db, identity.workspace_id, "identity.verified", {"identity_id": identity.id, "name": identity.name})
            db.commit()
            finish_job(db, job, "succeeded", result={"duration_s": result.duration_s})
        else:
            identity.consent_status = "rejected"
            events.emit(db, identity.workspace_id, "identity.rejected", {"identity_id": identity.id, "name": identity.name,
                                                                        "reason": result.reason})
            has_looks = db.scalar(select(Look.id).where(Look.identity_id == identity.id)) is not None
            identity.status = "ready" if has_looks else "draft"  # photo mode can still work
            db.commit()
            finish_job(db, job, "succeeded", result={"ok": False, "reason": result.reason})
    except Exception as e:  # noqa: BLE001
        log.exception("verify_identity failed")
        db.rollback()
        job = db.get(Job, job.id)
        identity = db.get(Identity, job.payload.get("identity_id"))
        if identity:
            identity.consent_status = "rejected"
            identity.consent_notes = "We could not read that recording. Record again."
            identity.status = "draft"
        finish_job(db, job, "failed", str(e)[:300])
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _run_engine_trial(db, job):
    from app.worker.lab import run_engine_trial

    run_engine_trial(db, job)


def _run_train_style(db, job):
    from app.worker.v2 import run_train_style

    run_train_style(db, job)


def _run_generate_look(db, job):
    from app.worker.v2 import run_generate_look

    run_generate_look(db, job)


def _run_clip(db, job):
    from app.worker.v3 import run_clip

    run_clip(db, job)


HANDLERS = {
    "engine_trial": _run_engine_trial,
    "render": lambda db, job: run_render(db, job, is_preview=False),
    "preview": lambda db, job: run_render(db, job, is_preview=True),
    "verify_identity": run_verify_identity,
    "train_style": _run_train_style,
    "generate_look": _run_generate_look,
    "clip": _run_clip,
}
