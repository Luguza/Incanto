"use strict";
// ==============================================================================
// progression.js — enemy spawning, run start, and circle layout. (Permanent
// build upgrades now live in the skill tree — see skilltree.js.)
// ==============================================================================

// The far end of the visible march track, in tiles from the hero: the largest
// `pos` at which a skeleton's whole 1-tile-wide sprite still fits inside the
// canvas. Beyond it the sprite is clipped by the right border, and a few pixels
// of shoulder poking past the edge is not something the player can see or fight
// — hence the full sprite width, not the bare canvas edge. Derived from the live
// scene because the canvas (and so the track) grows with the viewport, which is
// also what keeps arrivals just off camera on a wide screen instead of popping
// in over open floor. Before the scene exists (possible on the very first frame
// of a run, ahead of the first render) fall back to a nominal off-screen mark.
const FALLBACK_EDGE_TILES = 11;
function trackEdgeTiles() {
  if (!scene) return FALLBACK_EDGE_TILES;
  return (scene.artW - scene.enemyLineX) / TILE - 1;
}

// Is the corridor visibly empty — nothing on camera for the player to fight or
// watch? Dying skeletons still count as occupied: they're drawn while they
// dissolve, so the screen isn't actually bare.
function sceneIsEmpty() {
  const edge = trackEdgeTiles();
  return !state.enemies.some((e) => e.pos <= edge);
}

// Lanes are authored in the pack data (encounters.js), so a plan written for
// four lanes still works if CONFIG.enemyLanes is dialled down — the outer lanes
// fold into the last real one rather than marching in off the floor.
function clampLane(lane) {
  return Math.max(0, Math.min(lane | 0, CONFIG.enemyLanes - 1));
}

// Send in one designed pack: every rank of it, in the lanes the plan asked for,
// one `enemySpawnGapTiles` step deeper per rank so the formation marches in
// holding its shape. Returns how many actually made it in.
//
// The pack forms up just off the right edge of frame and strides into view
// inside half a second (`enemyApproachTiles`) — short enough that the corridor
// never reads as empty while a pack is inbound, long enough that skeletons walk
// in rather than appear. `inFrame` is the no-dead-air pull-forward (see
// updateSpawns): the front rank lands right at the edge of frame instead, on
// camera immediately, fading in through the 16px edge vignette.
function spawnPack(now, entry, inFrame = false) {
  const ranks = packRanks(entry);
  const lanes = new Set();
  for (const rank of ranks) for (const lane of rank) lanes.add(clampLane(lane));
  const edge = trackEdgeTiles();
  let front = inFrame ? edge : edge + CONFIG.enemyApproachTiles;
  // Never form up on top of a straggler. If anything the pack shares a lane with
  // is still standing at or behind the muster line, shift the WHOLE pack back as
  // a unit — pushing just the colliding members would break the designed shape,
  // which is the one thing the plan is for. Skeletons already ahead of the line
  // (in melee, walking in) can't collide and are ignored.
  for (const e of state.enemies) {
    if (!lanes.has(e.lane)) continue;
    front = Math.max(front, e.pos + CONFIG.enemySpawnGapTiles);
  }
  let sent = 0;
  for (let r = 0; r < ranks.length; r++) {
    const pos = front + r * CONFIG.enemySpawnGapTiles;
    const seen = new Set();
    for (const raw of ranks[r]) {
      const lane = clampLane(raw);
      if (seen.has(lane)) continue;          // two of a rank folded into one lane — keep the front one
      seen.add(lane);
      // The cap is a safety valve on how much fits on screen, not a design
      // input: a late pack can out-grow it, and the overflow is simply dropped.
      if (livingEnemies().length >= CONFIG.enemyMaxCount) return sent;
      spawnEnemy(now, lane, pos);
      sent++;
    }
  }
  return sent;
}

// One skeleton, placed exactly where the pack wants it. Every skeleton is
// identical (same HP/damage); it walks to its own stop slot before it starts
// attacking.
function spawnEnemy(now, lane, pos) {
  const id = state.nextEnemyId++;
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

// Close the gap on a pack that is already marching in but hasn't reached frame
// yet: slide the whole formation up until its leader sits exactly at the edge of
// frame. Every skeleton moves by the same amount, so the shape the plan designed
// is untouched — and since none of them are on camera, the shift itself is
// invisible. What the player sees is simply the pack arriving.
//
// This is what the no-dead-air rule does when an encounter is already on its
// way. Sending in ANOTHER pack instead would be worse twice over: it burns a
// designed encounter early, and the newcomer just musters behind the pack
// already inbound (spawnPack won't stack them), so it lands off camera too and
// the screen stays bare — which cascades into pulling pack after pack forward.
function advanceInboundPack() {
  if (!state.enemies.length) return false;
  const edge = trackEdgeTiles();
  let lead = Infinity;
  for (const e of state.enemies) lead = Math.min(lead, e.pos);
  if (lead <= edge) return false;                  // already on camera, nothing to close
  const shift = lead - edge;
  for (const e of state.enemies) e.pos -= shift;
  return true;
}

// A run: fixed build (persists between runs), walk the hall and fight the packs
// the plan sends in until the hero falls. Build/gold are meta-progression and
// are NOT reset here. Every run starts at metre 0 on plan index 0, so two runs
// walk into exactly the same encounters in the same order.
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
  state.heroSprinting = false;
  state.stridePhase = 0;
  state.packIndex = 0;        // back to the top of the encounter plan
  state.emptySinceMs = now;   // the corridor starts bare — the no-dead-air clock is already ticking
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

window.Incanto.progression = { spawnPack, spawnEnemy, clampLane, trackEdgeTiles, sceneIsEmpty, advanceInboundPack, startRun, layoutCircle, shuffleArray };
