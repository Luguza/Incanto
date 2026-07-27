"use strict";
// ==============================================================================
// progression.js — enemy spawning, run start, and circle layout. (Permanent
// build upgrades now live in the skill tree — see skilltree.js.)
// ==============================================================================

// A random delay (ms) until the next skeleton walks in, drawn uniformly from
// the configured [min, max] window, then stretched by a progress ramp so the
// trickle starts a touch slow and then quickens ever faster the deeper into the
// corridor the hero gets. The multiplier decays geometrically from
// `enemySpawnRampStartMult` at 0 m down to 1 once the hero has walked
// `enemySpawnRampMetres`, and keeps shrinking beyond that.
function randomSpawnDelay() {
  const { enemySpawnMinMs: lo, enemySpawnMaxMs: hi } = CONFIG;
  const base = lo + Math.random() * (hi - lo);
  return base * spawnRateRampMult();
}

// Delay multiplier for the current run progress: higher early (slower spawns),
// then shrinking without bound as the hero pushes down the hall. Progress is
// measured in METRES WALKED (state.distance), not kills — the hero only advances
// while the near stretch is clear, so distance is the honest "how deep am I"
// signal, and it can't be farmed by standing in one spot trading blows. The
// decay is geometric — mult = startMult^(1 - progress) — so the spawn *rate*
// (1/gap) grows exponentially: sparser at the start, full base speed at
// `enemySpawnRampMetres` (mult = 1), and accelerating past that point. There is
// no rate ceiling — the only real cap is `enemyMaxCount` (how many skeletons can
// be on screen at once), enforced in updateSpawns. `progress` is intentionally
// NOT clamped so the gaps keep tightening the further the hero walks.
function spawnRateRampMult() {
  const { enemySpawnRampStartMult: startMult, enemySpawnRampMetres: rampMetres } = CONFIG;
  if (rampMetres <= 0) return 1;
  const progress = state.distance / rampMetres;
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

// The far end of the visible march track, in tiles from the hero: the largest
// `pos` at which a skeleton's whole 1-tile-wide sprite still fits inside the
// canvas. Beyond it the sprite is clipped by the right border, and a few pixels
// of shoulder poking past the edge is not something the player can see or fight
// — hence the full sprite width, not the bare canvas edge. Derived from the live
// scene because the canvas (and so the track) grows with the viewport. Before
// the scene exists, fall back to the spawn distance — that reads as "everything
// is visible", which only ever suppresses the no-dead-air spawn below, never
// triggers a spurious one.
function trackEdgeTiles() {
  if (!scene) return CONFIG.enemySpawnTiles;
  return (scene.artW - scene.enemyLineX) / TILE - 1;
}

// Is the corridor visibly empty — nothing on camera for the player to fight or
// watch? Dying skeletons still count as occupied: they're drawn while they
// dissolve, so the screen isn't actually bare.
function sceneIsEmpty() {
  const edge = trackEdgeTiles();
  return !state.enemies.some((e) => e.pos <= edge);
}

// Send in one lone skeleton off the right edge. Every skeleton is identical
// (same HP/damage). It joins its dealt lane, queued a gap behind whoever is
// already furthest out in that lane so arrivals never spawn on top of a corpse
// or a straggler, then walks to its own stop slot before it starts attacking.
//
// `atEdge` is the no-dead-air arrival (see updateSpawns): it lands just inside
// the right edge of frame — on camera immediately, fading in through the edge
// vignette — instead of taking the usual multi-second off-screen approach. On a
// viewport wide enough that the normal spawn distance is already in frame, that
// distance is used unchanged. It also skips the trail-behind-stragglers rule:
// those stragglers are by definition off camera and further out, so queueing
// behind them would put this one off camera too, which is the whole thing we're
// trying to avoid. Nothing overlaps — the new arrival is *ahead* of them, and
// updateEnemies re-sorts the lane and holds the ones behind at a full gap.
function spawnEnemy(now, atEdge = false) {
  const id = state.nextEnemyId++;
  const lane = nextSpawnLane();
  // Spawn at the standard distance, but if this lane still has stragglers, drop
  // in a gap behind the rearmost so the new one trails the column.
  let pos = CONFIG.enemySpawnTiles;
  if (atEdge) {
    pos = Math.min(pos, trackEdgeTiles());
  } else {
    for (const e of state.enemies) {
      if (e.lane === lane) pos = Math.max(pos, e.pos + CONFIG.enemySpawnGapTiles);
    }
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
  state.distance = 0;
  state.cameraVel = 0;
  state.heroWalking = false;
  state.nextSpawnAt = now + CONFIG.enemyFirstSpawnMs;
  state.emptySinceMs = now;   // the corridor starts bare — the no-dead-air clock is already ticking
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

window.Incanto.progression = { randomSpawnDelay, spawnRateRampMult, nextSpawnLane, spawnEnemy, trackEdgeTiles, sceneIsEmpty, startRun, layoutCircle, shuffleArray };
