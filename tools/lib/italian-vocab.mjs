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

// ==============================================================================
// The staged set: what a learner has been HANDED by a given point on the road.
//
// The set above answers "does the game teach this word?", which is the right
// question for the sentence pool — a quiz question is drawn at random out of
// the whole vocabulary and owes nothing to any order. A lecture does owe
// something to an order: it is read after the lectures before it and before the
// ones after, and the drill at its end may only ask for what has been taught by
// then. Measured against the flat set, `Il libro è nuovo` is impeccable
// Italian — every word is in the pool — and it was the twelfth exercise of the
// FIRST lecture, which is about which article `libro` takes. It needed essere,
// nineteen lectures away, and adjective agreement, six.
//
// So the same vocabulary is served here as a set that GROWS. It starts as the
// dictionary — the pool's words in the shape the pool writes them — and a
// lecture opens the rest of a word as it teaches it: the plural once the plural
// has been taught, the feminine once gender has, a verb's six forms once that
// verb's own lecture has. An inflection is a claim about grammar, and grammar
// is exactly what is being sequenced.
//
// Two things it deliberately does NOT gate. Prepositions and `e`/`non` are glue
// a learner meets in the first sentence they ever read and no lecture claims to
// introduce (the preposition lectures are about the ARTICULATED forms, del and
// allo). And a distractor is exempt everywhere: a wrong option is supposed to
// be a form that does not exist.
// ==============================================================================

// The glue, per above.
export const GLUE_WORDS = `
e non ma o che se
di a da in con su per tra fra
sì no
`.trim().split(/\s+/);

const ARTICLE_HEADS = ["il", "lo", "la", "i", "gli", "le", "un", "uno", "una"];

const clean = (raw) => String(raw).toLowerCase().replace(/^[(„"]+|[)!?.,;:"“”]+$/g, "");

// -o → -i, -a → -e, -e → -i, plus the three spellings that keep the sound. A
// word that ends in none of them (città, il bar, la foto) does not move, which
// is exactly what the lecture on those says.
export function nounPlurals(word) {
  if (/io$/.test(word)) return [word.slice(0, -1)];
  if (/[cg]ia$/.test(word)) return [word.slice(0, -2) + "e"];
  if (/[cg]a$/.test(word)) return [word.slice(0, -1) + "he"];
  if (/[cg]o$/.test(word)) return [word.slice(0, -1) + "hi", word.slice(0, -1) + "i"];
  if (/o$/.test(word)) return [word.slice(0, -1) + "i"];
  if (/a$/.test(word)) return [word.slice(0, -1) + "e"];
  if (/e$/.test(word)) return [word.slice(0, -1) + "i"];
  return [];
}

// All four (or two) agreement forms of one adjective.
export function adjectiveForms(word) {
  if (!/[oae]$/.test(word) || word.length < 4) return [];
  const stem = word.slice(0, -1);
  const out = ["o", "a", "e", "i"].map((end) => stem + end);
  if (/[cg][oa]$/.test(word)) out.push(stem + "hi", stem + "he");
  if (/io$/.test(word)) out.push(stem);
  return out;
}

// Every finite form the game can produce, so the dictionary can be held clear
// of them: a conjugated verb enters the set through its lecture, never through
// the pool entry it was built from.
function everyVerbForm({ WORD_POOL, CONJ_POOL, conjugateRegular }) {
  const forms = new Set();
  for (const verb of CONJ_POOL) for (const f of verb.forms) forms.add(f);
  for (const entry of WORD_POOL) {
    for (const raw of entry.it.split(/\s+/)) {
      const word = clean(raw);
      const group = /are$/.test(word) ? "are" : /ere$/.test(word) ? "ere" : /ire$/.test(word) ? "ire" : null;
      if (!group || word.length <= 4) continue;
      for (const g of group === "ire" ? ["ire", "isc"] : [group]) {
        for (const f of conjugateRegular(word, g)) forms.add(f);
      }
    }
  }
  return forms;
}

// The road, walked one lecture at a time. `open(name)` is what a lecture's
// `opens` list asks for; `known` is everything handed over so far.
export function curriculumStage(pools) {
  const { WORD_POOL, CONJ_POOL, conjugateRegular } = pools;
  const verbForms = everyVerbForm(pools);
  const known = new Set(GLUE_WORDS);
  const nouns = [];                       // dictionary nouns, gender pairs included
  const others = [];                      // everything else that can inflect

  for (const entry of WORD_POOL) {
    const tokens = entry.it.split(/\s+/).map(clean).filter(Boolean);
    let isNoun = false, rest = tokens;
    if (tokens.length > 1 && ARTICLE_HEADS.includes(tokens[0])) { isNoun = true; rest = tokens.slice(1); }
    else if (/^(l|un)'/.test(tokens[0])) { isNoun = true; rest = [tokens[0].slice(tokens[0].indexOf("'") + 1), ...tokens.slice(1)]; }
    const body = rest.filter((t) => !GLUE_WORDS.includes(t));
    // A CHUNK IS NOT ITS WORDS. "come stai?" is taught as a thing you say, and
    // that is no licence to write `stai` before stare has a lecture.
    if (body.length !== 1) continue;
    const word = body[0];
    // The article says "noun", whatever else the letters happen to spell: `la
    // porta` is a door in a game that also conjugates portare.
    if (isNoun) { known.add(word); nouns.push(word); continue; }
    if (/(are|ere|ire|rsi)$/.test(word) || !verbForms.has(word)) { known.add(word); others.push(word); }
  }

  const conjugate = (infinitive) => {
    const entry = CONJ_POOL.find((v) => v.it === infinitive);
    if (entry) return entry.forms;
    const stem = /rsi$/.test(infinitive) ? infinitive.slice(0, -3) + "re" : infinitive;
    const group = /are$/.test(stem) ? "are" : /ere$/.test(stem) ? "ere" : "ire";
    return conjugateRegular(stem, group);
  };
  const infinitivesOf = (group) => {
    const suffix = group === "isc" ? "ire" : group;
    const out = new Set(CONJ_POOL.filter((v) => v.group === group).map((v) => v.it));
    for (const entry of WORD_POOL) {
      for (const raw of entry.it.split(/\s+/)) {
        const word = clean(raw);
        if (word.endsWith(suffix) && word.length > 4) out.add(word);
      }
    }
    return [...out];
  };

  function open(name) {
    if (name === "noun-gender") {
      for (const word of [...nouns]) {
        const other = /o$/.test(word) ? word.slice(0, -1) + "a"
          : /a$/.test(word) ? word.slice(0, -1) + "o" : null;
        if (other && !known.has(other)) { known.add(other); nouns.push(other); }
      }
      return true;
    }
    if (name === "noun-plural") {
      for (const word of nouns) for (const f of nounPlurals(word)) known.add(f);
      return true;
    }
    if (name === "adj-forms") {
      for (const word of others) for (const f of adjectiveForms(word)) known.add(f);
      return true;
    }
    if (name.startsWith("verb:")) {
      const what = name.slice(5);
      const list = what.startsWith("-") ? infinitivesOf(what.slice(1)) : [what];
      for (const inf of list) for (const f of conjugate(inf)) known.add(f);
      return true;
    }
    return false;                          // an `opens` the audit does not know
  }

  return { known, open };
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
