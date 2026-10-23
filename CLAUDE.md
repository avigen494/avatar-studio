# Avatar Studio — working notes for Claude Code

Read `PRD.md` first. It is the contract. This file holds what the code base
assumes and what we have learned; update it at the end of every feature.

## Layout

```
PRD.md                     product contract (sections 3 and 10 are hard-coded rules)
prompts/                   versioned prompt files; code fills {{vars}} only
apps/api/                  FastAPI + SQLAlchemy 2 + Alembic; also the render worker
  app/models/              every tenant table mixes in WorkspaceScoped
  app/routers/             one file per resource; errors are {"error": {code, message}}
  app/services/            estimate, credits (sync, used by API via run_sync), guardrails, prompts, captions, media
  app/adapters/            storage (local, r2) · voice (mock, sapi, elevenlabs, sarvam) · avatar (mock, runpod) · llm · face
  app/worker/              DB-backed job queue, pipeline.py = the 8-step render chain
  tests/                   pytest; real ffmpeg, mock engines, temp SQLite
apps/web/                  Next.js 16 App Router, phone-first (390 px), Tailwind v4
apps/gpu/                  RunPod serverless handler + Dockerfile (Wan2.2 S2V, InfiniteTalk, LatentSync, finish pass)
docs/plans/                one plan file per feature; docs/STAGE0_RUNSHEET.md for the engine bake-off
docker-compose.yml         Postgres + Redis + api + worker + web on one VPS
```

## Run locally (no keys needed)

```powershell
# API
cd apps/api; python -m venv .venv; .\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
# Worker (second terminal)
cd apps/api; .\.venv\Scripts\python -m app.worker
# Web (third terminal)
cd apps/web; pnpm install; pnpm dev
# Tests
cd apps/api; .\.venv\Scripts\python -m pytest -q
```

Dev auth: the web app sends `X-Dev-User-Email`; curl with `-H "X-Dev-User-Email: you@example.com"`.
Set `VOICE_ENGINE_DEFAULT=sapi` on Windows to hear real speech without any API key.

## Rules the code enforces (do not loosen)

1. Every tenant query filters by `workspace_id`; routers get it from `Ctx`.
2. Credits are written only by `credits.charge()` inside `worker/pipeline.py` step 8, after success. Unique `(job_id, kind)` stops double charges.
3. Estimate is computed in `services/estimate.py` from the PRD table and shown before Generate (`POST /videos/estimate`).
4. A real-person identity renders only when `consent_status == "verified"` (checked in the router AND the worker).
5. Previews: 480p, 15 s, never charged, skip the Sharpen step.
6. Prompts come from `/prompts/<name>.v<N>.md` via `services/prompts.render()`; never inline strings.
7. Workers delete their working folder in `finally` and never cache style files.
8. Engines are adapters. Adding one = one new file + registry entry; the UI does not change.
9. Only commercial-licence models in `apps/gpu`. CodeFormer is non-commercial, so the finish pass uses GFPGAN.
10. Consistency gate: after step 5 the output face must match the reference (`adapters/quality`; InsightFace on the GPU, a frame-similarity proxy locally). A failed check re-renders with the next seed, then fails without charging. Every avatar has a pinned `render_seed`; retries step it by one. Golden Lab trials are the regression baseline (`/lab/golden`).

## Runtime configuration (Connections)

Service keys are read through `services/runtime_config.cfg("...")`, never from `settings` directly. The admin edits them in Settings → Connections (`routers/admin.py`); values live encrypted in `platform_settings` and are cached 15 seconds, so a pasted key is used by the next render without a restart. `.env` values remain the fallback. The platform admin is `ADMIN_EMAILS` (set it in `.env`; the seed and browser tests create accounts first, so the "first user" fallback picks a test account on a dev database) or, when unset, the first user ever created.

## Engine Lab (Stage 0)

`routers/lab.py` + `worker/lab.py`. Trials bypass credits, render on the engine named in the trial, and record wall time, GPU seconds and cost from `gpu_price_inr_per_hour`. `GET /lab/results.md` is the content of `docs/STAGE0_RESULTS.md`; `POST /lab/adopt/{engine}` sets `default_engine_photo`.

## v3 building blocks

- Plans and prices: `services/plans.py` (the only place with numbers). Billing rules: `services/billing.py` (`apply_event` turns any provider event into plan/credit/invoice changes; idempotent per provider payment id). Providers: `adapters/payments/{razorpay,stripe,mock}.py`. Payment webhooks: `POST /webhooks/payments/{provider}`.
- Teams: `routers/team.py`. Roles owner/admin/editor/viewer; `IsAdmin` = owner or admin. Per-avatar access = `Identity.allowed_user_ids` checked by `ensure_identity_access` on create/preview/generate.
- Developer surface: `routers/developer.py` (API keys, webhooks), `services/events.emit()` from the worker, `events.deliver_due()` in the worker loop. API keys authenticate in `deps.get_ctx` (`Bearer ask_live_…`) as an editor limited by scopes.

- v3 features: `routers/v3.py` (translate, clip, plan, notification prefs, admin usage), `worker/v3.py` (clip job; translations are ordinary render jobs with `fixed_credits` in the payload), `adapters/stt` (ElevenLabs Scribe / mock), `adapters/notify` (WhatsApp Cloud / mock), `services/usage.py`. Clips and translations carry `source_video_id` and `kind`.

## Conventions

- Plain English in every user-facing string. No "Oops", no jargon, say what to do next.
- Error shape is always `{"error": {"code": "...", "message": "..."}}`; raise `ApiError`.
- New routes: add the Pydantic schema in `app/schemas`, serialise with `services/serializers.py`.
- New job type: add a handler to `pipeline.HANDLERS` and a `JOB_TYPES` entry.
- Definition of done (PRD 11): works on a 390 px phone; no credit moves on failure; tests for the route; copy reviewed; one line in `CHANGELOG.md`.

## Decisions log

- 2026-10-16 Queue lives in Postgres/SQLite (atomic UPDATE claim) rather than Redis so a charge and a job state change commit together. Redis stays for live progress fan-out later.
- 2026-10-16 Caption timing is proportional to word count per sentence (accurate for TTS). Swap `captions.timings()` for a forced aligner when needed.
- 2026-10-16 Consent verification v1 is `BasicVerifier` (length, video+audio). Face match (InsightFace) is the v2 step; the adapter seam is `adapters/face`.
- 2026-10-16 Delivery tags (P3) run only for engines that understand tags (ElevenLabs v3). Sarvam/SAPI get the plain script.
- 2026-10-16 `platform_settings` is the one table without `workspace_id`: deployment-wide service keys. Everything tenant-owned still carries it.
- 2026-10-16 Look generator uses fal.ai Flux Kontext (commercial licence) rather than a self-hosted image model; the mock keeps the exact photo and changes grade and crop so identity cannot drift in dev.
- 2026-10-16 Style training needs at least 120 s of footage (reference clip + uploads); the worker refuses and charges nothing below that.

## Lessons

- Browser checks on this box run with puppeteer-core against the installed Chrome (no Playwright install). Scripts live in the session scratchpad, not the repo.

- `uvicorn --reload` rarely notices file changes on this Windows box (WatchFiles fired once in a whole session). Run the API without `--reload` and restart it (and the worker) after backend edits; `scripts/dev.ps1` windows can simply be closed and rerun.
- SQLite returns naive datetimes even for `DateTime(timezone=True)`. Every model uses `UTCDateTime` from `models/base.py`, which re-attaches UTC so the API always emits `...Z`. Use it for any new datetime column.

- Browser MediaRecorder WebM files have no duration in the container header. `media.duration_seconds()` falls back to decoding the file; the web app also patches the header client-side (`fix-webm-duration`).
- First sign-in can arrive as several parallel requests; `_ensure_user` catches the unique-constraint error and re-selects. The web app still serialises `/me` first.

- FastAPI 0.143 includes routers lazily; `app.routes` shows `_IncludedRouter` objects until `app.openapi()` or the first request. Use `app.openapi()["paths"]` to list routes.
- Windows ffmpeg: pass the SRT as a relative filename with `cwd=work` to the `subtitles=` filter; absolute `D:\` paths break on the colon.
