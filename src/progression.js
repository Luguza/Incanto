"use strict";
// ==============================================================================
// progression.js — enemy scaling, upgrade costs, wave/run start, circle layout,
// and upgrade purchases (buyDmg/buyHp).
// ==============================================================================

// Enemy scaling: each wave's skeleton has more HP and hits harder
function enemyHPForWave(w) {
  return Math.round(CONFIG.enemyBaseHP * Math.pow(CONFIG.enemyHPGrowth, w - 1));
}
function enemyDmgForWave(w) {
  return Math.round(CONFIG.enemyBaseDmg * Math.pow(CONFIG.enemyDmgGrowth, w - 1));
}
function enemyCountForWave(w) {
  const extra = Math.floor((w - 1) / CONFIG.enemyCountEveryWaves);
  return Math.min(CONFIG.enemyMaxCount, CONFIG.enemiesBaseCount + extra);
}
function dmgUpgradeCost() {
  return Math.round(CONFIG.dmgUpgradeBaseCost * Math.pow(CONFIG.upgradeCostGrowth, state.dmgLevel));
}
function hpUpgradeCost() {
  return Math.round(CONFIG.hpUpgradeBaseCost * Math.pow(CONFIG.upgradeCostGrowth, state.hpLevel));
}

// Send in a mob for wave `w`, with fresh words to trace. Every skeleton shares
// the wave's HP/damage; they spawn off the right edge in a trailing column and
// each walks to its own stop slot before it starts attacking.
function startWave(w) {
  state.wave = w;
  const now = performance.now();
  const count = enemyCountForWave(w);
  const maxHP = enemyHPForWave(w);
  const dmg = enemyDmgForWave(w);
  state.enemies = [];
  for (let i = 0; i < count; i++) {
    state.enemies.push({
      id: state.nextEnemyId++,
      maxHP,
      hp: maxHP,
      dmg,
      slot: i,
      pos: 1.15 + i * CONFIG.enemySpawnGap,          // offscreen right, staggered
      stopPos: CONFIG.enemyStandoff + i * CONFIG.enemySlotSpacing,
      phase: "walk",                                  // walk | fight | dying
      phaseAt: now,
      attackAt: 0,
    });
  }
  state.castTargetId = null;
  state.pendingWaveEnd = false;
  state.castAt = 0;
  state.castChords = null;
  state.tapTraceUntil = 0;
  state.tapTraceFrom = null;
  state.tapTraceTo = null;
  state.pendingShapeAt = 0;
  populateCircle(drawLoadout());
}

// A run: fixed build (persists between runs), fight escalating waves until
// death. Build/gold are meta-progression and are NOT reset here.
function startRun() {
  state.wave = 1;
  state.heroHP = state.heroMaxHP;
  state.wrongMatchCount = 0;
  state.runStartMs = performance.now();
  state.runActive = true;
  state.screen = "combat";
  startWave(1);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
function layoutCircle(n) {
  // DECISION: angle slots are fixed (stable layout); only word-to-slot assignment is shuffled.
  const { x: cx, y: cy } = CONFIG.circleCenter;
  const r = CONFIG.circleRadius;
  const positions = [];
  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    positions.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return positions;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}


// Upgrade shop: spend quiz gold on permanent hero DMG or max HP
function buyDmg() {
  const cost = dmgUpgradeCost();
  if (state.gold < cost) return;
  state.gold -= cost;
  state.dmgLevel++;
  state.heroDmg = CONFIG.heroBaseDmg + state.dmgLevel * CONFIG.dmgPerLevel;
  saveProgress();
  state._structuralDirty = true;
}
function buyHp() {
  const cost = hpUpgradeCost();
  if (state.gold < cost) return;
  state.gold -= cost;
  state.hpLevel++;
  state.heroMaxHP += CONFIG.hpPerLevel;
  saveProgress();
  state._structuralDirty = true;
}

window.Incanto.progression = { enemyHPForWave, enemyDmgForWave, enemyCountForWave, dmgUpgradeCost, hpUpgradeCost, startWave, startRun, layoutCircle, shuffleArray, buyDmg, buyHp };
