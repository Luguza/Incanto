"""Generate the home-screen app icons — a hero rune inside an arcane ring.

Echoes the game's rune circle (see gen_wheel.py): a decorative cyan ring — a
band of tiny rune script, fine ticks and six socket nodes — framing one bold
glowing rune with a gold (#f2c14e) node at its heart, on the dark #141018
field. Calm, emblem-like, and recognisably Incanto.

Everything sits within the centre ~80% so iOS corner-rounding and Android
maskable crops leave the ring whole.

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


def px(f):                      # icon-fraction -> supersampled pixels
    return f * W


def ring(rf, width, color):
    r = px(rf)
    d.ellipse([CX - r, CY - r, CX + r, CY + r], outline=color,
              width=max(1, int(width * S)))


def radial(a_deg, rf1, rf2, width, color):
    c, s = math.cos(math.radians(a_deg)), math.sin(math.radians(a_deg))
    d.line([CX + px(rf1) * c, CY + px(rf1) * s, CX + px(rf2) * c, CY + px(rf2) * s],
           fill=color, width=max(1, int(width * S)))


# tiny rune-script glyphs (same alphabet as the arena wheel)
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
    gx = CX + px(rf) * math.cos(math.radians(a_deg))
    gy = CY + px(rf) * math.sin(math.radians(a_deg))
    rot = math.radians(a_deg + 90)
    pts = []
    for x, y in t:
        p, q = x * size / 5.0 * S, y * size / 5.0 * S
        rx = p * math.cos(rot) - q * math.sin(rot)
        ry = p * math.sin(rot) + q * math.cos(rot)
        pts.append((gx + rx, gy + ry))
    d.line(pts, fill=color, width=max(1, int(width * S)), joint="curve")


SOCKETS = [-90 + i * 60 for i in range(6)]


def near_socket(a_deg, margin):
    a = a_deg % 360
    return any(min(abs(a - (s % 360)), 360 - abs(a - (s % 360))) < margin
               for s in SOCKETS)


# ---- decorative ring -------------------------------------------------------
ring(0.400, 2.0, BRIGHT)
ring(0.415, 0.8, DIM)
ring(0.385, 0.8, DIM)
ring(0.300, 1.4, MID)
ring(0.286, 0.7, FAINT)

# rune-script band between the two main rings
for a in range(0, 360, 9):
    if not near_socket(a, 15):
        glyph(0.345, a + random.uniform(-1.5, 1.5), 9, 1.1, MID)

# fine ticks just inside the outer ring
for a in range(0, 360, 6):
    if not near_socket(a, 12):
        radial(a, 0.378, 0.398, 0.7, DIM)

# six socket nodes on the outer ring
for sa in SOCKETS:
    sx = CX + px(0.400) * math.cos(math.radians(sa))
    sy = CY + px(0.400) * math.sin(math.radians(sa))
    for rr, wd, col in [(0.030, 1.4, BRIGHT), (0.038, 0.7, DIM)]:
        r = px(rr)
        d.ellipse([sx - r, sy - r, sx + r, sy + r], outline=col,
                  width=max(1, int(wd * S)))
    r = px(0.010)
    d.ellipse([sx - r, sy - r, sx + r, sy + r], fill=MID)

# faint spokes from the inner ring out toward the sockets' gaps
for sa in SOCKETS:
    radial(sa + 30, 0.300, 0.385, 0.6, FAINT)

# ---- hero rune -------------------------------------------------------------
R = px(0.205)
STAVE = [(0, -0.72), (0, 0.72)]
BRANCHES = [
    [(0, -0.26), (-0.40, -0.58)],
    [(0, -0.26), (0.40, -0.58)],
    [(0, 0.26), (-0.40, 0.58)],
    [(0, 0.26), (0.40, 0.58)],
]


def stroke(pts, width, color):
    p = [(CX + x * R, CY + y * R) for x, y in pts]
    d.line(p, fill=color, width=max(1, int(width * S)), joint="curve")
    r = max(1, int(width * S / 2))
    for x, y in p:
        d.ellipse([x - r, y - r, x + r, y + r], fill=color)


for width, color in [(6.5, DIM), (4.0, MID), (2.3, BRIGHT), (1.1, CORE)]:
    stroke(STAVE, width, color)
    for br in BRANCHES:
        stroke(br, width, color)

# ---- sparks / particle field for life --------------------------------------
for _ in range(90):
    a = random.uniform(0, 360)
    rf = random.uniform(0.10, 0.40)
    x = CX + px(rf) * math.cos(math.radians(a))
    y = CY + px(rf) * math.sin(math.radians(a))
    sz = random.uniform(0.4, 1.4) * S
    b = random.random()
    col = CORE if b > 0.9 else (BRIGHT if b > 0.6 else MID if b > 0.3 else DIM)
    d.ellipse([x - sz, y - sz, x + sz, y + sz], fill=col)

# ---- downscale + bloom -----------------------------------------------------
art = art.resize((OUT, OUT), Image.LANCZOS)


def scaled(img, f):
    return img.point(lambda v: int(v * f))


b1 = art.filter(ImageFilter.GaussianBlur(2))
b2 = art.filter(ImageFilter.GaussianBlur(7))
b3 = art.filter(ImageFilter.GaussianBlur(18))
glow = ImageChops.add(ImageChops.add(scaled(b3, 0.5), scaled(b2, 0.55)),
                      ImageChops.add(scaled(b1, 0.8), art))
alpha = glow.convert("L").point(lambda v: min(255, int(v * 1.5)))

# gold node diamond, drawn crisp on top after bloom
top = Image.merge("RGBA", (*glow.split(), alpha))
nd = ImageDraw.Draw(top)
for rr, col in [(0.052, (*GOLD, 255)), (0.032, (*GOLD_HI, 255)),
                (0.015, (255, 250, 235, 255))]:
    r = rr * OUT
    nd.polygon([(OUT / 2, OUT / 2 - r), (OUT / 2 + r, OUT / 2),
                (OUT / 2, OUT / 2 + r), (OUT / 2 - r, OUT / 2)], fill=col)

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
