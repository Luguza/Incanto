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

// --- per-type question builders ---------------------------------------------
function makeChoose(dir) {
  // dir: "it2de" (show Italian, pick German) or "de2it" (show German, pick Italian)
  const pair = sampleN(WORD_POOL, 1)[0];
  const promptKey = dir === "it2de" ? "it" : "de";
  const answerKey = dir === "it2de" ? "de" : "it";
  const answer = pair[answerKey];
  const distractors = sampleN(WORD_POOL, CONFIG.quizOptionCount - 1, (p) => p[answerKey] !== answer)
    .map((p) => p[answerKey]);
  return { type: "choose", dir, prompt: pair[promptKey], answer, options: shuffleArray([answer, ...distractors]) };
}

function makeType(dir) {
  const pair = sampleN(WORD_POOL, 1)[0];
  const promptKey = dir === "it2de" ? "it" : "de";
  const answerKey = dir === "it2de" ? "de" : "it";
  return { type: "type", dir, prompt: pair[promptKey], answer: pair[answerKey] };
}

function makeMatch() {
  const n = CONFIG.quizMatchPairs;
  const pairs = sampleN(WORD_POOL, n).map((p, i) => ({ id: i, it: p.it, de: p.de }));
  return {
    type: "match",
    pairs,
    left: shuffleArray(pairs.map((p) => ({ id: p.id, word: p.it }))),
    right: shuffleArray(pairs.map((p) => ({ id: p.id, word: p.de }))),
  };
}

function makeFill(kind) {
  // kind: "fill-choose" (word bank) or "fill-type" (keyboard)
  const s = sampleN(SENTENCE_POOL, 1)[0];
  const tokens = s.it.split(" ");
  const blankIdx = tokens.indexOf(s.blank);
  const q = { type: kind, tokens, blankIdx, answer: s.blank, de: s.de, pos: s.pos };
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
}

function goToQuiz() {
  buildQuiz();
  state.screen = "quiz";
  state._structuralDirty = true;
}

function quizReward() {
  return CONFIG.goldPerCorrect + CONFIG.quizWaveBonus * (state.lastWaveReached - 1);
}

// Mark the current question checked and, if correct, pay out gold. Shared by
// every exercise type; `correct` is decided by that type's own handler.
function settleQuiz(correct) {
  if (state.quizChecked) return;
  state.quizChecked = true;
  state.quizWasCorrect = correct;
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
  settleQuiz(typedMatches(state.quizTyped, q.answer));
}

function quizFillCheckType() {
  if (state.quizChecked) return;
  const q = state.quizList[state.quizIndex];
  if (normAnswer(state.quizTyped) === "") return;
  settleQuiz(typedMatches(state.quizTyped, q.answer));
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
    state.screen = "upgrade";
  }
  state._structuralDirty = true;
}

window.Incanto.quiz = { buildQuiz, goToQuiz, advanceQuiz, quizChoose, quizTypeInput, quizCheckType, quizFillCheckType, quizMatchTap, quizArrangeAdd, quizArrangeRemove, quizCheckArrange, quizReveal };
