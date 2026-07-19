# CLAUDE.md — Incanto

Incanto is a single-file vanilla-JS browser game: everything lives in
`index.html` with **no build step**. Preview by opening `index.html` in a
browser. Every gameplay number is in the `CONFIG` object near the top of the
script; the combat scene renders to a `<canvas class="scene">`.

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

## Verifying scene/visual changes

Don't rely on code-reading alone for canvas rendering. Drive the game headlessly
with the pre-installed Chromium (Playwright, `executablePath` under
`/opt/pw-browsers/`), call `startRun()` to enter combat, then screenshot
`canvas.scene`. Confirm no `pageerror`/console errors.
