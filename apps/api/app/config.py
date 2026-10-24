"""
Central configuration for the API and the worker.

Every setting comes from the environment (or a .env file at the repo root).
Nothing else in the code base reads os.environ directly - it all goes through
`settings`, so a new engineer can see every knob in one place.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# The repo root is three levels above apps/api/app/config.py. Prompts and the
# local data folder are resolved against it so the API works from any cwd.
# Inside Docker the code lives at /app, so REPO_ROOT is given explicitly.
def _repo_root() -> Path:
    import os

    if os.environ.get("REPO_ROOT"):
        return Path(os.environ["REPO_ROOT"])
    parents = Path(__file__).resolve().parents
    return parents[3] if len(parents) > 3 else parents[-1]


REPO_ROOT = _repo_root()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", Path(".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- App -----------------------------------------------------------
    app_name: str = "Avatar Studio"
    env: str = Field(default="dev", description="dev | test | prod")
    api_base_url: str = "http://localhost:8000"
    web_base_url: str = "http://localhost:3000"
    secret_key: str = Field(
        default="dev-secret-change-me",
        description="Signs local media URLs and encrypts BYO voice keys.",
    )
    cors_origins: str = "http://localhost:3000"

    # --- Database -------------------------------------------------------
    # SQLite needs no services for local dev; Postgres is used in compose/prod.
    database_url: str = f"sqlite+aiosqlite:///{(REPO_ROOT / 'data' / 'avatar.db').as_posix()}"
    auto_create_tables: bool = Field(
        default=True,
        description="Run create_all on start (dev only). Prod uses alembic.",
    )

    # --- Redis (optional: live progress fan-out and rate limits) ---------
    redis_url: str | None = None

    # --- Auth -----------------------------------------------------------
    # auth_mode=clerk verifies Clerk session JWTs against the JWKS endpoint.
    # auth_mode=dev trusts an X-Dev-User-Email header (local only).
    auth_mode: str = Field(default="dev", description="dev | clerk")
    clerk_jwks_url: str | None = None
    clerk_issuer: str | None = None
    clerk_secret_key: str | None = None

    # --- Storage --------------------------------------------------------
    storage_backend: str = Field(default="local", description="local | r2")
    local_storage_root: str = (REPO_ROOT / "data" / "storage").as_posix()
    r2_account_id: str | None = None
    r2_access_key_id: str | None = None
    r2_secret_access_key: str | None = None
    r2_bucket: str = "avatar-studio"
    r2_endpoint_url: str | None = None

    # --- Engines --------------------------------------------------------
    # Default adapters. Every one can be swapped without touching the UI.
    voice_engine_default: str = Field(
        default="auto", description="auto | mock | sapi | elevenlabs | sarvam"
    )
    avatar_engine_backend: str = Field(default="mock", description="mock | runpod")
    elevenlabs_api_key: str | None = None
    elevenlabs_model_id: str = "eleven_multilingual_v2"
    sarvam_api_key: str | None = None
    runpod_api_key: str | None = None
    runpod_endpoint_id: str | None = None
    runpod_poll_seconds: float = 5.0
    runpod_timeout_seconds: int = 5400  # long renders without flash-attn take 30+ min
    default_engine_photo: str = Field(
        default="wan_s2v", description="Stage 0 picks wan_s2v or infinitetalk"
    )
    default_engine_real_footage: str = "infinitetalk_v2v"
    default_engine_mouth_only: str = "latentsync"

    # --- LLM (Claude) ---------------------------------------------------
    anthropic_api_key: str | None = None
    llm_model_sonnet: str = "claude-sonnet-5-5"
    llm_model_haiku: str = "claude-haiku-5-5"

    # --- Media tools ----------------------------------------------------
    ffmpeg_bin: str = "ffmpeg"
    ffprobe_bin: str = "ffprobe"
    work_dir: str = (REPO_ROOT / "data" / "work").as_posix()

    # --- Product rules (PRD sections 3, 5 and 9) -------------------------
    preview_max_seconds: int = 15
    preview_height: int = 480
    free_plan_credits: int = 30
    credit_price_inr: int = 2
    words_per_minute: int = 150

    # --- Platform admin ---------------------------------------------------
    # Comma-separated emails allowed to edit Connections and run the Engine Lab.
    # Empty = the first user who ever signed in on this deployment.
    admin_emails: str = ""

    # --- Worker ---------------------------------------------------------
    worker_poll_seconds: float = 2.0
    worker_id: str = "worker-1"

    @property
    def prompts_dir(self) -> Path:
        return REPO_ROOT / "prompts"

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def sync_database_url(self) -> str:
        """Alembic uses a sync driver; derive it from the async URL."""
        return self.database_url.replace("sqlite+aiosqlite", "sqlite").replace(
            "postgresql+asyncpg", "postgresql+psycopg"
        )

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
