"use strict";
// ==============================================================================
// render-scene.js — the combat canvas scene. Owns: scene, setupScene, buildBg,
// renderScene, drawHeroBackfire, rune/staff/gem draw helpers, staffTip/staffAct.
// ==============================================================================

// Scene state: canvas element, integer pixel scale, layout, cached background
let scene = null;

function setupScene(cv) {
  if (!tilesetImg.complete || !tilesetImg.naturalWidth) return false;
  if (!ASSETS) buildAssets();
  const dpr = window.devicePixelRatio || 1;
  const cssW = (cv.parentElement && cv.parentElement.clientWidth) || window.innerWidth || 360;
  const maxCssH = (window.innerHeight || 800) * 0.36;
  // Integer device-pixel scale: every art pixel renders at exactly `px`
  // device pixels, eliminating uneven pixel widths.
  let px = Math.round((cssW * dpr) / 200);
  const maxPxByH = Math.floor((maxCssH * dpr) / SCENE_H);
  px = Math.max(1, Math.min(px || 1, maxPxByH || 1, 10));
  const artW = Math.ceil((cssW * dpr) / px);
  // The hallway background is a long tile-strip drawn as two copies offset by the
  // camera, so the corridor scrolls on forever. Making it several screens long
  // (a whole number of pillar bays, so the pillar cadence wraps seamlessly) means
  // its props only recur every few screens — the repeat is far less obvious than
  // a one-screen loop. Props within it are scattered, not placed at fixed marks.
  const screenCols = Math.ceil(artW / TILE);
  const PILLAR_STEP = 6;                                   // wall pillars every N tiles (one bay)
  const cols = Math.ceil((screenCols * 3) / PILLAR_STEP) * PILLAR_STEP;
  const bgW = cols * TILE;
  cv.width = artW;
  cv.height = SCENE_H;
  cv.style.width = `${(artW * px) / dpr}px`;
  cv.style.height = `${(SCENE_H * px) / dpr}px`;

  const margin = Math.max(10, Math.round(artW * 0.08));
  const wiz = SHEET.wizardIdle;
  // Lanes: parallel depth rows across the floor the mob marches in on. Feet
  // lines run from near the back wall to the front of the floor; the hero holds
  // the middle lane.
  const laneCount = Math.max(1, CONFIG.enemyLanes);
  const laneY = [];
  for (let i = 0; i < laneCount; i++) {
    const frac = laneCount <= 1 ? 0.66 : 0.40 + (0.92 - 0.40) * (i / (laneCount - 1));
    laneY.push(FLOOR_Y + Math.round((SCENE_H - FLOOR_Y) * frac));
  }
  const heroLane = Math.floor(laneCount / 2);
  const feetY = laneY[heroLane];
  const wizard = { x: margin, y: feetY - wiz.h };
  // The traced rune is a "magic shield" hovering just in front of the wizard,
  // facing the enemy: a circle foreshortened to a tall, narrow ellipse (rx < ry).
  // Its centre sits ~0.9 tiles ahead of the wizard, midway up the floor.
  const runeCx = Math.round(wizard.x + wiz.w / 2 + 0.9 * TILE);
  const runeCy = Math.round((FLOOR_Y + SCENE_H) / 2);
  const layout = buildHallLayout(cols, PILLAR_STEP);
  scene = {
    cv,
    artW,
    bgW,
    wizard,
    feetY,
    laneY,
    // Enemy march track: a skeleton's `pos` is in tiles to the right of the
    // hero's front edge, so one pos-unit is exactly one 16px floor tile.
    enemyLineX: wizard.x + wiz.w,
    fountains: layout.fountainCols.map((c) => c * TILE),
    props: layout,
    rune: { cx: runeCx, cy: runeCy, rx: 8, ry: 12 },
    castChest: null,  // cached chest of the last cast target, for the fireball
    bg: null,
    edgeVignette: buildEdgeVignette(artW),
  };
  scene.bg = buildBg(bgW);
  return true;
}

// Scatter the corridor's furnishings across the whole strip so nothing sits at a
// fixed screen mark and the layout only repeats every strip-length. Pillars keep
// a steady bay cadence (architecture reads as deliberate); fountains, banners and
// floor debris are spread into even buckets with a deterministic tile-hash jitter
// so they never clump and never land on a pillar. All positions are tile columns.
function buildHallLayout(cols, step) {
  const pillars = [];
  for (let c = 0; c < cols; c += step) pillars.push(c);
  const taken = new Set(pillars);
  const blocked = (c) => taken.has(c - 1) || taken.has(c) || taken.has(c + 1);
  // Spread `count` marks into even buckets across [lo, hi), jittered ±2 tiles and
  // nudged clear of anything already placed.
  const scatter = (count, seed, lo, hi) => {
    const out = [];
    const range = hi - lo;
    for (let i = 0; i < count; i++) {
      let c = lo + Math.floor((i + 0.5) * range / count) + ((tileHash(seed, i) % 5) - 2);
      let guard = 0;
      while (blocked(c) && guard++ < 5) c++;
      c = Math.max(lo, Math.min(hi - 1, c));
      taken.add(c);
      out.push(c);
    }
    return out;
  };
  const fountainCols = scatter(Math.max(2, Math.round(cols / 16)), 101, 2, cols - 2);
  const banners = [];
  for (const c of scatter(Math.max(1, Math.round(cols / 18)), 202, 2, cols - 3)) {
    banners.push({ col: c, sheet: "bannerRed" });
    banners.push({ col: c + 1, sheet: "bannerGreen" });
    taken.add(c + 1);
  }
  const debris = ["skull", "crate"];
  const floorProps = scatter(Math.max(1, Math.round(cols / 22)), 303, 2, cols - 2)
    .map((c, i) => ({ col: c, type: debris[tileHash(404, i) % debris.length] }));
  return { pillars, banners, floorProps, fountainCols };
}

function buildBg(artW) {
  const d = CONFIG.colors.dungeon;
  const cv = document.createElement("canvas");
  cv.width = artW;
  cv.height = SCENE_H;
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const blit = (rect, dx, dy) =>
    ctx.drawImage(tilesetImg, rect.x, rect.y, rect.w, rect.h, dx, dy, rect.w, rect.h);

  ctx.fillStyle = d.background;
  ctx.fillRect(0, 0, artW, SCENE_H);

  const cols = Math.ceil(artW / TILE);

  // Wall: a top-cap row, then mid rows filling straight down to the floor line
  for (let c = 0; c < cols; c++) {
    blit(SHEET.wallTopMid, c * TILE, 0);
    for (let y = TILE; y < FLOOR_Y; y += TILE) blit(SHEET.wallMid, c * TILE, y);
  }

  // Floor: mostly floor_1 with stable variation (drawn before the props that
  // stand on it, so their base tiles read as resting on the floor)
  for (let r = 0; r * TILE + FLOOR_Y < SCENE_H; r++) {
    for (let c = 0; c < cols; c++) {
      const h = tileHash(r, c);
      const tile = h % 4 === 0 ? SHEET.floors[1 + (h % (SHEET.floors.length - 1))] : SHEET.floors[0];
      blit(tile, c * TILE, FLOOR_Y + r * TILE);
    }
  }

  // Contact shadow: the wall casts a soft gradient onto the floor just below
  // the seam, giving a crisp wall→floor transition instead of a muddy tile join.
  for (let y = 0; y < 6; y++) {
    ctx.fillStyle = `rgba(0, 0, 0, ${(0.42 * (1 - y / 6)).toFixed(3)})`;
    ctx.fillRect(0, FLOOR_Y + y, artW, 1);
  }

  // Wall pillars on a steady bay cadence down the corridor: capital on top, shaft
  // down the full wall, and the base tile planted on the first floor row so each
  // pillar stands with its bottom tile on the wall→floor transition.
  for (const col of scene.props.pillars) {
    const cx = col * TILE;
    blit(SHEET.wallColumnTop, cx, 0);
    for (let y = TILE; y < FLOOR_Y; y += TILE) blit(SHEET.wallColumnMid, cx, y);
    blit(SHEET.wallColumnBase, cx, FLOOR_Y);
  }

  // Banners hang in scattered pairs from just below the top cap
  for (const b of scene.props.banners) blit(SHEET[b.sheet], b.col * TILE, TILE);

  // Fountains are a 3-tile stack anchored to the floor line: spout, streaming
  // mid, and basin. The spout sits two rows above the floor so the mid tile
  // always has room (the stream + basin are animated in renderScene).
  for (const fx of scene.fountains) {
    blit(SHEET.fountainTop, fx, FLOOR_Y - 2 * TILE);
  }

  // Floor debris (skulls, crates) scattered down the hall, each on its own
  // grounding shadow, resting on the mid floor line.
  const feetY = FLOOR_Y + Math.round((SCENE_H - FLOOR_Y) * 0.66);
  for (const fp of scene.props.floorProps) {
    const spr = SHEET[fp.type];
    blit(spr, fp.col * TILE, feetY + 4 - spr.h);
    ctx.drawImage(ASSETS.shadow, fp.col * TILE + 8 - 9, feetY - 2);
  }

  // --- Atmosphere pass (baked): depth + vignette ---------------------------
  // Ambient occlusion: the wall casts a soft shadow onto the front of the floor.
  const ao = ctx.createLinearGradient(0, FLOOR_Y, 0, FLOOR_Y + 12);
  ao.addColorStop(0, "rgba(8, 5, 12, 0.55)");
  ao.addColorStop(1, "rgba(8, 5, 12, 0)");
  ctx.fillStyle = ao;
  ctx.fillRect(0, FLOOR_Y, artW, 12);

  // Gentle global darken so the lava and rune read as actual light sources.
  ctx.fillStyle = "rgba(9, 6, 14, 0.16)";
  ctx.fillRect(0, 0, artW, SCENE_H);

  // Edge vignette: soft darkening on all four borders.
  const band = (grad, x, y, w, h) => { ctx.fillStyle = grad; ctx.fillRect(x, y, w, h); };
  const vt = ctx.createLinearGradient(0, 0, 0, 8);
  vt.addColorStop(0, "rgba(6, 4, 10, 0.7)"); vt.addColorStop(1, "rgba(6, 4, 10, 0)");
  band(vt, 0, 0, artW, 8);
  const vb = ctx.createLinearGradient(0, SCENE_H - 8, 0, SCENE_H);
  vb.addColorStop(0, "rgba(6, 4, 10, 0)"); vb.addColorStop(1, "rgba(6, 4, 10, 0.6)");
  band(vb, 0, SCENE_H - 8, artW, 8);
  // The left/right vignette is NOT baked here — it belongs to the screen frame,
  // not the corridor. Baked in, it would sweep past as dark bands while the
  // hallway scrolls; instead it rides on top as a fixed overlay (see renderScene).

  return cv;
}

// The left/right edge vignette, cached as a screen-fixed overlay (transparent in
// the middle). Drawn over the scrolled corridor so the darkened borders stay
// pinned to the viewport instead of scrolling away with the hallway.
function buildEdgeVignette(artW) {
  const cv = document.createElement("canvas");
  cv.width = artW;
  cv.height = SCENE_H;
  const ctx = cv.getContext("2d");
  const vl = ctx.createLinearGradient(0, 0, 16, 0);
  vl.addColorStop(0, "rgba(6, 4, 10, 0.55)"); vl.addColorStop(1, "rgba(6, 4, 10, 0)");
  ctx.fillStyle = vl; ctx.fillRect(0, 0, 16, SCENE_H);
  const vr = ctx.createLinearGradient(artW - 16, 0, artW, 0);
  vr.addColorStop(0, "rgba(6, 4, 10, 0)"); vr.addColorStop(1, "rgba(6, 4, 10, 0.55)");
  ctx.fillStyle = vr; ctx.fillRect(artW - 16, 0, 16, SCENE_H);
  return cv;
}

function renderScene(now) {
  const cv = document.getElementById("scene");
  if (!cv) return;
  if (!scene || scene.cv !== cv) {
    if (!setupScene(cv)) return; // sheet still loading
  }
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  // Hallway scroll: the corridor (background + its props) slides left as the hero
  // strides forward, while he and the skeletons hold their screen positions — a
  // camera following the hero down an endless hall. Two tile-aligned copies of the
  // background wrap seamlessly; `camOff` is the current scroll within one length.
  const bgW = scene.bgW;
  const camOff = ((state.cameraX % bgW) + bgW) % bgW;
  ctx.drawImage(scene.bg, -camOff, 0);
  ctx.drawImage(scene.bg, bgW - camOff, 0);
  // Edge vignette rides on top, pinned to the viewport (not the scrolling hall).
  ctx.drawImage(scene.edgeVignette, 0, 0);

  const feetY = scene.feetY;        // the hero's lane
  const fountainBasinY = FLOOR_Y;   // basin on the first floor row

  // Lava fountains: 3-frame animation, stream + basin. Drawn BEFORE the warm
  // light pools so the light washes over the fountain itself, not only the
  // tiles around it (otherwise the opaque basin sprite leaves a dark core).
  scene.fountains.forEach((fx, i) => {
    const fi = (Math.floor(now / 160) + i) % ASSETS.fountainMid.length;
    // Scroll the animated stream+basin with the corridor (two wrapped copies) so
    // they stay planted on the baked spout as the hallway slides by.
    for (const bx of [fx - camOff, fx - camOff + bgW]) {
      // Streaming mid tiles fill the gap between the spout and the basin.
      for (let y = FLOOR_Y - TILE; y > FLOOR_Y - 2 * TILE; y -= TILE) ctx.drawImage(ASSETS.fountainMid[fi], bx, y);
      ctx.drawImage(ASSETS.fountainBasin[fi], bx, fountainBasinY);
    }
  });

  // Light pools (additive): each fountain spills warm light over itself and the
  // surrounding floor/wall, with a hot core right on the basin; the rune throws
  // cool light near the wizard. Gently flickering.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  scene.fountains.forEach((fx, i) => {
    for (const bx of [fx - camOff, fx - camOff + bgW]) {
      ctx.globalAlpha = 0.7 + 0.3 * Math.sin(now / 130 + i * 2.1);
      ctx.drawImage(ASSETS.poolWarm, bx + 8 - 34, fountainBasinY - 34);
      ctx.globalAlpha = 0.6 + 0.3 * Math.sin(now / 110 + i * 2.1);
      ctx.drawImage(ASSETS.glowFountain, bx + 8 - 15, fountainBasinY + 4 - 15);
    }
  });
  ctx.globalAlpha = (0.6 + 0.25 * Math.sin(now / 300)) * (state.screen === "combat" ? 1 : 0.5);
  ctx.drawImage(ASSETS.poolCool, scene.rune.cx - 22, scene.rune.cy - 22);
  ctx.restore();

  // Grounding shadow under the wizard (the skeleton's is drawn with it below).
  ctx.drawImage(ASSETS.shadow, scene.wizard.x + SHEET.wizardIdle.w / 2 - 9, feetY - 2);

  // Fighters: the sheet's own 4-frame idle animations, out of phase
  const wf = Math.floor(now / 160) % ASSETS.wizard.length;
  const sf = Math.floor(now / 160 + 2) % ASSETS.skelet.length;

  // Blast recoil: a mis-cast explosion shoves the hero back toward the wall and
  // lifts them off their feet, then they spring home. The grounding shadow above
  // stays planted so the hop reads as leaving the floor. Staff + body move as one.
  let hkx = 0, hky = 0;
  if (now < state.heroBlastUntil) {
    const q = 1 - (state.heroBlastUntil - now) / CONFIG.heroBlastMs; // 0 → 1
    const brk = CONFIG.heroBlastBreakFrac;
    if (q > brk) {
      // the explosion has reached the hero — recoil only now, not during the break
      const bq = (q - brk) / (1 - brk);                    // 0 → 1 across the explosion
      const recoil = bq < 0.16 ? bq / 0.16 : Math.pow(1 - (bq - 0.16) / 0.84, 1.7);
      hkx = -recoil * CONFIG.heroKnockback;                // snap back toward the wall, then spring home
      hky = -recoil * CONFIG.heroKnockback * 0.45;         // briefly off the ground
    }
  }

  // Walking down the hallway: a subtle vertical bob sells footsteps against the
  // scrolling floor (the hero keeps his screen spot; the corridor slides past).
  // Its amplitude tracks the eased pan speed so the bob fades in and out with the
  // motion rather than popping on and off.
  const walkFactor = Math.min(1, state.cameraVel / CONFIG.heroWalkPxPerMs);
  const walkBob = now >= state.heroBlastUntil
    ? -Math.abs(Math.sin(now / 150)) * walkFactor
    : 0;

  ctx.save();
  ctx.translate(Math.round(hkx), Math.round(hky + walkBob));
  // The staff is drawn BEHIND the wizard so the shaft is occluded by his body
  // and only the gem end pokes out. At rest it stands upright; while
  // tracing/casting the gem rides out to the rune disc, then jabs on launch.
  drawWizardStaff(ctx, now);

  ctx.drawImage(ASSETS.wizard[wf], scene.wizard.x, scene.wizard.y);
  ctx.restore();

  // Enemies: the mob walks in from the right toward the hero, fading out on
  // death. Each skeleton's tile position maps onto scene x (one tile = TILE px);
  // nearer ones (smaller pos) draw last so they overlap the ranks behind them.
  // Three distinct animations read the phase at a glance: a leg-cycling run
  // while walking, a still idle stance when stopped out of reach, and a forward
  // jab on every strike while attacking.
  const skl = SHEET.skeletIdle;
  const sceneX = (pos) => scene.enemyLineX + pos * TILE;
  const laneFeetY = (e) => scene.laneY[e.lane] ?? feetY;
  // Draw back lanes (higher up the floor) first, and within a lane the nearer
  // ones last, so closer skeletons overlap the ranks behind them.
  const ordered = state.enemies.slice().sort(
    (a, b) => (laneFeetY(a) - laneFeetY(b)) || (b.pos - a.pos)
  );
  for (const e of ordered) {
    const ly = laneFeetY(e);
    const skelY = ly - skl.h;
    const walking = e.phase === "walk";
    const frameSet = walking ? ASSETS.skeletRun : ASSETS.skelet;
    // Frame cadence sets the three moods apart: a brisk run cycle, a calm idle,
    // and an agitated (fast) shuffle while attacking.
    const frameMs = walking ? 110 : e.phase === "attack" ? 90 : 160;
    const ef = Math.floor(now / frameMs + e.slot) % frameSet.length;

    // Attacking: a sharp forward jab toward the hero (left) on each hit, then back.
    let xJab = 0;
    if (e.phase === "attack" && e.attackAnimAt && now - e.attackAnimAt < CONFIG.enemyAttackLungeMs) {
      const p = (now - e.attackAnimAt) / CONFIG.enemyAttackLungeMs;
      xJab = -Math.round(Math.sin(p * Math.PI) * 5);
    }

    const cx = Math.round(sceneX(e.pos));
    const sx = cx - Math.round(skl.w / 2) + xJab;
    let alpha = 1;
    if (e.phase === "dying") {
      const p = Math.min(1, (now - e.phaseAt) / CONFIG.enemyDeathMs);
      alpha = 1 - p;
      // dissolving embers rise as it collapses
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 7; i++) {
        const h = (i * 97) % 13;
        const ex = sx + 3 + ((i * 5) % skl.w);
        const ey = skelY + skl.h - Math.round(p * (10 + h));
        ctx.fillStyle = `rgba(77, 227, 224, ${(alpha * 0.8).toFixed(2)})`;
        ctx.fillRect(ex, ey, 1, 1);
      }
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(ASSETS.shadowSm, cx - 8, ly - 2);
    ctx.drawImage(frameSet[ef], sx, skelY);
    ctx.restore();
  }

  // The wizard's spell-in-progress: the rune the player is tracing below is
  // mirrored as a tilted disc in front of the wizard. While tracing, it shows
  // node dots plus the chords drawn so far; on completion it flares with a
  // semi-transparent disc, then puffs away as the fireball launches from it.
  if (state.castAt) {
    const t = now - state.castAt;
    const charge = CONFIG.castChargeMs;
    const puff = CONFIG.runePuffMs;
    const flight = CONFIG.fireballFlightMs;
    const impact = CONFIG.fireballImpactMs;
    const f = CONFIG.colors.fireball;
    // Aim at the skeleton this cast targeted; cache its chest so the fireball
    // still lands if the target has already dissolved by the time it arrives.
    const target = state.enemies.find((e) => e.id === state.castTargetId);
    let chest;
    if (target) {
      const ty = (scene.laneY[target.lane] ?? feetY) - skl.h;
      chest = { x: Math.round(sceneX(target.pos)), y: ty + 9 };
      scene.castChest = chest;
    } else {
      chest = scene.castChest || { x: scene.enemyLineX, y: (feetY - skl.h) + 9 };
    }

    if (t < charge) {
      // charge: disc fades in behind the completed rune, lines go white-hot
      const q = t / charge;
      drawSceneRune(ctx, now, state.castChords, { disc: 0.14 + q * 0.26, bright: q, scale: 1 });
    } else if (t < charge + puff) {
      // puff: the rune expands and dissolves
      const q = (t - charge) / puff;
      drawSceneRune(ctx, now, state.castChords, {
        disc: 0.4 * (1 - q),
        bright: 1,
        scale: 1 + q * 0.7,
        alpha: 1 - q,
      });
    }

    if (t >= charge && t <= charge + flight) {
      const p = (t - charge) / flight;
      const ap = domeProject(0, 0, 1);        // launch from the shield's lit apex
      const x = Math.round(ap.x + (chest.x - ap.x) * p);
      const y = Math.round(ap.y + (chest.y - ap.y) * p - Math.sin(p * Math.PI) * 10);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(ASSETS.glowFireball, x - 9, y - 9);
      ctx.restore();
      ctx.drawImage(ASSETS.fireball, x - 5, y - 3);
    } else if (t > charge + flight && t <= charge + flight + impact) {
      const q = (t - charge - flight) / impact;
      if (target && Math.floor((t - charge - flight) / 70) % 2 === 0) {
        const ty = (scene.laneY[target.lane] ?? feetY) - skl.h;
        ctx.drawImage(ASSETS.skeletHit[sf], Math.round(sceneX(target.pos)) - Math.round(skl.w / 2), ty);
      }
      const r = Math.round(2 + q * 10);
      ctx.fillStyle = f.y;
      ctx.fillRect(chest.x - r, chest.y, 2, 1);
      ctx.fillRect(chest.x + r, chest.y, 2, 1);
      ctx.fillRect(chest.x, chest.y - r, 1, 2);
      ctx.fillRect(chest.x, chest.y + r, 1, 2);
      ctx.fillStyle = f.O;
      ctx.fillRect(chest.x - r + 1, chest.y - r + 1, 1, 1);
      ctx.fillRect(chest.x + r - 1, chest.y - r + 1, 1, 1);
      ctx.fillRect(chest.x - r + 1, chest.y + r - 1, 1, 1);
      ctx.fillRect(chest.x + r - 1, chest.y + r - 1, 1, 1);
    } else if (t > charge + flight + impact) {
      state.castAt = 0;
      state.castChords = null;
    }
  } else if (state.screen === "combat" && now >= state.heroBlastUntil) {
    // tracing: live mirror of the chords drawn so far — suppressed while a
    // mis-cast is backfiring, since the disc is shattering in red instead.
    drawSceneRune(ctx, now, state.chords, { disc: 0, bright: 0, scale: 1 });
  }

  // Mis-cast backfire: the traced rune shatters in red over the wizard and its
  // broken magic detonates around him.
  if (now < state.heroBlastUntil) drawHeroBackfire(ctx, now);
}

// A wrong pair backfires: the rune the wizard was tracing tears apart in red
// over his head and the loose magic detonates around him. Timeline runs off
// state.heroBlastUntil: the disc shatters first, the blast blooms underneath.
function drawHeroBackfire(ctx, now) {
  const q = Math.max(0, Math.min(1, 1 - (state.heroBlastUntil - now) / CONFIG.heroBlastMs)); // 0 → 1
  const { cx, cy } = scene.rune;
  const wiz = SHEET.wizardIdle;
  const hx = scene.wizard.x + wiz.w / 2;
  const hy = scene.wizard.y + wiz.h / 2;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  const brk = CONFIG.heroBlastBreakFrac;

  // --- 1. BREAK first: the rune the hero was tracing tears apart in red over
  //        their head — a flash, then the six nodes hurled out with cracks
  //        snapping between them. Fully done before the explosion begins. ---
  if (q < brk) {
    const shatter = q / brk;      // 0 → 1 across the break
    const fade = 1 - shatter;
    // the whole disc drifts from its resting spot into the hero as it comes
    // apart, so the magic reads as breaking *into* him
    const dcx = cx + (hx - cx) * shatter;
    const dcy = cy + (hy - cy) * shatter;
    // red flash shaped like the shield dome, swelling hard as it lets go
    ctx.fillStyle = `rgba(255, 74, 80, ${(fade * 0.6).toFixed(3)})`;
    const grow = 1.4 * (1 + shatter);
    ctx.beginPath();
    const fseg = 32;
    for (let i = 0; i <= fseg; i++) {
      const a = (i / fseg) * Math.PI * 2;
      const p = domeProject(RUNE_DISC.bandOuter * Math.cos(a), RUNE_DISC.bandOuter * Math.sin(a), 1);
      const fx = dcx + (p.x - cx) * grow, fy = dcy + (p.y - cy) * grow;
      i ? ctx.lineTo(fx, fy) : ctx.moveTo(fx, fy);
    }
    ctx.closePath();
    ctx.fill();
    // the six crystals fling outward from the drifting centre as it sinks into him
    const nodes = [];
    for (let i = 0; i < CONFIG.runeCount; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / CONFIG.runeCount;
      const p = domeProject(Math.cos(a), Math.sin(a), 1);
      const spread = 1 + shatter * 2.2;   // hurl the crystals apart as they let go
      nodes.push({
        x: dcx + (p.x - cx) * spread,
        y: dcy + (p.y - cy) * spread,
      });
    }
    // jagged red cracks between neighbours, snapping as they separate
    ctx.fillStyle = `rgba(255, 90, 96, ${(fade * 0.9).toFixed(3)})`;
    for (let i = 0; i < nodes.length; i++) {
      const p1 = nodes[i], p2 = nodes[(i + 1) % nodes.length];
      pixLine(ctx, Math.round(p1.x), Math.round(p1.y), Math.round(p2.x), Math.round(p2.y));
    }
    // bright shards flung off each node
    ctx.fillStyle = `rgba(255, 210, 160, ${fade.toFixed(3)})`;
    for (const p of nodes) ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 4, 4);
  }

  // --- 2. THEN the explosion: only once the rune has finished breaking does the
  //        loose magic detonate on the hero — a white-hot core, two expanding
  //        red shock rings, and a spray of embers. The knockback (drawn with the
  //        wizard) fires on this phase's first frame, when the blast lands. ---
  if (q >= brk) {
    const blast = (q - brk) / (1 - brk); // 0 → 1 across the explosion
    // white-hot core flash
    ctx.fillStyle = `rgba(255, 236, 200, ${((1 - blast) * 0.7).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(hx, hy, Math.max(0, 22 * (1 - blast)), 0, Math.PI * 2);
    ctx.fill();
    // two shock rings, the second trailing the first
    for (const [off, w, aMul] of [[0, 3, 1], [-0.22, 2, 0.6]]) {
      const b = blast + off;
      if (b <= 0 || b >= 1) continue;
      ctx.strokeStyle = `rgba(255, 68, 74, ${((1 - b) * 0.9 * aMul).toFixed(2)})`;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(hx, hy, 5 + b * 46, 0, Math.PI * 2);
      ctx.stroke();
    }
    // embers flung outward, some larger
    const N = 18;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + blast * 1.4;
      const d = blast * (24 + (i % 4) * 11);
      ctx.fillStyle = `rgba(255, ${90 + (i % 4) * 30}, 60, ${((1 - blast) * 0.95).toFixed(2)})`;
      const s = i % 3 === 0 ? 3 : 2;
      ctx.fillRect(Math.round(hx + Math.cos(a) * d), Math.round(hy + Math.sin(a) * d), s, s);
    }
  }

  ctx.restore();
}

// Crisp 1px Bresenham line (canvas stroke() would anti-alias)
function pixLine(ctx, x0, y0, x1, y1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// --- Rune-shield disc geometry ----------------------------------------------
// The scene rune reads as a magic disc seen edge-on-ish in front of the wizard:
// a circle foreshortened to a tall, narrow ellipse (via rx < ry in scene.rune).
// Every ring shares one centre so the wheel stays clean and concentric, like a
// small mirror of the flat arena wheel below. The band is centred on the node
// ring (rr = 1); the crystal sockets exactly span its width, tangent to both
// edge rings.
const RUNE_DISC = (() => {
  const bandInner = 0.82, bandOuter = 1.18;
  const socketR = 0.15; // small, round sockets that sit within the band
  // Convex perspective: the disc bulges toward the viewer, turned slightly about
  // its vertical axis so the near point (apex) sits a touch RIGHT of centre. Each
  // interior ring therefore shifts progressively rightward — their centres are
  // NOT shared — and the radial lines curve. Rim points (rr >= 1) don't move, so
  // the outline stays put and there's no vertical lean.
  const turn = 0.34, bulge = 0.8;
  return {
    bandInner, bandOuter, socketR,
    turn, bulge, cosT: Math.cos(turn), sinT: Math.sin(turn),
  };
})();

// Project a point on the flat rune disc (unit coords u,v; the rim is |(u,v)| = 1)
// to screen. The disc bulges toward the viewer (height z, max at the centre) and
// is turned slightly about its vertical axis, which slides interior points to the
// right by z — so concentric input circles come out as rings whose centres step
// rightward, and straight radial lines bow. Vertical (v) stays clean, so nothing
// leans up or down.
function domeProject(u, v, scale = 1) {
  const { cx, cy, rx, ry } = scene.rune;
  const rr = Math.hypot(u, v);
  const z = rr < 1 ? RUNE_DISC.bulge * Math.sqrt(1 - rr * rr) : 0; // bulge toward viewer
  const x = u * RUNE_DISC.cosT + z * RUNE_DISC.sinT;              // turn slides inner points right
  return { x: cx + x * rx * scale, y: cy + v * ry * scale };
}

// Map a big-arena point onto the disc, proportionally (radius kept, not just
// angle), so a stroke drawn across the circle below mirrors faithfully on the
// shield. Radius is clamped so a pointer flung past the rim stays on the
// staff's reach.
function runePointXY(px, py, scale = 1) {
  let nx = (px - CONFIG.circleCenter.x) / CONFIG.circleRadius;
  let ny = (py - CONFIG.circleCenter.y) / CONFIG.circleRadius;
  const r = Math.hypot(nx, ny);
  if (r > 1.1) { nx = (nx / r) * 1.1; ny = (ny / r) * 1.1; }
  return domeProject(nx, ny, scale);
}

// A closed parallel (circle rr = const on the flat disc) drawn as a 1px curve
// bent over the dome.
function domeRing(ctx, rr, scale, seg = 40) {
  let prev = domeProject(rr, 0, scale);
  for (let i = 1; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const p = domeProject(rr * Math.cos(a), rr * Math.sin(a), scale);
    pixLine(ctx, Math.round(prev.x), Math.round(prev.y), Math.round(p.x), Math.round(p.y));
    prev = p;
  }
}

// A straight segment in flat disc space, sampled and drawn as a 1px polyline
// that bows over the dome.
function domeSeg(ctx, u1, v1, u2, v2, scale, seg = 5) {
  let prev = domeProject(u1, v1, scale);
  for (let i = 1; i <= seg; i++) {
    const t = i / seg;
    const p = domeProject(u1 + (u2 - u1) * t, v1 + (v2 - v1) * t, scale);
    pixLine(ctx, Math.round(prev.x), Math.round(prev.y), Math.round(p.x), Math.round(p.y));
    prev = p;
  }
}

// A traced chord between two big-arena points, sampled in arena space then
// curved over the dome and drawn with the additive glow.
function domeChord(ctx, x1, y1, x2, y2, scale, core, glowRGB, seg = 7) {
  let prev = runePointXY(x1, y1, scale);
  for (let i = 1; i <= seg; i++) {
    const t = i / seg;
    const p = runePointXY(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, scale);
    pixLineGlow(ctx, Math.round(prev.x), Math.round(prev.y), Math.round(p.x), Math.round(p.y), core, glowRGB);
    prev = p;
  }
}

// A rune crystal socket seated in the band: a small, round gem well with a
// glowing rim and a bright core. Drawn as a smooth foreshortened ellipse (rw x
// rh) rather than a stepped polygon, so it stays cleanly round at this size and
// the dome skew doesn't fleck it with straight edges. (cu,cv) is the slot on the
// unit node ring; `r` is the socket radius; `bright` is the cast glow.
function drawRuneCrystal(ctx, cu, cv, r, scale, bright, c) {
  const { rx, ry } = scene.rune;
  const p = domeProject(cu, cv, scale);
  const rw = r * rx * scale, rh = r * ry * scale;
  ctx.fillStyle = "rgba(4, 16, 16, 0.6)";            // dark gem well
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, rw * 0.9, rh * 0.9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();                                        // glowing rim
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = `rgba(${c.glowRGB}, ${(0.5 + bright * 0.4).toFixed(3)})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, rw, rh, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = c.dot;                             // bright core
  ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
}

// A 1px line with an additive glow: soft passes offset around the core line
function pixLineGlow(ctx, x0, y0, x1, y1, core, glowRGB) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = `rgba(${glowRGB}, 0.16)`;
  for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
    pixLine(ctx, x0 + ox, y0 + oy, x1 + ox, y1 + oy);
  }
  ctx.restore();
  ctx.fillStyle = core;
  pixLine(ctx, x0, y0, x1, y1);
}

// Draw the rune shield: a rune circle etched on a shallow sphere-cap dome. The
// glass backing is lit at the apex to read as bulging; concentric parallels and
// radial meridians curve over the surface (the 3D cue); a filled band straddles
// the node ring with a crystal seated in each of the six slots; traced chords
// bow across the dome. `bright` drives the cast brightening, `scale`/`alpha` the
// charge/puff growth-and-fade.
function drawSceneRune(ctx, now, chords, { disc, bright, scale, alpha = 1 }) {
  const c = CONFIG.colors.sceneRune;
  const { rx, ry } = scene.rune;
  const R = RUNE_DISC;
  const slotAngle = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / CONFIG.runeCount;
  const slotUV = (i) => ({ u: Math.cos(slotAngle(i)), v: Math.sin(slotAngle(i)) });
  const apex = domeProject(0, 0, scale);

  // trace the projected silhouette of the disc at flat-radius rr into a path
  const silhouette = (rr, seg = 46) => {
    ctx.beginPath();
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const p = domeProject(rr * Math.cos(a), rr * Math.sin(a), scale);
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
    }
    ctx.closePath();
  };

  ctx.save();
  // The whole wheel breathes: a calm ~3.5s alpha pulse gently dips the entire
  // disc (lines included) so the hero behind it shows through a little more at
  // the trough. Shallow — peaks at full, only eases back to 0.85.
  const pulse = 0.925 + 0.075 * Math.sin(now * (2 * Math.PI / 3500));
  ctx.globalAlpha = alpha * pulse;

  // --- 1. Glass shield backing: a convex lens sheen. The wheel stays perfectly
  //        round and concentric, but a bright highlight up top fading to a
  //        shaded lower rim makes the glass read as gently bulging toward us. ---
  const discNow = Math.max(disc, 0.06 + 0.04 * Math.sin(now / 900));
  const RXo = rx * scale * R.bandOuter, RYo = ry * scale * R.bandOuter;
  ctx.save();
  silhouette(R.bandOuter);
  ctx.clip();
  const bx = apex.x - RXo - 12, by = apex.y - RYo - 6, bw = RXo * 2 + 24, bh = RYo * 2 + 12;
  // Keep the glass mostly see-through so the wizard reads through it — just a
  // faint blue wash lit a little above centre.
  const glassBlue = "96, 158, 236";
  const g = ctx.createRadialGradient(apex.x, apex.y - RYo * 0.28, 0, apex.x, apex.y, Math.max(RXo, RYo));
  g.addColorStop(0, `rgba(${glassBlue}, ${(discNow * 0.45 + 0.035).toFixed(3)})`);
  g.addColorStop(0.55, `rgba(${glassBlue}, ${(discNow * 0.28 + 0.015).toFixed(3)})`);
  g.addColorStop(1, `rgba(${glassBlue}, ${(discNow * 0.05).toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fillRect(bx, by, bw, bh);
  // the lower rim curves away from the light: a light shade, not a heavy one, so
  // it doesn't darken what shows through
  const d = ctx.createLinearGradient(0, apex.y - RYo * 0.25, 0, apex.y + RYo);
  d.addColorStop(0, "rgba(3, 12, 16, 0)");
  d.addColorStop(1, "rgba(3, 12, 16, 0.24)");
  ctx.fillStyle = d;
  ctx.fillRect(bx, by, bw, bh);
  // glossy specular cap near the top of the bulge (faint at rest, blooms on cast)
  ctx.globalCompositeOperation = "lighter";
  const hy = apex.y - RYo * 0.5;
  const sMax = Math.max(RXo, RYo) * 0.62;
  const s = ctx.createRadialGradient(apex.x, hy, 0, apex.x, hy, sMax);
  const specA = Math.min(0.6, 0.1 + disc * 0.28 + bright * 0.32);
  s.addColorStop(0, `rgba(216, 253, 251, ${specA.toFixed(3)})`);
  s.addColorStop(0.6, `rgba(120, 240, 236, ${(specA * 0.3).toFixed(3)})`);
  s.addColorStop(1, "rgba(120, 240, 236, 0)");
  ctx.fillStyle = s;
  ctx.fillRect(bx, by, bw, bh);
  ctx.restore();

  // --- 2. Dome grid: concentric parallels + radial meridians, all bowed over
  //        the surface — the curved lines that sell the perspective. ---
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const gridA = 0.10 + 0.05 * Math.sin(now / 800) + bright * 0.18;
  ctx.fillStyle = `rgba(${c.glowRGB}, ${Math.max(0, gridA).toFixed(3)})`;
  domeRing(ctx, 0.5, scale);                          // one inner parallel
  for (let i = 0; i < CONFIG.runeCount; i++) {
    const s = slotUV(i);
    domeSeg(ctx, s.u * 0.16, s.v * 0.16, s.u * R.bandInner, s.v * R.bandInner, scale);
  }
  ctx.restore();

  // --- 3. Faint chord web (hexagon edges + hexagram), curved over the dome,
  //        mirroring the filigree pulse on the big circle below. ---
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let a = 0; a < CONFIG.runeCount; a++) {
    for (const step of [1, 2]) {
      const b = (a + step) % CONFIG.runeCount;
      const ga = 0.045 + 0.035 * Math.sin(now / 700 + (a * 2 + step) * 1.3);
      ctx.fillStyle = `rgba(${c.glowRGB}, ${Math.max(0, ga).toFixed(3)})`;
      const s1 = slotUV(a), s2 = slotUV(b);
      domeSeg(ctx, s1.u, s1.v, s2.u, s2.v, scale);
    }
  }
  ctx.restore();

  // --- 4. The outer band: a faint filled ring straddling the node circle, where
  //        the crystals sit; kept translucent so only its edge rings read hard. ---
  ctx.fillStyle = `rgba(${c.discRGB}, ${(0.07 + bright * 0.16 + 0.02 * Math.sin(now / 900)).toFixed(3)})`;
  ctx.beginPath();                                  // outer edge, then inner hole
  const bseg = 46;
  for (let i = 0; i <= bseg; i++) {
    const a = (i / bseg) * Math.PI * 2;
    const p = domeProject(R.bandOuter * Math.cos(a), R.bandOuter * Math.sin(a), scale);
    i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
  }
  for (let i = bseg; i >= 0; i--) {
    const a = (i / bseg) * Math.PI * 2;
    const p = domeProject(R.bandInner * Math.cos(a), R.bandInner * Math.sin(a), scale);
    ctx.lineTo(p.x, p.y);
  }
  ctx.fill("evenodd");
  // bright rim edges on the band
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = `rgba(${c.glowRGB}, ${(0.28 + bright * 0.4).toFixed(3)})`;
  domeRing(ctx, R.bandOuter, scale);
  domeRing(ctx, R.bandInner, scale);
  ctx.restore();

  // --- 5. Crystal sockets seated in the band at the six slots, each sized to
  //        span the band width exactly (tangent to both edge rings). ---
  for (let i = 0; i < CONFIG.runeCount; i++) {
    const s = slotUV(i);
    drawRuneCrystal(ctx, s.u, s.v, R.socketR, scale, bright, c);
  }

  // --- 6. Center hub: a small ring + core at the apex ---
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = `rgba(${c.glowRGB}, ${(0.35 + bright * 0.4).toFixed(3)})`;
  domeRing(ctx, 0.16, scale, 16);
  ctx.fillStyle = `rgba(${c.discRGB}, ${(0.55 + bright * 0.4).toFixed(3)})`;
  ctx.fillRect(Math.round(apex.x), Math.round(apex.y), 1, 1);
  ctx.restore();

  // --- 7. The chords traced so far, bowed over the dome; burst white right
  //        after a match, then hold lit. ---
  if (chords) {
    for (const ch of chords) {
      const bursting = ch.addedAt && now - ch.addedAt < 320;
      const core = bursting || bright > 0.5 ? c.bright : c.line;
      domeChord(ctx, ch.x1, ch.y1, ch.x2, ch.y2, scale, core, c.glowRGB);
    }
  }
  ctx.restore();
}

// Smoothed gem position, persisted between frames so the tip eases toward its
// target instead of snapping — this is what makes the trace read as deliberate.
let staffTip = null;
// Smoothed 0..1 "raise" factor: 0 = resting beside the wizard, 1 = aiming at the disc.
let staffAct = null;

// Compose and draw the staff for the current frame. On standby it stands
// upright; while the player drags a pair the gem follows the forming line so
// the tip literally draws the stroke in the direction being dragged; during a
// cast it lifts into the rune disc, blazes, then jabs at the enemy on release.
function drawWizardStaff(ctx, now) {
  if (!scene) return;
  const spr = ASSETS && ASSETS.staff;
  if (!spr) return;
  const wiz = SHEET.wizardIdle;
  const sway = Math.sin(now / 620);
  const S = 0.64;             // fixed staff scale — never varies with reach
  const totalLen = spr.height * S;      // full staff length in scene px
  // Two aim anchors: the planted foot (grounded rest, beside the wizard) and the
  // hand at his waist (aiming — the butt tucks behind his body). We ease between
  // them so the gem can be pinned to the target and still always reach it.
  const foot = { x: scene.wizard.x + wiz.w, y: scene.wizard.y + wiz.h - 1 };
  const hand = { x: scene.wizard.x + wiz.w * 0.5, y: scene.wizard.y + 16 };
  const uprightTip = { x: foot.x + sway * 0.5, y: foot.y - totalLen };

  let target = uprightTip, glow = 0, thrust = 0, smooth = 0.25, formA = null, active = 0;

  if (state.castAt) {
    const t = now - state.castAt;
    const charge = CONFIG.castChargeMs, puff = CONFIG.runePuffMs;
    const ap = domeProject(0, 0, 1);        // the dome apex — the shield's lit centre
    const discTop = { x: ap.x, y: ap.y - 4 };
    active = 1;
    if (t < charge) {                       // charge: lift into the disc, wind up
      target = discTop; glow = 0.55 + 0.45 * (t / charge); smooth = 0.4;
    } else if (t < charge + puff) {         // release: jab toward the enemy
      const q = (t - charge) / puff;
      target = discTop; glow = 1 - q * 0.4; thrust = Math.sin(q * Math.PI); smooth = 0.6;
    } else {                                // recover: settle, gem fades
      target = discTop; glow = Math.max(0, 1 - (t - charge - puff) / 220); smooth = 0.45;
    }
  } else if (
    state.screen === "combat" && state.dragActive &&
    state.selectedRuneId !== null && state.dragPointer
  ) {
    // active trace: the gem rides the drawn line from the held rune toward the
    // pointer, so it traces the exact stroke in the direction the player draws
    const held = state.runes.find((r) => r.id === state.selectedRuneId);
    if (held) {
      formA = runePointXY(held.x, held.y);
      target = runePointXY(state.dragPointer.x, state.dragPointer.y);
      const drawn = Math.hypot(target.x - formA.x, target.y - formA.y);
      glow = 0.35 + Math.min(0.55, (drawn / 13) * 0.55);
      smooth = 0.2; // eased, so the gem trails the pointer for a deliberate trace
      active = 1;
    }
  } else if (state.screen === "combat" && state.selectedRuneId !== null) {
    // tap-tap mode: a rune is armed but there's no drag — point the staff at the
    // armed rune, gem lit, waiting for the second tap to complete the pair
    const held = state.runes.find((r) => r.id === state.selectedRuneId);
    if (held) {
      target = runePointXY(held.x, held.y);
      glow = 0.5;
      smooth = 0.22;
      active = 1;
    }
  } else if (now < state.tapTraceUntil && state.tapTraceFrom && state.tapTraceTo) {
    // tap-tap: the pair just resolved — trace the gem from the first rune to the
    // second, drawing the stroke, before it rests (or the spell releases)
    formA = runePointXY(state.tapTraceFrom.x, state.tapTraceFrom.y);
    target = runePointXY(state.tapTraceTo.x, state.tapTraceTo.y);
    glow = 0.6;
    smooth = 0.3;
    active = 1;
  }
  // else: standby / menus — staff rests grounded beside the wizard

  // lunge slides the gem toward the enemy on cast release
  if (thrust) target = { x: target.x + thrust * 7, y: target.y + thrust * 1 };

  if (!staffTip) staffTip = { x: uprightTip.x, y: uprightTip.y };
  staffTip.x += (target.x - staffTip.x) * smooth;
  staffTip.y += (target.y - staffTip.y) * smooth;
  if (staffAct === null) staffAct = active;
  staffAct += (active - staffAct) * 0.14;        // eased raise/lower

  // The gem is pinned to the (smoothed) target, so it always reaches. The aim
  // anchor eases foot→hand as the staff raises; the butt is one staff-length
  // back from the gem along that aim, so at rest it lands on the foot (grounded)
  // and while aiming it lands behind the waist (hidden by the body, drawn behind).
  const gemx = staffTip.x, gemy = staffTip.y;
  const anchorx = foot.x + (hand.x - foot.x) * staffAct;
  const anchory = foot.y + (hand.y - foot.y) * staffAct;
  let dx = gemx - anchorx, dy = gemy - anchory;
  const d = Math.hypot(dx, dy) || 1;
  const aimx = dx / d, aimy = dy / d;
  const ang = Math.atan2(aimy, aimx);
  const buttx = gemx - aimx * totalLen, butty = gemy - aimy * totalLen;

  // the stroke being drawn runs from the anchor node to the gem
  if (formA) {
    const c = CONFIG.colors.sceneRune;
    pixLineGlow(ctx, Math.round(formA.x), Math.round(formA.y), Math.round(gemx), Math.round(gemy), c.line, c.glowRGB);
  }

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(buttx, butty);                   // pivot at the butt, one staff-length behind the gem
  ctx.rotate(ang + Math.PI / 2);                 // sprite points up (-y); swing its gem onto the aim
  ctx.scale(S, S);
  ctx.drawImage(spr, -Math.round(spr.width / 2), -spr.height);
  ctx.restore();
  // the gem blazes with an additive teal halo while tracing/casting
  drawGemGlow(ctx, now, Math.round(gemx), Math.round(gemy), glow);
}

// An additive teal halo on the staff's gem at (tx,ty); strength tracks `glow`
// in [0,1], with a flicked spark while it blazes. The gem body itself comes
// from the sprite — this only lights it up.
function drawGemGlow(ctx, now, tx, ty, glow) {
  if (glow <= 0.05) return;
  const rgb = CONFIG.colors.staff.glowRGB;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const halo = 0.18 + 0.55 * glow;
  for (const [ox, oy, a] of [[0, 0, 1], [1, 0, 0.6], [-1, 0, 0.6], [0, 1, 0.6], [0, -1, 0.6],
                             [2, 0, 0.3], [-2, 0, 0.3], [0, 2, 0.3], [0, -2, 0.3]]) {
    ctx.fillStyle = `rgba(${rgb}, ${(halo * a).toFixed(3)})`;
    ctx.fillRect(tx + ox, ty + oy, 1, 1);
  }
  if (glow > 0.6) {
    const sp = (Math.floor(now / 90) * 2654435761) >>> 0;
    const ax = (sp % 5) - 2, ay = ((sp >> 3) % 5) - 2;
    ctx.fillStyle = `rgba(${rgb}, ${(0.5 * glow).toFixed(3)})`;
    ctx.fillRect(tx + ax, ty + ay, 1, 1);
  }
  ctx.restore();
}

window.Incanto.renderScene = { setupScene, renderScene };
