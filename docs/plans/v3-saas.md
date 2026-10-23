# Plan: v3 SaaS (weeks 8–14)

Done when: first 20 paying users; cost per minute ≤ ₹60 at p95.

## Phases

| Phase | Items (PRD section 4 + 13) | Backend | Web |
| --- | --- | --- | --- |
| A Money + teams | Plans (Free / Creator ₹999 / Pro ₹2,499 / Team ₹5,999 + ₹499 seat; USD $12 / $29 / $69), Razorpay subscriptions + UPI top-ups + GST invoice, Stripe for USD, charge-on-success unchanged, rollover rule, team invites + roles (owner/admin/editor/viewer), per-avatar permission, workspace create/switch, 30-day price-change notice setting | | |
| B Developers | API keys (scoped, hashed), idempotency on POST /videos, batch ≤ 100 + CSV import, webhooks (HMAC, retries, replay), n8n node, MCP later | | |
| C Features | Translate (P4 + glossary; audio-only 6 cr/min; lip-sync via mouth-only engine), AI Clipping (STT + P9 picker + vertical reframe + caption presets), WhatsApp "video ready" notification, Video Agent (P5 plan → script), admin usage dashboard (renders, minutes, credits, cost, failures per workspace), 2FA via Clerk | | |

## Decisions

- Payments are adapters (`adapters/payments`): `razorpay`, `stripe`, `mock` (dev: a "Pay" button that succeeds instantly). Webhook secrets and keys live in Connections.
- Plan credits are granted on each paid period start. Creator rolls over one month: at renewal, balance above one monthly grant expires (ledger `adjust`). Pro/Team do not expire.
- GST: 18% shown on every INR invoice; invoice numbers `AS-YYYY-NNNNN`; invoices are HTML pages (printable) with a PDF export later.
- Team seats: Team plan includes 15 members; each extra seat is a ₹499/month add-on quantity on the same subscription.
- API keys authenticate as an "editor" of their workspace. Webhook events: `video.succeeded`, `video.failed`, `video.cancelled`, `preview.ready`, `identity.verified`, `style.ready`.
- Clipping costs 1 credit per source minute (not in the PRD price table; assumption to confirm).

## Status (17 Oct 2026)

| Phase | Backend | Web |
| --- | --- | --- |
| A Money + teams | done, tested (mock provider locally; Razorpay/Stripe need keys in Connections) | done: Plan & credits, Team, invite page, workspace switcher, per-avatar access |
| B Developers | done, tested; docs/API.md | done: Developers page (keys, webhooks, deliveries), Batch from CSV; n8n node in packages/ |
| C Features | done, tested with mock STT/LLM (ElevenLabs Scribe and Claude when connected) | done: Translate and Clip sheets, Versions, Plan a video tab, Notifications, Usage dashboard |

Assumptions to confirm with Avinash: clipping price (1 credit per source minute); Translate prorated to the second at 6 credits/min; Creator rollover = balance above 600 expires at renewal.
