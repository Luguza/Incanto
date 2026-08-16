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
// `tilesWide` is the body's drawn width in tiles, so an ogre — cut from a 32px
// sprite, two tiles across — has to stand that bit further in before it counts
// as fully on camera.
const FALLBACK_EDGE_TILES = 12;
function trackEdgeTiles(tilesWide = 1) {
  if (!scene) return FALLBACK_EDGE_TILES - tilesWide;
  return (scene.artW - scene.enemyLineX) / TILE - tilesWide;
}

// How wide a body is drawn, in march-track tiles — the figure every bit of
// spacing geometry is measured in. A plain skeleton is exactly 1; an ogre, cut
// from a 32px sprite, is 2.
function bodyTiles(e) {
  return (e && e.tiles) || 1;
}

// Is the corridor visibly empty — nothing on camera for the player to fight or
// watch? Dying skeletons still count as occupied: they're drawn while they
// dissolve, so the screen isn't actually bare.
function sceneIsEmpty() {
  return !state.enemies.some((e) => e.pos <= trackEdgeTiles(bodyTiles(e)));
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
let ENEMY_TYPE_BY_ID = null;
function enemyTypeById(id) {
  if (!ENEMY_TYPE_BY_ID) {
    ENEMY_TYPE_BY_ID = new Map(CONFIG.enemyTypes.map((t) => [t.id, t]));
  }
  return ENEMY_TYPE_BY_ID.get(id) || CONFIG.enemyTypes[0];
}

// Where a variant plants itself: melee walk into the standoff line, everything
// that shoots, summons or heals stops well short of it.
function typeStandoff(type) {
  return type.standoff != null ? type.standoff : CONFIG.enemyStandoffTiles;
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
  const ranks = orderRanksByReach(packRanks(entry));
  const lanes = new Set();
  for (const rank of ranks) for (const m of rank) lanes.add(clampLane(m.lane));
  // Measured against the front rank's own bodies, so a rank of brutes musters
  // fully clear of the right border rather than half-clipped by it.
  let front = trackEdgeTiles(rankTiles(ranks[0])) + CONFIG.enemyApproachTiles;
  // Never form up on top of a straggler. If anything the pack shares a lane with
  // is still standing at or behind the muster line, shift the WHOLE pack back as
  // a unit — pushing just the colliding members would break the designed shape,
  // which is the one thing the plan is for. Skeletons already ahead of the line
  // (in melee, walking in) can't collide and are ignored.
  for (const e of state.enemies) {
    if (!lanes.has(e.lane)) continue;
    front = Math.max(front, e.pos + CONFIG.enemySpawnGapTiles * (bodyTiles(e) + 1) / 2);
  }
  let sent = 0;
  let pos = front;
  for (let r = 0; r < ranks.length; r++) {
    // Ranks of brutes need more room between them than ranks of plain skeletons,
    // for the same reason two queued brutes do: the bodies are drawn bigger, so
    // a fixed gap would let the sprites overlap. Step by the pair's average size.
    if (r > 0) pos += CONFIG.enemySpawnGapTiles * (rankTiles(ranks[r - 1]) + rankTiles(ranks[r])) / 2;
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

// The drawn width (in track tiles) of the biggest body in a rank, used to space
// ranks apart so two ranks of ogres don't muster inside one another.
function rankTiles(rank) {
  let s = 1;
  for (const m of rank) {
    const type = enemyTypeById(m.type);
    const spr = enemySprite(type);
    // Measured at the HP it walks in on, because a slime's size is a function of
    // the rung it stands on rather than a constant (see bodyScale) — read off
    // `type.scale` alone, a big slime would muster in a gap sized for a small one.
    s = Math.max(s, (spr.idle.w * bodyScale(type, spawnHP(type))) / TILE);
  }
  return s;
}

// ---------------------------------------------------------------------------
// SIZE, AND THE BODIES THAT CHANGE IT. Almost everything in the hall is one
// fixed size decided by its variant. A slime is not: it carries `split`, and
// what it IS — how big it is drawn, how hard it hits, what the HP bar calls it
// — is the rung of CONFIG.slimeTiers its maxHP puts it on, re-read every time it
// divides. See the ladder's own comment in config.js for why it is built that way.
// ---------------------------------------------------------------------------

// The HP a variant walks in on. Needed before any body exists, so a pack can be
// spaced for the size its members are about to be.
//
// A SPLITTING body ignores `hpMult` and walks in on the top rung of its ladder.
// The ladder is the whole of what a slime is worth — three sizes and what each
// one carries — so letting a second number decide where it enters would mean a
// slime that starts between two rungs, drawn as one size and worth another.
function spawnHP(type) {
  if (type.split) {
    const ladder = CONFIG.slimeTiers;
    if (ladder && ladder.length) return ladder[ladder.length - 1].hp;
  }
  return Math.max(1, Math.round(CONFIG.enemyBaseHP * type.hpMult));
}

// Which rung of the ladder a body of this size stands on, or null for a variant
// that has no ladder (which is all of them but the slimes). Asked with the body's
// maxHP, which for a slime is always exactly a rung: it walks in on one and every
// split hands it the next one down whole. It still CLAMPS at both ends, so a
// number off the ladder resolves to the nearest rung at or below it rather than
// to nothing.
function bodyTier(type, hp) {
  if (!type.split) return null;
  const ladder = CONFIG.slimeTiers;
  if (!ladder || !ladder.length) return null;
  let tier = ladder[0];
  for (const t of ladder) if (hp >= t.hp) tier = t;
  return tier;
}

// How big a body of this variant is drawn at this size, as a multiple of its own
// sheet art: the variant's `scale`, times whatever rung it is standing on.
function bodyScale(type, hp) {
  const tier = bodyTier(type, hp);
  return (type.scale || 1) * (tier ? tier.scale : 1);
}

// Fix a body's drawn size, its damage and its name to what its rung makes it.
// For everything without a ladder this runs once at spawn and the answer never
// moves again; for a slime it runs again on every split, which is what makes the
// halves visibly smaller than the body they came off.
//
// Read off maxHP rather than off the HP left in the bar: a slime's size is the
// SIZE it is, not the wound it is carrying. (Under the old halving ladder those
// were the same question and this asked for `hp` — now a 40 nursing 12 points of
// damage is still a mid-sized slime, and it stays one right up until the next
// hit divides it.)
function sizeBody(e, type) {
  const tier = bodyTier(type, e.maxHP);
  const spr = enemySprite(type);
  e.scale = bodyScale(type, e.hp);
  e.w = Math.max(1, Math.round(spr.idle.w * e.scale));
  e.h = Math.max(1, Math.round(spr.idle.h * e.scale));
  e.tiles = e.w / TILE;
  e.dmg = Math.max(1, Math.round(CONFIG.enemyBaseDmg * type.dmgMult * (tier ? tier.dmgMult : 1)));
  e.name = (tier ? tier.prefix : "") + type.name;
  return e;
}

// Has this body a smaller size to become, and is there room on the floor for the
// pair? Asked in two places and it has to give the same answer in both: hitEnemy
// consults it BEFORE the blow lands, to decide whether the body is allowed to
// die at all, and splitSlime consults it again when the blow arrives. If the two
// ever disagreed, a slime held back from dying would then fail to divide and
// stand there on 1 HP forever.
function canSplit(e) {
  if (!e || doomed(e)) return false;
  const type = enemyTypeById(e.type);
  if (!type.split) return false;
  const ladder = CONFIG.slimeTiers;
  // The bottom rung has nothing smaller to become. That is what ends the chain,
  // and what stops the corridor filling with specks each still owed its own cast.
  if (ladder.indexOf(bodyTier(type, e.maxHP)) <= 0) return false;
  // The head-count cap is a safety valve on what fits on screen, not a design
  // input — a floor that is already full stops dividing (and its slimes start
  // dying again) rather than pushing bodies off the end of the track.
  return livingEnemies().length < CONFIG.enemyMaxCount;
}

// What a hit does to a body BEYOND taking the HP off it. hitEnemy marks the
// moment the blow will arrive and updateEnemies calls this on that beat, so a
// meteor, a fifth chain hop and a Dornen reflection all divide a slime alike and
// none of them does it before its own effect has landed.
//
// A slime comes apart into two of the size below, each with a FULL bar of that
// size's HP: the damage that did it is spent on the dividing and none of it
// carries into either half. The body that was hit becomes the first half in
// place; the second walks out from behind it.
//
// ANY hit divides it — including one that would have killed it outright, which
// hitEnemy holds at 1 HP rather than letting it land (see the note there). A
// grown hero one-shots 60 HP without noticing, so gating the split on surviving
// the blow meant the mechanic switched itself off for every build past the first
// few nodes. Killing a big slime is what spawns the small ones.
//
// It is the bottom rung that ends this, not the arithmetic: a KLEINER SCHLEIM
// has nothing smaller to become, so a hit on one is just a hit and it dies when
// its bar runs out. Which is why a big slime is a fixed seven casts for anybody,
// however hard they hit: one to divide it, two to divide the halves, four to
// finish the quarters.
//
// See CONFIG.slimeTiers for why this makes HP on purpose.
function splitSlime(e, at) {
  const type = enemyTypeById(e.type);
  if (!type.split || e.hp <= 0) return null;
  // Same question hitEnemy asked when it held the killing blow back, and it has
  // to be asked again here: a body doomed by another spell in the meantime, or a
  // floor that filled up while this blow was in the air, both end the chain.
  if (!canSplit(e)) return null;
  const ladder = CONFIG.slimeTiers;
  const next = ladder[ladder.indexOf(bodyTier(type, e.maxHP)) - 1];
  // Both halves start their bar full at their own size. They are two slimes now,
  // not one slime sharing a wound.
  e.hp = e.maxHP = next.hp;
  sizeBody(e, type);
  const twin = spawnEnemy(at, e.lane, e.pos, e.type);
  twin.hp = twin.maxHP = next.hp;
  sizeBody(twin, type);
  // Behind the parent in its own lane, clear of it by the gap the lane queue
  // keeps anyway — dropped in front it would jump the queue it was just part of.
  twin.pos = e.pos + CONFIG.enemyGapTiles * (bodyTiles(e) + bodyTiles(twin)) / 2;
  twin.frozenUntil = e.frozenUntil;   // a Frostkegel holds both halves, not just the one it caught
  twin.hitFlashAt = at;               // both halves blink on the hit that divided them
  // The performance (drawn in render-scene): both halves wobble, and a bridge of
  // goo stretches between them until it snaps. The twin carries the pairing so
  // the bridge always has two ends to hang off — read from the twin, because the
  // parent may be divided AGAIN before this one has finished playing.
  e.splitFxAt = at;
  e.splitFromId = null;               // whatever it was torn off last time, that rope is long gone
  twin.splitFxAt = at;
  twin.splitFromId = e.id;
  // …and what the tearing leaves on the floor under them.
  splashGoo(e, at, 5);
  return twin;
}

// ---------------------------------------------------------------------------
// THE GOO A SLIME LEAVES ON THE FLOOR (`state.slimeGoo`, drawn by render-scene).
// A mark is planted in WORLD px — `state.cameraX` plus the body's screen x — so
// it stays on the flagstone it landed on while the hall scrolls past, rather
// than sliding along with the camera. Pure decoration: nothing ever reads it
// back, and the list is capped and culled on age.
// ---------------------------------------------------------------------------

// One smear under a body. `spread` fattens it (a split splashes wider than a
// stride) and `jitter` offsets it along the lane so a trail isn't a row of
// identical stamps. The size wobbles a little per mark for the same reason —
// stamped at one size they line up into a painted stripe rather than a track.
function plantGoo(e, at, { spread = 1, jitter = 0 } = {}) {
  if (!state.slimeGoo) state.slimeGoo = [];
  if (state.slimeGoo.length >= CONFIG.slimeTrailMax) state.slimeGoo.shift();
  const vary = 0.8 + ((e.id * 29 + state.slimeGoo.length * 17) % 40) / 100;   // 0,8–1,2, deterministic
  state.slimeGoo.push({
    // World px: the camera offset is baked in here and taken back out at draw
    // time, which is what pins the mark to the floor.
    x: state.cameraX + e.pos * TILE + jitter,
    lane: e.lane,
    rx: Math.max(2, (e.w || 12) * 0.26 * spread * vary),
    ry: Math.max(1, (e.h || 10) * 0.11 * spread * vary),
    type: e.type,                     // which colourway it drips (see gooTint)
    born: at,
    ttl: CONFIG.slimeTrailFadeMs * (0.75 + 0.5 * ((e.id * 37) % 100) / 100) * (spread > 1 ? 1.35 : 1),
  });
  return true;
}

// The puddle a split throws out: `n` blobs scattered along the lane where the
// body came apart, so the pair is standing in the mess they made rather than
// next to it.
function splashGoo(e, at, n) {
  for (let i = 0; i < n; i++) {
    const k = i - (n - 1) / 2;                                  // -…0…+ along the lane
    plantGoo(e, at, { spread: 1.5 - Math.abs(k) * 0.22, jitter: k * TILE * 0.42 });
  }
}

// Marks are planted on the logic clock (see loop.updateEnemies) so a fight that
// runs while the player is off studying doesn't pile up an unbounded list nobody
// is watching. Age is the only thing that removes one.
function cullGoo(now) {
  const goo = state.slimeGoo;
  if (!goo || !goo.length) return;
  state.slimeGoo = goo.filter((g) => now - g.born < g.ttl);
}

// Put every lane's members in reach order — the body that plants CLOSEST to the
// hero in the front slot, the one that plants furthest back at the rear.
//
// This is a guarantee rather than a nicety. A lane is a strict queue: nothing
// walks through the body ahead of it. So a shaman authored into the front rank
// of a lane would stop at its own 8-tile standoff and wall its entire escort out
// of the fight behind it — the pack's melee would stand in the dark doing
// nothing while the hero picked them off. Sorting here means a pack can be
// written as a SHAPE (which lanes, how many ranks) without its author also
// having to hold the reach of every variant in their head; the caster ends up
// at the back of its lane no matter which rank it was written into.
//
// Only the lane assignment moves. Rank sizes, lanes and head count are untouched,
// so the formation the plan drew is the formation that walks in.
function orderRanksByReach(ranks) {
  const byLane = new Map();
  for (const rank of ranks) {
    for (const m of rank) {
      const lane = clampLane(m.lane);
      if (!byLane.has(lane)) byLane.set(lane, []);
      byLane.get(lane).push(m);
    }
  }
  for (const members of byLane.values()) {
    members.sort((a, b) => typeStandoff(enemyTypeById(a.type)) - typeStandoff(enemyTypeById(b.type)));
  }
  const cursor = new Map();
  return ranks.map((rank) => rank.map((m) => {
    const lane = clampLane(m.lane);
    const i = cursor.get(lane) || 0;
    cursor.set(lane, i + 1);
    const members = byLane.get(lane);
    return members[Math.min(i, members.length - 1)];
  }));
}

// One body, placed exactly where the pack wants it. Its variant decides how much
// HP and damage it carries, how much armour it wears, how fast it swings and
// marches, which creature it is drawn as, and what it DOES when it stops walking
// — everything else is identical. It walks to its own stop slot before it starts
// fighting.
//
// The variant's art is resolved into the two numbers the rest of the frame needs
// constantly (`w`/`h` in art pixels, `tiles` across the track) by sizeBody, so no
// hot path ever re-reads the sheet rect or re-multiplies by `scale`. For all but
// the slimes that resolution happens exactly once, right here.
function spawnEnemy(now, lane, pos, typeId) {
  const id = state.nextEnemyId++;
  const type = enemyTypeById(typeId);
  const hp = spawnHP(type);
  const e = {
    id,
    type: type.id,
    role: type.role || "melee",   // melee | ranged | summoner | healer
    maxHP: hp,
    hp,
    // scale / w / h / tiles / dmg / name are all filled in by sizeBody below —
    // they depend on `hp`, which for a splitting body keeps moving.
    armor: Math.max(0, type.armor || 0),  // turns aside a fraction of each hit (see armorReduction)
    atkMs: type.attackMs || CONFIG.enemyAttackIntervalMs,  // ms between its blows (its own cadence)
    walk: type.walkMult || 1,             // multiplies the march pace
    standoff: typeStandoff(type),         // where it plants: the melee line, or well short of it
    range: type.range != null ? type.range : CONFIG.enemyAttackRangeTiles,
    slot: id,                     // per-enemy constant, only used to de-sync the idle animation
    lane,
    pos,
    phase: "walk",                // walk | idle | attack | frozen | dying
    phaseAt: now,
    attackAt: 0,                  // next time this body lands a hit
    attackAnimAt: 0,              // start of the current forward-jab animation
    deathAt: 0,                   // >0: already killed, but only collapses when the blow ARRIVES
    splitAt: 0,                   // >0: a splitting body, waiting on the same arrival (see splitSlime)
    splitFxAt: 0,                 // when it last came apart — the wobble + goo bridge play off this
    splitFromId: null,            // the half it was torn off, so the bridge has two ends
    gooPos: null,                 // the tile it last dripped a mark on (see plantGoo)
    frozenUntil: 0,               // held fast by a Frostkegel until this moment (see updateEnemies)
    actAt: 0,                     // next summon/mend (0 = hasn't planted yet — see updateSupport)
    actFxAt: 0,                   // when the rune/beam of that act was thrown, for the draw
    healTargetId: null,           // who a healer's beam is pointing at
  };
  sizeBody(e, type);
  if (type.summon) e.summonsLeft = type.summon.max;
  state.enemies.push(e);
  return e;
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
  for (const e of state.enemies) shift = Math.min(shift, e.pos - trackEdgeTiles(bodyTiles(e)));
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
  state.hallCleared = false;  // this run hasn't reached the door yet
  state.screen = "combat";
  const now = performance.now();
  state.enemies = [];
  state.enemyShots = [];      // no bolt from a previous run still in the air
  state.slimeGoo = [];        // and no goo on the floor from the last run's slimes
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
  state.meteorRocks = [];     // …nor a barrage still falling when it ended
  state.spellPrimeUntil = 0;  // and no Frostkegel charge banked from it either
  state.heroShield = 0;
  state.tapTraceUntil = 0;
  state.tapTraceFrom = null;
  state.tapTraceTo = null;
  state.pendingShapeAt = 0;
  populateCircle(drawLoadout());
}

// Walking out of the far door: the end of the hall, and the only way a run ends
// that isn't the hero falling over. Deliberately handled like a death in every
// mechanical respect — the run stops, the banked reward is untouched and still
// waiting for a quiz — because the reward for the walk is the walk. What differs
// is the screen it lands on (see renderEndFull) and `hallClearedEver`, which is
// persisted so the hall stays walked-out once it has been.
function clearHall() {
  if (!state.runActive) return;
  state.runActive = false;
  state.hallCleared = true;
  state.hallClearedEver = true;
  state.deepest = Math.max(state.deepest || 0, HALL_END_METRES);
  saveProgress();
  // Only pull the player to the end screen if they are actually watching the
  // corridor; a run that finished while they were off studying simply won't
  // resume (the same rule death follows).
  if (state.screen === "combat") state.screen = "reward";
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

window.Incanto.progression = { clearHall, spawnPack, spawnFiller, spawnEnemy, enemyTypeById, typeStandoff, rankTiles, orderRanksByReach, bodyTiles, bodyTier, bodyScale, spawnHP, sizeBody, canSplit, splitSlime, plantGoo, splashGoo, cullGoo, clampLane, trackEdgeTiles, sceneIsEmpty, advanceInboundPack, startRun, layoutCircle, shuffleArray };
