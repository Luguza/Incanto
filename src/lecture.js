"use strict";
// ==============================================================================
// lecture.js — the grammar half of the study phase. Owns: the study hub, the
// lecture list, the drill builder, the explain-page renderer, the gem payout
// and the lecture record. The curriculum itself is data — see grammar.js.
// ==============================================================================
//
// A LECTURE RUNS ON THE QUIZ'S OWN SCREEN, and that is the whole reason this
// file is small. The quiz's body renderers turned out to be topic-agnostic:
// renderOptions, renderMatchBody, renderSentence, renderArrangeBody and
// renderConjTableBody read the question object in front of them and nothing
// else — none of them has ever heard of WORD_POOL. And the two learning-history
// hooks bow out of a question that carries no vocabulary of its own
// (recordQuizOutcome returns on an empty `words`, noteConjResult on an
// undefined `level`).
//
// So a grammar drill is an ordinary question object, a lecture is a list of
// them, and there is no second exercise engine in this game. What this file
// adds is the two things a lecture has that a quiz question doesn't: a PAGE to
// read first (type "explain", another step in the same list) and a payout in
// gems rather than gold.
//
// Why the drills are authored as compact specs and expanded here: the question
// objects the renderers want carry bookkeeping — a token array with the index of
// its blank, bank tiles with stable ids, a pairs list mirrored into two shuffled
// columns. Hand-writing that a few hundred times over is how one wrong index
// becomes a blank screen for one drill in one lecture that nobody opens for a
// month. The spec says what is being asked; the contract is written once, here.
// ---------------------------------------------------------------------------

function lectureById(id) { return GRAMMAR_LECTURES.find((l) => l.id === id) || null; }
function lecturesOfUnit(unitId) { return GRAMMAR_LECTURES.filter((l) => l.unit === unitId); }

// What the save knows about one lecture. Never creates the entry — asking about
// a lecture is not the same as having sat it.
function lectureRecord(id) {
  return (state.lectures && state.lectures[id]) || null;
}
function lecturePassedCount() {
  return GRAMMAR_LECTURES.filter((l) => { const r = lectureRecord(l.id); return r && r.passed; }).length;
}

// ---------------------------------------------------------------------------
// Building a session: the pages, then the drills, in the order they are written.
// The drills are NOT shuffled — a lecture's drills are authored to climb, from
// recognising a form to producing one, and dealing them at random would flatten
// the one bit of pedagogy the order carries. What is shuffled is what sits
// INSIDE a drill: the options, the two columns of a board, the word bank.
// ---------------------------------------------------------------------------

// A prompt line, with `___` in the authored text drawn as the same blank slot
// the fill-the-gap exercises use, so a question about a missing article looks
// like the missing article it is about.
function drillSlot(s) {
  return String(s).replace(/_{2,}/g, `<span class="blank">&nbsp;</span>`);
}
function drillPrompt(spec) {
  const q = spec.q ? drillSlot(spec.q) : "";
  const w = spec.word ? `${q ? " " : ""}<span class="quiz-word">${drillSlot(spec.word)}</span>` : "";
  return (q || w ? `<p class="quiz-prompt">${q}${w}</p>` : "")
    + (spec.note ? `<p class="quiz-hint">${spec.note}</p>` : "");
}

// One spec → one question object of a type the quiz already renders. Every
// field the renderers and checkers read is set HERE and nowhere else.
function buildDrill(spec) {
  const base = { title: spec.title, grammar: true };
  switch (spec.k) {
    case "pick":
      return Object.assign(base, {
        type: "choose", promptHtml: drillPrompt(spec),
        answer: spec.a, options: shuffleArray([spec.a, ...spec.d]),
      });
    case "write":
      return Object.assign(base, {
        type: "type", promptHtml: drillPrompt(spec), answer: spec.a,
        accept: [spec.a, ...(spec.accept || [])], strict: !!spec.strict,
      });
    case "pair": {
      const pairs = spec.pairs.map(([l, r], i) => ({ id: i, it: l, de: r }));
      return Object.assign(base, {
        type: "match", pairs,
        leftLabel: spec.leftLabel, rightLabel: spec.rightLabel,
        left: shuffleArray(pairs.map((p) => ({ id: p.id, word: p.it }))),
        right: shuffleArray(pairs.map((p) => ({ id: p.id, word: p.de }))),
      });
    }
    case "gap": {
      const tokens = spec.it.split(" ");
      return Object.assign(base, {
        type: spec.d ? "fill-choose" : "fill-type",
        tokens, blankIdx: tokens.indexOf(spec.a),
        answer: spec.a, de: spec.de,
        accept: [spec.a], strict: true,
        options: spec.d ? shuffleArray([spec.a, ...spec.d]) : undefined,
      });
    }
    case "build": {
      const answer = spec.it.split(" ");
      return Object.assign(base, {
        type: "arrange", answer, de: spec.de,
        bank: shuffleArray([...answer, ...(spec.extra || [])].map((word, i) => ({ id: i, word }))),
      });
    }
    case "para": {
      const v = spec.verb;
      const forms = v.forms || conjugateRegular(v.it, v.group);
      const rows = CONJ_PERSONS.map((_, i) => i);
      // `blanks` is which rows are asked for: a count (the first n, so a half
      // table always leaves the same worked examples standing rather than a
      // different three every time) or the whole paradigm.
      const blanks = Array.isArray(spec.blanks) ? spec.blanks.slice()
        : rows.slice(0, Math.min(spec.blanks || rows.length, rows.length));
      return Object.assign(base, {
        type: "conj-table", verb: { it: v.it, de: v.de, group: v.group },
        forms, blanks: blanks.sort((a, b) => a - b),
      });
    }
  }
  return null;
}

function buildLectureSession(lec) {
  const steps = lec.pages.map((page, i) => ({
    type: "explain", page, pageIndex: i, pageCount: lec.pages.length, grammar: true,
  }));
  for (const spec of lec.drills) {
    const q = buildDrill(spec);
    if (q) steps.push(q);
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Running one
// ---------------------------------------------------------------------------
function startLecture(id) {
  const lec = lectureById(id);
  if (!lec || !lec.drills || !lec.drills.length) return;
  state.quizMode = "grammar";
  state.quizLecture = lec.id;
  state.quizList = buildLectureSession(lec);
  state.quizIndex = 0;
  state.quizCorrect = 0;
  state.quizGoldEarned = 0;
  state.quizGemsEarned = 0;
  state.quizResults = [];
  state.lectureLast = null;
  resetQuizInput();
  state.screen = "quiz";
  state._structuralDirty = true;
}

function retryLecture() {
  if (state.lectureLast) startLecture(state.lectureLast.id);
}

// Walking out of a lecture part-way. Nothing is banked and nothing is lost —
// the gems already earned are already in the purse, because a correct answer
// pays on the spot (see settleQuiz). Only the first-clear bonus waits for the
// end, and a lecture left half-read has not been cleared.
function closeLecture() {
  state.quizMode = "vocab";
  state.quizLecture = null;
  state.quizList = [];
  state.quizIndex = 0;
  openLectures();
}

// What one right answer is worth. A lecture already cleared pays a fraction, so
// grinding the easiest one is never the best way to earn — but it still pays
// something, because re-reading a topic you got wrong is the point of having it
// on a shelf.
function lectureReward() {
  const g = CONFIG.grammar;
  const rec = lectureRecord(state.quizLecture);
  const mult = rec && rec.clears > 0 ? g.repeatFactor : 1;
  return Math.max(1, Math.round(g.gemsPerCorrect * mult));
}

// The end of a session: score it, bank the first-clear bonus if it was earned,
// and leave `lectureLast` for the done screen to read.
function recordLectureClear() {
  const lec = lectureById(state.quizLecture);
  if (!lec) return;
  let drills = 0, right = 0;
  state.quizList.forEach((q, i) => {
    if (q.type === "explain") return;
    drills++;
    if (state.quizResults[i] === "right") right++;
  });
  const score = drills ? right / drills : 0;
  const passed = score >= CONFIG.grammar.passScore;
  if (!state.lectures) state.lectures = {};
  const rec = state.lectures[lec.id] || (state.lectures[lec.id] = { clears: 0, passed: false, best: 0, lastAt: 0 });
  const firstPass = passed && !rec.passed;
  let bonus = 0;
  if (firstPass) {
    bonus = CONFIG.grammar.firstClearBonus;
    state.gems += bonus;
    rec.passed = true;
  }
  rec.clears++;
  rec.best = Math.max(rec.best || 0, score);
  rec.lastAt = Date.now();
  state.lectureLast = {
    id: lec.id, title: lec.title, right, drills, score, passed, firstPass,
    gems: state.quizGemsEarned + bonus, bonus,
  };
  state.quizMode = "vocab";
  state.quizLecture = null;
  state.quizList = [];
  state.quizIndex = 0;
  saveProgress();
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
function openStudyHub() {
  state.screen = "study";
  state._structuralDirty = true;
}
function openLectures() {
  state.screen = "lectures";
  state._structuralDirty = true;
}

function gemChip(n) { return `<span class="gem">◆</span> ${n}`; }
function lecturePct(x) { return Math.round(x * 100) + "%"; }

// The page a lecture is read from. Six kinds of block, and each one is a shape
// grammar explanation actually needs — including `bad`, the wrong form struck
// through beside the right one, which is how every grammar book alive corrects
// the mistake it knows you are about to make.
const LECTURE_BLOCK = {
  p: (b) => `<p class="lec-p">${b.de}</p>`,
  rule: (b) => `<p class="lec-rule">${b.de}</p>`,
  ex: (b) => `<div class="lec-ex"><span class="lec-it">${b.it}</span><span class="lec-de">${b.de}</span>${
    b.note ? `<span class="lec-note">${b.note}</span>` : ""}</div>`,
  bad: (b) => `<div class="lec-bad"><span class="lec-wrong">${b.wrong}</span><span class="lec-arrow">→</span><span class="lec-right">${b.right}</span></div>`,
  list: (b) => `<ul class="lec-list">${b.items.map((x) => `<li>${x}</li>`).join("")}</ul>`,
  table: (b) => `<div class="lec-table-wrap"><table class="lec-table">
    <thead><tr>${b.head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${b.rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? "" : ' class="lec-th"'}>${c}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`,
};

function renderExplainBody(q) {
  const blocks = q.page.blocks.map((b) => (LECTURE_BLOCK[b.t] ? LECTURE_BLOCK[b.t](b) : "")).join("");
  return `<div class="lec-page">${blocks}</div>`;
}

// The hub. The study phase has two doors now, and they are different kinds of
// thing: the quiz is a mixed session out of the whole vocabulary and is where
// the banked fight multiplier is spent, the lectures are one topic taught and
// then drilled. Saying that on the doors is cheaper than having the player find
// out by opening one.
function renderStudyHubFull() {
  const mult = rewardMult();
  const multChip = mult > 1
    ? `<span class="quiz-mult" title="Belohnungs-Multiplikator aus ${state.rewardKills} erlegten Skeletten">${fmtMult(mult)}</span>`
    : "";
  const done = lecturePassedCount();
  const total = GRAMMAR_LECTURES.filter((l) => l.drills && l.drills.length).length;
  app.innerHTML = `
    <div class="screen study-screen">
      <div class="frame study-frame">
        <header class="study-top">
          <h1 class="study-title">Bücherei</h1>
          <span class="study-purse">
            <span class="study-coin"><span class="coin">◈</span> ${state.gold}</span>
            <span class="study-gem">${gemChip(state.gems)}</span>
          </span>
        </header>
        <div class="study-doors scroll-y">
          <button class="study-door" data-act="goToQuiz">
            <span class="door-head"><span class="door-name">Vokabelquiz</span>${multChip}</span>
            <span class="door-blurb">Zehn gemischte Übungen quer durch den Wortschatz. Bezahlt Gold — und löst ein, was du dir im Gang erkämpft hast.</span>
            <span class="door-foot"><span class="coin">◈</span> ${CONFIG.goldPerCorrect} pro richtiger Antwort</span>
          </button>
          <button class="study-door" data-act="openLectures">
            <span class="door-head"><span class="door-name">Grammatik</span></span>
            <span class="door-blurb">Ein Thema erklärt, dann geübt: Artikel, Mehrzahl, Konjugation. Bezahlt Edelsteine.</span>
            <span class="door-foot">${gemChip(CONFIG.grammar.gemsPerCorrect)} pro richtiger Antwort &middot; ${done} von ${total} Lektionen bestanden</span>
          </button>
          <button class="ghost-btn study-history" data-act="openHistory">Lernverlauf ansehen</button>
        </div>
      </div>
    </div>`;
}

// The shelf. Every unit is listed, including the ones with nothing on them yet
// — the road ahead is part of what a curriculum screen is for, and a unit that
// simply isn't mentioned reads as a curriculum that stops there.
function renderLectureRow(lec) {
  const rec = lectureRecord(lec.id);
  const mark = rec && rec.passed
    ? `<span class="lec-mark pass" title="bestanden">✓</span>`
    : rec ? `<span class="lec-mark tried" title="schon versucht">◦</span>`
    : `<span class="lec-mark"></span>`;
  const best = rec && rec.clears
    ? `<span class="lec-best${rec.passed ? " pass" : ""}">${lecturePct(rec.best)}</span>`
    : `<span class="lec-best none">—</span>`;
  return `
    <button class="lec-row" data-act="startLecture" data-args='["${lec.id}"]'>
      ${mark}
      <span class="lec-row-text">
        <span class="lec-row-title">${lec.title}</span>
        <span class="lec-row-sub">${lec.subtitle}</span>
      </span>
      ${best}
    </button>`;
}

function renderLectureListFull() {
  const sections = GRAMMAR_UNITS.map((u) => {
    const lecs = lecturesOfUnit(u.id).filter((l) => l.drills && l.drills.length);
    const body = lecs.length
      ? lecs.map(renderLectureRow).join("")
      : `<p class="lec-soon">kommt noch</p>`;
    return `<section class="lec-unit${lecs.length ? "" : " empty"}">
      <h2 class="lec-unit-title">${u.title}</h2>
      <p class="lec-unit-blurb">${u.blurb}</p>
      ${body}
    </section>`;
  }).join("");
  app.innerHTML = `
    <div class="screen lectures-screen">
      <div class="frame lec-frame">
        <header class="lec-top">
          <button class="ghost-btn lec-back" data-act="openStudyHub" aria-label="Zurück zur Bücherei">←</button>
          <h1 class="lec-title">Grammatik</h1>
          <span class="lec-purse">${gemChip(state.gems)}</span>
        </header>
        <div class="lec-list scroll-y">${sections}</div>
      </div>
    </div>`;
}

function renderLectureDoneFull() {
  const r = state.lectureLast;
  if (!r) { openLectures(); return; }
  const verdict = r.passed
    ? `<p class="done-verdict pass">Bestanden</p>`
    : `<p class="done-verdict fail">Noch nicht bestanden — ${lecturePct(CONFIG.grammar.passScore)} reichen</p>`;
  const bonus = r.bonus
    ? `<p class="done-bonus">Erstmals bestanden: ${gemChip(r.bonus)} obendrauf</p>`
    : "";
  app.innerHTML = `
    <div class="screen lecdone-screen">
      <div class="frame lecdone-frame">
        <div class="lecdone-body scroll-y">
          <p class="done-kicker">Lektion beendet</p>
          <h1 class="done-title">${r.title}</h1>
          ${verdict}
          <p class="done-score"><b>${r.right}</b> von ${r.drills} Übungen richtig</p>
          <p class="done-gems">${gemChip(r.gems)} verdient</p>
          ${bonus}
          <p class="done-note">Edelsteine sammeln sich an. Ausrüstung, die sie kostet, gibt es noch nicht — sie wartet auf dich.</p>
        </div>
        <footer class="lecdone-foot">
          <button class="ghost-btn done-retry" data-act="retryLecture">Nochmal</button>
          <button class="btn-primary arcane" data-act="openLectures">Zurück zur Liste →</button>
        </footer>
      </div>
    </div>`;
}

window.Incanto.lecture = {
  lectureById, lecturesOfUnit, lectureRecord, lecturePassedCount,
  buildDrill, buildLectureSession, startLecture, retryLecture, closeLecture,
  lectureReward, recordLectureClear, renderExplainBody,
  openStudyHub, openLectures, renderStudyHubFull, renderLectureListFull, renderLectureDoneFull,
};
