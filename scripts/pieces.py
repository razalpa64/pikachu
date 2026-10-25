"""Board piece sprites: knock out the generated white background, trim, square
up and re-encode. Boards used hand-written SVG paths before these."""
from PIL import Image
import os

# masters live outside public/ so deploys do not carry them
SRC = 'art-src/piece'
OUT = 'public/art/piece'

for name, size in [('volt', 192), ('spark', 192), ('checker-gold', 192), ('checker-blush', 192)]:
    src = f'{SRC}/{name}.png'
    im = Image.open(src).convert('RGBA')
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            m = min(r, g, b)
            if m > 243 and max(r, g, b) - m < 11:
                px[x, y] = (r, g, b, 0)
    bb = im.getbbox()
    if bb: im = im.crop(bb)
    # square canvas so every piece centres identically on its cell
    side = max(im.size)
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
    sq = sq.resize((size, size), Image.LANCZOS)
    out = f'{OUT}/{name}.webp'
    sq.save(out, format='WEBP', quality=92, method=6)
    print(f'{name:16} {size}x{size}  {os.path.getsize(out)//1024} KB')
