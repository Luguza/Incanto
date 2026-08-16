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

// The doorway, cut NARROWER than the sheet's own `doors_all` rect on purpose.
// That rect is 64 px wide and bakes thirteen columns of WALL into each side of
// the arch — its own bricks, with their own lit ledge along the top. Blitted
// onto this room's wall those bricks land at a different phase from the wall
// they sit on, and the patch's top edge shows as a seam running across the
// masonry. Cutting from x+13 for 38 px takes the doorway alone — arch, jambs,
// leaf, threshold — and lets the room's own wall meet it on both sides. The
// corners above the arch are transparent on the sheet, so the curve reads
// against whatever is behind it.
const TAV_DOORWAY = { x: 29, y: 221, w: 38, h: 35 };

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
//
// `top` is where the piece's usable surface is, in the art's own coordinates —
// the middle of a table's boards, not the top of its bounding box. Anything the
// room stands ON a prop reads it, which is the whole reason a candle knows to
// sit in the middle of a table instead of hovering off its back edge.
function tavArt(w, h, draw, top) {
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(w));
  cv.height = Math.max(1, Math.round(h));
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  draw(ctx, (x, y, rw, rh, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, rw, rh); });
  if (top) cv.top = top;
  return cv;
}

const tavFrames = (rect, opts) =>
  Array.from({ length: rect.f || 1 }, (_, i) => cutFrame(tilesetImg, rect, i, opts));

// ---------------------------------------------------------------------------
// The furniture. A dungeon tileset has no tavern in it — no table, no bar, no
// stool — so these are drawn here, once, at load, and blitted like any other
// sprite afterwards.
//
// THE PERSPECTIVE IS MEASURED OFF THE SHEET, NOT INVENTED. Everything in this
// game is seen from a little above and dead on: a box shows its front and its
// top, never a side. How much top it shows is the one number that decides
// whether a drawn-in prop stands in the same room as the sheet's own art, and
// the sheet states it plainly — its crate is 16 px deep and shows 8 rows of lid,
// its closed chest shows 7, its column cap about 6 for 14 across. Call it half:
//
//     a surface D px deep reads as D / 2 px of top face.
//
// `tavTop` and `tavRy` are that ratio, and every horizontal surface in this room
// goes through one of them so none of them can drift from the sheet. Three rules
// come with it, all copied off the crate:
//
//   * the top face is drawn FULL WIDTH — a plain rectangle, or on a round thing
//     an ellipse of half the radius. Nothing narrows toward the back; this is a
//     tilt, not a vanishing point.
//   * it is LIGHTER than the front (the chest's lid is woodLit over a wood
//     body), and where the two planes meet there is exactly one bright line —
//     woodEdge on wood, stoneHi on stone. That pair of edges is what makes two
//     planes read as two planes instead of one flat panel.
//   * the far edge of the top face is the #222222 outline, same as every other
//     silhouette edge on the sheet.
//
// And a thing standing on legs meets the floor with each leg's own foot. A
// single bar of ink ruled across the bottom of all of them — which is what the
// stool and the table used to do — collapses the base into a flat plinth and
// throws away the tilt the top face just established.
// ---------------------------------------------------------------------------
const TP = TAV_PAL;

// How far a surface tilts toward the camera. See the essay above.
const TAV_TILT = 0.5;
// Rows of top face shown by a surface `depth` px deep.
const tavTop = (depth) => Math.max(1, Math.round(depth * TAV_TILT));
// The same for a round one: the minor radius of a circle of radius `rx`.
const tavRy = (rx) => Math.max(1, Math.round(rx * TAV_TILT));

// A filled ellipse, row by row. Round tops — a table, a stool's seat, a barrel's
// head — are the one shape a stack of rectangles cannot fake. `dy0`..`dy1` cut
// it down to a band of rows, which is how a surface gets an outline on the far
// arc alone: a barrel's head is flush with its staves, so it must NOT carry a
// line of #222222 round its near rim the way a table top standing clear of the
// floor does. That line is precisely what reads as a lid hovering over a cask.
function tavOval(r, cx, cy, rx, ry, col, dy0, dy1) {
  const from = dy0 === undefined ? -ry : dy0, to = dy1 === undefined ? ry : dy1;
  for (let y = from; y <= to; y++) {
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
  // Two slabs with a waist between them, and each slab gets its own top plane:
  // three rows of lit steel on the face, two on the splayed base. Without them
  // an anvil is a silhouette — the face is the part a smith looks down at.
  const spans = [
    [3, 13], [2, 14], [1, 14],        // the face, seen from above (and the horn)
    [2, 14], [4, 12],                 // its front, and the taper under it
    [7, 10], [7, 10],                 // the waist
    [3, 13], [2, 14],                 // the base, seen from above
    [2, 14], [2, 14],                 // its front
  ];
  const shade = [TP.steel, TP.steel, TP.stoneHi,
    TP.stoneLit, TP.stone,
    TP.stoneLit, TP.stone,
    TP.stoneHi, TP.stoneHi,
    TP.stoneLit, TP.stone];
  return tavArt(16, 13, (ctx, r) => {
    spans.forEach(([x0, x1], y) => r(x0 - 1, y, x1 - x0 + 2, 3, TP.ink));
    spans.forEach(([x0, x1], y) => r(x0, y + 1, x1 - x0, 1, shade[y]));
  }, { x: 8, y: 3 });
}

function tavShelf() {
  // A carcass 10 px deep, so five rows of it show on top; each board inside is a
  // surface too, and gets the two rows of its own that let the books read as
  // STANDING on it rather than being stuck to a line.
  const w = 28, deep = 10, top = tavTop(deep), h = 50;
  const books = [TP.red, TP.blueLit, TP.green, TP.gold, TP.bone, TP.blue, TP.greenLit];
  return tavArt(w, h, (ctx, r) => {
    r(0, 0, w, h, TP.ink);                           // outline
    r(1, 1, w - 2, top, TP.woodLit);                 // the top of the case
    for (let x = 5; x < w - 2; x += 8) r(x, 1, 1, top, TP.woodDark);   // planks, running away
    r(1, top + 1, w - 2, 1, TP.woodEdge);            // the lit front edge of the top
    r(1, top + 3, w - 2, h - top - 5, TP.wood);      // carcass front
    r(3, top + 4, w - 6, h - top - 9, TP.pit);       // the dark inside
    for (let sh = 0; sh < 4; sh++) {
      const plankY = 17 + sh * 9;
      let x = 4, i = 0;
      while (x < w - 5) {
        const bw = 2 + (tileHash(sh, i) % 2);
        const bh = 5 + (tileHash(i + 3, sh) % 3);
        r(x, plankY - bh, bw, bh, books[tileHash(sh * 7 + i, 13) % books.length]);
        // only the odd volume catches the light on its page edge
        if ((tileHash(i, sh + 5) % 4) === 0) r(x, plankY - bh, bw, 1, TP.bone);
        x += bw + 1; i++;
      }
      // The board, drawn AFTER the books: what is left showing is the strip of
      // it in front of them, which is the two rows of top face a 4 px board has.
      r(3, plankY, w - 6, 2, TP.woodLit);
      r(3, plankY + 2, w - 6, 1, TP.woodDark);       // its front edge, in shadow
    }
    r(1, h - 3, w - 2, 2, TP.woodDark);              // plinth
  });
}

function tavCounter(w) {
  // The bar is 14 px deep, which is seven rows of counter top. It used to show
  // three, and three rows of top is not a bar seen from above — it is a plank
  // stood on its edge.
  const deep = 14, top = tavTop(deep), front = 12, h = top + front + 5;
  return tavArt(w, h, (ctx, r) => {
    r(0, 0, w, h, TP.ink);                        // outline
    r(1, 1, w - 2, top, TP.woodLit);              // the top, seen from above
    // The planks run AWAY from the drinker, so their seams line up with the
    // panelling under them and the two faces read as one piece of joinery.
    for (let x = 5; x < w - 2; x += 7) r(x, 1, 1, top, TP.woodDark);
    r(1, top + 1, w - 2, 1, TP.woodEdge);         // the lit front edge of the top
    r(1, top + 2, w - 2, 1, TP.woodDark);         // under-lip
    r(1, top + 3, w - 2, front, TP.wood);         // front panel
    for (let x = 5; x < w - 2; x += 7) r(x, top + 3, 1, front, TP.woodDark);
    r(1, h - 2, w - 2, 1, TP.woodDark);           // foot rail in shadow
  }, { x: Math.round(w / 2), y: 1 + Math.round(top / 2) });
}

// A turned leg, falling in `segs` short segments so it can splay as it goes.
// Each one ends on its OWN foot of ink: what a table stands on is three points
// of contact with the boards, not one bar of ink ruled across all of them.
//
// `segs` is also how the legs say which of them is FURTHER BACK. The floor
// recedes at the same half as everything else, so a leg standing four px deeper
// into the room meets it two px higher up the screen — a shorter leg, ending
// sooner. Legs of equal length are legs standing in a row against a backdrop,
// which is what these used to be.
function tavLeg(r, x0, dx, y0, segs) {
  for (let i = 0; i < segs; i++) {
    const x = Math.round(x0 + dx * i), y = y0 + i * 3;
    r(x - 1, y, 4, 3, TP.ink);
    r(x, y, 2, 3, TP.woodDark);
    r(x, y, 1, 3, TP.wood);                      // the lit side of the turning
  }
  r(Math.round(x0 + dx * (segs - 1)) - 1, y0 + segs * 3 - 1, 4, 1, TP.ink);
}

function tavTable() {
  // A slab 24 across is a slab 24 deep, so its top is a 24 x 12 ellipse — half
  // as deep as it is wide, the same half the crate's lid is. Under its near rim
  // sit two rows of the slab's own thickness, which is what stops a round table
  // reading as a disc lying on the floor.
  const w = 24, h = 22, cx = 12, cy = 6, rx = 12, ry = tavRy(rx);
  return tavArt(w, h, (ctx, r) => {
    // Legs first, so the top is drawn over their heads and each one runs up
    // UNDER the slab instead of being butted against its outline. Four of them,
    // one to a quarter: the near one reaches the boards lowest, the two at the
    // sides stand three px deeper and so stop three px sooner, and the fourth is
    // right at the back where the slab covers it entirely — which is exactly
    // what a round table does when you look down on it.
    tavLeg(r, cx - 1, 0, 10, 4);
    tavLeg(r, 4, -1, 10, 3);
    tavLeg(r, 18, 1, 10, 3);
    tavOval(r, cx, cy + 2, rx, ry, TP.ink);      // the slab's thickness…
    tavOval(r, cx, cy, rx, ry, TP.ink);          // …and its top
    tavOval(r, cx, cy + 2, rx - 1, ry - 1, TP.woodDark);   // edge grain, in shadow
    tavOval(r, cx, cy, rx - 1, ry - 1, TP.wood);
    tavOval(r, cx, cy - 1, rx - 3, ry - 2, TP.woodLit);    // lit toward the far rim
    r(cx - 5, cy - 4, 10, 1, TP.woodEdge);
  }, { x: cx, y: cy + 1 });
}

function tavStool() {
  // The same slab-and-legs as the table, one size down. The seat used to sit on
  // three legs ruled together by a bar of ink along the bottom; now each leg
  // splays out and lands on its own foot.
  const w = 14, h = 16, cx = 7, cy = 4, rx = 6, ry = tavRy(rx);
  return tavArt(w, h, (ctx, r) => {
    tavLeg(r, cx - 1, 0, 7, 3);                  // the near leg…
    tavLeg(r, 3, -1, 7, 2);                      // …and the two standing deeper
    tavLeg(r, 9, 1, 7, 2);
    tavOval(r, cx, cy + 1, rx, ry, TP.ink);      // the seat's thickness…
    tavOval(r, cx, cy, rx, ry, TP.ink);          // …and its top
    tavOval(r, cx, cy + 1, rx - 1, ry - 1, TP.woodDark);
    tavOval(r, cx, cy, rx - 1, ry - 1, TP.wood);
    tavOval(r, cx, cy - 1, rx - 2, ry - 1, TP.woodLit);
    r(cx - 2, cy - 2, 5, 1, TP.woodEdge);
  }, { x: cx, y: cy });
}

function tavBarrel() {
  // The lid is the whole point: a barrel 14 across gets a 14 x 7 ellipse of it.
  // The old rim was two rows, which reads as a tube cut off square rather than a
  // cask with a head in it.
  const w = 14, h = 21, cx = 7, cy = 5, rx = 6, ry = tavRy(rx);
  return tavArt(w, h, (ctx, r) => {
    // The staves, drawn a row at a time so they can taper a pixel at the head
    // and at the foot — a cask bellies out, and the taper is what leaves room
    // for the head to sit INSIDE the silhouette instead of capping it.
    // The staves start at the head's OWN centre line, so the head's near half
    // lies over them and its far half stands clear against nothing. Started any
    // higher and the staves show up the sides of the head, which is what made
    // the old lid read as hovering over the cask rather than sitting in it.
    for (let y = cy; y < h; y++) {
      const i = y > h - 3 ? 1 : 0;               // and taper a px at the foot
      r(i, y, w - i * 2, 1, TP.ink);
      r(i + 1, y, w - i * 2 - 2, 1, TP.wood);
    }
    r(4, cy, 1, h - cy - 1, TP.woodDark);        // stave seams
    r(9, cy, 1, h - cy - 1, TP.woodDark);
    r(1, cy + 6, w - 2, 2, TP.stoneLit);         // iron hoops, clear of the head
    r(1, cy + 6, w - 2, 1, TP.stoneHi);
    r(1, h - 5, w - 2, 2, TP.stoneLit);
    r(1, h - 5, w - 2, 1, TP.stoneHi);
    r(2, h - 1, w - 4, 1, TP.pit);               // where it meets the boards
    // The head, 12 across and 6 deep. Outlined along its far arc only; in front
    // it is flush with the staves, so it gets a seam rather than a silhouette.
    tavOval(r, cx, cy, rx, ry, TP.ink);
    tavOval(r, cx, cy, rx, ry, TP.woodDark, 1, ry);
    tavOval(r, cx, cy, rx - 1, ry - 1, TP.wood);
    tavOval(r, cx, cy - 1, rx - 2, ry - 2, TP.woodLit);
    r(cx - 3, cy - 2, 6, 1, TP.woodEdge);        // the far rim, catching the light
  }, { x: cx, y: cy });
}

// The hearth is built into the back wall, and its stonework is the wall's own
// ramp so it reads as part of the masonry rather than a block parked against it.
// The firebox is left empty; the fire is drawn per frame, so it flickers.
function tavHearth() {
  const w = 36, h = 44;
  const mantel = tavTop(8);                      // the shelf is 8 px deep
  return tavArt(w, h, (ctx, r) => {
    r(0, 0, w, h, TP.ink);
    r(1, 1, w - 2, mantel, TP.stoneLit);         // the mantel shelf, seen from above
    r(2, 1, w - 4, 1, TP.stoneHi);
    r(1, mantel + 1, w - 2, 1, TP.stoneHi);      // its lit front edge
    r(1, mantel + 2, w - 2, 1, TP.stone);        // and the front of the shelf
    r(2, mantel + 3, w - 4, h - mantel - 4, TP.stone);   // surround, set back under it
    for (let y = 9; y < h - 5; y += 5) {         // courses, as on wall_mid
      r(3, y, w - 6, 1, TP.stoneLit);
      for (let x = 4 + ((y / 5) % 2) * 6; x < w - 4; x += 12) r(x, y - 3, 1, 3, TP.stoneLit);
    }
    r(8, 16, 20, h - 16, TP.pit);                // firebox
    r(10, 13, 16, 3, TP.pit);                    // its arch
    r(13, 11, 10, 2, TP.pit);
    r(7, 15, 22, 1, TP.stoneHi);                 // lintel edge, catching the fire
    r(4, h - 3, 28, 2, TP.stoneLit);             // hearthstone
    r(4, h - 1, 28, 1, TP.ink);
  });
}

// ---------------------------------------------------------------------------
// The menu. Seven things the keeper can put on the counter, one per item in
// content.js' BAR_ITEMS — the order's missing word is what gets served, so the
// two lists have to line up (`tools/check-sentences.mjs` checks that they do).
//
// Each is drawn to the same rules as the furniture above: #222222 all the way
// round, a three-step ramp of ONE material, one bright edge where the hearth
// catches it, and a shallow ellipse on anything round. They are small — a mug is
// eleven pixels tall next to a twenty-two pixel mage — so the silhouette carries
// them: a wedge is a wedge, a goblet has a stem, a drumstick has a bone.
//
// `kind` is how it is consumed, and it is the only thing the animation asks:
// food is bitten DOWN (clipped away from the top) and drink is TIPPED UP.
// ---------------------------------------------------------------------------
function tavPane() {                        // il pane — a round loaf, slashed
  return tavArt(12, 9, (ctx, r) => {
    tavOval(r, 6, 5, 6, 4, TP.ink);
    tavOval(r, 6, 5, 5, 3, TP.wood);
    tavOval(r, 6, 4, 4, 2, TP.woodLit);
    r(4, 1, 5, 1, TP.woodEdge);             // the crust catching the fire
    r(4, 3, 1, 3, TP.woodDark);             // the baker's two slashes
    r(7, 3, 1, 3, TP.woodDark);
  });
}

function tavFormaggio() {                   // il formaggio — a wedge, holed
  const rows = [[5, 7], [4, 8], [3, 9], [2, 10], [1, 11]];
  return tavArt(12, 9, (ctx, r) => {
    rows.forEach(([x0, x1], y) => r(x0 - 1, y + 1, x1 - x0 + 2, 3, TP.ink));
    rows.forEach(([x0, x1], y) => r(x0, y + 2, x1 - x0, 1, TP.gold));
    r(5, 2, 2, 1, TP.woodEdge);             // lit along the cut face
    r(4, 4, 1, 1, TP.woodDark);             // holes
    r(7, 5, 1, 1, TP.woodDark);
    r(3, 6, 1, 1, TP.woodDark);
  });
}

function tavMela() {                        // la mela — apple, leaf, stem
  return tavArt(10, 11, (ctx, r) => {
    tavOval(r, 5, 7, 5, 4, TP.ink);
    tavOval(r, 5, 7, 4, 3, TP.red);
    tavOval(r, 4, 6, 2, 2, TP.redLit);
    r(3, 4, 2, 1, TP.woodEdge);             // the shine on the shoulder
    r(5, 1, 1, 3, TP.ink);                  // stem
    r(5, 2, 1, 2, TP.woodDark);
    r(6, 1, 3, 2, TP.ink);                  // leaf
    r(6, 1, 2, 1, TP.greenLit);
    r(7, 2, 1, 1, TP.green);
  });
}

function tavPollo() {                       // il pollo — a drumstick
  return tavArt(11, 11, (ctx, r) => {
    r(2, 6, 4, 5, TP.ink);                  // the bone, running down to the left
    r(0, 7, 4, 4, TP.ink);                  // and its knuckle at the end
    tavOval(r, 7, 4, 4, 4, TP.ink);         // the meat, sat on top of it
    tavOval(r, 7, 4, 3, 3, TP.wood);
    tavOval(r, 6, 3, 2, 2, TP.woodLit);
    r(5, 1, 3, 1, TP.woodEdge);             // browned where the fire got it
    r(8, 5, 1, 1, TP.woodDark);
    r(3, 7, 2, 3, TP.bone);                 // shaft
    r(1, 8, 2, 2, TP.bone);                 // knuckle
    r(1, 8, 2, 1, TP.white);
  });
}

function tavVino() {                        // il vino — a goblet
  // Rows of the bowl, tapering into the stem: a rectangle with a foot reads as a
  // television, and the taper is the whole difference.
  const bowl = [[1, 8], [1, 8], [1, 8], [2, 7], [3, 6]];
  return tavArt(9, 13, (ctx, r) => {
    bowl.forEach(([x0, x1], y) => r(x0 - 1, y, x1 - x0 + 2, 3, TP.ink));
    bowl.forEach(([x0, x1], y) => r(x0, y + 1, x1 - x0, 1, TP.steel));
    r(2, 2, 5, 1, TP.redLit);               // the wine, its surface lit
    r(2, 3, 5, 1, TP.red);
    r(3, 4, 3, 1, TP.red);
    r(4, 5, 1, 1, TP.red);
    r(2, 1, 3, 1, TP.white);                // a glint on the rim
    r(3, 6, 3, 4, TP.ink);                  // stem
    r(4, 6, 1, 4, TP.stoneHi);
    tavOval(r, 4, 11, 4, 2, TP.ink);        // foot
    tavOval(r, 4, 11, 3, 1, TP.steel);
  });
}

function tavBirra() {                       // la birra — a tankard with a head
  return tavArt(12, 13, (ctx, r) => {
    r(8, 4, 4, 6, TP.ink);                  // handle, behind the body
    r(9, 5, 2, 4, TP.wood);
    r(0, 2, 9, 11, TP.ink);                 // body
    r(1, 3, 7, 9, TP.wood);
    r(3, 3, 1, 9, TP.woodDark);             // staves
    r(6, 3, 1, 9, TP.woodDark);
    r(1, 4, 7, 1, TP.stoneLit);             // iron hoops, as on the barrel
    r(1, 10, 7, 1, TP.stoneLit);
    tavOval(r, 4, 2, 5, 2, TP.ink);         // the head of foam, brimming over
    tavOval(r, 4, 2, 4, 1, TP.white);
    r(2, 0, 4, 1, TP.bone);
  });
}

function tavLatte() {                       // il latte — a jug, brim full
  return tavArt(11, 12, (ctx, r) => {
    r(8, 5, 3, 5, TP.ink);                  // handle
    r(9, 6, 1, 3, TP.bone);
    r(0, 2, 9, 10, TP.ink);                 // body
    r(1, 3, 7, 8, TP.bone);
    r(1, 3, 7, 1, TP.white);                // lit shoulder
    r(1, 9, 7, 2, TP.stoneHi);              // and the shadow it stands in
    r(6, 1, 3, 2, TP.ink);                  // the spout
    r(7, 2, 1, 1, TP.bone);
    tavOval(r, 4, 3, 4, 1, TP.white);       // milk, right at the rim
  });
}

// id → { art, kind }. The id IS the Italian word the player taps.
const TAV_MEAL = {
  pane:      { build: tavPane,      kind: "eat" },
  formaggio: { build: tavFormaggio, kind: "eat" },
  mela:      { build: tavMela,      kind: "eat" },
  pollo:     { build: tavPollo,     kind: "eat" },
  vino:      { build: tavVino,      kind: "drink" },
  birra:     { build: tavBirra,     kind: "drink" },
  latte:     { build: tavLatte,     kind: "drink" },
};

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
    door: cutFrame(tilesetImg, TAV_DOORWAY, 0),
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
    glowMeal: glowToCanvas(16, CONFIG.colors.sceneRune.glowRGB, 0.5),
    meal: Object.fromEntries(
      Object.entries(TAV_MEAL).map(([id, m]) => [id, m.build()])
    ),
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
  const doorX = Math.max(hearthX + 46, artW - 56);   // 38 px of doorway (see TAV_DOORWAY)
  const counterW = Math.max(52, Math.min(88, Math.round(artW * 0.46)));
  const counterX = Math.round(artW * 0.28);
  const counterY = fy(0.26);                       // far edge of the top, in art px
  TAV.counter = tavCounter(counterW);
  // Read off the art rather than restated: the counter grew when it was given a
  // real top face, and a hard-coded 20 here would have left its feet inside it.
  const counterFeet = counterY + TAV.counter.height;
  const shelfX = artW - 32;
  const shelfFeet = fy(0.80);
  const bottleX = counterX + 2;                    // the plank of bottles, on the wall
  const bannerX = doorX > 118 ? 96 : 0;            // only where the wall has room for it

  // Furniture that stands ON the floor: drawn in the depth-sorted pass with the
  // people, so the mage can walk behind a table and in front of the next one.
  const props = [
    // the forge corner
    { art: TAV.anvil, x: Math.round(artW * 0.05), feet: fy(0.11) },
    { art: TAV.crate, x: Math.round(artW * 0.05) + 46, feet: fy(0.06) },
    { art: TAV.barrel, x: Math.round(artW * 0.05), feet: fy(0.20) },
    // the bar
    { art: TAV.barrel, x: counterX + counterW + 2, feet: counterY + 4 },
    { art: TAV.crate, x: doorX - 24, feet: fy(0.12) },
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
      x: doorX + 19, y: floorY + 3,
      stand: freeSpot(doorX + 19, floorY + Math.round(depth * 0.18)), face: 1,
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
    // The bar leads nowhere, so arriving IS the event: the keeper looks up and
    // the order starts (see openBarOrder).
    if (goal && goal.id === "bar") openBarOrder(now);
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
  // Mid-order at the bar: tapping the bar again is a stray tap on a panel he is
  // already standing at, and tapping anywhere else is leaving — the order lapses.
  if (tavern.meal) {
    if (id === "bar") return;
    closeBarOrder();
  }
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
  // The bar's menu is painted into the scene, so it is hit-tested here, before
  // anything else can claim the tap — the plaques are drawn over the room and
  // have to take presses over it too.
  const meal = tavern.meal;
  if (meal) {
    for (const c of meal.chips) {
      if (artX >= c.x - 2 && artX <= c.x + c.w + 2 && artY >= c.y - 2 && artY <= c.y + c.h + 2) {
        barOrderPick(c.word);
        return;
      }
    }
    // A tap inside the speech itself is a tap on something being read, not on
    // the floor behind it: swallow it rather than walking him out of the order.
    for (const b of [meal.keeperBubble, meal.heroBubble]) {
      if (b && artX >= b.x && artX <= b.x + b.art.width &&
          artY >= b.y && artY <= b.y + b.art.height) return;
    }
  }
  // A tap near a station counts as tapping the station, so the door and the
  // anvil are hit targets in the picture and not only chips above it.
  for (const st of tavern.stations) {
    if (Math.abs(artX - st.x) < 22 && artY > st.y - 34 && artY < st.y + 14) { tavernGo(st.id); return; }
  }
  if (tavern.meal) closeBarOrder();          // walking off leaves the order behind
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
// The bar — ordering something to eat.
//
// The Schänke is the one station that leads nowhere: tapping it walks the mage
// to the counter and the exchange happens IN THE ROOM. The keeper greets him,
// the hero has one line of Italian to finish, and the missing word is the order
// — tap "birra" into the gap and a tankard is what lands on the counter. He
// carries it off, eats or drinks it where he stands, and walks away with a
// shield worth a tenth of his HP (see grantMealShield).
//
// It runs as a small stage machine on `tavern.meal` rather than as a screen,
// because the room is what the player should be watching:
//
//   order → reply → serve → eat → cheer → (closed)
//
// Only `order` waits on the player; the rest are timed and advance themselves in
// updateBarMeal.
//
// ALL OF IT IS DRAWN IN THE SCENE — speech in pixel bubbles over the two people
// talking, the menu as little plaques on the floor below (see layoutBarMeal).
// This started life as a DOM panel across the foot of the screen and that panel
// was the wrong object: crisp browser text in a box pasted over a pixel room
// reads as an interface interrupting the picture, and the exchange it carried is
// the one thing in this game that is *happening in the room*. Bubbles at the
// room's own resolution put the words where the mouths are. Two things follow
// from it, and both are deliberate: the text is baked into small canvases when
// the stage changes rather than drawn glyph by glyph every frame (see
// bakeBubble), and the menu is hit-tested against those baked rects in
// tavernTapPoint, because a plaque painted on the canvas is not a button the
// browser knows about. The smoke test presses the pixels for that reason.
//
// A wrong word is not a failure state. The keeper says "Come?", the word he
// couldn't place is struck through on the menu, and the order stands — the
// player picks again. There is nothing to lose here, so there is nothing to
// punish; the exchange only ends when it ends well or when the player walks off.
// ---------------------------------------------------------------------------
const PF = Incanto.pixelFont;

const BUB = {
  pad: 4,        // between a bubble's text and its outline
  tail: 3,       // how far the tail sticks out
  gap: 3,        // between stacked bubbles / menu plaques
  chipPadX: 7,   // a plaque is its word plus this much either side…
  chipH: 15,     // …and this tall, which is the thumb, not the text
  edge: 5,       // nothing is laid out closer than this to the room's edge
};
const MEAL_MS = { reply: 650, serve: 560, bite: 340, cheer: 900, after: 800 };
const MEAL_BITES = 4;                 // bites/sips a serving is worth

const mealPick = (list) => list[Math.floor(Math.random() * list.length)];

// One order off BAR_ORDER_POOL, with the menu to choose from: the answer plus
// other things the keeper actually stocks. Distractors are the rest of the menu
// rather than same-part-of-speech words, because at a bar the wrong answer is
// something else to eat — reading the German and knowing which is which is the
// whole exercise.
function barDrawOrder() {
  let s = mealPick(BAR_ORDER_POOL);
  for (let i = 0; i < 8 && tavern.lastOrder === s.it; i++) s = mealPick(BAR_ORDER_POOL);
  tavern.lastOrder = s.it;
  const tokens = s.it.split(" ");
  const others = BAR_ITEMS.filter((w) => w !== s.blank);
  const options = shuffleArray([s.blank, ...sampleN(others, CONFIG.meal.optionCount - 1)]);
  return { tokens, blankIdx: tokens.indexOf(s.blank), answer: s.blank, de: s.de, options };
}

// The keeper, wherever the room put him — the plate starts in his hands.
function barKeeper() {
  return tavern.people.find((p) => p.cast === "keeper") || null;
}

// --- bubbles ----------------------------------------------------------------
// A panel with a chamfered #222222 outline, drawn the way the sheet outlines
// everything else. `fill` is parchment for speech and dulls for a struck-out
// plaque; the corner pixels are left out rather than rounded, which is how a
// four-pixel radius reads at this size.
function pxPanel(r, x, y, w, h, fill, ink) {
  r(x + 1, y, w - 2, h, ink);
  r(x, y + 1, w, h - 2, ink);
  r(x + 2, y + 1, w - 4, h - 2, fill);
  r(x + 1, y + 2, w - 2, h - 4, fill);
}

// One speech bubble, baked. `lines` are { text, col }; `tail` is which side the
// speaker is on ("up" = the bubble hangs below them, "down" = above them) and
// `tailAt` how far along the bubble the speaker stands, so the nub points at the
// mouth rather than at the middle of a bubble that has been shoved off-centre to
// stay on screen.
function bakeBubble(lines, tail, tailAt) {
  const textW = Math.max(1, ...lines.map((l) => PF.width(l.text)));
  const bw = textW + BUB.pad * 2;
  const bh = lines.length * PF.LINE + BUB.pad * 2;
  const th = tail ? BUB.tail : 0;
  const top = tail === "up" ? th : 0;
  const cv = tavArt(bw, bh + th, (ctx, r) => {
    pxPanel(r, 0, top, bw, bh, TP.bone, TP.ink);
    // The nub, and the hole it opens in the outline it grows out of.
    const tx = Math.max(3, Math.min(bw - 4, Math.round(tailAt)));
    for (let i = 0; i < th; i++) {
      const half = th - i;
      const y = tail === "up" ? i : bh + i;
      r(tx - half, y, half * 2 + 1, 1, TP.ink);
      if (i > 0) r(tx - half + 1, y, half * 2 - 1, 1, TP.bone);
    }
    r(tx - 1, tail === "up" ? th : bh - 1, 3, 1, TP.bone);
    lines.forEach((l, i) => {
      PF.draw(ctx, l.text, BUB.pad, top + BUB.pad + i * PF.LINE + PF.H - 1, l.col);
    });
  });
  cv.tailSide = tail;
  return cv;
}

// The order itself is laid out token by token rather than as one string: the
// blank is a SLOT, drawn as a plate the answer lands on, and a slot has to know
// where it sits to be filled. Wrapping is by whole tokens for the same reason.
function bakeOrderBubble(meal, tailAt) {
  const q = meal.q;
  const answered = meal.stage !== "order";
  const maxW = Math.max(70, Math.min(tavern.artW - BUB.edge * 2 - BUB.pad * 2, 160));
  const slotW = PF.width(q.answer) + 6;
  const tokens = q.tokens.map((t, i) => (i === q.blankIdx
    ? { text: t, w: slotW, slot: true }
    : { text: t, w: PF.width(t), slot: false }));

  // Wrap: greedy, by token, with a space between.
  const space = PF.width(" ") + PF.GAP;
  const rows = [[]];
  let used = 0;
  for (const t of tokens) {
    const add = (rows[rows.length - 1].length ? space : 0) + t.w;
    if (rows[rows.length - 1].length && used + add > maxW) { rows.push([]); used = 0; }
    else used += add - t.w;
    rows[rows.length - 1].push(Object.assign({ x: used }, t));
    used += t.w;
  }
  const hint = PF.wrap(q.de, maxW);
  const textW = Math.max(
    ...rows.map((row) => (row.length ? row[row.length - 1].x + row[row.length - 1].w : 0)),
    ...hint.map((h) => PF.width(h)), 1);

  const bw = textW + BUB.pad * 2;
  const bodyH = (rows.length + hint.length) * PF.LINE;
  const bh = bodyH + BUB.pad * 2;
  const th = BUB.tail;
  return tavArt(bw, bh + th, (ctx, r) => {
    pxPanel(r, 0, th, bw, bh, TP.bone, TP.ink);
    const tx = Math.max(3, Math.min(bw - 4, Math.round(tailAt)));
    for (let i = 0; i < th; i++) {
      const half = th - i;
      r(tx - half, i, half * 2 + 1, 1, TP.ink);
      if (i > 0) r(tx - half + 1, i, half * 2 - 1, 1, TP.bone);
    }
    r(tx - 1, th, 3, 1, TP.bone);

    rows.forEach((row, li) => {
      const base = th + BUB.pad + li * PF.LINE + PF.H - 1;
      for (const t of row) {
        const x = BUB.pad + t.x;
        if (!t.slot) { PF.draw(ctx, t.text, x, base, TP.ink); continue; }
        if (answered) {
          // What he said, on a plate of its own so the eye goes to it.
          r(x - 1, base - PF.H - 1, t.w + 2, PF.H + 3, TP.gold);
          PF.draw(ctx, t.text, x + 3, base, TP.ink);
        } else {
          r(x, base + 1, t.w, 1, TP.woodDark);        // the line to be filled in
          r(x + 1, base - 1, 1, 1, TP.stoneLit);      // …and a hint of dots on it
          r(x + Math.round(t.w / 2), base - 1, 1, 1, TP.stoneLit);
          r(x + t.w - 2, base - 1, 1, 1, TP.stoneLit);
        }
      }
    });
    hint.forEach((h, li) => {
      PF.draw(ctx, h, BUB.pad, th + BUB.pad + (rows.length + li) * PF.LINE + PF.H - 1, TP.stone);
    });
  });
}

// A menu plaque: the word, on parchment, big enough to be pressed. A word the
// keeper couldn't place keeps its place in the menu but goes grey and struck
// through — it stays visible because it is the wrong answer to THIS order, which
// is worth seeing next to the right one.
function bakeChip(word, wrong) {
  const w = PF.width(word) + BUB.chipPadX * 2;
  const h = BUB.chipH;
  const cv = tavArt(w, h, (ctx, r) => {
    pxPanel(r, 0, 0, w, h, wrong ? TP.stoneLit : TP.bone, TP.ink);
    const base = Math.round((h + PF.H) / 2) - 1;
    PF.draw(ctx, word, BUB.chipPadX, base, wrong ? TP.stone : TP.ink);
    if (wrong) r(4, base - 2, w - 8, 1, TP.ink);
  });
  cv.chipW = w;
  return cv;
}

// Everything the bar draws, positioned. Rebuilt when the stage changes rather
// than every frame — baking text is the expensive part and none of it moves.
//
// The hero's words hang directly under him and the menu under those, as one
// stack: a bubble belongs at the mouth that said it, and a menu that is what he
// is choosing to say belongs with it. The stack is only pushed up if it would
// run off the bottom of a short room, which is the one case where being read
// beats being attached.
function layoutBarMeal() {
  const meal = tavern && tavern.meal;
  if (!meal) return;
  const { artW, artH } = tavern;
  const m = tavern.mage;
  const k = barKeeper();
  const answered = meal.stage !== "order";
  const done = meal.stage === "cheer" || meal.stage === "done";
  const clampX = (x, w) => Math.max(BUB.edge, Math.min(artW - BUB.edge - w, Math.round(x - w / 2)));

  // What he is saying. When the plate is empty there is nothing left to order —
  // just thanks.
  const heroLines = done
    ? [{ text: BAR_KEEPER.thanks.it, col: TP.ink }, { text: BAR_KEEPER.thanks.de, col: TP.stone }]
    : null;
  const measure = heroLines ? bakeBubble(heroLines, "up", 0) : bakeOrderBubble(meal, 0);
  const heroX = clampX(m.x, measure.width);
  // Re-baked once the x is known, so the nub points at the mage rather than at
  // the middle of a bubble that has been pushed sideways to stay on screen.
  const tailAt = m.x - heroX;
  const heroArt = heroLines ? bakeBubble(heroLines, "up", tailAt) : bakeOrderBubble(meal, tailAt);

  // The menu under it, two to a row.
  const arts = answered ? [] : meal.q.options.map((w) => bakeChip(w, meal.wrong.includes(w)));
  const colW = arts.length ? Math.max(...arts.map((a) => a.chipW)) : 0;
  const rows = Math.ceil(arts.length / 2);
  const menuH = rows ? rows * (BUB.chipH + BUB.gap) - BUB.gap + BUB.gap : 0;

  const stackH = heroArt.height + menuH;
  const top = Math.max(BUB.edge, Math.min(Math.round(m.y) + 5, artH - BUB.edge - stackH));
  meal.heroBubble = { art: heroArt, x: heroX, y: top };

  meal.chips = [];
  if (arts.length) {
    // Centred on the MAGE, not on the room: the menu is the bottom of his own
    // stack, and centring it in a wide room leaves it standing on its own.
    const x0 = clampX(m.x, colW * 2 + BUB.gap);
    const y0 = top + heroArt.height + BUB.gap;
    arts.forEach((art, i) => {
      const cx = x0 + (i % 2) * (colW + BUB.gap) + Math.round((colW - art.chipW) / 2);
      const cy = y0 + Math.floor(i / 2) * (BUB.chipH + BUB.gap);
      meal.chips.push({ art, word: meal.q.options[i], x: cx, y: cy, w: art.chipW, h: BUB.chipH });
    });
  }

  // And the keeper's, above his head.
  const kLine = !answered && meal.puzzled ? meal.puzzled : (answered && !done ? meal.reply : meal.greet);
  if (k && !done) {
    const art = bakeBubble(
      [{ text: kLine.it, col: TP.ink }, { text: kLine.de, col: TP.stone }], "down", 0);
    const x = clampX(k.x, art.width);
    meal.keeperBubble = {
      art: bakeBubble([{ text: kLine.it, col: TP.ink }, { text: kLine.de, col: TP.stone }],
        "down", k.x - x),
      x, y: Math.max(BUB.edge, k.y - 24 - art.height),
    };
  } else {
    meal.keeperBubble = null;
  }
}

// What the meal was worth, floating off the mage: baked once, when it is
// granted. Haloed rather than shadowed — it crosses the counter, the floor and
// whoever is standing between, and a single offset shadow disappears against
// half of them.
function bakeMealGain(amount) {
  const text = `⛨ +${amount}`;
  const w = PF.width(text) + 2;
  return tavArt(w, PF.H + 2, (ctx) => {
    for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2]]) PF.draw(ctx, text, dx, dy + PF.H - 1, TP.ink);
    PF.draw(ctx, text, 1, PF.H, CONFIG.colors.sceneRune.bright);
  });
}

function openBarOrder(now) {
  if (!tavern || tavern.meal) return;          // already mid-order: don't re-deal it
  const m = tavern.mage;
  m.moving = false;
  m.waitUntil = Infinity;                      // he stays at the counter until this is over
  tavern.meal = {
    q: barDrawOrder(),
    greet: mealPick(BAR_KEEPER.greet),
    reply: mealPick(BAR_KEEPER.serve),
    puzzled: null,
    wrong: [],
    stage: "order",
    t0: now || performance.now(),
    bites: 0,
    bits: [],
    shield: 0,
    chips: [],
    dirty: false,
  };
  layoutBarMeal();
}

function closeBarOrder() {
  if (!tavern || !tavern.meal) return;
  tavern.meal = null;
  tavern.mage.bob = 0;
  tavern.mage.waitUntil = performance.now() + 400;   // and back to strolling
  tavern.focus = null;
}

// A tap on a menu plaque — from the pixels in tavernTapPoint, since the menu is
// painted into the scene rather than laid over it.
function barOrderPick(word) {
  const meal = tavern && tavern.meal;
  if (!meal || meal.stage !== "order") return;
  if (word === meal.q.answer) {
    meal.stage = "reply";
    meal.t0 = performance.now();
    meal.item = word;
  } else if (!meal.wrong.includes(word)) {
    meal.wrong.push(word);
    meal.puzzled = mealPick(BAR_KEEPER.puzzled);
  }
  meal.dirty = true;
}

// The meal in HP: a tenth of the hero's pool, as absorb. It tops the shield UP
// to that rather than stacking onto it, so a second helping on a full stomach is
// worth nothing — see CONFIG.meal. During a run it goes straight into the pool
// he is fighting on; between runs it waits in `state.mealShield`, because
// startRun clears heroShield and would otherwise eat the meal on the way in.
function grantMealShield() {
  const amount = Math.max(1, Math.round(state.heroMaxHP * CONFIG.meal.shieldFraction));
  if (state.runActive) state.heroShield = Math.max(state.heroShield || 0, amount);
  else state.mealShield = Math.max(state.mealShield || 0, amount);
  return amount;
}

// Crumbs off a bite, drops off a sip: a handful of pixels thrown down and out,
// tinted from the serving's own art so nothing new enters the room.
function mealBits(meal, x, y) {
  const drink = TAV_MEAL[meal.item].kind === "drink";
  const cols = drink ? [TP.white, TP.bone] : [TP.woodDark, TP.wood, TP.bone];
  for (let i = 0; i < (drink ? 3 : 4); i++) {
    meal.bits.push({
      x, y,
      vx: (Math.random() - 0.5) * 0.03,
      vy: -0.012 - Math.random() * 0.012,
      life: 420 + Math.random() * 220,
      born: performance.now(),
      col: cols[i % cols.length],
    });
  }
}

function updateBarMeal(now, dt) {
  const meal = tavern.meal;
  if (!meal) return;
  const since = now - meal.t0;
  const m = tavern.mage;

  if (meal.stage === "reply" && since >= MEAL_MS.reply) {
    meal.stage = "serve"; meal.t0 = now; meal.dirty = true;
  } else if (meal.stage === "serve" && since >= MEAL_MS.serve) {
    meal.stage = "eat"; meal.t0 = now;
  } else if (meal.stage === "eat") {
    const want = Math.min(MEAL_BITES, Math.floor(since / MEAL_MS.bite));
    while (meal.bites < want) {
      meal.bites++;
      mealBits(meal, m.x + (m.facing >= 0 ? 5 : -5), m.y - 14);
    }
    if (since >= MEAL_BITES * MEAL_MS.bite) {
      meal.stage = "cheer"; meal.t0 = now;
      meal.shield = grantMealShield();       // the plate is empty: this is what it was worth
      meal.gain = bakeMealGain(meal.shield);
      meal.dirty = true;
    }
  } else if (meal.stage === "cheer") {
    // A little hop on the spot — the one moment the mage is pleased with himself.
    m.bob = Math.max(0, Math.sin((since / MEAL_MS.cheer) * Math.PI * 2) * 3);
    if (since >= MEAL_MS.cheer) { meal.stage = "done"; meal.t0 = now; m.bob = 0; meal.dirty = true; }
  } else if (meal.stage === "done" && since >= MEAL_MS.after) {
    closeBarOrder();
    return;
  }

  for (const b of meal.bits) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.vy += 0.00016 * dt;                    // they fall
  }
  meal.bits = meal.bits.filter((b) => now - b.born < b.life);
  if (meal.dirty) { meal.dirty = false; layoutBarMeal(); }
}

// Where the serving is, in room coordinates, at this instant.
function mealSpot(meal, now) {
  const m = tavern.mage;
  const hx = m.x + (m.facing >= 0 ? 5 : -5);
  // Held at the hand, low enough to read against his robe: at chest height a
  // brown loaf is brown wood on the counter behind him and disappears.
  const rest = m.y - 9;
  if (meal.stage === "serve") {
    const k = barKeeper();
    const from = k ? { x: k.x, y: k.y - 12 } : { x: hx, y: rest };
    const t = Math.min(1, (now - meal.t0) / MEAL_MS.serve);
    return {
      x: from.x + (hx - from.x) * t,
      // slid across the counter and lifted off it, rather than teleported
      y: (from.y + (rest - from.y) * t) - Math.sin(t * Math.PI) * 5,
      t,
    };
  }
  // Eating: raised to the face as each bite lands, and lowered again. A small
  // lift on purpose — the serving is nearly as tall as the mage's head, so a big
  // one sails over his hat instead of reaching his mouth.
  const lift = meal.stage === "eat"
    ? Math.max(0, Math.sin(((now - meal.t0) % MEAL_MS.bite) / MEAL_MS.bite * Math.PI)) * 3
    : 0;
  return { x: hx, y: rest - lift, t: 1 };
}

function drawBarMeal(ctx, now) {
  const meal = tavern && tavern.meal;
  if (!meal || !meal.item) return;
  const art = TAV.meal[meal.item];
  if (!art) return;
  const m = tavern.mage;
  const drink = TAV_MEAL[meal.item].kind === "drink";
  const eaten = meal.stage === "cheer" || meal.stage === "done"
    ? 1 : meal.bites / MEAL_BITES;

  if (eaten < 1) {
    const at = mealSpot(meal, now);
    const x = Math.round(at.x - art.width / 2), y = Math.round(at.y - art.height);
    ctx.save();
    if (drink) {
      // Tipped further back with every sip: the mug empties by the angle it is
      // held at, which is what drinking looks like at eleven pixels tall.
      ctx.translate(x + art.width / 2, y + art.height);
      ctx.rotate((m.facing >= 0 ? -1 : 1) * eaten * 0.6);
      ctx.drawImage(art, -art.width / 2, -art.height);
    } else {
      // Bitten down from the top — what is left is what he has not eaten yet.
      ctx.beginPath();
      ctx.rect(x, y + art.height * eaten, art.width, art.height * (1 - eaten));
      ctx.clip();
      ctx.drawImage(art, x, y);
    }
    ctx.restore();
  }

  for (const b of meal.bits) {
    const k = 1 - (now - b.born) / b.life;
    if (k <= 0) continue;
    ctx.globalAlpha = Math.min(1, k * 1.6);
    ctx.fillStyle = b.col;
    ctx.fillRect(Math.round(b.x), Math.round(b.y), 1, 1);
  }
  ctx.globalAlpha = 1;

  // The shield settling on him: the room's arcane glow, and a ring closing in.
  if (meal.stage === "cheer") {
    const t = Math.min(1, (now - meal.t0) / MEAL_MS.cheer);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = (1 - t) * 0.9;
    ctx.drawImage(TAV.glowMeal, Math.round(m.x - 16), Math.round(m.y - 30));
    ctx.strokeStyle = CONFIG.colors.sceneRune.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(m.x, m.y - 11, 3 + (1 - t) * 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// The talking, and the menu it is waiting on. Drawn last of all — a bubble is
// read over everything, including the person who said it.
function drawBarSpeech(ctx, now) {
  const meal = tavern && tavern.meal;
  if (!meal) return;
  const m = tavern.mage;
  for (const b of [meal.keeperBubble, meal.heroBubble]) {
    if (b) ctx.drawImage(b.art, b.x, b.y);
  }
  for (const c of meal.chips) ctx.drawImage(c.art, c.x, c.y);

  // What it was worth, rising off him and fading as it goes.
  if (meal.gain && (meal.stage === "cheer" || meal.stage === "done")) {
    const t = Math.min(1, (now - (meal.stage === "cheer" ? meal.t0 : meal.t0 - MEAL_MS.cheer))
      / (MEAL_MS.cheer + MEAL_MS.after));
    ctx.globalAlpha = Math.max(0, 1 - t * t);
    ctx.drawImage(meal.gain,
      Math.round(m.x - meal.gain.width / 2),
      Math.round(m.y - 26 - t * 12));
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
function drawTavernActor(ctx, a, now) {
  const skin = TAV.cast[a.cast];
  if (!skin) return;
  const set = a.moving ? (a.facing < 0 ? skin.runL : skin.run) : (a.facing < 0 ? skin.idleL : skin.idle);
  const f = Math.floor(now / (a.moving ? 110 : 170) + a.phase) % set.length;
  const x = Math.round(a.x - skin.w / 2), y = Math.round(a.y - skin.h - (a.bob || 0));
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
      // A candle STANDS on the table. It used to be planted at the top of the
      // table's bounding box — the far rim of the top ellipse — so it hovered
      // over the boards rather than resting on them. `art.top` is the middle of
      // the surface, which is where a thing put down on a table ends up.
      const t = p.art.top || { x: p.w / 2, y: 1 };
      const cx = Math.round(p.x + t.x), cy = Math.round(p.feet - p.h + t.y);
      // Its dish, tilted the same half as the top it sits on: seven across reads
      // as two rows deep. The shadow under it is what says "on", not "above".
      ctx.fillStyle = "rgba(0, 0, 0, 0.32)"; ctx.fillRect(cx - 3, cy + 1, 7, 1);
      ctx.fillStyle = TP.ink;  ctx.fillRect(cx - 3, cy, 7, 1);
      ctx.fillStyle = TP.gold; ctx.fillRect(cx - 2, cy - 1, 5, 1);
      ctx.fillStyle = TP.white; ctx.fillRect(cx - 1, cy - 6, 2, 5);
      ctx.fillStyle = TP.bone;  ctx.fillRect(cx, cy - 5, 1, 4);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(255, 226, 150, 0.95)";
      ctx.fillRect(cx - 1, cy - 9 - (Math.sin(now / 170 + p.x) > 0 ? 1 : 0), 2, 3);
      ctx.globalAlpha = 0.7 + 0.3 * Math.sin(now / 210 + p.x);
      ctx.drawImage(TAV.glowCandle, cx - 9, cy - 17);
      ctx.restore();
    }
  }

  // What the bar served, over the mage rather than sorted with him: he is
  // holding it out in front of himself.
  drawBarMeal(ctx, now);

  // The room's own edges, pinned over everything.
  ctx.drawImage(tavern.vignette, 0, 0);

  // …except the speech, which is over the edges too: the menu is pressed, and
  // the vignette darkening a plaque would darken a tap target.
  drawBarSpeech(ctx, now);
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
  updateBarMeal(now, dt);
  renderTavern(now);
  const chips = document.getElementById("tav-chips");
  if (chips) {
    // While the bar is talking the station labels step aside: the menu painted
    // in the scene is what is being pressed, and a chip floating over it is a
    // second thing to tap in the same place. The floor still walks him away.
    chips.classList.toggle("hushed", !!tavern.meal);
    for (const el of chips.children) {
      el.classList.toggle("on", el.dataset.station === tavern.focus);
    }
  }
}

window.Incanto.tavern = {
  renderTavernFull, patchTavernContinuous, tavernGo, tavernTapPoint, setupTavern,
  openBarOrder, closeBarOrder, barOrderPick, grantMealShield, TAV_MEAL,
};
