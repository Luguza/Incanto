"use strict";
// ==============================================================================
// tavern.js — the tavern screen: the game's home room, and the place its
// navigation is meant to grow into. The little mage idles and walks around a
// warm room while the tavern's own people stand at their stations — the smith at
// her anvil, the keeper behind the bar, the scholar at her books, a maid
// carrying drinks between the tables. Tapping a station walks the mage over and
// hands off to that phase, so "go and study" is something that HAPPENS IN THE
// ROOM rather than only on the bar below it.
//
// The room is its own scene: it bakes its own frames from the shared sprite
// sheet and its own furniture procedurally (there is no tavern art on a dungeon
// tileset), rather than borrowing combat's `scene`/`ASSETS`, so the corridor and
// the tavern can be worked on without colliding.
//
// Owns: tavern (scene state), TAV (baked art), renderTavernFull,
// patchTavernContinuous, tavernGo. Everything here is animation and layout —
// nothing in `state` belongs to it except `state.screen`.
// ==============================================================================

// Scene state: canvas, integer pixel scale, room geometry, actors, props.
let tavern = null;
// Baked art: cast frame sets, furniture canvases, glows. Built once, lazily.
let TAV = null;

// The room's palette IS the sprite sheet's palette. Every colour below was
// sampled out of assets/dungeon_tiles.png, because the furniture in this room is
// the only art in the game that isn't cut from that sheet — and a hand-mixed
// brown next to 0x72's browns is exactly what makes a drawn-in prop look pasted
// on. The sheet's own idiom comes with it: a hard #222222 outline round every
// object, a three-step ramp per material, and one bright edge where the light
// lands. Nothing here invents a shade.
const TAV_PAL = {
  ink: "#222222",        // the outline every object on the sheet wears
  pit: "#111111",        // deepest recess (a firebox, the inside of a case)
  wood: "#8f4029",       // plank
  woodDark: "#62232f",   // plank seam / shadow
  woodLit: "#c56025",    // plank, lit
  woodEdge: "#ee8e2e",   // the bright edge the sheet puts on lit wood and brass
  gold: "#facb3e",
  stone: "#483b3a",      // wall and floor base
  stoneLit: "#775c55",
  stoneHi: "#aa8d7a",
  bone: "#d3bfa9",
  steel: "#b6cbcf",
  white: "#fdf7ed",
  red: "#9f294e", redLit: "#da4e38",
  green: "#3d734f", greenLit: "#4ba747",
  blue: "#5956bd", blueLit: "#5698cc",
  teal: "#72d6ce",
};

// Room geometry, in the sheet's own 16px tiles.
//
// The wall is FOUR rows, and that is the door's doing. The sheet's gate is 35 px
// tall and the cap row costs 16 of them, so a three-row wall leaves 32 px of
// brick face for a 35 px door: the arch ends up jammed under the cap with its
// crown flattened against the ledge. Four rows give the doorway a course of
// brick above it, which is what an opening set into a wall looks like — and the
// hearth, which is nearly as tall, stops clipping the cap for the same reason.
// Anything hung on this wall has to fit inside `TAV_WALL_H - TILE`.
const TAV_WALL_ROWS = 4;                    // 1 cap row + 3 rows of brick face
const TAV_FLOOR_Y = TAV_WALL_ROWS * TILE;   // wall → floor line, in art px
const TAV_WALK_MS = 0.024;                  // art px per ms — an unhurried stroll

// Frame rects for the tavern's cast, lifted from assets/tiles_list.txt. The mage
// is the hero's own sprite (wizzard_m), so the figure wandering the room is
// recognisably the one who walks the corridor.
const TAV_CAST_SHEET = {
  mage:    { idle: { x: 128, y: 170, w: 16, h: 22, f: 4 }, run: { x: 192, y: 170, w: 16, h: 22, f: 4 } },
  smith:   { idle: { x: 128, y: 106, w: 16, h: 22, f: 4 }, run: { x: 192, y: 106, w: 16, h: 22, f: 4 } },
  keeper:  { idle: { x: 128, y: 42,  w: 16, h: 22, f: 4 }, run: { x: 192, y: 42,  w: 16, h: 22, f: 4 } },
  scholar: { idle: { x: 128, y: 132, w: 16, h: 28, f: 4 }, run: { x: 192, y: 132, w: 16, h: 28, f: 4 } },
  maid:    { idle: { x: 128, y: 16,  w: 16, h: 16, f: 4 }, run: { x: 192, y: 16,  w: 16, h: 16, f: 4 } },
  guest:   { idle: { x: 128, y: 205, w: 16, h: 19, f: 4 }, run: { x: 192, y: 205, w: 16, h: 19, f: 4 } },
  guest2:  { idle: { x: 128, y: 74,  w: 16, h: 22, f: 4 }, run: { x: 192, y: 74,  w: 16, h: 22, f: 4 } },
};

// Bottles for the bar top — the sheet's flasks, which read as tavern glassware
// once they stand on a counter instead of in a dungeon.
const TAV_FLASKS = [
  { x: 288, y: 240, w: 16, h: 16 },
  { x: 304, y: 240, w: 16, h: 16 },
  { x: 320, y: 240, w: 16, h: 16 },
  { x: 336, y: 240, w: 16, h: 16 },
];

// A small painted canvas. `r` is a 1:1 pixel rect — every prop in the room is
// drawn with it at art resolution, so the furniture is pixel art in the same
// grid as the sprites standing next to it.
function tavArt(w, h, draw) {
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(w));
  cv.height = Math.max(1, Math.round(h));
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  draw(ctx, (x, y, rw, rh, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, rw, rh); });
  return cv;
}

const tavFrames = (rect, opts) =>
  Array.from({ length: rect.f || 1 }, (_, i) => cutFrame(tilesetImg, rect, i, opts));

// ---------------------------------------------------------------------------
// The furniture. A dungeon tileset has no tavern in it — no table, no bar, no
// stool — so these are drawn here, once, at load, and blitted like any other
// sprite afterwards. They are drawn the way the SHEET draws a crate: outlined in
// #222222, flat front face, plank seams in the darker wood, one lit edge along
// the top, and a round object given a shallow top ellipse (the sheet's own cue —
// see its column cap and its chest lid). Front-on, never in plan.
// ---------------------------------------------------------------------------
const TP = TAV_PAL;

// A filled ellipse, row by row. Round tops — a table, a stool's seat, a barrel's
// rim — are the one shape a stack of rectangles cannot fake.
function tavOval(r, cx, cy, rx, ry, col) {
  for (let y = -ry; y <= ry; y++) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y / ry) ** 2)));
    if (w <= 0) continue;
    r(cx - w, cy + y, w * 2, 1, col);
  }
}

// The anvil, on the same silhouette the bottom bar's forge icon uses — a slab
// with a horn off the left, a narrow stem, a splayed base — since that shape is
// what makes an anvil an anvil at sixteen pixels. Written as row spans so the
// #222222 outline can be laid around the whole thing before it is filled, which
// is how every object on the sheet is built.
function tavAnvil() {
  const spans = [
    [3, 13], [3, 13], [1, 13], [4, 12],
    [7, 10], [7, 10], [7, 10],
    [4, 12], [2, 14], [2, 14],
  ];
  const shade = [TP.steel, TP.stoneHi, TP.stoneHi, TP.stone,
    TP.stoneLit, TP.stoneLit, TP.stone,
    TP.stoneHi, TP.stoneLit, TP.stone];
  return tavArt(16, 12, (ctx, r) => {
    spans.forEach(([x0, x1], y) => r(x0 - 1, y, x1 - x0 + 2, 3, TP.ink));
    spans.forEach(([x0, x1], y) => r(x0, y + 1, x1 - x0, 1, shade[y]));
  });
}

function tavShelf() {
  const w = 28, h = 48;
  const books = [TP.red, TP.blueLit, TP.green, TP.gold, TP.bone, TP.blue, TP.greenLit];
  return tavArt(w, h, (ctx, r) => {
    r(0, 0, w, h, TP.ink);              // outline
    r(1, 1, w - 2, h - 2, TP.wood);     // carcass
    r(1, 1, w - 2, 1, TP.woodLit);      // lit top
    r(3, 3, w - 6, h - 8, TP.pit);      // the dark inside
    for (let sh = 0; sh < 4; sh++) {
      const plankY = 11 + sh * 10;
      let x = 4, i = 0;
      while (x < w - 5) {
        const bw = 2 + (tileHash(sh, i) % 2);
        const bh = 5 + (tileHash(i + 3, sh) % 3);
        r(x, plankY - bh, bw, bh, books[tileHash(sh * 7 + i, 13) % books.length]);
        // only the odd volume catches the light on its page edge
        if ((tileHash(i, sh + 5) % 4) === 0) r(x, plankY - bh, bw, 1, TP.bone);
        x += bw + 1; i++;
      }
      r(3, plankY, w - 6, 1, TP.woodLit);            // the shelf itself
      r(3, plankY + 1, w - 6, 1, TP.woodDark);
    }
    r(1, h - 4, w - 2, 3, TP.woodDark);              // plinth
  });
}

function tavCounter(w) {
  const h = 20;
  return tavArt(w, h, (ctx, r) => {
    r(0, 0, w, h, TP.ink);              // outline
    r(1, 1, w - 2, 3, TP.wood);         // the top, seen a little from above
    r(1, 1, w - 2, 1, TP.woodLit);      // its lit edge
    r(1, 4, w - 2, 1, TP.woodDark);     // under-lip
    r(1, 5, w - 2, 13, TP.wood);        // front panel
    for (let x = 4; x < w - 2; x += 7) r(x, 6, 1, 11, TP.woodDark);   // plank seams
    r(1, 17, w - 2, 2, TP.woodDark);    // foot rail in shadow
  });
}

function tavTable() {
  return tavArt(26, 19, (ctx, r) => {
    tavOval(r, 13, 5, 13, 5, TP.ink);            // outlined top
    tavOval(r, 13, 5, 12, 4, TP.wood);
    tavOval(r, 13, 4, 10, 3, TP.woodLit);        // the lit half of the top
    r(7, 2, 9, 1, TP.woodEdge);
    r(4, 8, 18, 1, TP.woodDark);                 // the lip's shadow
    r(11, 10, 4, 5, TP.wood);                    // pedestal
    r(11, 10, 1, 5, TP.woodDark);
    tavOval(r, 13, 16, 7, 2, TP.ink);            // foot
    tavOval(r, 13, 16, 6, 1, TP.wood);
  });
}

function tavStool() {
  return tavArt(13, 14, (ctx, r) => {
    tavOval(r, 6, 3, 6, 3, TP.ink);
    tavOval(r, 6, 3, 5, 2, TP.wood);
    tavOval(r, 6, 2, 4, 1, TP.woodLit);
    r(2, 6, 2, 6, TP.woodDark);                  // legs
    r(9, 6, 2, 6, TP.woodDark);
    r(5, 7, 2, 5, TP.wood);
    r(2, 12, 9, 1, TP.ink);
  });
}

function tavBarrel() {
  return tavArt(14, 19, (ctx, r) => {
    r(0, 2, 14, 17, TP.ink);                     // outline
    r(1, 3, 12, 15, TP.wood);                    // body
    r(4, 3, 1, 15, TP.woodDark);                 // staves
    r(9, 3, 1, 15, TP.woodDark);
    r(1, 5, 12, 2, TP.stoneLit);                 // iron hoops
    r(1, 5, 12, 1, TP.stoneHi);
    r(1, 13, 12, 2, TP.stoneLit);
    r(1, 13, 12, 1, TP.stoneHi);
    tavOval(r, 7, 2, 7, 2, TP.ink);              // rim, seen a little from above
    tavOval(r, 7, 2, 6, 1, TP.woodLit);
    r(5, 1, 4, 1, TP.woodEdge);
    r(1, 18, 12, 1, TP.pit);
  });
}

// The hearth is built into the back wall, and its stonework is the wall's own
// ramp so it reads as part of the masonry rather than a block parked against it.
// The firebox is left empty; the fire is drawn per frame, so it flickers.
function tavHearth() {
  const w = 36, h = 44;
  return tavArt(w, h, (ctx, r) => {
    r(0, 0, w, h, TP.ink);
    r(1, 1, w - 2, 5, TP.stoneLit);              // mantel
    r(2, 1, w - 4, 1, TP.stoneHi);
    r(1, 7, w - 2, h - 8, TP.stone);             // surround
    for (let y = 9; y < h - 5; y += 5) {         // courses, as on wall_mid
      r(2, y, w - 4, 1, TP.stoneLit);
      for (let x = 3 + ((y / 5) % 2) * 6; x < w - 3; x += 12) r(x, y - 3, 1, 3, TP.stoneLit);
    }
    r(8, 16, 20, h - 16, TP.pit);                // firebox
    r(10, 13, 16, 3, TP.pit);                    // its arch
    r(13, 11, 10, 2, TP.pit);
    r(7, 15, 22, 1, TP.stoneHi);                 // lintel edge, catching the fire
    r(4, h - 3, 28, 2, TP.stoneLit);             // hearthstone
    r(4, h - 1, 28, 1, TP.ink);
  });
}

function buildTavernArt() {
  const cast = {};
  for (const id in TAV_CAST_SHEET) {
    const c = TAV_CAST_SHEET[id];
    const look = c.filter ? { filter: c.filter } : {};
    const lookL = Object.assign({ flip: true }, look);
    cast[id] = {
      idle: tavFrames(c.idle, look), idleL: tavFrames(c.idle, lookL),
      run: tavFrames(c.run, look), runL: tavFrames(c.run, lookL),
      h: c.idle.h, w: c.idle.w,
    };
  }
  TAV = {
    cast,
    door: cutFrame(tilesetImg, SHEET.doorsAll, 0),
    bannerRed: cutFrame(tilesetImg, SHEET.bannerRed, 0),
    bannerGreen: cutFrame(tilesetImg, SHEET.bannerGreen, 0),
    crate: cutFrame(tilesetImg, SHEET.crate, 0),
    flasks: TAV_FLASKS.map((f) => cutFrame(tilesetImg, f, 0)),
    anvil: tavAnvil(),
    shelf: tavShelf(),
    table: tavTable(),
    stool: tavStool(),
    barrel: tavBarrel(),
    hearth: tavHearth(),
    counter: null,                                  // sized with the room
    shadow: shadowToCanvas(8, 3, 0.42),
    shadowSm: shadowToCanvas(6, 2, 0.36),
    glowFire: glowToCanvas(30, "255, 156, 66", 0.42),
    glowEmber: glowToCanvas(13, "255, 190, 96", 0.55),
    glowCandle: glowToCanvas(9, "255, 214, 132", 0.5),
    glowArcane: glowToCanvas(11, CONFIG.colors.sceneRune.glowRGB, 0.4),
  };
}

// ---------------------------------------------------------------------------
// The room. Everything is placed off the art size, so the same tavern lays
// itself out on a tall phone and a short landscape window alike: x from the
// room's width, y as a fraction of the floor's depth.
// ---------------------------------------------------------------------------
function setupTavern(cv) {
  if (!tilesetImg.complete || !tilesetImg.naturalWidth) return false;
  if (!TAV) buildTavernArt();
  const dpr = window.devicePixelRatio || 1;
  const box = cv.parentElement;
  const cssW = (box && box.clientWidth) || window.innerWidth || 360;
  const cssH = (box && box.clientHeight) || window.innerHeight || 560;
  // Integer device-pixel scale, the same rule the corridor uses: every art pixel
  // renders at exactly `px` device pixels, so nothing is drawn at uneven widths.
  // ~175 art px across is the room's working width: the cast is 16px wide, so a
  // wider room would leave the people too small to read on a phone and the floor
  // too empty to furnish.
  let px = Math.round((cssW * dpr) / 175) || 1;
  px = Math.max(1, Math.min(px, Math.floor((cssH * dpr) / 175) || 1, 12));
  const artW = Math.ceil((cssW * dpr) / px);
  const artH = Math.ceil((cssH * dpr) / px);
  cv.width = artW;
  cv.height = artH;
  cv.style.width = `${(artW * px) / dpr}px`;
  cv.style.height = `${(artH * px) / dpr}px`;

  const floorY = TAV_FLOOR_Y;
  const depth = Math.max(60, artH - floorY);
  const fy = (frac) => Math.round(floorY + depth * frac);

  // --- where everything stands -------------------------------------------
  // Four corners of business: the forge back left, the bar across the middle,
  // the door out to the corridor up on the right, and the books down in the
  // right-hand corner. The open floor between them is what the mage strolls
  // across and what the tables are scattered over.
  const hearthX = 6;
  const doorX = Math.max(hearthX + 46, artW - 70);
  const counterW = Math.max(52, Math.min(88, Math.round(artW * 0.46)));
  const counterX = Math.round(artW * 0.28);
  const counterY = fy(0.26);                       // top plank, in art px
  const counterFeet = counterY + 20;
  const shelfX = artW - 32;
  const shelfFeet = fy(0.80);
  const bottleX = counterX + 2;                    // the plank of bottles, on the wall
  const bannerX = doorX > 132 ? 100 : 0;           // only where the wall has room for it

  TAV.counter = tavCounter(counterW);

  // Furniture that stands ON the floor: drawn in the depth-sorted pass with the
  // people, so the mage can walk behind a table and in front of the next one.
  const props = [
    // the forge corner
    { art: TAV.anvil, x: Math.round(artW * 0.05), feet: fy(0.11) },
    { art: TAV.crate, x: Math.round(artW * 0.05) + 46, feet: fy(0.06) },
    { art: TAV.barrel, x: Math.round(artW * 0.05), feet: fy(0.20) },
    // the bar
    { art: TAV.barrel, x: counterX + counterW + 2, feet: counterY + 4 },
    { art: TAV.crate, x: doorX - 22, feet: fy(0.12) },
    { art: TAV.counter, x: counterX, feet: counterFeet },
    { art: TAV.stool, x: counterX + 6, feet: counterFeet + 11 },
    { art: TAV.stool, x: counterX + counterW - 24, feet: counterFeet + 12 },
    // the tables
    { art: TAV.table, x: Math.round(artW * 0.03), feet: fy(0.48), candle: true },
    { art: TAV.stool, x: Math.round(artW * 0.03) + 24, feet: fy(0.52) },
    { art: TAV.table, x: Math.round(artW * 0.44), feet: fy(0.64), candle: true },
    { art: TAV.stool, x: Math.round(artW * 0.44) + 24, feet: fy(0.68) },
    { art: TAV.stool, x: Math.round(artW * 0.44) - 12, feet: fy(0.67) },
    // the reading corner
    { art: TAV.shelf, x: shelfX, feet: shelfFeet },
    { art: TAV.table, x: artW - 76, feet: fy(0.94), candle: true },
    { art: TAV.stool, x: artW - 88, feet: fy(0.97) },
    // odds and ends
    { art: TAV.barrel, x: Math.round(artW * 0.06), feet: fy(0.86) },
    { art: TAV.crate, x: Math.round(artW * 0.22), feet: fy(0.92) },
  ];
  for (const p of props) {
    p.w = p.art.width; p.h = p.art.height;
    // What the mage may not walk through: the prop's own footprint, widened a
    // little so he rounds a table rather than clipping its corner.
    p.block = { x0: p.x - 3, x1: p.x + p.w + 3, y0: p.feet - Math.min(p.h, 14), y1: p.feet + 7 };
  }

  const walk = {
    x0: 10, x1: artW - 10,
    y0: floorY + Math.round(depth * 0.16),
    y1: floorY + Math.round(depth * 0.98),
  };

  // Where the mage plants to use a station. Authored by hand and then nudged out
  // of the furniture, because a stand point that lands inside a stool is a walk
  // that can never finish — the layout shifts with the room's size, so the spot
  // has to be checked rather than trusted.
  const freeSpot = (x, y) => {
    for (let i = 0; i < 8; i++) {
      const cy = Math.min(walk.y1, Math.max(walk.y0, y + i * 7));
      const cx = Math.min(walk.x1, Math.max(walk.x0, x));
      if (!tavBlockedIn(props, walk, cx, cy)) return { x: cx, y: cy };
    }
    return { x: Math.min(walk.x1, Math.max(walk.x0, x)), y: Math.min(walk.y1, Math.max(walk.y0, y)) };
  };

  // --- the stations, and where the mage stands to use one -----------------
  const stations = [
    {
      id: "forge", name: "Schmiede", phase: "upgrade",
      x: Math.round(artW * 0.05) + 9, y: fy(0.11),
      stand: freeSpot(Math.round(artW * 0.05) + 12, fy(0.11) + 16), face: -1,
    },
    {
      id: "bar", name: "Schänke", phase: null,
      x: counterX + counterW / 2, y: counterFeet,
      stand: freeSpot(counterX + counterW / 2, counterFeet + 20), face: 1,
    },
    {
      id: "hall", name: "Gang", phase: "combat",
      x: doorX + 32, y: floorY + 3,
      stand: freeSpot(doorX + 32, floorY + Math.round(depth * 0.18)), face: 1,
    },
    {
      id: "study", name: "Bücherei", phase: "study",
      x: shelfX + 14, y: shelfFeet,
      stand: freeSpot(shelfX - 26, shelfFeet + 10), face: 1,
    },
  ];

  // --- the room's people ---------------------------------------------------
  // Three stand at their post and one carries drinks around; the mage is the
  // player's own figure and wanders the whole open floor.
  const actor = (cast, x, y, extra) => Object.assign({
    cast, x, y, tx: x, ty: y, facing: 1, moving: false,
    waitUntil: 0, goal: null, arriveAt: 0, phase: tileHash(x | 0, y | 0) % 4,
    roam: null, speed: TAV_WALK_MS,
  }, extra || {});

  const mage = actor("mage", Math.round(artW * 0.5), fy(0.42), {
    roam: walk, wander: true, waitUntil: 0,
  });
  const people = [
    actor("smith", Math.round(artW * 0.05) + 28, fy(0.10), { facing: -1 }),
    // Behind the bar: his feet are above the counter's, so the depth sort draws
    // the counter over his legs and he reads as standing behind it.
    actor("keeper", counterX + Math.round(counterW * 0.6), counterY + 6, { facing: 1 }),
    actor("scholar", shelfX - 12, shelfFeet + 3, { facing: 1 }),
    actor("guest", counterX + 22, counterFeet + 13, { facing: 1 }),
    actor("guest2", Math.round(artW * 0.03) + 30, fy(0.50), { facing: -1 }),
    actor("maid", Math.round(artW * 0.5), fy(0.72), {
      wander: true, speed: TAV_WALK_MS * 1.15,
      roam: { x0: 16, x1: artW - 26, y0: fy(0.34), y1: fy(0.96) },
    }),
  ];

  tavern = {
    cv, artW, artH, px, dpr, floorY, depth,
    cssScale: px / dpr,
    props, stations, walk, mage, people,
    hearth: { x: hearthX, y: floorY + 2 - TAV.hearth.height },
    door: { x: doorX, y: floorY + 3 - TAV.door.height },
    bottleX, bannerX, counterX, counterW, counterY,
    focus: null,
    lastNow: 0,
    bg: null,
    vignette: null,
  };
  tavern.bg = buildTavernBg();
  tavern.vignette = buildTavernVignette();
  return true;
}

// The room, baked once: walls, boards, the rug, and everything hanging on the
// wall. Only what moves or what the mage can walk around is left to the frame.
function buildTavernBg() {
  const { artW, artH, floorY } = tavern;
  const cv = document.createElement("canvas");
  cv.width = artW; cv.height = artH;
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const blit = (rect, dx, dy) =>
    ctx.drawImage(tilesetImg, rect.x, rect.y, rect.w, rect.h, dx, dy, rect.w, rect.h);
  const rect = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };

  rect(0, 0, artW, artH, "#120d18");
  const cols = Math.ceil(artW / TILE);
  for (let c = 0; c < cols; c++) {
    blit(SHEET.wallTopMid, c * TILE, 0);
    for (let y = TILE; y < floorY; y += TILE) blit(SHEET.wallMid, c * TILE, y);
  }
  for (let r = 0; r * TILE + floorY < artH; r++) {
    for (let c = 0; c < cols; c++) {
      const h = tileHash(r, c);
      const tile = h % 4 === 0 ? SHEET.floors[1 + (h % (SHEET.floors.length - 1))] : SHEET.floors[0];
      blit(tile, c * TILE, floorY + r * TILE);
    }
  }
  // Floorboards: the dungeon's flagstones washed with wood and lined, so the
  // tavern reads as a built room rather than the corridor with furniture in it.
  ctx.save();
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = "rgba(96, 58, 28, 0.42)";
  ctx.fillRect(0, floorY, artW, artH - floorY);
  ctx.restore();
  for (let y = floorY + 7; y < artH; y += 8) rect(0, y, artW, 1, "rgba(20, 12, 8, 0.35)");

  // The wall→floor contact shadow.
  for (let y = 0; y < 7; y++) rect(0, floorY + y, artW, 1, `rgba(0, 0, 0, ${(0.45 * (1 - y / 7)).toFixed(3)})`);

  // The rug: the middle of the room, with the tables scattered over it.
  const rugX = Math.round(artW * 0.16), rugW = Math.round(artW * 0.66);
  const rugY = tavern.floorY + Math.round(tavern.depth * 0.44), rugH = Math.round(tavern.depth * 0.3);
  rect(rugX, rugY, rugW, rugH, TP.ink);
  rect(rugX + 1, rugY + 1, rugW - 2, rugH - 2, TP.red);
  rect(rugX + 3, rugY + 3, rugW - 6, rugH - 6, TP.woodDark);
  for (let x = rugX + 9; x < rugX + rugW - 10; x += 11) rect(x, rugY + 7, 4, rugH - 14, TP.red);
  for (let x = rugX + 4; x < rugX + rugW - 5; x += 6) {
    rect(x, rugY + 2, 3, 1, TP.gold);
    rect(x, rugY + rugH - 3, 3, 1, TP.gold);
  }

  // Hanging on the wall: the hearth, the door out to the corridor, the plank of
  // bottles over the bar, and — only where the wall has the room for them, since
  // a narrow phone's wall is already full — a pair of banners.
  ctx.drawImage(TAV.hearth, tavern.hearth.x, tavern.hearth.y);
  ctx.drawImage(TAV.door, tavern.door.x, tavern.door.y);
  if (tavern.bannerX) {
    blit(SHEET.bannerRed, tavern.bannerX, TILE);
    blit(SHEET.bannerGreen, tavern.bannerX + TILE, TILE);
  }
  const bx = tavern.bottleX, bw = Math.min(46, Math.max(24, tavern.counterW - 8));
  rect(bx, floorY - 14, bw, 1, TP.woodLit);
  rect(bx, floorY - 13, bw, 1, TP.wood);
  rect(bx, floorY - 12, bw, 1, TP.ink);
  TAV.flasks.forEach((fl, i) => {
    if (bx + 1 + i * 11 + 16 <= bx + bw) ctx.drawImage(fl, bx + 1 + i * 11, floorY - 26);
  });

  // A gentle overall darken so the fire and the candles read as the light.
  rect(0, 0, artW, artH, "rgba(12, 7, 16, 0.16)");
  // …and a wash of hearth-warmth over the whole room, strongest up by the fire.
  const warm = ctx.createLinearGradient(0, floorY, artW * 0.9, artH);
  warm.addColorStop(0, "rgba(255, 150, 60, 0.10)");
  warm.addColorStop(1, "rgba(120, 90, 200, 0.05)");
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, artW, artH);
  return cv;
}

function buildTavernVignette() {
  const { artW, artH } = tavern;
  const cv = document.createElement("canvas");
  cv.width = artW; cv.height = artH;
  const ctx = cv.getContext("2d");
  const band = (grad, x, y, w, h) => { ctx.fillStyle = grad; ctx.fillRect(x, y, w, h); };
  const vl = ctx.createLinearGradient(0, 0, 22, 0);
  vl.addColorStop(0, "rgba(8, 5, 12, 0.6)"); vl.addColorStop(1, "rgba(8, 5, 12, 0)");
  band(vl, 0, 0, 22, artH);
  const vr = ctx.createLinearGradient(artW - 22, 0, artW, 0);
  vr.addColorStop(0, "rgba(8, 5, 12, 0)"); vr.addColorStop(1, "rgba(8, 5, 12, 0.6)");
  band(vr, artW - 22, 0, 22, artH);
  const vb = ctx.createLinearGradient(0, artH - 26, 0, artH);
  vb.addColorStop(0, "rgba(8, 5, 12, 0)"); vb.addColorStop(1, "rgba(8, 5, 12, 0.58)");
  band(vb, 0, artH - 26, artW, 26);
  return cv;
}

// ---------------------------------------------------------------------------
// Walking. Nobody in the room teleports: a tap sets a destination and the figure
// walks to it, rounding the furniture on the way.
// ---------------------------------------------------------------------------
// Is (x, y) somewhere a figure may stand? Takes its props and bounds as
// arguments so setupTavern can ask it while the room is still being built (the
// stand points are checked before `tavern` exists).
function tavBlockedIn(props, walk, x, y) {
  if (x < walk.x0 || x > walk.x1 || y < walk.y0 || y > walk.y1) return true;
  for (const p of props) {
    const b = p.block;
    if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) return true;
  }
  return false;
}

function tavBlocked(x, y) {
  return tavern ? tavBlockedIn(tavern.props, tavern.walk, x, y) : false;
}

// A free spot inside `roam` to stroll to. Tries a handful of times and gives up
// rather than looping — a frame with nowhere to go simply waits another beat.
function tavPickSpot(roam) {
  for (let i = 0; i < 14; i++) {
    const x = roam.x0 + Math.random() * (roam.x1 - roam.x0);
    const y = roam.y0 + Math.random() * (roam.y1 - roam.y0);
    if (!tavBlocked(x, y)) return { x, y };
  }
  return null;
}

function tavUpdateActor(a, now, dt) {
  // Arrived at a station a tap sent them to: hold a beat on the spot, then hand
  // the phase over. The pause is what makes the walk read as going somewhere.
  if (a.arriveAt && now >= a.arriveAt) {
    const goal = a.goal;
    a.goal = null; a.arriveAt = 0;
    if (goal && goal.phase) { tavern.focus = null; navTo(goal.phase); return; }
  }
  if (a.moving) {
    const dx = a.tx - a.x, dy = a.ty - a.y;
    const dist = Math.hypot(dx, dy);
    // Somewhere to BE is walked at a purpose; an idle stroll is not. The player
    // asked for a phase, so the mage doesn't dawdle on his way to it.
    const step = a.speed * (a.goal ? 2.6 : 1) * dt;
    if (dist <= Math.max(step, 0.8)) {
      a.x = a.tx; a.y = a.ty; a.moving = false;
      if (a.goal) {
        a.facing = a.goal.face || a.facing;
        a.arriveAt = now + 240;
      } else {
        a.waitUntil = now + 700 + Math.random() * 2400;
      }
      return;
    }
    const nx = a.x + (dx / dist) * step, ny = a.y + (dy / dist) * step;
    // Slide along whichever axis is free rather than walking into a table; if
    // both are blocked the destination is unreachable, so give it up. Standing
    // inside something is the one case that ignores all of it and simply walks
    // out — a room rebuilt at another size can leave a figure inside a stool
    // that wasn't there a frame ago, and being stuck for ever is not an option.
    if (tavBlocked(a.x, a.y)) { a.x = nx; a.y = ny; }
    else if (!tavBlocked(nx, ny)) { a.x = nx; a.y = ny; }
    else if (!tavBlocked(nx, a.y)) { a.x = nx; }
    else if (!tavBlocked(a.x, ny)) { a.y = ny; }
    else { a.moving = false; a.goal = null; a.waitUntil = now + 500; return; }
    if (Math.abs(dx) > 1.5) a.facing = dx > 0 ? 1 : -1;
    return;
  }
  if (!a.wander || a.goal || now < a.waitUntil) return;
  const spot = tavPickSpot(a.roam);
  if (!spot) { a.waitUntil = now + 900; return; }
  a.tx = spot.x; a.ty = spot.y; a.moving = true;
}

// A tap on a station: walk the mage over, and (for the three that lead
// somewhere) hand off to that phase when he gets there.
function tavernGo(id) {
  if (!tavern) return;
  const st = tavern.stations.find((s) => s.id === id);
  if (!st) return;
  const m = tavern.mage;
  m.tx = st.stand.x; m.ty = st.stand.y;
  m.goal = st; m.arriveAt = 0; m.waitUntil = 0;
  m.moving = Math.hypot(m.x - m.tx, m.y - m.ty) > 1.2;
  if (!m.moving) { m.facing = st.face || m.facing; m.arriveAt = performance.now() + 200; }
  tavern.focus = st.id;
}

// A tap on the floor itself: the mage strolls there. The room is walkable, not
// just a backdrop with buttons on it.
function tavernTapPoint(artX, artY) {
  if (!tavern) return;
  // A tap near a station counts as tapping the station, so the door and the
  // anvil are hit targets in the picture and not only chips above it.
  for (const st of tavern.stations) {
    if (Math.abs(artX - st.x) < 22 && artY > st.y - 34 && artY < st.y + 14) { tavernGo(st.id); return; }
  }
  // A tap that lands ON something walks to the nearest clear floor instead of
  // being swallowed: the thumb aimed at a place, not at a pixel.
  let tx = artX, ty = artY;
  if (tavBlocked(tx, ty)) {
    const spot = [[0, 14], [0, -14], [-18, 0], [18, 0], [-18, 14], [18, 14], [0, 28]]
      .map(([dx, dy]) => ({ x: artX + dx, y: artY + dy }))
      .find((q) => !tavBlocked(q.x, q.y));
    if (!spot) return;
    tx = spot.x; ty = spot.y;
  }
  const m = tavern.mage;
  m.tx = tx; m.ty = ty; m.goal = null; m.arriveAt = 0; m.waitUntil = 0; m.moving = true;
  tavern.focus = null;
}

function onTavernCanvasTap(e) {
  if (!tavern) return;
  const r = tavern.cv.getBoundingClientRect();
  tavernTapPoint(
    ((e.clientX - r.left) / r.width) * tavern.artW,
    ((e.clientY - r.top) / r.height) * tavern.artH
  );
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
function drawTavernActor(ctx, a, now) {
  const skin = TAV.cast[a.cast];
  if (!skin) return;
  const set = a.moving ? (a.facing < 0 ? skin.runL : skin.run) : (a.facing < 0 ? skin.idleL : skin.idle);
  const f = Math.floor(now / (a.moving ? 110 : 170) + a.phase) % set.length;
  const x = Math.round(a.x - skin.w / 2), y = Math.round(a.y - skin.h);
  ctx.drawImage(TAV.shadowSm, Math.round(a.x) - TAV.shadowSm.width / 2, Math.round(a.y) - 2);
  ctx.drawImage(set[f], x, y);
}

function renderTavern(now) {
  const cv = tavern.cv;
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tavern.bg, 0, 0);

  // The fire in the hearth — the room's light source, and the one thing in the
  // tavern that is never still. Two logs, three tongues of flame on their own
  // clocks, embers, and the pool it throws across the boards.
  const hx = tavern.hearth.x + 17, hy = tavern.hearth.y + TAV.hearth.height - 6;
  ctx.fillStyle = TP.woodDark;
  ctx.fillRect(hx - 9, hy - 2, 18, 3);
  ctx.fillRect(hx - 6, hy - 5, 13, 3);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 3; i++) {
    const t = Math.sin(now / (140 + i * 47) + i * 1.9);
    const h = 12 - i * 2 + t * 3;
    const w = 7 - i * 2;
    const fx = hx - 5 + i * 5 + t * 1.2;
    ctx.fillStyle = `rgba(255, ${120 + i * 45}, ${30 + i * 40}, 0.85)`;
    ctx.fillRect(Math.round(fx - w / 2), Math.round(hy - 3 - h), w, Math.round(h));
  }
  ctx.fillStyle = "rgba(255, 240, 190, 0.95)";     // white-hot heart of it
  ctx.fillRect(hx - 2, Math.round(hy - 9 - Math.abs(Math.sin(now / 160)) * 2), 5, 7);
  ctx.globalAlpha = 0.75 + 0.25 * Math.sin(now / 190);
  ctx.drawImage(TAV.glowFire, hx - 30, hy - 36);
  ctx.globalAlpha = 0.8 + 0.2 * Math.sin(now / 120 + 1.4);
  ctx.drawImage(TAV.glowEmber, hx - 13, hy - 17);
  ctx.globalAlpha = 1;
  ctx.restore();
  // Firelight spilling out onto the floor in front of the hearth.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.22 + 0.06 * Math.sin(now / 240);
  const spill = ctx.createLinearGradient(0, tavern.floorY, 0, tavern.floorY + 46);
  spill.addColorStop(0, "rgba(255, 158, 70, 0.55)");
  spill.addColorStop(1, "rgba(255, 158, 70, 0)");
  ctx.fillStyle = spill;
  ctx.fillRect(tavern.hearth.x - 8, tavern.floorY, 50, 46);
  ctx.restore();

  // Everything standing on the floor, back to front: a figure lower down the
  // room is nearer the camera, so it draws over what is behind it.
  const drawables = [];
  for (const p of tavern.props) drawables.push({ y: p.feet, p });
  for (const a of tavern.people) drawables.push({ y: a.y, a });
  drawables.push({ y: tavern.mage.y, a: tavern.mage });
  drawables.sort((u, v) => u.y - v.y);

  // The station the mage is on his way to, lit on the floor under his feet.
  if (tavern.focus) {
    const st = tavern.stations.find((s) => s.id === tavern.focus);
    if (st) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 260);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.35 + pulse * 0.4;
      ctx.drawImage(TAV.glowArcane, st.stand.x - 11, st.stand.y - 11);
      ctx.restore();
    }
  }

  for (const d of drawables) {
    if (d.a) { drawTavernActor(ctx, d.a, now); continue; }
    const p = d.p;
    ctx.drawImage(TAV.shadow, Math.round(p.x + p.w / 2 - TAV.shadow.width / 2), Math.round(p.feet - 3));
    ctx.drawImage(p.art, Math.round(p.x), Math.round(p.feet - p.h));
    if (p.candle) {
      // A candle on the table: a stub, a flame, and the light it throws.
      const cx = Math.round(p.x + p.w / 2), cy = Math.round(p.feet - p.h + 1);
      ctx.fillStyle = TP.white; ctx.fillRect(cx - 1, cy - 4, 2, 4);
      ctx.fillStyle = TP.bone; ctx.fillRect(cx, cy - 3, 1, 3);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(255, 226, 150, 0.95)";
      ctx.fillRect(cx - 1, cy - 7 - (Math.sin(now / 170 + p.x) > 0 ? 1 : 0), 2, 3);
      ctx.globalAlpha = 0.7 + 0.3 * Math.sin(now / 210 + p.x);
      ctx.drawImage(TAV.glowCandle, cx - 9, cy - 15);
      ctx.restore();
    }
  }

  // The room's own edges, pinned over everything.
  ctx.drawImage(tavern.vignette, 0, 0);
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
function renderTavernFull() {
  app.innerHTML = `
    <div class="screen tavern-screen" id="tavern-root">
      <header class="tav-top">
        <span class="tav-title">Zur Rostigen Rune</span>
        <span class="tav-gold"><span class="coin">◈</span> ${state.gold}</span>
      </header>
      <div class="tav-stage" id="tav-stage">
        <canvas class="tav-scene" id="tav-scene"></canvas>
        <div class="tav-chips" id="tav-chips"></div>
      </div>
    </div>`;
  tavern = null;                       // the canvas is new, so the room is rebuilt on it
  const cv = document.getElementById("tav-scene");
  if (cv) cv.addEventListener("click", onTavernCanvasTap);
  if (setupTavern(cv)) placeTavernChips();
}

// The station labels: DOM chips over the canvas rather than text drawn into it,
// so they stay crisp at any scale and go through the same delegated dispatch as
// every other button in the game.
function placeTavernChips() {
  const host = document.getElementById("tav-chips");
  if (!host || !tavern) return;
  const s = tavern.cssScale;
  host.innerHTML = tavern.stations.map((st) => {
    const left = (st.x * s).toFixed(1), top = ((st.y - 30) * s).toFixed(1);
    return `<button class="tav-chip${st.phase ? "" : " flavour"}" data-act="tavernGo"
      data-args='["${st.id}"]' data-station="${st.id}"
      style="left:${left}px; top:${top}px">${st.name}</button>`;
  }).join("");
  // A chip is centred on the thing it names, so one at the room's edge would
  // hang off the screen — the door and the bookshelf both stand right against a
  // wall. Measured after insertion and pulled back inside the stage.
  const stageW = host.clientWidth;
  for (const el of host.children) {
    const half = el.offsetWidth / 2 + 6;
    el.style.left = `${Math.min(Math.max(parseFloat(el.style.left), half), stageW - half).toFixed(1)}px`;
  }
}

function patchTavernContinuous(now) {
  const cv = document.getElementById("tav-scene");
  if (!cv) return;
  if (!tavern || tavern.cv !== cv) {
    if (!setupTavern(cv)) return;      // sheet still loading — try again next frame
    placeTavernChips();
  }
  const dt = tavern.lastNow ? Math.min(64, now - tavern.lastNow) : 16;
  tavern.lastNow = now;
  for (const a of tavern.people) tavUpdateActor(a, now, dt);
  tavUpdateActor(tavern.mage, now, dt);
  if (state.screen !== "tavern") return;   // a station handed off mid-frame
  renderTavern(now);
  const chips = document.getElementById("tav-chips");
  if (chips) {
    for (const el of chips.children) {
      el.classList.toggle("on", el.dataset.station === tavern.focus);
    }
  }
}

window.Incanto.tavern = {
  renderTavernFull, patchTavernContinuous, tavernGo, tavernTapPoint, setupTavern,
};
