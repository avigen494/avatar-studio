"""
Uploads and media serving.

The browser never sends files through the API in R2 mode: it asks for a
presigned PUT and uploads straight to the bucket. In local mode the "bucket"
is this API, so the same flow lands on PUT /uploads/local/{key}. Either way
the key is always under the caller's workspace prefix.
"""
from __future__ import annotations

import mimetypes
from pathlib import Path
from urllib.parse import unquote

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import FileResponse, RedirectResponse

from app.adapters.storage import get_storage
from app.config import settings
from app.services.runtime_config import cfg
from app.deps import ApiError, CanEdit, Ctx
from app.models.base import new_id
from app.schemas import PresignIn, PresignOut
from app.services.crypto import verify_media

router = APIRouter(tags=["uploads"])

ALLOWED = {
    "reference": ("video/",),
    "consent": ("video/", "audio/"),
    "look": ("image/", "video/"),
    "voice_sample": ("audio/", "video/"),
    "brand": ("image/",),
    "footage": ("video/",),
}
MAX_LOCAL_UPLOAD = 2 * 1024 * 1024 * 1024  # 2 GB in local mode


@router.post("/uploads/presign", response_model=PresignOut)
async def presign(body: PresignIn, ctx: Ctx = CanEdit) -> PresignOut:
    if not body.content_type.startswith(ALLOWED[body.purpose]):
        raise ApiError(400, "wrong_file_type", f"A {body.purpose.replace('_', ' ')} must be a {ALLOWED[body.purpose][0].rstrip('/')} file.")
    ext = Path(body.filename).suffix.lower()[:8] or mimetypes.guess_extension(body.content_type) or ""
    ws = ctx.workspace.id
    uid = new_id()
    if body.purpose in ("reference", "consent", "look", "footage"):
        ident = body.identity_id or "pending"
        sub = {"look": "looks/", "footage": "footage/"}.get(body.purpose, "")
        key = f"ws/{ws}/identities/{ident}/{sub}{body.purpose}-{uid}{ext}"
    elif body.purpose == "voice_sample":
        key = f"ws/{ws}/voices/samples/{uid}{ext}"
    else:
        key = f"ws/{ws}/brand/{uid}{ext}"
    p = get_storage().presign_upload(key, body.content_type)
    return PresignOut(key=p.key, method=p.method, url=p.url, headers=p.headers)


@router.put("/uploads/local/{key:path}")
async def local_put(key: str, request: Request, exp: int = Query(...), sig: str = Query(...)) -> dict:
    """Receive a browser upload in local-storage mode. Signed URL only."""
    key = unquote(key)
    if (cfg("storage_backend") or "local") != "local":
        raise ApiError(404, "not_found", "Not found.")
    if not verify_media(key, exp, sig):
        raise ApiError(403, "bad_signature", "This upload link has expired. Try again.")
    storage = get_storage()
    root = Path(settings.local_storage_root)
    dest = root / key
    dest.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    with open(dest, "wb") as f:
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_LOCAL_UPLOAD:
                f.close()
                dest.unlink(missing_ok=True)
                raise ApiError(413, "too_large", "That file is larger than 2 GB.")
            f.write(chunk)
    return {"key": key, "size": size, "ok": storage.exists(key)}


@router.get("/media/{key:path}")
async def media(key: str, exp: int = Query(...), sig: str = Query(...), dl: str | None = None):
    """Serve a stored file (local mode). Supports range requests for video seeking."""
    key = unquote(key)
    if not verify_media(key, exp, sig):
        raise ApiError(403, "bad_signature", "This link has expired.")
    if (cfg("storage_backend") or "local") != "local":
        return RedirectResponse(get_storage().download_url(key, 600, dl))
    path = Path(settings.local_storage_root) / key
    if not path.exists():
        raise ApiError(404, "not_found", "That file no longer exists.")
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    headers = {"Cache-Control": "private, max-age=3600"}
    if dl:
        headers["Content-Disposition"] = f'attachment; filename="{dl}"'
    return FileResponse(path, media_type=media_type, headers=headers)
