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
  // Past the last camp there is nothing left to send: the corridor's remaining
  // stretch is the walk to the door, and it is meant to be quiet (see
  // updateCamera, which ends the run there). No filler either — a skeleton
  // walking in over the ending would be the one place dead air is the point.
  if (!next) return;
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
// are drawn at their own sprite's size, so the gap grows with the pair's average
// width — an ogre and a goblin need more room than two goblins, or the bigger
// sprite would overlap even though their centres are a tile apart.
function laneSpacing(front, behind) {
  return CONFIG.enemyGapTiles * ((bodyTiles(front) + bodyTiles(behind)) / 2);
}

// The pause between a body planting in reach and its first blow: a share of its
// own cadence, floored so nothing opens instantly (see config.js).
function enemyWindupMs(e) {
  const beat = e.atkMs || CONFIG.enemyAttackIntervalMs;
  return Math.max(CONFIG.enemyFirstAttackMs, beat * CONFIG.enemyWindupBeats);
}

// March the mob one frame. Each lane is resolved independently, front-to-back
// (nearest the hero first), so a skeleton is blocked by the standoff line or by
// whoever is ahead of it *in its own lane*, always leaving > 1 tile between
// them — no two ever share a tile (lanes are separate rows). A skeleton walks
// while it has room, idles when stopped out of reach, and only attacks (on its
// own steady cadence) once it settles within attack range. No shared windup bar
// — each keeps its own timer. Finished deaths are culled.
function updateEnemies(now, dt) {
  // A doomed skeleton runs, swings and slides like any other until the blow that
  // killed it actually reaches it. `deathAt` is that arrival (booked by
  // applySpellHit), and it is the ONE thing that starts the collapse — a
  // fireball crosses the hall in nearly half a second and a meteor takes longer
  // still, so a body that halted and began dissolving when the shape was drawn
  // read as dying of nothing, with its own spell still in the air behind it.
  //
  // The dissolve is timed off `deathAt` rather than off `now`, so it starts on
  // the same instant the hit flash punches instead of a frame or two later.
  for (const e of state.enemies) {
    if (e.deathAt && now >= e.deathAt) {
      e.phase = "dying";
      e.phaseAt = e.deathAt;
      e.deathAt = 0;
    }
  }
  // …and a slime that survived one comes apart on the same beat, for the same
  // reason: hitEnemy marked it when the blow was booked, and this is the moment
  // the blow actually arrives. Walked over a snapshot because the halves are
  // pushed onto state.enemies as they appear, and a body born this instant has
  // nothing of its own to resolve yet.
  for (const e of state.enemies.slice()) {
    if (e.splitAt && now >= e.splitAt) {
      e.splitAt = 0;
      splitSlime(e, now);
    }
  }
  // Goo: a walking slime drips a smear behind it every few strides, and every
  // mark on the floor dries out on its own clock. Planted here rather than in
  // the draw so a fight running in the background (the player is off studying,
  // renderScene isn't being called) neither skips its trail nor piles up a list
  // nobody is watching.
  for (const e of state.enemies) {
    if (e.phase !== "walk" || !enemyTypeById(e.type).split) continue;
    if (e.gooPos != null && Math.abs(e.gooPos - e.pos) < CONFIG.slimeTrailStepTiles) continue;
    e.gooPos = e.pos;
    plantGoo(e, now, { jitter: ((e.id * 53) % 5) - 2 });
  }
  cullGoo(now);
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
      const own = trackEdgeTiles(bodyTiles(group[i]));
      ceiling[i] = i === group.length - 1
        ? own
        : Math.min(own, ceiling[i + 1] - laneSpacing(group[i], group[i + 1]));
    }
    let limit = 0;                         // how far forward the next body may advance (0 = the hero's toes)
    let chainSettled = true;               // is everything ahead in this lane settled against the hero?
    let frontRank = true;                  // only the lane's leading body stands in melee
    for (let i = 0; i < group.length; i++) {
      const e = group[i];
      const behind = group[i + 1];         // whoever queues up next in this lane
      const front = group[i - 1];          // whoever is queued ahead of it, toward the hero
      // Where THIS body plants: never in front of the body ahead of it, and
      // never past its own standoff. A melee body's standoff is the hero's
      // melee line; a caster's is out in the hall, which is what keeps it from
      // ever reaching him. Its lane's front slot is reserved for the shortest
      // reach in the pack (see orderRanksByReach), so a caster stopping early
      // never walls its own escort out of the fight.
      const stop = Math.max(limit, e.standoff != null ? e.standoff : CONFIG.enemyStandoffTiles);
      // Small things scurry, big things lumber — the pace is the variant's.
      const step = CONFIG.enemyWalkTilesPerMs * (e.walk || 1) * dt;
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
      const shoved = Math.min(Math.max(e.pos, stop), room);
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
      if (e.phase === "dying") {
        // a crumbling skeleton still holds its tile until it's culled, so the
        // ranks behind it can't walk through the corpse. A body whose killing
        // blow is still in the air is NOT held here — it marches on with the
        // rest of its rank and only stops when the blow lands.
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
      const newPos = Math.max(e.pos - step, stop);
      const blocked = newPos <= stop + 1e-3;
      e.pos = newPos;
      const settled = chainSettled && blocked;
      // WHO GETS TO FIGHT. Only the front body in a lane actually reaches melee
      // and swings; everyone queued behind it idles until it falls and they
      // advance. A body that fights at RANGE is exempt from that queue — it
      // shoots over the heads of the rank in front, so it opens up the moment it
      // has planted, wherever in the lane it stands. That exemption is the whole
      // point of a ranged body: it makes the corridor's back half dangerous, so
      // "kill the front rank" stops being the entire plan.
      const engaged = e.role === "ranged" ? blocked : (frontRank && settled);
      if (engaged && e.pos <= e.range + 1e-3) {
        // Six tenths of its own beat before the first blow — never shorter than
        // the floor, so the quickest bodies still announce themselves (the note
        // at `enemyWindupBeats` in config.js says why it scales with the beat).
        if (e.phase !== "attack") {
          e.phase = "attack";
          e.attackAt = now + enemyWindupMs(e);
        }
      } else if (!blocked) {
        e.phase = "walk";
      } else {
        e.phase = "idle";
      }
      if (e.phase === "attack" && now >= e.attackAt) {
        e.attackAt = now + (e.atkMs || CONFIG.enemyAttackIntervalMs);
        if (e.role === "ranged") fireEnemyShot(now, e);
        else enemyMeleeStrike(now, e);
      }
      // Summoners and healers work off their OWN clock, not the swing timer:
      // they act from the moment they plant, whether or not they are close
      // enough to hit anything, and go on acting while the rank in front does
      // the fighting. Ice stops them the same way it stops a swing.
      if (blocked && (e.role === "summoner" || e.role === "healer")) updateSupport(now, e);
      limit = e.pos + laneSpacing(e, behind);  // next body stays a gap behind this one
      chainSettled = settled;                 // a still-moving body breaks the settled chain
      frontRank = false;                      // everyone after the leader is a back rank
    }
  }
  updateEnemyShots(now);
  state.enemies = state.enemies.filter(
    (e) => !(e.phase === "dying" && now - e.phaseAt >= CONFIG.enemyDeathMs)
  );
}

// A number popping over the HERO, stepped back by the lane the blow came from.
//
// Every hit on the hero lands in the same place, so without the stagger they
// stack on one pixel. That was survivable while a body swung every three or four
// seconds; at the hall's current cadences four lanes' worth of small hits arrive
// inside a single number's lifetime, and one unreadable smear is the difference
// between "I am being ground down" and "something is happening to me".
//
// Up and to the LEFT, one short step per lane, for two reasons: it is the only
// empty corner of the frame — the rune circle sits at the hero's right shoulder
// and a number over it is a number over the one thing the player is aiming at —
// and stepping BOTH ways separates same-width numbers that would still overlap
// side by side. By lane rather than at random, so a given body always pops in
// the same place and the stream reads as several attackers rather than noise.
function popHeroDmgFloat(value, lane) {
  if (!scene || state.screen !== "combat") return;   // nobody is watching a background fight
  const step = Math.max(0, Math.min(CONFIG.enemyLanes - 1, Number(lane) || 0));
  // The hero stands close to the left edge, so the back lane's step has to give
  // way to the number's own width — a giant's three digits stepped the full way
  // over would hang off the frame. Half a digit block is 4 px at the 2 px scale
  // renderDmgFloats draws at; a wide number simply staggers less.
  const halfW = 4 * String(Math.max(0, Math.round(value))).length;
  spawnDmgFloat({
    value,
    color: CONFIG.colors.dmgFloat.hero,
    x: Math.max(halfW + 1, scene.wizard.x + SHEET.wizardIdle.w / 2 - step * 6),
    y: scene.wizard.y - 4 - step * 4,
  });
}

// A body's swing connecting with the hero: the damage, the forward jab, the
// number over his head, and whatever Dornen sends back the other way.
function enemyMeleeStrike(now, e) {
  hitPlayer(e.dmg);
  e.attackAnimAt = now;                 // fire the forward-jab animation
  // Pop the damage number over the hero, in sync with the body's jab. Both pops
  // below are for the combat screen only — off-screen (background) combat has no
  // one to show the numbers to, and they'd pile up unseen.
  const onScreen = scene && state.screen === "combat";
  popHeroDmgFloat(e.dmg, e.lane);
  // Thorns: reflect a slice of the blow back onto the attacker.
  if (state.mods.thorns > 0) {
    // Reflected through the same funnel as a spell, so an armoured body
    // shrugs part of it off too (hitEnemy returns what actually landed).
    const refl = hitEnemy(e, e.dmg * state.mods.thorns, now);
    if (onScreen) {
      spawnDmgFloat({
        value: refl,
        color: CONFIG.colors.dmgFloat.enemy,
        targetId: e.id,
        x: scene.enemyLineX + e.pos * TILE,
        y: (scene.laneY[e.lane] ?? scene.feetY) - enemyArt(e).h - 3,
      });
    }
    // Thorns are CONTACT damage — there is nothing in flight to wait for, so a
    // body it finishes drops on the spot. A body already doomed by a spell still
    // crossing the hall is left alone: its death is booked (and counted) for the
    // moment that spell arrives, and killing it twice would credit two kills.
    if (e.hp <= 0 && !doomed(e)) { e.phase = "dying"; e.phaseAt = now; creditKill(); }
  }
}

// ---------------------------------------------------------------------------
// Ranged fire. A bolt is a real travelling object rather than a hitscan: the
// shot is booked here and lands in updateEnemyShots when it reaches the hero.
//
// That ordering is deliberate. It gives the player something to SEE coming
// across a corridor where the shooter itself may be twenty pixels of imp behind
// two ranks of orc, and it means a bolt already in the air still arrives when
// the hero kills its caster mid-flight — which is what stops "kill the back
// rank" from being a free undo. The shot carries its own damage, so nothing
// about it has to reach back for a body that may no longer exist.
// ---------------------------------------------------------------------------
function fireEnemyShot(now, e) {
  const type = enemyTypeById(e.type);
  const shot = type.shot || {};
  const travel = shot.ms || 400;
  e.attackAnimAt = now;                 // the shooter rocks forward as it throws
  if (!state.enemyShots) state.enemyShots = [];
  state.enemyShots.push({
    shooterId: e.id,
    dmg: e.dmg,
    lane: e.lane,                       // which column its number pops in when it lands
    rgb: shot.rgb || CONFIG.colors.dmgFloat.hero,
    born: now,
    landAt: now + travel,
    // Where it left from, snapshotted now: the caster may be dust by the time
    // the mote arrives, and a bolt that re-reads a dead shooter's position would
    // snap back to the origin on the frame it dies.
    from: scene ? { x: scene.enemyLineX + e.pos * TILE, y: (scene.laneY[e.lane] ?? scene.feetY) - e.h * 0.55 } : null,
  });
}

// Bolts in flight: land the ones that have arrived, cull the ones whose splash
// has faded. Damage is applied here — off the combat screen too, since the run
// plays out in the background and a shot fired there still has to hurt.
function updateEnemyShots(now) {
  const shots = state.enemyShots;
  if (!shots || !shots.length) return;
  const keep = [];
  for (const s of shots) {
    if (!s.hit && now >= s.landAt) {
      s.hit = true;
      hitPlayer(s.dmg);
      popHeroDmgFloat(s.dmg, s.lane);
    }
    if (now < s.landAt + CONFIG.enemyShotFadeMs) keep.push(s);
  }
  state.enemyShots = keep;
}

// ---------------------------------------------------------------------------
// Support: the two bodies that don't try to kill the hero at all.
//
// A SUMMONER refills the hall — left alone it calls in bodies faster than a
// small spell empties the floor, so it is the one enemy that punishes killing in
// the order the queue offers. Its budget (`max`) is a lifetime total, so a fight
// the player stalls out on can't grow without bound.
//
// A HEALER mends the most wounded body it can see. That is the hall's DAMAGE
// CHECK in its purest form: a hero whose spell chips at a masked orc for less
// than the shaman puts back will stand there until the corridor kills him, no
// matter how much HP he has. Growing the tree is the answer; so is killing the
// shaman first, which is the lesson.
// ---------------------------------------------------------------------------
function updateSupport(now, e) {
  const type = enemyTypeById(e.type);
  const spec = type.summon || type.heal;
  if (!spec) return;
  if (now < (e.frozenUntil || 0)) return;    // iced: the chant stops with everything else
  // First act is delayed from the moment it plants, so a caster that has just
  // walked into frame doesn't fire on its arrival frame.
  if (!e.actAt) { e.actAt = now + (spec.firstMs || spec.everyMs); return; }
  if (now < e.actAt) return;
  e.actAt = now + spec.everyMs;
  if (type.summon) summonBodies(now, e, type.summon);
  else mendAlly(now, e, type.heal);
}

// Bodies walk out of a rune the caster opens IN FRONT of itself, never behind:
// a lane is a strict queue, so minions called up at the caster's back would be
// walled in by the caster itself and would stand there for the rest of the fight
// instead of joining it. Lanes rotate outward from the caster's own, so a long
// chant spreads its bodies across the floor rather than stacking one column.
function summonBodies(now, e, spec) {
  if (!e.summonsLeft) return;
  const lanes = Math.max(1, CONFIG.enemyLanes);
  let called = 0;
  for (let i = 0; i < spec.count && e.summonsLeft > 0; i++) {
    if (livingEnemies().length >= CONFIG.enemyMaxCount) break;
    e.summonTick = (e.summonTick || 0) + 1;
    // 0, +1, -1, +2, -2 … out from the caster's lane.
    const k = Math.ceil(e.summonTick / 2) * (e.summonTick % 2 ? 1 : -1);
    const lane = clampLane(e.lane + (e.summonTick === 1 ? 0 : k));
    spawnEnemy(now, lane, Math.max(CONFIG.enemyStandoffTiles, e.pos - CONFIG.enemySummonGapTiles), spec.type);
    e.summonsLeft--;
    called++;
  }
  if (called) e.actFxAt = now;              // the rune flares under the caster
}

// The mend: the most wounded body within reach, healed for a share of ITS OWN
// pool — so a shaman is worth far more to an ogre than to a goblin, and the
// player is being asked to read the pack rather than the front of the queue.
// The caster itself is a candidate, but only once everything else is whole.
function mendAlly(now, e, spec) {
  let best = null, worst = 1;
  for (const other of state.enemies) {
    if (doomed(other)) continue;   // no mending a body with a bolt already in the air
    if (other.hp >= other.maxHP) continue;
    if (Math.abs(other.pos - e.pos) > spec.radius) continue;
    const frac = other.hp / other.maxHP;
    if (best && frac >= worst) continue;
    worst = frac;
    best = other;
  }
  if (!best) return;
  const healed = Math.min(best.maxHP - best.hp, Math.max(1, Math.round(best.maxHP * spec.frac)));
  best.hp += healed;
  e.healTargetId = best.id;
  e.actFxAt = now;
  if (scene && state.screen === "combat") {
    spawnDmgFloat({
      value: healed,
      color: CONFIG.colors.spell.heal.rgb,
      targetId: best.id,
      x: scene.enemyLineX + best.pos * TILE,
      y: (scene.laneY[best.lane] ?? scene.feetY) - best.h - 3,
    });
  }
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
  // camp is met at the metre the plan says and not a stride beyond it. Once
  // every camp has been met the only mark left is the door at the end of the
  // hall, and he pulls up on that the same way.
  const mark = nextMark(state.packIndex);
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
  if (state.distance > (state.deepest || 0)) state.deepest = state.distance;
  // The door. The hall is finite (see encounters.HALL_END_METRES), and walking
  // onto its last metre is the one way a run ends that isn't dying.
  if (state.distance >= HALL_END_METRES - 1e-6) clearHall();
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
      // Regen is never clipped (see CONFIG.treeTotals): how much of it a build
      // carries is how many Genesung nodes it walked to. At the pace the tree
      // supplies it, an early build still cannot out-heal a full mob, so regen still
      // reads as a between-fights safety net rather than an autopilot.
      if (state.mods.regen > 0 && state.heroHP < state.heroMaxHP) {
        state.heroHP = Math.min(state.heroMaxHP, state.heroHP + state.mods.regen * effectiveDt / 1000);
      }
      updateSpawns(now);
      updateEnemies(now, effectiveDt);
      // A Meteoritenschauer resolves rock by rock as it comes down rather than
      // all at once at the cast (see updateMeteorRocks) — so it ticks with the
      // rest of the fight, and keeps falling while the player is off studying,
      // exactly as the bodies keep walking.
      updateMeteorRocks(now);
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
    // The web is a canvas, so the one thing on it that moves — the ring round
    // the selected node — has to be drawn on the clock like any other animation.
    patchTreeContinuous();
  } else if (state.screen === "bookorder") {
    if (builtScreen !== "bookorder" || state._structuralDirty) {
      renderBookOrderFull();
      builtScreen = "bookorder";
      state._structuralDirty = false;
    }
  } else if (state.screen === "stats") {
    if (builtScreen !== "stats" || state._structuralDirty) {
      renderStatsFull();
      builtScreen = "stats";
      state._structuralDirty = false;
    }
  } else if (state.screen === "tavern") {
    if (builtScreen !== "tavern" || state._structuralDirty) {
      renderTavernFull();
      builtScreen = "tavern";
      state._structuralDirty = false;
    }
    // The room is alive whether or not a run is: the mage strolls, the fire
    // burns and the maid does her round on the rAF clock, not the run's.
    patchTavernContinuous(now);
  } else {
    if (builtScreen !== state.screen) {
      renderEndFull();
      builtScreen = state.screen;
    }
  }
  updateNav();
}
window.Incanto.loop = { rafLoop, render, logAttempt, laneSpacing };
