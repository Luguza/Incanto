"use strict";
// ==============================================================================
// config.js — CONFIG: every gameplay number, flag, and colour. Owns: CONFIG.
// ==============================================================================

// ---------------------------------------------------------------------------
// CONFIG — every gameplay number, flag, and color lives here.
// ---------------------------------------------------------------------------
const CONFIG = {
  windupDurationMs: 8000,
  // Hero: small HP pool, starts weak, upgrades bought with gold
  heroBaseHP: 10,
  heroBaseDmg: 3,
  dmgPerLevel: 2,
  hpPerLevel: 25,
  dmgUpgradeBaseCost: 30,
  hpUpgradeBaseCost: 25,
  upgradeCostGrowth: 1.6,
  // Currency is earned only in the post-death vocab quiz, then spent between
  // runs on permanent build upgrades
  quizQuestionCount: 8,  // one of each Duolingo-style exercise per session
  quizOptionCount: 4,
  quizMatchPairs: 5,     // tap-to-match exercise: pairs per board
  goldPerCorrect: 12,
  quizWaveBonus: 5, // bonus gold per question, scaled by how far you got
  quizFeedbackMs: 650,   // how long a wrong match flashes red before clearing
  // Endless skeleton waves, scaling in HP and damage
  enemyBaseHP: 10,
  enemyHPGrowth: 1.45,
  enemyBaseDmg: 6,
  enemyDmgGrowth: 1.3,
  wrongPenaltyFraction: 0.2, // a wrong match backfires for this fraction of the hero's MAX HP
  enemyEnterMs: 900,
  enemyDeathMs: 600,
  runeCount: 6,
  pairsPerLoadout: 3,
  // When false, casting a spell does NOT reset the skeleton's attack windup, so
  // its attack timer keeps ticking and it lands hits at a steady cadence (constant DPS).
  staggerOnCast: false,
  wrongFlashDurationMs: 200,
  runeFlashDurationMs: 820,  // how long the rune circle glows red before it dissolves + re-deals
  heroBlastMs: 820,          // total length of the mis-cast backfire (break + explosion)
  heroBlastBreakFrac: 0.30,  // first this fraction is the rune shattering; the rest is the explosion
  heroKnockback: 13,         // px the hero is shoved back (toward the wall) when the blast hits
  shapeFlashDurationMs: 500,
  fireballFlightMs: 450,
  fireballImpactMs: 280,
  castChargeMs: 420,
  runePuffMs: 260,
  circleCenter: { x: 300, y: 300 },
  circleRadius: 215,
  runeRadius: 48,
  colors: {
    background: "#141018",
    runeUnmatched: "#3a3550",
    runeSelected: "#f2c14e",
    runeMatched: "#5ecf8f",
    chord: "#4de3e0",
    chordFlash: "#ffffff",
    wrongFlash: "rgba(229,72,77,0.35)",
    heartFull: "#e5484d",
    heartEmpty: "#3a3540",
    windupFill: "#e5484d",
    // Dungeon scene effect colors (sprites come from assets/dungeon_tiles.png)
    dungeon: {
      background: "#17131e",
      glowRGB: "242, 168, 58",
      glowAlpha: 0.2,
      vignette: "rgba(10, 7, 15, 0.45)",
    },
    sceneRune: {
      dot: "#8ff7f3",
      line: "#4de3e0",
      bright: "#eafffe",
      discRGB: "77, 227, 224",
      glowRGB: "77, 227, 224",
    },
    // The wizard's staff sprite is tinted at load to share the rune's teal;
    // this is the additive halo its gem throws while tracing/casting.
    staff: {
      glowRGB: "77, 227, 224",
    },
    fireball: {
      C: "#fff7d9", // core
      Y: "#ffe28a", // inner
      y: "#f2a83a", // mid
      O: "#e5673a", // outer
      T: "#a8432c", // trail
      glowRGB: "242, 168, 58",
      glowAlpha: 0.3,
    },
  },
};

window.Incanto.CONFIG = CONFIG;
