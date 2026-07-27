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

// ---------------------------------------------------------------------------
// Game loop — combat always runs in real time.
// ---------------------------------------------------------------------------
function getEffectiveDt(rawDt) {
  return rawDt;
}

// Walk the hero into the next designed encounter. Enemies do not trickle in on
// a timer any more: the run is a fixed sequence of PACKS laid out along the hall
// at fixed metre marks (see encounters.js), and crossing a mark sends that pack
// in. Nothing here is random, so the same distance always produces the same
// fight — which is what makes the packs designable in the first place.
//
// Reaching a camp's metre mark is the whole trigger — distance and nothing else.
// There is no check here on what is still alive, because there doesn't need to
// be: updateCamera only lets the hero travel while the hall is empty, so by the
// time distance reaches the next mark the previous camp is already dead and
// gone. That is what keeps two camps from ever stacking without the spawner
// having to arbitrate it.
//
// `state.packIndex` walks the plan and never rewinds, so every camp is met in
// order, at its own mark.
//
// The walk between camps is a real walk, not a dash, so the corridor can stand
// empty for a few seconds on the way. That gap is filled by a LONE SKELETON —
// not by the next camp. Pulling a camp forward would spend a designed encounter
// to patch a quiet moment and land it somewhere other than its mark; a filler
// costs the plan nothing, so the marks stay exactly where they were authored.
function updateSpawns(now) {
  // Track how long the corridor has been visibly bare — dissolving skeletons
  // still count as occupied, since they're drawn.
  const empty = sceneIsEmpty();
  if (empty) {
    if (!state.emptySinceMs) state.emptySinceMs = now;
  } else {
    state.emptySinceMs = 0;
  }
  const starved = empty && now - state.emptySinceMs >= CONFIG.enemyMaxEmptyMs;

  // Something is already on its way but hasn't made it into frame. Close the gap
  // on it rather than send anything new — whatever is inbound is about to arrive.
  if (starved && state.enemies.length) { advanceInboundPack(); return; }

  const next = encounterAt(state.packIndex);
  if (state.distance >= next.at) {
    spawnPack(now, next);
    state.packIndex++;
    return;
  }

  // Still short of the next mark with an empty hall: send one skeleton to keep
  // the corridor alive. It lands in frame rather than off camera, so the bare
  // stretch really does end at `enemyMaxEmptyMs` instead of running on through
  // its walk-in — and so it can't be sniped before it ever appears, since the
  // hero's spell auto-targets the frontmost living skeleton whether or not it's
  // on screen. Restart the clock so its arrival isn't immediately followed by
  // another.
  if (starved) {
    spawnFiller(now);
    state.emptySinceMs = now;
  }
}

// Clearance (in tiles) between two neighbours queued in the same lane. Bodies
// are drawn at their variant's scale, so the gap grows with the pair's average
// size — two brutes need more room than two plain skeletons, or the bigger
// sprites would overlap even though their centres are a tile apart.
function laneSpacing(front, behind) {
  const a = (front && front.scale) || 1;
  const b = (behind && behind.scale) || 1;
  return CONFIG.enemyGapTiles * ((a + b) / 2);
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
    for (let i = 0; i < group.length; i++) {
      const e = group[i];
      const behind = group[i + 1];         // whoever queues up next in this lane
      if (e.phase === "dying" || e.phase === "struck") {
        // a doomed/crumbling skeleton still holds its tile until it's culled, so
        // the ranks behind it can't walk through the corpse
        limit = e.pos + laneSpacing(e, behind);
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
        // Both the windup and the steady cadence are divided by the variant's
        // attack-speed multiplier, so a brute engages and swings quicker.
        if (e.phase !== "attack") { e.phase = "attack"; e.attackAt = now + CONFIG.enemyFirstAttackMs / (e.atkSpeed || 1); }
      } else if (!blocked) {
        e.phase = "walk";
      } else {
        e.phase = "idle";
      }
      if (e.phase === "attack" && now >= e.attackAt) {
        hitPlayer(e.dmg);
        e.attackAnimAt = now;                 // fire the forward-jab animation
        e.attackAt = now + CONFIG.enemyAttackIntervalMs / (e.atkSpeed || 1);
        // Pop the damage number over the hero, in sync with the skeleton's jab.
        // Only while the fight is on screen — off-screen (background) combat has
        // no one to show the numbers to, and they'd pile up unseen.
        const onScreen = scene && state.screen === "combat";
        if (onScreen) {
          spawnDmgFloat({
            value: e.dmg,
            color: CONFIG.colors.dmgFloat.hero,
            x: scene.wizard.x + SHEET.wizardIdle.w / 2,
            y: scene.wizard.y - 4,
          });
        }
        // Thorns: reflect a slice of the blow back onto the attacker.
        if (state.mods.thorns > 0) {
          const refl = Math.max(1, Math.round(e.dmg * state.mods.thorns));
          hitEnemy(e, refl);
          if (onScreen) {
            spawnDmgFloat({
              value: refl,
              color: CONFIG.colors.dmgFloat.enemy,
              targetId: e.id,
              x: scene.enemyLineX + e.pos * TILE,
              y: (scene.laneY[e.lane] ?? scene.feetY) - enemyArt(e).h - 3,
            });
          }
          if (e.hp <= 0) { e.phase = "dying"; e.phaseAt = now; state.kills++; }
        }
      }
      limit = e.pos + laneSpacing(e, behind);  // next skeleton stays a gap behind this one
      chainSettled = settled;                 // a still-moving skeleton breaks the settled chain
      frontRank = false;                      // everyone after the leader is a back rank
    }
  }
  state.enemies = state.enemies.filter(
    (e) => !(e.phase === "dying" && now - e.phaseAt >= CONFIG.enemyDeathMs)
  );
}

// Travel down the hall between camps. The hero holds his spot on screen; panning
// the corridor left reads as him striding forward. `pos` is tiles from the hero,
// so an enemy's screen x is `enemyLineX + pos * TILE`, independent of the scroll
// (no feedback).
//
// He moves ONLY while the hall is empty — of anything, a camp or a lone filler
// skeleton alike. The moment something musters he plants and fights it, and he
// doesn't set off again until it's dead and its dissolve has finished. That
// single rule is what lets updateSpawns trigger on distance alone: with no ground
// gained during a fight, the hero physically cannot walk far enough to trip the
// next camp's mark while the current one is still standing, so two camps can
// never stack.
//
// It holds for reasons a wider mark spacing would not. The ground he'd otherwise
// cover while a camp closed on him scales with `mods.walkMult` (uncapped — the
// tree's Flinkheit nodes repeat) and with the viewport width (a wider canvas is a
// longer approach), so no fixed spacing could stay ahead of it. Gating on the
// camp itself is immune to both.
function updateCamera(now, dt) {
  if (!scene) return;
  let clear = state.enemies.length === 0;
  // Hold position while a spell is charging or its bolt is in flight, so the
  // cast and its impact land against a still background instead of streaking
  // across a moving one. (A backfire has no target and so no enemies to gate on.)
  //
  // Only while that's actually being watched: `castAt` is cleared by renderScene,
  // which doesn't run on the quiz or upgrade screens, so a cast left in flight
  // when the player walks away stays set indefinitely. Holding on it there would
  // freeze the hero for as long as they studied — and since travel is what
  // triggers every camp, the whole background run would stall with it.
  if (state.castAt && state.screen === "combat") clear = false;
  // Walking pace. Fortune's walk-speed nodes scale it, up to a ceiling: past that
  // a single frame's coast on the way to a stop could carry the hero over the
  // next mark, which is the one thing this design must not allow.
  const pace = Math.min(
    CONFIG.heroWalkPxPerMs * state.mods.walkMult,
    CONFIG.heroWalkMaxPxPerMs
  );
  const targetVel = clear ? pace : 0;
  // Ease with a frame-rate-independent time constant so he sets off and pulls up
  // rather than snapping. Planting is quicker than setting off, so he arrives on
  // his mark rather than drifting past it.
  const k = 1 - Math.exp(-dt / (clear ? CONFIG.heroWalkEaseMs : CONFIG.heroHaltEaseMs));
  state.cameraVel += (targetVel - state.cameraVel) * k;
  if (state.cameraVel < 1e-4) state.cameraVel = 0;
  let advanced = state.cameraVel * dt;
  // Pull up exactly on the next camp's mark rather than drifting past it, so a
  // camp is met at the metre the plan says and not a stride beyond it.
  const mark = encounterAt(state.packIndex).at;
  const remaining = (mark - state.distance) * TILE;
  if (advanced > remaining) advanced = Math.max(0, remaining);
  state.cameraX += advanced;
  // Footstep cadence is driven by ground covered, not by wall time, so the bob
  // quickens with the pace and freezes when he plants — and never jumps phase the
  // way retuning a time-based sine would.
  state.stridePhase += advanced;
  // Metres walked this run: the same advance in tile units. This is the run's
  // depth gauge — it's what trips the encounter plan (see updateSpawns), so the
  // hero meets camps by walking to them.
  state.distance += advanced / TILE;
}

let lastRafNow = null;
function rafLoop(now) {
  // The whole frame is wrapped so a single stray exception can never kill the
  // loop. If it did, the screen would freeze while the input handlers keep
  // mutating state — clicks (the phase nav especially) would change `state`
  // but never repaint, so the game looks dead / the nav looks broken. Log the
  // error, skip the bad frame, and always reschedule so the loop self-heals.
  try {
    if (lastRafNow === null) lastRafNow = now;
    const rawDt = now - lastRafNow;
    lastRafNow = now;

    // A live run plays out in real time even while the player is off on the
    // quiz or upgrade screen — the fight continues in the background, so the
    // hero keeps taking hits (which is what limits how long you can linger away
    // studying). Simulation stops the moment the hero falls (runActive clears in
    // hitPlayer) or when there's no run to advance.
    if (state.runActive && state.heroHP > 0) {
      const effectiveDt = getEffectiveDt(rawDt);
      state.clockMs += effectiveDt;
      // Sustain: trickle HP back while the run is live, all the way to full.
      // CONFIG.caps.regen keeps the rate below a real mob's DPS, so regen still
      // reads as a between-fights safety net rather than an autopilot.
      if (state.mods.regen > 0 && state.heroHP < state.heroMaxHP) {
        state.heroHP = Math.min(state.heroMaxHP, state.heroHP + state.mods.regen * effectiveDt / 1000);
      }
      updateSpawns(now);
      updateEnemies(now, effectiveDt);
      updateCamera(now, effectiveDt);
      // Rune refill + the deferred tap-cast only make progress at the circle
      // (the player can't cast from another screen), so both are gated on the
      // combat screen — running them in the background would desync the board.
      if (state.pendingRefill && state.screen === "combat" && now >= state.shapeFlashUntil) {
        state.pendingRefill = false;
        populateCircle(drawLoadout());
      }
      if (state.pendingShapeAt && state.screen === "combat" && now >= state.pendingShapeAt) {
        state.pendingShapeAt = 0;
        onShapeComplete(now);
      }
    }

    render(now);
  } catch (err) {
    console.error("rafLoop frame error (loop kept alive):", err);
  }
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
window.Incanto.loop = { rafLoop, render, logAttempt, laneSpacing };
