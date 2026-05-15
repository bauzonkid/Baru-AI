"""Convert a Gemini/Midjourney-style logo PNG (rounded-square icon on
white canvas with drop shadow) into clean Electron app icons.

Pipeline:
  1. Detect the icon body bbox by finding dark (icon-body) pixels.
     The drop shadow is gray, NOT dark, so it doesn't contaminate the
     bbox.
  2. Draw a rounded-rectangle alpha mask matching that bbox with a
     corner radius proportional to the side (matches the source's
     squircle look).
  3. Composite the original image onto a transparent canvas using
     that mask — every pixel outside the rounded rect (including
     the soft drop shadow) becomes transparent.
  4. Resample to 1024x1024 for icon.png.
  5. Generate a multi-size icon.ico (16, 24, 32, 48, 64, 128, 256).

Usage:
  python electron/scripts/render_icon.py <source.png>

Outputs:
  electron/build/icon.png  (1024x1024, transparent background)
  electron/build/icon.ico  (multi-size Windows icon)
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


REPO = Path(__file__).resolve().parents[2]
OUT_PNG = REPO / "electron" / "build" / "icon.png"
OUT_ICO = REPO / "electron" / "build" / "icon.ico"

# Pixels darker than this are considered "icon body" (dark-gray
# rounded square + red B). Drop shadow is brighter than 130 even at
# its darkest, so this stays clear of it.
DARK_THRESHOLD = 130

# Corner radius as fraction of icon side. The Gemini source uses a
# typical iOS squircle ~18% radius. Tweak if a different image style
# is used.
CORNER_RADIUS_FRAC = 0.18


def detect_icon_bbox(img: Image.Image) -> tuple[int, int, int, int]:
    """Return tight bbox of the icon body (dark pixels)."""
    gray = img.convert("L")
    mask_dark = gray.point(lambda x: 255 if x < DARK_THRESHOLD else 0, mode="1")
    bbox = mask_dark.getbbox()
    if bbox is None:
        raise RuntimeError(
            "No dark pixels found — DARK_THRESHOLD too low or image inverted."
        )
    return bbox


def make_rounded_rect_mask(
    size: tuple[int, int],
    radius: int,
    supersample: int = 4,
) -> Image.Image:
    """Anti-aliased rounded-rect alpha mask matching the icon shape.

    Supersampled (4x) and downsampled with LANCZOS so the corner
    arcs are smooth at the icon's final resolution.
    """
    w, h = size
    big = (w * supersample, h * supersample)
    mask = Image.new("L", big, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        [(0, 0), (big[0] - 1, big[1] - 1)],
        radius=radius * supersample,
        fill=255,
    )
    return mask.resize(size, Image.LANCZOS)


def main() -> None:
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <source.png>", file=sys.stderr)
        sys.exit(2)

    src = Path(sys.argv[1])
    if not src.exists():
        print(f"Source not found: {src}", file=sys.stderr)
        sys.exit(1)

    img = Image.open(src).convert("RGBA")
    print(f"  Loaded {src} ({img.size[0]}x{img.size[1]} {img.mode})")

    bbox = detect_icon_bbox(img)
    bx0, by0, bx1, by1 = bbox
    bw, bh = bx1 - bx0, by1 - by0
    print(f"  Detected icon body bbox: ({bx0},{by0})-({bx1},{by1}) size {bw}x{bh}")

    # Square the bbox by expanding the shorter side symmetrically.
    side = max(bw, bh)
    cx = (bx0 + bx1) // 2
    cy = (by0 + by1) // 2
    half = side // 2
    # Tiny outward pad (1%) so the mask doesn't clip anti-aliased icon edges.
    pad = int(side * 0.01)
    x0 = max(0, cx - half - pad)
    y0 = max(0, cy - half - pad)
    x1 = min(img.size[0], cx + half + pad)
    y1 = min(img.size[1], cy + half + pad)
    side = min(x1 - x0, y1 - y0)
    cropped = img.crop((x0, y0, x0 + side, y0 + side))
    print(f"  Squared crop: {side}x{side}")

    radius = int(side * CORNER_RADIUS_FRAC)
    mask = make_rounded_rect_mask((side, side), radius)

    # Apply mask: pixels outside rounded rect become transparent. Use the
    # mask directly as alpha; respects the icon body's existing alpha
    # which is full-opaque inside the rounded rect.
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.paste(cropped, (0, 0), mask=mask)

    # Final: resample to 1024x1024 (canonical icon size).
    icon_1024 = out.resize((1024, 1024), Image.LANCZOS)

    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    icon_1024.save(OUT_PNG, format="PNG", optimize=True)
    print(f"  Wrote {OUT_PNG} ({OUT_PNG.stat().st_size // 1024} KB)")

    sizes = [(16, 16), (24, 24), (32, 32), (48, 48),
             (64, 64), (128, 128), (256, 256)]
    icon_1024.save(OUT_ICO, format="ICO", sizes=sizes)
    print(f"  Wrote {OUT_ICO} ({OUT_ICO.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
