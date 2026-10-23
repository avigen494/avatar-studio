from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.config import settings
from app.deps import ApiError, Ctx, IsAdmin, get_ctx
from app.models.credits import CreditEntry
from app.schemas import CreditsOut, DevGrantIn, LedgerEntryOut
from app.services import credits

router = APIRouter(prefix="/credits", tags=["credits"])


@router.get("", response_model=CreditsOut)
async def get_credits(ctx: Ctx = Depends(get_ctx)) -> CreditsOut:
    return CreditsOut(balance=await ctx.db.run_sync(credits.balance, ctx.workspace.id), plan=ctx.workspace.plan,
                      price_per_credit_inr=settings.credit_price_inr, free_preview_seconds=settings.preview_max_seconds)


@router.get("/ledger", response_model=list[LedgerEntryOut])
async def ledger(ctx: Ctx = Depends(get_ctx), limit: int = 200) -> list[LedgerEntryOut]:
    rows = (await ctx.db.scalars(
        select(CreditEntry).where(CreditEntry.workspace_id == ctx.workspace.id)
        .order_by(CreditEntry.created_at.desc()).limit(min(limit, 1000))
    )).all()
    return [LedgerEntryOut.model_validate(r) for r in rows]


@router.get("/ledger.csv")
async def ledger_csv(ctx: Ctx = Depends(get_ctx)) -> StreamingResponse:
    """Usage ledger export, with rupees next to credits (PRD section 13)."""
    rows = (await ctx.db.scalars(
        select(CreditEntry).where(CreditEntry.workspace_id == ctx.workspace.id).order_by(CreditEntry.created_at)
    )).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["date", "kind", "credits", "inr_list_value", "note", "video_id", "job_id"])
    for r in rows:
        w.writerow([r.created_at.isoformat(), r.kind, r.amount, r.amount * settings.credit_price_inr, r.note,
                    r.video_id or "", r.job_id or ""])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=usage-ledger.csv"})


@router.post("/dev-grant", response_model=CreditsOut)
async def dev_grant(body: DevGrantIn, ctx: Ctx = IsAdmin) -> CreditsOut:
    """Local testing only. Razorpay/Stripe top-ups arrive in v3."""
    if settings.env == "prod":
        raise ApiError(404, "not_found", "Not found.")
    await ctx.db.run_sync(credits.grant, ctx.workspace.id, body.amount, "Dev grant", "topup")
    await ctx.db.commit()
    return await get_credits(ctx)
