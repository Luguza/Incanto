"use strict";
// ==============================================================================
// pixel-font.js — a bitmap font for text drawn INSIDE a canvas scene.
//
// The DOM handles every other word in the game, and it should: it is crisp at
// any scale and it is what the delegated dispatch talks to. This font is for the
// one case the DOM cannot serve — words that belong to the ROOM rather than to
// the interface, like the speech in the tavern's bubbles. A DOM panel floating
// over a pixel scene is a different picture pasted onto it; text painted at the
// scene's own resolution is part of it.
//
// ALL CAPS on purpose. At five pixels of cap height there is no room for a
// descender or an x-height that still reads, and a mixed-case tiny font ends up
// with an 'a' and an 'o' that are the same three-pixel blob. Caps also halve the
// glyph table. `pxDraw` uppercases what it is given (ß → SS comes free from
// toUpperCase), so callers write ordinary text.
//
// A glyph is rows of "#" and "." separated by "/", and its width is the width of
// its rows — so a glyph is as wide as it needs to be (I is one pixel, M is five)
// and the font is proportional. Rows above five mean the glyph carries an accent
// and is drawn that much higher; the baseline is the bottom row either way.
//
// Owns: Incanto.pixelFont — { draw, width, height, wrap, bake, LINE }.
// ==============================================================================

const PX_GLYPH_H = 5;          // cap height; accented glyphs sit taller
const PX_GAP = 1;              // letterspacing
const PX_LINE = 7;             // baseline to baseline, accents included

const PX_FONT = {
  " ": "../../../../..",
  A: ".#./#.#/###/#.#/#.#",
  B: "##./#.#/##./#.#/##.",
  C: ".##/#../#../#../.##",
  D: "##./#.#/#.#/#.#/##.",
  E: "###/#../##./#../###",
  F: "###/#../##./#../#..",
  G: ".##/#../#.#/#.#/.##",
  H: "#.#/#.#/###/#.#/#.#",
  I: "#/#/#/#/#",
  J: "..#/..#/..#/#.#/.#.",
  K: "#.#/#.#/##./#.#/#.#",
  L: "#../#../#../#../###",
  M: "#...#/##.##/#.#.#/#...#/#...#",
  N: "#..#/##.#/#.##/#..#/#..#",
  O: ".#./#.#/#.#/#.#/.#.",
  P: "##./#.#/##./#../#..",
  Q: ".#./#.#/#.#/##./.##",
  R: "##./#.#/##./#.#/#.#",
  S: ".##/#../.#./..#/##.",
  T: "###/.#./.#./.#./.#.",
  U: "#.#/#.#/#.#/#.#/###",
  V: "#.#/#.#/#.#/#.#/.#.",
  W: "#...#/#...#/#.#.#/##.##/#...#",
  X: "#.#/#.#/.#./#.#/#.#",
  Y: "#.#/#.#/.#./.#./.#.",
  Z: "###/..#/.#./#../###",
  0: "###/#.#/#.#/#.#/###",
  1: ".#./##./.#./.#./###",
  2: "##./..#/.#./#../###",
  3: "##./..#/.#./..#/##.",
  4: "#.#/#.#/###/..#/..#",
  5: "###/#../##./..#/##.",
  6: ".##/#../##./#.#/.#.",
  7: "###/..#/.#./.#./.#.",
  8: ".#./#.#/.#./#.#/.#.",
  9: ".#./#.#/.##/..#/##.",
  "!": "#/#/#/./#",
  "?": "##./..#/.#./.../.#.",
  ".": "./././/#",
  ",": "./././#/#",
  "'": "#/#/./././",
  ":": "./#/./#/.",
  "-": ".../.../###/.../...",
  "—": "...../...../#####/...../.....",
  "+": ".../.#./###/.#./...",
  "/": "..#/..#/.#./#../#..",
  "(": ".#/#./#./#./.#",
  ")": "#./.#/.#/.#/#.",
  // The shield the bar's meal grants — a glyph so it can sit in a line of text
  // like any other character.
  "⛨": "#####/#####/#####/.###./..#..",
  // Accented capitals: two rows of mark above the letter's own five.
  Ä: "#.#/.../.#./#.#/###/#.#/#.#",
  Ö: "#.#/.../.#./#.#/#.#/#.#/.#.",
  Ü: "#.#/.../#.#/#.#/#.#/#.#/###",
  À: "#../.../.#./#.#/###/#.#/#.#",
  È: "#../.../###/#../##./#../###",
  É: "..#/.../###/#../##./#../###",
  Ì: "#../.../.#./.#./.#./.#./.#.",
  Ò: "#../.../.#./#.#/#.#/#.#/.#.",
  Ù: "#../.../#.#/#.#/#.#/#.#/###",
};

// char → { w, rows }, parsed once. An unknown character falls back to a space,
// so a stray glyph leaves a hole rather than throwing on the draw path.
const PX_PARSED = (() => {
  const out = {};
  for (const ch in PX_FONT) {
    const rows = PX_FONT[ch].split("/");
    out[ch] = { w: Math.max(...rows.map((r) => r.length)), rows };
  }
  return out;
})();

function pxGlyph(ch) {
  return PX_PARSED[ch] || PX_PARSED[" "];
}

// Width of a string in pixels, letterspacing included but not trailing.
function pxWidth(text) {
  const s = String(text).toUpperCase();
  let w = 0;
  for (const ch of s) w += pxGlyph(ch).w + PX_GAP;
  return Math.max(0, w - PX_GAP);
}

// Draw text with its BASELINE at y — i.e. y is the bottom row of an unaccented
// capital, so two lines sit PX_LINE apart whether or not either carries an
// accent. x is the left edge.
function pxDraw(ctx, text, x, y, col) {
  const s = String(text).toUpperCase();
  ctx.fillStyle = col;
  let cx = Math.round(x);
  const base = Math.round(y);
  for (const ch of s) {
    const g = pxGlyph(ch);
    // Rows are bottom-aligned to the baseline: an accent's extra rows go up.
    const top = base - g.rows.length + 1;
    for (let r = 0; r < g.rows.length; r++) {
      const row = g.rows[r];
      for (let c = 0; c < row.length; c++) {
        if (row[c] === "#") ctx.fillRect(cx + c, top + r, 1, 1);
      }
    }
    cx += g.w + PX_GAP;
  }
  return cx - PX_GAP - Math.round(x);
}

// Break text into lines that each fit `maxW`. Words are never split — a word
// longer than the box overflows it, which is visible, rather than being cut in
// half, which reads as a typo.
function pxWrap(text, maxW) {
  const words = String(text).split(" ").filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? line + " " + w : w;
    if (line && pxWidth(next) > maxW) { lines.push(line); line = w; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

// Is this character actually cut? Everything the game writes into a scene is
// authored text, so a missing glyph is a hole someone can see — the smoke test
// asks this of every character the tavern's own content contains.
function pxHas(ch) {
  return Object.prototype.hasOwnProperty.call(PX_PARSED, String(ch).toUpperCase());
}

window.Incanto.pixelFont = {
  draw: pxDraw, width: pxWidth, wrap: pxWrap, has: pxHas,
  H: PX_GLYPH_H, LINE: PX_LINE, GAP: PX_GAP,
};
