"""
Remove test accounts and their data from the local dev database and storage.

Keeps every user listed in KEEP (and everything in their workspaces). Deletes
all other users, their workspaces, and every row and file that belongs to
those workspaces. Dev only: refuses to run against anything but SQLite.

    cd apps/api && .venv\\Scripts\\python ..\\..\\scripts\\clean_dev_data.py --keep you@example.com [--dry-run]
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps" / "api"))

from sqlalchemy import delete, select  # noqa: E402

from app.config import settings  # noqa: E402
from app.models import (  # noqa: E402
    ApiKey, CreditEntry, EngineTrial, Identity, Invite, Job, Look, Membership, Payment, Project, Reaction,
    Subscription, User, Video, Voice, Webhook, WebhookDelivery, Workspace,
)
from app.worker.db import SyncSession  # noqa: E402

WORKSPACE_TABLES = [WebhookDelivery, Webhook, ApiKey, Invite, Payment, Subscription, EngineTrial, Reaction, CreditEntry,
                    Job, Video, Look, Identity, Voice, Project, Membership]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", action="append", default=[], help="email to keep (repeatable)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if not settings.is_sqlite:
        sys.exit("Refusing: this script only runs against the local SQLite database.")
    keep = {e.strip().lower() for e in args.keep if e.strip()}
    if not keep:
        sys.exit("Pass at least one --keep email.")

    with SyncSession() as db:
        users = db.scalars(select(User)).all()
        keep_users = [u for u in users if u.email.lower() in keep]
        drop_users = [u for u in users if u.email.lower() not in keep]
        keep_ws = {m.workspace_id for u in keep_users for m in db.scalars(select(Membership).where(Membership.user_id == u.id)).all()}
        # Workspaces to drop: every workspace with no kept member.
        all_ws = db.scalars(select(Workspace)).all()
        drop_ws = [w for w in all_ws if w.id not in keep_ws]

        print(f"keeping {len(keep_users)} user(s): {', '.join(u.email for u in keep_users)}")
        print(f"dropping {len(drop_users)} user(s) and {len(drop_ws)} workspace(s)")
        for w in drop_ws:
            n_videos = db.scalar(select(Video.id).where(Video.workspace_id == w.id)) is not None
            print(f"  - workspace {w.name!r} ({w.id[:8]}) plan={w.plan} videos={'yes' if n_videos else 'no'}")
        for u in drop_users:
            print(f"  - user {u.email}")
        if args.dry_run:
            print("dry run: nothing deleted")
            return

        for w in drop_ws:
            for table in WORKSPACE_TABLES:
                db.execute(delete(table).where(table.workspace_id == w.id))
            db.delete(w)
        for u in drop_users:
            db.execute(delete(Membership).where(Membership.user_id == u.id))
            db.delete(u)
        db.commit()

    root = Path(settings.local_storage_root) / "ws"
    removed = 0
    for w in drop_ws:
        p = root / w.id
        if p.exists():
            shutil.rmtree(p, ignore_errors=True)
            removed += 1
    tmp = Path(settings.local_storage_root) / "tmp"
    if tmp.exists():
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"deleted {len(drop_ws)} workspace folder(s) from storage ({removed} existed); tmp cleared")


if __name__ == "__main__":
    main()
