"use strict";
// ==============================================================================
// nav.js — bottom phase-switcher: a persistent, text-free panel of three
// pixel-art buttons (study · forge · combat) that lets the player jump between
// phases at will. Icons are hand-placed pixel grids rendered as crisp <rect>
// cells so no fonts or glyphs are involved. Owns: renderNav, updateNav, navTo.
// Renders into <nav id="bottom-nav"> (a sibling of #app, not inside it).
// ==============================================================================

const NAV_PIX = {
  o: "#10151a", // outline / spine
  p: "#f2ead0", // book parchment
  g: "#c9a24a", // gold (book line, sword fittings)
  c: "#4de3e0", // book teal cover
  s: "#b8c0cc", // anvil steel
  h: "#e6ecf3", // anvil top highlight
  d: "#6f7a88", // anvil dark steel
  b: "#e4ebf3", // sword blade
  w: "#8a5a2b", // staff wood
  t: "#7ff0ed", // staff gem
};

// Open book — the "study" phase.
const NAV_BOOK = [
  "................",
  "................",
  "..oooooooooooo..",
  "..oppppooppppo..",
  "..opggpoopggpo..",
  "..oppppooppppo..",
  "..opggpoopggpo..",
  "..oppppooppppo..",
  "..opggpoopggpo..",
  "..oppppooppppo..",
  "..oooooooooooo..",
  "..cccccccccccc..",
  "...cccccccccc...",
  "................",
  "................",
  "................",
];

// Anvil (Amboss) — the "upgrade / forge" phase.
const NAV_ANVIL = [
  "................",
  "................",
  "................",
  "...hhhhhhhhhh...",
  "...ssssssssss...",
  ".ssssssssssss...",
  "....dddddddd....",
  ".......sss......",
  ".......sss......",
  ".......sss......",
  "....ssssssss....",
  "..ssssssssssss..",
  "..dddddddddddd..",
  "................",
  "................",
  "................",
];

// Staff crossed with a sword — the "combat" phase. Built on a grid so the two
// diagonals can overlap cleanly (the sword is drawn over the staff).
function navWeaponRows() {
  const N = 16;
  const g = Array.from({ length: N }, () => Array(N).fill("."));
  const set = (x, y, ch) => { if (x >= 0 && x < N && y >= 0 && y < N) g[y][x] = ch; };
  // Staff: wooden shaft running top-left → bottom-right, 2px thick.
  for (let y = 4; y <= 13; y++) { set(y, y, "w"); set(y + 1, y, "w"); }
  // Gem crowning the staff head.
  set(2, 2, "t"); set(3, 2, "t"); set(2, 3, "t"); set(3, 3, "t");
  // Sword blade: top-right → centre, 2px thick, laid over the staff at the cross.
  for (let y = 2; y <= 10; y++) { set(14 - y, y, "b"); set(15 - y, y, "b"); }
  // Sword guard, grip and pommel (gold) toward the bottom-left.
  set(3, 10, "g");
  set(3, 11, "g"); set(4, 11, "g");
  set(2, 12, "g"); set(3, 12, "g");
  set(2, 13, "g");
  return g.map((row) => row.join(""));
}

function navPixSvg(rows) {
  let cells = "";
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const col = NAV_PIX[row[x]];
      if (!col) continue;
      cells += `<rect x="${x}" y="${y}" width="1" height="1" fill="${col}"/>`;
    }
  }
  return `<svg class="nav-icon" viewBox="0 0 ${rows[0].length} ${rows.length}" ` +
    `xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" aria-hidden="true">${cells}</svg>`;
}

function renderNav() {
  const nav = document.getElementById("bottom-nav");
  if (!nav) return;
  nav.innerHTML = `
    <button class="nav-btn" data-phase="study" data-act="navTo" data-args='["study"]' aria-label="Studieren">${navPixSvg(NAV_BOOK)}</button>
    <button class="nav-btn" data-phase="upgrade" data-act="navTo" data-args='["upgrade"]' aria-label="Schmiede">${navPixSvg(NAV_ANVIL)}</button>
    <button class="nav-btn" data-phase="combat" data-act="navTo" data-args='["combat"]' aria-label="Kampf">${navPixSvg(navWeaponRows())}</button>`;
}

// Map the internal screen name to the phase the nav highlights.
const NAV_PHASE_FOR_SCREEN = { quiz: "study", upgrade: "upgrade", combat: "combat" };

let lastNavPhase = null;
function updateNav() {
  const phase = NAV_PHASE_FOR_SCREEN[state.screen] || null; // "defeat" highlights nothing
  if (phase === lastNavPhase) return;
  lastNavPhase = phase;
  document.querySelectorAll("#bottom-nav .nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.phase === phase);
  });
}

// Jump to a phase. Combat and study resume an in-progress session rather than
// wiping it, so hopping away and back never costs the player their progress.
function navTo(phase) {
  if (!state) return;
  if (phase === "study") {
    if (state.screen === "quiz") return;
    const quizInProgress = state.quizList.length > 0 && state.quizIndex < state.quizList.length;
    if (quizInProgress) {
      state.screen = "quiz";
      state._structuralDirty = true;
    } else {
      goToQuiz();
    }
  } else if (phase === "upgrade") {
    if (state.screen === "upgrade") return;
    state.screen = "upgrade";
    state._structuralDirty = true;
  } else if (phase === "combat") {
    if (state.screen === "combat") return;
    if (state.runActive && state.heroHP > 0) {
      state.screen = "combat";        // resume the live run right where it paused
      state._structuralDirty = true;
    } else {
      startRun();                     // no run to resume → begin a fresh one
    }
  }
}

window.Incanto.nav = { renderNav, updateNav, navTo };
