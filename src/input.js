"use strict";
// ==============================================================================
// input.js — pointer/drag handling for the rune circle. Owns: clientToArena,
// runeIdAtPoint, onRunePointer{Down,Move,Up,Cancel}, DRAG_MOVE_THRESHOLD.
// ==============================================================================


// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

// Rune input — the primary gesture is drag-to-connect: press a rune, drag the
// glowing thread onto its pair, release to attempt the match. Tapping still
// arms a rune, so the older two-tap flow keeps working as a fallback. Handlers
// are delegated off document/window so they survive the SVG being rebuilt.
const DRAG_MOVE_THRESHOLD = 6; // px of pointer travel before a press counts as a drag
let dragStartClient = null;
// Did THIS press arm the rune it started on? A second tap on an armed rune
// releases it, but the tap that armed it must not release it again on its own
// pointerup — so the two are told apart here rather than by state alone.
let armedThisPress = false;

function clientToArena(clientX, clientY) {
  const svg = document.querySelector("svg.arena");
  const ctm = svg && svg.getScreenCTM ? svg.getScreenCTM() : null;
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

function runeIdAtPoint(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  const g = el && el.closest ? el.closest(".rune") : null;
  if (!g || g.dataset.id === undefined) return null;
  return Number(g.dataset.id);
}

function onRunePointerDown(e) {
  if (state.screen !== "combat") return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const id = runeIdAtPoint(e.clientX, e.clientY);
  if (id === null) {
    // Pressed the empty board with a rune armed → let it go. Only inside the
    // arena itself: a press on the spell book or the HUD is that widget's
    // business and shouldn't quietly disarm the circle behind it.
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (state.selectedRuneId !== null && el && el.closest && el.closest("svg.arena")) {
      handleRuneClick(state.selectedRuneId);
    }
    return;
  }
  const rune = state.runes.find((r) => r.id === id);
  if (!rune || rune.matchState === "matched") return;

  e.preventDefault();

  // A different rune is already armed → this press is the second selection;
  // resolve the match immediately (classic two-tap) without starting a drag.
  if (state.selectedRuneId !== null && state.selectedRuneId !== id) {
    handleRuneClick(id, true); // viaTap: let the staff trace to this 2nd rune
    return;
  }

  // Otherwise begin dragging from this rune, arming it first if needed.
  armedThisPress = state.selectedRuneId === null;
  if (armedThisPress) handleRuneClick(id);
  state.dragActive = true;
  state.dragMoved = false;
  state.dragPointer = { x: rune.x, y: rune.y };
  dragStartClient = { x: e.clientX, y: e.clientY };
  const svg = document.querySelector("svg.arena");
  if (svg && svg.setPointerCapture) { try { svg.setPointerCapture(e.pointerId); } catch (_) {} }
}

function onRunePointerMove(e) {
  if (!state.dragActive) return;
  if (dragStartClient) {
    const dx = e.clientX - dragStartClient.x;
    const dy = e.clientY - dragStartClient.y;
    if (dx * dx + dy * dy > DRAG_MOVE_THRESHOLD * DRAG_MOVE_THRESHOLD) state.dragMoved = true;
  }
  const p = clientToArena(e.clientX, e.clientY);
  if (p) state.dragPointer = p;
}

function onRunePointerUp(e) {
  if (!state.dragActive) return;
  state.dragActive = false;
  state.dragPointer = null;
  const from = state.selectedRuneId;
  if (from === null) return;

  const target = runeIdAtPoint(e.clientX, e.clientY);
  if (target !== null && target !== from) {
    handleRuneClick(target);            // resolve the match against the armed rune
  } else if (state.dragMoved) {
    handleRuneClick(from);              // dragged off and released → cancel the arm
  } else if (target === from && !armedThisPress) {
    // Tapped the armed rune a second time → release it. Guarded on
    // `armedThisPress` because the tap that ARMS a rune also lands here, and
    // without the guard it would disarm it again on the way up, leaving the
    // circle impossible to select on at all.
    handleRuneClick(from);
  }
  // Otherwise a first tap leaves the rune armed so a second tap can match.
  armedThisPress = false;
}

function onRunePointerCancel() {
  if (!state.dragActive) return;
  state.dragActive = false;
  state.dragPointer = null;
  armedThisPress = false;
  if (state.dragMoved && state.selectedRuneId !== null) handleRuneClick(state.selectedRuneId);
}
window.Incanto.input = { onRunePointerDown, onRunePointerMove, onRunePointerUp, onRunePointerCancel };
