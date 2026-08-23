#!/usr/bin/env node
// ==============================================================================
// check-grammar.mjs — audits GRAMMAR_UNITS + GRAMMAR_LECTURES (src/grammar.js).
//
// A lecture is the second place in this codebase where free-form Italian is
// written by hand, and it is a worse place for a typo than the sentence pool:
// a sentence that goes wrong is one question in a random draw, a lecture that
// goes wrong is a fixed page a learner is being TAUGHT from. So the same
// discipline applies, plus the checks the compact drill specs need — the
// builder in src/lecture.js turns them into question objects, and a spec it
// cannot expand is a blank screen.
//
// What is checked:
//   • unit ids are unique and every lecture belongs to one that exists
//   • lecture ids are unique; an authored lecture has pages and exactly
//     CONFIG.grammar.drillCount drills
//   • every block is a kind the renderer knows, with the fields it needs, and
//     every Italian example carries its German gloss
//   • every drill spec is a known kind with the fields its builder reads:
//     - pick / gap-with-bank: the answer is among the options, the options are
//       distinct, and there are CONFIG.quizOptionCount of them
//     - gap: the answer is one whole token of the sentence, appears exactly
//       once, and is never the first (a capitalised option gives itself away)
//     - pair: no repeated text in either column — a board with two identical
//       tiles has no right answer, which is the bug sampleDistinctWords and
//       unmistakablePersons exist to prevent in the quiz
//     - write: `accept` never contradicts the answer
//     - build: 3–7 tokens, the bank is tapped with a thumb
//     - para: six forms, blanks inside the paradigm
//   • every table declares what its columns hold (`cols`, one of label/it/de
//     each) and every list what language it is in — the renderer paints a cell
//     for what it holds, and a column typed wrong is a column drawn wrong
//   • every Italian word is vocabulary the game teaches BY THAT POINT ON THE
//     ROAD. The audit walks the lectures in order and grows the set as it goes:
//     a lecture may use the pool's dictionary forms, whatever earlier lectures
//     taught, whatever its own `teaches` names, and whatever its `opens`
//     unlocks — the plural once the plural has a lecture, a verb's six forms
//     once that verb has one. See `curriculumStage` in lib/italian-vocab.mjs
//     for why an inflection is gated at all. DISTRACTORS are exempt: a wrong
//     option is supposed to be a form that does not exist, and holding it to
//     the vocabulary would be holding it to being right.
//   • no raw < or & in an authored string — it goes into the page as written,
//     the way every other authored string in this game does
//
// Run: node tools/check-grammar.mjs   (exits non-zero on any failure)
// ==============================================================================
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadScript, buildKnownWords, curriculumStage, tokenKnown } from "./lib/italian-vocab.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const { WORD_POOL, CONJ_POOL, conjugateRegular, CONJ_PERSONS } = loadScript(root, "src/content.js");
const { GRAMMAR_UNITS, GRAMMAR_LECTURES } = loadScript(root, "src/grammar.js");
const CONFIG = loadScript(root, "src/config.js").CONFIG;

// Two sets, on purpose. `baseKnown` is the flat "does the game teach this word
// at all?" — it is what tells a typo apart from a form that is simply not due
// yet, and the two deserve different messages. `stage` is the same vocabulary
// as a set that grows lecture by lecture, and it is what a lecture is held to.
const baseKnown = buildKnownWords({ WORD_POOL, CONJ_POOL, conjugateRegular });
const stage = curriculumStage({ WORD_POOL, CONJ_POOL, conjugateRegular });

const errors = [];
const BLOCK_FIELDS = {
  p: ["de"], rule: ["de"], ex: ["it", "de"], bad: ["wrong", "right"],
  list: ["items", "lang"], table: ["head", "rows", "cols"],
};
const COL_KINDS = new Set(["label", "it", "de"]);
const DRILL_KINDS = new Set(["pick", "write", "pair", "gap", "build", "para"]);

// Everything authored gets read for markup that would land in the page raw.
function checkText(where, s) {
  if (typeof s !== "string") { errors.push(`${where}: expected a string, got ${typeof s}`); return; }
  if (/[<&]/.test(s)) errors.push(`${where}: contains a raw < or & — it is interpolated into the page as-is`);
}

// Italian, held to the vocabulary that has been taught by here. `extra` is the
// lecture's own `teaches` (already folded into the stage, and passed in as well
// so the message can tell one failure from the other).
function checkItalian(where, text, extra) {
  checkText(where, text);
  if (typeof text !== "string") return;
  for (const raw of text.split(/[\s/]+/)) {
    // A trailing apostrophe is NOT punctuation here: l' and un' are words in
    // their own right, and they are exactly what a lecture on articles teaches.
    const token = raw.replace(/^[(„"]+|[)!?.,;:"“”]+$/g, "");
    // A bare ending is morphology, not a word: -iamo is what the table is FOR.
    if (!token || /^_+$/.test(token) || /^[-—]/.test(token)) continue;
    if (extra.has(token.toLowerCase())) continue;
    if (tokenKnown(token, stage.known)) continue;
    if (tokenKnown(token, baseKnown)) {
      errors.push(`${where}: "${raw}" is taught, but not by this point in the curriculum — an earlier lecture has to open it, or this one has to name it in \`teaches\`/\`opens\``);
    } else {
      errors.push(`${where}: "${raw}" is not vocabulary the game teaches (add it to the lecture's \`teaches\` if this lecture is what introduces it)`);
    }
  }
}

// --- units --------------------------------------------------------------------
const unitIds = new Set();
for (const u of GRAMMAR_UNITS) {
  if (!u.id || !u.title || !u.blurb) errors.push(`unit "${u.id}": missing id/title/blurb`);
  if (unitIds.has(u.id)) errors.push(`unit "${u.id}": duplicate id`);
  unitIds.add(u.id);
  checkText(`unit "${u.id}" title`, u.title);
  checkText(`unit "${u.id}" blurb`, u.blurb);
}

// --- lectures -------------------------------------------------------------------
const lectureIds = new Set();
let authored = 0, drillTotal = 0, pageTotal = 0;
const kindCounts = {};

for (const lec of GRAMMAR_LECTURES) {
  const where = `lecture "${lec.id}"`;
  if (!lec.id) { errors.push(`a lecture has no id`); continue; }
  if (lectureIds.has(lec.id)) errors.push(`${where}: duplicate id`);
  lectureIds.add(lec.id);
  if (!unitIds.has(lec.unit)) errors.push(`${where}: unit "${lec.unit}" is not in GRAMMAR_UNITS`);
  if (!lec.title || !lec.subtitle) errors.push(`${where}: missing title/subtitle`);
  checkText(`${where} title`, lec.title);
  checkText(`${where} subtitle`, lec.subtitle);

  const teaches = new Set((lec.teaches || []).map((w) => String(w).toLowerCase()));
  // WHAT A LECTURE HANDS OVER IS HANDED OVER BEFORE IT IS READ, not after: the
  // lecture on essere is allowed to write `sono`, and every lecture after it is
  // too. Everything before it is not.
  for (const name of lec.opens || []) {
    if (!stage.open(name)) errors.push(`${where}: \`opens\` names "${name}", which the audit has no rule for`);
  }
  for (const word of teaches) stage.known.add(word);

  // --- pages ---
  const pages = lec.pages || [];
  if (!pages.length) errors.push(`${where}: no pages — a lecture that explains nothing is a quiz`);
  pageTotal += pages.length;
  pages.forEach((page, pi) => {
    const pw = `${where} page ${pi + 1}`;
    if (!page.blocks || !page.blocks.length) { errors.push(`${pw}: no blocks`); return; }
    for (const b of page.blocks) {
      const need = BLOCK_FIELDS[b.t];
      if (!need) { errors.push(`${pw}: unknown block type "${b.t}"`); continue; }
      for (const f of need) {
        if (b[f] === undefined || b[f] === null) errors.push(`${pw}: a "${b.t}" block is missing \`${f}\``);
      }
      if (b.t === "p" || b.t === "rule") checkText(`${pw} ${b.t}`, b.de);
      if (b.t === "ex") {
        checkItalian(`${pw} example`, b.it, teaches);
        checkText(`${pw} example gloss`, b.de);
        if (!String(b.de || "").trim()) errors.push(`${pw}: example "${b.it}" has no German gloss`);
        if (b.note !== undefined) checkText(`${pw} example note`, b.note);
      }
      if (b.t === "bad") {
        checkText(`${pw} wrong form`, b.wrong);   // deliberately not real Italian
        checkItalian(`${pw} right form`, b.right, teaches);
      }
      if (b.t === "list") {
        if (b.lang !== "it" && b.lang !== "de") errors.push(`${pw}: a list needs \`lang\` ("it" or "de")`);
        for (const it of b.items || []) {
          if (b.lang === "it") checkItalian(`${pw} list item`, it, teaches);
          else checkText(`${pw} list item`, it);
        }
      }
      if (b.t === "table") {
        const width = (b.head || []).length;
        for (const h of b.head || []) checkText(`${pw} table head`, h);
        // A CELL IS PAINTED FOR WHAT IT HOLDS, so what it holds is declared.
        // While the first column was muted on position alone, a table of two
        // Italian columns came out reading as one column captioning the other.
        const cols = b.cols || [];
        if (cols.length !== width) {
          errors.push(`${pw}: table has ${width} columns but \`cols\` types ${cols.length}`);
        }
        for (const c of cols) {
          if (!COL_KINDS.has(c)) errors.push(`${pw}: \`cols\` has "${c}" — one of label/it/de per column`);
        }
        (b.rows || []).forEach((r, ri) => {
          if (r.length !== width) errors.push(`${pw}: table row ${ri + 1} has ${r.length} cells, head has ${width}`);
          r.forEach((c, ci) => {
            if (cols[ci] === "it") checkItalian(`${pw} table cell`, c, teaches);
            else checkText(`${pw} table cell`, c);
          });
        });
      }
    }
  });

  // --- drills ---
  const drills = lec.drills || [];
  if (!drills.length) continue;                 // an unwritten lecture is a shelf slot, not an error
  authored++;
  drillTotal += drills.length;
  if (drills.length !== CONFIG.grammar.drillCount) {
    errors.push(`${where}: ${drills.length} drills (want ${CONFIG.grammar.drillCount})`);
  }

  drills.forEach((d, di) => {
    const dw = `${where} drill ${di + 1} (${d.k})`;
    if (!DRILL_KINDS.has(d.k)) { errors.push(`${dw}: unknown drill kind`); return; }
    kindCounts[d.k] = (kindCounts[d.k] || 0) + 1;
    if (d.title !== undefined) checkText(`${dw} title`, d.title);
    if (d.note !== undefined) checkText(`${dw} note`, d.note);

    // A closed set of options: the answer has to be in it, exactly once, and
    // there have to be as many as the grid is built for.
    const checkOptions = (answer, wrong) => {
      const opts = [answer, ...wrong];
      if (opts.length !== CONFIG.quizOptionCount) {
        errors.push(`${dw}: ${opts.length} options (want ${CONFIG.quizOptionCount})`);
      }
      if (new Set(opts).size !== opts.length) errors.push(`${dw}: repeated option`);
      for (const o of wrong) checkText(`${dw} distractor`, o);
    };

    if (d.k === "pick") {
      if (!d.q && !d.word) errors.push(`${dw}: no prompt (needs \`q\` or \`word\`)`);
      if (d.q) checkText(`${dw} prompt`, d.q);
      if (d.word) checkItalian(`${dw} prompt word`, d.word, teaches);
      if (d.a === undefined || !Array.isArray(d.d)) { errors.push(`${dw}: needs \`a\` and \`d\``); return; }
      checkItalian(`${dw} answer`, d.a, teaches);
      checkOptions(d.a, d.d);
    }

    if (d.k === "write") {
      if (!d.q && !d.word) errors.push(`${dw}: no prompt (needs \`q\` or \`word\`)`);
      if (d.q) checkText(`${dw} prompt`, d.q);
      if (d.word) checkText(`${dw} prompt word`, d.word);   // often the German side
      if (d.a === undefined) { errors.push(`${dw}: needs \`a\``); return; }
      checkItalian(`${dw} answer`, d.a, teaches);
      for (const alt of d.accept || []) {
        checkItalian(`${dw} accepted form`, alt, teaches);
        if (alt === d.a) errors.push(`${dw}: \`accept\` repeats the answer`);
      }
    }

    if (d.k === "pair") {
      if (!Array.isArray(d.pairs) || d.pairs.length < 3) { errors.push(`${dw}: needs at least 3 pairs`); return; }
      if (!d.leftLabel || !d.rightLabel) errors.push(`${dw}: both columns need a label`);
      checkText(`${dw} left label`, d.leftLabel);
      checkText(`${dw} right label`, d.rightLabel);
      const lefts = d.pairs.map((p) => p[0]), rights = d.pairs.map((p) => p[1]);
      // TWO IDENTICAL TILES HAVE NO RIGHT ANSWER. The board settles by tapping a
      // tile against its partner, so a column that repeats itself is a board the
      // player can be marked wrong on for a correct pairing.
      if (new Set(lefts).size !== lefts.length) errors.push(`${dw}: the left column repeats a tile`);
      if (new Set(rights).size !== rights.length) errors.push(`${dw}: the right column repeats a tile`);
      // WHICH COLUMN IS ITALIAN IS DECLARED, NOT GUESSED. It was guessed once —
      // "does it look like a lowercase Italian word?" — and that reads a German
      // "rot" or "zu teuer" as Italian and rejects it, while quietly letting
      // every capitalised German noun through unchecked. The spec says.
      const lang = Array.isArray(d.lang) ? d.lang : ["it", "it"];
      if (lang.length !== 2 || lang.some((x) => x !== "it" && x !== "de")) {
        errors.push(`${dw}: \`lang\` must be two of "it"/"de", one per column`);
      }
      for (const [l, r] of d.pairs) {
        [l, r].forEach((tile, col) => {
          const side = col ? "right" : "left";
          if (lang[col] === "it") checkItalian(`${dw} ${side} tile`, tile, teaches);
          else checkText(`${dw} ${side} tile`, tile);
        });
      }
    }

    if (d.k === "gap") {
      if (!d.it || !d.de || d.a === undefined) { errors.push(`${dw}: needs \`it\`, \`de\` and \`a\``); return; }
      checkItalian(`${dw} sentence`, d.it, teaches);
      checkText(`${dw} gloss`, d.de);
      const tokens = d.it.split(" ");
      const hits = tokens.filter((t) => t === d.a).length;
      if (hits === 0) errors.push(`${dw}: the answer "${d.a}" is not a token of "${d.it}"`);
      else if (hits > 1) errors.push(`${dw}: the answer "${d.a}" appears ${hits}× in "${d.it}"`);
      else if (tokens[0] === d.a) errors.push(`${dw}: the answer is the first token — a capital letter gives it away`);
      if (tokens.length < 3 || tokens.length > 7) errors.push(`${dw}: ${tokens.length} tokens (want 3–7)`);
      if (d.d) checkOptions(d.a, d.d);
    }

    if (d.k === "build") {
      if (!d.it || !d.de) { errors.push(`${dw}: needs \`it\` and \`de\``); return; }
      checkItalian(`${dw} sentence`, d.it, teaches);
      checkText(`${dw} gloss`, d.de);
      const tokens = d.it.split(" ");
      if (tokens.length < 3 || tokens.length > 7) errors.push(`${dw}: ${tokens.length} tokens (want 3–7)`);
      for (const x of d.extra || []) {
        // A decoy tile sits in a bank of real words and has to look like one.
        checkItalian(`${dw} decoy tile`, x, teaches);
        if (tokens.includes(x)) errors.push(`${dw}: decoy "${x}" is already in the sentence`);
      }
    }

    if (d.k === "para") {
      const v = d.verb;
      if (!v || !v.it || !v.de) { errors.push(`${dw}: needs a verb with \`it\` and \`de\``); return; }
      checkItalian(`${dw} verb`, v.it, teaches);
      checkText(`${dw} verb meaning`, v.de);
      const forms = v.forms || (v.group && v.group !== "irr" ? conjugateRegular(v.it, v.group) : null);
      if (!forms || forms.length !== CONJ_PERSONS.length) {
        errors.push(`${dw}: needs six forms (write them out for an irregular)`);
        return;
      }
      for (const f of forms) checkItalian(`${dw} form`, f, teaches);
      const blanks = Array.isArray(d.blanks) ? d.blanks : null;
      if (blanks) for (const i of blanks) {
        if (!Number.isInteger(i) || i < 0 || i >= CONJ_PERSONS.length) errors.push(`${dw}: blank row ${i} is not a person`);
      } else if (d.blanks !== undefined && (!Number.isInteger(d.blanks) || d.blanks < 1)) {
        errors.push(`${dw}: \`blanks\` must be a count or a list of person indices`);
      }
    }
  });
}

// Every unit named on the shelf should eventually hold something; an empty one
// is a promise, not a bug, so this only reports it.
const emptyUnits = GRAMMAR_UNITS
  .filter((u) => !GRAMMAR_LECTURES.some((l) => l.unit === u.id && l.drills && l.drills.length))
  .map((u) => u.title);

// --- report --------------------------------------------------------------------
console.log(`GRAMMAR: ${authored} authored lectures over ${GRAMMAR_UNITS.length} units`);
console.log(`  ${pageTotal} pages, ${drillTotal} drills`);
console.log(`  drills by kind: ${Object.entries(kindCounts).sort().map(([k, n]) => `${k} ${n}`).join(", ")}`);
if (emptyUnits.length) console.log(`  still empty: ${emptyUnits.join(", ")}`);

if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log("\nAll grammar checks passed.");
