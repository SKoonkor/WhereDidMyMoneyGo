"""Generate the app icon assets from a single drawn source.

Produces (next to this file):
  * ``icon.png``  — 1024×1024 master, used for the Linux/tray icon
  * ``icon.ico``  — multi-size Windows icon
  * ``icon.icns`` — macOS icon (via ``iconutil`` when available, else Pillow)

The artwork is a simple rounded-square coin with a "฿"/"$" glyph in the app's
teal accent. It's intentionally plain — replace ``icon.png`` (or tweak here)
with real branding any time and re-run:  ``python packaging/make_icon.py``.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ACCENT = (26, 188, 156, 255)      # #1abc9c — app accent
ACCENT_DK = (17, 122, 101, 255)   # deeper teal for the gradient bottom
GLYPH = "$"


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for name in ("Arial Bold.ttf", "Helvetica.ttc", "DejaVuSans-Bold.ttf", "Arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _master(px: int = 1024) -> Image.Image:
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Vertical teal gradient background painted into a rounded-square mask.
    grad = Image.new("RGBA", (px, px))
    gp = grad.load()
    for y in range(px):
        t = y / (px - 1)
        gp_row = tuple(round(ACCENT[i] * (1 - t) + ACCENT_DK[i] * t) for i in range(4))
        for x in range(px):
            gp[x, y] = gp_row
    mask = Image.new("L", (px, px), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, px - 1, px - 1], radius=int(px * 0.22), fill=255)
    img.paste(grad, (0, 0), mask)

    # Centered currency glyph.
    font = _font(int(px * 0.6))
    box = draw.textbbox((0, 0), GLYPH, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    draw.text(((px - w) / 2 - box[0], (px - h) / 2 - box[1]), GLYPH,
              font=font, fill=(255, 255, 255, 255))
    return img


def _write_icns(master: Image.Image, out: Path) -> None:
    """macOS .icns via iconutil (preferred) with a Pillow fallback."""
    try:
        with tempfile.TemporaryDirectory() as td:
            iconset = Path(td) / "icon.iconset"
            iconset.mkdir()
            for size in (16, 32, 64, 128, 256, 512):
                master.resize((size, size), Image.LANCZOS).save(
                    iconset / f"icon_{size}x{size}.png")
                master.resize((size * 2, size * 2), Image.LANCZOS).save(
                    iconset / f"icon_{size}x{size}@2x.png")
            subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(out)],
                           check=True, capture_output=True)
            return
    except Exception:
        pass
    master.save(out, format="ICNS")  # Pillow fallback (Pillow ≥ 9 supports write)


def main() -> int:
    master = _master(1024)
    master.save(HERE / "icon.png")
    master.save(HERE / "icon.ico",
                sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    _write_icns(master, HERE / "icon.icns")
    print("wrote", ", ".join(p.name for p in (
        HERE / "icon.png", HERE / "icon.ico", HERE / "icon.icns")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
