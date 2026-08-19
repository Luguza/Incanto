// ==============================================================================
// italian-vocab.mjs — "is this a word the game teaches?", answered once.
//
// Two audits need the same answer. `check-sentences.mjs` asks it of every token
// in SENTENCE_POOL and BAR_ORDER_POOL; `check-grammar.mjs` asks it of every
// Italian string in a lecture. They must not drift: two lists of function words
// that disagree would let a word through one door and stop it at the other,
// and the audit that let it through is the one nobody would notice.
// ==============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A classic script that hangs its data off window.Incanto, run in a tiny fake
// global so the pools can be read without a browser.
export function loadScript(root, rel) {
  const src = readFileSync(join(root, rel), "utf8");
  const sandbox = { Incanto: {} };
  new Function("window", src)(sandbox);
  return sandbox.Incanto;
}

// Articles, prepositions (plain and articulated), possessives and the pronoun
// clitics — the glue a sentence needs that no vocabulary card teaches.
export const FUNCTION_WORDS = `
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
export const ELIDABLE = ["l", "un", "all", "dell", "nell", "sull", "dall", "d", "c"];

// Verb forms the generator can't produce: irregular presents of pool verbs that
// the conjugation drills don't carry, so nothing else in the codebase knows them.
export const EXTRA_FORMS = [
  "tengo", "tieni", "tiene", "teniamo", "tenete", "tengono",
  "riesco", "riesci", "riesce", "riusciamo", "riuscite", "riescono",
  "conosco", "conosci", "conosce", "conosciamo", "conoscete", "conoscono",
  // svegliarsi is in the pool as a reflexive infinitive, so nothing derives its
  // present from the bare stem.
  "sveglio", "svegli", "sveglia", "svegliamo", "svegliate", "svegliano",
  "e-mail", "tv", "sì",
];

// The set of words the game teaches: the pool, its inflections, the present
// tense of every infinitive in it, the written-out irregulars, and the glue.
export function buildKnownWords({ WORD_POOL, CONJ_POOL, conjugateRegular }) {
  const known = new Set([...FUNCTION_WORDS, ...EXTRA_FORMS]);
  const add = (w) => { if (w) known.add(w.toLowerCase()); };

  // Inflections: a noun or adjective changes its final vowel for gender/number,
  // so admit every vowel ending of the same stem (rosso → rossa / rossi / rosse),
  // plus the two spellings that keep the sound: -co/-go grow an h before i/e
  // (lungo → lunghi), and -io has only one i in the plural (occhio → occhi).
  const addInflections = (word) => {
    add(word);
    if (word.length > 3 && /[oaei]$/.test(word)) {
      for (const end of ["o", "a", "e", "i"]) add(word.slice(0, -1) + end);
      if (/[cg]o$/.test(word)) for (const end of ["hi", "he"]) add(word.slice(0, -1) + end);
      if (/[cg]a$/.test(word)) for (const end of ["he", "hi"]) add(word.slice(0, -1) + end);
      if (/io$/.test(word)) add(word.slice(0, -1));
      // …and the feminine side of the same rule: unstressed -cia/-gia swallows
      // its i in the plural (arancia → arance, faccia → facce).
      if (/[cg]ia$/.test(word)) add(word.slice(0, -2) + "e");
    }
  };

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
  return known;
}

// One written token, measured against that set. Handles the elisions — a token
// like "l'orologio" or "un'ora" is two words wearing one apostrophe.
export function tokenKnown(raw, known) {
  const word = String(raw).toLowerCase().replace(/[?!.,;:]/g, "");
  if (!word) return true;
  if (known.has(word)) return true;
  if (word.includes("'")) {
    const head = word.slice(0, word.indexOf("'"));
    const tail = word.slice(word.indexOf("'") + 1);
    // "un'amica" — the head is the elided article; "l'" alone is the article on
    // its own, which a grammar lecture may well be about.
    if (ELIDABLE.includes(head) && (tail === "" || known.has(tail))) return true;
  }
  return false;
}
