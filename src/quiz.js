"use strict";
// ==============================================================================
// quiz.js — post-death vocab quiz logic. Owns: question builders, buildQuiz,
// answer checking/normalization, the conjugation ladder (makeConj /
// noteConjResult), and the inline exercise handlers (quizChoose, quizMatchTap,
// quizArrange*, quizTypeInput, quizConjInput, quizCheck*, quizReveal,
// advanceQuiz).
// ==============================================================================

// ---------------------------------------------------------------------------
// Post-death vocab quiz — the only source of currency
// ---------------------------------------------------------------------------
// The quiz is a mixed session of Duolingo-style exercises (everything but the
// audio/speech ones): multiple-choice translation both ways, typed translation
// both ways, tap-to-match pairs, fill-the-blank by word bank or by typing,
// build-the-sentence from a word bank, and conjugation drills that climb a
// difficulty ladder up to writing a verb's whole present tense out from nothing.
// Each entry in quizList is a self-contained question object carrying everything
// its renderer + checker need.
// ---------------------------------------------------------------------------

// Draw n distinct random items from a copy of arr (optionally filtered).
function sampleN(arr, n, keep) {
  const pool = shuffleArray((keep ? arr.filter(keep) : arr).slice());
  return pool.slice(0, n);
}

// Draw n words whose translations are distinct on BOTH sides, so a set never
// contains two entries that share a word (a handful of German meanings — "gut"
// = buono/bene, "schlecht" = cattivo/male — map to more than one Italian word).
// Without this a match board could show two indistinguishable tiles.
function sampleDistinctWords(n) {
  const seenIt = new Set(), seenDe = new Set(), out = [];
  for (const p of shuffleArray(WORD_POOL.slice())) {
    if (seenIt.has(p.it) || seenDe.has(p.de)) continue;
    seenIt.add(p.it); seenDe.add(p.de);
    out.push(p);
    if (out.length === n) break;
  }
  return out;
}

// Every acceptable answer-side word for a prompt, so synonyms that share the
// prompt (e.g. both buono and bene translate "gut") all count as correct.
function synonymsFor(pair, promptKey, answerKey) {
  return [...new Set(WORD_POOL.filter((p) => p[promptKey] === pair[promptKey]).map((p) => p[answerKey]))];
}

// The three sentence exercises share one pool, and a random draw out of it
// repeats far sooner than it feels like it should — two draws in the same
// session landing on the same sentence is the birthday problem, not bad luck.
// So the sentences just served are remembered and skipped: a ring of the last
// CONFIG.quizSentenceMemory of them, which spans many sessions' worth of draws.
// Memory only — a reload starts the pool fresh, which is the point at which a
// repeat no longer reads as one.
const recentSentences = [];
function drawSentence() {
  const memory = Math.min(CONFIG.quizSentenceMemory, SENTENCE_POOL.length - 1);
  const recent = new Set(recentSentences.slice(-memory));
  // Falls back to the whole pool if the filter left nothing (a pool smaller than
  // the memory, say) so a draw can never come back empty.
  const s = sampleN(SENTENCE_POOL, 1, (x) => !recent.has(x))[0] || sampleN(SENTENCE_POOL, 1)[0];
  recentSentences.push(s);
  if (recentSentences.length > memory) recentSentences.splice(0, recentSentences.length - memory);
  return s;
}

// Which WORD_POOL entry a question is drilling. Every question carries its
// `words` (pool indices) so the learning history can tally the outcome against
// the vocabulary itself rather than the exercise — see vocab-history.js. The
// samplers hand back pool objects by reference, so identity is enough.
function wordIndexOf(pair) { return WORD_POOL.indexOf(pair); }
// The sentence exercises drill a whole phrase; only the blank itself is a piece
// of vocabulary the history can meaningfully track, and only when the pool
// actually holds it as a standalone word.
function wordIndexByIt(word) { return WORD_POOL.findIndex((p) => p.it === word); }

// --- per-type question builders ---------------------------------------------
function makeChoose(dir) {
  // dir: "it2de" (show Italian, pick German) or "de2it" (show German, pick Italian)
  const pair = sampleN(WORD_POOL, 1)[0];
  const promptKey = dir === "it2de" ? "it" : "de";
  const answerKey = dir === "it2de" ? "de" : "it";
  const answer = pair[answerKey];
  // Exclude any word that shares the prompt (a synonym would be an equally
  // correct option) as well as one that repeats the answer text.
  const distractors = sampleN(WORD_POOL, CONFIG.quizOptionCount - 1,
    (p) => p[answerKey] !== answer && p[promptKey] !== pair[promptKey])
    .map((p) => p[answerKey]);
  return { type: "choose", dir, prompt: pair[promptKey], answer, words: [wordIndexOf(pair)],
    options: shuffleArray([answer, ...distractors]) };
}

function makeType(dir) {
  const pair = sampleN(WORD_POOL, 1)[0];
  const promptKey = dir === "it2de" ? "it" : "de";
  const answerKey = dir === "it2de" ? "de" : "it";
  return { type: "type", dir, prompt: pair[promptKey], answer: pair[answerKey],
    words: [wordIndexOf(pair)], accept: synonymsFor(pair, promptKey, answerKey) };
}

function makeMatch() {
  const n = CONFIG.quizMatchPairs;
  // Each tile keeps the pool index of the word it carries (`wid`), so a wrong
  // tap can be blamed on the two specific words that were confused.
  const pairs = sampleDistinctWords(n).map((p, i) => ({ id: i, it: p.it, de: p.de, wid: wordIndexOf(p) }));
  return {
    type: "match",
    pairs,
    words: pairs.map((p) => p.wid),
    left: shuffleArray(pairs.map((p) => ({ id: p.id, word: p.it }))),
    right: shuffleArray(pairs.map((p) => ({ id: p.id, word: p.de }))),
  };
}

function makeFill(kind) {
  // kind: "fill-choose" (word bank) or "fill-type" (keyboard)
  const s = drawSentence();
  const tokens = s.it.split(" ");
  const blankIdx = tokens.indexOf(s.blank);
  const blankWord = wordIndexByIt(s.blank);
  const q = { type: kind, tokens, blankIdx, answer: s.blank, de: s.de, pos: s.pos,
    words: blankWord >= 0 ? [blankWord] : [] };
  if (kind === "fill-choose") {
    const distractors = sampleN(BLANKS_BY_POS[s.pos] || [], CONFIG.quizOptionCount - 1, (w) => w !== s.blank);
    q.options = shuffleArray([s.blank, ...distractors]);
  }
  return q;
}

function makeArrange() {
  const s = drawSentence();
  const answer = s.it.split(" ");
  const distractors = sampleN(SENTENCE_WORDS, 2, (w) => !answer.includes(w));
  // Bank tiles are shuffled; each carries the token plus a stable tile id so a
  // repeated word (e.g. two "il") stays individually addressable.
  const bank = shuffleArray([...answer, ...distractors].map((word, i) => ({ id: i, word })));
  // No `words`: word order is what's being drilled here, not any one vocable, so
  // the learning history stays out of it.
  return { type: "arrange", answer, de: s.de, bank };
}

// --- conjugation drills -----------------------------------------------------
// One verb, six forms, and a ladder of ways to be asked for them (see
// CONFIG.conjugation): pick a form, write a form, fill half a table, write the
// whole paradigm out from nothing. Every rung shares the same question shape —
// the verb, its `forms`, and which of the six persons is being asked about — so
// the checker and the renderers only ever look at the rung's `kind`.
function conjLevels() { return CONFIG.conjugation.levels; }
function conjTopLevel() {
  return Math.max(0, Math.min(state.conjLevel || 0, conjLevels().length - 1));
}

// A conjugation question drills the verb itself, so its outcome lands on the
// same WORD_POOL entry the rune circle teaches (the -isc- block that isn't in
// the pool simply tallies nothing — see recordQuizOutcome).
function conjWords(verb) {
  const idx = wordIndexByIt(verb.it);
  return idx >= 0 ? [idx] : [];
}

// Wrong options for "pick the form". The verb's OWN other persons come first —
// those are the confusions worth drilling — and the endings of the classes it
// doesn't belong to fill up behind them, so a paradigm with repeated forms
// (essere: io sono / loro sono) still has four distinct options.
function conjDistractors(verb, answer, n) {
  const seen = new Set([answer]);
  const take = (words) => words.filter((w) => !seen.has(w) && seen.add(w));
  const own = take(verb.forms);
  const foreign = take(
    Object.keys(CONJ_ENDINGS)
      .filter((g) => g !== verb.group)
      .flatMap((g) => conjugateRegular(verb.it, g))
  );
  return [...shuffleArray(own), ...shuffleArray(foreign)].slice(0, n);
}

// Persons a verb spells unmistakably. A paradigm can write two of them the same
// way (essere: io sono / loro sono), and a matching board with two identical
// tiles on it has no right answer — so those persons stay off the boards.
function unmistakablePersons(verb) {
  return CONJ_PERSONS
    .map((_, i) => i)
    .filter((i) => verb.forms.indexOf(verb.forms[i]) === verb.forms.lastIndexOf(verb.forms[i]));
}

// The easy end of the ladder: a closed board of person tiles and form tiles to
// tap together. Two boards, and the difference is where the forms come from —
// ONE verb's paradigm (read the table off, the pairs eliminate each other), or
// one form each from several verbs, which can only be solved off the ENDINGS
// since no two tiles share a stem.
function makeConjMatch(level, lv) {
  const n = Math.min(lv.pairs || 4, CONJ_PERSONS.length);
  const pairs = [];
  const take = (verb, person) => pairs.push({
    id: pairs.length, person,
    it: CONJ_PERSONS[person].it, de: verb.forms[person],
    wid: conjWords(verb)[0] ?? -1,
  });
  const q = { type: "conj-match", level, goldMult: lv.gold, mixed: !!lv.mixed };
  if (lv.mixed) {
    for (const verb of shuffleArray(CONJ_POOL.slice())) {
      if (pairs.length === n) break;
      // a person no other tile claims, spelled a way no other tile spells
      const person = shuffleArray(unmistakablePersons(verb))
        .find((i) => !pairs.some((p) => p.person === i || p.de === verb.forms[i]));
      if (person !== undefined) take(verb, person);
    }
  } else {
    const verb = sampleN(CONJ_POOL, 1)[0];
    q.verb = { it: verb.it, de: verb.de, group: verb.group };
    q.forms = verb.forms.slice();
    for (const person of sampleN(unmistakablePersons(verb), n)) take(verb, person);
  }
  q.pairs = pairs;
  q.words = [...new Set(pairs.map((p) => p.wid))].filter((w) => w >= 0);
  q.leftLabel = "Person";
  q.rightLabel = "Form";
  q.left = shuffleArray(pairs.map((p) => ({ id: p.id, word: p.it })));
  q.right = shuffleArray(pairs.map((p) => ({ id: p.id, word: p.de })));
  return q;
}

function makeConj(level) {
  const lv = conjLevels()[level];
  if (lv.kind === "match") return makeConjMatch(level, lv);
  const verb = sampleN(CONJ_POOL, 1)[0];
  const q = {
    level, goldMult: lv.gold,
    verb: { it: verb.it, de: verb.de, group: verb.group },
    forms: verb.forms.slice(),
    words: conjWords(verb),
  };
  if (lv.kind === "table") {
    // Which rows are left blank. The full table blanks all six; a half table
    // leaves the rest standing as worked examples to pattern-match against.
    const rows = CONJ_PERSONS.map((_, i) => i);
    const blanks = Math.min(lv.blanks || rows.length, rows.length);
    q.type = "conj-table";
    q.blanks = sampleN(rows, blanks).sort((a, b) => a - b);
    return q;
  }
  q.person = Math.floor(Math.random() * CONJ_PERSONS.length);
  q.answer = verb.forms[q.person];
  if (lv.kind === "choose") {
    q.type = "conj-choose";
    q.options = shuffleArray([q.answer, ...conjDistractors(verb, q.answer, CONFIG.quizOptionCount - 1)]);
  } else {
    q.type = "conj-type";
    // The bare form is what's asked for, but writing the pronoun in front of it
    // is the same knowledge, so it counts.
    q.accept = [q.answer, ...CONJ_PERSONS[q.person].it.split("/").map((p) => `${p.trim()} ${q.answer}`)];
  }
  return q;
}

// The ladder climbs itself: only the TOP rung moves it, so clearing a rung the
// player has already outgrown neither promotes nor demotes. The streak is one
// signed counter — correct answers push it up, misses (a revealed solution
// included) push it down — so two in either direction move the mark by one rung.
function noteConjResult(q, correct) {
  if (!q || q.level === undefined || q.level !== conjTopLevel()) return;
  const cfg = CONFIG.conjugation;
  const streak = state.conjStreak || 0;
  state.conjStreak = correct ? Math.max(0, streak) + 1 : Math.min(0, streak) - 1;
  if (state.conjStreak >= cfg.promoteStreak && q.level < conjLevels().length - 1) {
    state.conjLevel = q.level + 1;
    state.conjStreak = 0;
  } else if (state.conjStreak <= -cfg.demoteStreak && q.level > 0) {
    state.conjLevel = q.level - 1;
    state.conjStreak = 0;
  }
  saveProgress();
}

function buildQuiz() {
  // A fixed variety template so every session shows the full range of
  // exercises; the vocabulary within each is random. Trimmed to the configured
  // question count.
  //
  // Two of the slots are conjugation drills: a warm-up early on, at some rung the
  // player already owns, and later the probe — the hardest rung they have
  // reached, and the only question that can move the ladder either way. The
  // warm-up sits inside the first eight slots so a trimmed session still drills
  // conjugation at all.
  const top = conjTopLevel();
  const warmUp = top > 0 ? Math.floor(Math.random() * top) : 0;
  const plan = [
    () => makeChoose("it2de"),
    () => makeMatch(),
    () => makeConj(warmUp),
    () => makeType("de2it"),
    () => makeFill("fill-choose"),
    () => makeArrange(),
    () => makeChoose("de2it"),
    () => makeConj(top),
    () => makeFill("fill-type"),
    () => makeType("it2de"),
  ];
  const n = Math.min(CONFIG.quizQuestionCount, plan.length);
  state.quizList = plan.slice(0, n).map((make) => make());
  state.quizIndex = 0;
  state.quizCorrect = 0;
  state.quizGoldEarned = 0;
  state.quizResults = [];
  resetQuizInput();
}

function resetQuizInput() {
  state.quizChecked = false;
  state.quizWasCorrect = false;
  state.quizRevealed = false;
  state.quizPicked = null;
  state.quizTyped = "";
  state.quizConj = [];
  state.quizConjFocus = null;
  state.quizBuilt = [];
  state.quizMatchSel = null;
  state.quizMatchDone = [];
  state.quizMatchWrong = null;
  state.quizMatchMisses = 0;
  state.quizWordMisses = [];
}

function goToQuiz() {
  buildQuiz();
  state.screen = "quiz";
  state._structuralDirty = true;
}

// Gold for one correct answer: the base payout lifted by the banked reward
// multiplier the player fought for (see creditKill), then by Fortune's coin
// nodes. The bank is NOT drained here — a correct answer spends nothing, so the
// whole session pays out at the same rate; finishing it is what cashes it in.
//
// A question may also carry its own stake (`goldMult`): the conjugation ladder
// pays more the more of the paradigm it makes you write, which is what makes
// climbing it worth the risk. Called without a question (the reward screen), it
// answers for a plain one.
function quizReward(q) {
  const stake = q && q.goldMult ? q.goldMult : 1;
  return Math.round(CONFIG.goldPerCorrect * stake * rewardMult() * (state.mods ? state.mods.coinMult : 1));
}

// Mark the current question checked and, if correct, pay out gold. Shared by
// every exercise type; `correct` is decided by that type's own handler.
function settleQuiz(correct) {
  if (state.quizChecked) return;
  state.quizChecked = true;
  state.quizWasCorrect = correct;
  state.quizResults[state.quizIndex] = correct ? "right" : "wrong";
  // Tally the vocabulary this question drilled before anything else — every
  // question resolves through here exactly once (see vocab-history.js).
  const q = state.quizList[state.quizIndex];
  recordQuizOutcome(q, correct);
  noteConjResult(q, correct);
  if (correct) {
    state.quizCorrect++;
    const reward = quizReward(q);
    state.gold += reward;
    state.quizGoldEarned += reward;
    saveProgress();
  }
  state.quizAnsweredAt = performance.now();
  state._structuralDirty = true;
}

// "I don't know" — reveal the solution in place, mark the question resolved but
// award no gold. Fills the answer into whatever surface the exercise uses so
// the learner sees the correct form before continuing.
function quizReveal() {
  if (state.quizChecked) return;
  const q = state.quizList[state.quizIndex];
  if (q.type === "match" || q.type === "conj-match") {
    state.quizMatchDone = q.pairs.map((p) => p.id);
    state.quizMatchSel = null;
  } else if (q.type === "arrange") {
    const built = [];
    for (const tok of q.answer) {
      const t = q.bank.find((b) => b.word === tok && !built.includes(b.id));
      if (t) built.push(t.id);
    }
    state.quizBuilt = built;
  } else if (q.type === "conj-table") {
    // The whole paradigm is written in, blanks and given rows alike, so the
    // learner reads it as one table rather than as their gaps.
    state.quizConj = q.forms.slice();
  } else if (q.type === "type" || q.type === "fill-type" || q.type === "conj-type") {
    state.quizTyped = q.answer;
  } else {
    state.quizPicked = null; // choose/fill-choose: highlight only the correct option
  }
  recordQuizOutcome(q, false); // a revealed solution is a word you didn't know
  noteConjResult(q, false);    // and a rung of the ladder you didn't clear
  state.quizResults[state.quizIndex] = "shown";
  state.quizRevealed = true;
  state.quizChecked = true;
  state.quizWasCorrect = false;
  state.quizAnsweredAt = performance.now();
  state._structuralDirty = true;
}

// --- answer normalization for the typed exercises ---------------------------
function foldAccents(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // strip combining accents
}
function normAnswer(s) {
  return foldAccents(String(s).toLowerCase())
    .replace(/['’.,!?;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const ARTICLE_TOKENS = new Set([
  "il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "l",
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer",
]);
// The set of typed strings we accept for a target: the full phrase, and the
// same phrase with a leading article dropped (so "milch" is fine for "die Milch").
function acceptedForms(target) {
  const norm = normAnswer(target);
  const forms = new Set([norm]);
  const toks = norm.split(" ");
  if (toks.length > 1 && ARTICLE_TOKENS.has(toks[0])) forms.add(toks.slice(1).join(" "));
  return forms;
}
function typedMatches(input, target) {
  return acceptedForms(target).has(normAnswer(input));
}

// --- exercise input handlers (called from inline on* attributes) ------------
function quizChoose(i) {
  if (state.quizChecked) return;
  const q = state.quizList[state.quizIndex];
  state.quizPicked = i;
  settleQuiz(q.options[i] === q.answer);
}

function quizTypeInput(el) { state.quizTyped = el.value; }
function quizCheckType() {
  if (state.quizChecked) return;
  const q = state.quizList[state.quizIndex];
  if (normAnswer(state.quizTyped) === "") return; // ignore empty submissions
  // A word can have more than one valid translation (`accept`); any counts.
  const accepted = q.accept && q.accept.length ? q.accept : [q.answer];
  settleQuiz(accepted.some((a) => typedMatches(state.quizTyped, a)));
}
// Fill-the-blank typing shares the exact same check as free typing, and so does
// writing a single conjugated form (its `accept` list carries the pronoun
// variants — see makeConj).
function quizFillCheckType() { quizCheckType(); }

// --- conjugation table ------------------------------------------------------
// Each blank row is its own field, mirrored into state.quizConj by person index
// so the table can be rebuilt at any moment without losing what's written. No
// re-render on a keystroke (the whole point — a rebuild mid-word would drop the
// phone's keyboard), so the last field written into is remembered and refocused
// if something else does force a rebuild.
function quizConjInput(el) {
  const i = Number(el.dataset.cell);
  if (!Number.isInteger(i)) return;
  if (!state.quizConj) state.quizConj = [];
  state.quizConj[i] = el.value;
  state.quizConjFocus = i;
}

function quizCheckConjTable() {
  if (state.quizChecked) return;
  const q = state.quizList[state.quizIndex];
  const typed = (i) => (state.quizConj && state.quizConj[i]) || "";
  // The paradigm is one answer, so it is checked as one: a half-filled table is
  // an unfinished submission, not a wrong one, and tapping Prüfen simply waits.
  if (q.blanks.some((i) => normAnswer(typed(i)) === "")) return;
  settleQuiz(q.blanks.every((i) => typedMatches(typed(i), q.forms[i])));
}

// Whether a single row of a settled table came out right — shared by the table
// renderer (per-row ✓/✕) and the feedback banner (how many of six).
function conjRowCorrect(q, i) {
  return typedMatches((state.quizConj && state.quizConj[i]) || "", q.forms[i]);
}

function quizMatchTap(col, idx) {
  if (state.quizChecked || state.quizMatchWrong) return;
  const q = state.quizList[state.quizIndex];
  const list = col === "left" ? q.left : q.right;
  const tile = list[idx];
  if (state.quizMatchDone.includes(tile.id)) return; // already solved
  const sel = state.quizMatchSel;
  if (!sel) { state.quizMatchSel = { col, idx }; state._structuralDirty = true; return; }
  if (sel.col === col) { state.quizMatchSel = { col, idx }; state._structuralDirty = true; return; } // re-arm same column
  const selTile = (sel.col === "left" ? q.left : q.right)[sel.idx];
  if (selTile.id === tile.id) {
    // correct pair
    state.quizMatchDone.push(tile.id);
    state.quizMatchSel = null;
    if (state.quizMatchDone.length === q.pairs.length) settleQuiz(true);
  } else {
    // wrong pair — flash both red briefly, then clear
    state.quizMatchMisses++;
    // Both words the player just confused are marked, so the board still blames
    // them once it settles (which it does as "correct" if the rest works out).
    const pairOf = (t) => q.pairs.find((p) => p.id === t.id);
    for (const t of [selTile, tile]) {
      const p = pairOf(t);
      if (p) noteQuizWordMiss(p.wid);
    }
    const left = sel.col === "left" ? sel : { col, idx };
    const right = sel.col === "right" ? sel : { col, idx };
    state.quizMatchWrong = { left: left.idx, right: right.idx };
    state.quizMatchSel = null;
    setTimeout(() => { state.quizMatchWrong = null; state._structuralDirty = true; }, CONFIG.quizFeedbackMs);
  }
  state._structuralDirty = true;
}

function quizArrangeAdd(bankId) {
  if (state.quizChecked || state.quizBuilt.includes(bankId)) return;
  state.quizBuilt.push(bankId);
  state._structuralDirty = true;
}
function quizArrangeRemove(pos) {
  if (state.quizChecked) return;
  state.quizBuilt.splice(pos, 1);
  state._structuralDirty = true;
}
function quizCheckArrange() {
  if (state.quizChecked) return;
  const q = state.quizList[state.quizIndex];
  if (state.quizBuilt.length === 0) return;
  const byId = Object.fromEntries(q.bank.map((t) => [t.id, t.word]));
  const built = state.quizBuilt.map((id) => byId[id]).join(" ");
  settleQuiz(normAnswer(built) === normAnswer(q.answer.join(" ")));
}

function advanceQuiz() {
  resetQuizInput();
  state.quizIndex++;
  if (state.quizIndex >= state.quizList.length) {
    // A FULL session is what cashes the reward bank in. Walking away halfway
    // leaves it standing, so the multiplier is never lost by getting
    // interrupted — only by seeing the round through, which is the point.
    state.rewardKills = 0;
    saveProgress();
    state.screen = "upgrade";
  }
  state._structuralDirty = true;
}

window.Incanto.quiz = { buildQuiz, goToQuiz, advanceQuiz, quizChoose, quizTypeInput, quizCheckType, quizFillCheckType, quizMatchTap, quizArrangeAdd, quizArrangeRemove, quizCheckArrange, quizReveal, quizConjInput, quizCheckConjTable, conjRowCorrect, conjLevels, conjTopLevel, makeConj, makeFill, makeArrange };
