"""Volt Runner sprites.

The runner was drawn with canvas primitives. The supplied GIF 44 is an actual
four-frame Pikachu running cycle, so it becomes the player sprite instead:
knock the flat background out, trim to the ink, and lay the frames out in one
horizontal strip the canvas can blit with drawImage().
"""
from PIL import Image
from collections import deque
import os

SRC = 'art-src/gif/44.gif'
OUT = 'public/art/run'
os.makedirs(OUT, exist_ok=True)

def knockout(fr, tol=34):
    """flood fill from the border, so enclosed same-colour pixels survive"""
    fr = fr.convert('RGBA')
    w, h = fr.size
    px = fr.load()
    base = px[0, 0][:3]
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            q.append((x, y))
    while q:
        x, y = q.popleft()
        if x < 0 or y < 0 or x >= w or y >= h: continue
        i = y * w + x
        if seen[i]: continue
        r, g, b, _ = px[x, y]
        if abs(r - base[0]) + abs(g - base[1]) + abs(b - base[2]) > tol: continue
        seen[i] = 1
        q.extend(((x+1,y),(x-1,y),(x,y+1),(x,y-1)))
    for y in range(h):
        for x in range(w):
            if seen[y*w+x]:
                r, g, b, _ = px[x, y]
                px[x, y] = (r, g, b, 0)
    return fr

im = Image.open(SRC)
frames = []
for i in range(im.n_frames):
    im.seek(i)
    frames.append(knockout(im.convert('RGBA')))

# common bounding box so the sprite does not jitter between frames
boxes = [f.getbbox() for f in frames]
l = min(b[0] for b in boxes); t = min(b[1] for b in boxes)
r = max(b[2] for b in boxes); btm = max(b[3] for b in boxes)
frames = [f.crop((l, t, r, btm)) for f in frames]

FH = 128
fw = max(1, round(frames[0].width * FH / frames[0].height))
frames = [f.resize((fw, FH), Image.NEAREST) for f in frames]

sheet = Image.new('RGBA', (fw * len(frames), FH), (0, 0, 0, 0))
for i, f in enumerate(frames):
    sheet.paste(f, (i * fw, 0), f)
sheet.save(f'{OUT}/runner.png')
print(f'runner.png  {len(frames)} frames  {fw}x{FH} each  {os.path.getsize(f"{OUT}/runner.png")//1024} KB')

# ── scenery + pickup sprites: generated art, white background knocked out ──────
SPRITES = [
    ('charge.png', 128),
    ('drone.png',  160),
    ('tree.png',   220),
    ('wall.png',   200),
]
for name, h in SPRITES:
    src = f'{OUT}/_src/{name}'
    if not os.path.exists(src):
        print(f'  !! missing {src}'); continue
    im = Image.open(src).convert('RGBA')
    px = im.load()
    w0, h0 = im.size
    # white-ish background -> transparent, with a soft edge so there is no halo
    for y in range(h0):
        for x in range(w0):
            r, g, b, a = px[x, y]
            m = min(r, g, b)
            if m > 242 and max(r, g, b) - m < 12:
                px[x, y] = (r, g, b, 0)
            elif m > 225 and max(r, g, b) - m < 18:
                px[x, y] = (r, g, b, int(a * (m - 225) / 17 * 0 + a * 0.45))
    bb = im.getbbox()
    if bb: im = im.crop(bb)
    w = max(1, round(im.width * h / im.height))
    im = im.resize((w, h), Image.LANCZOS)
    out = f'{OUT}/{name.replace(".png", ".webp")}'
    im.save(out, format='WEBP', quality=90, method=6)
    print(f'{name:12} -> {os.path.basename(out):14} {w}x{h}  {os.path.getsize(out)//1024} KB')
