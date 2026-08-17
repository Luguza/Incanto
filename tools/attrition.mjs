// How far down the hall a build gets before it is ground down — the tuning
// instrument for the ATTRITION side of the balance, the way stat-supply.mjs is
// the instrument for the supply side.
//
// The hall is meant to end in a slow grind: HP is handed out once at the mouth
// of the corridor (progression.js startRun) and never refilled, so a run is one
// long subtraction and the question is only how many camps it takes. What must
// NOT happen is a single camp settling it — if the pool is worth two or three
// seconds, the corridor stops being a grind and becomes a coin flip on whether
// the hero out-damages the first thing he meets.
//
// So this tool answers one question, for a build at a given spend:
//
//     how many camps does it clear before the hero falls?
//
//   node tools/attrition.mjs
//
// THE MODEL, and what it is worth. Per camp it ticks 50 ms at a time: bodies
// walk in, the front body of each lane swings on its own cadence (ranged bodies
// shoot from wherever they planted, per loop.js), the hero casts his best page
// every `SEC_PER_CAST` at the frontmost body with a splash onto the next, armour
// is applied through the game's own curve, and regen ticks. It is NOT the game
// — it has no freezes, no shove, no summons, no healers mending, no crit, no
// leech, and it assumes a player who never misses a rune. Read it as an upper
// bound on the hero and a comparison between two sets of numbers, not as a
// prediction. What it is good for is exactly what it is used for here: showing
// that camp 1 no longer decides the run.
//
// Chromium is pre-installed (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers).
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); }
catch { ({ chromium } = require(join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright"))); }

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".otf": "font/otf" };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const buf = await readFile(join(ROOT, p));
    res.writeHead(200, { "Content-Type": MIME[extname(p)] || "application/octet-stream" });
    res.end(buf);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));

// Fractions of CONFIG.treeGold to test, matching stat-supply.mjs so the two
// tools' columns line up. 0 is the bare hero who has never bought a node.
const SHARES = [0, 0.005, 0.02, 0.1, 0.3, 0.6, 0.9];

// Try a number without editing config.js first:
//   node tools/attrition.mjs enemyBaseDmg=10 enemyFirstAttackMs=2500
// Only top-level CONFIG keys, and only for a look — the committed balance is
// what is in config.js. A body's CADENCE is not reachable this way: every
// variant names its own `attackMs`, so `enemyAttackIntervalMs` is only the
// fallback and overriding it moves nothing.
const OVERRIDES = {};
for (const a of process.argv.slice(2)) {
  const [k, v] = a.split("=");
  if (k && v !== undefined) OVERRIDES[k] = Number(v);
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: "load" });
await page.waitForTimeout(700);

const data = await page.evaluate(({ shares, overrides }) => {
  for (const k in overrides) CONFIG[k] = overrides[k];
  const { TREE_NODES: N, TREE_EDGES: E, nodeCost, treeBuy } = Incanto.skilltree;
  const { ENCOUNTER_PLAN, packRanks, PACKS } = Incanto.encounters;
  const { spellPower } = Incanto.spells;
  const { spawnHP, bodyTier } = Incanto.progression;

  // How long one cast takes end to end on a phone: the rune has to be TRACED by
  // a thumb before it charges, and that trace — not castChargeMs — is what
  // actually sets the hero's rate of fire. Two seconds is a brisk, accurate
  // player; the charge is added on top because it is real time the spell spends
  // in the air.
  const TRACE_MS = 2000;
  const ENGAGE_MS = 4000;   // spawn line to the standoff line, roughly
  const ADVANCE_MS = 1500;  // a lane's next body stepping up over its dead front rank
  const SPLASH = 0.5;       // share of a hit the body behind the target also takes
  const TICK = 50;

  const typeById = {};
  for (const t of CONFIG.enemyTypes) typeById[t.id] = t;

  // The unit the pool is measured in: what a plain skeleton takes off per second
  // once it has planted — its rounded blow over its own cadence.
  const skeletonDps = (C) => {
    const t = typeById.skeleton;
    return Math.max(1, Math.round(C.enemyBaseDmg * t.dmgMult)) /
      ((t.attackMs || C.enemyAttackIntervalMs) / 1000);
  };

  const armorMult = (armor) => {
    const eff = Math.max(0, (armor || 0) - (state.mods.armorPen || 0));
    if (eff <= 0) return 1;
    return 1 - Math.min(CONFIG.armorMaxReduction, eff / (eff + CONFIG.armorK));
  };

  // …and the same curve on the hero's side of the swing (combat.heroArmorReduction).
  // Read from the game rather than re-derived, so the tool cannot quietly report
  // a pressure the hall does not actually apply. The backfire from a wrong match
  // is not modelled here at all, which is also where armour does not reach — the
  // two omissions happen to agree.
  const heroTakes = () => 1 - Incanto.combat.heroArmorReduction();

  // Build the camp exactly as the plan describes it: rank by rank, lane by lane,
  // each body carrying its variant's own numbers. HP comes from the game's own
  // spawn rule rather than from `hpMult`, because a splitting body ignores that
  // multiplier and walks in on the top rung of its ladder (progression.spawnHP).
  function campBodies(i) {
    const e = ENCOUNTER_PLAN[i];
    const ranks = packRanks({ pack: PACKS[e.pack], reinforce: e.reinforce || 0 });
    const out = [];
    ranks.forEach((rank, r) => {
      for (const m of rank) {
        const t = typeById[m.type] || typeById.skeleton;
        const hp = spawnHP(t);
        const tier = bodyTier(t, hp);
        out.push({
          lane: m.lane, rank: r, role: t.role || "melee",
          hp, maxHP: hp, type: t, split: !!t.split,
          // Rounded and floored exactly as progression.js sizeBody does it, the
          // rung's own multiplier included. That used to be a rounding error on a
          // 50-point blow and is now the difference between 3 and 4 on a
          // skeleton's, because the hall's cadences are fast enough that a blow
          // is a small integer — and on a slime fragment it is the difference
          // between 2 and 1.
          dmg: Math.max(1, Math.round(CONFIG.enemyBaseDmg * t.dmgMult * (tier ? tier.dmgMult : 1))),
          armor: t.armor || 0,
          interval: t.attackMs || CONFIG.enemyAttackIntervalMs,
          windup: Math.max(CONFIG.enemyFirstAttackMs,
            CONFIG.enemyWindupBeats * (t.attackMs || CONFIG.enemyAttackIntervalMs)),
        });
      }
    });
    return out;
  }

  // A slime that is hit becomes TWO of the rung below, each on a full bar
  // (progression.splitSlime) — however hard it was hit, since a slime above the
  // bottom rung cannot be killed at all. Modelled here because it is the one
  // thing in the hall that makes a camp cost more casts than its head count says,
  // and the only one whose cost does not fall as the hero grows: the hit that
  // divides a body is a whole cast that removes no HP from the camp, so a big
  // slime is seven casts for a fresh hero and seven for a finished one. Mutates
  // the body into the first half and returns the second, or null if it was
  // already on the bottom rung (where it dies like anything else).
  function splitBody(b) {
    const ladder = CONFIG.slimeTiers;
    let i = 0;
    for (let k = 0; k < ladder.length; k++) if (b.maxHP >= ladder[k].hp) i = k;
    if (i <= 0) return null;
    const rung = ladder[i - 1];
    b.hp = b.maxHP = rung.hp;
    b.dmg = Math.max(1, Math.round(CONFIG.enemyBaseDmg * b.type.dmgMult * rung.dmgMult));
    return Object.assign({}, b);
  }

  // One camp, ticked. Returns the HP the hero has left and how long it took;
  // hp <= 0 means the corridor ended here.
  function fightCamp(bodies, hp, maxHp, dps, regen, soak) {
    const alive = bodies.slice();
    const engagedAt = new Map();
    let t = 0, nextCast = TRACE_MS + Incanto.spells.castChargeMs();
    // WHO IS SWINGING. A lane still fights front-to-back — one melee body per
    // lane reaches the hero — but which bodies fill those slots is no longer
    // decided by the formation: a body walled in behind one that is already
    // fighting crosses to a lane whose slot is going begging (pathfind.js). So
    // the melee ceiling is the LANE COUNT rather than the number of lanes the
    // pack happened to be written into, and a camp's head count is what sets its
    // pressure. Front rank first, since that is who arrives first and so who
    // takes the near slots.
    //
    // Everything else is exempt from the queue for the same reasons the game
    // exempts it: a ranged body shoots over the rank in front of it, and a
    // summoner or healer works from wherever it planted.
    //
    // The crossing is not free here either — a body only counted as swinging
    // once it has a slot, and `engagedAt` is dropped the moment it stops, so a
    // body that changes lane re-arms and pays ADVANCE_MS + its own wind-up
    // before its next blow, which is about what the walk across costs it.
    const lanes = Math.max(1, CONFIG.enemyLanes);
    const swinging = () => {
      const set = new Set();
      let slots = lanes;
      for (const b of alive.slice().sort((a, c) => a.rank - c.rank || a.lane - c.lane)) {
        if (b.role !== "melee") { set.add(b); continue; }
        if (slots > 0) { set.add(b); slots--; }
      }
      return set;
    };
    while (alive.length && hp > 0 && t < 600000) {
      t += TICK;
      const front = swinging();
      for (const b of alive) {
        const swings = front.has(b);
        if (!swings) { engagedAt.delete(b); continue; }
        if (!engagedAt.has(b)) {
          // Front rank walks in; anyone stepping up over a corpse takes less.
          const delay = b.rank === 0 ? ENGAGE_MS : ADVANCE_MS;
          engagedAt.set(b, t + delay + b.windup);
        }
        let due = engagedAt.get(b);
        while (t >= due) {
          // Floored at 1 the way enemyHitPlayer floors it: plate makes a blow
          // small, never nothing, and at this hall's cadences that floor is a
          // real part of what a swarm costs.
          if (b.role !== "summoner" && b.role !== "healer") hp -= Math.max(1, Math.round(b.dmg * soak));
          due += b.interval;
        }
        engagedAt.set(b, due);
      }
      if (regen > 0 && hp < maxHp) hp = Math.min(maxHp, hp + regen * TICK / 1000);
      // The hero's cast: frontmost body, splash onto the one behind it.
      if (t >= nextCast) {
        nextCast += TRACE_MS + Incanto.spells.castChargeMs();
        const order = alive.slice().sort((a, b) => a.rank - b.rank || a.lane - b.lane);
        if (order[0]) order[0].hp -= dps * armorMult(order[0].armor);
        if (order[1]) order[1].hp -= dps * SPLASH * armorMult(order[1].armor);
        // Anything the cast touched divides, if it is the kind of body that does
        // — INCLUDING one the cast would have killed outright, which is the usual
        // case here: every build past the first few nodes deletes 60 HP in one
        // hit, and a big slime is still four small ones' worth of casts to clear
        // (see combat.hitEnemy). Reading it any other way models a prologue that
        // costs a grown hero three casts when it costs him twenty-one.
        for (const b of [order[0], order[1]]) {
          if (!b || !b.split) continue;
          const twin = splitBody(b);
          if (twin) alive.push(twin);
        }
        for (let i = alive.length - 1; i >= 0; i--) if (alive[i].hp <= 0) alive.splice(i, 1);
      }
    }
    return { hp, ms: t, cleared: !alive.length };
  }

  const rows = [];
  const budgets = shares.map((f) => Math.round(CONFIG.treeGold * f));
  for (const budget of budgets) {
    // Cheapest-reachable-first, the same build stat-supply.mjs measures.
    state.nodeRanks = {}; state.gold = budget; recomputeMods();
    const adj = {};
    for (const [a, b] of E) { (adj[a] = adj[a] || []).push(b); (adj[b] = adj[b] || []).push(a); }
    for (;;) {
      let best = null, bc = Infinity;
      for (const id in N) {
        if (id === "root") continue;
        const n = N[id], r = state.nodeRanks[id] || 0;
        if (r >= n.maxRank) continue;
        if (!(adj[id] || []).some((x) => x === "root" || (state.nodeRanks[x] || 0) > 0)) continue;
        const c = nodeCost(n, r);
        if (c < bc) { bc = c; best = id; }
      }
      if (!best || bc > state.gold) break;
      treeBuy(best);
    }
    // The best damage page this build has unlocked.
    let hit = 0;
    for (const s of Incanto.spells.SPELLS) {
      if (s.kind === "support") continue;
      if (s.id !== "fireball" && !(state.spellsUnlocked || []).includes(s.id)) continue;
      hit = Math.max(hit, spellPower(s.id));
    }
    const maxHp = state.heroMaxHP, regen = state.mods.regen || 0;
    const soak = heroTakes();
    let hp = maxHp, camps = 0, firstCampHp = null, ms = 0;
    const chapters = [];
    for (let i = 0; i < ENCOUNTER_PLAN.length; i++) {
      const before = hp;
      const r = fightCamp(campBodies(i), hp, maxHp, hit, regen, soak);
      ms += r.ms;
      if (firstCampHp === null) firstCampHp = Math.max(0, Math.round(r.hp));
      const ch = ENCOUNTER_PLAN[i].chapter;
      const row = chapters[ch] || (chapters[ch] = { ch: ch + 1, camps: 0, lost: 0, ms: 0 });
      row.camps++; row.lost += Math.max(0, before - r.hp); row.ms += r.ms;
      if (r.hp <= 0 || !r.cleared) { hp = 0; break; }
      hp = r.hp; camps = i + 1;
      // The walk to the next mark, where regen does its quiet work.
      const walkMs = CONFIG.encounterSpacingMetres * 16 / CONFIG.heroWalkPxPerMs;
      ms += walkMs;
      if (regen > 0) hp = Math.min(maxHp, hp + regen * walkMs / 1000);
    }
    rows.push({
      budget, hp: maxHp, hit: Math.round(hit), regen: Math.round(regen * 10) / 10,
      soak: Math.round((1 - soak) * 100),
      camps, chapter: ENCOUNTER_PLAN[Math.min(camps, ENCOUNTER_PLAN.length - 1)].chapter + 1,
      firstCampHp, mins: Math.round(ms / 60000), chapters: chapters.filter(Boolean),
      // The headline number: how long one plain skeleton, left alone with this
      // hero, would need to empty him. Seconds rather than blows, because a blow
      // is no longer a fixed bite — bodies swing on their own cadences now, and
      // what a pool is worth is the TIME it buys under that pressure. Armour is
      // in it, because a pool and the plate over it are one quantity as far as
      // "how long do I last" is concerned.
      secs: Math.round(maxHp / (skeletonDps(CONFIG) * soak)),
    });
  }
  return { rows, total: ENCOUNTER_PLAN.length, baseDmg: CONFIG.enemyBaseDmg, baseHp: CONFIG.heroBaseHP };
}, { shares: SHARES, overrides: OVERRIDES });

await browser.close();
server.close();

const pad = (s, n) => String(s).padStart(n);
console.log(`\nenemyBaseDmg ${data.baseDmg} · heroBaseHP ${data.baseHp} · ${data.total} camps in the hall\n`);
console.log("   gold     LP   Treffer  Regen  Rüstung   Skelettsekunden   Camp 1 endet mit   geschafft   Kapitel   ~min");
console.log("  ".padEnd(110, "─"));
for (const r of data.rows) {
  console.log(
    "  " + pad(r.budget, 6) + pad(r.hp, 7) + pad(r.hit, 10) + pad(r.regen, 7) +
    pad(r.soak + " %", 9) +
    pad(r.secs + " s", 18) + pad(r.firstCampHp + " LP", 19) +
    pad(r.camps + "/" + data.total, 12) + pad(r.chapter, 10) + pad(r.mins, 7)
  );
}
// Where the HP actually went, chapter by chapter, for the deepest run in the
// table: the column that says whether the far end of the hall threatens a grown
// hero at all, or merely takes a long time to cut down.
const deep = data.rows.reduce((a, b) => (b.camps >= a.camps ? b : a));
console.log(`\n  chapter-by-chapter for the ${deep.budget}-gold build (${deep.hp} LP):\n`);
console.log("   Kapitel   Camps   LP verloren   je Camp   ~min");
for (const c of deep.chapters) {
  console.log(
    pad(c.ch, 10) + pad(c.camps, 8) + pad(Math.round(c.lost), 14) +
    pad(Math.round(c.lost / c.camps), 10) + pad((c.ms / 60000).toFixed(1), 7)
  );
}
console.log(`
  Skelettsekunden — how long the pool survives one plain skeleton's attention.
  Under ~25 s a single camp settles the run; the hall is built to be a grind,
  not a coin flip.
  Camp 1 endet mit — HP left after the corridor's very first pack. It must not
  be anywhere near zero for a hero who has bought nothing.
`);
