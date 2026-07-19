"""Generate the home-screen app icons — a high-fidelity arcane rune circle.

A dense, glowing cyan sigil in the game's language (see gen_wheel.py): two
concentric rune-script bands, clock ticks, a six-point hexagram with node
markers, an inner construct with radiating spokes, and a scatter of sparks —
all bloomed, on the dark #141018 field with a single gold (#f2c14e) core.

The circle is centred and fills the frame within the safe ~88%, so iOS
corner-rounding and Android maskable crops leave the sigil intact.

Outputs:
  assets/apple-touch-icon.png  180x180
  assets/icon-192.png          192x192
  assets/icon-512.png          512x512
"""
import math
import random
from PIL import Image, ImageDraw, ImageFilter, ImageChops

random.seed(7)

S = 4
OUT = 512
W = OUT * S
CX = CY = W // 2

CORE = (198, 255, 252)
BRIGHT = (127, 244, 241)
MID = (77, 227, 224)
DIM = (40, 130, 128)
FAINT = (24, 78, 76)
GOLD = (242, 193, 78)
GOLD_HI = (255, 226, 150)

art = Image.new("RGB", (W, W), (0, 0, 0))
d = ImageDraw.Draw(art)


def rpx(f):                     # icon-fraction -> supersampled pixels
    return f * W


def ring(rf, width, color):
    r = rpx(rf)
    d.ellipse([CX - r, CY - r, CX + r, CY + r], outline=color,
              width=max(1, int(width * S)))


def dot_ring(rf, step_deg, size, color):
    a = 0.0
    r = rpx(rf)
    while a < 360:
        x = CX + r * math.cos(math.radians(a))
        y = CY + r * math.sin(math.radians(a))
        s = size * S
        d.ellipse([x - s, y - s, x + s, y + s], fill=color)
        a += step_deg


def radial(a_deg, rf1, rf2, width, color):
    c, s = math.cos(math.radians(a_deg)), math.sin(math.radians(a_deg))
    d.line([CX + rpx(rf1) * c, CY + rpx(rf1) * s,
            CX + rpx(rf2) * c, CY + rpx(rf2) * s],
           fill=color, width=max(1, int(width * S)))


def node(x, y, r0, color, gold=False):
    for rr, wd, col in [(r0, 1.4, color), (r0 * 1.28, 0.7, DIM)]:
        r = rpx(rr)
        d.ellipse([x - r, y - r, x + r, y + r], outline=col,
                  width=max(1, int(wd * S)))
    r = rpx(r0 * 0.32)
    d.ellipse([x - r, y - r, x + r, y + r], fill=GOLD if gold else MID)


GLYPHS = [
    [(0, -5), (0, 5)],
    [(-3, 5), (0, -5), (3, 5)],
    [(-3, -5), (-3, 5), (3, 5)],
    [(-3, 5), (-3, -5), (3, -5), (3, 5)],
    [(-3, -5), (3, 5), (3, -5)],
    [(0, -5), (0, 5), (3, 0), (-3, 0)],
    [(-3, 0), (0, -5), (3, 0), (0, 5), (-3, 0)],
    [(3, -5), (-3, -1), (3, 3), (0, 5)],
    [(-3, -5), (3, -5), (-3, 5), (3, 5)],
    [(0, -5), (-3, 0), (0, 5), (3, 0), (0, -5), (0, 5)],
]


def glyph(rf, a_deg, size, width, color):
    t = random.choice(GLYPHS)
    gx = CX + rpx(rf) * math.cos(math.radians(a_deg))
    gy = CY + rpx(rf) * math.sin(math.radians(a_deg))
    rot = math.radians(a_deg + 90)
    pts = []
    for x, y in t:
        p, q = x * size / 5.0 * S, y * size / 5.0 * S
        pts.append((gx + p * math.cos(rot) - q * math.sin(rot),
                    gy + p * math.sin(rot) + q * math.cos(rot)))
    d.line(pts, fill=color, width=max(1, int(width * S)), joint="curve")


VERT = [-90 + i * 60 for i in range(6)]


def near_vert(a_deg, margin):
    a = a_deg % 360
    return any(min(abs(a - (s % 360)), 360 - abs(a - (s % 360))) < margin
               for s in VERT)


# ---- outer band ------------------------------------------------------------
ring(0.450, 2.2, BRIGHT)
ring(0.465, 0.8, DIM)
ring(0.435, 0.6, DIM)
dot_ring(0.443, 3, 0.6, DIM)

# outer rune-script band
for a in range(0, 360, 8):
    if not near_vert(a, 13):
        glyph(0.412, a + random.uniform(-1.2, 1.2), 10, 1.2, MID)

ring(0.388, 1.6, BRIGHT)
ring(0.378, 0.6, DIM)

# fine clock ticks between the two outer rings
for a in range(0, 360, 3):
    if not near_vert(a, 11):
        radial(a, 0.378, 0.388, 0.6, DIM)

# inner rune-script band, tighter and dimmer
for a in range(0, 360, 7):
    if not near_vert(a, 12):
        glyph(0.352, a + random.uniform(-1.2, 1.2), 8, 1.0, DIM)

ring(0.320, 1.4, MID)
ring(0.310, 0.6, FAINT)

# chevrons at the six gap centres
for sa in VERT:
    mid = sa + 30
    c, s = math.cos(math.radians(mid)), math.sin(math.radians(mid))
    nx, ny = -s, c
    r = rpx(0.300)
    pxc, pyc = CX + r * c, CY + r * s
    sz = rpx(0.022)
    d.line([(pxc - nx * sz, pyc - ny * sz), (pxc + c * sz * 0.9, pyc + s * sz * 0.9),
            (pxc + nx * sz, pyc + ny * sz)], fill=MID, width=int(1.1 * S))

# ---- connect every possible path between the six vocabulary nodes ----------
# the complete graph on the six vertices: star diagonals, the three diameters
# through the centre, and the outer perimeter (no filled hexagon).
RV = 0.262
pts = [(CX + rpx(RV) * math.cos(math.radians(sa)),
        CY + rpx(RV) * math.sin(math.radians(sa))) for sa in VERT]
for i in range(6):                                  # skip-one star diagonals
    d.line([pts[i], pts[(i + 2) % 6]], fill=MID, width=int(1.2 * S),
           joint="curve")
for i in range(3):                                  # opposite diameters
    d.line([pts[i], pts[i + 3]], fill=MID, width=int(1.0 * S), joint="curve")
for i in range(6):                                  # outer perimeter edges
    d.line([pts[i], pts[(i + 1) % 6]], fill=MID, width=int(1.2 * S),
           joint="curve")

# node markers at the six vertices
for (x, y), sa in zip(pts, VERT):
    node(x, y, 0.034, BRIGHT)
    # small outward diamond on each node
    c, s = math.cos(math.radians(sa)), math.sin(math.radians(sa))
    dx, dy = x + rpx(0.050) * c, y + rpx(0.050) * s
    nx, ny = -s, c
    r = rpx(0.014)
    d.polygon([(dx + c * r, dy + s * r), (dx + nx * r * 0.8, dy + ny * r * 0.8),
               (dx - c * r, dy - s * r), (dx - nx * r * 0.8, dy - ny * r * 0.8)],
              outline=MID, width=int(0.9 * S))

# ---- inner construct -------------------------------------------------------
ring(0.180, 1.4, MID)
ring(0.150, 0.7, DIM)
ring(0.100, 1.0, MID)

# spokes from the inner construct out to the inner ring
for a in range(15, 360, 30):
    radial(a, 0.100, 0.180, 0.6, FAINT)

# small rune-script circle inside
for a in range(0, 360, 20):
    glyph(0.128, a, 6, 0.8, DIM)

# central mini-hexagram
cp = [(CX + rpx(0.058) * math.cos(math.radians(30 + i * 60)),
       CY + rpx(0.058) * math.sin(math.radians(30 + i * 60))) for i in range(6)]
for tri in ([0, 2, 4], [1, 3, 5]):
    d.line([cp[tri[0]], cp[tri[1]], cp[tri[2]], cp[tri[0]]],
           fill=DIM, width=int(0.8 * S), joint="curve")
ring(0.030, 1.0, BRIGHT)

# ---- sparks / particle field ----------------------------------------------
for _ in range(150):
    a = random.uniform(0, 360)
    rf = random.uniform(0.04, 0.45)
    x = CX + rpx(rf) * math.cos(math.radians(a))
    y = CY + rpx(rf) * math.sin(math.radians(a))
    sz = random.uniform(0.4, 1.5) * S
    b = random.random()
    col = CORE if b > 0.9 else (BRIGHT if b > 0.6 else MID if b > 0.3 else DIM)
    d.ellipse([x - sz, y - sz, x + sz, y + sz], fill=col)

# ---- downscale + bloom -----------------------------------------------------
art = art.resize((OUT, OUT), Image.LANCZOS)


def scaled(img, f):
    return img.point(lambda v: int(v * f))


b1 = art.filter(ImageFilter.GaussianBlur(2))
b2 = art.filter(ImageFilter.GaussianBlur(7))
b3 = art.filter(ImageFilter.GaussianBlur(20))
glow = ImageChops.add(ImageChops.add(scaled(b3, 0.5), scaled(b2, 0.55)),
                      ImageChops.add(scaled(b1, 0.8), art))
alpha = glow.convert("L").point(lambda v: min(255, int(v * 1.5)))
top = Image.merge("RGBA", (*glow.split(), alpha))

# ---- radial ground + composite ---------------------------------------------
bg = Image.new("RGB", (OUT, OUT), (20, 16, 24))
bd = ImageDraw.Draw(bg)
for i in range(OUT // 2, 0, -1):
    t = i / (OUT / 2)
    col = (int(10 + 16 * (1 - t)), int(7 + 13 * (1 - t)), int(15 + 19 * (1 - t)))
    bd.ellipse([OUT / 2 - i, OUT / 2 - i, OUT / 2 + i, OUT / 2 + i], fill=col)

master = Image.alpha_composite(bg.convert("RGBA"), top).convert("RGB")

for size, name in [(512, "icon-512.png"), (192, "icon-192.png"),
                   (180, "apple-touch-icon.png")]:
    master.resize((size, size), Image.LANCZOS).save(
        f"/home/user/Incanto/assets/{name}", optimize=True)
    print("saved", name, size)
