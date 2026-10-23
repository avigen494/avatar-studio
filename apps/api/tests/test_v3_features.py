"""v3 phase C: translate, clipping, planner, notifications, admin usage."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from tests.conftest import drain_jobs, upload

OWNER = "features-owner@example.com"
SCRIPT = ("Welcome back to the channel. Today we talk about planning your week in ten minutes. "
          "First, write the one result you want. Second, remove every task that does not move you there. "
          "Third, block two hours tomorrow morning. That is the whole system. Try it this week and tell me how it went. "
          "Follow for part two on Friday.")


@pytest.fixture(scope="module")
async def owner(sample_image):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver",
                           headers={"X-Dev-User-Email": OWNER}) as c:
        await c.get("/me")
        ident = (await c.post("/identities", json={"name": "Feature face", "kind": "designed"})).json()
        key = await upload(c, "look", sample_image, "image/jpeg", ident["id"])
        await c.post(f"/identities/{ident['id']}/looks", json={"key": key, "name": "Base", "kind": "photo"})
        voice = (await c.post("/voices", json={"engine": "mock", "external_voice_id": "mock-en-f", "name": "V", "language": "en"})).json()
        await c.post("/credits/dev-grant", json={"amount": 300})
        v = (await c.post("/videos", json={"identity_id": ident["id"], "voice_id": voice["id"], "script": SCRIPT,
                                           "title": "Weekly planning"})).json()
        await c.post(f"/videos/{v['id']}/generate")
        drain_jobs()
        v = (await c.get(f"/videos/{v['id']}")).json()
        assert v["status"] == "succeeded", v["error_message"]
        yield c, ident["id"], voice["id"], v


async def test_translate_creates_priced_drafts_and_renders(owner):
    c, ident, voice, v = owner
    langs = (await c.get("/translate/languages")).json()
    assert langs[0]["code"] == "hi" and langs[0]["indian"] is True
    before = (await c.get("/credits")).json()["balance"]
    r = await c.post(f"/videos/{v['id']}/translate", json={"languages": ["hi", "hinglish"], "mode": "audio_only", "generate": True})
    assert r.status_code == 202, r.text
    out = r.json()
    assert len(out["videos"]) == 2 and out["credits_per_minute"] == 6
    for t in out["videos"]:
        assert t["kind"] == "translation" and t["source_video_id"] == v["id"] and t["status"] == "queued"
        assert t["estimated_credits"] == 3  # ~28 s script at 6 credits per minute, prorated and rounded up
    assert drain_jobs() == 2
    derived = (await c.get(f"/videos/{v['id']}/derived")).json()
    assert len(derived) == 2 and all(d["status"] == "succeeded" for d in derived)
    assert all(d["charged_credits"] == 3 for d in derived)
    assert (await c.get("/credits")).json()["balance"] == before - 6
    assert (await c.post(f"/videos/{v['id']}/translate", json={"languages": ["en"]})).status_code == 400


async def test_clipping_makes_short_videos_and_charges_per_source_minute(owner):
    c, ident, voice, v = owner
    before = (await c.get("/credits")).json()["balance"]
    r = await c.post(f"/videos/{v['id']}/clip", json={"count": 2, "min_seconds": 5, "max_seconds": 15})
    assert r.status_code == 202, r.text
    assert r.json()["credits"] == 1
    job_id = r.json()["job_id"]
    assert drain_jobs() == 1
    st = (await c.get(f"/jobs/{job_id}/status")).json()
    assert st["status"] == "succeeded", st["error"]
    clips = [d for d in (await c.get(f"/videos/{v['id']}/derived")).json() if d["kind"] == "clip"]
    assert len(clips) == 2
    for clip in clips:
        assert clip["status"] == "succeeded" and clip["output_url"] and clip["output_captioned_url"] and clip["aspect"] == "9:16"
        assert 4 <= clip["duration_s"] <= 16.5
    assert (await c.get("/credits")).json()["balance"] == before - 1
    draft = (await c.post("/videos", json={"identity_id": ident, "voice_id": voice, "script": "Not rendered yet."})).json()
    assert (await c.post(f"/videos/{draft['id']}/clip", json={})).status_code == 409


async def test_video_agent_plan_returns_script(owner):
    c, ident, voice, v = owner
    r = await c.post("/ai/plan", json={"brief": "three ways to save tax as a freelancer", "target_seconds": 60,
                                       "identity_id": ident, "voice_id": voice})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["plan"]["scenes"] and out["plan"]["scenes"][0]["type"] == "A" and out["script"] and out["seconds"] > 0


async def test_notification_prefs_and_mock_send(owner):
    c, ident, voice, v = owner
    from app.adapters.notify import MockNotifier

    r = await c.put("/me/notifications", json={"phone": "+919876543210", "notify_whatsapp": True})
    assert r.status_code == 200 and r.json()["notify_whatsapp"] is True
    assert (await c.put("/me/notifications", json={"phone": "abc", "notify_whatsapp": True})).status_code == 422
    MockNotifier.sent.clear()
    nv = (await c.post("/videos", json={"identity_id": ident, "voice_id": voice, "script": "Ping me when done."})).json()
    await c.post(f"/videos/{nv['id']}/generate")
    drain_jobs()
    assert any(m["template"] == "video_ready" and m["phone"] == "+919876543210" for m in MockNotifier.sent)


async def test_admin_usage_dashboard(client):
    r = await client.get("/admin/usage?days=30")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["videos"]["total"] >= 1 and "failure_rate" in d["videos"]
    assert d["cost_per_minute_inr"]["target_p95"] == 60 and d["workspaces"]["target_paying"] == 20
    assert isinstance(d["per_workspace"], list) and isinstance(d["daily"], list)
    ids = [s["id"] for s in (await client.get("/admin/connections")).json()]
    assert "whatsapp" in ids
