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
// ---------------------------------------------------------------------------
const TREE_THEMES = {
  origin:    { color: "#eafffe", glow: "234,255,254" }, // the central seed
  might:     { color: "#ff7043", glow: "255,112,67"  }, // flat + % damage
  vigor:     { color: "#5ecf8f", glow: "94,207,143"  }, // flat + % HP
  crit:      { color: "#f2c14e", glow: "242,193,78"  }, // crit chance + crit damage
  sustain:   { color: "#e5679a", glow: "229,103,154" }, // regen + life leech
  guard:     { color: "#4de3e0", glow: "77,227,224"  }, // shields + fail-protection
  fortune:   { color: "#d9a441", glow: "217,164,65"  }, // gold + walk speed
  focus:     { color: "#c08cff", glow: "192,140,255" }, // cast speed
  thorn:     { color: "#ff3b30", glow: "255,59,48"   }, // the five unique thorn caches
  // One per page of the book — same colour the spell burns in on the canvas.
  fireball:  { color: "#f2a83a", glow: "242,168,58"  },
  lightning: { color: "#7fb8ff", glow: "127,184,255" },
  frost:     { color: "#79d8ee", glow: "121,216,238" },
  meteor:    { color: "#e5673a", glow: "229,103,58"  },
  shield:    { color: "#9a8ff0", glow: "154,143,240" },
  heal:      { color: "#6ed08a", glow: "110,208,138" },
};

// Small runic line-glyphs in local coords (centred on 0,0, ~±13). Stroke is
// inherited from the wrapping <g>, so colour is set once per node.
const RUNE_GLYPHS = {
  origin:    `<circle cx="0" cy="0" r="10"/><circle cx="0" cy="0" r="4"/><line x1="0" y1="-10" x2="0" y2="-14"/><line x1="0" y1="10" x2="0" y2="14"/><line x1="-10" y1="0" x2="-14" y2="0"/><line x1="10" y1="0" x2="14" y2="0"/>`,
  might:     `<polyline points="-9,4 0,-7 9,4"/><polyline points="-9,10 0,-1 9,10"/>`,
  vigor:     `<line x1="0" y1="-11" x2="0" y2="11"/><line x1="-10" y1="-1" x2="10" y2="-1"/><line x1="-5" y1="-11" x2="5" y2="-11"/>`,
  crit:      `<polygon points="0,-12 2.6,-2.6 12,0 2.6,2.6 0,12 -2.6,2.6 -12,0 -2.6,-2.6"/>`,
  sustain:   `<path d="M0,-11 C7,-3 7,7 0,10 C-7,7 -7,-3 0,-11 Z"/>`,
  guard:     `<polygon points="0,-11 9,-6 9,4 0,11 -9,4 -9,-6"/>`,
  fortune:   `<circle cx="0" cy="0" r="9"/><polygon points="0,-4 4,0 0,4 -4,0"/>`,
  focus:     `<circle cx="0" cy="0" r="4.5"/><line x1="0" y1="-6.5" x2="0" y2="-12"/><line x1="0" y1="6.5" x2="0" y2="12"/><line x1="-6.5" y1="0" x2="-12" y2="0"/><line x1="6.5" y1="0" x2="12" y2="0"/><line x1="-4.6" y1="-4.6" x2="-8.5" y2="-8.5"/><line x1="4.6" y1="4.6" x2="8.5" y2="8.5"/>`,
  thorn:     `<path d="M-10,9 C-4,4 4,-4 10,-9"/><path d="M-6,5 L-9,-1"/><path d="M-1,0 L2,-6"/><path d="M4,-5 L1,-11"/><path d="M-3,2 L-6,8"/><path d="M2,-3 L5,3"/>`,
  // The six pages. Each is the spell's silhouette in one or two strokes.
  fireball:  `<circle cx="0" cy="2" r="6.5"/><path d="M-6,-4 C-3,-9 -1,-8 0,-12 C1,-8 3,-9 6,-4"/>`,
  lightning: `<polyline points="3,-12 -5,-1 1,-1 -3,12"/><line x1="8" y1="-8" x2="11" y2="-11"/><line x1="-8" y1="8" x2="-11" y2="11"/>`,
  frost:     `<line x1="0" y1="-12" x2="0" y2="12"/><line x1="-10.4" y1="-6" x2="10.4" y2="6"/><line x1="-10.4" y1="6" x2="10.4" y2="-6"/><path d="M-3,-8 L0,-11 L3,-8"/><path d="M-3,8 L0,11 L3,8"/>`,
  meteor:    `<circle cx="2" cy="2" r="5.5"/><line x1="-4" y1="-4" x2="-11" y2="-11"/><line x1="-7" y1="0" x2="-12" y2="-4"/><line x1="0" y1="-7" x2="-4" y2="-12"/>`,
  shield:    `<path d="M0,-11 L9,-7 L9,1 C9,7 4,10 0,12 C-4,10 -9,7 -9,1 L-9,-7 Z"/><line x1="0" y1="-5" x2="0" y2="6"/>`,
  heal:      `<path d="M0,11 C-9,4 -11,-3 -7,-8 C-4,-11 -1,-10 0,-6 C1,-10 4,-11 7,-8 C11,-3 9,4 0,11 Z"/>`,
};

// ---------------------------------------------------------------------------
// Geometry — the tree lives in a large tree-space (seed at TREE_CENTER); the
// 900-unit SVG viewBox is just the pan/zoom window onto it. A node's place is
// fully determined by three authored numbers: which arm it's on, its RING
// (distance from the seed = tier), and its lateral fraction across the arm's
// wedge. Nothing is random, so ids stay stable and saves keep working.
// ---------------------------------------------------------------------------
const TREE_CENTER = 2600;      // seed sits at the middle of the tree-space
const TREE_VIEW = 900;         // SVG viewBox size = the pan/zoom window
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

// A node's effect grows gently with its ring — enough that a deep node is
// clearly the better one, not so much that a single outer node saturates a
// capped pool on its own (see CONFIG.caps and softCap).
const VAL_PER_RING = 0.14;
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

// Stats counted in whole bodies (an extra fireball target, an extra lightning
// hop, an extra meteor). They grant exactly 1 wherever they're planted — half a
// skeleton is not a thing — so a deep one simply costs more.
const COUNT_STATS = { tgtFireball: 1, chainLightning: 1, countMeteor: 1 };

// ---------------------------------------------------------------------------
// Archetypes — the reusable node types. A branch is written as a short list of
// these that it cycles through outward, so "this branch is about crit" is a
// property of the branch, not of thirty hand-written nodes.
// ---------------------------------------------------------------------------
const A = {
  dmgFlat:    { stat: "flatDmg",    theme: "might",   base: 2,     cost: 15, maxRank: 3,
                title: "Schneide",      blurb: "Schärft deinen Grundschaden — jede Seite des Buches trifft härter." },
  dmgPct:     { stat: "pctDmg",     theme: "might",   base: 0.04,  cost: 22, maxRank: 3,
                title: "Zorn",          blurb: "Verstärkt allen Schaden prozentual." },
  hpFlat:     { stat: "flatHp",     theme: "vigor",   base: 8,     cost: 14, maxRank: 3,
                title: "Zähigkeit",     blurb: "Erhöht deine maximalen Lebenspunkte." },
  hpPct:      { stat: "pctHp",      theme: "vigor",   base: 0.04,  cost: 20, maxRank: 3,
                title: "Lebenskraft",   blurb: "Mehr Lebenspunkte prozentual." },
  critChance: { stat: "critChance", theme: "crit",    base: 0.02,  cost: 22, maxRank: 3,
                title: "Präzision",     blurb: "Chance, dass ein Treffer kritisch einschlägt." },
  critMult:   { stat: "critMult",   theme: "crit",    base: 0.09,  cost: 24, maxRank: 3,
                title: "Wucht",         blurb: "Kritische Treffer schlagen härter zu." },
  // Armour penetration — the counter-stat to CONFIG.armorK. Its supply is
  // deliberately narrow (the Macht arm's Zermalmen branch, two keystones and
  // Falkenauge), so shredding plate is a detour a build chooses, like Dornen.
  armorPen:   { stat: "armorPen",   theme: "might",   base: 0.25,  cost: 24, maxRank: 3,
                title: "Durchschlag",   blurb: "Deine Zauber durchschlagen einen Teil der Panzerung des Getroffenen." },
  regen:      { stat: "regen",      theme: "sustain", base: 0.2,   cost: 20, maxRank: 3,
                title: "Genesung",      blurb: "Regeneriert langsam Lebenspunkte im Kampf." },
  leech:      { stat: "leech",      theme: "sustain", base: 0.025, cost: 26, maxRank: 3,
                title: "Aderlass",      blurb: "Heilt dich für einen Teil des Zauberschadens." },
  coin:       { stat: "coinMult",   theme: "fortune", base: 0.05,  cost: 20, maxRank: 3,
                title: "Glückssträhne", blurb: "Mehr Gold für richtig gelöste Vokabeln." },
  walk:       { stat: "walkMult",   theme: "fortune", base: 0.04,  cost: 22, maxRank: 3,
                title: "Flinkheit",     blurb: "Der Held schreitet zügiger durch den Gang." },
  failProt:   { stat: "spellFailProt", theme: "guard", base: 0.035, cost: 28, maxRank: 2, growth: 1.6,
                title: "Schutzzauber",  blurb: "Chance, den Rückschlag eines Fehlschlags ganz abzuwehren." },
  haste:      { stat: "castHaste",  theme: "focus",   base: 0.015, cost: 26, maxRank: 2, growth: 1.6,
                title: "Zauberhast",    blurb: "Der fertige Zauber löst sich schneller vom Stab." },
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
// target/hop/rock is a real decision rather than a rounding error.
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
  return { title: "Rohe Kraft", arch: [A.dmgFlat, A.dmgPct, A.dmgFlat],
    tip: uq("might", `${L.word}gewalt`, KEYSTONE_COST, { flatDmg: 8, pctDmg: 0.06 },
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
    tip: uq("sustain", `${L.word}zehrung`, KEYSTONE_COST, { leech: 0.06, regen: 0.4 },
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
//   · every % damage pool, every crit pool, every HP pool soft-caps on its own
//     (CONFIG.caps), so the outward push is rewarded with BREADTH — more pages,
//     more bodies hit, more keystones — rather than with a bigger single number;
//   · the whole-body nodes (an extra target, hop, rock) and the keystones sit
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
    [A.dmgFlat, A.dmgFlat, A.dmgPct, A.critChance],
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
    prelude: [A.dmgFlat, A.dmgFlat, A.dmgPct, A.dmgFlat],
    notable: uq("might", "Kriegsherz", NOTABLE_COST, { flatDmg: 4, pctDmg: 0.06 },
      "Ein Herz, das den Kampf sucht. Alles, was du wirkst, wiegt schwerer."),
    branches: [
      { title: "Schneide", arch: [A.dmgFlat, A.dmgFlat, A.dmgPct],
        tip: uq("might", "Henkersklinge", KEYSTONE_COST, { flatDmg: 10, armorPen: 1.2 },
          "Ein Schnitt, der nicht fragt, wie viel Knochen im Weg steht.") },
      { title: "Zorn", arch: [A.dmgPct, A.dmgPct, A.dmgFlat],
        tip: uq("might", "Blinder Zorn", KEYSTONE_COST, { pctDmg: 0.18 },
          "Du hörst auf zu zielen und fängst an zu treffen.") },
      // Zermalmen is where armour penetration lives: crushing through the plate
      // is the same idea as crushing through the body behind it.
      { title: "Zermalmen", arch: [A.armorPen, A.dmgFlat, A.critMult],
        tip: uq("might", "Zermalmender Hieb", KEYSTONE_COST, { critMult: 0.35, flatDmg: 4, armorPen: 0.6 },
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
        tip: uq("sustain", "Ewige Quelle", KEYSTONE_COST, { regen: 1.0, leech: 0.05 },
          "Die Quelle versiegt nicht mehr, auch wenn du das Wort nicht sprichst.") },
      { title: "Fürsorge", arch: [A.hpFlat, A.hpPct, A.hpFlat],
        tip: uq("vigor", "Zweites Leben", KEYSTONE_COST, { flatHp: 30, pctHp: 0.10 },
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
    [A.hpFlat, A.dmgFlat, A.hpPct, A.dmgPct],
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
    notable: uq("sustain", "Lebensband", NOTABLE_COST, { regen: 0.5, leech: 0.03 },
      "Ein Faden zwischen dir und allem, was du niederstreckst."),
    branches: [
      { title: "Genesung", arch: [A.regen, A.regen, A.hpFlat],
        tip: uq("sustain", "Lebensstrom", KEYSTONE_COST, { regen: 1.1 },
          "Wunden schließen sich, während du noch zeichnest.") },
      { title: "Aderlass", arch: [A.leech, A.leech, A.dmgFlat],
        tip: uq("sustain", "Blutdurst", KEYSTONE_COST, { leech: 0.09 },
          "Jeder Zauber bringt dir zurück, was er dem Gang nimmt.") },
      { title: "Wandeln", arch: [A.leech, A.hpPct, A.regen],
        tip: uq("sustain", "Wandelndes Grab", KEYSTONE_COST, { leech: 0.05, regen: 0.5, flatHp: 12 },
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

  // ---- Guard: absorb, fail-protection, the arm that keeps a fragile build alive.
  { key: "gua", kind: "generic", theme: "guard", title: "Abwehr",
    prelude: [A.hpFlat, A.shield, A.failProt, A.hpFlat],
    notable: uq("guard", "Wächterrune", NOTABLE_COST, { shieldChance: 0.08, shieldAmount: 6, shieldMax: 10 },
      "Eine Rune, die mitwacht, wenn du dich auf das Zeichnen konzentrierst."),
    branches: [
      { title: "Schildzauber", arch: [A.shield, A.shield, A.hpFlat],
        tip: uq("guard", "Ewiger Wall", KEYSTONE_COST, { shieldChance: 0.12, shieldAmount: 10, shieldMax: 24 },
          "Der Schild fällt nicht mehr ganz — er wird nur dünner.") },
      { title: "Schutzzauber", arch: [A.failProt, A.hpFlat, A.haste],
        tip: uq("guard", "Bannkreis", KEYSTONE_COST, { spellFailProt: 0.14 },
          "Ein misslungenes Zeichen kostet dich meist nur noch das Zeichen.") },
      { title: "Standhaftigkeit", arch: [A.hpFlat, A.shield, A.hpPct],
        tip: uq("guard", "Eisenwille", KEYSTONE_COST, { flatHp: 20, spellFailProt: 0.06, shieldMax: 12 },
          "Was dich treffen will, muss erst durch deinen Entschluss."),
        tip2: uq("thorn", "Dornenkrone", THORN_COST, { thorns: THORN_VALUE },
          "Ein verborgener Hort, nur ein einziges Mal zu heben. Ein Teil jedes erlittenen Schlages fährt in den Angreifer zurück.") },
    ] },

  // ---- Bannschild: absorb built from spell power, so raw damage lifts it too.
  { key: "shi", kind: "spell", spell: "shield", theme: "shield", title: "Bannschild",
    prelude: [A.hpFlat, A.hpFlat, A.shield, A.hpPct],
    branches: [
      bRawPower(SPELL_LORE.shield),
      bSigil("shield", SPELL_LORE.shield),
      { title: "Wirkung", arch: [A.shield, A.shield, sigil("shield")],
        tip: uq("shield", "Unzerbrechlich", KEYSTONE_COST, { shieldChance: 0.15, shieldAmount: 12, shieldMax: 40 },
          "Der Bann hält, auch wenn du längst nicht mehr hinsiehst.") },
      { title: "Bollwerk", arch: [A.hpFlat, A.hpPct, A.hpFlat],
        tip: uq("vigor", "Steinhaut", KEYSTONE_COST, { flatHp: 30, pctHp: 0.08 },
          "Knochen prallen ab, wo sie früher eindrangen.") },
      { title: "Wehrhaftigkeit", arch: [A.failProt, A.haste, A.hpFlat],
        tip: uq("guard", "Bannwall", KEYSTONE_COST, { spellFailProt: 0.12, castHaste: 0.06 },
          "Der Schild steht schon, bevor das Zeichen fertig ist.") },
    ] },

  // ---- Vigour: the plain HP arm.
  { key: "vig", kind: "generic", theme: "vigor", title: "Zähigkeit",
    prelude: [A.hpFlat, A.hpFlat, A.hpPct, A.hpFlat],
    notable: uq("vigor", "Eisenleib", NOTABLE_COST, { flatHp: 20, pctHp: 0.06 },
      "Ein Körper, der gelernt hat, im Gang zu stehen."),
    branches: [
      { title: "Knochenbau", arch: [A.hpFlat, A.hpFlat, A.hpPct],
        tip: uq("vigor", "Mark und Bein", KEYSTONE_COST, { flatHp: 34 },
          "Du trägst mehr, als ein Mensch tragen sollte.") },
      { title: "Lebenskraft", arch: [A.hpPct, A.hpPct, A.hpFlat],
        tip: uq("vigor", "Zweites Herz", KEYSTONE_COST, { pctHp: 0.18 },
          "Ein zweiter Schlag hinter dem ersten, für den Fall der Fälle.") },
      { title: "Beharrlichkeit", arch: [A.hpFlat, A.regen, A.hpPct],
        tip: uq("vigor", "Unbeugsam", KEYSTONE_COST, { regen: 0.9, flatHp: 12 },
          "Du gehst weiter, weil Stehenbleiben nie zur Debatte stand."),
        tip2: uq("thorn", "Dornenkrone", THORN_COST, { thorns: THORN_VALUE },
          "Ein verborgener Hort, nur ein einziges Mal zu heben. Ein Teil jedes erlittenen Schlages fährt in den Angreifer zurück.") },
    ] },

  // ---- Feuerball: the page you start with, so its key is a keystone, not a
  // seal. Its shape branch buys extra targets — the spell's whole upgrade path.
  damageSpellArm("fir", "fireball",
    [A.dmgFlat, A.dmgPct, A.critChance, A.dmgFlat],
    { title: "Wirkung",
      arch: [
        bodyNode("tgtFireball", "fireball", "Splitterzauber", "Der Feuerball trifft ein zusätzliches Ziel — mit voller Wucht."),
        sigil("fireball"),
        A.haste,
      ],
      tip: uq("fireball", "Zwillingsflamme", KEYSTONE_COST, { tgtFireball: 2 },
        "Aus einer Kugel werden drei, und keine davon ist die schwächere.") }),

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
function ringCost(base, ring) { return Math.max(5, Math.round(base * Math.pow(ring, COST_RING_POW))); }

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

  const pos = radialSlices(nodes, kids);
  relaxTree(pos, nodes, edges);
  return { nodes, pos, edges };
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

// One archetype, resolved at a ring: value scaled by the tier, cost by the ring.
function archNode(arch, ring, path, maxRankOverride) {
  const tier = 1 + VAL_PER_RING * (ring - 1);
  let effect;
  if (arch.special === "shield") {
    effect = { shieldChance: Math.min(0.12, 0.05 + 0.004 * ring),
      shieldAmount: Math.round(3 * tier), shieldMax: Math.round(5 * tier) };
  } else if (COUNT_STATS[arch.stat]) {
    effect = { [arch.stat]: 1 };
  } else {
    let v = arch.base * tier;
    if (arch.stat === "flatDmg" || arch.stat === "flatHp" || arch.stat === "freezeFrost") v = Math.max(1, Math.round(v));
    else if (arch.stat === "regen") v = Math.round(v * 10) / 10;
    else v = Math.round(v * 1000) / 1000;
    effect = { [arch.stat]: v };
  }
  return { title: arch.title, theme: arch.theme, ring, path, effect, blurb: arch.blurb,
    maxRank: maxRankOverride || arch.maxRank || 3,
    cost: ringCost(arch.cost, ring), growth: arch.growth || RANK_GROWTH };
}

// A unique — its value is authored outright, only its price knows about depth.
function uniqueNode(spec, ring, path) {
  return { title: spec.title, theme: spec.theme, ring, path, effect: spec.effect, blurb: spec.blurb,
    unique: true, maxRank: 1, growth: 1, cost: ringCost(spec.cost, ring) };
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
      cost: ringCost(UNLOCK_COST, KEY_RING),
      blurb: `Ein versiegeltes Zeichen. Heb es, und der Zauber schlägt eine neue Seite in deinem Buch auf. ${spell.blurb}` };
  }
  const node = arm.notable
    ? uniqueNode(arm.notable, KEY_RING, arm.title)
    // Feuerball is already known, so its arm's key is a prize rather than a lock.
    : uniqueNode(uq("fireball", "Feuermal", 40, { dmgFireball: 0.15, flatDmg: 2 },
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

// Which summed stat feeds which spell's % damage / signature parameter. Split
// out so recomputeMods stays a flat read of the pools rather than a per-spell
// special case (see spells.js — a resolver reads mods.spellPct[id] and
// mods.spellParam[key], never the raw sums).
const SPELL_DMG_STATS = {
  fireball: "dmgFireball", lightning: "dmgLightning", frost: "dmgFrost",
  meteor: "dmgMeteor", shield: "dmgShield", heal: "dmgHeal",
};
// Whole-body counts are bounded by their spell's own maximum (CONFIG.spells),
// so they pass through uncapped; the shape parameters (cone reach, crater size,
// chain falloff) are bounded here — see CONFIG.caps.
const SPELL_PARAM_STATS = [
  "tgtFireball", "chainLightning", "countMeteor",
  "freezeFrost", "coneFrost", "aoeMeteor", "falloffLightning",
];

function recomputeMods() {
  const sum = {
    flatDmg: 0, flatHp: 0, pctDmg: 0, pctHp: 0,
    critChance: 0, critMult: 0, armorPen: 0,
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
  const caps = CONFIG.caps;
  // Each page's % damage soft-caps on its own, so dumping a whole arm into one
  // spell plateaus there instead of making the other five pointless.
  const spellPct = {};
  for (const id in SPELL_DMG_STATS) spellPct[id] = softCap(sum[SPELL_DMG_STATS[id]], caps.spellPct);
  const spellParam = {};
  for (const k of SPELL_PARAM_STATS) {
    spellParam[k] = caps[k] != null ? Math.min(caps[k], sum[k]) : sum[k];
  }

  state.mods = {
    critChance: Math.min(caps.critChance, sum.critChance),
    critMult: 1.5 + Math.min(caps.critMult, sum.critMult),  // base ×1.5 on a crit
    // Armour points shredded off whatever the target wears, before the mitigation
    // curve is read (see armorReduction in combat.js).
    armorPen: Math.min(caps.armorPen, sum.armorPen),
    spellsUnlocked: unlocked,
    spellPct,
    spellParam,
    leech: Math.min(caps.leech, sum.leech),
    regen: Math.min(caps.regen, sum.regen),
    castHaste: Math.min(caps.castHaste, sum.castHaste),
    // Gold and pace get soft caps too: Fortuna is a whole arm now, and neither
    // stat is bounded by anything downstream the way damage is by the caps.
    walkMult: 1 + softCap(sum.walkMult, caps.walkMult),
    coinMult: 1 + softCap(sum.coinMult, caps.coinMult),
    shieldChance: Math.min(caps.shieldChance, sum.shieldChance),
    shieldAmount: Math.min(caps.shieldAmount, sum.shieldAmount),
    shieldMax: Math.min(caps.shieldMax, sum.shieldMax),
    // Uncapped on purpose: only five unique nodes grant thorns at all, so the
    // sum can never exceed 5 × THORN_VALUE = 50%.
    thorns: sum.thorns,
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
const STAT_FMT = {
  flatDmg:      (v) => `+${Math.round(v)} Schaden`,
  flatHp:       (v) => `+${Math.round(v)} LP`,
  pctDmg:       (v) => `+${Math.round(v * 100)}% Schaden`,
  pctHp:        (v) => `+${Math.round(v * 100)}% LP`,
  critChance:   (v) => `+${Math.round(v * 100)}% Krit-Chance`,
  critMult:     (v) => `+${Math.round(v * 100)}% Krit-Schaden`,
  armorPen:     (v) => `+${(Math.round(v * 10) / 10)} Rüstungsbruch`,
  leech:        (v) => `${Math.round(v * 100)}% Lebensraub`,
  // Per-spell nodes — worded so the page they lift is named in the effect line.
  dmgFireball:  (v) => `+${Math.round(v * 100)}% Feuerball-Schaden`,
  dmgLightning: (v) => `+${Math.round(v * 100)}% Blitzschlag-Schaden`,
  dmgFrost:     (v) => `+${Math.round(v * 100)}% Frostkegel-Schaden`,
  dmgMeteor:    (v) => `+${Math.round(v * 100)}% Meteoriten-Schaden`,
  dmgShield:    (v) => `+${Math.round(v * 100)}% Bannschild-Kraft`,
  dmgHeal:      (v) => `+${Math.round(v * 100)}% Heilwort-Kraft`,
  tgtFireball:  (v) => `+${Math.round(v)} Feuerball-Ziel`,
  chainLightning: (v) => `+${Math.round(v)} Blitz-Sprung`,
  countMeteor:  (v) => `+${Math.round(v)} Meteorit`,
  freezeFrost:  (v) => `+${(v / 1000).toFixed(1)}s Frostdauer`,
  coneFrost:    (v) => `+${Math.round(v * 100)}% Kegelweite`,
  aoeMeteor:    (v) => `+${Math.round(v * 100)}% Einschlagradius`,
  falloffLightning: (v) => `+${Math.round(v * 100)}% Sprungkraft`,
  castHaste:    (v) => `+${Math.round(v * 100)}% Zaubertempo`,
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
function nodeRadius(id) {
  if (id === "root") return 34;
  return TREE_NODES[id] && TREE_NODES[id].unique ? 33 : 28;   // uniques sit a little larger
}

function initTreeView(resetSelection) {
  const s = 0.62;                       // default zoom — shows the seed, every prelude, and all twelve keys
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
    if (node.unlocks) {
      // A sealed spell wears a solid double ring — plainly a different KIND of
      // prize from the keystones and caches that share the unique halo.
      disc += `<circle r="${R + 6}" fill="none" stroke="${theme.color}" stroke-width="2" ` +
        `opacity="${purchased ? 0.95 : 0.55}"/>` +
        `<circle r="${R + 10}" fill="none" stroke="${theme.color}" stroke-width="1" ` +
        `opacity="${purchased ? 0.6 : 0.3}"/>`;
    } else if (node.unique) {
      // Keystones, arm notables and the thorn caches: a barbed halo instead of
      // rank pips, so finding one reads as a discovery.
      disc += `<circle r="${R + 7}" fill="none" stroke="${theme.color}" stroke-width="1.5" ` +
        `stroke-dasharray="4 7" opacity="${purchased ? 0.9 : 0.5}"/>`;
    } else if (id !== "root") {
      dots = nodeDotsSvg(rank, node.maxRank, R, theme.color);
    }
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
      <span class="ti-tier">Stufe ${node.ring}</span>
      ${node.unique ? `<span class="ti-unique" style="color:${theme.color}">${node.unlocks ? "Zauber" : "Einzigartig"}</span>`
        : node.maxRank ? `<span class="ti-dots" style="color:${theme.color}">${dots}</span>` : ""}
    </div>
    ${node.path && node.path !== node.title ? `<div class="ti-path">${node.path}</div>` : ""}
    <div class="ti-blurb">${node.blurb}</div>
    ${node.unlocks ? `<div class="ti-effect">Schaltet frei: <b>${SPELL_BY_ID[node.unlocks].name}</b></div>` : ""}
    ${per ? `<div class="ti-effect">${node.unique ? "Einmalig" : "Pro Stufe"}: <b>${per}</b>` +
      `${!node.unique && total ? ` &middot; Gesamt: <b>${total}</b>` : ""}</div>` : ""}
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
// the DOM live, so tapping around the web stays cheap).
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
  TREE_NODES, TREE_EDGES, NODE_POS, TREE_THEMES, ARMS, recomputeMods, treeBuy, treeZoom, treeReset,
  renderUpgradeFull, nodeRevealed, nodeReachable, nodeCost, nodeRank,
};
