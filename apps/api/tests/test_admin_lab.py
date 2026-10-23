"""Connections (runtime config) and the Engine Lab."""
from __future__ import annotations

from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services.runtime_config import cfg, refresh
from tests.conftest import drain_jobs, upload


async def test_first_user_is_admin_and_others_are_not(client):
    assert (await client.get("/admin/whoami")).json()["is_admin"] is True
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver",
                           headers={"X-Dev-User-Email": "guest@example.com"}) as other:
        assert (await other.get("/admin/whoami")).json()["is_admin"] is False
        assert (await other.get("/admin/connections")).status_code == 403


async def test_save_masks_and_applies_live(client):
    r = await client.put("/admin/connections/elevenlabs", json={"values": {"elevenlabs_api_key": "sk_test_1234567890abcd"}})
    assert r.status_code == 200, r.text
    svc = r.json()
    field = svc["fields"][0]
    assert field["is_set"] and field["source"] == "db" and field["value"].endswith("abcd") and "…" in field["value"]
    assert svc["connected"] is True
    refresh(force=True)
    assert cfg("elevenlabs_api_key") == "sk_test_1234567890abcd"

    # Sending the masked value back keeps the stored secret.
    r = await client.put("/admin/connections/elevenlabs", json={"values": {"elevenlabs_api_key": field["value"]}})
    refresh(force=True)
    assert cfg("elevenlabs_api_key") == "sk_test_1234567890abcd"

    # Clearing removes the override.
    await client.put("/admin/connections/elevenlabs", json={"values": {"elevenlabs_api_key": ""}})
    refresh(force=True)
    assert cfg("elevenlabs_api_key") is None


async def test_choice_validation_and_public_config(client):
    r = await client.put("/admin/connections/runpod", json={"values": {"avatar_engine_backend": "banana"}})
    assert r.status_code == 400
    r = await client.put("/admin/connections/runpod", json={"values": {"gpu_name": "H100 80GB", "gpu_price_inr_per_hour": "250"}})
    assert r.status_code == 200
    pub = (await client.get("/config/public")).json()
    assert pub["auth_mode"] == "dev" and pub["avatar_engine"] == "mock" and "clerk_publishable_key" in pub


async def test_test_button_reports_plainly(client):
    r = await client.post("/admin/connections/runpod/test")
    assert r.status_code == 200
    assert r.json()["ok"] is False and "key" in r.json()["message"].lower()
    r = await client.post("/admin/connections/r2/test")
    assert r.json()["ok"] is True  # local storage


async def test_engine_lab_trial_scores_and_results(client, sample_image):
    voice = (await client.post("/voices", json={"engine": "mock", "external_voice_id": "mock-en-f",
                                                "name": "Lab voice", "language": "en"})).json()
    look_key = await upload(client, "look", sample_image, "image/jpeg")
    r = await client.post("/lab/trials", json={"name": "Run 1", "engine": "mock", "script": "Hello from the lab. This is a test.",
                                               "voice_id": voice["id"], "look_key": look_key})
    assert r.status_code == 202, r.text
    trial = r.json()
    assert drain_jobs() == 1
    t = next(x for x in (await client.get("/lab/trials")).json() if x["id"] == trial["id"])
    assert t["status"] == "succeeded", t["error"]
    assert t["output_url"] and t["duration_s"] > 0 and t["wall_seconds"] > 0

    for rater, s in (("A", 4), ("B", 5)):
        r = await client.post(f"/lab/trials/{trial['id']}/scores", json={"rater": rater, "lipsync": s, "motion": s,
                                                                      "identity": s, "overall": s})
        assert r.status_code == 200
    t = r.json()
    assert len(t["scores"]) == 2 and t["averages"]["panel"] == 4.5
    summary = (await client.get("/lab/summary")).json()
    row = next(x for x in summary["rows"] if x["engine"] == "mock")
    assert row["scored"] == 2 and row["verdict"] == "hard to tell from HeyGen"
    md = (await client.get("/lab/results.md")).text
    assert md.startswith("# Stage 0 results") and "Run 1" in md

    # Credits were not touched by lab runs.
    ledger = (await client.get("/credits/ledger")).json()
    assert not any(e["kind"] == "charge" and e["note"].startswith("Run 1") for e in ledger)

    r = await client.post("/lab/adopt/infinitetalk")
    assert r.status_code == 200
    refresh(force=True)
    assert cfg("default_engine_photo") == "infinitetalk"
    await client.put("/admin/connections/runpod", json={"values": {"default_engine_photo": ""}})
