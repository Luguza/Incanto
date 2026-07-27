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
// Spacing is the pacing dial. The hero covers ~1.9 m/s and gains ~3.5 m while a
// pack marches in, so a 6-8 m gap has him walking a beat or two between fights;
// tighten it and the fights start running together, widen it much past 9 m and
// the corridor starts to feel like a corridor rather than a fight (updateSpawns
// pulls the next pack forward before it can go quiet — see enemyMaxEmptyMs).
const ENCOUNTER_PLAN = [
  { at: 0,  pack: "spaeher" },              //  1 — opens the run right away
  { at: 6,  pack: "paar" },                 //  2
  { at: 13, pack: "keil" },                 //  3
  { at: 20, pack: "kolonne" },              //  3 — first pack that queues up behind itself
  { at: 27, pack: "welle" },                //  4 — first time every lane is filled
  { at: 34, pack: "koloss" },               //  1 — first brute, alone, so it reads before it's escorted
  { at: 40, pack: "zange" },                //  4
  { at: 47, pack: "reihe" },                //  4 — first solid wall of four
  { at: 54, pack: "wache" },                //  3 — and now the brute has cover
  { at: 61, pack: "trupp" },                //  6
  { at: 68, pack: "mauer" },                //  8
  { at: 75, pack: "bollwerk" },             //  6 — two brutes at the front
  { at: 82, pack: "schwarm" },              // 10
  { at: 90, pack: "mauer", reinforce: 1 },  // 12 — the authored run ends heavy
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
