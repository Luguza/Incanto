"use strict";
// ==============================================================================
// config.js — CONFIG: every gameplay number, flag, and colour. Owns: CONFIG.
// ==============================================================================

// ---------------------------------------------------------------------------
// CONFIG — every gameplay number, flag, and color lives here.
// ---------------------------------------------------------------------------
const CONFIG = {
  // Hero: small HP pool, starts weak, upgrades bought with gold. Base survives a
  // couple of skeleton blows so the very first upgradeless run is a real fight
  // (not an instant death) — a few cheap early nodes then tip a lone skeleton in
  // the hero's favour; see CONFIG.caps for why stacking past that plateaus.
  heroBaseHP: 14,
  heroBaseDmg: 3,
  dmgPerLevel: 2,
  hpPerLevel: 25,
  dmgUpgradeBaseCost: 30,
  hpUpgradeBaseCost: 25,
  upgradeCostGrowth: 1.6,
  // Hallway advance: the hero holds his spot on screen while the corridor scrolls
  // past (the camera pans right), reading as him striding deeper down the hall.
  // He walks whenever the near stretch of floor is clear and halts the moment a
  // skeleton crosses into it — that's when he plants to fight.
  heroWalkPxPerMs: 0.03,          // corridor pan speed while advancing (~1.9 tiles/sec)
  heroWalkClearFraction: 2 / 3,   // no skeleton within this fraction from the left → advance
  heroWalkEaseMs: 380,            // time-constant the pan velocity eases in/out over (no abrupt starts/stops)
  // Currency is earned only in the post-death vocab quiz, then spent between
  // runs on permanent build upgrades
  quizQuestionCount: 8,  // one of each Duolingo-style exercise per session
  quizOptionCount: 4,
  quizMatchPairs: 5,     // tap-to-match exercise: pairs per board
  goldPerCorrect: 12,
  quizKillBonus: 5, // bonus gold per question, scaled by skeletons slain last run
  quizFeedbackMs: 650,   // how long a wrong match flashes red before clearing
  // Endless skeletons: instead of discrete waves, lone skeletons stream in at
  // random intervals and walk toward the hero; each only attacks once it reaches
  // melee range, at its own steady cadence. There is no per-wave scaling — a
  // skeleton's strength comes from its VARIANT (see `enemyTypes`), not from how
  // deep the run is.
  enemyBaseHP: 10,
  enemyBaseDmg: 6,
  // Enemy variants. Every arrival rolls one of these: `weight` is its relative
  // chance (among the variants already unlocked), `minKills` is how far into the
  // run it starts showing up, and the multipliers scale the base numbers above.
  // `scale` is the drawn size of the 16x16 skeleton art — the tell that a
  // tougher one just walked in, so it reads before it swings.
  enemyTypes: [
    { id: "skeleton", weight: 1, minKills: 0, hpMult: 1, dmgMult: 1, attackSpeedMult: 1, scale: 1, label: null },
    // Brute: a head taller, twice the HP and damage, and swings ~40% faster.
    // `label` is called out on the enemy HP bar while it leads the queue, so a
    // slow-draining bar reads as "this one is tougher", not as a stuck bar.
    { id: "brute", weight: 0.28, minKills: 4, hpMult: 2, dmgMult: 2, attackSpeedMult: 1.4, scale: 1.375, label: "KNOCHENKOLOSS" },
  ],
  wrongPenaltyFraction: 0.15, // a wrong match backfires for this fraction of the hero's MAX HP
  enemyDeathMs: 600,         // how long a struck skeleton dissolves once the bolt lands
  // Random trickle: the next skeleton arrives after a delay drawn uniformly from
  // [min, max] ms, capped at `enemyMaxCount` alive so the arena never overflows.
  enemyMaxCount: 9,          // hard cap on skeletons alive at once
  enemySpawnMinMs: 3600,     // shortest gap between arrivals
  enemySpawnMaxMs: 10200,    // longest gap between arrivals
  enemyFirstSpawnMs: 400,    // the first skeleton of a run walks in almost at once
  // Progressive spawn rate: the trickle starts slow and then picks up
  // exponentially, with no ceiling — the only real cap is `enemyMaxCount` (how
  // many skeletons fit on screen at once). Each arrival's delay is multiplied by
  // a factor that decays GEOMETRICALLY from `enemySpawnRampStartMult` (at 0
  // kills): mult = startMult^(1 - progress), where progress = kills/rampKills is
  // NOT clamped. It reaches 1 (full base speed) at `enemySpawnRampKills` kills
  // and keeps shrinking past that, so the spawn *rate* (1/gap) grows
  // exponentially forever, throttled only by the on-screen skeleton cap.
  enemySpawnRampStartMult: 4,   // at run start, gaps between arrivals are this much longer
  enemySpawnRampKills: 45,      // kills to reach full base speed (mult=1); accelerates beyond
  enemyLanes: 3,             // parallel depth rows the mob streams in on
  // March + melee. A skeleton's `pos` is measured in TILES to the right of the
  // hero's front edge (0 = touching the hero). One pos-unit maps to exactly one
  // 16px floor tile on screen, and the queue keeps > 1 tile between neighbours,
  // so no two skeletons ever share a tile. They walk left until blocked (by the
  // standoff line or the skeleton ahead), stand idle if out of reach, and only
  // swing once within attack range.
  enemyWalkTilesPerMs: 0.0018,  // march speed (~1.8 tiles/sec)
  enemySpawnTiles: 13,          // frontmost skeleton spawns this many tiles out (off-screen right)
  enemySpawnGapTiles: 1.7,      // extra spawn distance per queue slot (trailing column)
  enemyStandoffTiles: 1.6,      // how far in front of the hero the front rank stops
  enemyGapTiles: 1.15,          // min tiles between two skeletons (> 1 → never the same tile)
  enemyAttackRangeTiles: 4.1,   // a stopped skeleton within this reach of the hero attacks; farther ones idle
  enemyFirstAttackMs: 2000,     // windup before a skeleton's first hit after engaging (a beat to react on first engage)
  enemyAttackIntervalMs: 3400,  // steady cadence between a skeleton's hits
  enemyAttackLungeMs: 260,      // length of the forward jab drawn on each hit
  runeCount: 6,
  pairsPerLoadout: 3,
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
  // Floating damage numbers that pop over a fighter on each hit, then rise + fade
  dmgFloatMs: 850,      // how long a damage number lingers before it's culled
  dmgFloatRisePx: 16,   // art pixels it drifts upward across its life
  // Sustain / anti-AFK. Regen only trickles the hero back up to this fraction of
  // his max HP — never to full. That keeps Genesung a between-fights safety net
  // (it patches a rough patch, then you must fight to climb higher) instead of a
  // hands-off autopilot: once a real mob forms, incoming damage outpaces a
  // capped regen that can't even reach full, so no build can idle forever.
  regenMaxHpFraction: 0.6,
  // Balance ceilings. The skill tree is ~1300 nodes whose effect grows the
  // farther out they sit, so without limits a stacked build snowballs into an
  // unkillable, AFK-able hero. recomputeMods runs every summed stat through
  // these: the flat/percent pools use a soft cap (near-linear while small, so
  // early upgrades feel strong, then asymptoting so each extra point returns
  // less), and the sustain/crit stats use hard ceilings. Enemies never scale, so
  // these caps are what keep the fight a fight no matter how deep the tree goes.
  caps: {
    flatHp: 60,         // soft-cap on summed +flat HP (before % HP)
    flatDmg: 22,        // soft-cap on summed +flat damage (before % damage)
    pctHp: 1.0,         // soft-cap on summed % HP  (approaches +100%)
    pctDmg: 1.0,        // soft-cap on summed % damage (approaches +100%)
    critChance: 0.6,    // hard ceiling on crit chance
    critMult: 1.5,      // hard ceiling on bonus crit damage (max crit ×3.0)
    regen: 2.0,         // hard ceiling on HP/s regen (below a full mob's DPS)
    thorns: 0.35,       // hard ceiling on reflected fraction of a blow
    leech: 0.5,         // hard ceiling on life-leech fraction
    shieldChance: 0.5,  // hard ceiling on per-cast shield chance
    spellFailProt: 0.6, // hard ceiling on backfire-ward chance
  },
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
    // Floating damage numbers: warm cream when the hero's spell bites a skeleton,
    // angry red when a skeleton lands a hit on the hero.
    dmgFloat: {
      enemy: "255, 236, 200",
      hero: "255, 92, 96",
      crit: "255, 214, 90",   // a crit bites gold
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
