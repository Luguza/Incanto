# CLAUDE.md — Incanto

Incanto is a vanilla-JS browser game with **no build step**. `index.html` is a
thin shell that links `styles/*.css` and loads `src/*.js` as ordered classic
`<script>` tags (they share one global scope — same as the old single file, just
split so parallel work doesn't collide). Preview by opening `index.html` in a
browser, or serve the folder over HTTP. Every gameplay number is in the `CONFIG`
object (`src/config.js`); the combat scene renders to a `<canvas class="scene">`.

## Incanto is a phone game — never add keyboard controls

It is played on a cellphone, with a thumb. **Never add a keyboard interaction:
no shortcuts, no hotkeys, no "press Enter to continue", no arrow-key navigation,
no `keydown`/`keyup`/`keypress` listener, no `accesskey`, no focus-ring styling
for keyboard users.** This is not a preference to weigh against convenience — it
is a standing rule, and it holds even when a keyboard path looks like a free
accessibility win.

The one and only exception, already in place, is the phone keyboard's own Go/
Enter key submitting a typed answer field (`[data-enter]` in `src/main.js`).
That is the on-screen keyboard's submit button, not a shortcut. Do not extend
it, and do not add a second one.

Why it is written this way: a "press Enter to advance" shortcut was added once
and immediately broke the quiz. The keystroke that submitted a typed answer kept
bubbling and also consumed the feedback, so a wrong answer jumped straight to the
next word without ever showing the learner its solution. Every action must reach
the player as something to tap.

**Test the way it is played.** Drive headless runs with `page.click` / `page.fill`,
never `page.keyboard.press`. `tools/smoke-test.mjs` asserts that a stray key
changes nothing.

## Module map — where things live

Load order is set by the `<script>` list in `index.html` (data → logic → render
→ screens → loop → bootstrap). **Add any new `src/*.js` file to that list.**

| File | Owns |
|------|------|
| `src/core.js` | `window.Incanto` root namespace (loads first) |
| `src/config.js` | `CONFIG` — all gameplay numbers, flags, colours, **the bestiary** (`enemyTypes`, where a variant's sprite, colour filter, size, stats and ROLE — melee / ranged / summoner / healer — are defined), and the two numbers the whole balance hangs off: **`treeGold`** (what the entire tree costs, end to end — every node's price is a share of it, by depth and by how many of its ranks you already own) and **`treeTotals`** (how much of each stat the whole tree contains). They are set against each other so an endgame build walks ~90 % of the nodes and actually reaches the totals. No runtime caps, soft caps or diminishing returns exist anywhere; a stat's total is its ceiling because it bounds the supply, and every node pays exactly what it prints. Damage is built in three stages (Kern → Verstärkung → Zuschlag) |
| `src/content.js` | vocab, sentences + verb paradigms: `WORD_POOL`, `SENTENCE_POOL` (~350 sentences — three questions of every quiz come out of it, so it has to be deep; house rules for a new one are written above the pool and enforced by `node tools/check-sentences.mjs`, which also fails on a word the game never teaches), `CONJ_POOL` (present tense, regular forms generated from `CONJ_ENDINGS`, irregulars written out), `CONJ_PERSONS`, … |
| `src/encounters.js` | **where the hall is designed**: `SHAPES` (bare formations), `PACKS` (a shape filled with variants), `CHAPTERS` (15 of them, each introducing one new body alone before using it in force), the derived `ENCOUNTER_PLAN` (160 camps on a fixed 2.5 m cadence) and `HALL_END_METRES` — the corridor is FINITE and ends at a door. Deterministic — no randomness. `previewPlan()` / `previewBestiary()` dump it to the console |
| `src/vocab-history.js` | the learning record: per-word tallies (seen / correct / wrong, split quiz vs. rune circle) in `state.vocab` + its own save key, the per-day buckets behind "struggled with lately", the `struggleDrawPool` weighting `drawLoadout` deals review words from, and `renderHistoryFull` (the Lernverlauf screen) |
| `src/state.js` | `state`, `freshState`, save/load/clear (persistence), and the **reward bank**: `creditKill` / `rewardMult` — kills charge a gold multiplier that banks across runs (persisted) and is only spent by finishing a whole quiz |
| `src/progression.js` | pack spawning (`spawnPack`, incl. `orderRanksByReach` — casters are sorted to the back of their lane so they never wall in their own escort), frame-edge geometry, run start + `clearHall` (walking out of the far door), circle layout |
| `src/skilltree.js` | the upgrade phase: an **authored** PoE-style rune tree (~1050 nodes) plus purchase/reveal logic, the derived stat model (`recomputeMods`) and the pan/zoom SVG screen (`renderUpgradeFull`). **Where you add or move nodes:** the `ARMS` table. **Where the balance lives:** `CONFIG.treeTotals` — one tunable number per stat saying how much of it the WHOLE tree contains. Nodes are authored as relative weights; `applyTreeTotals` divides each total across them while the tree is built, so a node's printed value is derived from the total rather than guessed at. That total is the only ceiling: it bounds what exists rather than clipping what you carry, so nothing is bent at runtime and the additive pools slow down on their own. Those totals are cut ~3.000 ranks deep, so the smallest slices are tiny by design and **every rounding in `applyTreeTotals` has a floor** (+1 for a whole stat, 0,1/s for a rate, 0,001 for a fraction) — nothing in the tree is ever nothing. The tooltip meets them there: `treeNum` prints one decimal, German comma, so a real +0,2 % reads as "+0,2 %" instead of rounding away to "+0 %". Tune with `node tools/stat-supply.mjs`, which prints target vs. achieved total, flags a whole-number total that has fallen below one-per-rank, shows what a build carries at 1–90 % of `treeGold` alongside how much of the tree that buys, and — in its second table — spells out exactly what the tooltip says for one rank of the typical node granting each stat. The smoke test fails if any node in the tree prints a figure of zero. A node's `blurb` is optional and most archetypes have none: it is for what the effect line can't say (which damage stage a node feeds, what a fraction is a fraction of), never a restatement of the stat's own name. Prices come from `applyTreeGold` the same way stats come from `applyTreeTotals`: authored weights, one total, normalised at build time. The damage archetypes come in three kinds matching the three stages — `dmgBaseFlat`/`dmgBasePct` feed the Kern, `dmgPct` multiplies, `dmgFlat` ("Schneide") lands last of all inside `spellPower`. Twelve arms leave the seed, alternating spell / generic; each runs `prelude` (rings 1–4, cheap generic nodes) → its **key** at ring 5 (a spell's unlock node, or a generic arm's notable — always visible via `beacon`) → `branches` (five aspect branches on a spell arm, three on a generic one) that fork in two around ring 13 and end in unique keystones out near ring 19, with dead-end offshoots hanging off them. Branch content is written as a short list of `A.*` archetypes it cycles outward. Rings are bookkeeping (cost + value); positions come from `radialSlices` + `relaxTree` (angular slices by subtree size, then springs/repulsion for even spacing), so don't read geometry off the ring. Also the **dev tools**: a slider in the tree topbar (`state.devMode`, persisted) arms a tree wipe and a tappable purse (`devToggle` / `devResetTree` / `devEditGold`) — every handler bails while it is off |
| `src/spells.js` | **the spell book's rules**: `SPELLS` (registry, in its authored order), unlock/selection, `spellPower`, and the per-spell resolvers a cast dispatches into. Where each spell actually SITS is the player's (`state.spellOrder`, a permutation of the ids) — anything drawing or leafing through the book reads `bookSpells()` / `bookSlot()`, never `SPELLS` directly |
| `src/render-assets.js` | sprite sheet + baked canvas assets (`ASSETS`, `buildAssets`), and `ENEMY_SPRITES` — the frame rects for all 17 creatures on the sheet. Each variant's idle/run/hit/rime frames are baked ONCE here, colour filter included; nothing recolours on the draw path |
| `src/render-scene.js` | the combat canvas scene (`scene`, `renderScene`, staff/rune draw) |
| `src/render-spells.js` | what a cast looks like: draws the effect descriptors `state.spellFx` queued by a resolver (blasts, arcs, meteors, cones, auras) |
| `src/rune-circle.js` | rune-circle population + procedural SVG glyphs |
| `src/spellbook.js` | the open book along the bottom of combat: page geometry (the V the circle nests in), the page's own `(u,v)` frame everything written rides on, the runic body script, `SPELL_ART` (the animated page effects, staged in 3D on the page — CSS keyframes live in `combat.css`), flipping. A book is assembled from parts (`bookDefs` once per SVG + `bookMarkup` per volume) so it can be drawn more than once |
| `src/book-order.js` | the order screen: the whole book as three open volumes in ONE SVG, where a page is dragged onto another to trade places (`swapBookPages`). Reached from the **Buch** button on the upgrade screen |
| `src/stats.js` | the ledger screen ("Werte"): what the build currently ADDS UP TO, in three tabs (Held · Zauber · Baum). Reached from the **Werte** button on the upgrade screen. Every figure is re-derived from `state.mods` the way combat derives it — the spell rows re-run each resolver's own arithmetic (radius, hops, freeze, count), so a change in `spells.js` must be mirrored here or the screen starts lying. Each row draws its meter against what the whole tree HOLDS of that stat (`TREE_SUPPLY`), since there are no ceilings left to measure against |
| `src/combat.js` | rune matching + cast dispatch (`handleRuneClick`, `hitEnemy`) |
| `src/quiz.js` | vocab-quiz logic + exercise handlers (`quizChoose`, `buildQuiz`, …); `quizReward` applies the banked multiplier plus the question's own stake, `advanceQuiz` cashes the multiplier in on the last question. Also the **conjugation ladder**: `makeConj` deals a rung of `CONFIG.conjugation.levels` (zuordnen: one verb's paradigm → zuordnen: forms from several verbs → pick a form → write a form → half a table → the whole paradigm), `noteConjResult` moves `state.conjLevel` up or down on the top rung |
| `src/screens.js` | full-screen DOM renderers (innerHTML into `#app`) |
| `src/nav.js` | bottom phase-switcher nav (`navTo`, pixel-art icons) — renders into `<nav id="bottom-nav">` |
| `src/input.js` | pointer/drag handling for the rune circle |
| `src/loop.js` | rAF loop + screen router (`rafLoop`, `render`, `app`) |
| `src/main.js` | event wiring + delegated UI dispatch + bootstrap (loads last) |

CSS is split by screen: `styles/{base,combat,quiz,meta}.css`. CSS `url(...)` is
relative to the CSS file, so asset paths there use `../assets/...`.

### Conventions for encapsulation

- **Shared singletons stay global.** `state`, `CONFIG`, `ASSETS`, `scene`,
  `builtScreen`, etc. are deliberate top-level globals visible across files (the
  classic-script global scope). Don't wrap them or rename references.
- **New cross-file helpers go on a namespace**, e.g. `Incanto.quiz.foo = …`,
  not a new bare global — two files adding the same global name collide at
  runtime.
- **No inline `on*` handlers.** UI templates use `data-act="fnName"` (+ optional
  `data-args` as a JSON array); one delegated listener on `#app` in `main.js`
  routes clicks/input/Enter to the global function. Add `data-act` to new
  buttons rather than `onclick`.

## Live-preview workflow — DO THIS AFTER EVERY CHANGE

GitHub Pages serves this repo from the **`gh-pages`** branch (Settings → Pages →
"Deploy from a branch" → `gh-pages` / root). `gh-pages` is a **movable pointer**:
to preview your work on the live site, force-update it to your current branch.

After you commit and push a set of changes, run:

```bash
./tools/deploy-preview.sh          # publishes the CURRENT branch to gh-pages
```

The live site (https://luguza.github.io/Incanto/) updates ~1 minute later. This
is expected and safe — each Claude Code session works on its own branch, so
point `gh-pages` at yours whenever you want it reviewable live.

**Caveats**
- There is only one public Pages site, so whatever branch was deployed last is
  what's public. Only one branch previews at a time (sessions will clobber each
  other's preview — that's fine, just be aware).
- After a PR merges to `main`, repoint Pages at production so the public site
  tracks `main` again: `./tools/deploy-preview.sh main`.

## Verifying changes

Run the committed smoke test — it serves the repo over HTTP (mirroring GitHub
Pages), boots the game in headless Chromium, checks for `pageerror`/console
errors, confirms the scene renders, and exercises the delegated UI dispatch:

```bash
node tools/smoke-test.mjs        # exits non-zero on any failure
```

When you touch `SENTENCE_POOL`, also run the sentence audit — it is the one
place hand-written Italian lives, so a typo or a word outside `WORD_POOL` has
nothing else to catch it:

```bash
node tools/check-sentences.mjs   # structure, blanks, vocabulary coverage
```

For scene/visual changes, don't rely on code-reading alone. Drive the game
headlessly with the pre-installed Chromium (Playwright, `executablePath` under
`/opt/pw-browsers/`) and screenshot `canvas.scene`. Note: canvas asset building
uses `getImageData`, which taints under `file://` — **serve over HTTP** when
driving headlessly (the smoke test already does).
