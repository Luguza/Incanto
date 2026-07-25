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

// Drip a new skeleton into the arena on the random schedule, unless we're
// already at the on-screen cap. Either way, re-arm the timer for the next
// arrival so the trickle keeps a steady but irregular rhythm.
function updateSpawns(now) {
  if (now < state.nextSpawnAt) return;
  if (livingEnemies().length < CONFIG.enemyMaxCount) spawnEnemy(now);
  state.nextSpawnAt = now + randomSpawnDelay();
}

// March the mob one frame. Each lane is resolved independently, front-to-back
// (nearest the hero first), so a skeleton is blocked by the standoff line or by
// whoever is ahead of it *in its own lane*, always leaving > 1 tile between
// them — no two ever share a tile (lanes are separate rows). A skeleton walks
// while it has room, idles when stopped out of reach, and only attacks (on its
// own steady cadence) once it settles within attack range. No shared windup bar
// — each keeps its own timer. Finished deaths are culled.
function updateEnemies(now, dt) {
  const step = CONFIG.enemyWalkTilesPerMs * dt;
  // A struck skeleton stands its ground until the bolt lands, then it collapses:
  // that's when the death animation begins (phaseAt resets so the dissolve runs
  // cleanly from here).
  for (const e of state.enemies) {
    if (e.phase === "struck" && now >= e.struckUntil) {
      e.phase = "dying";
      e.phaseAt = now;
    }
  }
  const lanes = new Map();
  for (const e of state.enemies) {
    if (!lanes.has(e.lane)) lanes.set(e.lane, []);
    lanes.get(e.lane).push(e);
  }
  for (const group of lanes.values()) {
    group.sort((a, b) => a.pos - b.pos);
    let limit = CONFIG.enemyStandoffTiles; // how far forward the next skeleton may advance
    let chainSettled = true;               // is everything ahead in this lane settled against the hero?
    let frontRank = true;                  // only the lane's leading skeleton stands in melee
    for (const e of group) {
      if (e.phase === "dying" || e.phase === "struck") {
        // a doomed/crumbling skeleton still holds its tile until it's culled, so
        // the ranks behind it can't walk through the corpse
        limit = e.pos + CONFIG.enemyGapTiles;
        chainSettled = false;
        continue;
      }
      const newPos = Math.max(e.pos - step, limit);
      const blocked = newPos <= limit + 1e-3;
      e.pos = newPos;
      const settled = chainSettled && blocked;
      // Only the front skeleton in the lane actually reaches melee and swings;
      // everyone queued behind it just idles until it falls and they advance.
      if (frontRank && settled && e.pos <= CONFIG.enemyAttackRangeTiles + 1e-3) {
        if (e.phase !== "attack") { e.phase = "attack"; e.attackAt = now + CONFIG.enemyFirstAttackMs; }
      } else if (!blocked) {
        e.phase = "walk";
      } else {
        e.phase = "idle";
      }
      if (e.phase === "attack" && now >= e.attackAt) {
        hitPlayer(e.dmg);
        e.attackAnimAt = now;                 // fire the forward-jab animation
        e.attackAt = now + CONFIG.enemyAttackIntervalMs;
        // Pop the damage number over the hero, in sync with the skeleton's jab.
        if (scene) {
          spawnDmgFloat({
            value: e.dmg,
            color: CONFIG.colors.dmgFloat.hero,
            x: scene.wizard.x + SHEET.wizardIdle.w / 2,
            y: scene.wizard.y - 4,
          });
        }
        // Thorns: reflect a slice of the blow back onto the attacker.
        if (state.mods.thorns > 0 && e.phase === "attack") {
          const refl = Math.max(1, Math.round(e.dmg * state.mods.thorns));
          hitEnemy(e, refl);
          spawnDmgFloat({
            value: refl,
            color: CONFIG.colors.dmgFloat.enemy,
            targetId: e.id,
            x: scene ? scene.enemyLineX + e.pos * TILE : 0,
            y: scene ? (scene.laneY[e.lane] ?? scene.feetY) - SHEET.skeletIdle.h - 3 : 0,
          });
          if (e.hp <= 0) { e.phase = "dying"; e.phaseAt = now; state.kills++; }
        }
      }
      limit = e.pos + CONFIG.enemyGapTiles;   // next skeleton stays a gap behind this one
      chainSettled = settled;                 // a still-moving skeleton breaks the settled chain
      frontRank = false;                      // everyone after the leader is a back rank
    }
  }
  state.enemies = state.enemies.filter(
    (e) => !(e.phase === "dying" && now - e.phaseAt >= CONFIG.enemyDeathMs)
  );
}

// Advance the hallway camera while the near stretch of floor is clear. The hero
// holds his spot on screen; panning the corridor left reads as him striding
// forward. He halts the instant a skeleton crosses into the near two-thirds —
// that's when he plants to fight. `pos` is tiles from the hero, so the enemy's
// screen x is `enemyLineX + pos * TILE`, independent of the scroll (no feedback).
function updateCamera(now, dt) {
  if (!scene) return;
  const boundary = scene.artW * CONFIG.heroWalkClearFraction;
  let clear = true;
  for (const e of livingEnemies()) {
    if (scene.enemyLineX + e.pos * TILE < boundary) { clear = false; break; }
  }
  // Ease the pan velocity toward its target (full speed when clear, 0 when a
  // skeleton is near) with a frame-rate-independent time constant, so the hero
  // accelerates into his stride and coasts to a stop instead of snapping.
  // Fortune's walk-speed nodes scale the stride pace.
  const walkSpeed = CONFIG.heroWalkPxPerMs * state.mods.walkMult;
  const targetVel = clear ? walkSpeed : 0;
  const k = 1 - Math.exp(-dt / CONFIG.heroWalkEaseMs);
  state.cameraVel += (targetVel - state.cameraVel) * k;
  if (state.cameraVel < 1e-4) state.cameraVel = 0;
  state.cameraX += state.cameraVel * dt;
  state.heroWalking = state.cameraVel > walkSpeed * 0.15;
}

let lastRafNow = null;
function rafLoop(now) {
  if (lastRafNow === null) lastRafNow = now;
  const rawDt = now - lastRafNow;
  lastRafNow = now;

  if (state.screen === "combat") {
    const effectiveDt = getEffectiveDt(rawDt);
    state.clockMs += effectiveDt;
    // Sustain: trickle HP back while the run is live.
    if (state.mods.regen > 0 && state.heroHP > 0 && state.heroHP < state.heroMaxHP) {
      healHero(state.mods.regen * effectiveDt / 1000);
    }
    updateSpawns(now);
    updateEnemies(now, effectiveDt);
    updateCamera(now, effectiveDt);
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
  updateNav();
}
window.Incanto.loop = { rafLoop, render, logAttempt };
