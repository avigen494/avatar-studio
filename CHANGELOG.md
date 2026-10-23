# Changelog

One line per shipped feature. Newest first.

## Consistency

- 2026-10-23 GPU image: weights moved off the image onto a RunPod network volume (downloaded once by ensure_weights, warmup task); GitHub Actions workflow builds and pushes ghcr.io/<owner>/avatar-gpu; scripts/build-gpu-image.sh for manual builds; scripts/clean_dev_data.py removes test accounts from the dev database.
- 2026-10-23 Web: Consistency row on finished videos (Face match / Frame check badge, attempts, pinned seed) and reference tips when the quality gate fails; render seed on the avatar page; Engine Lab golden set (star toggle with a first-use explainer, Quality line on cards, "Rerun golden set", regression table polling while reruns run).
- 2026-10-23 Quality gate: every render is checked against the reference face before it is accepted or charged (InsightFace `quality_check` task on the GPU image; frame-similarity proxy locally); one automatic re-render with the next seed, then a plain failure with no charge. Seeds pinned per avatar; engine image tag recorded per video. Engine Lab golden set: mark trials golden, rerun them after any change, `/lab/golden` reports quality and time regressions. Gate settings on the RunPod Connections card.

## v3 — SaaS (in progress)

- 2026-10-17 Web: Translate and Clip sheets with a Versions list on the video page, "Plan a video" tab in Help me write (scene list → script, title, aspect), WhatsApp notification prefs in Settings, admin Usage dashboard (/settings/usage, inline-SVG daily chart), Ends on + Resume plan and signed invoice links on Plan & credits, invite `expired` flag on Team. Last "v3" tags removed.
- 2026-10-17 Web: Plan & credits (Razorpay Checkout, mock pay, invoices, seats), Team (invites, roles, seats, workspace switcher, invite page), Developers (API keys, webhooks with deliveries and replay, quick start), Batch from CSV, per-avatar access. Billing: cancelled plans stay visible until they end, Resume, signed invoice links.
- 2026-10-17 n8n community node (packages/n8n-nodes-avatar-studio): Avatar Studio node (video create/generate/wait, estimate, batch, list; avatars, voices, credits) and a signed webhook trigger. Write-scoped API keys can now manage webhooks; GET /webhooks/{id} added.
- 2026-10-17 Features: Translate (P4 with glossary, Indian languages first, 6 credits/min prorated, lip-sync via mouth-only engine), AI Clipping (STT adapter + P9 picker + 9:16 reframe + captions, 1 credit per source minute), Video Agent planner (P5 → editable script), WhatsApp "video ready" notifications (Meta Cloud API, opt-in per user), admin usage dashboard (renders, minutes, credits, p50/p95 cost per minute, paying workspaces).
- 2026-10-17 Developers: scoped API keys (shown once, hashed), Idempotency-Key on POST /videos, batch up to 100 with upfront credit check, CSV import, webhooks with HMAC signatures, retries and replay, events emitted from every job outcome. docs/API.md.
- 2026-10-17 Money and teams: plans (Free/Creator/Pro/Team, INR + USD), Razorpay subscriptions and UPI top-ups, Stripe checkout, GST invoices (HTML), one-month rollover on Creator, cancel at period end, team invites with roles, seat limits, per-avatar access, create and switch workspaces. Razorpay and Stripe cards in Connections.

## v2 — Quality (in progress)

- 2026-10-16 Web: Train my style sheet, Make with AI (prompt, look packs, camera angles), Design with AI for designed avatars, brand kit editor, glossary table, Style on chip on Create. All v2 placeholders removed.
- 2026-10-16 Look packs for Indian niches (coaching, CA/finance, clinic, real estate, retail, wedding, creator) and Design with AI for designed avatars (form → 3 candidates, 2 credits, prompt P8 in prompts/design.v1.md).
- 2026-10-16 Look generator: new look from a prompt (3 variants, 2 credits) and camera angles (3 angles, 6 credits) via fal.ai Flux Kontext, ffmpeg mock offline; prompt P6; charged on success.
- 2026-10-16 Teach it my style: footage uploads, 2-minute minimum, DiffSynth LoRA task on the GPU image, 40 credits on success; style file attached to that avatar's renders only.
- 2026-10-16 Brand kit: primary colour drives caption colour, logo overlay on paid plans; glossary pronunciations applied to speech only.
- 2026-10-16 Consent face match: InsightFace task on the GPU image, used automatically when RunPod is connected; basic checks otherwise.

## Platform

- 2026-10-16 Settings → Connections: ElevenLabs, Sarvam, Claude, RunPod, fal, R2 and Clerk keys stored encrypted, applied live, with a Test button each. /config/public tells the web app the auth mode at runtime.
- 2026-10-16 Engine Lab (Stage 0): run one input set through each GPU engine, timing and cost per minute, blind panel scoring, summary with verdicts, adopt the winner, export STAGE0_RESULTS.md.

## v1 — Private studio (in progress)

- 2026-10-16 Web app (Next.js 16): sign-in, 3-step onboarding with camera teleprompter, home, create screen, rendering, video page, avatars, voices, projects, settings, public share page. Lighthouse mobile 95+.
- 2026-10-16 API additions from the web build: reaction counts and preview progress on videos, voice external id, look rename, WebM duration fallback, first-sign-in race fix (migration 0002).
- 2026-10-16 Public share page: title, player, reactions, views, transcript, password gate, "Made with Avatar Studio" on free plan.
- 2026-10-16 Captions (SRT + burned-in copy), watermark on free plan, AI-assisted label, thumbnails, download variants.
- 2026-10-16 Credits ledger: free-plan grant, estimate before Generate, charge on success only, CSV export, idempotent per job.
- 2026-10-16 Render worker: DB-backed queue, 8-step chain, live stage/progress/ETA, cancel without charge, free 15-second 480p preview.
- 2026-10-16 Voices: ElevenLabs clone + BYO key, Sarvam Hindi/Hinglish, Windows SAPI for dev, library with engine badge, inline sample.
- 2026-10-16 Avatars: 15-second recording with consent, basic verification job, photo looks, delete removes all media.
- 2026-10-16 Auth + workspaces: Clerk JWT or dev header, auto workspace on first sign-in, roles.
- 2026-10-16 Prompt contract: seven versioned prompt files, loader that only fills variables, guardrails for banned claims.
- 2026-10-16 Infra: FastAPI + SQLAlchemy + Alembic (0001), docker-compose (Postgres, Redis, api, worker, web), RunPod GPU handler image.
