"""v3 phase A: plans, mock checkout, invoices, rollover, invites, roles, per-avatar access.

Uses its own dev user so credit grants here never leak into the other test modules.
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app

OWNER = "billing-owner@example.com"


@pytest.fixture(scope="module")
async def owner():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver",
                           headers={"X-Dev-User-Email": OWNER}) as c:
        await c.get("/me")  # creates the workspace with 30 credits
        yield c


def _as(email: str, workspace_id: str | None = None) -> AsyncClient:
    headers = {"X-Dev-User-Email": email}
    if workspace_id:
        headers["X-Workspace-Id"] = workspace_id
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver", headers=headers)


async def test_plans_and_mock_checkout_grant_credits(owner):
    b = (await owner.get("/billing")).json()
    assert b["plan"] == "free" and [p["id"] for p in b["plans"]] == ["free", "creator", "pro", "team"]
    creator = next(p for p in b["plans"] if p["id"] == "creator")
    assert creator["inr_month"] == 99_900 and creator["credits_month"] == 600 and creator["usd_month"] == 1200
    assert b["providers"]["mock"] is True  # no Razorpay/Stripe keys in tests

    assert (await owner.post("/billing/checkout", json={"kind": "topup"})).status_code == 402  # paid plans only

    before = (await owner.get("/credits")).json()["balance"]
    r = await owner.post("/billing/checkout", json={"kind": "plan", "plan": "creator", "currency": "INR"})
    assert r.status_code == 200, r.text
    intent = r.json()
    assert intent["mode"] == "mock" and intent["provider_subscription_id"]
    r = await owner.post("/billing/confirm", json={"provider": "mock", "payload": {
        "provider_subscription_id": intent["provider_subscription_id"], "amount": 99_900, "currency": "INR"}})
    assert r.status_code == 200 and r.json()["granted"] == 600
    b = (await owner.get("/billing")).json()
    assert b["plan"] == "creator" and b["subscription"]["status"] == "active"
    assert (await owner.get("/credits")).json()["balance"] == before + 600
    me = (await owner.get("/me")).json()
    assert me["workspace"]["watermark_enabled"] is False and me["workspace"]["max_avatars"] == 2

    # GST invoice: inclusive 18% split, printable HTML.
    pay = b["payments"][0]
    assert pay["kind"] == "plan" and pay["amount"] == 99_900 and pay["tax_amount"] + pay["net_amount"] == 99_900
    assert round(pay["tax_amount"] / pay["net_amount"], 2) == 0.18
    inv = await owner.get(f"/billing/invoices/{pay['id']}")
    assert inv.status_code == 200 and pay["invoice_number"] in inv.text and "GST 18%" in inv.text

    # Replaying the same confirmation does not grant twice.
    bal = (await owner.get("/credits")).json()["balance"]
    await owner.post("/billing/confirm", json={"provider": "mock", "payload": {
        "provider_subscription_id": intent["provider_subscription_id"], "amount": 99_900, "currency": "INR"}})
    assert (await owner.get("/credits")).json()["balance"] == bal

    # Top-up now works: 100 credits for ₹199.
    r = await owner.post("/billing/checkout", json={"kind": "topup"})
    assert r.status_code == 200 and r.json()["amount"] == 19_900
    order = r.json()["provider_order_id"]
    r = await owner.post("/billing/confirm", json={"provider": "mock", "payload": {"provider_order_id": order, "amount": 19_900}})
    assert r.json()["topup"] == 100
    assert (await owner.get("/credits")).json()["balance"] == bal + 100


async def test_rollover_expires_excess_credits_on_renewal(owner):
    """Creator rolls over one month: anything above 600 expires when the next month is granted."""
    from datetime import datetime, timedelta, timezone

    from app.adapters.payments import PaymentEvent
    from app.db import SessionLocal
    from app.services import billing

    ws_id = (await owner.get("/me")).json()["workspace"]["id"]
    await owner.post("/credits/dev-grant", json={"amount": 2000})
    assert (await owner.get("/credits")).json()["balance"] > 600
    start = datetime.now(timezone.utc) + timedelta(days=31)
    async with SessionLocal() as db:
        sub = await db.run_sync(billing.current_subscription, ws_id)
        ev = PaymentEvent(type="subscription.charged", provider="mock", provider_payment_id="mock_pay_renewal",
                          provider_subscription_id=sub.provider_subscription_id, period_start=int(start.timestamp()),
                          period_end=int((start + timedelta(days=30)).timestamp()), amount=99_900, currency="INR")
        result = await db.run_sync(billing.apply_event, ev)
    assert result["granted"] == 600
    assert (await owner.get("/credits")).json()["balance"] == 600 + 600  # capped to one month, then the new month
    ledger = (await owner.get("/credits/ledger")).json()
    assert any(e["kind"] == "adjust" and "Rollover" in e["note"] for e in ledger)


async def test_cancel_keeps_plan_until_period_end_and_resume(owner):
    r = await owner.post("/billing/cancel")
    assert r.status_code == 200 and "stays active until" in r.json()["message"]
    assert (await owner.get("/me")).json()["workspace"]["plan"] == "creator"
    b = (await owner.get("/billing")).json()
    assert b["subscription"]["status"] == "cancelled" and b["plan_ends_at"]  # still visible until it ends
    assert (await owner.post("/billing/checkout", json={"kind": "plan", "plan": "creator"})).status_code == 409
    r = await owner.post("/billing/resume")
    assert r.status_code == 200
    assert (await owner.get("/billing")).json()["subscription"]["status"] == "active"
    # Signed invoice link opens without any auth header.
    inv_url = b["payments"][0]["invoice_url"]
    rel = inv_url.split("http://testserver", 1)[1]
    anon = AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver")
    assert (await anon.get(rel)).status_code == 200
    assert (await anon.get(rel.split("?")[0])).status_code == 401
    await owner.post("/billing/cancel")


async def test_invites_roles_and_seat_limits(owner):
    # Creator includes 1 member: inviting needs Team.
    r = await owner.post("/workspaces/current/invites", json={"email": "teammate@example.com", "role": "editor"})
    assert r.status_code == 402 and "Team" in r.json()["error"]["message"]

    intent = (await owner.post("/billing/checkout", json={"kind": "plan", "plan": "team"})).json()
    await owner.post("/billing/confirm", json={"provider": "mock", "payload": {
        "provider_subscription_id": intent["provider_subscription_id"], "amount": 599_900, "currency": "INR"}})
    assert (await owner.get("/billing")).json()["plan"] == "team"
    seats = (await owner.get("/workspaces/current/seats")).json()
    assert seats["limit"] == 15 and seats["members"] == 1

    r = await owner.post("/workspaces/current/invites", json={"email": "Teammate@example.com", "role": "editor"})
    assert r.status_code == 201, r.text
    token = r.json()["link"].rsplit("/", 1)[1]
    meta = (await owner.get(f"/invites/{token}")).json()
    assert meta["role"] == "editor" and meta["expired"] is False
    ws_id = (await owner.get("/me")).json()["workspace"]["id"]

    async with _as("stranger@example.com") as stranger:
        assert (await stranger.post(f"/invites/{token}/accept")).status_code == 403  # wrong account
    async with _as("teammate@example.com") as mate:
        r = await mate.post(f"/invites/{token}/accept")
        assert r.status_code == 200 and r.json()["role"] == "editor"
    async with _as("teammate@example.com", ws_id) as mate:
        assert (await mate.get("/me")).json()["workspace"]["id"] == ws_id
        assert (await mate.post("/workspaces/current/invites", json={"email": "x@example.com"})).status_code == 403
        mate_id = (await mate.get("/me")).json()["user"]["id"]

    assert len((await owner.get("/workspaces/current/members")).json()) == 2
    assert (await owner.patch(f"/workspaces/current/members/{mate_id}", json={"role": "viewer"})).json()["role"] == "viewer"
    await owner.patch(f"/workspaces/current/members/{mate_id}", json={"role": "editor"})

    # Per-avatar access: lock an avatar to the owner; the editor is refused.
    ident = (await owner.post("/identities", json={"name": "Brand face", "kind": "designed"})).json()
    voice = (await owner.post("/voices", json={"engine": "mock", "external_voice_id": "mock-en-f", "name": "V", "language": "en"})).json()
    owner_id = (await owner.get("/me")).json()["user"]["id"]
    r = await owner.put(f"/identities/{ident['id']}/access", json={"user_ids": [owner_id]})
    assert r.status_code == 200 and r.json()["allowed_user_ids"] == [owner_id]
    async with _as("teammate@example.com", ws_id) as mate:
        r = await mate.post("/videos", json={"identity_id": ident["id"], "voice_id": voice["id"], "script": "Hello team."})
        assert r.status_code == 403 and r.json()["error"]["code"] == "avatar_locked"
    await owner.put(f"/identities/{ident['id']}/access", json={"user_ids": []})

    # The last owner cannot be demoted; a member can be removed.
    assert (await owner.patch(f"/workspaces/current/members/{owner_id}", json={"role": "editor"})).status_code == 400
    assert (await owner.delete(f"/workspaces/current/members/{mate_id}")).status_code == 204


async def test_create_and_switch_workspace(owner):
    r = await owner.post("/workspaces", json={"name": "Client brand"})
    assert r.status_code == 201
    new_id = r.json()["id"]
    me = (await owner.get("/me", headers={"X-Workspace-Id": new_id})).json()
    assert me["workspace"]["id"] == new_id and me["credits"] == 30 and me["workspace"]["plan"] == "free"
    assert len(me["workspaces"]) >= 2


async def test_razorpay_and_stripe_connection_cards_exist(client):
    ids = [s["id"] for s in (await client.get("/admin/connections")).json()]
    assert "razorpay" in ids and "stripe" in ids
    r = await client.post("/admin/connections/razorpay/test")
    assert r.json()["ok"] is False and "key" in r.json()["message"].lower()
