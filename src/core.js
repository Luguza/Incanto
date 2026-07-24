"use strict";
// ==============================================================================
// core.js — loads first. Creates the single global namespace every module
// registers its public surface onto. New shared helpers should be attached to
// their module's namespace (e.g. Incanto.quiz.foo) rather than added as bare
// globals, so parallel work doesn't collide on the global name space.
//
// NOTE: the hot-path shared singletons (state, CONFIG, ASSETS, scene, …) remain
// top-level globals in their owning files — see CLAUDE.md "Module map".
// ==============================================================================

window.Incanto = window.Incanto || {};
