"""Imagen 3 / Nano Banana via Yohomin's ``/api/imagen/generate`` proxy.

Yohomin (sáº¿p's self-hosted dashboard) runs a Vertex AI gateway funded by
the $300 Google Cloud free credit. Two backends behind one endpoint:

* Text-to-image â†’ Imagen 3 (``imagen-3.0-generate-002``)
* Image-to-image (when ``source_image`` is provided) â†’ Gemini 2.5 Flash
  Image (Nano Banana) with ``responseModalities=IMAGE``

Auth: Bearer ``license_key`` (Baru license or Yohomin user token â€”
sáº¿p pools keys per consumer).

Same proxy Baru-YTB Thumb Studio calls (see baru_api/routes.py
``post_thumb_image``); keeping the shape identical lets sáº¿p share one
license + credit pool across both apps.
"""

from __future__ import annotations

import asyncio
import base64
import os
import re
import tempfile
from pathlib import Path
from typing import Optional

import httpx
from loguru import logger

from baru_ai.models.media import MediaResult


_DEFAULT_BASE_URL = "https://yohomin.com"
_DEFAULT_TIMEOUT_S = 200.0  # Imagen 3 renders take 60-90s, allow headroom.


class ImagenQuotaExceeded(RuntimeError):
    """Vertex AI quota for Imagen 3 is exhausted. Raised so MediaService
    can fall back to Gemini direct (Nano Banana via AI Studio) when the
    user has an AI Studio key configured.
    """


def _check_imagen_response(r: httpx.Response) -> None:
    """Raise the right typed exception for a non-2xx Imagen response.

    Vertex's per-base-model rate limit ("Quota exceeded for
    aiplatform.googleapis.com/online_prediction_requests_per_base_model")
    surfaces as a 500 with that message in ``error`` â€” we route to
    ``ImagenQuotaExceeded`` so the outer retry loop wakes up. Anything
    else stays a plain RuntimeError so MediaService can decide whether
    to fall back to Gemini direct.
    """
    if r.status_code < 400:
        return
    try:
        err = (r.json() or {}).get("error") or r.text[:300]
    except Exception:
        err = r.text[:300]
    if "quota" in err.lower() or "rate" in err.lower():
        raise ImagenQuotaExceeded(
            f"Yohomin /api/imagen/generate {r.status_code}: {err}"
        )
    raise RuntimeError(f"Yohomin /api/imagen/generate {r.status_code}: {err}")

# Imagen 3 blocks photoreal generation of anyone reading as a minor.
# Even with the IMAGEN SAFETY rule in the LLM prompt template
# (baru_ai/prompts/image_generation.py), the LLM occasionally lets
# a "child" / "daughter" / "son" slip through. Belt-and-suspenders:
# scrub those tokens client-side before they ever hit /api/imagen/generate.
# Same pattern Yohomin server.js applies on its end â€” we mirror it here
# so the error message ("safety filter rejected") doesn't surface to the
# user when we could've prevented it.
_MINOR_WORD_PATTERN = re.compile(
    r"\b(child(ren)?|kid(s)?|minor(s)?|son(s)?|daughter(s)?|toddler(s)?|"
    r"infant(s)?|bab(y|ies)|teen(s|ager(s)?)?|schoolchild(ren)?|"
    r"schoolboy(s)?|schoolgirl(s)?|young\s+(boy|girl))\b",
    re.IGNORECASE,
)


def _scrub_minor_terms(prompt: str) -> str:
    """Replace any minor-referencing word with ``adult helper``."""
    return _MINOR_WORD_PATTERN.sub("adult helper", prompt)


# How long to wait when Vertex's per-minute quota slams the request.
# Default Imagen 3 quota is 6 RPM = one slot every 10s, so waiting 65s
# clears the rolling window with a safety buffer for clock skew.
_QUOTA_RETRY_WAIT_S = 65.0
_QUOTA_MAX_RETRIES = 2


async def generate_image_imagen(
    prompt: str,
    license_key: str,
    base_url: str = _DEFAULT_BASE_URL,
    aspect_ratio: str = "9:16",
    source_image: Optional[str] = None,
    output_path: Optional[str] = None,
) -> MediaResult:
    """POST to ``{base_url}/api/imagen/generate``, write the returned PNG
    to ``output_path``, return ``MediaResult(media_type="image", url=path)``.

    On a per-minute quota hit (Vertex's "online_prediction_requests_per
    _base_model" rate limit, default 6 RPM), the call sleeps 65s and
    retries up to ``_QUOTA_MAX_RETRIES`` times. The 60-second sliding
    window resets within that wait, so a render that bursts ahead of
    the limit just pauses instead of failing â€” much friendlier than the
    Gemini-fallback path (which kicks in only after retries also fail).

    Args:
        prompt: Image prompt (text-to-image) or restyle instruction
            (image-to-image when source_image is set).
        license_key: Bearer token for Yohomin. Same key Baru-YTB Thumb
            Studio uses.
        base_url: Yohomin origin. Default ``https://yohomin.com`` â€”
            override to ``http://localhost:3457`` (or whatever local
            port) when running Yohomin locally.
        aspect_ratio: One of ``1:1`` / ``16:9`` / ``9:16`` / ``4:3``
            / ``3:4``. Vertical (9:16) by default for Shorts.
        source_image: Optional URL or ``data:image/...;base64,...`` of
            a reference image. When present, Yohomin routes to Nano
            Banana for restyle. Otherwise text-to-image via Imagen 3.
        output_path: Destination PNG path. Auto-generated under
            ``output/`` when omitted.
    """
    if not license_key:
        raise ValueError(
            "Yohomin license key missing. Set comfyui.image.imagen.license_key "
            "in config.yaml or BARU_LICENSE_KEY env var."
        )

    # Scrub any minor-referencing words client-side. The LLM prompt
    # template tells Gemini to avoid these, but we can't trust a single
    # layer when the failure mode is a hard safety-filter rejection.
    safe_prompt = _scrub_minor_terms(prompt)
    if safe_prompt != prompt:
        logger.warning(
            "[imagen-yohomin] Scrubbed minor-referencing tokens from prompt "
            "to avoid Imagen safety filter. Update the LLM prompt template "
            "if this keeps happening."
        )

    url = f"{base_url.rstrip('/')}/api/imagen/generate"
    body: dict[str, object] = {"prompt": safe_prompt, "aspectRatio": aspect_ratio}
    if source_image:
        body["sourceImage"] = source_image

    headers = {
        "Authorization": f"Bearer {license_key}",
        "Content-Type": "application/json",
        # Cloudflare WAF in front of yohomin.com blocks the default httpx
        # User-Agent on some account tiers. Match the Chrome UA Baru-YTB
        # already uses for LLM calls through the same tunnel.
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
    }

    logger.info(
        f"ðŸŽ¨ Imagen via Yohomin: {url} (aspect={aspect_ratio}, "
        f"mode={'edit' if source_image else 'generate'})"
    )

    # Retry on per-minute quota. Each retry waits ~65s so the Vertex
    # rolling window clears. After _QUOTA_MAX_RETRIES the typed
    # exception propagates so MediaService can try Gemini fallback or
    # surface the error to the user.
    last_exc: Optional[ImagenQuotaExceeded] = None
    for attempt in range(_QUOTA_MAX_RETRIES + 1):
        try:
            async with httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT_S) as client:
                r = await client.post(url, json=body, headers=headers)
            _check_imagen_response(r)
            break  # success â€” drop out and parse below
        except ImagenQuotaExceeded as exc:
            last_exc = exc
            if attempt < _QUOTA_MAX_RETRIES:
                logger.warning(
                    f"â³ Imagen quota hit (try {attempt + 1}/"
                    f"{_QUOTA_MAX_RETRIES + 1}); waiting "
                    f"{_QUOTA_RETRY_WAIT_S:.0f}s for rate window reset..."
                )
                await asyncio.sleep(_QUOTA_RETRY_WAIT_S)
                continue
            raise
    else:
        # Shouldn't reach here â€” either ``break`` or ``raise`` exits.
        # Guard against silent fallthrough just in case.
        if last_exc:
            raise last_exc

    data = r.json()
    image_data_url = data.get("image", "")
    if not image_data_url.startswith("data:image/"):
        raise RuntimeError(
            f"Yohomin returned unexpected payload (no data URL). Got: {str(data)[:200]}"
        )

    m = re.match(r"^data:(image/[\w+.-]+);base64,(.+)$", image_data_url)
    if not m:
        raise RuntimeError("Yohomin image data URL malformed")
    mime, b64 = m.group(1), m.group(2)
    image_bytes = base64.b64decode(b64)

    ext = "png" if "png" in mime else ("jpg" if "jpeg" in mime else "img")
    if not output_path:
        # Stage in tempdir, not in project ``output/``. The caller
        # (frame_processor._download_media) copies the result into the
        # task's frame dir; leaving a copy at output/<uuid>.png pollutes
        # the workspace with one file per frame per render.
        fd, output_path = tempfile.mkstemp(suffix=f".{ext}", prefix="baru_imagen_")
        os.close(fd)
    else:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "wb") as f:
        f.write(image_bytes)

    logger.info(
        f"âœ… Imagen saved: {output_path} ({len(image_bytes) // 1024} KB, "
        f"model={data.get('model', '?')})"
    )
    return MediaResult(media_type="image", url=output_path)
