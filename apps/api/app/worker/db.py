"""Sync database session for the worker process."""
from __future__ import annotations

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings


def make_sync_engine(url: str | None = None):
    url = url or settings.sync_database_url
    kwargs: dict = {"future": True}
    if url.startswith("sqlite"):
        path = url.split("///", 1)[-1]
        if path and path != ":memory:":
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        kwargs["connect_args"] = {"timeout": 30, "check_same_thread": False}
    else:
        kwargs["pool_pre_ping"] = True
    return create_engine(url, **kwargs)


sync_engine = make_sync_engine()
SyncSession = sessionmaker(sync_engine, expire_on_commit=False, class_=Session)
