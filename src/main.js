"use strict";
// ==============================================================================
// main.js — loads last. Wires global listeners + the delegated UI dispatch, then
// boots the game. Owns no game logic; only event wiring and bootstrap.
// ==============================================================================

// Rune-circle pointer input — delegated off document/window so it survives the
// SVG being rebuilt on every structural render.
document.addEventListener("pointerdown", onRunePointerDown);
window.addEventListener("pointermove", onRunePointerMove);
window.addEventListener("pointerup", onRunePointerUp);
window.addEventListener("pointercancel", onRunePointerCancel);

window.addEventListener("resize", () => {
  scene = null; // re-measure and rebuild the scene at the new integer scale
});

window.addEventListener("keydown", (e) => {
  if (e.key === "r" || e.key === "R") {
    // Hard reset (wipes upgrades) — only from menus, never mid-combat
    if (state.screen !== "combat") restart();
  }
});

// ---------------------------------------------------------------------------
// Delegated UI actions. Screen templates and the bottom nav carry `data-act`
// (+ optional `data-args` as a JSON array) instead of inline on* handlers, so
// markup holds no JS identifiers. The click listener is on `document` because
// the phase nav lives outside #app; input/Enter are quiz-only so they stay on
// #app. The action name resolves to a global function (module functions are
// declared at top level, so they're callable by name here).
// ---------------------------------------------------------------------------
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const fn = window[el.dataset.act];
  if (typeof fn === "function") fn(...JSON.parse(el.dataset.args || "[]"));
});

app.addEventListener("input", (e) => {
  const el = e.target.closest("[data-oninput]");
  if (!el) return;
  const fn = window[el.dataset.oninput];
  if (typeof fn === "function") fn(el);
});

app.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const el = e.target.closest("[data-enter]");
  if (!el) return;
  const fn = window[el.dataset.enter];
  if (typeof fn === "function") fn();
});

// ---------------------------------------------------------------------------
// Bootstrap — you start straight in combat with the base build.
// ---------------------------------------------------------------------------
newGame();
renderNav();
startRun();
requestAnimationFrame(rafLoop);
