"""
The credits ledger.

Append-only. The balance of a workspace is SUM(amount). Positive rows are
grants, top-ups and refunds; negative rows are charges. A charge row is only
ever written by the worker after a render succeeds (hard rule 3), and it is
linked 1:1 to the job that earned it.
"""
from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import IdMixin, TimestampMixin, WorkspaceScoped

ENTRY_KINDS = ("grant", "topup", "charge", "refund", "adjust")


class CreditEntry(Base, IdMixin, TimestampMixin, WorkspaceScoped):
    __tablename__ = "credit_entries"
    # One charge per job, enforced by the database, so a retried worker can
    # never double-charge.
    __table_args__ = (UniqueConstraint("job_id", "kind", name="uq_credit_job_kind"),)

    kind: Mapped[str] = mapped_column(String(20))
    amount: Mapped[int] = mapped_column(Integer)  # credits; negative = charge
    video_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("videos.id", ondelete="SET NULL"), index=True)
    job_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("jobs.id", ondelete="SET NULL"), index=True)
    note: Mapped[str] = mapped_column(String(300), default="")
    inr_paise: Mapped[int | None] = mapped_column(Integer)  # money moved, if any (top-ups)
