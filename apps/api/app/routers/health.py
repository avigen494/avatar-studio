from __future__ import annotations

import shutil

from fastapi import APIRouter
from sqlalchemy import text

from app.config import settings
from app.services.runtime_config import cfg
from app.db import engine

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    db_ok = True
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "env": settings.env,
        "db": db_ok,
        "ffmpeg": bool(shutil.which(settings.ffmpeg_bin)),
        "storage": cfg("storage_backend") or "local",
        "avatar_engine": cfg("avatar_engine_backend") or "mock",
        "auth_mode": cfg("auth_mode") or "dev",
    }
