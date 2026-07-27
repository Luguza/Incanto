"use strict";
// ==============================================================================
// encounters.js — the designed enemy schedule. Owns: PACKS (named formations),
// ENCOUNTER_PLAN (which pack the hero meets at which distance), LATE_CYCLE (the
// endless continuation), and the accessors that read them.
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
// CONFIG.enemyTypes — what a brute *is* lives there, where brutes *appear* is
// decided here.
const DEFAULT_TYPE = "skeleton";
const PACKS = {
  spaeher: { name: "Späher",  ranks: [[2]] },                                  // 1 — a lone scout in the hero's lane
  paar:    { name: "Paar",    ranks: [[1, 3]] },                               // 2 — two abreast, off to one side
  keil:    { name: "Keil",    ranks: [[2], [1, 3]] },                          // 3 — a point with two wings behind
  kolonne: { name: "Kolonne", ranks: [[2], [2], [2]] },                        // 3 — single file straight down the middle
  welle:   { name: "Welle",   ranks: [[0, 2], [1, 3]] },                       // 4 — staggered, fills every lane over two ranks
  zange:   { name: "Zange",   ranks: [[0, 3], [0, 3]] },                       // 4 — a pincer down both outer lanes
  reihe:   { name: "Reihe",   ranks: [[0, 1, 2, 3]] },                         // 4 — one full-width line
  trupp:   { name: "Trupp",   ranks: [[1, 2], [0, 3], [1, 2]] },               // 6 — a squad, weaving lanes rank to rank
  mauer:   { name: "Mauer",   ranks: [[0, 1, 2, 3], [0, 1, 2, 3]] },           // 8 — two solid ranks, no gaps
  schwarm: { name: "Schwarm", ranks: [[0, 1, 2, 3], [1, 2], [0, 3], [1, 2]] }, // 10 — a full-width mob with a deep tail

  // Brute packs. A brute carries twice the HP and damage and swings ~40% faster,
  // so it's introduced alone — one big silhouette with nothing to hide behind —
  // before it ever turns up escorted.
  koloss:   { name: "Koloss",   ranks: [[2]], types: ["brute"] },              // 1 — a lone brute, the hero's lane
  wache:    { name: "Wache",    ranks: [[1, 2, 3]],                            // 3 — a brute walled in by two skeletons
              types: [[DEFAULT_TYPE, "brute", DEFAULT_TYPE]] },
  bollwerk: { name: "Bollwerk", ranks: [[1, 2], [0, 3], [1, 2]],               // 6 — two brutes lead, skeletons behind
              types: ["brute"] },
};

// The authored opening: which pack the hero walks into, and how far down the
// hall he meets it. `at` is metres travelled this run (one metre = one floor
// tile). `reinforce` appends that many extra copies of the pack's LAST rank, so
// a shape can be reused at a heavier weight without needing its own entry.
//
// Spacing is the pacing dial, and it is set against the dead-air rule rather
// than by eye. The hero walks at ~1.9 m/s and only between camps, so a gap takes
// gap/1.9 seconds of empty corridor; once that passes `enemyMaxEmptyMs` (1.5 s,
// about 2.8 m) a filler skeleton walks in to cover the quiet. Gaps below that
// threshold produce no fillers at all; gaps above it produce one EVERY time,
// because the filler halts the hero and he has to clear it before setting off
// again. There is no middle: measured across a 3-minute run, 2.5 m gaps give
// ~100% of enemies and of separate fights from designed camps, while 3 m gaps
// drop that to 85% / 52% and 8 m gaps to 57% / 26%.
//
// So camps sit ~2.5 m apart, comfortably inside the budget, and the filler goes
// back to being what it should be — a safety net for the odd long gap, not the
// game's main supply of skeletons. Widening these marks past ~2.8 m hands the
// corridor back to the fillers.
const ENCOUNTER_PLAN = [
  { at: 0,    pack: "spaeher" },              //  1 — opens the run right away
  { at: 2.5,  pack: "paar" },                 //  2
  { at: 5,    pack: "keil" },                 //  3
  { at: 7.5,  pack: "kolonne" },              //  3 — first pack that queues up behind itself
  { at: 10,   pack: "welle" },                //  4 — first time every lane is filled
  { at: 12.5, pack: "koloss" },               //  1 — first brute, alone, so it reads before it's escorted
  { at: 15,   pack: "zange" },                //  4
  { at: 17.5, pack: "reihe" },                //  4 — first solid wall of four
  { at: 20,   pack: "wache" },                //  3 — and now the brute has cover
  { at: 22.5, pack: "trupp" },                //  6
  { at: 25,   pack: "mauer" },                //  8
  { at: 27.5, pack: "bollwerk" },             //  6 — two brutes at the front
  { at: 30,   pack: "schwarm" },              // 10
  { at: 32.5, pack: "mauer", reinforce: 1 },  // 12 — the authored run ends heavy
];

// Past the last authored entry the plan continues forever, still with no
// randomness: packs cycle through this list at a fixed spacing, and every
// completed lap adds another rank to whatever comes next. Growth is unbounded;
// CONFIG.enemyMaxCount is what actually caps how much of a pack fits on screen.
const LATE_CYCLE = ["reihe", "bollwerk", "trupp", "mauer", "wache", "schwarm", "zange"];

// The encounter at plan index `i` — defined for every i, forever.
// Returns { at, pack, reinforce }.
function encounterAt(i) {
  if (i < ENCOUNTER_PLAN.length) {
    const e = ENCOUNTER_PLAN[i];
    return { at: e.at, pack: PACKS[e.pack], reinforce: e.reinforce || 0 };
  }
  const k = i - ENCOUNTER_PLAN.length;                     // 0-based step into the endless tail
  const last = ENCOUNTER_PLAN[ENCOUNTER_PLAN.length - 1];
  return {
    at: last.at + (k + 1) * CONFIG.encounterLateSpacingMetres,
    pack: PACKS[LATE_CYCLE[k % LATE_CYCLE.length]],
    reinforce: Math.floor(k / LATE_CYCLE.length) + 1,      // one extra rank per completed lap
  };
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
// `Incanto.encounters.previewPlan(30)`. Shows where each pack is met, its
// formation rank by rank, and its head count, so a change to PACKS or
// ENCOUNTER_PLAN can be read back without playing all the way to it. Each rank
// prints as [lane lane …]; a lane followed by a capital is a variant, so `2B` is
// a brute in lane 2.
function previewPlan(count = 24) {
  const lines = ["  #      at   pack        formation (front rank first)          size"];
  for (let i = 0; i < count; i++) {
    const e = encounterAt(i);
    const shape = packRanks(e)
      .map((rank) => "[" + rank.map((m) => m.lane + (m.type === DEFAULT_TYPE ? "" : m.type[0].toUpperCase())).join(" ") + "]")
      .join("");
    lines.push(
      `${String(i).padStart(3)}  ${String(e.at + "m").padStart(6)}   ${e.pack.name.padEnd(10)}  ${shape.padEnd(36)}  ${String(packSize(e)).padStart(3)}`
    );
  }
  return lines.join("\n");
}

window.Incanto.encounters = { PACKS, ENCOUNTER_PLAN, LATE_CYCLE, DEFAULT_TYPE, encounterAt, packRanks, packSize, previewPlan };
