"""Subscriptions, payments and invoices. Credits still move only through the ledger."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import IdMixin, TimestampMixin, UTCDateTime, WorkspaceScoped

PROVIDERS = ("razorpay", "stripe", "mock")
SUBSCRIPTION_STATUSES = ("pending", "active", "past_due", "cancelled", "expired")
PAYMENT_KINDS = ("plan", "topup", "seats")
PAYMENT_STATUSES = ("created", "paid", "failed", "refunded")


class Subscription(Base, IdMixin, TimestampMixin, WorkspaceScoped):
    __tablename__ = "subscriptions"

    provider: Mapped[str] = mapped_column(String(20))
    provider_subscription_id: Mapped[str | None] = mapped_column(String(120), index=True)
    provider_customer_id: Mapped[str | None] = mapped_column(String(120))
    plan: Mapped[str] = mapped_column(String(20))
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    yearly: Mapped[bool] = mapped_column(Boolean, default=False)
    seats: Mapped[int] = mapped_column(Integer, default=0)  # extra seats beyond the plan's included members
    status: Mapped[str] = mapped_column(String(20), default="pending")
    current_period_start: Mapped[datetime | None] = mapped_column(UTCDateTime())
    current_period_end: Mapped[datetime | None] = mapped_column(UTCDateTime())
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False)
    last_granted_period_start: Mapped[datetime | None] = mapped_column(UTCDateTime())
    meta: Mapped[dict] = mapped_column(JSON, default=dict)


class Payment(Base, IdMixin, TimestampMixin, WorkspaceScoped):
    __tablename__ = "payments"
    __table_args__ = (UniqueConstraint("provider", "provider_payment_id", name="uq_payment_provider_id"),)

    provider: Mapped[str] = mapped_column(String(20))
    provider_order_id: Mapped[str | None] = mapped_column(String(120), index=True)
    provider_payment_id: Mapped[str | None] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(20))
    plan: Mapped[str | None] = mapped_column(String(20))
    amount: Mapped[int] = mapped_column(Integer)  # smallest unit, gross
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    net_amount: Mapped[int] = mapped_column(Integer, default=0)
    tax_amount: Mapped[int] = mapped_column(Integer, default=0)
    credits: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="created")
    invoice_number: Mapped[str | None] = mapped_column(String(30), unique=True)
    paid_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    description: Mapped[str] = mapped_column(String(200), default="")
    buyer: Mapped[dict] = mapped_column(JSON, default=dict)  # name, email, gstin, address snapshot
    raw: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text)
