#!/usr/bin/env python3
"""Generate the PWA app icons from the bpad glyph.

The glyph (open book + padlock + bookmark) mirrors ``public/favicon.svg``. It is
rendered on a fully transparent background and bled to the tile edges — the book's
top corners touch the left/right edges, no margin — so the icon reads as large as
possible next to other apps.

We emit ``icon-192.png`` / ``icon-512.png``; the manifest uses the 512 for both
``any`` and ``maskable`` (the lock + keyhole stay well inside the maskable safe
zone, so a mask only ever clips the outer page corners).

Run: ``python3 scripts/generate-icons.py`` (needs Pillow). Output goes to
``public/``. Keep this in sync with ``favicon.svg``.
"""

import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "public")

LEFT_PAGE = (58, 99, 176)  # #3A63B0
RIGHT_PAGE = (39, 75, 144)  # #274B90
BOOKMARK = (34, 177, 131)  # #22B183
WHITE = (255, 255, 255)
KEYHOLE = (27, 142, 105)   # #1B8E69

# Glyph geometry in a 0..48 art box (matches favicon.svg, offset by its 8/13
# viewBox origin). Content spans x[4..44] y[4..43], centred on (24, 23.5).
ART_CX, ART_CY = 24.0, 23.5
ART_W = 40.0  # reference span used for the fill fraction

SS = 4  # supersampling factor for anti-aliasing


def render(size: int, fill: float) -> Image.Image:
    """Render the glyph on a transparent background at ``size`` px.

    ``fill`` is the fraction of the tile width the glyph's bounding box spans;
    ``fill = 1.0`` bleeds the book's top corners to the left/right edges.
    """
    T = size * SS
    scale = fill * T / ART_W
    img = Image.new("RGBA", (T, T), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def P(x, y):
        return (T / 2 + (x - ART_CX) * scale, T / 2 + (y - ART_CY) * scale)

    # Open book: two pages meeting at the spine.
    d.polygon([P(4, 4), P(24, 8), P(24, 36), P(4, 31)], fill=LEFT_PAGE)
    d.polygon([P(44, 4), P(24, 8), P(24, 36), P(44, 31)], fill=RIGHT_PAGE)
    # Bookmark tab.
    d.polygon([P(19, 34), P(29, 34), P(24, 43)], fill=BOOKMARK)

    # Padlock shackle: top semicircle + two legs, tucked behind the body.
    stroke = 3 * scale
    sx0, sy0 = P(18, 9.6)
    sx1, sy1 = P(30, 21.6)
    d.arc([sx0, sy0, sx1, sy1], 180, 360, fill=WHITE, width=int(round(stroke)))
    d.line([P(18, 15.6), P(18, 18)], fill=WHITE, width=int(round(stroke)))
    d.line([P(30, 15.6), P(30, 18)], fill=WHITE, width=int(round(stroke)))

    # Padlock body.
    d.rounded_rectangle([P(15.5, 18), P(32.5, 32)], radius=2.6 * scale, fill=WHITE)

    # Keyhole.
    kx, ky = P(24, 24)
    r = 2 * scale
    d.ellipse([kx - r, ky - r, kx + r, ky + r], fill=KEYHOLE)
    d.rounded_rectangle([P(23, 24.4), P(25, 29.4)], radius=1 * scale, fill=KEYHOLE)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    render(192, 1.0).save(os.path.join(OUT, "icon-192.png"))
    render(512, 1.0).save(os.path.join(OUT, "icon-512.png"))
    print("wrote icon-192.png, icon-512.png")


if __name__ == "__main__":
    main()
