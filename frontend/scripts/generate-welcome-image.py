#!/usr/bin/env python3
"""Generate the illustration embedded in the welcome note.

The picture states bpad's core claim in one frame: the note as you wrote it on
the left, the ciphertext the server actually stores on the right, the browser's
encryption between them. New accounts get it uploaded as a real note image at
registration (see ``AuthGate.tsx``), so it doubles as proof that pictures work.

Drawn with Pillow rather than an SVG toolchain because Pillow is already the
project's image dependency (``generate-icons.py``) and the CI box has no SVG
renderer. Everything is drawn at ``SCALE``× and downsampled with LANCZOS —
that is what keeps the circles and the type free of jaggies.

Palette and type sizes mirror the app's own tokens in ``App.css`` so the
illustration reads as part of the UI rather than a foreign asset.

Run: ``python3 scripts/generate-welcome-image.py`` (needs Pillow).
Output: ``src/assets/welcome-encryption.webp``.
"""

import os

from PIL import Image, ImageDraw, ImageFont

# --- Canvas -----------------------------------------------------------------
# Type is sized generously against the canvas on purpose: a note column is only
# ~700 CSS px wide, so anything set smaller renders below the app's own body
# text. The lightbox covers the phone case, where a two-column diagram cannot
# be legible inline whatever the type size.
W, H = 1400, 560
SCALE = 3

# --- Palette (App.css tokens) ----------------------------------------------
GROUND = (14, 21, 36)
SURFACE = (23, 33, 54)
SURFACE_HOVER = (31, 44, 70)
INK = (238, 242, 250)
INK_DIM = (139, 152, 180)
ACCENT = (34, 177, 131)
# --hairline over each of the two backgrounds it is used on, flattened.
HAIRLINE_ON_GROUND = (34, 41, 55)
HAIRLINE_ON_SURFACE = (42, 51, 70)
# The connectors cross the dark ground, where a hairline would vanish.
CONNECTOR = (62, 76, 102)

FONT_DIR = "/usr/share/fonts/truetype/dejavu"
F_REGULAR = os.path.join(FONT_DIR, "DejaVuSans.ttf")
F_BOLD = os.path.join(FONT_DIR, "DejaVuSans-Bold.ttf")
F_MONO = os.path.join(FONT_DIR, "DejaVuSansMono.ttf")

OUT = os.path.join(os.path.dirname(__file__), "..", "src", "assets", "welcome-encryption.webp")


def s(v):
    """Scale a design-space value into the supersampled canvas."""
    return int(round(v * SCALE))


def font(path, size):
    return ImageFont.truetype(path, s(size))


def lerp(a, b, t):
    """Blend colour a toward b. Used to fade text into its own card."""
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def tracked_text(draw, xy, text, fnt, fill, tracking):
    """Draw text with letter-spacing — Pillow has no tracking of its own, and
    the uppercase eyebrows need it to match the app's .account-key style.
    Takes design-space coordinates like every other helper here."""
    x, y = s(xy[0]), s(xy[1])
    for ch in text:
        draw.text((x, y), ch, font=fnt, fill=fill)
        x += draw.textlength(ch, font=fnt) + s(tracking)


def card(draw, box, radius=18):
    draw.rounded_rectangle(
        [s(box[0]), s(box[1]), s(box[2]), s(box[3])],
        radius=s(radius),
        fill=SURFACE,
        outline=HAIRLINE_ON_GROUND,
        width=s(1.2),
    )


def glow(img, center, radius, colour, strength=0.16, steps=44):
    """Soft radial halo behind the lock, drawn as stacked translucent discs.
    Gives the centre of the frame some depth so it doesn't read as clip-art."""
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy = s(center[0]), s(center[1])
    for i in range(steps, 0, -1):
        r = s(radius) * i / steps
        alpha = int(255 * strength * (1 - i / steps) ** 2.2)
        if alpha <= 0:
            continue
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=colour + (alpha,))
    img.alpha_composite(layer)


def lock(draw, center, size):
    """The padlock from the bpad mark: a shut shackle over a rounded body.

    Drawn shackle-first (semicircle plus two straight legs), then the body on
    top so the legs disappear into it. Without the legs the arc floats clear of
    the body and the lock reads as *open* — the opposite of the point.
    """
    cx, cy = center
    stroke = size * 0.11

    sh_r = size * 0.26
    sh_cy = cy - size * 0.32
    draw.arc(
        [s(cx - sh_r), s(sh_cy - sh_r), s(cx + sh_r), s(sh_cy + sh_r)],
        start=180,
        end=360,
        fill=ACCENT,
        width=s(stroke),
    )
    for side in (-1, 1):
        lx = cx + side * sh_r
        draw.rectangle(
            [s(lx - stroke / 2), s(sh_cy), s(lx + stroke / 2), s(cy + size * 0.04)],
            fill=ACCENT,
        )

    body_w, body_h = size * 0.88, size * 0.62
    by0 = cy - size * 0.06
    draw.rounded_rectangle(
        [s(cx - body_w / 2), s(by0), s(cx + body_w / 2), s(by0 + body_h)],
        radius=s(size * 0.15),
        fill=ACCENT,
    )

    # Keyhole, punched in the surrounding disc's colour so it reads as a hole.
    kh_r = size * 0.085
    kcy = by0 + body_h * 0.36
    draw.ellipse(
        [s(cx - kh_r), s(kcy - kh_r), s(cx + kh_r), s(kcy + kh_r)],
        fill=SURFACE_HOVER,
    )
    draw.rounded_rectangle(
        [s(cx - kh_r * 0.55), s(kcy), s(cx + kh_r * 0.55), s(kcy + size * 0.17)],
        radius=s(kh_r * 0.55),
        fill=SURFACE_HOVER,
    )


def arrow(draw, x0, x1, y):
    """Thin connector with a small head — shows direction of travel."""
    head = 9
    draw.line([s(x0), s(y), s(x1 - head), s(y)], fill=CONNECTOR, width=s(1.6))
    draw.polygon(
        [
            (s(x1), s(y)),
            (s(x1 - head), s(y - head * 0.58)),
            (s(x1 - head), s(y + head * 0.58)),
        ],
        fill=CONNECTOR,
    )


def main():
    img = Image.new("RGBA", (W * SCALE, H * SCALE), GROUND + (255,))

    centre_x, centre_y = W / 2, 280
    glow(img, (centre_x, centre_y), 195, ACCENT)

    draw = ImageDraw.Draw(img)

    f_eyebrow = font(F_BOLD, 20)
    f_title = font(F_BOLD, 40)
    f_body = font(F_REGULAR, 30)
    f_mono = font(F_MONO, 27)
    f_caption = font(F_REGULAR, 25)
    f_meta = font(F_MONO, 21)

    # Narrower cards than the canvas allows: the gap has to be wide enough for
    # the connectors to read as arrows rather than specks.
    left = (56, 60, 580, 500)
    right = (820, 60, 1344, 500)
    card(draw, left)
    card(draw, right)

    # --- Left: the note as written -----------------------------------------
    lx = left[0] + 44
    tracked_text(draw, (lx, left[1] + 36), "WHAT YOU WRITE", f_eyebrow, INK_DIM, 2.6)
    draw.text((s(lx), s(left[1] + 78)), "Ideas", font=f_title, fill=INK)

    lines = [
        "pitch: lead with the demo",
        "salary talk — ask for 15%",
        "flights before Friday",
    ]
    y = left[1] + 160
    for line in lines:
        draw.ellipse([s(lx + 3), s(y + 14), s(lx + 12), s(y + 23)], fill=INK_DIM)
        draw.text((s(lx + 30), s(y)), line, font=f_body, fill=INK)
        y += 54

    draw.line(
        [s(lx), s(left[3] - 70), s(left[2] - 44), s(left[3] - 70)],
        fill=HAIRLINE_ON_SURFACE,
        width=s(1),
    )
    draw.text((s(lx), s(left[3] - 52)), "your device", font=f_caption, fill=INK_DIM)

    # --- Right: what the server holds --------------------------------------
    rx = right[0] + 44
    tracked_text(draw, (rx, right[1] + 36), "WHAT THE SERVER STORES", f_eyebrow, INK_DIM, 2.6)

    cipher = [
        "9f2Ak7Qm1TzB4vXcRe8Ld0",
        "PjH6yNs3Wg5UoI2ZbFtM9x",
        "0qVrE7hK4CnDaJ8lY1uSpO",
        "tG3wZ6iB9fRxQ2mLdKe5Nv",
        "A8cU4jYh1PsT7oXwM0zbEr",
    ]
    y = right[1] + 96
    for i, row in enumerate(cipher):
        # Fade the block into the card: the ciphertext runs on past the frame.
        t = (i / (len(cipher) - 1)) ** 1.5 * 0.72
        draw.text((s(rx), s(y)), row, font=f_mono, fill=lerp(INK_DIM, SURFACE, t))
        y += 50

    draw.line(
        [s(rx), s(right[3] - 70), s(right[2] - 44), s(right[3] - 70)],
        fill=HAIRLINE_ON_SURFACE,
        width=s(1),
    )
    draw.text((s(rx), s(right[3] - 52)), "AES-256-GCM", font=f_meta, fill=INK_DIM)

    # --- Middle: the encryption step ---------------------------------------
    r = 46
    arrow(draw, left[2] + 16, centre_x - r - 16, centre_y)
    arrow(draw, centre_x + r + 16, right[0] - 16, centre_y)

    draw.ellipse(
        [s(centre_x - r), s(centre_y - r), s(centre_x + r), s(centre_y + r)],
        fill=SURFACE_HOVER,
        outline=ACCENT,
        width=s(2),
    )
    lock(draw, (centre_x, centre_y), 42)

    for i, text in enumerate(("encrypted in", "your browser")):
        w = draw.textlength(text, font=f_caption)
        draw.text(
            (s(centre_x) - w / 2, s(centre_y + 76 + i * 34)),
            text,
            font=f_caption,
            fill=INK_DIM,
        )

    out = img.convert("RGB").resize((W, H), Image.LANCZOS)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    out.save(OUT, "WEBP", quality=88, method=6)
    print(f"wrote {os.path.normpath(OUT)} ({os.path.getsize(OUT) / 1024:.1f} KiB, {W}x{H})")


if __name__ == "__main__":
    main()
