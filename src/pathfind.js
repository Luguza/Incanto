"use strict";
// ==============================================================================
// pathfind.js — LANE ROUTING: how a body that cannot reach the hero looks for a
// way round one that can. Owns the occupancy grid, the A* search over it (the
// library is vendored in vendor-astar.js), and the sideways step it produces.
// ==============================================================================
//
// WHY THIS EXISTS. A lane is a strict queue and only its FRONT body reaches
// melee (see the note at `engaged` in loop.js). That is a good rule — it is what
// makes "kill the front rank" a real move — but on its own it means the hall's
// pressure is decided by how a pack happened to be authored rather than by how
// many bodies are in it. Three skeletons written into one lane fight the hero one
// at a time, in single file, while three lanes of open floor stand empty next to
// them. A slime is worse: it divides into its own lane (progression.splitSlime),
// so a barrel that comes apart four times becomes a column of eight fragments of
// which exactly one is ever swinging.
//
// So a body that is walled in looks for another way to the hero, and takes it if
// there is one. Nothing else about the queue changes: a lane still fights
// front-to-back, a body still cannot walk through the one ahead of it, and the
// hall still tops out at one melee attacker per lane. What changes is that the
// mob FILLS those slots instead of leaving them empty.
//
// WHY A REAL SEARCH AND NOT "PICK THE EMPTIEST LANE". Because the sidestep can
// itself be blocked, and the interesting cases are exactly the ones where it is.
// The lane next door may be full at the very tile the body stands on while it is
// open two tiles further back; an ogre is two tiles wide and walls its
// neighbours' path as well as its own; a caster planted at its 8-tile standoff
// is a wall its own escort has to go round. A greedy nudge sideways gets stuck on
// all three and the body stands there twitching. A* over the floor answers the
// only question worth asking — *is* there a way through, and where does it turn?
// — and answers "no" cleanly, which is just as important: a boxed-in body should
// hold its place in the queue rather than shuffle.
//
// THE GRID. One cell per lane per track tile: `grid[col][lane]`, col 0 at the
// hero's toes, growing out down the hall. A body walls the cells its own spacing
// covers — one for a skeleton, three for an ogre — so the grid is the same
// clearance the march itself keeps (loop.laneSpacing), read at tile resolution.
// The goal cell is the melee slot of the lane being tried: the body's own
// standoff, in that lane. A path exists iff that slot can be reached without
// walking through anybody.
//
// WHAT COMES OUT is ONE STEP, not a route to follow blindly: the column at which
// the path first changes lane, and which lane it changes to. The body marches as
// it always did until it reaches that column, then slides across — if the slot is
// still clear when it gets there, which is checked again on the frame it steps
// (the hall moves while it walks). Everything is re-planned a few times a second,
// so a route that goes stale is simply replaced rather than followed off a cliff.
//
// The whole thing is deterministic — no randomness anywhere, same as the plan.

// One cell is one track tile, and the grid never runs past the far end of the
// hall a pack can muster in.
const LANE_GRID_MAX_COLS = 96;

// Which grid column a track position falls in.
function laneCol(pos, cols) {
  return Math.max(0, Math.min(cols - 1, Math.round(pos)));
}

// The columns a body walls off in its own lane: its cell, widened by the
// clearance the queue keeps around it. A skeleton takes one, an ogre three —
// the same asymmetry laneSpacing applies to the march, so the grid can't promise
// a gap the march then refuses to let anybody stand in.
function bodyCols(e, cols) {
  const mid = laneCol(e.pos, cols);
  const half = Math.max(0, Math.round(CONFIG.enemyGapTiles * bodyTiles(e) / 2 - 0.5));
  const out = [];
  for (let c = mid - half; c <= mid + half; c++) if (c >= 0 && c < cols) out.push(c);
  return out;
}

// Where a body is HEADED — its goal lane if it is crossing, else the lane it
// stands in. Everything that counts heads counts them here, so a body already on
// its way to an empty lane doesn't invite a second one after it.
function laneAim(e) {
  return clampLane(e.laneGoal != null ? e.laneGoal : e.lane);
}

// Is a body still sliding between two rows? It is drawn between them (laneVis),
// and it neither swings nor plants while it is — a blow thrown from between two
// lanes lands from nowhere the player can see.
function laneSliding(e) {
  return e.laneVis != null && Math.abs(e.laneVis - e.lane) > 0.05;
}

// May this body be sent looking for another lane at all? Melee only: a ranged
// body already shoots over the rank in front of it, and a summoner or healer
// works from wherever it planted (loop.updateEnemies), so neither is waiting on
// a melee slot. Nothing that is dying, doomed, frozen or mid-shove moves either —
// each of those owns the body's position for as long as it lasts.
function canRoute(e, now) {
  return e.role === "melee" && e.phase !== "dying" && !e.deathAt && !e.splitAt &&
    !e.pushUntil && now >= (e.frozenUntil || 0);
}

// The occupancy grid for one planning pass. `occ` counts bodies per cell
// alongside the graph's own weights so a mover can lift ITSELF out of the wall
// it is standing in (and put itself back) without freeing a cell somebody else
// is also standing in.
function buildLaneGrid(lanes) {
  let far = 0;
  for (const e of state.enemies) far = Math.max(far, e.pos);
  const cols = Math.max(4, Math.min(LANE_GRID_MAX_COLS, Math.ceil(far) + 2));
  const weights = [];
  for (let c = 0; c < cols; c++) weights.push(new Array(lanes).fill(1));
  const graph = new Graph(weights);
  const occ = weights.map((row) => row.map(() => 0));
  for (const e of state.enemies) {
    const lane = clampLane(e.lane);
    if (lane >= lanes) continue;
    for (const c of bodyCols(e, cols)) {
      occ[c][lane]++;
      graph.grid[c][lane].weight = 0;
    }
  }
  return { graph, occ, cols, lanes };
}

// One search: from where `e` stands to the melee slot of `goalLane`. Returns the
// path as the library gives it (start excluded), or an empty array if the floor
// is walled off — which is a real answer, not a failure.
//
// THE FLOOR IS NOT THE WHOLE GRID, and getting that wrong is how a search starts
// promising routes the march cannot walk. Two strips are shut off for the length
// of one body's search:
//
//   - everything in FRONT of its standoff. The melee line is where a body stops
//     (`stop` in loop.updateEnemies); the tiles between it and the hero's toes
//     are not floor anybody may stand on. Left open they are a corridor running
//     right under the hero, and a body walled in on one side of the hall strolls
//     across his feet to reach the other.
//   - everything BEHIND the body itself. The march has no reverse gear — a body
//     only ever walks toward the hero — so a route that starts by backing off is
//     one it will stand and wait on forever, having been told there is a way.
//
// What is left is the rectangle between the body and the melee line, which is
// exactly the floor it can cover, and a search over it answers "no" when the
// answer is no. Both strips are put back before this returns; the grid belongs
// to the whole planning pass, not to one mover.
function laneRouteFor(g, e, goalLane) {
  const lane = clampLane(e.lane);
  const here = laneCol(e.pos, g.cols);
  const goalCol = laneCol(e.standoff != null ? e.standoff : CONFIG.enemyStandoffTiles, g.cols);
  const held = [];
  const hold = (c, l, w) => {
    const node = g.graph.grid[c][l];
    if (node.weight === w) return;
    held.push(node, node.weight);
    node.weight = w;
  };
  for (let c = 0; c < g.cols; c++) {
    if (c >= goalCol && c <= here) continue;
    for (let l = 0; l < g.lanes; l++) hold(c, l, 0);
  }
  // …and lift the mover out of its own footprint, or it would be searching from
  // inside a wall.
  const own = bodyCols(e, g.cols);
  for (const c of own) if (--g.occ[c][lane] <= 0) hold(c, lane, 1);
  const start = g.graph.grid[here][lane];
  const goal = g.graph.grid[goalCol][goalLane];
  const path = (start.isWall() || goal.isWall()) ? [] : astar.search(g.graph, start, goal);
  for (const c of own) g.occ[c][lane]++;
  for (let i = held.length - 2; i >= 0; i -= 2) held[i].weight = held[i + 1];
  return path;
}

// The first turn in a path: the column the body changes lane at, and which lane
// to. A grid step moves in one axis at a time, so the turn's own column is where
// it happens. Null if the route never leaves the lane it started in.
function laneStepFrom(e, path) {
  const lane = clampLane(e.lane);
  for (const node of path) {
    if (node.y !== lane) return { lane: node.y, pos: node.x };
  }
  return null;
}

// Is there room for `e` in `lane` at the tile it currently stands on? The march's
// own clearance, asked of the row it wants to step into — checked again on the
// frame the step is taken because the hall has been moving the whole time the
// body was walking up to it.
function laneSlotClear(e, lane) {
  for (const other of state.enemies) {
    if (other === e || clampLane(other.lane) !== lane) continue;
    if (Math.abs(other.pos - e.pos) < laneSpacing(e, other)) return false;
  }
  return true;
}

// Which body of a crowded lane is sent looking: the one FURTHEST from the hero.
// It is the one with least to lose — the front body is already fighting, and
// anything ahead of the mover keeps its place in the queue it was authored into,
// so a formation loses its stragglers rather than its shape. A body that has just
// crossed is left alone for `enemyLaneHoldMs`, which is what stops two lanes of
// equal length trading bodies back and forth forever.
function pickLaneMover(pool, lane, now) {
  let best = null, front = Infinity;
  for (const e of pool) if (clampLane(e.lane) === lane) front = Math.min(front, e.pos);
  for (const e of pool) {
    if (clampLane(e.lane) !== lane || e.laneGoal != null) continue;
    if (e.pos <= front + 1e-6) continue;                       // the lane's front body is fighting — leave it
    if (!canRoute(e, now)) continue;
    if (now - (e.laneMovedAt || 0) < CONFIG.enemyLaneHoldMs) continue;
    if (!best || e.pos > best.pos) best = e;
  }
  return best;
}

// THE PLAN, a few times a second (`enemyLaneRoutePlanMs`).
//
// The rule is one line long: while some lane is carrying two more melee bodies
// than some other, send the crowded lane's rearmost body to the empty one — if
// A* can get it there. Two, not one, because a difference of one is what an odd
// head count looks like when it is already spread as evenly as it can be, and
// moving on a difference of one would have the mob shuffling forever. It settles
// in a handful of passes and then stops: five bodies over four lanes end up
// 2/1/1/1 and stay there, which is four of them swinging instead of one.
function planLaneRoutes(now) {
  const lanes = Math.max(1, CONFIG.enemyLanes);
  if (lanes < 2 || !state.enemies.length) return;
  if (now - (state.laneRouteAt || 0) < CONFIG.enemyLaneRoutePlanMs) return;
  state.laneRouteAt = now;

  // Who is contending for a melee slot, and where each of them is headed.
  const pool = [];
  const load = new Array(lanes).fill(0);
  for (const e of state.enemies) {
    if (e.role !== "melee" || e.phase === "dying") continue;
    pool.push(e);
    load[laneAim(e)]++;
  }
  if (!pool.length) return;
  const g = buildLaneGrid(lanes);

  // 1. Anything already crossing re-reads the floor it is crossing. The hall it
  //    set out over is not the hall it is standing in — the body it was walking
  //    round may be dead, and the lane it was aiming at may have filled up. A
  //    route that no longer exists is dropped here rather than waited on, which
  //    hands the body straight back to the balance below.
  for (const e of pool) {
    if (e.laneGoal == null) continue;
    if (clampLane(e.laneGoal) === clampLane(e.lane) || !canRoute(e, now)) {
      e.laneGoal = null; e.laneStep = null;
      continue;
    }
    const step = laneStepFrom(e, laneRouteFor(g, e, clampLane(e.laneGoal)));
    if (step) { e.laneStep = step; continue; }
    load[clampLane(e.laneGoal)]--;
    load[clampLane(e.lane)]++;
    e.laneGoal = null; e.laneStep = null;
  }

  // 2. …and then the crowd spreads out. A lane whose mover can't get anywhere is
  //    shut out of the loop rather than retried against every other lane: a body
  //    that A* can't route out of its own row is boxed in, not choosy, and the
  //    next pass is 220 ms away.
  const shut = new Set();
  for (let guard = 0; guard < lanes * lanes; guard++) {
    let from = -1, to = -1;
    for (let l = 0; l < lanes; l++) {
      if (!shut.has(l) && (from < 0 || load[l] > load[from])) from = l;
      if (to < 0 || load[l] < load[to]) to = l;
    }
    if (from < 0 || to < 0 || load[from] - load[to] < 2) break;
    const mover = pickLaneMover(pool, from, now);
    const step = mover ? laneStepFrom(mover, laneRouteFor(g, mover, to)) : null;
    if (!step) { shut.add(from); continue; }
    mover.laneGoal = to;
    mover.laneStep = step;
    load[from]--;
    load[to]++;
  }
}

// THE STEP ITSELF, every frame. Two things happen here: the drawn row eases
// toward the real one (a body TELEPORTING between lanes reads as a glitch, not as
// a flanking move), and a body that has walked up to its turn takes it.
//
// The lane changes in one go while the picture catches up over
// `enemyLaneChangeMs`. That is the right way round: the queue is resolved from
// `lane`, so a half-committed body would be in two queues or neither, and the
// slot it is walking into has to be reserved the instant it commits or the body
// behind it walks into the same one.
function advanceLaneChanges(now, dt) {
  const ease = CONFIG.enemyLaneChangeMs > 0 ? dt / CONFIG.enemyLaneChangeMs : 1;
  for (const e of state.enemies) {
    if (e.laneVis == null) e.laneVis = e.lane;
    else if (e.laneVis !== e.lane) {
      const gap = e.lane - e.laneVis;
      e.laneVis = Math.abs(gap) <= ease ? e.lane : e.laneVis + Math.sign(gap) * ease;
    }
    const step = e.laneStep;
    if (!step) continue;
    if (!canRoute(e, now)) { e.laneStep = null; e.laneGoal = null; continue; }
    if (e.pos > step.pos + 0.5) continue;              // not up to the turn yet — keep marching
    if (!laneSlotClear(e, step.lane)) continue;        // it filled up while we walked — wait for the re-plan
    e.lane = step.lane;
    e.laneMovedAt = now;
    e.laneStep = null;
    if (clampLane(e.laneGoal) === e.lane) e.laneGoal = null;
  }
}

window.Incanto.pathfind = {
  planLaneRoutes, advanceLaneChanges, laneSliding, buildLaneGrid,
  laneRouteFor, laneStepFrom, laneSlotClear, laneAim, bodyCols, laneCol,
};
