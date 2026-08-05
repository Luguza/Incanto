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
| `src/config.js` | `CONFIG` — all gameplay numbers, flags, colours |
| `src/content.js` | vocab, sentences + verb paradigms: `WORD_POOL`, `SENTENCE_POOL`, `CONJ_POOL` (present tense, regular forms generated from `CONJ_ENDINGS`, irregulars written out), `CONJ_PERSONS`, … |
| `src/encounters.js` | **where enemy packs are designed**: `PACKS` (formations), `ENCOUNTER_PLAN` (which pack at which metre mark), `LATE_CYCLE` (endless tail). Deterministic — no randomness |
| `src/vocab-history.js` | the learning record: per-word tallies (seen / correct / wrong, split quiz vs. rune circle) in `state.vocab` + its own save key, the per-day buckets behind "struggled with lately", the `struggleDrawPool` weighting `drawLoadout` deals review words from, and `renderHistoryFull` (the Lernverlauf screen) |
| `src/state.js` | `state`, `freshState`, save/load/clear (persistence), and the **reward bank**: `creditKill` / `rewardMult` — kills charge a gold multiplier that banks across runs (persisted) and is only spent by finishing a whole quiz |
| `src/progression.js` | pack spawning (`spawnPack`), frame-edge geometry, run start, circle layout |
| `src/skilltree.js` | the upgrade phase: an **authored** PoE-style rune tree (~1050 nodes) plus purchase/reveal logic, the derived stat model (`recomputeMods`) and the pan/zoom SVG screen (`renderUpgradeFull`). **Where you add or move nodes:** the `ARMS` table. Twelve arms leave the seed, alternating spell / generic; each runs `prelude` (rings 1–4, cheap generic nodes) → its **key** at ring 5 (a spell's unlock node, or a generic arm's notable — always visible via `beacon`) → `branches` (five aspect branches on a spell arm, three on a generic one) that fork in two around ring 13 and end in unique keystones out near ring 19, with dead-end offshoots hanging off them. Branch content is written as a short list of `A.*` archetypes it cycles outward. Rings are bookkeeping (cost + value); positions come from `radialSlices` + `relaxTree` (angular slices by subtree size, then springs/repulsion for even spacing), so don't read geometry off the ring |
| `src/spells.js` | **the spell book's rules**: `SPELLS` (registry, in its authored order), unlock/selection, `spellPower`, and the per-spell resolvers a cast dispatches into. Where each spell actually SITS is the player's (`state.spellOrder`, a permutation of the ids) — anything drawing or leafing through the book reads `bookSpells()` / `bookSlot()`, never `SPELLS` directly |
| `src/render-assets.js` | sprite sheet + baked canvas assets (`ASSETS`, `buildAssets`) |
| `src/render-scene.js` | the combat canvas scene (`scene`, `renderScene`, staff/rune draw) |
| `src/render-spells.js` | what a cast looks like: draws the effect descriptors `state.spellFx` queued by a resolver (blasts, arcs, meteors, cones, auras) |
| `src/rune-circle.js` | rune-circle population + procedural SVG glyphs |
| `src/spellbook.js` | the open book along the bottom of combat: page geometry (the V the circle nests in), the page's own `(u,v)` frame everything written rides on, the runic body script, `SPELL_ART` (the animated page effects, staged in 3D on the page — CSS keyframes live in `combat.css`), flipping. A book is assembled from parts (`bookDefs` once per SVG + `bookMarkup` per volume) so it can be drawn more than once |
| `src/book-order.js` | the order screen: the whole book as three open volumes in ONE SVG, where a page is dragged onto another to trade places (`swapBookPages`). Reached from the **Buch** button on the upgrade screen |
| `src/combat.js` | rune matching + cast dispatch (`handleRuneClick`, `hitEnemy`) |
| `src/quiz.js` | vocab-quiz logic + exercise handlers (`quizChoose`, `buildQuiz`, …); `quizReward` applies the banked multiplier plus the question's own stake, `advanceQuiz` cashes the multiplier in on the last question. Also the **conjugation ladder**: `makeConj` deals a rung of `CONFIG.conjugation.levels` (pick a form → write a form → half a table → the whole paradigm), `noteConjResult` moves `state.conjLevel` up or down on the top rung |
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

For scene/visual changes, don't rely on code-reading alone. Drive the game
headlessly with the pre-installed Chromium (Playwright, `executablePath` under
`/opt/pw-browsers/`) and screenshot `canvas.scene`. Note: canvas asset building
uses `getImageData`, which taints under `file://` — **serve over HTTP** when
driving headlessly (the smoke test already does).
