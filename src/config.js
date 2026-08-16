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
  // WHAT ONE BLOW COSTS. This is the single most load-bearing number in the
  // hall, because HP is handed out once at the mouth of the corridor and never
  // refilled (progression.js startRun) — a run is one long subtraction, so this
  // number decides whether that subtraction is a grind or a guillotine.
  //
  // It used to be 48 against a 112 LP starting pool: a plain skeleton's blow was
  // more than a third of everything the hero had, and the very first camp of the
  // very first run settled it in three swings. That is not a corridor you are
  // ground down in, it is a coin flip on whether your damage beats one body's
  // walk-in — and it stayed a coin flip for the whole early game, because the
  // pool does not grow anywhere near fast enough to catch up (see the ramp note
  // below).
  //
  // IT IS A REFERENCE BLOW, NOT A BLOW. What a body actually lands is this times
  // its `dmgMult`, and a plain skeleton's share is a QUARTER of it — 3 LP, about
  // 2,7 % of the bare pool, every 0,9 s. Damage in this hall trickles: bodies
  // swing often and small (see the cadence note at `enemyAttackIntervalMs`), so
  // the number that matters is never one blow but the blows per second behind
  // it. This stays 12 because it is the unit every `dmgMult` is written against
  // and the slime ladder is a fraction of it; moving it moves everything.
  //
  // Tune it with `node tools/attrition.mjs`, which walks a build down the whole
  // plan and reports how many camps it clears. The rule that tool exists to
  // guard: the pool must never be worth less than ~25 seconds of the plainest
  // thing that can reach it (its "Skelettsekunden" column). Under that a single
  // camp settles the run, and the corridor stops being a grind.
  enemyBaseDmg: 12,
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
  //   `attackMs` the body's own CADENCE: milliseconds between its blows, written
  //             out rather than derived from a multiplier, because it is the
  //             number the design is stated in ("a goblin hits every 0,9 s").
  //             See the cadence note below `enemyAttackIntervalMs` for the bands
  //             a body is written into and why `dmgMult` is read against it.
  //   `walkMult` march pace. Small things scurry; big things lumber.
  //   `name`    called out on the enemy HP bar while it leads the queue, so a
  //             slow-draining bar reads as "this one is tougher", not stuck.
  //
  // THE RAMP IS A DAMAGE CHECK, NOT A BURST CHECK. Depth is bought with HP
  // pools, armour and healers rather than with ever-bigger hits: a hero who has
  // not grown his damage stalls out and is ground down, instead of being one-shot
  // out of nowhere. That is what ties the far end of the hall to a nearly-grown
  // tree (see encounters.js) — you get there by killing faster, not by tanking.
  //
  // BUT A BLOW MUST STAY A BLOW, and that is what `dmgMult` is for. The hero's
  // pool runs 112 LP bare to ~1.450 walked-out — thirteenfold. If a body's blow
  // did not climb with it, one number would have to threaten both heroes at
  // once, and no number can: the 48 that made a skeleton lethal at camp 1 was
  // also, by camp 120, less than a grown hero regenerates between swings. That
  // is exactly what used to happen. `node tools/attrition.mjs` traced a 90 %
  // build down the whole plan and found chapters 7 through 14 costing it ZERO
  // LP — the far hall was not a grind, it was a queue.
  //
  // So a body's PRESSURE climbs with DEPTH, at roughly the rate the pool it is
  // spending does: ×1 for the bone of chapter 2, ×5 by the time it reaches the
  // door, geometrically across the chapters in between (a body's factor is its
  // authored weight × 5^((chapter-2)/14) — the weights inside a tier are
  // untouched, so an ogre still leans harder than its escort). A body therefore
  // takes a roughly constant BITE out of whatever pool is carrying it, and the
  // grind reads the same at both ends of the hall.
  //
  // THAT RAMP IS PER SECOND, NOT PER BLOW. `dmgMult` is what ONE blow carries,
  // and one blow is the ramp cut into the body's own `attackMs` — so a heavy on
  // a 2,4 s beat prints a big number and a goblin on a 0,9 s beat prints a small
  // one while both stand exactly where their chapter put them. Read a variant's
  // two numbers together and never `dmgMult` alone: a body's real weight in the
  // hall is `enemyBaseDmg × dmgMult ÷ attackMs`, and that is the figure the ramp
  // above is written in.
  //
  // The ramp is measured from chapter 2 because chapter 1 is the slime
  // prologue, which is deliberately NOT a fight and sits below the scale
  // entirely (see the slime entries). Bone is the first thing that can kill
  // anyone, so bone is the ×1.
  //
  // The important thing is that this lives HERE, baked into what each body is,
  // rather than as a depth multiplier applied on the way out in progression.js.
  // A hidden factor on the damage path is the kind of thing you cannot read off
  // the bestiary, and the bestiary is supposed to be the whole truth about what
  // a body does.
  // ===========================================================================
  enemyTypes: [
    // --- Bone. The hall's first language: what the opening chapters teach with.
    { id: "skeleton", name: "SKELETT", sprite: "skelet",
      hpMult: 1, dmgMult: 0.25, attackMs: 900, armor: 0, scale: 1 },
    // Brute: a head taller, darker bone, twice the HP, the first body in the
    // hall that wears ARMOUR — and the first that trades cadence for weight. It
    // swings at about half the plain skeleton's rate and lands five times the
    // blow, which is what a colossus is supposed to feel like next to bone.
    { id: "brute", name: "KNOCHENKOLOSS", sprite: "skelet",
      hpMult: 2, dmgMult: 1.42, attackMs: 1700, armor: 5,
      scale: 1.375, tint: "rgba(26, 20, 34, 0.34)" },
    // Bleached, small and quick — the first thing that reaches the hero before
    // he expected it. Dies to anything; there are simply a lot of them.
    { id: "runner", name: "KNOCHENLÄUFER", sprite: "skelet",
      hpMult: 0.55, dmgMult: 0.25, attackMs: 800, armor: 0,
      scale: 0.85, walkMult: 1.8, filter: "sepia(0.9) saturate(1.9) brightness(1.12)" },
    // Steel-blue bone: the skeleton family's answer to a grown hero — plated,
    // slow, and not worth a fireball on its own.
    { id: "warden", name: "KNOCHENWACHE", sprite: "skelet",
      hpMult: 2.2, dmgMult: 1, attackMs: 1500, armor: 9,
      scale: 1.15, walkMult: 0.75, filter: "sepia(1) saturate(1.8) hue-rotate(175deg) brightness(0.95)" },

    // --- Schleim. What the hall opens with, ahead of the bone, and the one
    // family in the game that DIVIDES when you hurt it (`split` — the ladder it
    // walks down is `slimeTiers` below). A slime walks in big, comes apart into
    // two middling ones, and those come apart into small ones, so the opening
    // camps teach "hit the thing" with a body that answers back visibly and
    // cannot punish a slow answer: even the big one nibbles for 3 against a
    // 112 HP hero, and its fragments for 1.
    //
    // Their HP is NOT set here: a splitting variant walks in on the top rung of
    // `slimeTiers` (60) whatever its `hpMult` says, and every hit it survives
    // hands it down that ladder. So a fresh hero — 24 damage, one Feuerball, no
    // tree — walks the whole of it every time: 60 into two 40s, each 40 into two
    // 20s, and the 20s die to a single cast. `hpMult` is left on both entries
    // because everything else in the table carries one, but it is dead weight on
    // these two and moving it changes nothing.
    // Nothing later in the hall ever sends a slime, which is the point of them.
    //
    // ART: these two are the only bodies in the hall that are NOT cut from the
    // tileset. The sheet's smallest creatures are the tiny zombie and the
    // goblin, and shrinking either one to vermin height turns a drawn character
    // into a smudge with feet, so the slimes are drawn at the size they are
    // meant to be seen — 12x10 against a skeleton's 16x16 — in sprite-art.js,
    // to the sheet's own rules and out of the sheet's own palette. That is also
    // why the size ladder only ever scales UP from the drawing: enlarging keeps
    // every pixel of the face, shrinking is what loses it. No `filter` on
    // either: they are two colourways of one drawing, which is exactly how the
    // tileset itself ships `muddy` and `swampy`.
    //
    // (Written here rather than at the head of the table because the FIRST entry
    // is the fallback an unknown variant id resolves to — see enemyTypeById —
    // and that has to stay the plain skeleton.)
    // CADENCE: THE ONE PLACE A SLOW BEAT IS THE POINT. Everything else in the
    // hall was sped up so that damage trickles in rather than arriving in lumps
    // — but a slime's whole mechanic is a LADDER of blows (3 · 2 · 1 down the
    // tiers below), and a ladder needs headroom above the floor `sizeBody` puts
    // under every hit at 1 damage. Nibble any faster than this and the rungs
    // round into each other: at 1,2 s the big one would carry 2 and both the
    // fragments 1, which deletes the "a fist must not hit like a barrel" rule
    // that `slimeTiers` exists to state. So these two keep the slowest beat of
    // any small body in the game, and pay for it with the hall's smallest hits.
    // The same arithmetic is why `dmgMult` here is a FRACTION of `enemyBaseDmg`
    // rather than a number of its own: move that base and the whole ladder
    // moves with it, so anything that touches it has to come back and re-check
    // that these three rungs are still three distinct numbers.
    { id: "slime", name: "SCHLEIM", sprite: "slime", split: true,
      hpMult: 0.55, dmgMult: 0.25, attackMs: 2400, armor: 0, scale: 1, walkMult: 1.1 },
    { id: "slimeBlue", name: "TROPFLING", sprite: "slimeBlue", split: true,
      hpMult: 0.95, dmgMult: 0.33, attackMs: 2800, armor: 0, scale: 1, walkMult: 0.9 },

    // --- Goblins. Small, fast, in numbers: the swarm chapter.
    { id: "goblin", name: "KOBOLD", sprite: "goblin",
      hpMult: 0.5, dmgMult: 0.25, attackMs: 900, armor: 0, scale: 1, walkMult: 1.7 },
    { id: "goblinRed", name: "BLUTKOBOLD", sprite: "goblin",
      hpMult: 0.8, dmgMult: 0.5, attackMs: 900, armor: 0, scale: 1.1, walkMult: 1.8,
      filter: "sepia(1) saturate(3.4) hue-rotate(300deg)" },
    { id: "goblinIce", name: "FROSTKOBOLD", sprite: "goblin",
      hpMult: 0.9, dmgMult: 0.33, attackMs: 1000, armor: 4, scale: 1.05, walkMult: 1.4,
      filter: "sepia(1) saturate(2.4) hue-rotate(180deg) brightness(1.1)" },

    // --- Imps. The hall's first RANGED bodies: they never close, so the front
    // rank stops being the whole fight.
    { id: "imp", name: "FEUERIMP", sprite: "imp", role: "ranged",
      hpMult: 0.7, dmgMult: 0.25, attackMs: 1200, armor: 0, scale: 1, walkMult: 1.2,
      standoff: 6.5, range: 7.5, shot: { rgb: "242, 168, 58", ms: 420 } },
    { id: "impFrost", name: "EISIMP", sprite: "imp", role: "ranged",
      hpMult: 0.95, dmgMult: 0.33, attackMs: 1300, armor: 2, scale: 1, walkMult: 1.1,
      standoff: 7, range: 8, shot: { rgb: "121, 216, 238", ms: 420 },
      filter: "hue-rotate(195deg) saturate(1.3) brightness(1.1)" },
    { id: "impVoid", name: "SCHATTENIMP", sprite: "imp", role: "ranged",
      hpMult: 1.2, dmgMult: 0.75, attackMs: 1400, armor: 3, scale: 1.1, walkMult: 1.1,
      standoff: 7.5, range: 8.5, shot: { rgb: "192, 140, 255", ms: 380 },
      filter: "hue-rotate(265deg) saturate(0.9) brightness(0.8)" },

    // --- The rotting ranks. Slow, heavy, and the first real HP walls.
    { id: "zombie", name: "ZOMBIE", sprite: "zombie",
      hpMult: 2.6, dmgMult: 0.92, attackMs: 1900, armor: 0, scale: 1.1, walkMult: 0.55 },
    { id: "muddy", name: "SCHLAMMLING", sprite: "muddy",
      hpMult: 2.2, dmgMult: 0.75, attackMs: 1900, armor: 6, scale: 1.1, walkMult: 0.5 },
    { id: "swampy", name: "SUMPFLING", sprite: "swampy",
      hpMult: 2.4, dmgMult: 0.83, attackMs: 1800, armor: 4, scale: 1.1, walkMult: 0.6 },
    { id: "iceZombie", name: "EISZOMBIE", sprite: "iceZombie",
      hpMult: 3.0, dmgMult: 1.67, attackMs: 2000, armor: 5, scale: 1.15, walkMult: 0.45 },

    // --- Orcs. The armour chapters: nothing here dies to a hero who skipped
    // his damage nodes, and the masks are where penetration starts to pay.
    { id: "orc", name: "ORKKRIEGER", sprite: "orcWarrior",
      hpMult: 2.0, dmgMult: 0.83, attackMs: 1400, armor: 8, scale: 1, walkMult: 0.8 },
    { id: "orcBlack", name: "SCHWARZORK", sprite: "orcWarrior",
      hpMult: 2.6, dmgMult: 0.92, attackMs: 1400, armor: 11, scale: 1.1, walkMult: 0.75,
      filter: "brightness(0.55) saturate(0.6)" },
    { id: "orcIron", name: "EISENORK", sprite: "orcWarrior",
      hpMult: 3.0, dmgMult: 1.83, attackMs: 1600, armor: 12, scale: 1.1, walkMult: 0.65,
      filter: "sepia(1) saturate(1.6) hue-rotate(180deg)" },
    { id: "maskedOrc", name: "MASKENORK", sprite: "maskedOrc",
      hpMult: 3.0, dmgMult: 1.92, attackMs: 1600, armor: 13, scale: 1.1, walkMult: 0.7 },
    { id: "maskedOrcRed", name: "BLUTMASKE", sprite: "maskedOrc",
      hpMult: 3.4, dmgMult: 2.25, attackMs: 1300, armor: 12, scale: 1.15, walkMult: 0.85,
      filter: "sepia(1) saturate(3.4) hue-rotate(300deg)" },

    { id: "maskedOrcBone", name: "KNOCHENMASKE", sprite: "maskedOrc",
      hpMult: 3.6, dmgMult: 3.75, attackMs: 1600, armor: 15, scale: 1.2, walkMult: 0.65,
      filter: "saturate(0.15) brightness(1.35)" },

    // --- Shamans. HEALERS: they mend the body in front of them faster than a
    // small spell can chew it down, so the hall starts asking for real damage
    // (or for the player to kill the back rank first).
    { id: "shaman", name: "ORKSCHAMANE", sprite: "orcShaman", role: "healer",
      hpMult: 1.6, dmgMult: 0.42, attackMs: 1500, armor: 2, scale: 1, walkMult: 0.9,
      standoff: 8, heal: { frac: 0.16, everyMs: 3200, firstMs: 1800, radius: 7 } },
    { id: "shamanElder", name: "ÄLTESTER", sprite: "orcShaman", role: "healer",
      hpMult: 2.4, dmgMult: 0.5, attackMs: 1500, armor: 5, scale: 1.1, walkMult: 0.85,
      standoff: 8.5, heal: { frac: 0.26, everyMs: 2600, firstMs: 1500, radius: 9 },
      filter: "hue-rotate(270deg) saturate(1.2)" },

    { id: "shamanBlood", name: "BLUTSCHAMANE", sprite: "orcShaman", role: "healer",
      hpMult: 2.0, dmgMult: 1.42, attackMs: 1500, armor: 4, scale: 1.05, walkMult: 0.9,
      standoff: 8, heal: { frac: 0.2, everyMs: 2200, firstMs: 1400, radius: 8 },
      filter: "sepia(1) saturate(3.4) hue-rotate(300deg)" },

    // --- Wogols. The heavier ranged rank: they out-range the imps and hurt.
    { id: "wogol", name: "WOGOL", sprite: "wogol", role: "ranged",
      hpMult: 1.3, dmgMult: 0.75, attackMs: 1400, armor: 3, scale: 1, walkMult: 0.9,
      standoff: 7.5, range: 8.5, shot: { rgb: "154, 143, 240", ms: 380 } },
    { id: "wogolPale", name: "BLEICHER WOGOL", sprite: "wogol", role: "ranged",
      hpMult: 1.7, dmgMult: 1, attackMs: 1400, armor: 5, scale: 1.05, walkMult: 0.9,
      standoff: 8, range: 9, shot: { rgb: "234, 252, 255", ms: 340 },
      filter: "hue-rotate(185deg) saturate(0.8) brightness(1.25)" },

    { id: "wogolVoid", name: "SCHATTENWOGOL", sprite: "wogol", role: "ranged",
      hpMult: 2.0, dmgMult: 2.08, attackMs: 1400, armor: 6, scale: 1.1, walkMult: 0.85,
      standoff: 8.5, range: 9.5, shot: { rgb: "192, 140, 255", ms: 320 },
      filter: "hue-rotate(265deg) saturate(1.1) brightness(0.85)" },

    // --- Necromancers. SUMMONERS: left alone they refill the hall faster than
    // the hero empties it, which is the one enemy that punishes killing in the
    // wrong order. `max` is the lifetime budget, so a stalled fight can't grow
    // without bound.
    { id: "necromancer", name: "NEKROMANT", sprite: "necromancer", role: "summoner",
      hpMult: 2.0, dmgMult: 0.5, attackMs: 1600, armor: 3, scale: 1, walkMult: 0.85,
      standoff: 8.5,
      summon: { type: "skeleton", count: 2, everyMs: 5200, firstMs: 2600, max: 8 } },
    { id: "necroLord", name: "KNOCHENFÜRST", sprite: "necromancer", role: "summoner",
      hpMult: 3.2, dmgMult: 0.75, attackMs: 1600, armor: 6, scale: 1.15, walkMult: 0.8,
      standoff: 9,
      summon: { type: "runner", count: 3, everyMs: 4200, firstMs: 2200, max: 12 },
      filter: "hue-rotate(140deg) saturate(1.3)" },

    { id: "necroPale", name: "BLEICHER NEKROMANT", sprite: "necromancer", role: "summoner",
      hpMult: 2.6, dmgMult: 0.83, attackMs: 1600, armor: 4, scale: 1.05, walkMult: 0.85,
      standoff: 8.5,
      summon: { type: "carrion", count: 4, everyMs: 3800, firstMs: 2000, max: 16 },
      filter: "hue-rotate(235deg) saturate(0.7) brightness(1.3)" },

    // --- Chorts. Elite melee: fast AND heavy, the first bodies that punish
    // standing still.
    { id: "chort", name: "CHORT", sprite: "chort",
      hpMult: 2.8, dmgMult: 2.42, attackMs: 1000, armor: 4, scale: 1, walkMult: 1.3 },
    { id: "chortAsh", name: "ASCHECHORT", sprite: "chort",
      hpMult: 3.6, dmgMult: 2.92, attackMs: 1000, armor: 7, scale: 1.1, walkMult: 1.25,
      filter: "brightness(0.6) saturate(0.35)" },

    { id: "chortFrost", name: "FROSTCHORT", sprite: "chort",
      hpMult: 3.2, dmgMult: 2.92, attackMs: 1000, armor: 6, scale: 1.05, walkMult: 1.35,
      filter: "hue-rotate(185deg) saturate(1.2) brightness(1.1)" },

    // --- Carrion. Summoned fodder, never authored into a pack on its own.
    { id: "carrion", name: "KADAVERLING", sprite: "tinyZombie",
      hpMult: 0.35, dmgMult: 0.58, attackMs: 800, armor: 0, scale: 1, walkMult: 2.0 },

    // --- The heavies. One of these is a whole camp's worth of HP.
    { id: "ogre", name: "OGER", sprite: "ogre",
      hpMult: 6.5, dmgMult: 4.92, attackMs: 2400, armor: 10, scale: 1, walkMult: 0.5 },
    { id: "ogreFrost", name: "FROSTOGER", sprite: "ogre",
      hpMult: 8, dmgMult: 5.17, attackMs: 2400, armor: 12, scale: 1.05, walkMult: 0.45,
      filter: "hue-rotate(175deg) saturate(1.1) brightness(1.1)" },
    { id: "ogreBlack", name: "SCHWARZOGER", sprite: "ogre",
      hpMult: 9, dmgMult: 6.67, attackMs: 2500, armor: 14, scale: 1.05, walkMult: 0.45,
      filter: "brightness(0.5) saturate(0.5)" },
    { id: "bigZombie", name: "FLEISCHBERG", sprite: "bigZombie", role: "summoner",
      hpMult: 8, dmgMult: 4.92, attackMs: 2600, armor: 5, scale: 1, walkMult: 0.4,
      standoff: 2.4, range: 4.6,
      summon: { type: "carrion", count: 2, everyMs: 6000, firstMs: 3000, max: 8 } },

    { id: "pestBerg", name: "PESTBERG", sprite: "bigZombie", role: "summoner",
      hpMult: 9.5, dmgMult: 5.08, attackMs: 2600, armor: 7, scale: 1.05, walkMult: 0.4,
      standoff: 2.4, range: 4.6,
      summon: { type: "carrion", count: 3, everyMs: 5000, firstMs: 2600, max: 12 },
      filter: "sepia(1) saturate(2.2) hue-rotate(80deg)" },

    // --- The gate. The last two chapters, and nothing else in the hall reads
    // like them: they fill the corridor's whole height.
    { id: "bigDemon", name: "GROSSER DÄMON", sprite: "bigDemon",
      hpMult: 12, dmgMult: 9.92, attackMs: 2600, armor: 10, scale: 1, walkMult: 0.6 },
    { id: "demonAsh", name: "ASCHETEUFEL", sprite: "bigDemon",
      hpMult: 13, dmgMult: 10.83, attackMs: 2600, armor: 11, scale: 1, walkMult: 0.6,
      filter: "brightness(0.62) saturate(0.3)" },
    { id: "demonLord", name: "DÄMONENFÜRST", sprite: "bigDemon", role: "summoner",
      hpMult: 18, dmgMult: 13.17, attackMs: 2800, armor: 12, scale: 1.1, walkMult: 0.55,
      standoff: 2.6, range: 5,
      summon: { type: "chort", count: 1, everyMs: 7000, firstMs: 4000, max: 6 },
      filter: "hue-rotate(265deg) saturate(1.3) brightness(1.1)" },
  ],
  // ===========================================================================
  // SPLITTING, AND THE SIZE LADDER IT WALKS DOWN (variants with `split: true` —
  // today that is the two slimes). A slime is not a body you wear down. It is
  // THREE SIZES, and hitting one turns it into two of the size below at FULL HP:
  // 60 becomes two 40s, each 40 becomes two 20s, and a 20 is the bottom —
  // nothing smaller to become, so it just takes the hit like any other body and
  // dies when its bar runs out.
  //
  // A SLIME ABOVE THE BOTTOM RUNG CANNOT BE KILLED. Not "is hard to kill": the
  // blow that would empty its bar divides it instead, however far past zero it
  // went, and only the smallest size ever actually dies (see combat.hitEnemy).
  // Killing the big one is what spawns the small ones — which is the whole
  // mechanic, and is exactly what a split gated on surviving the hit does NOT
  // deliver, because a grown hero deletes 60 HP without noticing.
  //
  // THE HP IS THE RUNG, AND THE RUNG IS WHAT THE BODY IS. A slime's `maxHP` is
  // always exactly one of the numbers below, so the size it is drawn at, the
  // damage it swings for and the name over its bar are all read straight off
  // that rung — nothing has to remember what it started as.
  //
  // IT MAKES HP, ON PURPOSE, AND THAT IS THE WHOLE CHANGE. The old ladder halved
  // what the hit left behind, which is arithmetically tidy and meant the
  // mechanic almost never fired: a fresh hero's 24 damage on a 44 HP slime left
  // 20, and 20 is two 10s, so one camp showed one split and the rest died before
  // they could divide — and a hero with a tree behind him never saw a split at
  // all, because everything he touched died on the first hit. Dividing at full
  // HP, on any hit, means EVERY cast into a slime divides it: one big slime is
  // seven casts (1 split, 2 splits, 4 kills) and a wedge of three fills the lane
  // with fragments the way the chapter's comment always promised it would.
  //
  // It costs nothing in danger — these are the two bodies in the hall that cannot
  // meaningfully hurt anyone (see the slime variants above), so the extra pool
  // buys nothing but more of the mechanic on screen. What it does cost is TIME,
  // and the same amount of it for everybody: seven casts per big slime is seven
  // whether the hero hits for 24 or for 700, so the prologue is ~1 minute of any
  // run at any depth. That is the price of the mechanic firing at all, and the
  // dial if it ever reads as too long is the chapter's head count (encounters.js)
  // or a shorter ladder here — not the rule above.
  //
  // `scale` multiplies the variant's own drawn size and `dmgMult` its own
  // damage, and the second of those is what keeps the multiplying honest: a
  // slime the size of a fist must not hit like one the size of a barrel, or a
  // floor covered in fragments would add up to more danger than the single body
  // they came off. Split all the way down, a camp hits for LESS than it did
  // intact — 4 x 1 against the 3 the big one swung for, and on the fragments'
  // own slower beat at that.
  //
  // The rungs are written bottom-up: index 0 is the floor, the last is what a
  // slime walks in on (see progression.spawnHP — a splitting variant's `hpMult`
  // has no say, this ladder is the whole of what it is worth).
  slimeTiers: [
    { hp: 20, scale: 1,   dmgMult: 0.35, prefix: "KLEINER " },
    { hp: 40, scale: 1.3, dmgMult: 0.6,  prefix: "" },
    { hp: 60, scale: 1.6, dmgMult: 1,    prefix: "GROSSER " },   // what one walks in on
  ],
  // THE GOO A SLIME LEAVES BEHIND. Two things put marks on the floor and both
  // draw through the same list (`state.slimeGoo`, drawn by render-scene): the
  // smear a walking slime plants every few strides, and the puddle a split
  // splashes out under the pair. They are pure decoration — nothing reads them
  // back — but they are what makes a corridor of fragments read as slime rather
  // than as a lot of green sprites.
  // The trail is planted by GROUND COVERED, not on a timer: a slime crawls at
  // barely a tile a second, so a mark every fifth of a second would lay down a
  // smear every 3 px and the trail would read as one painted stripe. Every third
  // of a tile leaves separate smears that overlap into a track.
  slimeTrailStepTiles: 0.34, // how far a slime crawls between two smears
  slimeTrailFadeMs: 2800,    // how long a smear lingers before it dries away
  slimeTrailMax: 96,         // safety cap on marks on the floor at once
  // The split itself: the two halves are pulled apart with a goo bridge stretched
  // between them, which thins, snaps and drips. `slimeSplitFxMs` is that whole
  // performance, and it is deliberately a touch longer than the hit flash (210ms)
  // so the flash reads as the blow and the stretch as what the blow DID.
  slimeSplitFxMs: 430,
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
  enemyDeathMs: 600,         // how long a skeleton dissolves for, once the blow has landed on it
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
  // THE WINDUP IS A SHARE OF THE BODY'S OWN BEAT — the pause between planting in
  // reach and the first blow, measured in `attackMs` rather than in ms.
  //
  // WHY A SHARE AND NOT A NUMBER. Engagements here are SHORT: the front body
  // dies, the lane behind steps over it and starts again, so the windup is paid
  // many times per camp and is a real part of what a camp costs. It has always
  // been about six tenths of a beat (2.000 ms against the old 3.400 ms cadence)
  // and it has to stay six tenths, because that ratio is the whole difference
  // between re-timing the hall and quietly nerfing it — a flat windup charges a
  // goblin on a 0,9 s beat the same dead time as a giant on a 2,6 s stroke, and
  // measured on `tools/attrition.mjs` that alone took about a third of the
  // hall's pressure off a grown hero.
  //
  // The ms figure is the FLOOR under it, and it binds only for the two quickest
  // bodies in the game: however fast a thing swings, it does not open in under
  // half a second.
  enemyWindupBeats: 0.6,
  enemyFirstAttackMs: 500,
  // ===========================================================================
  // CADENCE — how often a body swings, and why every body swings often.
  //
  // DAMAGE IN THIS HALL TRICKLES. A camp used to hit in lumps: a skeleton stood
  // there for 3,4 s doing nothing and then took a ninth of the pool off in one
  // stroke, so the LP bar moved in steps and a fight was a sequence of jolts
  // rather than pressure. Every body now swings two to four times as often for
  // proportionally less, and the same fight drains the bar as a steady bleed —
  // one you can watch, react to and outheal, instead of one that arrives.
  //
  // PER-SECOND PRESSURE WAS HELD FIXED WHILE THAT HAPPENED. Each variant's
  // `dmgMult` was divided by exactly the factor its cadence was multiplied by,
  // so the hall costs what it always cost; what changed is the grain it costs it
  // in. Anything re-timing a body has to do the same arithmetic — halve the
  // interval, halve the blow — or it is not a re-timing, it is a buff.
  //
  // SIZE SETS THE BEAT. The bands a body is written into:
  //     0,8–1,0 s  vermin and small quick bodies — runners, goblins, carrion,
  //                the plain skeleton, and the chorts, whose whole character is
  //                that they are elite AND fast
  //     1,2–1,6 s  man-sized: imps, orcs, wogols, shamans, necromancers
  //     1,7–2,0 s  heavies on legs — the brute, the warden, the rotting ranks
  //     2,4–2,8 s  the giants: ogres, the bergs, the gate demons. These keep the
  //                slow heavy stroke on purpose — a body that fills the corridor
  //                should land like one, and a 119-point blow you can see coming
  //                is the counterweight the whole trickle is read against
  // The slimes sit outside the bands and swing slower than their size says, for
  // a reason written out at their entry: their damage ladder needs the room.
  //
  // The number below is only the FALLBACK for a variant that names no
  // `attackMs` of its own. Every body in the bestiary names one.
  // ===========================================================================
  enemyAttackIntervalMs: 1400,
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
    // Meteoritenschauer — rocks fall on random spots, but over the STRETCH OF
    // HALL THE MOB OCCUPIES rather than the whole visible track: the barrage is
    // aimed at the horde's bounding box, grown by `padTiles` along the corridor
    // and `padLanes` across it, and every rock is still rolled freely inside
    // that box. Nothing is aimed at a body, so it stays the spell that thins a
    // spread-out mob instead of deleting a front rank — it simply stops wasting
    // half a barrage on the empty floor in front of and behind the horde.
    // The padding is what keeps it a shower and not a volley of guided rocks:
    // rocks still stray past the edges of the pack, and a lone body does not
    // eat every one of them.
    meteor: { dmgMult: 0.5, count: 4, radiusTiles: 1.7, laneRadius: 1.4,
              padTiles: 2.2, padLanes: 1,
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
