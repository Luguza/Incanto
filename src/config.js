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
  // NUMBER SCALE. Every damage and HP figure in the game is carried at ×8 the
  // scale it reads at naturally, for one reason: a PERCENTAGE needs resolution
  // to express itself. At the old scale a fresh hero's frost cone hit for 1 and
  // his fifth lightning hop for 0.77, so a 33% armour reduction rounded to 0%
  // or 50% and a +4% damage node moved nothing at all — four ranks of it left
  // heroDmg at 3. At ×8 the smallest routine hit is ~6 and every percentage in
  // the game lands within a few points of its advertised value.
  //
  // The scale-up is paid for by COMPRESSING growth rather than sliding the whole
  // window up (see caps): a damage number must never reach four digits, and the
  // old spread already ran 0.77 → 778, wider than the three-digit space itself.
  // So the floor came up ×8 and the ceiling stayed put — the hero now starts at
  // 24 damage and tops out near 102 instead of starting at 3 and topping out at
  // 50, and the largest number the game can pop is still ~816.
  heroBaseHP: 112,
  heroBaseDmg: 24,
  dmgPerLevel: 2,
  hpPerLevel: 25,
  dmgUpgradeBaseCost: 30,
  hpUpgradeBaseCost: 25,
  upgradeCostGrowth: 1.6,
  // Hallway travel: the hero holds his spot on screen while the corridor scrolls
  // past (the camera pans right), reading as him striding deeper down the hall.
  // He walks ONLY between camps — the moment anything musters he plants and
  // fights, and sets off again once it's dead and gone. Distance therefore never
  // grows during a fight, which is what lets the encounter plan trigger purely on
  // metres walked without two camps ever stacking (see updateCamera).
  //
  // It's an ordinary walk, not a dash: covering the gap to the next camp takes a
  // few seconds, and the quiet is filled by a lone skeleton rather than by
  // hurrying the hero along (see enemyMaxEmptyMs).
  heroWalkPxPerMs: 0.03,          // walking pace (~1.9 tiles/sec)
  heroWalkMaxPxPerMs: 0.12,       // ceiling on pace with walk-speed nodes included: past this a single
                                  // frame's coast into a stop could carry him over the next camp's
                                  // mark, and `mods.walkMult` has no cap of its own
  heroWalkEaseMs: 120,            // wind-up into the stride (short: the ramp is charged against the
                                  // dead-air budget, so a slow one costs usable camp spacing)
  heroHaltEaseMs: 140,            // plant when something musters, so he pulls up on his mark
  heroStridePx: 4.5,              // corridor pixels per radian of footstep bob (cadence follows ground covered)
  // Currency is earned only in the post-death vocab quiz, then spent between
  // runs on permanent build upgrades
  quizQuestionCount: 8,  // one of each Duolingo-style exercise per session
  quizOptionCount: 4,
  quizMatchPairs: 5,     // tap-to-match exercise: pairs per board
  goldPerCorrect: 12,
  quizKillBonus: 5, // bonus gold per question, scaled by skeletons slain last run
  quizFeedbackMs: 650,   // how long a wrong match flashes red before clearing
  // Learning history (see vocab-history.js): every word the player meets — in a
  // quiz question or in the rune circle — is tallied, and the words they have
  // recently slipped on are dealt back into the circle more often. The window is
  // deliberately short: a word you fumbled this morning should come back today,
  // not haunt the circle for a fortnight.
  vocab: {
    recentDays: 3,        // the "recently struggled with" window, in calendar days
    keepDays: 21,         // per-day buckets older than this are dropped from the save
    reviewSlotChance: 0.5, // chance a rune-circle slot is filled from the review pool instead of the curriculum
    maxReviewSlots: 2,    // never fill a whole loadout with review words — the curriculum must keep moving
    recoveryCredit: 0.5,  // recent correct answers that cancel one recent mistake (2 rights ⇒ 1 wrong forgiven)
    mistakeWeight: 2.2,   // how much one recent mistake adds to a word's draw weight
    weightCap: 12,        // ceiling on that weight, so one disastrous word can't own the circle
  },
  // Skeletons arrive in designed packs (see encounters.js) and walk toward the
  // hero; each only attacks once it reaches melee range, at its own steady
  // cadence. There is no per-wave scaling — a skeleton's strength comes from its
  // VARIANT (see `enemyTypes` below), and a pack's threat from its shape, its
  // head count, and which variants the plan put in it.
  enemyBaseHP: 80,
  enemyBaseDmg: 48,
  // Enemy variants — what a kind of skeleton IS. The multipliers scale the base
  // numbers above; `scale` is the drawn size of the 16x16 skeleton art and
  // `tint` a wash laid over its pixels, together the tell that a tougher one
  // just walked in, so it reads before it swings.
  //
  // WHERE each variant shows up is not decided here: packs name their members'
  // variants in encounters.js, so a mark on the plan always sends the same
  // bodies. (These entries used to carry `weight` and `minKills` for a random
  // per-arrival roll — that draw is gone, since it would have put randomness
  // back into the one thing the encounter plan exists to make designable.)
  enemyTypes: [
    { id: "skeleton", hpMult: 1, dmgMult: 1, attackSpeedMult: 1, armor: 0, scale: 1, tint: null, label: null },
    // Brute: a head taller, darker bone, twice the HP and damage, swings ~40%
    // faster, and the only body in the hall that wears ARMOUR (see armorK).
    // `label` is called out on the enemy HP bar while it leads the queue, so a
    // slow-draining bar reads as "this one is tougher", not stuck.
    {
      id: "brute",
      hpMult: 2, dmgMult: 2, attackSpeedMult: 1.4, armor: 5,
      scale: 1.375, tint: "rgba(26, 20, 34, 0.34)", label: "KNOCHENKOLOSS",
    },
  ],
  // ARMOUR. A body's armour turns aside a FRACTION of every hit that lands on
  // it, never a flat amount:
  //
  //   reduction = min(armorMaxReduction, eff / (eff + armorK))
  //   eff       = max(0, armor - mods.armorPen)
  //
  // Percentage rather than subtraction, for two reasons rooted in this game:
  //  · `state.heroDmg` runs from 3 to ~48 across a fully-grown tree (heroBaseDmg
  //    plus caps.flatDmg / caps.pctDmg), so any flat deduction big enough to
  //    matter at 3 damage is a wall, and any small enough to be fair at 3 is
  //    invisible at 48. A fraction holds its meaning across that whole span.
  //  · most pages of the book deal their damage in many small hits (a meteor
  //    rock at 0.5x, a fifth lightning hop at 0.27x, a frost cone at 0.35x).
  //    A flat deduction taxes each hit separately and would collapse those into
  //    applySpellHit's minimum of 1, i.e. read as broken rather than as armour.
  //
  // The useful identity: armour A multiplies a body's EFFECTIVE HP by
  // (1 + A/armorK). With armorK 10 the brute's armour 5 turns aside a third of
  // every hit — its 20 HP take 30 damage to chew through — and the cap means no
  // amount of armour ever makes a body immune.
  armorK: 10,
  armorMaxReduction: 0.75,
  wrongPenaltyFraction: 0.15, // a wrong match backfires for this fraction of the hero's MAX HP
  enemyDeathMs: 600,         // how long a struck skeleton dissolves once the bolt lands
  // DESIGNED ENCOUNTERS. Skeletons don't trickle in on a timer — the hall is a
  // fixed sequence of packs laid out at fixed metre marks, and the hero walking
  // past a mark is what sends that pack in. The packs and the schedule are in
  // encounters.js; these are the knobs the spawner reads. Nothing about it is
  // random: the same distance always produces the same fight, in the same lanes.
  // One metre = one 16px floor tile.
  enemyMaxCount: 18,         // safety cap on skeletons alive at once (a late pack can out-grow it)
  encounterLateSpacingMetres: 2.5, // metres between packs once the authored plan runs out (see
                                   // ENCOUNTER_PLAN: must stay inside the dead-air budget below, or
                                   // every gap grows a filler skeleton)
  // How far past the edge of frame a pack forms up. This is a TIME budget wearing
  // tile units: at `enemyWalkTilesPerMs` it's a ~280ms approach — long enough
  // that skeletons visibly stride in rather than appear, short enough that the
  // corridor doesn't read as empty while a camp is already on its way. Re-derive
  // it whenever the march speed changes (0.3 tiles at the current 1.1 tiles/sec;
  // at the old 2.7 it was 1.0), or a slow march turns the walk-in into a wait.
  // Measured from the *live* frame edge, so a wide viewport pushes the muster
  // line out to match instead of popping packs in over open floor.
  enemyApproachTiles: 0.3,
  // No dead air. Walking to the next camp takes a few seconds, so the corridor
  // does go quiet in between; once nothing has been on camera this long,
  // updateSpawns sends in a single skeleton to keep it alive.
  //
  // A LONE FILLER, never the next camp. Pulling a camp forward would spend a
  // designed encounter to patch a quiet moment and land it somewhere other than
  // the metre it was authored for; a filler costs the plan nothing, so the marks
  // stay exactly where they were written.
  //
  // The filler lands at the far end of the visible track (see
  // progression.trackEdgeTiles) rather than off camera, which is what makes this
  // number the real bound rather than the bound plus a walk-in. Off camera it
  // wouldn't hold at all: the hero's spell auto-targets the frontmost living
  // skeleton whether or not it's visible, so a player casting into an
  // empty-looking hall snipes the arrival before it ever appears and the screen
  // stays bare through another whole budget. In frame it's safe either way — a
  // kill on arrival plays its dissolve on camera, which is not dead air. It shows
  // up flush against the right border, half-under the 16px edge vignette.
  enemyMaxEmptyMs: 1500,     // longest the screen may sit empty before a filler skeleton walks in
  enemyLanes: 4,             // parallel depth rows the mob streams in on
  // March + melee. A skeleton's `pos` is measured in TILES to the right of the
  // hero's front edge (0 = touching the hero). One pos-unit maps to exactly one
  // 16px floor tile on screen, and the queue keeps > 1 tile between neighbours,
  // so no two skeletons ever share a tile. They walk left until blocked (by the
  // standoff line or the skeleton ahead), stand idle if out of reach, and only
  // swing once within attack range.
  enemyWalkTilesPerMs: 0.00108, // march speed (~1.1 tiles/sec) — a slow, looming advance
  enemySpawnGapTiles: 1.7,      // depth between a pack's successive ranks (and the clearance
                                // a pack musters behind any straggler in its lanes)
  enemyStandoffTiles: 1.6,      // how far in front of the hero the front rank stops
  enemyGapTiles: 1.15,          // min tiles between two skeletons (> 1 → never the same tile)
  enemyAttackRangeTiles: 4.1,   // a stopped skeleton within this reach of the hero attacks; farther ones idle
  enemyFirstAttackMs: 2000,     // windup before a skeleton's first hit after engaging (a beat to react on first engage)
  enemyAttackIntervalMs: 3400,  // steady cadence between a skeleton's hits
  enemyAttackLungeMs: 260,      // length of the forward jab drawn on each hit
  // SPELLS. Completing a rune shape casts whatever spell the hero's book is
  // open at (see spells.js for the registry and the resolvers, spellbook.js for
  // the book). Every spell reads the SAME `state.heroDmg` and scales it by its
  // own `dmgMult`, so a generic +damage node lifts the whole book while a
  // spell-specific node lifts only its page — that pairing is the point of the
  // split (see skilltree.js: each sector now carries one spell's nodes).
  //
  // Only Feuerball is known at the start; the other five are unique unlock
  // nodes buried a few tiers out in their own sector of the tree.
  // THE BOOK ITSELF — how the open spread behaves, as opposed to what a spell
  // does. Geometry and page art live in spellbook.js; this is only the timing.
  book: {
    // How long the open page's miniature stays flared after a cast. Matched to
    // the shortest spell effect on the canvas, so the page settles at about the
    // moment the spell it answered finishes.
    castFlashMs: 420,
  },
  spells: {
    // A Frostkegel leaves the hero's next spell "primed": it shatters frozen
    // bodies for primeMult damage and reaches every frozen skeleton, not just
    // the ones the spell would normally touch. This window is how long that
    // charge keeps — long enough to solve one more loadout, not two.
    primeWindowMs: 7000,
    // Feuerball — the starting spell. One ball of flame flies into the thickest
    // part of the mob and BURSTS: everything caught in the blast takes FULL
    // damage, and it takes it whether it stood at the epicentre or at the rim (no
    // falloff — that's Blitzschlag's trade). The radius is the upgrade; the aim
    // picks the body whose burst catches the most, front and centre on a tie
    // (see pickBlastFocus in spells.js).
    //
    // `radiusTiles` is measured along the march track, where the queue keeps
    // ~1.15 tiles between bodies, so the opening blast is the body it hit plus
    // whoever is pressed up behind it. `laneRadius` is the same blast measured
    // ACROSS the lanes and starts under 1: a fresh Feuerball burns one lane, and
    // reaching into the neighbouring ones is what the Glutkern branch sells.
    // `maxRadiusTiles` is where the growth stops — it matches caps.aoeFireball,
    // so the cap is the single place that bounds the spell.
    fireball: { dmgMult: 1.0, radiusTiles: 1.3, maxRadiusTiles: 3.25,
                laneRadius: 0.85, flightMs: 450, blastMs: 560 },
    // Blitzschlag — arcs from body to body, each hop weaker than the last. Far
    // more reach than Feuerball, paid for in falloff.
    lightning: { dmgMult: 0.95, chain: 3, maxChain: 14, falloff: 0.72, hopMs: 85, holdMs: 260 },
    // Frostkegel — a cone off the staff that shoves the front ranks back down
    // the hall and freezes them where they land. Barely damages; it buys time
    // and sets up the shatter (see primeWindowMs).
    // `pushMs` is how long a caught body takes to SLIDE the pushTiles back —
    // it is shoved, not teleported, and the slide starts as the drawn wedge
    // sweeps over it (see the frost resolver + updateEnemies).
    //
    // Reach: the cone opens 4 tiles down the hall on the page you unlock, which
    // is the front two or three ranks of each lane and no more — a wedge that
    // swept the corridor from the moment the page opened would leave the whole
    // Weiter Atem branch with nothing to sell. `maxConeTiles` is the far end of
    // that branch: every rank of it together adds FOUR tiles and not a tile
    // more, so the fully-invested cone doubles its reach and stops there. The
    // hall itself is 10 tiles deep on a phone and nearly 20 on a desktop, so
    // even the maxed cone is a front-ranks spell rather than a screen clear.
    frost: { dmgMult: 0.35, coneTiles: 4, maxConeTiles: 8, pushTiles: 2.4, pushMs: 280,
             freezeMs: 2600, maxFreezeMs: 6000,
             // Trimmed from 2.4 with the number rescale: the shatter multiplies a
             // crit on top of a fully-invested page, so it sets the game's single
             // largest number and is what the three-digit ceiling binds against.
             primeMult: 2.0, castMs: 620 },
    // Meteoritenschauer — rocks fall on random spots across the WHOLE visible
    // track, not on chosen targets. Low per-hit damage over a wide, random area:
    // it thins a spread-out mob rather than deleting a front rank.
    meteor: { dmgMult: 0.5, count: 4, maxCount: 18, radiusTiles: 1.7, laneRadius: 1.4,
              spreadMs: 900, fallMs: 380, impactMs: 260 },
    // Bannschild — absorb, not damage. Its pool is derived from spell power the
    // same way damage is, and it stacks onto whatever Ward nodes already grant.
    shield: { dmgMult: 1.6, capMult: 2.2, castMs: 700 },
    // Heilwort — the same conversion, into HP. Part flat spell power, part a
    // slice of the pool, so it stays useful on both a small and a large hero.
    heal: { dmgMult: 1.1, maxFrac: 0.16, castMs: 760 },
  },
  runeCount: 6,
  pairsPerLoadout: 3,
  wrongFlashDurationMs: 200,
  runeFlashDurationMs: 820,  // how long the rune circle glows red before it dissolves + re-deals
  heroBlastMs: 820,          // total length of the mis-cast backfire (break + explosion)
  heroBlastBreakFrac: 0.30,  // first this fraction is the rune shattering; the rest is the explosion
  heroKnockback: 13,         // px the hero is shoved back (toward the wall) when the blast hits
  shapeFlashDurationMs: 500,
  castChargeMs: 420,
  runePuffMs: 260,
  // Floating damage numbers that pop over a fighter on each hit, then rise + fade
  dmgFloatMs: 850,      // how long a damage number lingers before it's culled
  dmgFloatRisePx: 16,   // art pixels it drifts upward across its life
  // Balance ceilings. The skill tree is ~1300 nodes whose effect grows the
  // farther out they sit, so without limits a stacked build snowballs into an
  // unkillable, AFK-able hero. recomputeMods runs every summed stat through
  // these: the flat/percent pools use a soft cap (near-linear while small, so
  // early upgrades feel strong, then asymptoting so each extra point returns
  // less), and the sustain/crit stats use hard ceilings. Enemies never scale, so
  // these caps are what keep the fight a fight no matter how deep the tree goes.
  //
  // These are also the COMPRESSION half of the ×8 number scale (see heroBaseDmg).
  // The base figures went up ×8 while these went up only ~2–3×, which is what
  // holds the ceiling still: growth used to run ×16.7 on damage and ×10.5 on HP,
  // and now runs ~×4.3 on both. That is the trade the three-digit rule forces —
  // and it is the direction the tree already claims for itself, since the arms
  // are meant to pay out in BREADTH (more pages, more bodies hit, more
  // keystones) rather than in a bigger single number.
  caps: {
    flatHp: 190,        // soft-cap on summed +flat HP (before % HP)
    flatDmg: 44,        // soft-cap on summed +flat damage (before % damage)
    pctHp: 0.6,         // soft-cap on summed % HP  (approaches +60%)
    pctDmg: 0.5,        // soft-cap on summed % damage (approaches +50%)
    critChance: 0.6,    // hard ceiling on crit chance
    critMult: 1.0,      // hard ceiling on bonus crit damage (max crit ×2.5)
    // Armour penetration, in armour POINTS shredded off whatever the body wears
    // (see CONFIG.armorK). Deliberately below the brute's armour 5: a build that
    // commits the whole Macht arm to penetration wears the brute's mitigation
    // down from a third to a sixth, but never erases it — and there is headroom
    // left for a heavier-plated variant later.
    armorPen: 3,
    // Per-spell % damage. Soft-capped like the generic pools, and separately —
    // a page's own nodes plateau on their own, so pouring an entire sector into
    // one spell still leaves the other five worth visiting.
    spellPct: 0.6,
    regen: 16,          // hard ceiling on HP/s regen (below a full mob's DPS) — an HP
                        // rate, so it took the full ×8 rather than the compression
    // No thorns entry: reflection is bounded by supply instead of by a ceiling —
    // only five unique nodes in the whole tree grant it, 10% each (see skilltree.js).
    leech: 0.5,         // hard ceiling on life-leech fraction
    shieldChance: 0.5,  // hard ceiling on per-cast shield chance
    // Absorb is measured in HP, so these track the hero's pool rather than the
    // ×8: the bankable shield stays worth roughly one full health bar, as before.
    shieldAmount: 150,  // hard ceiling on absorb granted per proc
    shieldMax: 350,     // hard ceiling on the absorb pool a hero may bank
    spellFailProt: 0.6, // hard ceiling on backfire-ward chance
    castHaste: 0.45,    // hard ceiling on how much of the cast charge can be shaved off
    // Fortuna is a whole arm of the tree now, and neither of its stats is bounded
    // by anything downstream the way damage is — so they soft-cap here.
    coinMult: 1.5,      // soft-cap on summed bonus gold (approaches +150%)
    walkMult: 1.0,      // soft-cap on summed bonus walking pace (heroWalkMaxPxPerMs still applies)
    // A spell's SHAPE parameters, bounded so a fully-invested branch broadens the
    // spell without erasing its trade-off. The whole-body counts (an extra hop,
    // an extra rock) are absent on purpose: each spell's own maximum in
    // CONFIG.spells already bounds those.
    // Cone reach doubles and stops — the spell's own `maxConeTiles` is what
    // actually binds it (in tiles, where the design rule lives). This cap is
    // here so the STAT can't advertise growth the spell won't deliver: the tree
    // has +148% of Kegelweite in it, and a node tooltip promising a reach past
    // the ceiling would be a lie told at 30 gold a rank.
    coneFrost: 1.0,        // frost cone reach, as a fraction of coneTiles
    // Feuerball's blast, as a fraction of radiusTiles. The Glutkern branch holds
    // ~229% of it, so the cap lands about two thirds of the way out — the same
    // shape as Kegelweite above: the branch is worth walking, and its far end
    // sells crit and sigils rather than yet more radius. Capped, the burst covers
    // three lanes and ~6.5 tiles of track: wide, but still a blast around one
    // body rather than the meteor's rain over the whole hall.
    aoeFireball: 1.5,
    aoeMeteor: 1.0,        // meteor crater size, as a fraction of radiusTiles
    falloffLightning: 0.2, // added to lightning's per-hop falloff (0.72 → at most 0.92)
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
      // A hit that armour has bitten into pops in dulled steel instead of warm
      // cream, so "that number is smaller than it should be" is visible on the
      // body rather than something the player has to infer from the HP bar.
      armored: "176, 192, 208",
    },
    // One signature colour per spell page, shared by the book art, the scene
    // effect and the spell's skill-tree sector so a page, its nodes and its
    // bolt all read as the same magic.
    spell: {
      fireball:  { core: "#fff2c4", mid: "#f2a83a", rgb: "242, 168, 58" },
      lightning: { core: "#f2fbff", mid: "#7fb8ff", rgb: "127, 184, 255" },
      frost:     { core: "#eafcff", mid: "#79d8ee", rgb: "121, 216, 238" },
      meteor:    { core: "#ffe6c8", mid: "#e5673a", rgb: "229, 103, 58" },
      shield:    { core: "#eef0ff", mid: "#9a8ff0", rgb: "154, 143, 240" },
      heal:      { core: "#eaffe9", mid: "#6ed08a", rgb: "110, 208, 138" },
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
