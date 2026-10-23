"""
End-to-end flow through the API and the worker, with the mock engines and
real ffmpeg: sign-in, avatar, voice, estimate, preview (free), render
(charged once), failure (never charged), cancel, share page.
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.conftest import drain_jobs, upload

SCRIPT = ("Here is the one thing nobody tells you about planning. Most people start with a list. "
          "Start with the result instead. Write the outcome in one line. Then remove every step that does not "
          "move you there. Do it today. Follow for the next one.")


async def _ledger_sum(client: AsyncClient) -> int:
    r = await client.get("/credits")
    return r.json()["balance"]


@pytest.fixture(scope="module")
async def setup(sample_image, sample_clip):
    """One avatar (photo + verified clip) and one voice, shared by the tests below."""
    from httpx import ASGITransport

    from app.main import app
    from tests.conftest import HEADERS

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver", headers=HEADERS) as c:
        me = (await c.get("/me")).json()
        assert me["credits"] == 30  # free plan grant on first sign-in

        ident = (await c.post("/identities", json={"name": "Avinash", "kind": "real_person"})).json()
        look_key = await upload(c, "look", sample_image, "image/jpeg", ident["id"])
        r = await c.post(f"/identities/{ident['id']}/looks", json={"key": look_key, "name": "Studio", "kind": "photo"})
        assert r.status_code == 201, r.text

        # Before the consent clip is verified, a real person cannot render.
        voice = (await c.post("/voices", json={"engine": "mock", "external_voice_id": "mock-en-f",
                                               "name": "Sample", "language": "en"})).json()
        est = (await c.post("/videos/estimate", json={"script": SCRIPT, "identity_id": ident["id"]})).json()
        assert any("consent" in b for b in est["blockers"])

        ref_key = await upload(c, "reference", sample_clip, "video/mp4", ident["id"])
        r = await c.post(f"/identities/{ident['id']}/reference", json={"key": ref_key, "consent_text_read": True})
        assert r.status_code == 200 and r.json()["status"] == "verifying"
        assert drain_jobs() == 1
        ident = (await c.get(f"/identities/{ident['id']}")).json()
        assert ident["consent_status"] == "verified" and ident["can_render"] is True
        yield {"identity": ident, "voice": voice}


async def test_estimate_shows_credits_and_balance(client, setup):
    r = await client.post("/videos/estimate", json={"script": SCRIPT, "identity_id": setup["identity"]["id"],
                                                    "engine_mode": "auto"})
    body = r.json()
    assert body["engine"] == "real_footage"  # a clip exists, so auto picks real footage
    assert body["credits"] >= 1 and body["balance"] == 30 and body["can_afford"] and body["blockers"] == []


async def test_preview_is_free_and_render_charges_once(client, setup):
    before = await _ledger_sum(client)
    v = (await client.post("/videos", json={"identity_id": setup["identity"]["id"], "voice_id": setup["voice"]["id"],
                                            "script": SCRIPT, "title": "Planning tip", "aspect": "9:16"})).json()
    assert v["status"] == "draft" and v["estimated_credits"] > 0

    # Free preview: a job runs, a 480p file appears, nothing is charged.
    r = await client.post(f"/videos/{v['id']}/preview")
    assert r.status_code == 202
    assert drain_jobs() == 1
    v2 = (await client.get(f"/videos/{v['id']}")).json()
    assert v2["preview_status"] == "ready" and v2["preview_url"]
    assert await _ledger_sum(client) == before

    # Full render: charged exactly the estimate, exactly once, after success.
    r = await client.post(f"/videos/{v['id']}/generate")
    assert r.status_code == 202 and r.json()["status"] == "queued"
    assert drain_jobs() == 1
    done = (await client.get(f"/videos/{v['id']}")).json()
    assert done["status"] == "succeeded", done["error_message"]
    assert done["output_url"] and done["srt_url"] and done["thumbnail_url"] and done["output_captioned_url"]
    assert done["charged_credits"] == done["estimated_credits"]
    assert done["watermarked"] is True and done["ai_labelled"] is True  # free plan
    assert await _ledger_sum(client) == before - done["charged_credits"]

    ledger = (await client.get("/credits/ledger")).json()
    charges = [e for e in ledger if e["kind"] == "charge" and e["video_id"] == v["id"]]
    assert len(charges) == 1  # ledger matches jobs 1:1

    # The media endpoint serves the file with range support.
    rel = done["output_url"].split("http://testserver", 1)[1]
    m = await client.get(rel, headers={"Range": "bytes=0-99"})
    assert m.status_code in (200, 206) and len(m.content) > 0

    # Share page: enable, read meta, view, react.
    r = await client.post(f"/videos/{v['id']}/share", json={"enabled": True, "password": "1234"})
    token = r.json()["share_token"]
    public = AsyncClient(transport=client._transport, base_url="http://testserver")
    meta = (await public.get(f"/share/{token}")).json()
    assert meta["needs_password"] is True and meta["title"] == "Planning tip"
    assert (await public.post(f"/share/{token}/view", json={"password": "wrong"})).status_code == 401
    view = (await public.post(f"/share/{token}/view", json={"password": "1234"})).json()
    assert view["video_url"] and view["views"] == 1
    counts = (await public.post(f"/share/{token}/react", json={"emoji": "🔥"})).json()
    assert counts == {"🔥": 1}


async def test_failed_render_is_never_charged(client, setup, monkeypatch):
    """Break the avatar engine; the job fails with a plain message and no credit moves."""
    from app.adapters.avatar import mock as mock_engine

    def boom(self, req, out_dir, progress):
        raise RuntimeError("GPU exploded")

    monkeypatch.setattr(mock_engine.MockAvatarEngine, "render", boom)
    before = await _ledger_sum(client)
    v = (await client.post("/videos", json={"identity_id": setup["identity"]["id"], "voice_id": setup["voice"]["id"],
                                            "script": SCRIPT})).json()
    assert (await client.post(f"/videos/{v['id']}/generate")).status_code == 202
    assert drain_jobs() == 1
    failed = (await client.get(f"/videos/{v['id']}")).json()
    assert failed["status"] == "failed" and "Nothing was charged" in failed["error_message"]
    assert failed["charged_credits"] == 0
    assert await _ledger_sum(client) == before


async def test_guardrail_blocks_generate(client, setup):
    v = (await client.post("/videos", json={"identity_id": setup["identity"]["id"], "voice_id": setup["voice"]["id"],
                                            "script": "This tea cures cancer in a week. Buy now."})).json()
    r = await client.post(f"/videos/{v['id']}/generate")
    assert r.status_code == 422 and r.json()["error"]["code"] == "blocked"
    assert "cure" in r.json()["error"]["message"].lower()


async def test_insufficient_credits_is_a_402(client, setup):
    long_script = " ".join(["word"] * 3000)  # ~20 minutes
    v = (await client.post("/videos", json={"identity_id": setup["identity"]["id"], "voice_id": setup["voice"]["id"],
                                            "script": long_script})).json()
    r = await client.post(f"/videos/{v['id']}/generate")
    assert r.status_code == 402 and r.json()["error"]["code"] == "insufficient_credits"


async def test_cancel_queued_render(client, setup):
    before = await _ledger_sum(client)
    v = (await client.post("/videos", json={"identity_id": setup["identity"]["id"], "voice_id": setup["voice"]["id"],
                                            "script": SCRIPT})).json()
    await client.post(f"/videos/{v['id']}/generate")
    r = await client.post(f"/videos/{v['id']}/cancel")
    assert r.json()["status"] == "cancelled"
    assert drain_jobs() == 0  # the job was cancelled before a worker took it
    assert await _ledger_sum(client) == before


async def test_workspace_isolation(client, setup):
    """A second user cannot see the first user's avatars or videos."""
    from httpx import ASGITransport

    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver",
                           headers={"X-Dev-User-Email": "someone-else@example.com"}) as other:
        assert (await other.get("/identities")).json() == []
        assert (await other.get(f"/identities/{setup['identity']['id']}")).status_code == 404
        assert (await other.get("/videos")).json()["items"] == []


async def test_script_helper_uses_prompt_file(client):
    r = await client.post("/ai/script", json={"brief": "three ways to plan a week", "target_seconds": 30})
    body = r.json()
    assert r.status_code == 200 and body["words"] > 20 and body["seconds"] > 0


async def test_ledger_csv_export(client, setup):
    r = await client.get("/credits/ledger.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    lines = r.text.strip().splitlines()
    assert lines[0] == "date,kind,credits,inr_list_value,note,video_id,job_id"
    assert any(",grant,30,60," in line for line in lines)  # free plan grant, with rupees next to credits


async def test_worker_crash_requeues_without_charge(client, setup):
    """A job left 'running' by a dead worker goes back to the queue on restart."""
    from sqlalchemy import select

    from app.models.videos import Job
    from app.worker.db import SyncSession
    from app.worker.runner import claim_next, requeue_orphans

    before = await _ledger_sum(client)
    v = (await client.post("/videos", json={"identity_id": setup["identity"]["id"], "voice_id": setup["voice"]["id"],
                                            "script": SCRIPT})).json()
    await client.post(f"/videos/{v['id']}/generate")
    with SyncSession() as db:
        job = claim_next(db, "dead-worker")  # claimed, then the worker "dies"
        assert job and job.status == "running"
    with SyncSession() as db:
        assert requeue_orphans(db, "dead-worker") == 1
        job = db.scalar(select(Job).where(Job.video_id == v["id"]))
        assert job.status == "queued"
    assert await _ledger_sum(client) == before
    assert drain_jobs() == 1  # and it still renders fine afterwards
    done = (await client.get(f"/videos/{v['id']}")).json()
    assert done["status"] == "succeeded"
