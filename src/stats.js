"use strict";
// ==============================================================================
// stats.js — the LEDGER: everything the build currently is, in one screen.
// Reached from a button on the upgrade screen (see skilltree.js), it sits in the
// upgrade phase next to the tree and the book-order screen.
//
// Why it exists: the tree tells you what ONE node does, and the fight tells you
// whether the build works, but nothing in between ever showed the sum. A player
// who has spent two thousand gold across sixty nodes could not read off what
// their Feuerball actually hits for, how much of a soft cap they had already
// eaten, or how many hops their chain has grown.
//
// The rule this screen follows: NEVER restate a config number as if it were the
// player's. Every figure here is derived from `state.mods` / `state.heroDmg` the
// same way combat derives it — the spell rows re-run the very arithmetic the
// resolvers in spells.js run (radius, hops, freeze, count), so the ledger and
// the fight can't drift apart. Where a stat is bounded, the row draws its meter
// against that bound (CONFIG.caps or the spell's own maximum) and says so, since
// "how close am I to the ceiling" is the question a stat screen exists to answer.
//
// Three tabs rather than one endless scroll — it is read with a thumb:
//   Held    · the hero's own numbers, grouped attack / defence / sustain
//   Zauber  · one card per page of the book, in the order it is bound
//   Baum    · what the tree investment adds up to
//
// Everything is a tap (`data-act`); no keyboard path exists here and none may be
// added — see CLAUDE.md.
// ==============================================================================

// ---------------------------------------------------------------------------
// Formatting — German decimals throughout (comma, non-breaking space before %).
// ---------------------------------------------------------------------------
// German decimals AND German thousands: the tree's ledger reaches six figures of
// gold, and "236030" is a number nobody reads at a glance.
function svNum(v, d = 0) {
  if (!Number.isFinite(v)) return "—";
  const s = (Math.abs(v) < 5e-9 ? 0 : v).toFixed(d);
  const [whole, frac] = s.split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return sign + grouped + (frac ? "," + frac : "");
}
function svPct(v, d = 0) { return svNum(v * 100, d) + "&nbsp;%"; }
function svPlusPct(v, d = 0) { return (v > 0 ? "+" : "") + svPct(v, d); }
function svPlus(v, d = 0) { return (v > 0 ? "+" : "") + svNum(v, d); }
function svSec(ms, d = 1) { return svNum(ms / 1000, d) + "&nbsp;s"; }
function svTiles(v, d = 2) { return svNum(v, d) + " Felder"; }
function svClamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// ---------------------------------------------------------------------------
// Row / meter primitives. A row is a label, a value, an optional meter drawn
// against the stat's own ceiling, and an optional note under it explaining where
// the number came from. The meter is the point: a bare "+38 % Schaden" doesn't
// say whether the next node is worth buying, and a bar three quarters up its cap
// does.
// ---------------------------------------------------------------------------
function svMeter(frac, color, capped) {
  const w = (svClamp01(frac) * 100).toFixed(1);
  return `<div class="sv-bar${capped ? " full" : ""}">` +
    `<i style="width:${w}%;background:${color}"></i></div>`;
}

// o: { label, value, note, frac, cap, color, tone, flag }
function svRow(o) {
  const color = o.color || "var(--arcane)";
  const capped = o.cap != null && o.frac != null && o.frac >= 0.999;
  const meter = o.frac == null ? "" : svMeter(o.frac, color, capped);
  const flag = capped ? `<span class="sv-flag">Grenze</span>`
    : o.flag ? `<span class="sv-flag soft">${o.flag}</span>` : "";
  return `<div class="sv-row">
      <div class="sv-line">
        <span class="sv-label">${o.label}</span>
        ${flag}
        <span class="sv-value${o.tone ? " " + o.tone : ""}">${o.value}</span>
      </div>
      ${meter}
      ${o.note ? `<div class="sv-note">${o.note}</div>` : ""}
    </div>`;
}

// A group of rows under a runic heading. `theme` picks the colour + glyph from
// the tree's own theme table, so a section is the same orange as the might nodes
// that fill it.
function svSection(theme, title, subtitle, rows) {
  const t = TREE_THEMES[theme] || TREE_THEMES.origin;
  return `<section class="sv-sec" style="--sec:${t.color};--sec-glow:${t.glow}">
      <h2 class="sv-sec-head">
        <span class="sv-sec-rune">${runeGlyphSvg(theme, 20)}</span>
        <span class="sv-sec-title">${title}</span>
        ${subtitle ? `<span class="sv-sec-sub">${subtitle}</span>` : ""}
      </h2>
      <div class="sv-rows">${rows.join("")}</div>
    </section>`;
}

// The soft-capped pools (flat/percent HP and damage, gold, pace) are summed
// BEFORE the cap bends them over, so a deep build is quietly losing part of
// every node it buys. That loss is worth stating out loud rather than hiding in
// a number that no longer matches the tooltips that were paid for.
function svSoftNote(raw, effective, fmt) {
  if (!(raw > effective + 1e-6)) return "";
  return `gebündelt ${fmt(raw)} — die Sockelgrenze biegt es auf ${fmt(effective)}`;
}

// ---------------------------------------------------------------------------
// Tab 1 — Held: the hero's own numbers.
// ---------------------------------------------------------------------------
function svHeroTab() {
  const m = state.mods;
  const caps = CONFIG.caps;
  const sums = m.sums || {};
  const der = m.derived || {};
  const out = [];

  // --- Angriff -------------------------------------------------------------
  const critAvg = 1 + m.critChance * (m.critMult - 1);
  const charge = castChargeMs();
  // What penetration is actually worth, shown against the one body in the hall
  // that wears armour at all (see CONFIG.enemyTypes — the brute).
  const brute = CONFIG.enemyTypes.find((t) => t.armor > 0);
  const red = (armor) => Math.min(CONFIG.armorMaxReduction, armor / (armor + CONFIG.armorK));
  const bruteName = brute && brute.label
    ? brute.label.charAt(0) + brute.label.slice(1).toLowerCase()
    : "gepanzerte Knochen";
  const penNote = brute
    ? `gegen einen ${bruteName} (Panzerung ${brute.armor}): ` +
      `${svPct(red(brute.armor))} → <b>${svPct(red(Math.max(0, brute.armor - m.armorPen)))}</b> Minderung`
    : "";

  // "Basis 24, +18 fest, dann +14 %" — but only the parts that actually exist,
  // so a fresh hero doesn't read a chain of zeroes.
  const buildNote = (base, flat, pct) => [
    `Basis ${svNum(base)}`,
    flat > 0.05 ? `${svPlus(flat, 1)} fest` : "",
    pct > 0.005 ? `dann ${svPlusPct(pct)}` : "",
  ].filter(Boolean).join(", ");

  out.push(svSection("might", "Angriff", "was ein Treffer trägt", [
    svRow({
      label: "Grundschaden", value: svNum(state.heroDmg), color: TREE_THEMES.might.color,
      note: `${buildNote(CONFIG.heroBaseDmg, der.flatDmg || 0, der.pctDmg || 0)} — ` +
        `jede Seite des Buches rechnet damit`,
    }),
    svRow({
      label: "Fester Zuschlag", value: svPlus(der.flatDmg || 0, 1), frac: (der.flatDmg || 0) / caps.flatDmg,
      cap: caps.flatDmg, color: TREE_THEMES.might.color,
      note: svSoftNote(sums.flatDmg || 0, der.flatDmg || 0, (v) => svPlus(v, 1)) ||
        `Sockelgrenze ${svPlus(caps.flatDmg)}`,
    }),
    svRow({
      label: "Prozentualer Zuschlag", value: svPlusPct(der.pctDmg || 0), frac: (der.pctDmg || 0) / caps.pctDmg,
      cap: caps.pctDmg, color: TREE_THEMES.might.color,
      note: svSoftNote(sums.pctDmg || 0, der.pctDmg || 0, (v) => svPlusPct(v)) ||
        `Sockelgrenze ${svPlusPct(caps.pctDmg)}`,
    }),
    svRow({
      label: "Krit-Chance", value: svPct(m.critChance), frac: m.critChance / caps.critChance,
      cap: caps.critChance, color: TREE_THEMES.crit.color,
      note: `Höchstwert ${svPct(caps.critChance)}`,
    }),
    svRow({
      label: "Krit-Schaden", value: "×" + svNum(m.critMult, 2), frac: (m.critMult - 1.5) / caps.critMult,
      cap: caps.critMult, color: TREE_THEMES.crit.color,
      note: `Grundwucht ×1,5, aufgestockt bis ×${svNum(1.5 + caps.critMult, 2)}`,
    }),
    svRow({
      label: "Erwartete Ausbeute", value: "×" + svNum(critAvg, 2), color: TREE_THEMES.crit.color,
      note: `was ein Treffer im Schnitt über viele Würfe trägt — ${svNum(state.heroDmg * critAvg, 1)} Grundschaden`,
    }),
    svRow({
      label: "Rüstungsbruch", value: svNum(m.armorPen, 2) + " Punkte", frac: m.armorPen / caps.armorPen,
      cap: caps.armorPen, color: TREE_THEMES.might.color, note: penNote,
    }),
    svRow({
      label: "Zaubertempo", value: svPlusPct(m.castHaste), frac: m.castHaste / caps.castHaste,
      cap: caps.castHaste, color: TREE_THEMES.focus.color,
      note: `Ladezeit der fertigen Rune ${svNum(CONFIG.castChargeMs)} → <b>${svNum(charge)}&nbsp;ms</b>`,
    }),
  ]));

  // --- Wehr ----------------------------------------------------------------
  const regenFill = m.regen > 0 ? state.heroMaxHP / m.regen : 0;
  const backfire = Math.round(state.heroMaxHP * CONFIG.wrongPenaltyFraction);
  out.push(svSection("vigor", "Wehr", "was dich stehen lässt", [
    svRow({
      label: "Lebenspunkte", value: svNum(state.heroMaxHP), color: TREE_THEMES.vigor.color,
      note: `${buildNote(CONFIG.heroBaseHP, der.flatHp || 0, der.pctHp || 0)} · ` +
        `derzeit ${svNum(Math.max(0, Math.round(state.heroHP)))} im Vorrat`,
    }),
    svRow({
      label: "Fester LP-Zuschlag", value: svPlus(der.flatHp || 0, 1), frac: (der.flatHp || 0) / caps.flatHp,
      cap: caps.flatHp, color: TREE_THEMES.vigor.color,
      note: svSoftNote(sums.flatHp || 0, der.flatHp || 0, (v) => svPlus(v, 1)) ||
        `Sockelgrenze ${svPlus(caps.flatHp)}`,
    }),
    svRow({
      label: "Prozentualer LP-Zuschlag", value: svPlusPct(der.pctHp || 0), frac: (der.pctHp || 0) / caps.pctHp,
      cap: caps.pctHp, color: TREE_THEMES.vigor.color,
      note: svSoftNote(sums.pctHp || 0, der.pctHp || 0, (v) => svPlusPct(v)) ||
        `Sockelgrenze ${svPlusPct(caps.pctHp)}`,
    }),
    svRow({
      label: "Regeneration", value: svNum(m.regen, 1) + " LP/s", frac: m.regen / caps.regen,
      cap: caps.regen, color: TREE_THEMES.sustain.color,
      note: m.regen > 0
        ? `füllt deinen ganzen Vorrat in ${svNum(regenFill, 0)}&nbsp;s — bewusst unter dem Schaden einer vollen Horde`
        : "noch kein Zeichen der Genesung gesetzt",
    }),
    svRow({
      label: "Schild-Chance", value: svPct(m.shieldChance), frac: m.shieldChance / caps.shieldChance,
      cap: caps.shieldChance, color: TREE_THEMES.guard.color,
      note: "Chance, dass ein Zauber nebenbei einen Schild wirkt",
    }),
    svRow({
      label: "Schild je Auslösung", value: svNum(m.shieldAmount), frac: m.shieldAmount / caps.shieldAmount,
      cap: caps.shieldAmount, color: TREE_THEMES.guard.color,
      note: `Höchstwert ${svNum(caps.shieldAmount)}`,
    }),
    svRow({
      label: "Schildspeicher", value: svNum(m.shieldMax), frac: m.shieldMax / caps.shieldMax,
      cap: caps.shieldMax, color: TREE_THEMES.guard.color,
      note: `derzeit ${svNum(Math.round(state.heroShield || 0))} gebannt · Höchstwert ${svNum(caps.shieldMax)}`,
    }),
    svRow({
      label: "Dornen", value: svPct(m.thorns), frac: m.thorns / (5 * 0.10),
      cap: 0.5, color: TREE_THEMES.thorn.color,
      note: "reflektierter Anteil jedes Schlags — nur die fünf Dornenkronen im Baum gewähren ihn, je 10&nbsp;%",
    }),
    svRow({
      label: "Fehlschutz", value: svPct(m.spellFailProt), frac: m.spellFailProt / caps.spellFailProt,
      cap: caps.spellFailProt, color: TREE_THEMES.guard.color,
      note: `Chance, den Rückschlag eines Fehlschlags ganz abzuwehren — er kostet sonst ` +
        `${svPct(CONFIG.wrongPenaltyFraction)} deiner Lebenspunkte (${svNum(backfire)})`,
    }),
  ]));

  // --- Zehrung & Gang ------------------------------------------------------
  const paceBase = CONFIG.heroWalkPxPerMs;
  const pace = Math.min(paceBase * m.walkMult, CONFIG.heroWalkMaxPxPerMs);
  const tilesPerSec = (px) => (px / TILE) * 1000;
  const paceCapped = paceBase * m.walkMult > CONFIG.heroWalkMaxPxPerMs + 1e-9;
  const gold = Math.round(CONFIG.goldPerCorrect * rewardMult() * m.coinMult);
  out.push(svSection("fortune", "Zehrung & Gang", "was der Lauf einbringt", [
    svRow({
      label: "Lebensraub", value: svPct(m.leech), frac: m.leech / caps.leech,
      cap: caps.leech, color: TREE_THEMES.sustain.color,
      note: `Anteil des ausgeteilten Zauberschadens, der zu dir zurückkehrt · Höchstwert ${svPct(caps.leech)}`,
    }),
    svRow({
      label: "Schrittempo", value: svNum(tilesPerSec(pace), 2) + " Felder/s",
      frac: (m.walkMult - 1) / caps.walkMult, cap: caps.walkMult, color: TREE_THEMES.fortune.color,
      flag: paceCapped ? "Marschgrenze" : "",
      note: `${svPlusPct(m.walkMult - 1)} auf den Grundgang von ${svNum(tilesPerSec(paceBase), 2)} Felder/s` +
        (paceCapped ? ` — der Marsch deckelt bei ${svNum(tilesPerSec(CONFIG.heroWalkMaxPxPerMs), 2)} Felder/s` : ""),
    }),
    svRow({
      label: "Goldsegen", value: svPlusPct(m.coinMult - 1), frac: (m.coinMult - 1) / caps.coinMult,
      cap: caps.coinMult, color: TREE_THEMES.fortune.color,
      note: svSoftNote(sums.coinMult || 0, m.coinMult - 1, (v) => svPlusPct(v)) ||
        `Sockelgrenze ${svPlusPct(caps.coinMult)}`,
    }),
    svRow({
      label: "Belohnungsbank", value: "×" + svNum(rewardMult(), 1),
      frac: rewardMult() / CONFIG.rewardMultMax, cap: CONFIG.rewardMultMax, color: "var(--gold)",
      note: `${svNum(state.rewardKills || 0)} erschlagene Skelette gebankt (${svPlusPct(CONFIG.rewardPerKill)} je Stück) — ` +
        `wird erst beim Abschluss eines ganzen Quiz eingelöst`,
    }),
    svRow({
      label: "Gold je richtige Antwort", value: svNum(gold), tone: "gold", color: "var(--gold)",
      note: `${svNum(CONFIG.goldPerCorrect)} Grundlohn × Bank × Goldsegen · Konjugationsstufen zahlen ein Vielfaches davon`,
    }),
  ]));

  return out.join("");
}

// ---------------------------------------------------------------------------
// Tab 2 — Zauber: one card per page of the book, in the order it is BOUND
// (see spells.js — bookSpells, never SPELLS).
//
// Every figure here re-runs the resolver's own arithmetic. If a resolver's
// formula changes, this must change with it — that duplication is deliberate:
// the alternative is a screen that quietly lies about the fight.
// ---------------------------------------------------------------------------
const SV_KIND_LABEL = { damage: "Angriff", control: "Kontrolle", support: "Beistand" };

// Which node in the tree lifts this page's seal — named on a sealed card so the
// player knows what to go and find.
function svUnlockNode(spellId) {
  for (const id in TREE_NODES) if (TREE_NODES[id].unlocks === spellId) return TREE_NODES[id];
  return null;
}

// The rows that differ page by page. `power` is what one body caught by the
// spell takes before crits and armour.
function svSpellDetail(spell, power) {
  const m = state.mods;
  const caps = CONFIG.caps;
  const cfg = CONFIG.spells[spell.id];
  const p = m.spellParam || {};
  const c = TREE_THEMES[spell.theme].color;
  const rows = [];

  if (spell.id === "fireball") {
    const aoe = p.aoeFireball || 0;
    const radius = Math.min(cfg.maxRadiusTiles, cfg.radiusTiles * (1 + aoe));
    const laneRadius = cfg.laneRadius * (1 + aoe * 0.5);
    rows.push(
      svRow({
        label: "Explosionsradius", value: svTiles(radius), frac: radius / cfg.maxRadiusTiles,
        cap: cfg.maxRadiusTiles, color: c,
        note: `${svTiles(cfg.radiusTiles)} Grundweite · ${svPlusPct(aoe)} aus dem Glutkern · Ende bei ${svTiles(cfg.maxRadiusTiles)}`,
      }),
      svRow({
        label: "Breite über die Bahnen", value: "±" + svNum(laneRadius, 2),
        frac: aoe > 0 ? (aoe * 0.5) / (caps.aoeFireball * 0.5) : 0, cap: caps.aoeFireball, color: c,
        note: `von ${CONFIG.enemyLanes} Bahnen — quer wächst die Glut nur halb so schnell wie längs`,
      }),
      svRow({
        label: "Flugzeit", value: svNum(cfg.flightMs) + "&nbsp;ms", color: c,
        note: "die Kugel sucht sich den Körper, dessen Explosion die meisten fasst — voller Schaden bis an den Rand, ohne Abschwächung",
      }),
    );
  } else if (spell.id === "lightning") {
    const hops = Math.min(cfg.maxChain, cfg.chain + (p.chainLightning || 0));
    const falloff = Math.min(0.94, cfg.falloff + (p.falloffLightning || 0));
    let chainTotal = 0, amount = power;
    for (let i = 0; i < hops; i++) { chainTotal += amount; amount *= falloff; }
    rows.push(
      svRow({
        label: "Sprünge", value: svNum(hops) + " Körper", frac: hops / cfg.maxChain,
        cap: cfg.maxChain, color: c,
        note: `${svNum(cfg.chain)} vom Bogen selbst · ${svPlus(p.chainLightning || 0)} aus dem Baum · Ende bei ${svNum(cfg.maxChain)}`,
      }),
      svRow({
        label: "Sprungkraft", value: svPct(falloff), frac: falloff / 0.94, cap: 0.94, color: c,
        note: `so viel trägt jeder Sprung vom vorigen weiter — ${svPct(cfg.falloff)} roh · ${svPlusPct(p.falloffLightning || 0)} aus der Leitfähigkeit`,
      }),
      svRow({
        label: "Letzter Sprung", value: svNum(power * Math.pow(falloff, hops - 1), 1), color: c,
        note: `was am Ende der Kette noch ankommt — der erste Körper nimmt ${svNum(power, 1)}`,
      }),
      svRow({
        label: "Ausbeute der ganzen Kette", value: svNum(chainTotal, 1), color: c,
        note: `alle ${svNum(hops)} Sprünge zusammen, im Takt von ${svNum(cfg.hopMs)}&nbsp;ms`,
      }),
    );
  } else if (spell.id === "frost") {
    const freeze = Math.min(cfg.maxFreezeMs, cfg.freezeMs + (p.freezeFrost || 0));
    const reach = Math.min(cfg.maxConeTiles, cfg.coneTiles * (1 + (p.coneFrost || 0)));
    rows.push(
      svRow({
        label: "Kegelweite", value: svTiles(reach, 2), frac: reach / cfg.maxConeTiles,
        cap: cfg.maxConeTiles, color: c,
        note: `${svTiles(cfg.coneTiles, 0)} Grundreichweite · ${svPlusPct(p.coneFrost || 0)} aus Weitem Atem · Ende bei ${svTiles(cfg.maxConeTiles, 0)}`,
      }),
      svRow({
        label: "Frostdauer", value: svSec(freeze), frac: freeze / cfg.maxFreezeMs,
        cap: cfg.maxFreezeMs, color: c,
        note: `${svSec(cfg.freezeMs)} roh · ${svPlus((p.freezeFrost || 0) / 1000, 1)}&nbsp;s aus dem Baum · ` +
          `der Schwung des Getroffenen setzt erst nach dem Auftauen wieder ein`,
      }),
      svRow({
        label: "Rückstoß", value: svTiles(cfg.pushTiles, 1), color: c,
        note: `die vorderste Reihe rutscht über ${svNum(cfg.pushMs)}&nbsp;ms den Gang hinunter`,
      }),
      svRow({
        label: "Splitterschlag", value: "×" + svNum(cfg.primeMult, 1), color: c,
        note: `dein nächster Zauber zerschmettert gefrorene Körper — überall auf dem Feld, nicht nur im Ziel. ` +
          `Zeitfenster ${svSec(CONFIG.spells.primeWindowMs)}`,
      }),
    );
  } else if (spell.id === "meteor") {
    const count = Math.min(cfg.maxCount, cfg.count + (p.countMeteor || 0));
    const aoe = p.aoeMeteor || 0;
    const radius = cfg.radiusTiles * (1 + aoe);
    const laneRadius = cfg.laneRadius * (1 + aoe * 0.5);
    rows.push(
      svRow({
        label: "Brocken je Zauber", value: svNum(count), frac: count / cfg.maxCount,
        cap: cfg.maxCount, color: c,
        note: `${svNum(cfg.count)} vom Schauer selbst · ${svPlus(p.countMeteor || 0)} aus dem Baum · Ende bei ${svNum(cfg.maxCount)}`,
      }),
      svRow({
        label: "Einschlagradius", value: svTiles(radius), frac: aoe / caps.aoeMeteor,
        cap: caps.aoeMeteor, color: c,
        note: `${svTiles(cfg.radiusTiles)} Grundkrater · ${svPlusPct(aoe)} aus der Einschlagswucht · quer ±${svNum(laneRadius, 2)} Bahnen`,
      }),
      svRow({
        label: "Ausbeute des Schauers", value: svNum(power * count, 1), color: c,
        note: `wenn jeder Brocken einen Körper fasst — sie fallen auf zufällige Stellen des ganzen Ganges, ` +
          `verteilt über ${svSec(cfg.fallMs + cfg.spreadMs)}`,
      }),
    );
  } else if (spell.id === "shield") {
    const amount = Math.max(1, Math.round(power));
    const cap = Math.max(m.shieldMax, Math.round(amount * cfg.capMult));
    rows.push(
      svRow({
        label: "Absorption je Zauber", value: svNum(amount), color: c,
        note: `deine Zauberkraft, in Schild gewandelt statt in Schaden`,
      }),
      svRow({
        label: "Höchstspeicher", value: svNum(cap), color: c,
        note: `das Größere aus deinem Schildspeicher (${svNum(m.shieldMax)}) und ×${svNum(cfg.capMult, 1)} dieses Zaubers · ` +
          `derzeit ${svNum(Math.round(state.heroShield || 0))} gebannt`,
      }),
      svRow({
        label: "Anteil deines Vorrats", value: svPct(amount / Math.max(1, state.heroMaxHP)),
        frac: amount / Math.max(1, state.heroMaxHP), color: c,
        note: `ein Zauber deckt so viel wie dieser Teil deiner ${svNum(state.heroMaxHP)} Lebenspunkte`,
      }),
    );
  } else if (spell.id === "heal") {
    const share = state.heroMaxHP * cfg.maxFrac;
    const amount = Math.max(1, Math.round(power + share));
    rows.push(
      svRow({
        label: "Heilung je Zauber", value: svNum(amount), color: c,
        note: `${svNum(power, 1)} aus deiner Zauberkraft + ${svNum(share, 1)} aus ${svPct(cfg.maxFrac)} deines Vorrats`,
      }),
      svRow({
        label: "Anteil deines Vorrats", value: svPct(amount / Math.max(1, state.heroMaxHP)),
        frac: amount / Math.max(1, state.heroMaxHP), color: c,
        note: `von ${svNum(state.heroMaxHP)} Lebenspunkten — der feste Anteil hält das Wort auch auf einem großen Helden lohnend`,
      }),
    );
  }
  return rows;
}

function svSpellCard(spell) {
  const m = state.mods;
  const cfg = CONFIG.spells[spell.id];
  const theme = TREE_THEMES[spell.theme];
  const unlocked = spellUnlocked(spell.id);
  const active = activeSpellId() === spell.id;
  const slot = bookSlot(spell.id);
  const power = spellPower(spell.id);
  const pct = (m.spellPct && m.spellPct[spell.id]) || 0;
  const rawPct = (m.sums && m.sums[spell.dmgKey]) || 0;
  // The headline number is what the page DOES: damage for the four offensive
  // pages, the pool it banks for the two support ones.
  const head = spell.id === "shield" ? { label: "Absorption je Zauber", value: svNum(Math.max(1, Math.round(power))) }
    : spell.id === "heal" ? { label: "Heilung je Zauber", value: svNum(Math.max(1, Math.round(power + state.heroMaxHP * cfg.maxFrac))) }
    : { label: "Schaden je Körper", value: svNum(power, 1) };

  const badges = [
    `<span class="sv-pill">Seite ${slot + 1}</span>`,
    `<span class="sv-pill">${SV_KIND_LABEL[spell.kind] || ""}</span>`,
    active ? `<span class="sv-pill open">Aufgeschlagen</span>` : "",
    unlocked ? "" : `<span class="sv-pill sealed">Versiegelt</span>`,
  ].filter(Boolean).join("");

  const rows = [
    svRow({
      label: "Zeichenbonus dieser Seite", value: svPlusPct(pct), frac: pct / CONFIG.caps.spellPct,
      cap: CONFIG.caps.spellPct, color: theme.color,
      note: svSoftNote(rawPct, pct, (v) => svPlusPct(v)) ||
        `eigene Sockelgrenze ${svPlusPct(CONFIG.caps.spellPct)} — jede Seite deckelt für sich`,
    }),
    svRow({
      label: "Zauberkraft", value: svNum(power, 1), color: theme.color,
      note: `${svNum(state.heroDmg)} Grundschaden × ${svNum(cfg.dmgMult, 2)} Seitenfaktor × ${svNum(1 + pct, 2)} Zeichen`,
    }),
  ];
  // The frost cone deliberately never crits (see the resolver), so promising an
  // average uplift on that page would be a lie.
  if (spell.kind !== "support" && spell.id !== "frost") {
    const critAvg = 1 + m.critChance * (m.critMult - 1);
    rows.push(svRow({
      label: "Erwartet je Körper", value: svNum(power * critAvg, 1), color: theme.color,
      note: `mit ${svPct(m.critChance)} Krit-Chance auf ×${svNum(m.critMult, 2)} gerechnet`,
    }));
  } else if (spell.id === "frost") {
    rows.push(svRow({
      label: "Schaden je Körper", value: svNum(power, 1), color: theme.color,
      note: "der Kegel schlägt nie kritisch ein — er kauft Zeit, statt Schaden zu tragen",
    }));
  }
  rows.push(...svSpellDetail(spell, power));

  const seal = unlocked ? "" : (() => {
    const node = svUnlockNode(spell.id);
    return `<div class="sv-seal">Versiegelt — ${node
      ? `öffnet sich mit dem Zeichen <b>${node.title}</b> (Stufe ${node.ring} im Runenbaum)`
      : "noch kein Schlüssel im Baum"}. Die Werte unten gelten ab dem Tag, an dem du sie hebst.</div>`;
  })();

  return `<article class="sv-spell${unlocked ? "" : " sealed"}${active ? " active" : ""}"
      style="--c:${theme.color};--g:${theme.glow}">
      <header class="sv-spell-head">
        <span class="sv-spell-rune">${runeGlyphSvg(spell.theme, 30)}</span>
        <div class="sv-spell-name">
          <h3>${spell.name}</h3>
          <div class="sv-spell-badges">${badges}</div>
        </div>
        <div class="sv-spell-head-num">
          <b>${head.value}</b>
          <span>${head.label}</span>
        </div>
      </header>
      ${seal}
      <p class="sv-spell-blurb">${spell.blurb}</p>
      <div class="sv-rows">${rows.join("")}</div>
    </article>`;
}

function svSpellsTab() {
  const spells = bookSpells();
  const open = spells.filter((s) => spellUnlocked(s.id)).length;
  const head = `<p class="sv-lead">${open} von ${spells.length} Seiten offen — in der Reihenfolge, in der du das Buch gebunden hast.
    Ein vollendeter Runenkreis wirkt immer die aufgeschlagene Seite.</p>`;
  return head + spells.map(svSpellCard).join("");
}

// ---------------------------------------------------------------------------
// Tab 3 — Baum: what the investment adds up to. The tree is ~1050 nodes; the
// only honest summary is how much of it is actually yours and where it went.
// ---------------------------------------------------------------------------
function svTreeTally() {
  const ranks = state.nodeRanks || {};
  const tally = {
    nodes: 0, nodesTotal: 0, ranks: 0, ranksTotal: 0,
    uniques: 0, uniquesTotal: 0, gold: 0, byTheme: {},
  };
  for (const id in TREE_NODES) {
    if (id === "root") continue;
    const node = TREE_NODES[id];
    tally.nodesTotal++;
    tally.ranksTotal += node.maxRank;
    if (node.unique) tally.uniquesTotal++;
    const r = Math.min(node.maxRank, ranks[id] || 0);
    if (r <= 0) continue;
    tally.nodes++;
    tally.ranks += r;
    if (node.unique) tally.uniques++;
    // What the build cost, re-derived from the same cost curve the buy button
    // charges — every rank of every owned node, summed.
    for (let k = 0; k < r; k++) tally.gold += nodeCost(node, k);
    tally.byTheme[node.theme] = (tally.byTheme[node.theme] || 0) + r;
  }
  return tally;
}

function svTreeTab() {
  const t = svTreeTally();
  const spells = SPELLS.filter((s) => spellUnlocked(s.id)).length;
  const spread = Object.entries(t.byTheme).sort((a, b) => b[1] - a[1]);
  const total = Math.max(1, t.ranks);

  // Where the ranks went, as one stacked band plus a legend. A build's shape is
  // a distribution, not a number — three arms deep or twelve arms wide reads off
  // this band at a glance.
  const band = spread.map(([theme, n]) => {
    const th = TREE_THEMES[theme] || TREE_THEMES.origin;
    return `<i style="width:${((n / total) * 100).toFixed(2)}%;background:${th.color}" title="${th.label}: ${n}"></i>`;
  }).join("");
  const legend = spread.map(([theme, n]) => {
    const th = TREE_THEMES[theme] || TREE_THEMES.origin;
    return `<div class="sv-leg">
        <span class="sv-leg-dot" style="background:${th.color}"></span>
        <span class="sv-leg-name">${th.label}</span>
        <span class="sv-leg-bar"><i style="width:${((n / total) * 100).toFixed(2)}%;background:${th.color}"></i></span>
        <span class="sv-leg-n">${n}</span>
      </div>`;
  }).join("");

  const rows = [
    svRow({
      label: "Zeichen im Besitz", value: `${svNum(t.nodes)} <span class="sv-of">von ${svNum(t.nodesTotal)}</span>`,
      frac: t.nodes / t.nodesTotal, color: TREE_THEMES.origin.color,
      note: `der Baum trägt ${svNum(t.nodesTotal)} Zeichen — er ist zum Wählen da, nicht zum Leerräumen`,
    }),
    svRow({
      label: "Gekaufte Stufen", value: `${svNum(t.ranks)} <span class="sv-of">von ${svNum(t.ranksTotal)}</span>`,
      frac: t.ranks / t.ranksTotal, color: TREE_THEMES.origin.color,
      note: "mehrstufige Zeichen werden mit jeder Stufe teurer",
    }),
    svRow({
      label: "Einzigartige Zeichen", value: `${svNum(t.uniques)} <span class="sv-of">von ${svNum(t.uniquesTotal)}</span>`,
      frac: t.uniques / t.uniquesTotal, color: TREE_THEMES.crit.color,
      note: "Schlusssteine, Notablen, Zauberschlüssel und die fünf Dornenkronen",
    }),
    svRow({
      label: "Seiten geöffnet", value: `${svNum(spells)} <span class="sv-of">von ${svNum(SPELLS.length)}</span>`,
      frac: spells / SPELLS.length, color: TREE_THEMES.fireball.color,
      note: "jede weitere Seite liegt hinter einem Zauberschlüssel auf Stufe 5 ihres Arms",
    }),
    svRow({
      label: "Gold im Baum verbaut", value: svNum(t.gold), tone: "gold", color: "var(--gold)",
      note: `${svNum(state.gold)} liegen noch in der Börse`,
    }),
  ];

  const dist = t.ranks > 0
    ? `<section class="sv-sec" style="--sec:${TREE_THEMES.origin.color};--sec-glow:${TREE_THEMES.origin.glow}">
        <h2 class="sv-sec-head">
          <span class="sv-sec-rune">${runeGlyphSvg("origin", 20)}</span>
          <span class="sv-sec-title">Verteilung</span>
          <span class="sv-sec-sub">wohin die Stufen gingen</span>
        </h2>
        <div class="sv-band">${band}</div>
        <div class="sv-legend">${legend}</div>
      </section>`
    : `<section class="sv-sec"><p class="sv-empty">Noch kein Zeichen gesetzt — der Baum wartet.</p></section>`;

  return svSection("origin", "Runenbaum", "was investiert ist", rows) + dist;
}

// ---------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------
const SV_TABS = [
  { id: "hero", label: "Held" },
  { id: "spells", label: "Zauber" },
  { id: "tree", label: "Baum" },
];

function statsTab() {
  const id = state.statsTab;
  return SV_TABS.some((t) => t.id === id) ? id : "hero";
}

function setStatsTab(id) {
  state.statsTab = id;
  state._structuralDirty = true;
}

function renderStatsFull() {
  const tab = statsTab();
  const body = tab === "spells" ? svSpellsTab() : tab === "tree" ? svTreeTab() : svHeroTab();
  const tabs = SV_TABS.map((t) => `<button class="sv-tab${t.id === tab ? " active" : ""}" role="tab"
      aria-selected="${t.id === tab}" data-act="setStatsTab" data-args='["${t.id}"]'>${t.label}</button>`).join("");

  // The two figures every other number on the screen leans on, called out above
  // the tabs so they stay put while the rest scrolls.
  const openPages = SPELLS.filter((s) => spellUnlocked(s.id)).length;

  app.innerHTML = `
    <div class="screen sv-screen">
      <div class="frame sv-frame">
        <header class="sv-header">
          <div class="sv-top">
            <button class="ghost-btn sv-back" data-act="closeStats" aria-label="Zurück zum Runenbaum">←</button>
            <h1 class="sv-title">Werte</h1>
            <span class="tree-gold"><span class="coin">◈</span> ${svNum(state.gold)}</span>
          </div>
          <div class="sv-hero">
            <div class="sv-hero-tile might">
              <span class="sv-hero-rune">${runeGlyphSvg("might", 22)}</span>
              <b>${svNum(state.heroDmg)}</b>
              <span class="sv-hero-label">Grundschaden</span>
            </div>
            <div class="sv-hero-tile vigor">
              <span class="sv-hero-rune">${runeGlyphSvg("vigor", 22)}</span>
              <b>${svNum(state.heroMaxHP)}</b>
              <span class="sv-hero-label">Lebenspunkte</span>
            </div>
            <div class="sv-hero-tile fireball">
              <span class="sv-hero-rune">${runeGlyphSvg("fireball", 22)}</span>
              <b>${openPages}<span class="sv-of">/${SPELLS.length}</span></b>
              <span class="sv-hero-label">Seiten offen</span>
            </div>
          </div>
          <div class="sv-tabs" role="tablist">${tabs}</div>
        </header>
        <div class="sv-body scroll-y">${body}</div>
      </div>
    </div>`;
}

// Open / leave. Both sit in the upgrade phase, so the nav keeps the anvil lit
// (see NAV_PHASE_FOR_SCREEN).
function openStats() {
  state.screen = "stats";
  state._structuralDirty = true;
}
function closeStats() {
  state.screen = "upgrade";
  state._structuralDirty = true;
}

window.Incanto.stats = {
  renderStatsFull, openStats, closeStats, setStatsTab, statsTab, svTreeTally,
};
