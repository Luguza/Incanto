"""Generate the home-screen app icons — a glowing hero rune on the arcane field.

Matches the game's palette and bloom treatment (see gen_wheel.py): a dark
purple ground (#141018), cyan arcane light, and a gold (#f2c14e) accent node.
The rune is a symmetric Algiz-style stave that reads clearly at small sizes.

Outputs (square, full-bleed — iOS rounds the corners itself, and the rune sits
inside the centre ~62% so Android maskable crops keep it whole):
  assets/apple-touch-icon.png  180x180  (iOS home screen)
  assets/icon-192.png          192x192  (PWA manifest)
  assets/icon-512.png          512x512  (PWA manifest / splash)
"""
import math
from PIL import Image, ImageDraw, ImageFilter, ImageChops

S = 4                       # supersample factor
OUT = 512                   # master render size
W = OUT * S
CX = CY = W // 2

CORE = (198, 255, 252)      # near-white cyan core
BRIGHT = (127, 244, 241)
MID = (77, 227, 224)
DIM = (38, 120, 118)
FAINT = (22, 70, 69)
GOLD = (242, 193, 78)
GOLD_HI = (255, 224, 150)

# Hero rune: a vertical stave with two upward and two downward branches
# (Algiz over inverted Algiz), fully symmetric. Coords in a -1..1 box, y down.
STAVE = [(0, -0.70), (0, 0.70)]
BRANCHES = [
    [(0, -0.28), (-0.40, -0.60)],
    [(0, -0.28), (0.40, -0.60)],
    [(0, 0.28), (-0.40, 0.60)],
    [(0, 0.28), (0.40, 0.60)],
]
R = 0.30 * W                # rune half-extent in supersampled pixels


def to_px(pts):
    return [(CX + x * R, CY + y * R) for x, y in pts]


def stroke(draw, pts, width, color):
    p = to_px(pts)
    draw.line(p, fill=color, width=max(1, int(width * S)), joint="curve")
    r = max(1, int(width * S / 2))
    for x, y in p:                       # round the ends/joints
        draw.ellipse([x - r, y - r, x + r, y + r], fill=color)


# ---- draw the arcane light layer (glows before bloom) ----------------------
art = Image.new("RGB", (W, W), (0, 0, 0))
d = ImageDraw.Draw(art)

# faint ring framing the rune
for rr, wd, col in [(0.46, 1.4, DIM), (0.485, 0.7, FAINT), (0.40, 0.6, FAINT)]:
    rad = rr * W
    d.ellipse([CX - rad, CY - rad, CX + rad, CY + rad], outline=col,
              width=max(1, int(wd * S)))
# tick marks around the ring
for a in range(0, 360, 15):
    c, s = math.cos(math.radians(a)), math.sin(math.radians(a))
    r1, r2 = 0.44 * W, 0.47 * W
    d.line([CX + r1 * c, CY + r1 * s, CX + r2 * c, CY + r2 * s],
           fill=FAINT, width=max(1, int(0.6 * S)))

# the rune: wide dim base, mid body, bright core
for width, color in [(9, DIM), (5.5, MID), (3.2, BRIGHT), (1.5, CORE)]:
    stroke(d, STAVE, width, color)
    for br in BRANCHES:
        stroke(d, br, width, color)

# small gold diamond node at the crossing centre (accent, not a focal blob)
for rr, col in [(0.055, GOLD), (0.034, GOLD_HI), (0.016, (255, 248, 228))]:
    rad = rr * W
    d.polygon([(CX, CY - rad), (CX + rad, CY), (CX, CY + rad), (CX - rad, CY)],
              fill=col)

# ---- downscale + bloom -----------------------------------------------------
art = art.resize((OUT, OUT), Image.LANCZOS)


def scaled(img, f):
    return img.point(lambda v: int(v * f))


b1 = art.filter(ImageFilter.GaussianBlur(2))
b2 = art.filter(ImageFilter.GaussianBlur(6))
b3 = art.filter(ImageFilter.GaussianBlur(16))
glow = ImageChops.add(ImageChops.add(scaled(b3, 0.6), scaled(b2, 0.6)),
                      ImageChops.add(scaled(b1, 0.85), art))

# ---- radial ground + composite ---------------------------------------------
bg = Image.new("RGB", (OUT, OUT), (20, 16, 24))
bd = ImageDraw.Draw(bg)
for i in range(OUT // 2, 0, -1):
    t = i / (OUT / 2)
    # centre #1b1524 -> edge #0a0710
    col = (int(10 + 17 * (1 - t)), int(7 + 14 * (1 - t)), int(16 + 20 * (1 - t)))
    bd.ellipse([OUT / 2 - i, OUT / 2 - i, OUT / 2 + i, OUT / 2 + i], fill=col)

alpha = glow.convert("L").point(lambda v: min(255, int(v * 1.6)))
top = Image.merge("RGBA", (*glow.split(), alpha))
master = Image.alpha_composite(bg.convert("RGBA"), top).convert("RGB")

for size, name in [(512, "icon-512.png"), (192, "icon-192.png"),
                   (180, "apple-touch-icon.png")]:
    img = master.resize((size, size), Image.LANCZOS)
    img.save(f"/home/user/Incanto/assets/{name}", optimize=True)
    print("saved", name, img.size)
