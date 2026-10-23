"""
Avatar Studio API.

Run locally:   uvicorn app.main:app --reload --port 8000
Worker:        python -m app.worker
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import settings
from app.db import init_db
from app.routers import (
    admin, ai, billing, credits, developer, health, identities, jobs, lab, me, projects, share, team, uploads, v3, videos,
    voices, workspaces,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    yield


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Multi-tenant AI avatar video API. Charge on success only. Free 15-second previews.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Every error has the same shape: {"error": {"code", "message", ...}}.
@app.exception_handler(StarletteHTTPException)
async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict) and "code" in detail:
        body = detail
    else:
        body = {"code": "error", "message": str(detail)}
    return JSONResponse(status_code=exc.status_code, content={"error": body})


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    loc = ".".join(str(p) for p in first.get("loc", []) if p not in ("body", "query"))
    msg = first.get("msg", "Invalid input")
    return JSONResponse(status_code=422, content={"error": {
        "code": "invalid_input", "message": f"{loc}: {msg}" if loc else msg, "details": exc.errors()}})


for r in (health, me, workspaces, uploads, identities, voices, projects, videos, share, credits, ai, jobs, admin, lab, billing, team,
          developer, v3):
    app.include_router(r.router)
