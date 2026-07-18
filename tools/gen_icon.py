"""Generate the home-screen app icons — a rune blazing inside a fireball.

Tells the game's story (cast spells by matching runes -> hurl fireballs): a
white-hot rune sigil at the core of a fireball, flames licking upward, on a
dark ember-lit ground. Warm palette with the game's gold (#f2c14e) accent.

Technique: draw the fire as a grayscale "heat" field (central orb + flame
tongues, biased upward), bloom it, then map heat -> a black->red->orange->
yellow->white fire ramp. The rune is overlaid as its own crisp gold-white
glow so it stays legible at small sizes.

Outputs (square, full-bleed; rune+core kept within the centre ~60% so iOS
rounding and Android maskable crops leave it whole):
  assets/apple-touch-icon.png  180x180
  assets/icon-192.png          192x192
  assets/icon-512.png          512x512
"""
import math
import random
from PIL import Image, ImageDraw, ImageFilter, ImageChops

random.seed(11)

S = 4                       # supersample factor
OUT = 512                   # master render size
W = OUT * S
CX = CY = W // 2

GOLD = (242, 193, 78)
GOLD_HI = (255, 226, 150)

# ---------------------------------------------------------------------------
# 1. Fire heat field (grayscale intensity, additive)
# ---------------------------------------------------------------------------
heat = Image.new("L", (W, W), 0)


def stamp(layer_draw, x, y, r, val):
    layer_draw.ellipse([x - r, y - r, x + r, y + r], fill=val)


def add_flame(acc, ang, length, base_w, base_i):
    """One tongue of flame: a stack of circles from a hot base to a cool tip."""
    tmp = Image.new("L", (W, W), 0)
    td = ImageDraw.Draw(tmp)
    dx, dy = math.cos(ang), math.sin(ang)
    steps = 26
    for i in range(steps, -1, -1):          # tip first, base last (base wins)
        t = i / steps
        r0 = 0.13 * W                        # start out from the core, not on it
        px = CX + (r0 + t * length) * dx
        # add a lateral wobble so tongues aren't ruler-straight
        wob = math.sin(t * 6 + ang * 3) * 0.03 * W * t
        px += -dy * wob
        py = CY + (r0 + t * length) * dy + dx * wob
        rr = base_w * (1 - 0.82 * t) + 2
        val = int(base_i * (1 - 0.55 * t) ** 1.4)
        stamp(td, px, py, rr, val)
    return ImageChops.add(acc, tmp)


# broad orange body halo (fills gaps so the fireball reads as a full mass)
body = Image.new("L", (W, W), 0)
bod = ImageDraw.Draw(body)
for i in range(60, 0, -1):
    t = i / 60
    stamp(bod, CX, CY, 0.24 * W * t, int(118 * (1 - t) ** 0.9))
heat = ImageChops.add(heat, body)

# small white-hot core
core = Image.new("L", (W, W), 0)
cod = ImageDraw.Draw(core)
for i in range(40, 0, -1):
    t = i / 40
    stamp(cod, CX, CY, 0.075 * W * t, int(130 * (1 - t) ** 0.6))
heat = ImageChops.add(heat, core)

# flame tongues licking outward, a little taller pointing up (screen up = -y)
for k in range(26):
    ang = math.radians(random.uniform(0, 360))
    up = max(0.0, -math.sin(ang))           # 1 straight up, 0 down/sideways
    length = (0.14 + 0.18 * up + random.uniform(0, 0.07)) * W
    base_w = (0.05 + 0.025 * random.random()) * W
    base_i = int(80 + 40 * up)
    heat = add_flame(heat, ang, length, base_w, base_i)

# a few tall central plumes for a licking crown
for ang_deg in (-90, -76, -104, -62, -118):
    ang = math.radians(ang_deg + random.uniform(-4, 4))
    heat = add_flame(heat, ang, 0.33 * W + random.uniform(0, 0.05) * W,
                     0.045 * W, 120)

# bloom the heat (gentle, so the core does not blow out to white)
heat = heat.resize((OUT, OUT), Image.LANCZOS)


def scaled(img, f):
    return img.point(lambda v: int(v * f))


# the flame SHAPE / opacity mask (bloomed heat). Colour is handled separately
# below by a radial temperature ramp, so overlaps never wash out to white.
soft = ImageChops.add(heat, ImageChops.add(
    scaled(heat.filter(ImageFilter.GaussianBlur(4)), 0.55),
    scaled(heat.filter(ImageFilter.GaussianBlur(12)), 0.45)))

# ---------------------------------------------------------------------------
# 2. Fire colour from a radial temperature ramp (hot centre -> cool tips)
# ---------------------------------------------------------------------------
STOPS = [
    (0.00, (30, 4, 2)),
    (0.16, (150, 26, 10)),
    (0.36, (224, 74, 18)),
    (0.56, (250, 142, 42)),
    (0.76, (255, 202, 98)),
    (0.90, (255, 238, 168)),
    (1.00, (255, 252, 242)),
]


def ramp(v):
    f = v / 255.0
    for i in range(len(STOPS) - 1):
        a, ca = STOPS[i]
        b, cb = STOPS[i + 1]
        if f <= b:
            t = 0 if b == a else (f - a) / (b - a)
            return tuple(int(ca[j] + (cb[j] - ca[j]) * t) for j in range(3))
    return STOPS[-1][1]


lut_r = [ramp(i)[0] for i in range(256)]
lut_g = [ramp(i)[1] for i in range(256)]
lut_b = [ramp(i)[2] for i in range(256)]

# radial temperature: 255 (white) at the core falling to 0 at the flame reach
temp = Image.new("L", (OUT, OUT), 0)
td2 = ImageDraw.Draw(temp)
Rmax = 0.42 * OUT
for i in range(int(Rmax), 0, -1):
    fr = i / Rmax
    td2.ellipse([OUT / 2 - i, OUT / 2 - i, OUT / 2 + i, OUT / 2 + i],
                fill=int(255 * (1 - fr) ** 0.82))
temp = temp.filter(ImageFilter.GaussianBlur(2))
fire = Image.merge("RGB", (temp.point(lut_r), temp.point(lut_g),
                           temp.point(lut_b)))

# ---------------------------------------------------------------------------
# 3. The rune sigil (crisp gold-white glow over the core)
# ---------------------------------------------------------------------------
rune_i = Image.new("L", (W, W), 0)
rd = ImageDraw.Draw(rune_i)
R = 0.245 * W
STAVE = [(0, -0.72), (0, 0.72)]
BRANCHES = [
    [(0, -0.26), (-0.40, -0.58)],
    [(0, -0.26), (0.40, -0.58)],
    [(0, 0.26), (-0.40, 0.58)],
    [(0, 0.26), (0.40, 0.58)],
]


def to_px(pts):
    return [(CX + x * R, CY + y * R) for x, y in pts]


def stroke(pts, width, val):
    p = to_px(pts)
    rd.line(p, fill=val, width=max(1, int(width * S)), joint="curve")
    r = max(1, int(width * S / 2))
    for x, y in p:
        rd.ellipse([x - r, y - r, x + r, y + r], fill=val)


for width, val in [(7.5, 150), (4.5, 220), (2.4, 255)]:
    stroke(STAVE, width, val)
    for br in BRANCHES:
        stroke(br, width, val)

rune_i = rune_i.resize((OUT, OUT), Image.LANCZOS)

# soft dark halo so the glowing rune stays legible over the bright core
shadow_mask = rune_i.filter(ImageFilter.MaxFilter(7)).filter(
    ImageFilter.GaussianBlur(4)).point(lambda v: int(v * 0.55))
rune_shadow = Image.merge("RGBA", (Image.new("L", (OUT, OUT), 30),
                                   Image.new("L", (OUT, OUT), 12),
                                   Image.new("L", (OUT, OUT), 8), shadow_mask))

rune_glow = ImageChops.add(rune_i.filter(ImageFilter.GaussianBlur(2)),
                           rune_i.filter(ImageFilter.GaussianBlur(7)))
rune_soft = ImageChops.add(rune_glow, rune_i)

# tint the rune white-hot with a gold bias
rune_rgb = Image.merge("RGB", (
    rune_soft,
    rune_soft.point(lambda v: int(v * 0.92)),
    rune_soft.point(lambda v: int(v * 0.72)),
))
rune_layer = Image.merge("RGBA", (*rune_rgb.split(),
                                  rune_soft.point(lambda v: min(255, int(v * 1.5)))))

# ---------------------------------------------------------------------------
# 4. Compose over an ember-lit ground
# ---------------------------------------------------------------------------
bg = Image.new("RGB", (OUT, OUT), (18, 12, 14))
bd = ImageDraw.Draw(bg)
for i in range(OUT // 2, 0, -1):
    t = i / (OUT / 2)                       # centre warm -> edge dark
    col = (int(8 + 34 * (1 - t) ** 2), int(6 + 14 * (1 - t) ** 2),
           int(12 + 8 * (1 - t) ** 2))
    bd.ellipse([OUT / 2 - i, OUT / 2 - i, OUT / 2 + i, OUT / 2 + i], fill=col)

fire_alpha = soft.point(lambda v: min(255, int(v * 1.4)))
scene = Image.alpha_composite(bg.convert("RGBA"),
                              Image.merge("RGBA", (*fire.split(), fire_alpha)))
scene = Image.alpha_composite(scene, rune_shadow)
scene = Image.alpha_composite(scene, rune_layer)

# gold node diamond last, at the crossing, on top of everything
sd = ImageDraw.Draw(scene)
for rr, col in [(0.052 * OUT, (*GOLD, 255)),
                (0.032 * OUT, (*GOLD_HI, 255)),
                (0.015 * OUT, (255, 250, 235, 255))]:
    sd.polygon([(OUT / 2, OUT / 2 - rr), (OUT / 2 + rr, OUT / 2),
                (OUT / 2, OUT / 2 + rr), (OUT / 2 - rr, OUT / 2)], fill=col)

master = scene.convert("RGB")

for size, name in [(512, "icon-512.png"), (192, "icon-192.png"),
                   (180, "apple-touch-icon.png")]:
    master.resize((size, size), Image.LANCZOS).save(
        f"/home/user/Incanto/assets/{name}", optimize=True)
    print("saved", name, size)
