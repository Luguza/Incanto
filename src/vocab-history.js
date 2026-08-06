"use strict";
// ==============================================================================
// vocab-history.js — the learning history. Owns: the per-word tally store
// (`state.vocab` + its localStorage save), the record* hooks the quiz and the
// rune circle call, the recent-struggle weighting drawLoadout draws its review
// words from, and renderHistoryFull (the "Lernverlauf" screen).
// ==============================================================================
//
// Every word the player meets is tallied twice over: how often it showed up and
// how it went, kept separately for the two places vocabulary is practised — the
// post-death quiz and the rune circle in combat. On top of the lifetime totals
// each word keeps small per-day buckets (seen / wrong), which is what makes
// "struggled with lately" answerable: only the last CONFIG.vocab.recentDays of
// them count toward the review weighting, so today's fumbles resurface and last
// month's are forgiven.
//
// A word's identity is its it/de text, never its WORD_POOL index — indices shift
// the moment vocabulary is added to content.js, and a save must survive that.
// ---------------------------------------------------------------------------

const VOCAB_SAVE_KEY = "incanto.vocab.v1";

function vocabKey(pair) { return pair.it + "|" + pair.de; }

// Local calendar day, so "the last 3 days" means what the player's clock says.
function vocabDayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Today plus the previous n-1 days, as bucket keys.
function recentDayKeys(days) {
  const out = [];
  const now = Date.now();
  for (let i = 0; i < days; i++) out.push(vocabDayKey(now - i * 86400000));
  return out;
}

function freshVocabEntry(pair) {
  return {
    it: pair.it, de: pair.de,
    quizSeen: 0, quizCorrect: 0, quizWrong: 0,   // post-death quiz questions
    runeSeen: 0, runeCorrect: 0, runeWrong: 0,   // rune-circle pairings
    lastSeenAt: 0,
    days: {},                                     // "YYYY-MM-DD" -> {seen, right, wrong}
  };
}

// The tally for a word, created on first sight. `ref` is a WORD_POOL index or a
// {it, de} pair.
function vocabEntry(ref) {
  const pair = typeof ref === "number" ? WORD_POOL[ref] : ref;
  if (!pair || !pair.it || !pair.de) return null;
  if (!state.vocab) state.vocab = {};
  const k = vocabKey(pair);
  return state.vocab[k] || (state.vocab[k] = freshVocabEntry(pair));
}

// Bump today's bucket and drop any that have aged out of the keep window, so a
// long-played save doesn't grow a bucket per word per day forever.
function bumpVocabDay(entry, field, n = 1) {
  const key = vocabDayKey(Date.now());
  const bucket = entry.days[key] || (entry.days[key] = { seen: 0, right: 0, wrong: 0 });
  bucket[field] += n;
  const keys = Object.keys(entry.days);
  if (keys.length > CONFIG.vocab.keepDays) {
    keys.sort();
    for (const old of keys.slice(0, keys.length - CONFIG.vocab.keepDays)) delete entry.days[old];
  }
}

// ---------------------------------------------------------------------------
// Recording hooks — called from the two places vocabulary is practised
// ---------------------------------------------------------------------------

// The circle was just dealt these pairs. Every word on the board counts as seen
// once, whether or not the player gets round to it before the board re-deals —
// what "seen" means here is "shown to you".
function recordRuneSeen(pairs) {
  const now = Date.now();
  for (const p of pairs) {
    const e = vocabEntry(p);
    if (!e) continue;
    e.runeSeen++;
    e.lastSeenAt = now;
    bumpVocabDay(e, "seen");
  }
  saveVocabHistory();
}

// A pairing was resolved in the circle. A correct link credits the one word it
// joined; a wrong link is a mistake for BOTH words the player confused, since
// either half could be the one they don't actually know.
function recordRuneMatch(refs, correct) {
  const seen = new Set();
  for (const ref of refs) {
    const e = vocabEntry(ref);
    if (!e || seen.has(e)) continue;
    seen.add(e);
    if (correct) { e.runeCorrect++; bumpVocabDay(e, "right"); }
    else { e.runeWrong++; bumpVocabDay(e, "wrong"); }
    e.lastSeenAt = Date.now();
  }
  saveVocabHistory();
}

// A quiz question resolved. `q.words` lists the WORD_POOL indices the question
// actually drilled (see quiz.js); `state.quizWordMisses` narrows the blame on a
// match board, which settles as correct overall even when single pairs were
// mis-tapped on the way there.
function recordQuizOutcome(q, correct) {
  if (!q || !q.words || !q.words.length) return;   // sentence exercises with no vocab of their own
  const missed = new Set(state.quizWordMisses || []);
  const now = Date.now();
  for (const idx of q.words) {
    const e = vocabEntry(idx);
    if (!e) continue;
    e.quizSeen++;
    e.lastSeenAt = now;
    bumpVocabDay(e, "seen");
    if (correct && !missed.has(idx)) { e.quizCorrect++; bumpVocabDay(e, "right"); }
    else { e.quizWrong++; bumpVocabDay(e, "wrong"); }
  }
  saveVocabHistory();
}

// A single wrong tap on the match board — remembered so the pairs involved are
// still blamed once the board is finished (or revealed).
function noteQuizWordMiss(idx) {
  if (idx === undefined || idx === null || idx < 0) return;
  if (!state.quizWordMisses) state.quizWordMisses = [];
  if (!state.quizWordMisses.includes(idx)) state.quizWordMisses.push(idx);
}

// ---------------------------------------------------------------------------
// Recent struggle — what the rune circle uses to resurface hard words
// ---------------------------------------------------------------------------
function vocabRecent(entry, days) {
  let seen = 0, right = 0, wrong = 0;
  for (const k of recentDayKeys(days || CONFIG.vocab.recentDays)) {
    const b = entry.days[k];
    if (b) { seen += b.seen; right += b.right || 0; wrong += b.wrong; }
  }
  return { seen, right, wrong };
}

// How badly a word is going lately: mistake COUNT scaled by mistake RATE, so a
// word missed twice out of three sightings outranks one missed twice out of
// twenty. Correct answers inside the same window pay the count back down (see
// CONFIG.vocab.recoveryCredit), so relearning a word visibly retires it from
// the review pool instead of leaving it boosted until its mistakes age out.
// Zero for anything the player isn't currently behind on.
function vocabStruggleScore(entry) {
  const { seen, right, wrong } = vocabRecent(entry);
  if (wrong <= 0) return 0;
  const net = wrong - CONFIG.vocab.recoveryCredit * right;
  if (net <= 0) return 0;
  return net * (0.5 + wrong / Math.max(wrong, seen));
}

// The review pool: every recently-fumbled word, with the weight it is drawn at.
// Returned as WORD_POOL indices because that is what a loadout is made of.
function struggleDrawPool() {
  const pool = [];
  if (!state.vocab) return pool;
  for (let i = 0; i < WORD_POOL.length; i++) {
    const e = state.vocab[vocabKey(WORD_POOL[i])];
    if (!e) continue;
    const score = vocabStruggleScore(e);
    if (score <= 0) continue;
    pool.push({ idx: i, weight: Math.min(CONFIG.vocab.weightCap, 1 + CONFIG.vocab.mistakeWeight * score) });
  }
  return pool;
}

// Weighted random pick over [{idx, weight}] — returns -1 for an empty pool.
function weightedPickIndex(pool) {
  let total = 0;
  for (const e of pool) total += e.weight;
  if (total <= 0) return -1;
  let r = Math.random() * total;
  for (const e of pool) { r -= e.weight; if (r <= 0) return e.idx; }
  return pool[pool.length - 1].idx;
}

// ---------------------------------------------------------------------------
// Persistence — its own save key, separate from the meta-progression save, so
// the learning record isn't entangled with gold and skill ranks.
// ---------------------------------------------------------------------------
let vocabSaveTimer = null;

function writeVocabHistory() {
  vocabSaveTimer = null;
  try {
    localStorage.setItem(VOCAB_SAVE_KEY, JSON.stringify({ words: state.vocab || {} }));
  } catch (e) { /* storage unavailable (private mode/quota) — play without saving */ }
}

// Matches land in bursts (a whole board resolves in a few seconds), so writes
// are coalesced rather than run once per tally.
function saveVocabHistory() {
  if (vocabSaveTimer !== null) return;
  vocabSaveTimer = setTimeout(writeVocabHistory, 400);
}

// Read the store back, keeping only fields of the expected shape — a hand-edited
// or half-written save must not be able to poison the counters.
function loadVocabHistory() {
  const num = (v) => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  try {
    const raw = localStorage.getItem(VOCAB_SAVE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    const words = data && data.words;
    if (!words || typeof words !== "object") return {};
    const keep = new Set(recentDayKeys(CONFIG.vocab.keepDays));
    const out = {};
    for (const key in words) {
      const w = words[key];
      if (!w || typeof w !== "object" || !w.it || !w.de) continue;
      const e = freshVocabEntry(w);
      for (const f of ["quizSeen", "quizCorrect", "quizWrong", "runeSeen", "runeCorrect", "runeWrong"]) e[f] = num(w[f]);
      e.lastSeenAt = num(w.lastSeenAt);
      if (w.days && typeof w.days === "object") {
        for (const d in w.days) {
          if (!keep.has(d)) continue;   // aged out — drop it on the way in
          e.days[d] = { seen: num(w.days[d].seen), right: num(w.days[d].right), wrong: num(w.days[d].wrong) };
        }
      }
      out[key] = e;
    }
    return out;
  } catch (e) { return {}; }
}

function clearVocabHistory() {
  if (state) state.vocab = {};
  try { localStorage.removeItem(VOCAB_SAVE_KEY); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// The Lernverlauf screen — one row per word in the pool, filtered and ranked
// ---------------------------------------------------------------------------
const HISTORY_FILTERS = [
  { id: "struggling", label: "Schwierig" },  // recently fumbled — the ones the circle is boosting
  { id: "seen", label: "Gesehen" },          // met at least once, anywhere
  { id: "new", label: "Neu" },               // the rest of the pool, not met yet
  { id: "all", label: "Alle" },
];

// One row per word, carrying both the lifetime totals and the recent window.
// `seen` counts appearances (a rune word can be shown without being resolved),
// while accuracy is measured over resolved attempts only.
function vocabHistoryRows(filter) {
  const rows = WORD_POOL.map((pair, idx) => {
    const e = (state.vocab && state.vocab[vocabKey(pair)]) || null;
    const quizSeen = e ? e.quizSeen : 0, runeSeen = e ? e.runeSeen : 0;
    const quizWrong = e ? e.quizWrong : 0, runeWrong = e ? e.runeWrong : 0;
    const correct = e ? e.quizCorrect + e.runeCorrect : 0;
    const wrong = quizWrong + runeWrong;
    const recent = e ? vocabRecent(e) : { seen: 0, wrong: 0 };
    return {
      idx, it: pair.it, de: pair.de,
      seen: quizSeen + runeSeen, quizSeen, runeSeen,
      quizCorrect: e ? e.quizCorrect : 0, runeCorrect: e ? e.runeCorrect : 0,
      quizWrong, runeWrong, correct, wrong,
      accuracy: correct + wrong > 0 ? correct / (correct + wrong) : null,
      recentWrong: recent.wrong,
      score: e ? vocabStruggleScore(e) : 0,
      lastSeenAt: e ? e.lastSeenAt : 0,
    };
  });
  const kept = rows.filter((r) => {
    if (filter === "struggling") return r.score > 0;
    if (filter === "seen") return r.seen > 0;
    if (filter === "new") return r.seen === 0;
    return true;
  });
  // Hardest first, then most-practised, then pool order — so the list opens on
  // exactly the words the next circle is most likely to deal.
  if (filter !== "new") {
    kept.sort((a, b) => b.score - a.score || b.wrong - a.wrong || b.seen - a.seen || a.idx - b.idx);
  }
  return kept;
}

function historyFilter() {
  return state.historyFilter || "seen";
}

function openHistory() {
  if (!state) return;
  state.screen = "history";
  state._structuralDirty = true;
}

// Back out of the history into the study phase proper: resume a half-finished
// quiz, or start a fresh one (the same rule navTo("study") follows).
function closeHistory() {
  if (!state) return;
  const quizInProgress = state.quizList.length > 0 && state.quizIndex < state.quizList.length;
  if (quizInProgress) {
    state.screen = "quiz";
    state._structuralDirty = true;
  } else {
    goToQuiz();
  }
}

function setHistoryFilter(id) {
  state.historyFilter = id;
  state._structuralDirty = true;
}

function historyPct(x) { return Math.round(x * 100) + "%"; }

function historyAgo(t) {
  if (!t) return "";
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return "heute";
  if (days === 1) return "gestern";
  return `vor ${days} Tagen`;
}

// One practice source as a compact "richtig von Versuchen" ratio. The long form
// ("3 richtig, 2 falsch · 5× gezeigt", twice per row) buried the two numbers
// that matter under punctuation; the full wording survives in the tooltip.
function historySource(label, seen, right, wrong) {
  if (seen === 0) return "";
  const tries = right + wrong;
  const ratio = tries === 0 ? "—" : `${right}/${tries}`;
  const title = `${label}: ${right} richtig, ${wrong} falsch, ${seen}× gezeigt`;
  return `<span class="hist-stat" title="${title}">${label} <b${wrong > right ? ' class="bad"' : ""}>${ratio}</b></span>`;
}

function renderHistoryRow(r) {
  const boosted = r.score > 0;
  const acc = r.accuracy === null ? "—" : historyPct(r.accuracy);
  const accCls = r.accuracy === null ? "none" : r.accuracy >= 0.8 ? "good" : r.accuracy >= 0.5 ? "mid" : "bad";
  // The track is always drawn so every row is the same height; only a word with
  // resolved attempts gets a fill.
  const bar = `<div class="hist-bar">${r.accuracy === null ? "" :
    `<div class="hist-bar-fill ${accCls}" style="width:${(r.accuracy * 100).toFixed(0)}%"></div>`}</div>`;
  // Appearances and attempts are different numbers — a rune can be dealt onto a
  // board the player never gets round to pairing — so the row states both
  // rather than folding them into one misleading ratio.
  const detail = r.seen === 0
    ? `<span class="hist-stat dim">noch nicht begegnet</span>`
    : [
        historySource("Quiz", r.quizSeen, r.quizCorrect, r.quizWrong),
        historySource("Kreis", r.runeSeen, r.runeCorrect, r.runeWrong),
        `<span class="hist-stat dim">${r.seen}× gezeigt</span>`,
        r.lastSeenAt ? `<span class="hist-stat dim">${historyAgo(r.lastSeenAt)}</span>` : "",
      ].filter(Boolean).join("");
  const badge = boosted
    ? `<span class="hist-badge" title="${r.recentWrong} Fehler in den letzten ${CONFIG.vocab.recentDays} Tagen, kommt darum öfter in den Runenkreis">⟳ ${r.recentWrong}</span>`
    : "";
  return `
    <div class="hist-row${boosted ? " boosted" : ""}">
      <div class="hist-head">
        <span class="hist-it">${r.it}</span>
        <span class="hist-de">${r.de}</span>
        ${badge}
        <span class="hist-acc ${accCls}">${acc}</span>
      </div>
      ${bar}
      <div class="hist-detail">${detail}</div>
    </div>`;
}

function renderHistoryFull() {
  const filter = historyFilter();
  const rows = vocabHistoryRows(filter);
  const all = vocabHistoryRows("all");
  const seen = all.filter((r) => r.seen > 0);
  const struggling = all.filter((r) => r.score > 0);
  const correct = seen.reduce((s, r) => s + r.correct, 0);
  const wrong = seen.reduce((s, r) => s + r.wrong, 0);
  const attempts = correct + wrong;
  const acc = attempts > 0 ? historyPct(correct / attempts) : "—";
  const coverage = Math.round((seen.length / WORD_POOL.length) * 100);

  const tabs = HISTORY_FILTERS.map((f) => {
    const n = f.id === "all" ? all.length
      : f.id === "seen" ? seen.length
      : f.id === "struggling" ? struggling.length
      : all.length - seen.length;
    return `<button class="hist-tab${f.id === filter ? " active" : ""}" role="tab" aria-selected="${f.id === filter}"
      data-act="setHistoryFilter" data-args='["${f.id}"]'>${f.label} <span class="hist-tab-n">${n}</span></button>`;
  }).join("");

  const list = rows.length
    ? rows.map(renderHistoryRow).join("")
    : `<div class="hist-empty">
         <div class="hist-empty-mark">◈</div>
         <p>Noch nichts zu sehen. Übe im Quiz oder im Runenkreis.</p>
       </div>`;
  // The ⟳ legend is only worth its line when a badge is actually on screen.
  const legend = rows.some((r) => r.score > 0)
    ? `<p class="hist-legend"><span class="hist-badge">⟳</span> zuletzt verwechselt, kommt öfter in den Kreis</p>`
    : "";

  app.innerHTML = `
    <div class="screen history-screen">
      <div class="frame hist-frame">
        <header class="hist-header">
          <div class="hist-top">
            <button class="ghost-btn hist-back" data-act="closeHistory" aria-label="Zurück zum Quiz">←</button>
            <h1 class="hist-title">Lernverlauf</h1>
            <span class="hist-top-pad" aria-hidden="true"></span>
          </div>
          <div class="hist-summary">
            <div class="hist-sum">
              <b>${seen.length}</b><span>von ${WORD_POOL.length} gesehen</span>
              <div class="hist-sum-bar"><div class="hist-sum-fill" style="width:${coverage}%"></div></div>
            </div>
            <div class="hist-sum"><b class="${attempts ? "" : "none"}">${acc}</b><span>richtig${attempts ? ` · ${correct}/${attempts}` : ""}</span></div>
            <div class="hist-sum"><b class="${struggling.length ? "warn" : ""}">${struggling.length}</b><span>schwierig · ${CONFIG.vocab.recentDays} Tage</span></div>
          </div>
          <div class="hist-tabs" role="tablist">${tabs}</div>
          ${legend}
        </header>
        <div class="hist-list scroll-y">${list}</div>
      </div>
    </div>`;
}

window.Incanto.vocabHistory = {
  vocabKey, vocabEntry, vocabRecent, vocabStruggleScore, struggleDrawPool, weightedPickIndex,
  recordRuneSeen, recordRuneMatch, recordQuizOutcome, noteQuizWordMiss,
  loadVocabHistory, saveVocabHistory, clearVocabHistory, vocabHistoryRows,
  renderHistoryFull, openHistory, closeHistory, setHistoryFilter,
};
