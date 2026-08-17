"use strict";
// ==============================================================================
// skilltree.js — the Path-of-Exile-style rune upgrade tree that replaces the old
// two-button shop. The tree is AUTHORED, not scattered: twelve arms grow out of
// the seed in a fixed, readable shape, and every node's place in that shape is a
// design decision rather than the output of a growth simulation.
//
//   root ──► 12 arms, alternating around the circle:
//              6 SPELL arms  (one per page of the book)
//              6 GENERIC arms (might, vigour, precision, sustain, guard, fortune)
//
//   Every arm has the SAME skeleton, so the tree teaches itself:
//     rings 1–4   prelude — four cheap, thematically fitting generic nodes.
//                 On a spell arm these are the toll you pay on the way to the
//                 page; on a generic arm they are the arm's own bread and butter.
//     ring 5      the ARM'S KEY — on a spell arm the unique node that unlocks
//                 that spell (Feuerball, the starter, gets a keystone instead);
//                 on a generic arm a named notable of the same weight.
//     rings 6+    the key fans into ASPECT BRANCHES — five on a spell arm
//                 (raw power · the spell's own % damage · its shape/AOE · crit ·
//                 leech-and-life), three on a generic arm.
//     ring 11–14  every aspect branch forks into two twigs, each at its own depth.
//     ring 15–19  a twig runs out and stops — twig A on the outer rings, carrying
//                 a unique KEYSTONE; twig B one to three rings shorter. Five of
//                 those twig-B ends out on the generic arms are the Dornenkrone
//                 caches. Dead-end offshoots of one or two nodes hang off
//                 branches the whole way out.
//
// That skeleton is BOOKKEEPING, not geometry. A node's ring fixes its cost and
// its value and nothing else; where it is DRAWN comes from the layout pass under
// REST_LEN, which aims at one thing — even spacing everywhere, no clumps and no
// voids — and gets its organic look from the fact that no two subtrees are the
// same size rather than from noise sprinkled on top.
//
// That gives ~1050 nodes with an actual grammar: reach a page, then choose which
// facet of it to sharpen. This module owns the layout, the derived stat model
// (recomputeMods), purchase/reveal logic, and the SVG screen. Loads after
// spells.js (it reads SPELL_BY_ID) and screens.js, so it can define the global
// `renderUpgradeFull` the loop router calls for the "upgrade" screen.
// ==============================================================================

// ---------------------------------------------------------------------------
// Themes — a node's colour and glyph come from WHAT IT DOES, not from which arm
// it grew on, so a wall of orange chevrons reads as "damage" wherever you find
// it and the six spell colours match their page in the book (CONFIG.colors.spell).
// `label` is the theme's name in the player's language: the ledger screen groups
// a build by theme (see stats.js), and that name belongs next to the colour it
// is drawn in rather than in a second table somewhere else.
// ---------------------------------------------------------------------------
const TREE_THEMES = {
  origin:    { color: "#eafffe", glow: "234,255,254", label: "Ursprung"     }, // the central seed
  might:     { color: "#ff7043", glow: "255,112,67",  label: "Macht"        }, // flat + % damage
  vigor:     { color: "#5ecf8f", glow: "94,207,143",  label: "Lebenskraft"  }, // flat + % HP
  crit:      { color: "#f2c14e", glow: "242,193,78",  label: "Präzision"    }, // crit chance + crit damage
  sustain:   { color: "#e5679a", glow: "229,103,154", label: "Zehrung"      }, // regen + life leech
  guard:     { color: "#4de3e0", glow: "77,227,224",  label: "Bewahrung"    }, // shields + fail-protection
  // Armour is guard's cousin and deliberately not guard's colour: a shield is a
  // thing that appears and is spent, plate is a thing you are wearing. Steel,
  // and the same steel a mitigated hit pops in on the canvas
  // (CONFIG.colors.dmgFloat.armored), so "that number was bitten into" reads the
  // same in the hall and in the tree.
  armor:     { color: "#b0c0d0", glow: "176,192,208", label: "Panzerung"    }, // damage taken, turned aside
  fortune:   { color: "#d9a441", glow: "217,164,65",  label: "Fortuna"      }, // gold + walk speed
  focus:     { color: "#c08cff", glow: "192,140,255", label: "Sammlung"     }, // cast speed
  thorn:     { color: "#ff3b30", glow: "255,59,48",   label: "Dornen"       }, // the five unique thorn caches
  // One per page of the book — same colour the spell burns in on the canvas.
  fireball:  { color: "#f2a83a", glow: "242,168,58",  label: "Feuerball"    },
  lightning: { color: "#7fb8ff", glow: "127,184,255", label: "Blitzschlag"  },
  frost:     { color: "#79d8ee", glow: "121,216,238", label: "Frostkegel"   },
  meteor:    { color: "#e5673a", glow: "229,103,58",  label: "Meteoriten"   },
  shield:    { color: "#9a8ff0", glow: "154,143,240", label: "Bannschild"   },
  heal:      { color: "#6ed08a", glow: "110,208,138", label: "Heilwort"     },
};

// Small runic line-glyphs in local coords (centred on 0,0, ~±13).
//
// Written as PRIMITIVES rather than as SVG markup because the same glyph now
// has to be drawn two ways: stroked onto the tree's canvas (see the note above
// drawTree — the web can't be SVG any more) and emitted as SVG for the little
// runes in the info panel and on the Werte screen. One authored shape, two
// renderers (glyphSvg / glyphPath), so the two can never drift apart.
//   ["c", cx, cy, r]                 circle
//   ["l", x1, y1, x2, y2]            line
//   ["p", x, y, x, y, …]             polyline (open)
//   ["g", x, y, x, y, …]             polygon (closed)
//   ["d", "M…"]                      path data, for the curved ones
const RUNE_GLYPHS = {
  origin:    [["c",0,0,10],["c",0,0,4],["l",0,-10,0,-14],["l",0,10,0,14],["l",-10,0,-14,0],["l",10,0,14,0]],
  might:     [["p",-9,4,0,-7,9,4],["p",-9,10,0,-1,9,10]],
  vigor:     [["l",0,-11,0,11],["l",-10,-1,10,-1],["l",-5,-11,5,-11]],
  crit:      [["g",0,-12,2.6,-2.6,12,0,2.6,2.6,0,12,-2.6,2.6,-12,0,-2.6,-2.6]],
  sustain:   [["d","M0,-11 C7,-3 7,7 0,10 C-7,7 -7,-3 0,-11 Z"]],
  guard:     [["g",0,-11,9,-6,9,4,0,11,-9,4,-9,-6]],
  // A banded plate with its rivets — squared off where `guard`'s shield is
  // pointed, so the two read as related without either being mistaken for the
  // other at the size a rune is actually drawn.
  armor:     [["g",-9,-10,9,-10,9,10,-9,10],["l",-9,-3,9,-3],["l",-9,3,9,3],["c",0,-6.5,1.3],["c",0,6.5,1.3]],
  fortune:   [["c",0,0,9],["g",0,-4,4,0,0,4,-4,0]],
  focus:     [["c",0,0,4.5],["l",0,-6.5,0,-12],["l",0,6.5,0,12],["l",-6.5,0,-12,0],["l",6.5,0,12,0],["l",-4.6,-4.6,-8.5,-8.5],["l",4.6,4.6,8.5,8.5]],
  thorn:     [["d","M-10,9 C-4,4 4,-4 10,-9"],["l",-6,5,-9,-1],["l",-1,0,2,-6],["l",4,-5,1,-11],["l",-3,2,-6,8],["l",2,-3,5,3]],
  // The six pages. Each is the spell's silhouette in one or two strokes.
  fireball:  [["c",0,2,6.5],["d","M-6,-4 C-3,-9 -1,-8 0,-12 C1,-8 3,-9 6,-4"]],
  lightning: [["p",3,-12,-5,-1,1,-1,-3,12],["l",8,-8,11,-11],["l",-8,8,-11,11]],
  frost:     [["l",0,-12,0,12],["l",-10.4,-6,10.4,6],["l",-10.4,6,10.4,-6],["p",-3,-8,0,-11,3,-8],["p",-3,8,0,11,3,8]],
  meteor:    [["c",2,2,5.5],["l",-4,-4,-11,-11],["l",-7,0,-12,-4],["l",0,-7,-4,-12]],
  shield:    [["d","M0,-11 L9,-7 L9,1 C9,7 4,10 0,12 C-4,10 -9,7 -9,1 L-9,-7 Z"],["l",0,-5,0,6]],
  heal:      [["d","M0,11 C-9,4 -11,-3 -7,-8 C-4,-11 -1,-10 0,-6 C1,-10 4,-11 7,-8 C11,-3 9,4 0,11 Z"]],
};

// The glyph as SVG elements. Stroke is inherited from the wrapping <g>, so
// colour is set once per rune.
function glyphSvg(theme) {
  let s = "";
  for (const [k, ...v] of RUNE_GLYPHS[theme]) {
    if (k === "c") { s += `<circle cx="${v[0]}" cy="${v[1]}" r="${v[2]}"/>`; continue; }
    if (k === "l") { s += `<line x1="${v[0]}" y1="${v[1]}" x2="${v[2]}" y2="${v[3]}"/>`; continue; }
    if (k === "d") { s += `<path d="${v[0]}"/>`; continue; }
    const pts = [];
    for (let i = 0; i < v.length; i += 2) pts.push(v[i] + "," + v[i + 1]);
    s += k === "p" ? `<polyline points="${pts.join(" ")}"/>` : `<polygon points="${pts.join(" ")}"/>`;
  }
  return s;
}

// The same glyph as one Path2D, built once per theme and stroked straight onto
// the canvas. Sixteen of these exist, so they are worth keeping.
const GLYPH_PATHS = {};
function glyphPath(theme) {
  if (GLYPH_PATHS[theme]) return GLYPH_PATHS[theme];
  const p = new Path2D();
  for (const [k, ...v] of RUNE_GLYPHS[theme]) {
    if (k === "c") { p.moveTo(v[0] + v[2], v[1]); p.arc(v[0], v[1], v[2], 0, Math.PI * 2); continue; }
    if (k === "l") { p.moveTo(v[0], v[1]); p.lineTo(v[2], v[3]); continue; }
    if (k === "d") { p.addPath(new Path2D(v[0])); continue; }
    p.moveTo(v[0], v[1]);
    for (let i = 2; i < v.length; i += 2) p.lineTo(v[i], v[i + 1]);
    if (k === "g") p.closePath();
  }
  return (GLYPH_PATHS[theme] = p);
}

// ---------------------------------------------------------------------------
// Geometry — the tree lives in a large tree-space (seed at TREE_CENTER); the
// SVG viewBox is just the pan/zoom window onto it. A node's place is
// fully determined by three authored numbers: which arm it's on, its RING
// (distance from the seed = tier), and its lateral fraction across the arm's
// wedge. Nothing is random, so ids stay stable and saves keep working.
// ---------------------------------------------------------------------------
const TREE_CENTER = 2600;      // seed sits at the middle of the tree-space
const TREE_VIEW = 900;         // the window the default zoom + zoom limits are authored against
const HOLE = 165;              // radius of ring 1 (clear space around the seed)
const NODE_STEP = 96;          // radial distance between consecutive rings
const PRELUDE_RINGS = 4;       // rings 1..4 — the generic run-up on every arm
const KEY_RING = 5;            // the spell unlock / arm notable
const FAN_RING = 6;            // first ring of the aspect branches
const FORK_RING = 13;          // roughly where an aspect branch splits (±1, per branch)
const TIP_RING = 19;           // the outermost ring — keystones live here
const SPUR_STEM = 0.6;         // chance an aspect branch's stem sprouts a dead-end offshoot
const SPUR_TWIG = 0.45;        // …and the (lower) chance a twig does, out where space is dearer

// --- how the tree is DRAWN -------------------------------------------------
// A node's ring is bookkeeping: it sets the node's cost and its value, and
// nothing else. Position comes from a two-step layout that aims for one thing —
// EVEN SPACING everywhere, with no clumps and no voids.
//
//   1. every subtree is given a slice of the circle proportional to how many
//      chain-ends it contains, so a fat arm gets more room than a thin one and
//      no two subtrees can ever overlap (that's what keeps edges from crossing);
//   2. the whole thing is then relaxed under three forces — springs along the
//      edges holding chains at one step, short-range repulsion pushing every
//      node off its neighbours, and a weak radial pull toward its own ring.
//
// The relaxation is what makes it look grown rather than drafted: it spreads
// nodes into whatever space is going spare, and because subtrees differ in size
// it never settles anywhere symmetrical. It is fully deterministic — the tree
// must be pixel-identical on every load, because saves name its nodes.
const REST_LEN = NODE_STEP;        // how long a spring wants its edge to be
const REPEL_RADIUS = NODE_STEP * 1.35;  // how far a node shoves its neighbours away
const K_SPRING = 0.3;              // edge springs — hold a chain together
const K_REPEL = 0.55;              // node repulsion — the thing that evens the density out
const K_RADIAL = 0.05;             // pull back toward the node's own ring — weak, so angles are free to redistribute
const K_RADIAL_KEY = 0.28;         // …but the twelve keys hold their ring firmly: they are the map's landmarks
const RELAX_PASSES = 90;             // the layout is fully settled by ~60; this leaves margin
const MAX_NUDGE = 14;              // per-pass movement cap, so the relaxation can't explode
const RELAX_CELLS = 34;            // repulsion lookup grid; RELAX_SPAN/RELAX_CELLS must stay >= REPEL_RADIUS
const RELAX_SPAN = 5200;

// HOW FAST A NODE GROWS WITH ITS DEPTH. This is the SHAPE of the whole power
// curve, and it is the number that decides whether growing the tree is felt in
// the hall.
//
// It used to be written as a straight line — `1 + 0.14 * (ring - 1)`, a ring-19
// node worth 3,5 shallow ones — and that turned out to be the reason the game
// stopped being about stats. The totals in CONFIG.treeTotals are divided across
// the tree in proportion to these weights, so a flat curve leaves most of the
// supply in the SHALLOW rings; and gold buys cheapest-reachable-first, so the
// shallow rings are exactly what a player owns early. Measured with
// tools/stat-supply.mjs: ten percent of the gold held a THIRD of the flat damage
// supply, which was already enough to clear camps meant to be a wall. Past that
// the tree had little left to pay out, and the run came down to whether the
// player could match pairs.
//
// A STRAIGHT LINE CANNOT FIX THAT, however steep it is drawn, and that is worth
// writing down because it was tried first. A cheapest-first build reaches about
// ring 11 at a tenth of the gold; on a line, the ratio between a ring-17 node
// and a ring-8 one tends to 16/7 — barely more than double — no matter how large
// the slope. So the nodes just past where the money runs out can never be worth
// much more than the ones just before it, and the curve stays flat where it
// matters. A POWER curve has no such ceiling: at ring^1.7 the same pair is 3,4
// apart and the outer third of the tree holds most of everything.
//
// So: a node's value is its ring raised to this power (times its archetype's own
// `ringVal`, for a grain that has to stay coarse). Ring 19 is worth ~150 ring-1
// nodes — which reads extreme until you remember it is also the ring you can
// only reach by buying eighteen nodes' worth of path to get there, and that
// applyTreeTotals normalises the whole thing back onto CONFIG.treeTotals
// afterwards. What the exponent sets is not how much power exists; it is WHERE
// IN THE TREE that power sits.
//
// THE SHALLOWEST NODES ARE MEANT TO BE NEARLY NOTHING, and that was checked
// rather than assumed. `ring^1.7` runs 1 to 150 across the tree, so a ring-1
// Zähigkeit grants "+0,1 LP" — it passes the no-zeros guard and still buys
// nothing anybody can feel, which looks like a reason to start the curve a ring
// or three inside the seed (`(ring + 3)^1.7`). Measured, that trade is bad both
// ways: at 2.000 gold it moved the hero from 20 damage to 28 — six study
// sessions still buying almost nothing either way — while at 40.000 it handed
// the mid build nine more camps and put the corridor's gate back where it was
// before any of this. The early game is slow because the tree is 250–300
// sessions long, not because of where the curve starts; the fix for the first
// purchase feeling thin is the Werte screen's meters, which say what a stat is
// out of what the tree holds.
const VAL_RING_POW = 1.7;
// Cost grows SUB-linearly with the ring (ring^0.9). Deep nodes are still much
// dearer per point than shallow ones, but the curve never runs away the way a
// per-ring exponential does across twenty rings.
const COST_RING_POW = 0.9;
const RANK_GROWTH = 1.45;      // default cost multiplier per extra rank of a node

const UNLOCK_COST = 46;        // base cost of a spell's unlock node (ring 5 ≈ 196 gold)
const NOTABLE_COST = 40;       // base cost of a generic arm's ring-5 notable
const KEYSTONE_COST = 90;      // base cost of a branch-tip keystone (ring 20 ≈ 1250 gold)
const THORN_COST = 70;         // base cost of a Dornenkrone cache
const THORN_VALUE = 0.10;      // reflected fraction each cache grants (five exist → 50% total)

// Stats counted in whole bodies (an extra lightning hop, an extra meteor). They
// grant exactly 1 wherever they're planted — half a skeleton is not a thing —
// so a deep one simply costs more.
const COUNT_STATS = { chainLightning: 1, countMeteor: 1 };

// Stats that do NOT ride the ring curve, on an archetype or on a unique. Two
// kinds, for the same underlying reason — the authored number IS the design, and
// scaling it by depth would be scaling something that has no smaller version.
// A hop is a whole body. A Dornenkrone is one of exactly five equal caches, and
// the Werte screen says so in words ("je 10 %"); put them on the curve and the
// five stop being equal and the sentence stops being true.
const FIXED_STATS = { ...COUNT_STATS, thorns: 1 };

// ---------------------------------------------------------------------------
// Archetypes — the reusable node types. A branch is written as a short list of
// these that it cycles through outward, so "this branch is about crit" is a
// property of the branch, not of thirty hand-written nodes.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Where the balance lives: CONFIG.treeTotals.
//
// The A entries below, and the keystones further down, are authored as RELATIVE
// weights — "a Zähigkeit node is worth about six Schneide nodes" — because that
// is the judgement a designer can make while writing a thousand nodes. How much
// the whole tree comes to is a different question, and it is answered in one
// place: CONFIG.treeTotals says the tree contains exactly +1.200 LP, exactly
// +60 % Krit-Chance, and so on. applyTreeTotals divides each of those across the
// nodes that carry it, in proportion to their weights, while the tree is built.
//
// So every stat has a maximum again — but it bounds what EXISTS instead of
// clipping what you carry, which is why nothing has to be bent at runtime: a
// node always pays exactly what it prints, and the ceiling is simply the end of
// the supply. Being additive, the pools slow down by themselves — the tenth
// +30 LP is the same +30 and a much smaller share of the pool it joins.
//
// To rebalance: edit CONFIG.treeTotals, run `node tools/stat-supply.mjs`.
const A = {
  // A `blurb` is for what the effect line CANNOT say. "Verstärkt allen Schaden
  // prozentual" under a line reading "+0,6 % Schaden" is the tooltip talking to
  // itself, and on a phone it pushes the number and the price further down the
  // card for nothing. So most archetypes carry no blurb at all — the ones that
  // do are the ones where the stat's name is not the whole story: where in the
  // three stages a node lands, what a fraction is a fraction OF, what a chance
  // is a chance AGAINST.
  //
  // THE THREE STAGES OF DAMAGE. A hit is built in this order and no other:
  //
  //   1. KERN        (heroBaseDmg + flatBase) × (1 + pctBase)
  //   2. VERSTÄRKUNG × (1 + pctDmg) × the page's own factor × its sigils
  //   3. ZUSCHLAG    + flatDmg — added last, after every multiplier
  //
  // Stage 3 is why the split exists. A node that reads "+5 Schaden je Treffer"
  // puts exactly 5 on the number that pops over a skeleton — on every page of
  // the book, at any depth of the tree, forever. Which stage a node feeds is the
  // one thing its number can't tell you, so these three keep a blurb.
  dmgBaseFlat:{ stat: "flatBase",   theme: "might",   base: 1.5,   cost: 16, maxRank: 3,
                title: "Kernschliff",   blurb: "Vertieft den Kern, aus dem jeder Zauber gerechnet wird — alles danach vervielfacht ihn." },
  dmgBasePct: { stat: "pctBase",    theme: "might",   base: 0.02,  cost: 22, maxRank: 3,
                title: "Härtung",       blurb: "Wächst den Kern, bevor irgendein Faktor darauf greift." },
  dmgFlat:    { stat: "flatDmg",    theme: "might",   base: 2.5,   cost: 15, maxRank: 3,
                title: "Schneide",      blurb: "Kommt ganz zuletzt obendrauf, nach allen Faktoren." },
  dmgPct:     { stat: "pctDmg",     theme: "might",   base: 0.025, cost: 22, maxRank: 3,
                title: "Zorn" },
  hpFlat:     { stat: "flatHp",     theme: "vigor",   base: 24,    cost: 14, maxRank: 3,
                title: "Zähigkeit" },
  hpPct:      { stat: "pctHp",      theme: "vigor",   base: 0.04,  cost: 20, maxRank: 3,
                title: "Lebenskraft" },
  // Panzerung — the one defensive stat that MULTIPLIES the pool instead of
  // adding to it, which is why the blurb names the curve rather than the number:
  // "+0,4 Rüstung" is meaningless on its own and the Werte screen is where the
  // reduction it currently buys is actually read off (see stats.js). Supply is
  // wide but confined to the three arms that already carry defence — Abwehr,
  // Zähigkeit and Bannschild — so plate stays a direction a build commits to.
  armor:      { stat: "armor",      theme: "armor",   base: 1.1,   cost: 24, maxRank: 3,
                title: "Panzerung",     blurb: "Wehrt einen Anteil jedes gegnerischen Schlages ab. Je mehr du trägst, desto größer der Anteil — der Rückschlag eines falschen Zeichens bleibt davon unberührt." },
  critChance: { stat: "critChance", theme: "crit",    base: 0.02,  cost: 22, maxRank: 3,
                title: "Präzision" },
  critMult:   { stat: "critMult",   theme: "crit",    base: 0.09,  cost: 24, maxRank: 3,
                title: "Wucht" },
  // Armour penetration — the counter-stat to CONFIG.armorK. Its supply is
  // deliberately narrow (the Macht arm's Zermalmen branch, two keystones and
  // Falkenauge), so shredding plate is a detour a build chooses, like Dornen.
  armorPen:   { stat: "armorPen",   theme: "might",   base: 0.25,  cost: 24, maxRank: 3,
                title: "Durchschlag",   blurb: "Zieht von der Panzerung des Getroffenen ab." },
  regen:      { stat: "regen",      theme: "sustain", base: 1.6,   cost: 20, maxRank: 3,
                title: "Genesung" },
  leech:      { stat: "leech",      theme: "sustain", base: 0.025, cost: 26, maxRank: 3,
                title: "Aderlass",      blurb: "Ein Anteil deines Zauberschadens, der dich heilt." },
  coin:       { stat: "coinMult",   theme: "fortune", base: 0.05,  cost: 20, maxRank: 3,
                title: "Glückssträhne", blurb: "Gilt für richtig gelöste Vokabeln." },
  walk:       { stat: "walkMult",   theme: "fortune", base: 0.04,  cost: 22, maxRank: 3,
                title: "Flinkheit" },
  failProt:   { stat: "spellFailProt", theme: "guard", base: 0.035, cost: 28, maxRank: 2, growth: 1.6,
                title: "Schutzzauber",  blurb: "Chance, den Rückschlag eines Fehlschlags ganz abzuwehren." },
  haste:      { stat: "castHaste",  theme: "focus",   base: 0.015, cost: 26, maxRank: 2, growth: 1.6,
                title: "Zauberhast" },
  shield:     { special: "shield",  theme: "guard",   cost: 26, maxRank: 3,
                title: "Schildzauber",  blurb: "Manche Zauber gewähren einen absorbierenden Schild." },
};

// Per-spell archetypes are built from the registry so a page and its nodes can
// never drift apart (see spells.js — dmgKey / paramKey).
const SPELL_LORE = {
  fireball:  { adj: "Flammen", word: "Glut",  akk: "den Feuerball" },
  lightning: { adj: "Sturm",   word: "Sturm", akk: "den Blitzschlag" },
  frost:     { adj: "Frost",   word: "Frost", akk: "den Frostkegel" },
  meteor:    { adj: "Stern",   word: "Stern", akk: "den Meteoritenschauer" },
  shield:    { adj: "Bann",    word: "Bann",  akk: "den Bannschild" },
  heal:      { adj: "Segens",  word: "Segen", akk: "das Heilwort" },
};
function sigil(id) {
  const L = SPELL_LORE[id];
  return { stat: SPELL_BY_ID[id].dmgKey, theme: id, base: 0.06, cost: 24, maxRank: 3,
    title: `${L.adj}zeichen`, blurb: `Verstärkt ${L.akk}.` };
}
// A "one more body" node: one rank, no scaling, and dear enough that each extra
// hop/rock is a real decision rather than a rounding error.
function bodyNode(stat, theme, title, blurb) {
  return { stat, theme, base: 1, cost: 55, maxRank: 1, growth: 1, title, blurb };
}
// A unique — a keystone, a notable, an unlock, a thorn cache. Fixed value (it
// already sits at a fixed ring), one rank, and its own halo in the SVG.
function uq(theme, title, cost, effect, blurb) {
  return { unique: true, theme, title, cost, effect, blurb, maxRank: 1, growth: 1 };
}

// ---------------------------------------------------------------------------
// Branch factories shared by the four damage-spell arms. Each spell arm fans
// into the same five aspects, so a player who has learned one page knows where
// to look on the next — only the middle branch (the spell's own shape) differs.
// ---------------------------------------------------------------------------
function bRawPower(L) {
  return { title: "Rohe Kraft", arch: [A.dmgBaseFlat, A.dmgPct, A.dmgFlat],
    tip: uq("might", `${L.word}gewalt`, KEYSTONE_COST, { flatDmg: 16, pctDmg: 0.06 },
      "Kraft, die keiner Seite gehört und darum jede trägt.") };
}
function bSigil(id, L) {
  return { title: "Zeichen", arch: [sigil(id), sigil(id), A.dmgPct],
    tip: uq(id, `Großes ${L.adj}zeichen`, KEYSTONE_COST, { [SPELL_BY_ID[id].dmgKey]: 0.30 },
      `Das vollendete Zeichen. ${L.akk[0].toUpperCase()}${L.akk.slice(1)} zu führen ist nun deine Kunst.`) };
}
function bEdge(L) {
  return { title: "Schärfe", arch: [A.critChance, A.critMult, A.critChance],
    tip: uq("crit", `${L.word}stoß`, KEYSTONE_COST, { critChance: 0.06, critMult: 0.25 },
      "Du siehst die Lücke im Knochen, bevor der Zauber sie findet.") };
}
function bDrain(L) {
  return { title: "Zehrung", arch: [A.leech, A.regen, A.hpFlat],
    tip: uq("sustain", `${L.word}zehrung`, KEYSTONE_COST, { leech: 0.06, regen: 3.2 },
      "Was du verbrennst, kehrt zu dir zurück.") };
}

// ---------------------------------------------------------------------------
// THE ARMS. Twelve of them, alternating spell / generic all the way around, so
// every page of the book has a plain stat arm on either side of it to lean on.
// Spell arms carry twice the angular weight (they hold five branches, generic
// arms three) — see buildSkillTree for how the wedges are cut.
//
// BALANCE, in terms of where a node sits:
//   · everything cheap and generic lives on rings 1–4, so the first few runs are
//     spent broadening rather than committing;
//   · a page of the book costs ~380 gold (four prelude nodes + the key) — about
//     three runs, and each further page costs the same, so which spell you go
//     and fetch first is a real choice and not a queue;
//   · nothing is capped, so the outward push pays in whatever it buys — but the
//     tree only HOLDS so much of each stat (see CONFIG.treeTotals), and breadth is
//     where the pages, the extra bodies hit and the keystones live;
//   · the whole-body nodes (an extra hop, an extra rock) and the keystones sit
//     from ring 13 outward, which is where the run-away power would be if the
//     caps didn't bound it.
// ---------------------------------------------------------------------------
function damageSpellArm(key, id, prelude, shapeBranch) {
  const L = SPELL_LORE[id];
  return { key, kind: "spell", spell: id, theme: id, title: SPELL_BY_ID[id].name,
    prelude, branches: [bRawPower(L), bSigil(id, L), shapeBranch, bEdge(L), bDrain(L)] };
}

const ARMS = [
  // ---- Blitzschlag: reach. Its shape branch buys hops and softens the falloff.
  damageSpellArm("lig", "lightning",
    [A.dmgFlat, A.dmgBaseFlat, A.dmgPct, A.critChance],
    { title: "Wirkung",
      arch: [
        bodyNode("chainLightning", "lightning", "Kettenglied", "Der Blitz springt auf einen weiteren Körper über."),
        { stat: "falloffLightning", theme: "lightning", base: 0.012, cost: 30, maxRank: 2, growth: 1.6,
          title: "Leitfähigkeit", blurb: "Jeder Sprung trägt mehr Kraft weiter als zuvor." },
        sigil("lightning"),
      ],
      tip: uq("lightning", "Gewitterfront", KEYSTONE_COST, { chainLightning: 3, falloffLightning: 0.06 },
        "Kein einzelner Bogen mehr, sondern eine Front, die den ganzen Gang entlangfährt.") }),

  // ---- Might: the plain damage arm. Lifts every page at once.
  { key: "mig", kind: "generic", theme: "might", title: "Macht",
    prelude: [A.dmgBaseFlat, A.dmgFlat, A.dmgBasePct, A.dmgFlat],
    notable: uq("might", "Kriegsherz", NOTABLE_COST, { flatDmg: 8, pctDmg: 0.06 },
      "Ein Herz, das den Kampf sucht. Alles, was du wirkst, wiegt schwerer."),
    branches: [
      { title: "Schneide", arch: [A.dmgFlat, A.dmgFlat, A.dmgBaseFlat],
        tip: uq("might", "Henkersklinge", KEYSTONE_COST, { flatDmg: 20, armorPen: 1.2 },
          "Ein Schnitt, der nicht fragt, wie viel Knochen im Weg steht.") },
      { title: "Zorn", arch: [A.dmgPct, A.dmgBasePct, A.dmgPct],
        tip: uq("might", "Blinder Zorn", KEYSTONE_COST, { pctDmg: 0.18 },
          "Du hörst auf zu zielen und fängst an zu treffen.") },
      // Zermalmen is where armour penetration lives: crushing through the plate
      // is the same idea as crushing through the body behind it.
      { title: "Zermalmen", arch: [A.armorPen, A.dmgFlat, A.critMult],
        tip: uq("might", "Zermalmender Hieb", KEYSTONE_COST, { critMult: 0.35, flatDmg: 8, armorPen: 0.6 },
          "Wenn es kritisch trifft, bleibt nichts stehen, das noch fallen könnte."),
        tip2: uq("thorn", "Dornenkrone", THORN_COST, { thorns: THORN_VALUE },
          "Ein verborgener Hort, nur ein einziges Mal zu heben. Ein Teil jedes erlittenen Schlages fährt in den Angreifer zurück.") },
    ] },

  // ---- Heilwort: the arm that turns spell power back into life.
  { key: "hea", kind: "spell", spell: "heal", theme: "heal", title: "Heilwort",
    prelude: [A.hpFlat, A.regen, A.hpPct, A.leech],
    branches: [
      bRawPower(SPELL_LORE.heal),
      bSigil("heal", SPELL_LORE.heal),
      { title: "Quell", arch: [A.regen, A.leech, A.regen],
        tip: uq("sustain", "Ewige Quelle", KEYSTONE_COST, { regen: 8.0, leech: 0.05 },
          "Die Quelle versiegt nicht mehr, auch wenn du das Wort nicht sprichst.") },
      { title: "Fürsorge", arch: [A.hpFlat, A.hpPct, A.hpFlat],
        tip: uq("vigor", "Zweites Leben", KEYSTONE_COST, { flatHp: 90, pctHp: 0.10 },
          "Ein Leben in Reserve, für den Schlag, den du nicht kommen siehst.") },
      { title: "Gelassenheit", arch: [A.haste, A.failProt, A.hpFlat],
        tip: uq("focus", "Ruhige Hand", KEYSTONE_COST, { castHaste: 0.10, spellFailProt: 0.10 },
          "Keine Hast in der Hand, und darum kein Zittern im Zeichen.") },
    ] },

  // ---- Precision: crit for the whole book.
  { key: "cri", kind: "generic", theme: "crit", title: "Präzision",
    prelude: [A.critChance, A.critMult, A.critChance, A.critMult],
    notable: uq("crit", "Falkenauge", NOTABLE_COST, { critChance: 0.05, armorPen: 0.3 },
      "Du liest den Gang wie eine Seite — und siehst, wo er dünn ist."),
    branches: [
      { title: "Treffsicherheit", arch: [A.critChance, A.critChance, A.critMult],
        tip: uq("crit", "Schwachstelle", KEYSTONE_COST, { critChance: 0.09 },
          "Jeder Körper hat eine. Du findest sie zuverlässig.") },
      { title: "Wucht", arch: [A.critMult, A.critMult, A.critChance],
        tip: uq("crit", "Vernichtender Schlag", KEYSTONE_COST, { critMult: 0.45 },
          "Ein kritischer Treffer ist kein Glück mehr, sondern ein Urteil.") },
      { title: "Kaltblütigkeit", arch: [A.critChance, A.haste, A.dmgPct],
        tip: uq("crit", "Meisterstreich", KEYSTONE_COST, { critChance: 0.05, critMult: 0.20, castHaste: 0.05 },
          "Schnell, ruhig, tödlich — in dieser Reihenfolge."),
        tip2: uq("thorn", "Dornenkrone", THORN_COST, { thorns: THORN_VALUE },
          "Ein verborgener Hort, nur ein einziges Mal zu heben. Ein Teil jedes erlittenen Schlages fährt in den Angreifer zurück.") },
    ] },

  // ---- Frostkegel: control. Its shape branch buys cone reach and freeze time.
  damageSpellArm("fro", "frost",
    [A.hpFlat, A.dmgBaseFlat, A.hpPct, A.dmgPct],
    { title: "Wirkung",
      arch: [
        { stat: "freezeFrost", theme: "frost", base: 120, cost: 34, maxRank: 2, growth: 1.6,
          title: "Ewiges Eis", blurb: "Der Frostkegel hält seine Opfer länger fest." },
        { stat: "coneFrost", theme: "frost", base: 0.04, cost: 30, maxRank: 2, growth: 1.6,
          title: "Weiter Atem", blurb: "Der Kegel greift tiefer in den Gang hinein." },
        sigil("frost"),
      ],
      tip: uq("frost", "Ewiger Winter", KEYSTONE_COST, { freezeFrost: 1200, coneFrost: 0.25 },
        "Der halbe Gang steht still, und dein nächster Zauber zerschlägt ihn.") }),

  // ---- Sustain: regen and leech, the arm that lets a build stay out longer.
  { key: "sus", kind: "generic", theme: "sustain", title: "Zehrung",
    prelude: [A.regen, A.leech, A.regen, A.hpFlat],
    notable: uq("sustain", "Lebensband", NOTABLE_COST, { regen: 4.0, leech: 0.03 },
      "Ein Faden zwischen dir und allem, was du niederstreckst."),
    branches: [
      { title: "Genesung", arch: [A.regen, A.regen, A.hpFlat],
        tip: uq("sustain", "Lebensstrom", KEYSTONE_COST, { regen: 8.8 },
          "Wunden schließen sich, während du noch zeichnest.") },
      { title: "Aderlass", arch: [A.leech, A.leech, A.dmgFlat],
        tip: uq("sustain", "Blutdurst", KEYSTONE_COST, { leech: 0.09 },
          "Jeder Zauber bringt dir zurück, was er dem Gang nimmt.") },
      { title: "Wandeln", arch: [A.leech, A.hpPct, A.regen],
        tip: uq("sustain", "Wandelndes Grab", KEYSTONE_COST, { leech: 0.05, regen: 4.0, flatHp: 36 },
          "Du gehst durch die Toten, als wärst du einer von ihnen."),
        tip2: uq("thorn", "Dornenkrone", THORN_COST, { thorns: THORN_VALUE },
          "Ein verborgener Hort, nur ein einziges Mal zu heben. Ein Teil jedes erlittenen Schlages fährt in den Angreifer zurück.") },
    ] },

  // ---- Meteoritenschauer: area. Its shape branch buys rocks and crater size.
  damageSpellArm("met", "meteor",
    [A.critChance, A.dmgFlat, A.critMult, A.dmgPct],
    { title: "Wirkung",
      arch: [
        bodyNode("countMeteor", "meteor", "Sternenregen", "Ein weiterer Brocken stürzt bei jedem Schauer herab."),
        { stat: "aoeMeteor", theme: "meteor", base: 0.05, cost: 30, maxRank: 2, growth: 1.6,
          title: "Einschlagswucht", blurb: "Jeder Brocken reißt einen größeren Krater." },
        sigil("meteor"),
      ],
      tip: uq("meteor", "Himmelssturz", KEYSTONE_COST, { countMeteor: 3, aoeMeteor: 0.30 },
        "Nicht mehr ein Schauer, sondern ein Himmel, der herunterkommt.") }),

  // ---- Guard: absorb, plate, fail-protection — the arm that keeps a fragile
  // build alive. It is where the hero's ARMOUR is concentrated: Standhaftigkeit
  // is now a plate branch end to end, and the prelude teaches it in the first
  // few gold the arm costs, because a stat that answers the deep hall is no use
  // to anyone who only meets it out at ring 15.
  { key: "gua", kind: "generic", theme: "guard", title: "Abwehr",
    prelude: [A.hpFlat, A.armor, A.failProt, A.shield],
    notable: uq("guard", "Wächterrune", NOTABLE_COST, { shieldChance: 0.08, shieldAmount: 15, shieldMax: 25 },
      "Eine Rune, die mitwacht, wenn du dich auf das Zeichnen konzentrierst."),
    branches: [
      { title: "Schildzauber", arch: [A.shield, A.shield, A.hpFlat],
        tip: uq("guard", "Ewiger Wall", KEYSTONE_COST, { shieldChance: 0.12, shieldAmount: 25, shieldMax: 60 },
          "Der Schild fällt nicht mehr ganz — er wird nur dünner.") },
      { title: "Schutzzauber", arch: [A.failProt, A.armor, A.haste],
        tip: uq("guard", "Bannkreis", KEYSTONE_COST, { spellFailProt: 0.14 },
          "Ein misslungenes Zeichen kostet dich meist nur noch das Zeichen.") },
      { title: "Standhaftigkeit", arch: [A.armor, A.hpFlat, A.armor],
        tip: uq("armor", "Eisenwille", KEYSTONE_COST, { armor: 9, flatHp: 60, spellFailProt: 0.06 },
          "Was dich treffen will, muss erst durch deinen Entschluss."),
        tip2: uq("thorn", "Dornenkrone", THORN_COST, { thorns: THORN_VALUE },
          "Ein verborgener Hort, nur ein einziges Mal zu heben. Ein Teil jedes erlittenen Schlages fährt in den Angreifer zurück.") },
    ] },

  // ---- Bannschild: absorb built from spell power, so raw damage lifts it too.
  { key: "shi", kind: "spell", spell: "shield", theme: "shield", title: "Bannschild",
    prelude: [A.hpFlat, A.armor, A.shield, A.hpPct],
    branches: [
      bRawPower(SPELL_LORE.shield),
      bSigil("shield", SPELL_LORE.shield),
      { title: "Wirkung", arch: [A.shield, A.shield, sigil("shield")],
        tip: uq("shield", "Unzerbrechlich", KEYSTONE_COST, { shieldChance: 0.15, shieldAmount: 30, shieldMax: 100 },
          "Der Bann hält, auch wenn du längst nicht mehr hinsiehst.") },
      // Steinhaut says out loud what it always described — knochen prallen AB —
      // so it is a plate keystone now rather than a second pool of LP.
      { title: "Bollwerk", arch: [A.armor, A.hpPct, A.hpFlat],
        tip: uq("armor", "Steinhaut", KEYSTONE_COST, { armor: 11, flatHp: 60 },
          "Knochen prallen ab, wo sie früher eindrangen.") },
      { title: "Wehrhaftigkeit", arch: [A.failProt, A.haste, A.hpFlat],
        tip: uq("guard", "Bannwall", KEYSTONE_COST, { spellFailProt: 0.12, castHaste: 0.06 },
          "Der Schild steht schon, bevor das Zeichen fertig ist.") },
    ] },

  // ---- Vigour: the plain HP arm.
  { key: "vig", kind: "generic", theme: "vigor", title: "Zähigkeit",
    prelude: [A.hpFlat, A.hpFlat, A.hpPct, A.hpFlat],
    notable: uq("vigor", "Eisenleib", NOTABLE_COST, { flatHp: 60, pctHp: 0.06 },
      "Ein Körper, der gelernt hat, im Gang zu stehen."),
    branches: [
      { title: "Knochenbau", arch: [A.hpFlat, A.armor, A.hpPct],
        tip: uq("vigor", "Mark und Bein", KEYSTONE_COST, { flatHp: 102, armor: 5 },
          "Du trägst mehr, als ein Mensch tragen sollte.") },
      { title: "Lebenskraft", arch: [A.hpPct, A.hpPct, A.hpFlat],
        tip: uq("vigor", "Zweites Herz", KEYSTONE_COST, { pctHp: 0.18 },
          "Ein zweiter Schlag hinter dem ersten, für den Fall der Fälle.") },
      { title: "Beharrlichkeit", arch: [A.armor, A.regen, A.hpFlat],
        tip: uq("vigor", "Unbeugsam", KEYSTONE_COST, { regen: 7.2, flatHp: 36, armor: 6 },
          "Du gehst weiter, weil Stehenbleiben nie zur Debatte stand."),
        tip2: uq("thorn", "Dornenkrone", THORN_COST, { thorns: THORN_VALUE },
          "Ein verborgener Hort, nur ein einziges Mal zu heben. Ein Teil jedes erlittenen Schlages fährt in den Angreifer zurück.") },
    ] },

  // ---- Feuerball: the page you start with, so its key is a keystone, not a
  // seal. Its shape branch buys blast radius — the spell's whole upgrade path.
  damageSpellArm("fir", "fireball",
    [A.dmgFlat, A.dmgPct, A.critChance, A.dmgBaseFlat],
    { title: "Wirkung",
      arch: [
        { stat: "aoeFireball", theme: "fireball", base: 0.05, cost: 30, maxRank: 2, growth: 1.6,
          title: "Glutkern", blurb: "Der Feuerball zerbirst weiter — die Flammen greifen über den Getroffenen hinaus." },
        sigil("fireball"),
        A.haste,
      ],
      tip: uq("fireball", "Flammenmeer", KEYSTONE_COST, { aoeFireball: 0.30 },
        "Keine Kugel mehr, sondern eine Woge, die über die Reihen schlägt — und jede trifft sie voll.") }),

  // ---- Fortune: gold and pace. Belongs to no page — it funds all of them.
  { key: "for", kind: "generic", theme: "fortune", title: "Fortuna",
    prelude: [A.coin, A.walk, A.coin, A.walk],
    notable: uq("fortune", "Glücksmünze", NOTABLE_COST, { coinMult: 0.12 },
      "Sie fällt immer richtig herum. Frag nicht, warum."),
    branches: [
      { title: "Glückssträhne", arch: [A.coin, A.coin, A.walk],
        tip: uq("fortune", "Goldrausch", KEYSTONE_COST, { coinMult: 0.25 },
          "Jede richtige Vokabel klingt jetzt anders — nämlich metallisch.") },
      { title: "Flinkheit", arch: [A.walk, A.walk, A.hpFlat],
        tip: uq("fortune", "Windschritt", KEYSTONE_COST, { walkMult: 0.20 },
          "Der Gang zwischen zwei Lagern wird kurz genug, um kein Gang mehr zu sein.") },
      { title: "Fündigkeit", arch: [A.coin, A.haste, A.walk],
        // No Dornenkrone out here: exactly five caches exist, and Fortuna — the
        // one arm that belongs to no page — is the one that doesn't hide one.
        tip: uq("fortune", "Schatzsinn", KEYSTONE_COST, { coinMult: 0.15, castHaste: 0.05 },
          "Du riechst Gold durch Stein — und sparst dir den Umweg.") },
    ] },
];

// ---------------------------------------------------------------------------
// Layout — grow the graph from the ARMS table first, then place it. Position is
// a two-step job (see the constants above): give every subtree a slice of the
// circle proportional to how many chain-ends it holds, then relax the whole
// thing under springs + repulsion so the density evens out and the shape stops
// looking drafted.
// ---------------------------------------------------------------------------
function ringRadius(ring) { return HOLE + (ring - 1) * NODE_STEP; }
// A node's price WEIGHT — not gold yet. Two things make one node dearer than
// another: how deep it sits (ring^COST_RING_POW) and how much of a node it is
// (the authored base — a keystone is worth several ordinary nodes). The weights
// are turned into gold in one pass once the tree is finished, so that the whole
// tree comes to exactly CONFIG.treeGold (see applyTreeGold).
function ringWeight(base, ring) { return base * Math.pow(ring, COST_RING_POW); }

// Small seeded PRNG. It decides which offshoots exist and how long twigs run,
// and saves name the nodes on them, so the layout never touches Math.random.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSkillTree() {
  const nodes = {
    root: { title: "Ursprung", theme: "origin", ring: 0, maxRank: 0, cost: 0, growth: 1, effect: {},
      path: "Runenbaum",
      blurb: "Der Quell deiner Macht. Zwölf Arme wachsen von hier — sechs tragen je eine Seite deines Buches, sechs tragen nichts als rohe Fertigkeit." },
  };
  const kids = { root: [] };
  const edges = [];
  // Children are recorded in the order they are grown, and the angular pass
  // below hands out slices in that same order — so an arm's five branches stay
  // side by side in the order the ARMS table lists them.
  const add = (id, node, parent) => {
    nodes[id] = node;
    kids[id] = [];
    kids[parent].push(id);
    edges.push([parent, id]);
    return id;
  };

  ARMS.forEach((arm, armIdx) => {
    const rng = mulberry32(0x9E3779B1 ^ Math.imul(armIdx + 1, 2654435761));
    // Some arms simply don't grow as far as others. Without this every arm ends
    // on the same ring and the whole tree is drawn inside a perfect circle.
    const armReach = rng() < 0.4 ? 1 : 0;

    // A dead-end offshoot: one or two nodes hanging off the side of a chain,
    // ending on a node with an extra rank so the detour is worth walking.
    const sprout = (chain, arch, path, chance) => {
      if (chain.length < 2 || rng() >= chance) return;
      const at = chain[1 + Math.floor(rng() * (chain.length - 1))];
      const count = rng() < 0.42 ? 2 : 1;
      let prev = at.id;
      for (let j = 0; j < count; j++) {
        prev = add(`${at.id}s${j}`,
          archNode(arch[(at.idx + 2 + j) % arch.length], at.ring + j + 1, path, j === count - 1 ? 4 : 0),
          prev);
      }
    };

    // --- rings 1..4: the prelude
    let prev = "root";
    const prelude = [];
    arm.prelude.forEach((arch, i) => {
      prev = add(`${arm.key}p${i}`, archNode(arch, i + 1, arm.title), prev);
      prelude.push({ id: prev, ring: i + 1, idx: i });
    });
    sprout(prelude, arm.prelude, arm.title, 0.55);

    // --- ring 5: the key — a spell's seal, or a generic arm's notable
    const key = add(`${arm.key}g`, keyNode(arm), prev);

    // --- rings 6..19: the aspect branches, each forking into two twigs
    arm.branches.forEach((br, b) => {
      const path = `${arm.title} · ${br.title}`;
      const forkRing = FORK_RING - 2 + Math.floor(rng() * 4);   // 11..14 — no two branches split in line
      const stem = [];
      let sPrev = key;
      for (let ring = FAN_RING; ring < forkRing; ring++) {
        const i = ring - FAN_RING;
        sPrev = add(`${arm.key}b${b}n${i}`, archNode(br.arch[i % br.arch.length], ring, path), sPrev);
        stem.push({ id: sPrev, ring, idx: i });
      }
      sprout(stem, br.arch, path, SPUR_STEM);

      for (let t = 0; t < 2; t++) {
        // Where a twig stops. Twig A carries the keystone so it runs long, but
        // not to a fixed ring — together with armReach and the varying fork this
        // is what keeps the outer edge ragged instead of circular, and it thins
        // the outermost band so the tips have room to breathe.
        const tipRing = TIP_RING - armReach - (t === 0
          ? Math.floor(rng() * 2)                 // twig A: one of the two outer rings
          : 1 + Math.floor(rng() * 3));           // twig B: one to three rings shorter
        const twig = [];
        let tPrev = sPrev;
        for (let ring = forkRing; ring <= tipRing; ring++) {
          const i = ring - forkRing;
          const isTip = ring === tipRing;
          const tipSpec = isTip ? (t === 0 ? br.tip : br.tip2) : null;
          const node = tipSpec
            ? uniqueNode(tipSpec, ring, path)
            : archNode(br.arch[(i + 1 + t * 2) % br.arch.length], ring, path,
                isTip ? 4 : 0);   // a twig with no keystone ends on a deeper-ranked node instead
          tPrev = add(`${arm.key}b${b}t${t}n${i}`, node, tPrev);
          twig.push({ id: tPrev, ring, idx: i });
        }
        sprout(twig.slice(0, -1), br.arch, path, SPUR_TWIG);   // never off the keystone itself
      }
    });
  });

  // Weights in, game units out: the totals are divided across the finished tree
  // (see applyTreeTotals). Nothing downstream ever sees a raw weight.
  const scale = applyTreeTotals(nodes);
  applyTreeGold(nodes);

  const pos = radialSlices(nodes, kids);
  relaxTree(pos, nodes, edges);
  return { nodes, pos, edges, scale };
}

// Step one: every subtree gets a wedge of the circle sized by how many
// chain-ends hang off it, and sits in the middle of its own wedge. Sibling
// wedges never overlap, so no branch can ever be drawn across another — which
// is what the relaxation below then has to preserve rather than create.
function radialSlices(nodes, kids) {
  const ends = {};
  const countEnds = (id) => (ends[id] = kids[id].length
    ? kids[id].reduce((s, c) => s + countEnds(c), 0)
    : 1);
  countEnds("root");

  const pos = {};
  const place = (id, a0, a1) => {
    const ang = (a0 + a1) / 2;
    const r = id === "root" ? 0 : ringRadius(nodes[id].ring);
    pos[id] = { x: TREE_CENTER + r * Math.cos(ang), y: TREE_CENTER + r * Math.sin(ang) };
    const cs = kids[id];
    if (!cs.length) return;
    const total = cs.reduce((s, c) => s + ends[c], 0);
    let a = a0;
    for (const c of cs) {
      const w = (a1 - a0) * (ends[c] / total);
      place(c, a, a + w);
      a += w;
    }
  };
  place("root", -Math.PI / 2, -Math.PI / 2 + Math.PI * 2);
  return pos;
}

// Step two: settle the whole tree under three forces at once —
//   springs along every edge, so a chain keeps one step between its nodes;
//   short-range repulsion, which is what actually evens the density out and
//     pushes nodes into whatever space is going spare;
//   a weak pull toward each node's own ring, enough to keep the tree growing
//     outward without pinning angles, so crowded regions can drain sideways.
// The seed is pinned and the twelve keys are held near their ring; everything
// else is free. Deterministic: fixed pass count, fixed iteration order.
function relaxTree(pos, nodes, edges) {
  const ids = Object.keys(pos);
  const n = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  // Flat arrays throughout: this runs a few hundred passes at page load, and
  // doing it over objects and string keys cost more than the rest of the boot.
  const px = new Float64Array(n), py = new Float64Array(n);
  const fx = new Float64Array(n), fy = new Float64Array(n);
  const target = new Float64Array(n), pull = new Float64Array(n);
  ids.forEach((id, i) => {
    px[i] = pos[id].x; py[i] = pos[id].y;
    target[i] = ringRadius(nodes[id].ring);
    pull[i] = nodes[id].beacon ? K_RADIAL_KEY : K_RADIAL;
  });
  const ea = new Int32Array(edges.length), eb = new Int32Array(edges.length);
  edges.forEach(([a, b], i) => { ea[i] = index.get(a); eb[i] = index.get(b); });
  const rootIdx = index.get("root");

  const cellSize = RELAX_SPAN / RELAX_CELLS;
  const buckets = Array.from({ length: RELAX_CELLS * RELAX_CELLS }, () => []);
  const cellOf = (v) => {
    const c = (v / cellSize) | 0;
    return c < 0 ? 0 : c >= RELAX_CELLS ? RELAX_CELLS - 1 : c;
  };

  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    fx.fill(0); fy.fill(0);

    for (let e = 0; e < ea.length; e++) {
      const a = ea[e], b = eb[e];
      const dx = px[b] - px[a], dy = py[b] - py[a];
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-3;
      const f = (d - REST_LEN) * K_SPRING, ux = dx / d, uy = dy / d;
      fx[a] += ux * f; fy[a] += uy * f;
      fx[b] -= ux * f; fy[b] -= uy * f;
    }

    for (const bucket of buckets) bucket.length = 0;
    for (let i = 0; i < n; i++) buckets[cellOf(py[i]) * RELAX_CELLS + cellOf(px[i])].push(i);
    for (let cy = 0; cy < RELAX_CELLS; cy++) {
      for (let cx = 0; cx < RELAX_CELLS; cx++) {
        const here = buckets[cy * RELAX_CELLS + cx];
        if (!here.length) continue;
        for (let oy = cy; oy <= cy + 1 && oy < RELAX_CELLS; oy++) {
          for (let ox = cx - 1; ox <= cx + 1; ox++) {
            if (ox < 0 || ox >= RELAX_CELLS) continue;
            if (oy === cy && ox < cx) continue;          // each cell pair once
            const there = buckets[oy * RELAX_CELLS + ox];
            const same = oy === cy && ox === cx;
            for (let ii = 0; ii < here.length; ii++) {
              const i = here[ii];
              for (let jj = same ? ii + 1 : 0; jj < there.length; jj++) {
                const j = there[jj];
                let dx = px[j] - px[i], dy = py[j] - py[i];
                let d = Math.sqrt(dx * dx + dy * dy);
                if (d >= REPEL_RADIUS) continue;
                if (d < 1e-3) { dx = 1; dy = 0; d = 1e-3; }
                // Quadratic falloff: barely felt at arm's length, very firm up
                // close, so no two nodes ever settle on top of each other.
                const t = (REPEL_RADIUS - d) / REPEL_RADIUS;
                const f = K_REPEL * REPEL_RADIUS * t * t, ux = dx / d, uy = dy / d;
                fx[i] -= ux * f; fy[i] -= uy * f;
                fx[j] += ux * f; fy[j] += uy * f;
              }
            }
          }
        }
      }
    }

    for (let i = 0; i < n; i++) {
      if (i === rootIdx) continue;
      const dx = px[i] - TREE_CENTER, dy = py[i] - TREE_CENTER;
      const d = Math.sqrt(dx * dx + dy * dy) || 1e-3;
      const f = (target[i] - d) * pull[i];
      fx[i] += (dx / d) * f; fy[i] += (dy / d) * f;
    }

    for (let i = 0; i < n; i++) {
      if (i === rootIdx) continue;
      px[i] += fx[i] < -MAX_NUDGE ? -MAX_NUDGE : fx[i] > MAX_NUDGE ? MAX_NUDGE : fx[i];
      py[i] += fy[i] < -MAX_NUDGE ? -MAX_NUDGE : fy[i] > MAX_NUDGE ? MAX_NUDGE : fy[i];
    }
  }
  ids.forEach((id, i) => { pos[id].x = px[i]; pos[id].y = py[i]; });
}

// Stats the player counts in whole units. A shield of 12,4 points is noise; an
// extra lightning hop cannot be 0,7 of one.
//
// THE THREE FLAT POOLS ARE NO LONGER IN HERE, AND THAT IS A BALANCE CHANGE
// RATHER THAN A FORMATTING ONE. flatBase, flatDmg and flatHp are the biggest
// pools in the game and they are divided across 143, 223 and 410 ranks. Rounded
// to a whole point with a floor of 1, most of those ranks landed ON the floor —
// `tools/stat-supply.mjs` used to print a span of "1 … 1" for flatBase, i.e.
// every Kernschliff node in the tree, ring 1 and ring 19 alike, granted exactly
// the same amount. The ring curve existed and did nothing.
//
// That is what made the tree front-loaded, and front-loading is what made the
// game stop being about stats: a quarter of the ranks, which is what ten percent
// of the gold buys, held a third of the flat supply, so a modest build already
// hit hard enough to clear camps that were meant to be a wall. Carried to a
// TENTH instead, the same totals sit where they were authored to sit — the
// shallow node grants 0,6 and the deep one 6 — and the tooltip prints both
// honestly (treeNum has always had the decimal place; nothing else needed it
// until now).
const WHOLE_STATS = {
  shieldAmount: 1, shieldMax: 1,
  freezeFrost: 1, chainLightning: 1, countMeteor: 1,
};
// …and the pools carried to one decimal, floored where the tooltip's last place
// is (0,1). `regen` was always one of these; the three flat pools joined it.
const TENTH_STATS = { regen: 1, flatDmg: 1, flatBase: 1, flatHp: 1, armor: 1 };

// What every rank of every node adds up to, per stat.
function supplyOf(nodes) {
  const total = {};
  for (const id in nodes) {
    const n = nodes[id];
    for (const k in n.effect) total[k] = (total[k] || 0) + n.effect[k] * n.maxRank;
  }
  return total;
}


// ---------------------------------------------------------------------------
// THE SECOND PASS — where the balance is actually decided.
//
// The tree is grown first with the RAW authored weights: the A table and the
// keystones say how much a node is worth RELATIVE to its neighbours, which is
// the judgement a designer can make while writing a thousand nodes. What none
// of them can say is how much the whole thing should come to.
//
// So that is stated separately, once, in CONFIG.treeTotals — "the tree contains
// exactly +1.200 LP" — and this pass divides that total across the nodes in
// proportion to their weights. Tuning the game is then editing one number per
// stat and re-running tools/stat-supply.mjs, instead of guessing at a multiplier
// and measuring what fell out.
//
// This is also where the ceilings went. Every stat HAS a maximum again — its
// total — but it is a ceiling of a different kind: it bounds what EXISTS rather
// than clipping what you carry. You can own all of it, and every node on the way
// pays exactly what it printed. And because these pools are additive, they slow
// down on their own: the tenth +30 LP is the same +30, but it is a far smaller
// share of the pool it lands in than the first was. The diminishing return is in
// the arithmetic, not bolted on top of it.
//
// Rounding drifts the achieved total a little off the target (a node worth 0.4
// LP still has to print +1). tools/stat-supply.mjs shows both figures.
//
// Every rounding here has a FLOOR, and the floor is the point: a thousand nodes
// dividing these totals leaves the smallest of them holding very little, and
// whatever it holds it still has to be a number the player can read. Nothing in
// the tree is ever nothing.
//
// THE FLOOR IS SET BY THE TOOLTIP, NOT BY THE GAME. What matters is the smallest
// figure `effectText` can print without it reading as a zero, and that differs
// per stat because the wordings differ: a percentage stat is multiplied by 100
// on its way to the page, so 0,001 shows as "0,1 %", while Rüstungsbruch prints
// its raw number and needs 0,05 to reach "+0,1", and Frostdauer is carried in
// milliseconds and divided by 1.000, so it needs 50 of them. STAT_FLOOR is those
// exceptions; everything else takes the default for its rounding class.
//
// They started to bind when the ring curve became a power curve (see
// VAL_RING_POW): the same total spread over a 150-fold range instead of a
// 3-fold one leaves the shallowest nodes holding a hundredth of what they used
// to, and two stats quietly began printing "+0". The smoke test's
// "no node sells a zero" check is the guard, and it is what caught them.
const STAT_FLOOR = { armorPen: 0.05, freezeFrost: 50 };
function applyTreeTotals(nodes) {
  const raw = supplyOf(nodes);
  const scale = {};
  for (const stat in raw) {
    const want = CONFIG.treeTotals[stat];
    scale[stat] = (want == null || raw[stat] <= 0) ? 1 : want / raw[stat];
  }
  for (const id in nodes) {
    const effect = nodes[id].effect;
    for (const k in effect) {
      const v = effect[k] * scale[k];
      const floor = STAT_FLOOR[k];
      effect[k] = WHOLE_STATS[k] ? Math.max(floor || 1, Math.round(v))
        : TENTH_STATS[k] ? Math.max(floor || 0.1, Math.round(v * 10) / 10)
        : Math.max(floor || 0.001, Math.round(v * 1000) / 1000);
    }
  }
  return scale;
}

// ---------------------------------------------------------------------------
// THE PRICE PASS — the same idea as applyTreeTotals, for gold.
//
// CONFIG.treeGold says what the WHOLE tree costs: every rank of every node, end
// to end. Each rank's share of that is its weight — how deep the node sits, how
// much of a node it is, and how many ranks of it you have already bought (each
// further rank of the same node is dearer by `growth`). So a price is never
// authored in gold; it is a fraction of the one number that says how long the
// tree should take.
//
// That is what makes the stat totals in CONFIG.treeTotals honest ceilings: gold
// income and tree price are set against each other, so an endgame build really
// does walk ~90 % of the nodes and really does arrive at the totals.
function applyTreeGold(nodes) {
  let weight = 0;
  for (const id in nodes) {
    const n = nodes[id];
    const growth = n.growth || RANK_GROWTH;
    for (let r = 0; r < n.maxRank; r++) weight += n.cost * Math.pow(growth, r);
  }
  const k = weight > 0 ? CONFIG.treeGold / weight : 1;
  for (const id in nodes) {
    if (id === "root") continue;
    nodes[id].cost = Math.max(5, Math.round(nodes[id].cost * k));
  }
}

// What a node at this ring is worth, before applyTreeTotals turns weights into
// game units. Used by ordinary archetypes AND by the uniques: a keystone is
// authored as a weight relative to the ordinary nodes around it ("about eight
// Schneide nodes"), so it has to ride the same ring curve they do or a ring-19
// keystone would come out worth a fraction of the plain node next to it.
function ringTier(ring, ringVal) {
  return Math.pow(Math.max(1, ring), VAL_RING_POW * (ringVal == null ? 1 : ringVal));
}

// One archetype, resolved at a ring: weight scaled by the tier, cost by the ring.
function archNode(arch, ring, path, maxRankOverride) {
  // `ringVal` scales how fast this archetype grows with depth, and no archetype
  // uses it at the moment: the three flat pools that once did were dampened only
  // because whole-point rounding pinned them flat anyway (see WHOLE_STATS), and
  // carrying them to a tenth made the dampener the thing holding the curve back.
  // It is kept because it is the right knob for an archetype whose grain really
  // does have to stay coarse.
  const tier = ringTier(ring, arch.ringVal);
  let effect;
  if (arch.special === "shield") {
    // All three parts on the same ring curve. The chance used to be a hand-rolled
    // `min(0.12, 0.05 + 0.004*ring)` while the two magnitudes rode the tier —
    // harmless while the curve was nearly flat, and a real distortion once it
    // is not, because applyTreeTotals then hands almost the whole shieldChance
    // total to the keystones and rounds the ordinary Schildzauber nodes to
    // nothing. Written as weights like everything else, the total lands where
    // CONFIG.treeTotals puts it.
    effect = { shieldChance: 0.05 * tier, shieldAmount: 8 * tier, shieldMax: 13 * tier };
  } else if (COUNT_STATS[arch.stat]) {
    effect = { [arch.stat]: 1 };
  } else {
    effect = { [arch.stat]: arch.base * tier };
  }
  return { title: arch.title, theme: arch.theme, ring, path, effect, blurb: arch.blurb,
    maxRank: maxRankOverride || arch.maxRank || 3,
    cost: ringWeight(arch.cost, ring), growth: arch.growth || RANK_GROWTH };
}

// A unique — a keystone, a notable, an unlock, a thorn cache. Its weight is
// authored outright and then put on the SAME ring curve an archetype rides, for
// the reason spelled out at ringTier: the authored figure says how a keystone
// compares with the plain nodes beside it, and "beside it" is at ring 19.
function uniqueNode(spec, ring, path) {
  const tier = ringTier(ring);
  const effect = {};
  for (const k in spec.effect) effect[k] = spec.effect[k] * (FIXED_STATS[k] ? 1 : tier);
  return { title: spec.title, theme: spec.theme, ring, path, effect, blurb: spec.blurb,
    unique: true, maxRank: 1, growth: 1, cost: ringWeight(spec.cost, ring) };
}

// The node at ring 5. On a spell arm that carries a sealed page it is the seal
// itself; on the starter's arm and on every generic arm it is a named notable,
// so all twelve arms have the same milestone at the same depth.
function keyNode(arm) {
  const spell = arm.spell ? SPELL_BY_ID[arm.spell] : null;
  // `beacon` shows a key through the fog from the very first screen (see
  // nodeRevealed). Twelve lit signs ringing the seed are what make the tree
  // navigable: you pick an arm because you can see what it leads to, not by
  // spending four nodes to find out.
  if (spell && spell.unlock) {
    return { title: spell.name, theme: arm.theme, ring: KEY_RING, path: arm.title, beacon: true,
      maxRank: 1, unique: true, unlocks: spell.id, growth: 1, effect: {},
      cost: ringWeight(UNLOCK_COST, KEY_RING),
      blurb: `Ein versiegeltes Zeichen. Heb es, und der Zauber schlägt eine neue Seite in deinem Buch auf. ${spell.blurb}` };
  }
  const node = arm.notable
    ? uniqueNode(arm.notable, KEY_RING, arm.title)
    // Feuerball is already known, so its arm's key is a prize rather than a lock.
    : uniqueNode(uq("fireball", "Feuermal", 40, { dmgFireball: 0.15, flatDmg: 4 },
        "Das Zeichen, mit dem du geboren wurdest. Der Feuerball war nie versiegelt — er war nur nie geschärft."),
      KEY_RING, arm.title);
  node.beacon = true;
  return node;
}

const _TREE = buildSkillTree();
const TREE_NODES = _TREE.nodes;
const NODE_POS = _TREE.pos;
const TREE_EDGES = _TREE.edges;

// Older releases used different node ids. Map their tier-1 bases onto the arm
// that inherited them so a little saved progress carries across; everything
// deeper drops (the tree was replanted) and is refunded in gold instead — see
// applySavedProgress in state.js.
const LEGACY_NODE_IDS = {
  dmg1: "migp0", o1: "migp0", off_0: "migp0", off_1_0: "migp0",
  hp1: "vigp0", v1: "vigp0", vit_0: "vigp0", vit_1_0: "vigp0",
  crit1: "crip0", c1: "crip0", cri_0: "crip0", cri_1_0: "crip0",
  sus1: "susp0", s1: "susp0", sus_0: "susp0", sus_1_0: "susp0",
  for1: "forp0", f1: "forp0", for_0: "forp0", for_1_0: "forp0",
  ward1: "guap0", w1: "guap0", war_0: "guap0", war_1_0: "guap0",
  arc1: "firp0", a1: "firp0", arc_0: "firp0", arc_1_0: "firp0",
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
// REACHABLE is the purchase gate: a node can only be bought once a purchased
// node sits next to it (the seed counts as purchased), so every arm has to be
// walked from the inside out.
function nodeReachable(id) {
  return (NEIGHBORS[id] || []).some(isPurchased);
}
// REVEALED is only about the fog. It follows reachability — except for the
// twelve `beacon` keys, which are lit from the first screen so you can see what
// each arm leads to. Seeing one is not owning one: it still has to be reached.
function nodeRevealed(id) {
  if (isPurchased(id)) return true;
  if (TREE_NODES[id] && TREE_NODES[id].beacon) return true;
  return nodeReachable(id);
}
function nodeCost(node, rank) {
  return Math.round(node.cost * Math.pow(node.growth || RANK_GROWTH, rank));
}

// ---------------------------------------------------------------------------
// Stat model — sum every purchased rank's effect into `state.mods`, then derive
// the two fields (heroMaxHP / heroDmg) the rest of combat reads.
//
// THAT IS THE WHOLE MODEL. There is no soft cap, no hard cap and no diminishing
// return anywhere in it: what the nodes granted is what the hero carries. A
// build is bounded by what the tree holds and what the player can afford, and
// the node values are derived from exactly that (see CONFIG.treeTotals).
//
// The only clamps left are the two that are arithmetic rather than balance, and
// they are marked as such below: a probability cannot exceed 1, and a chain hop
// cannot carry more than it received.
// ---------------------------------------------------------------------------
const asChance = (x) => (x > 1 ? 1 : x < 0 ? 0 : x);   // a probability, by definition

// Which summed stat feeds which spell's % damage / signature parameter. Split
// out so recomputeMods stays a flat read of the pools rather than a per-spell
// special case (see spells.js — a resolver reads mods.spellPct[id] and
// mods.spellParam[key], never the raw sums).
const SPELL_DMG_STATS = {
  fireball: "dmgFireball", lightning: "dmgLightning", frost: "dmgFrost",
  meteor: "dmgMeteor", shield: "dmgShield", heal: "dmgHeal",
};
// Every one of these passes through exactly as summed. What a page's shape can
// grow to is set by its total in CONFIG.treeTotals, not by a
// ceiling in the resolver.
const SPELL_PARAM_STATS = [
  "chainLightning", "countMeteor",
  "freezeFrost", "coneFrost", "aoeFireball", "aoeMeteor", "falloffLightning",
];

function recomputeMods() {
  const sum = {
    flatDmg: 0, flatBase: 0, pctBase: 0, flatHp: 0, pctDmg: 0, pctHp: 0,
    critChance: 0, critMult: 0, armorPen: 0, armor: 0,
    leech: 0, regen: 0, walkMult: 0, coinMult: 0, castHaste: 0,
    shieldChance: 0, shieldAmount: 0, shieldMax: 0,
    thorns: 0, spellFailProt: 0,
  };
  for (const id in SPELL_DMG_STATS) sum[SPELL_DMG_STATS[id]] = 0;
  for (const k of SPELL_PARAM_STATS) sum[k] = 0;

  const unlocked = {};
  if (state.nodeRanks) {
    for (const id in state.nodeRanks) {
      const node = TREE_NODES[id];
      if (!node) continue;
      // Clamp to the node's current maxRank: a save written before a node was
      // reshaped must not keep paying out ranks the node no longer has.
      const rank = Math.min(node.maxRank, state.nodeRanks[id] || 0);
      if (rank <= 0) continue;
      // A spell key is a rank, not a number: buying it opens that page.
      if (node.unlocks) unlocked[node.unlocks] = true;
      for (const k in node.effect) {
        if (k in sum) sum[k] += node.effect[k] * rank;
      }
    }
  }
  const spellPct = {};
  for (const id in SPELL_DMG_STATS) spellPct[id] = sum[SPELL_DMG_STATS[id]];
  const spellParam = {};
  for (const k of SPELL_PARAM_STATS) spellParam[k] = sum[k];

  state.mods = {
    // Stage 3 of the damage model: read by spellPower and added to every hit
    // after every multiplier, so what the node printed is what lands.
    flatDmg: sum.flatDmg,
    critChance: asChance(sum.critChance),
    critMult: 1.5 + sum.critMult,           // base ×1.5 on a crit
    // Armour points shredded off whatever the target wears, before the mitigation
    // curve is read (see armorReduction in combat.js). Shredding past what a body
    // wears simply leaves it unarmoured — armorReduction floors at zero.
    armorPen: sum.armorPen,
    // The hero's own plate, in points. What share of a blow that turns aside is
    // read through CONFIG.heroArmorK, in one place (heroArmorReduction in
    // combat.js) — the points themselves are carried raw here so the ledger can
    // show them against what the tree holds.
    armor: sum.armor,
    spellsUnlocked: unlocked,
    spellPct,
    spellParam,
    leech: sum.leech,
    regen: sum.regen,
    castHaste: sum.castHaste,
    walkMult: 1 + sum.walkMult,
    coinMult: 1 + sum.coinMult,
    shieldChance: asChance(sum.shieldChance),
    shieldAmount: sum.shieldAmount,
    shieldMax: sum.shieldMax,
    thorns: sum.thorns,
    spellFailProt: asChance(sum.spellFailProt),
  };
  const flatHp = sum.flatHp, pctHp = sum.pctHp;
  const flatBase = sum.flatBase, pctBase = sum.pctBase;
  const pctDmg = sum.pctDmg, flatDmg = sum.flatDmg;
  // Kept for the ledger (see stats.js), which shows each pool against what the
  // whole tree holds of it rather than against a ceiling, since there isn't one.
  state.mods.sums = sum;
  state.mods.derived = { flatHp, pctHp, flatBase, pctBase, pctDmg, flatDmg };
  state.heroMaxHP = Math.round((CONFIG.heroBaseHP + flatHp) * (1 + pctHp));
  // Stages 1 and 2. Stage 3 (flatDmg) is deliberately NOT in here: it is added
  // after the page's own factor too, inside spellPower, which is the whole point
  // of splitting it out — see spells.js.
  state.heroDmg = Math.max(1,
    Math.round((CONFIG.heroBaseDmg + flatBase) * (1 + pctBase) * (1 + pctDmg)));
  if (state.heroShield == null) state.heroShield = 0;
  if (state.heroShield > state.mods.shieldMax) state.heroShield = state.mods.shieldMax;
}

// Buy one rank of a node (routed from the info panel's "Kaufen" button).
function treeBuy(id) {
  const node = TREE_NODES[id];
  if (!node || id === "root") return;
  const rank = nodeRank(id);
  if (rank >= node.maxRank) return;
  if (!isPurchased(id) && !nodeReachable(id)) return;   // a lit beacon still has to be walked to
  const cost = nodeCost(node, rank);
  if (state.gold < cost) return;

  state.gold -= cost;
  state.nodeRanks[id] = rank + 1;
  const oldMax = state.heroMaxHP;
  recomputeMods();
  const gain = state.heroMaxHP - oldMax;   // buying vitality tops the pool up by the gain
  if (gain > 0) state.heroHP = Math.min(state.heroMaxHP, state.heroHP + gain);
  // Lifting a spell's seal turns the book straight to the page it opened —
  // finding the key and then having to go hunt for the page would be busywork.
  if (node.unlocks) state.activeSpell = node.unlocks;
  saveProgress();
  state._structuralDirty = true;
}

// ---------------------------------------------------------------------------
// Effect wording (single-click info)
// ---------------------------------------------------------------------------
// A number the tooltip can always tell the truth about. Rounding to whole
// percent is what turned a real +0,4 % into "+0 %"; one decimal place is all it
// takes for every figure in the tree to be a number instead of a zero, and the
// tree is built so nothing lands under it (see the floors in applyTreeTotals).
// A trailing ",0" is dropped — "+15 %" reads better than "+15,0 %" and says the
// same thing. German comma, as everywhere else on screen (cf. svNum in stats.js).
function treeNum(v) {
  let s = v.toFixed(1);
  if (s.endsWith(".0")) s = s.slice(0, -2);
  return s.replace(".", ",");
}
function treePct(v) { return treeNum(v * 100) + "%"; }

const STAT_FMT = {
  // The three damage stages read differently on purpose: "je Treffer" is the
  // one that lands verbatim on every body, and it must not be confusable with
  // the two that get multiplied on the way.
  flatDmg:      (v) => `+${treeNum(v)} Schaden je Treffer`,
  flatBase:     (v) => `+${treeNum(v)} Kernschaden`,
  pctBase:      (v) => `+${treePct(v)} Kernschaden`,
  flatHp:       (v) => `+${treeNum(v)} LP`,
  pctDmg:       (v) => `+${treePct(v)} Schaden`,
  pctHp:        (v) => `+${treePct(v)} LP`,
  critChance:   (v) => `+${treePct(v)} Krit-Chance`,
  critMult:     (v) => `+${treePct(v)} Krit-Schaden`,
  armorPen:     (v) => `+${treeNum(v)} Rüstungsbruch`,
  armor:        (v) => `+${treeNum(v)} Rüstung`,
  leech:        (v) => `${treePct(v)} Lebensraub`,
  // Per-spell nodes — worded so the page they lift is named in the effect line.
  dmgFireball:  (v) => `+${treePct(v)} Feuerball-Schaden`,
  dmgLightning: (v) => `+${treePct(v)} Blitzschlag-Schaden`,
  dmgFrost:     (v) => `+${treePct(v)} Frostkegel-Schaden`,
  dmgMeteor:    (v) => `+${treePct(v)} Meteoriten-Schaden`,
  dmgShield:    (v) => `+${treePct(v)} Bannschild-Kraft`,
  dmgHeal:      (v) => `+${treePct(v)} Heilwort-Kraft`,
  aoeFireball:  (v) => `+${treePct(v)} Feuerball-Radius`,
  chainLightning: (v) => `+${Math.round(v)} Blitz-Sprung`,
  countMeteor:  (v) => `+${Math.round(v)} Meteorit`,
  freezeFrost:  (v) => `+${treeNum(v / 1000)}s Frostdauer`,
  coneFrost:    (v) => `+${treePct(v)} Kegelweite`,
  aoeMeteor:    (v) => `+${treePct(v)} Einschlagradius`,
  falloffLightning: (v) => `+${treePct(v)} Sprungkraft`,
  castHaste:    (v) => `+${treePct(v)} Zaubertempo`,
  regen:        (v) => `+${treeNum(v)}/s LP`,
  walkMult:     (v) => `+${treePct(v)} Tempo`,
  coinMult:     (v) => `+${treePct(v)} Gold`,
  shieldChance: (v) => `${treePct(v)} Schild-Chance`,
  shieldAmount: (v) => `+${Math.round(v)} Schild`,
  shieldMax:    (v) => `+${Math.round(v)} max. Schild`,
  thorns:       (v) => `${treePct(v)} Dornen`,
  spellFailProt:(v) => `${treePct(v)} Fehlschutz`,
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
function nodeRadius(id) {
  if (id === "root") return 34;
  return TREE_NODES[id] && TREE_NODES[id].unique ? 33 : 28;   // uniques sit a little larger
}

// The pan/zoom window, in CSS pixels of the canvas box. The viewBox is kept the
// SAME SIZE as the <svg> element rather than a fixed 900 units, so one tree unit
// is always one screen pixel at scale 1 and the picture never depends on how
// tall the box happens to be.
//
// That is the whole point: the info panel below the canvas is as tall as the
// node it describes (a hint, a two-line blurb, a spell unlock), so the canvas
// box changes height on EVERY tap. With a fixed 900-unit viewBox and
// preserveAspectRatio, that box change rescaled and re-centred the entire web —
// the tree visibly resized and jumped each time you picked another node. Sized
// this way the box can grow and shrink freely: the corner it is anchored at
// stays put, so nothing on screen moves, the panel just uncovers or covers a
// strip of tree.
//
// It also makes clientToVB an exact 1:1 mapping. It could not be one before:
// under `meet` the square viewBox was letterboxed inside a taller box, and the
// old maths ignored that offset, so pinch/wheel zoom drifted vertically instead
// of holding the point under the fingers.
const TREE_VP = { w: TREE_VIEW, h: TREE_VIEW, dpr: 1, measured: false };

// How much of the authored 900-unit window fits in the current box. The default
// zoom and the zoom limits are written against that window, so they scale with
// it and a phone still opens on exactly the framing they were chosen for.
function treeFit() { return Math.min(TREE_VP.w, TREE_VP.h) / TREE_VIEW; }

// Re-read the canvas box and keep the backing store matched to it. Returns true
// when the size actually changed. Deliberately does NOT touch the camera:
// leaving tx/ty/scale alone is what pins the picture to the box's top-left
// corner and keeps a resize (info panel, rotation, browser chrome) from moving
// anything.
//
// Setting canvas.width/height CLEARS the bitmap, so every path out of here ends
// in a redraw.
function syncTreeViewport() {
  const cv = treeCanvasEl();
  if (!cv) return false;
  const r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);   // 2 is already past what a phone can show here
  const pw = Math.round(r.width * dpr), ph = Math.round(r.height * dpr);
  // The backing store is checked as well as the box, and that is not belt and
  // braces: TREE_VP outlives the screen but the <canvas> does not. Re-entering
  // the forge builds a NEW canvas, which starts life at the default 300×150,
  // and its box measures exactly what the last visit measured — so a check on
  // the box alone reported "unchanged", returned early, and left the whole web
  // drawn into 300×150 and stretched across the box. That is the tree coming
  // back skewed on the second visit.
  const same = TREE_VP.measured && Math.abs(r.width - TREE_VP.w) < 0.5 &&
    Math.abs(r.height - TREE_VP.h) < 0.5 && TREE_VP.dpr === dpr &&
    cv.width === pw && cv.height === ph;
  if (same) return false;
  TREE_VP.w = r.width; TREE_VP.h = r.height; TREE_VP.dpr = dpr; TREE_VP.measured = true;
  cv.width = pw;
  cv.height = ph;
  drawTree(true);
  return true;
}
let treeResizeObs = null;

function initTreeView(resetSelection) {
  const s = 0.62 * treeFit();           // default zoom — shows the seed, every prelude, and all twelve keys
  const keep = (!resetSelection && state.tree) ? state.tree.selected : null;
  state.tree = {
    scale: s, selected: keep,
    tx: TREE_VP.w / 2 - TREE_CENTER * s,
    ty: TREE_VP.h / 2 - TREE_CENTER * s,
    fitted: TREE_VP.measured,           // false until the box has been measured once
  };
}

function runeGroup(theme, opacity) {
  return `<g class="n-rune" stroke="${TREE_THEMES[theme].color}" fill="none" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}">${glyphSvg(theme)}</g>`;
}
function runeGlyphSvg(theme, size) {
  return `<svg class="mini-rune" viewBox="-16 -16 32 32" width="${size}" height="${size}" aria-hidden="true">` +
    runeGroup(theme, 1) + `</svg>`;
}

// ---------------------------------------------------------------------------
// Drawing the web
//
// THE TREE IS A CANVAS, AND THAT IS NOT A RENDERING PREFERENCE. It was an SVG
// of ~1050 <circle>s, which is the natural way to write it and the way it reads
// best — but a phone browser's own "dark mode for web contents" repaints SVG
// and this game is painted in near-black. That filter treats every fill and
// stroke as FOREGROUND and inverts the dark ones, so the whole web came back as
// a field of white discs on real phones. Declaring the page dark does not stop
// it: the browsers that do this ignore `color-scheme` and the meta tag alike
// (see styles/base.css — those declarations are still worth keeping for the
// browsers that DO listen, they just can't be relied on).
//
// A canvas is the one surface the filter cannot reach, which is why the combat
// scene always looked right on the same phone that broke this screen. Measured
// against a forced browser dark mode: every other way of painting a dark shape
// — plain SVG fill, an SVG gradient paint server, a pattern of a PNG, a CSS
// background, forced-color-adjust:none — comes back inverted. Canvas does not.
//
// So: do NOT move the web back to SVG, and do not paint new tree furniture with
// DOM elements. The little runes in the info panel and on the Werte screen are
// still SVG on purpose (they are small, and they sit inside DOM panels), and
// they are the known cost of that line.
// ---------------------------------------------------------------------------

// Everything the web is painted in. These were CSS rules on .tedge/.tnode
// before; on a canvas the colours have to live where the drawing does.
const TREE_PAINT = {
  edgeOff: "#2c2742", edgeHalf: "#574f76", edgeOn: "#7ff0ed", edgeOnTick: "#bffcfa",
  hiddenFill: "#120e1c", hiddenRim: "#332e46", hiddenInk: "#4a4560",
  openFill: "#141020", pipOff: "#241f36", pipOffRim: "#3a3550", sel: "#eafffe",
  ground: "#131020",
};
const TREE_Q_FONT = '700 26px "Palatino Linotype", "Book Antiqua", Georgia, serif';

function treeCanvasEl() { return document.getElementById("tree-canvas"); }

// The rank pips under a node.
function drawNodeDots(ctx, rank, max, R, color) {
  const gap = 8.5, y = R + 11, w = (max - 1) * gap;
  ctx.lineWidth = 0.8;
  for (let i = 0; i < max; i++) {
    const on = i < rank;
    ctx.beginPath();
    ctx.arc(-w / 2 + i * gap, y, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = on ? color : TREE_PAINT.pipOff;
    ctx.strokeStyle = on ? color : TREE_PAINT.pipOffRim;
    ctx.fill();
    ctx.stroke();
  }
}

// One node, drawn about its own centre (the caller has already translated).
function drawNode(ctx, id) {
  const node = TREE_NODES[id];
  const theme = TREE_THEMES[node.theme];
  const purchased = isPurchased(id);
  const R = nodeRadius(id);
  const ring = (r, color, width, alpha, dash) => {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  };

  if (!nodeRevealed(id)) {
    // Hidden nodes render as a cheap "?" disc (most of a fresh tree is hidden,
    // which keeps the huge web light until you push into it).
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fillStyle = TREE_PAINT.hiddenFill;
    ctx.fill();
    ring(R, TREE_PAINT.hiddenRim, 3, 1);
    ctx.fillStyle = TREE_PAINT.hiddenInk;
    ctx.font = TREE_Q_FONT;
    ctx.textAlign = "center";
    ctx.fillText("?", 0, 9);
    return;
  }

  const rank = nodeRank(id);
  const maxed = rank >= node.maxRank;
  ctx.globalAlpha = purchased ? 1 : 0.85;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fillStyle = purchased ? `rgba(${theme.glow},0.25)` : TREE_PAINT.openFill;
  ctx.fill();
  ctx.strokeStyle = theme.color;
  ctx.lineWidth = purchased ? 4 : 3;
  ctx.stroke();
  ctx.globalAlpha = 1;
  if (purchased) ring(R - 6, theme.color, 1.5, 0.45);
  if (maxed && id !== "root") ring(R + 4.5, theme.color, 1.5, 0.6);

  if (node.unlocks) {
    // A sealed spell wears a solid double ring — plainly a different KIND of
    // prize from the keystones and caches that share the unique halo.
    ring(R + 6, theme.color, 2, purchased ? 0.95 : 0.55);
    ring(R + 10, theme.color, 1, purchased ? 0.6 : 0.3);
  } else if (node.unique) {
    // Keystones, arm notables and the thorn caches: a barbed halo instead of
    // rank pips, so finding one reads as a discovery.
    ring(R + 7, theme.color, 1.5, purchased ? 0.9 : 0.5, [4, 7]);
  } else if (id !== "root") {
    drawNodeDots(ctx, rank, node.maxRank, R, theme.color);
  }

  ctx.globalAlpha = purchased ? 1 : 0.9;
  ctx.strokeStyle = theme.color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(glyphPath(node.theme));
  ctx.lineCap = "butt";
  ctx.globalAlpha = 1;
}

// One edge, trimmed to the rims of the two circles it joins, with a
// perpendicular tick at its midpoint.
function drawEdge(ctx, a, b) {
  const pa = NODE_POS[a], pb = NODE_POS[b];
  const both = isPurchased(a) && isPurchased(b);
  const half = !both && (isPurchased(a) || isPurchased(b));
  const dx = pb.x - pa.x, dy = pb.y - pa.y, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  // Stop each end at the rim of the circle it connects (leave a hair of gap).
  const ra = nodeRadius(a) + 1.5, rb = nodeRadius(b) + 1.5;
  if (len <= ra + rb) return;                         // circles touch — no visible segment
  const x1 = pa.x + ux * ra, y1 = pa.y + uy * ra;
  const x2 = pb.x - ux * rb, y2 = pb.y - uy * rb;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const nx = -uy * 5, ny = ux * 5;                    // perpendicular tick at the midpoint

  ctx.strokeStyle = both ? TREE_PAINT.edgeOn : half ? TREE_PAINT.edgeHalf : TREE_PAINT.edgeOff;
  ctx.lineWidth = 4.5;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  if (both) ctx.strokeStyle = TREE_PAINT.edgeOnTick;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(mx - nx, my - ny);
  ctx.lineTo(mx + nx, my + ny);
  ctx.stroke();
  ctx.lineCap = "butt";
}

// The whole web, at the current camera.
//
// The web itself is drawn into an offscreen bitmap and kept until the camera or
// the ranks move; only the selection ring, which breathes, is redrawn per
// frame. Without that, holding a node selected would re-stroke a thousand
// circles sixty times a second to animate one ring.
let treeWeb = null, treeWebKey = "";
function drawTree(force) {
  const cv = treeCanvasEl();
  if (!cv || !state.tree || !cv.width) return;
  const t = state.tree, dpr = TREE_VP.dpr || 1;
  const key = [t.tx.toFixed(2), t.ty.toFixed(2), t.scale.toFixed(4), cv.width, cv.height].join("|");

  if (force || key !== treeWebKey || !treeWeb) {
    if (!treeWeb) treeWeb = document.createElement("canvas");
    if (treeWeb.width !== cv.width || treeWeb.height !== cv.height) {
      treeWeb.width = cv.width; treeWeb.height = cv.height;
    }
    const w = treeWeb.getContext("2d");
    w.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Paint the ground rather than clearing to transparent. A transparent
    // canvas shows the page's own background through the gaps in the web, and
    // that background is CSS — the very thing a phone's dark mode is free to
    // repaint. Painting it here keeps the whole box inside the one surface the
    // filter can't reach. (Matches the middle of .tree-screen's radial ground.)
    w.fillStyle = TREE_PAINT.ground;
    w.fillRect(0, 0, TREE_VP.w, TREE_VP.h);
    w.translate(t.tx, t.ty);
    w.scale(t.scale, t.scale);

    // Only what the window can actually show, padded by a node's furthest ring
    // plus its rank pips. At the default framing that is most of the tree; zoom
    // in and it becomes a handful.
    const pad = 60;
    const x0 = -t.tx / t.scale - pad, y0 = -t.ty / t.scale - pad;
    const x1 = (TREE_VP.w - t.tx) / t.scale + pad, y1 = (TREE_VP.h - t.ty) / t.scale + pad;
    const near = (p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;

    for (const [a, b] of TREE_EDGES) if (near(NODE_POS[a]) || near(NODE_POS[b])) drawEdge(w, a, b);
    for (const id in TREE_NODES) {
      const p = NODE_POS[id];
      if (!near(p)) continue;
      w.save();
      w.translate(p.x, p.y);
      drawNode(w, id);
      w.restore();
    }
    treeWebKey = key;
  }

  const ctx = cv.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(treeWeb, 0, 0);

  // The selection ring, breathing the way the CSS animation used to (0.5 → 1
  // and back over 1.4s).
  const sel = t.selected && NODE_POS[t.selected];
  if (sel) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(t.tx, t.ty);
    ctx.scale(t.scale, t.scale);
    ctx.globalAlpha = 0.75 + 0.25 * Math.cos((state.clockMs || 0) / 1400 * Math.PI * 2);
    ctx.strokeStyle = TREE_PAINT.sel;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sel.x, sel.y, nodeRadius(t.selected) + 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// Which node is under a point given in canvas-box pixels, or null. The web is
// a bitmap now, so there is no element to hit-test — but the tree is only ever
// a thousand positions, so this is a cheap sweep rather than a spatial index.
function nodeAtPoint(vx, vy) {
  const t = state.tree;
  if (!t) return null;
  const x = (vx - t.tx) / t.scale, y = (vy - t.ty) / t.scale;
  let best = null, bestD = Infinity;
  for (const id in NODE_POS) {
    const p = NODE_POS[id];
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= nodeRadius(id) + 4 && d < bestD) { bestD = d; best = id; }
  }
  return best;
}

// Called every frame the forge is up: the only thing that moves is the
// selection ring, and only while something is selected.
function patchTreeContinuous() {
  if (state.tree && state.tree.selected) drawTree();
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
  // One rank, because one rank is what the price below buys. How many there are
  // is the dots' job, not a second sentence's.
  const per = effectText(node.effect, 1);

  let dots = "";
  for (let i = 0; i < node.maxRank; i++) dots += `<i class="dot${i < rank ? " on" : ""}"></i>`;

  let buy;
  if (id === "root") {
    buy = `<button class="tree-buy" disabled>Ursprung</button>`;
  } else if (maxed) {
    const done = node.unlocks ? "Erlernt" : node.unique ? "Gehoben" : "Maximal";
    buy = `<button class="tree-buy" disabled>${done}</button>`;
  } else if (!nodeReachable(id)) {
    // A beacon key you can see but haven't walked to yet.
    buy = `<button class="tree-buy" disabled>Noch nicht erreicht</button>`;
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
      ${node.unique ? `<span class="ti-unique" style="color:${theme.color}">${node.unlocks ? "Zauber" : "Einzigartig"}</span>`
        : node.maxRank ? `<span class="ti-dots" style="color:${theme.color}">${dots}</span>` : ""}
    </div>
    ${node.path && node.path !== node.title ? `<div class="ti-path">${node.path}</div>` : ""}
    ${node.blurb ? `<div class="ti-blurb">${node.blurb}</div>` : ""}
    ${node.unlocks ? `<div class="ti-effect">Schaltet frei: <b>${SPELL_BY_ID[node.unlocks].name}</b></div>` : ""}
    ${per ? `<div class="ti-effect">${node.maxRank > 1 ? "Pro Stufe" : "Einmalig"}: <b>${per}</b></div>` : ""}
    ${buy}</div>`;
}

// ---------------------------------------------------------------------------
// Dev tools — the slider in the tree topbar arms two testing shortcuts: wipe
// every purchased rank, and type an amount straight into the purse, so a build
// can be tried without first playing the runs that would pay for it. While the
// slider is off none of it is reachable (every handler bails on state.devMode),
// so all a player ever sees is the slider itself. The flag is persisted, so a
// tester keeps the tools armed across reloads.
// ---------------------------------------------------------------------------
let devResetArmed = false;   // the wipe asks once first — thumb-sized button, no undo

function devSwitchMarkup() {
  const on = !!state.devMode;
  return `<button class="dev-switch${on ? " on" : ""}" role="switch" aria-checked="${on}" ` +
    `data-act="devToggle" aria-label="Testmodus"><span class="dev-switch-text">Dev</span>` +
    `<span class="dev-switch-track"><span class="dev-switch-knob"></span></span></button>`;
}

// The purse. Plain text normally; a button that opens the amount for editing
// once the dev slider is on.
function treeGoldMarkup() {
  const coin = `<span class="coin">◈</span> ${state.gold}`;
  return state.devMode
    ? `<button class="tree-gold dev" data-act="devEditGold" aria-label="Gold setzen">${coin}</button>`
    : `<div class="tree-gold">${coin}</div>`;
}

// The row under the topbar, present only while the tools are armed.
function devBarMarkup() {
  if (!state.devMode) return "";
  return `<div class="dev-bar">
    <button class="dev-btn${devResetArmed ? " armed" : ""}" data-act="devResetTree">
      ${devResetArmed ? "Wirklich? Nochmal tippen" : "Baum zurücksetzen"}</button>
    <span class="dev-note">Gold antippen zum Setzen</span>
  </div>`;
}

function devToggle() {
  state.devMode = !state.devMode;
  devResetArmed = false;
  saveProgress();
  state._structuralDirty = true;
}

// Wipe every purchased rank. Gold is NOT refunded — the purse is editable right
// next to the button, so handing coins back would only get in the way.
function devResetTree() {
  if (!state.devMode) return;
  if (!devResetArmed) { devResetArmed = true; state._structuralDirty = true; return; }
  devResetArmed = false;
  state.nodeRanks = {};
  // Every spell but the starter is sealed again along with the node that opened
  // it, so the book has to be put back on a page the hero can still cast.
  state.activeSpell = STARTER_SPELL;
  const slot = (typeof bookSlot === "function") ? bookSlot(STARTER_SPELL) : -1;
  if (slot >= 0) state.bookSpread = Math.floor(slot / 2);
  recomputeMods();
  state.heroHP = Math.min(state.heroHP, state.heroMaxHP);
  if (state.tree) state.tree.selected = null;
  saveProgress();
  state._structuralDirty = true;
}

// Tap the purse: a small field with a ✓ drops out of it. It hangs BELOW the
// topbar rather than replacing the pill, so a six-digit amount can't squeeze
// the title and the Buch button out of a phone-width row. Patched into the DOM
// instead of re-rendered, so the field keeps focus (and the phone keyboard
// stays up) while the amount is typed. There is deliberately no Enter handling
// — the confirm is a tap, like everything else (see CLAUDE.md). Tapping the
// purse again puts the field away.
function devEditGold() {
  if (!state.devMode) return;
  const slot = document.getElementById("tree-gold-slot");
  if (!slot) return;
  const open = slot.querySelector(".dev-gold-pop");
  if (open) { open.remove(); return; }
  slot.insertAdjacentHTML("beforeend",
    `<div class="dev-gold-pop"><span class="coin">◈</span>` +
    `<input class="dev-gold-input" type="number" inputmode="numeric" min="0" ` +
    `max="${CONFIG.dev.goldMax}" value="${state.gold}">` +
    `<button class="dev-gold-ok" data-act="devGoldCommit" aria-label="Gold übernehmen">✓</button></div>`);
  const input = slot.querySelector(".dev-gold-input");
  if (input) { input.focus(); input.select(); }
}

function devGoldCommit() {
  const input = document.querySelector(".dev-gold-input");
  if (!input) return;
  const n = Math.floor(Number(input.value));
  if (Number.isFinite(n)) state.gold = treeClamp(n, 0, CONFIG.dev.goldMax);
  saveProgress();
  state._structuralDirty = true;   // redraws the purse and re-prices every Kaufen button
}

// The whole upgrade phase is the tree now. Called by the loop router for the
// "upgrade" screen (structural rebuild only — pan/zoom and node selection patch
// the DOM live, so tapping around the web stays cheap).
function renderUpgradeFull() {
  // A brand-new camera gets provisional numbers here (there is no box to measure
  // until this markup is in the document) and its real framing a few lines down
  // in attachTreeInteractions. Dropping `measured` makes sure the box is re-read
  // rather than trusted from an earlier visit, which may have been a different
  // size or orientation.
  if (!state.tree) { TREE_VP.measured = false; initTreeView(true); }

  app.innerHTML = `
    <div class="screen tree-screen">
      <div class="tree-topbar">
        <div class="tree-title">Runenbaum</div>
        ${devSwitchMarkup()}
        <!-- The two things the forge does BESIDE buying nodes: bind the book
             into an order (book-order.js), and read what the build now adds up
             to (stats.js). -->
        <div class="tree-tools">
          <button class="bo-open" data-act="openStats">
            <svg class="sv-open-icon" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="1.5" y="9" width="3" height="5.5" rx="0.7"/>
              <rect x="6.5" y="5.5" width="3" height="9" rx="0.7"/>
              <rect x="11.5" y="2" width="3" height="12.5" rx="0.7"/>
            </svg>Werte
          </button>
          <button class="bo-open" data-act="openBookOrder">
            <svg class="bo-open-icon" viewBox="0 0 24 16" aria-hidden="true">
              <path d="M12 3.4C9.6 1.6 6.6 1.2 3 1.9v11.4c3.6-.7 6.6-.3 9 1.5 2.4-1.8 5.4-2.2 9-1.5V1.9c-3.6-.7-6.6-.3-9 1.5Z"/>
              <path class="bo-open-spine" d="M12 3.4v11.4"/>
            </svg>Buch
          </button>
        </div>
        <div id="tree-gold-slot">${treeGoldMarkup()}</div>
      </div>
      ${devBarMarkup()}
      <canvas class="tree-canvas" id="tree-canvas"></canvas>
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
  const slot = document.getElementById("tree-info-slot");
  if (slot) slot.innerHTML = renderTreeInfo();
  // The panel just changed height, so the canvas box did too. Re-measure it
  // here and now rather than waiting on the ResizeObserver: the observer only
  // runs at the end of the task, which leaves the tree drawn through a stale
  // window for anything that reads its geometry in between. syncTreeViewport
  // redraws when the box really did change; when it didn't, draw the ring.
  if (!syncTreeViewport()) drawTree();
}

// The camera moved, so the web has to be re-drawn at the new one. (Under SVG
// this only had to write a transform attribute and the compositor did the rest;
// on a canvas the picture IS the drawing, so panning costs a redraw. That is
// what the offscreen bitmap in drawTree keeps down to one.)
function applyTreeCam() { drawTree(); }
// Zoom about a point given in viewBox coords, keeping it fixed under the cursor.
// The limits are the authored ones scaled by how much of the 900-unit window the
// box holds, so they mean the same thing on any screen.
function treeZoomAt(vx, vy, factor) {
  const t = state.tree;
  const f = treeFit();
  const ns = treeClamp(t.scale * factor, 0.1 * f, 3.2 * f);
  const real = ns / t.scale;
  t.tx = vx - (vx - t.tx) * real;
  t.ty = vy - (vy - t.ty) * real;
  t.scale = ns;
}
// Toolbar buttons — zoom about the middle of the canvas box.
function treeZoom(factor) { treeZoomAt(TREE_VP.w / 2, TREE_VP.h / 2, factor); applyTreeCam(); }
function treeReset() { syncTreeViewport(); initTreeView(false); applyTreeCam(); }

// Pan (one pointer), pinch (two pointers), wheel zoom, and tap-to-select — all
// bound to the freshly rendered SVG. Pan/zoom mutate the transform live and
// persist to state.tree; selection patches the DOM in place. Neither rebuilds.
function attachTreeInteractions() {
  const svg = treeCanvasEl();
  if (!svg) return;
  const pts = new Map();
  let last = null, moved = 0, pinch = 0, downId = null;

  // This is a fresh <canvas>, so the cached web belongs to an element that is
  // gone. Drop it or the first frame blits the old screen's bitmap.
  treeWeb = null; treeWebKey = "";

  // Size the backing store to the box before anything reads it, and settle the
  // default framing the first time we know how big the box really is.
  syncTreeViewport();
  if (state.tree && !state.tree.fitted && TREE_VP.measured) {
    initTreeView(false);
  }
  applyTreeCam();
  // The box also changes height whenever the info panel below it does (a taller
  // node description, the dev bar opening). Keep the backing store in step; the
  // camera is left alone, so the web stays exactly where it was on screen. One
  // observer for the screen's lifetime, re-pointed at each rebuild's canvas.
  if (typeof ResizeObserver === "function") {
    if (!treeResizeObs) treeResizeObs = new ResizeObserver(() => { syncTreeViewport(); });
    treeResizeObs.disconnect();
    treeResizeObs.observe(svg);
  }

  // The camera works in CSS pixels of the box, so this is 1:1.
  const clientToVB = (cx, cy) => {
    const r = svg.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
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
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      moved += Math.abs(dx) + Math.abs(dy);
      state.tree.tx += dx; state.tree.ty += dy;
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
    // A near-stationary single-pointer tap on a node selects it. There is no
    // element under the finger any more — the web is a bitmap — so the node is
    // found by where it sits rather than by what was hit.
    if (wasSingle && moved < 8 && e.pointerId === downId) {
      const p = clientToVB(e.clientX, e.clientY);
      const id = nodeAtPoint(p.x, p.y);
      if (id) selectNode(id);
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

// What the tree ACTUALLY holds of each stat, counted off the finished nodes —
// the targets in CONFIG.treeTotals as they came out after rounding. This is the
// figure the ledger measures a build against, so the screen can never quote a
// total the nodes don't really add up to.
const TREE_SUPPLY = supplyOf(TREE_NODES);

window.Incanto.skilltree = {
  TREE_NODES, TREE_EDGES, NODE_POS, TREE_THEMES, ARMS, TREE_SUPPLY, supplyOf,
  effectText,
  recomputeMods, treeBuy, treeZoom, treeReset,
  renderUpgradeFull, patchTreeContinuous, drawTree, nodeAtPoint,
  nodeRevealed, nodeReachable, nodeCost, nodeRank,
  devToggle, devResetTree, devEditGold, devGoldCommit,
};
