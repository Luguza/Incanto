"use strict";
// ==============================================================================
// content.js — vocabulary + sentence data. Owns: WORD_POOL, SENTENCE_POOL,
// BLANKS_BY_POS, SENTENCE_WORDS, CONJ_PERSONS, CONJ_POOL. Edit here to add/adjust
// vocab, sentences and verb paradigms.
// ==============================================================================

// ---------------------------------------------------------------------------
// Word pool — the A1 (beginner) Italian vocabulary, drawn in order and cycled.
// Each entry pairs the Italian word (`it`, shown in the circle) with its German
// meaning (`de`). Nouns keep their article in both languages so the learner
// absorbs gender; verbs are given as infinitives, everything else in its base
// form. Grouped by theme for upkeep; the game treats it as one flat list.
//
// Where the A1 scope comes from
// -----------------------------
// The pool covers the official A1 lexical inventory of the *Profilo della lingua
// italiana. Livelli del QCER A1, A2, B1, B2* (Spinelli & Parizzi 2010) — the
// CEFR reference-level description for Italian, published by the CVCL of the
// Università per Stranieri di Perugia. Its A1 list is 486 lemmas:
//   https://www.unistrapg.it/profilo_lingua_italiana/site/liste_lessicali_a1.html
// All 486 are represented here, with two deliberate exceptions: the bare
// definite articles (il, lo, la, i, gli, le) and the indefinite un/o/a. Seven
// cards that all answer "der/die/das" teach nothing and cannot be marked right —
// Italian gender is taught the way it is actually used, by the article each noun
// below carries. Everything beyond the 486 is extra the game already had (more
// animals, body parts, colours, numbers); it is kept, not pruned.
//
// …and the practical layer on top of it
// -------------------------------------
// A syllabus list is not the same as what people say. So the pool also carries
// everyday phrases ("come stai?", "quanto costa?", "mi dispiace"), the discourse
// glue that joins spoken sentences (allora, quindi, però, magari, purtroppo),
// the high-frequency verbs the A1 list skips (chiedere, credere, riuscire,
// conoscere) and the abstractions that fill ordinary talk (la gente, la volta,
// il modo). These were checked against the *Nuovo vocabolario di base della
// lingua italiana* (De Mauro & Chiari 2016) through dizionario.internazionale.it:
// all but a few carry the FO mark — the ~2000 lemmas that make up 86% of
// everything written or spoken in Italian.
//
// Two things to respect when adding a phrase. `normAnswer` in quiz.js turns an
// apostrophe into a space, so a German gloss must not contain one ("wie geht es
// dir?", never "wie geht's?") or nobody can type it. And the rune circle draws
// each word as one un-wrapped SVG <text> in a 48px-radius bubble, so anything
// much past ~16 characters starts to hang over the edge.
//
// To re-check coverage after editing, diff the `it` fields (minus their article)
// against that page's numbered list.
// ---------------------------------------------------------------------------
const WORD_POOL = [
  // Greetings & courtesy
  { it: "ciao", de: "hallo" },
  { it: "buongiorno", de: "guten Morgen" },
  { it: "buonasera", de: "guten Abend" },
  { it: "buonanotte", de: "gute Nacht" },
  { it: "arrivederci", de: "auf Wiedersehen" },
  { it: "grazie", de: "danke" },
  { it: "prego", de: "gern geschehen" },
  { it: "per favore", de: "bitte" },
  { it: "scusa", de: "Entschuldigung" },
  { it: "sì", de: "ja" },
  { it: "l'affetto", de: "die Zuneigung" },
  { it: "l'augurio", de: "der Glückwunsch" },
  { it: "il saluto", de: "der Gruß" },
  { it: "il bacio", de: "der Kuss" },
  { it: "l'attenzione", de: "die Aufmerksamkeit" },
  { it: "il favore", de: "der Gefallen" },
  { it: "il piacere", de: "das Vergnügen" },
  { it: "la cosa", de: "die Sache" },
  { it: "aiuto", de: "Hilfe" },
  { it: "cin cin", de: "Prost" },
  { it: "salute", de: "Gesundheit" },

  // Everyday phrases — the chunks a beginner actually says out loud
  { it: "come stai?", de: "wie geht es dir?" },
  { it: "come va?", de: "wie läuft es?" },
  { it: "va bene", de: "in Ordnung" },
  { it: "d'accordo", de: "einverstanden" },
  { it: "mi dispiace", de: "es tut mir leid" },
  { it: "non capisco", de: "ich verstehe nicht" },
  { it: "non lo so", de: "ich weiß es nicht" },
  { it: "quanto costa?", de: "was kostet das?" },
  { it: "quanti anni hai?", de: "wie alt bist du?" },
  { it: "mi chiamo", de: "ich heiße" },
  { it: "di niente", de: "keine Ursache" },
  { it: "a presto", de: "bis bald" },
  { it: "a domani", de: "bis morgen" },
  { it: "buon appetito", de: "guten Appetit" },
  { it: "buona fortuna", de: "viel Glück" },
  { it: "che peccato", de: "wie schade" },
  { it: "posso?", de: "darf ich?" },
  { it: "vorrei", de: "ich hätte gern" },
  { it: "ecco", de: "hier ist" },
  { it: "basta", de: "genug" },

  // People & family
  { it: "la famiglia", de: "die Familie" },
  { it: "la madre", de: "die Mutter" },
  { it: "il padre", de: "der Vater" },
  { it: "il figlio", de: "der Sohn" },
  { it: "la figlia", de: "die Tochter" },
  { it: "il fratello", de: "der Bruder" },
  { it: "la sorella", de: "die Schwester" },
  { it: "il nonno", de: "der Großvater" },
  { it: "la nonna", de: "die Großmutter" },
  { it: "il bambino", de: "das Kind" },
  { it: "l'uomo", de: "der Mann" },
  { it: "la donna", de: "die Frau" },
  { it: "l'amico", de: "der Freund" },
  { it: "il ragazzo", de: "der Junge" },
  { it: "la ragazza", de: "das Mädchen" },
  { it: "il nome", de: "der Name" },
  { it: "la mamma", de: "die Mama" },
  { it: "il papà", de: "der Papa" },
  { it: "il marito", de: "der Ehemann" },
  { it: "la moglie", de: "die Ehefrau" },
  { it: "maschio", de: "männlich" },
  { it: "femmina", de: "weiblich" },
  { it: "il compagno", de: "der Partner" },
  { it: "la signora", de: "die Dame" },
  { it: "il dottore", de: "der Arzt" },
  { it: "il professore", de: "der Lehrer" },
  { it: "l'insegnante", de: "die Lehrkraft" },
  { it: "lo studente", de: "der Student" },
  { it: "il turista", de: "der Tourist" },
  { it: "il cameriere", de: "der Kellner" },

  // Body
  { it: "la testa", de: "der Kopf" },
  { it: "la faccia", de: "das Gesicht" },
  { it: "la mano", de: "die Hand" },
  { it: "il piede", de: "der Fuß" },
  { it: "l'occhio", de: "das Auge" },
  { it: "la bocca", de: "der Mund" },
  { it: "il naso", de: "die Nase" },
  { it: "l'orecchio", de: "das Ohr" },
  { it: "il braccio", de: "der Arm" },
  { it: "la gamba", de: "das Bein" },
  { it: "il cuore", de: "das Herz" },
  { it: "i capelli", de: "die Haare" },
  { it: "il dente", de: "der Zahn" },
  { it: "gli occhiali", de: "die Brille" },
  { it: "la medicina", de: "die Medizin" },
  { it: "il sonno", de: "der Schlaf" },

  // Food & drink
  { it: "il cibo", de: "das Essen" },
  { it: "il pane", de: "das Brot" },
  { it: "l'acqua", de: "das Wasser" },
  { it: "il vino", de: "der Wein" },
  { it: "il latte", de: "die Milch" },
  { it: "il caffè", de: "der Kaffee" },
  { it: "il tè", de: "der Tee" },
  { it: "la birra", de: "das Bier" },
  { it: "la frutta", de: "das Obst" },
  { it: "la mela", de: "der Apfel" },
  { it: "l'arancia", de: "die Orange" },
  { it: "il formaggio", de: "der Käse" },
  { it: "la carne", de: "das Fleisch" },
  { it: "il pesce", de: "der Fisch" },
  { it: "l'uovo", de: "das Ei" },
  { it: "il riso", de: "der Reis" },
  { it: "il sale", de: "das Salz" },
  { it: "lo zucchero", de: "der Zucker" },
  { it: "la verdura", de: "das Gemüse" },
  { it: "il pollo", de: "das Hähnchen" },
  { it: "il gelato", de: "das Eis" },
  { it: "il burro", de: "die Butter" },
  { it: "il dolce", de: "der Nachtisch" },
  { it: "la colazione", de: "das Frühstück" },
  { it: "il pranzo", de: "das Mittagessen" },
  { it: "la cena", de: "das Abendessen" },
  { it: "l'aceto", de: "der Essig" },
  { it: "l'olio", de: "das Öl" },
  { it: "il pepe", de: "der Pfeffer" },
  { it: "il pomodoro", de: "die Tomate" },
  { it: "la pasta", de: "die Nudeln" },
  { it: "gli spaghetti", de: "die Spaghetti" },
  { it: "la pizza", de: "die Pizza" },
  { it: "il cappuccino", de: "der Cappuccino" },
  { it: "la fame", de: "der Hunger" },
  { it: "la sete", de: "der Durst" },

  // Table & restaurant
  { it: "la bottiglia", de: "die Flasche" },
  { it: "il bicchiere", de: "das Glas" },
  { it: "il coltello", de: "das Messer" },
  { it: "la forchetta", de: "die Gabel" },
  { it: "il cucchiaio", de: "der Löffel" },
  { it: "il piatto", de: "der Teller" },
  { it: "il menù", de: "die Speisekarte" },
  { it: "il conto", de: "die Rechnung" },

  // Animals
  { it: "il gatto", de: "die Katze" },
  { it: "il cane", de: "der Hund" },
  { it: "il cavallo", de: "das Pferd" },
  { it: "l'uccello", de: "der Vogel" },
  { it: "la mucca", de: "die Kuh" },
  { it: "il topo", de: "die Maus" },
  { it: "il maiale", de: "das Schwein" },
  { it: "la pecora", de: "das Schaf" },

  // Home & objects
  { it: "la casa", de: "das Haus" },
  { it: "la porta", de: "die Tür" },
  { it: "la finestra", de: "das Fenster" },
  { it: "la sedia", de: "der Stuhl" },
  { it: "il tavolo", de: "der Tisch" },
  { it: "il letto", de: "das Bett" },
  { it: "la cucina", de: "die Küche" },
  { it: "il bagno", de: "das Badezimmer" },
  { it: "la camera", de: "das Zimmer" },
  { it: "la chiave", de: "der Schlüssel" },
  { it: "il libro", de: "das Buch" },
  { it: "la penna", de: "der Stift" },
  { it: "la carta", de: "das Papier" },
  { it: "la lampada", de: "die Lampe" },
  { it: "lo specchio", de: "der Spiegel" },
  { it: "il telefono", de: "das Telefon" },
  { it: "l'orologio", de: "die Uhr" },
  { it: "l'appartamento", de: "die Wohnung" },
  { it: "il giardino", de: "der Garten" },
  { it: "la doccia", de: "die Dusche" },
  { it: "il soggiorno", de: "das Wohnzimmer" },
  { it: "il piano", de: "die Etage" },
  { it: "il quadro", de: "das Bild" },
  { it: "la pianta", de: "die Pflanze" },
  { it: "l'ombrello", de: "der Schirm" },
  { it: "la matita", de: "der Bleistift" },
  { it: "il quaderno", de: "das Heft" },
  { it: "la sigaretta", de: "die Zigarette" },
  { it: "l'animale", de: "das Tier" },

  // Clothes
  { it: "il vestito", de: "das Kleid" },
  { it: "la scarpa", de: "der Schuh" },
  { it: "il cappello", de: "der Hut" },
  { it: "la giacca", de: "die Jacke" },
  { it: "i pantaloni", de: "die Hose" },
  { it: "la camicia", de: "das Hemd" },
  { it: "la borsa", de: "die Tasche" },
  { it: "la calza", de: "die Socke" },
  { it: "la gonna", de: "der Rock" },
  { it: "la maglietta", de: "das T-Shirt" },
  { it: "il maglione", de: "der Pullover" },
  { it: "il cappotto", de: "der Mantel" },

  // Nature
  { it: "il sole", de: "die Sonne" },
  { it: "la luna", de: "der Mond" },
  { it: "la stella", de: "der Stern" },
  { it: "il cielo", de: "der Himmel" },
  { it: "il mare", de: "das Meer" },
  { it: "la montagna", de: "der Berg" },
  { it: "il fiume", de: "der Fluss" },
  { it: "l'albero", de: "der Baum" },
  { it: "il fiore", de: "die Blume" },
  { it: "la pioggia", de: "der Regen" },
  { it: "la neve", de: "der Schnee" },
  { it: "il vento", de: "der Wind" },
  { it: "il fuoco", de: "das Feuer" },
  { it: "la terra", de: "die Erde" },
  { it: "il bosco", de: "der Wald" },
  { it: "la spiaggia", de: "der Strand" },

  // Time
  { it: "il giorno", de: "der Tag" },
  { it: "la notte", de: "die Nacht" },
  { it: "la mattina", de: "der Morgen" },
  { it: "la sera", de: "der Abend" },
  { it: "la settimana", de: "die Woche" },
  { it: "il mese", de: "der Monat" },
  { it: "l'anno", de: "das Jahr" },
  { it: "l'ora", de: "die Stunde" },
  { it: "il tempo", de: "die Zeit" },
  { it: "oggi", de: "heute" },
  { it: "domani", de: "morgen" },
  { it: "ieri", de: "gestern" },
  { it: "adesso", de: "jetzt" },
  { it: "sempre", de: "immer" },
  { it: "mai", de: "nie" },
  { it: "presto", de: "früh" },
  { it: "tardi", de: "spät" },
  { it: "il minuto", de: "die Minute" },
  { it: "il secondo", de: "die Sekunde" },
  { it: "il quarto", de: "das Viertel" },
  { it: "la metà", de: "die Hälfte" },
  { it: "il mezzogiorno", de: "der Mittag" },
  { it: "la mezzanotte", de: "die Mitternacht" },
  { it: "il pomeriggio", de: "der Nachmittag" },
  { it: "la giornata", de: "der ganze Tag" },

  // Days of the week
  { it: "lunedì", de: "Montag" },
  { it: "martedì", de: "Dienstag" },
  { it: "mercoledì", de: "Mittwoch" },
  { it: "giovedì", de: "Donnerstag" },
  { it: "venerdì", de: "Freitag" },
  { it: "sabato", de: "Samstag" },
  { it: "domenica", de: "Sonntag" },

  // Months
  { it: "gennaio", de: "Januar" },
  { it: "febbraio", de: "Februar" },
  { it: "marzo", de: "März" },
  { it: "aprile", de: "April" },
  { it: "maggio", de: "Mai" },
  { it: "giugno", de: "Juni" },
  { it: "luglio", de: "Juli" },
  { it: "agosto", de: "August" },
  { it: "settembre", de: "September" },
  { it: "ottobre", de: "Oktober" },
  { it: "novembre", de: "November" },
  { it: "dicembre", de: "Dezember" },

  // Seasons & holidays
  { it: "la primavera", de: "der Frühling" },
  { it: "l'estate", de: "der Sommer" },
  { it: "l'autunno", de: "der Herbst" },
  { it: "l'inverno", de: "der Winter" },
  { it: "Natale", de: "Weihnachten" },
  { it: "Pasqua", de: "Ostern" },

  // Colours
  { it: "rosso", de: "rot" },
  { it: "blu", de: "blau" },
  { it: "verde", de: "grün" },
  { it: "giallo", de: "gelb" },
  { it: "nero", de: "schwarz" },
  { it: "bianco", de: "weiß" },
  { it: "grigio", de: "grau" },
  { it: "rosa", de: "rosa" },
  { it: "arancione", de: "orange" },
  { it: "marrone", de: "braun" },

  // Numbers
  { it: "uno", de: "eins" },
  { it: "due", de: "zwei" },
  { it: "tre", de: "drei" },
  { it: "quattro", de: "vier" },
  { it: "cinque", de: "fünf" },
  { it: "sei", de: "sechs" },
  { it: "sette", de: "sieben" },
  { it: "otto", de: "acht" },
  { it: "nove", de: "neun" },
  { it: "dieci", de: "zehn" },

  // Adjectives
  { it: "grande", de: "groß" },
  { it: "piccolo", de: "klein" },
  { it: "buono", de: "gut" },
  { it: "cattivo", de: "schlecht" },
  { it: "bello", de: "schön" },
  { it: "brutto", de: "hässlich" },
  { it: "nuovo", de: "neu" },
  { it: "vecchio", de: "alt" },
  { it: "caldo", de: "heiß" },
  { it: "freddo", de: "kalt" },
  { it: "alto", de: "hoch" },
  { it: "basso", de: "niedrig" },
  { it: "lungo", de: "lang" },
  { it: "corto", de: "kurz" },
  { it: "facile", de: "einfach" },
  { it: "difficile", de: "schwierig" },
  { it: "felice", de: "glücklich" },
  { it: "triste", de: "traurig" },
  { it: "veloce", de: "schnell" },
  { it: "lento", de: "langsam" },
  { it: "forte", de: "stark" },
  { it: "debole", de: "schwach" },
  { it: "giovane", de: "jung" },
  { it: "ricco", de: "reich" },
  { it: "povero", de: "arm" },
  { it: "pieno", de: "voll" },
  { it: "vuoto", de: "leer" },
  { it: "pulito", de: "sauber" },
  { it: "sporco", de: "schmutzig" },
  { it: "attento", de: "aufmerksam" },
  { it: "biondo", de: "blond" },
  { it: "caro", de: "teuer" },
  { it: "castano", de: "braunhaarig" },
  { it: "doppio", de: "doppelt" },
  { it: "falso", de: "falsch" },
  { it: "gentile", de: "freundlich" },
  { it: "importante", de: "wichtig" },
  { it: "intelligente", de: "intelligent" },
  { it: "interessante", de: "interessant" },
  { it: "internazionale", de: "international" },
  { it: "largo", de: "breit" },
  { it: "magro", de: "dünn" },
  { it: "malato", de: "krank" },
  { it: "mezzo", de: "halb" },
  { it: "simpatico", de: "sympathisch" },
  { it: "singolo", de: "einzeln" },
  { it: "stanco", de: "müde" },
  { it: "straniero", de: "ausländisch" },
  { it: "stretto", de: "eng" },
  { it: "vero", de: "wahr" },
  { it: "bravo", de: "tüchtig" },
  { it: "mio", de: "mein" },
  { it: "tuo", de: "dein" },
  { it: "quello", de: "jener" },
  { it: "questo", de: "dieser" },

  // Verbs
  { it: "essere", de: "sein" },
  { it: "avere", de: "haben" },
  { it: "fare", de: "machen" },
  { it: "andare", de: "gehen" },
  { it: "venire", de: "kommen" },
  { it: "stare", de: "bleiben" },
  { it: "mangiare", de: "essen" },
  { it: "bere", de: "trinken" },
  { it: "dormire", de: "schlafen" },
  { it: "parlare", de: "sprechen" },
  { it: "dire", de: "sagen" },
  { it: "leggere", de: "lesen" },
  { it: "scrivere", de: "schreiben" },
  { it: "vedere", de: "sehen" },
  { it: "sentire", de: "hören" },
  { it: "capire", de: "verstehen" },
  { it: "sapere", de: "wissen" },
  { it: "volere", de: "wollen" },
  { it: "potere", de: "können" },
  { it: "dovere", de: "müssen" },
  { it: "vivere", de: "leben" },
  { it: "amare", de: "lieben" },
  { it: "giocare", de: "spielen" },
  { it: "lavorare", de: "arbeiten" },
  { it: "studiare", de: "lernen" },
  { it: "comprare", de: "kaufen" },
  { it: "aprire", de: "öffnen" },
  { it: "chiudere", de: "schließen" },
  { it: "guardare", de: "schauen" },
  { it: "ascoltare", de: "zuhören" },
  { it: "camminare", de: "laufen" },
  { it: "correre", de: "rennen" },
  { it: "pensare", de: "denken" },
  { it: "prendere", de: "nehmen" },
  { it: "dare", de: "geben" },
  { it: "trovare", de: "finden" },
  { it: "chiamare", de: "rufen" },
  { it: "aspettare", de: "warten" },
  { it: "arrivare", de: "ankommen" },
  { it: "partire", de: "abfahren" },
  { it: "pagare", de: "bezahlen" },
  { it: "cucinare", de: "kochen" },
  // -isc- verbs (and one more irregular): they earn their place in the pool by
  // being the patterns the conjugation drills below need more than one example of
  { it: "finire", de: "beenden" },
  { it: "preferire", de: "bevorzugen" },
  { it: "pulire", de: "putzen" },
  { it: "uscire", de: "hinausgehen" },
  { it: "abitare", de: "wohnen" },
  { it: "ballare", de: "tanzen" },
  { it: "cambiare", de: "wechseln" },
  { it: "cantare", de: "singen" },
  { it: "cenare", de: "zu Abend essen" },
  { it: "cercare", de: "suchen" },
  { it: "cominciare", de: "anfangen" },
  { it: "costare", de: "kosten" },
  { it: "domandare", de: "fragen" },
  { it: "entrare", de: "eintreten" },
  { it: "fumare", de: "rauchen" },
  { it: "imparare", de: "lernen" },
  { it: "incontrare", de: "treffen" },
  { it: "insegnare", de: "unterrichten" },
  { it: "mettere", de: "legen" },
  { it: "morire", de: "sterben" },
  { it: "nascere", de: "geboren werden" },
  { it: "piovere", de: "regnen" },
  { it: "portare", de: "tragen" },
  { it: "pranzare", de: "zu Mittag essen" },
  { it: "prenotare", de: "reservieren" },
  { it: "ripetere", de: "wiederholen" },
  { it: "rispondere", de: "antworten" },
  { it: "ritornare", de: "zurückkehren" },
  { it: "scusare", de: "entschuldigen" },
  { it: "significare", de: "bedeuten" },
  { it: "spedire", de: "verschicken" },
  { it: "sposare", de: "heiraten" },
  { it: "suonare", de: "spielen" },
  { it: "svegliarsi", de: "aufwachen" },
  { it: "telefonare", de: "anrufen" },
  { it: "tornare", de: "zurückkommen" },
  { it: "viaggiare", de: "reisen" },
  { it: "visitare", de: "besuchen" },
  { it: "vedersi", de: "sich sehen" },
  { it: "piacere", de: "gefallen" },

  // More of the verbs that carry ordinary talk
  { it: "chiedere", de: "bitten" },
  { it: "credere", de: "glauben" },
  { it: "sperare", de: "hoffen" },
  { it: "ricordare", de: "erinnern" },
  { it: "dimenticare", de: "vergessen" },
  { it: "provare", de: "versuchen" },
  { it: "usare", de: "benutzen" },
  { it: "aiutare", de: "helfen" },
  { it: "lasciare", de: "lassen" },
  { it: "tenere", de: "halten" },
  { it: "perdere", de: "verlieren" },
  { it: "vincere", de: "gewinnen" },
  { it: "succedere", de: "geschehen" },
  { it: "funzionare", de: "funktionieren" },
  { it: "diventare", de: "werden" },
  { it: "sembrare", de: "scheinen" },
  { it: "restare", de: "übrig bleiben" },
  { it: "servire", de: "dienen" },
  { it: "riuscire", de: "schaffen" },
  { it: "conoscere", de: "kennen" },

  // Places
  { it: "la città", de: "die Stadt" },
  { it: "il paese", de: "das Land" },
  { it: "la strada", de: "die Straße" },
  { it: "la scuola", de: "die Schule" },
  { it: "il negozio", de: "das Geschäft" },
  { it: "il ristorante", de: "das Restaurant" },
  { it: "l'ospedale", de: "das Krankenhaus" },
  { it: "la stazione", de: "der Bahnhof" },
  { it: "l'aeroporto", de: "der Flughafen" },
  { it: "la banca", de: "die Bank" },
  { it: "il parco", de: "der Park" },
  { it: "la chiesa", de: "die Kirche" },
  { it: "il mercato", de: "der Markt" },
  { it: "l'ufficio", de: "das Büro" },
  { it: "il museo", de: "das Museum" },
  { it: "la piazza", de: "der Platz" },
  { it: "l'albergo", de: "das Hotel" },
  { it: "l'hotel", de: "die Herberge" },
  { it: "il bar", de: "die Bar" },
  { it: "il cinema", de: "das Kino" },
  { it: "il teatro", de: "das Theater" },
  { it: "la pizzeria", de: "die Pizzeria" },
  { it: "il supermercato", de: "der Supermarkt" },
  { it: "la farmacia", de: "die Apotheke" },
  { it: "la posta", de: "die Post" },
  { it: "l'agenzia", de: "die Agentur" },
  { it: "l'ambasciata", de: "die Botschaft" },
  { it: "il consolato", de: "das Konsulat" },
  { it: "la polizia", de: "die Polizei" },
  { it: "l'università", de: "die Universität" },
  { it: "la fabbrica", de: "die Fabrik" },
  { it: "l'industria", de: "die Industrie" },
  { it: "il centro", de: "das Zentrum" },
  { it: "il parcheggio", de: "der Parkplatz" },
  { it: "la fermata", de: "die Haltestelle" },
  { it: "la via", de: "der Weg" },
  { it: "il lago", de: "der See" },
  { it: "la campagna", de: "das Land" },
  { it: "l'estero", de: "das Ausland" },
  { it: "il posto", de: "der Ort" },

  // Transport
  { it: "la macchina", de: "das Auto" },
  { it: "il treno", de: "der Zug" },
  { it: "l'autobus", de: "der Bus" },
  { it: "la bicicletta", de: "das Fahrrad" },
  { it: "l'aereo", de: "das Flugzeug" },
  { it: "la nave", de: "das Schiff" },

  // Travel & documents
  { it: "il viaggio", de: "die Reise" },
  { it: "la vacanza", de: "der Urlaub" },
  { it: "il biglietto", de: "die Fahrkarte" },
  { it: "il passaporto", de: "der Reisepass" },
  { it: "il documento", de: "das Dokument" },
  { it: "il visto", de: "das Visum" },
  { it: "il check-in", de: "der Check-in" },
  { it: "la moto", de: "das Motorrad" },
  { it: "il taxi", de: "das Taxi" },
  { it: "lo stop", de: "das Stoppschild" },
  { it: "la valigia", de: "der Koffer" },
  { it: "lo zaino", de: "der Rucksack" },

  // Everyday life
  { it: "il lavoro", de: "die Arbeit" },
  { it: "i soldi", de: "das Geld" },
  { it: "il regalo", de: "das Geschenk" },
  { it: "la festa", de: "die Party" },
  { it: "la musica", de: "die Musik" },
  { it: "il film", de: "der Film" },
  { it: "la parola", de: "das Wort" },
  { it: "la lingua", de: "die Sprache" },
  { it: "il numero", de: "die Zahl" },
  { it: "la domanda", de: "die Frage" },
  { it: "la risposta", de: "die Antwort" },
  { it: "il problema", de: "das Problem" },
  { it: "l'idea", de: "die Idee" },
  { it: "la vita", de: "das Leben" },
  { it: "l'amore", de: "die Liebe" },
  { it: "la storia", de: "die Geschichte" },
  { it: "il colore", de: "die Farbe" },

  // Communication & media
  { it: "il computer", de: "der Computer" },
  { it: "il cellulare", de: "das Handy" },
  { it: "la tv", de: "der Fernseher" },
  { it: "la televisione", de: "das Fernsehen" },
  { it: "la radio", de: "das Radio" },
  { it: "il cd", de: "die CD" },
  { it: "il fax", de: "das Fax" },
  { it: "l'e-mail", de: "die E-Mail" },
  { it: "internet", de: "das Internet" },
  { it: "la lettera", de: "der Brief" },
  { it: "la cartolina", de: "die Postkarte" },
  { it: "il francobollo", de: "die Briefmarke" },
  { it: "il giornale", de: "die Zeitung" },
  { it: "la fotografia", de: "das Foto" },
  { it: "la busta", de: "der Umschlag" },
  { it: "il pacco", de: "das Paket" },

  // School, study & leisure
  { it: "la lezione", de: "die Lektion" },
  { it: "la classe", de: "die Klasse" },
  { it: "il corso", de: "der Kurs" },
  { it: "l'esercizio", de: "die Übung" },
  { it: "l'alfabeto", de: "das Alphabet" },
  { it: "italiano", de: "Italienisch" },
  { it: "l'arte", de: "die Kunst" },
  { it: "lo sport", de: "der Sport" },
  { it: "l'hobby", de: "das Hobby" },
  { it: "la canzone", de: "das Lied" },

  // Money & shopping
  { it: "il prezzo", de: "der Preis" },
  { it: "l'euro", de: "der Euro" },
  { it: "la spesa", de: "der Einkauf" },
  { it: "il credito", de: "das Guthaben" },

  // Personal data & appointments
  { it: "il cognome", de: "der Nachname" },
  { it: "l'indirizzo", de: "die Adresse" },
  { it: "la nazionalità", de: "die Staatsangehörigkeit" },
  { it: "la nazione", de: "die Nation" },
  { it: "la data", de: "das Datum" },
  { it: "il compleanno", de: "der Geburtstag" },
  { it: "l'informazione", de: "die Information" },
  { it: "la segreteria", de: "das Sekretariat" },
  { it: "l'appuntamento", de: "der Termin" },
  { it: "il momento", de: "der Moment" },

  // Everyday abstractions
  { it: "la gente", de: "die Leute" },
  { it: "la volta", de: "das Mal" },
  { it: "il modo", de: "die Art" },
  { it: "la parte", de: "der Teil" },
  { it: "il fatto", de: "die Tatsache" },
  { it: "il caso", de: "der Fall" },
  { it: "il motivo", de: "der Grund" },
  { it: "il bisogno", de: "das Bedürfnis" },
  { it: "il pezzo", de: "das Stück" },
  { it: "il gruppo", de: "die Gruppe" },
  { it: "il punto", de: "der Punkt" },
  { it: "la ragione", de: "das Recht" },
  { it: "l'esempio", de: "das Beispiel" },
  { it: "la paura", de: "die Angst" },
  { it: "la fretta", de: "die Eile" },
  { it: "la fine", de: "das Ende" },

  // Question & function words
  { it: "chi", de: "wer" },
  { it: "che", de: "was" },
  { it: "dove", de: "wo" },
  { it: "quando", de: "wann" },
  { it: "perché", de: "warum" },
  { it: "come", de: "wie" },
  { it: "quanto", de: "wie viel" },
  { it: "molto", de: "sehr" },
  { it: "poco", de: "wenig" },
  { it: "tutto", de: "alles" },
  { it: "niente", de: "nichts" },
  { it: "qui", de: "hier" },
  { it: "là", de: "dort" },
  { it: "bene", de: "gut" },
  { it: "male", de: "schlecht" },
  { it: "anche", de: "auch" },
  { it: "ma", de: "aber" },
  { it: "con", de: "mit" },
  { it: "senza", de: "ohne" },
  { it: "sotto", de: "unter" },
  { it: "sopra", de: "über" },
  { it: "dentro", de: "drinnen" },
  { it: "fuori", de: "draußen" },
  { it: "vicino", de: "nah" },
  { it: "lontano", de: "weit" },
  { it: "a", de: "zu" },
  { it: "di", de: "von" },
  { it: "in", de: "in" },
  { it: "per", de: "für" },
  { it: "e", de: "und" },
  { it: "o", de: "oder" },
  { it: "no", de: "nein" },
  { it: "non", de: "nicht" },
  { it: "avanti", de: "vorwärts" },
  { it: "certo", de: "sicher" },
  { it: "davanti", de: "vorne" },
  { it: "dietro", de: "hinten" },
  { it: "dopo", de: "danach" },
  { it: "giù", de: "hinunter" },
  { it: "indietro", de: "zurück" },
  { it: "lì", de: "da" },
  { it: "meno", de: "weniger" },
  { it: "più", de: "mehr" },
  { it: "quasi", de: "fast" },
  { it: "spesso", de: "oft" },
  { it: "su", de: "hinauf" },
  { it: "qua", de: "hierher" },
  { it: "la destra", de: "die rechte Seite" },
  { it: "la sinistra", de: "die linke Seite" },
  { it: "tanto", de: "so viel" },
  { it: "troppo", de: "zu viel" },

  // Pronouns
  { it: "io", de: "ich" },
  { it: "tu", de: "du" },
  { it: "lui", de: "er" },
  { it: "lei", de: "sie" },
  { it: "noi", de: "wir" },
  { it: "voi", de: "ihr" },
  { it: "loro", de: "sie (Pl.)" },
  { it: "me", de: "mich" },
  { it: "te", de: "dich" },
  { it: "mi", de: "mir" },
  { it: "ti", de: "dir" },
  { it: "si", de: "sich" },
  { it: "ci", de: "uns" },
  { it: "nessuno", de: "niemand" },
  { it: "quale", de: "welcher" },

  // Discourse glue — the little words that join spoken sentences up
  { it: "allora", de: "also" },
  { it: "quindi", de: "deshalb" },
  { it: "però", de: "jedoch" },
  { it: "invece", de: "stattdessen" },
  { it: "anzi", de: "im Gegenteil" },
  { it: "almeno", de: "wenigstens" },
  { it: "soprattutto", de: "vor allem" },
  { it: "abbastanza", de: "ziemlich" },
  { it: "circa", de: "ungefähr" },
  { it: "insomma", de: "kurz gesagt" },
  { it: "comunque", de: "jedenfalls" },
  { it: "naturalmente", de: "natürlich" },
  { it: "volentieri", de: "gerne" },
  { it: "purtroppo", de: "leider" },
  { it: "davvero", de: "wirklich" },
  { it: "subito", de: "sofort" },
  { it: "insieme", de: "zusammen" },
  { it: "ancora", de: "noch" },
  { it: "già", de: "schon" },
  { it: "appena", de: "gerade eben" },
  { it: "forse", de: "vielleicht" },
  { it: "magari", de: "hoffentlich" },
];

// ---------------------------------------------------------------------------
// Sentence pool — short A1 Italian sentences with their German translation.
// These feed the "fill the blank" and "build the sentence" quiz exercises.
// `it` is the Italian sentence (tokens split on spaces), `de` its German
// meaning (shown as a hint), `blank` the single Italian token that gets removed
// for fill-in exercises, and `pos` its part of speech so that the multiple-
// choice distractors stay the same kind of word (noun/adj/verb) as the answer.
// ---------------------------------------------------------------------------
const SENTENCE_POOL = [
  { it: "Io bevo il caffè", de: "Ich trinke den Kaffee", blank: "caffè", pos: "noun" },
  { it: "Tu mangi il pane", de: "Du isst das Brot", blank: "pane", pos: "noun" },
  { it: "La mela è rossa", de: "Der Apfel ist rot", blank: "mela", pos: "noun" },
  { it: "Il cane è grande", de: "Der Hund ist groß", blank: "cane", pos: "noun" },
  { it: "La casa è bianca", de: "Das Haus ist weiß", blank: "casa", pos: "noun" },
  { it: "Beviamo molta acqua", de: "Wir trinken viel Wasser", blank: "acqua", pos: "noun" },
  { it: "Il bambino ha fame", de: "Das Kind hat Hunger", blank: "bambino", pos: "noun" },
  { it: "La madre legge un libro", de: "Die Mutter liest ein Buch", blank: "libro", pos: "noun" },
  { it: "Il padre lavora oggi", de: "Der Vater arbeitet heute", blank: "padre", pos: "noun" },
  { it: "Mangio una mela", de: "Ich esse einen Apfel", blank: "mela", pos: "noun" },
  { it: "Il vino è buono", de: "Der Wein ist gut", blank: "vino", pos: "noun" },
  { it: "La sorella ha un gatto", de: "Die Schwester hat eine Katze", blank: "gatto", pos: "noun" },
  { it: "Il fratello beve il tè", de: "Der Bruder trinkt den Tee", blank: "tè", pos: "noun" },
  { it: "La nonna fa il pane", de: "Die Großmutter macht das Brot", blank: "pane", pos: "noun" },
  { it: "Il pesce nuota nel mare", de: "Der Fisch schwimmt im Meer", blank: "pesce", pos: "noun" },
  { it: "Noi mangiamo il formaggio", de: "Wir essen den Käse", blank: "formaggio", pos: "noun" },
  { it: "La donna beve il vino", de: "Die Frau trinkt den Wein", blank: "vino", pos: "noun" },
  { it: "Ho un amico italiano", de: "Ich habe einen italienischen Freund", blank: "amico", pos: "noun" },
  { it: "La città è grande", de: "Die Stadt ist groß", blank: "città", pos: "noun" },
  { it: "Il libro è nuovo", de: "Das Buch ist neu", blank: "libro", pos: "noun" },
  { it: "Mangiamo la frutta", de: "Wir essen das Obst", blank: "frutta", pos: "noun" },
  { it: "Il latte è freddo", de: "Die Milch ist kalt", blank: "latte", pos: "noun" },
  { it: "La casa ha una porta", de: "Das Haus hat eine Tür", blank: "porta", pos: "noun" },
  { it: "Il gatto dorme", de: "Die Katze schläft", blank: "gatto", pos: "noun" },
  { it: "La ragazza è felice", de: "Das Mädchen ist glücklich", blank: "felice", pos: "adj" },
  { it: "Il ragazzo corre veloce", de: "Der Junge läuft schnell", blank: "veloce", pos: "adj" },
  { it: "Il caffè è caldo", de: "Der Kaffee ist heiß", blank: "caldo", pos: "adj" },
  { it: "La neve è bianca", de: "Der Schnee ist weiß", blank: "bianca", pos: "adj" },
  { it: "Il mare è grande", de: "Das Meer ist groß", blank: "grande", pos: "adj" },
  { it: "Oggi fa freddo", de: "Heute ist es kalt", blank: "freddo", pos: "adj" },
  { it: "Il cane mangia la carne", de: "Der Hund isst das Fleisch", blank: "mangia", pos: "verb" },
  { it: "La donna legge il libro", de: "Die Frau liest das Buch", blank: "legge", pos: "verb" },
  { it: "Noi beviamo il latte", de: "Wir trinken die Milch", blank: "beviamo", pos: "verb" },
  { it: "Il bambino dorme molto", de: "Das Kind schläft viel", blank: "dorme", pos: "verb" },
];

// Blank words grouped by part of speech, so fill-in distractors match the
// answer's kind of word (deduped once at load).
const BLANKS_BY_POS = (() => {
  const acc = {};
  for (const s of SENTENCE_POOL) (acc[s.pos] ||= []).push(s.blank);
  for (const k in acc) acc[k] = [...new Set(acc[k])];
  return acc;
})();

// Content-word pool used to pad the "build the sentence" word bank with a
// couple of plausible wrong tiles (all real words from the sentence corpus).
const SENTENCE_WORDS = [
  ...new Set(SENTENCE_POOL.flatMap((s) => s.it.split(" ").filter((w) => w.length > 2))),
];

// ---------------------------------------------------------------------------
// Conjugation — the present tense (presente indicativo) of the pool's verbs.
// This is what the conjugation exercises drill (see quiz.js): from picking one
// form out of four, up to writing the whole paradigm out from nothing.
//
// The six persons, in the order every table in the game lists them. `de` is the
// German pronoun the learner reads the row as; a slash means the one Italian
// form covers both German ones.
// ---------------------------------------------------------------------------
const CONJ_PERSONS = [
  { it: "io", de: "ich" },
  { it: "tu", de: "du" },
  { it: "lui / lei", de: "er / sie" },
  { it: "noi", de: "wir" },
  { it: "voi", de: "ihr" },
  { it: "loro", de: "sie (Pl.)" },
];

// The three regular classes plus -isc-: verbs like capire that wedge -isc- into
// the singular and the third person plural, which is a class of its own to a
// learner even though the grammar books file it under -ire.
const CONJ_ENDINGS = {
  are: ["o", "i", "a", "iamo", "ate", "ano"],
  ere: ["o", "i", "e", "iamo", "ete", "ono"],
  ire: ["o", "i", "e", "iamo", "ite", "ono"],
  isc: ["isco", "isci", "isce", "iamo", "ite", "iscono"],
};

// A regular verb's six forms, built from the stem so the pattern stays a pattern
// (adding a regular verb below is one line, and it cannot disagree with itself).
// Two spelling rules keep the written form honest about the sound:
//  · -care/-gare grow an h before an i-ending, so the c/g stays hard
//    (giocare → giochi, not *gioci)
//  · -iare has only ever one i, so the stem's i is swallowed by an i-ending
//    (mangiare → mangi / mangiamo, not *mangii / *mangiiamo)
function conjugateRegular(inf, group) {
  const stem = inf.slice(0, -3);
  return CONJ_ENDINGS[group].map((end) => {
    if (group === "are" && /[cg]$/.test(stem) && end[0] === "i") return stem + "h" + end;
    if (stem.endsWith("i") && end[0] === "i") return stem + end.slice(1);
    return stem + end;
  });
}

// The verbs the drills draw from. `group` is the class its forms are built from;
// `irr` means the six forms are written out here because nothing generates them.
// Everything except the -isc- block also lives in WORD_POOL, so a conjugation
// answer is tallied against the same verb the rune circle teaches.
const CONJ_POOL = [
  // -are
  { it: "parlare", de: "sprechen", group: "are" },
  { it: "mangiare", de: "essen", group: "are" },
  { it: "amare", de: "lieben", group: "are" },
  { it: "giocare", de: "spielen", group: "are" },
  { it: "lavorare", de: "arbeiten", group: "are" },
  { it: "studiare", de: "lernen", group: "are" },
  { it: "comprare", de: "kaufen", group: "are" },
  { it: "guardare", de: "schauen", group: "are" },
  { it: "ascoltare", de: "zuhören", group: "are" },
  { it: "camminare", de: "laufen", group: "are" },
  { it: "pensare", de: "denken", group: "are" },
  { it: "trovare", de: "finden", group: "are" },
  { it: "chiamare", de: "rufen", group: "are" },
  { it: "aspettare", de: "warten", group: "are" },
  { it: "arrivare", de: "ankommen", group: "are" },
  { it: "pagare", de: "bezahlen", group: "are" },
  { it: "cucinare", de: "kochen", group: "are" },
  // -ere
  { it: "leggere", de: "lesen", group: "ere" },
  { it: "scrivere", de: "schreiben", group: "ere" },
  { it: "vedere", de: "sehen", group: "ere" },
  { it: "prendere", de: "nehmen", group: "ere" },
  { it: "correre", de: "rennen", group: "ere" },
  { it: "vivere", de: "leben", group: "ere" },
  { it: "chiudere", de: "schließen", group: "ere" },
  // -ire
  { it: "dormire", de: "schlafen", group: "ire" },
  { it: "sentire", de: "hören", group: "ire" },
  { it: "aprire", de: "öffnen", group: "ire" },
  { it: "partire", de: "abfahren", group: "ire" },
  // -ire with -isc-
  { it: "capire", de: "verstehen", group: "isc" },
  { it: "finire", de: "beenden", group: "isc" },
  { it: "preferire", de: "bevorzugen", group: "isc" },
  { it: "pulire", de: "putzen", group: "isc" },
  // irregular — the everyday verbs, which are exactly the ones that misbehave
  { it: "essere", de: "sein", group: "irr", forms: ["sono", "sei", "è", "siamo", "siete", "sono"] },
  { it: "avere", de: "haben", group: "irr", forms: ["ho", "hai", "ha", "abbiamo", "avete", "hanno"] },
  { it: "fare", de: "machen", group: "irr", forms: ["faccio", "fai", "fa", "facciamo", "fate", "fanno"] },
  { it: "andare", de: "gehen", group: "irr", forms: ["vado", "vai", "va", "andiamo", "andate", "vanno"] },
  { it: "venire", de: "kommen", group: "irr", forms: ["vengo", "vieni", "viene", "veniamo", "venite", "vengono"] },
  { it: "stare", de: "bleiben", group: "irr", forms: ["sto", "stai", "sta", "stiamo", "state", "stanno"] },
  { it: "dare", de: "geben", group: "irr", forms: ["do", "dai", "dà", "diamo", "date", "danno"] },
  { it: "dire", de: "sagen", group: "irr", forms: ["dico", "dici", "dice", "diciamo", "dite", "dicono"] },
  { it: "bere", de: "trinken", group: "irr", forms: ["bevo", "bevi", "beve", "beviamo", "bevete", "bevono"] },
  { it: "uscire", de: "hinausgehen", group: "irr", forms: ["esco", "esci", "esce", "usciamo", "uscite", "escono"] },
  { it: "sapere", de: "wissen", group: "irr", forms: ["so", "sai", "sa", "sappiamo", "sapete", "sanno"] },
  { it: "potere", de: "können", group: "irr", forms: ["posso", "puoi", "può", "possiamo", "potete", "possono"] },
  { it: "volere", de: "wollen", group: "irr", forms: ["voglio", "vuoi", "vuole", "vogliamo", "volete", "vogliono"] },
  { it: "dovere", de: "müssen", group: "irr", forms: ["devo", "devi", "deve", "dobbiamo", "dovete", "devono"] },
].map((v) => ({ ...v, forms: v.forms || conjugateRegular(v.it, v.group) }));

Object.assign(window.Incanto, {
  WORD_POOL, SENTENCE_POOL, SENTENCE_WORDS, BLANKS_BY_POS,
  CONJ_PERSONS, CONJ_ENDINGS, CONJ_POOL, conjugateRegular,
});
