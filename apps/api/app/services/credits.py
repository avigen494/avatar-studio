"""
Credits ledger service.

Only three operations exist on purpose:
  grant()   - plan grants, top-ups, dev grants
  charge()  - written by the worker when a render SUCCEEDS (hard rule 3)
  refund()  - undo a charge (support action); never needed for failures,
              because failures are never charged in the first place.

The functions take a plain (sync) SQLAlchemy Session so the worker can call
them directly and the async API calls them with `await db.run_sync(fn, ...)`.
One implementation, two callers, no drift.
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.credits import CreditEntry


class InsufficientCredits(Exception):
    def __init__(self, needed: int, available: int):
        super().__init__(f"You need {needed} credits for this video and have {available}.")
        self.needed = needed
        self.available = available


def balance(db: Session, workspace_id: str) -> int:
    total = db.scalar(
        select(func.coalesce(func.sum(CreditEntry.amount), 0)).where(CreditEntry.workspace_id == workspace_id)
    )
    return int(total or 0)


def grant(db: Session, workspace_id: str, amount: int, note: str, kind: str = "grant",
          inr_paise: int | None = None) -> CreditEntry:
    if amount <= 0:
        raise ValueError("Grant amount must be positive")
    entry = CreditEntry(workspace_id=workspace_id, kind=kind, amount=amount, note=note, inr_paise=inr_paise)
    db.add(entry)
    db.flush()
    return entry


def ensure_can_afford(db: Session, workspace_id: str, credits: int) -> int:
    have = balance(db, workspace_id)
    if credits > have:
        raise InsufficientCredits(credits, have)
    return have


def charge(db: Session, workspace_id: str, credits: int, video_id: str | None, job_id: str, note: str) -> CreditEntry | None:
    """
    Debit after success. Idempotent per job: a second call for the same job
    returns the existing row instead of charging twice (and the database
    enforces it too with a unique constraint).
    """
    existing = db.scalar(select(CreditEntry).where(CreditEntry.job_id == job_id, CreditEntry.kind == "charge"))
    if existing:
        return existing
    if credits <= 0:
        return None
    entry = CreditEntry(workspace_id=workspace_id, kind="charge", amount=-abs(credits),
                        video_id=video_id, job_id=job_id, note=note)
    db.add(entry)
    db.flush()
    return entry


def refund(db: Session, workspace_id: str, job_id: str, note: str) -> CreditEntry | None:
    """Reverse a charge for a job, once."""
    charged = db.scalar(select(CreditEntry).where(CreditEntry.job_id == job_id, CreditEntry.kind == "charge"))
    if not charged:
        return None
    already = db.scalar(select(CreditEntry).where(CreditEntry.job_id == job_id, CreditEntry.kind == "refund"))
    if already:
        return already
    entry = CreditEntry(workspace_id=workspace_id, kind="refund", amount=abs(charged.amount),
                        video_id=charged.video_id, job_id=job_id, note=note)
    db.add(entry)
    db.flush()
    return entry
