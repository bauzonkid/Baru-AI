"""Imagen 3 / Nano Banana via Yohomin's ``/api/imagen/generate`` proxy.

Yohomin (sếp's self-hosted dashboard) runs a Vertex AI gateway funded by
the $300 Google Cloud free credit. Two backends behind one endpoint:

* Text-to-image → Imagen 3 (``imagen-3.0-generate-002``)
* Image-to-image (when ``source_image`` is provided) → Gemini 2.5 Flash
  Image (Nano Banana) with ``responseModalities=IMAGE``

Auth: Bearer ``license_key`` (Baru license or Yohomin user token —
sếp pools keys per consumer).

Same proxy Baru-YTB Thumb Studio calls (see baru_api/routes.py
``post_thumb_image``); keeping the shape identical lets sếp share one
license + credit pool across both apps.
"""

from __future__ import annotations

import base64
import re
import uuid
from pathlib import Path
from typing import Optional

import httpx
from loguru import logger

from baru_pixelle.models.media import MediaResult


_DEFAULT_BASE_URL = "https://yohomin.com"
_DEFAULT_TIMEOUT_S = 200.0  # Imagen 3 renders take 60-90s, allow headroom.


class ImagenQuotaExceeded(RuntimeError):
    """Vertex AI quota for Imagen 3 is exhausted. Raised so MediaService
    can fall back to Gemini direct (Nano Banana via AI Studio) when the
    user has an AI Studio key configured.
    """

# Imagen 3 blocks photoreal generation of anyone reading as a minor.
# Even with the IMAGEN SAFETY rule in the LLM prompt template
# (baru_pixelle/prompts/image_generation.py), the LLM occasionally lets
# a "child" / "daughter" / "son" slip through. Belt-and-suspenders:
# scrub those tokens client-side before they ever hit /api/imagen/generate.
# Same pattern Yohomin server.js applies on its end — we mirror it here
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

    Args:
        prompt: Image prompt (text-to-image) or restyle instruction
            (image-to-image when source_image is set).
        license_key: Bearer token for Yohomin. Same key Baru-YTB Thumb
            Studio uses.
        base_url: Yohomin origin. Default ``https://yohomin.com`` —
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
        f"🎨 Imagen via Yohomin: {url} (aspect={aspect_ratio}, "
        f"mode={'edit' if source_image else 'generate'})"
    )

    async with httpx.AsyncClient(timeout=_DEFAULT_TIMEOUT_S) as client:
        r = await client.post(url, json=body, headers=headers)

    if r.status_code >= 400:
        try:
            err = (r.json() or {}).get("error") or r.text[:300]
        except Exception:
            err = r.text[:300]
        # Vertex AI's quota signal — "Quota exceeded for
        # aiplatform.googleapis.com/online_prediction_requests_per_base_model"
        # — surfaces as a 500 with that message in ``error``. Surface as
        # a typed exception so MediaService can route to Gemini direct.
        if "quota" in err.lower() or "rate" in err.lower():
            raise ImagenQuotaExceeded(
                f"Yohomin /api/imagen/generate {r.status_code}: {err}"
            )
        raise RuntimeError(f"Yohomin /api/imagen/generate {r.status_code}: {err}")

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
        output_path = str(Path("output") / f"{uuid.uuid4().hex}.{ext}")
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(image_bytes)

    logger.info(
        f"✅ Imagen saved: {output_path} ({len(image_bytes) // 1024} KB, "
        f"model={data.get('model', '?')})"
    )
    return MediaResult(media_type="image", url=output_path)
