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

// A settled quiz question advances on Enter, so a keyboard session doesn't have
// to reach for the pointer between questions.
//
// It must never be the SAME keystroke that settled it. Enter in the answer field
// checks the answer (the [data-enter] listener above), which flips quizChecked
// before the event finishes bubbling up to here — so without this guard one
// press both checked the answer and skipped the feedback, and a wrong answer
// jumped straight to the next word without ever showing the solution. Whichever
// control owns Enter keeps it: the answer field checks, a focused button fires
// its own click, and only a press that belongs to neither advances.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.repeat) return;
  if (state.screen !== "quiz" || !state.quizChecked) return;
  if (e.target.closest("[data-enter], [data-act], input, button, a")) return;
  e.preventDefault();
  advanceQuiz();
});

// ---------------------------------------------------------------------------
// Bootstrap — you start straight in combat with the base build.
// ---------------------------------------------------------------------------
newGame();
renderNav();
startRun();
requestAnimationFrame(rafLoop);
