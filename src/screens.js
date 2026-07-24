"use strict";
// ==============================================================================
// screens.js — full-screen DOM renderers (innerHTML into #app). Owns:
// renderQuizFull + body renderers, renderUpgradeFull, renderCombatFull,
// patchCombatContinuous, renderEndFull.
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
  const dir = q.dir ? `<span class="quiz-badge">${quizDirLabel(q.dir)}</span>` : "";
  app.innerHTML = `
    <div class="screen quiz-screen">
      <div class="quiz-progress">Frage ${state.quizIndex + 1} / ${state.quizList.length}
        &middot; <span class="coin">◈</span> ${state.quizGoldEarned} verdient</div>
      <div class="quiz-typeline"><span class="quiz-badge kind">${QUIZ_TITLE[q.type]}</span>${dir}</div>
      ${body}
      ${renderQuizActions(q)}
    </div>`;

  // Keep focus in the text field for the typed exercises (only rebuilt on
  // check/entry, never on keystroke, so the cursor stays put while typing).
  if ((q.type === "type" || q.type === "fill-type") && !state.quizChecked) {
    const inp = document.getElementById("quiz-input");
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }
}

// Multiple-choice options grid, shared by translation-choose and fill-choose.
function renderOptions(q) {
  const optsHtml = q.options
    .map((opt, i) => {
      let cls = "quiz-opt";
      if (state.quizChecked) {
        if (opt === q.answer) cls += " correct";
        else if (i === state.quizPicked) cls += " wrong";
        else cls += " faded";
      }
      return `<button class="${cls}" ${state.quizChecked ? "disabled" : ""} data-act="quizChoose" data-args="[${i}]">${opt}</button>`;
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
  const slot = filled
    ? `<span class="blank filled">${filled}</span>`
    : `<span class="blank">_____</span>`;
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
  return `
    <p class="quiz-prompt">Ordne jedem italienischen Wort seine Bedeutung zu</p>
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

// Bottom action bar: a Check button before answering (for the exercises that
// need an explicit submit), then the feedback banner + Continue afterwards.
function renderQuizActions(q) {
  if (state.quizChecked) {
    const last = state.quizIndex + 1 >= state.quizList.length;
    let banner;
    if (state.quizWasCorrect) {
      banner = `<div class="quiz-feedback good">Richtig! <span class="coin">◈</span> +${quizReward()}</div>`;
    } else if (q.type === "match") {
      // match has no single answer string; it only pays out when self-solved
      banner = `<div class="quiz-feedback reveal">Paare aufgedeckt — kein Gold verdient</div>`;
    } else {
      const answer = q.type === "arrange" ? q.answer.join(" ") : q.answer;
      const cls = state.quizRevealed ? "reveal" : "bad";
      const label = state.quizRevealed ? "Lösung" : "Antwort";
      banner = `<div class="quiz-feedback ${cls}">${label}: <strong>${answer}</strong></div>`;
    }
    return `${banner}<button class="fight-btn quiz-continue" data-act="advanceQuiz">${last ? "Fertig →" : "Weiter →"}</button>`;
  }
  // Not yet checked: choose/match resolve on tap, the rest need a Check button.
  // Every type offers "I don't know" to reveal the solution without earning gold.
  const checkFn = { type: "quizCheckType", "fill-type": "quizFillCheckType", arrange: "quizCheckArrange" }[q.type];
  const reveal = `<button class="quiz-reveal" data-act="quizReveal">Ich weiß es nicht — Lösung zeigen</button>`;
  const check = checkFn ? `<button class="fight-btn quiz-check" data-act="${checkFn}">Prüfen</button>` : "";
  return `${check}${reveal}`;
}

// Upgrade shop — spend quiz gold on permanent build upgrades, then run again
function renderUpgradeFull() {
  const dmgCost = dmgUpgradeCost();
  const hpCost = hpUpgradeCost();
  const canDmg = state.gold >= dmgCost;
  const canHp = state.gold >= hpCost;
  app.innerHTML = `
    <div class="screen upgrade-screen">
      <h1>Dein Arsenal</h1>
      <p class="gold-big"><span class="coin">◈</span> ${state.gold} Gold</p>
      <div class="upg-cards">
        <button class="upg-card ${canDmg ? "" : "poor"}" data-act="buyDmg">
          <div class="upg-name">⚔ Angriff</div>
          <div class="upg-stat">${state.heroDmg} → ${state.heroDmg + CONFIG.dmgPerLevel} Schaden</div>
          <div class="upg-cost"><span class="coin">◈</span> ${dmgCost}</div>
        </button>
        <button class="upg-card ${canHp ? "" : "poor"}" data-act="buyHp">
          <div class="upg-name">✚ Vitalität</div>
          <div class="upg-stat">${state.heroMaxHP} → ${state.heroMaxHP + CONFIG.hpPerLevel} max. LP</div>
          <div class="upg-cost"><span class="coin">◈</span> ${hpCost}</div>
        </button>
      </div>
      <p class="upg-hp">Aufbau: ${state.heroMaxHP} LP · ${state.heroDmg} Schaden</p>
      <button class="fight-btn next-wave-btn" data-act="startRun">Lauf starten →</button>
    </div>`;
}

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
          <div class="bar-sub">⚔ ${state.heroDmg} Schaden</div>
        </div>
        <div class="enemy-hud">
          <div class="bar-label" id="wave-label"></div>
          <div class="hp-track enemy"><div class="hp-fill" id="enemy-hp-fill"></div></div>
        </div>
      </div>
      <svg class="arena" viewBox="0 0 600 600" preserveAspectRatio="xMidYMid meet">
        ${arenaDefs}
        ${chordsHtml}
        ${dragLineHtml}
        ${runesHtml}
      </svg>
    </div>`;
}

function patchCombatContinuous(now) {
  const root = document.getElementById("combat-root");
  if (!root) return;

  root.classList.toggle("wrong-flash", now < state.wrongFlashUntil);
  root.classList.toggle("rune-flash", now < state.runeFlashUntil);
  document.getElementById("hero-hp-text").textContent = `${Math.ceil(state.heroHP)} / ${state.heroMaxHP}`;
  document.getElementById("hero-hp-fill").style.width = (100 * state.heroHP / state.heroMaxHP).toFixed(1) + "%";
  // With a whole mob on screen, the enemy bar tracks the frontmost skeleton —
  // the one the next spell will hit — and the label shows how many remain.
  const remaining = livingEnemies();
  const front = frontEnemy();
  const count = remaining.length;
  document.getElementById("wave-label").innerHTML =
    `WELLE ${state.wave} · ${count} SKELETT${count === 1 ? "" : "E"}`;
  const enemyPct = front ? (100 * front.hp / front.maxHP) : 0;
  document.getElementById("enemy-hp-fill").style.width = enemyPct.toFixed(1) + "%";

  renderScene(now);

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

function renderEndFull() {
  const elapsed = ((performance.now() - state.runStartMs) / 1000).toFixed(0);
  app.innerHTML = `
    <div class="screen end-screen">
      <h1 class="defeat">Niederlage</h1>
      <p>Die Horde hat dich in <strong>Welle ${state.lastWaveReached}</strong> überwältigt</p>
      <p class="dim">${elapsed}s überlebt &middot; ${state.wrongMatchCount} Fehler</p>
      <p class="end-flavor">Lerne deine Vokabeln, um für den nächsten Lauf stärker zu werden.</p>
      <button class="fight-btn study-btn" data-act="goToQuiz">Lernen &amp; Gold verdienen →</button>
    </div>`;
}
window.Incanto.screens = { renderQuizFull, renderUpgradeFull, renderCombatFull, patchCombatContinuous, renderEndFull };
