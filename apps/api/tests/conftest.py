"""
Test setup: a throwaway SQLite database, local storage in a temp folder,
dev auth, the mock voice and avatar engines. Everything the API needs runs
in-process, and the worker is driven by calling run_one() directly.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

# Settings are read at import time, so the environment must be set first.
_TMP = Path(tempfile.mkdtemp(prefix="avatar-tests-"))
os.environ.update({
    "ENV": "test",
    "DATABASE_URL": f"sqlite+aiosqlite:///{(_TMP / 'test.db').as_posix()}",
    "AUTO_CREATE_TABLES": "true",
    "AUTH_MODE": "dev",
    "STORAGE_BACKEND": "local",
    "LOCAL_STORAGE_ROOT": (_TMP / "storage").as_posix(),
    "WORK_DIR": (_TMP / "work").as_posix(),
    "VOICE_ENGINE_DEFAULT": "mock",
    "AVATAR_ENGINE_BACKEND": "mock",
    "ANTHROPIC_API_KEY": "",
    "ELEVENLABS_API_KEY": "",
    "SARVAM_API_KEY": "",
    "SECRET_KEY": "test-secret",
    "API_BASE_URL": "http://testserver",
})

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from app.config import settings  # noqa: E402
from app.db import init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.worker.runner import run_one  # noqa: E402

USER = "avinash@example.com"
HEADERS = {"X-Dev-User-Email": USER}


@pytest.fixture(scope="session", autouse=True)
async def _db():
    await init_db()
    yield
    shutil.rmtree(_TMP, ignore_errors=True)


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver", headers=HEADERS) as c:
        yield c


@pytest.fixture(scope="session")
def sample_image() -> Path:
    """A real JPEG made with ffmpeg so the mock engine has a look to animate."""
    out = _TMP / "look.jpg"
    subprocess.run([settings.ffmpeg_bin, "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x3b82f6:s=720x1280",
                    "-frames:v", "1", str(out)], check=True)
    return out


@pytest.fixture(scope="session")
def sample_clip() -> Path:
    """A 12-second clip with audio, standing in for the phone recording."""
    out = _TMP / "reference.mp4"
    subprocess.run([settings.ffmpeg_bin, "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=720x1280:rate=25",
                    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=24000", "-t", "12",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(out)], check=True)
    return out


async def upload(client: AsyncClient, purpose: str, path: Path, content_type: str, identity_id: str | None = None) -> str:
    """Presign, PUT the bytes through the same API, return the storage key."""
    r = await client.post("/uploads/presign", json={"purpose": purpose, "filename": path.name,
                                                    "content_type": content_type, "identity_id": identity_id})
    assert r.status_code == 200, r.text
    p = r.json()
    rel = p["url"].split("http://testserver", 1)[1]
    r2 = await client.put(rel, content=path.read_bytes(), headers=p["headers"])
    assert r2.status_code == 200, r2.text
    return p["key"]


def drain_jobs(max_jobs: int = 10) -> int:
    """Run queued jobs synchronously, like the worker would."""
    from sqlalchemy import select

    from app.models.videos import Job
    from app.worker.db import SyncSession
    from app.worker.runner import claim_next

    ran = 0
    for _ in range(max_jobs):
        with SyncSession() as db:
            job = claim_next(db, "test-worker")
            if not job:
                break
            job_id = job.id
        run_one(job_id)
        ran += 1
    return ran
