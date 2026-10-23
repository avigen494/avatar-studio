# n8n-nodes-avatar-studio

An [n8n](https://n8n.io) community node for **Avatar Studio**: create AI avatar videos from any workflow, wait for the render, and start workflows from Avatar Studio's signed webhooks.

The package ships two nodes and one credential:

| Item | What it does |
| --- | --- |
| **Avatar Studio** (regular node) | Video: Create, Get, Generate, Cancel, Estimate, Batch, List. Avatar: List, Get. Voice: List. Credit: Get Balance. |
| **Avatar Studio Trigger** (webhook trigger) | Starts a workflow on `video.succeeded`, `video.failed`, `video.cancelled`, `preview.ready`, `identity.verified`, `style.ready` or `look.generated`, after verifying the HMAC signature. |
| **Avatar Studio API** (credential) | Base URL + API key (bearer). The credential test calls `GET /credits`. |

## Install

### Option A: Community Nodes UI (n8n cloud or self-hosted ≥ 0.187)

1. Open **Settings → Community Nodes → Install**.
2. Enter `n8n-nodes-avatar-studio`, tick the risk acknowledgement and click **Install**.
3. The nodes appear in the node picker as *Avatar Studio* and *Avatar Studio Trigger*.

### Option B: npm in the custom folder (self-hosted)

```bash
# default custom folder; override with N8N_CUSTOM_EXTENSIONS
mkdir -p ~/.n8n/custom && cd ~/.n8n/custom
npm init -y >/dev/null 2>&1 || true
npm install n8n-nodes-avatar-studio
# restart n8n
```

For Docker, mount the folder and set `N8N_CUSTOM_EXTENSIONS=/home/node/.n8n/custom`.

### Option C: from this repository (development)

```bash
cd packages/n8n-nodes-avatar-studio
npm install
npm run build            # tsc + icons -> dist/
npm link
cd ~/.n8n/custom && npm link n8n-nodes-avatar-studio
n8n start
```

## Credential

1. In Avatar Studio open **Settings → API keys** and create a key (Pro and Team plans). Keys look like `ask_live_…` and are shown once. Give it the `read` scope for Get/List and `write` for Create, Generate, Cancel and Batch.
2. In n8n create an **Avatar Studio API** credential:
   - **Base URL**: your API host, for example `https://api.avatarstudio.example` (or `http://localhost:8000` for a local instance). No trailing slash.
   - **API Key**: the `ask_live_…` value.
3. Click **Test**. The node calls `GET /credits`; a balance and plan mean you are good to go.

## Walkthrough: Google Sheet row → Avatar Studio Create (wait) → Send WhatsApp

Goal: every new row in a sheet (columns `name`, `phone`, `script`) becomes a personalised avatar video, and the signed video link is sent to the person on WhatsApp.

1. **Google Sheets Trigger**
   - Event: *Row Added*. Pick your spreadsheet and sheet. Poll every minute.
   - Output per row: `{{ $json.name }}`, `{{ $json.phone }}`, `{{ $json.script }}`.

2. **Avatar Studio** node
   - Credential: the one you created above.
   - Resource **Video**, Operation **Create**.
   - **Avatar**: pick your avatar from the dropdown (it lists `GET /identities`; avatars that cannot render yet are marked).
   - **Voice**: pick a voice (from `GET /voices`).
   - **Script**: `{{ $json.script }}`
   - **Title**: `{{ $json.name }}`
   - Language `English`, Aspect `9:16`, Quality `720p`, Captions on.
   - **Additional Fields → Idempotency Key**: `sheet-{{ $json.row_number }}`. If the workflow retries, the same key returns the same video instead of creating a second one (sent as the `Idempotency-Key` header).
   - **Generate Now**: on. The node creates the draft with `POST /videos`, then queues it with `POST /videos/{id}/generate`. Credits are charged only when the render succeeds.
   - **Wait for Completion**: on, **Wait Timeout**: 15 minutes. The node polls `GET /videos/{id}` every 5 seconds until the status is `succeeded`, `failed` or `cancelled` and returns the final video object, including `output_url`, `share_url`, `charged_credits`, `duration_s` and `status`.

   Tip: add an **IF** node after this one on `{{ $json.status === 'succeeded' }}` so failed renders (`error_message` is set) go to a Slack/email branch instead of WhatsApp.

3. **WhatsApp Business Cloud** node (or Twilio / any HTTP node)
   - Operation: *Send Message*, To: `{{ $('Google Sheets Trigger').item.json.phone }}`.
   - Body: `Hi {{ $('Google Sheets Trigger').item.json.name }}, your video is ready: {{ $json.share_url || $json.output_url }}`.
   - `output_url` is a signed link valid for **one hour**. Send it right away, or use `share_url` (the public share page) for a link that does not expire. If you need a fresh signed link later, run **Video → Get** again.

Optional: run **Video → Estimate** with the same script before Create and stop (or alert) when `can_afford` is false or `blockers` is non-empty. **Credit → Get Balance** gives the workspace balance for a daily low-balance warning.

### Many rows at once

Use **Video → Batch** instead of looping Create. Feed it a JSON array (up to 100 items, built with a Code or Aggregate node):

```json
[
  { "script": "Hi Aman, welcome aboard.", "title": "Aman", "idempotency_key": "lead-1" },
  { "script": "Hi Neha, welcome aboard.", "title": "Neha", "idempotency_key": "lead-2" }
]
```

Set the avatar and voice once under **Defaults** and leave **Generate** on. Credits for the whole batch are checked first; if they are short nothing is queued and the drafts are kept (`402 insufficient_credits`). The response lists `rows[].video_id` and `status`; pair it with the trigger below to be told when each one finishes.

## Avatar Studio Trigger

Add the trigger, choose the events (default `video.succeeded`), activate the workflow. Each delivery becomes one item:

```json
{
  "event": "video.succeeded",
  "created_at": "2026-10-17T04:12:09Z",
  "data": { "id": "…", "title": "…", "status": "succeeded", "output_url": "…", "share_url": "…", "charged_credits": 10 },
  "delivery_id": "…"
}
```

The node answers `200` as soon as the payload is verified; the workflow runs afterwards, so long branches do not block Avatar Studio's delivery (it retries failed deliveries after 1 min, 5 min, 30 min, 2 h and 12 h).

### Registration modes

- **Automatic** (default): on activation the node calls `POST /webhooks` with the workflow's production URL and your events, stores the returned `id` and `secret` in the workflow's static data, and calls `DELETE /webhooks/{id}` on deactivation. If you change the events, it re-registers.
  Avatar Studio only lets workspace **owners and admins** manage webhooks, and API keys currently act as *editors*, so automatic registration can fail with `403 forbidden`. The node reports this with the URL you need; then use manual mode.
- **Manual**: in Avatar Studio open **Settings → Webhooks**, create a webhook with the node's **Production URL** and the events you want, copy the `whsec_…` secret and paste it into the node's **Webhook Secret** field. Events the node is not subscribed to are acknowledged with `200` and ignored.

### Signature verification

Every delivery carries `X-AvatarStudio-Signature: t=<unix seconds>,v1=<hex>`. The trigger recomputes

```
v1 == hex( HMAC_SHA256( secret, `${t}.${raw_body}` ) )
```

over the **raw request bytes** (not a re-serialised JSON object), compares it in constant time, and rejects the delivery with `401` when the signature does not match or when `|now - t| > 300 s` (configurable under *Options → Timestamp Tolerance*). Only verified payloads reach your workflow, so you can trust `data.output_url` and `charged_credits` without another `GET /videos/{id}`. The `X-AvatarStudio-Event` and `X-AvatarStudio-Delivery` headers are available via *Options → Include Headers*; `delivery_id` is always added to the item.

## Operations reference

| Resource / operation | Request | Notes |
| --- | --- | --- |
| Video → Create | `POST /videos` (+ `POST /videos/{id}/generate`) | `Idempotency-Key` header from Additional Fields. Generate Now and Wait for Completion as described above. |
| Video → Get | `GET /videos/{id}` | Returns a fresh signed `output_url` for finished videos. |
| Video → Generate | `POST /videos/{id}/generate` | Queues a draft; optional Wait for Completion. |
| Video → Cancel | `POST /videos/{id}/cancel` | Only queued/rendering videos change state. |
| Video → Estimate | `POST /videos/estimate` | Script, language, engine mode, quality, optional avatar. Returns credits, INR, `can_afford`, guardrails, blockers. |
| Video → Batch | `POST /videos/batch` | JSON items (≤ 100) + defaults + generate flag. |
| Video → List | `GET /videos` | Limit, filters: status, project ID, search, cursor. Items are returned one per n8n item. |
| Avatar → List / Get | `GET /identities`, `GET /identities/{id}` | Includes `looks[]` and `can_render`. |
| Voice → List | `GET /voices` | |
| Credit → Get Balance | `GET /credits` | `balance`, `plan`, `price_per_credit_inr`. |

Errors come back as n8n API errors with Avatar Studio's `{"error": {"code", "message"}}` text, for example `402 insufficient_credits` or `422` validation failures. Enable *Settings → On Error → Continue* on the node to route them.

## Development

```bash
npm install
npm run build      # tsc + copy icons to dist/
npm run lint       # eslint with the n8n community node rules
API_KEY=ask_live_... BASE_URL=http://localhost:8000 npm run smoke   # curl the endpoints the node uses
```

`scripts/smoke.sh` exercises the exact HTTP shapes the node sends (create with Idempotency-Key, estimate, list, batch, identities, voices, credits, webhook events). Pass `GENERATE=1` to also queue the draft and poll it like *Wait for Completion* does.

## Compatibility

Built and tested against `n8n-workflow` 2.x type definitions; the node uses only the declarative routing API plus `preSend`/`postReceive` hooks and the standard webhook trigger lifecycle, which have been stable since n8n 1.0. Node.js 18.10 or newer.

## License

MIT
