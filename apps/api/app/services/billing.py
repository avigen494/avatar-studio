"""
Billing rules: what a paid event does to a workspace.

  subscription.charged -> activate plan, set period, grant monthly credits once per period,
                          apply the rollover rule, write a GST invoice row
  payment.paid (topup) -> grant 100 credits, invoice row
  subscription.cancelled -> back to Free at period end (immediately if already past)
  payment.failed       -> mark past_due (renders keep working while credits last)

Sync functions on a plain Session (used by the API via run_sync and by webhooks).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.adapters.payments import PaymentEvent
from app.models.billing import Payment, Subscription
from app.models.core import Workspace
from app.services import credits
from app.services.plans import PLANS, TOPUP, apply_plan_to_workspace, gst_split, plan_for, price


def _now() -> datetime:
    return datetime.now(timezone.utc)


def next_invoice_number(db: Session) -> str:
    year = _now().year
    count = db.scalar(select(func.count(Payment.id)).where(Payment.invoice_number.like(f"AS-{year}-%"))) or 0
    return f"AS-{year}-{count + 1:05d}"


def current_subscription(db: Session, workspace_id: str) -> Subscription | None:
    """The subscription that governs the workspace now: active/pending/past_due, or cancelled but not yet ended."""
    live = db.scalar(select(Subscription).where(Subscription.workspace_id == workspace_id,
                                                Subscription.status.in_(["pending", "active", "past_due"]))
                     .order_by(Subscription.created_at.desc()))
    if live:
        return live
    return db.scalar(select(Subscription).where(Subscription.workspace_id == workspace_id, Subscription.status == "cancelled",
                                                Subscription.current_period_end > _now())
                     .order_by(Subscription.created_at.desc()))


def _record_payment(db: Session, ws: Workspace, ev: PaymentEvent, kind: str, plan: str | None, amount: int,
                    currency: str, credits_n: int, description: str, buyer: dict) -> Payment | None:
    existing = db.scalar(select(Payment).where(Payment.provider == ev.provider, Payment.provider_payment_id == ev.provider_payment_id)) \
        if ev.provider_payment_id else None
    if existing and existing.status == "paid":
        return None  # webhook replay
    pay = existing or Payment(workspace_id=ws.id, provider=ev.provider, provider_order_id=ev.provider_order_id,
                              provider_payment_id=ev.provider_payment_id, kind=kind)
    net, tax = gst_split(amount) if currency == "INR" else (amount, 0)
    pay.plan, pay.amount, pay.currency, pay.net_amount, pay.tax_amount = plan, amount, currency, net, tax
    pay.credits, pay.status, pay.paid_at, pay.description = credits_n, "paid", _now(), description
    pay.buyer = buyer
    pay.raw = ev.raw or {}
    if not pay.invoice_number:
        pay.invoice_number = next_invoice_number(db)
    db.add(pay)
    db.flush()
    return pay


def apply_event(db: Session, ev: PaymentEvent, workspace_id: str | None = None, buyer: dict | None = None) -> dict:
    """Apply one neutral payment event. Returns a small summary for logs/tests."""
    buyer = buyer or {}
    sub = None
    if ev.provider_subscription_id:
        sub = db.scalar(select(Subscription).where(Subscription.provider == ev.provider,
                                                   Subscription.provider_subscription_id == ev.provider_subscription_id))
    if sub is None and ev.provider_order_id:
        pay = db.scalar(select(Payment).where(Payment.provider == ev.provider, Payment.provider_order_id == ev.provider_order_id))
        workspace_id = workspace_id or (pay.workspace_id if pay else None)
    workspace_id = workspace_id or (sub.workspace_id if sub else None) or (ev.metadata or {}).get("workspace_id")
    if not workspace_id:
        return {"ignored": "no workspace"}
    ws = db.get(Workspace, workspace_id)
    if ws is None:
        return {"ignored": "workspace missing"}

    if ev.type == "payment.paid":
        pending = db.scalar(select(Payment).where(Payment.provider == ev.provider, Payment.provider_order_id == ev.provider_order_id,
                                                  Payment.status == "created"))
        amount = ev.amount or (pending.amount if pending else 0)
        currency = ev.currency or (pending.currency if pending else "INR")
        credits_n = pending.credits if pending else TOPUP["credits"]
        if pending:
            pending.provider_payment_id = ev.provider_payment_id
        pay = _record_payment(db, ws, ev, "topup", None, amount, currency, credits_n, f"Top-up · {credits_n} credits", buyer)
        if pay:
            credits.grant(db, ws.id, credits_n, f"Top-up {pay.invoice_number}", kind="topup", inr_paise=amount if currency == "INR" else None)
            db.commit()
            return {"topup": credits_n, "invoice": pay.invoice_number}
        return {"duplicate": True}

    if ev.type == "subscription.charged":
        if sub is None:
            sub = Subscription(workspace_id=ws.id, provider=ev.provider, provider_subscription_id=ev.provider_subscription_id,
                               plan=(ev.metadata or {}).get("plan") or ws.plan, currency=ev.currency or "INR")
            db.add(sub)
        plan = plan_for(sub.plan)
        start = datetime.fromtimestamp(ev.period_start, tz=timezone.utc) if ev.period_start else _now()
        end = datetime.fromtimestamp(ev.period_end, tz=timezone.utc) if ev.period_end else start + timedelta(days=365 if sub.yearly else 30)
        sub.status, sub.current_period_start, sub.current_period_end = "active", start, end
        apply_plan_to_workspace(ws, plan.id)
        granted = 0
        if sub.last_granted_period_start is None or sub.last_granted_period_start < start:
            _apply_rollover(db, ws.id, plan)
            credits.grant(db, ws.id, plan.credits_month, f"{plan.name} plan · month of {start:%d %b %Y}", kind="grant")
            sub.last_granted_period_start = start
            granted = plan.credits_month
        amount = ev.amount or price(plan.id, sub.currency, sub.yearly) + sub.seats * plan.seat_inr_month
        pay = _record_payment(db, ws, ev, "plan", plan.id, amount, sub.currency, granted,
                              f"{plan.name} plan · {start:%d %b %Y} to {end:%d %b %Y}", buyer)
        db.commit()
        return {"plan": plan.id, "granted": granted, "invoice": pay.invoice_number if pay else None}

    if ev.type == "subscription.cancelled":
        if sub:
            sub.status = "cancelled"
            if not sub.current_period_end or sub.current_period_end <= _now():
                apply_plan_to_workspace(ws, "free")
        db.commit()
        return {"cancelled": True}

    if ev.type == "payment.failed":
        if sub:
            sub.status = "past_due"
        db.commit()
        return {"past_due": True}

    return {"ignored": ev.type}


def _apply_rollover(db: Session, workspace_id: str, plan) -> None:
    """Creator: credits above one monthly grant expire at renewal (PRD: rollover 1 month)."""
    if plan.rollover_months is None:
        return
    bal = credits.balance(db, workspace_id)
    cap = plan.credits_month * plan.rollover_months
    if bal > cap:
        from app.models.credits import CreditEntry

        db.add(CreditEntry(workspace_id=workspace_id, kind="adjust", amount=-(bal - cap),
                           note=f"Rollover limit: credits above {cap} expired at renewal"))
        db.flush()


def expire_lapsed(db: Session) -> int:
    """Worker housekeeping: cancelled subscriptions past their period go back to Free."""
    rows = db.scalars(select(Subscription).where(Subscription.status == "cancelled",
                                                 Subscription.current_period_end < _now())).all()
    n = 0
    for sub in rows:
        ws = db.get(Workspace, sub.workspace_id)
        if ws and ws.plan == sub.plan:
            apply_plan_to_workspace(ws, "free")
            n += 1
        sub.status = "expired"
    db.commit()
    return n


def seat_limit(ws: Workspace, sub: Subscription | None) -> int:
    p = plan_for(ws.plan)
    return p.max_members + (sub.seats if sub else 0)


def plan_catalogue_for(ws: Workspace) -> list[dict]:
    from app.services.plans import public_plans

    out = public_plans()
    for item in out:
        item["current"] = item["id"] == ws.plan
    return out
