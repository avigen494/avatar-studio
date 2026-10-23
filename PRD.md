# Avatar Studio — Product Requirements (PRD)

Oct 16, 2026 · @Avinash Garg

Avatar Studio is a multi-user AI avatar video SaaS that replaces HeyGen for Avinash first, then sells to creators and small businesses in India and the US. It must beat HeyGen on price, predictability, mobile use and Hindi/Hinglish, and match it on avatar quality within six months.

## 1. Goal and what "better than HeyGen" means

Avinash makes her weekly masterclass and ad videos on Avatar Studio instead of HeyGen within 60 days, at under one-fifth of the cost per minute, from her phone if she wants. Other creators can sign up and do the same with their own face and voice.

"Better than HeyGen" is measured, not claimed:

| Measure | HeyGen today (from the research) | Avatar Studio target |
| --- | --- | --- |
| Price per finished minute (own avatar) | ₹250–600 (48 credits/min on Pro + subscription floor) | ₹40–100 list; ₹25–60 cost |
| Pay for failed or wrong renders | Yes (user complaints) | Never. Charge only on success |
| Preview before paying | No (except Podcast) | Free 15-second preview on every video |
| Pricing currency | USD only, no UPI | INR + UPI + GST invoice; USD via Stripe |
| Hindi / Hinglish voice | English-first; Pro clone English-only | Hinglish native (Sarvam + ElevenLabs), script-level language mixing |
| Mobile | iOS/Android apps, web not phone-first | Phone-first web app: record, generate, review, share on a phone |
| Custom avatar setup | 15-second clip + consent | Same 15-second flow, plus "use my real footage" mode |
| Avatar quality | Avatar V (best in class) | Avatar IV level at launch; Avatar V level by month 6 via the three quality steps |
| Time to first video for a new user | \~20 minutes (training) | Under 10 minutes using photo mode while the clip trains |
| Render transparency | Credit estimate shown; stuck renders common | Estimate + live progress + ETA; auto-refund on failure |

Sources: the HeyGen research workbook (feature inventory, usage ledger, complaints tab), 16 Oct 2026.

## 2. Users and what they need

Three kinds of people log in. Everything in the product is scoped to a workspace they own or were invited to.

| User | Who | What they do most | Must-have |
| --- | --- | --- | --- |
| Owner-creator (Avinash first) | Solo educator or marketer posting daily | Paste a script, get a 60–90 s vertical video of themselves, share or download | One-screen create flow; own voice; motion chips; captions; phone use |
| Small team | Agency or coaching business with 2–5 editors | Make videos for one or more client avatars, keep brand kits | Shared workspace, roles, per-avatar permission, brand kit, glossary |
| Developer / automator | n8n, Zapier or API user | Generate videos from a spreadsheet, CRM or workflow | API key, webhooks, n8n node, batch endpoint |

Jobs to be done, in order of frequency: (1) script to video with my avatar; (2) same video in Hindi/English; (3) new look (outfit/background) without re-recording; (4) clip a long video into shorts; (5) many personalised versions from one template.

## 3. Hard rules (hard-coded, never overridden by a feature request)

1. Multi-tenant from the first commit. Every table has `workspace_id`. No code path that only works for one account.
2. A user's media, voice, style file and consent recording are stored under their workspace prefix, loaded only for their jobs, and deleted from workers after every job.
3. Credits are charged only when a render succeeds. Failed, cancelled or wrong-aspect renders cost nothing and are auto-refunded.
4. The credit estimate and the expected duration are shown before the Generate button is enabled.
5. Every video can be previewed free at 480p for up to 15 seconds.
6. A real-person avatar cannot render until a consent recording is attached and verified.
7. An "AI-assisted" label is available per workspace and on by default for free plans.
8. Phone-first: every screen must be usable one-handed on a 390 px wide screen before it is accepted on desktop.
9. Plain English in all UI copy. Hindi UI is a later toggle, not a rewrite.
10. No vendor lock: voice and avatar engines are adapters behind one interface; any engine can be swapped without touching the UI.
11. Open-source models only with commercial licences (Apache-2.0, MIT). Non-commercial models (Sonic, Wav2Lip, F5-TTS weights) are banned from the codebase.
12. Every AI step (script help, motion prompts, translation, video planning) uses the system prompts in Section 10 verbatim; prompts live in `/prompts` as versioned files, never inline in code.

## 4. Scope by release

Three releases. Each one is usable on its own; nothing from a later release blocks an earlier one.

| Release | When | What ships | Done when |
| --- | --- | --- | --- |
| v1 — Private studio | Weeks 1–4 | Sign-up (Google/email), workspace, create avatar (15-s clip + consent, or photo), clone voice (ElevenLabs, own key optional), Single-scene create screen, free preview, render, captions, share page, download, projects list, credits ledger | Avinash makes her weekly video here and cancels HeyGen Pro |
| v2 — Quality | Weeks 4–8 | Real-footage mode (V2V), "teach it my style" training, motion chips (expression/gesture/gaze), sharpen pass to 1080p/4K, Hindi/Hinglish voices (Sarvam), look generator (new outfit/background from a prompt, 3 variants), brand kit + glossary | Blind test: 3 of 5 viewers cannot tell our video from HeyGen Avatar V for a 60-s Reel |
| v3 — SaaS | Weeks 8–14 | Plans + Razorpay (UPI, GST invoice) + Stripe, free tier with watermark, team workspaces and roles, Translate (dub + lip-sync), AI Clipping, Batch from CSV, public API + webhooks + n8n node, consent and AI-label controls, admin usage dashboard | First 20 paying users; cost per minute ≤ ₹60 at p95 |

Out of scope until after v3: real-time interactive avatars (buy from Anam/Simli via LiveKit when needed), PPT-to-video, interactive quizzes/SCORM, native mobile apps (phone-first web covers it).

## 5. Screens and mobile design

Design direction (chosen, not asked): light ground, one accent colour, big type, one primary action per screen. It should feel like a camera app, not a video editor. HeyGen's own strength is that its Single-scene screen is one card; we keep that and go further by making the card work on a phone.

Design rules: 390 px first; 16 px gutters; primary button pinned to the bottom of the screen on mobile; no hover-only controls; every long task shows progress, ETA and credits; skeletons instead of spinners; dark mode follows the system.

| Screen | What is on it | Phone behaviour |
| --- | --- | --- |
| Sign in | Google, email link. No password field. | Full-screen buttons |
| Onboarding (3 steps) | 1 Record 15 s with on-screen script (consent built in) or upload; 2 Hear your cloned voice, re-record if needed; 3 Make your first video | Uses phone camera directly; QR hand-off from desktop |
| Home | Your avatar card, your voice card, "Create video" button, recent videos with status and credits used | Single column; create button pinned bottom |
| Create (the main screen) | Look picker (thumbnails) · script box (paste, type, or record audio) · voice chip · language chip (English / Hindi / Hinglish) · engine chip (Photo / Real footage / Mouth-only; Auto by default) · motion chips (Calm, Confident, Smile, Wave, Point, Thumbs up, Look at camera) · aspect (9:16 / 16:9 / 1:1) · quality (720p / 1080p / 4K) · captions toggle · live line: "\~58 s · 10 credits · you have 212" · Preview (free) · Generate | Script box expands to full screen when focused; chips scroll horizontally; estimate line sticks above the pinned Generate button |
| Rendering | Progress bar with stages (Voice → Avatar → Sharpen → Captions), ETA, cancel (no charge) | Can leave the screen; push/WhatsApp notification when done (v3) |
| Video page | Player, download (MP4, with/without captions), share link + password, reactions and views, transcript, "Make another with this script", "Translate", "Clip" | Native share sheet; download to camera roll |
| Avatars | Identity cards → looks grid → look editor (Appearance, New look from prompt, Camera angles) · Add look (photo / video / phone) · Train my style (one-time) · consent status | Grid 2-up; look editor as bottom sheet |
| Voices | My voices (clone, design from prompt, import ElevenLabs key), library with filters (language, gender, style) · Play · Set default | List with inline play |
| Projects | Folders, search, type filter, credits per project | List; swipe to delete |
| Translate (v3) | Pick video → target languages (Indian languages first) → engine (audio-only / lip-sync) → glossary → estimate → go | Same card pattern |
| Settings | Account, workspace, members, brand kit, glossary, AI-label toggle, API keys, webhooks, plan and credits, usage ledger (CSV) | Grouped list |
| Share page (public) | Player, title, creator name, reactions, "Made with Avatar Studio" on free plan | Loads under 1 s on 4G; no sign-in |

Accessibility and speed: Lighthouse mobile score ≥ 90; all controls reachable by keyboard; captions on by default.

## 6. How a video is made

&#91;embedded content: render chain · 8 steps, charge at the end\]

Steps 1–4 run on the VPS in seconds. Steps 5–6 run on a rented GPU for 3–20 minutes depending on engine and length. Step 7 is CPU work. If anything fails between 4 and 8, the job is marked failed, the user is told why in plain words, and no credits move. A free preview runs the same chain at 480p for 15 seconds and skips step 6.

## 7. Per-user models and privacy

One shared base model; one private "style card" per avatar. The base model (Wan 2.x family, Apache-2.0) sits read-only on the GPU image. Each avatar owns:

| Owned by the user | Where it lives | Used when |
| --- | --- | --- |
| 15-second reference clip (motion + consent in one take) | `r2://ws/{workspace}/identities/{identity}/reference.mp4` | Real-footage renders; style training |
| Consent recording and verification result | same prefix, never deleted while the avatar exists | Gate on every render |
| Looks (photos or short videos per outfit/background) | same prefix `/looks/` | Picked per video |
| Style file (per-avatar LoRA, 200–600 MB, trained once) | same prefix `/style.safetensors` | Attached to the base model for that avatar's renders only |
| Voice (ElevenLabs/Sarvam voice id, or their own key) | `voices` table; key encrypted at rest | Every TTS call |

Rules the code enforces: a worker downloads only the files named in its job; it deletes its working folder in a `finally` block; it never caches a style file between jobs; a deleted avatar deletes its clip, looks, style file and voice binding within 24 hours; workspace data export (zip) on request; no user media is used to train anything shared.

## 8. Quality plan to reach Avatar V level

Three steps, in order, each measured with the same 60-second test script and a 5-person blind panel against HeyGen Avatar V.

| Step | What we do | Engine / tool | Cost | Target score (panel, 1–5) |
| --- | --- | --- | --- | --- |
| 0 Baseline | Photo + audio → video | Wan2.2-S2V-14B or InfiniteTalk | ₹25–55/min | ≥ 3.0 (usable for Reels) |
| 1 Teach it your style | Train a per-avatar style file on 2–10 min of the user's footage, once | Wan LoRA trainer (DiffSynth / Musubi) on H100, 1–3 h | ₹500–800 once | ≥ 3.8 (moves like the user) |
| 2 Real-footage mode | Keep the user's real 45-s clip; redraw mouth/jaw (and optionally head) to the new audio | InfiniteTalk V2V or LatentSync 1.6 | ₹8–30/min | ≥ 4.2 (hands, lighting, body are real) |
| 3 Finish | Super-resolution to 1080p/4K, light face restore, 30/60 fps | Real-ESRGAN, CodeFormer (light), RIFE | +₹3–5/min | +0.3 |

Extra levers if the panel is still below 4.5: motion chips mapped to prompt templates (expression, gesture, gaze), 40-step sampling for "Max quality" renders, and a better base model as they ship (watch LongCat-Video-Avatar, MagiHuman for 1080p, Wan 2.3). Avatar quality is reviewed every month against HeyGen's current best with the same panel.

## 9. Pricing and credits

One credit = ₹2 list price. Our cost is ₹0.4–0.9 per credit, so gross margin stays above 70% at every tier. No credits are taken for previews, failures or cancellations.

| What | Credits | List price | Our cost (est.) |
| --- | --- | --- | --- |
| Photo-mode minute (720p) | 10 | ₹20 | ₹5–9 |
| Real-footage minute | 6 | ₹12 | ₹2–5 |
| Mouth-only minute | 4 | ₹8 | ₹1–3 |
| 1080p / 4K finish per minute | +1 / +2 | ₹2 / ₹4 | ₹0.5 / ₹1 |
| Translate per minute | 6 | ₹12 | ₹3–5 |
| Teach-my-style (once per avatar) | 40 | ₹80 | ₹25–40 |
| New look (3 variants) | 2 | ₹4 | ₹0.5 |

| Plan | Price | Credits / month | Avatars | Includes |
| --- | --- | --- | --- | --- |
| Free | ₹0 | 30 | 1 | Watermark, 720p, 15-s previews |
| Creator | ₹999/mo (₹799 annual) | 600 (≈ 60–100 min) | 2 | No watermark, 1080p, Hinglish voices, rollover 1 month |
| Pro | ₹2,499/mo | 2,000 | 5 | 4K, style training included once, API, priority queue |
| Team | ₹5,999/mo | 6,000 + ₹499/seat | 15 | Members, roles, brand kits, batch, webhooks |
| USD (Stripe) | $12 / $29 / $69 | same | same | For the US LLC |

The comparison that sells: HeyGen Pro gives Avinash \~31 minutes for \~₹8,300; Creator here gives 60–100 minutes for ₹999. Top-ups: 100 credits for ₹199 on any paid plan, via UPI.

## 10. Prompt engineering contract (hard-coded)

Every AI step reads its prompt from `/prompts/<name>.v<N>.md`. Code may fill the `{{variables}}` and nothing else. A prompt change is a pull request with a before/after sample. These are the v1 prompts.

**P1 — Script helper** (`prompts/script_helper.v1.md`, model: Claude Sonnet)

```markdown
You write spoken scripts for short talking-head videos made with an AI avatar.
Rules: plain English (or the language asked), short sentences, one idea per sentence, no jargon, no emojis, no stage directions, no headings. Speak as the creator in first person. Open with a hook in the first 8 words. End with one clear next step. Target length: {{target_seconds}} seconds at 150 words per minute, so about {{target_words}} words. Never invent numbers, names or claims not given in the brief. If the brief includes a number, keep it exactly.
Brief: {{brief}}
Audience: {{audience}}
Language: {{language}} (Hinglish = natural Hindi-English mix as spoken in India, written in Latin script)
Output: the script only.
```

**P2 — Motion prompt builder** (`prompts/motion.v1.md`, no LLM; template)

```markdown
{{expression_phrase}}, {{gesture_phrase}}, {{gaze_phrase}}; natural talking, subtle head movement, stable framing, no camera motion.
expression: calm="calm relaxed face" confident="confident steady expression" smile="warm light smile" serious="serious focused expression" enthusiastic="bright enthusiastic energy"
gesture: none="" wave="waves hello near the start" point="points to camera on emphasis" thumbs_up="gives a thumbs up at the end" open_palms="open palm gestures while explaining" hand_on_heart="hand on heart once"
gaze: camera="looking at the camera" ahead="looking slightly ahead"
```

**P3 — Voice delivery tags** (`prompts/delivery.v1.md`, model: Claude Haiku; only for engines that accept tags)

```markdown
Insert delivery tags into this script for a text-to-speech engine that understands [pause], [excited], [serious], [whisper], [laughs]. Add at most one tag per sentence and only where a human presenter would naturally change delivery. Do not change any words. Keep punctuation. Output the tagged script only.
Script: {{script}}
Style: {{style}} (one of: neutral, energetic, warm, serious)
```

**P4 — Translation with glossary** (`prompts/translate.v1.md`, model: Claude Sonnet)

```markdown
Translate the script from {{source_language}} to {{target_language}} for a spoken video. Keep meaning, tone and sentence count. Keep each sentence close to the original length so timing fits. Do not translate these terms; keep them exactly: {{glossary_terms}}. For Hinglish, keep English technical words in English and write Hindi in Latin script. Output the translated script only, one sentence per line.
Script: {{script}}
```

**P5 — Video planner (Video Agent)** (`prompts/planner.v1.md`, model: Claude Sonnet, JSON output)

```markdown
You plan short talking-head videos. Given a brief, produce a plan as JSON matching this schema exactly:
{"title": str, "orientation": "9:16"|"16:9", "language": str, "scenes": [{"name": str, "start_s": int, "end_s": int, "type": "A"|"B", "visual": str, "voiceover": str}]}
Rules: 6–12 scenes; total {{target_seconds}} seconds; type A = presenter on screen, type B = B-roll with voiceover; first scene is always A and is a hook; last scene is A with the call to action; visual is one plain sentence a designer could follow; voiceover lines follow P1 rules; no invented facts. Output JSON only.
Brief: {{brief}}
Avatar: {{avatar_name}} Voice: {{voice_name}} Brand: {{brand_summary}}
```

**P6 — Look prompt builder** (`prompts/look.v1.md`, template to the image model)

```markdown
Same person as the reference image, identical face and identity, {{outfit}}, {{setting}}, {{lighting}}, {{framing}}, photorealistic, sharp focus, no text, no logos, no watermark.
Negative: different person, distorted face, extra fingers, blurry, cartoon, text.
```

**P7 — Share-page summary** (`prompts/summary.v1.md`, model: Claude Haiku)

```markdown
Write one sentence (max 25 words) that tells a viewer what this video is about, in plain English, no hype. Transcript: {{transcript}}
```

Guardrails that wrap every prompt: scripts are checked for banned claims (medical cures, guaranteed income, impersonation of a named real person other than the avatar owner); any hit blocks the render and tells the user why.

## 11. Build instructions for Claude Code

Repo `avatar-saas` (scaffold already delivered). Work in the compound engineering loop: plan file in `docs/plans/`, one branch per feature, review before merge, then update `CLAUDE.md` with what was learned.

| Order | Work item | Done when |
| --- | --- | --- |
| 0 | Stage 0 quality test on RunPod (run sheet in `docs/STAGE0_RUNSHEET.md`) | `docs/STAGE0_RESULTS.md` has three scored videos and a chosen default engine |
| 1 | Infra: Docker Compose on the VPS, Postgres, Redis, R2 bucket, Clerk, `.env` | `/health` returns ok over HTTPS; sign-in works |
| 2 | Data model + migrations (Alembic) from `apps/api/app/models` | `alembic upgrade head` clean; seed script creates a workspace |
| 3 | Avatar creation: 15-s record (phone camera + teleprompter + consent), upload, verification job, looks | Avinash's avatar created end to end on a phone |
| 4 | Voice: ElevenLabs clone + BYO key + Sarvam Hindi voice | Both voices play in the picker |
| 5 | GPU worker on RunPod serverless with the chosen engine; preview path | A 15-s free preview returns in under 3 minutes |
| 6 | Create screen (Next.js, mobile-first) with estimate line, preview, generate, rendering screen, video page, share page | Lighthouse mobile ≥ 90; one-thumb flow |
| 7 | Credits ledger, charge-on-success, refunds, usage page | Ledger matches jobs 1:1 in tests |
| 8 | Captions, watermark, AI label, download variants | Burned-in and SRT both exported |
| v2 | Real-footage mode, style training job, motion chips, sharpen, look generator, brand kit, glossary | Panel score ≥ 4.2 |
| v3 | Razorpay + Stripe, plans, team roles, Translate, Clipping, Batch, API + webhooks + n8n node, admin dashboard | 20 paying users |

Definition of done for every feature: works on a 390 px phone; no credit moves on failure; tests for the API route; copy reviewed for plain English; a one-line entry in `CHANGELOG.md`.

## 12. Risks and open questions

| Risk | Impact | What we do |
| --- | --- | --- |
| Open models stay visibly behind Avatar V | Users compare and leave | Real-footage mode first (hardest to tell apart); monthly panel test; swap base model as better Apache ones ship |
| GPU cold starts make previews slow | Feels broken on a phone | Keep one warm worker during Indian daytime; show stage-by-stage progress with ETA |
| ElevenLabs cost or policy change | Voice cost jumps | BYO key option; Sarvam and Chatterbox adapters ready |
| Consent abuse (someone uploads another person) | Legal and trust | Consent clip must match the reference face; manual review queue for flagged cases; takedown path |
| HeyGen launches INR pricing | Our price wedge shrinks | Keep the other wedges: no charge on failure, free preview, Hinglish, phone-first |
| Scope creep toward HeyGen's 13 apps | Nothing ships | Section 4 scope is the contract; new apps only after v3 |

Open questions, to settle in Stage 0 and v1: which engine wins the panel test; real COGS per minute at 720p on L40S vs H100; whether to warm one GPU 12 hours a day (≈ ₹15k/month) or stay fully on-demand; name and domain for the product.

## 13. HeyGen feature map — what we copy, beat or skip

From the research workbook (72 features, 61 live-app screens). "Beat" means a measurable change, not a claim.

| HeyGen feature (as seen live) | Our move | How |
| --- | --- | --- |
| Try-before-login: full creator UI visible to guests; sign-in only on first action | Copy | Public demo of the Create screen with a stock avatar; sign-in gate at Preview |
| 4-step onboarding (Twin → Voice → Look → First video) | Copy + beat | Same four steps; first video possible in photo mode while the clip is still training |
| 15-s record via webcam or phone QR, teleprompter script doubles as consent | Copy | Same; add Hindi/Hinglish teleprompter text |
| Upload footage ≤10 GB, Drive link, tips panel | Copy | Resumable upload, Drive link, WhatsApp-sent clip (India) |
| Design with AI form: Name, Age (5), Gender, Ethnicity (10), description, Orientation, Pose, Style (Realistic/Pixar/Cinematic/Vintage/Noir/Cyberpunk) | Copy | Same form over Flux/Nano Banana via fal; adds Indian wardrobe presets |
| Looks in sets of 3 per prompt; Look Packs by profession (Studio Streamer, Corporate, Fitness, Automotive, Medical, Real Estate…) | Copy + beat | 3 variants per prompt; packs for Indian niches: coaching, CA/accounting, clinic, real estate, kirana/retail, wedding |
| Edit look: Appearance (Refine/Studio/Glow + 12 sliders), Camera angles (3 for 40 cr), Custom edit (2 options, references), Remix into scene | Copy, cheaper | Same four verbs; camera angles 6 credits not 40 |
| Personal Model: 10–30 photos, 60 credits, 10–15 min | Beat | Our style training uses video + photos, 40 credits, and improves motion, not only looks |
| References modal: up to 3 product images → avatar holds the product | Copy | Product placement for affiliate/UGC ads (Avinash's main use) |
| Voice list shows engine per voice (ElevenLabs, Fish); import own ElevenLabs key | Copy | BYO ElevenLabs key day one; engine badge on every voice |
| Professional Voice Clone: $29/mo add-on, English-only | Beat | Hinglish pro clone via ElevenLabs PVC or Chatterbox; one-time fee, not a subscription |
| Voice settings: engine, model (v2/Turbo/v3/v4), speed, volume, similarity, stability, language, accent; Delivery: Enhance voice / Direct voice | Copy | Same panel; Enhance voice = prompt P3 |
| Brand Glossary: term → pronunciation, highlighted in script | Copy | Same; pre-seeded with common Indian names and brands |
| Single-scene card: engine chips V/IV/III, Motion box with More-expressive toggle, voice, orientation, 720p/1080p | Copy + beat | One card; engine chips Photo / Real footage / Mouth-only; live estimate line; free preview button |
| Motion chips: Expression ×7, Gestures ×13, Gaze ×2 | Copy | Same chip lists via prompt P2 |
| Cinematic mode (Seedance, prompt enhance, Auto/Custom duration) | Later | Route to Seedance/Kling via fal in v3 |
| AI Studio: script-left, canvas, filmstrip, right rail (Avatar, Brand, AI Tools, Media, Elements, Music, Captions, Screen Recorder, Templates, Layers, Interactivity) | Simplify | v2 ships script + avatar + captions + music + B-roll only; no layer editor |
| AI Tools: 9 image models (2 cr), 4 video models (50 cr) | Copy | Same aggregator via fal; image 1 cr, B-roll 15–25 cr |
| Captions: \~15 motion styles; Clipping: 25 styles | Copy | 12 caption presets incl. Hindi-script-safe fonts |
| Generate dialog: 720p/1080p/2K(2×)/4K, MP4, folder, watermark toggle | Copy | Same; 4K via Real-ESRGAN |
| Share page: views, 6 reactions, comments, transcript, Translate/Upscale/Clip buttons, password, embed | Copy | Same; add WhatsApp share and download-to-phone |
| Video Agent: Plan vs Auto-pilot, assets/knowledge attach, brand system, 12-scene plan with A/B-roll and timings, user memories, Resources pane | Copy (v3) | Prompt P5 planner; memories stored per workspace; observed timing target: plan < 60 s |
| Translate: 175+ languages incl. 12 Indian; Audio-only 4 / Speed 6 / Precision 10 cr; SRT upload; glossary; length-fit; keep music | Copy, Indian-first | Same options; Indian languages at top; 6 cr flat |
| App library of 13 apps; Video Podcast with paid preview; Batch Mode; Speech Cleanup; Upscale (Topaz, fps up to 120); PPT to video; Interactive video | Skip most | Keep Clipping, Batch, Upscale; skip Podcast, PPT, Interactive until demand |
| Projects list with credits per project; Usage & History ledger, CSV export | Copy | Same transparency, plus cost in rupees next to credits |
| Plans: Free/Creator $29/Pro $99 tiers to 100k credits/Business $149 + $20 seat; no INR, no top-ups on Creator | Beat | INR + UPI + GST; top-ups on every paid plan; no tier ladder |
| API: v3, scoped keys, idempotency, webhooks HMAC, batch ≤100, MCP server, CLI, n8n node | Copy (v3) | Same shapes so HeyGen users can migrate n8n flows; MCP later |
| Interactivity, SSO/2FA, 60-min videos gated to Business/Enterprise | Beat | 2FA for everyone; 30-min videos on Creator |
| Complaints: credits for failed/wrong renders, stuck at 97%, no preview, limits cut silently, AI-only support | Beat | Charge on success only; progress + ETA; free preview; price changes announced 30 days ahead; WhatsApp support in India |

The research workbook stays the source of truth for details; this table is the contract for what the product must contain.
