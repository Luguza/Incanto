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

// The room's own palette. Warm woods and brass against the game's cool dark —
// the tavern is the one place in Incanto that is supposed to feel lit.
const TAV_PAL = {
  o: "#150f1c",   // outline / recess
  w: "#5d3a20",   // wood, dark
  W: "#7d5129",   // wood
  L: "#a3703c",   // wood, lit
  s: "#6f7a88",   // steel, dark
  S: "#b8c0cc",   // steel
  H: "#e6ecf3",   // steel highlight
  p: "#f2ead0",   // parchment
  g: "#c9a24a",   // brass / gold
  r: "#8d2f36",   // red leather, cloth
  b: "#33518f",   // blue book
  t: "#2f7a5a",   // green book
  k: "#2b2436",   // stone, dark
  K: "#4a4258",   // stone
  e: "#120a08",   // firebox / soot
};

// Room geometry, in the sheet's own 16px tiles.
//
// THE PERSPECTIVE IS THE CORRIDOR'S. This tileset is drawn flat and side-on: a
// wall is seen face-on and a floor is a SHALLOW band beneath it, three rows deep
// in combat (see render-scene.js), with every figure standing on it at 1:1 — no
// foreshortening, no scaling with depth. A deep floor turns the same tiles into
// a floor plan seen from above, which is the one thing the art can't sell, so
// the tavern is a wide, shallow stage: a tall wall face to hang the hearth, the
// bottles and the door on, and a few rows of boards in front of it to stand on.
// The floor stays shallow whatever the screen and the wall stays a wall — a
// tavern's brick does not run up for ever. What fills the rest of a tall phone
// is the DARK ABOVE: unlit rafters, with the lanterns and the house sign hanging
// out of them on chains. That reads as a high hall instead of a bare warehouse,
// and it costs the perspective nothing, because unlit air has no perspective.
const TAV_WALL_ROWS_MIN = 4;                // 1 cap row + 3 rows of wall face
const TAV_WALL_ROWS_MAX = 6;
const TAV_FLOOR_ROWS_MIN = 3;               // the corridor's own depth …
const TAV_FLOOR_ROWS_MAX = 5;               // … and as deep as this room ever gets
const TAV_ROOM_W_MIN = 165;                 // narrowest the room may be, in art px
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

// The stations, in the order the room reads left to right. WHAT they are is
// fixed here; WHERE they stand is worked out per room in setupTavern, because
// that depends on the size of the screen. Keeping the two apart is what lets the
// board below be laid out before the canvas is measured — the board's height is
// what decides how much stage the room has to fill.
const TAV_STATIONS = [
  { id: "forge", name: "Schmiede", phase: "upgrade", blurb: "Runen setzen" },
  { id: "bar", name: "Schänke", phase: null, blurb: "Ein Krug Ruhe" },
  { id: "hall", name: "Gang", phase: "combat", blurb: "In den Gang" },
  { id: "study", name: "Bücherei", phase: "study", blurb: "Vokabeln üben" },
];

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
// The furniture. None of it exists on the tileset, so it is drawn here — once,
// at load — and blitted like any other sprite afterwards.
// ---------------------------------------------------------------------------
const TP = TAV_PAL;

function tavAnvil() {
  return tavArt(18, 13, (ctx, r) => {
    r(2, 1, 14, 1, TP.H);          // lit top face
    r(1, 2, 15, 3, TP.S);
    r(0, 3, 2, 2, TP.S);           // horn
    r(1, 5, 15, 1, TP.s);
    r(6, 6, 6, 3, TP.s);           // waist
    r(4, 9, 10, 1, TP.S);
    r(3, 10, 12, 2, TP.s);         // base
    r(2, 12, 14, 1, TP.o);
  });
}

function tavShelf() {
  const w = 28, h = 48, books = [TP.r, TP.b, TP.t, TP.g, TP.p];
  return tavArt(w, h, (ctx, r) => {
    r(0, 0, w, h, TP.w);           // carcass
    r(1, 1, w - 2, h - 4, TP.e);   // recess
    for (let s = 0; s < 4; s++) {
      const plankY = 10 + s * 11;
      let x = 2, i = 0;
      while (x < w - 3) {
        const bw = 2 + (tileHash(s, i) % 2);
        const bh = 5 + (tileHash(i + 3, s) % 4);
        r(x, plankY - bh, bw, bh, books[tileHash(s * 7 + i, 13) % books.length]);
        x += bw + 1; i++;
      }
      r(1, plankY, w - 2, 2, TP.W);
      r(1, plankY + 2, w - 2, 1, TP.o);
    }
    r(0, h - 4, w, 3, TP.W);       // plinth
    r(0, h - 1, w, 1, TP.o);
  });
}

function tavCounter(w) {
  const h = 20;
  return tavArt(w, h, (ctx, r) => {
    r(0, 4, w, h - 5, TP.w);                      // front panel
    for (let x = 4; x < w - 2; x += 8) r(x, 7, 1, h - 12, TP.o);
    r(0, 0, w, 3, TP.L);                          // top plank
    r(0, 3, w, 1, TP.W);
    r(0, 4, w, 1, TP.o);                          // under-lip shadow
    r(0, h - 1, w, 1, TP.o);                      // floor contact
  });
}

function tavTable() {
  return tavArt(22, 18, (ctx, r) => {
    r(4, 1, 14, 2, TP.L);
    r(1, 3, 20, 3, TP.W);
    r(1, 6, 20, 1, TP.o);
    r(9, 7, 4, 7, TP.w);            // stem
    r(6, 14, 10, 2, TP.W);          // foot
    r(5, 16, 12, 1, TP.o);
  });
}

function tavStool() {
  return tavArt(10, 12, (ctx, r) => {
    r(1, 1, 8, 2, TP.L);
    r(1, 3, 8, 1, TP.o);
    r(2, 4, 2, 6, TP.w);
    r(6, 4, 2, 6, TP.w);
    r(1, 10, 8, 1, TP.o);
  });
}

function tavBarrel() {
  return tavArt(14, 18, (ctx, r) => {
    r(1, 1, 12, 16, TP.W);
    r(1, 1, 2, 16, TP.w);
    r(11, 1, 2, 16, TP.w);
    r(2, 0, 10, 1, TP.L);
    r(0, 3, 14, 2, TP.g);           // hoops
    r(0, 11, 14, 2, TP.g);
    r(1, 17, 12, 1, TP.o);
  });
}

// The hearth is BUILT INTO the wall — a stone surround around a dark firebox,
// seen face-on like every other thing hanging on that wall. Its firebox is left
// empty here; the fire itself is drawn per frame, so it flickers.
function tavHearth() {
  const w = 36, h = 46;
  return tavArt(w, h, (ctx, r) => {
    r(0, 0, w, 6, TP.K);            // mantel shelf
    r(0, 6, w, 1, TP.k);
    r(1, 7, w - 2, h - 7, TP.k);    // stone surround
    for (let y = 10; y < h - 4; y += 6) {
      for (let x = 2 + ((y / 6) % 2) * 5; x < w - 3; x += 10) r(x, y, 9, 1, TP.K);
    }
    r(7, 18, 22, h - 18, TP.e);     // firebox
    r(9, 15, 18, 3, TP.e);          // its arch
    r(12, 13, 12, 2, TP.e);
    r(5, h - 3, 26, 3, TP.K);       // hearth lip on the floor line
  });
}

// The way out to the corridor. The sheet's whole gate is 64 px wide — a third
// of this room — so only its LEAF is cut, and the frame around it is painted to
// match the hearth's stonework. Same door, narrower doorway.
function tavDoor() {
  const leaf = cutFrame(tilesetImg, { x: 32, y: 224, w: 32, h: 32 }, 0);
  return tavArt(38, 36, (ctx, r) => {
    r(0, 0, 38, 4, TP.K);                        // lintel
    r(0, 4, 3, 32, TP.K);                        // jambs
    r(35, 4, 3, 32, TP.K);
    r(0, 3, 38, 1, TP.k);
    ctx.drawImage(leaf, 3, 4);
    r(0, 35, 38, 1, TP.o);                       // threshold
  });
}

// A hanging lantern: the tall wall's own light, on a chain from the beam.
function tavLantern(chain) {
  const h = chain + 11;
  return tavArt(9, h, (ctx, r) => {
    r(4, 0, 1, chain, TP.s);                     // chain
    r(3, chain, 3, 1, TP.g);                     // hanger
    r(1, chain + 1, 7, 1, TP.g);                 // cap
    r(1, chain + 2, 1, 7, TP.g);                 // frame
    r(7, chain + 2, 1, 7, TP.g);
    r(2, chain + 2, 5, 7, "#3a2a14");            // glass
    r(3, chain + 4, 3, 4, "#ffd68a");            // flame behind it
    r(1, chain + 9, 7, 1, TP.g);                 // base
  });
}

// The house sign, hanging over the bar: a plank with a tankard painted on it.
function tavSign() {
  const w = 46, h = 26, chain = 7;
  return tavArt(w, h, (ctx, r) => {
    r(9, 0, 1, chain, TP.s);
    r(w - 10, 0, 1, chain, TP.s);
    r(0, chain, w, 2, TP.L);                     // top edge
    r(0, chain + 2, w, h - chain - 3, TP.W);     // board
    r(0, h - 1, w, 1, TP.o);
    r(1, chain + 3, w - 2, 1, TP.L);
    // a tankard, painted small and centred
    const cx = Math.round(w / 2) - 5, cy = chain + 6;
    r(cx, cy, 9, 2, TP.p);                       // foam
    r(cx, cy + 2, 9, 8, TP.g);                   // ale
    r(cx - 1, cy + 1, 1, 9, TP.o);
    r(cx + 9, cy + 1, 1, 9, TP.o);
    r(cx + 10, cy + 3, 2, 1, TP.o);              // handle
    r(cx + 11, cy + 4, 1, 2, TP.o);
    r(cx + 10, cy + 6, 2, 1, TP.o);
    r(cx, cy + 10, 9, 1, TP.o);
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
    door: tavDoor(),
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
    sign: tavSign(),
    counter: null,                                  // sized with the room
    lantern: null,                                  // chained to the wall's height
    shadow: shadowToCanvas(8, 3, 0.42),
    shadowSm: shadowToCanvas(6, 2, 0.36),
    glowFire: glowToCanvas(30, "255, 156, 66", 0.42),
    glowEmber: glowToCanvas(13, "255, 190, 96", 0.55),
    glowCandle: glowToCanvas(9, "255, 214, 132", 0.5),
    glowArcane: glowToCanvas(11, CONFIG.colors.sceneRune.glowRGB, 0.4),
  };
}

// ---------------------------------------------------------------------------
// The room, laid out the way the corridor is: a wall face across the top and a
// shallow floor band under it. x comes off the room's width, y is a fraction of
// that band's depth — never more than a few tile rows, so the floor stays a
// floor rather than becoming a map.
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
  // Zoom in as far as the room's narrowest workable width allows — the people
  // are 16 px wide and have to read on a phone — then spend whatever height is
  // left on floor rows first (up to the shallow ceiling) and wall rows after.
  let px = Math.floor((cssW * dpr) / TAV_ROOM_W_MIN) || 1;
  px = Math.max(1, Math.min(px, 12));
  const artW = Math.ceil((cssW * dpr) / px);
  // The canvas fills the stage; the room is then built UP from its bottom edge —
  // boards, wall, and whatever is left over on top is the dark of the rafters.
  const artH = Math.max((TAV_WALL_ROWS_MIN + TAV_FLOOR_ROWS_MIN) * TILE,
    Math.floor((cssH * dpr) / px));
  const rows = Math.floor(artH / TILE);
  const floorRows = Math.max(TAV_FLOOR_ROWS_MIN,
    Math.min(TAV_FLOOR_ROWS_MAX, rows - TAV_WALL_ROWS_MIN));
  const wallRows = Math.max(TAV_WALL_ROWS_MIN,
    Math.min(TAV_WALL_ROWS_MAX, rows - floorRows));
  const depth = floorRows * TILE;
  const floorY = artH - depth;                     // wall → floor line
  const wallTop = Math.max(0, floorY - wallRows * TILE);
  cv.width = artW;
  cv.height = artH;
  cv.style.width = `${(artW * px) / dpr}px`;
  cv.style.height = `${(artH * px) / dpr}px`;

  // A spot on the floor band, as a fraction from the back wall to the front edge.
  const fy = (frac) => Math.round(floorY + 6 + (depth - 12) * frac);

  // --- where everything stands -------------------------------------------
  // Read the room left to right, the way the wall is read: the forge in the
  // corner by the fire, the bar across the middle under its bottles, the door
  // out to the corridor, and the books at the far end. Depth is only ever used
  // to put someone BEHIND something — the keeper behind his bar, a stool in
  // front of it — never to spread the room out into a plan.
  const hearthX = 4;
  const doorX = artW - 46;
  const counterW = Math.max(48, Math.min(78, Math.round(artW * 0.38)));
  const counterX = Math.round(artW * 0.27);
  const counterFeet = fy(0.5);
  const counterY = counterFeet - 20;               // top plank, in art px
  // The books stand in the FRONT-right corner rather than against the wall: the
  // wall's right end is the doorway, and a 48px shelf parked in front of it
  // would board the door up.
  const shelfX = artW - 32;
  const shelfFeet = fy(0.88);
  const bottleX = counterX + 2;                    // the plank of bottles, on the wall
  // Banners only where the wall has a gap left for them between the bottles and
  // the door — on a narrow phone it hasn't.
  const bannerGap = doorX - (bottleX + counterW);
  const bannerX = bannerGap > 40 ? bottleX + counterW + Math.round((bannerGap - 32) / 2) : 0;

  TAV.counter = tavCounter(counterW);
  // The rafters, and the beam everything hangs from — the lower of the two, so
  // a chain starts on timber instead of in mid-air.
  const rafterY = [Math.round(wallTop * 0.26), Math.round(wallTop * 0.66)];
  const beamY = rafterY[1] >= 6 ? rafterY[1] + 4 : Math.max(2, wallTop - 24);
  TAV.lantern = tavLantern(Math.max(8, wallTop + 34 - beamY));

  // Furniture that stands ON the floor: drawn in the depth-sorted pass with the
  // people, so the mage can walk behind a table and in front of the next one.
  const props = [
    // the forge, in the corner by the fire
    { art: TAV.anvil, x: hearthX + 8, feet: fy(0.34) },
    { art: TAV.barrel, x: hearthX + 36, feet: fy(0.1) },
    { art: TAV.table, x: hearthX + 6, feet: fy(0.94), candle: true },
    { art: TAV.stool, x: hearthX + 26, feet: fy(0.99) },
    // the bar
    { art: TAV.counter, x: counterX, feet: counterFeet },
    { art: TAV.barrel, x: counterX - 17, feet: counterFeet - 10 },
    { art: TAV.stool, x: counterX + 8, feet: counterFeet + 14 },
    { art: TAV.stool, x: counterX + counterW - 22, feet: counterFeet + 15 },
    { art: TAV.crate, x: doorX - 26, feet: fy(0.14) },
    // the middle of the room
    { art: TAV.table, x: Math.round(artW * 0.46), feet: fy(0.99), candle: true },
    // the reading corner, in the front right
    { art: TAV.shelf, x: shelfX, feet: shelfFeet },
    { art: TAV.stool, x: shelfX - 22, feet: fy(0.99) },
  ];
  for (const p of props) {
    p.w = p.art.width; p.h = p.art.height;
    // What the mage may not walk through: the prop's own footprint, widened a
    // little so he rounds a table rather than clipping its corner. The band is
    // shallow, so a prop only ever blocks a few rows of it.
    p.block = { x0: p.x - 3, x1: p.x + p.w + 3, y0: p.feet - 7, y1: p.feet + 5 };
  }

  const walk = { x0: 10, x1: artW - 10, y0: fy(0.1), y1: fy(1) };

  // Where the mage plants to use a station. Authored by hand and then nudged out
  // of the furniture, because a stand point that lands inside a stool is a walk
  // that can never finish — the layout shifts with the room's size, so the spot
  // has to be checked rather than trusted.
  // The band is shallow, so a spot is looked for sideways as well as forward —
  // stepping back out of a stool is rarely an option in three rows of floor.
  const freeSpot = (x, y) => {
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    for (const [dx, dy] of [[0, 0], [0, 8], [-14, 0], [14, 0], [-14, 8], [14, 8], [0, -8], [24, 0]]) {
      const cx = clamp(x + dx, walk.x0, walk.x1), cy = clamp(y + dy, walk.y0, walk.y1);
      if (!tavBlockedIn(props, walk, cx, cy)) return { x: cx, y: cy };
    }
    return { x: clamp(x, walk.x0, walk.x1), y: clamp(y, walk.y0, walk.y1) };
  };

  // --- where each station stands, and where the mage stands to use it -----
  const placed = {
    forge: { x: hearthX + 17, y: fy(0.34), stand: freeSpot(hearthX + 30, fy(0.52)), face: -1 },
    bar: {
      x: counterX + counterW / 2, y: counterFeet,
      stand: freeSpot(counterX + counterW / 2, counterFeet + 24), face: 1,
    },
    hall: { x: doorX + 19, y: floorY + 3, stand: freeSpot(doorX + 19, fy(0.24)), face: 1 },
    study: { x: shelfX + 14, y: shelfFeet, stand: freeSpot(shelfX - 12, fy(0.72)), face: 1 },
  };
  const stations = TAV_STATIONS.map((st) => Object.assign({}, st, placed[st.id]));

  // --- the room's people ---------------------------------------------------
  // Three stand at their post and one carries drinks around; the mage is the
  // player's own figure and wanders the whole open floor.
  const actor = (cast, x, y, extra) => Object.assign({
    cast, x, y, tx: x, ty: y, facing: 1, moving: false,
    waitUntil: 0, goal: null, arriveAt: 0, phase: tileHash(x | 0, y | 0) % 4,
    roam: null, speed: TAV_WALK_MS,
  }, extra || {});

  const mage = actor("mage", Math.round(artW * 0.42), fy(0.82), {
    roam: walk, wander: true, waitUntil: 0,
  });
  const people = [
    actor("smith", hearthX + 32, fy(0.3), { facing: -1 }),
    // Behind the bar: his feet are further back than the counter's, so the depth
    // sort draws the counter over his legs and he reads as standing behind it.
    actor("keeper", counterX + Math.round(counterW * 0.62), counterFeet - 14, { facing: 1 }),
    actor("scholar", shelfX - 12, shelfFeet + 4, { facing: 1 }),
    actor("guest", counterX + 26, counterFeet + 15, { facing: 1 }),
    actor("guest2", hearthX + 32, fy(0.96), { facing: -1 }),
    actor("maid", Math.round(artW * 0.5), fy(0.72), {
      wander: true, speed: TAV_WALK_MS * 1.15,
      roam: { x0: counterX - 20, x1: artW - 52, y0: fy(0.6), y1: fy(0.98) },
    }),
  ];

  tavern = {
    cv, artW, artH, px, dpr, floorY, depth,
    cssScale: px / dpr,
    props, stations, walk, mage, people,
    hearth: { x: hearthX, y: floorY + 2 - TAV.hearth.height },
    door: { x: doorX, y: floorY + 3 - TAV.door.height },
    bottleX, bannerX, counterX, counterW, counterY, wallTop, beamY, rafterY,
    // The two hanging lanterns, out of the way of the sign and the fire.
    lanternX: [Math.round(artW * 0.18), Math.round(artW * 0.78)],
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
  const wallTop = tavern.wallTop;
  // The rafters: unlit air above the wall, with two beams crossing it. Drawn
  // face-on like everything else, and dark enough that the eye reads depth
  // rather than a ceiling it has to believe in.
  const roof = ctx.createLinearGradient(0, 0, 0, wallTop + 4);
  roof.addColorStop(0, "#08060d");
  roof.addColorStop(1, "#150f1e");
  ctx.fillStyle = roof;
  ctx.fillRect(0, 0, artW, Math.max(0, wallTop));
  for (const by of tavern.rafterY) {
    if (by < 6) continue;
    rect(0, by, artW, 4, "#2f1e0b");
    rect(0, by, artW, 1, "#4d3216");
    rect(0, by + 4, artW, 1, "rgba(0, 0, 0, 0.5)");
  }
  for (let c = 0; c < cols; c++) {
    blit(SHEET.wallTopMid, c * TILE, wallTop);
    for (let y = wallTop + TILE; y < floorY; y += TILE) blit(SHEET.wallMid, c * TILE, y);
  }
  for (let r = 0; r * TILE + floorY < artH; r++) {
    for (let c = 0; c < cols; c++) {
      const h = tileHash(r, c);
      const tile = h % 4 === 0 ? SHEET.floors[1 + (h % (SHEET.floors.length - 1))] : SHEET.floors[0];
      blit(tile, c * TILE, floorY + r * TILE);
    }
  }
  // The boards. A tavern floor is wood, so the flagstones are washed warm — but
  // the PLANKS have to run into the room, not across it: on a floor seen this
  // flat, lines that recede are what say "floor" instead of "map". They are laid
  // out from the room's vanishing centre, so they fan very slightly apart toward
  // the front edge, and the seams between planks step in from the wall.
  ctx.save();
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = "rgba(104, 62, 30, 0.5)";
  ctx.fillRect(0, floorY, artW, artH - floorY);
  ctx.restore();
  const vanish = artW / 2, depth = artH - floorY;
  for (let i = -14; i <= 14; i++) {
    const back = vanish + i * 13;
    const front = vanish + i * 13 * 1.34;           // planks widen toward the viewer
    for (let y = 0; y < depth; y++) {
      const t = y / depth;
      rect(Math.round(back + (front - back) * t), floorY + y, 1, 1, "rgba(24, 14, 9, 0.34)");
    }
  }
  // Cross-seams, spaced out as they come forward — the one honest depth cue a
  // flat floor has.
  let seam = floorY + Math.round(depth * 0.22);
  for (let step = Math.round(depth * 0.26); seam < artH; step = Math.round(step * 1.35)) {
    rect(0, seam, artW, 1, "rgba(24, 14, 9, 0.3)");
    seam += step;
  }

  // The wall→floor contact shadow.
  for (let y = 0; y < 7; y++) rect(0, floorY + y, artW, 1, `rgba(0, 0, 0, ${(0.45 * (1 - y / 7)).toFixed(3)})`);

  // The rug, drawn in the floor's perspective: a band that widens as it comes
  // forward, not the rectangle a plan view would put here.
  const rugTop = floorY + Math.round(depth * 0.5), rugH = Math.round(depth * 0.44);
  const halfBack = artW * 0.24, halfFront = artW * 0.34;
  for (let y = 0; y < rugH; y++) {
    const t = y / rugH;
    const half = halfBack + (halfFront - halfBack) * t;
    const edge = y < 2 || y > rugH - 3;
    rect(Math.round(vanish - half), rugTop + y, Math.round(half * 2), 1, edge ? "#59202a" : "#8d2f36");
    if (!edge) {
      rect(Math.round(vanish - half), rugTop + y, 3, 1, "#59202a");
      rect(Math.round(vanish + half) - 3, rugTop + y, 3, 1, "#59202a");
    }
  }
  // Its pattern runs into the room with the boards.
  for (const i of [-2, -1, 0, 1, 2]) {
    for (let y = 3; y < rugH - 3; y++) {
      const t = y / rugH;
      const half = halfBack + (halfFront - halfBack) * t;
      const x = vanish + i * half * 0.42;
      rect(Math.round(x - 1), rugTop + y, 3, 1, "#6d2a34");
    }
  }

  // --- what hangs on the wall ---------------------------------------------
  // A beam under the cap row, and everything else hangs off it: that is what
  // keeps a tall wall from reading as bare brick, and it is all face-on, which
  // is the only way this tileset lets a wall be drawn.
  const beamY = tavern.beamY;

  ctx.drawImage(TAV.hearth, tavern.hearth.x, tavern.hearth.y);
  ctx.drawImage(TAV.door, tavern.door.x, tavern.door.y);
  if (tavern.bannerX) {
    blit(SHEET.bannerRed, tavern.bannerX, wallTop + TILE);
    blit(SHEET.bannerGreen, tavern.bannerX + TILE, wallTop + TILE);
  }
  // The house sign over the bar, and a lantern to each side of the room. Both
  // only where the wall is tall enough to hang something from without it landing
  // on the bottles.
  ctx.drawImage(TAV.sign, Math.round(tavern.counterX + tavern.counterW / 2 - TAV.sign.width / 2), beamY);
  for (const lx of tavern.lanternX) ctx.drawImage(TAV.lantern, lx, beamY);
  // A skull, nailed up by the door the way the corridor's are strewn across it.
  blit(SHEET.skull, tavern.door.x - 20, floorY - 26);

  const bx = tavern.bottleX, bw = Math.min(46, Math.max(24, tavern.counterW - 8));
  rect(bx, floorY - 13, bw, 2, TP.W);
  rect(bx, floorY - 11, bw, 1, TP.o);
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
  // A tap that lands ON something walks to the nearest clear boards instead of
  // being swallowed: the thumb aimed at a place, not at a pixel.
  let tx = artX, ty = artY;
  if (tavBlocked(tx, ty)) {
    const spot = [[0, 12], [0, -12], [-16, 0], [16, 0], [-16, 12], [16, 12], [0, 24]]
      .map(([dx, dy]) => ({ x: artX + dx, y: artY + dy }))
      .find((p) => !tavBlocked(p.x, p.y));
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
  ctx.fillStyle = TP.w;
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

  // The two hanging lanterns, each breathing on its own clock.
  if (TAV.lantern) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const lampY = tavern.beamY + TAV.lantern.height - 6;
    tavern.lanternX.forEach((lx, i) => {
      ctx.globalAlpha = 0.55 + 0.2 * Math.sin(now / (330 + i * 90) + i);
      ctx.drawImage(TAV.glowCandle, lx + 4 - 9, lampY - 9);
      ctx.globalAlpha = 0.3 + 0.1 * Math.sin(now / (410 + i * 70));
      ctx.drawImage(TAV.glowEmber, lx + 4 - 13, lampY - 13);
    });
    ctx.restore();
  }

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
      ctx.fillStyle = TP.p; ctx.fillRect(cx - 1, cy - 4, 2, 4);
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
// The screen is the room plus the board under it. The room is a WIDE, SHALLOW
// stage — that is what the tileset's perspective allows — so it can never fill a
// portrait phone on its own, and the space under it is not padding to stretch
// the picture into: it is where the stations are named and tapped, at the height
// a thumb actually reaches. The picture above stays the picture.
function renderTavernFull() {
  app.innerHTML = `
    <div class="screen tavern-screen" id="tavern-root">
      <header class="tav-top">
        <span class="tav-title">Zur Rostigen Rune</span>
        <span class="tav-gold"><span class="coin">◈</span> ${state.gold}</span>
      </header>
      <div class="tav-stage" id="tav-stage">
        <canvas class="tav-scene" id="tav-scene"></canvas>
      </div>
      <div class="tav-board">
        <div class="tav-cards" id="tav-cards"></div>
      </div>
    </div>`;
  tavern = null;                       // the canvas is new, so the room is rebuilt on it
  const cv = document.getElementById("tav-scene");
  if (cv) cv.addEventListener("click", onTavernCanvasTap);
  // The board first: it is content-sized, and the room is measured against
  // whatever height it leaves — the other way round the canvas would be built
  // against a stage that then shrinks under it.
  renderTavernCards();
  setupTavern(cv);
}

// The board: one card per station, carrying the same pixel icon the bottom bar
// uses for that phase, so the room's door and the bar's button are visibly the
// same errand. Built once per structural render — nothing on it changes per
// frame except which card is lit.
const TAV_CARD_ICON = {
  forge: () => navPixSvg(NAV_ANVIL),
  study: () => navPixSvg(NAV_BOOK),
  hall: () => navPixSvg(navWeaponRows()),
  bar: () => navPixSvg(NAV_TANKARD),
};

function renderTavernCards() {
  const host = document.getElementById("tav-cards");
  if (!host) return;
  host.innerHTML = TAV_STATIONS.map((st) => `
    <button class="tav-card${st.phase ? "" : " flavour"}" data-act="tavernGo"
      data-args='["${st.id}"]' data-station="${st.id}">
      <span class="tav-card-icon">${(TAV_CARD_ICON[st.id] || (() => ""))()}</span>
      <span class="tav-card-text"><b>${st.name}</b><i>${st.blurb}</i></span>
    </button>`).join("");
}

function patchTavernContinuous(now) {
  const cv = document.getElementById("tav-scene");
  if (!cv) return;
  if (!tavern || tavern.cv !== cv) {
    renderTavernCards();
    if (!setupTavern(cv)) return;      // sheet still loading — try again next frame
  }
  const dt = tavern.lastNow ? Math.min(64, now - tavern.lastNow) : 16;
  tavern.lastNow = now;
  for (const a of tavern.people) tavUpdateActor(a, now, dt);
  tavUpdateActor(tavern.mage, now, dt);
  if (state.screen !== "tavern") return;   // a station handed off mid-frame
  renderTavern(now);
  const cards = document.getElementById("tav-cards");
  if (cards) {
    for (const el of cards.children) el.classList.toggle("on", el.dataset.station === tavern.focus);
  }
}

window.Incanto.tavern = {
  renderTavernFull, patchTavernContinuous, tavernGo, tavernTapPoint, setupTavern,
  renderTavernCards,
};
