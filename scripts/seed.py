"""
Seed a local database with a workspace, an avatar (photo look), a voice and
one finished video, so the UI has something to show on first run.

    cd apps/api && .venv\\Scripts\\python ..\\..\\scripts\\seed.py you@example.com
"""
from __future__ import annotations

import asyncio
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "api"))

from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.config import settings  # noqa: E402
from app.db import init_db  # noqa: E402
from app.main import app  # noqa: E402


async def main(email: str) -> None:
    await init_db()
    headers = {"X-Dev-User-Email": email}
    async with AsyncClient(transport=ASGITransport(app=app), base_url=settings.api_base_url, headers=headers) as c:
        me = (await c.get("/me")).json()
        print("workspace:", me["workspace"]["name"], "credits:", me["credits"])
        if (await c.get("/identities")).json():
            print("already seeded")
            return
        ident = (await c.post("/identities", json={"name": me["user"]["name"] or "Me", "kind": "real_person"})).json()
        with tempfile.TemporaryDirectory() as tmp:
            img = Path(tmp) / "look.jpg"
            subprocess.run([settings.ffmpeg_bin, "-y", "-v", "error", "-f", "lavfi", "-i",
                            "gradients=s=720x1280:c0=0x0f766e:c1=0x111827", "-frames:v", "1", str(img)], check=True)
            p = (await c.post("/uploads/presign", json={"purpose": "look", "filename": "look.jpg",
                                                        "content_type": "image/jpeg", "identity_id": ident["id"]})).json()
            rel = p["url"].split(settings.api_base_url, 1)[1]
            await c.put(rel, content=img.read_bytes(), headers=p["headers"])
            await c.post(f"/identities/{ident['id']}/looks", json={"key": p["key"], "name": "Studio", "kind": "photo"})
        # Designed avatars need no consent; mark this seed avatar as such so a demo video can render.
        from sqlalchemy import update

        from app.db import SessionLocal
        from app.models.avatars import Identity

        async with SessionLocal() as db:
            await db.execute(update(Identity).where(Identity.id == ident["id"]).values(
                kind="designed", consent_status="verified", consent_method="not_required", status="ready"))
            await db.commit()
        lib = (await c.get("/voices/library")).json()
        v = lib[0]
        voice = (await c.post("/voices", json={"engine": v["engine"], "external_voice_id": v["external_voice_id"],
                                               "name": v["name"], "language": v["language"]})).json()
        video = (await c.post("/videos", json={
            "identity_id": ident["id"], "voice_id": voice["id"], "title": "Welcome to Avatar Studio",
            "script": "Hi, this is my first video on Avatar Studio. I pasted a script, picked my voice, and pressed "
                      "generate. Previews are free. You only pay when a video succeeds. Try it on your phone.",
        })).json()
        r = await c.post(f"/videos/{video['id']}/generate")
        print("queued video", video["id"], r.status_code, "- start the worker to render it: python -m app.worker")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "avinash@example.com"))
