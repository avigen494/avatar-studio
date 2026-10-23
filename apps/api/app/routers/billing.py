"""Plans, checkout, invoices, webhooks."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.adapters.payments import get_provider, payments_live, provider_for_currency
from app.config import settings
from app.db import get_db
from sqlalchemy.ext.asyncio import AsyncSession
from app.deps import ApiError, Ctx, IsAdmin, get_ctx
from app.models.billing import Payment, Subscription
from app.services import billing
from app.services.plans import PAID_RANK, TOPUP, plan_for, price
from app.services.runtime_config import cfg

router = APIRouter(tags=["billing"])


class CheckoutIn(BaseModel):
    kind: str = Field(pattern="^(plan|topup|seats)$")
    plan: str | None = None
    currency: str = Field(default="INR", pattern="^(INR|USD)$")
    yearly: bool = False
    seats: int = Field(default=0, ge=0, le=200)
    buyer_name: str | None = Field(default=None, max_length=120)
    gstin: str | None = Field(default=None, max_length=20)
    address: str | None = Field(default=None, max_length=300)


class ConfirmIn(BaseModel):
    provider: str
    payload: dict


class SubscriptionOut(BaseModel):
    id: str
    provider: str
    plan: str
    currency: str
    yearly: bool
    seats: int
    status: str
    current_period_start: datetime | None
    current_period_end: datetime | None
    cancel_at_period_end: bool


class PaymentOut(BaseModel):
    id: str
    provider: str
    kind: str
    plan: str | None
    amount: int
    currency: str
    net_amount: int
    tax_amount: int
    credits: int
    status: str
    invoice_number: str | None
    paid_at: datetime | None
    description: str
    created_at: datetime
    invoice_url: str | None = None


class BillingOut(BaseModel):
    plan: str
    plan_name: str
    credits: int
    subscription: SubscriptionOut | None
    payments: list[PaymentOut]
    plans: list[dict]
    topup: dict
    providers: dict
    seats_included: int
    seats_extra: int
    price_change_notice: str | None
    plan_ends_at: datetime | None = None   # set when the plan is cancelled and still running


@router.get("/billing", response_model=BillingOut)
async def get_billing(ctx: Ctx = Depends(get_ctx)) -> BillingOut:
    from app.services import credits as cr

    ws = ctx.workspace
    sub = await ctx.db.run_sync(billing.current_subscription, ws.id)
    pays = (await ctx.db.scalars(select(Payment).where(Payment.workspace_id == ws.id).order_by(Payment.created_at.desc()).limit(50))).all()
    live = payments_live()
    return BillingOut(
        plan=ws.plan, plan_name=plan_for(ws.plan).name, credits=await ctx.db.run_sync(cr.balance, ws.id),
        subscription=SubscriptionOut(**{k: getattr(sub, k) for k in SubscriptionOut.model_fields}) if sub else None,
        payments=[PaymentOut(**{k: getattr(p, k) for k in PaymentOut.model_fields if k != "invoice_url"},
                             invoice_url=_invoice_link(p)) for p in pays],
        plans=billing.plan_catalogue_for(ws),
        topup={**TOPUP, "available": ws.plan != "free"},
        providers={"razorpay": live["razorpay"], "stripe": live["stripe"], "mock": not (live["razorpay"] or live["stripe"]),
                   "razorpay_key_id": cfg("razorpay_key_id") if live["razorpay"] else None},
        seats_included=plan_for(ws.plan).max_members, seats_extra=sub.seats if sub else 0,
        price_change_notice=cfg("price_change_notice"),
        plan_ends_at=sub.current_period_end if sub and sub.status == "cancelled" else None,
    )


def _invoice_link(p: Payment) -> str | None:
    """A link that opens without the app's auth headers (valid 7 days), for sharing with an accountant."""
    if p.status != "paid":
        return None
    from app.services.crypto import sign_media

    exp, sig = sign_media(f"invoice:{p.id}", 7 * 86400)
    return f"{settings.api_base_url}/billing/invoices/{p.id}?exp={exp}&sig={sig}"


@router.post("/billing/checkout")
async def checkout(body: CheckoutIn, ctx: Ctx = IsAdmin) -> dict:
    ws = ctx.workspace
    provider = provider_for_currency(body.currency)
    buyer = {"name": body.buyer_name or ctx.user.name, "email": ctx.user.email, "gstin": body.gstin, "address": body.address}
    base = settings.web_base_url

    if body.kind == "topup":
        if ws.plan == "free":
            raise ApiError(402, "plan_required", "Top-ups are available on paid plans. Pick a plan first.")
        amount = TOPUP["inr"] if body.currency == "INR" else TOPUP["usd"]
        intent = await run_in_threadpool(provider.create_topup, ws.id, amount, body.currency,
                                         f"Avatar Studio · {TOPUP['credits']} credits", f"topup-{ws.id[:8]}-{int(datetime.now().timestamp())}")
        ctx.db.add(Payment(workspace_id=ws.id, provider=intent.provider, provider_order_id=intent.provider_order_id, kind="topup",
                           amount=amount, currency=body.currency, credits=TOPUP["credits"], status="created",
                           description=f"Top-up · {TOPUP['credits']} credits", buyer=buyer))
        await ctx.db.commit()
        return _intent_out(intent, buyer)

    if body.kind == "plan":
        if not body.plan or body.plan not in PAID_RANK or body.plan == "free":
            raise ApiError(400, "bad_plan", "Pick Creator, Pro or Team.")
        existing = await ctx.db.run_sync(billing.current_subscription, ws.id)
        if existing and existing.status == "active" and existing.plan == body.plan:
            raise ApiError(409, "already_on_plan", f"You are already on {plan_for(body.plan).name}.")
        if existing and existing.status == "cancelled" and existing.plan == body.plan:
            raise ApiError(409, "resume_instead", "This plan is cancelled but still running. Use Resume to keep it.")
        if body.yearly and body.plan != "creator":
            raise ApiError(400, "no_yearly", "Yearly billing is available on Creator.")
        intent = await run_in_threadpool(provider.create_subscription, ws.id, body.plan, body.currency, body.yearly, body.seats,
                                         ctx.user.email, f"{base}/settings/plan?paid=1", f"{base}/settings/plan")
        sub = Subscription(workspace_id=ws.id, provider=intent.provider, provider_subscription_id=intent.provider_subscription_id,
                           provider_customer_id=None, plan=body.plan, currency=body.currency, yearly=body.yearly,
                           seats=body.seats, status="pending", meta={"checkout_session": intent.provider_order_id, "buyer": buyer})
        ctx.db.add(sub)
        await ctx.db.commit()
        return _intent_out(intent, buyer)

    # seats
    sub = await ctx.db.run_sync(billing.current_subscription, ws.id)
    if not sub or sub.status != "active" or ws.plan != "team":
        raise ApiError(400, "team_required", "Extra seats are available on the Team plan.")
    await run_in_threadpool(get_provider(sub.provider).update_seats, sub.provider_subscription_id, body.seats)
    sub.seats = body.seats
    await ctx.db.commit()
    return {"ok": True, "seats": body.seats}


def _intent_out(intent, buyer) -> dict:
    return {"provider": intent.provider, "kind": intent.kind, "mode": intent.mode, "provider_order_id": intent.provider_order_id,
            "provider_subscription_id": intent.provider_subscription_id, "redirect_url": intent.redirect_url,
            "public_key": intent.public_key, "amount": intent.amount, "currency": intent.currency, "extra": intent.extra,
            "prefill": {"name": buyer.get("name"), "email": buyer.get("email")}}


@router.post("/billing/confirm")
async def confirm(body: ConfirmIn, ctx: Ctx = IsAdmin) -> dict:
    """Client-side confirmation after Razorpay Checkout (or the dev mock)."""
    if body.provider == "mock" and settings.env == "prod":
        raise ApiError(400, "bad_provider", "Not available.")
    provider = get_provider(body.provider)
    try:
        ev = await run_in_threadpool(provider.verify_checkout, body.payload)
    except ValueError as e:
        raise ApiError(400, "bad_signature", str(e))
    if ev is None:
        return {"ok": True, "note": "Confirmation arrives by webhook."}
    buyer = {"name": ctx.user.name, "email": ctx.user.email}
    result = await ctx.db.run_sync(billing.apply_event, ev, ctx.workspace.id, buyer)
    await ctx.db.commit()
    return {"ok": True, **result}


@router.post("/billing/cancel")
async def cancel(ctx: Ctx = IsAdmin) -> dict:
    sub = await ctx.db.run_sync(billing.current_subscription, ctx.workspace.id)
    if not sub or sub.status not in ("active", "past_due"):
        raise ApiError(404, "no_subscription", "There is no active plan to cancel.")
    await run_in_threadpool(get_provider(sub.provider).cancel_subscription, sub.provider_subscription_id, True)
    sub.cancel_at_period_end = True
    sub.status = "cancelled"
    await ctx.db.commit()
    end = sub.current_period_end.strftime("%d %b %Y") if sub.current_period_end else "the end of this period"
    return {"ok": True, "message": f"Your plan stays active until {end}, then returns to Free. Credits you have keep working."}


@router.post("/billing/resume")
async def resume(ctx: Ctx = IsAdmin) -> dict:
    """Keep a plan that was cancelled but has not ended yet."""
    sub = await ctx.db.run_sync(billing.current_subscription, ctx.workspace.id)
    if not sub or sub.status != "cancelled":
        raise ApiError(404, "nothing_to_resume", "There is no cancelled plan to resume.")
    ok = await run_in_threadpool(get_provider(sub.provider).resume_subscription, sub.provider_subscription_id)
    if not ok:
        end = sub.current_period_end.strftime("%d %b %Y") if sub.current_period_end else "the period end"
        raise ApiError(409, "cannot_resume", f"{sub.provider.title()} cannot undo a cancellation. Your plan runs until {end}; pick it again after that.")
    sub.status, sub.cancel_at_period_end = "active", False
    await ctx.db.commit()
    return {"ok": True, "message": "Your plan continues. Nothing else changes."}


@router.get("/billing/invoices/{payment_id}", response_class=HTMLResponse)
async def invoice(payment_id: str, request: Request, exp: int | None = None, sig: str | None = None,
                  db: AsyncSession = Depends(get_db)) -> HTMLResponse:
    """Printable GST invoice. Opens with the app's auth, or with the signed link from /billing."""
    from app.services.crypto import verify_media

    if exp and sig and verify_media(f"invoice:{payment_id}", exp, sig):
        p = await db.scalar(select(Payment).where(Payment.id == payment_id))
    else:
        from app.deps import get_ctx as _get_ctx

        ctx = await _get_ctx(request, db, request.headers.get("authorization"), request.headers.get("x-dev-user-email"),
                             request.headers.get("x-workspace-id"))
        p = await db.scalar(select(Payment).where(Payment.id == payment_id, Payment.workspace_id == ctx.workspace.id))
    if not p or p.status != "paid":
        raise ApiError(404, "not_found", "Invoice not found.")
    seller = {"name": cfg("seller_name") or "Avatar Studio", "address": cfg("seller_address") or "", "gstin": cfg("seller_gstin") or ""}
    sym = "₹" if p.currency == "INR" else "$"
    fmt = lambda v: f"{sym}{v / 100:,.2f}"  # noqa: E731
    buyer = p.buyer or {}
    rows = f"<tr><td>{p.description}</td><td style='text-align:right'>{fmt(p.net_amount)}</td></tr>"
    if p.currency == "INR":
        rows += f"<tr><td>GST 18% (CGST 9% + SGST 9%)</td><td style='text-align:right'>{fmt(p.tax_amount)}</td></tr>"
    html = f"""<!doctype html><html><head><meta charset='utf-8'><title>Invoice {p.invoice_number}</title>
<style>body{{font-family:system-ui,Arial;margin:40px;color:#111}}table{{width:100%;border-collapse:collapse;margin-top:24px}}
td,th{{padding:10px;border-bottom:1px solid #ddd;text-align:left}}.tot td{{font-weight:700;border-top:2px solid #111}}
.muted{{color:#666;font-size:14px}}@media print{{button{{display:none}}}}</style></head><body>
<h1>Tax invoice</h1><p class='muted'>{p.invoice_number} · {p.paid_at:%d %b %Y} · {p.provider.title()} payment {p.provider_payment_id or ''}</p>
<table><tr><th>From</th><th>To</th></tr><tr><td>{seller['name']}<br>{seller['address']}<br>GSTIN {seller['gstin'] or '—'}</td>
<td>{buyer.get('name') or ''}<br>{buyer.get('email') or ''}<br>{buyer.get('address') or ''}<br>{'GSTIN ' + buyer['gstin'] if buyer.get('gstin') else ''}</td></tr></table>
<table><tr><th>Item</th><th style='text-align:right'>Amount</th></tr>{rows}
<tr class='tot'><td>Total paid</td><td style='text-align:right'>{fmt(p.amount)}</td></tr></table>
<p class='muted'>Credits added: {p.credits}. Prices include GST where applicable. Place of supply: India.</p>
<button onclick='window.print()'>Print or save as PDF</button></body></html>"""
    return HTMLResponse(html)


# --- webhooks (no auth; signature-verified) ----------------------------------------------
@router.post("/webhooks/payments/{provider}")
async def webhook(provider: str, request: Request, db=Depends(get_db)) -> dict:
    if provider not in ("razorpay", "stripe"):
        raise ApiError(404, "not_found", "Unknown provider.")
    body = await request.body()
    try:
        events = await run_in_threadpool(get_provider(provider).parse_webhook, body, {k.lower(): v for k, v in request.headers.items()})
    except ValueError as e:
        raise ApiError(400, "bad_signature", str(e))
    results = []
    for ev in events:
        results.append(await db.run_sync(billing.apply_event, ev))
    await db.commit()
    return {"received": len(events), "results": results}
