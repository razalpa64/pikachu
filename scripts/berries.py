"""Berry Catch sprites: knock the white background out, trim, re-encode.

The generator paints on flat white. A naive "every white pixel becomes
transparent" pass eats the highlights *inside* the fruit and leaves a halo on the
edge. So this floods in from the border only, and gives the boundary a one-pixel
soft alpha so the sprite does not get a white fringe when the canvas paints it
over cream paper.

Masters live in art-src/berry/ (outside public/, so a deploy does not carry them).
"""
from collections import deque
from PIL import Image
import os

SRC = 'art-src/berry'
OUT = 'public/art/berry'
os.makedirs(OUT, exist_ok=True)

# name, output height in px, white threshold
SPRITES = [
    ('berry.png',      128, 236),
    ('berry-rot.png',  128, 236),
    ('basket.png',     190, 240),
]


def knock_out(im: Image.Image, threshold: int) -> Image.Image:
    im = im.convert('RGBA')
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    q = deque()

    def white(x: int, y: int) -> bool:
        r, g, b, _ = px[x, y]
        return r >= threshold and g >= threshold and b >= threshold

    for x in range(w):
        for y in (0, h - 1):
            if white(x, y) and not seen[y * w + x]:
                seen[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if white(x, y) and not seen[y * w + x]:
                seen[y * w + x] = 1
                q.append((x, y))

    while q:
        x, y = q.popleft()
        px[x, y] = (255, 255, 255, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and white(nx, ny):
                seen[ny * w + nx] = 1
                q.append((nx, ny))

    edge = []
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] == 0:
                    edge.append((x, y))
                    break
    for x, y in edge:
        r, g, b, a = px[x, y]
        px[x, y] = (r, g, b, 150)

    return im.crop(im.getbbox())


for name, height, threshold in SPRITES:
    im = Image.open(f'{SRC}/{name}')
    cut = knock_out(im, threshold)
    w, h = cut.size
    width = round(w * height / h)
    cut = cut.resize((width, height), Image.LANCZOS)
    out = f'{OUT}/{name.replace(".png", ".webp")}'
    cut.save(out, 'WEBP', quality=88, method=6)
    print(f'{out}  {width}x{height}  {os.path.getsize(out) // 1024} KB  alpha=on')
