"use strict";
// ==============================================================================
// skilltree.js — the Path-of-Exile-style rune upgrade tree that replaces the old
// two-button shop. The tree is PROCEDURALLY GENERATED: seven themed sectors each
// fan outward across ~22 rings, repeating a small set of effect archetypes whose
// magnitude — and cost — grow the farther they sit from the seed. That yields a
// giant web (~1400 nodes) you pan/zoom around. This module owns the generator,
// the derived stat model (recomputeMods), purchase/reveal logic, and the SVG
// screen. Loads after screens.js so it can define the global `renderUpgradeFull`
// the loop router calls for the "upgrade" screen.
// ==============================================================================

// ---------------------------------------------------------------------------
// Themes — each family shares one colour and one rune glyph (see RUNE_GLYPHS),
// so kindred nodes read as a set at a glance.
// ---------------------------------------------------------------------------
const TREE_THEMES = {
  offense:  { color: "#ff7043", glow: "255,112,67"  }, // flat + % damage
  vitality: { color: "#5ecf8f", glow: "94,207,143"  }, // flat + % HP
  crit:     { color: "#f2c14e", glow: "242,193,78"  }, // crit chance + crit damage
  arcane:   { color: "#b07cff", glow: "176,124,255" }, // spell power + area of effect
  ward:     { color: "#4de3e0", glow: "77,227,224"  }, // shields, thorns, fail-protection
  sustain:  { color: "#e5679a", glow: "229,103,154" }, // regen + life leech
  fortune:  { color: "#d9a441", glow: "217,164,65"  }, // gold + walk speed
  origin:   { color: "#eafffe", glow: "234,255,254" }, // the central seed node
};

// Small runic line-glyphs in local coords (centred on 0,0, ~±13). Stroke is
// inherited from the wrapping <g>, so colour is set once per node.
const RUNE_GLYPHS = {
  offense:  `<polyline points="-9,4 0,-7 9,4"/><polyline points="-9,10 0,-1 9,10"/>`,
  vitality: `<line x1="0" y1="-11" x2="0" y2="11"/><line x1="-10" y1="-1" x2="10" y2="-1"/><line x1="-5" y1="-11" x2="5" y2="-11"/>`,
  crit:     `<polygon points="0,-12 2.6,-2.6 12,0 2.6,2.6 0,12 -2.6,2.6 -12,0 -2.6,-2.6"/>`,
  arcane:   `<circle cx="0" cy="0" r="4.5"/><line x1="0" y1="-6.5" x2="0" y2="-12"/><line x1="0" y1="6.5" x2="0" y2="12"/><line x1="-6.5" y1="0" x2="-12" y2="0"/><line x1="6.5" y1="0" x2="12" y2="0"/><line x1="-4.6" y1="-4.6" x2="-8.5" y2="-8.5"/><line x1="4.6" y1="4.6" x2="8.5" y2="8.5"/>`,
  ward:     `<polygon points="0,-11 9,-6 9,4 0,11 -9,4 -9,-6"/>`,
  sustain:  `<path d="M0,-11 C7,-3 7,7 0,10 C-7,7 -7,-3 0,-11 Z"/>`,
  fortune:  `<circle cx="0" cy="0" r="9"/><polygon points="0,-4 4,0 0,4 -4,0"/>`,
  origin:   `<circle cx="0" cy="0" r="10"/><circle cx="0" cy="0" r="4"/><line x1="0" y1="-10" x2="0" y2="-14"/><line x1="0" y1="10" x2="0" y2="14"/><line x1="-10" y1="0" x2="-14" y2="0"/><line x1="10" y1="0" x2="14" y2="0"/>`,
};

// ---------------------------------------------------------------------------
// Generation — the tree lives in a large tree-space (seed at TREE_CENTER); the
// 900-unit SVG viewBox is just the pan/zoom window onto it, so the tree dwarfs
// the screen. Each sector repeats its `arch` (archetype) list outward; a node's
// effect value scales with its ring (stronger further out), as does its cost.
// ---------------------------------------------------------------------------
const TREE_CENTER = 2600;              // seed sits at the middle of the tree-space
const TREE_VIEW = 900;                 // SVG viewBox size = the pan/zoom window
const TREE_RADIUS = 2250;              // how far the tree reaches from the seed
const NODE_STEP = 90;                  // spacing a branch advances per node
const NODE_MIN_DIST = 72;              // guaranteed minimum centre-to-centre gap (no overlaps)
const VAL_PER_RING = 0.3;              // effect grows by this fraction of base per tier out (caps bound the total — see CONFIG.caps)
const COST_PER_RING = 1.25;            // cost multiplies by this per tier out

// Sectors: the effect archetypes that repeat outward. The seven sectors are laid
// out evenly around the full circle (see buildSkillTree), so every angle is used
// and there are no empty wedges. Each archetype is a reusable "node type"; `rare`
// ones (AoE, fail-protection) only appear on deep rings so the strong mechanics
// stay far from the seed.
const TREE_SECTORS = [
  { key: "off", theme: "offense", arch: [
    { stat: "flatDmg", base: 2, cost: 28, maxRank: 4, title: "Schneide", blurb: "Schärft deinen Grundschaden." },
    { stat: "pctDmg", base: 0.05, cost: 42, maxRank: 3, title: "Zorn", blurb: "Verstärkt allen Schaden prozentual." },
  ]},
  { key: "vit", theme: "vitality", arch: [
    { stat: "flatHp", base: 16, cost: 24, maxRank: 4, title: "Zähigkeit", blurb: "Erhöht deine maximalen Lebenspunkte." },
    { stat: "pctHp", base: 0.05, cost: 40, maxRank: 3, title: "Lebenskraft", blurb: "Mehr Lebenspunkte prozentual." },
  ]},
  { key: "cri", theme: "crit", arch: [
    { stat: "critChance", base: 0.03, cost: 40, maxRank: 4, title: "Präzision", blurb: "Chance auf kritische Treffer." },
    { stat: "critMult", base: 0.12, cost: 46, maxRank: 3, title: "Wucht", blurb: "Kritische Treffer schlagen härter zu." },
  ]},
  { key: "arc", theme: "arcane", arch: [
    { stat: "pctDmg", base: 0.05, cost: 44, maxRank: 3, title: "Fokus", blurb: "Arkane Bündelung — verstärkt deinen Schaden." },
    { stat: "aoeExtra", base: 1, cost: 220, growth: 1.8, maxRank: 1, rare: true, title: "Splitterzauber",
      blurb: "Dein Zauber trifft ein zusätzliches Ziel (mehr Kacheln)." },
  ]},
  { key: "war", theme: "ward", arch: [
    { stat: "thorns", base: 0.12, cost: 38, maxRank: 3, title: "Dornen", blurb: "Wirft einen Teil des erlittenen Schadens zurück." },
    { special: "shield", cost: 48, maxRank: 3, title: "Schildzauber", blurb: "Manche Zauber gewähren einen absorbierenden Schild." },
    { stat: "spellFailProt", base: 0.07, cost: 70, growth: 1.5, maxRank: 2, rare: true, title: "Schutzzauber",
      blurb: "Chance, den Fehlschlag-Rückschlag ganz abzuwehren." },
  ]},
  { key: "sus", theme: "sustain", arch: [
    { stat: "regen", base: 0.4, cost: 40, maxRank: 4, title: "Genesung", blurb: "Regeneriert langsam Lebenspunkte im Kampf." },
    { stat: "leech", base: 0.05, cost: 52, maxRank: 3, title: "Aderlass", blurb: "Heilt dich für einen Teil des Zauberschadens." },
  ]},
  { key: "for", theme: "fortune", arch: [
    { stat: "coinMult", base: 0.08, cost: 44, maxRank: 4, title: "Glückssträhne", blurb: "Mehr Gold für richtig gelöste Vokabeln." },
    { stat: "walkMult", base: 0.06, cost: 46, maxRank: 3, title: "Flinkheit", blurb: "Der Held schreitet zügiger voran." },
  ]},
];

// Small seeded PRNG so the generated tree is identical on every load (node ids
// must stay stable — saves reference them).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build the whole tree once at load via SPACE COLONISATION: scatter "attractor"
// points across a disc, grow branches from the seed toward them, and let a
// branch fork wherever attractors spread out around it. That yields an organic,
// always-branching tree (never a straight radial run) that fills the whole disc
// (no empty wedges), while a hard minimum-separation check keeps nodes from ever
// overlapping. Distance from the seed still sets a node's tier (stronger + more
// expensive further out); its theme comes from the angular sector it lands in.
function buildSkillTree() {
  const rng = mulberry32(0x9E3779B1);
  const C = TREE_CENTER, N = TREE_SECTORS.length, TWO_PI = Math.PI * 2;
  const HOLE = 140;                 // clear radius around the seed
  const INFLUENCE = 300;            // an attractor pulls the nearest node within this
  const KILL = 98;                  // an attractor is consumed once a node gets this close
  const MIN_SEP = NODE_MIN_DIST;    // never place a node closer than this to another

  const nodes = {
    root: { title: "Ursprung", theme: "origin", ring: 0, maxRank: 0, cost: 0, growth: 1.4, effect: {},
      blurb: "Der Quell deiner Macht. Von hier verzweigen sich alle Pfade." },
  };
  const pos = { root: { x: C, y: C } };
  const edges = [];

  // Spatial hash over the growing node set (cells sized to the influence radius).
  const nodeById = new Map();
  const grid = new Map();
  const ckey = (x, y) => `${Math.floor((x - C) / INFLUENCE)},${Math.floor((y - C) / INFLUENCE)}`;
  function nearby(x, y) {
    const cx = Math.floor((x - C) / INFLUENCE), cy = Math.floor((y - C) / INFLUENCE), out = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const a = grid.get(`${cx + i},${cy + j}`);
      if (a) for (const nd of a) out.push(nd);
    }
    return out;
  }
  const sectorAtAngle = (ang) => {
    let a = ((ang + Math.PI / 2) % TWO_PI + TWO_PI) % TWO_PI;
    return TREE_SECTORS[Math.floor(a / (TWO_PI / N)) % N];
  };

  // `secOverride` pins a node to a specific sector instead of deriving it from
  // its angle. The seed shoots use it because they sit exactly on the wedge
  // boundaries sectorAtAngle divides on, where floating-point rounding would
  // otherwise drop a shoot into its neighbour's sector (mis-theming it and
  // desyncing its id prefix). Growth nodes pass nothing and derive geometrically.
  function addNode(id, x, y, parentId, secOverride) {
    const dx = x - C, dy = y - C, rad = Math.hypot(dx, dy);
    const ring = Math.max(1, Math.round(rad / NODE_STEP));   // tier ~ distance from seed
    const sec = secOverride || sectorAtAngle(Math.atan2(dy, dx));
    const seed = ((ring * 2654435761) ^ (Math.round(x) * 40503) ^ Math.round(y)) >>> 0;
    let a = sec.arch[(ring + (seed % 3)) % sec.arch.length];
    if (a.rare && !(ring >= 6 && seed % 5 === 0)) a = sec.arch[0];   // rare types stay deep
    const tier = 1 + VAL_PER_RING * (ring - 1);
    let effect;
    if (a.special === "shield") {
      effect = { shieldChance: Math.min(0.3, 0.1 + 0.005 * ring), shieldAmount: Math.round(4 * tier), shieldMax: Math.round(6 * tier) };
    } else if (a.stat === "aoeExtra") {
      effect = { aoeExtra: 1 };
    } else {
      let v = a.base * tier;
      if (a.stat === "flatDmg" || a.stat === "flatHp") v = Math.max(1, Math.round(v));
      else if (a.stat === "regen") v = Math.round(v * 10) / 10;
      else v = Math.round(v * 1000) / 1000;
      effect = { [a.stat]: v };
    }
    const cost = Math.max(5, Math.round(a.cost * Math.pow(COST_PER_RING, ring - 1)));
    nodes[id] = { title: a.title, theme: sec.theme, ring, maxRank: a.maxRank || 3,
      cost, growth: a.growth || 1.4, effect, blurb: a.blurb };
    pos[id] = { x, y };
    const nd = { id, x, y };
    nodeById.set(id, nd);
    const k = ckey(x, y);
    (grid.get(k) || grid.set(k, []).get(k)).push(nd);
    if (parentId) edges.push([parentId, id]);
    return nd;
  }
  const tooClose = (x, y) => nearby(x, y).some((nd) => {
    const dx = x - nd.x, dy = y - nd.y; return dx * dx + dy * dy < MIN_SEP * MIN_SEP;
  });

  // Attractors on a jittered grid filling the disc (minus the central hole).
  const attractors = [];
  const g = NODE_STEP * 0.92;
  for (let x = -TREE_RADIUS; x <= TREE_RADIUS; x += g) {
    for (let y = -TREE_RADIUS; y <= TREE_RADIUS; y += g) {
      const jx = x + (rng() - 0.5) * g * 0.7, jy = y + (rng() - 0.5) * g * 0.7;
      const r = Math.hypot(jx, jy);
      if (r > HOLE && r < TREE_RADIUS) attractors.push({ x: C + jx, y: C + jy, dead: false });
    }
  }

  // Seven initial shoots so the seed branches out in every direction at once.
  // Each is pinned to its own sector (its angle lands on the sector boundary, so
  // geometric derivation is ambiguous) — that keeps a shoot's theme, effect, and
  // `${key}_0` id all in agreement.
  let counter = 0;
  for (let idx = 0; idx < N; idx++) {
    const A = -Math.PI / 2 + idx * (TWO_PI / N), rr = HOLE + NODE_STEP * 0.6;
    addNode(`${TREE_SECTORS[idx].key}_0`, C + rr * Math.cos(A), C + rr * Math.sin(A), "root", TREE_SECTORS[idx]);
  }

  // Grow: each round, every node pulled by ≥1 attractor sprouts one child toward
  // their mean direction; then attractors close to any node are consumed.
  for (let iter = 0; iter < 500; iter++) {
    const influence = new Map();
    let any = false;
    for (const at of attractors) {
      if (at.dead) continue;
      let best = null, bd = INFLUENCE * INFLUENCE;
      for (const nd of nearby(at.x, at.y)) {
        const dx = at.x - nd.x, dy = at.y - nd.y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = nd; }
      }
      if (best) {
        any = true;
        const dx = at.x - best.x, dy = at.y - best.y, l = Math.hypot(dx, dy) || 1;
        let e = influence.get(best.id);
        if (!e) { e = [0, 0]; influence.set(best.id, e); }
        e[0] += dx / l; e[1] += dy / l;
      }
    }
    if (!any) break;
    let grew = false;
    for (const [nid, e] of influence) {
      const n = nodeById.get(nid), l = Math.hypot(e[0], e[1]) || 1;
      const nx = n.x + (e[0] / l) * NODE_STEP, ny = n.y + (e[1] / l) * NODE_STEP;
      if (Math.hypot(nx - C, ny - C) > TREE_RADIUS + NODE_STEP) continue;
      if (tooClose(nx, ny)) continue;
      addNode(`${sectorAtAngle(Math.atan2(ny - C, nx - C)).key}_${++counter}`, nx, ny, nid);
      grew = true;
    }
    if (!grew) break;
    for (const at of attractors) {
      if (at.dead) continue;
      for (const nd of nearby(at.x, at.y)) {
        const dx = at.x - nd.x, dy = at.y - nd.y;
        if (dx * dx + dy * dy < KILL * KILL) { at.dead = true; break; }
      }
    }
  }

  return { nodes, pos, edges };
}

const _TREE = buildSkillTree();
const TREE_NODES = _TREE.nodes;
const NODE_POS = _TREE.pos;
const TREE_EDGES = _TREE.edges;

// The two earlier releases used different node ids; map their tier-1 bases onto
// the current inner nodes so a little saved progress carries across. Deeper old
// ids simply drop (the tree was regenerated). Unknown ids are ignored on load.
const LEGACY_NODE_IDS = {
  dmg1: "off_0", o1: "off_0", off_1_0: "off_0", hp1: "vit_0", v1: "vit_0", vit_1_0: "vit_0",
  crit1: "cri_0", c1: "cri_0", cri_1_0: "cri_0", sus1: "sus_0", s1: "sus_0", sus_1_0: "sus_0",
  for1: "for_0", f1: "for_0", for_1_0: "for_0", ward1: "war_0", w1: "war_0", war_1_0: "war_0",
  arc1: "arc_0", a1: "arc_0", arc_1_0: "arc_0",
};

const NEIGHBORS = {};
for (const [a, b] of TREE_EDGES) {
  (NEIGHBORS[a] || (NEIGHBORS[a] = [])).push(b);
  (NEIGHBORS[b] || (NEIGHBORS[b] = [])).push(a);
}

// ---------------------------------------------------------------------------
// Purchase / reveal helpers
// ---------------------------------------------------------------------------
function nodeRank(id) { return id === "root" ? 1 : (state.nodeRanks[id] || 0); }
function isPurchased(id) { return id === "root" || (state.nodeRanks[id] || 0) > 0; }
// Effects are only revealed once a purchased node sits next to this one (the
// seed counts as purchased), so tier-1 nodes are visible from the start.
function nodeRevealed(id) {
  if (isPurchased(id)) return true;
  return (NEIGHBORS[id] || []).some(isPurchased);
}
function nodeCost(node, rank) {
  return Math.round(node.cost * Math.pow(node.growth || 1.4, rank));
}

// ---------------------------------------------------------------------------
// Stat model — sum every purchased rank's effect into `state.mods`, then derive
// the two legacy fields (heroMaxHP / heroDmg) the rest of combat already reads.
// The summed pools are run through CONFIG.caps so a deep, stacked tree hits
// smooth diminishing returns instead of snowballing (see CONFIG.caps).
// ---------------------------------------------------------------------------
// Soft cap with a linear knee: the first half of the pool (up to `cap`/2) counts
// at full value, so a few early upgrades land exactly as advertised and feel
// strong; only the excess beyond the knee suffers diminishing returns, bending
// the total over to asymptote at `cap` (it can never reach or exceed it). This
// gives the shape the design wants — early points matter, deep stacking plateaus.
function softCap(x, cap) {
  if (cap <= 0) return 0;
  if (x <= 0) return 0;
  const knee = cap / 2;
  if (x <= knee) return x;                 // full value while under the knee
  const over = x - knee;                   // excess gets diminishing returns
  return knee + (knee * over) / (over + knee);
}

function recomputeMods() {
  const sum = {
    flatDmg: 0, flatHp: 0, pctDmg: 0, pctHp: 0,
    critChance: 0, critMult: 0, aoeExtra: 0,
    leech: 0, regen: 0, walkMult: 0, coinMult: 0,
    shieldChance: 0, shieldAmount: 0, shieldMax: 0,
    thorns: 0, spellFailProt: 0,
  };
  if (state.nodeRanks) {
    for (const id in state.nodeRanks) {
      const node = TREE_NODES[id];
      if (!node) continue;
      const rank = state.nodeRanks[id] || 0;
      for (const k in node.effect) {
        if (k in sum) sum[k] += node.effect[k] * rank;
      }
    }
  }
  const caps = CONFIG.caps;
  state.mods = {
    critChance: Math.min(caps.critChance, sum.critChance),
    critMult: 1.5 + Math.min(caps.critMult, sum.critMult),  // base ×1.5 on a crit
    aoeExtra: Math.round(sum.aoeExtra),
    leech: Math.min(caps.leech, sum.leech),
    regen: Math.min(caps.regen, sum.regen),
    walkMult: 1 + sum.walkMult,
    coinMult: 1 + sum.coinMult,
    shieldChance: Math.min(caps.shieldChance, sum.shieldChance),
    shieldAmount: sum.shieldAmount,
    shieldMax: sum.shieldMax,
    thorns: Math.min(caps.thorns, sum.thorns),
    spellFailProt: Math.min(caps.spellFailProt, sum.spellFailProt),
  };
  // Flat + percent pools soft-cap so a wall of stacked HP/damage nodes plateaus.
  const flatHp = softCap(sum.flatHp, caps.flatHp);
  const flatDmg = softCap(sum.flatDmg, caps.flatDmg);
  const pctHp = softCap(sum.pctHp, caps.pctHp);
  const pctDmg = softCap(sum.pctDmg, caps.pctDmg);
  state.heroMaxHP = Math.round((CONFIG.heroBaseHP + flatHp) * (1 + pctHp));
  state.heroDmg = Math.max(1, Math.round((CONFIG.heroBaseDmg + flatDmg) * (1 + pctDmg)));
  if (state.heroShield == null) state.heroShield = 0;
  if (state.heroShield > state.mods.shieldMax) state.heroShield = state.mods.shieldMax;
}

// Buy one rank of a node (routed from the info panel's "Kaufen" button).
function treeBuy(id) {
  const node = TREE_NODES[id];
  if (!node || id === "root") return;
  const rank = nodeRank(id);
  if (rank >= node.maxRank || !nodeRevealed(id)) return;
  const cost = nodeCost(node, rank);
  if (state.gold < cost) return;

  state.gold -= cost;
  state.nodeRanks[id] = rank + 1;
  const oldMax = state.heroMaxHP;
  recomputeMods();
  const gain = state.heroMaxHP - oldMax;   // buying vitality tops the pool up by the gain
  if (gain > 0) state.heroHP = Math.min(state.heroMaxHP, state.heroHP + gain);
  saveProgress();
  state._structuralDirty = true;
}

// ---------------------------------------------------------------------------
// Effect wording (single-click info)
// ---------------------------------------------------------------------------
const STAT_FMT = {
  flatDmg:      (v) => `+${Math.round(v)} Schaden`,
  flatHp:       (v) => `+${Math.round(v)} LP`,
  pctDmg:       (v) => `+${Math.round(v * 100)}% Schaden`,
  pctHp:        (v) => `+${Math.round(v * 100)}% LP`,
  critChance:   (v) => `+${Math.round(v * 100)}% Krit-Chance`,
  critMult:     (v) => `+${Math.round(v * 100)}% Krit-Schaden`,
  aoeExtra:     (v) => `+${Math.round(v)} Ziel`,
  leech:        (v) => `${Math.round(v * 100)}% Lebensraub`,
  regen:        (v) => `+${(Math.round(v * 10) / 10)}/s LP`,
  walkMult:     (v) => `+${Math.round(v * 100)}% Tempo`,
  coinMult:     (v) => `+${Math.round(v * 100)}% Gold`,
  shieldChance: (v) => `${Math.round(v * 100)}% Schild-Chance`,
  shieldAmount: (v) => `+${Math.round(v)} Schild`,
  shieldMax:    (v) => `+${Math.round(v)} max. Schild`,
  thorns:       (v) => `${Math.round(v * 100)}% Dornen`,
  spellFailProt:(v) => `${Math.round(v * 100)}% Fehlschutz`,
};
function effectText(effect, mult) {
  return Object.keys(effect)
    .map((k) => (STAT_FMT[k] ? STAT_FMT[k](effect[k] * mult) : ""))
    .filter(Boolean)
    .join(" · ");
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function treeClamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function nodeRadius(id) { return id === "root" ? 34 : 28; }

function initTreeView(resetSelection) {
  const s = 0.72;                       // default zoom — shows the seed + several tiers of branches
  const c = TREE_VIEW / 2;              // viewBox centre
  const keep = (!resetSelection && state.tree) ? state.tree.selected : null;
  state.tree = { scale: s, tx: c - TREE_CENTER * s, ty: c - TREE_CENTER * s, selected: keep };
}

function runeGroup(theme, opacity) {
  return `<g class="n-rune" stroke="${TREE_THEMES[theme].color}" fill="none" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}">${RUNE_GLYPHS[theme]}</g>`;
}
function runeGlyphSvg(theme, size) {
  return `<svg class="mini-rune" viewBox="-16 -16 32 32" width="${size}" height="${size}" aria-hidden="true">` +
    runeGroup(theme, 1) + `</svg>`;
}

function nodeDotsSvg(rank, max, R, color) {
  const gap = 8.5, y = R + 11, w = (max - 1) * gap;
  let s = "";
  for (let i = 0; i < max; i++) {
    const x = (-w / 2 + i * gap).toFixed(1);
    const on = i < rank;
    s += `<circle cx="${x}" cy="${y}" r="2.6" fill="${on ? color : "#241f36"}" ` +
      `stroke="${on ? color : "#3a3550"}" stroke-width="0.8"/>`;
  }
  return `<g class="n-dots">${s}</g>`;
}

function nodeSvg(id) {
  const node = TREE_NODES[id];
  const pos = NODE_POS[id];
  const theme = TREE_THEMES[node.theme];
  const revealed = nodeRevealed(id);
  const purchased = isPurchased(id);
  const rank = nodeRank(id);
  const maxed = rank >= node.maxRank;
  const R = nodeRadius(id);

  let disc, glyph, dots = "";
  if (!revealed) {
    // Hidden nodes render as a cheap "?" disc (most of a fresh tree is hidden,
    // which keeps the huge web light until you push into it).
    disc = `<circle class="n-disc" r="${R}" fill="#120e1c" stroke="#332e46" stroke-width="3"/>`;
    glyph = `<text class="n-q" y="9" text-anchor="middle" fill="#4a4560">?</text>`;
  } else {
    const fill = purchased ? `rgba(${theme.glow},0.25)` : "#141020";
    disc = `<circle class="n-disc" r="${R}" fill="${fill}" stroke="${theme.color}" ` +
      `stroke-width="${purchased ? 4 : 3}" opacity="${purchased ? 1 : 0.85}"/>` +
      (purchased ? `<circle r="${R - 6}" fill="none" stroke="${theme.color}" stroke-width="1.5" opacity="0.45"/>` : "") +
      (maxed && id !== "root" ? `<circle r="${R + 4.5}" fill="none" stroke="${theme.color}" stroke-width="1.5" opacity="0.6"/>` : "");
    glyph = runeGroup(node.theme, purchased ? 1 : 0.9);
    if (id !== "root") dots = nodeDotsSvg(rank, node.maxRank, R, theme.color);
  }
  return `<g class="tnode" data-node="${id}" transform="translate(${pos.x.toFixed(1)},${pos.y.toFixed(1)})">${disc}${glyph}${dots}</g>`;
}

function edgeSvg(a, b) {
  const pa = NODE_POS[a], pb = NODE_POS[b];
  const both = isPurchased(a) && isPurchased(b);
  const half = !both && (isPurchased(a) || isPurchased(b));
  const cls = both ? "e-on" : half ? "e-half" : "e-off";
  const dx = pb.x - pa.x, dy = pb.y - pa.y, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  // Stop each end at the rim of the circle it connects (leave a hair of gap).
  const ra = nodeRadius(a) + 1.5, rb = nodeRadius(b) + 1.5;
  if (len <= ra + rb) return "";                      // circles touch — no visible segment
  const x1 = pa.x + ux * ra, y1 = pa.y + uy * ra;
  const x2 = pb.x - ux * rb, y2 = pb.y - uy * rb;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const nx = -uy * 5, ny = ux * 5;                    // perpendicular tick at the midpoint
  return `<g class="tedge ${cls}">` +
    `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="e-line"/>` +
    `<line x1="${(mx - nx).toFixed(1)}" y1="${(my - ny).toFixed(1)}" x2="${(mx + nx).toFixed(1)}" y2="${(my + ny).toFixed(1)}" class="e-tick"/>` +
    `</g>`;
}

// The bottom info panel: a single click on a node fills this in and enables the
// otherwise-greyed "Kaufen" button.
function renderTreeInfo() {
  const id = state.tree && state.tree.selected;
  const node = id ? TREE_NODES[id] : null;
  const disabledBuy = `<button class="tree-buy" disabled>Kaufen</button>`;

  if (!node) {
    return `<div class="tree-info empty">
      <div class="ti-hint">Tippe ein Zeichen an, um seine Wirkung zu sehen.</div>
      ${disabledBuy}</div>`;
  }
  if (!nodeRevealed(id)) {
    return `<div class="tree-info">
      <div class="ti-head"><span class="ti-name">Verborgenes Zeichen</span></div>
      <div class="ti-blurb">Schalte ein benachbartes Zeichen frei, um dieses zu enthüllen.</div>
      ${disabledBuy}</div>`;
  }

  const theme = TREE_THEMES[node.theme];
  const rank = nodeRank(id);
  const maxed = rank >= node.maxRank;
  const per = effectText(node.effect, 1);
  const total = rank > 0 ? effectText(node.effect, rank) : null;

  let dots = "";
  for (let i = 0; i < node.maxRank; i++) dots += `<i class="dot${i < rank ? " on" : ""}"></i>`;

  let buy;
  if (id === "root") {
    buy = `<button class="tree-buy" disabled>Ursprung</button>`;
  } else if (maxed) {
    buy = `<button class="tree-buy" disabled>Maximal</button>`;
  } else {
    const cost = nodeCost(node, rank);
    const afford = state.gold >= cost;
    buy = `<button class="tree-buy${afford ? "" : " poor"}" ${afford ? "" : "disabled"} ` +
      `data-act="treeBuy" data-args='["${id}"]'>Kaufen <span class="coin">◈</span> ${cost}</button>`;
  }

  return `<div class="tree-info" style="border-color:${theme.color}">
    <div class="ti-head">
      <span class="ti-rune">${runeGlyphSvg(node.theme, 24)}</span>
      <span class="ti-name" style="color:${theme.color}">${node.title}</span>
      <span class="ti-tier">Stufe ${node.ring}</span>
      ${node.maxRank ? `<span class="ti-dots" style="color:${theme.color}">${dots}</span>` : ""}
    </div>
    <div class="ti-blurb">${node.blurb}</div>
    ${per ? `<div class="ti-effect">Pro Stufe: <b>${per}</b>${total ? ` &middot; Gesamt: <b>${total}</b>` : ""}</div>` : ""}
    ${buy}</div>`;
}

function selRingSvg() {
  const id = state.tree && state.tree.selected;
  const p = id && NODE_POS[id] ? NODE_POS[id] : null;
  return p
    ? `<circle id="tree-sel" fill="none" stroke="#eafffe" stroke-width="3" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${nodeRadius(id) + 7}"/>`
    : `<circle id="tree-sel" fill="none" stroke="#eafffe" stroke-width="3" r="0" style="display:none"/>`;
}

// The whole upgrade phase is the tree now. Called by the loop router for the
// "upgrade" screen (structural rebuild only — pan/zoom and node selection patch
// the DOM live, so tapping around the ~1400-node web stays cheap).
function renderUpgradeFull() {
  if (!state.tree) initTreeView(true);
  const t = state.tree;

  let edges = "";
  for (const [a, b] of TREE_EDGES) edges += edgeSvg(a, b);
  let nodes = "";
  for (const id in TREE_NODES) nodes += nodeSvg(id);

  const cam = `translate(${t.tx.toFixed(2)},${t.ty.toFixed(2)}) scale(${t.scale.toFixed(4)})`;

  app.innerHTML = `
    <div class="screen tree-screen">
      <div class="tree-topbar">
        <div class="tree-title">Runenbaum</div>
        <div class="tree-gold"><span class="coin">◈</span> ${state.gold}</div>
      </div>
      <svg class="tree-canvas" id="tree-canvas" viewBox="0 0 900 900" preserveAspectRatio="xMidYMid meet">
        <g id="tree-cam" transform="${cam}">
          <g class="tree-edges">${edges}</g>
          <g class="tree-nodes">${selRingSvg()}${nodes}</g>
        </g>
      </svg>
      <div class="tree-zoom">
        <button class="tz-btn" data-act="treeZoom" data-args="[1.25]" aria-label="Vergrößern">+</button>
        <button class="tz-btn" data-act="treeZoom" data-args="[0.8]" aria-label="Verkleinern">&minus;</button>
        <button class="tz-btn" data-act="treeReset" aria-label="Ansicht zurücksetzen">&#8635;</button>
      </div>
      <div id="tree-info-slot">${renderTreeInfo()}</div>
      <button class="fight-btn tree-run-btn" data-act="startRun">Lauf starten →</button>
    </div>`;

  attachTreeInteractions();
}

// Select a node without rebuilding the whole web: move the selection ring and
// refresh just the info slot.
function selectNode(id) {
  if (!state.tree) return;
  state.tree.selected = id;
  const ring = document.getElementById("tree-sel");
  const p = NODE_POS[id];
  if (ring && p) {
    ring.setAttribute("cx", p.x.toFixed(1));
    ring.setAttribute("cy", p.y.toFixed(1));
    ring.setAttribute("r", nodeRadius(id) + 7);
    ring.style.display = "";
  }
  const slot = document.getElementById("tree-info-slot");
  if (slot) slot.innerHTML = renderTreeInfo();
}

function applyTreeCam() {
  const cam = document.getElementById("tree-cam");
  if (cam) {
    const t = state.tree;
    cam.setAttribute("transform",
      `translate(${t.tx.toFixed(2)},${t.ty.toFixed(2)}) scale(${t.scale.toFixed(4)})`);
  }
}
// Zoom about a point given in viewBox coords, keeping it fixed under the cursor.
function treeZoomAt(vx, vy, factor) {
  const t = state.tree;
  const ns = treeClamp(t.scale * factor, 0.1, 3.2);
  const real = ns / t.scale;
  t.tx = vx - (vx - t.tx) * real;
  t.ty = vy - (vy - t.ty) * real;
  t.scale = ns;
}
// Toolbar buttons (rebuild is fine — not per-frame).
function treeZoom(factor) { treeZoomAt(450, 450, factor); state._structuralDirty = true; }
function treeReset() { initTreeView(false); state._structuralDirty = true; }

// Pan (one pointer), pinch (two pointers), wheel zoom, and tap-to-select — all
// bound to the freshly rendered SVG. Pan/zoom mutate the transform live and
// persist to state.tree; selection patches the DOM in place. Neither rebuilds.
function attachTreeInteractions() {
  const svg = document.getElementById("tree-canvas");
  if (!svg) return;
  const pts = new Map();
  let last = null, moved = 0, pinch = 0, downId = null;

  const rect = () => svg.getBoundingClientRect();
  const clientToVB = (cx, cy) => {
    const r = rect();
    return { x: (cx - r.left) * (900 / r.width), y: (cy - r.top) * (900 / r.height) };
  };
  const twoDist = () => {
    const v = [...pts.values()];
    return Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y);
  };
  const twoMidVB = () => {
    const v = [...pts.values()];
    return clientToVB((v[0].x + v[1].x) / 2, (v[0].y + v[1].y) / 2);
  };

  svg.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    try { svg.setPointerCapture(e.pointerId); } catch (_) {}
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { last = { x: e.clientX, y: e.clientY }; moved = 0; downId = e.pointerId; }
    else if (pts.size === 2) { pinch = twoDist(); }
  });

  svg.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size >= 2) {
      const d = twoDist();
      if (pinch > 0) { const mid = twoMidVB(); treeZoomAt(mid.x, mid.y, d / pinch); }
      pinch = d; applyTreeCam();
      return;
    }
    if (last) {
      const k = 900 / rect().width;
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      moved += Math.abs(dx) + Math.abs(dy);
      state.tree.tx += dx * k; state.tree.ty += dy * k;
      last = { x: e.clientX, y: e.clientY };
      applyTreeCam();
    }
  });

  const onUp = (e) => {
    const wasSingle = pts.size === 1;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = 0;
    if (pts.size === 1) { const r = [...pts.values()][0]; last = { x: r.x, y: r.y }; }
    else if (pts.size === 0) last = null;
    // A near-stationary single-pointer tap on a node selects it (cheap patch).
    if (wasSingle && moved < 8 && e.pointerId === downId) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const g = el && el.closest ? el.closest("[data-node]") : null;
      if (g) selectNode(g.dataset.node);
    }
  };
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointercancel", onUp);

  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const p = clientToVB(e.clientX, e.clientY);
    treeZoomAt(p.x, p.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    applyTreeCam();
  }, { passive: false });
}

window.Incanto.skilltree = {
  TREE_NODES, TREE_EDGES, recomputeMods, treeBuy, treeZoom, treeReset,
  renderUpgradeFull, nodeRevealed, nodeCost, nodeRank,
};
