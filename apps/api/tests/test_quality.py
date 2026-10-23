"""Quality gate, seed pinning and the golden regression set."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from tests.conftest import drain_jobs, upload

OWNER = "quality-owner@example.com"


@pytest.fixture(scope="module")
def detailed_image(tmp_path_factory):
    """A photo-like image with real detail, so the frame-similarity proxy has something to compare."""
    import subprocess

    from app.config import settings

    out = tmp_path_factory.mktemp("q") / "face.jpg"
    subprocess.run([settings.ffmpeg_bin, "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=1",
                    "-frames:v", "1", "-q:v", "3", str(out)], check=True)
    return out


@pytest.fixture(scope="module")
async def owner(detailed_image):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver",
                           headers={"X-Dev-User-Email": OWNER}) as c:
        await c.get("/me")
        ident = (await c.post("/identities", json={"name": "Quality face", "kind": "designed"})).json()
        key = await upload(c, "look", detailed_image, "image/jpeg", ident["id"])
        await c.post(f"/identities/{ident['id']}/looks", json={"key": key, "name": "Base", "kind": "photo"})
        voice = (await c.post("/voices", json={"engine": "mock", "external_voice_id": "mock-en-f", "name": "V", "language": "en"})).json()
        await c.post("/credits/dev-grant", json={"amount": 200})
        ident = (await c.get(f"/identities/{ident['id']}")).json()
        yield c, ident, voice["id"]


async def test_render_passes_gate_and_records_seed(owner):
    c, ident, voice = owner
    assert ident["render_seed"]  # every avatar gets a pinned seed
    v = (await c.post("/videos", json={"identity_id": ident["id"], "voice_id": voice, "script": "Consistency check one."})).json()
    await c.post(f"/videos/{v['id']}/generate")
    assert drain_jobs() == 1
    done = (await c.get(f"/videos/{v['id']}")).json()
    assert done["status"] == "succeeded", done["error_message"]
    assert done["quality_method"] == "frame_similarity" and done["quality_score"] is not None and done["quality_score"] > 0.25
    assert done["render_seed"] == ident["render_seed"] and done["render_attempts"] == 1

    # A second render of the same avatar uses the same seed: siblings, not strangers.
    v2 = (await c.post("/videos", json={"identity_id": ident["id"], "voice_id": voice, "script": "Consistency check two."})).json()
    await c.post(f"/videos/{v2['id']}/generate")
    drain_jobs()
    assert (await c.get(f"/videos/{v2['id']}")).json()["render_seed"] == ident["render_seed"]


async def test_failed_gate_retries_with_next_seed_then_fails_without_charge(owner, monkeypatch):
    c, ident, voice = owner
    from app.adapters import quality as q
    from app.worker import pipeline

    calls: list[int] = []
    real_render = pipeline.get_avatar_engine().render

    def spy_render(req, out_dir, progress):
        calls.append(req.extra["seed"])
        return real_render(req, out_dir, progress)

    class AlwaysBad(q.QualityChecker):
        name = "frame_similarity"

        def available(self):
            return True

        def check(self, output_video, reference, work):
            return q.QualityResult(False, 0.01, self.name, 0.25, "forced failure")

    monkeypatch.setattr(pipeline, "get_quality_checker", lambda: AlwaysBad())
    monkeypatch.setattr(type(pipeline.get_avatar_engine()), "render", lambda self, req, out_dir, progress: spy_render(req, out_dir, progress))

    before = (await c.get("/credits")).json()["balance"]
    v = (await c.post("/videos", json={"identity_id": ident["id"], "voice_id": voice, "script": "This one will be rejected."})).json()
    await c.post(f"/videos/{v['id']}/generate")
    drain_jobs()
    failed = (await c.get(f"/videos/{v['id']}")).json()
    assert failed["status"] == "failed" and "did not look enough like you" in failed["error_message"]
    assert failed["render_attempts"] == 2 and calls == [ident["render_seed"], ident["render_seed"] + 1]
    assert (await c.get("/credits")).json()["balance"] == before  # nothing charged


async def test_gate_can_be_turned_off_in_connections(client, owner):
    c, ident, voice = owner
    await client.put("/admin/connections/runpod", json={"values": {"quality_gate": "off"}})
    from app.services.runtime_config import refresh

    refresh(force=True)
    v = (await c.post("/videos", json={"identity_id": ident["id"], "voice_id": voice, "script": "Gate off."})).json()
    await c.post(f"/videos/{v['id']}/generate")
    drain_jobs()
    done = (await c.get(f"/videos/{v['id']}")).json()
    assert done["status"] == "succeeded" and done["quality_score"] is None
    await client.put("/admin/connections/runpod", json={"values": {"quality_gate": ""}})
    refresh(force=True)


async def test_golden_set_rerun_and_report(client, detailed_image):
    voice = (await client.get("/voices")).json()
    voice = voice[0] if voice else (await client.post("/voices", json={"engine": "mock", "external_voice_id": "mock-en-f",
                                                                        "name": "Lab", "language": "en"})).json()
    look_key = await upload(client, "look", detailed_image, "image/jpeg")
    r = await client.post("/lab/trials", json={"name": "Golden run", "engine": "mock", "script": "Golden baseline script for regressions.",
                                               "voice_id": voice["id"], "look_key": look_key})
    assert r.status_code == 202, r.text
    trial = r.json()
    drain_jobs()
    t = next(x for x in (await client.get("/lab/trials")).json() if x["id"] == trial["id"])
    assert t["status"] == "succeeded" and t["quality_score"] is not None and t["seed"]

    assert (await client.post("/lab/golden/rerun")).status_code == 404  # nothing golden yet
    r = await client.put(f"/lab/trials/{trial['id']}/golden", json={"is_golden": True})
    assert r.json()["is_golden"] is True
    r = await client.post("/lab/golden/rerun")
    assert r.status_code == 202 and r.json()[0]["golden_of"] == trial["id"] and r.json()[0]["seed"] == t["seed"]
    drain_jobs()
    report = (await client.get("/lab/golden")).json()
    row = next(x for x in report["rows"] if x["golden"]["id"] == trial["id"])
    assert row["latest"]["status"] == "succeeded" and row["verdict"] == "ok" and report["regressions"] == 0
    assert abs(row["quality_delta"]) < 0.05  # same inputs, same seed, same engine: same result
