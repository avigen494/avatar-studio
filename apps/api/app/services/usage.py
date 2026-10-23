"""Admin usage dashboard numbers (PRD v3: admin usage dashboard; p95 cost per minute)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.billing import Payment
from app.models.core import Membership, Workspace
from app.models.credits import CreditEntry
from app.models.platform import EngineTrial
from app.models.videos import Job, Video
from app.services.runtime_config import cfg


async def overview(db: AsyncSession, days: int = 30) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    gpu_price = float(cfg("gpu_price_inr_per_hour") or 95)

    totals = (await db.execute(select(
        func.count(Video.id),
        func.sum(case((Video.status == "succeeded", 1), else_=0)),
        func.sum(case((Video.status == "failed", 1), else_=0)),
        func.sum(case((Video.status == "cancelled", 1), else_=0)),
        func.coalesce(func.sum(case((Video.status == "succeeded", Video.duration_s), else_=0)), 0),
        func.coalesce(func.sum(Video.charged_credits), 0),
    ).where(Video.created_at >= since))).one()
    videos, ok, failed, cancelled, seconds, credits = totals
    minutes = float(seconds or 0) / 60

    # Render jobs: wall time from started_at to finished_at approximates GPU time on the mock; real GPU seconds land in job.result.
    jobs = (await db.scalars(select(Job).where(Job.type == "render", Job.status == "succeeded", Job.created_at >= since))).all()
    per_min: list[float] = []
    for j in jobs:
        gpu_s = float((j.result or {}).get("gpu_seconds") or 0)
        if not gpu_s and j.started_at and j.finished_at:
            gpu_s = (j.finished_at - j.started_at).total_seconds()
        v = await db.get(Video, j.video_id) if j.video_id else None
        if v and v.duration_s:
            per_min.append(gpu_s / 3600 * gpu_price / (v.duration_s / 60))
    per_min.sort()
    p50 = per_min[len(per_min) // 2] if per_min else None
    p95 = per_min[int(len(per_min) * 0.95) - 1 if len(per_min) >= 20 else -1] if per_min else None

    revenue = (await db.execute(select(Payment.currency, func.coalesce(func.sum(Payment.amount), 0))
                                .where(Payment.status == "paid", Payment.paid_at >= since).group_by(Payment.currency))).all()
    plans = (await db.execute(select(Workspace.plan, func.count(Workspace.id)).group_by(Workspace.plan))).all()
    paying = sum(n for p, n in plans if p != "free")

    per_ws = (await db.execute(select(
        Workspace.id, Workspace.name, Workspace.plan,
        func.count(Video.id), func.sum(case((Video.status == "succeeded", 1), else_=0)),
        func.sum(case((Video.status == "failed", 1), else_=0)),
        func.coalesce(func.sum(case((Video.status == "succeeded", Video.duration_s), else_=0)), 0),
        func.coalesce(func.sum(Video.charged_credits), 0),
    ).outerjoin(Video, (Video.workspace_id == Workspace.id) & (Video.created_at >= since))
     .group_by(Workspace.id).order_by(func.coalesce(func.sum(Video.charged_credits), 0).desc()).limit(50))).all()
    members = dict((await db.execute(select(Membership.workspace_id, func.count(Membership.id)).group_by(Membership.workspace_id))).all())
    balances = dict((await db.execute(select(CreditEntry.workspace_id, func.coalesce(func.sum(CreditEntry.amount), 0))
                                      .group_by(CreditEntry.workspace_id))).all())

    daily = (await db.execute(select(func.date(Video.created_at), func.count(Video.id),
                                     func.sum(case((Video.status == "succeeded", 1), else_=0)))
                              .where(Video.created_at >= since).group_by(func.date(Video.created_at)).order_by(func.date(Video.created_at)))).all()
    trials = await db.scalar(select(func.count(EngineTrial.id))) or 0

    return {
        "days": days,
        "videos": {"total": int(videos or 0), "succeeded": int(ok or 0), "failed": int(failed or 0), "cancelled": int(cancelled or 0),
                   "minutes": round(minutes, 1), "credits_charged": int(credits or 0),
                   "failure_rate": round((failed or 0) / videos, 3) if videos else 0.0},
        "cost_per_minute_inr": {"p50": round(p50, 1) if p50 is not None else None, "p95": round(p95, 1) if p95 is not None else None,
                                "target_p95": 60, "samples": len(per_min), "gpu_price_inr_per_hour": gpu_price,
                                "note": None if (cfg("avatar_engine_backend") or "mock") == "runpod" else "Mock engine: costs are wall time at the GPU price, not real GPU spend."},
        "revenue": {c: int(a) for c, a in revenue},
        "workspaces": {"total": sum(n for _, n in plans), "paying": paying, "by_plan": {p: n for p, n in plans}, "target_paying": 20},
        "per_workspace": [{"id": i, "name": n, "plan": p, "videos": int(v or 0), "succeeded": int(s or 0), "failed": int(f or 0),
                           "minutes": round(float(sec or 0) / 60, 1), "credits_charged": int(c or 0),
                           "members": int(members.get(i, 0)), "balance": int(balances.get(i, 0))}
                          for i, n, p, v, s, f, sec, c in per_ws],
        "daily": [{"date": str(d), "videos": int(n), "succeeded": int(s or 0)} for d, n, s in daily],
        "engine_trials": trials,
    }
