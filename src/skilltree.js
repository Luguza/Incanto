"use strict";
// ==============================================================================
// skilltree.js — the Path-of-Exile-style rune upgrade tree that replaces the old
// two-button shop. Owns: TREE_NODES/EDGES data, derived stat model
// (recomputeMods), purchase + reveal logic (treeBuy, nodeRevealed …), the
// pan/zoom SVG screen (renderUpgradeFull, attachTreeInteractions) and the
// procedural per-theme rune glyphs. Loads after screens.js so it can define the
// global `renderUpgradeFull` the loop router calls for the "upgrade" screen.
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
// Tree geometry — nodes sit on 8 radial spokes around a central seed. Distance
// from the seed = power tier (farther out = rarer, pricier, stronger). Positions
// are computed from {angle, ring} into a 900×900 tree-space (seed at 450,450).
// ---------------------------------------------------------------------------
const TREE_CENTER = 450;
const TREE_RINGS = { 1: 112, 2: 206, 3: 298, 4: 388 };

// Each node: title, theme, {angle,ring} placement, maxRank (dots), base cost +
// per-rank cost growth, an `effect` map summed into the stat model, and a blurb
// describing the mechanic (shown on a single click).
const TREE_NODES = {
  root: { title: "Ursprung", theme: "origin", angle: 0, ring: 0, maxRank: 0, cost: 0,
    effect: {}, blurb: "Der Quell deiner Macht. Von hier verzweigen sich alle Pfade." },

  // ── Offense (aufwärts) — flat & prozentualer Schaden ──────────────────────
  dmg1: { title: "Schneide", theme: "offense", angle: 270, ring: 1, maxRank: 5, cost: 30, growth: 1.5,
    effect: { flatDmg: 2 }, blurb: "Schärft deinen Grundschaden." },
  dmg2: { title: "Zorn", theme: "offense", angle: 270, ring: 2, maxRank: 4, cost: 90, growth: 1.5,
    effect: { pctDmg: 0.06 }, blurb: "Verstärkt allen Schaden prozentual." },
  dmg3: { title: "Bruch", theme: "offense", angle: 270, ring: 3, maxRank: 4, cost: 160, growth: 1.55,
    effect: { flatDmg: 4 }, blurb: "Wuchtiger Grundschaden." },
  dmg4: { title: "Vernichtung", theme: "offense", angle: 270, ring: 4, maxRank: 2, cost: 420, growth: 1.7,
    effect: { pctDmg: 0.15 }, blurb: "Schlüsselzeichen: gewaltige Schadensverstärkung." },

  // ── Vitality (abwärts) — flat & prozentuale LP ────────────────────────────
  hp1: { title: "Zähigkeit", theme: "vitality", angle: 90, ring: 1, maxRank: 5, cost: 25, growth: 1.5,
    effect: { flatHp: 20 }, blurb: "Erhöht deine maximalen Lebenspunkte." },
  hp2: { title: "Lebenskraft", theme: "vitality", angle: 90, ring: 2, maxRank: 4, cost: 80, growth: 1.5,
    effect: { pctHp: 0.06 }, blurb: "Mehr Lebenspunkte prozentual." },
  hp3: { title: "Bollwerk", theme: "vitality", angle: 90, ring: 3, maxRank: 4, cost: 150, growth: 1.55,
    effect: { flatHp: 45 }, blurb: "Eine große Lebensreserve." },
  hp4: { title: "Unsterblichkeit", theme: "vitality", angle: 90, ring: 4, maxRank: 2, cost: 400, growth: 1.7,
    effect: { pctHp: 0.18 }, blurb: "Schlüsselzeichen: gewaltige LP-Verstärkung." },

  // ── Crit (oben rechts) — Krit-Chance & Krit-Schaden ───────────────────────
  crit1: { title: "Präzision", theme: "crit", angle: 315, ring: 1, maxRank: 5, cost: 40, growth: 1.5,
    effect: { critChance: 0.04 }, blurb: "Chance, einen kritischen Treffer zu landen." },
  crit2: { title: "Wucht", theme: "crit", angle: 315, ring: 2, maxRank: 4, cost: 110, growth: 1.5,
    effect: { critMult: 0.15 }, blurb: "Kritische Treffer schlagen härter zu." },
  crit3: { title: "Adlerauge", theme: "crit", angle: 315, ring: 3, maxRank: 3, cost: 200, growth: 1.55,
    effect: { critChance: 0.06 }, blurb: "Deutlich mehr Krit-Chance." },
  crit4: { title: "Hinrichtung", theme: "crit", angle: 315, ring: 4, maxRank: 2, cost: 460, growth: 1.7,
    effect: { critMult: 0.4 }, blurb: "Schlüsselzeichen: verheerender Krit-Schaden." },

  // ── Sustain (rechts) — LP-Regeneration & Lebensraub ───────────────────────
  sus1: { title: "Genesung", theme: "sustain", angle: 0, ring: 1, maxRank: 5, cost: 45, growth: 1.5,
    effect: { regen: 0.5 }, blurb: "Regeneriert langsam Lebenspunkte im Kampf." },
  sus2: { title: "Aderlass", theme: "sustain", angle: 0, ring: 2, maxRank: 4, cost: 130, growth: 1.55,
    effect: { leech: 0.08 }, blurb: "Heilt dich für einen Teil des Zauberschadens." },
  sus3: { title: "Lebensquell", theme: "sustain", angle: 0, ring: 3, maxRank: 3, cost: 220, growth: 1.55,
    effect: { regen: 1 }, blurb: "Kräftigere LP-Regeneration." },
  sus4: { title: "Vampirismus", theme: "sustain", angle: 0, ring: 4, maxRank: 2, cost: 480, growth: 1.7,
    effect: { leech: 0.15 }, blurb: "Schlüsselzeichen: gewaltiger Lebensraub." },

  // ── Fortune (unten rechts) — Gold & Lauftempo ─────────────────────────────
  for1: { title: "Glückssträhne", theme: "fortune", angle: 45, ring: 1, maxRank: 5, cost: 50, growth: 1.5,
    effect: { coinMult: 0.1 }, blurb: "Mehr Gold für richtig gelöste Vokabeln." },
  for2: { title: "Flinkheit", theme: "fortune", angle: 45, ring: 2, maxRank: 3, cost: 90, growth: 1.55,
    effect: { walkMult: 0.08 }, blurb: "Der Held schreitet zügiger durch den Gang." },
  for3: { title: "Reichtum", theme: "fortune", angle: 45, ring: 3, maxRank: 3, cost: 200, growth: 1.6,
    effect: { coinMult: 0.15 }, blurb: "Deutlich mehr Gold aus dem Lernen." },

  // ── Ward (links) — Schilde, Dornen, Fehlschlag-Schutz ─────────────────────
  ward1: { title: "Schildzauber", theme: "ward", angle: 180, ring: 1, maxRank: 4, cost: 70, growth: 1.55,
    effect: { shieldChance: 0.14, shieldAmount: 5, shieldMax: 6 },
    blurb: "Manche Zauber gewähren einen Schild, der erlittenen Schaden absorbiert." },
  ward2: { title: "Dornen", theme: "ward", angle: 180, ring: 2, maxRank: 4, cost: 140, growth: 1.55,
    effect: { thorns: 0.25 }, blurb: "Wirft einen Teil des erlittenen Schadens auf den Angreifer zurück." },
  ward3: { title: "Barriere", theme: "ward", angle: 180, ring: 3, maxRank: 3, cost: 240, growth: 1.6,
    effect: { shieldChance: 0.1, shieldAmount: 6, shieldMax: 8 },
    blurb: "Häufigere und stärkere Schilde." },
  ward4: { title: "Schutzzauber", theme: "ward", angle: 180, ring: 4, maxRank: 3, cost: 300, growth: 1.6,
    effect: { spellFailProt: 0.2 }, blurb: "Schlüsselzeichen: Chance, den Fehlschlag-Rückschlag ganz abzuwehren." },

  // ── Arcane (oben links) — Zaubermacht & Flächenwirkung ────────────────────
  arc1: { title: "Fokus", theme: "arcane", angle: 225, ring: 1, maxRank: 4, cost: 60, growth: 1.5,
    effect: { pctDmg: 0.05 }, blurb: "Arkane Bündelung — verstärkt deinen Schaden." },
  arc2: { title: "Splitterzauber", theme: "arcane", angle: 225, ring: 2, maxRank: 2, cost: 260, growth: 1.8,
    effect: { aoeExtra: 1 }, blurb: "Dein Zauber trifft ein zusätzliches Skelett (mehr Kacheln)." },
  arc3: { title: "Kettenblitz", theme: "arcane", angle: 225, ring: 3, maxRank: 1, cost: 600, growth: 1.8,
    effect: { aoeExtra: 1 }, blurb: "Schlüsselzeichen: trifft ein weiteres Ziel — reine Verwüstung." },
};

// Undirected connections. A short inner ring links the tier-1 nodes for a woven
// look; each spoke then chains outward; a couple of cross-links between
// neighbouring spokes open alternate routes (Path-of-Exile style webbing).
const TREE_EDGES = [
  ["root", "dmg1"], ["root", "hp1"], ["root", "crit1"], ["root", "sus1"],
  ["root", "for1"], ["root", "ward1"], ["root", "arc1"],
  // inner ring
  ["dmg1", "crit1"], ["crit1", "sus1"], ["sus1", "for1"], ["for1", "hp1"],
  ["ward1", "arc1"], ["arc1", "dmg1"],
  // spokes
  ["dmg1", "dmg2"], ["dmg2", "dmg3"], ["dmg3", "dmg4"],
  ["hp1", "hp2"], ["hp2", "hp3"], ["hp3", "hp4"],
  ["crit1", "crit2"], ["crit2", "crit3"], ["crit3", "crit4"],
  ["sus1", "sus2"], ["sus2", "sus3"], ["sus3", "sus4"],
  ["for1", "for2"], ["for2", "for3"],
  ["ward1", "ward2"], ["ward2", "ward3"], ["ward3", "ward4"],
  ["arc1", "arc2"], ["arc2", "arc3"],
  // cross-links
  ["dmg2", "crit2"], ["ward2", "arc2"],
];

// Resolve {angle,ring} → absolute tree-space coords, and build the neighbour map.
const NODE_POS = {};
for (const id in TREE_NODES) {
  const n = TREE_NODES[id];
  const r = TREE_RINGS[n.ring] || 0;
  const a = (n.angle * Math.PI) / 180;
  NODE_POS[id] = { x: TREE_CENTER + r * Math.cos(a), y: TREE_CENTER + r * Math.sin(a) };
}
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
  return Math.round(node.cost * Math.pow(node.growth || 1.55, rank));
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

function initTreeView(resetSelection) {
  const s = 0.82;
  const keep = (!resetSelection && state.tree) ? state.tree.selected : null;
  state.tree = { scale: s, tx: TREE_CENTER - TREE_CENTER * s, ty: TREE_CENTER - TREE_CENTER * s, selected: keep };
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
  const selected = state.tree && state.tree.selected === id;
  const R = id === "root" ? 30 : 26;

  const sel = selected
    ? `<circle class="n-sel" r="${R + 6}" fill="none" stroke="#eafffe" stroke-width="2"/>`
    : "";

  let disc, glyph, dots = "";
  if (!revealed) {
    disc = `<circle class="n-disc" r="${R}" fill="#120e1c" stroke="#332e46" stroke-width="2"/>`;
    glyph = `<text class="n-q" y="8" text-anchor="middle" fill="#4a4560">?</text>`;
  } else {
    const fill = purchased ? `rgba(${theme.glow},0.22)` : "#141020";
    disc = `<circle class="n-disc" r="${R}" fill="${fill}" stroke="${theme.color}" ` +
      `stroke-width="${purchased ? 3 : 2}" opacity="${purchased ? 1 : 0.82}" ` +
      `${purchased ? 'filter="url(#nodeGlow)"' : ""}/>` +
      (maxed && id !== "root" ? `<circle r="${R + 3.5}" fill="none" stroke="${theme.color}" stroke-width="1" opacity="0.55"/>` : "");
    glyph = runeGroup(node.theme, purchased ? 1 : 0.9);
    if (id !== "root") dots = nodeDotsSvg(rank, node.maxRank, R, theme.color);
  }
  return `<g class="tnode${selected ? " selected" : ""}" data-node="${id}" ` +
    `transform="translate(${pos.x.toFixed(1)},${pos.y.toFixed(1)})">${sel}${disc}${glyph}${dots}</g>`;
}

function edgeSvg(a, b) {
  const pa = NODE_POS[a], pb = NODE_POS[b];
  const both = isPurchased(a) && isPurchased(b);
  const half = !both && (isPurchased(a) || isPurchased(b));
  const cls = both ? "e-on" : half ? "e-half" : "e-off";
  const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
  const dx = pb.x - pa.x, dy = pb.y - pa.y, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len * 4, ny = dx / len * 4; // little perpendicular tick at midpoint
  return `<g class="tedge ${cls}">` +
    `<line x1="${pa.x.toFixed(1)}" y1="${pa.y.toFixed(1)}" x2="${pb.x.toFixed(1)}" y2="${pb.y.toFixed(1)}" class="e-line"/>` +
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
      ${node.maxRank ? `<span class="ti-dots" style="color:${theme.color}">${dots}</span>` : ""}
    </div>
    <div class="ti-blurb">${node.blurb}</div>
    ${per ? `<div class="ti-effect">Pro Stufe: <b>${per}</b>${total ? ` &middot; Gesamt: <b>${total}</b>` : ""}</div>` : ""}
    ${buy}</div>`;
}

// The whole upgrade phase is the tree now. Called by the loop router for the
// "upgrade" screen (structural rebuild only — pan/zoom patch the transform live).
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
        <defs>
          <filter id="nodeGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.2"/>
          </filter>
        </defs>
        <g id="tree-cam" transform="${cam}">
          <g class="tree-edges">${edges}</g>
          <g class="tree-nodes">${nodes}</g>
        </g>
      </svg>
      <div class="tree-zoom">
        <button class="tz-btn" data-act="treeZoom" data-args="[1.25]" aria-label="Vergrößern">+</button>
        <button class="tz-btn" data-act="treeZoom" data-args="[0.8]" aria-label="Verkleinern">&minus;</button>
        <button class="tz-btn" data-act="treeReset" aria-label="Ansicht zurücksetzen">&#8635;</button>
      </div>
      ${renderTreeInfo()}
      <button class="fight-btn tree-run-btn" data-act="startRun">Lauf starten →</button>
    </div>`;

  attachTreeInteractions();
}

// Recentre + fit the view on the seed.
function applyTreeCam() {
  const cam = document.getElementById("tree-cam");
  if (cam) {
    const t = state.tree;
    cam.setAttribute("transform",
      `translate(${t.tx.toFixed(2)},${t.ty.toFixed(2)}) scale(${t.scale.toFixed(4)})`);
  }
}
// Zoom about a point given in viewBox (tree-space-ish) coords, keeping it fixed.
function treeZoomAt(vx, vy, factor) {
  const t = state.tree;
  const ns = treeClamp(t.scale * factor, 0.32, 2.6);
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
// persist to state.tree, so a later rebuild restores the same view.
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
    // A near-stationary single-pointer tap on a node selects it.
    if (wasSingle && moved < 8 && e.pointerId === downId) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const g = el && el.closest ? el.closest("[data-node]") : null;
      if (g) { state.tree.selected = g.dataset.node; state._structuralDirty = true; }
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
