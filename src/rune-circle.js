"use strict";
// ==============================================================================
// rune-circle.js — rune-circle population + procedural SVG glyphs. Owns:
// drawLoadout, populateCircle, GLYPH_TEMPLATES, glyphAt.
// ==============================================================================

// ---------------------------------------------------------------------------
// Word pool / circle population
// ---------------------------------------------------------------------------
// A loadout is part curriculum, part revision. Most slots walk the pool in order
// (`poolIndex`) so the whole vocabulary keeps coming round; the rest are drawn
// from the review pool — the words the player has fumbled in the last few days,
// weighted by how badly (see vocab-history.js). CONFIG.vocab.maxReviewSlots caps
// the revision share so the curriculum never stalls on a handful of hard words.
//
// A word already on the board is never dealt twice, and neither is one whose
// Italian or German text is already there: two identical-looking runes would
// make the pairing ambiguous rather than hard.
function drawLoadout() {
  const pairs = [];
  const usedIdx = new Set();
  const usedText = new Set();
  const conflicts = (idx) => usedIdx.has(idx) || usedText.has(WORD_POOL[idx].it) || usedText.has(WORD_POOL[idx].de);
  const take = (idx) => {
    usedIdx.add(idx);
    usedText.add(WORD_POOL[idx].it);
    usedText.add(WORD_POOL[idx].de);
    pairs.push({ id: idx, it: WORD_POOL[idx].it, de: WORD_POOL[idx].de });
  };
  // Next usable word in curriculum order, advancing the cursor past whatever it
  // skips so the pool still walks forward exactly once per deal.
  const takeNext = () => {
    for (let guard = 0; guard < WORD_POOL.length; guard++) {
      const idx = state.poolIndex % WORD_POOL.length;
      state.poolIndex = (state.poolIndex + 1) % WORD_POOL.length;
      if (!conflicts(idx)) return idx;
    }
    return state.poolIndex % WORD_POOL.length; // pool too small to avoid a repeat
  };

  const review = (typeof struggleDrawPool === "function") ? struggleDrawPool() : [];
  // A thin review pool gets fewer slots than a fat one: with two hard words on
  // file, two review slots per board would mean seeing that same pair over and
  // over, which is drilling by exhaustion rather than by spacing.
  const maxReview = Math.min(CONFIG.vocab.maxReviewSlots, Math.ceil(review.length / 2));
  let reviewSlots = 0;
  for (let i = 0; i < CONFIG.pairsPerLoadout; i++) {
    let idx = -1;
    if (review.length && reviewSlots < maxReview && Math.random() < CONFIG.vocab.reviewSlotChance) {
      idx = weightedPickIndex(review.filter((e) => !conflicts(e.idx)));
      if (idx >= 0) reviewSlots++;
    }
    take(idx >= 0 ? idx : takeNext());
  }
  if (typeof recordRuneSeen === "function") recordRuneSeen(pairs);
  return pairs;
}

function populateCircle(pairs) {
  const slots = layoutCircle(CONFIG.runeCount);
  const contents = [];
  pairs.forEach((p) => {
    contents.push({ pairId: p.id, lang: "it", word: p.it });
    contents.push({ pairId: p.id, lang: "de", word: p.de });
  });
  shuffleArray(contents);

  state.runes = contents.map((c, i) => ({
    id: i,
    pairId: c.pairId,
    lang: c.lang,
    word: c.word,
    x: slots[i].x,
    y: slots[i].y,
    matchState: "unmatched",
  }));
  state.chords = [];
  state.selectedRuneId = null;
  state.currentPairs = pairs;
  pairs.forEach((p) => {
    state.pairAvailableAtClockMs[p.id] = state.clockMs;
  });
  state._structuralDirty = true;
}



// Small runic-looking polyline glyphs, procedurally placed so no font
// support is required. Templates are in local coords (y up = outward).
const GLYPH_TEMPLATES = [
  [[0, -5], [0, 5]],
  [[-3, 5], [0, -5], [3, 5]],
  [[-3, -5], [-3, 5], [3, 5]],
  [[-3, 5], [-3, -5], [3, -5], [3, 5]],
  [[-3, -5], [3, 5], [3, -5]],
  [[0, -5], [0, 5], [3, 0], [-3, 0]],
  [[-3, 0], [0, -5], [3, 0], [0, 5], [-3, 0]],
  [[3, -5], [-3, -1], [3, 3], [0, 5]],
];

function glyphAt(cx, cy, r, angleDeg, size, seed, cls) {
  const t = GLYPH_TEMPLATES[tileHash(seed, 31) % GLYPH_TEMPLATES.length];
  const gx = cx + r * Math.cos((angleDeg * Math.PI) / 180);
  const gy = cy + r * Math.sin((angleDeg * Math.PI) / 180);
  const pts = t.map(([x, y]) => `${(x * size / 5).toFixed(1)},${(y * size / 5).toFixed(1)}`).join(" ");
  return `<polyline class="${cls}" points="${pts}" transform="translate(${gx.toFixed(1)} ${gy.toFixed(1)}) rotate(${(angleDeg + 90).toFixed(1)})"/>`;
}

window.Incanto.runeCircle = { drawLoadout, populateCircle, glyphAt };
