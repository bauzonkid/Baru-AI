# Copyright (C) 2025 AIDC-AI
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#     http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
ComfyUI health endpoint — used by the Settings panel + Advanced tab
gate to confirm the user-configured ComfyUI server is reachable before
they try to render i2v.
"""

from typing import Optional

import httpx
from fastapi import APIRouter
from loguru import logger
from pydantic import BaseModel

from baru_ai.config import config_manager

router = APIRouter(prefix="/comfyui", tags=["ComfyUI"])


class ComfyHealthResponse(BaseModel):
    """ComfyUI server reachability probe."""
    online: bool
    url: str
    error: Optional[str] = None


@router.get("/health", response_model=ComfyHealthResponse)
async def comfyui_health(url: Optional[str] = None) -> ComfyHealthResponse:
    """
    Ping a ComfyUI server.

    Hits ``GET {url}/system_stats`` with a 3s timeout — that's
    ComfyUI's standard health endpoint and returns even when the
    queue is busy.

    If ``url`` query param is given, probes that URL (used by the
    Settings Test button when the user types a new URL but hasn't saved
    yet). Otherwise probes the URL from saved config (used by the
    Advanced tab gate on render).
    """
    target = (url or config_manager.config.comfyui.comfyui_url or "").rstrip("/")
    if not target:
        return ComfyHealthResponse(
            online=False, url="", error="ComfyUI URL chưa cấu hình"
        )

    probe = f"{target}/system_stats"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(probe)
            resp.raise_for_status()
        return ComfyHealthResponse(online=True, url=target)
    except httpx.ConnectError:
        return ComfyHealthResponse(
            online=False, url=target, error="Không kết nối được (server tắt?)"
        )
    except httpx.TimeoutException:
        return ComfyHealthResponse(
            online=False, url=target, error="Timeout 3s — server quá chậm"
        )
    except httpx.HTTPStatusError as e:
        return ComfyHealthResponse(
            online=False, url=target, error=f"HTTP {e.response.status_code}"
        )
    except Exception as e:  # noqa: BLE001 — show any unknown error to user
        logger.warning(f"ComfyUI health probe failed: {e}")
        return ComfyHealthResponse(online=False, url=target, error=str(e))
