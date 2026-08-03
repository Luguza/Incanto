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

  // 6. Learning history (see vocab-history.js): quiz answers and rune pairings
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

  // 7. A wrong answer must STOP on the question and show the solution — that
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

  // 8. The reward bank. Kills charge a gold multiplier that must survive dying
  //    and starting over — it is spent only by finishing a whole quiz, so a run
  //    cut short is never wasted fighting.
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
