"use strict";
// ==============================================================================
// sprite-art.js — creatures drawn HERE rather than cut from the tileset. Owns:
// PIXEL_ART (the pixel maps + palettes), ART_RECTS (their frame rects) and
// artSheet() (the offscreen sheet they are baked onto).
//
// WHY THIS FILE EXISTS. Every other body in the hall is a rect in
// assets/dungeon_tiles.png (0x72's CC0 "16x16 DungeonTileset II"), bent into a
// variant by `scale` and a colour `filter`. That works while the sheet has a
// creature close enough to what a chapter needs — a bleached skeleton, a darker
// orc — and stops working the moment it doesn't. The sheet has no small vermin:
// its smallest bodies are the tiny zombie and the goblin, and shrinking either
// one to ankle height turns a drawn character into a smudge with feet. So the
// slimes the hall opens with are DRAWN, at the size they are actually meant to
// be seen.
//
// WHAT "CONSISTENT WITH THE OTHERS" MEANS HERE — the rules were read off the
// sheet's own goo creatures (`muddy` / `swampy`, whose maps are four colours
// each) and are followed exactly:
//
//   · FOUR COLOURS, no more, and every one of them lifted from the tileset's own
//     56-colour palette rather than invented. Nothing dithers, nothing is
//     anti-aliased, no pixel is a blend of two others.
//   · #222222 IS THE OUTLINE, and it is also the eyes and the interior creases.
//     The sheet uses one near-black for all three; a second dark would read as
//     a different artist.
//   · THE SILHOUETTE IS CLOSED. Every body pixel has outline or body on all four
//     sides, so the shape survives being stamped flat — which it is, twice, for
//     the white hit flash and the frost rime (see buildAssets).
//   · THE ART FACES RIGHT. Everything on the sheet does, and render-assets.js
//     flips all of it once at load, so a sprite drawn facing left would be the
//     only body in the hall walking backwards.
//   · A LIGHT SIDE AND A DARK SIDE: one colour above the body colour for the
//     shine, one below it for the shading, exactly the three-tone split
//     `muddy` uses.
//
// The frames are then handed to the SAME bake path as the tileset's own art —
// packed onto one offscreen sheet, cut into rects, flipped, flashed and rimed by
// cutFrame — so nothing downstream can tell a drawn creature from a cut one.
// ==============================================================================

// A frame is written as one string per row: '.' is transparent, and the letters
// index the creature's palette. Rows must all be the same length, and every
// frame of a creature the same size — buildArtSheet checks both rather than
// silently packing a ragged sheet.
//
//   A  outline · eyes · creases (always #222222)
//   B  shine   (lighter than the body)
//   C  body
//   D  shading (darker than the body)
//
// THE SLIME, 12x10. Deliberately smaller than everything else that walks the
// hall — a skeleton is 16x16 — because "you have outgrown this in a minute" is
// the whole message of the chapter it opens.
//
// The idle is the bob the sheet's goo creatures do: the dome lifts a pixel off
// its puddle and settles back, and the puddle itself spreads and gathers under
// it. The head shape never changes through it, which is what keeps a 12-pixel
// creature legible while it moves.
//
// The face follows `muddy`'s: a shading crease along the top of the eyes, then
// two 2x2 eyes below it. The GAP between them is two pixels and it has to be —
// drawn a pixel closer (which is where this started) the two eyes and the
// pixel between them blur into one wide dark band at the size this is actually
// seen at, and the slime stops having a face at all.
//
// The shine sits on the left of the drawing, so it ends up on the slime's
// trailing side once render-assets.js flips it — same as the rim light on every
// goo creature the sheet ships.
const SLIME_IDLE = [
  [ // settled, goo gathered
    "............",
    "............",
    "..AAAAAAA...",
    ".ABBCCCCCA..",
    "ABCDDCCDDCA.",
    "ABCAACCAACA.",
    "ABCAACCAACA.",
    "ABCCCCCCCCA.",
    "ABDCCDCCDCA.",
    "AAAAAAAAAAA.",
  ],
  [ // lifting — one more row of body between the face and the goo
    "............",
    "..AAAAAAA...",
    ".ABBCCCCCA..",
    "ABCDDCCDDCA.",
    "ABCAACCAACA.",
    "ABCAACCAACA.",
    "ABCCCCCCCCA.",
    "ABCCCCCCCCA.",
    "ABDCCDCCDCA.",
    "AAAAAAAAAAA.",
  ],
  [ // up, and the goo spreads out from under it
    "............",
    "..AAAAAAA...",
    ".ABBCCCCCA..",
    "ABCDDCCDDCA.",
    "ABCAACCAACA.",
    "ABCAACCAACA.",
    "ABCCCCCCCCA.",
    "ABCCCCCCCCCA",
    "ABDCCDCCDCCA",
    "AAAAAAAAAAAA",
  ],
  [ // settling back into the spread puddle
    "............",
    "............",
    "..AAAAAAA...",
    ".ABBCCCCCA..",
    "ABCDDCCDDCA.",
    "ABCAACCAACA.",
    "ABCAACCAACA.",
    "ABCCCCCCCCCA",
    "ABDCCDCCDCCA",
    "AAAAAAAAAAAA",
  ],
];

// The march is a HOP, not a shuffle: gather, launch, off the ground, land. The
// third frame has two empty rows at the bottom, and that is load-bearing — a
// body is drawn with its feet on its lane's floor line (see renderScene), so
// emptiness under the sprite is air under the slime. Its shadow stays on the
// floor while it is up there, which is the whole trick.
const SLIME_RUN = [
  [ // gathered low and wide, about to go — the crouch squashes the brow away
    "............",
    "............",
    "............",
    "..AAAAAAA...",
    ".ABBCCCCCA..",
    "ABCAACCAACA.",
    "ABCAACCAACA.",
    "ABCCCCCCCCCA",
    "ABDCCDCCDCCA",
    "AAAAAAAAAAAA",
  ],
  [ // launching — the goo draws up into a tail behind it
    "..AAAAAAA...",
    ".ABBCCCCCA..",
    "ABCDDCCDDCA.",
    "ABCAACCAACA.",
    "ABCAACCAACA.",
    "ABCCCCCCCCA.",
    "ABCCCCCCCCA.",
    ".ABCCCCCA...",
    ".ABDCCDCA...",
    "..AAAAAA....",
  ],
  [ // airborne: nothing touching the floor
    "..AAAAAAA...",
    ".ABBCCCCCA..",
    "ABCDDCCDDCA.",
    "ABCAACCAACA.",
    "ABCAACCAACA.",
    "ABCCCCCCCCA.",
    ".ABDCCDCA...",
    "..AAAAAA....",
    "............",
    "............",
  ],
  [ // landed, goo splashed out the other way
    "............",
    "............",
    "............",
    "..AAAAAAA...",
    ".ABBCCCCCA..",
    "ABCAACCAACA.",
    "ABCAACCAACA.",
    "ABCCCCCCCCCA",
    "ABCDCCDCCDCA",
    "AAAAAAAAAAAA",
  ],
];

// Two colourways of the one drawing, which is how the sheet itself ships its goo
// creatures — `muddy` and `swampy` are the same 16x16 map in two palettes, not
// two drawings. Every value below appears somewhere in dungeon_tiles.png
// already, so the slimes sit in the same colour world as the rest of the hall
// instead of next to it.
const PIXEL_ART = {
  // Grass green off the goblin, shaded with the sheet's commonest dark green and
  // lit with the bright lime that `swampy` is made of.
  slime: {
    w: 12, h: 10,
    palette: { A: "#222222", B: "#97da3f", C: "#4ba747", D: "#3d734f" },
    idle: SLIME_IDLE, run: SLIME_RUN,
  },
  // The same slime run cold: the sheet's mid blue, its blue-teal shade, and the
  // pale ice highlight it uses on frost.
  slimeBlue: {
    w: 12, h: 10,
    palette: { A: "#222222", B: "#cae6f5", C: "#5698cc", D: "#417089" },
    idle: SLIME_IDLE, run: SLIME_RUN,
  },
};

// Where each drawn creature's frames land on the sheet built below. Pure
// geometry — derived without touching a canvas, so ENEMY_SPRITES can name these
// rects while the sheet itself is still unbuilt. One row per creature: the idle
// strip first, the run strip after it, both in the rect shape the tileset's own
// entries use ({ x, y, w, h, f }) so a drawn creature and a cut one are the same
// kind of thing to everything downstream.
const ART_RECTS = (() => {
  const rects = {};
  let y = 0;
  for (const [id, art] of Object.entries(PIXEL_ART)) {
    rects[id] = {
      idle: { x: 0, y, w: art.w, h: art.h, f: art.idle.length, sheet: "art" },
      run: { x: art.w * art.idle.length, y, w: art.w, h: art.h, f: art.run.length, sheet: "art" },
    };
    y += art.h;
  }
  return rects;
})();

// The sheet itself, built once on first use and cached. Everything is drawn a
// pixel at a time at 1:1 — it is a few hundred fillRects, once, and the result
// is an ordinary canvas that cutFrame can treat exactly like the loaded PNG.
//
// It is generated rather than fetched, so unlike the tileset it is ready the
// moment it is asked for (no onload), and it never taints a canvas — which is
// what lets the game keep building its assets under file:// as well as HTTP.
let ART_SHEET = null;
function artSheet() {
  if (ART_SHEET) return ART_SHEET;
  const entries = Object.entries(PIXEL_ART);
  let width = 0, height = 0;
  for (const [, art] of entries) {
    width = Math.max(width, art.w * (art.idle.length + art.run.length));
    height += art.h;
  }
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, width);
  cv.height = Math.max(1, height);
  const ctx = cv.getContext("2d");
  for (const [id, art] of entries) {
    const rect = ART_RECTS[id];
    drawArtStrip(ctx, art, art.idle, rect.idle.x, rect.idle.y, `${id}.idle`);
    drawArtStrip(ctx, art, art.run, rect.run.x, rect.run.y, `${id}.run`);
  }
  ART_SHEET = cv;
  return ART_SHEET;
}

// One strip of frames, laid left to right from (ox, oy). A map that doesn't
// match the creature's declared size, or that names a colour the palette hasn't
// got, throws HERE — at build time, with the frame's name — rather than quietly
// packing a ragged sheet that every rect after it would then read off by a few
// pixels.
function drawArtStrip(ctx, art, frames, ox, oy, label) {
  for (let f = 0; f < frames.length; f++) {
    const map = frames[f];
    if (map.length !== art.h) throw new Error(`${label}[${f}]: ${map.length} rows, expected ${art.h}`);
    for (let y = 0; y < map.length; y++) {
      if (map[y].length !== art.w) throw new Error(`${label}[${f}] row ${y}: ${map[y].length} px, expected ${art.w}`);
      for (let x = 0; x < map[y].length; x++) {
        const key = map[y][x];
        if (key === ".") continue;
        const color = art.palette[key];
        if (!color) throw new Error(`${label}[${f}] row ${y}: no palette entry '${key}'`);
        ctx.fillStyle = color;
        ctx.fillRect(ox + f * art.w + x, oy + y, 1, 1);
      }
    }
  }
}

window.Incanto.spriteArt = { PIXEL_ART, ART_RECTS, artSheet };
