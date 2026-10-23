# Avatar Studio

A multi-user AI avatar video SaaS that replaces HeyGen: cheaper per minute, charge on success only, free previews, Hinglish voices, phone-first. The product contract is [PRD.md](PRD.md).

## What is in this repo

| Path | What |
| --- | --- |
| `apps/api` | FastAPI API + render worker (Python 3.12+, SQLAlchemy 2, Alembic). Tests included. |
| `apps/web` | Next.js 16 web app, built for a 390 px phone first. |
| `apps/gpu` | RunPod serverless image: Wan2.2 S2V, InfiniteTalk, LatentSync, finish pass, style training, face match. |
| `packages/n8n-nodes-avatar-studio` | n8n community node: create/generate/wait, batch, and a signed webhook trigger. |
| `prompts/` | The seven versioned prompt files (PRD section 10). Code only fills variables. |
| `docs/` | Architecture, v1 plan, Stage 0 run sheet. |
| `docker-compose.yml` | Postgres + Redis + api + worker + web for one VPS. |

## Run it locally in five minutes (no API keys needed)

Requirements: Python 3.12+, Node 22 + pnpm, ffmpeg on PATH.

```powershell
# 1. API
cd apps\api
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000

# 2. Worker (second terminal)
cd apps\api
.\.venv\Scripts\python -m app.worker

# 3. Web (third terminal)
cd apps\web
pnpm install
pnpm dev
```

Or run `scripts\dev.ps1` to open all three. Then open http://localhost:3000, sign in with any email (dev mode), and follow onboarding. Optional: `python scripts\seed.py you@example.com` creates a demo avatar, voice and a queued video.

Without keys the app uses SQLite, local disk storage, a mock voice (silent audio of the right length) and a mock avatar engine (ffmpeg animates your photo). On Windows set `VOICE_ENGINE_DEFAULT=sapi` in `.env` to hear real speech. Add `ELEVENLABS_API_KEY`, `SARVAM_API_KEY`, `ANTHROPIC_API_KEY`, `RUNPOD_*` and `R2_*` as you connect the real services; nothing else changes.

## Tests

```powershell
cd apps\api
.\.venv\Scripts\python -m pytest -q
```

The flow test signs in, creates an avatar with a consent clip, verifies it, runs a free preview, renders a video (charged once), breaks the engine (charged nothing), blocks a banned claim, cancels a queued render and reads the public share page.

## Deploy (one VPS)

```bash
cp .env.example .env   # fill keys, set AUTH_MODE=clerk, STORAGE_BACKEND=r2, AVATAR_ENGINE_BACKEND=runpod
docker compose up -d --build
curl https://your-host/health
```

Build and push `apps/gpu` to a registry and create a RunPod serverless endpoint from it (see `apps/gpu/README.md`).

## What is built (Oct 2026)

- **v1 Private studio**: avatars with consent, voices, create screen, free previews, renders charged on success, captions, share page, credits ledger.
- **Platform**: Settings → Connections (keys stored encrypted, applied live, tested per service) and Engine Lab (Stage 0 bake-off with blind scoring).
- **v2 Quality**: real-footage mode, style training, look generator and look packs, Design with AI, brand kit, glossary, consent face match.
- **v3 SaaS**: plans with Razorpay (UPI, GST invoices) and Stripe, top-ups, team invites and roles, per-avatar access, API keys, idempotency, batch and CSV, webhooks with signed retries, Translate, AI Clipping, Video Agent planner, WhatsApp notifications, admin usage dashboard, n8n node.

Real GPU rendering, payments and notifications switch on when their keys are added in Settings → Connections; until then the mock engines keep every flow working locally.

## Where to read next

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): request path, tenancy, adapters, credits.
- [docs/plans/v1-private-studio.md](docs/plans/v1-private-studio.md): status of every v1 work item.
- [docs/STAGE0_RUNSHEET.md](docs/STAGE0_RUNSHEET.md): how to pick the default GPU engine.
- [docs/API.md](docs/API.md): API keys, batch, webhooks, n8n.
- [docs/plans/v3-saas.md](docs/plans/v3-saas.md): v3 status and the pricing assumptions to confirm.
- [CLAUDE.md](CLAUDE.md): rules the code enforces and lessons learned.
