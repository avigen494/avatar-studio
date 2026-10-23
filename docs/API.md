# Avatar Studio API

Base URL: your API host (local: `http://localhost:8000`). Interactive docs: `/docs`. Every error has the shape `{"error": {"code", "message"}}`.

## Authentication

Create a key in **Settings → API keys** (Pro and Team plans). Keys look like `ask_live_…` and are shown once. Send them as a bearer token:

```bash
curl -H "Authorization: Bearer ask_live_XXXX" https://api.example.com/videos
```

Scopes: `read` (list and fetch) and `write` (create, generate, cancel, manage webhooks). A key acts inside the workspace that created it. Keys never reach platform settings or billing.

## Make a video

```bash
# 1. Create a draft (Idempotency-Key makes retries safe)
curl -X POST https://api.example.com/videos \
  -H "Authorization: Bearer ask_live_XXXX" -H "Idempotency-Key: order-1042" \
  -H "Content-Type: application/json" \
  -d '{"identity_id":"<avatar id>","voice_id":"<voice id>","script":"Hi Priya, your order is on its way.","aspect":"9:16","language":"en"}'

# 2. Queue the render (credits are charged only on success)
curl -X POST https://api.example.com/videos/<id>/generate -H "Authorization: Bearer ask_live_XXXX"

# 3. Poll, or wait for the webhook
curl https://api.example.com/videos/<id> -H "Authorization: Bearer ask_live_XXXX"
```

Useful ids: `GET /identities` (avatars and their looks), `GET /voices`, `POST /videos/estimate` (credits before you commit).

## Batch (up to 100)

```bash
curl -X POST https://api.example.com/videos/batch -H "Authorization: Bearer ask_live_XXXX" -H "Content-Type: application/json" \
  -d '{"identity_id":"<avatar>","voice_id":"<voice>","generate":true,
       "items":[{"script":"Hi Aman…","title":"Aman","idempotency_key":"lead-1"},{"script":"Hi Neha…","title":"Neha","idempotency_key":"lead-2"}]}'
```

Credits for the whole batch are checked first. If they are short, nothing is queued and the drafts are kept (`402 insufficient_credits`).

CSV: `POST /videos/batch/csv` (multipart `file`, plus form fields `identity_id`, `voice_id`, `generate`). Columns: `script` (required), `title`, `language`, `aspect`, `quality`, `identity_id`, `voice_id`, `idempotency_key`, `expression`, `gesture`, `gaze`.

## Webhooks

Create one in **Settings → Webhooks** or `POST /webhooks {"url","events"}`. Events:

`video.succeeded` · `video.failed` · `video.cancelled` · `preview.ready` · `identity.verified` · `identity.rejected` · `style.ready` · `style.failed` · `look.generated` · `test.ping`

Each delivery is a JSON POST:

```json
{"event":"video.succeeded","created_at":"2026-10-17T04:12:09Z","data":{"id":"…","title":"…","status":"succeeded","output_url":"…","share_url":"…","charged_credits":10}}
```

Headers: `X-AvatarStudio-Event`, `X-AvatarStudio-Delivery`, `X-AvatarStudio-Signature: t=<unix>,v1=<hex>`.

Verify: `v1 == hex(hmac_sha256(secret, f"{t}.{raw_body}"))` and reject if `|now - t| > 300` seconds.

```python
import hmac, hashlib, time
def verify(secret, raw_body: bytes, header: str) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    if abs(time.time() - int(parts["t"])) > 300: return False
    expected = hmac.new(secret.encode(), f"{parts['t']}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts["v1"])
```

Retries: 1 min, 5 min, 30 min, 2 h, 12 h, then marked failed. Replay any delivery from the Webhooks page or `POST /webhooks/deliveries/{id}/replay`. Return any 2xx quickly; do the work afterwards.

## n8n and Zapier

Use an HTTP Request node with the bearer header for `POST /videos` + `POST /videos/{id}/generate`, and a Webhook trigger node for `video.succeeded`. The `output_url` in the payload is a signed link valid for one hour; download it in the same flow or call `GET /videos/{id}` later for a fresh link. The packaged node lives in `packages/n8n-nodes-avatar-studio` (install from the Community Nodes screen once published, or copy it into `~/.n8n/custom`). Its trigger node registers the webhook for you with a write-scoped key.

## Limits

- 100 items per batch, 10 webhooks per workspace, scripts up to 20,000 characters.
- Signed media links expire after one hour; fetch the video again for a new one.
