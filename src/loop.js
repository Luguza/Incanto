"use strict";
// ==============================================================================
// loop.js — main rAF loop + screen router. Owns: logAttempt, getEffectiveDt,
// rafLoop, render (router), app (#app root), builtScreen, lastRafNow.
// ==============================================================================

function logAttempt(correct, first, second, secondsAvailable) {
  console.log(
    `[${new Date().toISOString()}] pair="${first.word} / ${second.word}" ` +
    `result=${correct ? "correct" : "wrong"} availableFor=${secondsAvailable}s`
  );
}

function restart() {
  // Hard reset: wipes meta-progression (including the saved game) and starts a
  // fresh run from the base build
  clearProgress();
  newGame();
  startRun();
}

// ---------------------------------------------------------------------------
// Game loop — combat always runs in real time.
// ---------------------------------------------------------------------------
function getEffectiveDt(rawDt) {
  return rawDt;
}

let lastRafNow = null;
function rafLoop(now) {
  if (lastRafNow === null) lastRafNow = now;
  const rawDt = now - lastRafNow;
  lastRafNow = now;

  if (state.screen === "combat") {
    const effectiveDt = getEffectiveDt(rawDt);
    state.clockMs += effectiveDt;
    // The skeleton only winds up its attack once it has fully entered and is
    // still alive — not while walking in or dying.
    if (state.enemyPhase === "alive") {
      state.windup += effectiveDt / CONFIG.windupDurationMs;
      if (state.windup >= 1) {
        state.windup = 0;
        hitPlayer(state.enemyDmg);
      }
    }
    // Enemy finished walking in → it's now active
    if (state.enemyPhase === "enter" && now - state.enemyPhaseAt >= CONFIG.enemyEnterMs) {
      state.enemyPhase = "alive";
    }
    // A lethal cast has finished animating → play the skeleton's death
    if (state.pendingWaveEnd && state.castAt === 0 && state.enemyPhase !== "dying") {
      state.pendingWaveEnd = false;
      state.enemyPhase = "dying";
      state.enemyPhaseAt = now;
    }
    // Death animation done → the next, stronger skeleton walks in. The build
    // stays fixed for the whole run; upgrades only happen between runs.
    if (state.enemyPhase === "dying" && now - state.enemyPhaseAt >= CONFIG.enemyDeathMs) {
      startWave(state.wave + 1);
    }
    if (state.pendingRefill && state.screen === "combat" && now >= state.shapeFlashUntil) {
      state.pendingRefill = false;
      populateCircle(drawLoadout());
    }
    // Third pair matched by tap: once the staff has traced to the 2nd rune,
    // release the spell.
    if (state.pendingShapeAt && now >= state.pendingShapeAt) {
      state.pendingShapeAt = 0;
      onShapeComplete(now);
    }
  }

  render(now);
  requestAnimationFrame(rafLoop);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
// DECISION: the DOM is only rebuilt on actual state changes (screen switch,
// rune/chord structure change). Continuous per-frame animation (windup bar,
// flash timers, HUD text) is patched directly on existing nodes instead of
// replacing the whole tree every rAF tick — rebuilding ~60x/sec would tear
// down interactive elements (e.g. the Fight button) out from under real
// clicks, since a click can land in the gap between two rebuilds.
const app = document.getElementById("app");
let builtScreen = null;

function render(now) {
  if (state.screen === "combat") {
    if (builtScreen !== "combat" || state._structuralDirty) {
      renderCombatFull();
      builtScreen = "combat";
      state._structuralDirty = false;
    }
    patchCombatContinuous(now);
  } else if (state.screen === "quiz") {
    if (builtScreen !== "quiz" || state._structuralDirty) {
      renderQuizFull();
      builtScreen = "quiz";
      state._structuralDirty = false;
    }
  } else if (state.screen === "upgrade") {
    if (builtScreen !== "upgrade" || state._structuralDirty) {
      renderUpgradeFull();
      builtScreen = "upgrade";
      state._structuralDirty = false;
    }
  } else {
    if (builtScreen !== state.screen) {
      renderEndFull();
      builtScreen = state.screen;
    }
  }
}
window.Incanto.loop = { rafLoop, render, logAttempt };
