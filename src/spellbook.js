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
// is this mirrored about x = 300 (the spine).
//
// The book is raked hard toward the player: the top edges climb ~22° from the
// spine out to the wings, which is what makes the V deep enough for the rune
// wheel to sit in. Paying for that angle in height would have pushed the book
// halfway up the screen, so the pages simply RUN OFF THE BOTTOM — both lower
// corners sit below the viewBox and are clipped away. Nothing is lost: the part
// of a page below its illustration is blank vellum anyway.
//
// The consequence is that the book's thickness (cover rim + the slivers of
// already-turned pages) is only ever visible along the OUTER edges, at the left
// and right of the screen. There is no bottom edge on screen to show it on.
const BOOK_W = 600, BOOK_H = 250;
const SPINE_X = 300;
const NOTCH_Y = 126;                   // where both pages meet at the top — the bottom of the V
const PAGE_L = [
  { x: 38, y: 20 },                    // outer top    — the high corner of the wing
  { x: SPINE_X, y: NOTCH_Y },          // inner top    — the notch
  { x: SPINE_X, y: 300 },              // inner bottom — below the viewBox, clipped
  { x: 16, y: 262 },                   // outer bottom — below the viewBox, clipped
];
// A page's content rides on the page plane, so it's rotated to match that
// plane's tilt (the angle of its top edge) rather than sitting flat on screen.
const PAGE_TILT = Math.atan2(NOTCH_Y - PAGE_L[0].y, SPINE_X - PAGE_L[0].x) * 180 / Math.PI;
// Centre + radii of a page's contents, in left-page coords. The name sits ABOVE
// the illustration (see spellPage), so the ring is set low enough on the page to
// leave the title clear of the top edge once the whole group is tilted.
const CONTENT = { x: 160, y: 170, ring: 37, art: 25 };
// Foreshortening. Rotating the contents onto the page plane gets the direction
// right but not the perspective: a page raked this far toward the player is
// seen at a slant, so it should be squashed vertically too. Applied OUTSIDE the
// rotation (translate → squash → rotate) so the squash is along screen-vertical
// rather than along the page's own axis.
const PAGE_SQUASH = 0.85;
// How far a page must be dragged, as a fraction of the book's width, before
// letting go turns the leaf instead of springing it back.
const FLIP_THRESHOLD = 0.12;

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
function pageGlyphRing(seed, radius, count = 13) {
  let s = "";
  for (let i = 0; i < count; i++) {
    // A ring left open at the TOP, where the spell's name sits — the glyphs run
    // down one side, under the illustration and back up the other.
    const ang = 22 + (i * 316) / (count - 1);
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
  // The title heads the page, above the illustration and inside the gap left in
  // the glyph ring. Long names (Meteoritenschauer) have to fit the page width;
  // squeeze rather than clip, so every page keeps its title on one line.
  const nameSvg =
    `<text class="bk-name" y="${-(CONTENT.ring + 19)}" text-anchor="middle" ` +
    `fill="${unlocked ? c.core : "#6d6484"}" textLength="128" lengthAdjust="spacingAndGlyphs">${name}</text>`;

  // The ribbon marking the page the book is open at, hung over the outer edge.
  const ribbon = active
    ? `<g class="bk-ribbon" fill="${c.mid}">` +
      `<polygon points="${quad([pts[0], { x: pts[0].x + side * -14, y: pts[0].y },
        { x: pts[0].x + side * -14, y: pts[0].y + 34 }, { x: pts[0].x + side * -7, y: pts[0].y + 27 },
        { x: pts[0].x, y: pts[0].y + 34 }])}"/></g>`
    : "";

  // `data-side` lets the drag handler find the leaf it should turn without
  // re-deriving which spell is on it.
  const act = unlocked ? ` data-act="spellSelect" data-args='["${spell.id}"]'` : "";
  return `<g class="bk-page${active ? " active" : ""}${unlocked ? "" : " locked"}" data-side="${side}"${act}>
      <polygon class="bk-leaf" points="${quad(pts)}"${active ? ` stroke="${c.mid}"` : ""}/>
      ${ribbon}
      <g transform="translate(${cx},${CONTENT.y}) scale(1,${PAGE_SQUASH}) rotate(${tilt.toFixed(2)})">${inner}${nameSvg}</g>
    </g>`;
}

// The pages already turned on one side, drawn as a few slivers peeking out past
// the open leaf's OUTER edge — the only place the book's thickness shows, since
// its lower edge is clipped off the bottom of the screen. They also double as
// the affordance for dragging: a fat stack on the right means more to turn to.
function pageStack(side, count) {
  if (count <= 0) return "";
  const pts = side < 0 ? PAGE_L : PAGE_L.map(mirror);
  let s = "";
  for (let i = Math.min(4, count); i > 0; i--) {
    const off = i * 4.5;
    // Pushed straight out toward the screen edge — no downward offset, or the
    // slivers would fan out along a bottom edge that isn't there.
    const shifted = [
      { x: pts[0].x - side * off, y: pts[0].y - off * 0.22 },
      { x: pts[1].x, y: pts[1].y },
      { x: pts[2].x, y: pts[2].y },
      { x: pts[3].x - side * off, y: pts[3].y },
    ];
    s += `<polygon class="bk-stack" points="${quad(shifted)}" opacity="${(0.55 - i * 0.09).toFixed(2)}"/>`;
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

  // Covers: the same quads pushed OUT only, so a rim of leather shows past the
  // pages along the outer edges and the top of each wing. Nothing is pushed
  // down — the bottom of the book is off screen.
  const coverPts = (side) => {
    const p = side < 0 ? PAGE_L : PAGE_L.map(mirror);
    return [
      { x: p[0].x - side * 11, y: p[0].y - 6 },
      { x: p[1].x, y: p[1].y - 1 },
      { x: p[2].x, y: p[2].y },
      { x: p[3].x - side * 13, y: p[3].y },
    ];
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
      <path class="bk-spine" d="M${SPINE_X} ${NOTCH_Y - 2} L${SPINE_X} ${BOOK_H}"/>
      <path class="bk-spine-hl" d="M${SPINE_X} ${NOTCH_Y + 6} L${SPINE_X} ${BOOK_H}"/>
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
  const leafFor = (d) => svg.querySelector(`.bk-page[data-side="${d < 0 ? 1 : -1}"]`);
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
    release();
    if (flipped) {
      // Swallow the click this same gesture is about to fire, so turning a page
      // never also re-arms the spell it let go over. Kept short — the click
      // arrives right behind pointerup, and a longer window would start eating
      // genuine taps made straight after a flip.
      bookDragUntil = performance.now() + 250;
      spellbookFlip(dx < 0 ? 1 : -1);
      return;
    }
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
}

window.Incanto.spellbook = { SPELL_ART, renderSpellbook, spellbookFlip, attachSpellbookDrag };
