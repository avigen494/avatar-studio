"""
Razorpay: Orders for top-ups, Subscriptions for plans, UPI included.

Plans are created once through the API and their ids cached in platform
settings, so nothing has to be configured by hand in the Razorpay dashboard
except the webhook URL (/webhooks/razorpay) and its secret.
"""
from __future__ import annotations

import hashlib
import hmac
import json

import httpx

from app.adapters.payments import CheckoutIntent, PaymentEvent, PaymentProvider
from app.services.plans import plan_for, price
from app.services.runtime_config import cfg

BASE = "https://api.razorpay.com/v1"


class RazorpayProvider(PaymentProvider):
    name = "razorpay"

    def _auth(self) -> tuple[str, str]:
        return (cfg("razorpay_key_id") or "", cfg("razorpay_key_secret") or "")

    def available(self) -> bool:
        return all(self._auth())

    def _post(self, path: str, payload: dict) -> dict:
        with httpx.Client(timeout=30, auth=self._auth()) as c:
            r = c.post(f"{BASE}{path}", json=payload)
        if r.status_code >= 400:
            try:
                msg = r.json().get("error", {}).get("description")
            except ValueError:
                msg = None
            raise RuntimeError(msg or f"Razorpay error {r.status_code}")
        return r.json()

    def _patch(self, path: str, payload: dict) -> dict:
        with httpx.Client(timeout=30, auth=self._auth()) as c:
            r = c.patch(f"{BASE}{path}", json=payload)
        r.raise_for_status()
        return r.json()

    # --- top-ups -----------------------------------------------------------------
    def create_topup(self, workspace_id, amount, currency, description, receipt) -> CheckoutIntent:
        order = self._post("/orders", {"amount": amount, "currency": currency, "receipt": receipt[:40],
                                       "notes": {"workspace_id": workspace_id, "kind": "topup"}})
        return CheckoutIntent(provider="razorpay", kind="topup", mode="razorpay_checkout", provider_order_id=order["id"],
                              public_key=cfg("razorpay_key_id"), amount=amount, currency=currency,
                              extra={"description": description})

    # --- subscriptions -----------------------------------------------------------
    def _plan_id(self, plan_id: str, yearly: bool, seat: bool = False) -> str:
        """Razorpay plan id for our plan, created on first use and cached."""
        from app.services.runtime_config import refresh

        cache_key = f"razorpay_plan_{plan_id}_{'seat' if seat else ('year' if yearly else 'month')}"
        cached = refresh().get(cache_key)
        if cached:
            return cached
        p = plan_for(plan_id)
        amount = p.seat_inr_month if seat else price(plan_id, "INR", yearly)
        created = self._post("/plans", {
            "period": "yearly" if yearly and not seat else "monthly", "interval": 1,
            "item": {"name": f"Avatar Studio {p.name}{' extra seat' if seat else ''}{' (yearly)' if yearly and not seat else ''}",
                     "amount": amount * (12 if yearly and not seat else 1), "currency": "INR"},
        })
        from app.services.runtime_config import set_values
        from app.worker.db import SyncSession

        with SyncSession() as db:
            # Store outside the KEYS whitelist on purpose: internal cache, never shown in the UI.
            from app.models.platform import PlatformSetting
            from app.services import crypto

            row = db.get(PlatformSetting, cache_key) or PlatformSetting(key=cache_key, is_secret=False)
            row.value_encrypted = crypto.encrypt(created["id"])
            db.add(row)
            db.commit()
        refresh(force=True)
        return created["id"]

    def create_subscription(self, workspace_id, plan_id, currency, yearly, seats, customer_email, success_url, cancel_url) -> CheckoutIntent:
        payload = {
            "plan_id": self._plan_id(plan_id, yearly), "total_count": 12 if yearly else 120, "quantity": 1,
            "customer_notify": 1, "notes": {"workspace_id": workspace_id, "plan": plan_id, "kind": "plan"},
        }
        if seats > 0:
            payload["addons"] = []  # seats are a separate monthly subscription on Razorpay (see update_seats)
        sub = self._post("/subscriptions", payload)
        return CheckoutIntent(provider="razorpay", kind="plan", mode="razorpay_checkout", provider_subscription_id=sub["id"],
                              public_key=cfg("razorpay_key_id"), amount=price(plan_id, "INR", yearly), currency="INR",
                              extra={"plan": plan_id, "yearly": yearly, "seats": seats, "short_url": sub.get("short_url")})

    def cancel_subscription(self, provider_subscription_id, at_period_end=True) -> None:
        self._post(f"/subscriptions/{provider_subscription_id}/cancel", {"cancel_at_cycle_end": 1 if at_period_end else 0})

    def update_seats(self, provider_subscription_id, seats) -> None:
        # Razorpay subscriptions update quantity via PATCH; seats ride on a dedicated seat plan.
        self._patch(f"/subscriptions/{provider_subscription_id}", {"quantity": max(seats, 1), "schedule_change_at": "now"})

    # --- confirmations -----------------------------------------------------------
    def verify_checkout(self, payload: dict) -> PaymentEvent | None:
        """Razorpay Checkout returns ids + signature to the browser; verify with the key secret."""
        secret = cfg("razorpay_key_secret") or ""
        pay_id = payload.get("razorpay_payment_id")
        sig = payload.get("razorpay_signature")
        if payload.get("razorpay_subscription_id"):
            msg = f"{pay_id}|{payload['razorpay_subscription_id']}"
        elif payload.get("razorpay_order_id"):
            msg = f"{payload['razorpay_order_id']}|{pay_id}"
        else:
            return None
        expected = hmac.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest()
        if not sig or not hmac.compare_digest(expected, sig):
            raise ValueError("Payment signature did not match.")
        if payload.get("razorpay_subscription_id"):
            return PaymentEvent(type="subscription.charged", provider="razorpay", provider_payment_id=pay_id,
                                provider_subscription_id=payload["razorpay_subscription_id"], raw=payload)
        return PaymentEvent(type="payment.paid", provider="razorpay", provider_payment_id=pay_id,
                            provider_order_id=payload["razorpay_order_id"], raw=payload)

    def parse_webhook(self, body: bytes, headers: dict) -> list[PaymentEvent]:
        secret = cfg("razorpay_webhook_secret") or ""
        sig = headers.get("x-razorpay-signature", "")
        expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        if not secret or not hmac.compare_digest(expected, sig):
            raise ValueError("Webhook signature did not match.")
        data = json.loads(body)
        event = data.get("event", "")
        payload = data.get("payload", {})
        pay = (payload.get("payment") or {}).get("entity") or {}
        sub = (payload.get("subscription") or {}).get("entity") or {}
        out: list[PaymentEvent] = []
        if event == "payment.captured" and pay.get("order_id") and not sub:
            out.append(PaymentEvent("payment.paid", "razorpay", pay.get("id"), pay.get("order_id"), None,
                                    int(pay.get("amount") or 0), pay.get("currency", "INR"), raw=data))
        elif event in ("subscription.charged", "subscription.activated"):
            out.append(PaymentEvent("subscription.charged", "razorpay", pay.get("id"), None, sub.get("id"),
                                    int(pay.get("amount") or 0), pay.get("currency", "INR"),
                                    sub.get("current_start"), sub.get("current_end"), raw=data))
        elif event in ("subscription.cancelled", "subscription.completed", "subscription.halted"):
            out.append(PaymentEvent("subscription.cancelled", "razorpay", None, None, sub.get("id"), raw=data))
        elif event == "payment.failed":
            out.append(PaymentEvent("payment.failed", "razorpay", pay.get("id"), pay.get("order_id"), sub.get("id") or None,
                                    raw=data, metadata={"reason": pay.get("error_description")}))
        return out
