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

  // 3. Delegated UI dispatch: force the upgrade screen, click the data-act
  //    button, confirm buyDmg() ran (dmgLevel incremented). Exercises the full
  //    click -> [data-act] -> window[fn] path introduced by the refactor.
  await page.evaluate(() => {
    state.gold = 999999;
    state.dmgLevel = 0;
    state.screen = "upgrade";
    render(performance.now()); // rebuild DOM for the upgrade screen
  });
  await page.click('[data-act="buyDmg"]');
  const dmgLevel = await page.evaluate(() => state.dmgLevel);
  check(dmgLevel === 1, "delegated data-act='buyDmg' fired buyDmg() (dmgLevel=" + dmgLevel + ")");

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
