"""v3 phase B: API keys, idempotency, batch + CSV, webhooks with signatures and retries."""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services import events
from tests.conftest import drain_jobs, upload

OWNER = "dev-owner@example.com"


class _Hook(BaseHTTPRequestHandler):
    received: list[dict] = []
    fail_first = {"n": 0}

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        _Hook.received.append({"headers": dict(self.headers), "body": body})
        if _Hook.fail_first["n"] > 0:
            _Hook.fail_first["n"] -= 1
            self.send_response(500)
        else:
            self.send_response(200)
        self.end_headers()

    def log_message(self, *a):  # silence
        return


@pytest.fixture(scope="module")
def hook_server():
    srv = HTTPServer(("127.0.0.1", 0), _Hook)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_port}/hook"
    srv.shutdown()


@pytest.fixture(scope="module")
async def owner(sample_image):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver",
                           headers={"X-Dev-User-Email": OWNER}) as c:
        await c.get("/me")
        ident = (await c.post("/identities", json={"name": "Dev face", "kind": "designed"})).json()
        key = await upload(c, "look", sample_image, "image/jpeg", ident["id"])
        await c.post(f"/identities/{ident['id']}/looks", json={"key": key, "name": "Base", "kind": "photo"})
        voice = (await c.post("/voices", json={"engine": "mock", "external_voice_id": "mock-en-f", "name": "V", "language": "en"})).json()
        await c.post("/credits/dev-grant", json={"amount": 500})
        yield c, ident["id"], voice["id"]


async def test_api_key_auth_and_scopes(owner):
    c, ident, voice = owner
    r = await c.post("/api-keys", json={"name": "n8n", "scopes": ["read"]})
    assert r.status_code == 201 and r.json()["key"].startswith("ask_live_")
    ro = r.json()["key"]
    r = await c.post("/api-keys", json={"name": "zapier", "scopes": ["read", "write"]})
    rw = r.json()["key"]
    listed = (await c.get("/api-keys")).json()
    assert len(listed) == 2 and all(k.get("key") is None for k in listed)  # full key shown once only

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver",
                           headers={"Authorization": f"Bearer {ro}"}) as api:
        assert (await api.get("/videos")).status_code == 200
        r = await api.post("/videos", json={"identity_id": ident, "voice_id": voice, "script": "Hi from the API."})
        assert r.status_code == 403 and r.json()["error"]["code"] == "scope_required"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver",
                           headers={"Authorization": f"Bearer {rw}", "Idempotency-Key": "order-42"}) as api:
        r1 = await api.post("/videos", json={"identity_id": ident, "voice_id": voice, "script": "Hi from the API."})
        r2 = await api.post("/videos", json={"identity_id": ident, "voice_id": voice, "script": "Hi from the API."})
        assert r1.status_code == 201 and r1.json()["id"] == r2.json()["id"]  # idempotent
        assert (await api.get("/admin/connections")).status_code == 403  # keys are never platform admins
        # A write key may register webhooks (n8n trigger), and read it back by id.
        wh = await api.post("/webhooks", json={"url": "https://example.com/hook", "events": ["video.succeeded"]})
        assert wh.status_code == 201, wh.text
        assert (await api.get(f"/webhooks/{wh.json()['id']}")).json()["secret"].startswith("whsec_")
        assert (await api.delete(f"/webhooks/{wh.json()['id']}")).status_code == 204
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver",
                           headers={"Authorization": f"Bearer {ro}"}) as api:
        assert (await api.post("/webhooks", json={"url": "https://example.com/hook"})).status_code == 403
    bad = AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver", headers={"Authorization": "Bearer ask_live_nope"})
    assert (await bad.get("/videos")).status_code == 401
    key_id = listed[0]["id"]
    assert (await c.delete(f"/api-keys/{key_id}")).status_code == 204


async def test_batch_checks_credits_then_queues(owner):
    c, ident, voice = owner
    items = [{"script": f"Hello customer number {i}. Thanks for joining.", "title": f"Welcome {i}"} for i in range(3)]
    r = await c.post("/videos/batch", json={"items": items, "identity_id": ident, "voice_id": voice, "generate": True})
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["created"] == 3 and out["queued"] == 3 and out["total_credits"] >= 3
    assert drain_jobs() == 3
    vids = (await c.get("/videos")).json()["items"]
    assert sum(1 for v in vids if v["title"].startswith("Welcome") and v["status"] == "succeeded") == 3

    huge = [{"script": " ".join(["word"] * 3000)} for _ in range(6)]  # ~1200 credits, more than the balance
    r = await c.post("/videos/batch", json={"items": huge, "identity_id": ident, "voice_id": voice})
    assert r.status_code == 402 and "Nothing was queued" in r.json()["error"]["message"]


async def test_batch_from_csv(owner):
    c, ident, voice = owner
    csv_text = "title,script,aspect\nLead A,Hi A. Your demo is ready.,9:16\nLead B,Hi B. Your demo is ready.,16:9\n"
    r = await c.post("/videos/batch/csv", files={"file": ("leads.csv", csv_text, "text/csv")},
                     data={"identity_id": ident, "voice_id": voice, "generate": "false"})
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["created"] == 2 and out["queued"] == 0 and all(row["status"] == "draft" for row in out["rows"])


async def test_webhooks_sign_retry_and_replay(owner, hook_server):
    c, ident, voice = owner
    r = await c.post("/webhooks", json={"url": hook_server, "events": ["video.succeeded", "test.ping"], "description": "CRM"})
    assert r.status_code == 201, r.text
    hook = r.json()
    assert hook["secret"].startswith("whsec_")

    # test.ping delivers immediately with a valid signature.
    _Hook.received.clear()
    d = (await c.post(f"/webhooks/{hook['id']}/test")).json()
    assert d["status"] == "delivered" and d["last_status_code"] == 200
    got = _Hook.received[-1]
    assert got["headers"]["X-AvatarStudio-Event"] == "test.ping"
    assert events.verify(hook["secret"], got["body"], got["headers"]["X-AvatarStudio-Signature"])
    assert not events.verify("wrong", got["body"], got["headers"]["X-AvatarStudio-Signature"])

    # A render emits video.succeeded; the receiver fails once, so the delivery is retried later.
    _Hook.fail_first["n"] = 1
    v = (await c.post("/videos", json={"identity_id": ident, "voice_id": voice, "script": "Webhook test video."})).json()
    await c.post(f"/videos/{v['id']}/generate")
    drain_jobs()
    from app.worker.db import SyncSession

    with SyncSession() as db:
        events.deliver_due(db)  # first attempt -> 500
    dl = (await c.get(f"/webhooks/{hook['id']}/deliveries")).json()
    ev = next(x for x in dl if x["event"] == "video.succeeded")
    assert ev["status"] == "pending" and ev["attempts"] == 1 and ev["last_status_code"] == 500
    assert ev["payload"]["data"]["id"] == v["id"] and ev["payload"]["data"]["output_url"]

    # Replay sends it again right now and it lands.
    r = await c.post(f"/webhooks/deliveries/{ev['id']}/replay")
    assert r.json()["status"] == "delivered"
    body = json.loads(_Hook.received[-1]["body"])
    assert body["event"] == "video.succeeded" and body["data"]["status"] == "succeeded"

    # Filtered events are not delivered.
    assert not any(x["event"] == "preview.ready" for x in dl)
    assert (await c.delete(f"/webhooks/{hook['id']}")).status_code == 204
