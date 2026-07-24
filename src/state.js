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
    // Hero: an HP pool (no discrete hearts) that upgrades persist across waves
    heroMaxHP: CONFIG.heroBaseHP,
    heroHP: CONFIG.heroBaseHP,
    heroDmg: CONFIG.heroBaseDmg,
    dmgLevel: 0,
    hpLevel: 0,
    gold: 0,
    // Endless waves — each wave sends a mob of skeletons that walk in from the
    // right. An enemy: {id, maxHP, hp, dmg, slot, pos, phase, phaseAt, attackAt,
    // attackAnimAt}. `pos` is in tiles to the right of the hero (0 = at him);
    // `phase` is walk | idle | attack | dying.
    wave: 1,
    enemies: [],
    nextEnemyId: 1,
    castTargetId: null,       // which enemy the in-flight fireball is aimed at
    pendingWaveEnd: false,    // set when the last skeleton falls; ends the wave after the cast anim
    poolIndex: 0,
    wrongMatchCount: 0,
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
    quizAnsweredAt: 0,
    lastWaveReached: 1,
    clockMs: 0,               // internal clock warped by mode+selection, drives windup + instrumentation
    runStartMs: 0,            // wall-clock start of the run, for the end-screen summary
    pairAvailableAtClockMs: {},
    wrongFlashUntil: 0,
    runeFlashUntil: 0,   // combat: rune circle glowing red after a wrong pair
    heroBlastUntil: 0,   // combat: harmful explosion bursting around the hero
    shapeFlashUntil: 0,
    castAt: 0,
    castChords: null, // snapshot of the completed chords for the cast animation
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
      dmgLevel: state.dmgLevel,
      hpLevel: state.hpLevel,
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

function clearProgress() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}

// Overlay any persisted meta-progression onto a freshly built state.
function applySavedProgress() {
  const data = loadProgress();
  if (!data) return;
  const asCount = (v) => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  state.gold = asCount(data.gold);
  state.dmgLevel = asCount(data.dmgLevel);
  state.hpLevel = asCount(data.hpLevel);
  state.heroDmg = CONFIG.heroBaseDmg + state.dmgLevel * CONFIG.dmgPerLevel;
  state.heroMaxHP = CONFIG.heroBaseHP + state.hpLevel * CONFIG.hpPerLevel;
  state.heroHP = state.heroMaxHP;
}

window.Incanto.state = { freshState, newGame, saveProgress, loadProgress, clearProgress, applySavedProgress };
