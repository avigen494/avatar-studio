"""Stripe (USD, for the US LLC): Checkout Sessions, subscriptions, webhooks. Raw REST, no SDK."""
from __future__ import annotations

import hashlib
import hmac
import json
import time

import httpx

from app.adapters.payments import CheckoutIntent, PaymentEvent, PaymentProvider
from app.services.plans import plan_for, price
from app.services.runtime_config import cfg

BASE = "https://api.stripe.com/v1"


def _form(data: dict, prefix: str = "") -> dict:
    """Flatten nested dicts/lists into Stripe's form encoding."""
    out: dict = {}
    for k, v in data.items():
        key = f"{prefix}[{k}]" if prefix else k
        if isinstance(v, dict):
            out.update(_form(v, key))
        elif isinstance(v, list):
            for i, item in enumerate(v):
                if isinstance(item, dict):
                    out.update(_form(item, f"{key}[{i}]"))
                else:
                    out[f"{key}[{i}]"] = item
        elif v is not None:
            out[key] = v
    return out


class StripeProvider(PaymentProvider):
    name = "stripe"

    def available(self) -> bool:
        return bool(cfg("stripe_secret_key"))

    def _post(self, path: str, data: dict) -> dict:
        with httpx.Client(timeout=30, auth=(cfg("stripe_secret_key") or "", "")) as c:
            r = c.post(f"{BASE}{path}", data=_form(data))
        if r.status_code >= 400:
            try:
                msg = r.json().get("error", {}).get("message")
            except ValueError:
                msg = None
            raise RuntimeError(msg or f"Stripe error {r.status_code}")
        return r.json()

    def _price_id(self, plan_id: str, seat: bool = False) -> str:
        from app.services.runtime_config import refresh

        cache_key = f"stripe_price_{plan_id}_{'seat' if seat else 'month'}"
        cached = refresh().get(cache_key)
        if cached:
            return cached
        p = plan_for(plan_id)
        created = self._post("/prices", {
            "currency": "usd", "unit_amount": p.seat_usd_month if seat else price(plan_id, "USD"),
            "recurring": {"interval": "month"},
            "product_data": {"name": f"Avatar Studio {p.name}{' extra seat' if seat else ''}"},
        })
        from app.models.platform import PlatformSetting
        from app.services import crypto
        from app.worker.db import SyncSession

        with SyncSession() as db:
            row = db.get(PlatformSetting, cache_key) or PlatformSetting(key=cache_key, is_secret=False)
            row.value_encrypted = crypto.encrypt(created["id"])
            db.add(row)
            db.commit()
        refresh(force=True)
        return created["id"]

    def create_topup(self, workspace_id, amount, currency, description, receipt) -> CheckoutIntent:
        session = self._post("/checkout/sessions", {
            "mode": "payment", "success_url": f"{cfg('web_base_url') or ''}/settings/plan?paid=1",
            "cancel_url": f"{cfg('web_base_url') or ''}/settings/plan",
            "client_reference_id": workspace_id, "metadata": {"workspace_id": workspace_id, "kind": "topup", "receipt": receipt},
            "line_items": [{"quantity": 1, "price_data": {"currency": "usd", "unit_amount": amount,
                                                          "product_data": {"name": description}}}],
        })
        return CheckoutIntent(provider="stripe", kind="topup", mode="redirect", provider_order_id=session["id"],
                              redirect_url=session["url"], amount=amount, currency="USD")

    def create_subscription(self, workspace_id, plan_id, currency, yearly, seats, customer_email, success_url, cancel_url) -> CheckoutIntent:
        items = [{"price": self._price_id(plan_id), "quantity": 1}]
        if seats > 0:
            items.append({"price": self._price_id(plan_id, seat=True), "quantity": seats})
        session = self._post("/checkout/sessions", {
            "mode": "subscription", "success_url": success_url, "cancel_url": cancel_url,
            "customer_email": customer_email, "client_reference_id": workspace_id,
            "subscription_data": {"metadata": {"workspace_id": workspace_id, "plan": plan_id}},
            "metadata": {"workspace_id": workspace_id, "kind": "plan", "plan": plan_id},
            "line_items": items,
        })
        return CheckoutIntent(provider="stripe", kind="plan", mode="redirect", provider_order_id=session["id"],
                              redirect_url=session["url"], amount=price(plan_id, "USD"), currency="USD",
                              extra={"plan": plan_id, "seats": seats})

    def cancel_subscription(self, provider_subscription_id, at_period_end=True) -> None:
        if at_period_end:
            self._post(f"/subscriptions/{provider_subscription_id}", {"cancel_at_period_end": "true"})
        else:
            with httpx.Client(timeout=30, auth=(cfg("stripe_secret_key") or "", "")) as c:
                c.delete(f"{BASE}/subscriptions/{provider_subscription_id}")

    def resume_subscription(self, provider_subscription_id) -> bool:
        self._post(f"/subscriptions/{provider_subscription_id}", {"cancel_at_period_end": "false"})
        return True

    def update_seats(self, provider_subscription_id, seats) -> None:
        with httpx.Client(timeout=30, auth=(cfg("stripe_secret_key") or "", "")) as c:
            sub = c.get(f"{BASE}/subscriptions/{provider_subscription_id}").json()
        items = sub.get("items", {}).get("data", [])
        seat_item = next((i for i in items if i["price"].get("recurring") and "seat" in (i["price"].get("nickname") or "").lower()), None)
        plan = (sub.get("metadata") or {}).get("plan", "team")
        update = {"items": []}
        if seat_item:
            update["items"].append({"id": seat_item["id"], "quantity": max(seats, 0)})
        elif seats > 0:
            update["items"].append({"price": self._price_id(plan, seat=True), "quantity": seats})
        if update["items"]:
            self._post(f"/subscriptions/{provider_subscription_id}", update)

    def verify_checkout(self, payload: dict) -> PaymentEvent | None:
        return None  # Stripe confirms through webhooks only

    def parse_webhook(self, body: bytes, headers: dict) -> list[PaymentEvent]:
        secret = cfg("stripe_webhook_secret") or ""
        sig_header = headers.get("stripe-signature", "")
        parts = dict(p.split("=", 1) for p in sig_header.split(",") if "=" in p)
        ts, v1 = parts.get("t"), parts.get("v1")
        if not (secret and ts and v1):
            raise ValueError("Webhook signature missing.")
        expected = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, v1) or abs(time.time() - int(ts)) > 300:
            raise ValueError("Webhook signature did not match.")
        data = json.loads(body)
        t = data.get("type", "")
        obj = data.get("data", {}).get("object", {})
        out: list[PaymentEvent] = []
        if t == "checkout.session.completed" and obj.get("mode") == "payment":
            out.append(PaymentEvent("payment.paid", "stripe", obj.get("payment_intent"), obj.get("id"), None,
                                    int(obj.get("amount_total") or 0), "USD", raw=data,
                                    metadata=obj.get("metadata") or {}))
        elif t == "invoice.paid" and obj.get("subscription"):
            line = (obj.get("lines", {}).get("data") or [{}])[0]
            period = line.get("period") or {}
            out.append(PaymentEvent("subscription.charged", "stripe", obj.get("payment_intent") or obj.get("id"), None,
                                    obj.get("subscription"), int(obj.get("amount_paid") or 0), "USD",
                                    period.get("start"), period.get("end"), raw=data,
                                    metadata={"checkout_session": obj.get("metadata", {}).get("checkout_session")}))
        elif t == "customer.subscription.deleted":
            out.append(PaymentEvent("subscription.cancelled", "stripe", None, None, obj.get("id"), raw=data))
        elif t == "invoice.payment_failed":
            out.append(PaymentEvent("payment.failed", "stripe", None, None, obj.get("subscription"), raw=data))
        return out
