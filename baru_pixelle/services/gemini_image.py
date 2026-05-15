"""Gemini Image direct provider — bypass ComfyUI.

Calls Google Gemini's image-generation models (e.g. ``gemini-2.5-flash-image-preview``,
codename "Nano Banana") directly via the ``google-genai`` SDK. Returns the same
``MediaResult`` shape as ``MediaService`` for drop-in routing inside it.

Why direct (vs. through ComfyUI's GeminiImageNode): a desktop user with just an
AI Studio API key shouldn't need ComfyUI installed + custom-nodes wired up.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from pathlib import Path
from typing import Optional

from loguru import logger

from baru_pixelle.models.media import MediaResult


DEFAULT_MODEL = "gemini-2.5-flash-image-preview"


async def generate_image_gemini(
    prompt: str,
    api_key: str,
    model: str = DEFAULT_MODEL,
    output_path: Optional[str] = None,
) -> MediaResult:
    """Generate one image via Gemini API. Returns ``MediaResult(media_type="image", url=<path>)``."""
    if not api_key:
        raise ValueError(
            "Gemini API key missing. Set comfyui.image.gemini.api_key in config.yaml "
            "or GEMINI_API_KEY env var."
        )

    # Lazy import so the rest of the app boots even if google-genai isn't installed.
    from google import genai

    logger.info(f"🎨 Gemini Image direct: model={model}")

    client = genai.Client(api_key=api_key)

    def _call() -> bytes:
        response = client.models.generate_content(
            model=model,
            contents=prompt,
        )
        for candidate in response.candidates or []:
            for part in candidate.content.parts or []:
                inline = getattr(part, "inline_data", None)
                if inline and inline.data and (inline.mime_type or "").startswith("image/"):
                    return inline.data
        raise RuntimeError(
            "Gemini returned no image data. Check model name + that the API key has "
            "image-gen permission (Nano Banana is preview-tier)."
        )

    image_bytes = await asyncio.to_thread(_call)

    if not output_path:
        unique_id = uuid.uuid4().hex
        output_path = str(Path("output") / f"{unique_id}.png")

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(image_bytes)

    logger.info(f"✅ Gemini Image saved: {output_path} ({len(image_bytes) // 1024} KB)")
    return MediaResult(media_type="image", url=output_path)
