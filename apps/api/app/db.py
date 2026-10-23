"""
Database session plumbing.

One async engine for the API. The worker is a separate process and builds its
own engine from the same settings. SQLite for local dev, Postgres for
compose/prod - the ORM code is identical for both.
"""
from __future__ import annotations

import os
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


class Base(DeclarativeBase):
    pass


def make_engine(url: str):
    kwargs: dict = {"future": True}
    if url.startswith("sqlite"):
        # Make sure the folder for the SQLite file exists before connecting.
        path = url.split("///", 1)[-1]
        if path and path != ":memory:":
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        kwargs["connect_args"] = {"timeout": 30}
    else:
        kwargs["pool_pre_ping"] = True
        kwargs["pool_size"] = 10
    return create_async_engine(url, **kwargs)


engine = make_engine(settings.database_url)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


async def init_db() -> None:
    """Dev convenience: create tables and put SQLite in WAL mode."""
    from app import models  # noqa: F401  (registers every table on Base)

    async with engine.begin() as conn:
        if settings.is_sqlite:
            await conn.exec_driver_sql("PRAGMA journal_mode=WAL")
        if settings.auto_create_tables:
            await conn.run_sync(Base.metadata.create_all)
