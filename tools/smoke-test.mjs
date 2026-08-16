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

  // 2b. The phone's own dark mode must not repaint the game. A browser dark mode
  //     ("dark mode for web contents") reads every SVG fill and stroke as
  //     foreground and inverts the dark ones, which turns the rune tree into a
  //     field of white discs — it reached real phones that way. The page opts
  //     out three times over (see the essay in styles/base.css); this checks
  //     both halves of that: the signals are declared, AND the tree still comes
  //     out dark when a browser dark mode is forced on over the top of it.
  const declared = await page.evaluate(() => ({
    meta: (document.querySelector('meta[name="color-scheme"]') || {}).content || "",
    root: getComputedStyle(document.documentElement).colorScheme,
    query: [...document.styleSheets].some((s) => {
      try { return [...s.cssRules].some((r) => /prefers-color-scheme:\s*dark/.test(r.conditionText || "")); }
      catch { return false; }
    }),
  }));
  check(/dark/.test(declared.meta) && /dark/.test(declared.root) && declared.query,
    "the page declares its darkness all three ways (meta=\"" + declared.meta +
    "\", :root=" + declared.root + ", prefers-color-scheme block=" + declared.query + ")");

  //     Driven the way an inverting phone drives it: a second page in a dark
  //     system theme with the browser's own dark mode forced on, measured
  //     against the same parts drawn normally. Each of these was inverted on a
  //     real phone — the tree came back a field of white discs, the sealed page
  //     as bright paper, the rune wells as lit buttons — and each is now painted
  //     on a surface the filter cannot reach (a canvas for the tree, an feFlood
  //     for the flat SVG shapes; see the dark-paint defs in index.html).
  //
  //     A DELTA rather than an absolute, so the check survives the art being
  //     retuned, and two-sided: the filter's two failure modes are inverting
  //     dark paint to light AND darkening light paint, and the book is made of
  //     both — near-black wax over cream parchment.
  //
  //     Measured three ways, because an average is the wrong instrument for
  //     most of this. "surface" is the mean of a solid area. "ink" and "paper"
  //     read the darkest and the lightest pixels of the SAME box — the written
  //     block — so one watches the strokes and the other the vellum between
  //     them. Averaging that box would hide both: thin half-transparent strokes
  //     barely move the mean of a page that is mostly parchment, and the guard
  //     would sit there looking green while the hand inverted.
  const darkParts = [
    ["the rune tree", "upgrade", ".tree-canvas", "surface"],
    ["the book's parchment", "combat", '.bk-page[data-side="-1"] .bk-script', "paper"],
    ["the hand written on it", "combat", '.bk-page[data-side="-1"] .bk-script', "ink"],
    ["the book's boards", "combat", ".bk-cover", "surface"],
    ["the book's sealed page", "combat", ".bk-sealed", "surface"],
    ["its wax seal", "combat", ".bk-wax", "surface"],
    ["the rune circle's wells", "combat", ".rune .well", "surface"],
  ];
  const measure = (target, sel, how) => target.locator(sel).first().screenshot().then((bytes) =>
    // Decoded on the ORIGINAL page: that one is not being darkened, so the
    // pixels it reads back are the ones the measured page actually painted.
    page.evaluate(async ([bs, mode]) => {
      const bmp = await createImageBitmap(new Blob([new Uint8Array(bs)], { type: "image/png" }));
      const c = document.createElement("canvas");
      c.width = bmp.width; c.height = bmp.height;
      const g = c.getContext("2d");
      g.drawImage(bmp, 0, 0);
      // For a surface, only the bottom third of the box. An element screenshot
      // is its BOUNDING BOX, so a rune well's would otherwise average in the
      // word written across its middle. Ink and paper read the whole box and
      // pick their pixels out of it by brightness instead.
      const y0 = mode === "surface" ? Math.floor(bmp.height * 0.66) : 0;
      const d = g.getImageData(0, y0, bmp.width, bmp.height - y0).data;
      const lum = [];
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;
        lum.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
      }
      if (!lum.length) return -1;
      if (mode !== "surface") {
        lum.sort((a, b) => a - b);
        // the strokes themselves, or the vellum they are written on
        const part = mode === "ink"
          ? lum.slice(0, Math.max(1, Math.floor(lum.length * 0.02)))
          : lum.slice(Math.floor(lum.length * 0.8));
        return part.reduce((a, b) => a + b, 0) / part.length;
      }
      return lum.reduce((a, b) => a + b, 0) / lum.length;
    }, [[...bytes], how]));

  const openPage = async (force) => {
    const p = await browser.newPage({ viewport: { width: 412, height: 726 }, colorScheme: "dark" });
    if (force) {
      const cdp = await p.context().newCDPSession(p);
      await cdp.send("Emulation.setAutoDarkModeOverride", { enabled: true });
    }
    await p.goto(INDEX_URL, { waitUntil: "load" });
    await p.waitForSelector("canvas.scene", { timeout: 5000 });
    if (force) {
      // Chromium HONOURS the page's opt-out, and the phones this is written for
      // do not — so strip the opt-out here, or the darkening never engages and
      // every assertion below passes without testing anything. The canary a few
      // lines down is what proves it really did engage.
      await p.evaluate(() => {
        document.querySelectorAll('meta[name="color-scheme"]').forEach((m) => m.remove());
        const s = document.createElement("style");
        s.textContent = ":root, html { color-scheme: normal !important; }";
        document.head.appendChild(s);
        const c = document.createElement("div");
        c.id = "dark-canary";
        c.style.cssText = "position:fixed;left:0;top:0;width:40px;height:40px;z-index:99";
        c.innerHTML = '<svg width="40" height="40"><circle cx="20" cy="20" r="20" fill="#120e1c"/></svg>';
        document.body.appendChild(c);
      });
      await p.waitForTimeout(250);
    }
    return p;
  };
  const plain = await openPage(false), forced = await openPage(true);

  //     The canary: an ordinary dark SVG fill, the exact thing this whole
  //     section is about. It MUST come back inverted — if it doesn't, the
  //     harness failed to force the browser's dark mode on and the checks that
  //     follow would all pass while proving nothing.
  await plain.evaluate(() => {
    const c = document.createElement("div");
    c.id = "dark-canary";
    c.style.cssText = "position:fixed;left:0;top:0;width:40px;height:40px;z-index:99";
    c.innerHTML = '<svg width="40" height="40"><circle cx="20" cy="20" r="20" fill="#120e1c"/></svg>';
    document.body.appendChild(c);
  });
  const canaryA = await measure(plain, "#dark-canary", "surface");
  const canaryB = await measure(forced, "#dark-canary", "surface");
  check(canaryB - canaryA > 60,
    "the harness really is forcing a browser dark mode on (canary " +
    canaryA.toFixed(0) + " → " + canaryB.toFixed(0) + " of 255)");
  for (const [what, screen, sel, how] of darkParts) {
    for (const p of [plain, forced]) { await p.evaluate((s) => navTo(s), screen); }
    await forced.waitForTimeout(500);
    const a = await measure(plain, sel, how), b = await measure(forced, sel, how);
    check(a > 0 && b > 0 && Math.abs(a - b) < 20,
      `a forced browser dark mode cannot repaint ${what} ` +
      `(${a.toFixed(0)} → ${b.toFixed(0)} of 255)`);
  }
  await plain.close();
  await forced.close();

  // 2c. The rune circle takes a real thumb. Every other rune check in here calls
  //     handleRuneClick() directly, which is how the circle once shipped
  //     completely dead to a finger: splitting the well off the ring left the
  //     ring with `fill: none`, and an unpainted fill is not hit-tested, so the
  //     tap target shrank from the whole disc to a 1,5 px outline while every
  //     test still passed. So this one presses the pixels.
  await page.evaluate(() => { navTo("combat"); render(performance.now()); });
  await page.waitForTimeout(300);
  const runeGeom = await page.evaluate(() => {
    const mid = (g) => {
      const b = g.querySelector(".body").getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    };
    const gs = [...document.querySelectorAll("svg.arena .rune")];
    const id = (g) => Number(g.dataset.id);
    const from = gs[0];
    const want = state.runes.find((r) => r.id === id(from)).pairId;
    const to = gs.find((g) => state.runes.find((r) => r.id === id(g)).pairId === want &&
      id(g) !== id(from));
    const p = mid(from);
    const el = document.elementFromPoint(p.x, p.y);
    return {
      hitsRune: !!(el && el.closest && el.closest(".rune")),
      hit: el ? el.tagName + "." + (el.getAttribute("class") || "?") : "nothing",
      from: p, to: mid(to), fromId: id(from), toId: id(to),
    };
  });
  check(runeGeom.hitsRune,
    "the middle of a rune belongs to that rune, not to what is behind it (hit " +
    runeGeom.hit + ")");
  await page.mouse.move(runeGeom.from.x, runeGeom.from.y);
  await page.mouse.down();
  await page.waitForTimeout(60);
  const armed = await page.evaluate(() => state.selectedRuneId);
  check(armed === runeGeom.fromId,
    "pressing it arms it (selectedRuneId=" + armed + ", expected " + runeGeom.fromId + ")");
  await page.mouse.move(runeGeom.to.x, runeGeom.to.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const paired = await page.evaluate(() => ({
    matched: state.runes.filter((r) => r.matchState === "matched").length,
    armed: state.selectedRuneId,
  }));
  check(paired.matched >= 2 && paired.armed === null,
    "dragging it onto its pair matches them both (" + paired.matched + " matched)");

  // 2d. THE WHEEL IS AS BIG AS THE BOOK LETS IT BE, and no bigger. The circle is
  //     height-limited on every phone, so it is grown by taking height off the
  //     strip above it and by cropping the arena's viewBox to the wheel's own
  //     extent — which walks it straight at the open book below. What must not
  //     touch is the rune BUBBLES: the book paints over the arena, so a bubble
  //     that reached the paper would be a tap target with the top of a page laid
  //     across it. (The faint outermost ring does now pass behind the pages;
  //     that is the trade, and it is written up over .combat-screen.)
  //
  //     The closest approach is a TANGENT distance about three quarters of the
  //     way out along each page's top edge, not the vertical gap at the notch —
  //     so this walks the edges rather than comparing bounding boxes, and it
  //     does it at the shortest screen the game is built for, where the wheel
  //     sits lowest relative to the book.
  const wheelFit = await page.evaluate(() => {
    const arena = document.querySelector("svg.arena");
    const at = (x, y) => {
      const p = arena.createSVGPoint(); p.x = x; p.y = y;
      return p.matrixTransform(arena.getScreenCTM());
    };
    const c = at(CONFIG.circleCenter.x, CONFIG.circleCenter.y);
    const R = at(CONFIG.circleCenter.x + CONFIG.circleRadius + CONFIG.runeRadius,
                 CONFIG.circleCenter.y).x - c.x;
    let gap = Infinity;
    for (const edge of document.querySelectorAll(".spellbook .bk-cut")) {
      const ctm = edge.getScreenCTM(), L = edge.getTotalLength();
      for (let i = 0; i <= 400; i++) {
        const q = edge.getPointAtLength((i / 400) * L).matrixTransform(ctm);
        gap = Math.min(gap, Math.hypot(q.x - c.x, q.y - c.y) - R);
      }
    }
    const box = arena.getBoundingClientRect();
    return {
      gap, R,
      // Nothing may be cut off the top or the sides either.
      fits: c.y - R > box.top - 0.5 && c.x - R > -0.5 && c.x + R < window.innerWidth + 0.5,
      // What the wheel is worth as a share of the screen it has to live on.
      share: (2 * R) / Math.min(window.innerWidth, window.innerHeight),
      vw: window.innerWidth,
    };
  });
  check(wheelFit.gap > 6 && wheelFit.fits,
    `the wheel clears the open book by a real margin (${wheelFit.gap.toFixed(1)}px ` +
    `from paper to the nearest rune bubble)`);
  check(wheelFit.share > 0.62,
    `…while still filling the screen it sits on (${(2 * wheelFit.R).toFixed(0)}px of rune ` +
    `circle across a ${wheelFit.vw}px-wide phone, ${Math.round(wheelFit.share * 100)}%)`);

  // 3. The spell book turns under the finger, and ALL of it does. A page turn is
  //    one motion on one progress: the held leaf stands up to the spine over the
  //    first half of the drag, and the leaf it carries over lies down on the far
  //    side during the second — both straight off the pointer, so dragging the
  //    whole span leaves nothing to animate on release. This is a regression
  //    guard: the second half used to be able to run only after the book was
  //    re-rendered at its new spread, so a drag stopped dead at the gutter and
  //    the rest of the turn played by itself once the finger let go.
  await page.evaluate(() => { state.bookSpread = 0; state._structuralDirty = true; render(performance.now()); });
  const book = await page.locator("#spellbook").boundingBox();
  const bx = book.x + book.width * 0.8, by = book.y + book.height * 0.55;
  // How far each leaf is through its swing, read off the transform setTurn wrote
  // (1 = lying flat and open, 0.02 = stood up against the spine).
  const probeBook = () => page.evaluate(() => {
    const svg = document.getElementById("spellbook");
    const open = (el) => {
      if (!el) return null;
      const m = /scale\(([-\d.]+)/.exec(el.getAttribute("transform") || "");
      return m ? +m[1] : 1;
    };
    const carried = svg.querySelector(".bk-turn .bk-page");
    return {
      spread: state.bookSpread,
      held: open(svg.querySelector(':scope > .bk-page:not(.under)[data-side="1"]')),
      carried: carried ? open(carried) : null,
      carriedSide: carried ? carried.dataset.side : null,
    };
  });
  await page.mouse.move(bx, by);
  await page.mouse.down();
  await page.mouse.move(bx - book.width * 0.3, by, { steps: 8 });   // half a turn
  await page.waitForTimeout(60);
  const halfTurn = await probeBook();
  await page.mouse.move(bx - book.width * 0.6, by, { steps: 8 });   // and the rest of it
  await page.waitForTimeout(60);
  const fullTurn = await probeBook();
  await page.mouse.up();
  await page.waitForTimeout(150);
  const landed = await probeBook();
  check(halfTurn.held <= 0.06 && halfTurn.carried !== null && halfTurn.carried <= 0.06 &&
    halfTurn.carriedSide === "-1",
    "half a drag stands the held leaf up at the spine, the leaf it carries behind it");
  check(fullTurn.carried >= 0.94 && fullTurn.held <= 0.06,
    "the second half lays that leaf down on the other side under the finger too " +
    "(carried " + fullTurn.carried + ")");
  check(landed.spread === 1 && landed.carried === null && landed.held === 1,
    "letting go of a finished turn just commits the spread (" + landed.spread + ")");
  await page.mouse.move(bx, by);
  await page.mouse.down();
  await page.mouse.move(bx - book.width * 0.06, by, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const sprung = await probeBook();
  check(sprung.spread === 1 && sprung.carried === null && sprung.held === 1,
    "a drag that falls short springs back and turns nothing");

  // 4. Delegated UI dispatch: open the skill-tree upgrade screen with a tier-1
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

  //    …and picking nodes never moves the web. The info panel under the canvas
  //    is as tall as whatever it describes, so the canvas box changes height on
  //    every tap. It used to carry a fixed 900-unit window that its contents
  //    were rescaled and re-centred to fit — so choosing a node visibly resized
  //    and jumped the whole tree. The camera works in CSS pixels of the box
  //    instead (see syncTreeViewport), pinning the picture where it is. Guard:
  //    the camera must be identical for every selection, even though the panel
  //    below is demonstrably changing height.
  const still = await page.evaluate(() => {
    const ids = Object.keys(Incanto.skilltree.TREE_NODES);
    const read = () => ({
      cam: [state.tree.tx, state.tree.ty, state.tree.scale].map((v) => +v.toFixed(3)).join(","),
      info: +document.querySelector(".tree-info").getBoundingClientRect().height.toFixed(1),
    });
    const seen = [];
    for (const id of ["root", ids[3], ids[40], ids[200], ids[600]]) { selectNode(id); seen.push(read()); }
    return { cams: [...new Set(seen.map((s) => s.cam))], panels: [...new Set(seen.map((s) => s.info))] };
  });
  check(still.panels.length > 1, "the info panel really does change height per node (" + still.panels.join(" / ") + "px)");
  check(still.cams.length === 1, "…yet the tree's camera never moves with it (" + still.cams.length + " distinct cameras: " + still.cams.join(" | ") + ")");

  //    Tapping the web picks the node under the finger. The web is a bitmap, so
  //    there is no element to hit — nodeAtPoint resolves it by position, and a
  //    tap on bare web between nodes must select nothing at all.
  const tapping = await page.evaluate(() => {
    const { nodeAtPoint } = Incanto.skilltree;
    const t = state.tree, P = Incanto.skilltree.NODE_POS;
    const toBox = (p) => ({ x: p.x * t.scale + t.tx, y: p.y * t.scale + t.ty });
    const ids = Object.keys(Incanto.skilltree.TREE_NODES);
    const hits = ids.filter((id) => { const b = toBox(P[id]); return nodeAtPoint(b.x, b.y) === id; });
    // a point far outside the web entirely
    const far = toBox({ x: -9000, y: -9000 });
    return { hits: hits.length, total: ids.length, empty: nodeAtPoint(far.x, far.y) };
  });
  check(tapping.hits === tapping.total && tapping.empty === null,
    "a tap resolves to the node under it, and to nothing off the web (" +
    tapping.hits + "/" + tapping.total + ")");

  //    …and the web comes back the same shape on the SECOND visit. The canvas
  //    is rebuilt with the screen but TREE_VP outlives it, so a fresh canvas
  //    arrives at the default 300x150 while the remembered box measures exactly
  //    what it did last time. syncTreeViewport used to read that as "unchanged"
  //    and return before sizing the backing store, and the whole tree came back
  //    stretched across a bitmap a fifth of the size it needed. Leaving and
  //    re-entering has to leave the backing store matched to the box.
  const revisit = await page.evaluate(async () => {
    const shape = () => {
      const cv = document.getElementById("tree-canvas");
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      return {
        box: [Math.round(r.width), Math.round(r.height)],
        want: [Math.round(r.width * dpr), Math.round(r.height * dpr)],
        got: [cv.width, cv.height],
      };
    };
    const go = (s) => { navTo(s); render(performance.now()); };
    go("upgrade");
    const first = shape();
    go("combat"); go("upgrade");
    const second = shape();
    return { first, second };
  });
  const fits = (s) => s.want.join() === s.got.join();
  check(fits(revisit.first) && fits(revisit.second),
    "the tree's canvas is sized to its box on every visit, not just the first " +
    "(revisit " + revisit.second.got.join("x") + ", box needs " +
    revisit.second.want.join("x") + ")");

  // 5. The skill tree is authored, not grown (see skilltree.js): twelve arms out
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

  // 6. A beacon key is visible from the first screen but NOT buyable until the
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

  // 7. Learning history (see vocab-history.js): quiz answers and rune pairings
  //    both feed a per-word record, and a word fumbled inside the recent window
  //    is dealt back into the circle far more often than the pool average —
  //    until it is relearned, which retires the boost again.
  const vocab = await page.evaluate(() => {
    clearVocabHistory();
    const pairs = drawLoadout();
    const hard = pairs[0].id, confusedWith = pairs[1].id;
    recordRuneMatch([hard, confusedWith], false);          // mispaired in the circle
    recordQuizOutcome({ type: "choose", words: [hard] }, false); // and missed in the quiz
    const e = vocabEntry(hard);
    const inPool = struggleDrawPool().some((p) => p.idx === hard);
    const deals = 300;
    let hits = 0;
    for (let i = 0; i < deals; i++) if (drawLoadout().some((p) => p.id === hard)) hits++;
    const share = hits / deals;
    const scoreBefore = vocabStruggleScore(e);
    for (let i = 0; i < 12; i++) recordRuneMatch([hard], true); // relearn it
    return {
      runeWrong: e.runeWrong, quizWrong: e.quizWrong, seen: e.runeSeen > 0 && e.quizSeen === 1,
      inPool, share, scoreBefore, retired: vocabStruggleScore(e) === 0,
      baseline: CONFIG.pairsPerLoadout / WORD_POOL.length,
    };
  });
  check(vocab.runeWrong === 1 && vocab.quizWrong === 1 && vocab.seen,
    "a mispairing and a missed quiz answer are both tallied against the word");
  check(vocab.inPool && vocab.scoreBefore > 0, "it lands in the recent-struggle review pool");
  check(vocab.share > vocab.baseline * 5,
    "the circle deals it far more often than pool average (" +
    (vocab.share * 100).toFixed(0) + "% of boards vs " + (vocab.baseline * 100).toFixed(1) + "%)");
  check(vocab.retired, "relearning it retires the boost");

  //    …and the study phase can reach the record: a data-act button on the quiz
  //    opens it, the nav stays on the study phase, and the filter tabs work.
  await page.evaluate(() => { goToQuiz(); render(performance.now()); });
  await page.click('[data-act="openHistory"]');
  await page.waitForTimeout(120);
  const hist = await page.evaluate(() => ({
    screen: state.screen,
    rows: document.querySelectorAll(".hist-row").length,
    phase: (document.querySelector("#bottom-nav .nav-btn.active") || {}).dataset.phase,
  }));
  check(hist.screen === "history" && hist.rows > 0,
    "the quiz's Lernverlauf button opens the history (" + hist.rows + " rows)");
  check(hist.phase === "study", "the history sits inside the study phase (nav=" + hist.phase + ")");
  await page.click('[data-act="setHistoryFilter"][data-args=\'["seen"]\']');
  await page.waitForTimeout(120);
  const seenTab = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".hist-row")];
    return { n: rows.length, allMet: rows.every((r) => !/noch nicht begegnet/.test(r.textContent)) };
  });
  check(seenTab.n > 0 && seenTab.allMet,
    "the 'Gesehen' tab lists only vocabulary actually met (" + seenTab.n + " rows)");

  // 8. A wrong answer must STOP on the question and show the solution — that
  //    pause is the whole point of the quiz, and it is only ever dismissed by
  //    tapping Weiter. Driven the way a phone drives it: fill the field, tap
  //    Prüfen, tap Weiter. Nothing here presses a key, because nothing in the
  //    game may respond to one (see CLAUDE.md).
  const start = await page.evaluate(() => {
    goToQuiz();
    state.quizIndex = state.quizList.findIndex((q) => q.type === "type");
    resetQuizInput();
    state._structuralDirty = true;
    render(performance.now());
    return state.quizIndex;
  });
  await page.fill("#quiz-input", "definitiv-falsch");
  await page.click('[data-act="quizCheckType"]');
  await page.waitForTimeout(120);
  const checked = await page.evaluate(() => ({
    i: state.quizIndex,
    checked: state.quizChecked,
    solution: /Richtig wäre/.test(document.querySelector(".quiz-feedback")?.textContent || ""),
    weiter: !!document.querySelector(".quiz-continue"),
  }));
  check(checked.i === start && checked.checked && checked.solution && checked.weiter,
    "a wrong typed answer holds on the question, names the solution, and waits for Weiter");
  await page.click(".quiz-continue");
  await page.waitForTimeout(120);
  const advanced = await page.evaluate(() => state.quizIndex);
  check(advanced === start + 1, "tapping Weiter moves on exactly one question (" + start + " -> " + advanced + ")");

  //    Same on the tap path: a wrong option marks the right one and holds.
  const tapped = await page.evaluate(() => {
    state.quizIndex = 0;
    resetQuizInput();
    state._structuralDirty = true;
    render(performance.now());
    const q = state.quizList[0];
    return q.options.findIndex((o) => o !== q.answer);
  });
  await page.click(`[data-act="quizChoose"][data-args="[${tapped}]"]`);
  await page.waitForTimeout(120);
  const held = await page.evaluate(() => ({
    i: state.quizIndex,
    marked: !!document.querySelector(".quiz-opt.correct"),
  }));
  check(held.i === 0 && held.marked, "a wrong tapped answer holds on the question and marks the right option");

  //    …and no key may drive the game. The only keydown the app listens for is
  //    the phone keyboard's Go on a typed answer field; a stray Enter anywhere
  //    else must do nothing at all.
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press("Enter");
  await page.keyboard.press(" ");
  await page.waitForTimeout(120);
  const inert = await page.evaluate(() => state.quizIndex);
  check(inert === 0, "keys do not drive the game — a stray Enter/Space changes nothing (index " + inert + ")");

  // 8a2. The sentence exercises must not keep serving the same sentences. Three
  //      questions of every session come out of SENTENCE_POOL, so the pool has
  //      to be deep and the draw has to remember what it just showed (see
  //      drawSentence + CONFIG.quizSentenceMemory). Drawn here the way a long
  //      evening of play would draw it.
  const sentences = await page.evaluate(() => {
    const drawn = [];
    const options = [];
    for (let i = 0; i < 120; i++) {
      const fc = Incanto.quiz.makeFill("fill-choose");
      options.push(fc.options);
      drawn.push(fc.tokens.join(" "),
        Incanto.quiz.makeFill("fill-type").tokens.join(" "),
        Incanto.quiz.makeArrange().answer.join(" "));
    }
    const last = {}; let minGap = Infinity;
    drawn.forEach((s, i) => { if (s in last) minGap = Math.min(minGap, i - last[s]); last[s] = i; });
    return {
      pool: Incanto.SENTENCE_POOL.length,
      memory: CONFIG.quizSentenceMemory,
      optionCount: CONFIG.quizOptionCount,
      distinct: new Set(drawn).size,
      drawn: drawn.length,
      minGap,
      badOptions: options.filter((o) => o.length !== CONFIG.quizOptionCount || new Set(o).size !== o.length).length,
    };
  });
  check(sentences.pool >= 200, "the sentence pool is deep enough to draw from (" + sentences.pool + " sentences)");
  check(sentences.minGap > sentences.memory,
    "a sentence never comes back inside the draw's memory (" + sentences.minGap + " draws apart, memory " + sentences.memory + ")");
  check(sentences.distinct >= sentences.pool * 0.6,
    "a long session works through most of the pool (" + sentences.distinct + " different sentences over " +
    sentences.drawn + " draws)");
  check(sentences.badOptions === 0,
    "fill-the-blank always offers " + sentences.optionCount + " distinct options of the answer's own kind");

  // 8b. Conjugation drills (see quiz.js + CONFIG.conjugation). A ladder over one
  //     verb's present tense: tap the pairs together, pick a form, write a form,
  //     fill half a table, and at the top write the whole paradigm out from
  //     nothing. The paradigms themselves must be right, since they are what the
  //     game teaches.
  const conj = await page.evaluate(() => {
    const byIt = Object.fromEntries(Incanto.CONJ_POOL.map((v) => [v.it, v.forms.join(" ")]));
    return {
      rungs: CONFIG.conjugation.levels.length,
      // the two spelling rules and one irregular, spelled out
      giocare: byIt.giocare,      // -care grows an h before an i-ending
      mangiare: byIt.mangiare,    // -iare never doubles its i
      capire: byIt.capire,        // -isc- in the singular + 3rd plural, not in noi/voi
      essere: byIt.essere,
      // every verb has exactly six forms, none of them empty
      shape: Incanto.CONJ_POOL.every((v) => v.forms.length === 6 && v.forms.every((f) => f && !/undefined/.test(f))),
      // the top rung leaves every row blank, and the ladder's stake grows with it
      top: (() => {
        const last = CONFIG.conjugation.levels.length - 1;
        state.conjLevel = last;
        const q = Incanto.quiz.makeConj(last);
        return { blanks: q.blanks.length, stake: q.goldMult, type: q.type };
      })(),
      // the two easy rungs are matching boards, and a board must be solvable:
      // no two tiles alike in either column, over many deals
      boards: (() => {
        const bad = { dupes: 0, short: 0, kinds: new Set() };
        for (let i = 0; i < 200; i++) {
          for (const lv of [0, 1]) {
            const q = Incanto.quiz.makeConj(lv);
            bad.kinds.add(q.type);
            if (q.pairs.length !== CONFIG.conjugation.levels[lv].pairs) bad.short++;
            const persons = new Set(q.pairs.map((p) => p.it));
            const forms = new Set(q.pairs.map((p) => p.de));
            if (persons.size !== q.pairs.length || forms.size !== q.pairs.length) bad.dupes++;
          }
        }
        return { dupes: bad.dupes, short: bad.short, kinds: [...bad.kinds] };
      })(),
      // the drills are dealt in every session, at the reached rung
      dealt: (() => { state.conjLevel = 2; buildQuiz(); return state.quizList.filter((q) => q.level !== undefined).map((q) => q.level); })(),
    };
  });
  check(conj.giocare === "gioco giochi gioca giochiamo giocate giocano", "giocare is spelled with its h (" + conj.giocare + ")");
  check(conj.mangiare === "mangio mangi mangia mangiamo mangiate mangiano", "mangiare keeps a single i (" + conj.mangiare + ")");
  check(conj.capire === "capisco capisci capisce capiamo capite capiscono", "capire takes -isc- where it should (" + conj.capire + ")");
  check(conj.essere === "sono sei è siamo siete sono", "the irregulars are written out (essere: " + conj.essere + ")");
  check(conj.shape && conj.rungs === 6, "every verb carries six forms, over a six-rung ladder");
  check(conj.top.type === "conj-table" && conj.top.blanks === 6 && conj.top.stake > 1,
    "the hardest rung is the whole paradigm written out (" + conj.top.blanks + " blank rows, ×" + conj.top.stake + " gold)");
  check(conj.boards.kinds.join(",") === "conj-match" && conj.boards.dupes === 0 && conj.boards.short === 0,
    "the easy rungs deal full matching boards with no two tiles alike (400 boards)");
  check(conj.dealt.length === 2 && Math.max(...conj.dealt) === 2,
    "every session deals two conjugation drills, up to the rung reached (" + conj.dealt.join(", ") + ")");

  //     The easy rung, driven the way a thumb drives it: tap a person, tap its
  //     form, four times over. Solving it settles the question, pays out, and
  //     opens the next rung of the ladder.
  const board = await page.evaluate(() => {
    state.conjLevel = 0; state.conjStreak = 0;
    goToQuiz();
    state.quizIndex = state.quizList.findIndex((q) => q.type === "conj-match");
    resetQuizInput(); state._structuralDirty = true; render(performance.now());
    const q = state.quizList[state.quizIndex];
    return {
      // for each left tile, which right tile carries its partner
      taps: q.left.map((t, i) => [i, q.right.findIndex((r) => r.id === t.id)]),
      tiles: document.querySelectorAll(".match-tile").length,
      head: [...document.querySelectorAll(".match-head span")].map((n) => n.textContent.trim()),
      gold: state.quizGoldEarned,
    };
  });
  check(board.tiles === 8 && board.head[0] === "Person" && board.head[2] === "Form",
    "the matching rung draws a person/form board (" + board.tiles + " tiles, " + board.head[0] + " | " + board.head[2] + ")");
  for (const [l, r] of board.taps) {
    await page.click(`[data-act="quizMatchTap"][data-args='["left",${l}]']`);
    await page.click(`[data-act="quizMatchTap"][data-args='["right",${r}]']`);
  }
  await page.waitForTimeout(150);
  const solved = await page.evaluate(() => ({
    ok: state.quizWasCorrect, earned: state.quizGoldEarned, level: state.conjLevel,
  }));
  check(solved.ok && solved.earned > board.gold,
    "tapping the pairs together solves the board and pays out (◈ " + (solved.earned - board.gold) + ")");
  check(solved.level === 1, "clearing a rung opens the next one (Stufe " + (solved.level + 1) + ")");

  //     Driven the way a thumb drives it: fill the six rows, tap Prüfen. A
  //     half-filled table must WAIT rather than settle — the paradigm is one
  //     answer, so a stray tap can't spend it.
  const table = await page.evaluate(() => {
    state.conjLevel = CONFIG.conjugation.levels.length - 1; state.conjStreak = 0; state.gold = 0;
    goToQuiz();
    // the probe, not the warm-up: the rung where every row is blank
    state.quizIndex = state.quizList.findIndex((q) => q.type === "conj-table" && q.blanks.length === 6);
    resetQuizInput(); state._structuralDirty = true; render(performance.now());
    const q = state.quizList[state.quizIndex];
    return { forms: q.forms, blanks: q.blanks, stake: q.goldMult, rows: document.querySelectorAll(".conj-row").length };
  });
  check(table.rows === 6 && table.blanks.length === 6, "the table screen draws all six rows as blanks");
  await page.fill('.conj-input[data-cell="0"]', table.forms[0]);
  await page.click('[data-act="quizCheckConjTable"]');
  await page.waitForTimeout(120);
  check(await page.evaluate(() => !state.quizChecked), "one row filled in: Prüfen waits instead of settling");
  for (const i of table.blanks) await page.fill(`.conj-input[data-cell="${i}"]`, table.forms[i]);
  await page.click('[data-act="quizCheckConjTable"]');
  await page.waitForTimeout(120);
  const written = await page.evaluate(() => ({
    ok: state.quizWasCorrect, gold: state.quizGoldEarned, level: state.conjLevel, streak: state.conjStreak,
    base: Math.round(CONFIG.goldPerCorrect * rewardMult() * state.mods.coinMult),
  }));
  check(written.ok && written.gold === Math.round(written.base * table.stake),
    "writing the whole paradigm settles correct and pays its stake (" + written.gold + " vs " + written.base + " base)");
  check(written.streak === 1, "a clean run at the top rung is recorded (streak " + written.streak + ")");

  //     …and a miss at the top rung steps the ladder back down, so the hardest
  //     exercise on offer is always one the learner has shown they can take.
  const slipped = await page.evaluate(() => {
    const last = CONFIG.conjugation.levels.length - 1;
    state.conjLevel = last; state.conjStreak = 0;
    state.quizList = [Incanto.quiz.makeConj(last)]; state.quizIndex = 0; resetQuizInput();
    quizReveal();                       // "I don't know" — twice over
    const after1 = state.conjLevel;
    resetQuizInput(); state.quizList = [Incanto.quiz.makeConj(state.conjLevel)];
    quizReveal();
    return { last, after1, after2: state.conjLevel, filled: state.quizConj.filter(Boolean).length };
  });
  check(slipped.after1 === slipped.last && slipped.after2 === slipped.last - 1,
    "two misses at the top rung step the ladder back down (" + slipped.last + " → " + slipped.after2 + ")");
  check(slipped.filled === 6, "revealing a paradigm writes the whole table out for the learner");

  //     The rung reached is progress, so it is persisted like gold is.
  const kept = await page.evaluate(() => {
    state.conjLevel = 2; state.conjStreak = 1; saveProgress();
    const saved = JSON.parse(localStorage.getItem("incanto.save.v1")).conjLevel;
    state.conjLevel = 0; state.conjStreak = 0;
    applySavedProgress();                     // what a reload does with the save
    return { saved, level: state.conjLevel, streak: state.conjStreak };
  });
  check(kept.saved === 2 && kept.level === 2 && kept.streak === 1,
    "the rung the learner reached survives a reload (Stufe " + (kept.level + 1) + ")");

  // 8c. Every node has to print a real number. The tree divides
  //     CONFIG.treeTotals across a thousand-odd nodes and three thousand ranks,
  //     so the smallest slices are genuinely tiny — and rounded to whole percent
  //     they came out as "+0 % Krit-Chance" on a node costing real gold. Two
  //     things keep that from happening and this guards both: the floors in
  //     applyTreeTotals, under which no node's share may fall, and the tooltip's
  //     decimal place (treeNum). So: read what ONE rank of every node in the
  //     tree would say, and let no zero through.
  const worthless = await page.evaluate(() => {
    const { TREE_NODES: N, effectText } = Incanto.skilltree;
    const bad = [];
    for (const id in N) {
      if (id === "root") continue;
      const n = N[id];
      for (const k in n.effect) {
        const says = effectText({ [k]: n.effect[k] }, 1);
        // A whole figure that is nothing but zeros — "+0%", "+0 LP", "0,0s".
        // "+0,3%" is a real number and must pass, so the token has to END here.
        if (/(^|[^\d])0(?:[,.]0+)?(?![\d,.])/.test(says)) bad.push(`${n.title} (${id}): ${says}`);
      }
    }
    return { bad: bad.slice(0, 6), count: bad.length, nodes: Object.keys(N).length - 1 };
  });
  check(worthless.count === 0,
    `no node in the tree sells a zero (${worthless.nodes} nodes read)` +
    (worthless.count ? " — " + worthless.count + ": " + worthless.bad.join(", ") : ""));

  // 9. Binding the book (see book-order.js): the forge's book button opens the
  //    whole spell book as three open volumes, and a page dragged onto another
  //    trades places with it. Driven the way a thumb drives it — press, move,
  //    release — because that is the only input this game has.
  await page.evaluate(() => {
    for (const s of Incanto.spells.SPELLS) state.mods.spellsUnlocked[s.id] = true;
    state.screen = "upgrade";
    state._structuralDirty = true;
    render(performance.now());
  });
  await page.click('[data-act="openBookOrder"]');
  await page.waitForTimeout(200);
  const bound = await page.evaluate(() => ({
    screen: state.screen,
    books: document.querySelectorAll(".bo-book").length,
    pages: document.querySelectorAll(".bk-page[data-slot]").length,
    order: Incanto.spells.bookOrder(),
    phase: (document.querySelector("#bottom-nav .nav-btn.active") || {}).dataset.phase,
  }));
  check(bound.screen === "bookorder" && bound.books === 3 && bound.pages === 6,
    "the forge's book button opens three open books (" + bound.books + " books, " + bound.pages + " pages)");
  check(bound.phase === "upgrade", "binding the book sits inside the upgrade phase (nav=" + bound.phase + ")");

  const drag = async (fromSlot, toPoint) => {
    const r = await page.locator(`.bk-page[data-slot="${fromSlot}"] .bk-leaf`).boundingBox();
    const from = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 8, from.y + 16, { steps: 4 });
    await page.mouse.move(toPoint.x, toPoint.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  };
  const lastLeaf = await page.locator('.bk-page[data-slot="5"] .bk-leaf').boundingBox();
  await drag(0, { x: lastLeaf.x + lastLeaf.width / 2, y: lastLeaf.y + lastLeaf.height / 2 });
  const swapped = await page.evaluate(() => ({
    order: Incanto.spells.bookOrder(),
    saved: (JSON.parse(localStorage.getItem("incanto.save.v1") || "{}").spellOrder || []).join(","),
    carried: document.querySelectorAll("#bo-carry .bk-page").length,
  }));
  check(swapped.order[0] === bound.order[5] && swapped.order[5] === bound.order[0] &&
    swapped.order.slice(1, 5).join(",") === bound.order.slice(1, 5).join(","),
    "dragging a page onto another trades exactly those two places (" + swapped.order.join(" · ") + ")");
  check(swapped.saved === swapped.order.join(","), "the new binding is persisted");
  check(swapped.carried === 0, "the carried page is put down again");

  //    A drag that lands on no page changes nothing — the leaf falls back into
  //    the slot it came from rather than being lost or dropped somewhere else.
  const stage = await page.locator(".bo-canvas").boundingBox();
  await drag(1, { x: stage.x + stage.width / 2, y: stage.y + 4 });
  const missed = await page.evaluate(() => ({
    order: Incanto.spells.bookOrder(),
    pages: document.querySelectorAll(".bk-page[data-slot]").length,
    carried: document.querySelectorAll("#bo-carry .bk-page").length,
  }));
  check(missed.order.join(",") === swapped.order.join(",") && missed.pages === 6 && missed.carried === 0,
    "a page dropped on nothing settles back into its own slot");

  //    …and the book the hero actually fights out of is bound that way too.
  await page.click('[data-act="closeBookOrder"]');
  await page.waitForTimeout(150);
  const closed = await page.evaluate(() => state.screen);
  await page.evaluate(() => {
    state.screen = "combat";
    state._structuralDirty = true;
    render(performance.now());
  });
  await page.waitForTimeout(200);
  const inCombat = await page.evaluate(() => ({
    names: [...document.querySelectorAll("#spellbook .bk-page:not(.under) .bk-name")].map((n) => n.textContent),
    want: Incanto.spells.bookSpells()
      .slice(state.bookSpread * 2, state.bookSpread * 2 + 2).map((s) => s.name),
  }));
  check(closed === "upgrade", "leaving the book returns to the tree (screen=" + closed + ")");
  check(inCombat.names.join(",") === inCombat.want.join(",") && inCombat.names.length === 2,
    "the combat book opens on the newly bound order (" + inCombat.names.join(" | ") + ")");

  // 9b. The ledger (see stats.js): the forge's other side door, where the build
  //     is read rather than bought. Its whole reason to exist is that its
  //     numbers are the FIGHT's numbers — so the guard here is not "a screen
  //     rendered" but "the figures track the resolvers and the stat model".
  await page.evaluate(() => {
    state.nodeRanks = {}; state.gold = 999999; recomputeMods();
    for (let i = 0; i < 3; i++) { treeBuy("migp0"); treeBuy("vigp0"); }
    state.screen = "upgrade"; state._structuralDirty = true; render(performance.now());
  });
  await page.click('[data-act="openStats"]');
  await page.waitForTimeout(180);
  //     Read a row by its label, the way a player reads it off the screen.
  const rowValue = (label) => page.evaluate((want) => {
    const row = [...document.querySelectorAll(".sv-row")]
      .find((r) => r.querySelector(".sv-label").textContent.trim() === want);
    return row ? row.querySelector(".sv-value").textContent.trim() : null;
  }, label);
  const ledger = await page.evaluate(() => ({
    screen: state.screen,
    rows: document.querySelectorAll(".sv-row").length,
    phase: (document.querySelector("#bottom-nav .nav-btn.active") || {}).dataset.phase,
    dmg: state.heroDmg, hp: state.heroMaxHP,
    headline: [...document.querySelectorAll(".sv-hero-tile b")].map((b) => b.textContent.trim()),
  }));
  check(ledger.screen === "stats" && ledger.rows > 15,
    "the forge's Werte button opens the ledger (" + ledger.rows + " stat rows)");
  check(ledger.phase === "upgrade", "the ledger sits inside the upgrade phase (nav=" + ledger.phase + ")");
  check(ledger.headline[0] === String(ledger.dmg) && ledger.headline[1] === String(ledger.hp),
    "its headline figures are the hero's own (" + ledger.headline.slice(0, 2).join(" / ") + ")");
  check(await rowValue("Grundschaden") === String(ledger.dmg),
    "a bought damage node moves the ledger's Grundschaden row (" + ledger.dmg + ")");

  //     THE PROMISE. Damage is built in three stages (see skilltree.js), and the
  //     last one exists so that a node reading "+N Schaden je Treffer" puts
  //     exactly N on every body it touches — on the ×1.00 Feuerball and the
  //     ×0.35 Frostkegel alike, on the first rank and after the pool is already
  //     hundreds deep. It is uncapped precisely so that stays true, and this is
  //     the guard on it. Support pages are the one exception: a damage node must
  //     not inflate a heal.
  const promise = await page.evaluate(() => {
    const { TREE_NODES: N, treeBuy } = Incanto.skilltree;
    const { SPELLS, spellPower } = Incanto.spells;
    state.nodeRanks = {}; state.gold = 10 ** 7; recomputeMods();
    const ids = SPELLS.map((s) => s.id);
    const snap = () => Object.fromEntries(ids.map((id) => [id, spellPower(id)]));
    // The Macht prelude runs Kernschliff · Schneide · Härtung · Schneide, so
    // migp1 and migp3 are flat "je Treffer" nodes with a reachable path.
    const deltas = [];
    const measureRanks = (id) => {
      const want = N[id].effect.flatDmg;
      for (let r = 0; r < N[id].maxRank; r++) {
        const before = snap();
        treeBuy(id);
        const after = snap();
        deltas.push({ id, want, got: Object.fromEntries(ids.map((s) => [s, +(after[s] - before[s]).toFixed(6)])) });
      }
    };
    treeBuy("migp0");                                   // reach the first Schneide
    measureRanks("migp1");
    for (let r = 0; r < N.migp2.maxRank; r++) treeBuy("migp2");   // walk on past the Härtung
    measureRanks("migp3");
    // …and once more from deep inside the pool: buy out the Macht arm until the
    // stack is dozens of points deep, then buy one more rank and check it still
    // pays its full face.
    const adj = {};
    for (const [a, b] of Incanto.skilltree.TREE_EDGES) { (adj[a] = adj[a] || []).push(b); (adj[b] = adj[b] || []).push(a); }
    const reachable = (id) => (adj[id] || []).some((x) => x === "root" || (state.nodeRanks[x] || 0) > 0);
    for (let guard = 0; guard < 400 && state.mods.flatDmg < 60; guard++) {
      const next = Object.keys(N).find((id) =>
        id.startsWith("mig") && (state.nodeRanks[id] || 0) < N[id].maxRank && reachable(id));
      if (!next) break;
      treeBuy(next);
    }
    const deepBefore = snap();
    const deepId = Object.keys(N).find((id) =>
      N[id].effect.flatDmg && (state.nodeRanks[id] || 0) < N[id].maxRank && reachable(id));
    const deepWant = N[deepId].effect.flatDmg;
    treeBuy(deepId);
    const deepAfter = snap();
    return {
      deltas, pool: state.mods.flatDmg,
      deepWant, deepGot: +(deepAfter.fireball - deepBefore.fireball).toFixed(6),
      deepFrost: +(deepAfter.frost - deepBefore.frost).toFixed(6),
      support: +(deepAfter.heal - deepBefore.heal).toFixed(6),
    };
  });
  const paysFace = promise.deltas.every((d) =>
    ["fireball", "lightning", "frost", "meteor"].every((s) => d.got[s] === d.want) &&
    ["shield", "heal"].every((s) => d.got[s] === 0));
  check(paysFace,
    "every rank of a flat node pays its printed value on all four damage pages, and none of it on the support pages");
  check(promise.deepGot === promise.deepWant && promise.deepFrost === promise.deepWant &&
    promise.support === 0 && promise.pool > 40,
    "it still pays face value deep in the pool (+" + promise.deepWant + " on a +" +
    Math.round(promise.pool) + " stack, Frostkegel included)");

  //     Nothing is capped any more, so a meter measures what the player owns
  //     against what the TREE HOLDS — the only honest denominator left, and the
  //     one that still answers "is another node of this worth walking to".
  const meter = await page.evaluate(() => {
    state._structuralDirty = true; render(performance.now());   // show what was just bought
    const supply = Incanto.skilltree.TREE_SUPPLY;
    const row = [...document.querySelectorAll(".sv-row")]
      .find((r) => r.querySelector(".sv-label").textContent.trim() === "③ Zuschlag je Treffer");
    const fill = row.querySelector(".sv-bar > i");
    return {
      supply: supply.flatDmg, mine: state.mods.flatDmg,
      width: parseFloat(fill.style.width),
      note: row.querySelector(".sv-note").textContent.replace(/\s+/g, " ").trim(),
    };
  });
  check(Math.abs(meter.width - (meter.mine / meter.supply) * 100) < 0.2,
    "a meter is drawn against what the whole tree holds of that stat (" +
    meter.width.toFixed(1) + "% of " + Math.round(meter.supply) + ")");
  check(/von .* im ganzen Baum/.test(meter.note), "…and the row says so in words (" + meter.note.slice(0, 48) + "…)");

  //     The spell tab: one card per page, in the order the book is BOUND, and
  //     each card's signature figures re-derived from the same mods the
  //     resolvers read — a chain that grew in the tree grows here too.
  await page.click('[data-act="setStatsTab"][data-args=\'["spells"]\']');
  await page.waitForTimeout(180);
  const cards = await page.evaluate(() => ({
    n: document.querySelectorAll(".sv-spell").length,
    names: [...document.querySelectorAll(".sv-spell-name h3")].map((h) => h.textContent.trim()),
    want: Incanto.spells.bookSpells().map((s) => s.name),
  }));
  check(cards.n === 6 && cards.names.join(",") === cards.want.join(","),
    "the ledger lists all six pages in bound order (" + cards.names.join(" · ") + ")");
  const grown = await page.evaluate(() => {
    state.mods.spellParam.chainLightning = 4;   // what four "one more hop" nodes buy
    state._structuralDirty = true; render(performance.now());
    const row = [...document.querySelectorAll(".sv-row")]
      .find((r) => r.querySelector(".sv-label").textContent.trim() === "Sprünge");
    return { shown: row ? row.querySelector(".sv-value").textContent.trim() : null,
             want: CONFIG.spells.lightning.chain + 4 };
  });
  check(grown.shown === grown.want + " Körper",
    "a spell's own parameters are re-derived, not restated (Sprünge " + grown.shown + ")");
  await page.click('[data-act="closeStats"]');
  await page.waitForTimeout(150);
  check(await page.evaluate(() => state.screen) === "upgrade", "leaving the ledger returns to the tree");
  await page.evaluate(() => { recomputeMods(); });   // undo the two hand-set mods

  // 10. The reward bank. Kills charge a gold multiplier that must survive dying
  //     and starting over — it is spent only by finishing a whole quiz, so a run
  //     cut short is never wasted fighting.
  const bank = await page.evaluate(() => {
    state.rewardKills = 0; state.kills = 0;
    creditKill(); creditKill(); creditKill();
    const afterKills = { run: state.kills, bank: state.rewardKills, mult: rewardMult() };
    startRun();                                   // a fresh run must not wipe the pile
    const afterRestart = { run: state.kills, bank: state.rewardKills };
    creditKill(); creditKill();
    const stacked = state.rewardKills;
    const saved = JSON.parse(localStorage.getItem("incanto.save.v1")).rewardKills;
    state.rewardKills = 10 ** 6;
    const capped = { mult: rewardMult(), flag: rewardMultCapped() };
    return { afterKills, afterRestart, stacked, saved, capped,
             cfg: { max: CONFIG.rewardMultMax, perCorrect: CONFIG.goldPerCorrect } };
  });
  check(bank.afterKills.bank === 3 && Math.abs(bank.afterKills.mult - 1.3) < 1e-9,
    "three kills bank a ×1.3 reward multiplier");
  check(bank.afterRestart.run === 0 && bank.afterRestart.bank === 3,
    "a new run clears the run score but keeps the banked multiplier (bank " + bank.afterRestart.bank + ")");
  check(bank.stacked === 5 && bank.saved === 5,
    "the next run's kills add on top, and the bank is persisted (" + bank.saved + ")");
  check(bank.capped.mult === bank.cfg.max && bank.capped.flag === true,
    "the multiplier is capped at ×" + bank.capped.mult);

  //    The quiz shows what it is worth, and only a completed session spends it.
  const spend = await page.evaluate(() => {
    state.rewardKills = 24;
    goToQuiz();
    render(performance.now());
    const chip = document.querySelector(".quiz-mult");
    const shown = chip ? chip.textContent.trim() : null;
    const perAnswer = quizReward();
    state.quizIndex = 2; advanceQuiz();
    const midway = state.rewardKills;                 // bailing out mid-quiz keeps it
    state.quizIndex = state.quizList.length - 1; advanceQuiz();
    return { shown, perAnswer, midway, after: state.rewardKills, screen: state.screen,
             saved: JSON.parse(localStorage.getItem("incanto.save.v1")).rewardKills };
  });
  check(spend.shown === "×3,4", "the quiz header shows the banked multiplier (" + spend.shown + ")");
  check(spend.perAnswer === Math.round(bank.cfg.perCorrect * 3.4),
    "each correct answer pays the multiplied reward (" + spend.perAnswer + ")");
  check(spend.midway === 24, "an unfinished quiz leaves the bank standing (" + spend.midway + ")");
  check(spend.after === 0 && spend.saved === 0 && spend.screen === "upgrade",
    "finishing the whole quiz cashes the bank in");

  //    And the run-over screen is a reward, not a defeat notice.
  await page.evaluate(() => {
    state.rewardKills = 12; state.runStartMs = performance.now();
    state.screen = "reward"; state._structuralDirty = true;
    render(performance.now());
  });
  const endScreen = await page.evaluate(() => ({
    text: document.querySelector(".end-screen").textContent,
    mult: (document.querySelector(".reward-mult-num") || {}).textContent,
    study: !!document.querySelector(".study-btn"),
  }));
  check(!/Niederlage/.test(endScreen.text) && endScreen.mult === "×2,2" && endScreen.study,
    "the run-over screen leads with the multiplier and a nudge to study (" + endScreen.mult + ")");

  // 11. The hall (see encounters.js) and the bodies that walk it. Three things
  //     are worth guarding here because all three are easy to break silently
  //     from a data file: the schedule has to resolve end to end, a body has to
  //     be able to fight from the back of the corridor, and the corridor has to
  //     have an end at all.
  const hall = await page.evaluate(() => {
    const E = window.Incanto.encounters;
    const SPRITES = window.Incanto.renderAssets.ENEMY_SPRITES;
    const known = new Set(CONFIG.enemyTypes.map((t) => t.id));
    const badPack = [], badType = new Set(), badSprite = [], noDebut = [];
    const firstAt = new Map();
    for (let i = 0; i < E.ENCOUNTER_PLAN.length; i++) {
      const entry = E.encounterAt(i);
      if (!entry.pack) { badPack.push(E.ENCOUNTER_PLAN[i].pack); continue; }
      for (const rank of E.packRanks(entry)) {
        for (const m of rank) {
          if (!known.has(m.type)) badType.add(m.type);
          if (!firstAt.has(m.type)) firstAt.set(m.type, { at: entry.at, camp: i });
        }
      }
    }
    for (const t of CONFIG.enemyTypes) {
      if (!SPRITES[t.sprite || "skelet"]) badSprite.push(t.id);
      if (!ASSETS.enemy[t.id]) badSprite.push(t.id + " (no frames)");
    }
    // Nothing new may arrive in a rush. This used to be measured in metres — a
    // new body had to be two camps clear of the last one — and that reading died
    // with the cut to half length: 42 bodies over 82 camps is a debut every
    // other camp on average, and holding a two-camp gap would need 210 m of hall
    // to put them in. What survives the halving, and is the thing that actually
    // decides whether a body is legible when it arrives, is that a debut gets a
    // camp TO ITSELF: two new silhouettes must never walk in on the same mark,
    // where neither can be told from the other.
    const debuts = [...firstAt.values()].sort((a, b) => a.at - b.at);
    const perCamp = new Map();
    for (const d of debuts) perCamp.set(d.camp, (perCamp.get(d.camp) || 0) + 1);
    const shared = [...perCamp.values()].filter((n) => n > 1).length;
    let tightest = Infinity;
    for (let i = 1; i < debuts.length; i++) {
      if (debuts[i].at < 33) continue;                 // the bone chapter teaches two at once, by design
      tightest = Math.min(tightest, debuts[i].at - debuts[i - 1].at);
    }
    return {
      camps: E.ENCOUNTER_PLAN.length,
      end: E.HALL_END_METRES,
      past: E.encounterAt(E.ENCOUNTER_PLAN.length),   // the plan runs out rather than looping
      mark: E.nextMark(E.ENCOUNTER_PLAN.length),
      types: CONFIG.enemyTypes.length,
      spacing: CONFIG.encounterSpacingMetres,
      placed: firstAt.size,
      lastDebut: debuts[debuts.length - 1].at,
      tightest, shared,
      badPack, badSprite, badType: [...badType],
    };
  });
  check(hall.badPack.length === 0 && hall.badType.length === 0 && hall.badSprite.length === 0,
    `every camp names a real pack, variant and sprite (${hall.camps} camps, ${hall.types} variants)`);
  check(hall.past === null && hall.mark === hall.end,
    `the hall ENDS: past the last camp the only mark left is the door at ${hall.end} m`);
  check(hall.shared === 0 && hall.tightest >= hall.spacing,
    `no new body is rushed in — every debut gets a camp to itself (tightest gap ${hall.tightest} m)`);
  check(hall.lastDebut > hall.end * 0.9,
    `the roster keeps opening up to the end (last new body at ${hall.lastDebut} m)`);

  //     SPLITTING SLIMES. The opening chapter's bodies divide when they are hurt
  //     (CONFIG.slimeTiers), and five things about that have to hold or the
  //     mechanic either stops firing or fills the corridor with specks:
  //       · a slime walks in on the TOP rung of the ladder whatever its hpMult
  //         says — the ladder is the whole of what it is worth;
  //       · a hit turns it into TWO of the rung below, each with a full bar of
  //         that rung's HP. None of the damage carries over;
  //       · A KILLING BLOW DIVIDES IT TOO, and this is the one the mechanic lives
  //         or dies by. A grown hero one-shots 60 HP without noticing, so a split
  //         gated on surviving the blow switches itself off for every build past
  //         the first few nodes — the player kills the big one and nothing comes
  //         out of it. Overkill has to leave two halves standing, however far
  //         past zero it went;
  //       · the bottom rung divides into nothing. It takes the hit like any other
  //         body and dies, which is what stops the floor filling with 1 HP
  //         fragments each still owed its own cast;
  //       · the size and the damage follow the rung down, so a half is drawn
  //         smaller and hits softer than the body it came off.
  const split = await page.evaluate(async () => {
    const P = window.Incanto.progression;
    const settle = (ms) => new Promise((r) => setTimeout(r, ms));
    const rungs = CONFIG.slimeTiers;
    const top = rungs[rungs.length - 1], floor = rungs[0];
    // A body on exactly `hp`, hit for `dmg`, once the loop has carried the blow out.
    const strike = async (hp, dmg) => {
      startRun();
      state.enemies = [];
      state.packIndex = 999;                 // no camp may wander in mid-measurement
      const e = P.spawnEnemy(performance.now(), 2, 3, "slime");
      e.hp = e.maxHP = hp;
      P.sizeBody(e, P.enemyTypeById("slime"));
      const was = { w: e.w, dmg: e.dmg, name: e.name };
      const kills = state.kills;
      // Through the spell pipeline, not through hitEnemy alone: booking the death
      // and crediting the kill happen in applySpellHit, and "a killing blow
      // divides instead of killing" is a claim about THAT path.
      Incanto.spells.applySpellHit(e, dmg, performance.now());
      await settle(120);                     // updateEnemies resolves it on the next beats
      const live = livingEnemies();
      return { was, bodies: live.length, hp: live.reduce((n, x) => n + x.hp, 0),
               w: live[0] && live[0].w, dmg: live[0] && live[0].dmg, name: live[0] && live[0].name,
               full: live.every((x) => x.hp === x.maxHP), killed: state.kills - kills,
               corpses: state.enemies.length - live.length };
    };
    const walkIn = P.spawnHP(P.enemyTypeById("slimeBlue"));
    const big = await strike(top.hp, 1);           // a scratch → two of the rung below
    const mid = await strike(rungs[1].hp, 1);      // …and those divide again
    const small = await strike(floor.hp, 1);       // the bottom rung: nothing smaller to become
    // What every real build does to a 60 HP body: delete it. It has to come apart
    // anyway, and it must not be counted as a kill — it didn't die.
    const overkill = await strike(top.hp, 10000);
    const finish = await strike(floor.hp, 10000);  // …but the smallest really does die
    return { walkIn, top: top.hp, mid: rungs[1].hp, floor: floor.hp, big, mids: mid, small,
             overkill, finish };
  });
  check(split.walkIn === split.top,
    `a slime walks in on the ladder's top rung, not on its hpMult (${split.walkIn} HP)`);
  check(split.big.bodies === 2 && split.big.hp === 2 * split.mid && split.big.full,
    `a hurt slime divides into two of the rung below, both on a FULL bar (2 x ${split.mid} HP)`);
  check(split.mids.bodies === 2 && split.mids.hp === 2 * split.floor && split.mids.full,
    `and those divide again, down to the floor (2 x ${split.floor} HP)`);
  check(split.big.w < split.big.was.w && split.big.dmg < split.big.was.dmg,
    `each half is drawn smaller and hits softer than the body it came off (${split.big.was.w}px/${split.big.was.dmg} → ${split.big.w}px/${split.big.dmg})`);
  check(split.small.bodies === 1 && split.small.hp === split.floor - 1,
    `the smallest slime divides into nothing — it just takes the hit (${split.small.name}, ${split.small.hp} HP)`);
  check(split.overkill.bodies === 2 && split.overkill.hp === 2 * split.mid && split.overkill.full,
    `a blow that would delete a big slime divides it instead — 10.000 damage still leaves 2 x ${split.mid} HP standing`);
  check(split.overkill.killed === 0 && split.overkill.corpses === 0,
    "…and none of it is counted as a kill, because nothing died");
  check(split.finish.bodies === 0 && split.finish.killed === 1,
    "the smallest slime does die to it, exactly once");

  //     THE CADENCE CONTRACT (config.js: `attackMs`). Damage in this hall
  //     trickles: every body swings often and small. Two things have to hold for
  //     that to stay readable rather than turn into noise or into nothing —
  //       · every variant names a cadence, inside the bands the design is
  //         written in, and no body's blow rounds away to the 1-damage floor
  //         that `sizeBody` puts under it;
  //       · a slime's three rungs stay three DISTINCT numbers. They are what the
  //         splitting ladder above is made of, and they are the first thing a
  //         faster nibble would flatten (see the note at the slime entries).
  const cadence = await page.evaluate(() => {
    const blow = (t) => Math.max(1, Math.round(CONFIG.enemyBaseDmg * t.dmgMult));
    const bad = [];
    for (const t of CONFIG.enemyTypes) {
      const ms = t.attackMs;
      if (!(ms >= 800 && ms <= 3000)) bad.push(`${t.id}: attackMs ${ms}`);
      if (Math.round(CONFIG.enemyBaseDmg * t.dmgMult) < 1) bad.push(`${t.id}: blow rounds to nothing`);
    }
    const ladders = CONFIG.enemyTypes.filter((t) => t.split).map((t) => ({
      id: t.id, rungs: CONFIG.slimeTiers.map((s) => Math.max(1, Math.round(CONFIG.enemyBaseDmg * t.dmgMult * s.dmgMult))),
    }));
    return { bad, ladders, count: CONFIG.enemyTypes.length };
  });
  check(cadence.bad.length === 0,
    `every one of the ${cadence.count} bodies swings on its own cadence, in band, for a real number` +
    (cadence.bad.length ? " — " + cadence.bad.join("; ") : ""));
  check(cadence.ladders.every((l) => new Set(l.rungs).size === l.rungs.length),
    "a splitting body's damage rungs stay distinct, so a fragment never hits like the barrel it came off (" +
    cadence.ladders.map((l) => `${l.id} ${l.rungs.join("/")}`).join(", ") + ")");

  //     A ranged body plants far short of the melee line and still lands hits;
  //     a healer puts HP back on a wounded ally; a summoner adds bodies.
  const roles = await page.evaluate(async () => {
    const E = window.Incanto.encounters;
    const settle = (ms) => new Promise((r) => setTimeout(r, ms));
    startRun();
    state.heroMaxHP = state.heroHP = 100000;
    // Regen would quietly refill whatever the corridor takes off (the tree nodes
    // bought earlier in this run are still on), so it is off for the measurement
    // — the question here is whether a bolt lands at all, not how the hero copes.
    state.mods.regen = 0;
    state.enemies = [];
    state.enemyShots = [];
    // A caster escort, dropped where it would stand after its walk-in, with the
    // front rank already hurt so the healer has something to mend.
    spawnPack(performance.now(), { pack: E.PACKS.knochenfuerst, reinforce: 0 });
    for (const e of state.enemies) {
      e.pos = Math.max(e.standoff, e.pos - 7);
      if (e.role === "melee") e.hp = Math.round(e.maxHP * 0.35);
    }
    const wounded = state.enemies.filter((e) => e.role === "melee").map((e) => e.id);
    const before = { hp: state.heroHP, bodies: state.enemies.length, ids: new Set(state.enemies.map((e) => e.id)) };
    // Watch the whole window rather than sampling the end of it: a bolt is in
    // the air for well under a second, and a mend is instant.
    let sawShot = 0, landed = 0, mended = false;
    const seenShots = new Set();
    for (let i = 0; i < 320; i++) {
      await settle(50);
      for (const shot of state.enemyShots || []) {
        if (!seenShots.has(shot)) { seenShots.add(shot); sawShot++; }
        if (shot.hit && !shot._counted) { shot._counted = true; landed++; }
      }
      if (state.enemies.some((e) => wounded.includes(e.id) && e.hp > Math.round(e.maxHP * 0.35))) mended = true;
      if (landed && mended && state.enemies.length > before.bodies) break;
    }
    const ranged = state.enemies.filter((e) => e.role === "ranged");
    return {
      sawShot, landed,
      heroLost: Math.round(before.hp - state.heroHP),
      summoned: state.enemies.filter((e) => !before.ids.has(e.id)).length,
      mended,
      rangedStandoff: ranged.length ? Math.min(...ranged.map((e) => e.pos)) : 0,
      meleeLine: CONFIG.enemyStandoffTiles,
    };
  });
  check(roles.rangedStandoff > roles.meleeLine + 2,
    `a ranged body holds the back of the hall (${roles.rangedStandoff.toFixed(1)} tiles vs. a ${roles.meleeLine}-tile melee line)`);
  check(roles.sawShot > 0 && roles.landed > 0 && roles.heroLost > 0,
    `its bolts cross the corridor and land (${roles.landed} of ${roles.sawShot} arrived, ${roles.heroLost} damage taken)`);
  check(roles.mended, "a healer puts HP back on the wounded body in front of it");
  check(roles.summoned > 0, `a summoner calls in bodies of its own (${roles.summoned})`);

  //     THE MOB LOOKS FOR A WAY ROUND (see pathfind.js). A lane is a strict queue
  //     and only its front body reaches melee, so a column of six in one lane used
  //     to come at the hero in single file with three lanes of open floor beside
  //     it. Now a body that is walled in runs A* over the hall and crosses. Four
  //     things are measured, and only the first is about spreading out: the
  //     column fills the empty lanes and really does swing; nothing ever ends up
  //     sharing a tile with anybody (a change of lane must not be a way through a
  //     body); and the change is a SLIDE, drawn between the two rows rather than
  //     a jump from one to the other.
  const spread = await page.evaluate(async () => {
    const E = window.Incanto.encounters;
    const settle = (ms) => new Promise((r) => setTimeout(r, ms));
    startRun();
    state.heroMaxHP = state.heroHP = 10 ** 6;
    state.mods.regen = 0;
    state.packIndex = E.ENCOUNTER_PLAN.length;   // no camps, no fillers — just these six
    state.enemies = [];
    // All six in one lane, and unkillable: what is measured here is the marching,
    // not the hero's aim.
    for (let i = 0; i < 6; i++) {
      const b = spawnEnemy(performance.now(), 1, 2 + i * 1.3, CONFIG.enemyTypes[0].id);
      b.hp = b.maxHP = 10 ** 6;
    }
    const hp0 = state.heroHP;
    let slid = 0, shared = 0, swinging = 0;
    for (let i = 0; i < 160; i++) {
      await settle(50);
      for (const e of state.enemies) if (Math.abs(e.laneVis - e.lane) > 0.05) slid++;
      // No two bodies of one lane may ever come inside the clearance the march
      // itself keeps — a sidestep that lands on top of somebody is a body walked
      // through, however good the reason for it.
      for (const a of state.enemies) {
        for (const b of state.enemies) {
          if (a.id >= b.id || a.lane !== b.lane) continue;
          if (Math.abs(a.pos - b.pos) < Incanto.loop.laneSpacing(a, b) - 0.05) shared++;
        }
      }
      swinging = Math.max(swinging, state.enemies.filter((e) => e.phase === "attack").length);
    }
    const per = {};
    for (const e of state.enemies) per[e.lane] = (per[e.lane] || 0) + 1;
    return {
      bodies: state.enemies.length, lanes: Object.keys(per).length, per, slid, shared, swinging,
      hurt: Math.round(hp0 - state.heroHP), of: CONFIG.enemyLanes,
    };
  });
  check(spread.bodies === 6 && spread.lanes === spread.of,
    `six bodies stacked in one lane spread over all ${spread.of} of them (` +
    Object.keys(spread.per).sort().map((l) => `${l}:${spread.per[l]}`).join(" ") + ")");
  check(spread.swinging >= spread.of && spread.hurt > 0,
    `…and ${spread.swinging} of them reach the hero at once instead of one (${spread.hurt} damage taken)`);
  check(!spread.shared, "no body ever crosses INTO another one — the march's own clearance holds throughout");
  check(spread.slid > 0, `the change of lane is a slide, drawn between the two rows (${spread.slid} frames caught mid-step)`);

  //     …and the part that needs a search rather than a nudge sideways: when the
  //     lane next door is a wall, the body has to go ROUND it. Asked of the search
  //     directly, because the answer that matters most is the negative one — a
  //     floor with no way through must come back "no", so a boxed-in body holds
  //     its place in the queue instead of shuffling against the wall forever.
  const around = await page.evaluate(async () => {
    const E = window.Incanto.encounters;
    const P = window.Incanto.pathfind;
    const settle = (ms) => new Promise((r) => setTimeout(r, ms));
    const mk = (lane, pos) => {
      const b = spawnEnemy(performance.now(), lane, pos, CONFIG.enemyTypes[0].id);
      b.hp = b.maxHP = 10 ** 6;
      return b;
    };
    const clear = () => {
      startRun();
      state.heroMaxHP = state.heroHP = 10 ** 6;
      state.mods.regen = 0;
      state.packIndex = E.ENCOUNTER_PLAN.length;
      state.enemies = [];
    };
    const routeTo = (b, lane) => P.laneRouteFor(P.buildLaneGrid(CONFIG.enemyLanes), b, lane);

    // (a) THE SEARCH, ASKED DIRECTLY. A body five tiles out has the stretch from
    //     the melee line to its own feet to work with and nothing else, so lane 1
    //     sealed across exactly that stretch puts lanes 2 and 3 out of reach.
    clear();
    const boxed = mk(0, 5);
    const wall = [2, 3, 4, 5].map((c) => mk(1, c));
    const walled = routeTo(boxed, 2).length;
    // Open one gate in it, two tiles ahead of where the body stands, and the
    // same question has an answer — and the answer is the gate, not a shuffle
    // sideways into the wall.
    state.enemies = state.enemies.filter((b) => b !== wall[1]);
    const gate = P.laneStepFrom(boxed, routeTo(boxed, 2));

    // (b) AND THE WALK. The shape a pack really makes: lane 0 three deep with the
    //     hero already busy, one body in lane 1 parked square on the rearmost
    //     one's sidestep, two lanes of open floor past it. Getting there means
    //     walking up the hall first and turning where lane 1 is clear.
    clear();
    mk(0, CONFIG.enemyStandoffTiles); mk(0, 2.8);
    const straggler = mk(0, 6);
    const blocker = mk(1, 6);
    const from = { lane: straggler.lane, pos: straggler.pos };
    let turnedAt = null;
    for (let i = 0; i < 240 && straggler.lane !== 2; i++) {
      await settle(50);
      if (turnedAt == null && straggler.lane !== from.lane) turnedAt = straggler.pos;
    }
    return {
      walled, wall: wall.length, gate,
      from: from.lane, to: straggler.lane, blocker: +blocker.pos.toFixed(1),
      turnedAt: turnedAt == null ? null : +turnedAt.toFixed(1), start: from.pos,
    };
  });
  check(around.walled === 0,
    `a lane sealed across the whole stretch a body can cover (${around.wall} bodies) is answered ` +
    `"no way through" rather than fudged`);
  check(around.gate && around.gate.lane === 1 && around.gate.pos === 3,
    `one gate in that wall and the search comes back with the gate itself — cross at ${around.gate ? around.gate.pos : "?"} tiles, ` +
    `not at the 5 it is standing on`);
  check(around.to === 2 && around.turnedAt != null && around.turnedAt < around.start - 0.5,
    `and a straggler walled in behind its own rank goes ROUND the body blocking its sidestep — ` +
    `lane ${around.from} → ${around.to}, turning at ${around.turnedAt} tiles rather than the ${around.start} it set off from`);

  //     THERE IS NO ENEMY HEALTH BAR, and that is a decision, not an oversight.
  //     The strip under the scene is the hero's alone — no wave line, no bar
  //     tracking whichever body happens to be frontmost — and the hall itself
  //     stays clean: a per-body gauge painted into the scene was built and thrown
  //     out, because the hall is 200x80 art pixels, bodies queue a 16 px tile
  //     apart, and "127/176" is 27 px wide. What a body is worth is read off the
  //     body: its size, its sprite, and the damage popping off it.
  const hud = await page.evaluate(async () => {
    const settle = (ms) => new Promise((r) => setTimeout(r, ms));
    const E = window.Incanto.encounters;
    startRun();
    state.heroMaxHP = state.heroHP = 100000;
    state.enemies = [];
    spawnPack(performance.now(), { pack: E.PACKS.knochenfuerst, reinforce: 0 });
    for (let i = 0; i < 40 && state.enemies.some((x) => x.phase === "walk"); i++) await settle(100);
    render(performance.now());
    const strip = document.querySelector(".hud-under");
    return {
      bodies: livingEnemies().length,
      hero: !!document.getElementById("hero-hp-fill"),
      // The strip holds ONE bar. A re-added enemy bar would be a second.
      bars: strip.querySelectorAll(".hp-track").length,
      heroBar: !!strip.querySelector(".hp-track.hero #hero-hp-fill"),
      // …and nothing anywhere on the screen still writes the hall's numbers out.
      leftovers: ["wave-label", "enemy-hp-fill", "enemy-gauges"]
        .filter((id) => document.getElementById(id)),
      // The strip is one row, no taller than the bar plus its padding: the row
      // it used to spend on a "HELD" caption is the rune circle's now.
      height: strip.getBoundingClientRect().height,
    };
  });
  check(hud.bodies > 5 && hud.hero && hud.bars === 1 && hud.heroBar && hud.leftovers.length === 0,
    `no enemy carries a health bar — the strip is the hero's alone with ${hud.bodies} bodies up` +
    (hud.leftovers.length ? " (found: " + hud.leftovers.join(", ") + ")" : ""));
  check(hud.height <= 28,
    `…and it is one row tall, figures beside the bar rather than over it (${Math.round(hud.height)}px)`);

  //     A spell takes time to cross the hall, and a body it has already killed
  //     must go on running until it ARRIVES — stopping dead and dissolving at the
  //     moment the shape was drawn reads as dying of nothing.
  const flight = await page.evaluate(async () => {
    const settle = (ms) => new Promise((r) => setTimeout(r, ms));
    startRun();
    state.heroMaxHP = state.heroHP = 100000;
    state.mods.regen = 0;
    state.heroDmg = 100000;              // one-shot whatever it lands on
    state.mods.castHaste = 1e6;          // no wind-up, so the flight IS the whole delay
    state.enemies = [];
    state.enemyShots = [];
    const e = spawnEnemy(performance.now(), 1, 9, CONFIG.enemyTypes[0].id);
    await settle(200);                   // let it get up to a walk out in the hall
    const from = e.pos;
    const kills0 = state.kills;
    const t0 = performance.now();
    onShapeComplete(t0);
    const booked = e.deathAt ? Math.round(e.deathAt - t0) : null;
    // Sample across the flight: it must still be walking, and still moving.
    const seen = new Set();
    let posAtLand = e.pos, earlyStop = false;
    for (let i = 0; i < 40 && e.phase !== "dying"; i++) {
      await settle(25);
      if (performance.now() - t0 < CONFIG.spells.fireball.flightMs - 60) {
        seen.add(e.phase);
        posAtLand = e.pos;
        if (e.phase === "dying") earlyStop = true;
      }
    }
    await settle(700);                   // and the dissolve still finishes
    return {
      booked, flightMs: CONFIG.spells.fireball.flightMs,
      phases: [...seen], earlyStop,
      walked: +(from - posAtLand).toFixed(2),
      kills: state.kills - kills0,
      culled: !state.enemies.includes(e),
    };
  });
  check(flight.booked !== null && Math.abs(flight.booked - flight.flightMs) < 40,
    `a fatal hit books its death for the moment the spell arrives (+${flight.booked}ms of ${flight.flightMs}ms flight)`);
  check(!flight.earlyStop && flight.phases.join() === "walk" && flight.walked > 0.15,
    `the doomed body keeps running while the ball is in the air (${flight.walked} tiles, phase ${flight.phases.join("/")})`);
  check(flight.kills === 1 && flight.culled,
    "it then collapses, is culled, and is counted exactly once");

  //     THE METEOR'S AIM (see meteorField in spells.js). The shower is random,
  //     but random OVER THE HORDE: the rocks are rolled inside the mob's
  //     bounding box grown by CONFIG.spells.meteor.padTiles / padLanes. Both
  //     halves matter and are checked separately — a barrage that ignored the
  //     box would waste itself on empty floor, and one that dropped a rock on
  //     each body would be a volley, not a shower. So: nothing lands outside the
  //     padded box, and rocks DO land outside the pack itself.
  const shower = await page.evaluate(() => {
    startRun();
    state.heroMaxHP = state.heroHP = 10 ** 6;
    state.enemies = [];
    // One tight pack, deliberately parked mid-hall in two of the four lanes, so
    // "aimed at the horde" and "sprayed over the hall" can't be confused.
    const at = [[4.6, 1], [5.0, 2], [5.4, 1]];
    for (const [pos, lane] of at) spawnEnemy(performance.now(), lane, pos, CONFIG.enemyTypes[0].id);
    for (const e of state.enemies) e.hp = e.maxHP = 10 ** 6;   // nothing dies mid-barrage
    const cfg = CONFIG.spells.meteor;
    const field = meteorField(spellTargets());
    const rocks = [];
    for (let i = 0; i < 40; i++) {
      state.spellFx = [];
      state.meteorRocks = [];
      const now = performance.now();
      SPELL_RESOLVERS.meteor({ castAt: now, now, power: 1, shatter: false, pickTargets: () => [] });
      // The barrage is scheduled, not resolved: run the clock past the last
      // rock's landing so every one of them commits and strikes.
      updateMeteorRocks(now + cfg.fallMs + cfg.spreadMs + 1);
      for (const f of state.spellFx) if (f.kind === "meteor") rocks.push({ pos: f.pos, lane: f.lane });
    }
    const lo = Math.min(...at.map((a) => a[0])), hi = Math.max(...at.map((a) => a[0]));
    return {
      n: rocks.length, field, edge: trackEdgeTiles(1), pad: cfg.padTiles,
      left: state.meteorRocks.length,
      inBox: rocks.every((r) => r.pos >= field.posLo - 1e-6 && r.pos <= field.posHi + 1e-6 &&
        r.lane >= field.laneLo && r.lane <= field.laneHi),
      pastPack: rocks.filter((r) => r.pos < lo || r.pos > hi).length,
      lanes: new Set(rocks.map((r) => r.lane)).size,
      spread: +(Math.max(...rocks.map((r) => r.pos)) - Math.min(...rocks.map((r) => r.pos))).toFixed(2),
      wholeLane: at.every(([, lane]) => rocks.some((r) => r.lane === lane)),
    };
  });
  check(shower.inBox && shower.field.posHi - shower.field.posLo < shower.edge * 0.75 && !shower.left,
    `every rock falls on the horde's own stretch of hall, not the whole track ` +
    `(${shower.n} rocks in ${shower.field.posLo.toFixed(1)}–${shower.field.posHi.toFixed(1)} of ${shower.edge.toFixed(1)} tiles)`);
  check(shower.pastPack > shower.n * 0.2 && shower.spread > shower.pad,
    `and it is still a shower, not a volley — ${shower.pastPack} of ${shower.n} land off the pack, ` +
    `over ${shower.spread} tiles`);
  check(shower.lanes > 1 && shower.wholeLane,
    `the padding reaches across the lanes too (${shower.lanes} lanes struck, both occupied ones included)`);

  //     …and it aims at the horde WHERE IT IS WHEN THE ROCK FALLS. Up to 1,7 s
  //     of charge, fall and barrage-spread sits between the shape being drawn
  //     and a stone hitting the floor, so a shower that picked its spots at cast
  //     time cratered the flagstones a marching pack had already left. Each rock
  //     commits as it starts falling and hurts whoever is under it when it
  //     lands: driven in real time against a body walking in, every rock has to
  //     land near where that body was at ITS OWN moment, not at the cast's.
  const tracking = await page.evaluate(async () => {
    const settle = (ms) => new Promise((r) => setTimeout(r, ms));
    startRun();
    state.heroMaxHP = state.heroHP = 10 ** 6;
    state.mods.regen = 0;
    state.enemies = [];
    const e = spawnEnemy(performance.now(), 1, 9.4, CONFIG.enemyTypes[0].id);
    e.hp = e.maxHP = 10 ** 6;                 // it has to survive the whole barrage to be walked at
    state.spellFx = []; state.meteorRocks = [];
    const cast = performance.now();
    const posAtCast = e.pos;
    SPELL_RESOLVERS.meteor({ castAt: cast, now: cast, power: 1, shatter: false, pickTargets: () => [] });
    // Sample where the body actually is, frame by frame, while the rocks fall —
    // and collect the rocks as they appear, since a spent effect is culled off
    // state.spellFx long before the last one has come down.
    const track = [];
    const seen = new Set();
    const rocks = [];
    const cfg = CONFIG.spells.meteor;
    // Sampled across the barrage's whole window rather than until the last rock
    // happens to land — the window is fixed, the last rock's moment inside it is
    // a die roll, and the drift measured below has to be the window's.
    const windowMs = cfg.fallMs + cfg.spreadMs;
    while (performance.now() - cast < windowMs + 200) {
      track.push({ t: performance.now(), pos: e.pos });
      for (const f of state.spellFx) {
        if (f.kind === "meteor" && !seen.has(f)) { seen.add(f); rocks.push(f); }
      }
      await settle(25);
    }
    const posAt = (t) => track.reduce((best, s) =>
      Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best, track[0]).pos;
    return {
      n: rocks.length, walked: +(posAtCast - e.pos).toFixed(2), pad: cfg.padTiles,
      left: state.meteorRocks.length,
      // Each rock against the body as it stood at that rock's OWN commit moment
      // — the padded box it was rolled inside of, so the bound is exact.
      offBorn: rocks.map((f) => +Math.abs(f.pos - posAt(f.born)).toFixed(2)),
      // …and how far an aim taken at the cast has gone stale by the end of the
      // barrage's window, which is the whole of the bug this replaced.
      staleBy: +Math.abs(posAtCast - posAt(cast + windowMs)).toFixed(2),
    };
  });
  const worstBorn = Math.max(...tracking.offBorn);
  check(tracking.n >= 3 && !tracking.left && tracking.walked > 0.6,
    `a barrage comes down on a body still walking in (${tracking.n} rocks over ${tracking.walked} tiles of march)`);
  check(worstBorn <= tracking.pad + 0.05,
    `every rock is rolled over the horde as it stands when THAT rock starts falling ` +
    `(worst ${worstBorn} tiles from it, padding ${tracking.pad})`);
  check(tracking.staleBy > 0.6,
    `— an aim taken at the cast is ${tracking.staleBy} tiles stale by the end of the barrage`);

  //     A crater is a ring drawn on the floor, so an impact point too near a
  //     frame edge leaves the screen on one side and comes back on the other:
  //     a rock at the hero's feet painting half a ring at the far wall reads as
  //     the spell landing twice. The AIM is held in far enough for the whole
  //     crater to fit; the radius the player bought is never trimmed to do it.
  const crater = await page.evaluate(() => {
    startRun();
    state.heroMaxHP = state.heroHP = 10 ** 6;
    state.enemies = [];
    // A wide-crater build, with the pack right on top of the hero — the case
    // that used to spill the ring off the left edge.
    state.mods.spellParam.aoeMeteor = 0.75;
    const cfg = CONFIG.spells.meteor;
    const radius = cfg.radiusTiles * (1 + state.mods.spellParam.aoeMeteor);
    for (const [pos, lane] of [[CONFIG.enemyStandoffTiles, 1], [2.1, 2]]) {
      const b = spawnEnemy(performance.now(), lane, pos, CONFIG.enemyTypes[0].id);
      b.hp = b.maxHP = 10 ** 6;
    }
    const rocks = [];
    for (let i = 0; i < 30; i++) {
      state.spellFx = []; state.meteorRocks = [];
      const now = performance.now();
      SPELL_RESOLVERS.meteor({ castAt: now, now, power: 1, shatter: false, pickTargets: () => [] });
      updateMeteorRocks(now + cfg.fallMs + cfg.spreadMs + 1);
      for (const f of state.spellFx) if (f.kind === "meteor") rocks.push(f);
    }
    // The ring as render-spells draws it: centred on enemyLineX + pos*TILE.
    const edges = rocks.map((f) => ({
      left: scene.enemyLineX + (f.pos - f.radius) * TILE,
      right: scene.enemyLineX + (f.pos + f.radius) * TILE,
      r: f.radius,
    }));
    return {
      n: rocks.length, radius, artW: scene.artW, hall: +(scene.artW / TILE).toFixed(1),
      offLeft: edges.filter((e) => e.left < -0.01).length,
      offRight: edges.filter((e) => e.right > scene.artW + 0.01).length,
      keptRadius: edges.every((e) => Math.abs(e.r - radius) < 1e-9),
    };
  });
  check(crater.n > 0 && !crater.offLeft && !crater.offRight,
    `a wide crater is aimed to stay inside the frame — no ring wrapping off one edge and back on the other ` +
    `(${crater.n} rocks, ${crater.radius.toFixed(1)}-tile radius in a ${crater.hall}-tile frame)`);
  check(crater.keptRadius,
    "…and it is the aim that moved, not the radius the player bought");

  //     And walking onto the hall's last metre ends the run the one way that
  //     isn't dying.
  const cleared = await page.evaluate(() => {
    const E = window.Incanto.encounters;
    startRun();
    state.packIndex = E.ENCOUNTER_PLAN.length;
    state.distance = E.HALL_END_METRES;
    state.enemies = [];
    updateCamera(performance.now(), 16);
    state._structuralDirty = true;
    render(performance.now());
    return {
      screen: state.screen, run: state.runActive, flag: state.hallCleared,
      saved: !!JSON.parse(localStorage.getItem("incanto.save.v1")).hallClearedEver,
      title: (document.querySelector(".end-screen h1") || {}).textContent,
    };
  });
  check(cleared.flag && !cleared.run && cleared.screen === "reward" && cleared.saved,
    "reaching the door ends the run and is remembered");
  check(/Ende des Ganges/.test(cleared.title || ""),
    `the end screen says so rather than reading as a death ("${cleared.title}")`);
  // 11b. The tavern (see tavern.js): the home room, and the first button on the
  //      bottom bar. Three things matter here — the bar still offers every phase
  //      in its old order with the tavern added AHEAD of them, the room is a live
  //      scene (the mage wanders on his own), and tapping a station walks him
  //      over and hands the phase off when he arrives. Driven with taps only.
  const bar = await page.evaluate(() => ({
    phases: [...document.querySelectorAll("#bottom-nav .nav-btn")].map((b) => b.dataset.phase),
  }));
  check(bar.phases.join(",") === "tavern,study,upgrade,combat",
    "the tavern leads the bar and the three phases keep their order (" + bar.phases.join(" · ") + ")");

  await page.click('#bottom-nav .nav-btn[data-phase="tavern"]');
  await page.waitForTimeout(400);
  const room = await page.evaluate(() => ({
    screen: state.screen,
    phase: (document.querySelector("#bottom-nav .nav-btn.active") || {}).dataset.phase,
    canvas: !!document.getElementById("tav-scene"),
    chips: [...document.querySelectorAll(".tav-chip")].map((c) => c.dataset.station),
    people: tavern ? tavern.people.length + 1 : 0,
    // No chip may hang off the edge of the room, however tight the phone.
    inside: [...document.querySelectorAll(".tav-chip")].every((c) => {
      const r = c.getBoundingClientRect(), s = document.getElementById("tav-stage").getBoundingClientRect();
      return r.left >= s.left - 0.5 && r.right <= s.right + 0.5;
    }),
  }));
  check(room.screen === "tavern" && room.canvas && room.phase === "tavern",
    "the tankard button opens the tavern (nav=" + room.phase + ")");
  check(room.chips.join(",") === "forge,bar,hall,study" && room.inside,
    "every station carries a chip, all of them on screen (" + room.chips.join(" · ") + ")");
  check(room.people === 7, "the room is peopled (" + room.people + " figures, the mage included)");

  //      The tavern's furniture is the only art in the game not cut from the
  //      sprite sheet, so it is the only art that can drift away from it. Every
  //      colour it uses has to be a colour the sheet itself uses — a hand-mixed
  //      brown standing next to 0x72's browns is what makes a drawn-in prop look
  //      pasted on.
  const palette = await page.evaluate(() => {
    const cv = document.createElement("canvas");
    cv.width = tilesetImg.naturalWidth; cv.height = tilesetImg.naturalHeight;
    const cx = cv.getContext("2d");
    cx.imageSmoothingEnabled = false;
    cx.drawImage(tilesetImg, 0, 0);
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    const sheet = new Set();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      sheet.add("#" + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join(""));
    }
    const strays = Object.entries(TAV_PAL).filter(([, hex]) => !sheet.has(hex.toLowerCase()));
    return { count: Object.keys(TAV_PAL).length, strays: strays.map(([k, v]) => k + "=" + v) };
  });
  check(palette.strays.length === 0,
    "every colour the tavern's own art uses is one the sheet uses (" + palette.count +
    " checked" + (palette.strays.length ? ", stray: " + palette.strays.join(" ") : "") + ")");

  //      The mage is not a still picture: left alone he picks somewhere to be
  //      and walks there.
  const strolled = await page.evaluate(async () => {
    const settle = (ms) => new Promise((r) => setTimeout(r, ms));
    const from = { x: tavern.mage.x, y: tavern.mage.y };
    let moved = 0;
    for (let i = 0; i < 60 && moved < 6; i++) {
      await settle(100);
      moved = Math.hypot(tavern.mage.x - from.x, tavern.mage.y - from.y);
    }
    return { moved, walked: moved > 6 };
  });
  check(strolled.walked, "the mage wanders the room on his own (" + strolled.moved.toFixed(0) + " px)");

  //      And a station is a door: tap it, he walks over, and the phase changes
  //      when he gets there — not before.
  const sent = await page.evaluate(() => {
    // Put him across the room from the forge so the walk is a real one.
    const st = tavern.stations.find((s) => s.id === "forge");
    tavern.mage.x = tavern.walk.x1 - 6;
    tavern.mage.y = tavern.walk.y1 - 6;
    tavern.mage.moving = false; tavern.mage.goal = null; tavern.mage.waitUntil = Infinity;
    return { stand: st.stand, from: { x: tavern.mage.x, y: tavern.mage.y } };
  });
  await page.click('.tav-chip[data-station="forge"]');
  await page.waitForTimeout(250);
  const walking = await page.evaluate(() => ({
    screen: state.screen,
    moving: tavern.mage.moving,
    goal: tavern.mage.goal && tavern.mage.goal.id,
    lit: !!document.querySelector('.tav-chip[data-station="forge"].on'),
  }));
  check(walking.screen === "tavern" && walking.moving && walking.goal === "forge" && walking.lit,
    "tapping a station sets the mage walking rather than jumping the screen (goal=" + walking.goal + ")");
  await page.waitForFunction(() => state.screen === "upgrade", null, { timeout: 15000 });
  const arrived = await page.evaluate((stand) => ({
    screen: state.screen,
    phase: (document.querySelector("#bottom-nav .nav-btn.active") || {}).dataset.phase,
    dist: Math.hypot(tavern.mage.x - stand.x, tavern.mage.y - stand.y),
  }), sent.stand);
  check(arrived.screen === "upgrade" && arrived.phase === "upgrade" && arrived.dist < 2,
    "…and reaching the anvil is what opens the forge (" + arrived.dist.toFixed(1) + " px from the spot)");

  //      A tap on bare floor is a walk and nothing else — the room is walkable,
  //      not a menu with a picture behind it.
  const floor = await page.evaluate(() => {
    navTo("tavern");
    render(performance.now());
    const w = tavern.walk;
    const to = { x: (w.x0 + w.x1) / 2, y: (w.y0 + w.y1) / 2 };
    tavernTapPoint(to.x, to.y);
    return { screen: state.screen, moving: tavern.mage.moving, goal: tavern.mage.goal };
  });
  check(floor.screen === "tavern" && floor.moving && floor.goal === null,
    "a tap on the floor walks him there and changes no screen");

  //      …and he gets there from ANYWHERE. The room is meant to be crowded, so
  //      the floor is searched with A* (tavern.js buildTavernNav) rather than
  //      slid along — the walk this replaced ended on the spot when a corner
  //      blocked both axes at once, which made the layout numbers load-bearing:
  //      one barrel moved three px and a station became unreachable, silently.
  //      Every station, from every corner, with the phase hand-off disarmed so
  //      the walk itself is what is measured.
  const corners = await page.evaluate(async () => {
    navTo("tavern");
    const w = tavern.walk, m = tavern.mage;
    const spots = [[w.x0 + 4, w.y0 + 4], [w.x1 - 4, w.y0 + 4],
      [w.x0 + 4, w.y1 - 4], [w.x1 - 4, w.y1 - 4]];
    const bad = [];
    for (const st of tavern.stations) {
      for (const [x, y] of spots) {
        m.x = x; m.y = y; m.moving = false; m.goal = null; m.waitUntil = Infinity;
        m.arriveAt = 0; m.path = null;
        tavern.meal = null;
        tavernGo(st.id);
        const t0 = performance.now();
        // Stepped by hand, so no frame of this can hand a phase over.
        while (m.goal && performance.now() - t0 < 4000) {
          await new Promise((r) => requestAnimationFrame(r));
          m.arriveAt = 0;
          tavUpdateActor(m, performance.now(), 16);
        }
        const d = Math.hypot(m.x - st.stand.x, m.y - st.stand.y);
        if (d > 2) bad.push(`${st.id}@${x | 0},${y | 0}=${d.toFixed(0)}px`);
      }
    }
    m.goal = null; m.waitUntil = 0;
    return { bad, tried: tavern.stations.length * spots.length };
  });
  check(corners.bad.length === 0,
    "every station is reachable from every corner of the crowded room (" +
    corners.tried + " walks" + (corners.bad.length ? ", stuck: " + corners.bad.join(" · ") : "") + ")");

  //      The bar (see tavern.js + BAR_ORDER_POOL). The one station that leads
  //      nowhere: the hero walks to the counter, orders in Italian, is served,
  //      eats, and comes away with a shield. Driven entirely by taps — the
  //      wrong word first, because not losing the order to it is the point.
  const menu = await page.evaluate(() => {
    // Every word the pool can ask for has to be something the keeper can
    // actually put on the counter, or the hero eats nothing.
    const artless = BAR_ITEMS.filter((id) => !Incanto.tavern.TAV_MEAL[id] || !TAV.meal[id]);
    state.runActive = false;                 // between runs: the meal waits in state.mealShield
    state.mealShield = 0; state.heroShield = 0;
    navTo("tavern");
    render(performance.now());
    // Put him across the room, so ordering means walking to the bar first.
    tavern.mage.x = tavern.walk.x0 + 6; tavern.mage.y = tavern.walk.y1 - 6;
    tavern.mage.moving = false; tavern.mage.goal = null; tavern.mage.waitUntil = Infinity;
    return { artless, items: BAR_ITEMS.length, maxHP: state.heroMaxHP };
  });
  check(menu.artless.length === 0,
    "every word on the bar's menu has a serving drawn for it (" + menu.items +
    " items" + (menu.artless.length ? ", missing: " + menu.artless.join(" ") : "") + ")");

  await page.click('.tav-chip[data-station="bar"]');
  const toBar = await page.evaluate(() => ({
    screen: state.screen, moving: tavern.mage.moving,
    goal: tavern.mage.goal && tavern.mage.goal.id,
    meal: !!tavern.meal,
  }));
  check(toBar.screen === "tavern" && toBar.moving && toBar.goal === "bar" && !toBar.meal,
    "tapping the bar sets him walking and opens nothing yet (goal=" + toBar.goal + ")");

  await page.waitForFunction(() => !!(tavern && tavern.meal), null, { timeout: 15000 });
  const order = await page.evaluate(() => {
    const meal = tavern.meal;
    const opts = meal.chips.map((c) => c.word);
    const inside = (r) => r.x >= 0 && r.y >= 0 &&
      r.x + (r.w || r.art.width) <= tavern.artW && r.y + (r.h || r.art.height) <= tavern.artH;
    return {
      screen: state.screen, opts, answer: meal.q.answer,
      onMenu: opts.every((w) => BAR_ITEMS.includes(w)),
      unique: new Set(opts).size === opts.length,
      want: CONFIG.meal.optionCount,
      // Everything the exchange draws is INSIDE the room — a plaque half off the
      // edge is half a tap target, and a bubble off the top is unread.
      inside: [meal.heroBubble, meal.keeperBubble, ...meal.chips].every((r) => !r || inside(r)),
      spoken: !!meal.keeperBubble && !!meal.heroBubble,
      // The station labels get out of the menu's way while it is up.
      hushed: !!document.querySelector(".tav-chips.hushed"),
      // …and no DOM panel is left: the exchange is painted in the scene.
      dom: document.querySelectorAll("#tav-stage button:not(.tav-chip)").length,
      atBar: Math.hypot(
        tavern.mage.x - tavern.stations.find((s) => s.id === "bar").stand.x,
        tavern.mage.y - tavern.stations.find((s) => s.id === "bar").stand.y) < 2,
    };
  });
  check(order.screen === "tavern" && order.atBar && order.spoken && order.dom === 0,
    "reaching the counter opens the order as speech in the scene, with no panel over it");
  check(order.opts.length === order.want && order.unique && order.onMenu &&
    order.opts.includes(order.answer),
    "the menu offers " + order.want + " distinct things to order, the right one among them (" +
    order.opts.join(" · ") + ")");
  check(order.inside && order.hushed,
    "every bubble and plaque is drawn inside the room, and the station labels stand aside");

  // Every character the bar can say has to be cut in the font, or a word comes
  // out with a hole in it (see pixel-font.js).
  const glyphs = await page.evaluate(() => {
    const text = [
      ...BAR_ORDER_POOL.flatMap((o) => [o.it, o.de]),
      ...Object.values(BAR_KEEPER).flatMap((g) => [].concat(g)).flatMap((l) => [l.it, l.de]),
      ...BAR_ITEMS, "⛨ +1234567890", "Gestärkt",
    ].join(" ");
    const missing = [...new Set(text)].filter((ch) => !Incanto.pixelFont.has(ch));
    return { missing, chars: new Set(text.toUpperCase()).size };
  });
  check(glyphs.missing.length === 0,
    "the pixel font cuts every character the bar speaks (" + glyphs.chars +
    " distinct" + (glyphs.missing.length ? ", missing: " + glyphs.missing.join(" ") : "") + ")");

  // The menu is painted onto the canvas, so it is PRESSED, not clicked: art
  // coordinates → page coordinates → a real tap. A test that called
  // barOrderPick would pass with the plaques drawn anywhere at all.
  const pressChip = async (word) => {
    const at = await page.evaluate((w) => {
      const c = tavern.meal.chips.find((k) => k.word === w);
      const r = tavern.cv.getBoundingClientRect();
      const s = r.width / tavern.artW;
      return { x: r.left + (c.x + c.w / 2) * s, y: r.top + (c.y + c.h / 2) * s };
    }, word);
    await page.mouse.click(at.x, at.y);
  };

  // A wrong word: the keeper doesn't understand, that word is struck through,
  // and the order is still standing. Nothing is lost and nothing is earned.
  const wrongWord = order.opts.find((w) => w !== order.answer);
  await pressChip(wrongWord);
  await page.waitForTimeout(120);
  const shrug = await page.evaluate((w) => ({
    open: !!tavern.meal,
    struck: tavern.meal.wrong.length === 1 && tavern.meal.wrong[0] === w,
    puzzled: !!tavern.meal.puzzled,
    stage: tavern.meal.stage,
    shield: state.mealShield + state.heroShield,
    chips: tavern.meal.chips.length,
  }), wrongWord);
  check(shrug.open && shrug.struck && shrug.puzzled && shrug.stage === "order" &&
    shrug.chips === order.want && shrug.shield === 0,
    "a wrong word is struck off the menu and the order stands (stage=" + shrug.stage +
    ", shield=" + shrug.shield + ")");

  // A press on the speech itself is a press on something being read — it must
  // not send him walking off mid-order.
  const onBubble = await page.evaluate(async () => {
    const b = tavern.meal.heroBubble;
    const r = tavern.cv.getBoundingClientRect();
    const s = r.width / tavern.artW;
    return { x: r.left + (b.x + b.art.width / 2) * s, y: r.top + (b.y + b.art.height / 2) * s };
  });
  await page.mouse.click(onBubble.x, onBubble.y);
  await page.waitForTimeout(80);
  const stayed = await page.evaluate(() => ({ open: !!tavern.meal, moving: tavern.mage.moving }));
  check(stayed.open && !stayed.moving,
    "a press on the bubble is swallowed rather than walking him out of the order");

  // The right one: he is served, he eats it, and the meal is worth a tenth of
  // his pool. The exchange closes itself — no tap needed to get back to the room.
  await pressChip(order.answer);
  const served = await page.evaluate(async () => {
    const settle = (ms) => new Promise((r) => setTimeout(r, ms));
    const stages = new Set();
    let drawn = false, spoke = false;
    for (let i = 0; i < 160 && tavern.meal; i++) {
      stages.add(tavern.meal.stage);
      if (tavern.meal.item && tavern.meal.stage !== "reply") drawn = true;
      if (tavern.meal.stage === "reply" && tavern.meal.keeperBubble) spoke = true;
      await settle(50);
    }
    return {
      stages: [...stages], drawn, spoke,
      item: state.mealShield, screen: state.screen,
      hushed: !!document.querySelector(".tav-chips.hushed"),
      want: Math.round(state.heroMaxHP * CONFIG.meal.shieldFraction),
    };
  });
  check(served.stages.includes("serve") && served.stages.includes("eat") &&
    served.stages.includes("cheer") && served.drawn && served.spoke,
    "the keeper answers, and the order is poured, carried, eaten and cheered (" +
    served.stages.join(" → ") + ")");
  check(!served.hushed && served.screen === "tavern" && served.item === served.want,
    "…and he walks away with ⛨ " + served.item + " of " + menu.maxHP + " LP (wanted " +
    served.want + "), the room's labels back");

  // The shield is banked, not spent: it survives the walk to the door, which is
  // the whole point of eating BEFORE a run rather than during one.
  const carried = await page.evaluate(() => {
    const before = state.mealShield;
    const second = Incanto.tavern.grantMealShield();      // a second helping on a full stomach
    const stacked = state.mealShield;
    startRun();
    const after = { shield: state.heroShield, meal: state.mealShield };
    state.runActive = false; state.screen = "tavern";
    return { before, second, stacked, after };
  });
  check(carried.stacked === carried.before,
    "a second helping tops the shield up rather than stacking it (" + carried.stacked + ")");
  check(carried.after.shield === carried.before && carried.after.meal === 0,
    "starting a run pours the meal into the shield pool instead of clearing it (⛨ " +
    carried.after.shield + ", " + carried.after.meal + " left on the plate)");

  // 12. The dev tools on the tree screen (see skilltree.js). They are armed by a
  //     slider and must be unreachable while it is off; armed, they wipe every
  //     purchased rank (asking once first) and let the purse be typed into.
  await page.evaluate(() => {
    state.devMode = false;
    state.gold = 500;
    // Two nodes rather than two ranks of one, so the check doesn't depend on
    // how deep a particular archetype happens to rank.
    state.nodeRanks = {}; Incanto.skilltree.treeBuy("migp0"); Incanto.skilltree.treeBuy("vigp0");
    state.screen = "upgrade"; state.tree = null;
    state._structuralDirty = true;
    render(performance.now());
  });
  const devOff = await page.evaluate(() => ({
    bar: document.querySelectorAll(".dev-bar").length,
    purse: document.querySelectorAll(".tree-gold.dev").length,
    slider: document.querySelectorAll(".dev-switch").length,
  }));
  check(devOff.slider === 1 && devOff.bar === 0 && devOff.purse === 0,
    "the dev slider is the only dev thing on the tree until it is switched on");

  await page.click(".dev-switch");
  await page.waitForTimeout(120);
  check(await page.evaluate(() => state.devMode === true && !!document.querySelector(".dev-bar")),
    "the slider arms the tools and opens the dev row");

  // Typing a gold amount: tap the purse, fill the field, tap ✓ (no Enter — see CLAUDE.md).
  await page.click(".tree-gold.dev");
  await page.fill(".dev-gold-input", "4321");
  await page.click(".dev-gold-ok");
  await page.waitForTimeout(120);
  const purse = await page.evaluate(() => ({
    gold: state.gold,
    shown: document.querySelector("#tree-gold-slot").textContent.trim(),
    saved: JSON.parse(localStorage.getItem("incanto.save.v1")).gold,
  }));
  check(purse.gold === 4321 && /4321/.test(purse.shown) && purse.saved === 4321,
    "tapping the purse sets the gold and persists it (" + purse.shown + ")");
  await page.click(".tree-gold.dev");
  await page.fill(".dev-gold-input", "-40");
  await page.click(".dev-gold-ok");
  await page.waitForTimeout(120);
  check(await page.evaluate(() => state.gold === 0), "a negative amount clamps to nothing");

  // Wiping the tree: the first tap only arms the button.
  await page.click(".dev-btn");
  await page.waitForTimeout(120);
  check(await page.evaluate(() => state.nodeRanks.migp0 > 0 && state.nodeRanks.vigp0 > 0
      && /Wirklich/.test(document.querySelector(".dev-btn").textContent)),
    "the first tap on the wipe asks instead of wiping");
  await page.click(".dev-btn");
  await page.waitForTimeout(120);
  const wiped = await page.evaluate(() => ({
    ranks: Object.keys(state.nodeRanks).length,
    baseDmg: state.heroDmg === CONFIG.heroBaseDmg,
    spell: state.activeSpell,
    saved: Object.keys(JSON.parse(localStorage.getItem("incanto.save.v1")).nodeRanks).length,
  }));
  check(wiped.ranks === 0 && wiped.saved === 0 && wiped.baseDmg && wiped.spell === "fireball",
    "the second tap wipes every rank, re-derives the build and reseals the book");

  await page.click(".dev-switch");
  await page.waitForTimeout(120);
  check(await page.evaluate(() => state.devMode === false && !document.querySelector(".dev-bar")),
    "switching the slider back off puts the tools away");

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
