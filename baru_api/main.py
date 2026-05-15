"""FastAPI entry point — `python -m uvicorn baru_api.main:app`.

Merged from Pixelle-Video api/app.py with Baru-Pixelle Electron-spawn defaults.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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
    image_router,
    llm_router,
    resources_router,
    tasks_router,
    tts_router,
    video_router,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start/stop task manager and Pixelle core lifecycle."""
    user_data = os.environ.get("BARU_USER_DATA", "")
    logger.info(
        f"Baru-Pixelle API v{__version__} starting (user_data={user_data!r})"
    )
    await task_manager.start()
    logger.info("Baru-Pixelle API started")

    yield

    logger.info("Baru-Pixelle API shutting down")
    await task_manager.stop()
    await shutdown_pixelle_video()
    logger.info("Baru-Pixelle API shutdown complete")


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


@app.get("/")
async def root() -> dict[str, str]:
    """Electron pill ping target."""
    return {"service": "baru-pixelle", "version": __version__}
