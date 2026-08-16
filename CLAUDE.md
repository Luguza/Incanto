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

## The phone's own dark mode must never get hold of the page

The game is painted in near-black, and a phone browser's "dark mode for web
contents" (Samsung Internet's dark mode, Chrome's Auto Dark Theme) inverts
exactly that: its filter reads every SVG fill and stroke as foreground and flips
the dark ones light. The rune tree comes back as a field of white discs, the
sealed page in the book turns to grey paper, its wax seal goes pink — while the
canvas scenes, which it can't touch, still look right. That combination is the
signature: **combat looks nearly fine and the forge looks broken.**

The page therefore declares its darkness three times — `color-scheme: dark` on
`:root`, `<meta name="color-scheme" content="dark">` in `index.html`, and a
`@media (prefers-color-scheme: dark)` block — because different engines key off
different ones. The media block restates what `:root` already sets **on
purpose**; answering the query is the signal, not changing a colour. The
reasoning is written out above that block in `styles/base.css`; don't tidy any
of the three away.

**But do not trust them.** They were tried against the phone that reported this
and the page was repainted anyway: the dark modes that do this ignore every
declarative opt-out there is. So the declarations are politeness for the
browsers that listen, not a defence.

There are exactly **two** surfaces the filter cannot reach, and everything the
game paints dark has to use one of them.

**1. `<canvas>`** — for anything large, or anything needing a gradient. That is
why combat always looked right on the phone that broke the forge, and why **the
rune tree is drawn on a canvas** (see the essay above `drawTree` in
`src/skilltree.js`). Don't move it back.

A canvas brings its own trap, and the tree hit it: **a memoised viewport size
outlives the element it measured.** `TREE_VP` is module state, the `<canvas>` is
rebuilt with the screen, and a fresh canvas starts at the default 300×150 — so
on the second visit to the forge the remembered box matched, `syncTreeViewport`
reported "unchanged", and the whole web came back stretched across a bitmap a
fifth of the size it needed. Any such guard has to check the **backing store**
(`cv.width`/`cv.height`) as well as the box, never the box alone.

**2. An `feFlood` filter** — for an SVG shape that has to stay SVG, which is the
whole spell book and the rune circle. `src/dark-paint.js` owns it: `flood()` for
a flat colour, `ramp()` for one running across a shape, `dropShadow()` for a
shadow. A flood's colour is one of the *filter's own* constants rather than a
paint the shape carries, so the dark-mode pass never classifies it; compositing
it back in with `feComposite operator="in"` keeps the shape's outline and
antialiasing. **It applies to light paint as much as dark** — the book's
parchment is flooded too, because the filter darkens a light surface just as
readily as it lightens a dark one.

Four rules come with it, each learned by getting it wrong:

- Give the shape an **opaque** paint and put transparency on the element as
  `opacity`. `in` multiplies the flood by the source's alpha, so an `rgba()`
  fill applies its alpha twice and washes out.
- The shape needs an **area**. A filter region is a percentage of the geometric
  bounding box, so a straight line's region collapses and clips its stroke away
  (which is why `.bk-spine` is left alone).
- A `ramp()` belongs on a **rectangle**, clipped to the shape you want. Its
  gradient is made by smearing the silhouette sideways, so a shape that narrows
  — a page seen in perspective — lands the ramp somewhere different on each row
  and paints a band across it. That is why the paper is a clipped `.bk-paper`
  rect rather than the leaf itself.
- **One flood carries one colour.** A shape that is filled *and* stroked has to
  become two elements, one per colour, and if it was faded as a whole then the
  two go in a group carrying the `opacity` — fading them separately composites
  the outline over the fill instead of over the page. Where splitting would
  change how the shape renders, don't: the page title's letters and outline are
  painted together by `paint-order`, splitting them made the title visibly
  lighter for everyone, so it is left unprotected on purpose.
- **If the shape was a tap target, hand the target back.** Splitting a
  filled-and-stroked shape leaves the stroked half with `fill: none`, and an
  unpainted fill is not hit-tested — so the split silently shrinks the target to
  the width of the outline. It reached the player once: the rune circle's ring
  kept its `cursor: pointer` and its `data-` wiring and went completely dead to
  a thumb, because the only pixels left that could take a press were 1,5 px of
  edge. The ring carries `pointer-events: all` for exactly that reason (see
  `.rune .body` in `styles/combat.css`); don't tidy it away. Tests that call
  `handleRuneClick` will not catch this — the smoke test presses the pixels.

What is at risk is worth knowing precisely, because it decides whether a new
shape needs any of this. Measured against a forced browser dark mode: an SVG
**fill** is repainted always. A **stroke** survives the mild variant but not the
aggressive one — and the phone that reported this is the aggressive one, since
its screenshot came back with the tree's edge strokes turned light. So treat
both as vulnerable.

Everything else was measured and does *not* survive: a plain SVG fill, an SVG
gradient paint server, a pattern of a PNG, a CSS background,
`forced-color-adjust: none`, `mix-blend-mode`, and — worth knowing — **attaching
a filter shields nothing by itself**. A paint colour is already inverted by the
time an SVG filter sees it, so an identity filter, on the shape or on a parent
group, changes nothing. Only a flood wins.

**Known remaining gap:** the mini runes in the DOM panels (the info panel, the
Werte screen) are still ordinary SVG, as are the spell effects animating on an
open page. They are small and coloured rather than near-black, and they are the
accepted cost.

The smoke test checks all three declarations are present, then drives a second
session with a browser dark mode forced on — **stripping the page's opt-out
first**, since Chromium honours it and the phones this is written for do not,
and an unstripped run passes while testing nothing. A canary shape proves the
darkening really engaged; then the tree, the parchment, the hand written on it,
the boards, the sealed page, the wax seal and the rune wells are each measured
against the same part drawn normally. Ink and parchment are read as the darkest
and lightest pixels of the written block rather than as its average — averaging
hides a hand that has inverted under the page it is written on.

## Module map — where things live

Load order is set by the `<script>` list in `index.html` (data → logic → render
→ screens → loop → bootstrap). **Add any new `src/*.js` file to that list.**

| File | Owns |
|------|------|
| `src/core.js` | `window.Incanto` root namespace (loads first) |
| `src/dark-paint.js` | **painting a colour a phone's dark mode cannot repaint**: `flood()` (flat), `ramp()` (a colour running across a shape), `dropShadow()`. All build `feFlood`-based filters into one document-level `<defs>`, since a flood's colour is a filter constant and never gets classified. A stylesheet can't call `flood()`, so the colours the stylesheets use are registered in `CSS_FLOODS` and referenced as `url(#fl-<hex>)` — the same hex twice, so the two can't drift. Loads early, before anything draws |
| `src/pixel-font.js` | **`Incanto.pixelFont`** — a bitmap font for text drawn INSIDE a canvas scene, which is the tavern's speech bubbles and nothing else so far. The DOM handles every other word in the game and should; this is for words that belong to the ROOM rather than to the interface, where a crisp browser panel over a pixel picture reads as an interface interrupting it. ALL CAPS on purpose — at five pixels of cap height a mixed-case font's `a` and `o` are the same blob, and `draw` uppercases what it is given. A glyph is rows of `#`/`.` and is as wide as it needs to be (`I` is one pixel, `M` is five); rows above five carry an accent and are drawn higher, since the baseline is the bottom row either way. Loads early, before anything draws |
| `src/config.js` | `CONFIG` — all gameplay numbers, flags, colours, **the bestiary** (`enemyTypes`, where a variant's sprite, colour filter, size, stats, CADENCE (`attackMs` — what one blow costs is `dmgMult`, how often it lands is `attackMs`, and only the two together say what a body is worth) and ROLE — melee / ranged / summoner / healer — are defined, plus `slimeTiers`, the HP→size ladder the one SPLITTING family walks down), and the two numbers the whole balance hangs off: **`treeGold`** (what the entire tree costs, end to end — every node's price is a share of it, by depth and by how many of its ranks you already own) and **`treeTotals`** (how much of each stat the whole tree contains). They are set against each other so an endgame build walks ~90 % of the nodes and actually reaches the totals. No runtime caps, soft caps or diminishing returns exist anywhere; a stat's total is its ceiling because it bounds the supply, and every node pays exactly what it prints. Damage is built in three stages (Kern → Verstärkung → Zuschlag) |
| `src/content.js` | vocab, sentences + verb paradigms: `WORD_POOL`, `SENTENCE_POOL` (~350 sentences — three questions of every quiz come out of it, so it has to be deep; house rules for a new one are written above the pool and enforced by `node tools/check-sentences.mjs`, which also fails on a word the game never teaches), `CONJ_POOL` (present tense, regular forms generated from `CONJ_ENDINGS`, irregulars written out), `CONJ_PERSONS`, `BAR_ORDER_POOL` + `BAR_ITEMS` + `BAR_KEEPER` (what is said at the tavern's counter — same house rules, one extra: a blank has to be something on `BAR_ITEMS`, since whatever fills the gap is what gets served and needs art in `TAV_MEAL`), … |
| `src/encounters.js` | **where the hall is designed**: `SHAPES` (bare formations), `PACKS` (a shape filled with variants), `CHAPTERS` (16 of them — a 2-camp slime prologue that is not a fight, then 15 that each introduce one new body alone before using it in force), the derived `ENCOUNTER_PLAN` (82 camps on a fixed 2.5 m cadence) and `HALL_END_METRES` — the corridor is FINITE and ends at a door. Deterministic — no randomness. Every chapter is the SHORTEST version of its own argument: it was cut to half its waves, so what is left is one camp per idea and no reinforced re-runs — putting a wave back means naming a pack again in `CHAPTERS`, since the packs that fell out of the plan are kept in `PACKS` rather than deleted. `previewPlan()` / `previewBestiary()` dump it to the console |
| `src/vocab-history.js` | the learning record: per-word tallies (seen / correct / wrong, split quiz vs. rune circle) in `state.vocab` + its own save key, the per-day buckets behind "struggled with lately", the `struggleDrawPool` weighting `drawLoadout` deals review words from, and `renderHistoryFull` (the Lernverlauf screen) |
| `src/state.js` | `state`, `freshState`, save/load/clear (persistence), and the **reward bank**: `creditKill` / `rewardMult` — kills charge a gold multiplier that banks across runs (persisted) and is only spent by finishing a whole quiz |
| `src/progression.js` | pack spawning (`spawnPack`, incl. `orderRanksByReach` — casters are sorted to the back of their lane so they never wall in their own escort), **body sizing** (`sizeBody` fixes a body's drawn size, damage and displayed name from the rung its maxHP puts it on; for everything but a slime that is decided once at spawn) and **splitting** (`canSplit` / `splitSlime` — a slime that is hit becomes TWO of the size below it, each on a full bar of that size's HP, with none of the damage carrying over. **A slime above the bottom rung cannot be killed**: `hitEnemy` holds a would-be fatal blow at 1 HP so it divides instead, which is the only reason the mechanic still fires for a hero who one-shots 60 HP — only the bottom rung dies. Marked by `hitEnemy` and carried out by `updateEnemies` on the beat the blow lands, the way a kill waits on `deathAt`) and the **goo it leaves behind** (`plantGoo` / `splashGoo` / `cullGoo` fill `state.slimeGoo`, in world px so a smear stays on its flagstone while the hall scrolls), frame-edge geometry, run start + `clearHall` (walking out of the far door), circle layout |
| `src/skilltree.js` | the upgrade phase: an **authored** PoE-style rune tree (~1050 nodes) plus purchase/reveal logic, the derived stat model (`recomputeMods`) and the pan/zoom screen (`renderUpgradeFull`). **The web is drawn on a `<canvas>`, and that is a hard requirement, not a rendering preference** — see the essay above `drawTree` and the dark-mode section below; don't move it back to SVG. Colours live in `TREE_PAINT`, glyphs in `RUNE_GLYPHS` (authored once as primitives, rendered two ways by `glyphSvg`/`glyphPath`), hit-testing in `nodeAtPoint`. **Where you add or move nodes:** the `ARMS` table. **Where the balance lives:** `CONFIG.treeTotals` — one tunable number per stat saying how much of it the WHOLE tree contains. Nodes are authored as relative weights; `applyTreeTotals` divides each total across them while the tree is built, so a node's printed value is derived from the total rather than guessed at. That total is the only ceiling: it bounds what exists rather than clipping what you carry, so nothing is bent at runtime and the additive pools slow down on their own. Those totals are cut ~3.000 ranks deep, so the smallest slices are tiny by design and **every rounding in `applyTreeTotals` has a floor** (+1 for a whole stat, 0,1/s for a rate, 0,001 for a fraction) — nothing in the tree is ever nothing. The tooltip meets them there: `treeNum` prints one decimal, German comma, so a real +0,2 % reads as "+0,2 %" instead of rounding away to "+0 %". Tune with `node tools/stat-supply.mjs`, which prints target vs. achieved total, flags a whole-number total that has fallen below one-per-rank, shows what a build carries at 1–90 % of `treeGold` alongside how much of the tree that buys, and — in its second table — spells out exactly what the tooltip says for one rank of the typical node granting each stat. The smoke test fails if any node in the tree prints a figure of zero. A node's `blurb` is optional and most archetypes have none: it is for what the effect line can't say (which damage stage a node feeds, what a fraction is a fraction of), never a restatement of the stat's own name. Prices come from `applyTreeGold` the same way stats come from `applyTreeTotals`: authored weights, one total, normalised at build time. The damage archetypes come in three kinds matching the three stages — `dmgBaseFlat`/`dmgBasePct` feed the Kern, `dmgPct` multiplies, `dmgFlat` ("Schneide") lands last of all inside `spellPower`. Twelve arms leave the seed, alternating spell / generic; each runs `prelude` (rings 1–4, cheap generic nodes) → its **key** at ring 5 (a spell's unlock node, or a generic arm's notable — always visible via `beacon`) → `branches` (five aspect branches on a spell arm, three on a generic one) that fork in two around ring 13 and end in unique keystones out near ring 19, with dead-end offshoots hanging off them. Branch content is written as a short list of `A.*` archetypes it cycles outward. Rings are bookkeeping (cost + value); positions come from `radialSlices` + `relaxTree` (angular slices by subtree size, then springs/repulsion for even spacing), so don't read geometry off the ring. Also the **dev tools**: a slider in the tree topbar (`state.devMode`, persisted) arms a tree wipe and a tappable purse (`devToggle` / `devResetTree` / `devEditGold`) — every handler bails while it is off |
| `src/spells.js` | **the spell book's rules**: `SPELLS` (registry, in its authored order), unlock/selection, `spellPower`, and the per-spell resolvers a cast dispatches into. Where each spell actually SITS is the player's (`state.spellOrder`, a permutation of the ids) — anything drawing or leafing through the book reads `bookSpells()` / `bookSlot()`, never `SPELLS` directly. A resolver normally books its damage at cast time, for a moment in the future; **the Meteoritenschauer is the exception** — its resolver only SCHEDULES rocks into `state.meteorRocks`, and `updateMeteorRocks` (ticked by the loop) picks each rock's spot as it starts falling and hurts whoever stands under it when it lands, because a rock aimed at cast time craters the floor a marching pack has already left. Where the rocks may fall is `meteorField`: the horde's own bounding box, padded, and held far enough from the frame edges that the whole crater fits on screen (a ring centred too near an edge leaves on one side and comes back on the other) |
| `src/vendor-astar.js` | **vendored, unmodified**: [javascript-astar 0.4.1](http://github.com/bgrins/javascript-astar) (MIT), a binary-heap A* over a weighted grid. It sets `astar` and `Graph` as globals — the one place a bare global is not a house-rule violation, because that is the library's own UMD fallback and rewriting a dependency to fit the convention is how a dependency stops being updatable. Don't edit it; `pathfind.js` is the only caller |
| `src/pathfind.js` | **how a body walled in behind another looks for a way to the hero**: the occupancy grid (one cell per lane per track tile, a body walling the cells its own march clearance covers), the A* search over it, and the sideways step that comes out. A lane is still a strict queue with one melee slot; what changed is that a body queued behind one already fighting crosses to a lane whose slot is going begging, so a camp's HEAD COUNT decides its pressure rather than the lanes it happened to be authored into. The search window — the rectangle between the body and the melee line — is load-bearing, and both of its edges were learned by getting them wrong: open the floor in front of the standoff and bodies route under the hero's feet to reach the far side of the hall, open the floor behind the body and the search hands out routes the march has no reverse gear to walk (it then stands still, having been told there is a way). `lane` is the row the queue resolves from and changes in ONE GO; `laneVis` is the row it is DRAWN on, easing across behind it — so everything anchored to a body reads `laneFloorY` (render-scene.js) rather than `scene.laneY[lane]`, or the damage number, the shadow and the goo rope stay behind on the row it left. Balance is one rule: while a lane carries two more melee bodies than another, its REARMOST crosses if A\* can get it there — two rather than one, or an odd head count has the mob shuffling forever. "No way through" is a real answer and leaves the body in its queue |
| `src/sprite-art.js` | the creatures **drawn in code** rather than cut from the tileset, for bodies the sheet hasn't got (the opening slimes): `PIXEL_ART` (pixel maps + palettes), `ART_RECTS`, `artSheet()`. The house rules for drawing one — four colours, all lifted from the tileset's own palette, `#222222` for outline/eyes/creases, closed silhouette, art faces right — are written at the top of the file. Loads before `render-assets.js`, which spreads `ART_RECTS` into `ENEMY_SPRITES` and bakes them down the same path as the sheet's own art |
| `src/render-assets.js` | sprite sheet + baked canvas assets (`ASSETS`, `buildAssets`), and `ENEMY_SPRITES` — the frame rects for all 18 creatures, 17 cut from `assets/dungeon_tiles.png` and the slime drawn in `sprite-art.js` (`sheet: "art"` on a rect says which image it comes from). Each variant's idle/run/hit/rime frames are baked ONCE here, colour filter included; nothing recolours on the draw path |
| `src/render-scene.js` | the combat canvas scene (`scene`, `renderScene`, staff/rune draw), incl. the **slime goo** — the trail of smears on the flagstones (`drawSlimeGoo`, reading `state.slimeGoo`) and the stretching, snapping, dripping bridge between two halves that just came apart (`drawSplitGoo` + `splitWobble`). Both take their colours from the creature's own sprite palette (`gooTint`), so no new colour enters the hall |
| `src/render-spells.js` | what a cast looks like: draws the effect descriptors `state.spellFx` queued by a resolver — or, for a meteor, by `updateMeteorRocks` as each rock commits (blasts, arcs, meteors, cones, auras) |
| `src/rune-circle.js` | rune-circle population + procedural SVG glyphs |
| `src/spellbook.js` | the open book along the bottom of combat: page geometry (the V the circle nests in), the page's own `(u,v)` frame everything written rides on, the runic body script, `SPELL_ART` (the animated page effects, staged in 3D on the page — CSS keyframes live in `combat.css`), flipping. A book is assembled from parts (`bookDefs` once per SVG + `bookMarkup` per volume) so it can be drawn more than once |
| `src/book-order.js` | the order screen: the whole book as three open volumes in ONE SVG, where a page is dragged onto another to trade places (`swapBookPages`). Reached from the **Buch** button on the upgrade screen |
| `src/stats.js` | the ledger screen ("Werte"): what the build currently ADDS UP TO, in three tabs (Held · Zauber · Baum). Reached from the **Werte** button on the upgrade screen. Every figure is re-derived from `state.mods` the way combat derives it — the spell rows re-run each resolver's own arithmetic (radius, hops, freeze, count), so a change in `spells.js` must be mirrored here or the screen starts lying. Each row draws its meter against what the whole tree HOLDS of that stat (`TREE_SUPPLY`), since there are no ceilings left to measure against |
| `src/combat.js` | rune matching + cast dispatch (`handleRuneClick`, `hitEnemy` — the single funnel every point of damage in the game passes through, which is why splitting hangs off it) |
| `src/quiz.js` | vocab-quiz logic + exercise handlers (`quizChoose`, `buildQuiz`, …); `quizReward` applies the banked multiplier plus the question's own stake, `advanceQuiz` cashes the multiplier in on the last question. Also the **conjugation ladder**: `makeConj` deals a rung of `CONFIG.conjugation.levels` (zuordnen: one verb's paradigm → zuordnen: forms from several verbs → pick a form → write a form → half a table → the whole paradigm), `noteConjResult` moves `state.conjLevel` up or down on the top rung |
| `src/screens.js` | full-screen DOM renderers (innerHTML into `#app`), incl. the combat HUD — which is **the hero's bar and nothing else**. There is no enemy health bar in this game: not under the scene (the wave line and the front-body bar that used to sit there are gone) and **not in the hall either** — a small per-body gauge painted onto the canvas was built and thrown out, because the scene is 200x80 art px, bodies queue a 16 px tile apart, and "127/176" is 27 px wide, so the readouts collided on every camp and sat over the sprites they described. What a body is worth is read off the body: its size, its sprite, and the damage numbers popping off it. Don't add one back. The strip is **one row** — bar across, figures at its right-hand end, no caption — because the rune circle under it is HEIGHT-limited on every phone, so a row spent here is diameter taken off the thing the thumb aims at. For the same reason `ARENA_VIEWBOX` crops the arena to the wheel's own extent (285 of the 300 it is authored in); that crop and the arena's bottom margin in `combat.css` are **one calculation** — the crop draws the wheel bigger, which walks it at the open book — so re-derive both together, by walking the pages' top edges in screen px (the closest approach is a tangent partway along the slope, not the vertical gap at the notch) |
| `src/tavern.js` | **the tavern** — the home room and where navigation is headed. Its own canvas scene (`tavern`, `TAV`): the hero's own sprite idles and walks the floor, the room's people stand at their posts, and the furniture is drawn procedurally here (`tavArt`) since a dungeon tileset has no table, bar or stool in it. **That furniture is the only art in the game not cut from the sheet, so it is the only art that can drift away from it**: `TAV_PAL` is sampled straight out of `assets/dungeon_tiles.png` and the sheet's idiom comes with it — a hard `#222222` outline round every object, a three-step ramp per material, one bright edge where the light lands, and a shallow top ellipse on anything round (the sheet's own cue — see its column cap). Never mix a new shade; the smoke test fails if a colour in `TAV_PAL` isn't a colour the sheet uses. Four **stations** — `Schmiede` → upgrade, `Bücherei` → study, `Gang` → combat, plus the flavour `Schänke`; tapping a station's chip — or the picture itself — walks the mage over and hands the phase off **on arrival**, never before. Chips are DOM buttons placed over the canvas from art coordinates (`placeTavernChips`), so they go through the same delegated `data-act` dispatch as every other button and stay crisp. Layout is derived from the art size (x off the room's width, y as a fraction of the floor's depth), so the same room lays itself out on any phone |
| `src/nav.js` | bottom phase-switcher nav (`navTo`, pixel-art icons) — renders into `<nav id="bottom-nav">`. Four buttons: **tavern first**, then study · forge · combat |
| `src/input.js` | pointer/drag handling for the rune circle |
| `src/loop.js` | rAF loop + screen router (`rafLoop`, `render`, `app`), and the **march** (`updateEnemies`): every lane resolved front-to-back as a strict queue, one melee slot per lane, the Frostkegel's shove propagating down a lane, deaths and splits landing on the beat the blow actually arrives. Lane routing (pathfind.js) is planned and stepped here, AHEAD of the grouping, so a body that crosses this frame is resolved in the queue it has just joined rather than the one it left |
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

For anything that touches how hard the hall hits — `enemyBaseDmg`, a variant's
`dmgMult` or `attackMs`, the windup, hero HP or regen — run the attrition tool,
which walks a build down all 82 camps and reports how deep it gets before it
falls. **A variant's two damage numbers are one number**: damage in this hall
trickles (bodies swing every 0,8–2,8 s for a small share of a blow), so re-timing
a body means dividing its `dmgMult` by exactly the factor its `attackMs` was
multiplied by. Change one without the other and you have not re-timed it, you
have buffed it.

```bash
node tools/attrition.mjs                      # the committed balance
node tools/attrition.mjs enemyBaseDmg=20      # try a number without editing config
```

Its model now fills the melee slots the way the hall does — up to one melee
body per lane, whoever is nearest, rather than one per lane the pack was authored
into (see `src/pathfind.js`) — so a camp that stacks its bodies costs what its
head count says it should.

Two things to read off it. The **Skelettsekunden** column is how long the pool
survives one plain skeleton's attention — under ~25 s and a single camp settles
the run instead of grinding it down. (Seconds rather than blows: a blow is no
longer a fixed bite now that every body swings on its own cadence.) The
**chapter table** is the grind itself: LP lost
per camp should climb steadily with depth, and a chapter costing a grown hero 0
LP means the hall has stopped threatening him there. Its model is an upper bound
on the hero (no rune misses, no healers mending, no summons), so read it for
comparison between two sets of numbers, not as a prediction.

When you touch `SENTENCE_POOL`, also run the sentence audit — it is the one
place hand-written Italian lives, so a typo or a word outside `WORD_POOL` has
nothing else to catch it:

```bash
node tools/check-sentences.mjs   # structure, blanks, vocabulary coverage
                                 # (also audits BAR_ORDER_POOL, incl. that every
                                 #  order names something the bar can serve)
```

For scene/visual changes, don't rely on code-reading alone. Drive the game
headlessly with the pre-installed Chromium (Playwright, `executablePath` under
`/opt/pw-browsers/`) and screenshot `canvas.scene`. Note: canvas asset building
uses `getImageData`, which taints under `file://` — **serve over HTTP** when
driving headlessly (the smoke test already does).
