# Architecture

```
 phone / desktop browser
        │  HTTPS
        ▼
 apps/web (Next.js)  ──►  apps/api (FastAPI)  ──►  Postgres (tenant data, credits ledger, job queue)
                                │                   Redis (optional: progress fan-out, rate limits)
                                │                   Storage: R2 (prod) / local disk (dev)
                                ▼
                        apps/api worker (python -m app.worker)
                                │   steps 1–4, 7, 8 on the VPS (ffmpeg)
                                ▼
                        apps/gpu on RunPod serverless (steps 5–6)
```

## Request path for one video

1. **Create screen** calls `POST /videos/estimate` on every edit (debounced). The response carries seconds, credits, rupees, balance, guardrail hits and blockers. Generate stays disabled until it is clean (hard rule 4).
2. `POST /videos` stores a draft. `POST /videos/{id}/preview` queues a free job; `POST /videos/{id}/generate` re-checks consent, guardrails and balance, then queues a render job. Nothing is charged.
3. The **worker** claims the job with an atomic `UPDATE … WHERE status='queued'`, then runs `pipeline.run_render()`:
   voice (TTS adapter) → prepare (motion prompt from `prompts/motion.v1.md`, fetch look/reference) → avatar (engine adapter) → sharpen (1080p/4K only) → captions/watermark/label/thumbnail (ffmpeg) → publish + `credits.charge()`.
   Progress, stage and ETA are written to the `videos` row after every step; the UI polls `GET /videos/{id}` every 2 seconds.
4. Failure or cancel at any step marks the job and the video with a plain-English reason and writes no ledger row. The working folder is removed in `finally`.

## Consistency (how renders stay recognisably you)

1. **Real pixels first.** Real-footage mode redraws only the mouth and jaw on the user's own clip, so identity, hands and lighting cannot drift.
2. **Per-avatar style file.** A LoRA trained on 2–10 minutes of the user's footage teaches the engine how they move.
3. **Pinned seed.** `Identity.render_seed` is fixed at creation; every render starts from it, retries step it by one.
4. **Quality gate.** `adapters/quality` compares the output face with the reference (InsightFace on the GPU, frame proxy locally). Below threshold → one re-render → fail without charge. Score, method, seed and GPU image tag are stored on the video.
5. **Golden regression set.** Engine Lab trials marked golden are rerun after any engine or settings change; `/lab/golden` flags quality or time regressions before a change becomes the default.
6. **Monthly blind panel** against HeyGen Avatar V through the Engine Lab.

## Tenancy and privacy

- `WorkspaceScoped` mixin → `workspace_id` on every tenant table, indexed. `Ctx` resolves the caller's workspace from the membership table; routers never trust ids in the body without re-checking the workspace.
- Storage keys always start with `ws/{workspace_id}/`. Presign refuses other prefixes; the worker downloads only the keys named in its job.
- BYO ElevenLabs keys are Fernet-encrypted with `SECRET_KEY`.
- Deleting an identity deletes `ws/{ws}/identities/{id}/` (clip, consent, looks, style file).

## Adapters (hard rule 10)

| Seam | Interface | Implementations |
| --- | --- | --- |
| Storage | `adapters/storage/base.Storage` | `LocalStorage`, `R2Storage` |
| Voice | `adapters/voice/base.VoiceEngine` | `mock`, `sapi` (Windows dev), `elevenlabs`, `sarvam` |
| Avatar | `adapters/avatar/base.AvatarEngine` | `MockAvatarEngine` (ffmpeg), `RunPodAvatarEngine` → `apps/gpu/handler.py` |
| LLM | `adapters/llm.complete(prompt_name, vars, tier)` | Anthropic SDK; deterministic offline fallback |
| Consent | `adapters/face.ConsentVerifier` | `BasicVerifier` (v1); face match (v2) |

## Credits

`credit_entries` is append-only; balance = `SUM(amount)`. Kinds: grant, topup, charge, refund, adjust. A charge row is unique per `(job_id, kind)`, so a retried job cannot charge twice. The estimate table from PRD section 9 lives in `services/estimate.py`.

## Why the queue is in the database

The charge and the job's final state must commit together, and a worker crash must leave a queued job, not a lost one. A DB-backed queue with an atomic claim gives both with no extra moving parts. Redis is reserved for fan-out (live progress over SSE/WebSocket) when polling becomes expensive.
