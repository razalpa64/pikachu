"""Memory Match card faces + the Truth-or-Dare bottle.

The generator returns a wide RGB canvas with a pure-white field. We knock that
field out with a flood fill seeded from the border — a global "is this pixel
white?" test also erases white *inside* the subject (highlights, the cork, the
glint on the glass), which is exactly the bug that ate earlier sprites.

Output is a square RGBA WebP so every card centres identically on its tile and
the bottle rotates around its own middle.
"""
from PIL import Image
from collections import deque
import os
import sys

MEM_SRC = 'art-src/mem'
MEM_OUT = 'public/art/mem'
CARDS = ['bolt', 'cheek', 'tail', 'berry', 'coil', 'star', 'orb', 'leaf', 'cloud',
         'gear', 'feather', 'ember', 'moon', 'shell', 'crown', 'ball', 'rune', 'prism']


def knockout(im, tol_min=238, tol_spread=14):
    """Alpha-out the contiguous near-white region reachable from the border."""
    im = im.convert('RGBA')
    w, h = im.size
    px = im.load()

    def is_bg(x, y):
        r, g, b, a = px[x, y]
        m = min(r, g, b)
        return m > tol_min and max(r, g, b) - m < tol_spread

    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not seen[y * w + x] and is_bg(x, y):
                seen[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not seen[y * w + x] and is_bg(x, y):
                seen[y * w + x] = 1
                q.append((x, y))

    while q:
        x, y = q.popleft()
        px[x, y] = (255, 255, 255, 0)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and is_bg(nx, ny):
                seen[ny * w + nx] = 1
                q.append((nx, ny))
    return im


def square(im, size, pad_frac=0.04):
    bb = im.getbbox()
    if bb:
        im = im.crop(bb)
    side = int(max(im.size) * (1 + pad_frac * 2))
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
    return sq.resize((size, size), Image.LANCZOS)


def run(name, src, out, size):
    if not os.path.exists(src):
        return None
    im = square(knockout(Image.open(src)), size)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    im.save(out, format='WEBP', quality=92, method=6)
    print(f'{name:10} {size}x{size}  {os.path.getsize(out) // 1024} KB')
    return im


if __name__ == '__main__':
    only = sys.argv[1:] or None
    made = []
    for c in CARDS:
        if only and c not in only:
            continue
        if run(c, f'{MEM_SRC}/{c}.png', f'{MEM_OUT}/{c}.webp', 256):
            made.append(c)
    if not only or 'bottle' in (only or []):
        run('bottle', 'art-src/bottle.png', 'public/art/dare/bottle.webp', 512)
    missing = [c for c in CARDS if not os.path.exists(f'{MEM_OUT}/{c}.webp')]
    print(f'\ncards on disk: {len(CARDS) - len(missing)}/{len(CARDS)}')
    if missing:
        print('still to generate:', ', '.join(missing))
