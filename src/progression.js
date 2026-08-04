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
// `scale` is the body's drawn width in tiles, so a brute — drawn half again as
// wide — has to stand that bit further in before it counts as fully on camera.
const FALLBACK_EDGE_TILES = 12;
function trackEdgeTiles(scale = 1) {
  if (!scene) return FALLBACK_EDGE_TILES - scale;
  return (scene.artW - scene.enemyLineX) / TILE - scale;
}

// Is the corridor visibly empty — nothing on camera for the player to fight or
// watch? Dying skeletons still count as occupied: they're drawn while they
// dissolve, so the screen isn't actually bare.
function sceneIsEmpty() {
  return !state.enemies.some((e) => e.pos <= trackEdgeTiles(e.scale || 1));
}

// Lanes are authored in the pack data (encounters.js), so a plan written for
// four lanes still works if CONFIG.enemyLanes is dialled down — the outer lanes
// fold into the last real one rather than marching in off the floor.
function clampLane(lane) {
  return Math.max(0, Math.min(lane | 0, CONFIG.enemyLanes - 1));
}

// Look up a variant by id, falling back to the first entry (the plain skeleton)
// for an unknown or missing one, so a typo in a pack costs a brute rather than
// the whole encounter.
//
// DECISION: which variant walks in is a property of the PACK, not a die roll.
// Variants used to be picked at spawn time by a weighted random draw gated on
// kill count; with the encounter plan that would put randomness right back in
// the one place the plan exists to remove — the same metre mark would sometimes
// be four skeletons and sometimes four brutes, and a pack couldn't be designed
// around its own composition. The variant table keeps what a brute *is* (twice
// the HP and damage, ~40% faster swings, drawn a head taller in darker bone);
// encounters.js decides where brutes appear.
function enemyTypeById(id) {
  return CONFIG.enemyTypes.find((t) => t.id === id) || CONFIG.enemyTypes[0];
}

// Send in one designed pack: every rank of it, in the lanes and variants the
// plan asked for, one gap-step deeper per rank so the formation marches in
// holding its shape. Returns how many actually made it in.
//
// The pack forms up just off the right edge of frame and strides into view
// (`enemyApproachTiles`) — long enough that skeletons walk in rather than
// appear, short enough that the corridor doesn't read as empty while a camp is
// already inbound. A camp is only ever sent in by reaching its mark; quiet
// stretches are covered by spawnFiller instead, so there is no case here where a
// camp needs landing early.
function spawnPack(now, entry) {
  const ranks = packRanks(entry);
  const lanes = new Set();
  for (const rank of ranks) for (const m of rank) lanes.add(clampLane(m.lane));
  // Measured against the front rank's own bodies, so a rank of brutes musters
  // fully clear of the right border rather than half-clipped by it.
  let front = trackEdgeTiles(rankScale(ranks[0])) + CONFIG.enemyApproachTiles;
  // Never form up on top of a straggler. If anything the pack shares a lane with
  // is still standing at or behind the muster line, shift the WHOLE pack back as
  // a unit — pushing just the colliding members would break the designed shape,
  // which is the one thing the plan is for. Skeletons already ahead of the line
  // (in melee, walking in) can't collide and are ignored.
  for (const e of state.enemies) {
    if (!lanes.has(e.lane)) continue;
    front = Math.max(front, e.pos + CONFIG.enemySpawnGapTiles * ((e.scale || 1) + 1) / 2);
  }
  let sent = 0;
  let pos = front;
  for (let r = 0; r < ranks.length; r++) {
    // Ranks of brutes need more room between them than ranks of plain skeletons,
    // for the same reason two queued brutes do: the bodies are drawn bigger, so
    // a fixed gap would let the sprites overlap. Step by the pair's average size.
    if (r > 0) pos += CONFIG.enemySpawnGapTiles * (rankScale(ranks[r - 1]) + rankScale(ranks[r])) / 2;
    const seen = new Set();
    for (const member of ranks[r]) {
      const lane = clampLane(member.lane);
      if (seen.has(lane)) continue;          // two of a rank folded into one lane — keep the front one
      seen.add(lane);
      // The cap is a safety valve on how much fits on screen, not a design
      // input: a late pack can out-grow it, and the overflow is simply dropped.
      if (livingEnemies().length >= CONFIG.enemyMaxCount) return sent;
      spawnEnemy(now, lane, pos, member.type);
      sent++;
    }
  }
  return sent;
}

// The drawn size of the biggest body in a rank, used to space ranks apart.
function rankScale(rank) {
  let s = 1;
  for (const m of rank) s = Math.max(s, enemyTypeById(m.type).scale || 1);
  return s;
}

// One skeleton, placed exactly where the pack wants it. Its variant decides how
// much HP and damage it carries, how much armour it wears, how fast it swings,
// and how big it's drawn — everything else is identical. It walks to its own stop slot before it starts
// attacking.
function spawnEnemy(now, lane, pos, typeId) {
  const id = state.nextEnemyId++;
  const type = enemyTypeById(typeId);
  const hp = Math.max(1, Math.round(CONFIG.enemyBaseHP * type.hpMult));
  state.enemies.push({
    id,
    type: type.id,
    maxHP: hp,
    hp,
    dmg: Math.max(1, Math.round(CONFIG.enemyBaseDmg * type.dmgMult)),
    armor: Math.max(0, type.armor || 0),  // turns aside a fraction of each hit (see armorReduction)
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
    frozenUntil: 0,               // held fast by a Frostkegel until this moment (see updateEnemies)
  });
}

// One lone skeleton to fill a quiet stretch of corridor (see updateSpawns). It
// is NOT part of the encounter plan: the plan isn't advanced, no designed camp is
// spent, and the next camp still waits at exactly its own mark. Always the plain
// variant — a filler is there to keep the hall from standing empty, not to be an
// encounter of its own.
//
// It lands right at the edge of frame, on camera immediately, for the same
// reason a camp's arrival is measured there: off camera it could be sniped by
// the hero's auto-targeted spell before it ever showed up, and the corridor
// would stay bare through another whole budget.
//
// Lanes rotate rather than roll: consecutive fillers spread across the floor
// instead of trooping down one lane, and the run stays free of randomness.
function spawnFiller(now) {
  state.fillerLane = (state.fillerLane + 1) % Math.max(1, CONFIG.enemyLanes);
  spawnEnemy(now, clampLane(state.fillerLane), trackEdgeTiles(), DEFAULT_TYPE);
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
  // Close on whichever body would show first, measured against its own width.
  let shift = Infinity;
  for (const e of state.enemies) shift = Math.min(shift, e.pos - trackEdgeTiles(e.scale || 1));
  if (shift <= 0) return false;                    // already on camera, nothing to close
  for (const e of state.enemies) e.pos -= shift;
  return true;
}

// A run: fixed build (persists between runs), walk the hall and fight the packs
// the plan sends in until the hero falls. Build/gold are meta-progression and
// are NOT reset here. Every run starts at metre 0 on plan index 0, so two runs
// walk into exactly the same encounters in the same order.
function startRun() {
  state.kills = 0;            // this run's score only — state.rewardKills (the
                              // banked quiz multiplier) deliberately carries over

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
  state.stridePhase = 0;
  state.packIndex = 0;        // back to the top of the encounter plan
  state.fillerLane = -1;      // so the first filler skeleton walks into lane 0
  state.emptySinceMs = now;   // the corridor starts bare — the no-dead-air clock is already ticking
  state.castTargetId = null;
  state.castAt = 0;
  state.castChords = null;
  state.spellFx = [];         // no bolts or meteors carried over from the last run
  state.spellPrimeUntil = 0;  // and no Frostkegel charge banked from it either
  state.heroShield = 0;
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

window.Incanto.progression = { spawnPack, spawnFiller, spawnEnemy, enemyTypeById, rankScale, clampLane, trackEdgeTiles, sceneIsEmpty, advanceInboundPack, startRun, layoutCircle, shuffleArray };
