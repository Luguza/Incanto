"use strict";
// ==============================================================================
// progression.js — enemy spawning, run start, and circle layout. (Permanent
// build upgrades now live in the skill tree — see skilltree.js.)
// ==============================================================================

// A random delay (ms) until the next skeleton walks in, drawn uniformly from
// the configured [min, max] window, then stretched by a progress ramp so the
// trickle starts slow and then quickens ever faster the further the hero gets.
// The multiplier decays geometrically from `enemySpawnRampStartMult` at 0 kills
// down to 1 once the hero has `enemySpawnRampKills` kills (and stays at 1
// thereafter).
function randomSpawnDelay() {
  const { enemySpawnMinMs: lo, enemySpawnMaxMs: hi } = CONFIG;
  const base = lo + Math.random() * (hi - lo);
  return base * spawnRateRampMult();
}

// Delay multiplier for the current run progress: high early (slower spawns),
// then shrinking without bound as the run goes on. The decay is geometric —
// mult = startMult^(1 - progress) — so the spawn *rate* (1/gap) grows
// exponentially: sparse at the start, hitting full speed at `enemySpawnRampKills`
// kills (mult = 1), and continuing to accelerate past that point. There is no
// rate ceiling — the only real cap is `enemyMaxCount` (how many skeletons can
// be on screen at once), enforced in updateSpawns. `progress` is intentionally
// NOT clamped so the gaps keep tightening the deeper the hero gets.
function spawnRateRampMult() {
  const { enemySpawnRampStartMult: startMult, enemySpawnRampKills: rampKills } = CONFIG;
  if (rampKills <= 0) return 1;
  const progress = state.kills / rampKills;
  return Math.pow(startMult, 1 - progress);
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

// Roll the variant for the next arrival: a weighted pick among the entries of
// CONFIG.enemyTypes whose `minKills` the run has already passed, so the tougher
// ones only start turning up once the hero has a few kills behind him. Falls
// back to the first entry (the plain skeleton) if nothing is unlocked yet.
function pickEnemyType() {
  const types = CONFIG.enemyTypes;
  const pool = types.filter((t) => state.kills >= (t.minKills || 0));
  if (!pool.length) return types[0];
  const total = pool.reduce((sum, t) => sum + t.weight, 0);
  let roll = Math.random() * total;
  for (const t of pool) {
    roll -= t.weight;
    if (roll < 0) return t;
  }
  return pool[pool.length - 1];
}

// Send in one lone skeleton off the right edge. Its variant (see pickEnemyType)
// decides how much HP and damage it carries, how fast it swings, and how big it
// is drawn — everything else is identical. It joins its dealt lane, queued a gap
// behind whoever is already furthest out in that lane so arrivals never spawn on
// top of a corpse or a straggler, then walks to its own stop slot before it
// starts attacking.
function spawnEnemy(now) {
  const id = state.nextEnemyId++;
  const lane = nextSpawnLane();
  const type = pickEnemyType();
  const hp = Math.max(1, Math.round(CONFIG.enemyBaseHP * type.hpMult));
  // Spawn at the standard distance, but if this lane still has stragglers, drop
  // in a gap behind the rearmost so the new one trails the column.
  let pos = CONFIG.enemySpawnTiles;
  for (const e of state.enemies) {
    if (e.lane === lane) pos = Math.max(pos, e.pos + CONFIG.enemySpawnGapTiles);
  }
  state.enemies.push({
    id,
    type: type.id,
    maxHP: hp,
    hp,
    dmg: Math.max(1, Math.round(CONFIG.enemyBaseDmg * type.dmgMult)),
    atkSpeed: type.attackSpeedMult || 1,  // multiplies swing rate (divides the interval)
    scale: type.scale || 1,               // drawn size vs. the 16x16 sheet art
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

window.Incanto.progression = { randomSpawnDelay, spawnRateRampMult, nextSpawnLane, pickEnemyType, spawnEnemy, startRun, layoutCircle, shuffleArray };
