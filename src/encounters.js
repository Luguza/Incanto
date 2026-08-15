"use strict";
// ==============================================================================
// encounters.js — the designed enemy schedule. Owns: PACKS (named formations),
// CHAPTERS + ENCOUNTER_PLAN (which pack the hero meets at which distance),
// HALL_END_METRES (where the corridor stops), and the accessors that read them.
//
// This file is DATA — it is where packs are designed. Nothing here is random:
// the same metre mark always sends in the same pack, in the same formation, in
// the same lanes, every run. The spawner that acts on it is spawnPack() in
// progression.js, driven by updateSpawns() in loop.js.
// ==============================================================================

// A pack is a list of RANKS, front rank first. Every rank walks in one gap-step
// deeper than the one ahead of it, so the whole formation marches in holding its
// shape.
//
// The numbers in a rank are LANES — the parallel depth rows the mob streams in
// on (CONFIG.enemyLanes). Lane 0 is the far row against the back wall, the last
// lane is the near row at the front of the floor, and the hero stands in the
// middle one. A lane may appear once per rank; a lane index past the configured
// lane count is clamped, so a pack never silently spawns into nowhere.
//
// `types` is optional and parallel to `ranks`: entry r is either one variant id
// for that whole rank, or an array naming a variant per lane in the same order.
// Anything left out is a plain skeleton. Variants are defined in
// CONFIG.enemyTypes — what a chort *is* lives there, where chorts *appear* is
// decided here.
//
// A pack does NOT have to worry about where its casters end up. Every lane is
// re-ordered at spawn time so the shortest-reaching body leads and the longest-
// reaching one brings up the rear (see orderRanksByReach), which is what lets a
// pack be written purely as a shape.
const DEFAULT_TYPE = "skeleton";

// The bare formations, with no variants attached. Everything below is one of
// these shapes filled with bodies — writing the shape once and the casting
// separately is what keeps ~40 named packs readable.
const SHAPES = {
  solo:    [[2]],                                 // 1 — a lone body in the hero's lane
  paar:    [[1, 3]],                              // 2 — two abreast, off to one side
  keil:    [[2], [1, 3]],                         // 3 — a point with two wings behind
  kolonne: [[2], [2], [2]],                       // 3 — single file straight down the middle
  drei:    [[1, 2, 3]],                           // 3 — three abreast
  welle:   [[0, 2], [1, 3]],                      // 4 — staggered, fills every lane over two ranks
  zange:   [[0, 3], [0, 3]],                      // 4 — a pincer down both outer lanes
  reihe:   [[0, 1, 2, 3]],                        // 4 — one full-width line
  trupp:   [[1, 2], [0, 3], [1, 2]],              // 6 — a squad, weaving lanes rank to rank
  mauer:   [[0, 1, 2, 3], [0, 1, 2, 3]],          // 8 — two solid ranks, no gaps
  schwarm: [[0, 1, 2, 3], [1, 2], [0, 3], [1, 2]],// 10 — a full-width mob with a deep tail
  hof:     [[2], [1, 3], [0, 2, 3]],              // 6 — one body in front, a court behind it
  geleit:  [[1, 2, 3], [0, 2]],                   // 5 — a line with a pair in support
  saeule:  [[2], [1, 3], [2], [1, 3]],            // 6 — a long alternating column
};

// A pack: a shape, plus who is standing in it. `types` follows the rank/lane
// convention above.
const pack = (name, shape, types) => ({ name, ranks: SHAPES[shape], types });
const D = DEFAULT_TYPE;

// PACKS is a LIBRARY, and the chapters below draw on about half of it. Every
// pack here is a designed formation that has been met at some point in the
// hall's life; CHAPTERS decides which ones the hero actually walks into. After
// the schedule was cut to half its camps a good number of these are on the
// shelf rather than in the plan — they are kept, not deleted, because putting a
// wave back is then a one-word edit in CHAPTERS rather than a re-design.
// `previewPlan()` prints what is live; nothing reads a pack the plan never names.
const PACKS = {
  // --- Ch. 1 · Schleim: the camps a new player meets first. The head count is
  // the whole escalation, because nothing in here can actually hurt anyone (see
  // the slime variants in CONFIG.enemyTypes). Every body in the chapter walks in
  // on the top rung (see progression.spawnHP): a big slime swings for 3 of the
  // hero's 112, on the slowest beat in the game (dmgMult 0,25 × the top rung's
  // 1, one blow per 2,4 s).
  //
  // The chapter itself is `schleim` then `schleimnest` — one body, then a wedge
  // of three. The two on the shelf are the same lesson at the weights in
  // between: `schleimspur` is the single slime twice over, `schleimrudel` the
  // nest with a GROSSER SCHLEIM in place of the Tropfling leading it.
  //
  // The three-body camps are WEDGES rather than lines, and that is about the
  // splitting: three big slimes abreast at one mark stand shoulder to shoulder,
  // and the moment each divides the lane fills up and the whole camp reads as
  // one green smear. Staggered in depth they stay countable however often they
  // come apart.
  //
  // What the wedge is actually for is the splitting. Three full-size slimes come
  // apart into six, and those into twelve — every cast into a slime divides what
  // it hit, a killing one included — so this is the first time the corridor holds
  // more targets than the player has casts to spare, which is the lesson chapter
  // 2 opens by charging for. It reads the same at every depth, too: a body that
  // divides rather than dying costs a finished hero the same twenty-one casts it
  // costs a new one.
  schleim:      pack("Schleim", "solo", ["slime"]),
  schleimspur:  pack("Schleimspur", "paar", ["slime"]),
  schleimnest:  pack("Schleimnest", "keil", [["slimeBlue"], ["slime", "slime"]]),
  // One id PER RANK, and `keil` has two of them — a bare ["slime"] would type the
  // point and quietly leave the two wings as the default skeleton, which is the
  // one body this chapter must not contain.
  schleimrudel: pack("Schleimrudel", "keil", ["slime", "slime"]),

  // --- Ch. 2 · Knochen. The opening language of the hall, and the first camps
  // that can actually kill anyone.
  spaeher:  pack("Späher", "solo"),
  paar:     pack("Paar", "paar"),
  keil:     pack("Keil", "keil"),
  kolonne:  pack("Kolonne", "kolonne"),
  welle:    pack("Welle", "welle"),
  zange:    pack("Zange", "zange"),
  reihe:    pack("Reihe", "reihe"),
  trupp:    pack("Trupp", "trupp"),
  mauer:    pack("Mauer", "mauer"),
  schwarm:  pack("Schwarm", "schwarm"),

  // Brute packs. A brute carries twice the HP and damage and swings ~40%
  // faster, so it's introduced alone — one big silhouette with nothing to hide
  // behind — before it ever turns up escorted.
  koloss:   pack("Koloss", "solo", ["brute"]),
  wache:    pack("Wache", "drei", [[D, "brute", D]]),
  bollwerk: pack("Bollwerk", "trupp", ["brute"]),

  // --- Ch. 3 · Knochenläufer: the first thing that arrives faster than expected.
  laeufer:     pack("Läufer", "solo", ["runner"]),
  hetze:       pack("Hetze", "welle", ["runner"]),
  meute:       pack("Meute", "schwarm", ["runner"]),
  vorhut:      pack("Vorhut", "keil", [["runner"], [D, D]]),
  knochenlauf: pack("Knochenlauf", "mauer", [["runner", "runner", "runner", "runner"], [D, D, D, D]]),

  // --- Ch. 4 · Kobolde: the swarm proper, and its two colours.
  kobold:      pack("Kobold", "solo", ["goblin"]),
  kobolde:     pack("Kobolde", "reihe", ["goblin"]),
  koboldnest:  pack("Koboldnest", "schwarm", ["goblin"]),
  blutkobold:  pack("Blutkobold", "keil", [["goblinRed"], ["goblin", "goblin"]]),
  frostkobold: pack("Frostkobold", "trupp", [["goblinIce", "goblinIce"], ["goblin", "goblin"], ["goblin", "goblin"]]),
  koboldheer:  pack("Koboldheer", "mauer", [["goblinRed", "goblin", "goblin", "goblinRed"], ["goblinIce", "goblin", "goblin", "goblinIce"]]),

  // --- Ch. 5 · Orks: the first armour worth penetrating.
  ork:         pack("Ork", "solo", ["orc"]),
  orkpaar:     pack("Orkpaar", "paar", ["orc"]),
  orktrupp:    pack("Orktrupp", "keil", [["orc"], ["orc", "orc"]]),
  orkwall:     pack("Orkwall", "reihe", ["orc"]),
  schwarzork:  pack("Schwarzork", "drei", [["orc", "orcBlack", "orc"]]),
  orkkeil:     pack("Orkkeil", "trupp", [["orcBlack", "orcBlack"], ["orc", "orc"], ["goblin", "goblin"]]),

  // --- Ch. 6 · Imps: the corridor stops being a front-rank problem.
  imp:         pack("Imp", "solo", ["imp"]),
  impwurf:     pack("Impwurf", "paar", ["imp"]),
  impdeckung:  pack("Impdeckung", "geleit", [[D, D, D], ["imp", "imp"]]),
  impschar:    pack("Impschar", "welle", ["imp"]),
  eisimp:      pack("Eisimp", "geleit", [["orc", "orc", "orc"], ["impFrost", "impFrost"]]),
  impfeuer:    pack("Impfeuer", "hof", [["brute"], ["orc", "orc"], ["imp", "imp", "impFrost"]]),

  // --- Ch. 7 · Die faulenden Reihen: slow walls of HP.
  zombie:      pack("Zombie", "solo", ["zombie"]),
  zombiepaar:  pack("Zombiepaar", "paar", ["zombie"]),
  schlamm:     pack("Schlamm", "drei", [["muddy", "zombie", "muddy"]]),
  sumpf:       pack("Sumpf", "keil", [["swampy"], ["muddy", "muddy"]]),
  faeulnis:    pack("Fäulnis", "reihe", [["muddy", "zombie", "zombie", "swampy"]]),
  totenzug:    pack("Totenzug", "trupp", [["zombie", "zombie"], ["swampy", "swampy"], ["imp", "imp"]]),

  // --- Ch. 8 · Schamanen: the first fight that answers back.
  schamane:    pack("Schamane", "paar", [["orc", "shaman"]]),
  heilkreis:   pack("Heilkreis", "geleit", [["orc", "orc", "orc"], ["shaman", "shaman"]]),
  orkheer:     pack("Orkheer", "trupp", [["orcBlack", "orcBlack"], ["orc", "orc"], ["shaman", "shaman"]]),
  faulmesse:   pack("Faulmesse", "hof", [["zombie"], ["muddy", "muddy"], ["shaman", "imp", "shaman"]]),
  aeltester:   pack("Ältester", "hof", [["orcBlack"], ["orc", "orc"], ["shamanElder", "shaman", "imp"]]),

  // --- Ch. 9 · Wogole: the heavy back rank.
  wogol:       pack("Wogol", "solo", ["wogol"]),
  wogolpaar:   pack("Wogolpaar", "paar", ["wogol"]),
  knochenwache: pack("Knochenwache", "drei", ["warden"]),
  wogolwache:  pack("Wogolwache", "geleit", [["warden", "warden", "warden"], ["wogol", "wogol"]]),
  bleichfeuer: pack("Bleichfeuer", "hof", [["warden"], ["orc", "orc"], ["wogolPale", "wogol", "wogol"]]),
  fernkampf:   pack("Fernkampf", "mauer", [["warden", "orc", "orc", "warden"], ["wogol", "imp", "imp", "wogol"]]),

  schattenimp:  pack("Schattenimp", "geleit", [["warden", "warden", "warden"], ["impVoid", "impVoid"]]),
  schattenwurf: pack("Schattenwurf", "mauer", [["warden", "orc", "orc", "warden"], ["impVoid", "wogol", "wogol", "impVoid"]]),

  // --- Ch. 10 · Nekromanten: kill the back rank or fight forever.
  nekromant:   pack("Nekromant", "paar", [["warden", "necromancer"]]),
  totenruf:    pack("Totenruf", "geleit", [["warden", "warden", "warden"], ["necromancer", "shaman"]]),
  grabherr:    pack("Grabherr", "hof", [["brute"], ["warden", "warden"], ["necromancer", "wogol", "shaman"]]),
  knochenfuerst: pack("Knochenfürst", "hof", [["orcBlack"], ["warden", "warden"], ["necroLord", "wogol", "shamanElder"]]),
  totenfeld:   pack("Totenfeld", "mauer", [["warden", "brute", "brute", "warden"], ["necromancer", "shaman", "shaman", "necromancer"]]),

  // --- Ch. 11 · Masken: the armour check proper.
  maske:       pack("Maske", "solo", ["maskedOrc"]),
  maskenpaar:  pack("Maskenpaar", "paar", ["maskedOrc"]),
  maskenwall:  pack("Maskenwall", "drei", ["maskedOrc"]),
  blutmaske:   pack("Blutmaske", "keil", [["maskedOrcRed"], ["maskedOrc", "maskedOrc"]]),
  maskenheer:  pack("Maskenheer", "hof", [["maskedOrcRed"], ["maskedOrc", "maskedOrc"], ["shamanElder", "wogol", "shaman"]]),
  panzerzug:   pack("Panzerzug", "mauer", [["maskedOrc", "orcBlack", "orcBlack", "maskedOrc"], ["shaman", "wogol", "wogol", "shaman"]]),

  eisenork:    pack("Eisenork", "solo", ["orcIron"]),
  eisenwall:   pack("Eisenwall", "mauer", [["orcIron", "maskedOrc", "maskedOrc", "orcIron"], ["shamanElder", "wogol", "wogol", "shamanElder"]]),

  // --- Ch. 12 · Das Eis: the rotting ranks come back plated.
  eiszombie:   pack("Eiszombie", "solo", ["iceZombie"]),
  frostzug:    pack("Frostzug", "drei", [["iceZombie", "iceZombie", "iceZombie"]]),
  frostwall:   pack("Frostwall", "geleit", [["iceZombie", "iceZombie", "iceZombie"], ["impFrost", "impFrost"]]),
  frosthof:    pack("Frosthof", "hof", [["iceZombie"], ["muddy", "swampy"], ["impFrost", "shamanElder", "impFrost"]]),
  eisheer:     pack("Eisheer", "mauer", [["iceZombie", "maskedOrc", "maskedOrc", "iceZombie"], ["impFrost", "wogolPale", "wogolPale", "impFrost"]]),

  bleichruf:   pack("Bleichruf", "paar", [["warden", "necroPale"]]),
  bleichfeld:  pack("Bleichfeld", "hof", [["iceZombie"], ["warden", "warden"], ["necroPale", "impFrost", "shamanElder"]]),

  // --- Ch. 13 · Chorts: fast AND heavy, at last together.
  chort:       pack("Chort", "solo", ["chort"]),
  chortpaar:   pack("Chortpaar", "paar", ["chort"]),
  chortkeil:   pack("Chortkeil", "keil", [["chortAsh"], ["chort", "chort"]]),
  aschebrand:  pack("Aschebrand", "hof", [["chortAsh"], ["chort", "chort"], ["wogolPale", "shamanElder", "wogolPale"]]),
  hoellenzug:  pack("Höllenzug", "trupp", [["chort", "chort"], ["chortAsh", "chortAsh"], ["necromancer", "shamanElder"]]),

  schattenwogol: pack("Schattenwogol", "paar", ["wogolVoid"]),
  schattenchor:  pack("Schattenchor", "hof", [["chortAsh"], ["chort", "chort"], ["wogolVoid", "shamanElder", "wogolVoid"]]),

  // --- Ch. 14 · Oger: one body, a whole camp's worth of HP.
  oger:        pack("Oger", "solo", ["ogre"]),
  ogerwache:   pack("Ogerwache", "keil", [["ogre"], ["maskedOrc", "maskedOrc"]]),
  frostoger:   pack("Frostoger", "keil", [["ogreFrost"], ["iceZombie", "iceZombie"]]),
  ogerhof:     pack("Ogerhof", "hof", [["ogre"], ["chort", "chort"], ["shamanElder", "wogolPale", "shamanElder"]]),
  ogerpaar:    pack("Ogerpaar", "geleit", [["ogre", "ogreFrost", "ogre"], ["necroLord", "shamanElder"]]),

  frostchort:  pack("Frostchort", "keil", [["chortFrost"], ["chort", "chort"]]),
  frosthoelle: pack("Frosthölle", "trupp", [["chortFrost", "chortFrost"], ["chortAsh", "chortAsh"], ["necroPale", "shamanElder"]]),

  // --- Ch. 15 · Fleischberge: HP that walks in with its own reinforcements.
  fleischberg: pack("Fleischberg", "solo", ["bigZombie"]),
  bergwache:   pack("Bergwache", "keil", [["bigZombie"], ["chortAsh", "chortAsh"]]),
  doppelberg:  pack("Doppelberg", "paar", ["bigZombie"]),
  berghof:     pack("Berghof", "hof", [["bigZombie"], ["ogre", "chortAsh"], ["necroLord", "shamanElder", "wogolPale"]]),
  seuchenzug:  pack("Seuchenzug", "trupp", [["bigZombie", "ogreFrost"], ["iceZombie", "iceZombie"], ["necroLord", "shamanElder"]]),

  schwarzoger: pack("Schwarzoger", "solo", ["ogreBlack"]),
  pestberg:    pack("Pestberg", "solo", ["pestBerg"]),
  pestfeld:    pack("Pestfeld", "hof", [["pestBerg"], ["ogreBlack", "chortFrost"], ["necroPale", "shamanElder", "wogolVoid"]]),

  // --- Ch. 16 · Das Tor. Everything the hall has taught, and the demon.
  daemon:      pack("Dämon", "solo", ["bigDemon"]),
  daemonwache: pack("Dämonenwache", "keil", [["bigDemon"], ["chortAsh", "chortAsh"]]),
  daemonhof:   pack("Dämonenhof", "hof", [["bigDemon"], ["ogre", "ogreFrost"], ["shamanElder", "necroLord", "wogolPale"]]),
  torwache:    pack("Torwache", "geleit", [["bigDemon", "bigZombie", "bigDemon"], ["shamanElder", "shamanElder"]]),
  knochenmaske: pack("Knochenmaske", "solo", ["maskedOrcBone"]),
  blutmesse:    pack("Blutmesse", "geleit", [["maskedOrcBone", "orcIron", "maskedOrcBone"], ["shamanBlood", "shamanBlood"]]),
  ascheteufel:  pack("Ascheteufel", "solo", ["demonAsh"]),
  aschewache:   pack("Aschewache", "keil", [["demonAsh"], ["chortFrost", "chortAsh"]]),
  torwall:      pack("Torwall", "mauer", [["maskedOrcBone", "orcIron", "orcIron", "maskedOrcBone"], ["shamanBlood", "wogolVoid", "wogolVoid", "shamanBlood"]]),
  daemonenfuerst: pack("Dämonenfürst", "hof", [["demonLord"], ["bigDemon", "demonAsh"], ["shamanBlood", "necroLord", "shamanBlood"]]),
};

// ==============================================================================
// THE HALL, chapter by chapter.
//
// One camp every `CONFIG.encounterSpacingMetres` metres, from the door the hero
// walks in through to the door he walks out of. Each chapter opens by showing
// ONE new body on its own, with nothing to hide behind — the way the brute was
// always introduced — then escorts it, then sends it in force, and only then
// does the next chapter start. A body never disappears once it has been taught:
// later chapters keep drawing on the earlier ones, which is what makes the far
// end of the hall feel like the whole hall rather than like a different game.
//
// SPACING is the pacing dial, and it is set against the dead-air rule rather
// than by eye. The hero walks at ~1.9 m/s and only between camps, so a gap takes
// gap/1.9 seconds of empty corridor; once that passes `enemyMaxEmptyMs` (1.5 s,
// about 2.8 m) a filler skeleton walks in to cover the quiet. Gaps below that
// threshold produce no fillers at all; gaps above it produce one EVERY time,
// because the filler halts the hero and he has to clear it before setting off
// again. There is no middle: measured across a 3-minute run, 2.5 m gaps give
// ~100% of enemies and of separate fights from designed camps, while 3 m gaps
// drop that to 85% / 52% and 8 m gaps to 57% / 26%.
//
// So camps sit 2.5 m apart, comfortably inside the budget, and the filler goes
// back to being what it should be — a safety net for the odd long gap, not the
// game's main supply of skeletons. Widening that past ~2.8 m hands the corridor
// back to the fillers.
//
// HOW LONG THE HALL IS, AND WHY. The corridor ENDS: 82 camps, then a door. It
// is not an endless tail any more, because a hall with no end has no reward for
// walking down it and no way to say "you have seen all of this".
//
// It used to be 164, two camps per idea instead of one. Each chapter has since
// been cut to HALF its waves — the ladder is intact, every body still steps out
// alone before it arrives escorted, and the chapter still ends on the heaviest
// thing it can build out of what it has taught, but it does all of that once.
// What is gone is the repetition: the reinforced re-runs of a camp already met
// ([pack, n] entries), the callbacks that replayed an earlier chapter's climax,
// and the intermediate head counts that only restated the step before them.
// A chapter is now the shortest version of its own argument, so the hall reads
// as a sequence of lessons rather than a corridor to be endured, and the door
// comes at half the walking it used to.
//
// That last part is a real change to the balance, and it is not hidden: the
// hall was sized so the player reached the door at ROUGHLY the point where the
// rune tree is ~95% bought, and half the camps means half the attrition on the
// way down, so the door now falls earlier than that. The per-chapter checks in
// the table below are unchanged — chapter 8 still asks for burst that out-paces
// a mend — but the hero arrives at each of them with less grind behind him.
// Measured with `node tools/attrition.mjs`, which is the instrument to re-read
// after any change here: a build at ~10% of treeGold used to be ground down in
// chapter 5 and now gets into chapter 7, and the finished build used to fall
// one camp short of the door and now walks out of it, in 10 minutes rather
// than 24. The deep chapters are where that slack sits, so if the hall wants
// tightening again, tighten the VARIANTS in those chapters rather than adding
// the camps back.
//
// Nothing enforces the ~95% with a number, and nothing should: the tree is
// bought with quiz gold and the hall is walked with damage, and welding the two
// together would make the fight a progress bar. What ties them is the RAMP.
// Enemies never scale (see CONFIG.enemyBaseHP) — a camp is exactly as hard as
// the bodies written into it — so the hall's difficulty is entirely this table,
// and it is a DAMAGE check the whole way down: HP pools, armour that only
// penetration erodes, and healers that mend faster than a small spell chews.
// A hero who has not grown his damage stalls, is ground down, and dies a
// chapter or two short of where he'd like to be. Which chapter that is, is the
// design intent recorded below.
//
// THE POOLS BELOW ARE OWED A PASS. They were set against the damage curve as it
// stood before the tree was repriced from one total (CONFIG.treeGold /
// treeTotals) and the stat ceilings were removed. Under the new curve a
// Feuerball hit runs ~199 at a quarter of the tree and ~749 at nearly all of it
// — the endgame hero is some 4.6× harder-hitting than the one these HP pools
// were sized for, so the last chapters land softer than the table claims and the
// door is reachable earlier than the ~95% it is written for. `node
// tools/stat-supply.mjs` prints that curve against tree completion, which is the
// figure to re-tune the deep variants against.
//
//     chapter                 camps      metres       the hero it is written for
//     ----------------------  ---------  -----------  ---------------------------
//      1  Schleim               0–1        0–2.5     nothing at all · a first-ever minute
//      2  Knochen               2–8        5–20      a fresh tree · the first two runs
//      3  Knochenläufer         9–13    22.5–32.5    ~10% · flat damage, one page open
//      4  Kobolde              14–18      35–45      ~20% · a second page
//      5  Orks                 19–23    47.5–57.5    ~30% · the first penetration ranks
//      6  Imps                 24–28      60–70      ~35% · area damage that reaches the back
//      7  Die faulenden Reihen 29–33    72.5–82.5    ~45% · sustain, or nothing survives the grind
//      8  Schamanen            34–38      85–95      ~55% · burst enough to out-pace a mend
//      9  Wogole               39–43    97.5–107.5   ~60% · a third page
//     10  Nekromanten          44–48     110–120     ~65% · picking targets, not just the front
//     11  Masken               49–53   122.5–132.5   ~72% · penetration in earnest
//     12  Das Eis              54–58     135–145     ~78% · crit, and a fourth page
//     13  Chorts               59–63   147.5–157.5   ~83% · everything at once, quickly
//     14  Oger                 64–68     160–170     ~87% · single-target damage
//     15  Fleischberge         69–73   172.5–182.5   ~91% · both, sustained
//     16  Das Tor              74–81     185–202.5   ~95% · a grown tree, and the door
//
// Chapter 1 is the exception to every line under it: it is the ONLY one that is
// not a check of anything, and it is not part of the ramp — it is the step onto
// it. Ch. 2 is still the game's real opening, the skeleton-and-brute lesson, met
// by exactly the hero it always was, two camps and 5 m later than before.
//
// Re-tuning the hall means re-tuning THIS table (and the variants it names), not
// hunting for a difficulty multiplier — there isn't one.
// ==============================================================================
//
// A chapter is a plain list of pack ids in the order they are met. An entry may
// also be written as [id, reinforce] — `reinforce` appends that many extra
// copies of the pack's LAST rank, so a shape can be reused at a heavier weight
// without needing its own entry. The plan uses none at the moment: a reinforced
// re-run of a camp already met was exactly the kind of repetition the cut to
// half length went after, so the mechanism is here and unused rather than gone.
//
// Each chapter below is the halved list. What every one of them still keeps, in
// this order: the new body ALONE (or leading, where it cannot hurt anyone), the
// new body escorted, any further new colourways of it, and one closing camp
// heavy enough to be the chapter's last word. What every one of them dropped:
// the second pass at a head count already shown, and the callbacks to earlier
// chapters where a chapter had more than one.
const CHAPTERS = [
  {
    name: "Schleim",
    // The ramp's bottom step: two camps of slimes before the first skeleton.
    // A player opening the game for the first time has never traced a rune, and
    // the hall used to answer that with a skeleton that hits for 48 out of 112.
    // These two cost nothing to get wrong — one slime, then a cold one leading a
    // pair — so the opening minute is spent learning the circle rather than
    // learning the death screen.
    //
    // It is also where the hall's one trick body is taught, and taught in
    // order. A slime DIVIDES when it is hurt (see CONFIG.slimeTiers): camp one
    // is a single big one, so the very first cast of the game turns one body
    // into two smaller ones with nothing else on screen to confuse the lesson —
    // and the cast after that turns each of those into two smaller ones again,
    // all the way down to four of the smallest, which is the whole ladder taught
    // on one body. Camp two is the wedge: the Tropfling, the cold colourway of
    // the same trick, leading two of the first camp's slimes — three bodies that
    // come apart into six and those into twelve, which is the first floor the
    // corridor makes that holds more targets than the player has casts to spare.
    //
    // The chapter breaks the "one new body alone first" rule on the Tropfling,
    // and deliberately: the rule exists so a body that can kill you is legible
    // before it arrives escorted, and neither of these can. It leads the wedge
    // instead, which is legible enough for something that hits for 4.
    packs: ["schleim", "schleimnest"],
  },
  {
    name: "Knochen",
    // The skeleton-and-brute lesson, in the order it always ran, at half its
    // camps: one skeleton, three, four, then the brute alone — one big
    // silhouette with nothing to hide behind — then the brute escorted, then a
    // squad of brutes, then the ten-body mob. The head counts it dropped (paar,
    // kolonne, zange, reihe, mauer) each restated a step this list already
    // makes; the shapes are still in PACKS.
    packs: ["spaeher", "keil", "welle", "koloss", "wache", "bollwerk", "schwarm"],
  },
  {
    name: "Knochenläufer",
    packs: ["laeufer", "hetze", "vorhut", "meute", "knochenlauf"],
  },
  {
    name: "Kobolde",
    packs: ["kobold", "kobolde", "blutkobold", "frostkobold", "koboldheer"],
  },
  {
    name: "Orks",
    packs: ["ork", "orkpaar", "koboldnest", "schwarzork", "orkkeil"],
  },
  {
    name: "Imps",
    packs: ["imp", "impwurf", "impdeckung", "eisimp", "impfeuer"],
  },
  {
    name: "Die faulenden Reihen",
    packs: ["zombie", "schlamm", "sumpf", "faeulnis", "totenzug"],
  },
  {
    name: "Schamanen",
    packs: ["schamane", "heilkreis", "orkheer", "faulmesse", "aeltester"],
  },
  {
    name: "Wogole",
    // Four new bodies in five camps, which is why this one keeps no callback at
    // all: wogol, then the warden, then the pale wogol, then the void imp, and
    // the closing mauer is the only camp here that is not an introduction.
    packs: ["wogol", "knochenwache", "bleichfeuer", "schattenimp", "fernkampf"],
  },
  {
    name: "Nekromanten",
    packs: ["nekromant", "totenruf", "grabherr", "totenfeld", "knochenfuerst"],
  },
  {
    name: "Masken",
    packs: ["maske", "maskenwall", "blutmaske", "eisenork", "eisenwall"],
  },
  {
    name: "Das Eis",
    packs: ["eiszombie", "frostzug", "frostwall", "bleichruf", "eisheer"],
  },
  {
    name: "Chorts",
    packs: ["chort", "chortkeil", "aschebrand", "schattenwogol", "hoellenzug"],
  },
  {
    name: "Oger",
    packs: ["oger", "ogerwache", "frostoger", "frostchort", "ogerpaar"],
  },
  {
    name: "Fleischberge",
    packs: ["fleischberg", "bergwache", "schwarzoger", "pestberg", "pestfeld"],
  },
  {
    name: "Das Tor",
    // The one chapter still worth more than five camps, because it has five new
    // bodies to spend them on: the demon, the bone mask, the blood shaman, the
    // ash devil and the lord at the door.
    packs: ["daemon", "daemonwache", "knochenmaske", "blutmesse", "daemonhof",
            "ascheteufel", "torwall", "daemonenfuerst"],
  },
];

// Flatten the chapters into the plan the spawner reads: one entry per camp, laid
// on the fixed cadence. `at` is metres travelled this run (one metre = one floor
// tile) and is DERIVED — the schedule is a rhythm, not a list of hand-picked
// marks, and writing 160 marks by hand only creates ways to typo one.
const ENCOUNTER_PLAN = (() => {
  const out = [];
  for (let c = 0; c < CHAPTERS.length; c++) {
    for (const entry of CHAPTERS[c].packs) {
      const [id, reinforce] = Array.isArray(entry) ? entry : [entry, 0];
      out.push({
        at: out.length * CONFIG.encounterSpacingMetres,
        pack: id,
        reinforce: reinforce || 0,
        chapter: c,
      });
    }
  }
  return out;
})();

// Where the corridor stops. The hero walks one last stretch past the final camp
// and reaches the door — a full spacing beyond the last mark, so the fight and
// the ending don't land on the same step.
const HALL_END_METRES =
  ENCOUNTER_PLAN[ENCOUNTER_PLAN.length - 1].at + CONFIG.encounterSpacingMetres;

// The encounter at plan index `i`, or null once the plan is walked out — which
// now happens, and is the whole point: past the last camp there is a door, not
// another lap. Returns { at, pack, reinforce, chapter }.
function encounterAt(i) {
  if (i < 0 || i >= ENCOUNTER_PLAN.length) return null;
  const e = ENCOUNTER_PLAN[i];
  return { at: e.at, pack: PACKS[e.pack], reinforce: e.reinforce || 0, chapter: e.chapter };
}

// The metre mark the hero is currently walking toward: the next camp, or the
// door once every camp has been met. Distance is the run's only clock, so this
// is what updateCamera pulls up on.
function nextMark(i) {
  const next = encounterAt(i);
  return next ? next.at : HALL_END_METRES;
}

// Which chapter a depth falls in, for the HUD. The cadence is fixed, so the
// camp index is arithmetic rather than a scan — this is read every frame.
function chapterAt(metres) {
  const i = Math.max(0, Math.min(ENCOUNTER_PLAN.length - 1,
    Math.floor(metres / CONFIG.encounterSpacingMetres)));
  return CHAPTERS[ENCOUNTER_PLAN[i].chapter];
}

// The ranks an encounter actually sends in, reinforcements included, with each
// member resolved to { lane, type } so the spawner never has to re-read the
// pack's optional `types` shorthand.
function packRanks(entry) {
  const pack = entry.pack;
  const rankAt = (r) => pack.ranks[r].map((lane, i) => {
    const t = pack.types && pack.types[r];
    return { lane, type: (Array.isArray(t) ? t[i] : t) || DEFAULT_TYPE };
  });
  const ranks = pack.ranks.map((_, r) => rankAt(r));
  // Reinforcements repeat the last rank — variants and all, so reinforcing a
  // brute pack sends more brutes rather than quietly diluting it with skeletons.
  for (let i = 0; i < entry.reinforce; i++) ranks.push(rankAt(pack.ranks.length - 1));
  return ranks;
}

function packSize(entry) {
  return packRanks(entry).reduce((n, rank) => n + rank.length, 0);
}

// Design aid: dump the schedule to the console —
// `Incanto.encounters.previewPlan()`. Shows where each pack is met, its
// formation rank by rank, and its head count, so a change to PACKS or CHAPTERS
// can be read back without playing all the way to it. Each rank prints as
// [lane:type …], with the plain skeleton left unnamed.
function previewPlan(count = ENCOUNTER_PLAN.length, from = 0) {
  const lines = ["  #      at   pack             formation (front rank first)"];
  let chapter = -1;
  for (let i = from; i < Math.min(from + count, ENCOUNTER_PLAN.length); i++) {
    const e = encounterAt(i);
    if (e.chapter !== chapter) {
      chapter = e.chapter;
      lines.push(`--- ${chapter + 1}. ${CHAPTERS[chapter].name} ---`);
    }
    const shape = packRanks(e)
      .map((rank) => "[" + rank.map((m) => m.lane + (m.type === DEFAULT_TYPE ? "" : ":" + m.type)).join(" ") + "]")
      .join("");
    lines.push(
      `${String(i).padStart(3)}  ${String(e.at + "m").padStart(6)}   ${e.pack.name.padEnd(15)}  ${shape}  (${packSize(e)})`
    );
  }
  lines.push(`--- Tor bei ${HALL_END_METRES} m ---`);
  return lines.join("\n");
}

// Design aid: where every variant first shows up, so "no new body before it is
// earned" can be checked rather than assumed —
// `Incanto.encounters.previewBestiary()`.
function previewBestiary() {
  const first = new Map();
  for (let i = 0; i < ENCOUNTER_PLAN.length; i++) {
    const e = encounterAt(i);
    for (const rank of packRanks(e)) {
      for (const m of rank) if (!first.has(m.type)) first.set(m.type, e);
    }
  }
  const lines = ["  at   kapitel  gegner"];
  for (const [type, e] of first) {
    lines.push(`${String(e.at + "m").padStart(6)}   ${String(e.chapter + 1).padStart(2)}      ${type}`);
  }
  return lines.join("\n");
}

window.Incanto.encounters = {
  PACKS, SHAPES, CHAPTERS, ENCOUNTER_PLAN, HALL_END_METRES, DEFAULT_TYPE,
  encounterAt, nextMark, chapterAt, packRanks, packSize, previewPlan, previewBestiary,
};
