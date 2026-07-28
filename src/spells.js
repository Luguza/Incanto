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
// specifically (see skilltree.js — each spell owns one sector of the tree).
// `unlock` is null for the one spell the hero starts with; every other page is
// sealed until its unique unlock node is bought.
const SPELLS = [
  {
    id: "fireball", name: "Feuerball", theme: "arcane", sector: "arc", kind: "damage",
    dmgKey: "dmgFireball", paramKey: "tgtFireball", unlock: null,
    blurb: "Eine Kugel aus Flammen für jedes der nächsten Ziele — volle Wucht auf jedes, ohne Abschwächung.",
  },
  {
    id: "lightning", name: "Blitzschlag", theme: "offense", sector: "off", kind: "damage",
    dmgKey: "dmgLightning", paramKey: "chainLightning", unlock: "lightning",
    blurb: "Ein Bogen, der von Körper zu Körper springt. Jeder Sprung trägt weniger Kraft als der vorige.",
  },
  {
    id: "frost", name: "Frostkegel", theme: "vitality", sector: "vit", kind: "control",
    dmgKey: "dmgFrost", paramKey: "freezeFrost", unlock: "frost",
    blurb: "Ein Kegel aus Eis stößt die vorderste Reihe zurück und friert sie fest. Dein nächster Zauber zerschmettert sie.",
  },
  {
    id: "meteor", name: "Meteoritenschauer", theme: "crit", sector: "cri", kind: "damage",
    dmgKey: "dmgMeteor", paramKey: "countMeteor", unlock: "meteor",
    blurb: "Brocken stürzen auf zufällige Stellen des ganzen Ganges — verheerend gegen eine weit verteilte Horde.",
  },
  {
    id: "shield", name: "Bannschild", theme: "ward", sector: "war", kind: "support",
    dmgKey: "dmgShield", paramKey: null, unlock: "shield",
    blurb: "Wandelt deine Zauberkraft in einen Schild, der die nächsten Schläge schluckt.",
  },
  {
    id: "heal", name: "Heilwort", theme: "sustain", sector: "sus", kind: "support",
    dmgKey: "dmgHeal", paramKey: null, unlock: "heal",
    blurb: "Wandelt deine Zauberkraft in Lebenspunkte zurück.",
  },
];

const SPELL_BY_ID = Object.fromEntries(SPELLS.map((s) => [s.id, s]));
const STARTER_SPELL = "fireball";

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
// ---------------------------------------------------------------------------
function spellPower(id) {
  const spell = SPELL_BY_ID[id];
  const cfg = CONFIG.spells[id];
  if (!spell || !cfg) return state.heroDmg;
  const pct = (state.mods.spellPct && state.mods.spellPct[id]) || 0;
  return state.heroDmg * cfg.dmgMult * (1 + pct);
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
// Damage application — one funnel so every spell rolls crits, pops its damage
// number at the right moment, counts the kill and feeds leech identically.
// `at` is when the hit visually LANDS: the number pops then, and a fatal target
// stands `struck` until that moment before it collapses.
// ---------------------------------------------------------------------------
function applySpellHit(target, amount, at, opts = {}) {
  const m = state.mods;
  const crit = opts.noCrit ? false : Math.random() < m.critChance;
  let dmg = amount * (crit ? m.critMult : 1);
  // Shattering a frozen body: the Frostkegel's setup pays off here.
  if (opts.shatter && target.frozenUntil && at < target.frozenUntil) {
    dmg *= CONFIG.spells.frost.primeMult;
  }
  dmg = Math.max(1, Math.round(dmg));
  hitEnemy(target, dmg);
  target.hitFlashAt = at;          // the body blinks white when the hit lands (see renderScene)
  spawnDmgFloat({
    value: dmg,
    color: crit ? CONFIG.colors.dmgFloat.crit : (opts.color || CONFIG.colors.dmgFloat.enemy),
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
    state.kills++;
  }
  return dmg;
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
const SPELL_RESOLVERS = {
  // Feuerball: one bolt per target, each carrying FULL power. Extra targets are
  // the upgrade; there is no falloff — that's Blitzschlag's trade, not this one.
  fireball(ctx) {
    const cfg = CONFIG.spells.fireball;
    const count = Math.min(cfg.maxTargets, cfg.targets + (state.mods.spellParam.tgtFireball || 0));
    const targets = ctx.pickTargets(count);
    let dealt = 0;
    targets.forEach((target, i) => {
      // Bolts leave together but land in sequence, so a wide fireball reads as a
      // volley rather than one silent multi-hit.
      const land = ctx.castAt + CONFIG.fireballFlightMs + i * cfg.boltStaggerMs;
      dealt += applySpellHit(target, ctx.power, land, { shatter: ctx.shatter });
      pushFx({
        kind: "bolt", spell: "fireball", born: ctx.castAt + i * cfg.boltStaggerMs,
        landAt: land, until: land + CONFIG.fireballImpactMs,
        targetId: target.id, to: enemyPoint(target),
      });
    });
    if (targets.length) state.castTargetId = targets[0].id;
    return dealt;
  },

  // Blitzschlag: an arc from the staff through the queue, each hop carrying
  // `falloff` of the one before it. Reaches much further than Feuerball and
  // arrives weaker with every body.
  lightning(ctx) {
    const cfg = CONFIG.spells.lightning;
    const hops = Math.min(cfg.maxChain, cfg.chain + (state.mods.spellParam.chainLightning || 0));
    const targets = ctx.pickTargets(hops);
    const points = [];
    let dealt = 0, amount = ctx.power;
    targets.forEach((target, i) => {
      const land = ctx.castAt + i * cfg.hopMs;
      dealt += applySpellHit(target, amount, land, {
        shatter: ctx.shatter, color: CONFIG.colors.spell.lightning.rgb,
      });
      points.push({ targetId: target.id, at: enemyPoint(target) });
      amount *= cfg.falloff;                      // every further body takes less
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
    const land = ctx.castAt + cfg.castMs * 0.45;
    const caught = spellTargets().filter((e) => e.pos <= cfg.coneTiles);
    let dealt = 0;
    for (const e of caught) {
      dealt += applySpellHit(e, ctx.power, land, {
        noCrit: true, color: CONFIG.colors.spell.frost.rgb,
      });
      // Shoved back toward the far end, never past the edge of the visible
      // track — a skeleton punted off camera would just be gone.
      e.pos = Math.min(e.pos + cfg.pushTiles, trackEdgeTiles(e.scale || 1));
      e.frozenUntil = land + freeze;
      e.phase = "walk";
      // Its swing timer resumes from the thaw, so freezing genuinely costs it a
      // hit rather than merely postponing one it had already wound up.
      e.attackAt = Math.max(e.attackAt, e.frozenUntil);
    }
    state.spellPrimeUntil = land + CONFIG.spells.primeWindowMs;
    state.castTargetId = caught.length ? caught[0].id : null;
    pushFx({
      kind: "cone", spell: "frost", born: ctx.castAt, landAt: land,
      until: ctx.castAt + cfg.castMs, reach: cfg.coneTiles,
    });
    return dealt;
  },

  // Meteoritenschauer: rocks fall on RANDOM spots across the whole visible
  // track, not on chosen bodies. Each cracks a small area, so it thins a mob
  // spread down the corridor instead of deleting whichever rank is in front.
  meteor(ctx) {
    const cfg = CONFIG.spells.meteor;
    const count = Math.min(cfg.maxCount, cfg.count + (state.mods.spellParam.countMeteor || 0));
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
        if (Math.abs(e.pos - pos) > cfg.radiusTiles) continue;
        if (Math.abs(e.lane - lane) > cfg.laneRadius) continue;
        dealt += applySpellHit(e, ctx.power, land, {
          shatter: ctx.shatter, color: CONFIG.colors.spell.meteor.rgb,
        });
      }
      pushFx({
        kind: "meteor", spell: "meteor", born: land - cfg.fallMs, landAt: land,
        until: land + cfg.impactMs, pos, lane,
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
  const castAt = now + CONFIG.castChargeMs;   // the rune finishes charging first
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
  spellSelect, spellPower, castActiveSpell, primeActive,
};
