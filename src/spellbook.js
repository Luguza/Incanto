"use strict";
// ==============================================================================
// spellbook.js — the hero's open spell book along the bottom of the combat
// screen. Owns: page geometry, the manuscript layout, SPELL_ART (the animated
// page effects), renderSpellbook, spellbookFlip.
//
// The book lies open toward the player, its two page planes tilted up and out
// so their top edges form a shallow V with the spine at the bottom of the
// notch — and the rune circle above drops into that notch (see combat.css,
// which pulls the arena's box down over the book's upper half).
//
// One spell per page, and the page is WRITTEN: a rubricated title under a ruled
// head, an illuminated initial, the page's own great rune sunk into the middle
// of it, and runic script over every line from the head to off the bottom of the
// screen. The spell's effect plays over the whole leaf — no frame, no plate, no
// window cut into the paper.
//
// Four things are worth knowing before changing any of it:
//   * Content is laid out in the page's own paper coordinates and mapped on by a
//     PROJECTIVE transform (see pageProject), not a rotation. The book is tilted
//     toward the player, so a page converges as it recedes; anything laid on it
//     with a rotation stays stubbornly rectangular and reads as a sticker.
//   * A page of script is ~700 glyphs, emitted into a single <path> and cached —
//     the book is rebuilt wholesale on every structural render.
//   * The effects animate from CSS keyframes (combat.css), never from JS. Each
//     class has one duration, and spellbook hands it a negative animation-delay
//     so a rebuild doesn't restart the motion.
//   * Each side of the spread carries an UNDER-LEAF, the page a turn would bring
//     up. It is what a page turn uncovers; without it a turn reveals the board.
//
// Everything here is drawn in the book SVG's own 600-wide viewBox, which is the
// same width as the arena's, so the two share a horizontal scale and the notch
// lines up with the circle at every viewport size.
// ==============================================================================

// --- Page geometry -----------------------------------------------------------
// The left page as a quad, corners clockwise from its outer top. The right page
// is this mirrored about x = 300 (the spine).
//
// The top edges climb ~16° from the spine out to the wings — enough of a V for
// the rune wheel to sit down into, without raking the book so hard that the
// pages read as seen edge-on.
//
// Both lower corners sit well BELOW the viewBox and are clipped away, the inner
// (spine) one furthest of all, so the gutter runs off the bottom of the screen
// rather than stopping on it. Nothing is lost — the part of a page below its
// illustration is blank vellum — and the payoff is that the book's thickness
// (cover rim, the slivers of already-turned pages) is only ever visible along
// the OUTER edges at the left and right of the screen. There is no bottom edge
// on screen for it to show up on.
const BOOK_W = 600, BOOK_H = 240;
const SPINE_X = 300;
const NOTCH_Y = 110;                   // where both pages meet at the top — the bottom of the V
const PAGE_L = [
  { x: 34, y: 34 },                    // outer top    — the high corner of the wing
  { x: SPINE_X, y: NOTCH_Y },          // inner top    — the notch
  { x: SPINE_X, y: 340 },              // inner bottom — far below the viewBox: the gutter runs off screen
  { x: 4, y: 274 },                    // outer bottom — below the viewBox too, so no bottom edge shows
];
// Paper doesn't lie dead flat in an open book. Both visible edges bow: the top
// edge lifts through its middle, and the outer edge bellies out toward the
// screen edge. The two clipped lower edges stay straight — nobody sees them.
const TOP_BOW = 7, OUT_BOW = 5;
// How far a page must be dragged, as a fraction of the book's width, before
// letting go turns the leaf instead of springing it back.
const FLIP_THRESHOLD = 0.12;

const mirror = (p) => ({ x: 2 * SPINE_X - p.x, y: p.y });
const pageCorners = (side) => (side < 0 ? PAGE_L : PAGE_L.map(mirror));

// The control point for a bowed edge: the midpoint of P→Q pushed out along the
// edge's normal. `side` flips the push for the mirrored page, so both leaves bow
// away from the spine rather than one bowing into itself.
function bowCtrl(p, q, amount, side) {
  const dx = q.x - p.x, dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const k = (amount * -side) / len;
  return { x: (p.x + q.x) / 2 + dy * k, y: (p.y + q.y) / 2 - dx * k };
}

// A leaf's outline: bowed along the two edges that are on screen, straight
// along the two that are clipped off the bottom.
function leafPath(side) {
  const [A, B, C, D] = pageCorners(side);
  const t = bowCtrl(A, B, TOP_BOW, side);       // top edge, lifted through its middle
  const o = bowCtrl(D, A, OUT_BOW, side);       // outer edge, bellied toward the screen edge
  const f = (p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  return `M${f(A)} Q${f(t)} ${f(B)} L${f(C)} L${f(D)} Q${f(o)} ${f(A)} Z`;
}

// Just the bowed top edge, for the lit paper-cut highlight that runs along it.
function leafTopEdge(side) {
  const [A, B] = pageCorners(side);
  const t = bowCtrl(A, B, TOP_BOW, side);
  const f = (p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  return `M${f(A)} Q${f(t)} ${f(B)}`;
}

// The bookmark on the page the book is currently cast from. A real ribbon is
// sewn into the HEAD OF THE SPINE and lies down the page from there, so that is
// where this one comes from — hanging it over the fore-edge would put it
// exactly where the fanned page edges show and read as a flag stapled to the
// paper. It lies in the gutter strip, which is empty (the ruled frame starts
// further out), and ends in the usual swallow-tail notch.
function ribbonPath(side) {
  const [A, B] = pageCorners(side);
  const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
  const e = { x: dx / len, y: dy / len };                       // along the top edge, spine-ward
  const d = side < 0 ? { x: -e.y, y: e.x } : { x: e.y, y: -e.x }; // down the page, away from the head
  const at = (along, down) => ({
    x: B.x - e.x * along + d.x * down,
    y: B.y - e.y * along + d.y * down,
  });
  const f = (p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  return `<path d="M${f(at(7, -3))} L${f(at(19, -3))} L${f(at(19, 64))} ` +
    `L${f(at(13, 52))} L${f(at(7, 64))} Z"/>`;
}

// --- The page plane, in perspective ------------------------------------------
// Everything WRITTEN on a leaf is laid out in the page's own paper coordinates
// (u across, v down, PAGE_W x PAGE_H) and mapped onto the leaf by a PROJECTIVE
// transform — the homography taking the unit square to the leaf's four corners.
//
// It has to be projective rather than a rotation, because the book is tilted
// toward the player: the head of a page is further away than its foot. The leaf
// itself is already drawn that way — its foot edge is the wider of the two — and
// a rotation lays dead-straight, dead-parallel content onto a shape that
// converges. A rectangle would stay a rectangle instead of narrowing as it
// recedes, which is exactly what gives a flat sticker stuck on a tilted plane.
// Under the homography a page rectangle comes out as the trapezoid you would
// actually see, straight lines stay straight, and glyphs shrink toward the head
// on their own without anything scaling them by hand.
//
// SVG has no projective transform, so none of this is done with a `transform`
// attribute: paths are emitted point by point through `at()`. The two things
// that CANNOT be warped that way — SVG <text>, and the spell effect floating
// above the paper — are placed with `frameAt()`, the projection differentiated
// at a point. That puts them on the page plane at the right tilt and the right
// size for their depth without bending the letters of a word or squashing the
// effect's circles into eggs.
//
// Reading order is the book's, not the screen's: u runs fore-edge -> spine on
// the left leaf and gutter -> fore-edge on the right, which is how the two
// halves of a spread are actually written. Because the leaves are mirror images
// that comes out left-to-right on screen for both, so no glyph is ever mirrored.
const PAGE_W = 285, PAGE_H = 250;      // the leaf in paper units, head to foot

function pageProject(side) {
  const c = pageCorners(side);
  // (0,0) is where the first line starts, (1,0) where it ends, and (.,1) the
  // foot of the leaf below each.
  const [P0, P1, P2, P3] = side < 0 ? [c[0], c[1], c[2], c[3]] : [c[1], c[0], c[3], c[2]];
  const sx = P0.x - P1.x + P2.x - P3.x;
  const sy = P0.y - P1.y + P2.y - P3.y;
  let a, b, d, e, g, h;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    // A parallelogram has no vanishing point, so the homography degenerates to
    // the affine case — and the general solution below would divide by zero.
    g = 0; h = 0;
    a = P1.x - P0.x; b = P3.x - P0.x;
    d = P1.y - P0.y; e = P3.y - P0.y;
  } else {
    const dx1 = P1.x - P2.x, dx2 = P3.x - P2.x;
    const dy1 = P1.y - P2.y, dy2 = P3.y - P2.y;
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    h = (dx1 * sy - sx * dy1) / den;
    a = P1.x - P0.x + g * P1.x; b = P3.x - P0.x + h * P3.x;
    d = P1.y - P0.y + g * P1.y; e = P3.y - P0.y + h * P3.y;
  }
  const cx = P0.x, cy = P0.y;
  const at = (u, v) => {
    const s = u / PAGE_W, t = v / PAGE_H;
    const w = g * s + h * t + 1;
    return { x: (a * s + b * t + cx) / w, y: (d * s + e * t + cy) / w };
  };
  return {
    at,
    // A paper point as path data.
    p: (u, v) => { const q = at(u, v); return q.x.toFixed(1) + " " + q.y.toFixed(1); },
    // The projection's local affine frame at a point, for the children that
    // can't be warped vertex by vertex.
    frameAt: (u, v) => {
      const o = at(u, v), k = 4;
      const eu = at(u + k, v), ev = at(u, v + k);
      const m = [(eu.x - o.x) / k, (eu.y - o.y) / k, (ev.x - o.x) / k, (ev.y - o.y) / k, o.x, o.y];
      return `matrix(${m.map((n) => n.toFixed(4)).join(" ")})`;
    },
  };
}

// --- Manuscript layout (all in paper units) ----------------------------------
// A written page: a rubricated title under a ruled head, an illuminated initial,
// the page's own great rune sunk into the middle of it, and runic script filling
// every line from the head to off the bottom of the screen.
const MARGIN = 16;                     // ink-free strip inside both side edges
const HEAD_V = 25;                     // baseline of the title
const RULE_V = 35;                     // the double rule under it
const BODY_TOP = 47;                   // first line of body script
const LINE_H = 11.5;                   // leading
const GLYPH_H = 7;                     // cap height of a script glyph
const GLYPH_ADV = 5.4;                 // pen advance between glyphs
const WORD_GAP = 4.4;                  // and between words
const INITIAL = { w: 18, h: 19 };      // the illuminated capital opening the body
// The page's great rune: one glyph blown up to most of the text block, ringed
// twice. It is the page's GROUND, not a picture set into a hole in it, so the
// script runs straight over the top of it.
const SIGIL = { u: PAGE_W / 2, v: 94, h: 88, r: 63 };
// Where the spell's effect is anchored. It plays over the whole leaf rather than
// inside a frame, so this is only the origin of its local page frame.
const FX = { u: PAGE_W / 2, v: 92, scale: 1.12 };

// One glyph as an absolute subpath, every vertex taken through the projection.
// The whole body of a page is emitted into a SINGLE <path> this way: ~700 glyphs
// as 700 elements would be a real cost on a phone, and they all share one stroke.
function glyphSub(P, u, v, h, seed) {
  const tpl = GLYPH_TEMPLATES[tileHash(seed, 31) % GLYPH_TEMPLATES.length];
  const k = h / 10;                    // templates span -5..5
  let s = "";
  for (let i = 0; i < tpl.length; i++) {
    s += (i ? "L" : "M") + P.p(u + tpl[i][0] * k, v + tpl[i][1] * k);
  }
  return s;
}

// Fill one line with words of 2-6 glyphs, stopping when the next word would
// overrun. The leftover is the line's ragged edge — a hard stop at a fixed width
// would read as a printed block rather than a written one.
function scriptRun(P, u0, u1, v, seed, n0) {
  let s = "", u = u0, n = n0;
  while (u < u1) {
    let word = 2 + (tileHash(seed, n * 7 + 3) % 5);
    if (u + word * GLYPH_ADV > u1) {
      word = 2;                        // try to squeeze a short word into the tail
      if (u + word * GLYPH_ADV > u1) break;
    }
    for (let i = 0; i < word; i++) s += glyphSub(P, u + i * GLYPH_ADV, v, GLYPH_H, seed * 13 + n * 11 + i);
    u += word * GLYPH_ADV + WORD_GAP;
    n++;
  }
  return s;
}

// The body of a page: every line from under the head to past the foot of the
// screen, the first two wrapped around the illuminated initial. Deterministic in
// `seed`, so a page reads the same every time it is opened.
function pageScript(P, seed) {
  let s = "", n = 0;
  for (let v = BODY_TOP, line = 0; v <= PAGE_H; v += LINE_H, line++) {
    s += scriptRun(P, MARGIN + (line < 2 ? INITIAL.w + 4 : 0), PAGE_W - MARGIN, v, seed, n);
    n += 9;
  }
  return s;
}

// Building ~700 glyphs into a path string is cheap but not free, and the book is
// rebuilt wholesale on every structural render (a re-deal, a page turn, picking
// a spell). The script is deterministic, so compute it once per page and keep it.
const scriptCache = {};
function cachedScript(P, seed, key) {
  if (scriptCache[key] === undefined) scriptCache[key] = pageScript(P, seed);
  return scriptCache[key];
}

// The ruled box the text block sits in. Its four corners go through the same
// projection as everything else, so it arrives as a trapezoid that converges
// with the leaf instead of a rectangle pasted flat on top of it. The foot is
// left open — it runs off the screen with the rest of the page.
function marginRule(P, inset) {
  const vTop = HEAD_V - 16, vBot = PAGE_H;
  return `M${P.p(inset, vBot)} L${P.p(inset, vTop)} ` +
    `L${P.p(PAGE_W - inset, vTop)} L${P.p(PAGE_W - inset, vBot)}`;
}

// The illuminated initial opening the body text, in a gilt box the first two
// lines of script wrap around.
function pageInitial(P, colour, seed) {
  const u = MARGIN, v = BODY_TOP - GLYPH_H / 2, w = INITIAL.w, h = INITIAL.h;
  return `<path class="bk-initial-box" d="M${P.p(u, v)} L${P.p(u + w, v)} ` +
      `L${P.p(u + w, v + h)} L${P.p(u, v + h)} Z"/>` +
    `<path class="bk-initial" stroke="${colour}" ` +
      `d="${glyphSub(P, u + w / 2, v + h / 2, h - 4, seed * 7 + 5)}"/>`;
}

// The page's great rune, laid under the script. Both rings are emitted as
// projected polygons rather than <circle>s — a circle drawn on a page tilted
// away from you is not a circle on screen, and the rings are the clearest place
// on the whole page to read that.
function pageSigil(P, colour, seed) {
  const ring = (r, n) => {
    let s = "";
    for (let i = 0; i <= n; i++) {
      const ang = (i / n) * Math.PI * 2;
      s += (i ? "L" : "M") + P.p(SIGIL.u + Math.cos(ang) * r, SIGIL.v + Math.sin(ang) * r);
    }
    return s + "Z";
  };
  let ticks = "";
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2 + 0.26;
    const co = Math.cos(ang), si = Math.sin(ang);
    ticks += `M${P.p(SIGIL.u + co * SIGIL.r * 0.9, SIGIL.v + si * SIGIL.r * 0.9)}` +
      `L${P.p(SIGIL.u + co * SIGIL.r, SIGIL.v + si * SIGIL.r)}`;
  }
  return `<g class="bk-sigil" stroke="${colour}">` +
    `<path class="bk-sigil-ring" d="${ring(SIGIL.r, 56)}"/>` +
    `<path class="bk-sigil-ring thin" d="${ring(SIGIL.r * 0.87, 56)}"/>` +
    `<path class="bk-sigil-tick" d="${ticks}"/>` +
    `<path class="bk-sigil-rune" d="${glyphSub(P, SIGIL.u, SIGIL.v, SIGIL.h, seed * 17 + 3)}"/>` +
    `</g>`;
}

// A spell's colour blended toward the page's ink, for the outlines of its
// effect. The palette in CONFIG is LIGHT — those tones were picked to glow on
// the dark combat canvas — and light-on-cream is barely a line at all. Three of
// the six (lightning, frost, heal) all but vanish on vellum at full tint.
//
// Darkening the same hue is what an illuminator would do: the art on the page is
// pigment, not a projection, so it reads by being darker than the paper rather
// than brighter. That keeps the vellum clean — the alternative, pooling shadow
// under the effect to give the light something to glow against, dims the very
// page the writing is supposed to fill.
function inkShade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [[(n >> 16) & 255, 0x2c], [(n >> 8) & 255, 0x1b], [n & 255, 0x12]];
  return "#" + ch.map(([c, t]) => Math.round(c + (t - c) * k).toString(16).padStart(2, "0")).join("");
}

// --- Page effects ------------------------------------------------------------
// One per spell, playing over the WHOLE leaf — authored in a box of roughly
// +-100 x +-95 paper units, which the page frame then lays onto the tilt. They
// are line art in the spell's own colour, matching the game's other procedural
// glyph work: `c` is the CONFIG.colors.spell entry, so a page, its bolt on the
// canvas and its sector in the tree all read as the same magic.
//
// The art is ANIMATED, and animated declaratively: every moving part carries a
// CSS class whose keyframes live in combat.css, so the loop costs nothing per
// frame and needs no JS driver. `D(period, phase)` is handed in by the caller —
// it returns a negative `animation-delay` that both staggers an element against
// its siblings and starts the loop at the phase the game clock is already at, so
// a structural re-render doesn't visibly restart the motion.
const SPELL_ART = {
  // A burning heart to the page, throwing licks of flame the height of it and
  // embers drifting up off the paper everywhere.
  fireball: (c, D) => {
    let motes = "";
    for (let i = 0; i < 11; i++) {
      const x = -88 + ((tileHash(i, 5) % 180));
      const y = 18 + ((tileHash(i, 9) % 70));
      motes += `<circle class="bk-fx-mote" cx="${x}" cy="${y}" ` +
        `r="${(1.8 + (tileHash(i, 13) % 22) / 10).toFixed(1)}" style="${D(2400, i * 218)}"/>`;
    }
    return `
    <circle class="bk-fx-pulse" cx="0" cy="4" r="66" fill="${c.mid}" opacity="0.1" style="${D(2600, 0)}"/>
    <circle class="bk-fx-ripple" cx="0" cy="4" r="42" fill="none" stroke="${c.deep}"
      stroke-width="2.8" style="${D(3000, 0)}"/>
    <circle class="bk-fx-ripple" cx="0" cy="4" r="42" fill="none" stroke="${c.deep}"
      stroke-width="1.8" style="${D(3000, 1500)}"/>
    <circle class="bk-fx-pulse" cx="0" cy="4" r="34" fill="${c.mid}" opacity="0.45" stroke="${c.deep}"
      stroke-width="2" style="${D(2600, 420)}"/>
    <circle class="bk-fx-pulse" cx="0" cy="4" r="15" fill="${c.core}" stroke="${c.deep}"
      stroke-width="1.6" style="${D(2600, 900)}"/>
    <g fill="none" stroke="${c.deep}" stroke-width="4.2" stroke-linecap="round">
      <path class="bk-fx-lick" d="M-26 -24 Q-20 -54 -6 -80" style="${D(1800, 0)}"/>
      <path class="bk-fx-lick" d="M12 -28 Q24 -56 34 -78" style="${D(1800, 600)}"/>
      <path class="bk-fx-lick" d="M-50 -12 Q-60 -42 -48 -68" style="${D(1800, 1200)}"/>
      <path class="bk-fx-lick" d="M40 -6 Q56 -32 50 -60" style="${D(1800, 900)}"/>
    </g>
    <g fill="${c.core}" stroke="${c.deep}" stroke-width="1.2">${motes}</g>`;
  },

  // A bolt down the whole height of the page: three forks take it in turn, each
  // lit for a fifth of the cycle, over a flash that fires with them.
  lightning: (c, D) => `
    <ellipse class="bk-fx-flash" cx="0" cy="0" rx="88" ry="82" fill="${c.mid}"
      opacity="0.15" style="${D(1500, 0)}"/>
    <g fill="${c.mid}" stroke="${c.deep}" stroke-width="2.6" stroke-linejoin="round">
      <path class="bk-fx-bolt" d="M18 -92 L-22 -6 L8 -2 L-16 92 L44 -14 L14 -18 Z" style="${D(1500, 0)}"/>
      <path class="bk-fx-bolt" d="M6 -92 L-34 -8 L-2 -4 L-26 92 L32 -12 L2 -16 Z" style="${D(1500, 500)}"/>
      <path class="bk-fx-bolt" d="M32 -92 L-8 -4 L22 0 L-2 92 L58 -12 L28 -16 Z" style="${D(1500, 1000)}"/>
    </g>
    <g fill="none" stroke="${c.deep}" stroke-width="3" stroke-linecap="round">
      <path class="bk-fx-bolt" d="M-30 -44 L-74 -14 L-52 -8" style="${D(1500, 250)}"/>
      <path class="bk-fx-bolt" d="M34 26 L82 56 L58 62" style="${D(1500, 750)}"/>
      <path class="bk-fx-bolt" d="M-26 34 L-70 62 L-48 68" style="${D(1500, 1250)}"/>
    </g>`,

  // A cone opening clear across the page, with crystals tumbling down it.
  frost: (c, D) => {
    const shard = (x, y, s, phase) =>
      `<g transform="translate(${x},${y}) scale(${s})"><g class="bk-fx-drift" style="${D(2800, phase)}">` +
      `<g class="bk-fx-spin" style="${D(4200, phase)}">` +
      `<path d="M-14 0 L14 0 M0 -14 L0 14 M-10 -10 L10 10 M10 -10 L-10 10"/></g></g></g>`;
    return `
    <path d="M-96 2 L86 -76 L86 80 Z" fill="${c.mid}" opacity="0.1"/>
    <path class="bk-fx-sweep" d="M-96 2 L86 -76 L86 80 Z" fill="${c.core}"
      opacity="0.14" style="${D(2600, 0)}"/>
    <path d="M-96 2 L86 -76 M-96 2 L86 80" fill="none" stroke="${c.deep}" stroke-width="3.4"
      stroke-linecap="round"/>
    <path d="M86 -76 L86 80" stroke="${c.deep}" stroke-width="2.2" opacity="0.5"/>
    <g stroke="${c.deep}" stroke-width="2.6" stroke-linecap="round" fill="none">
      ${shard(-34, -22, 1, 0)}${shard(0, 24, 0.8, 700)}${shard(18, -14, 1.2, 1400)}${shard(-14, 50, 0.7, 2100)}
    </g>`;
  },

  // Rocks falling the height of the page onto a cracked ground line near the
  // foot, each landing in a flash of its own — the burst is on the same period
  // as its rock, timed to the end of the fall.
  meteor: (c, D) => {
    const rock = (x, r, phase) =>
      `<g transform="translate(${x},0)"><g class="bk-fx-fall" style="${D(1900, phase)}">` +
      `<path d="M${(-r * 2.6).toFixed(1)} ${(-r * 3.6).toFixed(1)} L0 0" stroke="${c.deep}"
        stroke-width="3.4" stroke-linecap="round" opacity="0.9"/>` +
      `<circle r="${r}" fill="${c.core}" stroke="${c.deep}" stroke-width="1.6"/></g>` +
      `<ellipse class="bk-fx-burst" cy="50" rx="${(r * 2.8).toFixed(1)}" ry="${(r * 0.9).toFixed(1)}"
        fill="${c.core}" style="${D(1900, phase)}"/></g>`;
    // The ground line has to sit well above the foot of the art box: the lower
    // third of a leaf runs off the bottom of the screen, so anything landing at
    // the box's own floor lands where nobody can see it.
    return `
    <path d="M-94 50 L94 50" stroke="${c.deep}" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M-64 50 L-74 70 M-24 50 L-32 72 M18 50 L12 70 M60 50 L70 68" stroke="${c.deep}"
      stroke-width="2.4" stroke-linecap="round" opacity="0.7"/>
    ${rock(-66, 9, 0)}${rock(-30, 7, 500)}${rock(6, 8, 980)}${rock(44, 6, 1440)}${rock(74, 5, 260)}`;
  },

  // A ward standing over the whole page: a rune ring turning around a kite
  // shield, and a barrier pulsing out past the margins.
  shield: (c, D) => {
    let ring = "";
    for (let i = 0; i < 16; i++) ring += glyphAt(0, 0, 74, i * 22.5, 15, 91 + i, "bk-fx-glyph");
    return `
    <ellipse class="bk-fx-ward" rx="90" ry="86" fill="none" stroke="${c.deep}"
      stroke-width="2.6" style="${D(3000, 0)}"/>
    <g class="bk-fx-turn" stroke="${c.deep}" style="${D(24000, 0)}">${ring}</g>
    <g class="bk-fx-float" style="${D(3200, 0)}">
      <path d="M0 -62 L46 -38 L46 10 Q46 50 0 70 Q-46 50 -46 10 L-46 -38 Z"
        fill="${c.mid}" fill-opacity="0.4" stroke="${c.deep}" stroke-width="4" stroke-linejoin="round"/>
      <path d="M0 -38 L0 42 M-26 -6 L26 -6" stroke="${c.deep}" stroke-width="4.4" stroke-linecap="round"/>
      <path d="M-14 -24 L0 -38 L14 -24" fill="none" stroke="${c.deep}" stroke-width="3.4"
        stroke-linecap="round" stroke-linejoin="round"/>
    </g>`;
  },

  // A living sprig over a pulse running the width of the page — growth rather
  // than a medical cross — shedding motes that drift up off the paper.
  heal: (c, D) => {
    let motes = "";
    for (let i = 0; i < 9; i++) {
      const x = -86 + ((tileHash(i, 21) % 176));
      const y = 10 + ((tileHash(i, 27) % 66));
      motes += `<circle class="bk-fx-mote" cx="${x}" cy="${y}" ` +
        `r="${(1.7 + (tileHash(i, 31) % 20) / 10).toFixed(1)}" style="${D(2400, i * 267)}"/>`;
    }
    return `
    <ellipse class="bk-fx-ward" rx="86" ry="82" fill="none" stroke="${c.deep}"
      stroke-width="2.2" style="${D(3000, 0)}"/>
    <g class="bk-fx-float" style="${D(3200, 0)}">
      <path d="M0 -66 Q38 -16 38 12 Q38 50 0 50 Q-38 50 -38 12 Q-38 -16 0 -66 Z"
        fill="${c.mid}" fill-opacity="0.45" stroke="${c.deep}" stroke-width="4" stroke-linejoin="round"/>
      <path d="M0 -36 L0 30 M-21 -5 L21 -5" stroke="${c.deep}" stroke-width="4.6" stroke-linecap="round"/>
    </g>
    <path d="M-94 70 L-54 70 L-38 46 L-18 88 L-2 60 L14 70 L94 70" fill="none" stroke="${c.deep}"
      stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>
    <g fill="${c.core}" stroke="${c.deep}" stroke-width="1.2">${motes}</g>`;
  },
};

// --- Page rendering ----------------------------------------------------------
// One page of the book: a written leaf — a rubricated title under a ruled head,
// an illuminated initial, the page's great rune, and script over every line of
// it — with the spell's effect playing over the whole thing.
//
// `side` is -1 for the left leaf, +1 for the right. A sealed page keeps its
// writing but is illegible under a wax seal, and the page the book is CAST from
// carries a ribbon and a lit border. `under` marks an under-leaf: the page a
// turn would bring up, drawn beneath the open one and only ever glimpsed for a
// fifth of a second mid-turn, so it gets no effect, no ribbon and no tap target.
function spellPage(spell, side, under) {
  const d = leafPath(side);
  const key = side < 0 ? "L" : "R";
  const P = pageProject(side);
  // The paper itself: a gradient-filled leaf, a fibre wash and a little foxing
  // to break the flat fill, a shadow welling out of the gutter, a sheen along
  // the fore-edge where the sheet lifts, and the lit cut along the top edge.
  // Everything laid over the leaf is clipped to it so none of it reaches the
  // cover.
  const paper =
    `<path class="bk-leaf" d="${d}"/>` +
    `<g clip-path="url(#bkClip${key})">` +
      `<rect class="bk-fibre" x="0" y="0" width="${BOOK_W}" height="${BOOK_H}"/>` +
      `<g class="bk-foxing">` +
        `<ellipse cx="${side < 0 ? 46 : 554}" cy="88" rx="26" ry="17"/>` +
        `<ellipse cx="${side < 0 ? 120 : 480}" cy="216" rx="34" ry="20"/>` +
        `<ellipse cx="${side < 0 ? 24 : 576}" cy="180" rx="18" ry="26"/>` +
      `</g>` +
      `<rect class="bk-gutter" x="${side < 0 ? SPINE_X - 78 : SPINE_X}" ` +
        `y="0" width="78" height="${BOOK_H + 110}" fill="url(#bkGutter${key})"/>` +
      `<rect class="bk-foreedge" x="${side < 0 ? 0 : BOOK_W - 54}" y="0" ` +
        `width="54" height="${BOOK_H}" fill="url(#bkFore${key})"/>` +
    `</g>` +
    `<path class="bk-cut" d="${leafTopEdge(side)}"/>`;
  // Raised as the leaf swings over during a page turn (see setTurn): paper
  // turning away from the light goes dark, and without that a turn reads as a
  // page being squeezed thin rather than lifted.
  const shade = `<path class="bk-shade" d="${d}" opacity="0"/>`;

  if (!spell) {
    // An odd-numbered book would leave one blank leaf; draw it as empty vellum
    // rather than skipping it, so the spread keeps its shape.
    return `<g class="bk-page blank${under ? " under" : ""}" data-side="${side}">${paper}${shade}</g>`;
  }

  const base = CONFIG.colors.spell[spell.id];
  const c = { ...base, deep: inkShade(base.mid, 0.55) };
  const unlocked = spellUnlocked(spell.id);
  const active = unlocked && spell.id === activeSpellId();
  const idx = SPELLS.indexOf(spell);
  const ink = unlocked ? c.mid : "#6d6484";

  // A negative animation-delay that both staggers an element against its
  // siblings and picks the loop up at the phase the game clock has already
  // reached — so the book being rebuilt (a re-deal, a page turn) doesn't visibly
  // restart every effect on screen.
  const D = (period, phase) =>
    `animation-delay:${(-((((state.clockMs || 0) + phase) % period) | 0)).toFixed(0)}ms`;

  // The title heads the page over a ruled band. It is the one thing on the leaf
  // that can't be warped vertex by vertex, so it rides the projection's local
  // frame instead. The font is scaled to the name's length rather than squeezed
  // to a fixed width: `textLength` stretches short names into a caricature of
  // themselves, and only the longest name in the book (Meteoritenschauer) needs
  // any help at all.
  const name = unlocked ? spell.name : "Versiegelt";
  const head =
    `<g transform="${P.frameAt(PAGE_W / 2, HEAD_V)}"><text class="bk-name" text-anchor="middle" ` +
      `fill="${ink}" style="font-size:${Math.min(17, 190 / name.length).toFixed(1)}px">${name}</text></g>` +
    `<path class="bk-rule" stroke="${ink}" ` +
      `d="M${P.p(MARGIN, RULE_V)} L${P.p(PAGE_W - MARGIN, RULE_V)}"/>` +
    `<path class="bk-rule thin" stroke="${ink}" ` +
      `d="M${P.p(MARGIN + 7, RULE_V + 3.5)} L${P.p(PAGE_W - MARGIN - 7, RULE_V + 3.5)}"/>`;

  // The spell playing over the leaf. Not framed and not printed: it hovers over
  // the whole page, on a wash of its own coloured light that falls on the paper
  // under it. Placed on the projection's local frame so it lies at the page's
  // tilt without its circles being pulled into eggs by the perspective.
  const fx = under || !unlocked ? "" :
    `<g transform="${P.frameAt(FX.u, FX.v)}">` +
      `<ellipse class="bk-wash" rx="112" ry="100" fill="url(#bkPool${key})"/>` +
      `<g class="bk-fx" transform="scale(${FX.scale})">` +
        `<g class="bk-fx-cast">${SPELL_ART[spell.id](c, D)}</g></g></g>`;

  // Sealed: a blob of wax pressed over the page's own rune, its sigil unread.
  // The name is withheld too — the tree node that opens the page is where you
  // learn what it is.
  let seal = "";
  if (!unlocked) {
    const blob = "M0 -32 Q21 -32 29 -17 Q39 -3 29 12 Q21 30 3 32 Q-18 33 -29 18 " +
      "Q-39 2 -29 -15 Q-20 -30 0 -32 Z";
    seal = `<g transform="${P.frameAt(SIGIL.u, SIGIL.v)}">` +
      `<path class="bk-wax-shadow" d="${blob}" transform="translate(2,3)"/>` +
      `<path class="bk-wax" d="${blob}"/>` +
      `<path class="bk-wax-rim" d="${blob}" transform="scale(0.82)"/>` +
      `<text class="bk-sealmark" y="11" text-anchor="middle">?</text></g>`;
  }

  const ribbon = active && !under ? `<g class="bk-ribbon" fill="${c.mid}">${ribbonPath(side)}</g>` : "";

  // The clip and the page content must sit on SEPARATE groups from any
  // transform. A `clip-path` with the default userSpaceOnUse resolves in the
  // user space its own element establishes, so hanging one off a transformed
  // group measures the leaf's outline in page coordinates instead of viewBox
  // ones and cuts the page to ribbons.
  //
  // Order is the order a scribe worked in: rule the page, lay in the great rune,
  // write over it, illuminate, then head it — and the spell on top of all of it.
  const written =
    `<g clip-path="url(#bkClip${key})">` +
      `<path class="bk-margin" d="${marginRule(P, MARGIN - 7)}"/>` +
      pageSigil(P, ink, idx + 1) +
      `<path class="bk-script" d="${cachedScript(P, idx + 1, spell.id + key)}"/>` +
      pageInitial(P, ink, idx + 1) +
      head + seal + fx +
    `</g>`;

  // `data-side` lets the drag handler find the leaf it should turn without
  // re-deriving which spell is on it.
  const act = unlocked && !under ? ` data-act="spellSelect" data-args='["${spell.id}"]'` : "";
  return `<g class="bk-page${active ? " active" : ""}${unlocked ? "" : " locked"}` +
    `${under ? " under" : ""}" data-side="${side}"${act}>
      ${paper}
      ${unlocked ? "" : `<path class="bk-sealed" d="${d}"/>`}
      ${written}
      ${active && !under ? `<path class="bk-halo" d="${d}" stroke="${c.mid}"/>` +
                 `<path class="bk-lit" d="${d}" stroke="${c.mid}"/>` : ""}
      ${ribbon}
      ${shade}
    </g>`;
}

// The pages already turned on one side, drawn as a few leaf shapes fanned out
// behind the open one. Every leaf in a book is bound along the same spine, so a
// sliver is the SAME shape displaced straight out toward the screen edge —
// never up. Displacing it upward would show the block's head edges above the
// open page, which is not something you can see in a book lying open: the head
// is edge-on to the viewer and hidden behind the top edge of the page on top of
// it. Pushed purely outward, each sliver is covered by the open leaf except for
// a thin band past its outer edge — the only place the book's thickness shows,
// since its lower edge is clipped off the bottom of the screen. The band also
// doubles as the affordance for dragging: a fat stack on the right means there
// is more to turn to.
const STACK_STEP = 2.6;                // how far apart the fanned edges sit
// Nearest the open leaf first, darkening with depth into the block — the edges
// further in catch less light.
const STACK_SHADE = ["#ece3c4", "#e6dcba", "#e0d5b0", "#d9cda6", "#d2c59d", "#cbbd94", "#c4b58b"];
function pageStack(side, count) {
  if (count <= 0) return "";
  const pts = pageCorners(side);
  let s = "";
  for (let i = Math.min(STACK_SHADE.length, count); i > 0; i--) {
    // A hand-cut text block is not a comb: each leaf sits a hair proud or shy of
    // its neighbour, which is what stops the fan reading as printed stripes.
    const off = i * STACK_STEP + ((tileHash(i, side + 3) % 100) / 100) * 1.3;
    // `+ side * off`: outward is -x on the left leaf (side -1) and +x on the
    // right (side +1). Getting this backwards tucks the whole fan UNDER the
    // open page, where the only thing that can escape is a vertical lift at the
    // head — which is exactly the thing a book can't show.
    const A = { x: pts[0].x + side * off, y: pts[0].y };
    const D = { x: pts[3].x + side * off, y: pts[3].y };
    const t = bowCtrl(A, pts[1], TOP_BOW, side);
    const o = bowCtrl(D, A, OUT_BOW, side);
    const f = (p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    // Opaque, and a shade darker the further out it sits — the edges deeper in
    // the block catch less light. The stroke is the seam between two leaves.
    s += `<path class="bk-stack" fill="${STACK_SHADE[i - 1]}" ` +
      `d="M${f(A)} Q${f(t)} ${f(pts[1])} L${f(pts[2])} L${f(D)} Q${f(o)} ${f(A)} Z"/>`;
  }
  return s;
}

// The whole book: covers, spine, the two facing pages of the current spread and
// the thumb tabs that turn it. Returned as markup for the combat screen to drop
// in (see screens.js) — flipping and selecting mark the screen structurally
// dirty, so the book is rebuilt with the rest of the combat DOM.
function renderSpellbook() {
  const leaves = Math.ceil(SPELLS.length / 2);
  const spread = Math.max(0, Math.min(leaves - 1, state.bookSpread || 0));
  const left = SPELLS[spread * 2];
  const right = SPELLS[spread * 2 + 1];

  // Covers: the leaf outline pushed out, far enough to sit outside the widest
  // page sliver (STACK_SHADE.length * STACK_STEP) so the block never pokes out
  // past its own boards. The small lift at the head is deliberate and is the
  // one thing that should overhang there — a hardcover's boards are cut proud
  // of the text block on all three outer edges. The rim bows with the page it
  // backs rather than cutting a straight line behind a curved edge.
  // `out` is how far past the text block the board is cut; passing a smaller one
  // traces the blind-tooled fillet lines inset on the leather, which are just
  // the board's own outline drawn again a few units in.
  const coverPath = (side, out = 0) => {
    const p = pageCorners(side);
    const A = { x: p[0].x + side * (22 - out), y: p[0].y - 7 + out };
    const B = { x: p[1].x, y: p[1].y - 1 + out };
    const D = { x: p[3].x + side * (26 - out), y: p[3].y };
    const t = bowCtrl(A, B, TOP_BOW, side);
    const o = bowCtrl(D, A, OUT_BOW, side);
    const f = (q) => `${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
    return `M${f(A)} Q${f(t)} ${f(B)} L${f(p[2])} L${f(D)} Q${f(o)} ${f(A)} Z`;
  };

  // A board is leather over wood: grain, a bevel catching the light along its
  // cut head edge, and two blind-tooled fillets running round inside the edge.
  const cover = (side) =>
    `<path class="bk-cover" d="${coverPath(side)}"/>` +
    `<g clip-path="url(#bkCoverClip${side < 0 ? "L" : "R"})">` +
      `<rect class="bk-grain" x="0" y="0" width="${BOOK_W}" height="${BOOK_H}"/></g>` +
    `<path class="bk-cover-bevel" d="${coverPath(side, 1.6)}"/>` +
    `<path class="bk-tool" d="${coverPath(side, 7)}"/>` +
    `<path class="bk-tool thin" d="${coverPath(side, 10)}"/>`;

  // The leaf lying under each side of the spread: the page a turn in that
  // direction brings up. Completely hidden by the open leaf on top of it until
  // that leaf is dragged off — and WITHOUT it a page turn squeezes a leaf away
  // to reveal the board underneath, which is why a flip only ever read as its
  // own first half.
  //
  // Which page it is follows the physical turn, not the array: turning the right
  // leaf over uncovers the next leaf's recto on the right, and turning the left
  // one back uncovers the previous leaf's verso on the left.
  const under = (side) => {
    const to = spread + (side < 0 ? -1 : 1);
    if (to < 0 || to >= leaves) return "";
    return spellPage(SPELLS[to * 2 + (side < 0 ? 0 : 1)], side, true);
  };

  // The wash of light the effect lays on the paper around it.
  // Tinted with that page's own spell, so it has to be built per spread rather
  // than declared once — an unlocked page gets none.
  const pool = (key, spell) => {
    const c = spell && spellUnlocked(spell.id) ? CONFIG.colors.spell[spell.id] : null;
    if (!c) return `<radialGradient id="bkPool${key}"><stop offset="0" stop-color="#000" stop-opacity="0"/></radialGradient>`;
    return `<radialGradient id="bkPool${key}">
        <stop offset="0" stop-color="${c.core}" stop-opacity="0.5"/>
        <stop offset="0.45" stop-color="${c.mid}" stop-opacity="0.22"/>
        <stop offset="1" stop-color="${c.mid}" stop-opacity="0"/>
      </radialGradient>`;
  };

  // Paper is lit from the outer edge and falls into shadow toward the gutter,
  // which is most of what stops a flat fill reading as cardboard. One gradient
  // per side because the light runs the opposite way on each leaf; the gutter
  // shadow is a second pass on top, clipped to the leaf.
  const defs = `
    <defs>
      <linearGradient id="bkPaperL" gradientUnits="userSpaceOnUse" x1="${SPINE_X}" y1="0" x2="10" y2="0">
        <stop offset="0" stop-color="#cabd95"/>
        <stop offset="0.22" stop-color="#e4d9b6"/>
        <stop offset="0.62" stop-color="#f3eacd"/>
        <stop offset="1" stop-color="#fcf5de"/>
      </linearGradient>
      <linearGradient id="bkPaperR" gradientUnits="userSpaceOnUse" x1="${SPINE_X}" y1="0" x2="${BOOK_W - 10}" y2="0">
        <stop offset="0" stop-color="#cabd95"/>
        <stop offset="0.22" stop-color="#e4d9b6"/>
        <stop offset="0.62" stop-color="#f3eacd"/>
        <stop offset="1" stop-color="#fcf5de"/>
      </linearGradient>
      <linearGradient id="bkGutterL" gradientUnits="userSpaceOnUse" x1="${SPINE_X}" y1="0" x2="${SPINE_X - 78}" y2="0">
        <stop offset="0" stop-color="#2e2213" stop-opacity="0.55"/>
        <stop offset="0.45" stop-color="#2e2213" stop-opacity="0.16"/>
        <stop offset="1" stop-color="#2e2213" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="bkGutterR" gradientUnits="userSpaceOnUse" x1="${SPINE_X}" y1="0" x2="${SPINE_X + 78}" y2="0">
        <stop offset="0" stop-color="#2e2213" stop-opacity="0.55"/>
        <stop offset="0.45" stop-color="#2e2213" stop-opacity="0.16"/>
        <stop offset="1" stop-color="#2e2213" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="bkForeL" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="54" y2="0">
        <stop offset="0" stop-color="#fffdf2" stop-opacity="0.5"/>
        <stop offset="0.5" stop-color="#fffdf2" stop-opacity="0.12"/>
        <stop offset="1" stop-color="#fffdf2" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="bkForeR" gradientUnits="userSpaceOnUse" x1="${BOOK_W}" y1="0" x2="${BOOK_W - 54}" y2="0">
        <stop offset="0" stop-color="#fffdf2" stop-opacity="0.5"/>
        <stop offset="0.5" stop-color="#fffdf2" stop-opacity="0.12"/>
        <stop offset="1" stop-color="#fffdf2" stop-opacity="0"/>
      </linearGradient>
      ${pool("L", left)}
      ${pool("R", right)}
      <clipPath id="bkClipL"><path d="${leafPath(-1)}"/></clipPath>
      <clipPath id="bkClipR"><path d="${leafPath(1)}"/></clipPath>
      <clipPath id="bkCoverClipL"><path d="${coverPath(-1)}"/></clipPath>
      <clipPath id="bkCoverClipR"><path d="${coverPath(1)}"/></clipPath>
      <!-- Vellum is a fibrous sheet, not a flat wash. One turbulence pass,
           stretched sideways so the noise reads as laid fibres running across
           the page, is laid over each leaf and multiplied into it. It is static
           and painted once, so it costs nothing per frame. -->
      <filter id="bkFibre" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.55 0.09" numOctaves="4" seed="11"/>
        <feColorMatrix type="matrix" values="0 0 0 0 0.40  0 0 0 0 0.31  0 0 0 0 0.16  0 0 0 -0.7 0.5"/>
      </filter>
      <filter id="bkGrain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="3" seed="4"/>
        <feColorMatrix type="matrix" values="0 0 0 0 0.09  0 0 0 0 0.05  0 0 0 0 0.02  0 0 0 -0.8 0.55"/>
      </filter>
      <!-- The book carries its own glow rather than borrowing the arena's:
           a CSS filter whose reference can't be resolved makes the element
           disappear entirely, so it must not depend on another SVG existing. -->
      <filter id="bkGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2.5"/>
      </filter>
    </defs>`;

  return `
    <svg class="spellbook" id="spellbook" viewBox="0 0 ${BOOK_W} ${BOOK_H}"
         preserveAspectRatio="xMidYMax meet" aria-label="Zauberbuch">
      ${defs}
      ${cover(-1)}
      ${cover(1)}
      ${pageStack(-1, spread * 2)}
      ${pageStack(1, SPELLS.length - spread * 2 - 2)}
      ${under(-1)}
      ${under(1)}
      ${spellPage(left, -1)}
      ${spellPage(right, 1)}
      <path class="bk-spine" d="M${SPINE_X} ${NOTCH_Y - 2} L${SPINE_X} ${BOOK_H}"/>
    </svg>`;
}

// Turn one leaf. The spread is UI only — it doesn't change which spell is cast
// (that's spellSelect), so leafing through the book mid-fight is free.
function spellbookFlip(dir) {
  const leaves = Math.ceil(SPELLS.length / 2);
  const next = (state.bookSpread || 0) + dir;
  if (next < 0 || next >= leaves) return;
  state.bookSpread = next;
  state._structuralDirty = true;
}

// ---------------------------------------------------------------------------
// Drag to turn a page. There are no flip buttons: you tap a page to cast from
// it and drag across the book to leaf through it, which is what you'd do to a
// real book. Both gestures start with the same pointerdown, so the drag sets
// `bookDragUntil` on release and spellSelect (spells.js) ignores the click that
// a completed drag also fires — otherwise turning a page would select whatever
// spell the release happened to land on.
// ---------------------------------------------------------------------------
let bookDragUntil = 0;

// A released flip is finished for the player: the grabbed leaf swings the rest
// of the way over to the spine, the spread changes under it, and the leaf now
// facing up swings back OPEN on the other side. Letting go halfway through and
// snapping the new spread in would show only the first half of a page turn.
const FLIP_CLOSE_MS = 190;             // the grabbed leaf finishing its swing
const FLIP_OPEN_MS = 230;              // the leaf beneath opening out
// Which side's leaf should swing open once the book is rebuilt at its new
// spread. Survives the re-render (the SVG is replaced wholesale), which is why
// it lives out here rather than inside attachSpellbookDrag.
let pendingOpenSide = 0;

// Drive `setTurn` from one closed-fraction to another over `ms`, easing out.
// Bails if the leaf is torn out from under it — a structural re-render mid-turn
// replaces the whole book, and the fresh one is already in the right shape.
function animateTurn(setTurn, leaf, from, to, ms, done) {
  const t0 = performance.now();
  const step = (now) => {
    if (!leaf.isConnected) return;
    const p = Math.min(1, (now - t0) / Math.max(1, ms));
    const eased = p * (2 - p);
    setTurn(leaf, from + (to - from) * eased);
    if (p < 1) { requestAnimationFrame(step); return; }
    if (done) done();
  };
  requestAnimationFrame(step);
}

// Bound to the freshly rendered book after every structural combat render (the
// SVG is replaced wholesale, so there are no stale listeners to clean up).
function attachSpellbookDrag() {
  const svg = document.getElementById("spellbook");
  if (!svg) return;
  const leaves = Math.ceil(SPELLS.length / 2);
  let startX = 0, dx = 0, down = false, turning = null;

  // Which leaf a drag in this direction turns, and how far it has closed toward
  // the spine (0 = flat open, 1 = shut). Dragging left turns the right-hand
  // page over; dragging right turns the left-hand one back.
  const leafSide = (d) => (d < 0 ? 1 : -1);
  // `:not(.under)` matters: the under-leaf is the FIRST match for its side, and
  // grabbing it would turn the page that is meant to be revealed.
  const leafFor = (d) => svg.querySelector(`.bk-page:not(.under)[data-side="${leafSide(d)}"]`);
  const canTurn = (d) => (d < 0 ? (state.bookSpread || 0) < leaves - 1 : (state.bookSpread || 0) > 0);

  const setTurn = (leaf, closed) => {
    if (!leaf) return;
    // Squeezing the page horizontally about the spine reads as it standing up
    // and swinging over — the right motion for a book seen this close to flat.
    leaf.setAttribute("transform",
      `translate(${SPINE_X},0) scale(${Math.max(0.02, 1 - closed).toFixed(3)},1) translate(${-SPINE_X},0)`);
    // ...and it goes dark as it turns away from the light. Squeezing alone reads
    // as a page being compressed; losing the light is what makes it read as one
    // being lifted off the leaf underneath.
    const sh = leaf.querySelector(".bk-shade");
    if (sh) sh.setAttribute("opacity", (closed * 0.62).toFixed(3));
  };
  const clearTurn = (leaf) => {
    if (!leaf) return;
    leaf.removeAttribute("transform");
    const sh = leaf.querySelector(".bk-shade");
    if (sh) sh.setAttribute("opacity", "0");
  };
  const release = () => {
    clearTurn(turning);
    svg.classList.remove("dragging");
    turning = null;
  };

  svg.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    try { svg.setPointerCapture(e.pointerId); } catch (_) {}
    down = true; startX = e.clientX; dx = 0; turning = null;
  });

  svg.addEventListener("pointermove", (e) => {
    if (!down) return;
    dx = e.clientX - startX;
    const w = svg.getBoundingClientRect().width || 1;
    if (Math.abs(dx) < 4 || !canTurn(dx)) { release(); return; }
    if (!turning) { turning = leafFor(dx); svg.classList.add("dragging"); }
    setTurn(turning, Math.min(1, Math.abs(dx) / (w * 0.5)));
  });

  const onUp = (e) => {
    if (!down) return;
    down = false;
    const w = svg.getBoundingClientRect().width || 1;
    const flipped = Math.abs(dx) > w * FLIP_THRESHOLD && canTurn(dx);
    if (flipped) {
      // Swallow the click this same gesture is about to fire, so turning a page
      // never also re-arms the spell it let go over. Kept short — the click
      // arrives right behind pointerup, and a longer window would start eating
      // genuine taps made straight after a flip.
      bookDragUntil = performance.now() + 250;
      const dir = dx < 0 ? 1 : -1;
      const leaf = turning || leafFor(dx);
      turning = null;
      const closed = Math.min(1, Math.abs(dx) / (w * 0.5));
      if (!leaf) { svg.classList.remove("dragging"); spellbookFlip(dir); return; }
      // Keep `dragging` on so the CSS transition stays out of the way while the
      // rAF drives the rest of the swing frame by frame.
      svg.classList.add("dragging");
      animateTurn(setTurn, leaf, closed, 1, FLIP_CLOSE_MS * (1 - closed) + 40, () => {
        // The leaf that just turned lands on the OTHER side of the spine, so
        // that is the side the swing continues on. Armed here rather than up
        // front so a turn interrupted by a re-render leaves nothing pending.
        pendingOpenSide = -leafSide(dx);
        spellbookFlip(dir);   // marks the screen structurally dirty → book rebuilt
      });
      return;
    }
    release();
    // A tap. The pages still carry `data-act`, but the drag needs pointer
    // capture on the SVG, and a captured pointer makes the browser dispatch the
    // click to the CAPTURE TARGET — the SVG root — instead of to the leaf under
    // the finger, so the delegated dispatch in main.js never sees it. Resolve
    // the leaf here, exactly as attachTreeInteractions does for node taps.
    if (Math.abs(dx) >= 8) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const g = el && el.closest ? el.closest(".bk-page[data-act]") : null;
    if (g) spellSelect(JSON.parse(g.dataset.args)[0]);
  };
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointercancel", onUp);

  // Second half of a turn that was committed on the previous book: this render
  // IS the new spread, so the leaf that came over the spine starts shut against
  // it and swings out flat. Applied synchronously — attachSpellbookDrag runs
  // inside the same frame's render, before anything is painted, so the page is
  // never briefly seen already open.
  if (pendingOpenSide) {
    // `:not(.under)` again, and it is the whole second half of the turn: the
    // under-leaf is the FIRST match for its side, so without it the swing was
    // applied to the page HIDDEN BENEATH the one that just came over. The
    // animation ran perfectly and was invisible, and a turn stopped dead with
    // the leaf stood upright against the spine.
    const incoming = svg.querySelector(`.bk-page:not(.under)[data-side="${pendingOpenSide}"]`);
    pendingOpenSide = 0;
    if (incoming) {
      svg.classList.add("dragging");
      setTurn(incoming, 1);
      animateTurn(setTurn, incoming, 1, 0, FLIP_OPEN_MS, () => {
        clearTurn(incoming);
        svg.classList.remove("dragging");
      });
    }
  }
}

window.Incanto.spellbook = { SPELL_ART, renderSpellbook, spellbookFlip, attachSpellbookDrag };
