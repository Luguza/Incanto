"use strict";
// ==============================================================================
// grammar.js — the grammar curriculum. Owns: GRAMMAR_UNITS (the shelf) and
// GRAMMAR_LECTURES (what is on it). Data only; src/lecture.js runs it.
// ==============================================================================
//
// A LECTURE IS A TOPIC THAT IS TAUGHT BEFORE IT IS TESTED. That is the whole
// difference between this and the quiz. The post-death quiz asks a learner to
// reproduce `capisco` and marks it right or wrong; it never once says that
// capire belongs to a class of -ire verbs that wedge -isc- into four of their
// six persons. A lecture says that first, in German, with the table in front of
// the learner — and then drills it.
//
// So a lecture is `pages` followed by `drills`, and they are ONE session: the
// pages are steps of the same progress bar the exercises are, because a page
// that can be skipped is a page nobody reads.
//
// Where the A1 scope comes from
// -----------------------------
// The same place WORD_POOL's does (see the essay above it in content.js): the
// CEFR/QCER A1 level description for Italian. On top of that, the topic list
// and its order are the union of the grammar indexes of the coursebooks that
// actually teach A1 — Nuovo Espresso 1, Nuovo Progetto Italiano 1, Via del
// Corso A1, and the Grammatica pratica della lingua italiana (elementare).
// Where they disagree about whether something is A1 or A2 (object pronouns, the
// passato prossimo) it is kept and placed late, because a learner meets both
// long before they are ready to be examined on them.
//
// House rules for writing one — `tools/check-grammar.mjs` enforces them:
//   • Explanations are in GERMAN, examples in Italian, and every Italian
//     example carries its German gloss. The interface is German; a grammar
//     explanation the learner has to decode first has explained nothing.
//   • Italian words come from WORD_POOL, or are inflections of one, or are
//     listed in the lecture's own `teaches` — which is for the forms the
//     lecture itself introduces (articles, pronouns, participles). Nothing is
//     smuggled in that the game never teaches.
//   • A lecture holds exactly CONFIG.grammar.drillCount drills, and they climb:
//     recognition first (pick, pair), production last (write, build, para).
//   • No raw `<` or `&` in any authored string — it is interpolated into the
//     page as-is, the way every other authored string in this game is.
//
// The drill specs are COMPACT rather than literal question objects. Every drill
// ends up as a question object of a type the quiz already renders (see the
// builder in lecture.js), and hand-writing two hundred of those — with their
// token arrays, blank indices and tile ids — is how a typo becomes a blank
// screen. The spec says what is being asked; the builder knows the contract.
//
//   { k: "pick",  q, word?, hint?, a, d: [3 wrong] }        → choose
//   { k: "write", q, word?, hint?, a, accept?: [] }         → type
//   { k: "pair",  leftLabel, rightLabel, pairs: [[l, r]] }  → match
//   { k: "gap",   it, de, a, d?: [3 wrong] }                → fill-choose / fill-type
//   { k: "build", it, de, extra?: [] }                      → arrange
//   { k: "para",  verb, blanks? }                           → conj-table
//
// Any spec may carry `title` to name itself in the exercise header, and `note`
// to add a line of guidance under the prompt.
// ---------------------------------------------------------------------------

// The shelf. `lectures` is the order they are read in; a unit with none yet is
// on the list anyway, so the screen shows the whole road rather than only the
// paved part.
const GRAMMAR_UNITS = [
  { id: "nomen",   title: "Nomen und Artikel",   blurb: "Geschlecht, Mehrzahl und die sieben Artikel" },
  { id: "adj",     title: "Adjektive",          blurb: "Wie ein Eigenschaftswort sich anpasst" },
  { id: "praes",   title: "Verben: Präsens",    blurb: "Die Gegenwart, von essere bis zu den Reflexiven" },
  { id: "satz",    title: "Sätze bauen",        blurb: "Fragen, Verneinung und was Italienisch weglässt" },
  { id: "praep",   title: "Präpositionen",      blurb: "di, a, da, in — und was passiert, wenn ein Artikel folgt" },
  { id: "besitz",  title: "Besitz und Zeigen",  blurb: "mein, dein, dieser, jener" },
  { id: "zahlen",  title: "Zahlen und Zeit",    blurb: "Zählen, die Uhrzeit und das Datum" },
  { id: "pron",    title: "Pronomen",           blurb: "mi piace, lo, gli und die Höflichkeitsform" },
  { id: "verg",    title: "Vergangenheit",      blurb: "Das passato prossimo" },
  { id: "tun",     title: "Sagen und Tun",      blurb: "Befehle, Verlaufsform, sapere und conoscere" },
];

// The lectures, in reading order. `teaches` lists the Italian words this
// lecture is itself what introduces — articles, pronouns, endings — so the
// audit can hold everything else to the vocabulary the game already teaches.
const GRAMMAR_LECTURES = [

  // ===========================================================================
  // Unit 1 — Nomen & Artikel
  // ===========================================================================
  {
    id: "nom-genus", unit: "nomen",
    title: "Männlich oder weiblich?",
    subtitle: "Jedes Nomen hat ein Geschlecht",
    teaches: ["il", "la", "lo", "le", "gli", "i"],
    pages: [
      { blocks: [
        { t: "p", de: "Jedes italienische Nomen ist entweder männlich oder weiblich. Ein Neutrum wie das deutsche „das“ gibt es nicht — auch ein Tisch und ein Fenster sind das eine oder das andere." },
        { t: "p", de: "Meistens verrät die Endung, welches von beiden:" },
        { t: "table", head: ["Endung", "Geschlecht", "Beispiel"], rows: [
          ["-o", "männlich", "il libro"],
          ["-a", "weiblich", "la casa"],
        ] },
        { t: "ex", it: "il libro", de: "das Buch" },
        { t: "ex", it: "la casa", de: "das Haus" },
      ] },
      { blocks: [
        { t: "p", de: "Der Artikel gehört zum Nomen wie die Endung. Er ist das Erste, woran man das Geschlecht sieht — und das Einzige, woran man es bei den Ausnahmen sieht." },
        { t: "ex", it: "il gatto", de: "die Katze", note: "männlich, obwohl „die Katze“" },
        { t: "ex", it: "la mucca", de: "die Kuh" },
        { t: "rule", de: "Lerne ein Nomen nie allein, sondern immer mit seinem Artikel." },
      ] },
      { blocks: [
        { t: "p", de: "Das deutsche Geschlecht hilft dabei nicht. Es stimmt oft genug überein, um in Sicherheit zu wiegen, und dann plötzlich nicht mehr." },
        { t: "ex", it: "il naso", de: "die Nase", note: "italienisch männlich" },
        { t: "ex", it: "la sedia", de: "der Stuhl", note: "italienisch weiblich" },
        { t: "ex", it: "il latte", de: "die Milch" },
        { t: "bad", wrong: "la naso", right: "il naso" },
      ] },
      { blocks: [
        { t: "p", de: "Bei Menschen und Tieren richtet sich das Geschlecht nach dem Lebewesen — und die Endung wechselt mit." },
        { t: "table", head: ["männlich", "weiblich"], rows: [
          ["il figlio", "la figlia"],
          ["il nonno", "la nonna"],
          ["il ragazzo", "la ragazza"],
          ["il bambino", "la bambina"],
        ] },
        { t: "ex", it: "il fratello e la sorella", de: "der Bruder und die Schwester" },
      ] },
      { blocks: [
        { t: "p", de: "Ein paar Wörter halten sich nicht daran: einige auf -a sind männlich, und ein berühmtes auf -o ist weiblich." },
        { t: "ex", it: "il problema", de: "das Problem", note: "-a, aber männlich" },
        { t: "ex", it: "la mano", de: "die Hand", note: "-o, aber weiblich" },
        { t: "p", de: "Es sind wenige, und sie bekommen später eine eigene Lektion. Fürs Erste gilt die Regel — und der Artikel, den du mitlernst, fängt die Ausnahmen ohnehin auf." },
        { t: "rule", de: "-o ist männlich, -a ist weiblich. Der Artikel sagt es dir im Zweifel genauer als die Endung." },
      ] },
    ],
    drills: [
      { k: "pick", q: "Welcher Artikel gehört zu", word: "libro", a: "il", d: ["la", "lo", "le"] },
      { k: "pick", q: "Welcher Artikel gehört zu", word: "casa", a: "la", d: ["il", "lo", "gli"] },
      { k: "pick", q: "Welches Nomen ist weiblich?", a: "la finestra", d: ["il tavolo", "il letto", "il piatto"] },
      { k: "pick", q: "Welches Nomen ist männlich?", a: "il quaderno", d: ["la penna", "la sedia", "la porta"] },
      { k: "pair", leftLabel: "männlich", rightLabel: "weiblich", pairs: [
        ["il figlio", "la figlia"], ["il nonno", "la nonna"], ["il ragazzo", "la ragazza"],
        ["il fratello", "la sorella"], ["il marito", "la moglie"],
      ] },
      { k: "gap", it: "Io vedo la casa", de: "Ich sehe das Haus", a: "la", d: ["il", "lo", "le"] },
      { k: "gap", it: "Tu compri il pane", de: "Du kaufst das Brot", a: "il", d: ["la", "lo", "le"] },
      { k: "write", q: "Mit Artikel:", word: "die Milch", a: "il latte", strict: true },
      { k: "write", q: "Mit Artikel:", word: "die Nase", a: "il naso", strict: true },
      { k: "write", q: "Mit Artikel:", word: "der Stuhl", a: "la sedia", strict: true },
      { k: "build", it: "Il libro è nuovo", de: "Das Buch ist neu", extra: ["la", "vecchia"] },
      { k: "build", it: "La sedia è piccola", de: "Der Stuhl ist klein", extra: ["il", "piccolo"] },
    ],
  },

  {
    id: "nom-plural", unit: "nomen",
    title: "Einer oder viele?",
    subtitle: "Die Mehrzahl ist eine andere Endung",
    teaches: ["i", "le", "gli"],
    pages: [
      { blocks: [
        { t: "p", de: "Für die Mehrzahl hängt Italienisch nichts an — es tauscht die Endung aus. Und weil das Geschlecht in der Endung steckt, hat jedes Geschlecht seine eigene Mehrzahl." },
        { t: "table", head: ["", "Singular", "Plural"], rows: [
          ["männlich", "il libro", "i libri"],
          ["weiblich", "la casa", "le case"],
        ] },
        { t: "rule", de: "-o wird zu -i, -a wird zu -e." },
      ] },
      { blocks: [
        { t: "p", de: "Der Artikel geht mit: il wird zu i, la wird zu le. Man hört die Mehrzahl also zweimal — am Artikel und am Nomen." },
        { t: "ex", it: "il gatto", de: "die Katze" },
        { t: "ex", it: "i gatti", de: "die Katzen" },
        { t: "ex", it: "la scarpa", de: "der Schuh" },
        { t: "ex", it: "le scarpe", de: "die Schuhe" },
      ] },
      { blocks: [
        { t: "p", de: "Nomen auf -io haben im Plural nur ein i. Zwei hintereinander schreibt das Italienische nicht." },
        { t: "ex", it: "il figlio", de: "der Sohn" },
        { t: "ex", it: "i figli", de: "die Söhne" },
        { t: "bad", wrong: "i figlii", right: "i figli" },
      ] },
      { blocks: [
        { t: "p", de: "Weibliche Nomen auf -ca und -ga schieben im Plural ein h ein. Ohne das h würde aus dem harten k plötzlich ein tsch — die Schreibweise rettet den Klang." },
        { t: "ex", it: "la mucca", de: "die Kuh" },
        { t: "ex", it: "le mucche", de: "die Kühe" },
        { t: "ex", it: "l'amica", de: "die Freundin" },
        { t: "ex", it: "le amiche", de: "die Freundinnen" },
        { t: "bad", wrong: "le mucce", right: "le mucche" },
      ] },
      { blocks: [
        { t: "p", de: "Bei den männlichen Formen auf -co und -go ist es leider nicht so verlässlich. Manche nehmen das h, manche nicht." },
        { t: "ex", it: "l'amico", de: "der Freund" },
        { t: "ex", it: "gli amici", de: "die Freunde", note: "ohne h — gesprochen „amitschi“" },
        { t: "p", de: "Das ist eines der wenigen Dinge in dieser Lektion, die man pro Wort lernt statt nach Regel. Es sind nicht viele." },
        { t: "rule", de: "-ca und -ga bekommen im Plural ein h. Bei -co und -go entscheidet das einzelne Wort." },
      ] },
    ],
    drills: [
      { k: "pick", q: "Plural von", word: "il libro", a: "i libri", d: ["le libri", "i libro", "gli libri"] },
      { k: "pick", q: "Plural von", word: "la casa", a: "le case", d: ["le casi", "la case", "i case"] },
      { k: "pick", q: "Plural von", word: "il figlio", a: "i figli", d: ["i figlii", "le figli", "i figlio"] },
      { k: "pick", q: "Plural von", word: "la mucca", a: "le mucche", d: ["le mucce", "le mucca", "i mucchi"] },
      { k: "pair", leftLabel: "einer", rightLabel: "viele", pairs: [
        ["il gatto", "i gatti"], ["la penna", "le penne"], ["il piatto", "i piatti"],
        ["la scarpa", "le scarpe"], ["il quaderno", "i quaderni"],
      ] },
      { k: "gap", it: "Io compro le mele", de: "Ich kaufe die Äpfel", a: "le", d: ["la", "i", "gli"] },
      { k: "gap", it: "Noi mangiamo i pomodori", de: "Wir essen die Tomaten", a: "i", d: ["il", "le", "gli"] },
      { k: "write", q: "Plural von", word: "la sedia", a: "le sedie", strict: true },
      { k: "write", q: "Plural von", word: "il bambino", a: "i bambini", strict: true },
      { k: "write", q: "Plural von", word: "l'amica", a: "le amiche", strict: true },
      { k: "build", it: "Le finestre sono grandi", de: "Die Fenster sind groß", extra: ["la", "grande"] },
      { k: "build", it: "I libri sono nuovi", de: "Die Bücher sind neu", extra: ["le", "nuovo"] },
    ],
  },

  {
    id: "nom-e", unit: "nomen",
    title: "Nomen auf -e",
    subtitle: "Die Gruppe, die ihr Geschlecht nicht verrät",
    teaches: ["il", "la", "i", "le"],
    pages: [
      { blocks: [
        { t: "p", de: "Neben -o und -a gibt es eine dritte Gruppe: Nomen auf -e. Sie sind der Grund, warum man den Artikel mitlernt — die Endung sagt hier nämlich gar nichts über das Geschlecht." },
        { t: "ex", it: "il padre", de: "der Vater", note: "männlich" },
        { t: "ex", it: "la madre", de: "die Mutter", note: "weiblich" },
        { t: "p", de: "Beide enden auf -e. Nur der Artikel unterscheidet sie." },
      ] },
      { blocks: [
        { t: "p", de: "Im Plural fallen die beiden Geschlechter zusammen: -e wird zu -i, ganz gleich ob männlich oder weiblich." },
        { t: "table", head: ["", "Singular", "Plural"], rows: [
          ["männlich", "il padre", "i padri"],
          ["weiblich", "la madre", "le madri"],
        ] },
        { t: "rule", de: "-e wird im Plural immer zu -i. Das Geschlecht steht danach nur noch im Artikel." },
      ] },
      { blocks: [
        { t: "p", de: "Es sind viele alltägliche Wörter, und sie verteilen sich ohne erkennbares Muster auf beide Geschlechter." },
        { t: "ex", it: "il cane", de: "der Hund" },
        { t: "ex", it: "il mare", de: "das Meer" },
        { t: "ex", it: "la chiave", de: "der Schlüssel" },
        { t: "ex", it: "la notte", de: "die Nacht" },
      ] },
      { blocks: [
        { t: "p", de: "Zwei Endungen sind aber verlässlich, und die beiden decken einen guten Teil der Gruppe ab:" },
        { t: "table", head: ["Endung", "Geschlecht", "Beispiele"], rows: [
          ["-zione", "immer weiblich", "la stazione, la lezione"],
          ["-ore", "fast immer männlich", "il colore, il dottore"],
        ] },
        { t: "ex", it: "la nazione", de: "die Nation" },
        { t: "ex", it: "il professore", de: "der Lehrer" },
      ] },
      { blocks: [
        { t: "p", de: "Der häufigste Fehler ist, das deutsche Geschlecht zu übernehmen. „Die Farbe“ ist weiblich, il colore ist es nicht." },
        { t: "bad", wrong: "la colore", right: "il colore" },
        { t: "bad", wrong: "il chiave", right: "la chiave" },
        { t: "rule", de: "Bei einem Nomen auf -e ist der Artikel keine Zugabe, sondern die halbe Information." },
      ] },
    ],
    drills: [
      { k: "pick", q: "Welcher Artikel gehört zu", word: "chiave", a: "la", d: ["il", "lo", "gli"] },
      { k: "pick", q: "Welcher Artikel gehört zu", word: "cane", a: "il", d: ["la", "lo", "le"] },
      { k: "pick", q: "Welcher Artikel gehört zu", word: "stazione", a: "la", d: ["il", "lo", "gli"] },
      { k: "pick", q: "Plural von", word: "il fiore", a: "i fiori", d: ["le fiore", "i fiore", "le fiori"] },
      { k: "pair", leftLabel: "einer", rightLabel: "viele", pairs: [
        ["il padre", "i padri"], ["la madre", "le madri"], ["la notte", "le notti"],
        ["il mese", "i mesi"], ["la chiave", "le chiavi"],
      ] },
      { k: "pair", leftLabel: "deutsch", rightLabel: "italienisch", pairs: [
        ["der Hund", "il cane"], ["die Nacht", "la notte"], ["das Meer", "il mare"],
        ["der Schlüssel", "la chiave"], ["die Sonne", "il sole"],
      ] },
      { k: "gap", it: "Io vedo il mare", de: "Ich sehe das Meer", a: "il", d: ["la", "lo", "le"] },
      { k: "gap", it: "Tu prendi la chiave", de: "Du nimmst den Schlüssel", a: "la", d: ["il", "lo", "le"] },
      { k: "write", q: "Mit Artikel:", word: "die Sonne", a: "il sole", strict: true },
      { k: "write", q: "Mit Artikel:", word: "das Brot", a: "il pane", strict: true },
      { k: "write", q: "Plural von", word: "la classe", a: "le classi", strict: true },
      { k: "build", it: "La notte è fredda", de: "Die Nacht ist kalt", extra: ["il", "freddo"] },
    ],
  },

  {
    id: "art-def", unit: "nomen",
    title: "Der bestimmte Artikel",
    subtitle: "il · lo · l' · la · i · gli · le",
    teaches: ["il", "lo", "la", "i", "gli", "le"],
    pages: [
      { blocks: [
        { t: "p", de: "Wo das Deutsche drei Artikel hat, hat das Italienische sieben. Das klingt nach mehr Arbeit, als es ist: das Geschlecht entscheidet die Spalte, und der Laut, mit dem das Wort anfängt, entscheidet die Zeile." },
        { t: "table", head: ["männlich", "Singular", "Plural"], rows: [
          ["vor Konsonant", "il", "i"],
          ["vor s+Konsonant, z, ps, gn, y", "lo", "gli"],
          ["vor Vokal", "l'", "gli"],
        ] },
        { t: "table", head: ["weiblich", "Singular", "Plural"], rows: [
          ["vor Konsonant", "la", "le"],
          ["vor Vokal", "l'", "le"],
        ] },
      ] },
      { blocks: [
        { t: "p", de: "Die Zeile mit lo ist die, die man lernen muss. Sie gilt vor s plus Konsonant, vor z, ps, gn und y — also überall dort, wo il davor schwer auszusprechen wäre." },
        { t: "ex", it: "lo studente", de: "der Student", note: "s + Konsonant" },
        { t: "ex", it: "lo zaino", de: "der Rucksack", note: "z" },
        { t: "ex", it: "lo specchio", de: "der Spiegel" },
        { t: "bad", wrong: "il zucchero", right: "lo zucchero" },
      ] },
      { blocks: [
        { t: "p", de: "Vor einem Vokal verkürzen sich il, lo und la alle drei zu l'. Das Geschlecht ist im Singular dann nicht mehr zu hören — nur im Plural kommt es zurück." },
        { t: "ex", it: "l'amico", de: "der Freund", note: "Plural: gli amici" },
        { t: "ex", it: "l'acqua", de: "das Wasser", note: "Plural: le acque" },
        { t: "bad", wrong: "il amico", right: "l'amico" },
      ] },
      { blocks: [
        { t: "p", de: "Im Plural gibt es nur noch drei Formen: i, gli und le. gli übernimmt alles, was im Singular lo oder l' hatte." },
        { t: "table", head: ["Singular", "Plural"], rows: [
          ["il tavolo", "i tavoli"],
          ["lo zaino", "gli zaini"],
          ["l'occhio", "gli occhi"],
          ["la porta", "le porte"],
          ["l'arancia", "le arance"],
        ] },
      ] },
      { blocks: [
        { t: "p", de: "Italienisch setzt den Artikel außerdem an Stellen, an denen das Deutsche keinen setzt — vor abstrakte Begriffe und vor ganze Gattungen." },
        { t: "ex", it: "L'amore è bello", de: "Liebe ist schön" },
        { t: "ex", it: "Il caffè è caldo", de: "Der Kaffee ist heiß" },
        { t: "rule", de: "Das Geschlecht wählt die Spalte, der Anfangslaut die Zeile. Im Plural bleiben nur i, gli und le übrig." },
      ] },
    ],
    drills: [
      { k: "pick", q: "Welcher Artikel gehört zu", word: "zucchero", a: "lo", d: ["il", "la", "gli"] },
      { k: "pick", q: "Welcher Artikel gehört zu", word: "studente", a: "lo", d: ["il", "la", "gli"] },
      { k: "pick", q: "Welcher Artikel gehört zu", word: "amico", a: "l'", d: ["il", "lo", "la"] },
      { k: "pick", q: "Welcher Artikel gehört zu", word: "acqua", a: "l'", d: ["il", "la", "lo"] },
      { k: "pick", q: "Welcher Artikel passt?", word: "___ studenti", a: "gli", d: ["i", "le", "lo"] },
      { k: "pair", leftLabel: "einer", rightLabel: "viele", pairs: [
        ["lo zaino", "gli zaini"], ["il tavolo", "i tavoli"], ["la porta", "le porte"],
        ["l'occhio", "gli occhi"], ["l'arancia", "le arance"],
      ] },
      { k: "gap", it: "Io compro lo zucchero", de: "Ich kaufe den Zucker", a: "lo", d: ["il", "la", "gli"] },
      { k: "gap", it: "Tu vedi gli occhiali", de: "Du siehst die Brille", a: "gli", d: ["i", "le", "lo"] },
      { k: "write", q: "Mit Artikel:", word: "der Rucksack", a: "lo zaino", strict: true },
      { k: "write", q: "Mit Artikel:", word: "der Spiegel", a: "lo specchio", strict: true },
      { k: "write", q: "Plural von", word: "lo studente", a: "gli studenti", strict: true },
      { k: "build", it: "Gli studenti sono giovani", de: "Die Studenten sind jung", extra: ["i", "giovane"] },
    ],
  },

  {
    id: "art-indef", unit: "nomen",
    title: "Der unbestimmte Artikel",
    subtitle: "un · uno · una · un'",
    teaches: ["un", "uno", "una", "dei", "delle"],
    pages: [
      { blocks: [
        { t: "p", de: "„Ein“ und „eine“ folgen derselben Logik wie il und lo: das Geschlecht wählt die Spalte, der Anfangslaut die Zeile. Nur sind es vier Formen statt sieben." },
        { t: "table", head: ["", "männlich", "weiblich"], rows: [
          ["vor Konsonant", "un libro", "una casa"],
          ["vor s+Konsonant, z", "uno zaino", "—"],
          ["vor Vokal", "un amico", "un'amica"],
        ] },
      ] },
      { blocks: [
        { t: "p", de: "Die Zeile vor dem Vokal ist die, an der fast jeder einmal hängen bleibt: männlich steht un ohne Apostroph, weiblich un' mit." },
        { t: "ex", it: "un amico", de: "ein Freund", note: "kein Apostroph" },
        { t: "ex", it: "un'amica", de: "eine Freundin", note: "mit Apostroph" },
        { t: "bad", wrong: "un'amico", right: "un amico" },
        { t: "p", de: "Der Apostroph steht für ein weggelassenes a. Männlich war da nie eines, also gibt es auch nichts wegzulassen." },
      ] },
      { blocks: [
        { t: "p", de: "uno steht genau dort, wo im bestimmten Artikel lo steht — vor s plus Konsonant und vor z." },
        { t: "ex", it: "uno studente", de: "ein Student" },
        { t: "ex", it: "uno zaino", de: "ein Rucksack" },
        { t: "bad", wrong: "un zaino", right: "uno zaino" },
      ] },
      { blocks: [
        { t: "p", de: "Einen Plural hat der unbestimmte Artikel nicht — „einige“ sagt man mit di plus bestimmtem Artikel, oder man lässt es ganz weg." },
        { t: "ex", it: "Io compro dei libri", de: "Ich kaufe einige Bücher" },
        { t: "ex", it: "Io compro delle mele", de: "Ich kaufe einige Äpfel" },
        { t: "ex", it: "Io compro libri", de: "Ich kaufe Bücher" },
      ] },
      { blocks: [
        { t: "p", de: "Und noch ein Unterschied zum Deutschen: bei einem Beruf steht gar kein Artikel." },
        { t: "ex", it: "Io sono studente", de: "Ich bin Student" },
        { t: "rule", de: "un vor allem Männlichen, uno vor s+Konsonant und z, una vor weiblichem Konsonant, un' vor weiblichem Vokal." },
      ] },
    ],
    drills: [
      { k: "pick", q: "Welcher Artikel passt?", word: "___ libro", a: "un", d: ["uno", "una", "un'"] },
      { k: "pick", q: "Welcher Artikel passt?", word: "___ zaino", a: "uno", d: ["un", "una", "un'"] },
      { k: "pick", q: "Welcher Artikel passt?", word: "___ casa", a: "una", d: ["un", "uno", "un'"] },
      { k: "pick", q: "Welcher Artikel passt?", word: "___ amica", a: "un'", d: ["un", "uno", "una"] },
      { k: "pick", q: "Welcher Artikel passt?", word: "___ amico", a: "un", d: ["un'", "uno", "una"] },
      { k: "pair", leftLabel: "Nomen", rightLabel: "mit Artikel", pairs: [
        ["zaino", "uno zaino"], ["libro", "un libro"], ["casa", "una casa"],
        ["amica", "un'amica"], ["studente", "uno studente"],
      ] },
      { k: "gap", it: "Io voglio una mela", de: "Ich will einen Apfel", a: "una", d: ["un", "uno", "un'"] },
      { k: "gap", it: "Tu prendi un caffè", de: "Du nimmst einen Kaffee", a: "un", d: ["uno", "una", "un'"] },
      { k: "write", q: "Mit unbestimmtem Artikel:", word: "ein Spiegel", a: "uno specchio", strict: true },
      { k: "write", q: "Mit unbestimmtem Artikel:", word: "eine Freundin", a: "un'amica", strict: true },
      { k: "write", q: "Mit unbestimmtem Artikel:", word: "ein Freund", a: "un amico", strict: true },
      { k: "build", it: "Io voglio un bicchiere di vino", de: "Ich will ein Glas Wein", extra: ["una", "uno"] },
    ],
  },

  {
    id: "nom-irr", unit: "nomen",
    title: "Nomen, die aus der Reihe tanzen",
    subtitle: "città, bar, mano, uomo, problema",
    teaches: ["il", "la", "i", "le", "gli", "foto", "uomini"],
    pages: [
      { blocks: [
        { t: "p", de: "Eine Handvoll Nomen hält sich an keine der bisherigen Endungen. Es sind wenige, aber es sind alltägliche — und deshalb begegnen sie einem ständig." },
        { t: "p", de: "Die größte Gruppe ändert sich im Plural überhaupt nicht. Nur der Artikel zeigt dann noch an, dass es mehrere sind." },
        { t: "table", head: ["Singular", "Plural"], rows: [
          ["la città", "le città"],
          ["il bar", "i bar"],
          ["il film", "i film"],
          ["l'università", "le università"],
        ] },
      ] },
      { blocks: [
        { t: "p", de: "Zwei Sorten Wörter sind unveränderlich: die auf einem betonten Vokal enden, und die auf einem Konsonanten enden." },
        { t: "ex", it: "il caffè", de: "der Kaffee", note: "betonte Endung" },
        { t: "ex", it: "lo sport", de: "der Sport", note: "endet auf Konsonant" },
        { t: "ex", it: "l'autobus", de: "der Bus" },
        { t: "rule", de: "Betonte Endung oder Konsonant am Ende: der Plural sieht aus wie der Singular." },
      ] },
      { blocks: [
        { t: "p", de: "Dann die Wörter auf -a, die trotzdem männlich sind. Ihr Plural endet auf -i, nicht auf -e — sie verhalten sich also männlich, wie sie es auch sind." },
        { t: "table", head: ["Singular", "Plural"], rows: [
          ["il problema", "i problemi"],
          ["il cinema", "i cinema"],
        ] },
        { t: "bad", wrong: "la problema", right: "il problema" },
      ] },
      { blocks: [
        { t: "p", de: "Und der berühmteste Einzelfall: la mano endet auf -o und ist weiblich. Ihr Plural ist le mani." },
        { t: "ex", it: "la mano", de: "die Hand" },
        { t: "ex", it: "le mani", de: "die Hände" },
        { t: "p", de: "l'uomo baut seinen Plural gleich ganz neu:" },
        { t: "ex", it: "l'uomo", de: "der Mann" },
        { t: "ex", it: "gli uomini", de: "die Männer" },
      ] },
      { blocks: [
        { t: "p", de: "Zuletzt die abgekürzten Wörter. la foto ist die Kurzform von la fotografia — sie behält deren Geschlecht und ändert sich nicht mehr." },
        { t: "ex", it: "la foto", de: "das Foto" },
        { t: "ex", it: "le foto", de: "die Fotos" },
        { t: "rule", de: "Diese Wörter lernt man einzeln. Es sind so wenige, dass das billiger ist als jede Regel." },
      ] },
    ],
    drills: [
      { k: "pick", q: "Plural von", word: "la città", a: "le città", d: ["le citte", "i città", "le cittade"] },
      { k: "pick", q: "Plural von", word: "il bar", a: "i bar", d: ["i bari", "le bar", "i barri"] },
      { k: "pick", q: "Welcher Artikel gehört zu", word: "problema", a: "il", d: ["la", "lo", "gli"] },
      { k: "pick", q: "Welcher Artikel gehört zu", word: "mano", a: "la", d: ["il", "lo", "gli"] },
      { k: "pick", q: "Plural von", word: "l'uomo", a: "gli uomini", d: ["gli uomi", "le uomini", "i uomo"] },
      { k: "pair", leftLabel: "einer", rightLabel: "viele", pairs: [
        ["la città", "le città"], ["il film", "i film"], ["la mano", "le mani"],
        ["il problema", "i problemi"], ["l'uomo", "gli uomini"],
      ] },
      { k: "gap", it: "Tu hai un problema", de: "Du hast ein Problem", a: "un", d: ["una", "uno", "un'"] },
      { k: "gap", it: "Io ho due mani", de: "Ich habe zwei Hände", a: "mani", d: ["mano", "mane", "manie"] },
      { k: "write", q: "Plural von", word: "l'università", a: "le università", strict: true },
      { k: "write", q: "Mit Artikel:", word: "die Hand", a: "la mano", strict: true },
      { k: "write", q: "Plural von", word: "il problema", a: "i problemi", strict: true },
      { k: "build", it: "Le città italiane sono belle", de: "Die italienischen Städte sind schön", extra: ["la", "bello"] },
    ],
  },

];

Object.assign(window.Incanto, { GRAMMAR_UNITS, GRAMMAR_LECTURES });
