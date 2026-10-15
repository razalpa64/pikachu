"""Three of the supplied PNGs are full painted scenes rather than cut-outs, so
they cannot become floating mascots — they belong in a frame. This sizes and
re-encodes them for <PikaScene/>, which does the matting and warm grade in CSS.

Run from the project root:  python3 scripts/scenes.py
"""
from PIL import Image
import os

SRC = '/home/user/uploads'
OUT = 'public/art/pika'
os.makedirs(OUT, exist_ok=True)

# source, output, target width  (height follows the source aspect)
JOBS = [
    ('image-1.png', 'meadow.webp',  520),   # wide: sitting in a sunlit meadow
    ('image-3.png', 'goldenhour.webp', 380),  # tall: eyes shut, happy, golden grass
    ('image-6.png', 'storm.webp',   400),   # square: lightning, all the drama
]

total = 0
for src, name, width in JOBS:
    im = Image.open(os.path.join(SRC, src)).convert('RGB')
    h = max(1, round(im.height * width / im.width))
    im = im.resize((width, h), Image.LANCZOS)
    path = os.path.join(OUT, name)
    im.save(path, format='WEBP', quality=84, method=6)
    size = os.path.getsize(path)
    total += size
    print(f'{name:18} {width}x{h:<4} {size//1024:>4} KB')
print(f'{"total":18} {total//1024} KB')
