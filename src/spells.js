"use strict";
// ==============================================================================
// spells.js — the spell book's contents. Owns: SPELLS (the registry, in page
// order), SPELL_BY_ID, spell unlock/selection helpers, spellPower, and the
// per-spell resolvers that a completed rune shape dispatches into.
//
// This file is the RULES half of a spell. The other two halves live next door:
// what it looks like on the canvas is render-spells.js, and what its page looks
// like is spellbook.js. A resolver never draws — it mutates the fight and
// queues an effect descriptor onto `state.spellFx`, which render-spells reads.
// ==============================================================================

// The book, in page order. Two pages face each other per spread, so the pairs
// here are deliberate: offense, control, then the two support spells.
//
// `dmgKey` / `paramKey` name the skill-tree stats that lift this page
// specifically, and `sector` is the key of the tree arm that carries them (see
// skilltree.js — every spell owns one of the twelve arms, and the unique node
// at that arm's ring 5 is what opens the page).
// `unlock` is null for the one spell the hero starts with; every other page is
// sealed until its unique unlock node is bought.
const SPELLS = [
  {
    id: "fireball", name: "Feuerball", theme: "fireball", sector: "fir", kind: "damage",
    dmgKey: "dmgFireball", paramKey: "aoeFireball", unlock: null,
    blurb: "Eine Kugel aus Flammen, die dort zerbirst, wo die Horde am dichtesten steht — alles im Umkreis nimmt die volle Wucht, ohne Abschwächung.",
  },
  {
    id: "lightning", name: "Blitzschlag", theme: "lightning", sector: "lig", kind: "damage",
    dmgKey: "dmgLightning", paramKey: "chainLightning", unlock: "lightning",
    blurb: "Ein Bogen, der von Körper zu Körper springt. Jeder Sprung trägt weniger Kraft als der vorige.",
  },
  {
    id: "frost", name: "Frostkegel", theme: "frost", sector: "fro", kind: "control",
    dmgKey: "dmgFrost", paramKey: "freezeFrost", unlock: "frost",
    blurb: "Ein Kegel aus Eis stößt die vorderste Reihe zurück und friert sie fest. Dein nächster Zauber zerschmettert sie.",
  },
  {
    id: "meteor", name: "Meteoritenschauer", theme: "meteor", sector: "met", kind: "damage",
    dmgKey: "dmgMeteor", paramKey: "countMeteor", unlock: "meteor",
    blurb: "Brocken stürzen auf zufällige Stellen des ganzen Ganges — verheerend gegen eine weit verteilte Horde.",
  },
  {
    id: "shield", name: "Bannschild", theme: "shield", sector: "shi", kind: "support",
    dmgKey: "dmgShield", paramKey: null, unlock: "shield",
    blurb: "Wandelt deine Zauberkraft in einen Schild, der die nächsten Schläge schluckt.",
  },
  {
    id: "heal", name: "Heilwort", theme: "heal", sector: "hea", kind: "support",
    dmgKey: "dmgHeal", paramKey: null, unlock: "heal",
    blurb: "Wandelt deine Zauberkraft in Lebenspunkte zurück.",
  },
];

const SPELL_BY_ID = Object.fromEntries(SPELLS.map((s) => [s.id, s]));
const STARTER_SPELL = "fireball";

// ---------------------------------------------------------------------------
// Page order — SPELLS above is the AUTHORED order the book ships in; where each
// spell actually sits is the player's, rebound on the order screen (see
// book-order.js) and kept in `state.spellOrder` as a permutation of the ids.
//
// Everything that draws or leafs through the book reads `bookSpells()` rather
// than SPELLS, so a page moves as a whole — its art, its seal, its ribbon. What
// does NOT move with it is the page's script and great rune: those are seeded
// from the spell's index in SPELLS (see spellPage), so a spell's leaf reads the
// same wherever in the book it is bound.
// ---------------------------------------------------------------------------
// Repair anything a save (or a hand-edited order) can hand back: unknown ids and
// duplicates are dropped, and any spell the list forgot is appended in its
// authored place. The result is always a full permutation, so the book can never
// come up a page short.
function normalizeSpellOrder(list) {
  const out = [];
  if (Array.isArray(list)) {
    for (const id of list) if (SPELL_BY_ID[id] && !out.includes(id)) out.push(id);
  }
  for (const s of SPELLS) if (!out.includes(s.id)) out.push(s.id);
  return out;
}

function bookOrder() { return normalizeSpellOrder(state && state.spellOrder); }
function bookSpells() { return bookOrder().map((id) => SPELL_BY_ID[id]); }

// Which page slot a spell is bound to (0 = the first recto of the first spread).
function bookSlot(id) { return bookOrder().indexOf(id); }

// Trade two pages. The book stays open on the page it is CAST from rather than
// on the slot the finger let go over — moving a page must never quietly change
// which spell a completed shape fires.
function swapBookPages(a, b) {
  const order = bookOrder();
  const inRange = (i) => Number.isInteger(i) && i >= 0 && i < order.length;
  if (!inRange(a) || !inRange(b) || a === b) return false;
  const tmp = order[a];
  order[a] = order[b];
  order[b] = tmp;
  state.spellOrder = order;
  const idx = order.indexOf(activeSpellId());
  if (idx >= 0) state.bookSpread = Math.floor(idx / 2);
  saveProgress();
  state._structuralDirty = true;
  return true;
}

// ---------------------------------------------------------------------------
// Unlock + selection
// ---------------------------------------------------------------------------
function spellUnlocked(id) {
  const spell = SPELL_BY_ID[id];
  if (!spell) return false;
  if (!spell.unlock) return true;                       // the starter is always known
  return !!(state.mods.spellsUnlocked && state.mods.spellsUnlocked[id]);
}

// The spell a completed shape will actually cast. Falls back to the starter if
// the saved page points at something no longer unlocked (a wiped tree, a save
// carried over from before that node existed) — so a cast never no-ops.
function activeSpellId() {
  const id = state.activeSpell;
  return spellUnlocked(id) ? id : STARTER_SPELL;
}
function activeSpell() { return SPELL_BY_ID[activeSpellId()]; }

// Turn the book to a page (routed from the book's page buttons). Sealed pages
// can be read but not cast from, so tapping one is a no-op rather than a swap.
function spellSelect(id) {
  if (!SPELL_BY_ID[id] || !spellUnlocked(id)) return;
  // A drag that turned a page fires a click too. Ignore it, or leafing through
  // the book would also re-arm whichever spell the release landed on.
  if (typeof bookDragUntil !== "undefined" && performance.now() < bookDragUntil) return;
  state.activeSpell = id;
  saveProgress();
  state._structuralDirty = true;
}

// ---------------------------------------------------------------------------
// Spell power — every spell reads the same hero damage and scales it by its own
// multiplier plus its own page's % nodes, so a generic damage node lifts the
// whole book and a spell node lifts one page.
//
// Then, LAST of all, the flat stage is added (see skilltree.js — the three
// stages of damage). It goes on after the page's factor and after its sigils,
// which is what makes "+5 Schaden je Treffer" mean exactly five more damage on
// every body this spell touches — on the ×1.00 Feuerball and on the ×0.35
// Frostkegel alike, rather than five multiplied down to under two.
//
// Support pages are excluded: a damage node has no business inflating a heal or
// a ward, and Heilwort deriving its pool from spell power is why it would.
// ---------------------------------------------------------------------------
function spellPower(id) {
  const spell = SPELL_BY_ID[id];
  const cfg = CONFIG.spells[id];
  if (!spell || !cfg) return state.heroDmg;
  const pct = (state.mods.spellPct && state.mods.spellPct[id]) || 0;
  const scaled = state.heroDmg * cfg.dmgMult * (1 + pct);
  return spell.kind === "support" ? scaled : scaled + (state.mods.flatDmg || 0);
}

// How long the traced rune charges before the spell actually leaves it.
// Zauberhast nodes shave that wind-up down; the scene renderer reads the SAME
// number for the charge/puff animation, so the rune never puffs out of step with
// the bolt it launched.
function castChargeMs() {
  return CONFIG.castChargeMs * (1 - (state.mods.castHaste || 0));
}

// Living skeletons nearest the hero first — the order every targeted spell
// picks from.
function spellTargets() {
  return livingEnemies().sort((a, b) => a.pos - b.pos);
}

// Is the hero's next spell primed by a Frostkegel? A primed cast shatters:
// it hits harder AND spreads to every frozen body on the floor.
function primeActive(now) {
  return now < (state.spellPrimeUntil || 0);
}

// ---------------------------------------------------------------------------
// Damage application — one funnel so every spell rolls crits, is mitigated by
// the target's armour, pops its damage number at the right moment, counts the
// kill and feeds leech identically. `at` is when the hit visually LANDS: the
// number pops then, and a fatal target stands `struck` until that moment before
// it collapses.
// ---------------------------------------------------------------------------
function applySpellHit(target, amount, at, opts = {}) {
  const m = state.mods;
  const crit = opts.noCrit ? false : Math.random() < m.critChance;
  let dmg = amount * (crit ? m.critMult : 1);
  // Shattering a frozen body: the Frostkegel's setup pays off here.
  if (opts.shatter && target.frozenUntil && at < target.frozenUntil) {
    dmg *= CONFIG.spells.frost.primeMult;
  }
  // Armour is applied inside hitEnemy, which hands back what actually landed —
  // so the number that pops, the life-leech it feeds and the kill decided below
  // are all the same figure the HP bar just lost. A mitigated hit pops in steel
  // rather than cream (a crit still wins that contest: it's the louder read).
  const armored = armorReduction(target) > 0;
  const dealt = hitEnemy(target, dmg);
  target.hitFlashAt = at;          // the body blinks white when the hit lands (see renderScene)
  spawnDmgFloat({
    value: dealt,
    color: crit ? CONFIG.colors.dmgFloat.crit
      : armored ? CONFIG.colors.dmgFloat.armored
      : (opts.color || CONFIG.colors.dmgFloat.enemy),
    born: at,
    targetId: target.id,
    x: scene ? scene.enemyLineX + target.pos * TILE : 0,
    y: scene ? (scene.laneY[target.lane] ?? scene.feetY) - enemyArt(target).h - 3 : 0,
  });
  if (target.hp <= 0 && target.phase !== "struck" && target.phase !== "dying") {
    // Killed, but it keeps its feet until the effect actually reaches it (see
    // updateEnemies) — the kill is already decided, so it's counted now.
    target.phase = "struck";
    target.phaseAt = at;
    target.struckUntil = at;
    creditKill();
  }
  return dealt;
}

// Queue a visual for render-spells to draw. Descriptors are plain data; nothing
// here touches the canvas.
function pushFx(fx) {
  if (!state.spellFx) state.spellFx = [];
  state.spellFx.push(fx);
}

// Where a skeleton's chest sits on screen right now — the aim point for every
// bolt, arc and impact.
function enemyPoint(e) {
  if (!scene) return { x: 0, y: 0 };
  const art = enemyArt(e);
  return {
    x: Math.round(scene.enemyLineX + e.pos * TILE),
    y: (scene.laneY[e.lane] ?? scene.feetY) - art.h + art.chest,
  };
}

// ---------------------------------------------------------------------------
// The resolvers. Each is handed the cast context and returns the total damage
// it dealt (which is what life-leech feeds on).
//   now      — the moment the shape completed
//   castAt   — when the rune finishes charging and the spell actually leaves
//   power    — this spell's damage before crits
// ---------------------------------------------------------------------------
// Where to throw the Feuerball. A blast centred on the body nearest the hero
// spends half its radius on the empty hall in front of that body, so the ball is
// aimed instead at whichever skeleton's burst catches the MOST of the mob.
//
// Ties — and in a queue that has bunched up at the standoff line there are many —
// go to the FRONT of the hall first and then to the CENTRE of the lanes: of two
// equally fat shots, the nearer one buys time against the rank that is actually
// swinging, and the middle lane is the one with neighbours on both sides. The
// candidates are the bodies themselves rather than a free point on the floor:
// the fire has to visibly land on something, and with the lane spread measured
// between lane centres, an epicentre floated between two lanes catches no more
// than one planted on either of them.
//
// `bodies` arrives sorted nearest-first (see spellTargets), so the front-most of
// an equal-scoring set is simply the first one found.
function pickBlastFocus(bodies, radius, laneRadius) {
  const mid = (Math.max(1, CONFIG.enemyLanes) - 1) / 2;
  let best = null, bestCount = 0;
  for (const c of bodies) {
    let count = 0;
    for (const e of bodies) {
      if (Math.abs(e.pos - c.pos) <= radius && Math.abs(e.lane - c.lane) <= laneRadius) count++;
    }
    if (!best || count > bestCount) { best = c; bestCount = count; continue; }
    if (count < bestCount) continue;
    // Same haul: take the one nearer the hero, then the one nearer mid-hall.
    const ahead = c.pos - best.pos;
    if (ahead < -1e-6 ||
      (Math.abs(ahead) <= 1e-6 && Math.abs(c.lane - mid) < Math.abs(best.lane - mid))) best = c;
  }
  return best;
}

const SPELL_RESOLVERS = {
  // Feuerball: one ball of flame thrown into the thick of the mob, which BURSTS
  // where it lands. Everything inside the blast takes FULL power — the rim hits
  // as hard as the epicentre, because falloff is Blitzschlag's trade, not this
  // one. The radius is the upgrade; where it's aimed is pickBlastFocus above.
  fireball(ctx) {
    const cfg = CONFIG.spells.fireball;
    // Glutkern nodes widen the burst. Its spread ACROSS the lanes grows at half
    // that rate — the same rule the meteor's crater follows, and for the same
    // reason: a blast that swallowed every lane at once would erase the lanes.
    const aoe = state.mods.spellParam.aoeFireball || 0;
    const radius = Math.min(cfg.maxRadiusTiles, cfg.radiusTiles * (1 + aoe));
    const laneRadius = cfg.laneRadius * (1 + aoe * 0.5);
    const ordered = spellTargets();
    if (!ordered.length) return 0;             // nothing to throw it at — no cast, no burst
    const focus = pickBlastFocus(ordered, radius, laneRadius);
    const caught = ordered.filter((e) =>
      Math.abs(e.pos - focus.pos) <= radius && Math.abs(e.lane - focus.lane) <= laneRadius);
    // A primed cast shatters every frozen body wherever it stands, inside the
    // blast or not — pickTargets(0) hands back exactly those, and that reach is
    // what the Frostkegel combo buys.
    for (const e of ctx.pickTargets(0)) if (!caught.includes(e)) caught.push(e);

    const land = ctx.castAt + cfg.flightMs;
    let dealt = 0;
    for (const e of caught) dealt += applySpellHit(e, ctx.power, land, { shatter: ctx.shatter });
    state.castTargetId = focus.id;
    // The drawn blast reads its size off the same two figures the catch above
    // used, so the fire on screen covers exactly what burned.
    pushFx({
      kind: "blast", spell: "fireball", born: ctx.castAt, landAt: land,
      until: land + cfg.blastMs, targetId: focus.id, to: enemyPoint(focus),
      radius, laneRadius,
    });
    return dealt;
  },

  // Blitzschlag: an arc from the staff through the queue, each hop carrying
  // `falloff` of the one before it. Reaches much further than Feuerball and
  // arrives weaker with every body.
  lightning(ctx) {
    const cfg = CONFIG.spells.lightning;
    const hops = Math.min(cfg.maxChain, cfg.chain + (state.mods.spellParam.chainLightning || 0));
    // Leitfähigkeit nodes soften the per-hop falloff, so a long chain arrives at
    // the back of the queue with something left in it.
    const falloff = Math.min(0.94, cfg.falloff + (state.mods.spellParam.falloffLightning || 0));
    const targets = ctx.pickTargets(hops);
    const points = [];
    let dealt = 0, amount = ctx.power;
    targets.forEach((target, i) => {
      const land = ctx.castAt + i * cfg.hopMs;
      dealt += applySpellHit(target, amount, land, {
        shatter: ctx.shatter, color: CONFIG.colors.spell.lightning.rgb,
      });
      points.push({ targetId: target.id, at: enemyPoint(target) });
      amount *= falloff;                          // every further body takes less
    });
    if (targets.length) {
      state.castTargetId = targets[0].id;
      pushFx({
        kind: "chain", spell: "lightning", born: ctx.castAt,
        until: ctx.castAt + targets.length * cfg.hopMs + cfg.holdMs,
        hopMs: cfg.hopMs, points,
      });
    }
    return dealt;
  },

  // Frostkegel: a cone off the staff. Everything inside it is shoved back down
  // the hall and frozen where it lands, and the hero's NEXT spell is primed to
  // shatter the frozen bodies (see primeActive / applySpellHit).
  frost(ctx) {
    const cfg = CONFIG.spells.frost;
    const freeze = Math.min(cfg.maxFreezeMs, cfg.freezeMs + (state.mods.spellParam.freezeFrost || 0));
    // Weiter Atem nodes push the cone further down the hall, up to `maxConeTiles`
    // — the whole branch is worth four tiles of reach and no more (the drawn cone
    // reads the same figure off the fx descriptor, so the art always matches the
    // catch).
    const reach = Math.min(cfg.maxConeTiles,
      cfg.coneTiles * (1 + (state.mods.spellParam.coneFrost || 0)));
    // The drawn wedge grows to its full length over the first 45% of the cast
    // (see SPELL_FX.cone), so its front passes a body at that fraction of the
    // sweep. Every body is hit — and starts moving — when the ice actually
    // reaches it, rather than all of them at one arbitrary instant.
    const sweepMs = cfg.castMs * 0.45;
    const sweepEnd = ctx.castAt + sweepMs;
    const caught = spellTargets().filter((e) => e.pos <= reach);
    let dealt = 0;
    for (const e of caught) {
      const land = ctx.castAt + sweepMs * Math.min(1, e.pos / Math.max(0.001, reach));
      dealt += applySpellHit(e, ctx.power, land, {
        noCrit: true, color: CONFIG.colors.spell.frost.rgb,
      });
      // A body the cone KILLED is left alone from here: applySpellHit has put it
      // in `struck`, where it stands until the ice lands and then collapses.
      // Shoving or freezing it would overwrite that phase, and a skeleton whose
      // kill was decided but whose phase says "walk" never dies at all — it just
      // marches on at 0 HP.
      if (e.phase === "struck" || e.phase === "dying") continue;
      // Shoved back toward the far end — as a slide across `pushMs`, not a jump.
      // Only the timing is booked here; updateEnemies reads the body's position
      // at the moment the shove actually starts (it may still be walking during
      // the cast's wind-up) and carries it back from there.
      e.pushAt = land;
      e.pushUntil = land + cfg.pushMs;
      e.pushBy = cfg.pushTiles;
      e.pushFrom = null;
      e.shunted = 0;      // ground the ranks in front give it before its own turn
      e.frozenUntil = land + freeze;
      // Its swing timer resumes from the thaw, so freezing genuinely costs it a
      // hit rather than merely postponing one it had already wound up.
      e.attackAt = Math.max(e.attackAt, e.frozenUntil);
    }
    state.spellPrimeUntil = sweepEnd + CONFIG.spells.primeWindowMs;
    state.castTargetId = caught.length ? caught[0].id : null;
    pushFx({
      kind: "cone", spell: "frost", born: ctx.castAt, landAt: sweepEnd,
      until: ctx.castAt + cfg.castMs, reach,
    });
    return dealt;
  },

  // Meteoritenschauer: rocks fall on RANDOM spots across the whole visible
  // track, not on chosen bodies. Each cracks a small area, so it thins a mob
  // spread down the corridor instead of deleting whichever rank is in front.
  meteor(ctx) {
    const cfg = CONFIG.spells.meteor;
    const count = Math.min(cfg.maxCount, cfg.count + (state.mods.spellParam.countMeteor || 0));
    // Einschlagswucht nodes widen the crater. Depth grows at half the rate — a
    // rock that swallowed every lane at once would erase the point of lanes.
    const aoe = state.mods.spellParam.aoeMeteor || 0;
    const radius = cfg.radiusTiles * (1 + aoe);
    const laneRadius = cfg.laneRadius * (1 + aoe * 0.5);
    const edge = trackEdgeTiles(1);
    const lanes = Math.max(1, CONFIG.enemyLanes);
    let dealt = 0;
    for (let i = 0; i < count; i++) {
      const pos = Math.random() * Math.max(1, edge);
      const lane = Math.floor(Math.random() * lanes);
      // Spread the barrage over its window so rocks rain down rather than
      // landing as one thud.
      const land = ctx.castAt + cfg.fallMs + Math.random() * cfg.spreadMs;
      for (const e of spellTargets()) {
        if (Math.abs(e.pos - pos) > radius) continue;
        if (Math.abs(e.lane - lane) > laneRadius) continue;
        dealt += applySpellHit(e, ctx.power, land, {
          shatter: ctx.shatter, color: CONFIG.colors.spell.meteor.rgb,
        });
      }
      pushFx({
        kind: "meteor", spell: "meteor", born: land - cfg.fallMs, landAt: land,
        until: land + cfg.impactMs, pos, lane, radius,
      });
    }
    state.castTargetId = null;
    return dealt;
  },

  // Bannschild: the same spell power, banked as absorb instead of spent as
  // damage. Stacks onto whatever Ward nodes already grant.
  shield(ctx) {
    const cfg = CONFIG.spells.shield;
    const amount = Math.max(1, Math.round(ctx.power));
    const cap = Math.max(state.mods.shieldMax, Math.round(amount * cfg.capMult));
    state.heroShield = Math.min(cap, (state.heroShield || 0) + amount);
    state.castTargetId = null;
    pushFx({ kind: "aura", spell: "shield", born: ctx.castAt, until: ctx.castAt + cfg.castMs, amount });
    return 0;   // no damage dealt — and so nothing for life-leech to feed on
  },

  // Heilwort: spell power converted back into HP, part flat and part a slice of
  // the pool so it stays worth a page on both a small and a large hero.
  heal(ctx) {
    const cfg = CONFIG.spells.heal;
    const amount = Math.max(1, Math.round(ctx.power + state.heroMaxHP * cfg.maxFrac));
    const before = state.heroHP;
    healHero(amount);
    const gained = Math.round(state.heroHP - before);
    state.castTargetId = null;
    if (gained > 0 && scene) {
      spawnDmgFloat({
        value: gained, color: CONFIG.colors.spell.heal.rgb, born: ctx.castAt,
        x: scene.wizard.x + SHEET.wizardIdle.w / 2, y: scene.wizard.y - 4,
      });
    }
    pushFx({ kind: "aura", spell: "heal", born: ctx.castAt, until: ctx.castAt + cfg.castMs, amount: gained });
    return 0;
  },
};

// ---------------------------------------------------------------------------
// The cast — called by onShapeComplete once the three chords are drawn. Builds
// the context, runs the active page's resolver, then applies the effects that
// belong to every cast regardless of spell (leech, Ward's chance shield).
// ---------------------------------------------------------------------------
function castActiveSpell(now) {
  const spell = activeSpell();
  const id = spell.id;
  const castAt = now + castChargeMs();   // the rune finishes charging first
  const shatter = primeActive(now);

  const ctx = {
    now, castAt, spell, power: spellPower(id), shatter,
    // Nearest `n` targets — plus, on a primed cast, every frozen body on the
    // floor, which is what makes the Frostkegel → damage combo worth setting up.
    pickTargets(n) {
      const ordered = spellTargets();
      const picked = ordered.slice(0, Math.max(0, n));
      if (shatter) {
        for (const e of ordered) {
          if (e.frozenUntil && castAt < e.frozenUntil && !picked.includes(e)) picked.push(e);
        }
      }
      return picked;
    },
  };

  const dealt = SPELL_RESOLVERS[id](ctx) || 0;
  // A primed cast is spent the moment it goes off, whether or not it connected.
  if (shatter) state.spellPrimeUntil = 0;

  const m = state.mods;
  if (m.leech > 0 && dealt > 0) healHero(dealt * m.leech);
  if (m.shieldChance > 0 && Math.random() < m.shieldChance) {
    state.heroShield = Math.min(m.shieldMax, (state.heroShield || 0) + m.shieldAmount);
  }
  return dealt;
}

window.Incanto.spells = {
  SPELLS, SPELL_BY_ID, STARTER_SPELL, spellUnlocked, activeSpellId, activeSpell,
  spellSelect, spellPower, castActiveSpell, primeActive, castChargeMs,
  normalizeSpellOrder, bookOrder, bookSpells, bookSlot, swapBookPages,
};
