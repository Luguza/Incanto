"use strict";
// ==============================================================================
// screens.js — full-screen DOM renderers (innerHTML into #app). Owns:
// renderQuizFull + body renderers, renderCombatFull, patchCombatContinuous,
// renderEndFull. (The upgrade screen is the skill tree — see skilltree.js.)
// ==============================================================================


// The post-death vocab quiz — a mixed session of Duolingo-style exercises.
// One dispatcher builds a shared frame (progress + prompt + action bar) and
// hands the middle off to a per-type body renderer.
const QUIZ_TITLE = {
  choose: "Übersetzung wählen",
  type: "Übersetzung tippen",
  match: "Passende Paare finden",
  "fill-choose": "Lücke füllen",
  "fill-type": "Lücke füllen",
  arrange: "Satz bilden",
};

function quizDirLabel(dir) {
  return dir === "it2de" ? "Italienisch → Deutsch" : "Deutsch → Italienisch";
}

// The session at a glance: one cell per question, coloured once it settles.
// A learner can see how the round is going without counting, and the current
// question has an unambiguous position in it.
function renderQuizSteps() {
  const cells = state.quizList.map((_, i) => {
    const r = state.quizResults[i];
    const cls = r ? `qstep ${r}` : i === state.quizIndex ? "qstep now" : "qstep";
    return `<span class="${cls}"></span>`;
  }).join("");
  return `<div class="quiz-steps" role="progressbar" aria-label="Fortschritt"
    aria-valuemin="0" aria-valuemax="${state.quizList.length}" aria-valuenow="${state.quizIndex}">${cells}</div>`;
}

// The banked reward multiplier, shown where the learner can see what each
// correct answer is currently worth (and that the fighting they did is what
// bought it). Hidden at ×1 so an unearned chip never clutters the header.
function renderQuizMult() {
  const mult = rewardMult();
  if (mult <= 1) return "";
  const capped = rewardMultCapped();
  const title = capped
    ? `Belohnungs-Multiplikator am Anschlag — dieses Quiz löst ihn ein`
    : `Belohnungs-Multiplikator aus ${state.rewardKills} erlegten Skeletten`;
  return `<span class="quiz-mult${capped ? " capped" : ""}" title="${title}">${fmtMult(mult)}</span>`;
}

// The screen is a fixed three-part column: a header that never moves, a stage
// that holds whatever the exercise needs, and a footer pinned to the bottom
// edge. Anchoring the action bar is the point — the primary button sits in the
// same place for every exercise type and before/after checking, so answering
// question after question never makes the target move under the thumb.
function renderQuizFull() {
  const q = state.quizList[state.quizIndex];
  let body;
  switch (q.type) {
    case "choose":      body = renderChooseBody(q, `Was bedeutet <span class="quiz-word">${q.prompt}</span>?`); break;
    case "type":        body = renderTypeBody(q); break;
    case "match":       body = renderMatchBody(q); break;
    case "fill-choose": body = renderFillChooseBody(q); break;
    case "fill-type":   body = renderFillTypeBody(q); break;
    case "arrange":     body = renderArrangeBody(q); break;
  }
  const dir = q.dir ? `<span class="quiz-dir">${quizDirLabel(q.dir)}</span>` : "";
  app.innerHTML = `
    <div class="screen quiz-screen">
      <div class="frame quiz-frame">
        <header class="quiz-header">
          ${renderQuizSteps()}
          <div class="quiz-meta">
            <span class="quiz-count">Frage <b>${state.quizIndex + 1}</b> / ${state.quizList.length}</span>
            ${renderQuizMult()}
            <span class="quiz-purse" title="in dieser Runde verdient"><span class="coin">◈</span> ${state.quizGoldEarned}</span>
            <button class="ghost-btn quiz-history-btn" data-act="openHistory">Lernverlauf</button>
          </div>
        </header>
        <main class="quiz-body scroll-y">
          <div class="quiz-stage">
            <div class="quiz-task"><span class="quiz-kind">${QUIZ_TITLE[q.type]}</span>${dir}</div>
            ${body}
          </div>
        </main>
        ${renderQuizFoot(q)}
      </div>
    </div>`;

  // Keep focus in the text field for the typed exercises (only rebuilt on
  // check/entry, never on keystroke, so the cursor stays put while typing).
  if ((q.type === "type" || q.type === "fill-type") && !state.quizChecked) {
    const inp = document.getElementById("quiz-input");
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }
}

// Multiple-choice options grid, shared by translation-choose and fill-choose.
// A settled option is marked with a glyph as well as a colour, so the outcome
// still reads for a colour-blind player (and in a screenshot).
function renderOptions(q) {
  const optsHtml = q.options
    .map((opt, i) => {
      let cls = "quiz-opt", mark = "";
      if (state.quizChecked) {
        if (opt === q.answer) { cls += " correct"; mark = `<span class="opt-mark">✓</span>`; }
        else if (i === state.quizPicked) { cls += " wrong"; mark = `<span class="opt-mark">✕</span>`; }
        else cls += " faded";
      }
      return `<button class="${cls}" ${state.quizChecked ? "disabled" : ""} data-act="quizChoose" data-args="[${i}]">
        <span class="opt-text">${opt}</span>${mark}</button>`;
    })
    .join("");
  return `<div class="quiz-opts">${optsHtml}</div>`;
}
function renderChooseBody(q, promptHtml) {
  return `<p class="quiz-prompt">${promptHtml}</p>${renderOptions(q)}`;
}

function renderTypeBody(q) {
  return `
    <p class="quiz-prompt">Übersetze <span class="quiz-word">${q.prompt}</span></p>
    ${renderTypeInput("quizCheckType")}`;
}

function renderFillTypeBody(q) {
  return `
    ${renderSentence(q, null)}
    <p class="quiz-hint">${q.de}</p>
    ${renderTypeInput("quizFillCheckType")}`;
}

function renderTypeInput(checkFn) {
  const disabled = state.quizChecked ? "disabled" : "";
  return `
    <input id="quiz-input" class="quiz-input" type="text" autocomplete="off"
      autocapitalize="off" autocorrect="off" spellcheck="false"
      placeholder="Antwort eingeben" value="${state.quizTyped}" ${disabled}
      data-oninput="quizTypeInput" data-enter="${checkFn}">`;
}

// A sentence with its blank rendered as a slot; `filled` (a word) drops into
// the slot once answered.
function renderSentence(q, filled) {
  // Empty, the slot is the underline itself — spelling it out with underscores
  // as well drew a second, ragged line under the first.
  const slot = filled
    ? `<span class="blank filled">${filled}</span>`
    : `<span class="blank">&nbsp;</span>`;
  const parts = q.tokens.map((t, i) => (i === q.blankIdx ? slot : `<span>${t}</span>`));
  return `<p class="quiz-sentence">${parts.join(" ")}</p>`;
}

function renderFillChooseBody(q) {
  const filled = state.quizChecked
    ? (state.quizWasCorrect || state.quizRevealed ? q.answer : q.options[state.quizPicked])
    : null;
  return `
    ${renderSentence(q, filled)}
    <p class="quiz-hint">${q.de}</p>
    ${renderOptions(q)}`;
}

function renderMatchBody(q) {
  const tile = (col, i, t) => {
    let cls = "match-tile";
    const sel = state.quizMatchSel;
    if (state.quizMatchDone.includes(t.id)) cls += " done";
    else if (sel && sel.col === col && sel.idx === i) cls += " sel";
    if (state.quizMatchWrong && state.quizMatchWrong[col] === i) cls += " wrong";
    return `<button class="${cls}" data-act="quizMatchTap" data-args='["${col}",${i}]'>${t.word}</button>`;
  };
  const left = q.left.map((t, i) => tile("left", i, t)).join("");
  const right = q.right.map((t, i) => tile("right", i, t)).join("");
  // The board has no Check button — it settles itself — so it carries its own
  // progress readout instead.
  return `
    <div class="match-head">
      <span>Italienisch</span>
      <span class="match-count">${state.quizMatchDone.length} / ${q.pairs.length} Paare</span>
      <span>Deutsch</span>
    </div>
    <div class="match-cols">
      <div class="match-col">${left}</div>
      <div class="match-col">${right}</div>
    </div>`;
}

function renderArrangeBody(q) {
  const byId = Object.fromEntries(q.bank.map((t) => [t.id, t.word]));
  const builtHtml = state.quizBuilt
    .map((id, pos) => `<button class="tile built" ${state.quizChecked ? "disabled" : ""} data-act="quizArrangeRemove" data-args="[${pos}]">${byId[id]}</button>`)
    .join("");
  const bankHtml = q.bank
    .map((t) => {
      if (state.quizBuilt.includes(t.id)) return `<span class="tile spent"></span>`;
      return `<button class="tile" ${state.quizChecked ? "disabled" : ""} data-act="quizArrangeAdd" data-args="[${t.id}]">${t.word}</button>`;
    })
    .join("");
  return `
    <p class="quiz-prompt">Übersetze: <span class="quiz-word">${q.de}</span></p>
    <div class="build-line">${builtHtml || '<span class="build-placeholder">tippe unten auf die Wörter</span>'}</div>
    <div class="build-bank">${bankHtml}</div>`;
}

// Which exercises need an explicit submit; the rest settle on tap.
const QUIZ_CHECK_FN = { type: "quizCheckType", "fill-type": "quizFillCheckType", arrange: "quizCheckArrange" };
// What to do when an exercise offers no Check button, so the slot the button
// would occupy carries the instruction instead of sitting empty.
const QUIZ_CUE = {
  choose: "Tippe eine Antwort an",
  "fill-choose": "Tippe eine Antwort an",
  match: "Tippe zwei zusammengehörende Wörter an",
};

// Bottom action bar, pinned to the foot of the frame. It always ends in the
// same row — a primary button, or the cue that stands in for one — and grows
// UPWARDS as the feedback banner appears, so nothing below the answer ever
// shifts when a question settles.
function renderQuizFoot(q) {
  if (state.quizChecked) {
    const last = state.quizIndex + 1 >= state.quizList.length;
    let banner;
    if (state.quizWasCorrect) {
      banner = `<div class="quiz-feedback good"><span class="fb-mark">✓</span>
        <span class="fb-text">Richtig</span><span class="fb-gain"><span class="coin">◈</span> +${quizReward()}</span></div>`;
    } else if (q.type === "match") {
      // match has no single answer string; it only pays out when self-solved
      banner = `<div class="quiz-feedback reveal"><span class="fb-mark">◈</span>
        <span class="fb-text">Paare aufgedeckt — kein Gold verdient</span></div>`;
    } else {
      const answer = q.type === "arrange" ? q.answer.join(" ") : q.answer;
      const shown = state.quizRevealed;
      banner = `<div class="quiz-feedback ${shown ? "reveal" : "bad"}"><span class="fb-mark">${shown ? "◈" : "✕"}</span>
        <span class="fb-text">${shown ? "Lösung" : "Richtig wäre"}: <strong>${answer}</strong></span></div>`;
    }
    // On the closing question, say plainly what "Fertig" spends: the banked
    // multiplier is cashed in by finishing the session, not by any one answer.
    // It rides in the button's own label rather than a line above it — the foot
    // bar keeps a fixed row count so the primary button never shifts.
    const label = last
      ? (rewardMult() > 1 ? `Fertig &middot; ${fmtMult(rewardMult())} einlösen` : "Fertig")
      : "Weiter";
    return `<footer class="quiz-foot">${banner}
      <button class="btn-primary quiz-continue" data-act="advanceQuiz">${label} →</button>
    </footer>`;
  }
  // Not yet checked. Every type offers "I don't know" to reveal the solution
  // without earning gold; it sits above the primary row so revealing an answer
  // doesn't move the button it sits over.
  const checkFn = QUIZ_CHECK_FN[q.type];
  const action = checkFn
    ? `<button class="btn-primary quiz-check" data-act="${checkFn}">Prüfen</button>`
    : `<p class="quiz-cue">${QUIZ_CUE[q.type] || ""}</p>`;
  return `<footer class="quiz-foot">
    <button class="quiz-reveal" data-act="quizReveal">Ich weiß es nicht — Lösung zeigen</button>
    ${action}
  </footer>`;
}

// The upgrade phase is now the rune skill tree — see src/skilltree.js, which
// owns renderUpgradeFull (the loop router calls it for the "upgrade" screen).

function renderCombatFull() {
  const { x: cx, y: cy } = CONFIG.circleCenter;
  const slots = layoutCircle(CONFIG.runeCount);

  // The static wheel art is baked into assets/arcane_wheel.png (generated
  // from this exact geometry). Live SVG adds only the dynamic layers.
  const bandInner = CONFIG.circleRadius - 52;
  const bandOuter = CONFIG.circleRadius + 52;

  // Rotating inner script ring beneath the chords (rings are baked; only the
  // rotating glyphs stay live)
  const inner = [];
  for (let i = 0; i < 24; i++) {
    inner.push(glyphAt(cx, cy, 100, i * 15, 7, 100 + i, "glyph"));
  }
  const innerHtml = `<g class="inner-band" id="inner-band" opacity="0.30">${inner.join("")}</g>`;

  // Ember sparks scattered around the band, twinkling per frame
  const sparks = [];
  for (let i = 0; i < 60; i++) {
    const h = tileHash(i, 997);
    const a = (h % 3600) / 10;
    const r = bandInner - 6 + (tileHash(i, 499) % (bandOuter - bandInner + 12));
    const sx = cx + r * Math.cos((a * Math.PI) / 180);
    const sy = cy + r * Math.sin((a * Math.PI) / 180);
    const sr = 1.5 + (h % 3);
    sparks.push(`<circle class="spark" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="${sr}" data-phase="${((h % 628) / 100).toFixed(2)}" style="opacity:0"/>`);
  }
  const sparksHtml = sparks.join("");

  // Filigree: for each of the 15 possible chords, an artistic group of
  // sub-lines (ghost line, perpendicular ticks, midpoint diamond, end barbs).
  // They pulse with the background hum; a correct match bursts its group
  // white, then it stays lit alongside the drawn main chord.
  const filigree = [];
  for (let a = 0; a < CONFIG.runeCount; a++) {
    for (let b = a + 1; b < CONFIG.runeCount; b++) {
      const p1 = slots[a], p2 = slots[b];
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      const ux = dx / len, uy = dy / len;   // along the chord
      const nx = -uy, ny = ux;              // perpendicular
      const at = (t) => ({ x: p1.x + dx * t, y: p1.y + dy * t });
      const seg = (x1, y1, x2, y2, w) =>
        `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke-width="${w}"/>`;
      const parts = [];
      // ghost of the main line
      parts.push(`<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" stroke-width="1" stroke-dasharray="2 7"/>`);
      // perpendicular ticks
      for (const t of [0.35, 0.65]) {
        const p = at(t);
        parts.push(seg(p.x - nx * 7, p.y - ny * 7, p.x + nx * 7, p.y + ny * 7, 1.2));
      }
      // midpoint diamond
      const m = at(0.5);
      parts.push(
        `<polygon points="${(m.x + ux * 6).toFixed(1)},${(m.y + uy * 6).toFixed(1)} ${(m.x + nx * 6).toFixed(1)},${(m.y + ny * 6).toFixed(1)} ${(m.x - ux * 6).toFixed(1)},${(m.y - uy * 6).toFixed(1)} ${(m.x - nx * 6).toFixed(1)},${(m.y - ny * 6).toFixed(1)}" stroke-width="1.2"/>`
      );
      // barbs angled back near each endpoint
      for (const [t, dir] of [[0.14, 1], [0.86, -1]]) {
        const p = at(t);
        parts.push(seg(p.x, p.y, p.x + (nx * 9 - ux * 6 * dir), p.y + (ny * 9 - uy * 6 * dir), 1.2));
        parts.push(seg(p.x, p.y, p.x - (nx * 9 + ux * 6 * dir), p.y - (ny * 9 + uy * 6 * dir), 1.2));
      }
      filigree.push(`<g class="sub-group" data-key="${a}-${b}">${parts.join("")}</g>`);
    }
  }
  const filigreeHtml = filigree.join("");

  const chordsHtml = state.chords
    .map(
      (c) =>
        `<line x1="${c.x1}" y1="${c.y1}" x2="${c.x2}" y2="${c.y2}" class="chord-glow" />` +
        `<line x1="${c.x1}" y1="${c.y1}" x2="${c.x2}" y2="${c.y2}" class="chord" />`
    )
    .join("");

  const runesHtml = state.runes
    .map(
      (r) => `
    <g class="rune ${r.matchState}" data-id="${r.id}">
      <circle class="halo" cx="${r.x}" cy="${r.y}" r="${CONFIG.runeRadius + 7}" filter="url(#glow)"></circle>
      <circle class="body" cx="${r.x}" cy="${r.y}" r="${CONFIG.runeRadius}"></circle>
      <text x="${r.x}" y="${r.y}">${r.word}</text>
    </g>`
    )
    .join("");

  // Live line that follows the pointer while dragging a rune toward its pair.
  const dragLineHtml = `<line id="drag-line" class="drag-line" x1="0" y1="0" x2="0" y2="0"></line>`;

  const arenaDefs = `
    <defs>
      <radialGradient id="bgGlow">
        <stop offset="0%" stop-color="rgba(77,227,224,0.15)"/>
        <stop offset="60%" stop-color="rgba(77,227,224,0.06)"/>
        <stop offset="100%" stop-color="rgba(77,227,224,0)"/>
      </radialGradient>
      <radialGradient id="sparkGrad">
        <stop offset="0%" stop-color="rgba(234,255,254,0.95)"/>
        <stop offset="35%" stop-color="rgba(77,227,224,0.6)"/>
        <stop offset="100%" stop-color="rgba(77,227,224,0)"/>
      </radialGradient>
      <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="6"/>
      </filter>
      <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="2.5"/>
      </filter>
      <filter id="wideGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="9"/>
      </filter>
    </defs>
    <image id="wheel-img" href="assets/arcane_wheel.png" x="0" y="0" width="600" height="600"/>
    <circle id="bg-glow" cx="${cx}" cy="${cy}" r="${CONFIG.circleRadius + 60}" fill="url(#bgGlow)"/>
    ${innerHtml}
    ${sparksHtml}
    ${filigreeHtml}`;

  app.innerHTML = `
    <div class="screen combat-screen" id="combat-root">
      <div class="scene-wrap"><canvas class="scene" id="scene"></canvas></div>
      <div class="hud-under">
        <div class="hero-hud">
          <div class="bar-label">HELD <span id="hero-hp-text"></span></div>
          <div class="hp-track hero"><div class="hp-fill" id="hero-hp-fill"></div></div>
        </div>
        <div class="enemy-hud">
          <div class="bar-label" id="wave-label"></div>
          <div class="hp-track enemy"><div class="hp-fill" id="enemy-hp-fill"></div></div>
        </div>
      </div>
      <svg class="arena" viewBox="0 0 600 600" preserveAspectRatio="xMidYMax meet">
        ${arenaDefs}
        ${chordsHtml}
        ${dragLineHtml}
        ${runesHtml}
      </svg>
      ${renderSpellbook()}
    </div>`;

  // The book is replaced wholesale by the innerHTML above, so its drag-to-turn
  // handlers are rebound to the fresh SVG on every structural render.
  attachSpellbookDrag();
}

function patchCombatContinuous(now) {
  const root = document.getElementById("combat-root");
  if (!root) return;

  root.classList.toggle("wrong-flash", now < state.wrongFlashUntil);
  root.classList.toggle("rune-flash", now < state.runeFlashUntil);
  const shield = Math.floor(state.heroShield || 0);
  document.getElementById("hero-hp-text").textContent =
    `${Math.ceil(state.heroHP)} / ${state.heroMaxHP}` + (shield > 0 ? ` ⛨${shield}` : "");
  document.getElementById("hero-hp-fill").style.width = (100 * state.heroHP / state.heroMaxHP).toFixed(1) + "%";
  // The enemy bar tracks the frontmost skeleton — the one the next spell will
  // hit — while the label shows how deep the hero has pushed (metres walked, the
  // stat the horde's density ramps on), his kill tally, and how many are on screen.
  const remaining = livingEnemies();
  const front = frontEnemy();
  const count = remaining.length;
  // Name the front skeleton's variant when it has one — the bar tracks that one,
  // and a brute's doubled HP pool would otherwise look like a bar that's stuck.
  const frontType = front && CONFIG.enemyTypes.find((t) => t.id === front.type);
  const frontLabel = frontType && frontType.label ? ` · ${frontType.label}` : "";
  // Armour is shown as the share of every hit it turns aside, not as raw points:
  // that's the number the player actually feels, and it visibly falls as
  // penetration nodes are bought (see armorReduction).
  const reduction = front ? armorReduction(front) : 0;
  const armorLabel = reduction > 0 ? ` ⛨${Math.round(reduction * 100)}%` : "";
  document.getElementById("wave-label").innerHTML =
    `${Math.floor(state.distance)} M · ${state.kills} ERLEGT · ${count} SKELETT${count === 1 ? "" : "E"}${frontLabel}${armorLabel}`;
  const enemyPct = front ? (100 * front.hp / front.maxHP) : 0;
  document.getElementById("enemy-hp-fill").style.width = enemyPct.toFixed(1) + "%";

  renderScene(now);

  // The book answers a cast: while a freshly queued effect is still in the air,
  // the open page's miniature swells and its light pool floods the paper. Driven
  // from the descriptors already on `state.spellFx` (see render-spells.js) rather
  // than from a second timer, so the page flares exactly as long as the spell is
  // on screen — and it's a classList toggle, not a rebuild of the book.
  const book = document.getElementById("spellbook");
  if (book) {
    const casting = (state.spellFx || []).some((f) => now - f.born < CONFIG.book.castFlashMs);
    book.classList.toggle("casting", casting);
  }

  const shapeFlashActive = now < state.shapeFlashUntil;
  document.querySelectorAll(".chord, .chord-glow").forEach((el) => el.classList.toggle("flash", shapeFlashActive));

  // Drag-to-connect: while a rune is held, draw a line from it to the pointer.
  const dragLine = document.getElementById("drag-line");
  if (dragLine) {
    const anchor = state.dragActive && state.selectedRuneId !== null
      ? state.runes.find((r) => r.id === state.selectedRuneId)
      : null;
    if (anchor && state.dragPointer) {
      dragLine.setAttribute("x1", anchor.x);
      dragLine.setAttribute("y1", anchor.y);
      dragLine.setAttribute("x2", state.dragPointer.x.toFixed(1));
      dragLine.setAttribute("y2", state.dragPointer.y.toFixed(1));
      dragLine.classList.add("active");
    } else {
      dragLine.classList.remove("active");
    }
  }

  // Background hum: the cyan glow behind the circle breathes slowly, and the
  // band's glow layers breathe with it
  const hum = 0.72 + 0.28 * Math.sin(now / 900);
  const bgGlowEl = document.getElementById("bg-glow");
  if (bgGlowEl) bgGlowEl.style.opacity = hum.toFixed(3);
  const wheelImg = document.getElementById("wheel-img");
  if (wheelImg) wheelImg.style.opacity = (0.86 + 0.14 * Math.sin(now / 900)).toFixed(3);

  // Inner script ring rotates slowly; ember sparks twinkle at their own phase
  const innerBand = document.getElementById("inner-band");
  if (innerBand) {
    innerBand.setAttribute(
      "transform",
      `rotate(${((now / 260) % 360).toFixed(2)} ${CONFIG.circleCenter.x} ${CONFIG.circleCenter.y})`
    );
  }
  document.querySelectorAll(".spark").forEach((el) => {
    const p = parseFloat(el.dataset.phase);
    const tw = Math.max(0, Math.sin(now / 420 + p * 2.4));
    el.style.opacity = (tw * tw * 0.95).toFixed(3);
  });

  // Filigree: lit groups follow their matched chord (burst first, then hold);
  // unlit groups shimmer with the background pulse
  const chordByKey = {};
  for (const c of state.chords) chordByKey[`${c.slotA}-${c.slotB}`] = c;
  document.querySelectorAll(".sub-group").forEach((el, idx) => {
    const chord = chordByKey[el.dataset.key];
    if (chord) {
      const burst = now - chord.addedAt < 320;
      el.classList.toggle("burst", burst);
      el.style.opacity = burst ? "1" : "0.8";
    } else {
      el.classList.remove("burst");
      el.style.opacity = (0.06 + 0.05 * Math.sin(now / 700 + idx * 1.3)).toFixed(3);
    }
  });
}

// "×2.4", but "×3" rather than "×3.0" — a round multiplier shouldn't wear a
// pointless decimal.
function fmtMult(m) {
  return `×${(Math.round(m * 10) / 10).toString().replace(".", ",")}`;
}

// The end of a run is NOT a loss screen. Falling costs the player nothing they
// had banked: every skeleton they slew is still sitting in the reward bank,
// multiplying the gold the next quiz pays out, and it keeps growing across runs
// until a full session cashes it in. So the screen leads with the number they
// won — the multiplier — and points at the one door that spends it: studying.
function renderEndFull() {
  const elapsed = ((performance.now() - state.runStartMs) / 1000).toFixed(0);
  const mult = rewardMult();
  const capped = rewardMultCapped();
  const banked = Math.max(0, state.rewardKills || 0);
  const carried = Math.max(0, banked - state.kills);   // brought in from earlier runs
  // How full the bank is, as a share of the cap — the bar is the nudge: a nearly
  // full one says "go study before the next kills are wasted".
  const fill = Math.max(0, Math.min(1, (mult - 1) / (CONFIG.rewardMultMax - 1)));

  const carryLine = carried > 0
    ? `<p class="reward-carry"><strong>${carried}</strong> davon aus früheren Läufen &mdash; nichts geht verloren</p>`
    : `<p class="reward-carry">Jeder Lauf legt obendrauf &mdash; nichts geht verloren</p>`;
  const nudge = capped
    ? `Am Anschlag: weitere Skelette zahlen nicht mehr ein. <strong>Jetzt lernen</strong> bringt am meisten.`
    : `Ein <strong>komplettes Quiz</strong> löst den Bonus ein.`;

  app.innerHTML = `
    <div class="screen end-screen reward-screen">
      <h1 class="reward">Bonus gesichert</h1>
      <div class="reward-mult${capped ? " capped" : ""}">
        <span class="reward-mult-num">${fmtMult(mult)}</span>
        <span class="reward-mult-label">Gold im nächsten Quiz</span>
      </div>
      <div class="reward-bar" role="img" aria-label="Bonus ${fmtMult(mult)} von ${fmtMult(CONFIG.rewardMultMax)}">
        <span class="reward-bar-fill${capped ? " capped" : ""}" style="width:${(fill * 100).toFixed(1)}%"></span>
      </div>
      <p class="reward-bank">${capped
        ? `<strong>${banked}</strong> erlegte Skelette &mdash; mehr als genug für den vollen Bonus`
        : `<strong>${banked}</strong> erlegte Skelette warten auf ihre Auszahlung`}</p>
      ${carryLine}
      <p class="reward-rate"><span class="coin">◈</span> <strong>${quizReward()}</strong> Gold pro richtiger Antwort</p>
      <p class="end-flavor">${nudge}</p>
      <button class="fight-btn study-btn" data-act="goToQuiz">Lernen &amp; ${fmtMult(mult)} Gold kassieren →</button>
      <p class="dim">${Math.floor(state.distance)} m weit &middot; ${state.kills} in diesem Lauf erlegt &middot; ${elapsed}s gekämpft &middot; ${state.wrongMatchCount} Fehler</p>
    </div>`;
}
window.Incanto.screens = { renderQuizFull, renderCombatFull, patchCombatContinuous, renderEndFull, fmtMult };
