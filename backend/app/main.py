"""FastAPI application wiring for the EdgeSec Agent.

Serves:
  - /api/v1/scan        POST  start a scan (async, WS/SSE progress)
  - /api/v1/health      GET   agent status
  - /api/v1/scans       GET   recent scans
  - /api/v1/scan-results/{id} GET full report
  - /api/v1/scan-events/{id}  SSE progress fallback
  - /ws/scan/{id}       WS    progress stream

The built Angular PWA is also served from the same origin so service-worker
caching of the API (ngsw dataGroups) works.
"""
from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config
from .routers import browse, events, health, scan

app = FastAPI(
    title=config.APP_NAME,
    version=config.VERSION,
    description="Edge-native cybersecurity agent backend (FastAPI + LangGraph).",
)

# Local PWA + backend are same-origin in production; dev server proxies to :8000.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200", "http://127.0.0.1:4200"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = FastAPI(title=f"{config.APP_NAME} API", version=config.VERSION)
api.include_router(health.router)  # /health, /scan, ... relative to the mount
api.include_router(scan.router)
api.include_router(browse.router)  # /browse — host folder browser

app.include_router(events.router)  # /ws/scan/{id}
app.mount(config.API_PREFIX, api)  # /api/v1/health, /api/v1/scan, ...


# ── Serve the built PWA from the same origin ─────────────────────────────
def _serve_static() -> None:
    dist = os.path.abspath(config.DIST_DIR)
    index_path = os.path.join(dist, "index.html")
    if not os.path.exists(index_path):
        return
    app.mount("/assets", StaticFiles(directory=os.path.join(dist, "assets")), name="assets")
    app.mount("/media", StaticFiles(directory=os.path.join(dist, "media")), name="media")

    @app.get("/")
    async def root():
        return FileResponse(index_path)

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        candidate = os.path.normpath(os.path.join(dist, full_path))
        if full_path and candidate.startswith(dist) and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(index_path)


_serve_static()