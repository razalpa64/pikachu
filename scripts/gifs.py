"""Clean the supplied Pikachu GIFs: drop the watermark, cut the flat background
out where it helps, shrink, and re-encode small enough to stream instantly."""
from PIL import Image
import os, sys

SRC = '/home/user/uploads'
OUT = '/home/user/pikachu/public/art/pika'
os.makedirs(OUT, exist_ok=True)

def frames(path):
    im = Image.open(path); out = []
    i = 0
    try:
        while True:
            im.seek(i); out.append(im.convert('RGBA').copy()); i += 1
    except EOFError:
        pass
    return out

def near(p, ref, tol):
    return abs(p[0]-ref[0]) <= tol and abs(p[1]-ref[1]) <= tol and abs(p[2]-ref[2]) <= tol

def knockout(fr, tol=26):
    """flood from the border so interior whites (eyes!) survive"""
    w, h = fr.size
    px = fr.load()
    ref = px[1, 1][:3]
    seen = bytearray(w*h)
    stack = [(x, 0) for x in range(w)] + [(x, h-1) for x in range(w)] \
          + [(0, y) for y in range(h)] + [(w-1, y) for y in range(h)]
    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= w or y >= h: continue
        i = y*w + x
        if seen[i]: continue
        if not near(px[x, y], ref, tol): continue
        seen[i] = 1
        stack.extend(((x+1, y), (x-1, y), (x, y+1), (x, y-1)))
    for y in range(h):
        row = y*w
        for x in range(w):
            if seen[row+x]:
                r, g, b, a = px[x, y]
                px[x, y] = (r, g, b, 0)
    return fr

def save_webp(fs, name, duration, quality):
    """animated webp: ~5x smaller than the gif and keeps real alpha"""
    path = os.path.join(OUT, name)
    fs[0].save(path, format='WEBP', save_all=True, append_images=fs[1:],
               duration=duration, loop=0, quality=quality, method=6,
               minimize_size=True, allow_mixed=True)
    return os.path.getsize(path)

# name, source, crop(box|None), every-nth-frame, target width, knock out bg?, duration
# name, source, crop, frame step, width, knock-out bg, frame ms, webp quality
JOBS = [
    ('run.webp',     '44-pikachu-pixel-usagif.gif',     (0, 0, 480, 318),  1, 300, True,  110, 86),
    ('shy.webp',     '60-pikachu-usagif.gif',           (0, 0, 366, 174),  1, 300, True,  100, 86),
    ('hello.webp',   '61-pikachu-game-usagif.gif',      (54, 160, 318, 300),1, 280, True,  110, 86),
    ('cap.webp',     '70-pikachu-pixel-usagif.gif',     (90, 90, 510, 510),1, 250, True,  150, 90, 53),
    ('materialise.webp','70-pikachu-pixel-usagif.gif',  (90, 90, 510, 510),3, 230, True,  110, 86),
    ('gift.webp',    '74-pikachu-christmas-usagif.gif', (0, 0, 600, 408),  2, 420, False, 110, 72),
    ('crowd.webp',   '75-pikachu-usagif.gif',           (0, 0, 500, 262),  2, 440, False, 110, 72),
    ('curious.webp', '78-pikachu-usagif.gif',           (0, 0, 520, 276),  2, 440, False,  90, 72),
]

total = 0
for job in JOBS:
    name, src, box, step, width, cut, dur, q = job[:8]
    start = job[8] if len(job) > 8 else 0
    fs = frames(os.path.join(SRC, src))
    if box: fs = [f.crop(box) for f in fs]
    fs = fs[start*step:][::step]
    if cut: fs = [knockout(f) for f in fs]
    scale = width / fs[0].width
    size = (width, max(1, round(fs[0].height * scale)))
    fs = [f.resize(size, Image.LANCZOS if not cut else Image.NEAREST) for f in fs]
    if cut:  # harden the alpha after resampling
        for f in fs:
            a = f.getchannel('A').point(lambda v: 255 if v > 110 else 0)
            f.putalpha(a)
    n = save_webp(fs, name, dur * step, q)
    total += n
    print(f'{name:12s} {size[0]}x{size[1]}  {len(fs):3d} frames  {n//1024:4d} KB')
print(f'total {total//1024} KB')
