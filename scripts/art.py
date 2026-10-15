"""Trim, size and re-encode the generated key art; build the one cover the
image generator could not deliver this turn out of pieces we already own."""
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance
import os, glob

ART = 'public/art'
os.makedirs(f'{ART}/game', exist_ok=True)

# ── 1. chess cover came back with a palette swatch strip baked along the bottom
p = f'{ART}/game/chess.jpg'
im = Image.open(p)
w, h = im.size
im.crop((0, 0, w, int(h * 0.845))).resize((w, w), Image.LANCZOS).save(p, quality=95)
print('chess swatch strip trimmed')

# ── 2. Volt Runner cover: sunset sky from the hero + a candy lane + the pixel sprite
hero = Image.open(f'{ART}/scene/hero.jpg').convert('RGB')
S = 1024
sky = hero.crop((120, 0, 120 + 900, 420)).resize((S, int(S * 420 / 900)), Image.LANCZOS)
cov = Image.new('RGB', (S, S), (255, 246, 230))
cov.paste(sky, (0, 0))
# blend the sky down into cream
grad = Image.new('L', (1, S), 0)
for y in range(S):
    t = max(0.0, min(1.0, (y - S * 0.30) / (S * 0.22)))
    grad.putpixel((0, y), int(255 * t))
cov = Image.composite(Image.new('RGB', (S, S), (255, 243, 224)), cov, grad.resize((S, S)))
d = ImageDraw.Draw(cov, 'RGBA')
# lane: a wide ribbon narrowing to the horizon
hz = int(S * 0.40)
d.polygon([(int(S*0.07), S), (int(S*0.93), S), (int(S*0.60), hz), (int(S*0.40), hz)], fill=(255, 236, 206, 255))
d.polygon([(int(S*0.07), S), (int(S*0.13), S), (int(S*0.425), hz), (int(S*0.40), hz)], fill=(243, 206, 168, 255))
d.polygon([(int(S*0.87), S), (int(S*0.93), S), (int(S*0.60), hz), (int(S*0.575), hz)], fill=(243, 206, 168, 255))
# dashed centre line, perspective spaced
y = S
step = 118.0
while y > hz + 14:
    t = (y - hz) / (S - hz)
    half = (0.016 + 0.030 * t) * S
    cx = S / 2
    d.polygon([(cx - half, y), (cx + half, y), (cx + half * 0.72, y - 46 * t - 8), (cx - half * 0.72, y - 46 * t - 8)],
              fill=(255, 214, 228, 230))
    y -= step * t + 26
    step *= 0.94
# soft hedges
for side in (0, 1):
    for i in range(7):
        t = i / 6
        yy = hz + int((S - hz) * (t ** 1.7)) + 10
        r = 26 + 74 * t
        cx = (S*0.40 - (S*0.33)*t) if side == 0 else (S*0.60 + (S*0.33)*t)
        d.ellipse([cx - r, yy - r*0.8, cx + r, yy + r*0.8], fill=(168, 230, 207, 255))
        d.ellipse([cx - r*0.7, yy - r*1.0, cx + r*0.6, yy + r*0.4], fill=(186, 238, 217, 255))
# floating coins + hearts
for (cx, cy, r, col) in [(0.30, 0.56, 30, (255, 217, 90)), (0.70, 0.62, 36, (255, 217, 90)),
                         (0.47, 0.49, 22, (255, 217, 90)), (0.62, 0.80, 44, (242, 119, 154)),
                         (0.26, 0.76, 34, (255, 173, 198))]:
    x, y2 = cx * S, cy * S
    d.ellipse([x-r, y2-r, x+r, y2+r], fill=col + (255,), outline=(150, 106, 78, 255), width=4)
cov = cov.filter(ImageFilter.GaussianBlur(0.6))
# the supplied pixel sprite, running down the lane
spr = Image.open(f'{ART}/pika/run.webp'); spr.seek(1)
spr = spr.convert('RGBA').resize((420, int(420 * spr.height / spr.width)), Image.NEAREST)
sh = Image.new('RGBA', cov.size, (0, 0, 0, 0))
ImageDraw.Draw(sh).ellipse([S*0.34, S*0.845, S*0.72, S*0.90], fill=(150, 106, 78, 70))
cov = Image.alpha_composite(cov.convert('RGBA'), sh.filter(ImageFilter.GaussianBlur(7)))
cov.alpha_composite(spr, (int(S*0.30), int(S*0.60)))
cov.convert('RGB').save(f'{ART}/game/arcade.jpg', quality=94)
print('arcade cover composited from the hero sky + the supplied run sprite')

# ── 3. ship everything as webp at sane display sizes
def ship(src, dst, width, q):
    im = Image.open(src).convert('RGB')
    if im.width != width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(dst, 'WEBP', quality=q, method=6)
    return os.path.getsize(dst)

total = 0
for f in sorted(glob.glob(f'{ART}/game/*.jpg')):
    out = f[:-4] + '.webp'
    n = ship(f, out, 640, 82); total += n
    os.remove(f)
    print(f'  {os.path.basename(out):18s} {n//1024:3d} KB')
n = ship(f'{ART}/scene/hero.jpg', f'{ART}/scene/hero.webp', 1600, 84); total += n
os.remove(f'{ART}/scene/hero.jpg')
print(f'  hero.webp          {n//1024:3d} KB')
print(f'art total {total//1024} KB')
