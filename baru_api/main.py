"""FastAPI entry point — `python -m uvicorn baru_api.main:app`.

Merged from Pixelle-Video api/app.py with Baru-Pixelle Electron-spawn defaults.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger

from baru_api import __version__
from baru_api.config import api_config
from baru_api.dependencies import shutdown_pixelle_video
from baru_api.tasks import task_manager
from baru_api.routers import (
    config_router,
    content_router,
    files_router,
    frame_router,
    health_router,
    history_router,
    image_router,
    license_router,
    llm_router,
    resources_router,
    tasks_router,
    tts_router,
    video_router,
)
from baru_api.routers.license import (
    get_license_validity,
    refresh_license_at_startup,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start/stop task manager + revalidate license on every boot."""
    user_data = os.environ.get("BARU_USER_DATA", "")
    logger.info(
        f"Baru-Pixelle API v{__version__} starting (user_data={user_data!r})"
    )
    # Probe yohomin for the saved license before serving any request.
    # This is what flips _LICENSE_VALID = True so middleware lets the
    # pipeline through. A blank / unreachable / revoked key keeps the
    # tool gated until LicenseGate posts a working one.
    refresh_license_at_startup()
    await task_manager.start()
    logger.info("Baru-Pixelle API started")

    yield

    logger.info("Baru-Pixelle API shutting down")
    await task_manager.stop()
    await shutdown_pixelle_video()
    logger.info("Baru-Pixelle API shutdown complete")


# Endpoints the license middleware lets through regardless of validity.
# Includes the gate itself + everything the renderer needs to render
# LicenseGate (ping, version, app config defaults). Pipeline endpoints
# (video / image / llm / tts / content / tasks) require a valid license.
_LICENSE_BYPASS_PREFIXES = (
    "/",  # root + /health + /version + /docs / /openapi.json
    "/health",
    "/version",
    "/docs",
    "/redoc",
    "/openapi.json",
    f"{api_config.api_prefix}/license",
    f"{api_config.api_prefix}/license-status",
    f"{api_config.api_prefix}/config",
    f"{api_config.api_prefix}/resources",
)


def _license_bypass(path: str) -> bool:
    # Exact "/", or any of the public prefixes.
    if path == "/":
        return True
    return any(path.startswith(p) for p in _LICENSE_BYPASS_PREFIXES if p != "/")


app = FastAPI(
    title="Baru-Pixelle API",
    version=__version__,
    docs_url=api_config.docs_url,
    redoc_url=api_config.redoc_url,
    openapi_url=api_config.openapi_url,
    lifespan=lifespan,
)

# Desktop app: renderer (Vite dev http://localhost:5173 or file://) hits
# FastAPI on 127.0.0.1:5000 — different origin, browser blocks the fetch
# without these headers. allow_origins=["*"] is fine because the server
# only binds 127.0.0.1 (loopback) and ships inside the Electron bundle.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# License gate middleware: returns 451 on every pipeline endpoint when
# the saved license isn't currently ``ok``. Renderer listens for 451
# and bounces back to LicenseGate. Bypass list: gate endpoints + the
# few things the gate UI itself needs (config defaults, resource lists,
# health ping). Same pattern Baru-YTB uses.
@app.middleware("http")
async def license_gate(request: Request, call_next):
    if not _license_bypass(request.url.path):
        valid, status, error = get_license_validity()
        if not valid:
            return JSONResponse(
                status_code=451,
                content={
                    "detail": "license_invalid",
                    "license_status": status,
                    "license_error": error,
                },
            )
    return await call_next(request)

# Health check router (no prefix — exposes /health and /version).
app.include_router(health_router)

# API routers (prefixed with /api).
app.include_router(llm_router, prefix=api_config.api_prefix)
app.include_router(tts_router, prefix=api_config.api_prefix)
app.include_router(image_router, prefix=api_config.api_prefix)
app.include_router(content_router, prefix=api_config.api_prefix)
app.include_router(video_router, prefix=api_config.api_prefix)
app.include_router(tasks_router, prefix=api_config.api_prefix)
app.include_router(files_router, prefix=api_config.api_prefix)
app.include_router(resources_router, prefix=api_config.api_prefix)
app.include_router(frame_router, prefix=api_config.api_prefix)
app.include_router(config_router, prefix=api_config.api_prefix)
app.include_router(license_router, prefix=api_config.api_prefix)
app.include_router(history_router, prefix=api_config.api_prefix)


@app.get("/")
async def root() -> dict[str, str]:
    """Electron pill ping target."""
    return {"service": "baru-pixelle", "version": __version__}
