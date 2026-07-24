# CLAUDE.md — Incanto

Incanto is a vanilla-JS browser game with **no build step**. `index.html` is a
thin shell that links `styles/*.css` and loads `src/*.js` as ordered classic
`<script>` tags (they share one global scope — same as the old single file, just
split so parallel work doesn't collide). Preview by opening `index.html` in a
browser, or serve the folder over HTTP. Every gameplay number is in the `CONFIG`
object (`src/config.js`); the combat scene renders to a `<canvas class="scene">`.

## Module map — where things live

Load order is set by the `<script>` list in `index.html` (data → logic → render
→ screens → loop → bootstrap). **Add any new `src/*.js` file to that list.**

| File | Owns |
|------|------|
| `src/core.js` | `window.Incanto` root namespace (loads first) |
| `src/config.js` | `CONFIG` — all gameplay numbers, flags, colours |
| `src/content.js` | vocab + sentences: `WORD_POOL`, `SENTENCE_POOL`, … |
| `src/state.js` | `state`, `freshState`, save/load/clear (persistence) |
| `src/progression.js` | enemy scaling, upgrade costs, wave/run start, `buyDmg/buyHp` |
| `src/render-assets.js` | sprite sheet + baked canvas assets (`ASSETS`, `buildAssets`) |
| `src/render-scene.js` | the combat canvas scene (`scene`, `renderScene`, staff/rune draw) |
| `src/rune-circle.js` | rune-circle population + procedural SVG glyphs |
| `src/combat.js` | rune matching + spell resolution (`handleRuneClick`, `hitEnemy`) |
| `src/quiz.js` | vocab-quiz logic + exercise handlers (`quizChoose`, `buildQuiz`, …) |
| `src/screens.js` | full-screen DOM renderers (innerHTML into `#app`) |
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
