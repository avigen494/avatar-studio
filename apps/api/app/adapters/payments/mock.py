"""Dev payments: the web app shows a 'Pay (test)' button that confirms instantly."""
from __future__ import annotations

import time
import uuid

from app.adapters.payments import CheckoutIntent, PaymentEvent, PaymentProvider


class MockPaymentProvider(PaymentProvider):
    name = "mock"

    def available(self) -> bool:
        return True

    def create_topup(self, workspace_id, amount, currency, description, receipt) -> CheckoutIntent:
        return CheckoutIntent(provider="mock", kind="topup", mode="mock", provider_order_id=f"mock_order_{uuid.uuid4().hex[:10]}",
                              amount=amount, currency=currency)

    def create_subscription(self, workspace_id, plan_id, currency, yearly, seats, customer_email, success_url, cancel_url) -> CheckoutIntent:
        return CheckoutIntent(provider="mock", kind="plan", mode="mock", provider_subscription_id=f"mock_sub_{uuid.uuid4().hex[:10]}",
                              currency=currency, extra={"plan": plan_id, "yearly": yearly, "seats": seats})

    def cancel_subscription(self, provider_subscription_id, at_period_end=True) -> None:
        return None

    def update_seats(self, provider_subscription_id, seats) -> None:
        return None

    def resume_subscription(self, provider_subscription_id) -> bool:
        return True

    def verify_checkout(self, payload: dict) -> PaymentEvent | None:
        now = int(time.time())
        if payload.get("provider_subscription_id"):
            return PaymentEvent(type="subscription.charged", provider="mock", provider_subscription_id=payload["provider_subscription_id"],
                                provider_payment_id=f"mock_pay_{uuid.uuid4().hex[:10]}", period_start=now, period_end=now + 30 * 86400,
                                amount=int(payload.get("amount") or 0), currency=payload.get("currency", "INR"))
        return PaymentEvent(type="payment.paid", provider="mock", provider_order_id=payload.get("provider_order_id"),
                            provider_payment_id=f"mock_pay_{uuid.uuid4().hex[:10]}", amount=int(payload.get("amount") or 0),
                            currency=payload.get("currency", "INR"))

    def parse_webhook(self, body: bytes, headers: dict) -> list[PaymentEvent]:
        return []
