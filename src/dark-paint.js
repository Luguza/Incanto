"use strict";
// ==============================================================================
// dark-paint.js — painting a colour that a phone's browser dark mode cannot
// repaint. Owns: flood(), ramp(), the document-level <defs> they live in.
// Loads early (before anything that draws) so the filters exist by first paint.
// ==============================================================================
//
// WHY THIS EXISTS
// ---------------
// A phone browser's own "dark mode for web contents" — Samsung Internet's dark
// mode, Chrome's Auto Dark Theme — repaints the page whatever it is told. It
// reads every SVG fill and stroke as foreground, inverts the dark ones and
// darkens the light ones, so the game came back wrong on real phones: the
// book's sealed page turned to bright paper, its wax seal went pink, the rune
// circle's wells became lit discs, the parchment went olive and the ink on it
// went pale. Declaring the page dark does not stop it — the browsers that do
// this ignore `color-scheme`, the meta tag and the media query alike (see
// styles/base.css, where the declarations are kept anyway for the ones that do
// listen).
//
// Nor can a shape defend itself. A paint colour is ALREADY inverted by the time
// an SVG filter sees it, so an identity filter shields nothing — not on the
// shape, not on a parent group, not on the <svg> root. Measured against a
// forced browser dark mode, all of these come back repainted: a plain fill, an
// SVG gradient paint server, a pattern of a PNG, an <img>, a CSS background,
// `forced-color-adjust: none`, `mix-blend-mode`.
//
// TWO THINGS SURVIVE, and everything the game paints uses one of them:
//
//   1. <canvas>. The pixels are the game's own; no filter reaches them. Used
//      for the combat scene, the tavern and the rune tree (see drawTree in
//      skilltree.js). Anything large or freely shaded belongs here.
//
//   2. feFlood — this file. A flood's colour is one of the FILTER's own
//      constants rather than a paint the shape carries, so the dark-mode pass
//      never classifies it; compositing it back into the shape's own coverage
//      ("in") returns exactly the colour asked for, with the shape's outline
//      and antialiasing intact. Used for the spell book and the rune circle,
//      which are SVG and have to stay SVG.
//
// HOW TO USE IT
// -------------
//   flood("#5c4526")            -> "url(#fl-5c4526)", a flat colour
//   ramp("#cabd95", "#fcf5de", 1) -> "url(#rmp-…)", a colour running across the
//                                  shape, +1 rightwards / -1 leftwards
// Both register the filter on first use and return a reference to drop into a
// `filter` attribute. The shape still needs a fill or stroke — that is what
// gives the flood its coverage — but the colour it names no longer matters
// except as a fallback, so keep it the same as the flood so the two agree.
//
// TWO RULES, both learned by getting them wrong:
//
//   * Give the shape an OPAQUE paint and put any transparency on the element as
//     `opacity`. `feComposite operator="in"` multiplies the flood by the
//     source's alpha, so a half-transparent fill applies its alpha twice and
//     the result washes out.
//   * The shape needs an AREA. A filter region is a percentage of the geometric
//     bounding box, so a straight line — zero width — has its region collapse
//     and its stroke clipped away entirely. Leave those alone (see .bk-spine).

// Filters are referenced by id from anywhere in the document, so one <defs>
// serves every SVG in the game. Built on demand and left in place.
const DARK_PAINT_IDS = new Set();
let darkPaintDefs = null;

function darkPaintRoot() {
  if (darkPaintDefs) return darkPaintDefs;
  const NS = "http://www.w3.org/2000/svg";
  let host = document.getElementById("dark-paint");
  if (!host) {
    host = document.createElementNS(NS, "svg");
    host.setAttribute("id", "dark-paint");
    host.setAttribute("width", "0");
    host.setAttribute("height", "0");
    host.setAttribute("aria-hidden", "true");
    host.style.position = "absolute";
    document.body.insertBefore(host, document.body.firstChild);
  }
  darkPaintDefs = document.createElementNS(NS, "defs");
  host.appendChild(darkPaintDefs);
  return darkPaintDefs;
}

// A filter big enough not to clip what it floods. Percentages of the bounding
// box, generous enough for a stroke standing outside its own geometry.
function darkPaintFilter(id) {
  const NS = "http://www.w3.org/2000/svg";
  const f = document.createElementNS(NS, "filter");
  f.setAttribute("id", id);
  f.setAttribute("x", "-15%");
  f.setAttribute("y", "-15%");
  f.setAttribute("width", "130%");
  f.setAttribute("height", "130%");
  f.setAttribute("color-interpolation-filters", "sRGB");
  return f;
}

function darkPaintPrim(name, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

// A flat colour. `#5c4526` -> url(#fl-5c4526)
function flood(colour) {
  const id = "fl-" + colour.replace(/[^0-9a-fA-F]/g, "");
  if (!DARK_PAINT_IDS.has(id)) {
    DARK_PAINT_IDS.add(id);
    const f = darkPaintFilter(id);
    f.appendChild(darkPaintPrim("feFlood", { "flood-color": colour }));
    f.appendChild(darkPaintPrim("feComposite", { in2: "SourceGraphic", operator: "in" }));
    darkPaintRoot().appendChild(f);
  }
  return `url(#${id})`;
}

// A colour running across the shape, from `a` at one side to `b` at the other.
//
// There is no way to ask a filter for a linear gradient — every primitive that
// takes a colour takes ONE — so the ramp is made instead of asked for: smear
// the shape's own alpha sideways and blur it hard, and that blurred edge is a
// soft mask running across the shape. Blend the two floods through it and the
// result is a gradient built entirely out of filter constants, which is the
// whole point: there is no paint colour in it for a dark mode to find.
//
// `dir` is +1 for the light end at the right, -1 for the left. `shift` is how
// far the silhouette is pushed — how much of the shape is left purely `b` —
// and `soft` how wide the crossover is, both in the shape's own user units.
// Push too far and the whole shape becomes a blend of the two, which reads as
// a duller, flatter version of the colour you asked for.
//
// APPLY THIS TO A RECTANGLE, and clip the rectangle to the shape you actually
// want — do not put it on the shape itself. The mask is made out of the
// silhouette, so a shape that narrows (a page, seen in perspective, narrows
// towards its head) makes the ramp arrive at a different place on every row,
// which paints a band of half-mixed colour across it.
function ramp(a, b, dir, shift, soft) {
  const reach = shift || 150, blur = soft || reach * 0.42;
  const id = "rmp-" + a.replace(/[^0-9a-f]/gi, "") + "-" + b.replace(/[^0-9a-f]/gi, "") +
    "-" + (dir < 0 ? "l" : "r") + Math.round(reach) + "-" + Math.round(blur);
  if (!DARK_PAINT_IDS.has(id)) {
    DARK_PAINT_IDS.add(id);
    const f = darkPaintFilter(id);
    f.appendChild(darkPaintPrim("feFlood", { "flood-color": a, result: "A" }));
    f.appendChild(darkPaintPrim("feFlood", { "flood-color": b, result: "B" }));
    // Push the shape's silhouette back the way the ramp runs, then blur it: what
    // is left is full where B belongs and fades to nothing where A does.
    // Shifted TOWARDS the light end: what the shifted silhouette still covers
    // is the half that gets B.
    f.appendChild(darkPaintPrim("feOffset", {
      in: "SourceAlpha", dx: dir * reach, dy: 0, result: "shift",
    }));
    f.appendChild(darkPaintPrim("feGaussianBlur", {
      in: "shift", stdDeviation: blur, result: "mask",
    }));
    f.appendChild(darkPaintPrim("feComposite", { in: "B", in2: "mask", operator: "in", result: "lit" }));
    f.appendChild(darkPaintPrim("feComposite", { in: "lit", in2: "A", operator: "over", result: "both" }));
    f.appendChild(darkPaintPrim("feComposite", { in: "both", in2: "SourceGraphic", operator: "in" }));
    darkPaintRoot().appendChild(f);
  }
  return `url(#${id})`;
}

// The shadow the book casts on the screen behind it. A CSS drop-shadow takes a
// paint colour and a dark mode inverts it into a bright halo round the whole
// book; feDropShadow's flood-color is a filter constant, so it stays a shadow.
function dropShadow(id, colour, opacity, dy, blur) {
  if (!DARK_PAINT_IDS.has(id)) {
    DARK_PAINT_IDS.add(id);
    const f = darkPaintFilter(id);
    f.setAttribute("x", "-20%"); f.setAttribute("y", "-20%");
    f.setAttribute("width", "140%"); f.setAttribute("height", "140%");
    f.appendChild(darkPaintPrim("feDropShadow", {
      dx: 0, dy, stdDeviation: blur, "flood-color": colour, "flood-opacity": opacity,
    }));
    darkPaintRoot().appendChild(f);
  }
  return `url(#${id})`;
}
dropShadow("bookShadow", "#06040c", 0.6, -3, 5);

// A stylesheet cannot call flood(), so the colours the stylesheets reference are
// registered here at load instead. The id is derived from the colour, so a rule
// names the same hex twice — `fill: #211a35; filter: url(#fl-211a35)` — and the
// two cannot drift apart. Adding a flooded colour to a stylesheet means adding
// it to this list.
const CSS_FLOODS = [
  "#211a35",  // .bk-sealed      the wash over a sealed page
  "#7c2434",  // .bk-wax         the seal itself
  "#4d1420",  // .bk-wax-edge    its outline
  "#120c1c",  // .bk-wax-shadow  what it casts on the paper
  "#a29673",  // .bk-leaf-edge   the cut edge of a leaf
  "#5c4526",  // .bk-script      the body hand
  "#7d6440",  // .bk-margin      the ruled margin
  "#fffcf0",  // .bk-cut         the lit top edge of a leaf
  "#3d2b1c",  // .bk-cover       leather over board
  "#150f0a",  // .bk-cover-edge  its cut edge
  "#241708",  // .bk-tool        blind-tooled fillets
  "#a3763f",  // .bk-foxing      age spots
  "#7d5c3c",  // .bk-cover-bevel the light along the board's cut edge
  "#b3924e",  // .bk-initial-box the illuminated capital's frame
  "#6b6389",  // .bk-page.locked .bk-script  a sealed page's hand
  "#080d12",  // .rune .well     a word bubble, unmatched
  "#f2c14e",  //                 …armed
  "#5ecf8f",  //                 …matched
  "#e5484d",  //                 …and the wrong-pair flash
];
for (const c of CSS_FLOODS) flood(c);

window.Incanto.darkPaint = { flood, ramp, dropShadow };
