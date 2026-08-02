"use strict";
// ==============================================================================
// combat.js — rune matching + spell resolution. Owns: handleRuneClick,
// onShapeComplete, hitPlayer, hitEnemy, armorReduction, TAP_TRACE_MS.
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
    // to the defeat screen if they're actually watching combat; otherwise leave
    // them where they are (the dead run simply won't resume, and the next trip to
    // combat starts fresh).
    state.runActive = false;
    if (state.screen === "combat") state.screen = "defeat";
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
function hitEnemy(enemy, n) {
  const dealt = Math.max(1, Math.round(n * (1 - armorReduction(enemy))));
  enemy.hp = Math.max(0, enemy.hp - dealt);
  return dealt;
}

window.Incanto.combat = { handleRuneClick, onShapeComplete, hitPlayer, hitEnemy, armorReduction, healHero, livingEnemies, frontEnemy };
