#!/usr/bin/env node
// ==============================================================================
// check-sentences.mjs — audits SENTENCE_POOL (src/content.js).
//
// The sentence pool is the one place where free-form Italian is written by hand,
// so it is the one place a typo, a stray word the game never teaches, or a blank
// that gives itself away can slip in unnoticed. This checks the house rules
// written above the pool:
//
//   • 3–7 tokens per sentence (the build-the-sentence bank is tapped with a thumb)
//   • `blank` is one whole token of `it`, appears exactly once, and is never the
//     first token (a capitalised option would be a free answer)
//   • no elided article inside a blank ("l'orologio" would print with its article)
//   • no duplicate sentences
//   • every part of speech holds at least CONFIG.quizOptionCount distinct blanks,
//     so fill-the-blank can always find same-kind distractors
//   • every Italian token is vocabulary the game teaches — a WORD_POOL entry, an
//     inflection of one, a present-tense form of one, a function word, or one of
//     the few forms listed in EXTRA_FORMS below
//
// Run: node tools/check-sentences.mjs   (exits non-zero on any failure)
// ==============================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// content.js is a classic script that hangs its data off window.Incanto; run it
// in a tiny fake global so the pools can be read without a browser.
function loadContent() {
  const src = readFileSync(join(root, "src/content.js"), "utf8");
  const sandbox = { Incanto: {} };
  new Function("window", src)(sandbox);
  return sandbox.Incanto;
}
function loadConfig() {
  const src = readFileSync(join(root, "src/config.js"), "utf8");
  const sandbox = { Incanto: {} };
  new Function("window", src)(sandbox);
  return sandbox.Incanto.CONFIG;
}

// Articles, prepositions (plain and articulated), possessives and the pronoun
// clitics — the glue a sentence needs that no vocabulary card teaches.
const FUNCTION_WORDS = `
il lo la i gli le un uno una
di a da in con su per tra fra
del dello della dei degli delle
al allo alla ai agli alle
dal dallo dalla dai dagli dalle
nel nello nella nei negli nelle
sul sullo sulla sui sugli sulle col
mio mia miei mie tuo tua tuoi tue
`.trim().split(/\s+/);

// Elidable words: what may sit in front of an apostrophe inside a token.
const ELIDABLE = ["l", "un", "all", "dell", "nell", "sull", "dall", "d", "c"];

// Verb forms the generator can't produce: irregular presents of pool verbs that
// the conjugation drills don't carry, so nothing else in the codebase knows them.
const EXTRA_FORMS = [
  "tengo", "tieni", "tiene", "teniamo", "tenete", "tengono",
  "riesco", "riesci", "riesce", "riusciamo", "riuscite", "riescono",
  "conosco", "conosci", "conosce", "conosciamo", "conoscete", "conoscono",
  // svegliarsi is in the pool as a reflexive infinitive, so nothing derives its
  // present from the bare stem.
  "sveglio", "svegli", "sveglia", "svegliamo", "svegliate", "svegliano",
  "e-mail", "tv", "sì",
];

const { WORD_POOL, SENTENCE_POOL, CONJ_POOL, conjugateRegular,
  BAR_ITEMS, BAR_ORDER_POOL, BAR_KEEPER } = loadContent();
const CONFIG = loadConfig();

// --- the set of words a sentence may use -------------------------------------
const known = new Set([...FUNCTION_WORDS, ...EXTRA_FORMS]);
const add = (w) => { if (w) known.add(w.toLowerCase()); };

// Inflections: a noun or adjective changes its final vowel for gender/number, so
// admit every vowel ending of the same stem (rosso → rossa / rossi / rosse), plus
// the two spellings that keep the sound: -co/-go grow an h before i/e (lungo →
// lunghi), and -io has only one i in the plural (occhio → occhi).
function addInflections(word) {
  add(word);
  if (word.length > 3 && /[oaei]$/.test(word)) {
    for (const end of ["o", "a", "e", "i"]) add(word.slice(0, -1) + end);
    if (/[cg]o$/.test(word)) for (const end of ["hi", "he"]) add(word.slice(0, -1) + end);
    if (/io$/.test(word)) add(word.slice(0, -1));
  }
}

for (const entry of WORD_POOL) {
  for (const raw of entry.it.split(" ")) {
    const word = raw.replace(/[?!.,]/g, "");
    // Pool nouns carry their article ("il cane"); the article itself is glue.
    if (FUNCTION_WORDS.includes(word)) continue;
    const bare = word.includes("'") ? word.slice(word.indexOf("'") + 1) : word;
    addInflections(bare);
    // Any infinitive in the pool is drillable, so its present tense is fair game.
    const group = /are$/.test(bare) ? "are" : /ere$/.test(bare) ? "ere" : /ire$/.test(bare) ? "ire" : null;
    if (group && bare.length > 4) {
      for (const g of group === "ire" ? ["ire", "isc"] : [group]) {
        for (const form of conjugateRegular(bare, g)) add(form);
      }
    }
  }
}
for (const verb of CONJ_POOL) for (const form of verb.forms) add(form);

// --- the audit ---------------------------------------------------------------
const errors = [];
const seen = new Set();
const byPos = {};

for (const s of SENTENCE_POOL) {
  const where = `"${s.it}"`;
  const tokens = s.it.split(" ");

  if (seen.has(s.it)) errors.push(`${where}: duplicate sentence`);
  seen.add(s.it);

  if (tokens.length < 3 || tokens.length > 7) {
    errors.push(`${where}: ${tokens.length} tokens (want 3–7)`);
  }

  const hits = tokens.filter((t) => t === s.blank).length;
  if (hits === 0) errors.push(`${where}: blank "${s.blank}" is not a token`);
  else if (hits > 1) errors.push(`${where}: blank "${s.blank}" appears ${hits}×`);
  else if (tokens[0] === s.blank) errors.push(`${where}: blank "${s.blank}" is the first token`);
  if (s.blank.includes("'")) errors.push(`${where}: blank "${s.blank}" carries an elided article`);
  if (!s.de || !s.pos) errors.push(`${where}: missing de/pos`);

  (byPos[s.pos] ||= new Set()).add(s.blank);

  for (const raw of tokens) {
    const word = raw.toLowerCase().replace(/[?!.,]/g, "");
    if (known.has(word)) continue;
    // "l'orologio", "un'ora", "all'estero": check the two halves separately.
    if (word.includes("'")) {
      const [head, tail] = [word.slice(0, word.indexOf("'")), word.slice(word.indexOf("'") + 1)];
      if (ELIDABLE.includes(head) && known.has(tail)) continue;
    }
    errors.push(`${where}: "${raw}" is not vocabulary the game teaches`);
  }
}

// --- the bar's own pool ------------------------------------------------------
// Same rules, one extra: the blank is not just any word, it is an ORDER. It has
// to be something on BAR_ITEMS, because whatever fills the gap is what the
// keeper puts on the counter — a line whose answer has no serving to go with it
// would leave the hero eating nothing (see TAV_MEAL in src/tavern.js, which is
// keyed by the same ids).
const orderedItems = new Set();

for (const s of BAR_ORDER_POOL) {
  const where = `bar "${s.it}"`;
  const tokens = s.it.split(" ");

  if (seen.has(s.it)) errors.push(`${where}: duplicate sentence`);
  seen.add(s.it);

  if (tokens.length < 3 || tokens.length > 7) {
    errors.push(`${where}: ${tokens.length} tokens (want 3–7)`);
  }

  const hits = tokens.filter((t) => t === s.blank).length;
  if (hits === 0) errors.push(`${where}: blank "${s.blank}" is not a token`);
  else if (hits > 1) errors.push(`${where}: blank "${s.blank}" appears ${hits}×`);
  else if (tokens[0] === s.blank) errors.push(`${where}: blank "${s.blank}" is the first token`);
  if (s.blank.includes("'")) errors.push(`${where}: blank "${s.blank}" carries an elided article`);
  if (!s.de) errors.push(`${where}: missing de`);
  if (!BAR_ITEMS.includes(s.blank)) {
    errors.push(`${where}: "${s.blank}" is not on the menu (BAR_ITEMS), so nothing can be served for it`);
  }
  orderedItems.add(s.blank);

  // An order names one thing. A second menu item in the same line would show the
  // player one of its own distractors already spoken for.
  const extra = tokens.filter((t) => t !== s.blank && BAR_ITEMS.includes(t));
  if (extra.length) errors.push(`${where}: also names ${extra.join(", ")} — one order, one item`);

  for (const raw of tokens) {
    const word = raw.toLowerCase().replace(/[?!.,]/g, "");
    if (!known.has(word)) errors.push(`${where}: "${raw}" is not vocabulary the game teaches`);
  }
}

for (const item of BAR_ITEMS) {
  if (!orderedItems.has(item)) errors.push(`menu item "${item}": nothing on BAR_ORDER_POOL orders it`);
}
if (BAR_ITEMS.length < CONFIG.meal.optionCount) {
  errors.push(`BAR_ITEMS: ${BAR_ITEMS.length} items, needs ${CONFIG.meal.optionCount} for a full menu of options`);
}

// The keeper's spoken lines are read, not answered, but they are still Italian
// the player is expected to understand — so they are held to the same
// vocabulary, and each one has to carry its German.
for (const [group, lines] of Object.entries(BAR_KEEPER)) {
  for (const l of [].concat(lines)) {
    if (!l.it || !l.de) { errors.push(`keeper ${group}: a line is missing it/de`); continue; }
    for (const raw of l.it.split(" ")) {
      const word = raw.toLowerCase().replace(/[?!.,]/g, "");
      if (!known.has(word)) errors.push(`keeper ${group} "${l.it}": "${raw}" is not vocabulary the game teaches`);
    }
  }
}

for (const [pos, blanks] of Object.entries(byPos)) {
  if (blanks.size < CONFIG.quizOptionCount) {
    errors.push(`pos "${pos}": only ${blanks.size} distinct blanks, needs ${CONFIG.quizOptionCount} for distractors`);
  }
}

// --- report ------------------------------------------------------------------
const posCounts = Object.entries(byPos)
  .map(([pos, blanks]) => `${pos} ${SENTENCE_POOL.filter((s) => s.pos === pos).length} (${blanks.size} distinct blanks)`)
  .sort();
console.log(`SENTENCE_POOL: ${SENTENCE_POOL.length} sentences`);
for (const line of posCounts) console.log(`  ${line}`);
console.log(`BAR_ORDER_POOL: ${BAR_ORDER_POOL.length} orders over ${BAR_ITEMS.length} menu items`);

if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log("\nAll sentence checks passed.");
