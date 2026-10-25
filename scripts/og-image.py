#!/usr/bin/env python3
"""
Generates the share card and app icons in public/og/.

Not wired into `npm run build` on purpose: the output is committed, it changes
about once a year, and CI should not need Pillow. Re-run it by hand after a
visual change (`python3 scripts/og-image.py`).

Needs Pillow and two variable fonts (the same faces the site ships):
    pip install pillow
    # Baloo 2 + Quicksand, OFL, from github.com/google/fonts
    FONT_DIR=/path/with/Baloo2.ttf/and/Quicksand.ttf python3 scripts/og-image.py

The card is drawn from the site's own tokens — cream paper #fff8ec, butter
#ffd24d, cocoa #6b4b3e, blush #ffd6e2, mint #d6f3e7 — plus three covers from
/art/game, so a shared link looks like the arcade rather than like a template.
"""
from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "og")
FONT_DIR = os.environ.get("FONT_DIR", "/tmp")

CREAM = (255, 248, 236)
BUTTER = (255, 210, 77)
COCOA = (107, 75, 62)
INK = (92, 64, 53)
MUTED = (116, 86, 74)
FAINT = (138, 107, 91)

W, H = 1200, 630


def font(name: str, size: int, weight: int) -> ImageFont.FreeTypeFont:
    path = os.path.join(FONT_DIR, name)
    if not os.path.exists(path):
        sys.exit(f"missing {path} — pass FONT_DIR=/dir with Baloo2.ttf and Quicksand.ttf")
    f = ImageFont.truetype(path, size)
    try:
        f.set_variation_by_axes([weight])
    except Exception:
        pass
    return f


def glow(im: Image.Image, cx: int, cy: int, r: int, tint: tuple[int, int, int], alpha: int) -> None:
    """A soft radial wash of colour over the paper (the page's own CSS wash)."""
    g = Image.radial_gradient("L").resize((2 * r, 2 * r), Image.BICUBIC)
    g = g.point(lambda v: int((255 - v) * alpha / 255))
    layer = Image.new("RGBA", (2 * r, 2 * r), tint + (255,))
    layer.putalpha(g)
    im.paste(layer, (cx - r, cy - r), layer)


def share_card() -> None:
    im = Image.new("RGB", (W, H), CREAM).convert("RGBA")
    glow(im, 120, 80, 420, (255, 214, 226), 150)
    glow(im, 1120, 60, 380, (255, 233, 170), 170)
    glow(im, 1000, 650, 420, (214, 243, 231), 90)

    dots = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dd = ImageDraw.Draw(dots)
    for y in range(0, H, 22):
        for x in range(0, W, 22):
            dd.ellipse((x, y, x + 2.6, y + 2.6), fill=(201, 168, 136, 42))
    im.alpha_composite(dots)

    d = ImageDraw.Draw(im)
    d.text((76, 118), "AN ARCADE FOR TWO", font=font("Quicksand.ttf", 21, 700), fill=FAINT)

    word = font("Baloo2.ttf", 138, 800)
    d.text((76, 155), "PIKACHU", font=word, fill=COCOA, stroke_width=9, stroke_fill=COCOA)
    d.text((76, 146), "PIKACHU", font=word, fill=BUTTER, stroke_width=9, stroke_fill=COCOA)

    d.text((80, 330), "20 free browser games for two.", font=font("Quicksand.ttf", 34, 700), fill=INK)
    d.text((80, 378), "Private rooms · five-letter code · play from anywhere",
           font=font("Quicksand.ttf", 22, 600), fill=MUTED)

    x = 80
    for label, bg, fg in (("Chess", (255, 248, 221), (150, 99, 12)),
                          ("Battleship", (234, 246, 255), (42, 114, 175)),
                          ("Wild Eights", (255, 240, 244), (154, 43, 67))):
        f = font("Quicksand.ttf", 19, 700)
        tw = d.textlength(label, font=f)
        box = (x, 452, x + tw + 34, 498)
        d.rounded_rectangle(box, radius=23, fill=bg, outline=(201, 168, 136), width=2)
        d.text((x + 17, 459), label, font=f, fill=fg)
        x = box[2] + 12

    d.text((80, 560), "pikachu-bay.vercel.app", font=font("Quicksand.ttf", 20, 600), fill=FAINT)

    covers = (("chess.webp", -14, 760, 150), ("cards.webp", 0, 886, 126), ("reversi.webp", 14, 1006, 150))
    for name, angle, cx, cy in covers:
        art = Image.open(os.path.join(ROOT, "public", "art", "game", name)).convert("RGB")
        art = art.resize((246, 246), Image.LANCZOS)
        frame = Image.new("RGB", (258, 258), (255, 253, 247))
        frame.paste(art, (6, 6))
        mask = Image.new("L", (258, 258), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, 257, 257), radius=26, fill=255)
        frame = frame.rotate(angle, expand=True, resample=Image.BICUBIC)
        mask = mask.rotate(angle, expand=True, resample=Image.BICUBIC)

        sticker = Image.new("RGBA", frame.size, (0, 0, 0, 0))
        sticker.paste(frame, (0, 0), mask)
        shadow = Image.new("RGBA", frame.size, (120, 80, 55, 0))
        shadow.putalpha(sticker.split()[3].point(lambda a: int(a * 0.26)))
        im.paste(shadow, (cx + 6, cy + 16), shadow)
        im.paste(sticker, (cx, cy), mask)

    im.convert("RGB").save(os.path.join(OUT, "pikachu-og.png"), optimize=True)
    print("wrote pikachu-og.png 1200x630")


def bolt_tile(size: int, radius_ratio: float, pad_ratio: float) -> Image.Image:
    """The header mark: butter rounded square, cocoa outline, cocoa lightning."""
    s = size * 4  # draw big, downsample for clean edges
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    pad = s * 0.02
    r = s * radius_ratio
    d.rounded_rectangle((pad, pad, s - pad, s - pad), radius=r, fill=(255, 217, 90), outline=COCOA, width=int(s * 0.06))

    # the bolt from the logo's 14x18 path, centred on its own bounding box so it
    # sits optically in the middle of the tile rather than at the path's origin
    inner = s * (1 - 2 * pad_ratio) * 0.92
    pts = [(8, 0), (0, 10), (5, 10), (4, 18), (14, 7), (8.5, 7)]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    k = inner / max(max(xs) - min(xs), max(ys) - min(ys))
    cx = (max(xs) + min(xs)) / 2
    cy = (max(ys) + min(ys)) / 2
    d.polygon([(s / 2 + (px - cx) * k, s / 2 + (py - cy) * k) for px, py in pts], fill=COCOA)
    return im.resize((size, size), Image.LANCZOS)


def icons() -> None:
    # "any" purpose: rounded tile on transparency
    for size in (192, 512):
        bolt_tile(size, 0.24, 0.20).save(os.path.join(OUT, f"icon-{size}.png"), optimize=True)
    # maskable: full bleed, mark inside the 80% safe circle
    m = Image.new("RGBA", (512, 512), (255, 248, 236, 255))
    m.alpha_composite(bolt_tile(320, 0.26, 0.22), (96, 96))
    m.save(os.path.join(OUT, "icon-maskable-512.png"), optimize=True)
    # iOS ignores transparency and rounds the corners itself
    a = Image.new("RGB", (180, 180), CREAM)
    a.paste(bolt_tile(180, 0.24, 0.20), (0, 0), bolt_tile(180, 0.24, 0.20))
    a.save(os.path.join(OUT, "apple-touch-icon.png"), optimize=True)
    print("wrote icon-192/512, icon-maskable-512, apple-touch-icon")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    share_card()
    icons()
