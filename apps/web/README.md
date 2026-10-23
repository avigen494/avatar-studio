# Avatar Studio — web

Phone-first Next.js front end for the Avatar Studio API (`apps/api`). One accent colour, big type, one primary action per screen; the primary button is pinned to the bottom on phones and dark mode follows the system.

## Run it

```bash
cd apps/web
pnpm install
cp .env.example .env.local   # then edit if your API is not on localhost:8000
pnpm dev                     # http://localhost:3000
```

Start the API in another terminal (`apps/api`, `uvicorn app.main:app --port 8000`). The API's `CORS_ORIGINS` must include `http://localhost:3000` (the default).

Production: `pnpm build && pnpm start`. Lint: `pnpm lint`.

## Environment variables

| Variable | Required | What it does |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | no | Base URL of the FastAPI backend. Defaults to `http://localhost:8000`. When it points at localhost, Settings shows an "Add 100 test credits" button. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | no | **Fallback only.** The auth mode and Clerk key normally come from the API at runtime (see "Runtime config" below). This env is used when `GET /config/public` cannot be reached, and by Clerk's middleware. |
| `CLERK_SECRET_KEY` | with Clerk | Used by Clerk's middleware (`src/proxy.ts`) to refresh sessions. The middleware is build-time: set both Clerk envs when you run Clerk in production. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | with Clerk | Keep at `/sign-in`. |

Workspace switching stores the chosen workspace id in `localStorage` and sends it as `X-Workspace-Id` (the switcher is in the phone header and the desktop side bar; `MeProvider` forgets a remembered id the person is no longer a member of).

## Runtime config

On every page load the app fetches `GET /config/public` once (`src/lib/public-config.ts`, kicked off by `ConfigProvider` in the root layout) and keeps it in a small store that any component can read with `usePublicConfig()`:

```ts
{ auth_mode: "dev" | "clerk", clerk_publishable_key, api_base_url, avatar_engine, voice_engines, script_helper, look_generator }
```

- `auth_mode` + `clerk_publishable_key` decide **dev vs Clerk sign-in at runtime** (`AuthProvider`, `SignInScreen`). Until the fetch answers, pages show skeletons (`auth.ready` is false). If the fetch fails, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` decides: set → Clerk, empty → dev, and the sign-in page says so.
- `script_helper` turns the "Help me write" chip on Create on or off. When off, admins get a link to Settings → Connections; everyone else gets the hint.
- `look_generator` says whether fal.ai is connected. The look generator, camera angles and Design with AI always work; when it is false the API uses a mock that only changes colour grade and crop, and the forms show "Connect fal.ai in Settings → Connections for real new looks" (admins get the link).
- The Connections page shows the same config as the "Live right now" strip and refetches it after every save or test (`loadPublicConfig(true)`).

Admin-only pages and links are gated by `GET /admin/whoami` (`useIsAdmin()` in `src/lib/admin.ts`). Non-admins never see the Platform group in Settings or the extra rows on More, and the two pages show a one-line notice instead of their content.

## Routes

| Route | Screen |
| --- | --- |
| `/sign-in` | Email-only (dev) or Clerk sign-in |
| `/onboarding` | Three steps: record 15 s with the consent teleprompter (or upload / photo), choose or clone a voice, make the first video. QR hand-off on desktop. |
| `/` | Home: avatar card, voice card, recent videos, pinned Create button, set-up checklist |
| `/create` | The main screen: look picker, script (full-screen on phones, "Help me write" with the **Write a script** and **Plan a video** tabs), voice, language, engine, motion chips, aspect, quality, captions, live estimate line, Preview (free) and Generate |
| `/videos/[id]` | Rendering progress (stages, ETA, credits, cancel), failure/retry, finished video with download, share, transcript, "Make another with this script", **Translate** and **Clip** sheets, **Versions** list (translations and clips made from this video); a translation or clip shows its kind badge and a link to the original. **Consistency** row on a finished video (quality-gate score, attempts, pinned seed) and reference tips when the gate failed |
| `/avatars`, `/avatars/[id]` | Identity grid (New avatar: "Record myself" or "Design a presenter"), looks grid with "AI" badges, look editor sheet (Appearance: rename / default / delete; New look from prompt with Look packs; Camera angles), add look, re-record, consent status, **Train my style** sheet, **Design with AI** card for designed avatars, "Render seed" line under Access |
| `/voices` | My voices (play, default, rename, remove), library with filters, clone, ElevenLabs key import |
| `/projects` | Folders with counts and credits, search and status filter over videos |
| `/settings` | Account, **notifications** (WhatsApp number + toggle), workspace, team summary, brand kit (logo with preview/remove, primary colour, caption colour, show logo on videos), glossary (term → spoken as), developers links, plan & credits summary, usage ledger (CSV). Platform admins also get a "Platform" group linking to Connections, Engine Lab and Usage |
| `/settings/plan` | **Plan & credits (v3).** Current plan card (credits, renewal, or "Ends on …" with a **Resume plan** button after a cancel), INR/USD toggle (USD only when Stripe or the mock provider is live), plan cards with the yearly Creator toggle, includes list and Choose/Switch/Current (choosing the cancelled plan again resumes it: 409 `resume_instead`), top-up card, extra-seats stepper on Team, billing details sheet (buyer name, GSTIN, address in `localStorage`), invoices table (signed `invoice_url` opens in a new tab, "Copy link"), `price_change_notice` banner |
| `/settings/team` | **Team (v3).** Seats bar ("3 of 15 seats"), invite form (email + role; 402 `seat_limit` shows a notice linking to Plan & credits), members with a role select (only an owner can grant owner; last-owner messages come from the API), remove with confirm, pending invites with Copy link / Revoke (an invite's `expired` flag comes from the API), Leave workspace |
| `/settings/developers` | **Developers (v3).** Owners and admins. Quick-start curl snippets with copy buttons and a link to `/docs` on the API host; API keys (create sheet with name + read/write scopes, the full key shown once in a copy box, list with prefix, scopes, last used, revoke); webhooks (add/edit sheet with URL, events, description; active toggle; secret show/copy; Send test with the result inline; deliveries sheet with status, attempts, last error, payload and Replay) |
| `/batch` | **Batch from CSV (v3).** Pick avatar, voice, project; "Generate now" toggle; upload a CSV (`POST /videos/batch/csv`, multipart) and see the per-row table (status, error, credits) with totals; sample CSV download; 402 shows the API message with a link to Plan & credits. Reachable from Projects and the More tab |
| `/invite/[token]` | Public invite page: workspace, role and inviter from `GET /invites/{token}`; "Sign in to accept" sends to `/sign-in?next=/invite/<token>` and comes back; handles expired, used and wrong-account (403) states; accepting switches to the new workspace |
| `/settings/connections` | **Admin only.** One card per service (ElevenLabs, Sarvam, Claude, RunPod, fal, R2, Clerk): status pill (Connected / Not connected / Using .env), fields with show/hide for secrets, Save (then auto-Test), Test with the result inline. "Live right now" strip from `/config/public` |
| `/settings/usage` | **Admin only.** Usage dashboard: 7/30/90-day chips, KPI tiles (videos, success rate, minutes, credits, paying workspaces vs target, p95 ₹/min vs target with an on/off-target badge and the API's note), revenue per currency, an inline-SVG bar chart of videos per day (succeeded over all, with a table view), per-workspace table (desktop) or cards (phone) sorted by credits |
| `/settings/lab` | **Admin only.** Stage 0 Engine Lab: shared inputs (150-word test script, voice, photo, optional real clip, optional HeyGen benchmark mp4, aspect, steps), one trial per ticked engine, trial cards polling every 3 s, blind mode (shuffled "Clip A/B/C…"), per-trial score sheet (rater remembered in `localStorage`), summary table with the recommended photo engine and "Adopt as default", "Export results" → `STAGE0_RESULTS.md`, and the **Golden set** (star toggle on cards, "Rerun golden set", regression report) |
| `/s/[token]` | Public share page: player, reactions, views, transcript, password gate |

## Avatar jobs (v2)

Style training, look generation and Design with AI are background jobs. The avatar page polls `GET /identities/{id}/jobs` every 3 s while one is queued or running (`useIdentityJobs()` in `src/lib/identity-jobs.ts`) and refetches the avatar when the set of running jobs changes, so new looks and the new `style_status` appear without a reload. Every action shows its credit cost before the button and the API charges only on success:

| Action | Where | Cost | Result |
| --- | --- | --- | --- |
| Train my style | `/avatars/[id]` → "Train my style" sheet (real-person avatars) | 40 credits | `style_status` none → queued → training → ready / failed; "Style trained" badge on the card, header and a "Style on" chip on Create |
| New look from prompt / Look packs | Look editor → "New look from prompt", or "Make with AI" above the grid | 2 credits | 3 looks with `kind: "generated"` |
| Camera angles | Look editor → "Camera angles" | 6 credits | 3 looks |
| Design with AI | Designed avatar without looks (card), "Design with AI" button, onboarding step 1 → "Design a presenter" | 2 credits | 3 candidates; the first becomes the default and the avatar turns `ready`; "Use this" on any tile sets the default |

Training needs 2–10 minutes of footage in total. The consent recording counts; extra clips are recorded (up to 60 s each) or uploaded with presign purpose `footage` and attached with `POST /identities/{id}/footage`. The sheet lists `identity.footage` (key, url, seconds measured by the API) and drives the progress bar from `footage_seconds_total`, so it is exact after a reload; a browser-side measurement is kept only as a fallback for a clip whose `seconds` is still null. Under the minimum the Start button stays disabled unless the person ticks "Start anyway" (the job then fails with `style_error` and nothing is charged). 402 / 409 / 422 answers are shown inline in plain English.

## Money, teams, developers (v3)

- **Checkout** (`src/lib/billing.ts`, `src/components/billing/*`): `POST /billing/checkout` answers with a `mode`. `razorpay_checkout` loads `https://checkout.razorpay.com/v1/checkout.js` once and opens Razorpay with `key = public_key`, the order or subscription id and the prefill; the success handler's response is sent to `POST /billing/confirm`. `redirect` sets `window.location` to `redirect_url`; coming back with `?paid=1` shows a toast and refetches. `mock` (no provider keys) opens a "Pay ₹X (test)" sheet that confirms with `{provider_subscription_id | provider_order_id, amount, currency}`. After any confirmation the page refetches `/billing` and `/me`, so the credits pill and the watermark flag update at once. Amounts from the API are in paise/cents; `money()` in `src/lib/format.ts` prints them.
- **Teams**: roles are owner, admin, editor, viewer. `IsAdmin` endpoints (invites, roles, billing, developer) are hidden from editors and viewers, who see a one-line notice instead. Per-avatar access: owners and admins get an "Access" card on `/avatars/[id]` that opens a sheet listing editors and viewers with checkboxes → `PUT /identities/{id}/access {user_ids}` (empty = everyone). A lock badge appears on the identity card and header when `allowed_user_ids` is non-empty.
- **Developers**: keys are shown once (`key` in the POST answer) and never again; the list shows the prefix. Webhook deliveries poll every 4 s while one is pending. The quick-start text mirrors `docs/API.md`.

## v3 features

- **Translate** (`src/components/video/TranslateSheet.tsx`): `GET /translate/languages` fills the chips (Indian languages first, then a divider). Mode is *Audio only* (new voice track, re-rendered) or *Lip-sync* (needs the avatar's real-footage clip: disabled with a hint when `identity.reference_url` is null). Optional voice (default: the original's). The estimate is `estimated_seconds` (or `duration_s`) × 6 credits per minute, at least 1. `POST /videos/{id}/translate {languages, mode, voice_id, generate: true}` answers 202 with one draft-turned-queued video per language; the sheet lists them and polls every 2 s. 400 `same_language` (the source language's chip is disabled), 402 (drafts are kept, the message says so), 422 blockers and 503 (Claude not connected; admins get the Connections hint) are shown inline.
- **Clip** (`ClipSheet.tsx`): count stepper (1–10, default 3), length presets 5–15 / 15–30 / 15–60 / 30–60 s plus two number inputs, cost line "1 credit per source minute". `POST /videos/{id}/clip` answers a job; `GET /jobs/{id}/status` is polled every 2 s and the sheet shows stage + %. On success the Versions list refetches (`result.clip_ids` are ordinary videos with `kind: "clip"`); on failure the API message is shown as-is (the mock STT needs the script; uploaded videos need ElevenLabs).
- **Versions** (`VersionsSection.tsx`): `GET /videos/{id}/derived`, polled every 3 s while any item renders. Groups Translations and Clips with a kind badge, language, status pill, thumbnail and an Open link. `languageLabel()` in `src/lib/format.ts` knows all translation codes.
- **Video Agent** (`ScriptHelperSheet.tsx`, "Plan a video" tab): brief + 30/60/90/120 s → `POST /ai/plan` → scene list (number, A/B-roll pill, time range, visual in muted text, voiceover). "Use this script" fills the script, sets the title to `plan.title` (sent as `title` on the draft) and the aspect from `plan.orientation` (`aspectFromOrientation()` accepts `9:16` or portrait/landscape/square). The mock planner answers without Claude; a 503 shows the Connections hint for admins. The "Help me write" chip is always enabled now; only the *Write a script* button is gated by `script_helper`.
- **Notifications** (Settings): `GET/PUT /me/notifications {phone, notify_whatsapp}`. The phone must be E.164 (`+` and the country code); the WhatsApp toggle stays off until it is. `/config/public` has no WhatsApp indicator, so the "not connected yet" note is shown only to platform admins with a link to `/settings/connections#whatsapp`.
- **Usage** (`src/components/admin/UsageScreen.tsx`, `DailyChart.tsx`): `GET /admin/usage?days=`. The chart is inline SVG, one teal hue in two steps (`--viz-1`, `--viz-1-soft` in `globals.css`, chosen for light and dark and validated with the dataviz palette checker), ≤24 px columns with rounded tops, hairline gridlines, a legend, native tooltips and a "Show as a table" view. Target states (paying workspaces ≥ 20, p95 ≤ ₹60/min) are shown as icon + label badges, never colour alone.
- **Billing follow-ups**: `GET /billing` keeps a cancelled subscription until `plan_ends_at`; the current-plan card shows "Ends on …" and **Resume plan** (`POST /billing/resume`; 409 `cannot_resume` shows the message). `payments[].invoice_url` is a signed link used as a plain `href target=_blank` with a Copy link button.

## Consistency (quality gate)

- **Video page** (`ConsistencyRow` in `VideoScreen.tsx`): shown on a finished video when `quality_score`, `render_seed` or `render_attempts > 1` is set. The badge reads "Face match 0.78" (`quality_method: "face_match"`, RunPod ran InsightFace) or "Frame check 0.91" (`"frame_similarity"`, the local proxy); the line under it says how it was measured. "Attempt 2 of 2" appears when the gate re-rendered with the next seed; "Seed … · pinned per avatar" plus `engine_version` are muted text. Labels live in `src/lib/quality.ts`. On a failed video whose `error_message` contains "did not look enough like you", an amber card gives reference tips (face the camera, even light, no sunglasses, one person in frame) and links to the avatar page.
- **Avatar page**: `IdentityOut.render_seed` is shown as "Render seed <n>" under the Access card with a one-line explanation.
- **Engine Lab golden set** (`src/components/lab/GoldenSet.tsx`): the star on a finished, non-benchmark trial card calls `PUT /lab/trials/{id}/golden {is_golden}`; the first time it opens a confirm sheet explaining the regression set (remembered in `localStorage`, `as_lab_golden_intro`). Cards show a "Quality" line (score + method, hidden when null), a "Golden" badge and "Golden rerun" on trials with `golden_of`. The "Golden set" section under Summary has "Rerun golden set" (`POST /lab/golden/rerun`, disabled with a hint when nothing is golden) and a table (desktop) or cards (phone) from `GET /lab/golden`: quality golden → latest with the delta (green rise, amber dip within 0.05, red beyond), wall seconds delta (amber up to +50 %, red beyond), ₹/min golden → latest, and a verdict pill (OK / Not rerun yet / Worse: …). The report polls every 5 s while any row has `pending_reruns > 0` and refetches whenever a trial changes status. Deltas always carry an arrow and a sign, never colour alone.
- **Connections → RunPod** shows the gate settings (`quality_gate`, `quality_face_threshold`, `quality_retries`) through the generic field form; nothing is special-cased.

Brand kit: `PATCH /workspaces/current {brand_kit: {logo_key, primary_color, caption_style, show_logo}}`. The logo is uploaded with presign purpose `brand` and saved immediately; the preview comes from `brand_logo_url`. Caption colour "Brand colour" drives burned-in captions; the logo is burned in bottom-right on paid plans only (the Free plan shows the watermark instead, and the UI says so).

## Layout

- `src/lib/api.ts` — `apiFetch()`, `ApiError`, uploads (presign → PUT), recorder helpers
- `src/lib/endpoints.ts` — typed wrappers for every endpoint; `src/lib/types.ts` mirrors `openapi.json`
- `src/lib/hooks.ts` — `useApi` (fetch + polling), debounce, media queries
- `src/lib/public-config.ts` — runtime `/config/public` store; `src/lib/admin.ts` — `useIsAdmin()`; `src/lib/lab.ts` — blind-mode shuffle, labels, number formats
- `src/lib/identity-jobs.ts` — `useIdentityJobs()` polling, `jobErrorMessage()`; `src/lib/media.ts` — `measureDuration()` for clips in the browser; `src/lib/constants.ts` — credit costs, footage limits, design options
- `src/lib/billing.ts` — plan prices, Razorpay loader, billing details in `localStorage`; `apiForm()` in `src/lib/api.ts` posts multipart forms (CSV batch)
- `src/lib/quality.ts` — quality-gate labels (`qualityLabel`, `qualityHint`, `isGateFailure`) shared by the video page and the Lab
- `src/components/ui/*` — Button, Chip, Sheet, ConfirmSheet, Card, Skeleton, Toast, ProgressBar, Toggle, Field, Badge
- `src/components/{recorder,uploader,voice,video,avatar,auth,layout}` — feature components
- `src/components/avatar/*` — `AvatarScreen`, `TrainStyleSheet`, `LookGenerator` (prompt form, look packs, camera angles, `CostLine`), `DesignWithAI` (form, `CandidateGrid`, `GeneratingTiles`, `AiBadge`), `AvatarKindPicker`, `LookGeneratorHint`
- `src/components/admin/*` — Connections page, `UsageScreen` + `DailyChart` (usage dashboard); `src/components/lab/*` — Engine Lab (inputs, trial card, score sheet, summary table, `GoldenSet` regression report)
- `src/components/billing/*` — `PlanScreen` (plan cards, top-up, seats, invoices), `BillingSheets` (mock payment, billing details)
- `src/components/team/*` — `TeamScreen` (seats, invites, members, `MemberAvatar`), `InviteScreen` (public accept page); `src/components/layout/WorkspaceSwitcher.tsx`; `src/components/avatar/AccessSheet.tsx` (`AccessSheet`, `LockedBadge`)
- `src/components/developer/*` — `DevelopersScreen` (quick start, `Snippet`), `ApiKeysSection`, `WebhooksSection` (deliveries sheet); `src/components/video/BatchScreen.tsx`
- `src/components/video/{TranslateSheet,ClipSheet,VersionsSection}.tsx` — translate, clip and the derived-videos list; `ScriptHelperSheet.tsx` — Write a script / Plan a video tabs (`aspectFromOrientation()`)
