"""Generate assets/arcane_wheel.png — a high-fidelity cyan arcane wheel.

Geometry mirrors the game's SVG arena exactly (600x600 viewBox, center 300,
band 163/267, sockets r=48 at radius 215, slot angles -90+i*60), rendered at
4x (2400px canvas supersampled from 4800) and saved at 1200px so the live SVG
elements layered on top mesh with the baked art.
"""
import math
import random
from PIL import Image, ImageDraw, ImageFilter, ImageChops

random.seed(7)

S = 8               # supersample factor over SVG units (600 * 8 = 4800)
OUT = 1200          # final output size
CX = CY = 300 * S
W = 600 * S

CORE = (190, 255, 252)
BRIGHT = (127, 244, 241)
MID = (77, 227, 224)
DIM = (38, 120, 118)
FAINT = (22, 70, 69)

art = Image.new("RGB", (W, W), (0, 0, 0))
d = ImageDraw.Draw(art)

def ring(r, width, color):
    d.ellipse([CX - r * S, CY - r * S, CX + r * S, CY + r * S], outline=color, width=max(1, int(width * S)))

def dot_ring(r, step_deg, size, color, skip=None):
    a = 0.0
    while a < 360:
        if not (skip and skip(a)):
            x = CX + r * S * math.cos(math.radians(a))
            y = CY + r * S * math.sin(math.radians(a))
            d.ellipse([x - size * S, y - size * S, x + size * S, y + size * S], fill=color)
        a += step_deg

def radial(a_deg, r1, r2, width, color):
    c, s = math.cos(math.radians(a_deg)), math.sin(math.radians(a_deg))
    d.line([CX + r1 * S * c, CY + r1 * S * s, CX + r2 * S * c, CY + r2 * S * s],
           fill=color, width=max(1, int(width * S)))

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

def glyph(r, a_deg, size, width, color):
    t = random.choice(GLYPHS)
    gx = CX + r * S * math.cos(math.radians(a_deg))
    gy = CY + r * S * math.sin(math.radians(a_deg))
    rot = math.radians(a_deg + 90)
    pts = []
    for x, y in t:
        px, py = x * size / 5.0, y * size / 5.0
        rx = px * math.cos(rot) - py * math.sin(rot)
        ry = px * math.sin(rot) + py * math.cos(rot)
        pts.append((gx + rx * S, gy + ry * S))
    d.line(pts, fill=color, width=max(1, int(width * S)), joint="curve")

SLOTS = [-90 + i * 60 for i in range(6)]

def near_slot(a_deg, margin):
    a = a_deg % 360
    return any(min(abs(a - (sa % 360)), 360 - abs(a - (sa % 360))) < margin for sa in SLOTS)

# ---- outer band -----------------------------------------------------------
ring(267, 2.2, BRIGHT)
ring(273, 0.8, DIM)
ring(261, 0.6, DIM)
ring(163, 2.2, BRIGHT)
ring(157, 0.8, DIM)
ring(169, 0.6, DIM)
dot_ring(255, 3, 0.55, DIM)
dot_ring(175, 3, 0.55, DIM)

# script ring between the sockets (outer part of the band)
for a in range(0, 360, 5):
    if not near_slot(a, 16):
        glyph(240, a + random.uniform(-1, 1), 7.5, 1.0, MID)
# script ring inside the band, tighter and dimmer
for a in range(0, 360, 6):
    if not near_slot(a, 15):
        glyph(186, a + random.uniform(-1, 1), 6, 0.9, DIM)

# fine clock ticks on both band edges
for a in range(0, 360, 3):
    if not near_slot(a, 13):
        radial(a, 263, 267, 0.5, DIM)
        radial(a, 163, 167, 0.5, DIM)

# chevrons at the gap centers
for sa in SLOTS:
    mid = sa + 30
    for rr, sz in [(215, 9)]:
        c, s = math.cos(math.radians(mid)), math.sin(math.radians(mid))
        nx, ny = -s, c
        px, py = CX + rr * S * c, CY + rr * S * s
        d.line([(px - nx * sz * S, py - ny * sz * S), (px + c * sz * 0.9 * S, py + s * sz * 0.9 * S),
                (px + nx * sz * S, py + ny * sz * S)], fill=MID, width=int(1.1 * S))
        d.line([(px - nx * sz * 0.55 * S, py - ny * sz * 0.55 * S), (px - c * sz * 0.5 * S, py - s * sz * 0.5 * S),
                (px + nx * sz * 0.55 * S, py + ny * sz * 0.55 * S)], fill=DIM, width=int(0.9 * S))

# ---- word sockets ---------------------------------------------------------
for sa in SLOTS:
    sx = CX + 215 * S * math.cos(math.radians(sa))
    sy = CY + 215 * S * math.sin(math.radians(sa))
    def sring(r, width, color):
        d.ellipse([sx - r * S, sy - r * S, sx + r * S, sy + r * S], outline=color, width=max(1, int(width * S)))
    sring(48, 1.8, BRIGHT)
    sring(52, 0.7, DIM)
    sring(43, 0.6, DIM)
    # tiny rim ticks
    for a in range(0, 360, 30):
        c2, s2 = math.cos(math.radians(a)), math.sin(math.radians(a))
        d.line([(sx + 44 * S * c2, sy + 44 * S * s2), (sx + 48 * S * c2, sy + 48 * S * s2)],
               fill=DIM, width=int(0.6 * S))
    # outward diamond on the rim
    c3, s3 = math.cos(math.radians(sa)), math.sin(math.radians(sa))
    dx, dy = sx + 55 * S * c3, sy + 55 * S * s3
    nx, ny = -s3, c3
    d.polygon([(dx + c3 * 5 * S, dy + s3 * 5 * S), (dx + nx * 4 * S, dy + ny * 4 * S),
               (dx - c3 * 5 * S, dy - s3 * 5 * S), (dx - nx * 4 * S, dy - ny * 4 * S)],
              outline=MID, width=int(0.9 * S))

# ---- center construct -----------------------------------------------------
ring(112, 1.6, MID)
ring(88, 1.0, DIM)
ring(120, 0.6, FAINT)
ring(34, 1.4, MID)
ring(8, 1.0, BRIGHT)

# hexagram joining socket centers (very faint - live chords draw over it)
pts = [(CX + 215 * S * math.cos(math.radians(sa)), CY + 215 * S * math.sin(math.radians(sa))) for sa in SLOTS]
for tri in ([0, 2, 4], [1, 3, 5]):
    d.line([pts[tri[0]], pts[tri[1]], pts[tri[2]], pts[tri[0]]], fill=FAINT, width=int(1.0 * S))
# inner hexagon joining adjacent sockets, fainter
d.line(pts + [pts[0]], fill=(14, 46, 45), width=int(0.8 * S))

# spokes from the center construct out to the band
for a in range(15, 360, 30):
    radial(a, 120, 163, 0.6, FAINT)

# small script circle inside the center
for a in range(0, 360, 15):
    glyph(100, a, 5, 0.8, DIM)

# ---- particle field -------------------------------------------------------
for _ in range(260):
    a = random.uniform(0, 360)
    r = random.uniform(150, 285)
    x = CX + r * S * math.cos(math.radians(a))
    y = CY + r * S * math.sin(math.radians(a))
    sz = random.uniform(0.4, 1.6) * S
    b = random.random()
    col = CORE if b > 0.9 else (BRIGHT if b > 0.6 else MID if b > 0.3 else DIM)
    d.ellipse([x - sz, y - sz, x + sz, y + sz], fill=col)

# ---- downscale + bloom ----------------------------------------------------
art = art.resize((OUT, OUT), Image.LANCZOS)

def scaled(img, f):
    return img.point(lambda v: int(v * f))

b1 = art.filter(ImageFilter.GaussianBlur(2))
b2 = art.filter(ImageFilter.GaussianBlur(7))
b3 = art.filter(ImageFilter.GaussianBlur(20))
glow = ImageChops.add(ImageChops.add(scaled(b3, 0.5), scaled(b2, 0.55)), ImageChops.add(scaled(b1, 0.8), art))

# alpha from luminance
alpha = glow.convert("L").point(lambda v: min(255, int(v * 1.5)))

# translucent dark wells inside the sockets and the center, so text sits well
dark = Image.new("L", (OUT, OUT), 0)
dd = ImageDraw.Draw(dark)
K = OUT / 600.0
for sa in SLOTS:
    sx = OUT / 2 + 215 * K * math.cos(math.radians(sa))
    sy = OUT / 2 + 215 * K * math.sin(math.radians(sa))
    dd.ellipse([sx - 46 * K, sy - 46 * K, sx + 46 * K, sy + 46 * K], fill=120)
dd.ellipse([OUT / 2 - 110 * K, OUT / 2 - 110 * K, OUT / 2 + 110 * K, OUT / 2 + 110 * K], fill=60)
dark = dark.filter(ImageFilter.GaussianBlur(3))

base = Image.merge("RGBA", (*Image.new("RGB", (OUT, OUT), (8, 13, 18)).split(), dark))
top = Image.merge("RGBA", (*glow.split(), alpha))
final = Image.alpha_composite(base, top)
final.save("/home/user/Incanto/assets/arcane_wheel.png", optimize=True)
print("saved", final.size)
