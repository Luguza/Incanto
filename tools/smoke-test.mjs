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

  //     A stat sitting on its ceiling must SAY so — further nodes of that kind
  //     are wasted gold, and that is the question a stat screen answers.
  const flagged = await page.evaluate(() => {
    state.mods.critChance = CONFIG.caps.critChance;
    state._structuralDirty = true; render(performance.now());
    const row = [...document.querySelectorAll(".sv-row")]
      .find((r) => r.querySelector(".sv-label").textContent.trim() === "Krit-Chance");
    return { flag: !!row.querySelector(".sv-flag"), bar: !!row.querySelector(".sv-bar.full") };
  });
  check(flagged.flag && flagged.bar, "a capped stat is flagged as at its Grenze, meter and all");

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
