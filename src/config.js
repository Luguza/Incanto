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
  // the hero's favour, and stacking further keeps paying — nothing plateaus.
  // DAMAGE IS BUILT IN THREE STAGES (see skilltree.js: the A table, and
  // recomputeMods). Kern → Verstärkung → Zuschlag: a flat node adds to the core
  // that everything else multiplies, or — the Schneide nodes — lands last of
  // all, after the page's own factor, so its printed number is exactly what
  // arrives on every body.
  //
  // Nothing about it is capped, and nothing about any other stat is either (see
  // the note where the caps used to live, below). On the cheapest-first curve a
  // Feuerball hit runs ~58 at 1.000 gold spent, ~88 at 3.000, ~133 at 10.000 and
  // ~330 at 30.000, and keeps climbing from there. Four-digit numbers therefore
  // do appear on a deeply invested tree — the old "never four digits" rule was
  // a consequence of the ceilings, and it went with them. Run
  // tools/stat-supply.mjs to see the whole curve.
  //
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
  quizQuestionCount: 10, // one of each Duolingo-style exercise per session, plus two conjugation drills
  quizOptionCount: 4,
  quizMatchPairs: 5,     // tap-to-match exercise: pairs per board
  quizSentenceMemory: 90, // the three sentence exercises (fill ×2, build) skip the last N sentences
                          // they served, so a session works through SENTENCE_POOL instead of
                          // rolling the same few. Kept well under the pool size — the draw falls
                          // back to the full pool if the memory ever swallowed all of it
  goldPerCorrect: 12,
  // CONJUGATION DRILLS (see quiz.js + content.js CONJ_POOL). A ladder rather
  // than one exercise: each rung asks for more of the verb's paradigm and pays
  // more gold for it, and the top rung is the whole table written out from
  // nothing — no options, no given forms, six blank lines.
  //
  // Which rung the game DEALS is not a setting the player hunts for in a menu:
  // the ladder climbs itself. Clear the top rung twice and the next one opens;
  // slip on it twice and it steps back down (see noteConjResult), so the hardest
  // exercise on offer is always the hardest one the player has shown they can
  // take. `state.conjLevel` is that high-water mark and is persisted.
  conjugation: {
    // `kind` picks the exercise (match = tap the pairs together, choose = pick a
    // form, type = write one form, table = fill a paradigm); `pairs` is the size
    // of a matching board and `mixed` makes it draw one form each from several
    // verbs instead of a single paradigm; `blanks` is how many of the six rows a
    // table leaves empty; `gold` multiplies that question's payout.
    //
    // The two matching rungs are the easy end on purpose: a closed board can be
    // solved by elimination, so a learner who only half-knows the endings still
    // gets somewhere, and reads the whole paradigm while doing it.
    levels: [
      { kind: "match", name: "Formen zuordnen", pairs: 4, gold: 1 },
      { kind: "match", name: "Personen zuordnen", pairs: 4, mixed: true, gold: 1.2 },
      { kind: "choose", name: "Form wählen", gold: 1.3 },
      { kind: "type", name: "Form schreiben", gold: 1.7 },
      { kind: "table", name: "Halbe Tabelle", blanks: 3, gold: 2.4 },
      { kind: "table", name: "Ganze Tabelle", blanks: 6, gold: 3.4 },
    ],
    // Promotion is quick and demotion is slow: one clean run at the top rung
    // opens the next, but it takes two slips to close it again, so the ladder
    // reaches for the hard exercises and lets go of them reluctantly.
    promoteStreak: 1,  // correct answers at the top rung before the next one opens
    demoteStreak: 2,   // misses at the top rung before it steps back down
  },
  // Fighting doesn't pay out gold — it charges the multiplier the quiz pays out
  // AT. Every skeleton slain lifts it, and the charge BANKS across runs
  // (state.rewardKills): dying doesn't burn it, starting a fresh run doesn't
  // reset it. It is only spent by finishing a whole quiz session (see
  // advanceQuiz), so a run that ended at two kills still added its two to the
  // pile. The cap is the nudge — once the bank is full, further fighting is
  // wasted until the player goes and studies.
  rewardPerKill: 0.1,   // +10% quiz gold per banked skeleton
  rewardMultMax: 5,     // ceiling on the banked multiplier (×5)
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
  // ===========================================================================
  // ENEMY VARIANTS — what a kind of body IS. The multipliers scale the two base
  // numbers above; everything else is how it reads and how it fights.
  //
  // WHERE each variant shows up is not decided here: packs name their members'
  // variants in encounters.js, so a mark on the plan always sends the same
  // bodies. (These entries used to carry `weight` and `minKills` for a random
  // per-arrival roll — that draw is gone, since it would have put randomness
  // back into the one thing the encounter plan exists to make designable.)
  //
  // A VARIANT IS ART + STATS + A ROLE, and the three are meant to agree:
  //
  //   `sprite`  which creature off the sheet (a key into ENEMY_SPRITES in
  //             render-assets.js — that's where the frame rects live). The
  //             sprite's own size is the body's size; `scale` multiplies it.
  //   `filter`  a CSS filter string baked into the variant's frames ONCE at
  //             load (hue-rotate / brightness / saturate). This is how one
  //             creature becomes three: the sheet has 17 monsters on it, and
  //             recolouring is what turns them into the ~30 bodies the hall
  //             actually sends. Baked, not applied per frame — a filter on the
  //             hot draw path would cost more than the whole scene.
  //   `tint`    the older flat wash (source-atop), kept where a variant wants
  //             DARKER rather than a different hue.
  //   `role`    what it does when it stops walking:
  //               melee    — closes to `enemyStandoffTiles` and swings (default)
  //               ranged   — plants at its own `standoff`, far back, and
  //                          throws (see `shot`); it never reaches the hero
  //               summoner — plants and calls in bodies of its own (`summon`)
  //               healer   — plants and mends the most wounded body near it
  //                          (`heal`), which is the hall's DPS check
  //             A body with a `standoff` past the melee line is placed in the
  //             REAR of its lane automatically (see spawnPack), so a caster can
  //             never wall its own front rank out of the fight.
  //   `armor`   fraction of every hit turned aside (see armorK below).
  //   `walkMult` march pace. Small things scurry; big things lumber.
  //   `name`    called out on the enemy HP bar while it leads the queue, so a
  //             slow-draining bar reads as "this one is tougher", not stuck.
  //
  // THE RAMP IS A DAMAGE CHECK, NOT A BURST CHECK. Depth is bought with HP
  // pools, armour and healers rather than with ever-bigger hits: a hero who has
  // not grown his damage stalls out and is ground down, instead of being one-shot
  // out of nowhere. That is what ties the far end of the hall to a nearly-grown
  // tree (see encounters.js) — you get there by killing faster, not by tanking.
  // ===========================================================================
  enemyTypes: [
    // --- Bone. The hall's first language: what the opening chapters teach with.
    { id: "skeleton", name: "SKELETT", sprite: "skelet",
      hpMult: 1, dmgMult: 1, attackSpeedMult: 1, armor: 0, scale: 1 },
    // Brute: a head taller, darker bone, twice the HP and damage, swings ~40%
    // faster, and the first body in the hall that wears ARMOUR.
    { id: "brute", name: "KNOCHENKOLOSS", sprite: "skelet",
      hpMult: 2, dmgMult: 2, attackSpeedMult: 1.4, armor: 5,
      scale: 1.375, tint: "rgba(26, 20, 34, 0.34)" },
    // Bleached, small and quick — the first thing that reaches the hero before
    // he expected it. Dies to anything; there are simply a lot of them.
    { id: "runner", name: "KNOCHENLÄUFER", sprite: "skelet",
      hpMult: 0.55, dmgMult: 0.7, attackSpeedMult: 1.5, armor: 0,
      scale: 0.85, walkMult: 1.8, filter: "sepia(0.9) saturate(1.9) brightness(1.12)" },
    // Steel-blue bone: the skeleton family's answer to a grown hero — plated,
    // slow, and not worth a fireball on its own.
    { id: "warden", name: "KNOCHENWACHE", sprite: "skelet",
      hpMult: 2.2, dmgMult: 1.2, attackSpeedMult: 0.85, armor: 9,
      scale: 1.15, walkMult: 0.75, filter: "sepia(1) saturate(1.8) hue-rotate(175deg) brightness(0.95)" },

    // --- Goblins. Small, fast, in numbers: the swarm chapter.
    { id: "goblin", name: "KOBOLD", sprite: "goblin",
      hpMult: 0.5, dmgMult: 0.6, attackSpeedMult: 1.4, armor: 0, scale: 1, walkMult: 1.7 },
    { id: "goblinRed", name: "BLUTKOBOLD", sprite: "goblin",
      hpMult: 0.8, dmgMult: 1.0, attackSpeedMult: 1.5, armor: 0, scale: 1.1, walkMult: 1.8,
      filter: "sepia(1) saturate(3.4) hue-rotate(300deg)" },
    { id: "goblinIce", name: "FROSTKOBOLD", sprite: "goblin",
      hpMult: 0.9, dmgMult: 0.8, attackSpeedMult: 1.2, armor: 4, scale: 1.05, walkMult: 1.4,
      filter: "sepia(1) saturate(2.4) hue-rotate(180deg) brightness(1.1)" },

    // --- Imps. The hall's first RANGED bodies: they never close, so the front
    // rank stops being the whole fight.
    { id: "imp", name: "FEUERIMP", sprite: "imp", role: "ranged",
      hpMult: 0.7, dmgMult: 0.55, attackSpeedMult: 0.85, armor: 0, scale: 1, walkMult: 1.2,
      standoff: 6.5, range: 7.5, shot: { rgb: "242, 168, 58", ms: 420 } },
    { id: "impFrost", name: "EISIMP", sprite: "imp", role: "ranged",
      hpMult: 0.95, dmgMult: 0.7, attackSpeedMult: 0.8, armor: 2, scale: 1, walkMult: 1.1,
      standoff: 7, range: 8, shot: { rgb: "121, 216, 238", ms: 420 },
      filter: "hue-rotate(195deg) saturate(1.3) brightness(1.1)" },
    { id: "impVoid", name: "SCHATTENIMP", sprite: "imp", role: "ranged",
      hpMult: 1.2, dmgMult: 0.95, attackSpeedMult: 0.9, armor: 3, scale: 1.1, walkMult: 1.1,
      standoff: 7.5, range: 8.5, shot: { rgb: "192, 140, 255", ms: 380 },
      filter: "hue-rotate(265deg) saturate(0.9) brightness(0.8)" },

    // --- The rotting ranks. Slow, heavy, and the first real HP walls.
    { id: "zombie", name: "ZOMBIE", sprite: "zombie",
      hpMult: 2.6, dmgMult: 1.3, attackSpeedMult: 0.7, armor: 0, scale: 1.1, walkMult: 0.55 },
    { id: "muddy", name: "SCHLAMMLING", sprite: "muddy",
      hpMult: 2.2, dmgMult: 1.1, attackSpeedMult: 0.7, armor: 6, scale: 1.1, walkMult: 0.5 },
    { id: "swampy", name: "SUMPFLING", sprite: "swampy",
      hpMult: 2.4, dmgMult: 1.2, attackSpeedMult: 0.75, armor: 4, scale: 1.1, walkMult: 0.6 },
    { id: "iceZombie", name: "EISZOMBIE", sprite: "iceZombie",
      hpMult: 3.0, dmgMult: 1.4, attackSpeedMult: 0.65, armor: 5, scale: 1.15, walkMult: 0.45 },

    // --- Orcs. The armour chapters: nothing here dies to a hero who skipped
    // his damage nodes, and the masks are where penetration starts to pay.
    { id: "orc", name: "ORKKRIEGER", sprite: "orcWarrior",
      hpMult: 2.0, dmgMult: 1.4, attackSpeedMult: 1, armor: 8, scale: 1, walkMult: 0.8 },
    { id: "orcBlack", name: "SCHWARZORK", sprite: "orcWarrior",
      hpMult: 2.6, dmgMult: 1.6, attackSpeedMult: 1, armor: 11, scale: 1.1, walkMult: 0.75,
      filter: "brightness(0.55) saturate(0.6)" },
    { id: "orcIron", name: "EISENORK", sprite: "orcWarrior",
      hpMult: 3.0, dmgMult: 1.5, attackSpeedMult: 0.9, armor: 12, scale: 1.1, walkMult: 0.65,
      filter: "sepia(1) saturate(1.6) hue-rotate(180deg)" },
    { id: "maskedOrc", name: "MASKENORK", sprite: "maskedOrc",
      hpMult: 3.0, dmgMult: 1.5, attackSpeedMult: 0.95, armor: 13, scale: 1.1, walkMult: 0.7 },
    { id: "maskedOrcRed", name: "BLUTMASKE", sprite: "maskedOrc",
      hpMult: 3.4, dmgMult: 1.7, attackSpeedMult: 1.25, armor: 12, scale: 1.15, walkMult: 0.85,
      filter: "sepia(1) saturate(3.4) hue-rotate(300deg)" },

    { id: "maskedOrcBone", name: "KNOCHENMASKE", sprite: "maskedOrc",
      hpMult: 3.6, dmgMult: 1.6, attackSpeedMult: 1, armor: 15, scale: 1.2, walkMult: 0.65,
      filter: "saturate(0.15) brightness(1.35)" },

    // --- Shamans. HEALERS: they mend the body in front of them faster than a
    // small spell can chew it down, so the hall starts asking for real damage
    // (or for the player to kill the back rank first).
    { id: "shaman", name: "ORKSCHAMANE", sprite: "orcShaman", role: "healer",
      hpMult: 1.6, dmgMult: 0.6, attackSpeedMult: 0.8, armor: 2, scale: 1, walkMult: 0.9,
      standoff: 8, heal: { frac: 0.16, everyMs: 3200, firstMs: 1800, radius: 7 } },
    { id: "shamanElder", name: "ÄLTESTER", sprite: "orcShaman", role: "healer",
      hpMult: 2.4, dmgMult: 0.7, attackSpeedMult: 0.8, armor: 5, scale: 1.1, walkMult: 0.85,
      standoff: 8.5, heal: { frac: 0.26, everyMs: 2600, firstMs: 1500, radius: 9 },
      filter: "hue-rotate(270deg) saturate(1.2)" },

    { id: "shamanBlood", name: "BLUTSCHAMANE", sprite: "orcShaman", role: "healer",
      hpMult: 2.0, dmgMult: 0.8, attackSpeedMult: 0.8, armor: 4, scale: 1.05, walkMult: 0.9,
      standoff: 8, heal: { frac: 0.2, everyMs: 2200, firstMs: 1400, radius: 8 },
      filter: "sepia(1) saturate(3.4) hue-rotate(300deg)" },

    // --- Wogols. The heavier ranged rank: they out-range the imps and hurt.
    { id: "wogol", name: "WOGOL", sprite: "wogol", role: "ranged",
      hpMult: 1.3, dmgMult: 1.0, attackSpeedMult: 0.8, armor: 3, scale: 1, walkMult: 0.9,
      standoff: 7.5, range: 8.5, shot: { rgb: "154, 143, 240", ms: 380 } },
    { id: "wogolPale", name: "BLEICHER WOGOL", sprite: "wogol", role: "ranged",
      hpMult: 1.7, dmgMult: 1.3, attackSpeedMult: 0.85, armor: 5, scale: 1.05, walkMult: 0.9,
      standoff: 8, range: 9, shot: { rgb: "234, 252, 255", ms: 340 },
      filter: "hue-rotate(185deg) saturate(0.8) brightness(1.25)" },

    { id: "wogolVoid", name: "SCHATTENWOGOL", sprite: "wogol", role: "ranged",
      hpMult: 2.0, dmgMult: 1.6, attackSpeedMult: 0.9, armor: 6, scale: 1.1, walkMult: 0.85,
      standoff: 8.5, range: 9.5, shot: { rgb: "192, 140, 255", ms: 320 },
      filter: "hue-rotate(265deg) saturate(1.1) brightness(0.85)" },

    // --- Necromancers. SUMMONERS: left alone they refill the hall faster than
    // the hero empties it, which is the one enemy that punishes killing in the
    // wrong order. `max` is the lifetime budget, so a stalled fight can't grow
    // without bound.
    { id: "necromancer", name: "NEKROMANT", sprite: "necromancer", role: "summoner",
      hpMult: 2.0, dmgMult: 0.5, attackSpeedMult: 0.8, armor: 3, scale: 1, walkMult: 0.85,
      standoff: 8.5,
      summon: { type: "skeleton", count: 2, everyMs: 5200, firstMs: 2600, max: 8 } },
    { id: "necroLord", name: "KNOCHENFÜRST", sprite: "necromancer", role: "summoner",
      hpMult: 3.2, dmgMult: 0.8, attackSpeedMult: 0.8, armor: 6, scale: 1.15, walkMult: 0.8,
      standoff: 9,
      summon: { type: "runner", count: 3, everyMs: 4200, firstMs: 2200, max: 12 },
      filter: "hue-rotate(140deg) saturate(1.3)" },

    { id: "necroPale", name: "BLEICHER NEKROMANT", sprite: "necromancer", role: "summoner",
      hpMult: 2.6, dmgMult: 0.7, attackSpeedMult: 0.8, armor: 4, scale: 1.05, walkMult: 0.85,
      standoff: 8.5,
      summon: { type: "carrion", count: 4, everyMs: 3800, firstMs: 2000, max: 16 },
      filter: "hue-rotate(235deg) saturate(0.7) brightness(1.3)" },

    // --- Chorts. Elite melee: fast AND heavy, the first bodies that punish
    // standing still.
    { id: "chort", name: "CHORT", sprite: "chort",
      hpMult: 2.8, dmgMult: 1.8, attackSpeedMult: 1.3, armor: 4, scale: 1, walkMult: 1.3 },
    { id: "chortAsh", name: "ASCHECHORT", sprite: "chort",
      hpMult: 3.6, dmgMult: 2.1, attackSpeedMult: 1.35, armor: 7, scale: 1.1, walkMult: 1.25,
      filter: "brightness(0.6) saturate(0.35)" },

    { id: "chortFrost", name: "FROSTCHORT", sprite: "chort",
      hpMult: 3.2, dmgMult: 1.9, attackSpeedMult: 1.3, armor: 6, scale: 1.05, walkMult: 1.35,
      filter: "hue-rotate(185deg) saturate(1.2) brightness(1.1)" },

    // --- Carrion. Summoned fodder, never authored into a pack on its own.
    { id: "carrion", name: "KADAVERLING", sprite: "tinyZombie",
      hpMult: 0.35, dmgMult: 0.5, attackSpeedMult: 1.6, armor: 0, scale: 1, walkMult: 2.0 },

    // --- The heavies. One of these is a whole camp's worth of HP.
    { id: "ogre", name: "OGER", sprite: "ogre",
      hpMult: 6.5, dmgMult: 2.2, attackSpeedMult: 0.8, armor: 10, scale: 1, walkMult: 0.5 },
    { id: "ogreFrost", name: "FROSTOGER", sprite: "ogre",
      hpMult: 8, dmgMult: 2.3, attackSpeedMult: 0.8, armor: 12, scale: 1.05, walkMult: 0.45,
      filter: "hue-rotate(175deg) saturate(1.1) brightness(1.1)" },
    { id: "ogreBlack", name: "SCHWARZOGER", sprite: "ogre",
      hpMult: 9, dmgMult: 2.4, attackSpeedMult: 0.85, armor: 14, scale: 1.05, walkMult: 0.45,
      filter: "brightness(0.5) saturate(0.5)" },
    { id: "bigZombie", name: "FLEISCHBERG", sprite: "bigZombie", role: "summoner",
      hpMult: 8, dmgMult: 2.4, attackSpeedMult: 0.6, armor: 5, scale: 1, walkMult: 0.4,
      standoff: 2.4, range: 4.6,
      summon: { type: "carrion", count: 2, everyMs: 6000, firstMs: 3000, max: 8 } },

    { id: "pestBerg", name: "PESTBERG", sprite: "bigZombie", role: "summoner",
      hpMult: 9.5, dmgMult: 2.5, attackSpeedMult: 0.6, armor: 7, scale: 1.05, walkMult: 0.4,
      standoff: 2.4, range: 4.6,
      summon: { type: "carrion", count: 3, everyMs: 5000, firstMs: 2600, max: 12 },
      filter: "sepia(1) saturate(2.2) hue-rotate(80deg)" },

    // --- The gate. The last two chapters, and nothing else in the hall reads
    // like them: they fill the corridor's whole height.
    { id: "bigDemon", name: "GROSSER DÄMON", sprite: "bigDemon",
      hpMult: 12, dmgMult: 2.6, attackSpeedMult: 1, armor: 10, scale: 1, walkMult: 0.6 },
    { id: "demonAsh", name: "ASCHETEUFEL", sprite: "bigDemon",
      hpMult: 13, dmgMult: 2.7, attackSpeedMult: 1.05, armor: 11, scale: 1, walkMult: 0.6,
      filter: "brightness(0.62) saturate(0.3)" },
    { id: "demonLord", name: "DÄMONENFÜRST", sprite: "bigDemon", role: "summoner",
      hpMult: 18, dmgMult: 2.9, attackSpeedMult: 1.1, armor: 12, scale: 1.1, walkMult: 0.55,
      standoff: 2.6, range: 5,
      summon: { type: "chort", count: 1, everyMs: 7000, firstMs: 4000, max: 6 },
      filter: "hue-rotate(265deg) saturate(1.3) brightness(1.1)" },
  ],
  // ARMOUR. A body's armour turns aside a FRACTION of every hit that lands on
  // it, never a flat amount:
  //
  //   reduction = min(armorMaxReduction, eff / (eff + armorK))
  //   eff       = max(0, armor - mods.armorPen)
  //
  // Percentage rather than subtraction, for two reasons rooted in this game:
  //  · a hit runs from 24 on a fresh hero into the hundreds on a deep tree, and
  //    with the flat damage stage uncapped (see caps) there is no top end at all
  //    any more — so any flat deduction big enough to matter at 24 is a wall,
  //    and any small enough to be fair at 24 is invisible at 300. A fraction
  //    holds its meaning across the whole span, however far it now runs.
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
  enemyMaxCount: 24,         // safety cap on bodies alive at once (a late pack + its summons can out-grow it)
  encounterSpacingMetres: 2.5,     // metres between camps — the whole hall is laid out on this cadence
                                   // (must stay inside the dead-air budget below, or every gap grows a
                                   // filler skeleton)
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
  // A RANGED body's bolt is a real travelling object, not a hitscan: the damage
  // lands when the mote reaches the hero, so a shot fired at the moment its
  // caster dies still arrives (it was already in the air) and the player can see
  // what is about to hit him. `enemyShotFadeMs` is how long the splash lingers
  // after impact.
  enemyShotFadeMs: 180,
  // A SUMMONER's bodies walk out of a rune it opens behind itself. The glow is
  // what makes the call readable at a glance; `enemySummonGapTiles` is how far
  // back of the caster they appear, so they never pop out on top of it.
  enemySummonGlowMs: 520,
  enemySummonGapTiles: 1.4,
  // A HEALER's mend: the beam it throws at the body it is patching up, and how
  // long that beam is drawn. The number pops in the heal spell's green, so
  // "that bar just went back up" is legible without staring at it.
  enemyHealBeamMs: 420,
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
    // How far the blast can grow is now just how much Glutkern the tree holds
    // (see treeTotals.aoeFireball below — bought out, it reaches ~3,25 tiles).
    fireball: { dmgMult: 1.0, radiusTiles: 1.3,
                laneRadius: 0.85, flightMs: 450, blastMs: 560 },
    // Blitzschlag — arcs from body to body, each hop weaker than the last. Far
    // more reach than Feuerball, paid for in falloff.
    lightning: { dmgMult: 0.95, chain: 3, falloff: 0.72, hopMs: 85, holdMs: 260 },
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
    // Weiter Atem branch with nothing to sell. That branch, bought out entirely,
    // adds four more tiles: the fully-invested cone doubles its reach because
    // that is all the Kegelweite the tree contains. The hall itself is 10 tiles
    // deep on a phone and nearly 20 on a desktop, so even then it is a
    // front-ranks spell rather than a screen clear.
    frost: { dmgMult: 0.35, coneTiles: 4, pushTiles: 2.4, pushMs: 280, freezeMs: 2600,
             // Trimmed from 2.4 with the number rescale: the shatter multiplies a
             // crit on top of a fully-invested page, so it sets the game's single
             // largest number and is what the three-digit ceiling binds against.
             primeMult: 2.0, castMs: 620 },
    // Meteoritenschauer — rocks fall on random spots across the WHOLE visible
    // track, not on chosen targets. Low per-hit damage over a wide, random area:
    // it thins a spread-out mob rather than deleting a front rank.
    meteor: { dmgMult: 0.5, count: 4, radiusTiles: 1.7, laneRadius: 1.4,
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
  // ===========================================================================
  // THE BALANCE TABLE — how much of each stat the whole skill tree CONTAINS.
  //
  // This is the one place the game's power curve is tuned. Every figure is a
  // total: "walk every node that grants Zähigkeit and you will have +1.200 LP,
  // and not one point more". skilltree.js grows the tree from relative weights
  // and then divides these totals across it (applyTreeTotals), so a node's
  // printed value is derived from the number below rather than guessed at.
  //
  // WHY THIS IS A CAP AND ALSO ISN'T. Every stat is bounded again — you cannot
  // carry more than the tree holds — but the bound is on what EXISTS, not on
  // what you may keep. Nothing is clipped, nothing suffers diminishing returns,
  // and a node always pays exactly what its tooltip says, at ring 1 and ring 19
  // alike. The ceiling is just the end of the supply.
  //
  // And the pools slow themselves down without any help: they are ADDITIVE, so
  // the tenth +30 LP is the same +30 as the first while being a far smaller
  // share of the pool it lands in. That is where the diminishing return comes
  // from now — the arithmetic, not a curve laid over it.
  //
  // WHAT A REAL BUILD SEES. Nobody owns the tree: it costs a couple of million
  // gold. On the cheapest-first curve a player holds roughly 5–8 % of each total
  // after 10.000 gold and 10–15 % after 30.000, so these figures are ceilings
  // that a build approaches from far below, and raising one lifts the whole
  // curve under it. `node tools/stat-supply.mjs` prints target vs. achieved
  // total next to what a build carries at 1k–100k gold — run it after any edit
  // here.
  // What the WHOLE skill tree costs — every rank of every node, end to end.
  // Each rank's price is a share of this, weighted by how deep the node sits,
  // how much of a node it is, and how many of its ranks you already own (see
  // skilltree.js applyTreeGold). Nothing is priced in gold by hand.
  //
  // It is set against the INCOME so that an endgame player really does walk most
  // of the tree and really does arrive at the ceilings in treeTotals — which is
  // what makes those ceilings mean something. A quiz session pays roughly
  // goldPerCorrect × the banked multiplier × the gold bonus, over ten questions
  // and two conjugation drills: about 350 gold early, ~1.000 in the middle and
  // ~2.800 once Fortuna is walked. Reaching 90 % of the NODES costs ~300.000
  // (the cheap ranks go first, so the last tenth of the gold buys keystones),
  // which is on the order of 250–300 finished sessions.
  //
  // Lower it and the tree opens faster; raise it and every total below becomes a
  // more distant horizon. Nothing else needs touching either way — the prices
  // redistribute themselves.
  treeGold: 400000,
  treeTotals: {
    // Every figure is what the WHOLE tree holds, and roughly 1/0,9 of what an
    // endgame build actually ends up carrying. Read them as "this is the most
    // this stat is ever worth", because now that is what they are.
    //
    // — damage, in the three stages it is built in (see skilltree.js)
    flatBase: 150,        // ① +150 Kernschaden, before any factor
    pctBase: 0.4,         // ① +40 % on that core
    pctDmg: 0.6,          // ② ×1,6 all told
    flatDmg: 250,         // ③ +250 on every single body hit, after everything
    // …which lands an endgame Feuerball around 700 per body: a skeleton (80 LP)
    // and a brute (160) both die to one, which is what an endgame ought to feel
    // like. The two flat stages cannot go much below this: they are counted in
    // whole points, and 143 / 231 ranks of the tree grant them, so a smaller
    // total would only mean every one of those nodes printing "+1".
    // — the hero
    flatHp: 600,          // with pctHp: ~1.240 LP at the end, ~25 skeleton blows
    pctHp: 1,
    critChance: 0.6,      // 60 % — and it is a probability, so it could not be more
    critMult: 1.5,        // a crit lands at ×3,0
    armorPen: 5,          // exactly the brute's plate: commit fully and it is gone
    leech: 0.4,
    regen: 25,            // LP/s — ~2 % of the endgame pool per second
    castHaste: 1.2,       // as a rate: 420 ms ÷ 2,2 ≈ 190 ms
    walkMult: 1,          // pace 0,057 px/ms, still under the march's own 0,12
    coinMult: 2.5,
    shieldChance: 0.5,
    shieldAmount: 350,
    shieldMax: 800,       // a banked shield worth about half the endgame pool
    spellFailProt: 0.6,
    thorns: 0.5,          // five Dornenkronen, 10 % each — the one already-exact total
    // — per page of the book: a page's own sigils are worth ~+50 % to it
    dmgFireball: 0.5, dmgLightning: 0.5, dmgFrost: 0.5,
    dmgMeteor: 0.5, dmgShield: 0.5, dmgHeal: 0.5,
    // — page SHAPE, where the totals are the shapes' own design limits
    aoeFireball: 1.5,     // blast radius ×2,5 → 3,25 Felder
    aoeMeteor: 1.5,       // crater ×2,5
    coneFrost: 1,         // cone reach ×2 → 8 Felder, the corridor's own depth
    freezeFrost: 3400,    // +3,4 s → 6,0 s frozen
    falloffLightning: 0.2, // +20 % carried per hop → 0,92, still short of 1
    // chainLightning / countMeteor are absent on purpose: they are whole bodies.
    // A node grants one more hop or one more rock and cannot grant 0,7 of one,
    // so their total is simply how many such nodes the tree has (12 and 13).
  },
  // Testing tools on the upgrade screen (see skilltree.js). A slider in the tree
  // topbar arms them; while it is off nothing they touch can be reached, so the
  // ordinary game is unchanged. `goldMax` bounds what the tappable purse accepts
  // — high enough to buy anything, low enough that the pill still fits a phone.
  dev: {
    goldMax: 999999,
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
