# Time Fantasy style prototype

A **style-direction prototype**, not final art. It previews what Incanto could
look like reframed as a top-down 16-bit JRPG (Final Fantasy VI / Time Fantasy /
"Ancient Kingdoms" era) instead of the current side-view dark dungeon.

**Open `time_fantasy_prototype.html` in a browser** (or via GitHub Pages) — it
runs with zero downloads.

## What you're looking at

The hero and slime are **placeholder sprites I drew**, in the 16-bit palette and
in the **exact sheet format Time Fantasy ships in**:

- RPG Maker VX/MV character sheet = a **3-column × 4-row** block per character
- columns = walk frames `[step-A, idle, step-B]`
- rows = facing `[down, left, right, up]`

The same sampling code runs whether the art is my placeholder or a real dropped-in
PNG — so evaluating the *look* and proving the *loader* happen together.

## Dropping in the real free pack

1. Grab a free Time Fantasy pack from the
   [Time Fantasy FREE PACKS collection](https://itch.io/c/310683/time-fantasy-free-packs)
   (or the full paid bundle for the 80+ characters and monsters).
2. Put a character sheet at `prototype/assets/hero.png` and a monster sheet at
   `prototype/assets/slime.png`.
3. If that pack's cells aren't 16×16 / 16×24, edit `SHEET_CONFIG` at the top of
   the HTML (`cellW`, `cellH`, and `charCol`/`charRow` to pick which character on
   a multi-character sheet).
4. Reload. A small green square in the top-left of the canvas confirms real art
   loaded. No code changes needed.

## Why the art isn't committed here

Time Fantasy's license allows using the assets in games but **forbids
redistributing the raw sheets** — and this repo is public, so committing them
would be redistribution. `prototype/assets/*.png` is git-ignored for that reason.
The placeholder art in the HTML is my own and ships freely.

If we adopt this direction for real, the clean setup is: keep the art out of git
and add a small download/setup step, exactly as this prototype is structured.
