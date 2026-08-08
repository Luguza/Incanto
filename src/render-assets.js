"use strict";
// ==============================================================================
// render-assets.js — sprite sheet, palettes, and baked canvas assets. Owns:
// TILE/SHEET/FIREBALL_SPRITE, drawSpritePx, spriteToCanvas, glow/shadowToCanvas,
// tileHash, cutFrame, recolorStaffGem, buildAssets, ASSETS.
// ==============================================================================

// ---------------------------------------------------------------------------
// Pixel-art dungeon scene.
// DECISION: scene art comes from a professional CC0 sprite sheet
// (assets/dungeon_tiles.png — "16x16 DungeonTileset II" by 0x72, coordinates
// in assets/tiles_list.txt). Frames are prerendered to offscreen canvases and
// composited each frame onto a <canvas> whose backing store is sized for
// INTEGER device-pixel scaling (a fractional scale makes art pixels render at
// uneven widths — the "warped" look). Idle/fountain animations play from the
// sheet's own frames; the fireball and glows remain procedural.
// ---------------------------------------------------------------------------
const TILE = 16;
// Scene geometry, in tile rows. A taller wall (one top-cap row + several mid
// rows) gives the arena more vertical presence; the floor rows sit below it.
const WALL_ROWS = 2;   // 1 top-cap row + 1 mid row of wall face (kept low)
const FLOOR_ROWS = 3;  // floor rows below the wall (roomy foreground)
const FLOOR_Y = WALL_ROWS * TILE;                    // wall→floor transition line
const SCENE_H = (WALL_ROWS + FLOOR_ROWS) * TILE;     // native art pixel height

// Frame rects in assets/dungeon_tiles.png (from tiles_list.txt)
const SHEET = {
  wallTopMid: { x: 32, y: 0, w: 16, h: 16 },
  wallMid: { x: 32, y: 16, w: 16, h: 16 },
  wallColumnTop: { x: 96, y: 80, w: 16, h: 16 },
  wallColumnMid: { x: 96, y: 96, w: 16, h: 16 },
  wallColumnBase: { x: 96, y: 112, w: 16, h: 16 },
  fountainTop: { x: 64, y: 0, w: 16, h: 16 },
  fountainMidRed: { x: 64, y: 16, w: 16, h: 16, f: 3 },
  fountainBasinRed: { x: 64, y: 32, w: 16, h: 16, f: 3 },
  bannerRed: { x: 16, y: 32, w: 16, h: 16 },
  bannerGreen: { x: 16, y: 48, w: 16, h: 16 },
  floors: [
    { x: 16, y: 64, w: 16, h: 16 },
    { x: 32, y: 64, w: 16, h: 16 },
    { x: 48, y: 64, w: 16, h: 16 },
    { x: 16, y: 80, w: 16, h: 16 },
    { x: 32, y: 96, w: 16, h: 16 },
  ],
  skull: { x: 288, y: 320, w: 16, h: 16 },
  crate: { x: 288, y: 298, w: 16, h: 22 },
  wizardIdle: { x: 128, y: 170, w: 16, h: 22, f: 4 },
  skeletIdle: { x: 368, y: 80, w: 16, h: 16, f: 4 },
  skeletRun: { x: 432, y: 80, w: 16, h: 16, f: 4 },
  // 0x72 DungeonTileset II magic staff — a wooden shaft capped with a gem; the
  // gem is recolored teal at load so it matches the rune it traces.
  staffMagic: { x: 340, y: 145, w: 8, h: 30 },
  // The door at the far end of the hall — the whole assembled gate (frame +
  // leaf), drawn once, at one fixed metre mark (see encounters.HALL_END_METRES).
  doorsAll: { x: 16, y: 221, w: 64, h: 35 },
};

// ---------------------------------------------------------------------------
// THE BESTIARY'S ART. Every creature the sheet has, as an idle/run frame pair.
// A CONFIG.enemyTypes entry names one of these keys in its `sprite` field and
// then bends it with `scale` / `filter` / `tint`, which is how seventeen drawn
// monsters become the ~30 bodies the hall actually sends in.
//
// Coordinates are lifted verbatim from assets/tiles_list.txt. A few creatures
// ship without a separate run cycle (the sheet lists the same rect twice) — for
// those the run entry deliberately aliases the idle rect rather than inventing
// frames, so a zombie shambles with the same four poses whether it is walking or
// standing. Every rect carries `f` frames laid out horizontally at `w` apart.
// ---------------------------------------------------------------------------
const ENEMY_SPRITES = {
  skelet:      { idle: { x: 368, y: 80,  w: 16, h: 16, f: 4 }, run: { x: 432, y: 80,  w: 16, h: 16, f: 4 } },
  tinyZombie:  { idle: { x: 368, y: 20,  w: 16, h: 12, f: 4 }, run: { x: 432, y: 20,  w: 16, h: 12, f: 4 } },
  goblin:      { idle: { x: 368, y: 37,  w: 16, h: 11, f: 4 }, run: { x: 432, y: 37,  w: 16, h: 11, f: 4 } },
  imp:         { idle: { x: 368, y: 48,  w: 16, h: 16, f: 4 }, run: { x: 432, y: 48,  w: 16, h: 16, f: 4 } },
  muddy:       { idle: { x: 368, y: 112, w: 16, h: 16, f: 4 }, run: { x: 368, y: 112, w: 16, h: 16, f: 4 } },
  swampy:      { idle: { x: 432, y: 112, w: 16, h: 16, f: 4 }, run: { x: 432, y: 112, w: 16, h: 16, f: 4 } },
  zombie:      { idle: { x: 368, y: 144, w: 16, h: 16, f: 4 }, run: { x: 368, y: 144, w: 16, h: 16, f: 4 } },
  iceZombie:   { idle: { x: 432, y: 144, w: 16, h: 16, f: 4 }, run: { x: 432, y: 144, w: 16, h: 16, f: 4 } },
  maskedOrc:   { idle: { x: 368, y: 172, w: 16, h: 20, f: 4 }, run: { x: 432, y: 172, w: 16, h: 20, f: 4 } },
  orcWarrior:  { idle: { x: 368, y: 204, w: 16, h: 20, f: 4 }, run: { x: 432, y: 204, w: 16, h: 20, f: 4 } },
  orcShaman:   { idle: { x: 368, y: 236, w: 16, h: 20, f: 4 }, run: { x: 432, y: 236, w: 16, h: 20, f: 4 } },
  necromancer: { idle: { x: 366, y: 270, w: 16, h: 20, f: 4 }, run: { x: 366, y: 270, w: 16, h: 20, f: 4 } },
  wogol:       { idle: { x: 368, y: 303, w: 16, h: 17, f: 4 }, run: { x: 432, y: 303, w: 16, h: 17, f: 4 } },
  chort:       { idle: { x: 368, y: 328, w: 16, h: 24, f: 4 }, run: { x: 432, y: 328, w: 16, h: 24, f: 4 } },
  bigZombie:   { idle: { x: 16,  y: 270, w: 32, h: 34, f: 4 }, run: { x: 144, y: 270, w: 32, h: 34, f: 4 } },
  ogre:        { idle: { x: 16,  y: 320, w: 32, h: 32, f: 4 }, run: { x: 144, y: 320, w: 32, h: 32, f: 4 } },
  bigDemon:    { idle: { x: 16,  y: 364, w: 32, h: 36, f: 4 }, run: { x: 144, y: 364, w: 32, h: 36, f: 4 } },
};

// The frame rects a variant is drawn from, falling back to bare bone for an
// unknown key so a typo in CONFIG.enemyTypes costs a sprite rather than the
// whole scene.
function enemySprite(type) {
  return ENEMY_SPRITES[(type && type.sprite) || "skelet"] || ENEMY_SPRITES.skelet;
}

const FIREBALL_SPRITE = [
  "....OOO...",
  "..TOYYYO..",
  "TTOYYCCYO.",
  ".TOyYCCYO.",
  "..TOYYYOO.",
  "....OOO...",
];

function drawSpritePx(ctx, map, palette, ox, oy) {
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[y].length; x++) {
      const c = map[y][x];
      if (c !== "." && palette[c]) {
        ctx.fillStyle = palette[c];
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
}

function spriteToCanvas(map, palette) {
  const cv = document.createElement("canvas");
  cv.width = map[0].length;
  cv.height = map.length;
  drawSpritePx(cv.getContext("2d"), map, palette, 0, 0);
  return cv;
}

// Radial glow prerendered once; blitted additively per frame
function glowToCanvas(radius, rgb, maxAlpha) {
  const size = radius * 2 + 1;
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext("2d");
  for (let py = -radius; py <= radius; py++) {
    for (let px = -radius; px <= radius; px++) {
      const dist = Math.sqrt(px * px + py * py);
      if (dist > radius) continue;
      const a = maxAlpha * (1 - dist / radius);
      if (a < 0.015) continue;
      ctx.fillStyle = `rgba(${rgb}, ${a.toFixed(3)})`;
      ctx.fillRect(radius + px, radius + py, 1, 1);
    }
  }
  return cv;
}

// Soft elliptical shadow prerendered once; blitted normally under props/fighters
function shadowToCanvas(rx, ry, maxAlpha) {
  const w = rx * 2 + 1, h = ry * 2 + 1;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d");
  for (let py = -ry; py <= ry; py++) {
    for (let px = -rx; px <= rx; px++) {
      const dist = Math.sqrt((px / rx) ** 2 + (py / ry) ** 2);
      if (dist > 1) continue;
      const a = maxAlpha * (1 - dist);
      if (a < 0.01) continue;
      ctx.fillStyle = `rgba(8, 5, 12, ${a.toFixed(3)})`;
      ctx.fillRect(rx + px, ry + py, 1, 1);
    }
  }
  return cv;
}

// Deterministic hash so tile variation is stable across rebuilds
function tileHash(a, b) {
  let h = (a * 73856093) ^ (b * 19349663);
  h = (h ^ (h >> 13)) * 1274126177;
  return Math.abs(h ^ (h >> 16));
}

// Cut one frame of a sheet entry to its own canvas; optionally flip, run it
// through a CSS `filter` (how a variant gets its own colour), recolor to a flat
// silhouette (for the hit flash), or wash it with a translucent `tint` (for the
// darker variants).
//
// Both recolour paths stay off getImageData, which would taint the canvas under
// file://: the tint is laid over the sprite's own pixels with `source-atop`, so
// the transparent surround is left alone and the silhouette keeps its shape,
// and the hue shift rides on the 2D context's own `filter` — applied here, ONCE
// at load, never on the per-frame draw path.
function cutFrame(img, rect, frame, { flip = false, silhouette = null, tint = null, filter = null } = {}) {
  const cv = document.createElement("canvas");
  cv.width = rect.w;
  cv.height = rect.h;
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  if (flip) {
    ctx.translate(rect.w, 0);
    ctx.scale(-1, 1);
  }
  if (filter) ctx.filter = filter;
  ctx.drawImage(img, rect.x + frame * rect.w, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  ctx.filter = "none";
  if (silhouette) {
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = silhouette;
    ctx.fillRect(flip ? -rect.w : 0, 0, rect.w * 2, rect.h);
  } else if (tint) {
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = tint;
    ctx.fillRect(flip ? -rect.w : 0, 0, rect.w * 2, rect.h);
  }
  return cv;
}

// Shift the staff's green gem to the rune's teal, preserving each pixel's
// brightness so the shine and shading survive. Wood (red-dominant) and the
// cream highlight (unsaturated) are left untouched.
function recolorStaffGem(cv) {
  const ctx = cv.getContext("2d");
  const img = ctx.getImageData(0, 0, cv.width, cv.height);
  const p = img.data;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], g = p[i + 1], b = p[i + 2];
    if (p[i + 3] === 0) continue;
    // green-dominant and reasonably saturated == gem
    if (g > r + 12 && g > b + 12) {
      const lum = (r + g + b) / 3;
      p[i] = Math.round(lum * 0.32);
      p[i + 1] = Math.round(Math.min(255, lum * 1.02));
      p[i + 2] = Math.round(Math.min(255, lum * 1.0));
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

const tilesetImg = new Image();
tilesetImg.src = "assets/dungeon_tiles.png";
tilesetImg.onload = () => {
  scene = null; // force rebuild now that frames can be cut
};

let ASSETS = null;

function buildAssets() {
  const f = CONFIG.colors.fireball;
  const d = CONFIG.colors.dungeon;
  const frames = (rect, opts) =>
    Array.from({ length: rect.f || 1 }, (_, i) => cutFrame(tilesetImg, rect, i, opts));
  ASSETS = {
    wizard: frames(SHEET.wizardIdle),
    staff: recolorStaffGem(cutFrame(tilesetImg, SHEET.staffMagic, 0)),
    skelet: frames(SHEET.skeletIdle, { flip: true }),
    skeletRun: frames(SHEET.skeletRun, { flip: true }),
    skeletHit: frames(SHEET.skeletIdle, { flip: true, silhouette: "#fff3d0" }),
    // Held fast by a Frostkegel: the same bones washed with the frost spell's
    // blue. Drawn OVER the live frame (see drawFrostRime) so the rime follows
    // the body's silhouette instead of sitting on it as a square of ice.
    skeletFrozen: frames(SHEET.skeletIdle, { flip: true, tint: "rgba(121, 216, 238, 0.62)" }),
    door: cutFrame(tilesetImg, SHEET.doorsAll, 0),
    fountainMid: frames(SHEET.fountainMidRed),
    fountainBasin: frames(SHEET.fountainBasinRed),
    fireball: spriteToCanvas(FIREBALL_SPRITE, f),
    glowFountain: glowToCanvas(15, d.glowRGB, d.glowAlpha),
    glowFireball: glowToCanvas(9, f.glowRGB, f.glowAlpha),
    // Large soft light pools the fountains/rune cast across the scene, and
    // grounding shadows for the fighters — the "sharper look" atmosphere pass.
    poolWarm: glowToCanvas(34, d.glowRGB, 0.34),
    poolCool: glowToCanvas(22, CONFIG.colors.sceneRune.glowRGB, 0.30),
    shadow: shadowToCanvas(9, 3, 0.5),
    shadowSm: shadowToCanvas(8, 3, 0.45),
  };
  // ---------------------------------------------------------------------------
  // Per-variant frame sets. Every body in CONFIG.enemyTypes gets FOUR sets baked
  // here — idle, run, the white hit flash, and the frost-rime overlay — because
  // the roster is no longer one 16x16 skeleton in different washes: a chort is
  // 16x24 and an ogre 32x32, so a shared flash or shared rime cut from skeleton
  // art would land on the wrong silhouette entirely.
  //
  // Baking is once-at-load and cheap (a few hundred sub-40px blits), which is
  // the whole reason `filter` lives here rather than on the draw path: the hot
  // loop only ever blits a finished canvas.
  //
  // Variants that share a look share their canvases — keyed by sprite + tint +
  // filter — so three plain-coloured bodies off the same sheet rect cost one set
  // between them.
  // ---------------------------------------------------------------------------
  ASSETS.enemy = {};
  const skinCache = new Map();
  for (const t of CONFIG.enemyTypes) {
    const spr = enemySprite(t);
    const key = `${t.sprite || "skelet"}|${t.tint || ""}|${t.filter || ""}`;
    let skin = skinCache.get(key);
    if (!skin) {
      const look = { flip: true, tint: t.tint || null, filter: t.filter || null };
      skin = {
        idle: frames(spr.idle, look),
        run: frames(spr.run, look),
        // The flash is a flash: it is drawn flat, so it takes the body's shape
        // and nothing else — tinting or hue-shifting it would mute the one
        // thing it exists to show.
        hit: frames(spr.idle, { flip: true, silhouette: "#fff3d0" }),
        // Rime follows the body's own silhouette, so it is cut from the body's
        // own frames rather than from a square of ice laid over them.
        frozen: frames(spr.idle, { flip: true, tint: "rgba(121, 216, 238, 0.62)" }),
      };
      skinCache.set(key, skin);
    }
    ASSETS.enemy[t.id] = skin;
  }
}

window.Incanto.renderAssets = { buildAssets, ENEMY_SPRITES, enemySprite };
