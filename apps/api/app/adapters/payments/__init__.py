"""
Payment adapters: Razorpay (INR, UPI, subscriptions), Stripe (USD), mock (dev).

The API decides WHAT to sell (plan, seats, top-up) and the adapter only talks
to the provider. Every adapter returns a CheckoutIntent the web app knows how
to open, and turns a provider webhook into a list of neutral PaymentEvents.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from app.services.runtime_config import cfg


@dataclass
class CheckoutIntent:
    provider: str
    kind: str                     # plan | topup | seats
    mode: str                     # "razorpay_checkout" | "redirect" | "mock"
    provider_order_id: str | None = None
    provider_subscription_id: str | None = None
    redirect_url: str | None = None
    public_key: str | None = None
    amount: int = 0
    currency: str = "INR"
    extra: dict = field(default_factory=dict)


@dataclass
class PaymentEvent:
    """Neutral form of a provider webhook."""
    type: str                     # payment.paid | subscription.charged | subscription.cancelled | payment.failed
    provider: str
    provider_payment_id: str | None = None
    provider_order_id: str | None = None
    provider_subscription_id: str | None = None
    amount: int = 0
    currency: str = "INR"
    period_start: int | None = None   # unix
    period_end: int | None = None
    metadata: dict = field(default_factory=dict)
    raw: dict = field(default_factory=dict)


class PaymentProvider(ABC):
    name = "base"

    @abstractmethod
    def available(self) -> bool: ...

    @abstractmethod
    def create_topup(self, workspace_id: str, amount: int, currency: str, description: str, receipt: str) -> CheckoutIntent: ...

    @abstractmethod
    def create_subscription(self, workspace_id: str, plan_id: str, currency: str, yearly: bool, seats: int,
                            customer_email: str, success_url: str, cancel_url: str) -> CheckoutIntent: ...

    @abstractmethod
    def cancel_subscription(self, provider_subscription_id: str, at_period_end: bool = True) -> None: ...

    @abstractmethod
    def update_seats(self, provider_subscription_id: str, seats: int) -> None: ...

    def resume_subscription(self, provider_subscription_id: str) -> bool:
        """Undo a cancel-at-period-end. Returns False when the provider cannot (a new plan is needed at period end)."""
        return False

    @abstractmethod
    def verify_checkout(self, payload: dict) -> PaymentEvent | None:
        """Client-side confirmation (Razorpay returns a signature to the browser)."""

    @abstractmethod
    def parse_webhook(self, body: bytes, headers: dict) -> list[PaymentEvent]: ...


def provider_for_currency(currency: str) -> PaymentProvider:
    from app.adapters.payments.mock import MockPaymentProvider
    from app.adapters.payments.razorpay import RazorpayProvider
    from app.adapters.payments.stripe import StripeProvider

    if currency == "USD":
        s = StripeProvider()
        return s if s.available() else MockPaymentProvider()
    r = RazorpayProvider()
    return r if r.available() else MockPaymentProvider()


def get_provider(name: str) -> PaymentProvider:
    from app.adapters.payments.mock import MockPaymentProvider
    from app.adapters.payments.razorpay import RazorpayProvider
    from app.adapters.payments.stripe import StripeProvider

    return {"razorpay": RazorpayProvider, "stripe": StripeProvider, "mock": MockPaymentProvider}[name]()


def payments_live() -> dict:
    return {"razorpay": bool(cfg("razorpay_key_id") and cfg("razorpay_key_secret")),
            "stripe": bool(cfg("stripe_secret_key"))}
