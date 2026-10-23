# Plan: v1 Private studio (weeks 1–4)

Done when: Avinash makes her weekly video here and cancels HeyGen Pro.

## Work items and status

| # | Item (PRD 11) | Status | Notes |
| --- | --- | --- | --- |
| 0 | Stage 0 quality test on RunPod | tooling done, run pending | Settings → Engine Lab runs trials, scores and exports `docs/STAGE0_RESULTS.md`; needs a RunPod endpoint |
| 1 | Infra: compose, Postgres, Redis, R2, Clerk, .env | done (code) | `docker-compose.yml`, `.env.example`; `/health` reports db/ffmpeg/storage |
| 2 | Data model + Alembic | done | 11 tables, all tenant tables carry `workspace_id`; `0001_v1_initial_schema` |
| 3 | Avatar creation (record + consent, upload, verification, looks) | done | `BasicVerifier` in v1; face match is v2 |
| 4 | Voice: ElevenLabs clone + BYO key + Sarvam | done | plus SAPI (Windows dev) and mock |
| 5 | GPU worker on RunPod + preview path | done (code) | `apps/gpu`; mock engine locally; preview < 3 min target measured in Stage 0 |
| 6 | Create screen, rendering, video page, share page (Next.js) | built by the web agent | see `apps/web/README.md` |
| 7 | Credits ledger, charge on success, usage page | done + tested | `tests/test_flow.py` asserts ledger matches jobs 1:1 |
| 8 | Captions, watermark, AI label, download variants | done | burned-in + SRT |

## Open questions carried from the PRD

- Which engine wins the panel test (wan_s2v vs infinitetalk) → `DEFAULT_ENGINE_PHOTO`.
- Real COGS per minute at 720p on L40S vs H100 → fill `docs/STAGE0_RESULTS.md`.
- Warm one GPU 12 h/day or stay on-demand → decide after the first week of real previews.
- Product name and domain.

## How to verify locally

1. `pytest -q` in `apps/api` (end-to-end with the mock engines and real ffmpeg).
2. Start api + worker + web, sign in with any email, follow onboarding on a phone-width window.
3. Make a video: watch the estimate line, run a free preview, generate, cancel one, see the ledger.
