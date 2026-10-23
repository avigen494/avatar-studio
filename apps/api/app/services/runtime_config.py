"""
Runtime configuration: values the admin can change from Settings > Connections
without restarting anything.

Resolution order for cfg("elevenlabs_api_key"):
  1. platform_settings row (encrypted in the database, cached 15 seconds)
  2. the environment / .env value in settings
  3. None

Both the API and the worker read through this module, so a key pasted in the
UI is used by the next render.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass

from sqlalchemy import select

from app.config import settings
from app.services import crypto

CACHE_TTL = 15.0


@dataclass(frozen=True)
class KeySpec:
    key: str
    secret: bool = True
    choices: tuple[str, ...] | None = None


# Every key the Connections page may write. Anything else is refused.
KEYS: dict[str, KeySpec] = {
    # voice
    "elevenlabs_api_key": KeySpec("elevenlabs_api_key"),
    "sarvam_api_key": KeySpec("sarvam_api_key"),
    "voice_engine_default": KeySpec("voice_engine_default", False, ("auto", "mock", "sapi", "elevenlabs", "sarvam")),
    # llm
    "anthropic_api_key": KeySpec("anthropic_api_key"),
    "llm_model_sonnet": KeySpec("llm_model_sonnet", False),
    "llm_model_haiku": KeySpec("llm_model_haiku", False),
    # gpu
    "runpod_api_key": KeySpec("runpod_api_key"),
    "runpod_endpoint_id": KeySpec("runpod_endpoint_id", False),
    "avatar_engine_backend": KeySpec("avatar_engine_backend", False, ("mock", "runpod")),
    "default_engine_photo": KeySpec("default_engine_photo", False, ("wan_s2v", "infinitetalk")),
    "gpu_price_inr_per_hour": KeySpec("gpu_price_inr_per_hour", False),
    "gpu_name": KeySpec("gpu_name", False),
    # quality gate
    "quality_gate": KeySpec("quality_gate", False, ("on", "off")),
    "quality_face_threshold": KeySpec("quality_face_threshold", False),
    "quality_frame_threshold": KeySpec("quality_frame_threshold", False),
    "quality_retries": KeySpec("quality_retries", False),
    # images (v2 look generator)
    "fal_api_key": KeySpec("fal_api_key"),
    # storage
    "storage_backend": KeySpec("storage_backend", False, ("local", "r2")),
    "r2_account_id": KeySpec("r2_account_id", False),
    "r2_access_key_id": KeySpec("r2_access_key_id", False),
    "r2_secret_access_key": KeySpec("r2_secret_access_key"),
    "r2_bucket": KeySpec("r2_bucket", False),
    # payments
    "razorpay_key_id": KeySpec("razorpay_key_id", False),
    "razorpay_key_secret": KeySpec("razorpay_key_secret"),
    "razorpay_webhook_secret": KeySpec("razorpay_webhook_secret"),
    "stripe_publishable_key": KeySpec("stripe_publishable_key", False),
    "stripe_secret_key": KeySpec("stripe_secret_key"),
    "stripe_webhook_secret": KeySpec("stripe_webhook_secret"),
    "seller_name": KeySpec("seller_name", False),
    "seller_address": KeySpec("seller_address", False),
    "seller_gstin": KeySpec("seller_gstin", False),
    "price_change_notice": KeySpec("price_change_notice", False),
    # notifications
    "whatsapp_token": KeySpec("whatsapp_token"),
    "whatsapp_phone_number_id": KeySpec("whatsapp_phone_number_id", False),
    "whatsapp_template_language": KeySpec("whatsapp_template_language", False),
    # auth
    "auth_mode": KeySpec("auth_mode", False, ("dev", "clerk")),
    "clerk_issuer": KeySpec("clerk_issuer", False),
    "clerk_jwks_url": KeySpec("clerk_jwks_url", False),
    "clerk_publishable_key": KeySpec("clerk_publishable_key", False),
    "clerk_secret_key": KeySpec("clerk_secret_key"),
}

_DEFAULTS = {"gpu_price_inr_per_hour": "95", "gpu_name": "L40S 48GB", "clerk_publishable_key": ""}

_lock = threading.Lock()
_cache: dict[str, str] = {}
_cache_at = 0.0


def _load_from_db() -> dict[str, str]:  # noqa: D103
    from app.models.platform import PlatformSetting
    from app.worker.db import SyncSession

    out: dict[str, str] = {}
    try:
        with SyncSession() as db:
            for row in db.scalars(select(PlatformSetting)).all():
                val = crypto.decrypt(row.value_encrypted)
                if val is not None:
                    out[row.key] = val
    except Exception:
        # Table missing (first boot before create_all) or DB down: env values still work.
        return {}
    return out


def refresh(force: bool = False) -> dict[str, str]:
    global _cache, _cache_at
    with _lock:
        if force or time.time() - _cache_at > CACHE_TTL:
            _cache = _load_from_db()
            _cache_at = time.time()
        return dict(_cache)


def cfg(key: str) -> str | None:
    """The live value for a key, or None when it is empty everywhere."""
    val = refresh().get(key)
    if val is None or val == "":
        val = getattr(settings, key, None)
    if val is None or val == "":
        val = _DEFAULTS.get(key)
    return None if val in (None, "") else str(val)


def cfg_bool(key: str) -> bool:
    return str(cfg(key) or "").lower() in ("1", "true", "yes", "on")


def source_of(key: str) -> str:
    """Where the current value comes from: db | env | default | none."""
    if refresh().get(key):
        return "db"
    if getattr(settings, key, None):
        return "env"
    if _DEFAULTS.get(key):
        return "default"
    return "none"


def set_values(db, values: dict[str, str | None], updated_by: str | None = None) -> None:
    """Write (sync Session). Empty string or None deletes the override."""
    from app.models.platform import PlatformSetting

    for key, value in values.items():
        spec = KEYS.get(key)
        if spec is None:
            raise KeyError(key)
        row = db.get(PlatformSetting, key)
        if value is None or str(value).strip() == "":
            if row:
                db.delete(row)
            continue
        value = str(value).strip()
        if spec.choices and value not in spec.choices:
            raise ValueError(f"{key} must be one of {', '.join(spec.choices)}")
        if row is None:
            row = PlatformSetting(key=key, is_secret=spec.secret)
            db.add(row)
        row.value_encrypted = crypto.encrypt(value)
        row.updated_by = updated_by
    db.flush()
    refresh(force=True)


def record_test(db, keys: list[str], ok: bool, message: str) -> None:
    from datetime import datetime, timezone

    from app.models.platform import PlatformSetting

    for key in keys:
        row = db.get(PlatformSetting, key)
        if row:
            row.last_test_ok, row.last_test_message = ok, message[:500]
            row.last_tested_at = datetime.now(timezone.utc)
    db.flush()


def masked(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "•" * len(value)
    return f"{value[:3]}…{value[-4:]}"
