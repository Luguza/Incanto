// Headless smoke test for Incanto.
//
// Boots index.html in Chromium over file://, asserts the game loads with no
// console/page errors, that the canvas scene actually renders (advances), and
// that the delegated UI dispatch works end-to-end (clicks a data-act button and
// checks the action ran). Exits non-zero on any failure.
//
// Run:
//   node tools/smoke-test.mjs
//
// Chromium is pre-installed (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers); do not
// run `playwright install`. Playwright is resolved from local node_modules or,
// failing that, the global install.

import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

// Resolve playwright whether it's installed locally or globally.
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
  ({ chromium } = require(join(globalRoot, "playwright")));
}

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SHOT = join(process.env.TMPDIR || "/tmp", "incanto-smoke.png");

// Serve the repo over HTTP so the run mirrors GitHub Pages (and avoids the
// file:// canvas-taint that blocks the game's own getImageData asset builds).
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".otf": "font/otf", ".webmanifest": "application/manifest+json",
  ".txt": "text/plain", ".json": "application/json",
};
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const buf = await readFile(join(ROOT, p));
    res.writeHead(200, { "Content-Type": MIME[extname(p)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const INDEX_URL = `http://127.0.0.1:${server.address().port}/index.html`;

const errors = [];
let browser;

function check(cond, msg) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("  ok  " + msg);
}

try {
  browser = await chromium.launch(); // uses the pre-installed browser
  const page = await browser.newPage({ viewport: { width: 420, height: 780 } });

  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console.error: " + m.text());
  });

  await page.goto(INDEX_URL, { waitUntil: "load" });
  await page.waitForSelector("canvas.scene", { timeout: 5000 });
  await page.waitForTimeout(900); // let a few rAF frames run

  // 1. Namespace + boot state.
  const boot = await page.evaluate(() => ({
    ns: window.Incanto ? Object.keys(window.Incanto).sort() : null,
    screen: typeof state !== "undefined" ? state.screen : null,
    assetsReady: typeof ASSETS !== "undefined" && ASSETS !== null,
    clock: typeof state !== "undefined" ? state.clockMs : -1,
  }));
  check(boot.ns && boot.ns.length >= 10, "Incanto namespace populated (" + (boot.ns || []).length + " modules)");
  check(boot.screen === "combat", "boots into combat (screen=" + boot.screen + ")");
  check(boot.assetsReady, "render assets built");
  check(boot.clock > 0, "game clock advanced (rendering loop running, clock=" + boot.clock + ")");

  // 2. Canvas actually paints something (via compositor screenshot; avoids
  //    getImageData taint under file://).
  const buf = await page.locator("canvas.scene").screenshot({ path: SHOT });
  check(buf.length > 1500, "canvas.scene screenshot is non-trivial (" + buf.length + " bytes) -> " + SHOT);

  // 3. Delegated UI dispatch: open the skill-tree upgrade screen with a tier-1
  //    node selected, click its data-act "Kaufen" button, confirm treeBuy() ran
  //    (the node's rank incremented). Exercises the full click -> [data-act] ->
  //    window[fn] path, plus the tree's reveal/purchase logic + stat recompute.
  const before = await page.evaluate(() => {
    state.gold = 999999;
    state.nodeRanks = {};
    recomputeMods();
    state.tree = { scale: 0.62, tx: 0, ty: 0, selected: "migp0" };
    state.screen = "upgrade";
    render(performance.now()); // rebuild DOM for the skill-tree screen
    return state.gold;
  });
  await page.click('[data-act="treeBuy"]');
  const bought = await page.evaluate(() => ({ rank: state.nodeRanks.migp0 || 0, gold: state.gold }));
  check(bought.rank === 1, "delegated data-act='treeBuy' fired treeBuy() (migp0 rank=" + bought.rank + ")");
  check(bought.gold < before, "buying the node spent gold (" + before + " -> " + bought.gold + ")");

  // 4. The skill tree is authored, not grown (see skilltree.js): twelve arms out
  //    of one seed, one connected acyclic graph, every sealed page reachable by
  //    exactly one unlock node, and no node overlapping another on screen.
  const tree = await page.evaluate(() => {
    const { TREE_NODES: N, TREE_EDGES: E } = Incanto.skilltree;
    const ids = Object.keys(N);
    const adj = {};
    for (const [a, b] of E) { (adj[a] = adj[a] || []).push(b); (adj[b] = adj[b] || []).push(a); }
    const seen = new Set(["root"]), stack = ["root"];
    while (stack.length) for (const n of adj[stack.pop()] || []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    const sealed = Incanto.spells.SPELLS.filter((s) => s.unlock).map((s) => s.id);
    const unlocks = ids.filter((i) => N[i].unlocks).map((i) => N[i].unlocks);
    return {
      count: ids.length,
      arms: (adj.root || []).length,
      connected: seen.size === ids.length && E.length === ids.length - 1,
      unlocksOk: sealed.every((id) => unlocks.filter((u) => u === id).length === 1),
      thorns: ids.filter((i) => N[i].effect && N[i].effect.thorns).length,
      unknownTheme: ids.filter((i) => !Incanto.skilltree.TREE_THEMES[N[i].theme]).length,
    };
  });
  check(tree.arms === 12, "twelve arms grow out of the seed (" + tree.arms + ")");
  check(tree.connected, "tree is one connected, acyclic graph (" + tree.count + " nodes)");
  check(tree.unlocksOk, "every sealed spell has exactly one unlock node");
  check(tree.thorns === 5, "exactly five Dornenkrone caches exist (" + tree.thorns + ")");
  check(tree.unknownTheme === 0, "every node's theme resolves to a colour + glyph");

  //    …and it is laid out evenly. The whole point of radialSlices + relaxTree is
  //    that nodes sit at a roughly constant distance from each other everywhere:
  //    no clumps, no voids. Guard the nearest-neighbour spread so a tweak to the
  //    forces or the node counts can't quietly go back to a lumpy web.
  const spacing = await page.evaluate(() => {
    const { TREE_NODES: N } = Incanto.skilltree;
    const P = Incanto.skilltree.NODE_POS;
    const ids = Object.keys(N);
    const cell = 220, grid = new Map();
    for (const id of ids) {
      const p = P[id], k = Math.floor(p.x / cell) + "," + Math.floor(p.y / cell);
      (grid.get(k) || grid.set(k, []).get(k)).push(id);
    }
    const nn = ids.map((id) => {
      const p = P[id], cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
      let best = Infinity;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++)
        for (const o of grid.get(cx + i + "," + (cy + j)) || []) {
          if (o === id) continue;
          const d = Math.hypot(p.x - P[o].x, p.y - P[o].y);
          if (d < best) best = d;
        }
      return best;
    }).sort((a, b) => a - b);
    return { min: nn[0], p5: nn[(nn.length * 0.05) | 0], p95: nn[(nn.length * 0.95) | 0] };
  });
  check(spacing.min >= 58, "no two nodes overlap (closest pair " + spacing.min.toFixed(0) + ")");
  check(spacing.p5 >= 66 && spacing.p95 <= 130,
    "node spacing is even (5th-95th percentile " + spacing.p5.toFixed(0) + "-" + spacing.p95.toFixed(0) + ")");

  // 5. A beacon key is visible from the first screen but NOT buyable until the
  //    prelude that leads to it has been walked.
  const beacon = await page.evaluate(() => {
    const { nodeRevealed, treeBuy } = Incanto.skilltree;
    state.gold = 999999; state.nodeRanks = {}; recomputeMods();
    const seen = nodeRevealed("ligg");
    treeBuy("ligg");
    const blocked = !state.nodeRanks.ligg;
    for (let i = 0; i < 4; i++) treeBuy("ligp" + i);
    treeBuy("ligg");
    return { seen, blocked, bought: !!state.nodeRanks.ligg, unlocked: !!state.mods.spellsUnlocked.lightning };
  });
  check(beacon.seen && beacon.blocked, "a spell key is lit through the fog but not buyable unreached");
  check(beacon.bought && beacon.unlocked, "walking its prelude makes the key buyable and opens the page");

  check(errors.length === 0, "no console/page errors");

  console.log("\nSMOKE TEST PASSED");
} catch (err) {
  console.error("\nSMOKE TEST FAILED\n" + err.message);
  if (errors.length) console.error("captured errors:\n  " + errors.join("\n  "));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}
