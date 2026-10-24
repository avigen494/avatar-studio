"""
The service catalogue behind Settings > Connections.

Each service lists its fields and a `test()` that makes one cheap, real call
to the provider and returns (ok, plain-English message). Tests never spend
more than a fraction of a rupee.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import httpx

from app.config import settings
from app.services.runtime_config import KEYS, cfg


@dataclass
class Field:
    key: str
    label: str
    help: str = ""
    placeholder: str = ""


@dataclass
class Service:
    id: str
    name: str
    purpose: str
    fields: list[Field]
    docs_url: str = ""
    required_for: str = ""
    extra: dict = field(default_factory=dict)

    @property
    def keys(self) -> list[str]:
        return [f.key for f in self.fields]


SERVICES: list[Service] = [
    Service(
        "elevenlabs", "ElevenLabs", "Voice cloning and English text-to-speech.",
        [Field("elevenlabs_api_key", "API key", "Profile → API keys in the ElevenLabs dashboard.", "sk_…")],
        "https://elevenlabs.io/app/settings/api-keys", "Your own voice",
    ),
    Service(
        "sarvam", "Sarvam AI", "Hindi and Hinglish voices (Bulbul).",
        [Field("sarvam_api_key", "API subscription key", "dashboard.sarvam.ai → API keys.")],
        "https://dashboard.sarvam.ai", "Hindi / Hinglish videos",
    ),
    Service(
        "anthropic", "Claude (Anthropic)", "Script helper, delivery tags, share-page summaries.",
        [Field("anthropic_api_key", "API key", "console.anthropic.com → API keys.", "sk-ant-…"),
         Field("llm_model_sonnet", "Sonnet model id", "Used for scripts and planning.", "claude-sonnet-5-5"),
         Field("llm_model_haiku", "Haiku model id", "Used for tags and summaries.", "claude-haiku-5-5")],
        "https://console.anthropic.com", "Help me write",
    ),
    Service(
        "runpod", "RunPod (GPU)", "Runs the real avatar engines. Without it, renders use the ffmpeg mock.",
        [Field("runpod_api_key", "API key", "RunPod → Settings → API keys."),
         Field("runpod_endpoint_id", "Serverless endpoint id", "The endpoint built from apps/gpu.", "abc123xyz"),
         Field("avatar_engine_backend", "Render backend", "mock = local ffmpeg; runpod = real engines.", "mock"),
         Field("default_engine_photo", "Photo-mode engine", "Set this from the Stage 0 result.", "wan_s2v"),
         Field("gpu_name", "GPU", "Shown in the Engine Lab and cost estimates.", "L40S 48GB"),
         Field("gpu_price_inr_per_hour", "GPU price (INR per hour)", "Used to compute cost per minute.", "95"),
         Field("quality_gate", "Quality gate", "on = every render must pass the face check before it is accepted or charged.", "on"),
         Field("quality_face_threshold", "Face match threshold", "InsightFace similarity 0–1; same person is usually above 0.5.", "0.45"),
         Field("quality_retries", "Retries with a new seed", "How many times a failed check re-renders before giving up (0–3).", "1")],
        "https://www.runpod.io/console/serverless", "Real lip-synced renders",
    ),
    Service(
        "fal", "fal.ai (images)", "Look generator: new outfit or background from a prompt (v2).",
        [Field("fal_api_key", "API key", "fal.ai → Keys.")],
        "https://fal.ai/dashboard/keys", "New looks from a prompt",
    ),
    Service(
        "r2", "Cloudflare R2 (storage)", "Where videos, clips and voices are stored in production.",
        [Field("storage_backend", "Storage backend", "local = this machine; r2 = Cloudflare.", "local"),
         Field("r2_account_id", "Account id"), Field("r2_access_key_id", "Access key id"),
         Field("r2_secret_access_key", "Secret access key"), Field("r2_bucket", "Bucket", "", "avatar-studio")],
        "https://dash.cloudflare.com/?to=/:account/r2", "Production storage",
    ),
    Service(
        "razorpay", "Razorpay (INR payments)", "Plans, UPI top-ups and GST invoices for India.",
        [Field("razorpay_key_id", "Key id", "Dashboard → Account & Settings → API keys.", "rzp_live_…"),
         Field("razorpay_key_secret", "Key secret"),
         Field("razorpay_webhook_secret", "Webhook secret", "Set the webhook URL to <api>/webhooks/payments/razorpay with events payment.captured, subscription.charged, subscription.cancelled, payment.failed."),
         Field("seller_name", "Invoice: business name", "", "Internet Youth Academy"),
         Field("seller_address", "Invoice: address"), Field("seller_gstin", "Invoice: GSTIN"),
         Field("price_change_notice", "Price change notice", "Shown to every user 30 days before a change.")],
        "https://dashboard.razorpay.com/app/keys", "Paid plans in India",
    ),
    Service(
        "stripe", "Stripe (USD payments)", "Plans and top-ups for the US LLC.",
        [Field("stripe_publishable_key", "Publishable key", "", "pk_live_…"), Field("stripe_secret_key", "Secret key", "", "sk_live_…"),
         Field("stripe_webhook_secret", "Webhook signing secret", "Endpoint <api>/webhooks/payments/stripe with checkout.session.completed, invoice.paid, invoice.payment_failed, customer.subscription.deleted.")],
        "https://dashboard.stripe.com/apikeys", "Paid plans in USD",
    ),
    Service(
        "whatsapp", "WhatsApp (Meta Cloud API)", "'Your video is ready' messages to users who opt in.",
        [Field("whatsapp_token", "Permanent access token", "Meta Business → System user token with whatsapp_business_messaging."),
         Field("whatsapp_phone_number_id", "Phone number id", "From the WhatsApp → API setup page.", "1234567890"),
         Field("whatsapp_template_language", "Template language code", "Templates avatar_video_ready, avatar_video_failed, avatar_style_ready must be approved.", "en")],
        "https://developers.facebook.com/apps", "WhatsApp notifications",
    ),
    Service(
        "clerk", "Clerk (sign-in)", "Google and email-link sign-in for real users.",
        [Field("auth_mode", "Auth mode", "dev = email-only sign-in; clerk = real accounts.", "dev"),
         Field("clerk_publishable_key", "Publishable key", "", "pk_…"),
         Field("clerk_secret_key", "Secret key", "", "sk_…"),
         Field("clerk_issuer", "Issuer (Frontend API URL)", "https://<app>.clerk.accounts.dev")],
        "https://dashboard.clerk.com", "Public sign-up",
        extra={"warning": "Switching to Clerk signs out dev-mode users. Do this once sign-up is ready."},
    ),
]

SERVICE_BY_ID = {s.id: s for s in SERVICES}
assert all(k in KEYS for s in SERVICES for k in s.keys)


# --- live tests -------------------------------------------------------------------
def _get(url: str, headers: dict, timeout: float = 15) -> httpx.Response:
    with httpx.Client(timeout=timeout) as client:
        return client.get(url, headers=headers)


def test_service(service_id: str) -> tuple[bool, str]:
    try:
        return _TESTS[service_id]()
    except httpx.TimeoutException:
        return False, "The service did not answer in time. Try again."
    except httpx.HTTPError as e:
        return False, f"Network error: {str(e)[:120]}"
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {str(e)[:160]}"


def _t_elevenlabs() -> tuple[bool, str]:
    key = cfg("elevenlabs_api_key")
    if not key:
        return False, "No key saved."
    r = _get("https://api.elevenlabs.io/v1/user/subscription", {"xi-api-key": key})
    if r.status_code == 401:
        return False, "ElevenLabs rejected the key."
    r.raise_for_status()
    d = r.json()
    used, limit = d.get("character_count", 0), d.get("character_limit", 0)
    # The subscription call succeeds even when speech is blocked (billing, permissions),
    # so make one two-word speech call too. It costs a handful of characters.
    from app.adapters.voice.elevenlabs import ElevenLabsError, raise_for_status

    with httpx.Client(timeout=30) as client:
        t = client.post(f"https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL",
                        headers={"xi-api-key": key, "accept": "audio/mpeg"},
                        params={"output_format": "mp3_22050_32"},
                        json={"text": "Hello there.", "model_id": "eleven_multilingual_v2"})
    try:
        raise_for_status(t)
    except ElevenLabsError as e:
        return False, f"Key accepted, but speech is blocked: {e}"
    return True, f"Connected and speaking. Plan {d.get('tier', '?')}: {used:,} of {limit:,} characters used this cycle."


def _t_sarvam() -> tuple[bool, str]:
    key = cfg("sarvam_api_key")
    if not key:
        return False, "No key saved."
    with httpx.Client(timeout=20) as client:
        r = client.post("https://api.sarvam.ai/text-to-speech", headers={"api-subscription-key": key},
                        json={"inputs": ["नमस्ते"], "target_language_code": "hi-IN", "speaker": "anushka",
                              "model": "bulbul:v2"})
    if r.status_code in (401, 403):
        return False, "Sarvam rejected the key."
    r.raise_for_status()
    return True, "Connected. Hindi voices are available."


def _t_anthropic() -> tuple[bool, str]:
    key = cfg("anthropic_api_key")
    if not key:
        return False, "No key saved."
    import anthropic

    client = anthropic.Anthropic(api_key=key)
    try:
        model = cfg("llm_model_haiku") or "claude-haiku-5-5"
        client.models.retrieve(model)
        sonnet = cfg("llm_model_sonnet") or "claude-sonnet-5-5"
        client.models.retrieve(sonnet)
    except anthropic.AuthenticationError:
        return False, "Anthropic rejected the key."
    except anthropic.NotFoundError as e:
        return False, f"A model id is wrong: {str(e)[:120]}"
    return True, f"Connected. Models {model} and {sonnet} are available."


def _t_runpod() -> tuple[bool, str]:
    key, endpoint = cfg("runpod_api_key"), cfg("runpod_endpoint_id")
    if not key:
        return False, "No API key saved."
    if not endpoint:
        return False, "No endpoint id saved."
    r = _get(f"https://api.runpod.ai/v2/{endpoint}/health", {"Authorization": f"Bearer {key}"})
    if r.status_code == 401:
        return False, "RunPod rejected the API key."
    if r.status_code == 404:
        return False, "That endpoint id was not found."
    r.raise_for_status()
    d = r.json()
    w = d.get("workers", {})
    ready = w.get("ready", 0) + w.get("idle", 0)
    return True, f"Endpoint reachable. Workers: {ready} ready, {w.get('running', 0)} running, {w.get('initializing', 0)} starting."


def _t_fal() -> tuple[bool, str]:
    key = cfg("fal_api_key")
    if not key:
        return False, "No key saved."
    r = _get("https://rest.alpha.fal.ai/tokens/", {"Authorization": f"Key {key}"})
    if r.status_code in (401, 403):
        return False, "fal.ai rejected the key."
    return True, "Connected."


def _t_r2() -> tuple[bool, str]:
    if (cfg("storage_backend") or "local") == "local":
        return True, "Using local disk storage on this machine."
    if not all(cfg(k) for k in ("r2_account_id", "r2_access_key_id", "r2_secret_access_key", "r2_bucket")):
        return False, "Fill in account id, access key, secret and bucket."
    from app.adapters.storage.r2 import R2Storage

    s = R2Storage()
    s.client.head_bucket(Bucket=s.bucket)
    try:
        origins = s.ensure_cors()
    except Exception:  # noqa: BLE001 - an Object Read & Write token cannot change bucket settings
        return True, (f"Bucket {s.bucket} is reachable. This token cannot set the bucket's CORS rule, so make sure the "
                      f"bucket's CORS policy in the Cloudflare dashboard allows PUT from {settings.web_base_url}.")
    return True, f"Bucket {s.bucket} is reachable; browser uploads allowed from {', '.join(origins)}."


def _t_clerk() -> tuple[bool, str]:
    if (cfg("auth_mode") or "dev") == "dev":
        return True, "Dev sign-in (email only). Switch Auth mode to clerk when ready."
    issuer, jwks = cfg("clerk_issuer"), cfg("clerk_jwks_url")
    url = jwks or (issuer.rstrip("/") + "/.well-known/jwks.json" if issuer else None)
    if not url:
        return False, "Add the issuer URL (Frontend API URL in Clerk)."
    r = _get(url, {})
    r.raise_for_status()
    n = len(r.json().get("keys", []))
    if not cfg("clerk_publishable_key"):
        return False, "Add the publishable key so the web app can show Clerk sign-in."
    return True, f"JWKS reachable ({n} key(s)). Clerk sign-in is live."


def _t_razorpay() -> tuple[bool, str]:
    kid, secret = cfg("razorpay_key_id"), cfg("razorpay_key_secret")
    if not (kid and secret):
        return False, "Add the key id and secret."
    with httpx.Client(timeout=15, auth=(kid, secret)) as client:
        r = client.get("https://api.razorpay.com/v1/payments", params={"count": 1})
    if r.status_code == 401:
        return False, "Razorpay rejected the key."
    r.raise_for_status()
    mode = "live" if kid.startswith("rzp_live") else "test"
    hook = "webhook secret set" if cfg("razorpay_webhook_secret") else "webhook secret missing (renewals will not be recorded)"
    return True, f"Connected in {mode} mode; {hook}."


def _t_stripe() -> tuple[bool, str]:
    key = cfg("stripe_secret_key")
    if not key:
        return False, "Add the secret key."
    with httpx.Client(timeout=15, auth=(key, "")) as client:
        r = client.get("https://api.stripe.com/v1/balance")
    if r.status_code == 401:
        return False, "Stripe rejected the key."
    r.raise_for_status()
    mode = "live" if key.startswith("sk_live") else "test"
    hook = "webhook secret set" if cfg("stripe_webhook_secret") else "webhook secret missing (payments will not be recorded)"
    return True, f"Connected in {mode} mode; {hook}."


def _t_whatsapp() -> tuple[bool, str]:
    token, pnid = cfg("whatsapp_token"), cfg("whatsapp_phone_number_id")
    if not (token and pnid):
        return False, "Add the access token and phone number id."
    r = _get(f"https://graph.facebook.com/v21.0/{pnid}", {"Authorization": f"Bearer {token}"})
    if r.status_code in (400, 401, 403):
        return False, "Meta rejected the token or phone number id."
    r.raise_for_status()
    d = r.json()
    return True, f"Connected: {d.get('verified_name', 'number')} ({d.get('display_phone_number', pnid)})."


_TESTS = {
    "elevenlabs": _t_elevenlabs, "sarvam": _t_sarvam, "anthropic": _t_anthropic, "runpod": _t_runpod,
    "fal": _t_fal, "r2": _t_r2, "razorpay": _t_razorpay, "stripe": _t_stripe, "whatsapp": _t_whatsapp, "clerk": _t_clerk,
}
