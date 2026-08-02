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
// head, an illuminated initial, and runic script filling everything else —
// running down both sides of the miniature and off the bottom of the screen. The
// miniature itself is a dark plate, a window cut through the vellum, and the
// spell's effect plays over it, animated, lighting the paper around it.
//
// Three things are worth knowing before changing any of it:
//   * Everything written on a leaf is laid out in the page's own (u,v) frame and
//     mapped on with ONE matrix (see pageFrame), so nothing is rotated by hand.
//   * A page of script is ~500 glyphs, emitted into a single <path> and cached —
//     the book is rebuilt wholesale on every structural render.
//   * The effects animate from CSS keyframes (combat.css), never from JS. Each
//     class has one duration, and spellbook hands it a negative animation-delay
//     so a rebuild doesn't restart the motion.
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

// --- The page plane's own coordinate frame -----------------------------------
// Everything WRITTEN on a leaf — the script, the ruled margins, the miniature —
// is laid out in (u,v). `u` runs along the top edge in reading order and `v`
// runs straight down the page from it. One `matrix(...)` maps that frame onto
// the leaf, so content arrives already lying on the page plane and nothing needs
// rotating glyph by glyph.
//
// Reading order is the book's, not the screen's: the left leaf reads fore-edge →
// spine and the right leaf reads gutter → fore-edge, which is how the two halves
// of a spread are actually written. Because the leaves are mirror images that
// works out to left-to-right on screen for both, so no glyph is ever mirrored.
function pageFrame(side) {
  const c = pageCorners(side);
  const o = side < 0 ? c[0] : c[1];      // where a line begins
  const t = side < 0 ? c[1] : c[0];      // where it runs out to
  const len = Math.hypot(t.x - o.x, t.y - o.y) || 1;
  const e = { x: (t.x - o.x) / len, y: (t.y - o.y) / len };
  const d = { x: -e.y, y: e.x };         // rot90 of e — down the page on both leaves
  const proj = (p) => ({
    u: (p.x - o.x) * e.x + (p.y - o.y) * e.y,
    v: (p.x - o.x) * d.x + (p.y - o.y) * d.y,
  });
  // The leaf is a quad, not a rectangle: the spine edge is vertical while the
  // frame is tilted, so a line's width grows as it goes down the page. Both side
  // edges are straight, so solve each once and interpolate — that's what keeps
  // the ragged edges of the script parallel to the real edges of the paper.
  const edge = (p, q) => {
    const P = proj(p), Q = proj(q);
    const dv = Q.v - P.v;
    return (v) => (Math.abs(dv) < 1e-6 ? P.u : P.u + ((Q.u - P.u) * (v - P.v)) / dv);
  };
  const f = (n) => n.toFixed(4);
  return {
    m: `matrix(${f(e.x)} ${f(e.y)} ${f(d.x)} ${f(d.y)} ${o.x} ${o.y})`,
    startAt: edge(o, side < 0 ? c[3] : c[2]),   // the edge lines begin on
    endAt: edge(t, side < 0 ? c[2] : c[3]),     // the edge they run out to
  };
}

// --- Manuscript layout (all in the page frame) -------------------------------
// A written page, not a label with a picture on it: a rubricated title under a
// ruled head, an illuminated initial, and body script filling everything left —
// running down both sides of the miniature and off the bottom of the screen.
const MARGIN = 15;                     // ink-free strip inside both side edges
const HEAD_V = 27;                     // baseline of the title
const RULE_V = 37;                     // the double rule under it
const BODY_TOP = 48;                   // first line of body script
const BODY_BOTTOM = 236;               // last line worth emitting; the leaf clip cuts it
const LINE_H = 11;                     // leading
const GLYPH_H = 6.6;                   // cap height of a script glyph
const GLYPH_ADV = 5.2;                 // pen advance between glyphs
const WORD_GAP = 4.2;                  // and between words
const INITIAL = { w: 17, h: 18 };      // the illuminated capital opening the body
// The miniature: a gilt-framed plate the spell's effect plays over, set into the
// text block with script running down either side of it.
const PLATE = { top: 63, h: 78, w: 168 };
const PLATE_MID = PLATE.top + PLATE.h / 2;

// One glyph as an absolute subpath. The whole body of a page is emitted into a
// SINGLE <path> this way: ~500 glyphs as 500 elements would be a real cost on a
// phone, and they all share one stroke anyway.
function glyphSub(u, v, h, seed) {
  const t = GLYPH_TEMPLATES[tileHash(seed, 31) % GLYPH_TEMPLATES.length];
  const k = h / 10;                    // templates span -5..5
  let s = "";
  for (let i = 0; i < t.length; i++) {
    s += (i ? "L" : "M") + (u + t[i][0] * k).toFixed(1) + " " + (v + t[i][1] * k).toFixed(1);
  }
  return s;
}

// Fill one horizontal run of a line with words of 2–6 glyphs, stopping when the
// next word would overrun. The leftover is the line's ragged edge — a hard stop
// at a fixed width would read as a printed block rather than a written one.
function scriptRun(u0, u1, v, seed, n0) {
  let s = "", u = u0, n = n0;
  while (u < u1) {
    let word = 2 + (tileHash(seed, n * 7 + 3) % 5);
    if (u + word * GLYPH_ADV > u1) {
      word = 2;                        // try to squeeze a short word into the tail
      if (u + word * GLYPH_ADV > u1) break;
    }
    for (let i = 0; i < word; i++) s += glyphSub(u + i * GLYPH_ADV, v, GLYPH_H, seed * 13 + n * 11 + i);
    u += word * GLYPH_ADV + WORD_GAP;
    n++;
  }
  return s;
}

// The body of a page. Lines that cross the miniature are split into the two
// runs beside it; the first two lines start clear of the illuminated initial.
// Deterministic in `seed`, so a page reads the same every time it is opened.
function pageScript(frame, seed) {
  let s = "";
  let n = 0;
  for (let v = BODY_TOP, line = 0; v <= BODY_BOTTOM; v += LINE_H, line++) {
    let u0 = frame.startAt(v) + MARGIN;
    const u1 = frame.endAt(v) - MARGIN;
    if (line < 2) u0 += INITIAL.w + 4;                 // wrapped around the initial
    const overPlate = v + GLYPH_H / 2 > PLATE.top && v - GLYPH_H / 2 < PLATE.top + PLATE.h;
    if (!overPlate) {
      s += scriptRun(u0, u1, v, seed, n);
      n += 9;
      continue;
    }
    // Beside the miniature: two short columns, one per side.
    const mid = (frame.startAt(PLATE_MID) + frame.endAt(PLATE_MID)) / 2;
    s += scriptRun(u0, mid - PLATE.w / 2 - 5, v, seed, n);
    s += scriptRun(mid + PLATE.w / 2 + 5, u1, v, seed, n + 4);
    n += 9;
  }
  return s;
}

// Building ~500 glyphs into a path string is cheap but not free, and the book is
// rebuilt wholesale on every structural render (a re-deal, a page turn, picking
// a spell). The script is deterministic, so compute it once per page and keep it.
const scriptCache = {};
function cachedScript(frame, seed, key) {
  if (scriptCache[key] === undefined) scriptCache[key] = pageScript(frame, seed);
  return scriptCache[key];
}

// --- Page illustrations ------------------------------------------------------
// One per spell, playing over the miniature plate in a box of roughly ±80 × ±34.
// They're line art in the spell's own colour, matching the game's other
// procedural glyph work — `c` is the CONFIG.colors.spell entry, so a page, its
// bolt on the canvas and its sector in the tree all read as the same magic.
//
// The art is ANIMATED, and animated declaratively: every moving part carries a
// CSS class whose keyframes live in combat.css, so the loop costs nothing per
// frame and survives without a JS driver. `D(period, phase)` is handed in by the
// caller — it returns a negative `animation-delay` that both staggers an element
// against its siblings and starts the loop at the phase the game clock is
// already at, so a structural re-render doesn't visibly restart the motion.
const SPELL_ART = {
  // A burning orb that breathes, throwing licks of flame and embers upward.
  fireball: (c, D) => `
    <circle class="bk-fx-pulse" cx="0" cy="2" r="30" fill="${c.mid}" opacity="0.18" style="${D(2600, 0)}"/>
    <circle class="bk-fx-ripple" cx="0" cy="2" r="19" fill="none" stroke="${c.mid}"
      stroke-width="1.8" style="${D(3000, 0)}"/>
    <circle class="bk-fx-pulse" cx="0" cy="2" r="17" fill="${c.mid}" opacity="0.8" style="${D(2600, 420)}"/>
    <circle class="bk-fx-pulse" cx="0" cy="2" r="9" fill="${c.core}" style="${D(2600, 900)}"/>
    <g fill="none" stroke="${c.mid}" stroke-width="2.4" stroke-linecap="round">
      <path class="bk-fx-lick" d="M-12 -11 Q-8 -23 -1 -30" style="${D(1800, 0)}"/>
      <path class="bk-fx-lick" d="M4 -13 Q8 -24 15 -31" style="${D(1800, 600)}"/>
      <path class="bk-fx-lick" d="M-24 -6 Q-27 -17 -21 -25" style="${D(1800, 1200)}"/>
    </g>
    <g fill="${c.core}">
      <circle class="bk-fx-mote" cx="-27" cy="8" r="2" style="${D(2400, 0)}"/>
      <circle class="bk-fx-mote" cx="23" cy="12" r="1.7" style="${D(2400, 800)}"/>
      <circle class="bk-fx-mote" cx="-42" cy="14" r="1.5" style="${D(2400, 1600)}"/>
      <circle class="bk-fx-mote" cx="40" cy="6" r="1.8" style="${D(2400, 400)}"/>
      <circle class="bk-fx-mote" cx="9" cy="16" r="1.4" style="${D(2400, 2000)}"/>
    </g>`,

  // A bolt that never strikes twice the same way: three forks take it in turn,
  // each lit for a fifth of the cycle, over a flash that fires with them.
  lightning: (c, D) => `
    <ellipse class="bk-fx-flash" cx="0" cy="0" rx="30" ry="26" fill="${c.mid}"
      opacity="0.22" style="${D(1500, 0)}"/>
    <g fill="${c.core}" stroke="${c.mid}" stroke-width="1.5" stroke-linejoin="round">
      <path class="bk-fx-bolt" d="M6 -28 L-8 0 L2 1 L-6 28 L14 -5 L4 -6 Z" style="${D(1500, 0)}"/>
      <path class="bk-fx-bolt" d="M2 -28 L-12 -2 L-1 -1 L-9 28 L10 -3 L0 -4 Z" style="${D(1500, 500)}"/>
      <path class="bk-fx-bolt" d="M11 -28 L-3 -1 L7 0 L-1 28 L19 -4 L9 -5 Z" style="${D(1500, 1000)}"/>
    </g>
    <g fill="none" stroke="${c.mid}" stroke-width="1.8" stroke-linecap="round">
      <path class="bk-fx-bolt" d="M-26 -13 L-34 -2 L-26 -1" style="${D(1500, 250)}"/>
      <path class="bk-fx-bolt" d="M27 9 L35 19 L27 19" style="${D(1500, 750)}"/>
    </g>`,

  // A cone with shards tumbling out along it and a shimmer running through.
  frost: (c, D) => {
    const shard = (x, y, s, phase) =>
      `<g transform="translate(${x},${y}) scale(${s})"><g class="bk-fx-drift" style="${D(2800, phase)}">` +
      `<g class="bk-fx-spin" style="${D(4200, phase)}">` +
      `<path d="M-6 0 L6 0 M0 -6 L0 6 M-4 -4 L4 4 M4 -4 L-4 4"/></g></g></g>`;
    return `
    <path d="M-46 0 L26 -25 L26 25 Z" fill="${c.mid}" opacity="0.18"/>
    <path class="bk-fx-sweep" d="M-46 0 L26 -25 L26 25 Z" fill="${c.core}"
      opacity="0.16" style="${D(2600, 0)}"/>
    <path d="M-46 0 L26 -25 M-46 0 L26 25" fill="none" stroke="${c.mid}" stroke-width="2.2"
      stroke-linecap="round"/>
    <path d="M26 -25 L26 25" stroke="${c.core}" stroke-width="1.5" opacity="0.55"/>
    <g stroke="${c.core}" stroke-width="1.7" stroke-linecap="round" fill="none">
      ${shard(-16, -8, 1, 0)}${shard(-4, 9, 0.85, 900)}${shard(6, -3, 1.15, 1800)}
    </g>`;
  },

  // Rocks falling in sequence onto a cracked ground line, each landing in a
  // flash of its own — the burst is on the same period as its rock, timed to
  // the end of the fall.
  meteor: (c, D) => {
    const rock = (x, r, phase) =>
      `<g transform="translate(${x},0)"><g class="bk-fx-fall" style="${D(1900, phase)}">` +
      `<path d="M${(-r * 2.4).toFixed(1)} ${(-r * 3.4).toFixed(1)} L0 0" stroke="${c.mid}"
        stroke-width="2.2" stroke-linecap="round" opacity="0.85"/>` +
      `<circle r="${r}" fill="${c.core}"/></g>` +
      `<ellipse class="bk-fx-burst" cy="24" rx="${(r * 2.6).toFixed(1)}" ry="${(r * 0.9).toFixed(1)}"
        fill="${c.core}" style="${D(1900, phase)}"/></g>`;
    return `
    <path d="M-54 24 L54 24" stroke="${c.mid}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M-30 24 L-35 33 M2 24 L-2 34 M31 24 L36 33" stroke="${c.mid}" stroke-width="1.6"
      stroke-linecap="round" opacity="0.7"/>
    ${rock(-30, 4.2, 0)}${rock(2, 3.2, 700)}${rock(31, 3.6, 1350)}`;
  },

  // A kite shield riding on its own ward: a rune ring turning around it and a
  // barrier pulsing out past the frame.
  shield: (c, D) => {
    let ring = "";
    for (let i = 0; i < 12; i++) ring += glyphAt(0, 0, 31, i * 30, 7, 91 + i, "bk-fx-glyph");
    return `
    <ellipse class="bk-fx-ward" rx="36" ry="32" fill="none" stroke="${c.mid}"
      stroke-width="1.6" style="${D(3000, 0)}"/>
    <g class="bk-fx-turn" stroke="${c.mid}" style="${D(24000, 0)}">${ring}</g>
    <g class="bk-fx-float" style="${D(3200, 0)}">
      <path d="M0 -25 L20 -16 L20 5 Q20 21 0 29 Q-20 21 -20 5 L-20 -16 Z"
        fill="${c.mid}" fill-opacity="0.22" stroke="${c.mid}" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M0 -15 L0 17 M-11 -3 L11 -3" stroke="${c.core}" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M-6 -9 L0 -15 L6 -9" fill="none" stroke="${c.core}" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round"/>
    </g>`;
  },

  // A living sprig over a rising pulse — growth rather than a medical cross —
  // shedding motes that drift up off the page.
  heal: (c, D) => `
    <ellipse class="bk-fx-ward" rx="34" ry="31" fill="none" stroke="${c.mid}"
      stroke-width="1.5" style="${D(3000, 0)}"/>
    <g class="bk-fx-float" style="${D(3200, 0)}">
      <path d="M0 -25 Q14 -6 14 5 Q14 19 0 19 Q-14 19 -14 5 Q-14 -6 0 -25 Z"
        fill="${c.mid}" fill-opacity="0.3" stroke="${c.mid}" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M0 -14 L0 11 M-8 -2 L8 -2" stroke="${c.core}" stroke-width="2.4" stroke-linecap="round"/>
    </g>
    <path d="M-52 26 L-30 26 L-22 17 L-11 32 L-2 22 L7 26 L52 26" fill="none" stroke="${c.mid}"
      stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>
    <g fill="${c.core}">
      <circle class="bk-fx-mote" cx="-30" cy="10" r="1.9" style="${D(2400, 0)}"/>
      <circle class="bk-fx-mote" cx="28" cy="6" r="1.6" style="${D(2400, 800)}"/>
      <circle class="bk-fx-mote" cx="-44" cy="4" r="1.5" style="${D(2400, 1600)}"/>
      <circle class="bk-fx-mote" cx="43" cy="12" r="1.7" style="${D(2400, 400)}"/>
    </g>`,
};

// --- Page rendering ----------------------------------------------------------

// The margin rule: the ruled box the text block sits in, traced in the page
// frame. Its two side rules follow the leaf's real edges (which converge, since
// the spine is vertical and the page is tilted), so the ruling reads as drawn on
// the paper rather than pasted over it. The bottom is left open — it runs off
// the screen with the rest of the page.
function marginRule(frame, inset) {
  const vTop = HEAD_V - 17, vBot = BOOK_H + 30;
  const p = (u, v) => `${u.toFixed(1)} ${v.toFixed(1)}`;
  const l = (v) => frame.startAt(v) + inset, r = (v) => frame.endAt(v) - inset;
  return `M${p(l(vBot), vBot)} L${p(l(vTop), vTop)} L${p(r(vTop), vTop)} L${p(r(vBot), vBot)}`;
}

// The illuminated initial opening the body text: a gilt box with an oversized
// glyph in it, the first two lines of script wrapped around its right side.
function pageInitial(frame, colour, seed) {
  const u = frame.startAt(BODY_TOP) + MARGIN;
  const v = BODY_TOP - GLYPH_H / 2;
  return `<rect class="bk-initial-box" x="${u.toFixed(1)}" y="${v.toFixed(1)}" ` +
    `width="${INITIAL.w}" height="${INITIAL.h}"/>` +
    `<path class="bk-initial" stroke="${colour}" ` +
    `d="${glyphSub(u + INITIAL.w / 2, v + INITIAL.h / 2, INITIAL.h - 4, seed * 7 + 5)}"/>`;
}

// One page of the book: a written leaf — rubricated title over a ruled head,
// body script filling the whole text block, and the spell's effect playing on a
// gilt plate set into it. `side` is -1 for the left leaf, +1 for the right; a
// sealed page keeps its writing but is illegible under a wax seal, and the page
// the book is CAST from carries a ribbon and a lit border.
function spellPage(spell, side) {
  const d = leafPath(side);
  const key = side < 0 ? "L" : "R";
  const frame = pageFrame(side);
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

  if (!spell) {
    // An odd-numbered book would leave one blank leaf; draw it as empty vellum
    // rather than skipping it, so the spread keeps its shape.
    return `<g class="bk-page blank" data-side="${side}">${paper}</g>`;
  }

  const c = CONFIG.colors.spell[spell.id];
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

  // The text block. Written the same on a sealed page as an open one — the page
  // exists, you simply can't read it yet — so sealing changes only the ink.
  const body =
    `<path class="bk-script" d="${cachedScript(frame, idx + 1, spell.id + key)}"/>` +
    pageInitial(frame, ink, idx + 1);

  // The miniature: a gilt plate seated in the text block, with the spell's
  // effect floating ABOVE it — a shadow cast down onto the paper and a pool of
  // its own coloured light spilling out past the frame are what sell the effect
  // as hovering over the page rather than printed on it.
  const mid = (frame.startAt(PLATE_MID) + frame.endAt(PLATE_MID)) / 2;
  const px = mid - PLATE.w / 2;
  // The pool goes UNDER the plate, so what shows of it is the light spilling out
  // past the frame onto the vellum — over the plate it would only wash out the
  // effect it is supposed to be coming from.
  const plate =
    `<ellipse class="bk-pool" cx="${mid.toFixed(1)}" cy="${PLATE_MID}" rx="${PLATE.w * 0.72}" ` +
      `ry="${PLATE.h * 0.95}" fill="url(#bkPool${key})"/>` +
    `<rect class="bk-plate-shadow" x="${(px + 3).toFixed(1)}" y="${PLATE.top + 4}" ` +
      `width="${PLATE.w}" height="${PLATE.h}" rx="4"/>` +
    `<rect class="bk-plate" x="${px.toFixed(1)}" y="${PLATE.top}" ` +
      `width="${PLATE.w}" height="${PLATE.h}" rx="4"/>` +
    `<rect class="bk-plate-rule" x="${(px + 4).toFixed(1)}" y="${PLATE.top + 4}" ` +
      `width="${PLATE.w - 8}" height="${PLATE.h - 8}" rx="2"/>`;

  let art;
  if (unlocked) {
    art =
      `<ellipse class="bk-aura" cx="${mid.toFixed(1)}" cy="${PLATE_MID}" rx="${PLATE.w * 0.44}" ` +
        `ry="${PLATE.h * 0.46}" fill="url(#bkPool${key})"/>` +
      `<g class="bk-fx" transform="translate(${mid.toFixed(1)},${PLATE_MID})">` +
        `<g class="bk-fx-cast">${SPELL_ART[spell.id](c, D)}</g></g>`;
  } else {
    // Sealed: a blob of wax pressed over the plate, its sigil unread. The name
    // is withheld too — the tree node that opens the page is where you learn
    // what it is.
    const blob = "M0 -21 Q14 -21 19 -11 Q26 -2 19 8 Q14 20 2 21 Q-12 22 -19 12 " +
      "Q-26 1 -19 -10 Q-13 -20 0 -21 Z";
    art =
      `<g transform="translate(${mid.toFixed(1)},${PLATE_MID})">` +
        `<path class="bk-wax-shadow" d="${blob}" transform="translate(1.5,2)"/>` +
        `<path class="bk-wax" d="${blob}"/>` +
        `<path class="bk-wax-rim" d="${blob}" transform="scale(0.82)"/>` +
        `<text class="bk-sealmark" y="8" text-anchor="middle">?</text></g>`;
  }

  // The title heads the page over a ruled band. The font is scaled to the name's
  // length instead of being squeezed to a fixed width: `textLength` stretches
  // short names into a caricature of themselves, and only the longest name in
  // the book (Meteoritenschauer) needs any help at all.
  const name = unlocked ? spell.name : "Versiegelt";
  const uMid = (frame.startAt(HEAD_V) + frame.endAt(HEAD_V)) / 2;
  const head =
    `<text class="bk-name" x="${uMid.toFixed(1)}" y="${HEAD_V}" text-anchor="middle" ` +
      `fill="${ink}" ` +
      `style="font-size:${Math.min(17, 190 / name.length).toFixed(1)}px">${name}</text>` +
    `<path class="bk-rule" stroke="${ink}" d="M${(frame.startAt(RULE_V) + MARGIN).toFixed(1)} ${RULE_V} ` +
      `L${(frame.endAt(RULE_V) - MARGIN).toFixed(1)} ${RULE_V}"/>` +
    `<path class="bk-rule thin" stroke="${ink}" d="M${(frame.startAt(RULE_V + 3) + MARGIN + 6).toFixed(1)} ${RULE_V + 3} ` +
      `L${(frame.endAt(RULE_V + 3) - MARGIN - 6).toFixed(1)} ${RULE_V + 3}"/>`;

  const ribbon = active ? `<g class="bk-ribbon" fill="${c.mid}">${ribbonPath(side)}</g>` : "";

  // Everything written rides the page frame — one matrix, so the script, the
  // rules and the plate all lie on the same plane. That shared plane is most of
  // what sells the tilt: ruled lines seen at an angle read as a surface.
  //
  // The clip and the frame must sit on SEPARATE groups, in that order. A
  // `clip-path` with the default userSpaceOnUse resolves in the user space its
  // own element establishes — so putting both on one group would measure the
  // leaf's outline in (u,v) instead of viewBox coords and cut the page to
  // ribbons (the title, sitting above the leaf's top corner in that misreading,
  // vanishes outright).
  const written =
    `<g clip-path="url(#bkClip${key})"><g transform="${frame.m}">` +
      `<path class="bk-margin" d="${marginRule(frame, MARGIN - 7)}"/>` +
      `${head}${body}${plate}${art}` +
    `</g></g>`;

  // `data-side` lets the drag handler find the leaf it should turn without
  // re-deriving which spell is on it.
  const act = unlocked ? ` data-act="spellSelect" data-args='["${spell.id}"]'` : "";
  return `<g class="bk-page${active ? " active" : ""}${unlocked ? "" : " locked"}" data-side="${side}"${act}>
      ${paper}
      ${unlocked ? "" : `<path class="bk-sealed" d="${d}"/>`}
      ${written}
      ${active ? `<path class="bk-halo" d="${d}" stroke="${c.mid}"/>` +
                 `<path class="bk-lit" d="${d}" stroke="${c.mid}"/>` : ""}
      ${ribbon}
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

  // The pool of light the miniature's effect throws onto the paper around it.
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
  const leafFor = (d) => svg.querySelector(`.bk-page[data-side="${leafSide(d)}"]`);
  const canTurn = (d) => (d < 0 ? (state.bookSpread || 0) < leaves - 1 : (state.bookSpread || 0) > 0);

  const setTurn = (leaf, closed) => {
    if (!leaf) return;
    // Squeezing the page horizontally about the spine reads as it standing up
    // and swinging over — the right motion for a book seen this close to flat.
    leaf.setAttribute("transform",
      `translate(${SPINE_X},0) scale(${Math.max(0.02, 1 - closed).toFixed(3)},1) translate(${-SPINE_X},0)`);
  };
  const release = () => {
    if (turning) turning.removeAttribute("transform");
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
    const incoming = svg.querySelector(`.bk-page[data-side="${pendingOpenSide}"]`);
    pendingOpenSide = 0;
    if (incoming) {
      svg.classList.add("dragging");
      setTurn(incoming, 1);
      animateTurn(setTurn, incoming, 1, 0, FLIP_OPEN_MS, () => {
        incoming.removeAttribute("transform");
        svg.classList.remove("dragging");
      });
    }
  }
}

window.Incanto.spellbook = { SPELL_ART, renderSpellbook, spellbookFlip, attachSpellbookDrag };
