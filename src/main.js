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
  scene = null;   // re-measure and rebuild the corridor at the new integer scale
  tavern = null;  // …and the tavern room, whose chips are placed off that scale
  if (state && state.screen === "tavern") state._structuralDirty = true;
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

// The ONLY key this game listens for: the phone keyboard's Go/Enter on a typed
// answer field, which submits it. That is the on-screen keyboard's own submit
// button, not a desktop shortcut. Nothing else here is keyboard-driven, and
// nothing else may become keyboard-driven — see "Incanto is a phone game" in
// CLAUDE.md. Every action reaches the player as something to tap.
app.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const el = e.target.closest("[data-enter]");
  if (!el) return;
  const fn = window[el.dataset.enter];
  if (typeof fn === "function") fn();
});

// ---------------------------------------------------------------------------
// Bootstrap — the game opens in the TAVERN, the home room. No run is started
// here: the corridor begins when the player walks the mage to the Gang (or taps
// the nav's crossed blades), which is what makes the room the hub rather than a
// screen you back out into. `freshState` already names the tavern as the screen,
// so booting is nothing but building the state and the nav and letting the loop
// take it from there.
// ---------------------------------------------------------------------------
newGame();
renderNav();
requestAnimationFrame(rafLoop);
