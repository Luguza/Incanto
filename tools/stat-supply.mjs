// What the tree HOLDS of every stat, and what a build carries at a given spend.
//
// This is the tuning instrument for CONFIG.treeTotals, which is where the game's
// power curve is set. "target" is what that table asks for; "actual" is what the
// finished nodes add up to once each one's share has been rounded to something a
// tooltip can print. The gold columns are what a player who always buys the
// cheapest reachable rank carries after spending that much — nobody owns the
// whole tree, so those are the numbers that decide how the game plays.
//
// Edit CONFIG.treeTotals, run this, read the two columns.
//
//   node tools/stat-supply.mjs
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

// Fractions of CONFIG.treeGold — the last one is the endgame target.
const SHARES = [0.005, 0.02, 0.1, 0.3, 0.6, 0.9];
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: "load" });
await page.waitForTimeout(700);

const data = await page.evaluate((shares) => {
  const { TREE_NODES: N, TREE_EDGES: E, TREE_SUPPLY, nodeCost, treeBuy } = Incanto.skilltree;
  const adj = {};
  for (const [a, b] of E) { (adj[a] = adj[a] || []).push(b); (adj[b] = adj[b] || []).push(a); }
  const rows = {};
  const budgets = shares.map((f) => Math.round(CONFIG.treeGold * f));
  for (const budget of budgets) {
    state.nodeRanks = {}; state.gold = budget; recomputeMods();
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
    let allRanks = 0;
    for (const id in N) if (id !== "root") allRanks += N[id].maxRank;
    rows[budget] = {
      ...state.mods.sums,
      _pct: Math.round((Object.values(state.nodeRanks).reduce((a, b) => a + b, 0) / allRanks) * 100),
      _ranks: Object.values(state.nodeRanks).reduce((a, b) => a + b, 0),
      _hit: Math.round(Incanto.spells.spellPower("fireball")),
      _hp: state.heroMaxHP,
      _charge: Math.round(castChargeMs()),
    };
  }
  // A stat the player counts in whole units cannot total less than the number of
  // ranks granting it: every one of them has to print at least +1. Below that
  // floor the target is unreachable and the actual total runs away from it.
  const floor = {};
  for (const id in N) {
    if (id === "root") continue;
    for (const k in N[id].effect) {
      if (Number.isInteger(TREE_SUPPLY[k]) || ["flatHp", "flatDmg", "flatBase", "shieldAmount", "shieldMax", "freezeFrost"].includes(k)) {
        floor[k] = (floor[k] || 0) + N[id].maxRank;
      }
    }
  }
  let allRanks = 0, cheapest = Infinity;
  for (const id in N) {
    if (id === "root") continue;
    allRanks += N[id].maxRank;
    cheapest = Math.min(cheapest, nodeCost(N[id], 0));
  }
  return { supply: TREE_SUPPLY, target: CONFIG.treeTotals, rows, budgets, floor,
           gold: CONFIG.treeGold, allRanks, cheapest };
}, SHARES);

const pad = (s, n) => String(s).padStart(n);
console.log("\nWhat the tree holds, and what a build carries at each spend\n");
const WIDTH = 18 + 11 + 11 + 9 * SHARES.length;
console.log(`tree: ${data.allRanks} ranks, ${data.gold.toLocaleString("de-DE")} gold end to end, ` +
  `cheapest node ${data.cheapest}\n`);
console.log("stat".padEnd(18) + pad("target", 11) + pad("actual", 11) +
  data.budgets.map((b, i) => pad(Math.round(SHARES[i] * 100) + "% gold", 9)).join(""));
console.log("-".repeat(WIDTH));
for (const k of Object.keys(data.supply).sort()) {
  const want = data.target[k];
  const got = data.supply[k];
  const under = want != null && data.floor[k] != null && want < data.floor[k];
  const off = want == null ? ""
    : under ? "  <- below its floor of " + data.floor[k] + " (one per rank)"
    : Math.abs(got - want) / Math.max(1e-9, want) > 0.08 ? "  <- off" : "";
  console.log(k.padEnd(18) + pad(want == null ? "—" : want, 11) + pad(got.toFixed(2), 11) +
    data.budgets.map((b) => pad((data.rows[b][k] ?? 0).toFixed(2), 9)).join("") + off);
}
console.log("-".repeat(WIDTH));
for (const [label, key] of [["tree completed %", "_pct"], ["ranks bought", "_ranks"],
                            ["Feuerball hit", "_hit"], ["max HP", "_hp"], ["cast charge ms", "_charge"]]) {
  console.log(label.padEnd(40) + data.budgets.map((b) => pad(data.rows[b][key], 9)).join(""));
}
console.log("\ngold spent" .padEnd(40) + data.budgets.map((b) => pad(b, 9)).join(""));
console.log();
await browser.close();
server.close();
