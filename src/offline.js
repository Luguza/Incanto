"use strict";
// ==============================================================================
// offline.js — registers the service worker (sw.js), which is what makes the
// game playable with no network after one visit. The reasoning about WHAT is
// cached and why lives in the long comment at the top of sw.js; this file is
// only the doorbell.
//
// Three things it is careful about, each of which is a way this breaks:
//
// 1. It is REGISTERED LATE, on `load`. The install step precaches ~1,6 MB, and
//    a registration fired while the page is still pulling 32 script files puts
//    that download in competition with the launch the player is waiting on. The
//    first visit has no offline copy either way; it costs nothing to let the
//    game come up first.
//
// 2. The path is RELATIVE. The live site is served out of a subdirectory
//    (https://luguza.github.io/Incanto/), so "/sw.js" would ask the domain root
//    for a file that is not there — and even if it were, a worker only controls
//    the folder it is served from, so its scope would exclude the whole game.
//    "./sw.js" resolves next to index.html wherever index.html happens to be,
//    which is also how manifest.webmanifest is written and how the smoke test
//    can serve this folder at a server root.
//
// 3. Failure is SILENT and total. A service worker is an enhancement on top of
//    a game that works without one, and there are perfectly ordinary ways to
//    have none: opening index.html off the disk (file:// is not a secure
//    context, so `navigator.serviceWorker` is not even defined), a browser with
//    storage switched off, a private window on some engines. None of those is a
//    thing to tell the player about and none of them may reach the console —
//    the smoke test fails the build on a single console error, which is the
//    right rule and this must not be the exception to it.
//
// There is deliberately no "an update is ready" prompt. sw.js serves code
// network-first and claims the page as soon as it installs, so a reload is
// already current and there is nothing for such a prompt to offer. (It would
// also have to be a tappable button — this game has no keyboard affordances at
// all; see CLAUDE.md.)
// ==============================================================================

window.Incanto = window.Incanto || {};

Incanto.offline = {
  register() {
    try {
      if (!("serviceWorker" in navigator)) return;
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    } catch (_) {
      /* no offline copy; the game does not care */
    }
  },
};

window.addEventListener("load", () => Incanto.offline.register());
