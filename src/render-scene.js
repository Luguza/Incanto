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
  cv.width = artW;
  cv.height = SCENE_H;
  cv.style.width = `${(artW * px) / dpr}px`;
  cv.style.height = `${(SCENE_H * px) / dpr}px`;

  const margin = Math.max(10, Math.round(artW * 0.08));
  const wiz = SHEET.wizardIdle;
  const skl = SHEET.skeletIdle;
  // Fighters stand in the middle of the floor, not right up against the wall
  const feetY = FLOOR_Y + Math.round((SCENE_H - FLOOR_Y) * 0.66);
  const wizard = { x: margin, y: feetY - wiz.h };
  const skelet = { x: artW - margin - skl.w, y: feetY - skl.h };
  scene = {
    cv,
    artW,
    wizard,
    skelet,
    fountains: [Math.round(artW * 0.32 / TILE) * TILE, Math.round(artW * 0.68 / TILE) * TILE],
    // The traced rune is a "magic shield" — a shallow convex lens conjured
    // upright at arm's reach in front of the wizard, facing the enemy. It stands
    // nearly round (a hair wider than tall) so it reads as hovering face-on, not
    // lying flat; domeProject() bulges its grid toward the viewer for the lens's
    // convex 3D read. rx/ry size the node ring; the crystal band + glass reach a
    // little past it.
    rune: { cx: wizard.x + wiz.w + 13, cy: wizard.y + 10, rx: 13, ry: 11 },
    skelChest: { x: skelet.x + skl.w / 2, y: skelet.y + 9 },
    bg: null,
  };
  scene.bg = buildBg(artW);
  return true;
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

  // Columns near the edges: capital on top, shaft down the full wall, and the
  // base tile planted on the first floor row so the pillar stands on the floor
  // with its bottom tile aligned to the wall→floor transition.
  for (const cx of [TILE, (cols - 2) * TILE]) {
    blit(SHEET.wallColumnTop, cx, 0);
    for (let y = TILE; y < FLOOR_Y; y += TILE) blit(SHEET.wallColumnMid, cx, y);
    blit(SHEET.wallColumnBase, cx, FLOOR_Y);
  }

  // Banners hang from just below the top cap
  blit(SHEET.bannerRed, Math.round(artW * 0.46 / TILE) * TILE, TILE);
  blit(SHEET.bannerGreen, Math.round(artW * 0.54 / TILE) * TILE, TILE);

  // Fountains are a 3-tile stack anchored to the floor line: spout, streaming
  // mid, and basin. The spout sits two rows above the floor so the mid tile
  // always has room (the stream + basin are animated in renderScene).
  for (const fx of scene.fountains) {
    blit(SHEET.fountainTop, fx, FLOOR_Y - 2 * TILE);
  }

  // Floor prop: a skull near the skeleton (the wizard's side stays clear —
  // the traced rune floats there)
  const feetY = FLOOR_Y + Math.round((SCENE_H - FLOOR_Y) * 0.66);
  blit(SHEET.skull, scene.skelet.x - 16, feetY - 12);
  ctx.drawImage(ASSETS.shadow, scene.skelet.x - 16 + 8 - 9, feetY - 2); // skull shadow

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
  const vl = ctx.createLinearGradient(0, 0, 16, 0);
  vl.addColorStop(0, "rgba(6, 4, 10, 0.55)"); vl.addColorStop(1, "rgba(6, 4, 10, 0)");
  band(vl, 0, 0, 16, SCENE_H);
  const vr = ctx.createLinearGradient(artW - 16, 0, artW, 0);
  vr.addColorStop(0, "rgba(6, 4, 10, 0)"); vr.addColorStop(1, "rgba(6, 4, 10, 0.55)");
  band(vr, artW - 16, 0, 16, SCENE_H);

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
  ctx.drawImage(scene.bg, 0, 0);

  const feetY = FLOOR_Y + Math.round((SCENE_H - FLOOR_Y) * 0.66);
  const fountainBasinY = FLOOR_Y;   // basin on the first floor row

  // Lava fountains: 3-frame animation, stream + basin. Drawn BEFORE the warm
  // light pools so the light washes over the fountain itself, not only the
  // tiles around it (otherwise the opaque basin sprite leaves a dark core).
  scene.fountains.forEach((fx, i) => {
    const fi = (Math.floor(now / 160) + i) % ASSETS.fountainMid.length;
    // Streaming mid tiles fill the gap between the spout and the basin.
    for (let y = FLOOR_Y - TILE; y > FLOOR_Y - 2 * TILE; y -= TILE) ctx.drawImage(ASSETS.fountainMid[fi], fx, y);
    ctx.drawImage(ASSETS.fountainBasin[fi], fx, fountainBasinY);
  });

  // Light pools (additive): each fountain spills warm light over itself and the
  // surrounding floor/wall, with a hot core right on the basin; the rune throws
  // cool light near the wizard. Gently flickering.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  scene.fountains.forEach((fx, i) => {
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(now / 130 + i * 2.1);
    ctx.drawImage(ASSETS.poolWarm, fx + 8 - 34, fountainBasinY - 34);
    ctx.globalAlpha = 0.6 + 0.3 * Math.sin(now / 110 + i * 2.1);
    ctx.drawImage(ASSETS.glowFountain, fx + 8 - 15, fountainBasinY + 4 - 15);
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

  ctx.save();
  ctx.translate(Math.round(hkx), Math.round(hky));
  // The staff is drawn BEHIND the wizard so the shaft is occluded by his body
  // and only the gem end pokes out. At rest it stands upright; while
  // tracing/casting the gem rides out to the rune disc, then jabs on launch.
  drawWizardStaff(ctx, now);

  ctx.drawImage(ASSETS.wizard[wf], scene.wizard.x, scene.wizard.y);
  ctx.restore();

  // Skeleton: walks in from the right on a new wave, fades out on death
  let exOff = 0, eAlpha = 1;
  if (state.enemyPhase === "enter") {
    const p = Math.min(1, (now - state.enemyPhaseAt) / CONFIG.enemyEnterMs);
    const eased = 1 - Math.pow(1 - p, 3);
    exOff = Math.round((1 - eased) * (scene.artW + 24 - scene.skelet.x));
  } else if (state.enemyPhase === "dying") {
    const p = Math.min(1, (now - state.enemyPhaseAt) / CONFIG.enemyDeathMs);
    eAlpha = 1 - p;
    exOff = Math.round(p * 8);
    // dissolving embers rise as it collapses
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 7; i++) {
      const h = (i * 97) % 13;
      const ex = scene.skelet.x + 3 + ((i * 5) % SHEET.skeletIdle.w);
      const ey = scene.skelet.y + SHEET.skeletIdle.h - Math.round(p * (10 + h));
      ctx.fillStyle = `rgba(77, 227, 224, ${(eAlpha * 0.8).toFixed(2)})`;
      ctx.fillRect(ex, ey, 1, 1);
    }
    ctx.restore();
  }
  ctx.save();
  ctx.globalAlpha = eAlpha;
  ctx.drawImage(ASSETS.shadowSm, scene.skelet.x + exOff + SHEET.skeletIdle.w / 2 - 8, feetY - 2);
  ctx.drawImage(ASSETS.skelet[sf], scene.skelet.x + exOff, scene.skelet.y);
  ctx.restore();

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
    const chest = scene.skelChest;

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
      if (Math.floor((t - charge - flight) / 70) % 2 === 0) {
        ctx.drawImage(ASSETS.skeletHit[sf], scene.skelet.x, scene.skelet.y);
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
      const p = domeProject(RUNE3D.bandOuter * Math.cos(a), RUNE3D.bandOuter * Math.sin(a), 1);
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

// --- 3D rune-shield projection ----------------------------------------------
// The scene rune is etched on a shallow spherical cap ("magic shield") that
// bulges toward the viewer. RUNE3D turns the cap slightly toward the enemy and
// tilts it so we look down onto it; the band straddles the node ring so the
// crystals sit in a filled ring, like the sockets on the big arena wheel.
const RUNE3D = (() => {
  const turn = 0.26, tilt = 0.34, bulge = 0.66;
  return {
    turn, tilt, bulge,
    cosT: Math.cos(turn), sinT: Math.sin(turn),
    cosB: Math.cos(tilt), sinB: Math.sin(tilt),
    bandInner: 0.80, bandOuter: 1.15, // node ring is rr = 1
  };
})();

// Lift a point on the flat rune disc (unit coords u,v; the rim is |(u,v)| = 1)
// onto the sphere cap and project it to screen. Straight lines on the flat disc
// come out curved, bowing over the dome — the whole 3D cue. Points past the rim
// (rr > 1) stay flat, forming the shield's raised lip.
function domeProject(u, v, scale = 1) {
  const { cx, cy, rx, ry } = scene.rune;
  const rr = Math.hypot(u, v);
  const z = rr < 1 ? RUNE3D.bulge * Math.sqrt(1 - rr * rr) : 0; // height toward viewer
  const y = -v;                                  // flip to math-up
  const x1 = u * RUNE3D.cosT + z * RUNE3D.sinT;  // turn about the vertical axis
  const z1 = -u * RUNE3D.sinT + z * RUNE3D.cosT;
  const y2 = y * RUNE3D.cosB + z1 * RUNE3D.sinB; // tilt: the bulge lifts toward us
  return { x: cx + x1 * rx * scale, y: cy - y2 * ry * scale };
}

// Map a big-arena point onto the disc, proportionally (radius kept, not just
// angle) then curved over the dome, so a stroke drawn across the circle below
// mirrors faithfully on the shield. Radius is clamped so a pointer flung past
// the rim stays on the staff's reach.
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

// A single rune crystal seated in the band: a dark socket well, a glowing gem,
// and a crisp core. `bright` (0..1) is the cast/charge brightening.
function drawRuneCrystal(ctx, x, y, bright, c) {
  ctx.save();
  ctx.fillStyle = "rgba(4, 16, 16, 0.5)";           // socket well
  ctx.beginPath();
  ctx.ellipse(x, y, 2.4, 3.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "lighter";          // glowing gem body
  ctx.fillStyle = `rgba(${c.glowRGB}, ${(0.5 + bright * 0.45).toFixed(3)})`;
  ctx.beginPath();
  ctx.moveTo(x, y - 2.7); ctx.lineTo(x + 1.7, y); ctx.lineTo(x, y + 2.7); ctx.lineTo(x - 1.7, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = c.dot;                             // crisp core
  ctx.fillRect(x, y - 1, 1, 2);
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
  const R = RUNE3D;
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
  ctx.globalAlpha = alpha;

  // --- 1. Glass shield backing: fill the dome silhouette with a radial wash
  //        brightest at the apex, so the surface reads as bulging toward us. ---
  const discNow = Math.max(disc, 0.06 + 0.04 * Math.sin(now / 900));
  const rad = Math.max(rx, ry) * scale * R.bandOuter;
  const g = ctx.createRadialGradient(apex.x, apex.y, 0, apex.x, apex.y, rad);
  g.addColorStop(0, `rgba(${c.discRGB}, ${(discNow + 0.10).toFixed(3)})`);
  g.addColorStop(0.6, `rgba(${c.discRGB}, ${(discNow * 0.7).toFixed(3)})`);
  g.addColorStop(1, `rgba(${c.discRGB}, ${(discNow * 0.15).toFixed(3)})`);
  silhouette(R.bandOuter);
  ctx.fillStyle = g;
  ctx.fill();

  // --- 2. Dome grid: concentric parallels + radial meridians, all bowed over
  //        the surface — the curved lines that sell the perspective. ---
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const gridA = 0.10 + 0.05 * Math.sin(now / 800) + bright * 0.18;
  ctx.fillStyle = `rgba(${c.glowRGB}, ${Math.max(0, gridA).toFixed(3)})`;
  for (const rr of [0.34, 0.58, 0.80]) domeRing(ctx, rr, scale);
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

  // --- 4. The outer band: a filled ring straddling the node circle, where the
  //        crystals sit (the filled band from the big arena wheel). ---
  ctx.fillStyle = `rgba(${c.discRGB}, ${(0.16 + bright * 0.20 + 0.03 * Math.sin(now / 900)).toFixed(3)})`;
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

  // --- 5. Crystals seated in the band at the six slots ---
  for (let i = 0; i < CONFIG.runeCount; i++) {
    const s = slotUV(i);
    const p = domeProject(s.u, s.v, scale);
    drawRuneCrystal(ctx, Math.round(p.x), Math.round(p.y), bright, c);
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
