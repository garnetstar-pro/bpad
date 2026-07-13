#!/usr/bin/env python3
"""Generate the app icons from the bpad artwork.

``icon-master.png`` is the source of truth: the book + padlock + bookmark glyph
on a fully transparent background (its dark backdrop already removed), cropped to
the artwork. This script scales it, without distortion, into square transparent
tiles bled to the edges:

* ``public/icon-192.png`` / ``public/icon-512.png`` — PWA / home-screen icons.
* ``public/favicon.png`` — browser-tab icon.

Run: ``python3 scripts/generate-icons.py`` (needs Pillow). To change the artwork,
replace ``icon-master.png`` and re-run.
"""

import os
from PIL import Image

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "..", "public")
MASTER = os.path.join(HERE, "icon-master.png")

# (filename, size) tiles to emit.
TILES = [
    ("icon-192.png", 192),
    ("icon-512.png", 512),
    ("favicon.png", 64),
]


def tile(master: Image.Image, size: int) -> Image.Image:
    """Fit the artwork into a ``size`` square transparent tile, centred."""
    aw, ah = master.size
    scale = size / max(aw, ah)
    nw, nh = round(aw * scale), round(ah * scale)
    art = master.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(art, ((size - nw) // 2, (size - nh) // 2))
    return canvas


def main() -> None:
    master = Image.open(MASTER).convert("RGBA")
    for name, size in TILES:
        tile(master, size).save(os.path.join(OUT, name))
    print("wrote", ", ".join(name for name, _ in TILES))


if __name__ == "__main__":
    main()
