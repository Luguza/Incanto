"use strict";
// ==============================================================================
// book-order.js — the order screen: where the spell book is BOUND. Reached from
// a button on the upgrade screen (see skilltree.js), it shows the whole book at
// once — three open volumes, one per spread — and lets a page be picked up and
// dropped onto another. The two trade places.
//
// Why three books rather than a list of six names: the page IS the spell here.
// The book in combat is read by its art — a page of flames, a page of ice — and
// the order you bind them in is what your thumb has to leaf through mid-fight.
// Dragging the actual leaf, seal, ribbon and all, is the same object the player
// already knows, so nothing has to be translated back and forth.
//
// The three books are drawn into ONE svg (spellbook.js hands out the parts:
// bookDefs once, bookMarkup per volume). That is not a layout convenience — it
// is what makes the drag possible at all. A page lifted out of its own svg
// would be cut off at that svg's edge the moment it crossed into a neighbour's
// space; inside one svg it can be reparented into a drag layer that floats over
// every book on the screen.
//
// Everything here is drag-and-drop with a thumb. No keyboard path exists and
// none may be added — see CLAUDE.md.
// ==============================================================================

const BO_GAP = 30;                       // clear space between two stacked books
const BO_SLOT = BOOK_H + BO_GAP;         // pitch from one book's head to the next

// Where a book's box sits in the tall svg.
function boBookY(book) { return book * BO_SLOT; }

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------
function renderBookOrderFull() {
  const books = bookLeaves();
  const height = books * BOOK_H + (books - 1) * BO_GAP;
  const pages = bookSpells();

  // One light pool per open page, namespaced per book — without the suffix all
  // three volumes would resolve to the first book's gradient and every page
  // would glow in the first spell's colour (see spellPage's `ns`).
  const pools = [];
  for (let b = 0; b < books; b++) {
    pools.push({ id: "bkPoolLb" + b, spell: pages[b * 2] });
    pools.push({ id: "bkPoolRb" + b, spell: pages[b * 2 + 1] });
  }

  // A book: clipped to its own box so a leaf — which runs a long way below the
  // box's foot — can't hang into the volume underneath. The clip is on an inner
  // group with no transform of its own, because a userSpaceOnUse clip resolves
  // in the space its element establishes (the same trap spellPage documents).
  let volumes = "";
  for (let b = 0; b < books; b++) {
    volumes += `<g transform="translate(0,${boBookY(b)})" class="bo-book">` +
      `<g clip-path="url(#bkBox)">` +
        bookMarkup(b, {
          ns: "b" + b,
          act: false,                    // this screen binds pages; it doesn't cast from them
          under: false,                  // nothing turns here, so nothing needs revealing
          attrs: (slot) => ` data-slot="${slot}"`,
        }) +
        // The box cuts a leaf off well short of its foot — in combat that edge
        // is the bottom of the screen and is never seen. Here three of them are
        // stacked, so each cut is dropped into shadow: the page reads as running
        // on out of the light rather than as having been sliced through.
        `<rect class="bo-foot" x="0" y="${BOOK_H - 52}" width="${BOOK_W}" height="52" fill="url(#boFoot)"/>` +
      `</g></g>`;
  }

  app.innerHTML = `
    <div class="screen bo-screen">
      <div class="bo-topbar">
        <button class="bo-back" data-act="closeBookOrder">‹ Runenbaum</button>
        <div class="tree-title">Buch binden</div>
      </div>
      <p class="bo-hint">Zieh eine Seite auf eine andere — sie tauschen die Plätze.</p>
      <div class="bo-stage">
        <svg class="bo-canvas" id="book-order" viewBox="0 0 ${BOOK_W} ${height}"
             preserveAspectRatio="xMidYMid meet" aria-label="Seitenreihenfolge">
          ${bookDefs(pools)}
          <defs>
            <linearGradient id="boFoot" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#0b0810" stop-opacity="0"/>
              <stop offset="1" stop-color="#0b0810" stop-opacity="0.85"/>
            </linearGradient>
          </defs>
          ${volumes}
          <!-- The carried page. Reparented in on pick-up so it floats over every
               book instead of under the next one's boards, and clipped to a
               page-sized box that travels with it. -->
          <g id="bo-carry-at"><g id="bo-carry" clip-path="url(#bkBox)"></g></g>
        </svg>
      </div>
    </div>`;

  attachBookOrderDrag();
}

// Open / leave the screen. Both live in the upgrade phase, so the nav keeps the
// anvil lit either way (see NAV_PHASE_FOR_SCREEN).
function openBookOrder() {
  state.screen = "bookorder";
  state._structuralDirty = true;
}
function closeBookOrder() {
  state.screen = "upgrade";
  state._structuralDirty = true;
}

// ---------------------------------------------------------------------------
// Pick a page up, carry it, drop it on another
// ---------------------------------------------------------------------------
const BO_TAP_SLOP = 6;                   // px of travel below which a gesture is a tap, not a drag
const BO_SETTLE_MS = 170;                // how long a page takes to fall back when dropped on nothing

function attachBookOrderDrag() {
  const svg = document.getElementById("book-order");
  if (!svg) return;
  const carry = document.getElementById("bo-carry");
  const carryAt = document.getElementById("bo-carry-at");
  if (!carry || !carryAt) return;

  let page = null;                       // the leaf being carried
  let home = null;                       // where it came from: { parent, next, y }
  let fromSlot = -1, overSlot = -1;
  let start = null, moved = false;

  // Client px → the svg's own coordinates. Read off the live CTM rather than the
  // bounding box, so it stays right whatever letterboxing preserveAspectRatio
  // leaves around the drawing.
  const toVB = (e) => {
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const at = (x, y) => carryAt.setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)})`);

  // Which page the finger is over. The carried leaf is under the finger the
  // whole time, so it is `pointer-events: none` (see meta.css) and this reads
  // straight through it to the book below.
  const pageUnder = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const g = el && el.closest ? el.closest(".bk-page[data-slot]") : null;
    return g && g !== page ? g : null;
  };
  const markTarget = (g) => {
    const prev = svg.querySelector(".bo-target");
    if (prev && prev !== g) prev.classList.remove("bo-target");
    if (g) g.classList.add("bo-target");
    overSlot = g ? Number(g.dataset.slot) : -1;
  };

  // Put a leaf back where it was lifted from. Only ever needed when a drop
  // changes nothing — a swap rebuilds the whole screen anyway.
  const restore = (leaf, spot) => {
    if (!leaf || !spot || !spot.parent.isConnected) return;
    spot.parent.insertBefore(leaf, spot.next);
    leaf.classList.remove("bo-lift");
  };

  svg.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const g = e.target.closest ? e.target.closest(".bk-page[data-slot]") : null;
    if (!g) return;
    page = g;
    fromSlot = Number(g.dataset.slot);
    home = { parent: g.parentNode, next: g.nextSibling, y: boBookY(fromSlot >> 1) };
    start = toVB(e);
    moved = false;
    overSlot = -1;
    // Lifted into the carry layer at exactly the offset its own book had, so it
    // doesn't jump on the frame it is picked up.
    at(0, home.y);
    carry.appendChild(page);
    page.classList.add("bo-lift");
    try { svg.setPointerCapture(e.pointerId); } catch (_) {}
  });

  svg.addEventListener("pointermove", (e) => {
    if (!page) return;
    const p = toVB(e);
    const dx = p.x - start.x, dy = p.y - start.y;
    if (!moved && Math.hypot(dx, dy) < BO_TAP_SLOP) return;
    moved = true;
    at(dx, home.y + dy);
    markTarget(pageUnder(e));
  });

  const onUp = (e) => {
    if (!page) return;
    const dropped = page, spot = home;
    const target = moved ? overSlot : -1;
    markTarget(null);
    page = null;
    if (target >= 0 && target !== fromSlot) {
      // The swap rebuilds the screen from the new order, so the carried node is
      // about to be thrown away with the rest of the DOM — nothing to restore.
      swapBookPages(fromSlot, target);
      return;
    }
    // Dropped on nothing: the page falls back into its slot rather than
    // snapping, so a mis-aimed drag reads as a page settling and not as a
    // rejection.
    const from = carryAt.getAttribute("transform");
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(from || "");
    const x0 = m ? parseFloat(m[1]) : 0, y0 = m ? parseFloat(m[2]) : spot.y;
    const y1 = spot.y;
    const t0 = performance.now();
    const step = (now) => {
      // Torn out from under the animation — a re-render replaces the whole svg,
      // and a fresh pick-up takes the carry layer over. Either way the fall has
      // nothing left to land.
      if (!dropped.isConnected || dropped.parentNode !== carry) return;
      const k = Math.min(1, (now - t0) / BO_SETTLE_MS);
      const eased = k * (2 - k);
      at(x0 * (1 - eased), y0 + (y1 - y0) * eased);
      if (k < 1) { requestAnimationFrame(step); return; }
      restore(dropped, spot);
    };
    requestAnimationFrame(step);
  };
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointercancel", onUp);
}

window.Incanto.bookOrder = { renderBookOrderFull, openBookOrder, closeBookOrder, attachBookOrderDrag };
