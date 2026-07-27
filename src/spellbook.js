"use strict";
// ==============================================================================
// spellbook.js — the hero's open spell book along the bottom of the combat
// screen. Owns: SPELL_ART (procedural page illustrations), renderSpellbook,
// spellbookFlip.
//
// The book lies open toward the player, its two page planes tilted up and out
// so their top edges form a shallow V with the spine at the bottom of the
// notch — and the rune circle above drops into that notch (see combat.css,
// which pulls the arena's box down over the book's upper half). One spell per
// page: an illustration ringed by runic glyphs, its name beneath.
//
// Everything here is drawn in the book SVG's own 600-wide viewBox, which is the
// same width as the arena's, so the two share a horizontal scale and the notch
// lines up with the circle at every viewport size.
// ==============================================================================

// --- Page geometry -----------------------------------------------------------
// The left page as a quad, corners clockwise from its outer top. The right page
// is this mirrored about x = 300 (the spine). Tuned so the notch bottom (the
// inner top corners, y = NOTCH_Y) sits low enough for the circle to nest in it.
const BOOK_W = 600, BOOK_H = 232;
const SPINE_X = 300;
const NOTCH_Y = 104;                   // where both pages meet at the top — the bottom of the V
const PAGE_L = [
  { x: 30, y: 44 },                    // outer top   — the high corner of the wing
  { x: SPINE_X, y: NOTCH_Y },          // inner top   — the notch
  { x: SPINE_X, y: 206 },              // inner bottom— at the spine
  { x: 12, y: 168 },                   // outer bottom
];
// A page's content rides on the page plane, so it's rotated to match that
// plane's tilt (the angle of its top edge) rather than sitting flat on screen.
const PAGE_TILT = Math.atan2(NOTCH_Y - PAGE_L[0].y, SPINE_X - PAGE_L[0].x) * 180 / Math.PI;
const CONTENT = { x: 160, y: 120, ring: 35, art: 24 };   // centre + radii, in left-page coords

const mirror = (p) => ({ x: 2 * SPINE_X - p.x, y: p.y });
const quad = (pts) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

// --- Page illustrations ------------------------------------------------------
// One per spell, drawn procedurally in a local box roughly ±22 around the
// origin (CONTENT.art is the radius they're scaled to fit). They're line art in
// the spell's own colour, matching the game's other procedural glyph work —
// `c` is the CONFIG.colors.spell entry, so a page, its bolt on the canvas and
// its sector in the tree all read as the same magic.
const SPELL_ART = {
  // A burning orb with licks of flame trailing off it.
  fireball: (c) => `
    <circle cx="1" cy="2" r="9" fill="${c.mid}" opacity="0.55"/>
    <circle cx="1" cy="2" r="5" fill="${c.core}"/>
    <path d="M-8 -4 Q-2 -12 3 -6 Q7 -13 9 -5" fill="none" stroke="${c.mid}" stroke-width="2"
      stroke-linecap="round"/>
    <path d="M-14 8 L-8 5 M-15 1 L-9 0 M-12 13 L-6 9" stroke="${c.mid}" stroke-width="2"
      stroke-linecap="round" opacity="0.85"/>
    <circle cx="1" cy="2" r="13" fill="none" stroke="${c.mid}" stroke-width="1.4"
      stroke-dasharray="3 6" opacity="0.7"/>`,

  // A forked bolt, the classic zig-zag, with two smaller arcs splitting off it.
  lightning: (c) => `
    <path d="M4 -17 L-6 0 L1 1 L-5 17 L9 -3 L2 -4 Z" fill="${c.core}" stroke="${c.mid}"
      stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M-11 -8 L-14 -1 L-10 -1" fill="none" stroke="${c.mid}" stroke-width="1.6"
      stroke-linecap="round" opacity="0.8"/>
    <path d="M12 5 L15 11 L11 11" fill="none" stroke="${c.mid}" stroke-width="1.6"
      stroke-linecap="round" opacity="0.8"/>`,

  // A cone opening to the right, filled with drifting shards.
  frost: (c) => `
    <path d="M-15 0 L13 -13 L13 13 Z" fill="${c.mid}" opacity="0.22"/>
    <path d="M-15 0 L13 -13 M-15 0 L13 13" fill="none" stroke="${c.mid}" stroke-width="1.8"
      stroke-linecap="round"/>
    <g stroke="${c.core}" stroke-width="1.6" stroke-linecap="round">
      <path d="M-3 -6 L3 -6 M0 -9 L0 -3"/>
      <path d="M4 4 L10 4 M7 1 L7 7"/>
      <path d="M-6 6 L-1 6 M-3.5 3.5 L-3.5 8.5"/>
    </g>
    <path d="M13 -13 L13 13" stroke="${c.core}" stroke-width="1.4" opacity="0.6"/>`,

  // Three rocks streaking down onto a cracked ground line.
  meteor: (c) => `
    <g stroke="${c.mid}" stroke-width="2" stroke-linecap="round" opacity="0.85">
      <path d="M-14 -16 L-7 -3"/><path d="M-1 -18 L4 -7"/><path d="M10 -14 L14 -6"/>
    </g>
    <circle cx="-6" cy="-1" r="3.5" fill="${c.core}"/>
    <circle cx="5" cy="-5" r="2.6" fill="${c.core}"/>
    <circle cx="15" cy="-4" r="2.2" fill="${c.core}"/>
    <path d="M-17 9 L17 9" stroke="${c.mid}" stroke-width="2" stroke-linecap="round"/>
    <path d="M-9 9 L-12 15 M2 9 L0 16 M11 9 L13 15" stroke="${c.mid}" stroke-width="1.5"
      stroke-linecap="round" opacity="0.7"/>`,

  // A kite shield with a rune bar across it.
  shield: (c) => `
    <path d="M0 -16 L13 -10 L13 3 Q13 13 0 18 Q-13 13 -13 3 L-13 -10 Z"
      fill="${c.mid}" fill-opacity="0.25" stroke="${c.mid}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M0 -10 L0 11 M-7 -2 L7 -2" stroke="${c.core}" stroke-width="2" stroke-linecap="round"/>
    <path d="M-4 -6 L0 -10 L4 -6" fill="none" stroke="${c.core}" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round"/>`,

  // A leaf-and-drop over a rising pulse — growth rather than a medical cross.
  heal: (c) => `
    <path d="M0 -16 Q9 -4 9 3 Q9 12 0 12 Q-9 12 -9 3 Q-9 -4 0 -16 Z"
      fill="${c.mid}" fill-opacity="0.3" stroke="${c.mid}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M0 -9 L0 7 M-5 -1 L5 -1" stroke="${c.core}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M-14 16 L-8 16 L-5 11 L-1 19 L3 14 L7 16 L14 16" fill="none" stroke="${c.mid}"
      stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`,
};

// --- Page rendering ----------------------------------------------------------
// The runic glyph ring around an illustration. Reuses the rune circle's
// procedural glyph templates (see rune-circle.js) so the book is written in the
// same alphabet as the wheel the player traces on.
function pageGlyphRing(seed, radius, count = 11) {
  let s = "";
  for (let i = 0; i < count; i++) {
    // Leave the bottom of the ring open so the glyphs never collide with the
    // spell's name — the arc runs over the top, not all the way round.
    const ang = -186 + (i * 192) / (count - 1);
    s += glyphAt(0, 0, radius, ang, 8, seed * 31 + i, "book-glyph");
  }
  return s;
}

// One page of the book: the spell's illustration, its glyph ring and its name,
// laid on the tilted page plane. `side` is -1 for the left leaf, +1 for the
// right; a sealed page shows a wax seal instead of the illustration, and the
// page the book is CAST from carries a ribbon and a lit border.
function spellPage(spell, side) {
  const pts = side < 0 ? PAGE_L : PAGE_L.map(mirror);
  const tilt = side < 0 ? PAGE_TILT : -PAGE_TILT;
  const cx = side < 0 ? CONTENT.x : 2 * SPINE_X - CONTENT.x;
  const idx = SPELLS.indexOf(spell);

  if (!spell) {
    // An odd-numbered book would leave one blank leaf; draw it as empty vellum
    // rather than skipping it, so the spread keeps its shape.
    return `<g class="bk-page blank"><polygon class="bk-leaf" points="${quad(pts)}"/></g>`;
  }

  const c = CONFIG.colors.spell[spell.id];
  const unlocked = spellUnlocked(spell.id);
  const active = unlocked && spell.id === activeSpellId();

  let inner;
  if (unlocked) {
    inner =
      `<g class="bk-ring" stroke="${c.mid}">${pageGlyphRing(idx + 1, CONTENT.ring)}</g>` +
      `<g class="bk-art" transform="scale(${(CONTENT.art / 18).toFixed(3)})">${SPELL_ART[spell.id](c)}</g>`;
  } else {
    // Sealed: a wax seal over the illustration's place. The name is withheld
    // too — the tree node that opens the page is where you learn what it is.
    inner =
      `<circle class="bk-seal" r="17" fill="#2a2136" stroke="#5b5170" stroke-width="2.5"/>` +
      `<text class="bk-sealmark" y="7" text-anchor="middle">?</text>` +
      `<circle r="${CONTENT.ring}" fill="none" stroke="#4a4360" stroke-width="1.2" stroke-dasharray="3 7"/>`;
  }

  const name = unlocked ? spell.name : "Versiegelt";
  // Long names (Meteoritenschauer) have to fit the page width; squeeze rather
  // than clip, so every page keeps one line.
  const nameSvg =
    `<text class="bk-name" y="${CONTENT.ring + 20}" text-anchor="middle" ` +
    `fill="${unlocked ? c.core : "#6d6484"}" textLength="128" lengthAdjust="spacingAndGlyphs">${name}</text>`;

  // The ribbon marking the page the book is open at, hung over the outer edge.
  const ribbon = active
    ? `<g class="bk-ribbon" fill="${c.mid}">` +
      `<polygon points="${quad([pts[0], { x: pts[0].x + side * -14, y: pts[0].y },
        { x: pts[0].x + side * -14, y: pts[0].y + 34 }, { x: pts[0].x + side * -7, y: pts[0].y + 27 },
        { x: pts[0].x, y: pts[0].y + 34 }])}"/></g>`
    : "";

  const act = unlocked ? ` data-act="spellSelect" data-args='["${spell.id}"]'` : "";
  return `<g class="bk-page${active ? " active" : ""}${unlocked ? "" : " locked"}"${act}>
      <polygon class="bk-leaf" points="${quad(pts)}"${active ? ` stroke="${c.mid}"` : ""}/>
      ${ribbon}
      <g transform="translate(${cx},${CONTENT.y}) rotate(${tilt.toFixed(2)})">${inner}${nameSvg}</g>
    </g>`;
}

// The stack of pages already turned on one side, drawn as a few edge slivers
// behind the open leaf so the book reads as thick rather than as two flat cards.
function pageStack(side, count) {
  if (count <= 0) return "";
  const pts = side < 0 ? PAGE_L : PAGE_L.map(mirror);
  let s = "";
  for (let i = Math.min(4, count); i > 0; i--) {
    const off = i * 2.5;
    const shifted = [
      { x: pts[0].x - side * off, y: pts[0].y + off * 0.5 },
      { x: pts[1].x, y: pts[1].y + off * 0.5 },
      { x: pts[2].x, y: pts[2].y + off * 0.4 },
      { x: pts[3].x - side * off, y: pts[3].y + off * 0.4 },
    ];
    s += `<polygon class="bk-stack" points="${quad(shifted)}" opacity="${(0.5 - i * 0.08).toFixed(2)}"/>`;
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

  // Covers: the same quads pushed out and down, so a rim of leather shows past
  // the pages on the outer and lower edges.
  const coverPts = (side) => {
    const p = side < 0 ? PAGE_L : PAGE_L.map(mirror);
    return [
      { x: p[0].x - side * 9, y: p[0].y - 4 },
      { x: p[1].x, y: p[1].y - 2 },
      { x: p[2].x, y: p[2].y + 9 },
      { x: p[3].x - side * 9, y: p[3].y + 8 },
    ];
  };

  const tab = (dir, x) => {
    const disabled = dir < 0 ? spread <= 0 : spread >= leaves - 1;
    return `<g class="bk-tab${disabled ? " off" : ""}"${disabled ? "" :
      ` data-act="spellbookFlip" data-args="[${dir}]"`} transform="translate(${x},213)">
        <rect class="bk-tabbg" x="-19" y="-13" width="38" height="26" rx="9"/>
        <path class="bk-tabarrow" d="${dir < 0 ? "M4 -6 L-4 0 L4 6" : "M-4 -6 L4 0 L-4 6"}"/>
      </g>`;
  };

  return `
    <svg class="spellbook" id="spellbook" viewBox="0 0 ${BOOK_W} ${BOOK_H}"
         preserveAspectRatio="xMidYMax meet" aria-label="Zauberbuch">
      <polygon class="bk-cover" points="${quad(coverPts(-1))}"/>
      <polygon class="bk-cover" points="${quad(coverPts(1))}"/>
      ${pageStack(-1, spread * 2)}
      ${pageStack(1, SPELLS.length - spread * 2 - 2)}
      ${spellPage(left, -1)}
      ${spellPage(right, 1)}
      <path class="bk-spine" d="M${SPINE_X} ${NOTCH_Y - 2} L${SPINE_X} 215"/>
      <path class="bk-spine-hl" d="M${SPINE_X} ${NOTCH_Y + 6} L${SPINE_X} 200"/>
      ${tab(-1, 96)}
      ${tab(1, BOOK_W - 96)}
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

window.Incanto.spellbook = { SPELL_ART, renderSpellbook, spellbookFlip };
