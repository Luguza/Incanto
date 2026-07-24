"use strict";
// ==============================================================================
// rune-circle.js — rune-circle population + procedural SVG glyphs. Owns:
// drawLoadout, populateCircle, GLYPH_TEMPLATES, glyphAt.
// ==============================================================================

// ---------------------------------------------------------------------------
// Word pool / circle population
// ---------------------------------------------------------------------------
function drawLoadout() {
  const pairs = [];
  for (let i = 0; i < CONFIG.pairsPerLoadout; i++) {
    const idx = (state.poolIndex + i) % WORD_POOL.length;
    pairs.push({ id: idx, it: WORD_POOL[idx].it, de: WORD_POOL[idx].de });
  }
  state.poolIndex = (state.poolIndex + CONFIG.pairsPerLoadout) % WORD_POOL.length;
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
