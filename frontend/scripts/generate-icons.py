#!/usr/bin/env python3
"""Generate the app icons from the bpad artwork.

``icon-master.png`` is the source of truth: the book + padlock + bookmark glyph
on a fully transparent background (its dark backdrop already removed), cropped to
the artwork. This script emits two families of icons:

* ``icon-192.png`` / ``icon-512.png`` / ``favicon.png`` — ``purpose: any``.
  Transparent tiles with the artwork bled to the edges. Browsers draw these as-is.

* ``icon-maskable-192.png`` / ``icon-maskable-512.png`` — ``purpose: maskable``.
  Android crops these to a launcher-chosen shape (circle, squircle, teardrop) and
  only guarantees the centred circle of 80% diameter, so the artwork is scaled to
  fit inside that safe zone and sits on an opaque background. A bled tile would
  lose its outer book wings and the bookmark tip.

The two purposes need separate files: an ``any`` icon wants to fill the tile, a
``maskable`` one must leave the margin the launcher eats. Declaring one file as
``any maskable`` gets the ``any`` case right and the Android case cropped.

Run: ``python3 scripts/generate-icons.py`` (needs Pillow), then
``python3 scripts/check-icons.py`` after a build to verify. To change the
artwork, replace ``icon-master.png`` and re-run.
"""

import math
import os

from PIL import Image

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "..", "public")
MASTER = os.path.join(HERE, "icon-master.png")

# Fraction of the icon's width spanned by the maskable safe-zone circle, less a
# little headroom for resampling: the artwork must stay inside this radius.
SAFE_ZONE_RADIUS = 0.385
# Opaque backdrop for the maskable tiles; matches the manifest background_color.
BACKDROP = (0x0E, 0x15, 0x24, 255)

# (filename, size) tiles bled to the edges, for `purpose: any`.
TILES = [
    ("icon-192.png", 192),
    ("icon-512.png", 512),
    ("favicon.png", 64),
]

# (filename, size) tiles fitted to the safe zone, for `purpose: maskable`.
MASKABLE_TILES = [
    ("icon-maskable-192.png", 192),
    ("icon-maskable-512.png", 512),
]


def fit(master: Image.Image, size: int) -> Image.Image:
    """Scale the artwork, without distortion, to fill a ``size`` square tile."""
    aw, ah = master.size
    scale = size / max(aw, ah)
    return master.resize((round(aw * scale), round(ah * scale)), Image.LANCZOS)


def centre(art: Image.Image, canvas: Image.Image) -> Image.Image:
    w, h = canvas.size
    nw, nh = art.size
    canvas.alpha_composite(art, ((w - nw) // 2, (h - nh) // 2))
    return canvas


def tile(master: Image.Image, size: int) -> Image.Image:
    """Artwork bled to the edges of a transparent tile."""
    return centre(fit(master, size), Image.new("RGBA", (size, size), (0, 0, 0, 0)))


def opaque_reach(img: Image.Image) -> float:
    """Max distance of any opaque pixel from the tile centre, in pixels."""
    alpha = img.split()[3].load()
    w, h = img.size
    cx, cy = w / 2, h / 2
    reach = 0.0
    for y in range(h):
        for x in range(w):
            if alpha[x, y] > 8:
                reach = max(reach, math.hypot(x + 0.5 - cx, y + 0.5 - cy))
    return reach


def maskable_tile(master: Image.Image, size: int) -> Image.Image:
    """Artwork shrunk into the safe-zone circle, on an opaque backdrop.

    The artwork fills the square's corners, so its reach is measured from the
    real pixels rather than assumed from the bounding box -- a glyph with soft
    corners earns a larger scale than one that squares them off.
    """
    bled = tile(master, size)
    shrink = (SAFE_ZONE_RADIUS * size) / opaque_reach(bled)
    art = fit(master, round(size * shrink))
    return centre(art, Image.new("RGBA", (size, size), BACKDROP))


def main() -> None:
    master = Image.open(MASTER).convert("RGBA")
    written = []
    for name, size in TILES:
        tile(master, size).save(os.path.join(OUT, name))
        written.append(name)
    for name, size in MASKABLE_TILES:
        maskable_tile(master, size).save(os.path.join(OUT, name))
        written.append(name)
    print("wrote", ", ".join(written))


if __name__ == "__main__":
    main()
