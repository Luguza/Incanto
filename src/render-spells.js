"use strict";
// ==============================================================================
// render-spells.js — what a cast LOOKS like on the combat canvas. Owns:
// renderSpellFx, drawFrostRime, and the per-kind effect painters.
//
// The rules half of a spell is spells.js: a resolver decides who takes what and
// queues a plain-data descriptor onto `state.spellFx`. This file only draws
// those descriptors and drops them once they expire — it never touches HP,
// never picks targets, and never reads the skill tree.
//
// Every descriptor carries `born` (when it starts) and `until` (when it's
// culled); the targeted kinds also carry `landAt`, the moment the hit connects,
// which is the same instant the damage number pops.
// ==============================================================================

// A queued effect's live anchor: bolts and arcs track the body they were aimed
// at so they follow it as it marches, and fall back to the point captured when
// the spell went off once that body is gone.
function fxPoint(stored, targetId) {
  if (targetId != null && scene) {
    const e = state.enemies.find((en) => en.id === targetId);
    if (e) {
      const art = enemyArt(e);
      return {
        x: Math.round(scene.enemyLineX + e.pos * TILE),
        y: (scene.laneY[e.lane] ?? scene.feetY) - art.h + art.chest,
      };
    }
  }
  return stored;
}

// Where a spell leaves the hero: the lit apex of the rune shield he casts
// through, so every spell launches from the same place the fireball always did.
function castOrigin() {
  return domeProject(0, 0, 1);
}

// A jagged bolt between two points: the segment is broken into steps that jitter
// off the straight line, so an arc reads as electricity rather than a ruler.
// `seed` keeps one arc's shape stable across the frames it's drawn for, and
// `spread` is how far it may wander in scene pixels.
function boltPath(x0, y0, x1, y1, seed, spread, steps = 7) {
  const pts = [{ x: x0, y: y0 }];
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;         // perpendicular to the run
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    // Wander most in the middle and pin both ends, so the arc still starts at
    // the staff and finishes on the body it hit.
    const taper = Math.sin(t * Math.PI);
    const h = ((tileHash(seed, i) % 200) / 100 - 1) * spread * taper;
    pts.push({ x: x0 + dx * t + nx * h, y: y0 + dy * t + ny * h });
  }
  pts.push({ x: x1, y: y1 });
  return pts;
}

function drawBoltPath(ctx, pts, core, glowRGB) {
  for (let i = 1; i < pts.length; i++) {
    pixLineGlow(ctx, Math.round(pts[i - 1].x), Math.round(pts[i - 1].y),
      Math.round(pts[i].x), Math.round(pts[i].y), core, glowRGB);
  }
}

// ---------------------------------------------------------------------------
// The painters — one per descriptor kind. Each is handed the descriptor, the
// frame time, and `p`, its own 0→1 progress across born→until.
// ---------------------------------------------------------------------------
const SPELL_FX = {
  // Feuerball: the existing bolt — a glowing mote flying from the shield to a
  // skeleton's chest on a shallow arc, then a four-spoke crack on impact.
  bolt(ctx, f, now) {
    const c = CONFIG.colors.spell[f.spell] || CONFIG.colors.spell.fireball;
    const to = fxPoint(f.to, f.targetId);
    const flight = f.landAt - f.born;
    if (now < f.landAt) {
      const q = flight > 0 ? (now - f.born) / flight : 1;
      const from = castOrigin();
      const x = Math.round(from.x + (to.x - from.x) * q);
      const y = Math.round(from.y + (to.y - from.y) * q - Math.sin(q * Math.PI) * 10);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(ASSETS.glowFireball, x - 9, y - 9);
      ctx.restore();
      ctx.drawImage(ASSETS.fireball, x - 5, y - 3);
      return;
    }
    const q = Math.min(1, (now - f.landAt) / Math.max(1, f.until - f.landAt));
    const r = Math.round(2 + q * 10);
    ctx.fillStyle = c.mid;
    ctx.fillRect(to.x - r, to.y, 2, 1);
    ctx.fillRect(to.x + r, to.y, 2, 1);
    ctx.fillRect(to.x, to.y - r, 1, 2);
    ctx.fillRect(to.x, to.y + r, 1, 2);
    ctx.fillStyle = c.core;
    ctx.fillRect(to.x - r + 1, to.y - r + 1, 1, 1);
    ctx.fillRect(to.x + r - 1, to.y - r + 1, 1, 1);
    ctx.fillRect(to.x - r + 1, to.y + r - 1, 1, 1);
    ctx.fillRect(to.x + r - 1, to.y + r - 1, 1, 1);
  },

  // Blitzschlag: an arc drawn hop by hop as the chain travels, then the whole
  // chain held lit for a beat while it fades. Each hop re-jitters every couple
  // of frames so the arc crackles instead of sitting still.
  chain(ctx, f, now) {
    const c = CONFIG.colors.spell.lightning;
    const reached = Math.min(f.points.length, Math.floor((now - f.born) / f.hopMs) + 1);
    if (reached <= 0) return;
    const fade = Math.max(0, Math.min(1, (f.until - now) / 220));
    const flick = Math.floor(now / 55);
    ctx.save();
    ctx.globalAlpha = fade;
    let prev = castOrigin();
    for (let i = 0; i < reached; i++) {
      const to = fxPoint(f.points[i].at, f.points[i].targetId);
      // Later hops wander further — the arc frays as it loses its grip.
      drawBoltPath(ctx, boltPath(prev.x, prev.y, to.x, to.y, flick + i * 31, 4 + i, 7),
        c.core, c.rgb);
      prev = to;
    }
    // A hot spark on each body the chain has already touched.
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < reached; i++) {
      const to = fxPoint(f.points[i].at, f.points[i].targetId);
      ctx.fillStyle = `rgba(${c.rgb}, 0.75)`;
      ctx.fillRect(to.x - 2, to.y - 2, 4, 4);
    }
    ctx.restore();
  },

  // Frostkegel: a wedge of rime sweeping out from the staff over the whole
  // floor, shards riding out along it, then fading back.
  cone(ctx, f, now) {
    if (!scene) return;
    const c = CONFIG.colors.spell.frost;
    const p = Math.max(0, Math.min(1, (now - f.born) / Math.max(1, f.until - f.born)));
    const sweep = Math.min(1, p / 0.45);                 // reaches full length at the landing
    const fade = p < 0.45 ? 1 : 1 - (p - 0.45) / 0.55;
    const from = castOrigin();
    const reach = f.reach * TILE * sweep;
    const lanes = scene.laneY;
    const top = lanes[0] - 14, bottom = lanes[lanes.length - 1] + 2;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // The wedge itself: narrow at the staff, opening across every lane.
    const g = ctx.createLinearGradient(from.x, 0, from.x + reach, 0);
    g.addColorStop(0, `rgba(${c.rgb}, ${(0.42 * fade).toFixed(3)})`);
    g.addColorStop(1, `rgba(${c.rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y - 3);
    ctx.lineTo(from.x + reach, top);
    ctx.lineTo(from.x + reach, bottom);
    ctx.lineTo(from.x, from.y + 3);
    ctx.closePath();
    ctx.fill();
    // Shards streaking out along the wedge.
    for (let i = 0; i < 22; i++) {
      const t = ((tileHash(i, 71) % 100) / 100 + p * 1.4) % 1;
      const sx = from.x + reach * t;
      const sy = from.y + (top + (bottom - top) * ((tileHash(i, 17) % 100) / 100) - from.y) * t;
      const len = 3 + (tileHash(i, 5) % 4);
      ctx.fillStyle = `rgba(${c.rgb}, ${(fade * (1 - t) * 0.9).toFixed(3)})`;
      ctx.fillRect(Math.round(sx), Math.round(sy), len, 1);
    }
    ctx.restore();
  },

  // Meteoritenschauer: a rock streaking down from above the wall, then a
  // low crater flash on the floor where it lands.
  meteor(ctx, f, now) {
    if (!scene) return;
    const c = CONFIG.colors.spell.meteor;
    const x = Math.round(scene.enemyLineX + f.pos * TILE);
    const groundY = scene.laneY[Math.min(f.lane, scene.laneY.length - 1)] ?? scene.feetY;
    if (now < f.landAt) {
      const q = (now - f.born) / Math.max(1, f.landAt - f.born);
      // Falls steeply from off the top of the frame, trailing embers.
      const y = Math.round(-10 + (groundY + 10) * q);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(ASSETS.glowFireball, x - 9, y - 9);
      // Trail: embers strung back up the rock's path, thinning as they cool.
      for (let i = 1; i < 7; i++) {
        ctx.fillStyle = `rgba(${c.rgb}, ${(0.62 - i * 0.09).toFixed(2)})`;
        ctx.fillRect(x - 1 - i, y - i * 4, i < 3 ? 3 : 2, i < 3 ? 3 : 2);
      }
      ctx.restore();
      ctx.fillStyle = c.mid;
      ctx.fillRect(x - 2, y - 2, 5, 5);
      ctx.fillStyle = c.core;
      ctx.fillRect(x - 1, y - 1, 3, 3);
      return;
    }
    const q = Math.min(1, (now - f.landAt) / Math.max(1, f.until - f.landAt));
    const r = Math.round(3 + q * CONFIG.spells.meteor.radiusTiles * TILE);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // A flattened ring, so the blast reads as spreading along the floor rather
    // than as a ball hanging in the air.
    ctx.strokeStyle = `rgba(${c.rgb}, ${((1 - q) * 0.85).toFixed(2)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, groundY - 2, r, Math.max(1, r * 0.42), 0, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const d = q * r;
      ctx.fillStyle = `rgba(${c.rgb}, ${((1 - q) * 0.9).toFixed(2)})`;
      ctx.fillRect(Math.round(x + Math.cos(a) * d), Math.round(groundY - 2 + Math.sin(a) * d * 0.42), 2, 2);
    }
    ctx.restore();
  },

  // Bannschild / Heilwort: a ring that blooms around the hero. Both support
  // spells share the shape and differ only in colour and direction — the shield
  // closes inward onto him, the heal rises off him.
  aura(ctx, f, now) {
    if (!scene) return;
    const c = CONFIG.colors.spell[f.spell];
    const p = Math.max(0, Math.min(1, (now - f.born) / Math.max(1, f.until - f.born)));
    const wiz = SHEET.wizardIdle;
    const hx = scene.wizard.x + wiz.w / 2;
    const hy = scene.wizard.y + wiz.h / 2;
    const inward = f.spell === "shield";
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const [off, w] of [[0, 2], [-0.25, 1]]) {
      const b = p + off;
      if (b <= 0 || b >= 1) continue;
      const rr = inward ? 30 * (1 - b) + 8 : 6 + b * 26;
      ctx.strokeStyle = `rgba(${c.rgb}, ${((1 - b) * 0.85).toFixed(2)})`;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.ellipse(hx, hy, rr, rr * 1.15, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Motes: they settle onto the hero for a shield, lift off him for a heal.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + p * 1.1;
      const d = inward ? 26 * (1 - p) : 8 + p * 20;
      const lift = inward ? 0 : -p * 12;
      ctx.fillStyle = `rgba(${c.rgb}, ${((1 - p) * 0.9).toFixed(2)})`;
      ctx.fillRect(Math.round(hx + Math.cos(a) * d), Math.round(hy + Math.sin(a) * d * 0.9 + lift), 2, 2);
    }
    ctx.restore();
  },
};

// Draw every live effect, then drop the expired ones. Called from renderScene
// after the fighters so effects sit over the bodies they're hitting.
function renderSpellFx(ctx, now) {
  const fx = state.spellFx;
  if (!scene || !fx || !fx.length) return;
  const keep = [];
  for (const f of fx) {
    if (now >= f.until) continue;          // expired — drop it
    keep.push(f);
    if (now < f.born) continue;            // queued, not started yet
    const paint = SPELL_FX[f.kind];
    if (paint) paint(ctx, f, now);
  }
  state.spellFx = keep;
}

// Rime on a frozen skeleton: the frost-washed copy of the bones laid over the
// live frame, plus a few ice crystals clinging to it. Using the tinted sprite
// rather than a filled rect is what keeps the ice on the BODY — a rect would
// freeze the sprite's transparent corners too and read as a square block.
// Drawn by renderScene right after the body it belongs to; it fades over the
// last beat so a thaw is visible coming rather than snapping off.
function drawFrostRime(ctx, now, e, frame, sx, sy, w, h) {
  const c = CONFIG.colors.spell.frost;
  const a = Math.min(1, Math.max(0, (e.frozenUntil - now) / 400));
  const rime = ASSETS.skeletFrozen;
  ctx.save();
  ctx.globalAlpha *= a;
  if (rime) ctx.drawImage(rime[frame % rime.length], sx, sy, w, h);
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = `rgba(${c.rgb}, 0.9)`;
  // Crystals clinging to the body — placed off the enemy's own id so one
  // skeleton's ice doesn't shimmer around between frames.
  for (let i = 0; i < 4; i++) {
    const px = sx + 2 + (tileHash(e.id, i) % Math.max(1, w - 4));
    const py = sy + 3 + (tileHash(e.id, i + 9) % Math.max(1, h - 6));
    ctx.fillRect(px, py, 1, 2);
    ctx.fillRect(px - 1, py + 1, 3, 1);
  }
  ctx.restore();
}

window.Incanto.renderSpells = { renderSpellFx, drawFrostRime };
