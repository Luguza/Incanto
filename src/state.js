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
    screen: "combat",       // combat | quiz | upgrade | defeat
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
    nodeRanks: {},             // { nodeId: rank } — purchased skill-tree ranks
    tree: null,                // { scale, tx, ty, selected } — pan/zoom view state
    // Derived combat modifiers (see skilltree.recomputeMods). Safe defaults so
    // combat never touches an undefined field before the first recompute.
    mods: {
      critChance: 0, critMult: 1.5, leech: 0, regen: 0, castHaste: 0,
      walkMult: 1, coinMult: 1, shieldChance: 0, shieldAmount: 0, shieldMax: 0,
      thorns: 0, spellFailProt: 0,
      spellsUnlocked: {}, spellPct: {}, spellParam: {},
    },
    gold: 0,
    // Designed packs walk in from the right as the hero passes their metre marks
    // (see encounters.js). An enemy: {id, maxHP, hp, dmg, slot, lane, pos, phase,
    // phaseAt, attackAt, attackAnimAt, struckUntil}. `pos` is in tiles to the
    // right of the hero (0 = at him); `phase` is walk | idle | attack | struck |
    // dying. `struck` = fatally hit, standing until the bolt lands, then it
    // collapses.
    kills: 0,                 // skeletons slain this run (score + quiz gold bonus)
    enemies: [],
    nextEnemyId: 1,
    packIndex: 0,             // how far through the encounter plan this run has walked (see encounters.js)
    emptySinceMs: 0,          // when the corridor last went visibly bare (0 = something is on camera)
    fillerLane: -1,           // rotates so consecutive dead-air fillers spread across the lanes
    cameraX: 0,               // hallway scroll (px): grows as the hero strides right down the corridor
    distance: 0,              // metres walked this run (cameraX / TILE) — triggers the encounter plan
    cameraVel: 0,             // current pan speed (px/ms), eased toward its target so starts/stops aren't abrupt
    stridePhase: 0,           // corridor px covered on foot — drives the footstep bob's cadence
    castTargetId: null,       // which enemy the in-flight spell is aimed at (null for the untargeted ones)
    // The spell book (see spells.js / spellbook.js). `activeSpell` is the page
    // it's open at — the spell a completed shape casts — and `bookSpread` is
    // which leaf is showing, which is pure UI and deliberately not persisted.
    activeSpell: STARTER_SPELL,
    bookSpread: 0,
    spellFx: [],              // queued scene effects for render-spells (bolts, arcs, meteors, auras)
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
      nodeRanks: state.nodeRanks,
      activeSpell: state.activeSpell,
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
        if (node) ranks[mapped] = Math.min((ranks[mapped] || 0) + r, node.maxRank);
        else orphanedRanks += r;
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
  // Open the book at the spread the active page sits on.
  if (typeof SPELLS !== "undefined") {
    const idx = SPELLS.findIndex((s) => s.id === state.activeSpell);
    if (idx >= 0) state.bookSpread = Math.floor(idx / 2);
  }
  // Write the pruned tree straight back, so the refund above can never be
  // collected twice by reloading the page.
  if (orphanedRanks > 0) saveProgress();
  state.heroHP = state.heroMaxHP;
}

window.Incanto.state = { freshState, newGame, saveProgress, loadProgress, clearProgress, applySavedProgress };
