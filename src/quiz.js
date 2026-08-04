"use strict";
// ==============================================================================
// quiz.js — post-death vocab quiz logic. Owns: question builders, buildQuiz,
// answer checking/normalization, and the inline exercise handlers (quizChoose,
// quizMatchTap, quizArrange*, quizTypeInput, quizCheck*, quizReveal, advanceQuiz).
// ==============================================================================

// ---------------------------------------------------------------------------
// Post-death vocab quiz — the only source of currency
// ---------------------------------------------------------------------------
// The quiz is a mixed session of Duolingo-style exercises (everything but the
// audio/speech ones): multiple-choice translation both ways, typed translation
// both ways, tap-to-match pairs, fill-the-blank by word bank or by typing, and
// build-the-sentence from a word bank. Each entry in quizList is a self-
// contained question object carrying everything its renderer + checker need.
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
  const s = sampleN(SENTENCE_POOL, 1)[0];
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
  const s = sampleN(SENTENCE_POOL, 1)[0];
  const answer = s.it.split(" ");
  const distractors = sampleN(SENTENCE_WORDS, 2, (w) => !answer.includes(w));
  // Bank tiles are shuffled; each carries the token plus a stable tile id so a
  // repeated word (e.g. two "il") stays individually addressable.
  const bank = shuffleArray([...answer, ...distractors].map((word, i) => ({ id: i, word })));
  // No `words`: word order is what's being drilled here, not any one vocable, so
  // the learning history stays out of it.
  return { type: "arrange", answer, de: s.de, bank };
}

function buildQuiz() {
  // A fixed variety template so every session shows the full range of
  // exercises; the vocabulary within each is random. Trimmed to the configured
  // question count.
  const plan = [
    () => makeChoose("it2de"),
    () => makeMatch(),
    () => makeType("de2it"),
    () => makeFill("fill-choose"),
    () => makeArrange(),
    () => makeChoose("de2it"),
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
function quizReward() {
  return Math.round(CONFIG.goldPerCorrect * rewardMult() * (state.mods ? state.mods.coinMult : 1));
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
  recordQuizOutcome(state.quizList[state.quizIndex], correct);
  if (correct) {
    state.quizCorrect++;
    const reward = quizReward();
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
  if (q.type === "match") {
    state.quizMatchDone = q.pairs.map((p) => p.id);
    state.quizMatchSel = null;
  } else if (q.type === "arrange") {
    const built = [];
    for (const tok of q.answer) {
      const t = q.bank.find((b) => b.word === tok && !built.includes(b.id));
      if (t) built.push(t.id);
    }
    state.quizBuilt = built;
  } else if (q.type === "type" || q.type === "fill-type") {
    state.quizTyped = q.answer;
  } else {
    state.quizPicked = null; // choose/fill-choose: highlight only the correct option
  }
  recordQuizOutcome(q, false); // a revealed solution is a word you didn't know
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
// Fill-the-blank typing shares the exact same check as free typing.
function quizFillCheckType() { quizCheckType(); }

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

window.Incanto.quiz = { buildQuiz, goToQuiz, advanceQuiz, quizChoose, quizTypeInput, quizCheckType, quizFillCheckType, quizMatchTap, quizArrangeAdd, quizArrangeRemove, quizCheckArrange, quizReveal };
