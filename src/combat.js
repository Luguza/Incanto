"use strict";
// ==============================================================================
// combat.js — rune matching + spell resolution. Owns: handleRuneClick,
// onShapeComplete, hitPlayer, enemyHitPlayer, hitEnemy, armorReduction,
// heroArmorReduction, TAP_TRACE_MS.
// ==============================================================================

// ---------------------------------------------------------------------------
// Combat logic
// ---------------------------------------------------------------------------
// How long the staff spends tracing to the pair's second rune after a tap match
// (before it rests, or before the third pair releases the spell).
const TAP_TRACE_MS = 240;

// A body whose death is already booked. `deathAt` is set the moment a fatal hit
// is resolved but names a moment in the FUTURE — when the bolt, rock or wedge
// actually reaches it (see applySpellHit). In between, it is still on its feet
// and still marching; it just can't be saved. So it is a separate question from
// its phase, which goes on saying what the body is visibly doing.
function doomed(e) {
  return e.phase === "dying" || !!e.deathAt;
}

// Enemies a spell can still meaningfully hit: on their feet and not already
// doomed. A skeleton with a killing blow in the air is excluded here — the next
// cast picks a new target instead of wasting itself on a corpse-to-be.
function livingEnemies() {
  return state.enemies.filter((e) => !doomed(e));
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
  // Feed the learning history: a correct link credits the pair it joined, a
  // wrong one blames both words that were confused (see vocab-history.js).
  recordRuneMatch(correct ? [first.pairId] : [first.pairId, rune.pairId], correct);
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
    // Ward's fail-protection can, by chance, ward off the harmful blast entirely
    // (the board still re-deals — the spell still failed).
    state.wrongFlashUntil = now + CONFIG.wrongFlashDurationMs;
    state.runeFlashUntil = now + CONFIG.runeFlashDurationMs;
    const warded = Math.random() < state.mods.spellFailProt;
    if (!warded) {
      state.heroBlastUntil = now + CONFIG.heroBlastMs;
      hitPlayer(Math.max(1, Math.round(state.heroMaxHP * CONFIG.wrongPenaltyFraction)));
    }
    setTimeout(() => {
      if (state.screen === "combat") populateCircle(drawLoadout());
    }, CONFIG.runeFlashDurationMs);
  }
}

function onShapeComplete(now) {
  // The three completed chords lighting up together *is* the cast. The rune
  // charge, the flash and the refill are the same whatever is being cast; WHAT
  // goes off is the page the hero's book is open at, so the resolution itself is
  // handed to spells.js (which also applies leech and Ward's chance shield).
  state.shapeFlashUntil = now + CONFIG.shapeFlashDurationMs;
  state.castAt = now;
  state.castSpell = activeSpellId();                     // drives the cast's colour + effect
  state.castChords = state.chords.map((c) => ({ ...c })); // survives the refill

  castActiveSpell(now);

  // Always deal a fresh loadout after a cast — there's always another skeleton
  // walking in behind this one.
  state.pendingRefill = true;
}

function healHero(n) {
  state.heroHP = Math.min(state.heroMaxHP, state.heroHP + n);
}

// The share of an incoming blow the hero's own plate turns aside. Same curve the
// bodies wear (see armorReduction below), read from the other side of the swing,
// and for the same reason: damage in this hall trickles in small integers at one
// end of the corridor and lands in three-digit strokes at the other, so only a
// FRACTION means the same thing at both ends. CONFIG.heroArmorK sets how many
// points buy how much, and the cap keeps three tenths of every blow arriving.
function heroArmorReduction() {
  const armor = state.mods && state.mods.armor > 0 ? state.mods.armor : 0;
  if (armor <= 0) return 0;
  return Math.min(CONFIG.heroArmorMaxReduction, armor / (armor + CONFIG.heroArmorK));
}

// What one enemy blow actually costs, plate included — the figure that leaves
// the HP bar and the figure that pops over the hero, which have to be the same
// number or the mitigation is invisible.
//
// It lives HERE and not inside hitPlayer on purpose. hitPlayer is also how the
// rune circle's backfire reaches the hero, and armour must not touch that: a
// wrong match is the one moment in the game that is purely the player's answer,
// so nothing bought in the forge may soften it (see CONFIG.heroArmorK). Every
// caller that is a BODY hitting the hero goes through this; the backfire calls
// hitPlayer directly.
//
// Floored at 1 for the same reason a spell hit on an armoured body is: plate
// makes a blow small, never nothing.
function enemyHitPlayer(raw) {
  const dealt = Math.max(1, Math.round(raw * (1 - heroArmorReduction())));
  hitPlayer(dealt);
  return dealt;
}

function hitPlayer(n) {
  // A Ward shield soaks damage before the HP pool does.
  if (state.heroShield > 0) {
    const absorbed = Math.min(state.heroShield, n);
    state.heroShield -= absorbed;
    n -= absorbed;
  }
  if (n <= 0) return;
  state.heroHP = Math.max(0, state.heroHP - n);
  if (state.heroHP <= 0 && state.runActive) {
    // The run is over the instant the hero falls — even if the fight was playing
    // out in the background while the player studied or shopped. Only pull them
    // to the reward screen if they're actually watching combat; otherwise leave
    // them where they are (the dead run simply won't resume, and the next trip to
    // combat starts fresh).
    state.runActive = false;
    // How deep this run got is meta-progression like the reward bank, so it is
    // banked the moment the run ends rather than waiting on the next kill.
    saveProgress();
    if (state.screen === "combat") state.screen = "reward";
  }
}

// The fraction of an incoming hit this body's armour turns aside. Ratio-based
// (see CONFIG.armorK), so it is scale-free: a 2-damage meteor rock and a
// 40-damage fireball both lose the same share, which is what keeps the
// many-small-hits pages of the book playable against an armoured target. The
// hero's penetration shreds armour POINTS first, so a pen build bends the whole
// curve down rather than chipping at the far end of it.
function armorReduction(enemy) {
  const armor = Math.max(0, (enemy.armor || 0) - (state.mods.armorPen || 0));
  if (armor <= 0) return 0;
  return Math.min(CONFIG.armorMaxReduction, armor / (armor + CONFIG.armorK));
}

// The ONE place a skeleton's HP goes down, and therefore the one place armour is
// applied — a spell hit, a shattered freeze, a thorns reflection all land here,
// so none of them can quietly bypass the mitigation. Takes RAW damage, returns
// what actually landed, so whoever called it can pop that number, feed leech
// with it and decide the kill from the same figure the HP bar lost. Floored at 1
// after mitigation: armour makes a hit small, never nothing.
function hitEnemy(enemy, n, at = performance.now()) {
  const dealt = Math.max(1, Math.round(n * (1 - armorReduction(enemy))));
  enemy.hp = Math.max(0, enemy.hp - dealt);
  // Some bodies do more than lose a bar when they are hurt: a slime divides into
  // two of the size below it. This hangs off hitEnemy rather than off the
  // resolvers because hitEnemy is the single funnel every point of damage in the
  // game passes through — a meteor rock, a fifth chain hop and a Dornen
  // reflection all have to divide a slime the same way, and none of them should
  // have to know that slimes exist.
  //
  // A SLIME ABOVE THE FLOOR DOES NOT DIE. It is not killed by a big enough hit;
  // it comes apart, and only the smallest rung — which has nothing left to become
  // — actually dies. That is the difference between a mechanic and a curiosity:
  // gated on SURVIVING the blow, it fired for a fresh hero and stopped firing the
  // moment a grown one could one-shot 60 HP, which is every build past the first
  // handful of nodes. Killing the big one has to spawn the small ones or the
  // ladder is only ever seen by a player who hasn't bought anything yet.
  //
  // Mechanically that is this one line: a blow that would empty the bar leaves it
  // on 1 instead, so no caller ever sees a dead slime and none of them books a
  // death or credits a kill for it (see applySpellHit). The 1 HP never reaches
  // the screen — the split resolves on the next tick and hands the body a full
  // bar at its new size. `canSplit` carries the head-count cap, so a floor that
  // is already full lets the slime die normally rather than making it immortal.
  //
  // The split is only MARKED here, for exactly the reason a killing blow only
  // books `deathAt`: a spell resolves the instant its shape is drawn, but `at` is
  // when the effect actually arrives — nearly half a second later for a
  // Feuerball, longer for a meteor. Done on the spot, a slime would come apart
  // while the spell that split it was still visibly crossing the hall.
  // updateEnemies carries both out on the beat the blow lands.
  if (enemy.hp <= 0 && canSplit(enemy)) enemy.hp = 1;
  if (enemy.hp > 0) enemy.splitAt = at;
  return dealt;
}

window.Incanto.combat = { handleRuneClick, onShapeComplete, hitPlayer, enemyHitPlayer, hitEnemy,
  armorReduction, heroArmorReduction, healHero, doomed, livingEnemies, frontEnemy };
