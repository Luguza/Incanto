"use strict";
// ==============================================================================
// progression.js — enemy spawning, upgrade costs, run start, circle layout,
// and upgrade purchases (buyDmg/buyHp).
// ==============================================================================

function dmgUpgradeCost() {
  return Math.round(CONFIG.dmgUpgradeBaseCost * Math.pow(CONFIG.upgradeCostGrowth, state.dmgLevel));
}
function hpUpgradeCost() {
  return Math.round(CONFIG.hpUpgradeBaseCost * Math.pow(CONFIG.upgradeCostGrowth, state.hpLevel));
}

// A random delay (ms) until the next skeleton walks in, drawn uniformly from
// the configured [min, max] window.
function randomSpawnDelay() {
  const { enemySpawnMinMs: lo, enemySpawnMaxMs: hi } = CONFIG;
  return lo + Math.random() * (hi - lo);
}

// Pick the lane for the next arrival. Lanes are dealt from a shuffled bag —
// every lane is used exactly once per cycle (so all lanes get populated), and
// the bag is reshuffled if it would repeat the previous lane back-to-back, so
// no two consecutive skeletons ever share a lane.
function nextSpawnLane() {
  if (CONFIG.enemyLanes <= 1) return 0;
  if (state.laneBag.length === 0) {
    do {
      state.laneBag = shuffleArray([...Array(CONFIG.enemyLanes).keys()]);
    } while (state.laneBag[state.laneBag.length - 1] === state.lastSpawnLane);
  }
  const lane = state.laneBag.pop();          // next lane to deal is the bag's tail
  state.lastSpawnLane = lane;
  return lane;
}

// Send in one lone skeleton off the right edge. Every skeleton is identical
// (same HP/damage). It joins its dealt lane, queued a gap behind whoever is
// already furthest out in that lane so arrivals never spawn on top of a corpse
// or a straggler, then walks to its own stop slot before it starts attacking.
function spawnEnemy(now) {
  const id = state.nextEnemyId++;
  const lane = nextSpawnLane();
  // Spawn at the standard distance, but if this lane still has stragglers, drop
  // in a gap behind the rearmost so the new one trails the column.
  let pos = CONFIG.enemySpawnTiles;
  for (const e of state.enemies) {
    if (e.lane === lane) pos = Math.max(pos, e.pos + CONFIG.enemySpawnGapTiles);
  }
  state.enemies.push({
    id,
    maxHP: CONFIG.enemyBaseHP,
    hp: CONFIG.enemyBaseHP,
    dmg: CONFIG.enemyBaseDmg,
    slot: id,                     // per-enemy constant, only used to de-sync the idle animation
    lane,
    pos,
    phase: "walk",                // walk | idle | attack | struck | dying
    phaseAt: now,
    attackAt: 0,                  // next time this skeleton lands a hit
    attackAnimAt: 0,              // start of the current forward-jab animation
    struckUntil: 0,               // while `struck`: when the bolt lands and it collapses
  });
}

// A run: fixed build (persists between runs), fight the endless trickle until
// death. Build/gold are meta-progression and are NOT reset here.
function startRun() {
  state.kills = 0;
  state.heroHP = state.heroMaxHP;
  state.wrongMatchCount = 0;
  state.runStartMs = performance.now();
  state.runActive = true;
  state.screen = "combat";
  const now = performance.now();
  state.enemies = [];
  state.cameraX = 0;
  state.cameraVel = 0;
  state.heroWalking = false;
  state.nextSpawnAt = now + CONFIG.enemyFirstSpawnMs;
  state.laneBag = [];
  state.lastSpawnLane = -1;
  state.castTargetId = null;
  state.castAt = 0;
  state.castChords = null;
  state.tapTraceUntil = 0;
  state.tapTraceFrom = null;
  state.tapTraceTo = null;
  state.pendingShapeAt = 0;
  populateCircle(drawLoadout());
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

window.Incanto.progression = { dmgUpgradeCost, hpUpgradeCost, randomSpawnDelay, nextSpawnLane, spawnEnemy, startRun, layoutCircle, shuffleArray, buyDmg, buyHp };
