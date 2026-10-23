"""v2: glossary in speech, look generator, style training, brand kit."""
from __future__ import annotations

import subprocess

import pytest
from httpx import AsyncClient

from app.config import settings
from app.services import glossary
from tests.conftest import drain_jobs, upload


def test_glossary_replaces_spoken_terms_only():
    g = [{"term": "IYA", "pronunciation": "eye why ay"}, {"term": "Avatar Studio", "pronunciation": "Avatar Studio"}]
    assert glossary.apply("Welcome to IYA. IYAs are not replaced. iya is.", g) == \
        "Welcome to eye why ay. IYAs are not replaced. eye why ay is."


@pytest.fixture(scope="module")
async def avatar(sample_image, sample_clip):
    from httpx import ASGITransport

    from app.main import app
    from tests.conftest import HEADERS

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver", headers=HEADERS) as c:
        ident = (await c.post("/identities", json={"name": "V2 person", "kind": "real_person"})).json()
        if "id" not in ident:  # avatar limit on free plan: reuse the first avatar
            ident = (await c.get("/identities")).json()[0]
        look_key = await upload(c, "look", sample_image, "image/jpeg", ident["id"])
        await c.post(f"/identities/{ident['id']}/looks", json={"key": look_key, "name": "Base", "kind": "photo"})
        if ident["consent_status"] != "verified":
            ref_key = await upload(c, "reference", sample_clip, "video/mp4", ident["id"])
            await c.post(f"/identities/{ident['id']}/reference", json={"key": ref_key, "consent_text_read": True})
            drain_jobs()
        yield (await c.get(f"/identities/{ident['id']}")).json()


async def test_look_generator_makes_three_variants_and_charges_two(client, avatar):
    await client.post("/credits/dev-grant", json={"amount": 100})
    before = (await client.get("/credits")).json()["balance"]
    r = await client.post(f"/identities/{avatar['id']}/looks/generate",
                          json={"name": "Blue blazer", "outfit": "navy blazer", "setting": "bright office"})
    assert r.status_code == 202, r.text
    assert r.json()["credits"] == 2
    assert drain_jobs() == 1
    ident = (await client.get(f"/identities/{avatar['id']}")).json()
    generated = [l for l in ident["looks"] if l["kind"] == "generated"]
    assert len(generated) == 3 and all(l["media_url"] for l in generated)
    assert (await client.get("/credits")).json()["balance"] == before - 2
    jobs = (await client.get(f"/identities/{avatar['id']}/jobs")).json()
    assert jobs[0]["type"] == "generate_look" and jobs[0]["status"] == "succeeded"


async def test_camera_angles_cost_six(client, avatar):
    before = (await client.get("/credits")).json()["balance"]
    r = await client.post(f"/identities/{avatar['id']}/looks/generate", json={"mode": "camera_angles"})
    assert r.status_code == 202 and r.json()["credits"] == 6
    drain_jobs()
    assert (await client.get("/credits")).json()["balance"] == before - 6


async def test_style_training_needs_two_minutes_then_succeeds(client, avatar, tmp_path):
    before = (await client.get("/credits")).json()["balance"]
    r = await client.post(f"/identities/{avatar['id']}/train-style")
    assert r.status_code == 202 and r.json()["credits"] == 40
    drain_jobs()
    ident = (await client.get(f"/identities/{avatar['id']}")).json()
    assert ident["style_status"] == "failed" and "2 minutes" in ident["style_error"]
    assert (await client.get("/credits")).json()["balance"] == before  # nothing charged

    # Upload two more minutes of footage, then it trains (mock) and charges 40.
    clip = tmp_path / "long.mp4"
    subprocess.run([settings.ffmpeg_bin, "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x568:rate=10",
                    "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "125", "-c:v", "libx264", "-preset", "ultrafast",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(clip)], check=True)
    key = await upload(client, "footage", clip, "video/mp4", avatar["id"])
    r = await client.post(f"/identities/{avatar['id']}/footage", json={"key": key})
    assert r.status_code == 201 and r.json()["footage_count"] == 1
    assert r.json()["footage"][0]["seconds"] > 120 and r.json()["footage_seconds_total"] > 130
    r = await client.post(f"/identities/{avatar['id']}/train-style")
    assert r.status_code == 202
    drain_jobs()
    ident = (await client.get(f"/identities/{avatar['id']}")).json()
    assert ident["style_status"] == "ready", ident["style_error"]
    assert ident["style_footage_seconds"] > 120
    assert (await client.get("/credits")).json()["balance"] == before - 40


async def test_brand_kit_and_glossary_save(client):
    r = await client.patch("/workspaces/current", json={"brand_kit": {"primary_color": "#14b8a6", "caption_style": "brand"},
                                                        "glossary": [{"term": "IYA", "pronunciation": "eye why ay"},
                                                                     {"term": "", "pronunciation": "x"}]})
    assert r.status_code == 200, r.text
    ws = r.json()
    assert ws["brand_kit"]["primary_color"] == "#14b8a6" and ws["glossary"] == [{"term": "IYA", "pronunciation": "eye why ay"}]
    assert (await client.patch("/workspaces/current", json={"brand_kit": {"primary_color": "teal"}})).status_code == 400


async def test_paid_plan_brand_logo_and_no_watermark(client, avatar, tmp_path):
    """On a paid plan the watermark goes away and the brand logo is burned in."""
    from sqlalchemy import update

    from app.db import SessionLocal
    from app.models.core import Workspace

    logo = tmp_path / "logo.png"
    subprocess.run([settings.ffmpeg_bin, "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0xf59e0b:s=400x160",
                    "-frames:v", "1", str(logo)], check=True)
    logo_key = await upload(client, "brand", logo, "image/png")
    r = await client.patch("/workspaces/current", json={"brand_kit": {"logo_key": logo_key, "show_logo": True,
                                                                      "primary_color": "#14b8a6", "caption_style": "brand"}})
    assert r.status_code == 200 and r.json()["brand_logo_url"]
    ws_id = r.json()["id"]
    async with SessionLocal() as db:
        await db.execute(update(Workspace).where(Workspace.id == ws_id).values(plan="creator"))
        await db.commit()
    try:
        voices = (await client.get("/voices")).json()
        voice = voices[0] if voices else (await client.post("/voices", json={
            "engine": "mock", "external_voice_id": "mock-en-f", "name": "Brand voice", "language": "en"})).json()
        v = (await client.post("/videos", json={"identity_id": avatar["id"], "voice_id": voice["id"],
                                                "script": "Brand kit test. The logo sits bottom right and captions use the brand colour."})).json()
        assert (await client.post(f"/videos/{v['id']}/generate")).status_code == 202
        drain_jobs()
        done = (await client.get(f"/videos/{v['id']}")).json()
        assert done["status"] == "succeeded", done["error_message"]
        assert done["watermarked"] is False and done["output_captioned_url"]
    finally:
        async with SessionLocal() as db:
            await db.execute(update(Workspace).where(Workspace.id == ws_id).values(plan="free"))
            await db.commit()


async def test_look_packs_listed_and_usable(client, avatar):
    packs = (await client.get("/identities/look-packs")).json()
    assert len(packs) >= 6 and all(len(p["looks"]) == 3 for p in packs)
    before = (await client.get("/credits")).json()["balance"]
    r = await client.post(f"/identities/{avatar['id']}/looks/generate", json={"pack_id": "coaching", "pack_index": 1})
    assert r.status_code == 202 and r.json()["credits"] == 2
    drain_jobs()
    ident = (await client.get(f"/identities/{avatar['id']}")).json()
    assert any(l["name"].startswith("Whiteboard") for l in ident["looks"])
    assert (await client.get("/credits")).json()["balance"] == before - 2


async def test_design_with_ai_makes_a_designed_avatar_ready(client):
    """Designed avatars need no consent; three candidates arrive and the first becomes the face."""
    from sqlalchemy import update

    from app.db import SessionLocal
    from app.models.core import Workspace

    me = (await client.get("/me")).json()
    async with SessionLocal() as db:  # free plan allows 1 avatar; lift it for this test
        await db.execute(update(Workspace).where(Workspace.id == me["workspace"]["id"]).values(max_avatars=5))
        await db.commit()
    ident = (await client.post("/identities", json={"name": "Riya", "kind": "designed"})).json()
    assert ident["status"] == "draft" and ident["consent_status"] == "verified"
    r = await client.post(f"/identities/{ident['id']}/design", json={"gender": "woman", "description": "friendly fitness coach",
                                                                   "style": "Realistic"})
    assert r.status_code == 202, r.text
    drain_jobs()
    ident = (await client.get(f"/identities/{ident['id']}")).json()
    assert ident["status"] == "ready" and ident["can_render"] is True
    gen = [l for l in ident["looks"] if l["kind"] == "generated"]
    assert len(gen) == 3 and sum(1 for l in gen if l["is_default"]) == 1 and ident["thumbnail_url"]
