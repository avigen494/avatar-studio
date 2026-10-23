"""
Engine Lab (Stage 0). Admin-only.

Run one fixed input set (script, voice, photo, optional real clip) through
each candidate engine, record wall time, GPU time and cost, collect blind
panel scores, and export docs/STAGE0_RESULTS.md. Trials never touch credits.
"""
from __future__ import annotations

from datetime import datetime
from statistics import mean

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.adapters.storage import get_storage
from app.deps import ApiError, Ctx
from app.models.platform import EngineTrial
from app.models.voices import Voice
from app.services.admin import require_admin
from app.services.jobs import enqueue
from app.services.runtime_config import cfg, refresh, set_values
from app.services.serializers import url_for

router = APIRouter(prefix="/lab", tags=["lab"])

ENGINES = {
    "wan_s2v": "Wan2.2-S2V-14B (photo)",
    "infinitetalk": "InfiniteTalk (photo)",
    "infinitetalk_v2v": "InfiniteTalk V2V (real footage)",
    "latentsync": "LatentSync 1.6 (mouth only)",
    "mock": "ffmpeg mock (local check)",
    "heygen_v": "HeyGen Avatar V (benchmark upload)",
}
CRITERIA = ("lipsync", "motion", "identity", "overall")


class TrialIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    engine: str
    script: str = Field(default="", max_length=5000)
    voice_id: str | None = None
    look_key: str | None = None
    reference_key: str | None = None
    aspect: str = "9:16"
    steps: int = Field(default=20, ge=4, le=60)
    notes: str = ""
    benchmark_key: str | None = None  # for engine == heygen_v: the uploaded HeyGen video


class ScoreIn(BaseModel):
    rater: str = Field(min_length=1, max_length=40)
    lipsync: int = Field(ge=1, le=5)
    motion: int = Field(ge=1, le=5)
    identity: int = Field(ge=1, le=5)
    overall: int = Field(ge=1, le=5)
    guessed_heygen: bool = False


class TrialOut(BaseModel):
    id: str
    name: str
    engine: str
    engine_label: str
    gpu: str
    status: str
    script: str
    voice_id: str | None
    aspect: str
    steps: int
    output_url: str | None
    thumbnail_url: str | None
    look_url: str | None
    reference_url: str | None
    duration_s: float | None
    wall_seconds: float | None
    gpu_seconds: float | None
    cost_inr: float | None
    cost_per_minute_inr: float | None
    vram_gb: float | None
    error: str | None
    notes: str
    is_benchmark: bool
    is_golden: bool = False
    golden_of: str | None = None
    quality_score: float | None = None
    quality_method: str | None = None
    seed: int | None = None
    engine_version: str | None = None
    scores: list[dict]
    averages: dict[str, float | None]
    created_at: datetime


class SummaryRow(BaseModel):
    engine: str
    engine_label: str
    trials: int
    scored: int
    avg: dict[str, float | None]
    panel_avg: float | None
    cost_per_minute_inr: float | None
    wall_seconds_per_minute: float | None
    guessed_heygen: int
    verdict: str


class SummaryOut(BaseModel):
    rows: list[SummaryRow]
    recommended_photo_engine: str | None
    current_default: str
    gpu: str
    gpu_price_inr_per_hour: float


def _avgs(scores: list[dict]) -> dict[str, float | None]:
    out: dict[str, float | None] = {}
    for c in CRITERIA:
        vals = [s[c] for s in scores if isinstance(s.get(c), (int, float))]
        out[c] = round(mean(vals), 2) if vals else None
    both = [v for v in out.values() if v is not None]
    out["panel"] = round(mean(both), 2) if both else None
    return out


def _out(t: EngineTrial) -> TrialOut:
    cpm = round(t.cost_inr / (t.duration_s / 60), 1) if t.cost_inr and t.duration_s else None
    return TrialOut(
        id=t.id, name=t.name, engine=t.engine, engine_label=ENGINES.get(t.engine, t.engine), gpu=t.gpu,
        status=t.status, script=t.script, voice_id=t.voice_id, aspect=t.aspect, steps=t.steps,
        output_url=url_for(t.output_key), thumbnail_url=url_for(t.thumbnail_key), look_url=url_for(t.look_key),
        reference_url=url_for(t.reference_key), duration_s=t.duration_s, wall_seconds=t.wall_seconds,
        gpu_seconds=t.gpu_seconds, cost_inr=t.cost_inr, cost_per_minute_inr=cpm, vram_gb=t.vram_gb, error=t.error,
        notes=t.notes, is_benchmark=t.is_benchmark, is_golden=bool(t.is_golden), golden_of=t.golden_of,
        quality_score=t.quality_score, quality_method=t.quality_method, seed=t.seed, engine_version=t.engine_version,
        scores=t.scores or [], averages=_avgs(t.scores or []), created_at=t.created_at,
    )


async def _get(ctx: Ctx, trial_id: str) -> EngineTrial:
    t = await ctx.db.scalar(select(EngineTrial).where(EngineTrial.id == trial_id, EngineTrial.workspace_id == ctx.workspace.id))
    if not t:
        raise ApiError(404, "not_found", "That trial does not exist.")
    return t


@router.get("/engines")
async def engines(ctx: Ctx = Depends(require_admin)) -> dict:
    backend = cfg("avatar_engine_backend") or "mock"
    return {
        "engines": [{"id": k, "label": v, "runs_on": "upload" if k == "heygen_v" else ("local" if k == "mock" else "runpod")}
                    for k, v in ENGINES.items()],
        "backend": backend,
        "gpu": cfg("gpu_name"),
        "gpu_price_inr_per_hour": float(cfg("gpu_price_inr_per_hour") or 95),
        "note": None if backend == "runpod" else "RunPod is not connected: GPU engines will run through the ffmpeg mock. Connect RunPod in Settings → Connections for real results.",
    }


@router.get("/trials", response_model=list[TrialOut])
async def list_trials(ctx: Ctx = Depends(require_admin)) -> list[TrialOut]:
    rows = (await ctx.db.scalars(
        select(EngineTrial).where(EngineTrial.workspace_id == ctx.workspace.id).order_by(EngineTrial.created_at.desc())
    )).all()
    return [_out(t) for t in rows]


@router.post("/trials", response_model=TrialOut, status_code=202)
async def create_trial(body: TrialIn, ctx: Ctx = Depends(require_admin)) -> TrialOut:
    if body.engine not in ENGINES:
        raise ApiError(400, "bad_engine", "Unknown engine.")
    storage = get_storage()
    ws = ctx.workspace.id
    for key in (body.look_key, body.reference_key, body.benchmark_key):
        if key and (not key.startswith(f"ws/{ws}/") or not storage.exists(key)):
            raise ApiError(400, "upload_missing", "One of the files was not uploaded. Try again.")

    t = EngineTrial(workspace_id=ws, name=body.name.strip(), engine=body.engine, script=body.script.strip(),
                    voice_id=body.voice_id, look_key=body.look_key, reference_key=body.reference_key,
                    aspect=body.aspect, steps=body.steps, notes=body.notes, gpu=cfg("gpu_name") or "")
    if body.engine == "heygen_v":
        if not body.benchmark_key:
            raise ApiError(400, "benchmark_missing", "Upload the HeyGen video for the benchmark.")
        from app.services import media  # local probe for duration

        t.is_benchmark, t.status, t.output_key, t.gpu = True, "succeeded", body.benchmark_key, "HeyGen"
        try:
            import tempfile
            from pathlib import Path

            with tempfile.TemporaryDirectory() as tmp:
                p = storage.get_to_file(body.benchmark_key, Path(tmp) / "bench.mp4")
                t.duration_s = round(media.duration_seconds(p), 2)
                thumb = Path(tmp) / "thumb.jpg"
                media.thumbnail(p, thumb, 1.0)
                storage.put_file(f"ws/{ws}/lab/{t.id}/thumb.jpg", thumb, "image/jpeg")
                t.thumbnail_key = f"ws/{ws}/lab/{t.id}/thumb.jpg"
        except Exception:
            pass
        ctx.db.add(t)
        await ctx.db.commit()
        return _out(t)

    if not body.script:
        raise ApiError(400, "script_required", "Add the test script.")
    if not body.voice_id or not await ctx.db.scalar(select(Voice.id).where(Voice.id == body.voice_id, Voice.workspace_id == ws)):
        raise ApiError(400, "voice_required", "Pick a voice.")
    if body.engine in ("infinitetalk_v2v", "latentsync") and not body.reference_key:
        raise ApiError(400, "reference_required", "This engine needs the real clip.")
    if body.engine in ("wan_s2v", "infinitetalk", "mock") and not body.look_key and not body.reference_key:
        raise ApiError(400, "look_required", "Upload the photo.")
    ctx.db.add(t)
    await ctx.db.flush()
    await enqueue(ctx.db, ws, "engine_trial", {"trial_id": t.id})
    await ctx.db.commit()
    return _out(t)


@router.post("/trials/{trial_id}/scores", response_model=TrialOut)
async def add_score(trial_id: str, body: ScoreIn, ctx: Ctx = Depends(require_admin)) -> TrialOut:
    t = await _get(ctx, trial_id)
    scores = [s for s in (t.scores or []) if s.get("rater") != body.rater]  # one score per rater
    scores.append(body.model_dump())
    t.scores = scores
    await ctx.db.commit()
    return _out(t)


@router.delete("/trials/{trial_id}", status_code=204)
async def delete_trial(trial_id: str, ctx: Ctx = Depends(require_admin)) -> None:
    t = await _get(ctx, trial_id)
    await ctx.db.delete(t)
    await ctx.db.commit()
    get_storage().delete_prefix(f"ws/{ctx.workspace.id}/lab/{trial_id}")


class GoldenIn(BaseModel):
    is_golden: bool = True


@router.put("/trials/{trial_id}/golden", response_model=TrialOut)
async def set_golden(trial_id: str, body: GoldenIn, ctx: Ctx = Depends(require_admin)) -> TrialOut:
    """Keep this trial as a regression baseline. Golden trials are rerun by /lab/golden/rerun."""
    t = await _get(ctx, trial_id)
    if t.is_benchmark:
        raise ApiError(400, "benchmark", "The HeyGen benchmark is already the reference; mark engine trials instead.")
    t.is_golden = body.is_golden
    await ctx.db.commit()
    return _out(t)


@router.post("/golden/rerun", response_model=list[TrialOut], status_code=202)
async def rerun_golden(ctx: Ctx = Depends(require_admin)) -> list[TrialOut]:
    """Rerun every golden trial with today's engines and settings. Compare in /lab/golden."""
    golden = (await ctx.db.scalars(select(EngineTrial).where(EngineTrial.workspace_id == ctx.workspace.id,
                                                             EngineTrial.is_golden.is_(True)))).all()
    if not golden:
        raise ApiError(404, "no_golden", "Mark at least one trial as golden first.")
    out = []
    for g in golden:
        t = EngineTrial(workspace_id=ctx.workspace.id, name=f"{g.name} · regression {datetime.utcnow():%d %b %H:%M}",
                        engine=g.engine, script=g.script, voice_id=g.voice_id, look_key=g.look_key, reference_key=g.reference_key,
                        aspect=g.aspect, steps=g.steps, notes="golden rerun", gpu=cfg("gpu_name") or "", golden_of=g.id, seed=g.seed)
        ctx.db.add(t)
        await ctx.db.flush()
        await enqueue(ctx.db, ctx.workspace.id, "engine_trial", {"trial_id": t.id})
        out.append(t)
    await ctx.db.commit()
    return [_out(t) for t in out]


@router.get("/golden")
async def golden_report(ctx: Ctx = Depends(require_admin)) -> dict:
    """Baseline vs latest rerun per golden trial: quality score, wall time, cost per minute."""
    golden = (await ctx.db.scalars(select(EngineTrial).where(EngineTrial.workspace_id == ctx.workspace.id,
                                                             EngineTrial.is_golden.is_(True)).order_by(EngineTrial.created_at))).all()
    rows = []
    for g in golden:
        latest = await ctx.db.scalar(select(EngineTrial).where(EngineTrial.golden_of == g.id, EngineTrial.status == "succeeded")
                                     .order_by(EngineTrial.created_at.desc()))
        pending = await ctx.db.scalar(select(func.count(EngineTrial.id)).where(EngineTrial.golden_of == g.id,
                                                                               EngineTrial.status.in_(["queued", "running"])))

        def cpm(t):
            return round(t.cost_inr / (t.duration_s / 60), 1) if t and t.cost_inr and t.duration_s else None

        def verdict():
            if latest is None:
                return "not rerun yet"
            if latest.quality_score is not None and g.quality_score is not None and latest.quality_score < g.quality_score - 0.05:
                return "worse: quality dropped"
            if latest.wall_seconds and g.wall_seconds and latest.wall_seconds > g.wall_seconds * 1.5:
                return "worse: much slower"
            return "ok"

        rows.append({
            "golden": _out(g).model_dump(mode="json"), "latest": _out(latest).model_dump(mode="json") if latest else None,
            "pending_reruns": int(pending or 0), "quality_delta": (round(latest.quality_score - g.quality_score, 3)
                                                                  if latest and latest.quality_score is not None and g.quality_score is not None else None),
            "wall_delta_s": (round(latest.wall_seconds - g.wall_seconds, 1) if latest and latest.wall_seconds and g.wall_seconds else None),
            "cost_per_minute": {"golden": cpm(g), "latest": cpm(latest)}, "verdict": verdict(),
        })
    return {"rows": rows, "count": len(rows), "regressions": sum(1 for r in rows if r["verdict"].startswith("worse"))}


@router.post("/trials/{trial_id}/rerun", response_model=TrialOut, status_code=202)
async def rerun(trial_id: str, ctx: Ctx = Depends(require_admin)) -> TrialOut:
    t = await _get(ctx, trial_id)
    if t.is_benchmark:
        raise ApiError(400, "benchmark", "The benchmark is an upload; nothing to rerun.")
    t.status, t.error, t.output_key = "queued", None, None
    t.wall_seconds = t.gpu_seconds = t.cost_inr = None
    await enqueue(ctx.db, ctx.workspace.id, "engine_trial", {"trial_id": t.id})
    await ctx.db.commit()
    return _out(t)


async def _summary(ctx: Ctx) -> SummaryOut:
    rows = (await ctx.db.scalars(select(EngineTrial).where(EngineTrial.workspace_id == ctx.workspace.id))).all()
    by: dict[str, list[EngineTrial]] = {}
    for t in rows:
        by.setdefault(t.engine, []).append(t)
    out: list[SummaryRow] = []
    for engine, ts in by.items():
        all_scores = [s for t in ts for s in (t.scores or [])]
        av = _avgs(all_scores)
        ok = [t for t in ts if t.status == "succeeded" and t.duration_s]
        cpm = [t.cost_inr / (t.duration_s / 60) for t in ok if t.cost_inr]
        wpm = [t.wall_seconds / (t.duration_s / 60) for t in ok if t.wall_seconds]
        panel = av["panel"]
        verdict = "not scored"
        if panel is not None:
            verdict = "drop (< 3.0)" if panel < 3.0 else "usable for Reels" if panel < 3.8 else \
                "moves like the user" if panel < 4.2 else "hard to tell from HeyGen"
        out.append(SummaryRow(
            engine=engine, engine_label=ENGINES.get(engine, engine), trials=len(ts), scored=len(all_scores),
            avg={c: av[c] for c in CRITERIA}, panel_avg=panel,
            cost_per_minute_inr=round(mean(cpm), 1) if cpm else None,
            wall_seconds_per_minute=round(mean(wpm), 1) if wpm else None,
            guessed_heygen=sum(1 for s in all_scores if s.get("guessed_heygen")), verdict=verdict,
        ))
    photo = [r for r in out if r.engine in ("wan_s2v", "infinitetalk") and r.panel_avg is not None]
    rec = None
    if photo:
        photo.sort(key=lambda r: (-(r.panel_avg or 0), r.cost_per_minute_inr or 1e9))
        rec = photo[0].engine
    return SummaryOut(rows=sorted(out, key=lambda r: -(r.panel_avg or -1)), recommended_photo_engine=rec,
                      current_default=cfg("default_engine_photo") or "wan_s2v", gpu=cfg("gpu_name") or "",
                      gpu_price_inr_per_hour=float(cfg("gpu_price_inr_per_hour") or 95))


@router.get("/summary", response_model=SummaryOut)
async def summary(ctx: Ctx = Depends(require_admin)) -> SummaryOut:
    return await _summary(ctx)


@router.post("/adopt/{engine}")
async def adopt(engine: str, ctx: Ctx = Depends(require_admin)) -> dict:
    """Make the winning photo engine the default for every render."""
    if engine not in ("wan_s2v", "infinitetalk"):
        raise ApiError(400, "bad_engine", "Only wan_s2v or infinitetalk can be the photo-mode default.")
    await ctx.db.run_sync(set_values, {"default_engine_photo": engine}, ctx.user.id)
    await ctx.db.commit()
    refresh(force=True)
    return {"default_engine_photo": engine}


@router.get("/results.md", response_class=PlainTextResponse)
async def results_markdown(ctx: Ctx = Depends(require_admin)) -> str:
    """The content of docs/STAGE0_RESULTS.md."""
    s = await _summary(ctx)
    trials = (await ctx.db.scalars(
        select(EngineTrial).where(EngineTrial.workspace_id == ctx.workspace.id).order_by(EngineTrial.created_at)
    )).all()
    lines = [
        "# Stage 0 results", "",
        f"Generated {datetime.utcnow():%Y-%m-%d %H:%M} UTC · GPU {s.gpu or 'n/a'} at ₹{s.gpu_price_inr_per_hour:.0f}/hour · "
        f"current photo-mode default `{s.current_default}`", "",
        "## Summary by engine", "",
        "| Engine | Trials | Scores | Lip sync | Motion | Identity | Overall | Panel avg | ₹/min | Wall s per min | Guessed as HeyGen | Verdict |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in s.rows:
        f = lambda v: "–" if v is None else (f"{v:.2f}" if isinstance(v, float) else str(v))  # noqa: E731
        lines.append(f"| {r.engine_label} | {r.trials} | {r.scored} | {f(r.avg['lipsync'])} | {f(r.avg['motion'])} | "
                     f"{f(r.avg['identity'])} | {f(r.avg['overall'])} | {f(r.panel_avg)} | {f(r.cost_per_minute_inr)} | "
                     f"{f(r.wall_seconds_per_minute)} | {r.guessed_heygen} | {r.verdict} |")
    lines += ["", "## Decision", ""]
    if s.recommended_photo_engine:
        lines.append(f"Recommended photo-mode engine: **{s.recommended_photo_engine}** (highest panel average; ties broken by cost per minute).")
    else:
        lines.append("No photo-mode engine has panel scores yet.")
    lines += ["", "## Trials", "", "| Name | Engine | GPU | Status | Length s | Wall s | GPU s | Cost ₹ | Panel | Notes |",
              "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for t in trials:
        av = _avgs(t.scores or [])
        g = lambda v: "–" if v is None else (f"{v:.1f}" if isinstance(v, float) else str(v))  # noqa: E731
        lines.append(f"| {t.name} | {t.engine} | {t.gpu} | {t.status} | {g(t.duration_s)} | {g(t.wall_seconds)} | "
                     f"{g(t.gpu_seconds)} | {g(t.cost_inr)} | {g(av['panel'])} | {t.notes or ''} |")
    return "\n".join(lines) + "\n"
