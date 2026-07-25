"use strict";
// ==============================================================================
// combat.js — rune matching + spell resolution. Owns: handleRuneClick,
// onShapeComplete, hitPlayer, hitEnemy, TAP_TRACE_MS.
// ==============================================================================

// ---------------------------------------------------------------------------
// Combat logic
// ---------------------------------------------------------------------------
// How long the staff spends tracing to the pair's second rune after a tap match
// (before it rests, or before the third pair releases the spell).
const TAP_TRACE_MS = 240;

// Enemies a spell can still meaningfully hit: on their feet and not already
// doomed. A `struck` skeleton has taken its killing blow and is only standing
// until the bolt lands, so it's excluded here — the next cast picks a new target
// instead of wasting itself on a corpse-to-be.
function livingEnemies() {
  return state.enemies.filter((e) => e.phase !== "dying" && e.phase !== "struck");
}

// The skeleton closest to the hero (smallest pos) — the spell's target and the
// one whose HP the HUD tracks.
function frontEnemy() {
  const alive = livingEnemies();
  if (!alive.length) return null;
  return alive.reduce((a, b) => (b.pos < a.pos ? b : a));
}

function handleRuneClick(id, viaTap = false) {
  if (state.screen !== "combat") return;
  const rune = state.runes.find((r) => r.id === id);
  if (!rune) return;
  if (rune.matchState === "matched") return; // DECISION: clicking a matched rune is a no-op

  if (state.selectedRuneId === id) {
    rune.matchState = "unmatched";
    state.selectedRuneId = null;
    state._structuralDirty = true;
    return;
  }

  if (state.selectedRuneId === null) {
    rune.matchState = "selected";
    state.selectedRuneId = id;
    state._structuralDirty = true;
    return;
  }

  const first = state.runes.find((r) => r.id === state.selectedRuneId);
  const correct = first.pairId === rune.pairId;
  const now = performance.now();
  const availableAt = state.pairAvailableAtClockMs[first.pairId] ?? state.clockMs;
  const secondsAvailable = ((state.clockMs - availableAt) / 1000).toFixed(1);
  logAttempt(correct, first, rune, secondsAvailable);
  state._structuralDirty = true;

  if (correct) {
    first.matchState = "matched";
    rune.matchState = "matched";
    state.chords.push({
      x1: first.x, y1: first.y, x2: rune.x, y2: rune.y,
      pairId: rune.pairId,
      slotA: Math.min(first.id, rune.id),
      slotB: Math.max(first.id, rune.id),
      addedAt: now, // drives the burst flash on the filigree and the mirror
    });
    state.selectedRuneId = null;
    const shapeDone = state.chords.length >= CONFIG.pairsPerLoadout;
    if (viaTap) {
      // Tapped the pair: send the staff to the second rune before it rests. On
      // the third pair, hold the spell until that trace finishes so the reveal
      // reads the same as a drag (gem at the 2nd rune, then it lifts to cast).
      state.tapTraceFrom = { x: first.x, y: first.y };
      state.tapTraceTo = { x: rune.x, y: rune.y };
      state.tapTraceUntil = now + TAP_TRACE_MS;
      if (shapeDone) state.pendingShapeAt = now + TAP_TRACE_MS;
    } else if (shapeDone) {
      onShapeComplete(now); // dragged: the gem is already at the 2nd rune
    }
  } else {
    state.wrongMatchCount++;
    first.matchState = "unmatched";
    rune.matchState = "unmatched";
    state.selectedRuneId = null;
    // A wrong pair backfires: the whole circle flares red, a harmful blast bursts
    // around the hero for a fifth of his MAX HP, then the board dissolves and
    // re-deals a fresh set of words — any pairs solved this loadout are lost.
    state.wrongFlashUntil = now + CONFIG.wrongFlashDurationMs;
    state.runeFlashUntil = now + CONFIG.runeFlashDurationMs;
    state.heroBlastUntil = now + CONFIG.heroBlastMs;
    hitPlayer(Math.max(1, Math.round(state.heroMaxHP * CONFIG.wrongPenaltyFraction)));
    setTimeout(() => {
      if (state.screen === "combat") populateCircle(drawLoadout());
    }, CONFIG.runeFlashDurationMs);
  }
}

function onShapeComplete(now) {
  // The three completed chords lighting up together *is* the cast. Fire the
  // spell animation, then resolve damage against the frontmost skeleton.
  state.shapeFlashUntil = now + CONFIG.shapeFlashDurationMs;
  state.castAt = now;
  state.castChords = state.chords.map((c) => ({ ...c })); // survives the refill

  const target = frontEnemy();
  state.castTargetId = target ? target.id : null;
  if (!target) return; // nothing left to hit

  // The spell hits the target (no gold in combat — currency is quiz-only)
  hitEnemy(target, state.heroDmg);
  // Pop the damage number over the skeleton the moment the fireball lands, not
  // when the cast starts — the pop is re-anchored to the body each frame.
  const impactAt = now + CONFIG.castChargeMs + CONFIG.fireballFlightMs;
  spawnDmgFloat({
    value: state.heroDmg,
    color: CONFIG.colors.dmgFloat.enemy,
    born: impactAt,
    targetId: target.id,
    x: scene ? scene.enemyLineX + target.pos * TILE : 0,
    y: scene ? (scene.laneY[target.lane] ?? scene.feetY) - SHEET.skeletIdle.h - 3 : 0,
  });
  if (target.hp <= 0) {
    // Killed — but don't play the death animation yet. The fireball is still
    // charging + flying; the skeleton stays standing (marked `struck`) until the
    // bolt actually lands, then it collapses (see updateEnemies). Count the kill
    // now, since it's already decided.
    target.phase = "struck";
    target.phaseAt = now;
    target.struckUntil = now + CONFIG.castChargeMs + CONFIG.fireballFlightMs;
    state.kills++;
  }

  // Always deal a fresh loadout after a cast — there's always another skeleton
  // walking in behind this one.
  state.pendingRefill = true;
}

function hitPlayer(n) {
  state.heroHP = Math.max(0, state.heroHP - n);
  if (state.heroHP <= 0 && state.screen === "combat") {
    state.runActive = false;   // run is over — the combat nav will start a fresh one
    state.screen = "defeat";
  }
}

function hitEnemy(enemy, n) {
  enemy.hp = Math.max(0, enemy.hp - n);
}

window.Incanto.combat = { handleRuneClick, onShapeComplete, hitPlayer, hitEnemy, livingEnemies, frontEnemy };
