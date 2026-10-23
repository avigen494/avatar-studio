#!/usr/bin/env bash
# Smoke-test the HTTP shapes the n8n node relies on, straight against the API with curl.
#
#   BASE_URL=http://localhost:8000 API_KEY=ask_live_... bash scripts/smoke.sh
#
# Creates one draft video (idempotent), estimates it, lists videos, creates two
# batch drafts (not queued) and reads avatars, voices and credits. Nothing is
# rendered unless you pass GENERATE=1, in which case the draft is queued and
# polled the same way the node's "Wait for Completion" does.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"
: "${API_KEY:?set API_KEY to an Avatar Studio API key (ask_live_...)}"
AUTH="Authorization: Bearer ${API_KEY}"
JSON="Content-Type: application/json"

json() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(eval(process.argv[1]))})' "$1"; }

echo "== GET /credits (credential test)"
curl -sS "$BASE_URL/credits" -H "$AUTH"; echo

echo "== GET /identities"
IDENTITY_ID=$(curl -sS "$BASE_URL/identities" -H "$AUTH" | json 'j.filter(i=>i.can_render)[0].id')
echo "identity_id=$IDENTITY_ID"

echo "== GET /voices"
VOICE_ID=$(curl -sS "$BASE_URL/voices" -H "$AUTH" | json '(j.find(v=>v.is_default)||j[0]).id')
echo "voice_id=$VOICE_ID"

echo "== POST /videos/estimate"
curl -sS -X POST "$BASE_URL/videos/estimate" -H "$AUTH" -H "$JSON" \
  -d "{\"script\":\"Hi Priya, your order is on its way.\",\"language\":\"en\",\"engine_mode\":\"auto\",\"quality\":\"720p\",\"identity_id\":\"$IDENTITY_ID\"}"; echo

echo "== POST /videos (Idempotency-Key: n8n-smoke-1)"
VIDEO_ID=$(curl -sS -X POST "$BASE_URL/videos" -H "$AUTH" -H "$JSON" -H "Idempotency-Key: n8n-smoke-1" \
  -d "{\"identity_id\":\"$IDENTITY_ID\",\"voice_id\":\"$VOICE_ID\",\"script\":\"Hi Priya, your order is on its way.\",\"title\":\"n8n smoke\",\"language\":\"en\",\"aspect\":\"9:16\",\"quality\":\"720p\",\"captions\":true}" | json 'j.id+" "+j.status')
echo "video=$VIDEO_ID"
VIDEO_ID=${VIDEO_ID%% *}

echo "== GET /videos/$VIDEO_ID"
curl -sS "$BASE_URL/videos/$VIDEO_ID" -H "$AUTH" | json 'JSON.stringify({id:j.id,status:j.status,estimated_credits:j.estimated_credits,output_url:j.output_url})'

echo "== GET /videos?status=draft&limit=5"
curl -sS "$BASE_URL/videos?status=draft&limit=5" -H "$AUTH" | json 'j.items.length+" items, next_cursor="+j.next_cursor'

echo "== POST /videos/batch (generate=false)"
curl -sS -X POST "$BASE_URL/videos/batch" -H "$AUTH" -H "$JSON" \
  -d "{\"identity_id\":\"$IDENTITY_ID\",\"voice_id\":\"$VOICE_ID\",\"generate\":false,\"items\":[{\"script\":\"Hi Aman, welcome.\",\"title\":\"Aman\",\"idempotency_key\":\"n8n-smoke-b1\"},{\"script\":\"Hi Neha, welcome.\",\"title\":\"Neha\",\"idempotency_key\":\"n8n-smoke-b2\"}]}"; echo

if [[ "${GENERATE:-0}" == "1" ]]; then
  echo "== POST /videos/$VIDEO_ID/generate"
  curl -sS -X POST "$BASE_URL/videos/$VIDEO_ID/generate" -H "$AUTH" | json 'j.status'
  for _ in $(seq 1 180); do
    STATUS=$(curl -sS "$BASE_URL/videos/$VIDEO_ID" -H "$AUTH" | json 'j.status+" "+j.stage+" "+j.progress+"%"')
    echo "   $STATUS"
    case "$STATUS" in succeeded*|failed*|cancelled*) break;; esac
    sleep 5
  done
  curl -sS "$BASE_URL/videos/$VIDEO_ID" -H "$AUTH" | json 'JSON.stringify({status:j.status,charged_credits:j.charged_credits,output_url:j.output_url})'
fi

echo "== GET /webhooks/events"
curl -sS "$BASE_URL/webhooks/events" -H "$AUTH"; echo
echo "== POST /webhooks (needs an owner/admin key; editors get 403)"
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$BASE_URL/webhooks" -H "$AUTH" -H "$JSON" \
  -d '{"url":"https://n8n.example.com/webhook/avatar-studio","events":["video.succeeded"],"description":"n8n smoke"}'
echo "done"
