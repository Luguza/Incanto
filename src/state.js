"use strict";
// ==============================================================================
// state.js — game state + persistence. Owns: state, freshState, newGame,
// save/load/clear/applySavedProgress. `state` is a shared global (see CLAUDE.md).
// ==============================================================================

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let state = null;

function freshState() {
  return {
    screen: "combat",       // combat | quiz | history | upgrade | bookorder | stats | tavern | reward
    statsTab: "hero",       // which tab the ledger screen shows (see stats.js) — pure UI, not persisted
    runActive: false,       // a combat run is live (used by the bottom nav to resume vs. restart)
    runes: [],               // {id, pairId, lang, word, x, y, matchState}
    selectedRuneId: null,
    // Drag-to-connect: press a rune, drag to its pair, release to match.
    dragActive: false,       // a pointer drag is in progress
    dragMoved: false,        // the pointer moved past the tap threshold since pressing
    dragPointer: null,       // {x, y} pointer position in SVG (viewBox) coords, for the live line
    chords: [],              // {x1,y1,x2,y2,pairId}
    currentPairs: [],
    // Hero: an HP pool (no discrete hearts) whose upgrades persist across runs.
    // The build is now the skill tree: `nodeRanks` (persisted) is the source of
    // truth, `mods` is the derived stat bundle recomputed from it, and heroMaxHP
    // / heroDmg are two derived legacy fields the combat code still reads.
    heroMaxHP: CONFIG.heroBaseHP,
    heroHP: CONFIG.heroBaseHP,
    heroDmg: CONFIG.heroBaseDmg,
    heroShield: 0,             // absorb pool granted by Ward nodes on some casts
    // A meal eaten at the bar between runs (see tavern.js). It cannot go into
    // heroShield directly — startRun clears that pool, so a shield taken in the
    // tavern would be wiped by the very walk into the hall it was meant for. It
    // waits here instead and is poured into heroShield when the next run begins;
    // eating DURING a run skips the wait and fills the pool on the spot.
    mealShield: 0,
    nodeRanks: {},             // { nodeId: rank } — purchased skill-tree ranks
    tree: null,                // { scale, tx, ty, selected } — pan/zoom view state
    // Derived combat modifiers (see skilltree.recomputeMods). Safe defaults so
    // combat never touches an undefined field before the first recompute.
    mods: {
      flatDmg: 0, armor: 0, armorPen: 0,
      critChance: 0, critMult: 1.5, leech: 0, regen: 0, castHaste: 0,
      walkMult: 1, coinMult: 1, shieldChance: 0, shieldAmount: 0, shieldMax: 0,
      thorns: 0, spellFailProt: 0,
      spellsUnlocked: {}, spellPct: {}, spellParam: {},
    },
    gold: 0,
    // Designed packs walk in from the right as the hero passes their metre marks
    // (see encounters.js). An enemy: {id, maxHP, hp, dmg, slot, lane, pos, phase,
    // phaseAt, attackAt, attackAnimAt, deathAt, splitAt}. `pos` is in tiles to
    // the right of the hero (0 = at him); `phase` is walk | idle | attack |
    // frozen | dying and says only what the body is visibly DOING. Whether it is
    // already dead is `deathAt`: a fatal hit books the moment the blow arrives,
    // and until then the body keeps marching and swinging as though nothing had
    // hit it. `splitAt` is the same clock for the other thing a blow can do —
    // a slime coming apart (see progression.splitSlime).
    kills: 0,                 // bodies slain this run (the end-screen score)
    // Bolts a ranged body has in the air: {shooterId, dmg, rgb, born, landAt,
    // from, hit}. They carry their own damage and land on their own clock (see
    // updateEnemyShots), so a shot outlives the caster that threw it.
    enemyShots: [],
    // Goo on the floor: {x (WORLD px, camera baked in), lane, rx, ry, type, born,
    // ttl}. A walking slime plants one every few strides and a split splashes a
    // handful under the pair (see progression.plantGoo). Decoration only —
    // nothing reads it back — and it dies of old age.
    slimeGoo: [],
    // How deep the hall has ever been walked, in metres, and whether its far
    // door has been reached at all. Both are persisted: the hall is finite (see
    // encounters.HALL_END_METRES), so how far down it you have been is the one
    // number that says how much of the game you have seen. `hallCleared` is the
    // same fact for THIS run only, and is what the end screen reads.
    deepest: 0,
    hallCleared: false,
    hallClearedEver: false,
    // The reward bank: skeletons slain and not yet cashed in. Unlike `kills` it
    // survives a death and a fresh run (see creditKill) and is persisted — it
    // empties only when a whole quiz session is finished.
    rewardKills: 0,
    enemies: [],
    nextEnemyId: 1,
    packIndex: 0,             // how far through the encounter plan this run has walked (see encounters.js)
    emptySinceMs: 0,          // when the corridor last went visibly bare (0 = something is on camera)
    fillerLane: -1,           // rotates so consecutive dead-air fillers spread across the lanes
    laneRouteAt: 0,           // when the mob last re-read the floor for a way round (see pathfind.js)
    cameraX: 0,               // hallway scroll (px): grows as the hero strides right down the corridor
    distance: 0,              // metres walked this run (cameraX / TILE) — triggers the encounter plan
    cameraVel: 0,             // current pan speed (px/ms), eased toward its target so starts/stops aren't abrupt
    stridePhase: 0,           // corridor px covered on foot — drives the footstep bob's cadence
    castTargetId: null,       // which enemy the in-flight spell is aimed at (null for the untargeted ones)
    // The spell book (see spells.js / spellbook.js). `activeSpell` is the page
    // it's open at — the spell a completed shape casts — and `bookSpread` is
    // which leaf is showing, which is pure UI and deliberately not persisted.
    // `spellOrder` is how the pages are BOUND: a permutation of the spell ids
    // the player rearranges on the order screen (book-order.js), persisted.
    activeSpell: STARTER_SPELL,
    spellOrder: SPELLS.map((s) => s.id),
    bookSpread: 0,
    spellFx: [],              // queued scene effects for render-spells (bolts, arcs, meteors, auras)
    meteorRocks: [],          // rocks of a Meteoritenschauer still in the sky (see updateMeteorRocks)
    castSpell: STARTER_SPELL, // which spell the in-progress cast animation belongs to
    spellPrimeUntil: 0,       // a Frostkegel primes the next cast to shatter frozen bodies
    poolIndex: 0,
    wrongMatchCount: 0,
    // Learning history (see vocab-history.js): key -> per-word tally of every
    // sighting, hit and slip. Persisted under its own save key; `historyFilter`
    // is which tab the Lernverlauf screen is showing and is pure UI.
    vocab: {},
    historyFilter: "seen",
    // Post-death vocab quiz — a mixed Duolingo-style session
    quizList: [],
    quizIndex: 0,
    quizCorrect: 0,
    quizGoldEarned: 0,
    quizResults: [],         // per question, once settled: "right" | "wrong" | "shown" (drives the step bar)
    quizChecked: false,      // the current question has been answered/checked
    quizWasCorrect: false,   // result of the checked answer
    quizRevealed: false,     // solution shown via "I don't know" (checked, but no gold)
    quizPicked: null,        // choose / fill-choose: selected option index
    quizTyped: "",           // type / fill-type: mirror of the text input
    quizBuilt: [],           // arrange: bank tile indices placed, in order
    quizMatchSel: null,      // match: {col, idx} currently armed tile
    quizMatchDone: [],       // match: pair ids already solved
    quizMatchWrong: null,    // match: {left, right} flashing red, briefly
    quizMatchMisses: 0,      // match: wrong taps this question
    quizConj: [],            // conj-table: what is written on each of the six rows, by person index
    quizConjFocus: null,     // conj-table: last row written into, so a forced rebuild lands back in it
    // The conjugation ladder (see CONFIG.conjugation): the hardest rung the
    // player has proved, and the signed streak that moves it. Persisted — a
    // learner who has earned the whole-table drill keeps it across runs.
    conjLevel: 0,
    conjStreak: 0,
    // Testing tools on the upgrade screen (see skilltree.js: devToggle). Off by
    // default and persisted, so a tester keeps them armed across reloads while a
    // player never sees more than the slider itself.
    devMode: false,
    quizWordMisses: [],      // WORD_POOL indices fumbled on the current question (see vocab-history.js)
    quizAnsweredAt: 0,
    clockMs: 0,               // internal clock warped by mode+selection, drives windup + instrumentation
    runStartMs: 0,            // wall-clock start of the run, for the end-screen summary
    pairAvailableAtClockMs: {},
    wrongFlashUntil: 0,
    runeFlashUntil: 0,   // combat: rune circle glowing red after a wrong pair
    heroBlastUntil: 0,   // combat: harmful explosion bursting around the hero
    shapeFlashUntil: 0,
    castAt: 0,
    castChords: null, // snapshot of the completed chords for the cast animation
    dmgFloats: [],    // {value, color, born, x, y, targetId} damage numbers over fighters
    pendingRefill: false,
    // Tap-tap: after the second tap resolves a pair, the staff traces to the 2nd
    // rune of that pair before resting (or, on the third pair, before the cast).
    tapTraceUntil: 0,
    tapTraceFrom: null,      // {x,y} arena pos of the first rune of the pair
    tapTraceTo: null,        // {x,y} arena pos of the second rune of the pair
    pendingShapeAt: 0,       // when >0 and reached, fire the deferred cast (onShapeComplete)
    _structuralDirty: false, // set true whenever runes/chords/screen need a full DOM rebuild
  };
}

function newGame() {
  state = freshState();
  applySavedProgress();
}

// A slain skeleton counts twice: once toward this run's score, and once into the
// reward bank that multiplies the next quiz's payout. The bank is deliberately
// NOT cleared by starting a new run (see startRun) and not by dying either — it
// only empties when a full quiz session is finished (see advanceQuiz), so every
// fight the player wins is eventually worth gold. Persisted on the spot so a
// reload mid-run can't swallow the pile.
function creditKill() {
  state.kills++;
  state.rewardKills++;
  saveProgress();
}

// The multiplier the banked kills are currently worth, capped. Reads as "×2.4"
// on the reward screen and in the quiz header.
function rewardMult() {
  const banked = Math.max(0, state.rewardKills || 0);
  return Math.min(1 + banked * CONFIG.rewardPerKill, CONFIG.rewardMultMax);
}
function rewardMultCapped() {
  return rewardMult() >= CONFIG.rewardMultMax;
}

// ---------------------------------------------------------------------------
// Persistence — meta-progression (gold + upgrade levels) survives reloads via
// localStorage. Only the source-of-truth numbers are stored; hero DMG and max
// HP are always re-derived from the levels, so tuning CONFIG stays authoritative.
// ---------------------------------------------------------------------------
const SAVE_KEY = "incanto.save.v1";

function saveProgress() {
  if (!state) return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      gold: state.gold,
      rewardKills: state.rewardKills,
      nodeRanks: state.nodeRanks,
      activeSpell: state.activeSpell,
      spellOrder: state.spellOrder,
      conjLevel: state.conjLevel,
      conjStreak: state.conjStreak,
      deepest: state.deepest,
      hallClearedEver: state.hallClearedEver,
      devMode: state.devMode,
    }));
  } catch (e) { /* storage unavailable (private mode/quota) — play without saving */ }
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return (data && typeof data === "object") ? data : null;
  } catch (e) { return null; }
}

// A full reset: the meta-progression save AND the learning history, which is
// stored separately but is just as much "progress".
function clearProgress() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  if (typeof clearVocabHistory === "function") clearVocabHistory();
}

// Overlay any persisted meta-progression onto a freshly built state, then derive
// the build from it. Legacy saves (flat dmgLevel/hpLevel from the old two-button
// shop) are migrated onto the two entry skill-tree nodes so no progress is lost.
// Gold handed back per rank that a save carried on a node the current tree no
// longer has. The tree was replanted into authored branches (see skilltree.js),
// so old deep ids have nowhere to land — refunding turns a silent wipe into a
// pile of gold to re-spend. The save is rewritten immediately afterwards, so a
// rank is only ever refunded once.
const REPLANT_REFUND = 40;

function applySavedProgress() {
  const asCount = (v) => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  // The learning history rides along in its own save (see vocab-history.js) —
  // restored first, because the very first loadout is dealt from it.
  if (typeof loadVocabHistory === "function") state.vocab = loadVocabHistory();
  const data = loadProgress();
  let orphanedRanks = 0;
  if (data) {
    state.gold = asCount(data.gold);
    state.rewardKills = asCount(data.rewardKills);
    // The conjugation ladder, clamped to the rungs that currently exist — the
    // levels are CONFIG, and a save must survive one being added or removed.
    const rungs = (CONFIG.conjugation && CONFIG.conjugation.levels.length) || 1;
    state.conjLevel = Math.min(asCount(data.conjLevel), rungs - 1);
    state.conjStreak = Number.isFinite(data.conjStreak) ? Math.trunc(data.conjStreak) : 0;
    // How far down the hall this save has ever been. Clamped to the hall's
    // current length so shortening the plan can't leave a save claiming a depth
    // that no longer exists.
    state.deepest = Math.min(
      Number.isFinite(data.deepest) ? Math.max(0, data.deepest) : 0,
      typeof HALL_END_METRES !== "undefined" ? HALL_END_METRES : Infinity
    );
    state.hallClearedEver = !!data.hallClearedEver;
    state.devMode = data.devMode === true;
    if (data.nodeRanks && typeof data.nodeRanks === "object") {
      const ranks = {};
      const nodes = (typeof TREE_NODES !== "undefined") ? TREE_NODES : {};
      const legacy = (typeof LEGACY_NODE_IDS !== "undefined") ? LEGACY_NODE_IDS : {};
      for (const id in data.nodeRanks) {
        const r = asCount(data.nodeRanks[id]);
        if (r <= 0) continue;
        // accept current ids as-is; remap ids from an earlier release onto their
        // present-day equivalent so nobody's tree progress is silently wiped
        const mapped = nodes[id] ? id : legacy[id];
        const node = mapped ? nodes[mapped] : null;
        if (!node) { orphanedRanks += r; continue; }
        // A node reshaped since the save was written can hold fewer ranks than
        // the save bought. Those ranks were paid for, so they refund like any
        // other rank the current tree has nowhere to put.
        const want = (ranks[mapped] || 0) + r;
        ranks[mapped] = Math.min(want, node.maxRank);
        orphanedRanks += want - ranks[mapped];
      }
      state.nodeRanks = ranks;
      state.gold += orphanedRanks * REPLANT_REFUND;
    } else {
      // migrate the very old flat dmgLevel/hpLevel onto the two entry nodes
      state.nodeRanks = {};
      const nd = (typeof TREE_NODES !== "undefined") ? TREE_NODES : {};
      if (asCount(data.dmgLevel) > 0 && nd.migp0) state.nodeRanks.migp0 = Math.min(asCount(data.dmgLevel), nd.migp0.maxRank);
      if (asCount(data.hpLevel) > 0 && nd.vigp0) state.nodeRanks.vigp0 = Math.min(asCount(data.hpLevel), nd.vigp0.maxRank);
    }
  }
  if (typeof recomputeMods === "function") recomputeMods();
  // The open page is restored only if its unlock node is still bought — a wiped
  // or regenerated tree must never leave the book open at a spell the hero can
  // no longer cast (activeSpellId falls back on its own, this just keeps the
  // saved value honest so the book doesn't show a sealed page as active).
  if (data && data.activeSpell && typeof spellUnlocked === "function" && spellUnlocked(data.activeSpell)) {
    state.activeSpell = data.activeSpell;
  }
  // How the pages were bound last time. Run through normalizeSpellOrder so a
  // save written before a spell existed (or one that lost an id) still comes
  // back as a complete book.
  if (typeof normalizeSpellOrder === "function") {
    state.spellOrder = normalizeSpellOrder(data && data.spellOrder);
  }
  // Open the book at the spread the active page sits on — in the order the
  // player bound it, not the authored one.
  if (typeof bookSlot === "function") {
    const idx = bookSlot(state.activeSpell);
    if (idx >= 0) state.bookSpread = Math.floor(idx / 2);
  }
  // Write the pruned tree straight back, so the refund above can never be
  // collected twice by reloading the page.
  if (orphanedRanks > 0) saveProgress();
  state.heroHP = state.heroMaxHP;
}

window.Incanto.state = {
  freshState, newGame, saveProgress, loadProgress, clearProgress, applySavedProgress,
  creditKill, rewardMult, rewardMultCapped,
};
