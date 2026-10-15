#!/usr/bin/env python3
"""
Detective Pikachu scene clip for the mystery game.

The source is a 896x500 loop of Pikachu raising a magnifying glass to his eye.
The background is a dark, cluttered shop interior, so a background knockout is
hopeless — a border-seeded flood fill has nothing flat to grab. Instead the crop
goes tight on the character and a vignette rolls the edges down to black, which
turns the clutter into a noir surround. That suits a detective game better than
a cut-out would, and it is the one place in this site where a dark panel is the
right answer.
"""
from PIL import Image, ImageEnhance
import numpy as np, os

SRC = '/home/user/image-search/detective-pikachu-hat-magnifying-glass-c-3.gif'
OUT = 'public/art/pika/detective.webp'
CROP = (142, 8, 472, 498)      # tight portrait on the character
W = 300                        # final width

im = Image.open(SRC)
frames, durs = [], []
i = 0
try:
    while True:
        im.seek(i)
        f = im.convert('RGB').crop(CROP)
        h = round(f.height * W / f.width)
        f = f.resize((W, h), Image.LANCZOS)
        frames.append(f)
        durs.append(im.info.get('duration', 60))
        i += 1
except EOFError:
    pass

w, h = frames[0].size
# radial vignette: 1.0 in the middle, rolling to ~0.18 at the corners
yy, xx = np.mgrid[0:h, 0:w]
cx, cy = w / 2, h * 0.46
r = np.sqrt(((xx - cx) / (w * 0.62)) ** 2 + ((yy - cy) / (h * 0.60)) ** 2)
mask = np.clip(1.22 - 0.95 * np.clip(r, 0, 1.6) ** 1.7, 0.16, 1.0)[..., None]

out = []
for f in frames:
    a = np.array(f).astype(np.float32) * mask
    g = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    g = ImageEnhance.Color(g).enhance(1.18)      # the rip is a little washed out
    g = ImageEnhance.Contrast(g).enhance(1.06)
    out.append(g)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
# 35 frames of a slow raise/lower is more than the eye needs; every second
# frame at double duration looks identical and halves the payload
keep = out[::2]
kd = [durs[i] + durs[i + 1] if i + 1 < len(durs) else durs[i] for i in range(0, len(out), 2)]
keep[0].save(OUT, 'WEBP', save_all=True, append_images=keep[1:],
             duration=kd, loop=0, quality=64, method=6)
out = keep
print(f'{len(out)} frames  {w}x{h}  {os.path.getsize(OUT)/1024:.0f} KB  -> {OUT}')
