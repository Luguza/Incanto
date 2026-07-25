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
const TREE_CENTER = 3500;
const TREE_VIEW = 900;
const TREE_RINGS = 22;                 // number of rings (tiers) per sector
const TREE_DR = 150;                   // tree-space distance between rings
const VAL_PER_RING = 0.5;              // effect grows by this fraction of base per ring out
const COST_PER_RING = 1.25;            // cost multiplies by this per ring out

// Sectors: base angle (screen degrees, y-down) + the effect archetypes that
// repeat outward. Each archetype is a reusable "node type"; `rare` ones (AoE,
// fail-protection) only appear on deep rings so the strong mechanics stay far
// from the seed.
const TREE_SECTORS = [
  { key: "off", theme: "offense", angle: 270, arch: [
    { stat: "flatDmg", base: 2, cost: 28, maxRank: 4, title: "Schneide", blurb: "Schärft deinen Grundschaden." },
    { stat: "pctDmg", base: 0.05, cost: 42, maxRank: 3, title: "Zorn", blurb: "Verstärkt allen Schaden prozentual." },
  ]},
  { key: "vit", theme: "vitality", angle: 90, arch: [
    { stat: "flatHp", base: 16, cost: 24, maxRank: 4, title: "Zähigkeit", blurb: "Erhöht deine maximalen Lebenspunkte." },
    { stat: "pctHp", base: 0.05, cost: 40, maxRank: 3, title: "Lebenskraft", blurb: "Mehr Lebenspunkte prozentual." },
  ]},
  { key: "cri", theme: "crit", angle: 315, arch: [
    { stat: "critChance", base: 0.03, cost: 40, maxRank: 4, title: "Präzision", blurb: "Chance auf kritische Treffer." },
    { stat: "critMult", base: 0.12, cost: 46, maxRank: 3, title: "Wucht", blurb: "Kritische Treffer schlagen härter zu." },
  ]},
  { key: "arc", theme: "arcane", angle: 225, arch: [
    { stat: "pctDmg", base: 0.05, cost: 44, maxRank: 3, title: "Fokus", blurb: "Arkane Bündelung — verstärkt deinen Schaden." },
    { stat: "aoeExtra", base: 1, cost: 220, growth: 1.8, maxRank: 1, rare: true, title: "Splitterzauber",
      blurb: "Dein Zauber trifft ein zusätzliches Ziel (mehr Kacheln)." },
  ]},
  { key: "war", theme: "ward", angle: 180, arch: [
    { stat: "thorns", base: 0.12, cost: 38, maxRank: 3, title: "Dornen", blurb: "Wirft einen Teil des erlittenen Schadens zurück." },
    { special: "shield", cost: 48, maxRank: 3, title: "Schildzauber", blurb: "Manche Zauber gewähren einen absorbierenden Schild." },
    { stat: "spellFailProt", base: 0.07, cost: 70, growth: 1.5, maxRank: 2, rare: true, title: "Schutzzauber",
      blurb: "Chance, den Fehlschlag-Rückschlag ganz abzuwehren." },
  ]},
  { key: "sus", theme: "sustain", angle: 0, arch: [
    { stat: "regen", base: 0.4, cost: 40, maxRank: 4, title: "Genesung", blurb: "Regeneriert langsam Lebenspunkte im Kampf." },
    { stat: "leech", base: 0.05, cost: 52, maxRank: 3, title: "Aderlass", blurb: "Heilt dich für einen Teil des Zauberschadens." },
  ]},
  { key: "for", theme: "fortune", angle: 45, arch: [
    { stat: "coinMult", base: 0.08, cost: 44, maxRank: 4, title: "Glückssträhne", blurb: "Mehr Gold für richtig gelöste Vokabeln." },
    { stat: "walkMult", base: 0.06, cost: 46, maxRank: 3, title: "Flinkheit", blurb: "Der Held schreitet zügiger voran." },
  ]},
];

function thash(a, b, c) {
  let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) >>> 0;
  return h;
}
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// Build the whole tree once at load: node metadata, absolute positions, edges.
function buildSkillTree() {
  const nodes = {
    root: { title: "Ursprung", theme: "origin", ring: 0, maxRank: 0, cost: 0, growth: 1.4, effect: {},
      blurb: "Der Quell deiner Macht. Von hier verzweigen sich alle Pfade." },
  };
  const pos = { root: { x: TREE_CENTER, y: TREE_CENTER } };
  const edges = [];

  const minSpacing = 84;
  const wedge = (2 * Math.PI / TREE_SECTORS.length) * 0.86; // leave a gap between sectors
  const half = wedge / 2;

  for (const sec of TREE_SECTORS) {
    const A = (sec.angle * Math.PI) / 180;
    const ringNodes = [[]]; // ringNodes[r] = [{id, ang}]
    for (let r = 1; r <= TREE_RINGS; r++) {
      const Rr = r * TREE_DR;
      const maxByArc = Math.max(1, Math.floor((wedge * Rr) / minSpacing));
      const width = Math.min(Math.max(1, Math.round(0.8 * r)), maxByArc, 13);
      const arr = [];
      for (let i = 0; i < width; i++) {
        const frac = width === 1 ? 0.5 : i / (width - 1);
        const h = thash(sec.angle + 1, r, i + 1);
        const jA = ((h % 100) / 100 - 0.5) * wedge * 0.05;
        const jR = (((h >> 8) % 100) / 100 - 0.5) * TREE_DR * 0.26;
        const ang = A - half + frac * (2 * half) + jA;
        const rr = Rr + jR;
        const id = `${sec.key}_${r}_${i}`;

        // Pick an archetype; the simple flat stat (arch[0]) anchors each ring's
        // first node, the rest alternate. Rare ones only surface on deep rings.
        let a = sec.arch[((r - 1) + i) % sec.arch.length];
        if (a.rare && !(r >= 7 && ((r * 3 + i) % 6 === 0))) a = sec.arch[0];

        const tier = 1 + VAL_PER_RING * (r - 1);   // magnitude multiplier for this ring
        let effect;
        if (a.special === "shield") {
          effect = { shieldChance: Math.min(0.3, 0.1 + 0.005 * r), shieldAmount: Math.round(4 * tier), shieldMax: Math.round(6 * tier) };
        } else if (a.stat === "aoeExtra") {
          effect = { aoeExtra: 1 };
        } else {
          let v = a.base * tier;
          if (a.stat === "flatDmg" || a.stat === "flatHp") v = Math.max(1, Math.round(v));
          else if (a.stat === "regen") v = Math.round(v * 10) / 10;
          else v = Math.round(v * 1000) / 1000;
          effect = { [a.stat]: v };
        }
        const cost = Math.max(5, Math.round(a.cost * Math.pow(COST_PER_RING, r - 1)));
        nodes[id] = { title: a.title, theme: sec.theme, ring: r, maxRank: a.maxRank || 3,
          cost, growth: a.growth || 1.4, effect, blurb: a.blurb };
        pos[id] = { x: TREE_CENTER + rr * Math.cos(ang), y: TREE_CENTER + rr * Math.sin(ang) };
        arr.push({ id, ang });
      }
      ringNodes[r] = arr;
    }

    // Edges: each node links to its nearest parent one ring in (ring 1 → root);
    // every third node gets a second parent, and alternate same-ring neighbours
    // are joined — enough to weave a web without turning it into a solid mesh.
    for (let r = 1; r <= TREE_RINGS; r++) {
      const arr = ringNodes[r];
      for (let k = 0; k < arr.length; k++) {
        const cur = arr[k];
        if (r === 1) { edges.push(["root", cur.id]); continue; }
        const inner = ringNodes[r - 1];
        let best = inner[0], bd = Infinity, second = null, sd = Infinity;
        for (const n of inner) {
          const d = Math.abs(angDiff(n.ang, cur.ang));
          if (d < bd) { sd = bd; second = best; bd = d; best = n; }
          else if (d < sd) { sd = d; second = n; }
        }
        edges.push([best.id, cur.id]);
        if (k % 3 === 0 && second) edges.push([second.id, cur.id]);
      }
      for (let k = 0; k + 1 < arr.length; k += 2) edges.push([arr[k].id, arr[k + 1].id]);
    }
  }

  // Weave the sectors together with an inner ring across their tier-1 bases.
  for (let s = 0; s < TREE_SECTORS.length; s++) {
    const a = `${TREE_SECTORS[s].key}_1_0`;
    const b = `${TREE_SECTORS[(s + 1) % TREE_SECTORS.length].key}_1_0`;
    if (pos[a] && pos[b]) edges.push([a, b]);
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
  dmg1: "off_1_0", o1: "off_1_0", hp1: "vit_1_0", v1: "vit_1_0",
  crit1: "cri_1_0", c1: "cri_1_0", sus1: "sus_1_0", s1: "sus_1_0",
  for1: "for_1_0", f1: "for_1_0", ward1: "war_1_0", w1: "war_1_0",
  arc1: "arc_1_0", a1: "arc_1_0",
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
// ---------------------------------------------------------------------------
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
  state.mods = {
    critChance: Math.min(1, sum.critChance),
    critMult: 1.5 + sum.critMult,        // base ×1.5 on a crit
    aoeExtra: Math.round(sum.aoeExtra),
    leech: sum.leech,
    regen: sum.regen,
    walkMult: 1 + sum.walkMult,
    coinMult: 1 + sum.coinMult,
    shieldChance: Math.min(1, sum.shieldChance),
    shieldAmount: sum.shieldAmount,
    shieldMax: sum.shieldMax,
    thorns: sum.thorns,
    spellFailProt: Math.min(0.9, sum.spellFailProt),
  };
  state.heroMaxHP = Math.round((CONFIG.heroBaseHP + sum.flatHp) * (1 + sum.pctHp));
  state.heroDmg = Math.max(1, Math.round((CONFIG.heroBaseDmg + sum.flatDmg) * (1 + sum.pctDmg)));
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
  const s = 0.9;                        // default zoom — seed + inner rings big
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
