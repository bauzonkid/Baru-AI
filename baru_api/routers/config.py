"""Config endpoints — read + write config.yaml from the UI."""

from typing import Any

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel

from baru_pixelle.config.manager import ConfigManager

router = APIRouter(prefix="/config", tags=["Config"])


class ConfigUpdateRequest(BaseModel):
    """Partial config update — deep-merged into existing config.yaml."""

    updates: dict[str, Any]


@router.get("")
async def get_config() -> dict[str, Any]:
    """Return current configuration as a plain dict.

    Note: this exposes API keys to anyone who can reach the local FastAPI
    port. That's by design — the renderer needs them to render the
    Settings form pre-filled. FastAPI only binds 127.0.0.1, so the keys
    don't leave the machine.
    """
    cm = ConfigManager()
    return cm.config.to_dict()


@router.post("")
async def update_config(request: ConfigUpdateRequest) -> dict[str, Any]:
    """Deep-merge ``updates`` into config.yaml, persist, and invalidate the
    cached PixelleVideoCore singleton so the next request rebuilds it
    against the new values.
    """
    try:
        cm = ConfigManager()
        cm.update(request.updates)
        cm.save()
        logger.info(f"Config updated + saved: keys={list(request.updates.keys())}")

        # Drop the cached core so MediaService / TTSService / LLMService
        # pick up the new config on the next request. Without this, edits
        # to api_key etc. wouldn't take effect until app restart.
        from baru_api.dependencies import _pixelle_video_instance  # noqa: F401
        import baru_api.dependencies as deps

        if deps._pixelle_video_instance is not None:
            try:
                await deps._pixelle_video_instance.cleanup()
            except Exception as e:
                logger.warning(f"Cleanup failed during config reload (non-fatal): {e}")
            deps._pixelle_video_instance = None
            logger.info("PixelleVideoCore invalidated — will rebuild on next request")

        return cm.config.to_dict()

    except Exception as e:
        logger.error(f"Config update failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
