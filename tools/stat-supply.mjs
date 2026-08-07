// What the tree HOLDS of every stat, and what a build carries at a given spend.
//
// This is the tuning instrument for skilltree.js STAT_SCALE. Nothing in the game
// is capped: a build is bounded by what the tree contains and what the player can
// afford, so those two numbers ARE the balance. "supply" is what you would carry
// owning every node granting that stat; the gold columns are what a
// cheapest-reachable-first player has after spending that much.
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

const BUDGETS = [1000, 3000, 10000, 30000, 100000];
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: "load" });
await page.waitForTimeout(700);

const data = await page.evaluate((budgets) => {
  const { TREE_NODES: N, TREE_EDGES: E, TREE_SUPPLY, nodeCost, treeBuy } = Incanto.skilltree;
  const adj = {};
  for (const [a, b] of E) { (adj[a] = adj[a] || []).push(b); (adj[b] = adj[b] || []).push(a); }
  const rows = {};
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
    rows[budget] = {
      ...state.mods.sums,
      _ranks: Object.values(state.nodeRanks).reduce((a, b) => a + b, 0),
      _hit: Math.round(Incanto.spells.spellPower("fireball")),
      _hp: state.heroMaxHP,
      _charge: Math.round(castChargeMs()),
    };
  }
  return { supply: TREE_SUPPLY, rows };
}, BUDGETS);

const pad = (s, n) => String(s).padStart(n);
console.log("\nWhat the tree holds, and what a build carries at each spend\n");
console.log("stat".padEnd(18) + pad("supply", 10) + BUDGETS.map((b) => pad(b / 1000 + "k", 9)).join(""));
console.log("-".repeat(18 + 10 + 9 * BUDGETS.length));
for (const k of Object.keys(data.supply).sort()) {
  console.log(k.padEnd(18) + pad(data.supply[k].toFixed(2), 10) +
    BUDGETS.map((b) => pad((data.rows[b][k] ?? 0).toFixed(2), 9)).join(""));
}
console.log("-".repeat(18 + 10 + 9 * BUDGETS.length));
for (const [label, key] of [["ranks bought", "_ranks"], ["Feuerball hit", "_hit"], ["max HP", "_hp"], ["cast charge ms", "_charge"]]) {
  console.log(label.padEnd(28) + BUDGETS.map((b) => pad(data.rows[b][key], 9)).join(""));
}
console.log();
await browser.close();
server.close();
