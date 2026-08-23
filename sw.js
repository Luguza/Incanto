"use strict";
// ==============================================================================
// sw.js — the service worker. Makes Incanto playable with no network at all,
// which is the point of a phone game: it is installed to a homescreen (see
// manifest.webmanifest, "display": "standalone") and played on a train.
// Registered by src/offline.js; there is no build step, so this file is the
// whole of it and ships exactly as written.
//
// ------------------------------------------------------------------------------
// WHY THE CACHING IS SPLIT THE WAY IT IS
// ------------------------------------------------------------------------------
// The obvious service worker — precache everything, serve everything from the
// cache, fall back to the network — would break this repo's own workflow within
// a day, and would break it in the way that is hardest to diagnose.
//
// Nothing here is content-hashed. There is no bundler, so `src/loop.js` is
// `src/loop.js` in every build there will ever be, and `index.html` never
// changes its name either. A cache-first worker therefore pins whoever loaded
// it to the build they first saw, FOREVER, because no later build has a URL it
// has not already got an answer for. And the page it pins hardest is the
// gh-pages preview: that branch is a movable pointer every session force-pushes
// at its own work (see "Live-preview workflow" in CLAUDE.md), so the reviewer
// looking at the live site is the person who reloads it most and is least able
// to tell a stale cache from a bad deploy. The symptom is "my change didn't
// deploy" when it did, and the fix a normal person reaches for — clearing site
// data — is one no player will ever find.
//
// So the split is by what staleness COSTS, not by file size:
//
//   * Code and markup — index.html, styles/*.css, src/*.js, the manifest — are
//     NETWORK-FIRST. Online, you always run precisely what is deployed, so the
//     failure above cannot happen at all; the cache is only ever the answer
//     when the network has none. It also keeps a build INTERNALLY consistent:
//     32 script files fetched from the same place in the same instant are 32
//     files from the same build, where a half-warm cache could otherwise pair
//     yesterday's `config.js` with today's `skilltree.js`.
//
//   * assets/ — the sprite sheet, the wheel, the rune font, the icons — is
//     CACHE-FIRST, and revalidated in the background so a changed sheet lands
//     on the next launch. These are the big files (~600 kB), they change very
//     rarely, and one launch spent on an old sprite sheet is a cosmetic cost,
//     not a broken preview. Note `assets/dungeon_tiles.png` is not optional
//     dressing: render-assets.js bakes every creature frame out of it with
//     getImageData at boot, so a miss here does not degrade the art, it stops
//     the game — which is exactly why it is precached rather than merely
//     cacheable.
//
// The network-first half is raced against a timer (NET_TIMEOUT_MS) rather than
// simply awaited. "Offline" on a phone is usually not a clean disconnection —
// it is a station platform with one bar, where fetch neither succeeds nor fails
// for half a minute. A clean disconnection rejects immediately and never sees
// the timer; lie-fi does, and gets the cached build instead of a spinner. The
// request it gave up on is left running and still fills the cache, so the wait
// is paid once and the next launch is current. Measured against a server that
// answers nothing for twenty seconds, the room was on screen in 6,7 s: the
// timer is spent twice, once on the navigation and once on the 36 files it asks
// for, because the second wave cannot start until the first gives up. That is
// the shape to expect if NET_TIMEOUT_MS is ever retuned — the cost of raising
// it is doubled, and so is the saving from lowering it.
//
// If launch latency on a real phone ever becomes the complaint, the answer is
// content-hashed filenames (which would make cache-first safe), NOT flipping
// the code half to cache-first. That flip is the bug described above.
//
// ONE MORE CACHE SITS UNDER THIS ONE, and it undid the whole design once. A
// plain `fetch(request)` inside a worker is served by the browser's ordinary
// HTTP cache, which does not know it is standing in for the network: GitHub
// Pages sends `Cache-Control: max-age=600`, so for ten minutes "network-first"
// quietly meant "disk-first" and a fresh deploy did not arrive even on a
// reload. Driven headlessly with that header set, a build pushed between two
// loads did not reach the page at all. Worse, it is a REGRESSION against having
// no worker: a reload revalidates a page's own subresources, and a worker's
// fetch does not inherit that. So every request this file makes is reissued
// `cache: "no-cache"` — revalidate with the server, ride the ETag, take the 304
// and the bytes already on disk. It is a conditional request per file, not a
// download, and it is what makes "network-first" mean what it says.
//
// VERSION names the cache. Bumping it is a hard reset: install refills a new
// cache from the network and activate deletes every older one, so a build that
// changes an asset's meaning without changing its name has a way to say so.
// Day to day it does not need touching — the code half is network-first, so it
// is not what keeps players current.
//
// Everything is addressed RELATIVELY. The live site is served from a
// subdirectory (https://luguza.github.io/Incanto/), so an absolute "/sw.js" or
// an absolute scope resolves to the domain root, where it 404s or is refused
// for scope. Scope comes from this file's own location and the precache paths
// resolve against it, which is the same idiom manifest.webmanifest already uses
// ("start_url": "./index.html", "scope": "./") and is also what lets the smoke
// test serve the folder at the root of a throwaway HTTP server.
// ==============================================================================

const VERSION = "v1";
const CACHE = "incanto-" + VERSION;
const NET_TIMEOUT_MS = 3000;

// Resolved against this file's URL, so they are right in a subdirectory and at
// a server root alike.
const HERE = new URL("./", self.location.href);
const INDEX = new URL("./index.html", HERE).href;
const ASSET_DIR = new URL("./assets/", HERE).pathname;

// The precache. Code and markup are the `<link>`/`<script>` list of index.html,
// in its order — that list is the authoritative set of what the game is made
// of, so it is transcribed rather than guessed at, and the smoke test fails if
// the two ever drift apart. assets/tiles_list.txt is deliberately absent: it
// documents the sheet's coordinates for a human and is never fetched.
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",

  "./styles/base.css",
  "./styles/combat.css",
  "./styles/quiz.css",
  "./styles/meta.css",

  "./src/core.js",
  "./src/offline.js",
  "./src/dark-paint.js",
  "./src/pixel-font.js",
  "./src/config.js",
  "./src/spells.js",
  "./src/content.js",
  "./src/grammar.js",
  "./src/vocab-history.js",
  "./src/encounters.js",
  "./src/state.js",
  "./src/progression.js",
  "./src/vendor-astar.js",
  "./src/pathfind.js",
  "./src/sprite-art.js",
  "./src/render-assets.js",
  "./src/render-scene.js",
  "./src/render-spells.js",
  "./src/rune-circle.js",
  "./src/spellbook.js",
  "./src/combat.js",
  "./src/quiz.js",
  "./src/screens.js",
  "./src/lecture.js",
  "./src/skilltree.js",
  "./src/book-order.js",
  "./src/stats.js",
  "./src/tavern.js",
  "./src/nav.js",
  "./src/input.js",
  "./src/loop.js",
  "./src/main.js",

  "./assets/dungeon_tiles.png",
  "./assets/arcane_wheel.png",
  "./assets/rune_font.otf",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/apple-touch-icon.png",
];

// ---------------------------------------------------------------------------
// install — fill the cache, then stand aside for the running page.
//
// Each entry is added on its own and a failure is swallowed: a precache that
// fails as a unit leaves the player with NO offline copy because one icon
// moved, which is a worse trade than an offline copy missing one icon. The
// fetches are `cache: "reload"`, so the precache is filled from the network
// rather than from whatever the browser's own HTTP cache happens to be holding
// — otherwise a fresh install can be born stale.
// ---------------------------------------------------------------------------
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map((path) =>
      cache.add(new Request(new URL(path, HERE).href, { cache: "reload" })).catch(() => {})));
    // Take over as soon as this worker is ready rather than waiting for every
    // tab to close. Safe here BECAUSE the code half is network-first: a newly
    // claimed page fetches from the network like any other, so there is no
    // half-warm cache for it to be handed. It is also what makes the update
    // path need no UI — nothing to tap, nothing to explain, no "press R to
    // reload" (which this game could not offer anyway; see CLAUDE.md).
    await self.skipWaiting();
  })());
});

// ---------------------------------------------------------------------------
// activate — one cache generation lives at a time. Anything from an older
// VERSION is deleted here rather than left to rot, since a cache that is no
// longer read is a cache nothing will ever evict on the player's behalf.
// ---------------------------------------------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => n.startsWith("incanto-") && n !== CACHE)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  // A range request wants a slice, and a cache entry answers with the whole
  // file; leave those to the browser.
  if (req.headers.has("range")) return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(HERE.pathname)) return;  // outside our folder

  if (url.pathname.startsWith(ASSET_DIR)) event.respondWith(cacheFirst(event));
  else event.respondWith(networkFirst(event));
});

// Only a same-origin 200 is worth keeping: an opaque response has no body we
// could read back, and a 404 or a 500 mid-deploy is not a copy of the game.
function keepable(res) {
  return !!res && res.ok && res.type === "basic";
}

// The same request, reissued so it actually goes and asks. See the note on the
// HTTP cache above: without this the worker's "network" is a disk read with a
// ten-minute memory. The response is still keyed in our cache by the ORIGINAL
// request, so nothing downstream has to know.
function fresh(req) {
  return new Request(req.url, { cache: "no-cache", credentials: "same-origin" });
}

// `Vary: Accept-Encoding` (which GitHub Pages sends) is enough to make a stored
// response invisible to a request that asked for it slightly differently, and
// an entry that cannot be matched is an entry that is not there when the player
// is on a train. One URL, one copy.
const MATCH = { ignoreVary: true };

// Big, rarely-changed art. Answer from the cache at once, and refresh it behind
// the player's back so a changed file is in place next launch.
async function cacheFirst(event) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, MATCH);
  const net = fetch(fresh(req))
    .then((res) => { if (keepable(res)) cache.put(req, res.clone()); return res; })
    .catch(() => null);
  if (hit) {
    event.waitUntil(net);   // keep the worker alive long enough to revalidate
    return hit;
  }
  return (await net) || Response.error();
}

// Code and markup. The network is the truth; the cache is what is left when
// there isn't one.
async function networkFirst(event) {
  const req = event.request;
  const cache = await caches.open(CACHE);

  const net = fetch(fresh(req))
    .then((res) => { if (keepable(res)) cache.put(req, res.clone()); return res; })
    .catch(() => null);

  let timer;
  const timeout = new Promise((r) => { timer = setTimeout(() => r("timeout"), NET_TIMEOUT_MS); });
  const first = await Promise.race([net, timeout]);
  clearTimeout(timer);

  // A real answer wins outright. Anything else — a rejection, a 5xx from a
  // half-finished deploy, or a network that is simply taking too long — falls
  // through to whatever was cached.
  if (keepable(first)) return first;

  const hit = await cache.match(req, MATCH) ||
    // A navigation can arrive at a URL the cache has never seen ("…/Incanto/"
    // vs "…/Incanto/index.html", or a deep link). The shell answers all of
    // them, since the game routes itself once it is running.
    (req.mode === "navigate" ? await cache.match(INDEX, MATCH) : null);
  if (hit) {
    if (first === "timeout") event.waitUntil(net);   // let the slow one finish and refill
    return hit;
  }

  // Nothing cached: give the network whatever time it still wants, and hand
  // back exactly what it says — including its error, which is what the player
  // would have seen with no service worker at all.
  if (first === "timeout") {
    const late = await net;
    if (late) return late;
  } else if (first) {
    return first;   // a genuine 404/500 with nothing better to offer
  }
  return Response.error();
}
