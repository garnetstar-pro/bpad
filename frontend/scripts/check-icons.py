#!/usr/bin/env python3
"""Validate the icons declared in the built PWA manifest.

Run after ``npm run build``: ``python3 scripts/check-icons.py``

The check that matters is ``maskable``. Android composites a maskable icon on an
opaque background and then crops it to a launcher-chosen shape (circle, squircle,
teardrop...). Only the centred circle of 80% diameter -- the "safe zone" -- is
guaranteed to survive; anything outside it may be cut. Desktop browsers do not
mask, so a too-large maskable icon looks correct everywhere except on a phone.
"""

import json
import math
import os
import sys

from PIL import Image

HERE = os.path.dirname(__file__)
DIST = os.path.join(HERE, "..", "dist")
MANIFEST = os.path.join(DIST, "manifest.webmanifest")

# Fraction of the icon's width spanned by the maskable safe-zone circle.
SAFE_ZONE_DIAMETER = 0.8
ALPHA_THRESHOLD = 8
# RGB distance past which a pixel counts as artwork rather than backdrop.
COLOR_THRESHOLD = 10


def content_reach(img: Image.Image) -> float:
    """Max distance of any artwork pixel from the centre, as a fraction of width.

    A correct maskable icon is opaque edge to edge, so alpha cannot separate the
    artwork from its backdrop -- the backdrop colour does. It is read from the
    corners, which the safe zone never covers and artwork should never reach.
    """
    px = img.convert("RGB").load()
    w, h = img.size
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    if len(set(corners)) != 1:
        raise ValueError(f"corners disagree ({corners}) -- cannot identify the backdrop")
    br, bg_, bb = corners[0]

    cx, cy = w / 2, h / 2
    reach = 0.0
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if math.dist((r, g, b), (br, bg_, bb)) > COLOR_THRESHOLD:
                reach = max(reach, math.hypot(x + 0.5 - cx, y + 0.5 - cy))
    return reach / w


def transparent_fraction(img: Image.Image) -> float:
    alpha = img.split()[3].getdata()
    return sum(1 for a in alpha if a <= ALPHA_THRESHOLD) / len(alpha)


def main() -> int:
    if not os.path.exists(MANIFEST):
        print("no manifest at dist/ -- run `npm run build` first", file=sys.stderr)
        return 2

    with open(MANIFEST) as fh:
        icons = json.load(fh)["icons"]

    errors = []
    for icon in icons:
        src = icon["src"]
        purposes = icon.get("purpose", "any").split()
        path = os.path.join(DIST, src.lstrip("/"))
        if not os.path.exists(path):
            errors.append(f"{src}: declared in manifest but missing from dist/")
            continue

        img = Image.open(path).convert("RGBA")
        declared = icon.get("sizes", "")
        actual = f"{img.size[0]}x{img.size[1]}"
        if declared != actual:
            errors.append(f"{src}: declared {declared} but file is {actual}")

        if "maskable" not in purposes:
            print(f"ok   {src:24} purpose={' '.join(purposes):8} (unmasked, no safe zone needed)")
            continue

        # Opacity is checked first: the reach measurement reads the backdrop
        # colour from the corners, which only means anything on an opaque tile.
        transparent = transparent_fraction(img)
        if transparent > 0.01:
            errors.append(
                f"{src}: maskable, but {transparent * 100:.0f}% transparent -- a maskable "
                f"icon must be opaque edge to edge, or the launcher fills the gaps"
            )
            continue

        limit = SAFE_ZONE_DIAMETER / 2
        reach = content_reach(img)
        if reach > limit:
            errors.append(
                f"{src}: maskable, but artwork reaches {reach:.3f}x width from centre "
                f"(safe zone allows {limit:.3f}) -- {reach / limit:.2f}x too large, "
                f"Android will crop it"
            )
        else:
            print(f"ok   {src:24} purpose={' '.join(purposes):8} reach={reach:.3f} (safe zone {limit:.3f})")

    if errors:
        print("\nFAIL", file=sys.stderr)
        for e in errors:
            print("  - " + e, file=sys.stderr)
        return 1

    print("\nall icons ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
