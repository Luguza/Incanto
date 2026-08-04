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
    // How far back each body in this lane may be driven. Walked from the BACK,
    // so a body's ceiling accounts for every rank behind it and not just its
    // neighbour: the rearmost stops at the edge of the visible track (a skeleton
    // punted off camera would just be gone), and each one in front of it stops a
    // body's width short of that. A shove that runs out of hall therefore stalls
    // the queue ahead of it rather than driving the last rank into the dark.
    const ceiling = new Array(group.length);
    for (let i = group.length - 1; i >= 0; i--) {
      const own = trackEdgeTiles(group[i].scale || 1);
      ceiling[i] = i === group.length - 1
        ? own
        : Math.min(own, ceiling[i + 1] - laneSpacing(group[i], group[i + 1]));
    }
    let limit = CONFIG.enemyStandoffTiles; // how far forward the next skeleton may advance
    let chainSettled = true;               // is everything ahead in this lane settled against the hero?
    let frontRank = true;                  // only the lane's leading skeleton stands in melee
    for (let i = 0; i < group.length; i++) {
      const e = group[i];
      const behind = group[i + 1];         // whoever queues up next in this lane
      const front = group[i - 1];          // whoever is queued ahead of it, toward the hero
      // A Frostkegel's shove PROPAGATES down the lane. `limit` is already the
      // tile no body may come in front of; here it also does the pushing, so a
      // body the rank ahead has been driven into is driven back itself. That is
      // what makes the cone bulldoze a whole lane into one clump instead of
      // stopping dead at the first skeleton it didn't catch — and since the rank
      // ahead is sliding smoothly, everything it shunts slides smoothly too.
      //
      // `room` is what the hall actually leaves for that. An over-full lane can
      // have less room than the bodies in it need, so it is floored at the tile
      // the body already stands on: a queue with nowhere to go stalls where it
      // is rather than being dragged forward into the hero.
      const room = Math.max(e.pos, ceiling[i]);
      const shoved = Math.min(Math.max(e.pos, limit), room);
      if (shoved > e.pos + 1e-6 && front && now < (front.frozenUntil || 0)) {
        // Shoved by a body the cone froze, so the ice travels with the shove —
        // and this is what makes the Frostkegel a setup rather than a nudge.
        // The front ranks are driven into the ranks behind, the lane bunches
        // into one clump, and the whole clump ends up frozen, which is exactly
        // what an area spell wants: a frozen body is auto-targeted by the next
        // cast AND shattered by it (see pickTargets and applySpellHit), so the
        // follow-up lands on every skeleton the shove reached, not just the
        // ones the wedge itself covered.
        //
        // The thaw time is INHERITED, never restarted. A body comes loose with
        // whoever shoved it, so a chain of shoves can't keep extending its own
        // freeze, and the clump can't outlast the cone that made it.
        e.frozenUntil = Math.max(e.frozenUntil || 0, front.frozenUntil);
        e.attackAt = Math.max(e.attackAt, e.frozenUntil);
      }
      // Ground the rank in front has already given a body counts against what
      // the cone still owes it: the ice drives a skeleton 2.4 tiles from where
      // it was STANDING, not 2.4 on top of however far it was shunted first.
      // The wedge sweeps outward, so a body is nearly always shunted before the
      // ice reaches it, and letting the two stack fans the lane out down the
      // hall instead of bunching it up. Credited until the slide actually
      // starts — `pushFrom == null` and not `now < pushAt`, because the frame
      // the slide begins on is shunted here first and reads the total below.
      if (shoved > e.pos + 1e-6 && e.pushUntil && e.pushFrom == null) {
        e.shunted = (e.shunted || 0) + (shoved - e.pos);
      }
      e.pos = shoved;
      if (e.phase === "dying" || e.phase === "struck") {
        // a doomed/crumbling skeleton still holds its tile until it's culled, so
        // the ranks behind it can't walk through the corpse
        limit = e.pos + laneSpacing(e, behind);
        chainSettled = false;
        continue;
      }
      // Shoved back by a Frostkegel. The body SLIDES the whole distance across
      // the push window so it travels with the cone that hit it, instead of
      // being teleported down the hall the instant the shape was drawn. The
      // starting tile is read here rather than at cast time: the cast has a
      // wind-up, and the skeleton is still walking through it.
      //
      // Nothing here looks at the rank behind — `room` above is the only bound,
      // and the shove drives whatever is in its way rather than stopping against
      // it. A body that has run out of hall stops where it stands and the ice
      // simply doesn't move it.
      if (e.pushUntil) {
        if (now >= e.pushUntil) {
          if (e.pushFrom != null) e.pos = Math.max(e.pos, Math.min(e.pushTo, room));
          e.pushUntil = 0; e.pushFrom = null;
        } else if (now >= e.pushAt) {
          if (e.pushFrom == null) {
            e.pushFrom = e.pos;
            // Only what the shunt hasn't already delivered is left to slide.
            e.pushTo = Math.max(e.pos, e.pos - (e.shunted || 0) + e.pushBy);
            e.shunted = 0;
          }
          const q = (now - e.pushAt) / Math.max(1, e.pushUntil - e.pushAt);
          const slid = e.pushFrom + (e.pushTo - e.pushFrom) * (1 - (1 - q) * (1 - q));
          e.pos = Math.max(e.pos, Math.min(slid, room));
          e.phase = "frozen";                 // it's iced the moment it's hit
          limit = e.pos + laneSpacing(e, behind);
          chainSettled = false;
          continue;
        }
      }
      // Frozen by a Frostkegel: it neither advances nor swings, but it still
      // holds its tile so the rank behind piles up against the ice rather than
      // walking through it. Breaking the settled chain here is what stops that
      // rank from taking over the melee slot while the leader is iced.
      if (now < (e.frozenUntil || 0)) {
        e.phase = "frozen";
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
          // Reflected through the same funnel as a spell, so an armoured body
          // shrugs part of it off too (hitEnemy returns what actually landed).
          const refl = hitEnemy(e, e.dmg * state.mods.thorns);
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
  } else if (state.screen === "history") {
    if (builtScreen !== "history" || state._structuralDirty) {
      renderHistoryFull();
      builtScreen = "history";
      state._structuralDirty = false;
    }
  } else if (state.screen === "upgrade") {
    if (builtScreen !== "upgrade" || state._structuralDirty) {
      renderUpgradeFull();
      builtScreen = "upgrade";
      state._structuralDirty = false;
    }
  } else if (state.screen === "bookorder") {
    if (builtScreen !== "bookorder" || state._structuralDirty) {
      renderBookOrderFull();
      builtScreen = "bookorder";
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
