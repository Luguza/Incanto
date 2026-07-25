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
// Tree geometry — a big, deliberately over-sized web. Seven themed sectors
// (offense, vitality, crit, arcane, ward, sustain, fortune) each FAN OUT from
// the seed into branching sub-paths, and neighbouring sectors are cross-linked,
// so routes weave rather than run in straight lines. Positions are computed from
// {angle, ring} in a large tree-space (seed at TREE_CENTER); the 900-unit SVG
// viewBox is just the pan/zoom window onto it, so the tree dwarfs the screen.
// ---------------------------------------------------------------------------
const TREE_CENTER = 1300;                 // seed sits at the middle of the tree-space
const TREE_VIEW = 900;                     // SVG viewBox size = the pan/zoom window
const TREE_RINGS = { 1: 230, 2: 430, 3: 640, 4: 860, 5: 1050 };

// Each node: title, theme, {angle,ring} placement, maxRank (dots), base cost +
// per-rank cost growth, an `effect` map summed into the stat model, and a blurb
// describing the mechanic (shown on a single click).
const TREE_NODES = {
  root: { title: "Ursprung", theme: "origin", angle: 0, ring: 0, maxRank: 0, cost: 0,
    effect: {}, blurb: "Der Quell deiner Macht. Von hier verzweigen sich alle Pfade." },

  // ── Offense (aufwärts, 270°) — flat & prozentualer Schaden ────────────────
  o1: { title: "Schneide", theme: "offense", angle: 270, ring: 1, maxRank: 5, cost: 30, growth: 1.5,
    effect: { flatDmg: 2 }, blurb: "Schärft deinen Grundschaden." },
  o2: { title: "Zorn", theme: "offense", angle: 255, ring: 2, maxRank: 4, cost: 90, growth: 1.5,
    effect: { pctDmg: 0.06 }, blurb: "Verstärkt allen Schaden prozentual." },
  o3: { title: "Wetzstein", theme: "offense", angle: 285, ring: 2, maxRank: 5, cost: 70, growth: 1.5,
    effect: { flatDmg: 3 }, blurb: "Mehr Grundschaden." },
  o4: { title: "Bruch", theme: "offense", angle: 246, ring: 3, maxRank: 4, cost: 170,
    effect: { flatDmg: 5 }, blurb: "Wuchtiger Grundschaden." },
  o5: { title: "Raserei", theme: "offense", angle: 270, ring: 3, maxRank: 3, cost: 210,
    effect: { pctDmg: 0.08 }, blurb: "Kräftige prozentuale Verstärkung." },
  o6: { title: "Spalter", theme: "offense", angle: 294, ring: 3, maxRank: 3, cost: 200,
    effect: { flatDmg: 6 }, blurb: "Schwerer Grundschaden." },
  o7: { title: "Vernichtung", theme: "offense", angle: 270, ring: 4, maxRank: 2, cost: 460, growth: 1.7,
    effect: { pctDmg: 0.15 }, blurb: "Schlüsselzeichen: gewaltige Schadensverstärkung." },

  // ── Vitality (abwärts, 90°) — flat & prozentuale LP ───────────────────────
  v1: { title: "Zähigkeit", theme: "vitality", angle: 90, ring: 1, maxRank: 5, cost: 25, growth: 1.5,
    effect: { flatHp: 20 }, blurb: "Erhöht deine maximalen Lebenspunkte." },
  v2: { title: "Lebenskraft", theme: "vitality", angle: 75, ring: 2, maxRank: 4, cost: 80, growth: 1.5,
    effect: { pctHp: 0.06 }, blurb: "Mehr Lebenspunkte prozentual." },
  v3: { title: "Zäher Balg", theme: "vitality", angle: 105, ring: 2, maxRank: 5, cost: 65, growth: 1.5,
    effect: { flatHp: 30 }, blurb: "Mehr maximale Lebenspunkte." },
  v4: { title: "Bollwerk", theme: "vitality", angle: 66, ring: 3, maxRank: 4, cost: 150,
    effect: { flatHp: 50 }, blurb: "Eine große Lebensreserve." },
  v5: { title: "Herzblut", theme: "vitality", angle: 90, ring: 3, maxRank: 3, cost: 200,
    effect: { pctHp: 0.08 }, blurb: "Kräftige prozentuale LP." },
  v6: { title: "Wall", theme: "vitality", angle: 114, ring: 3, maxRank: 3, cost: 190,
    effect: { flatHp: 60 }, blurb: "Gewaltige Lebensreserve." },
  v7: { title: "Unsterblichkeit", theme: "vitality", angle: 90, ring: 4, maxRank: 2, cost: 440, growth: 1.7,
    effect: { pctHp: 0.18 }, blurb: "Schlüsselzeichen: gewaltige LP-Verstärkung." },

  // ── Crit (oben rechts, 315°) — Krit-Chance & Krit-Schaden ─────────────────
  c1: { title: "Präzision", theme: "crit", angle: 315, ring: 1, maxRank: 5, cost: 40, growth: 1.5,
    effect: { critChance: 0.04 }, blurb: "Chance, einen kritischen Treffer zu landen." },
  c2: { title: "Wucht", theme: "crit", angle: 300, ring: 2, maxRank: 4, cost: 110, growth: 1.5,
    effect: { critMult: 0.15 }, blurb: "Kritische Treffer schlagen härter zu." },
  c3: { title: "Schärfe", theme: "crit", angle: 330, ring: 2, maxRank: 4, cost: 95, growth: 1.5,
    effect: { critChance: 0.05 }, blurb: "Mehr Krit-Chance." },
  c4: { title: "Zermalmen", theme: "crit", angle: 296, ring: 3, maxRank: 3, cost: 210,
    effect: { critMult: 0.2 }, blurb: "Kräftiger Krit-Schaden." },
  c5: { title: "Adlerauge", theme: "crit", angle: 315, ring: 3, maxRank: 3, cost: 220,
    effect: { critChance: 0.06 }, blurb: "Deutlich mehr Krit-Chance." },
  c6: { title: "Grausamkeit", theme: "crit", angle: 334, ring: 3, maxRank: 3, cost: 200,
    effect: { critMult: 0.18 }, blurb: "Härtere kritische Treffer." },
  c7: { title: "Hinrichtung", theme: "crit", angle: 315, ring: 4, maxRank: 2, cost: 480, growth: 1.7,
    effect: { critMult: 0.4 }, blurb: "Schlüsselzeichen: verheerender Krit-Schaden." },

  // ── Arcane (oben links, 225°) — Zaubermacht & Flächenwirkung ──────────────
  a1: { title: "Fokus", theme: "arcane", angle: 225, ring: 1, maxRank: 4, cost: 60, growth: 1.5,
    effect: { pctDmg: 0.05 }, blurb: "Arkane Bündelung — verstärkt deinen Schaden." },
  a2: { title: "Resonanz", theme: "arcane", angle: 210, ring: 2, maxRank: 3, cost: 130,
    effect: { pctDmg: 0.06 }, blurb: "Mehr prozentualer Schaden." },
  a3: { title: "Kanalisierung", theme: "arcane", angle: 240, ring: 2, maxRank: 3, cost: 120,
    effect: { flatDmg: 4 }, blurb: "Arkane Wucht auf deinen Schaden." },
  a4: { title: "Überladung", theme: "arcane", angle: 216, ring: 3, maxRank: 2, cost: 260,
    effect: { pctDmg: 0.09 }, blurb: "Kräftige Schadensverstärkung." },
  a5: { title: "Splitterzauber", theme: "arcane", angle: 225, ring: 4, maxRank: 2, cost: 320, growth: 1.8,
    effect: { aoeExtra: 1 }, blurb: "Dein Zauber trifft ein zusätzliches Skelett (mehr Kacheln)." },
  a6: { title: "Kettenblitz", theme: "arcane", angle: 225, ring: 5, maxRank: 1, cost: 700, growth: 1.8,
    effect: { aoeExtra: 1 }, blurb: "Schlüsselzeichen: trifft ein weiteres Ziel — reine Verwüstung." },

  // ── Ward (links, 180°) — Schilde, Dornen, Fehlschlag-Schutz ───────────────
  w1: { title: "Schildzauber", theme: "ward", angle: 180, ring: 1, maxRank: 4, cost: 70, growth: 1.55,
    effect: { shieldChance: 0.14, shieldAmount: 5, shieldMax: 6 },
    blurb: "Manche Zauber gewähren einen Schild, der erlittenen Schaden absorbiert." },
  w2: { title: "Dornen", theme: "ward", angle: 165, ring: 2, maxRank: 4, cost: 130,
    effect: { thorns: 0.2 }, blurb: "Wirft einen Teil des erlittenen Schadens auf den Angreifer zurück." },
  w3: { title: "Aegis", theme: "ward", angle: 195, ring: 2, maxRank: 3, cost: 150,
    effect: { shieldChance: 0.08, shieldAmount: 5, shieldMax: 6 }, blurb: "Häufigere Schilde." },
  w4: { title: "Stacheln", theme: "ward", angle: 162, ring: 3, maxRank: 3, cost: 230,
    effect: { thorns: 0.25 }, blurb: "Stärkere Schadensreflexion." },
  w5: { title: "Barriere", theme: "ward", angle: 186, ring: 3, maxRank: 3, cost: 240,
    effect: { shieldChance: 0.1, shieldAmount: 6, shieldMax: 8 }, blurb: "Stärkere, häufigere Schilde." },
  w6: { title: "Schutzzauber", theme: "ward", angle: 180, ring: 4, maxRank: 3, cost: 320, growth: 1.6,
    effect: { spellFailProt: 0.2 }, blurb: "Schlüsselzeichen: Chance, den Fehlschlag-Rückschlag ganz abzuwehren." },

  // ── Sustain (rechts, 0°) — LP-Regeneration & Lebensraub ───────────────────
  s1: { title: "Genesung", theme: "sustain", angle: 0, ring: 1, maxRank: 5, cost: 45, growth: 1.5,
    effect: { regen: 0.5 }, blurb: "Regeneriert langsam Lebenspunkte im Kampf." },
  s2: { title: "Aderlass", theme: "sustain", angle: 345, ring: 2, maxRank: 4, cost: 130,
    effect: { leech: 0.06 }, blurb: "Heilt dich für einen Teil des Zauberschadens." },
  s3: { title: "Balsam", theme: "sustain", angle: 15, ring: 2, maxRank: 4, cost: 110,
    effect: { regen: 0.8 }, blurb: "Stärkere LP-Regeneration." },
  s4: { title: "Blutzoll", theme: "sustain", angle: 338, ring: 3, maxRank: 3, cost: 230,
    effect: { leech: 0.08 }, blurb: "Mehr Lebensraub." },
  s5: { title: "Lebensquell", theme: "sustain", angle: 0, ring: 3, maxRank: 3, cost: 220,
    effect: { regen: 1.2 }, blurb: "Kräftige LP-Regeneration." },
  s6: { title: "Zehrung", theme: "sustain", angle: 22, ring: 3, maxRank: 3, cost: 210,
    effect: { leech: 0.07 }, blurb: "Zusätzlicher Lebensraub." },
  s7: { title: "Vampirismus", theme: "sustain", angle: 0, ring: 4, maxRank: 2, cost: 480, growth: 1.7,
    effect: { leech: 0.15 }, blurb: "Schlüsselzeichen: gewaltiger Lebensraub." },

  // ── Fortune (unten rechts, 45°) — Gold & Lauftempo ────────────────────────
  f1: { title: "Glückssträhne", theme: "fortune", angle: 45, ring: 1, maxRank: 5, cost: 50, growth: 1.5,
    effect: { coinMult: 0.1 }, blurb: "Mehr Gold für richtig gelöste Vokabeln." },
  f2: { title: "Flinkheit", theme: "fortune", angle: 30, ring: 2, maxRank: 3, cost: 90,
    effect: { walkMult: 0.08 }, blurb: "Der Held schreitet zügiger durch den Gang." },
  f3: { title: "Wohlstand", theme: "fortune", angle: 60, ring: 2, maxRank: 4, cost: 100,
    effect: { coinMult: 0.12 }, blurb: "Mehr Gold aus dem Lernen." },
  f4: { title: "Windschritt", theme: "fortune", angle: 26, ring: 3, maxRank: 2, cost: 200,
    effect: { walkMult: 0.1 }, blurb: "Deutlich schnelleres Vorankommen." },
  f5: { title: "Reichtum", theme: "fortune", angle: 45, ring: 3, maxRank: 3, cost: 210,
    effect: { coinMult: 0.15 }, blurb: "Deutlich mehr Gold." },
  f6: { title: "Schatzgespür", theme: "fortune", angle: 64, ring: 3, maxRank: 2, cost: 220,
    effect: { coinMult: 0.15 }, blurb: "Noch mehr Gold aus dem Lernen." },
};

// Undirected connections. Each sector FANS from its tier-1 node into two (or
// more) sub-branches, and adjacent sectors are cross-linked at their nearest
// tips, so the tree weaves into a web instead of running as straight spokes.
const TREE_EDGES = [
  // seed → each sector root
  ["root", "o1"], ["root", "v1"], ["root", "c1"], ["root", "a1"],
  ["root", "w1"], ["root", "s1"], ["root", "f1"],
  // inner ring weaving the tier-1 nodes together
  ["o1", "c1"], ["c1", "s1"], ["s1", "f1"], ["f1", "v1"], ["w1", "a1"], ["a1", "o1"],
  // Offense fan
  ["o1", "o2"], ["o1", "o3"], ["o2", "o4"], ["o2", "o5"], ["o3", "o5"], ["o3", "o6"],
  ["o5", "o7"], ["o6", "o7"],
  // Vitality fan
  ["v1", "v2"], ["v1", "v3"], ["v2", "v4"], ["v2", "v5"], ["v3", "v5"], ["v3", "v6"],
  ["v5", "v7"], ["v6", "v7"],
  // Crit fan
  ["c1", "c2"], ["c1", "c3"], ["c2", "c4"], ["c2", "c5"], ["c3", "c5"], ["c3", "c6"],
  ["c5", "c7"], ["c6", "c7"],
  // Arcane fan (deep AoE keystones)
  ["a1", "a2"], ["a1", "a3"], ["a2", "a4"], ["a3", "a4"], ["a4", "a5"], ["a5", "a6"],
  // Ward fan
  ["w1", "w2"], ["w1", "w3"], ["w2", "w4"], ["w3", "w5"], ["w2", "w5"], ["w5", "w6"], ["w4", "w6"],
  // Sustain fan
  ["s1", "s2"], ["s1", "s3"], ["s2", "s4"], ["s3", "s5"], ["s3", "s6"], ["s5", "s7"], ["s4", "s7"],
  // Fortune fan
  ["f1", "f2"], ["f1", "f3"], ["f2", "f4"], ["f3", "f5"], ["f3", "f6"],
  // cross-links between neighbouring sectors (the web)
  ["o3", "c2"], ["c3", "s2"], ["s3", "f2"], ["f3", "v2"], ["w3", "a2"], ["a3", "o4"],
];

// The first release used different node ids; this maps those onto their closest
// equivalent in the current tree so saved progress isn't lost across the rename.
const LEGACY_NODE_IDS = {
  dmg1: "o1", dmg2: "o2", dmg3: "o4", dmg4: "o7",
  hp1: "v1", hp2: "v2", hp3: "v4", hp4: "v7",
  crit1: "c1", crit2: "c2", crit3: "c5", crit4: "c7",
  sus1: "s1", sus2: "s2", sus3: "s5", sus4: "s7",
  for1: "f1", for2: "f2", for3: "f5",
  ward1: "w1", ward2: "w2", ward3: "w5", ward4: "w6",
  arc1: "a1", arc2: "a5", arc3: "a6",
};

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

function nodeRadius(id) { return id === "root" ? 34 : 28; }

function initTreeView(resetSelection) {
  const s = 0.92;                       // default zoom — shows the seed + inner rings big
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
  const selected = state.tree && state.tree.selected === id;
  const R = nodeRadius(id);

  const sel = selected
    ? `<circle class="n-sel" r="${R + 7}" fill="none" stroke="#eafffe" stroke-width="3"/>`
    : "";

  let disc, glyph, dots = "";
  if (!revealed) {
    disc = `<circle class="n-disc" r="${R}" fill="#120e1c" stroke="#332e46" stroke-width="3"/>`;
    glyph = `<text class="n-q" y="9" text-anchor="middle" fill="#4a4560">?</text>`;
  } else {
    // Crisp, flat discs — a filled inner core for purchased nodes, hollow for
    // affordable-but-unbought. No blur (clean borders).
    const fill = purchased ? `rgba(${theme.glow},0.25)` : "#141020";
    disc = `<circle class="n-disc" r="${R}" fill="${fill}" stroke="${theme.color}" ` +
      `stroke-width="${purchased ? 4 : 3}" opacity="${purchased ? 1 : 0.85}"/>` +
      (purchased ? `<circle r="${R - 6}" fill="none" stroke="${theme.color}" stroke-width="1.5" opacity="0.45"/>` : "") +
      (maxed && id !== "root" ? `<circle r="${R + 4.5}" fill="none" stroke="${theme.color}" stroke-width="1.5" opacity="0.6"/>` : "");
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
  const ns = treeClamp(t.scale * factor, 0.28, 3.2);
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
