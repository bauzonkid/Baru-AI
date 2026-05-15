"""FastAPI entry point — `python -m uvicorn baru_api.main:app`."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from baru_api import __version__


@asynccontextmanager
async def lifespan(app: FastAPI):
    user_data = os.environ.get("BARU_USER_DATA", "")
    logger.info(f"Baru-Pixelle API v{__version__} starting (user_data={user_data!r})")
    yield
    logger.info("Baru-Pixelle API shutting down")


app = FastAPI(
    title="Baru-Pixelle API",
    version=__version__,
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


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "baru-pixelle", "version": __version__}


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}
