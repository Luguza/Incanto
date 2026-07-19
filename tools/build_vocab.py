"""Build an Italian-German vocabulary database from a kaikki.org dump.

kaikki.org publishes machine-readable Wiktionary extracts (Wiktextract) as
JSONL — one JSON object per line, one line per word sense/entry. This script
turns such a dump into `assets/vocab_it_de.json`: a clean, deduplicated list of
Italian -> German pairs shaped for the game, each carrying the display form
(with article for nouns, the way the rune words expect), part of speech and
gender.

Which kaikki file to feed it
----------------------------
Use a dump that actually contains Italian->German *translations*. The Italian
Wiktionary edition does:

    https://kaikki.org/itwiktionary/    (pick the raw Wiktextract JSONL)

Each Italian lemma there carries a `translations` list with German entries
(code "de" / lang "Tedesco"). The English-Wiktionary "Italian" extract is
richer for gender/pos but keeps translation tables on the *English* lemma, so
it yields almost no German for Italian words — don't use it as the sole source.

The script also reads gzip directly, so either `foo.jsonl` or `foo.jsonl.gz`
works.

Usage
-----
    # 1. See what the dump actually looks like (always do this first):
    python tools/build_vocab.py --inspect 5 path/to/kaikki.jsonl.gz

    # 2. Extract:
    python tools/build_vocab.py path/to/kaikki.jsonl.gz --out assets/vocab_it_de.json

    # Optional: attach correct German der/die/das from the german-nouns CSV
    # (https://github.com/gambolputty/german-nouns) when the dump omits gender:
    python tools/build_vocab.py dump.jsonl.gz --german-nouns german_nouns.csv

The output is a plain JSON array; regenerating the game's inline WORD_POOL from
a curated subset of it is a separate, deliberate step.
"""
import argparse
import gzip
import io
import json
import sys
from collections import Counter

# --- language detection -----------------------------------------------------
DE_LANG_NAMES = {"german", "deutsch", "tedesco", "alemán", "allemand"}
DE_CODES = {"de", "deu", "ger"}


def open_maybe_gzip(path):
    """Open a .jsonl or .jsonl.gz path as a text stream."""
    if path.endswith(".gz"):
        return io.TextIOWrapper(gzip.open(path, "rb"), encoding="utf-8")
    return open(path, encoding="utf-8")


def iter_entries(path):
    with open_maybe_gzip(path) as fh:
        for lineno, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                # A handful of malformed lines are normal in big dumps.
                continue


# --- gender / article synthesis ---------------------------------------------
GENDERS = {"masculine": "m", "feminine": "f", "neuter": "n",
           "m": "m", "f": "f", "n": "n"}


def find_gender(entry):
    """Return 'm' / 'f' / 'n' (or None) by scanning the usual tag locations."""
    buckets = [entry.get("tags", [])]
    for sense in entry.get("senses", []):
        buckets.append(sense.get("tags", []))
    for form in entry.get("forms", []):
        buckets.append(form.get("tags", []))
    for tags in buckets:
        for t in tags or []:
            if t in GENDERS:
                return GENDERS[t]
    return None


def is_plural(entry):
    for sense in entry.get("senses", []):
        if "plural" in (sense.get("tags") or []):
            return True
    return "plural" in (entry.get("tags") or [])


_LO_STARTS = ("gn", "pn", "ps", "x", "y", "z")


def _needs_lo(word):
    w = word.lower()
    if w[:1] in "aeiouàèéìòù":
        return False  # handled as l'
    if w.startswith(_LO_STARTS):
        return True
    if w.startswith("s") and len(w) > 1 and w[1] not in "aeiouàèéìòù":
        return True  # s + consonant
    if w.startswith("i") and len(w) > 1 and w[1] in "aeiou":
        return True  # semiconsonant i
    return False


def italian_display(word, gender, plural):
    """Prefix the Italian article the way the hand-made pool does."""
    if not gender:
        return word
    vowel = word[:1].lower() in "aeiouàèéìòù"
    if plural:
        if gender == "f":
            return f"le {word}"
        return f"gli {word}" if (vowel or _needs_lo(word)) else f"i {word}"
    if vowel:
        return f"l'{word}"
    if gender == "f":
        return f"la {word}"
    return f"lo {word}" if _needs_lo(word) else f"il {word}"


DE_ARTICLE = {"m": "der", "f": "die", "n": "das"}


def german_display(word, gender, plural):
    if plural:
        return f"die {word}"
    if gender in DE_ARTICLE:
        return f"{DE_ARTICLE[gender]} {word}"
    return word


def load_german_nouns(path):
    """Map lowercase German noun -> gender letter from the german-nouns CSV."""
    import csv
    genders = {}
    with open(path, encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            noun = (row.get("lemma") or row.get("noun") or "").strip()
            g = (row.get("genus") or row.get("gender") or "").strip().lower()
            g = {"m": "m", "f": "f", "n": "n", "maskulinum": "m",
                 "femininum": "f", "neutrum": "n"}.get(g[:1] if g else "", None) or \
                {"m": "m", "f": "f", "n": "n"}.get(g, None)
            if noun and g:
                genders.setdefault(noun.lower(), g)
    return genders


# --- extraction -------------------------------------------------------------
def _iter_translation_records(entry):
    """Translations may live at the entry top level or under each sense."""
    yield from entry.get("translations", []) or []
    for sense in entry.get("senses", []) or []:
        yield from sense.get("translations", []) or []


def german_translations(entry):
    """Yield (german_word, de_gender_or_None) for the entry's DE translations."""
    for tr in _iter_translation_records(entry):
        code = (tr.get("code") or "").lower()
        lang = (tr.get("lang") or "").lower()
        if code in DE_CODES or lang in DE_LANG_NAMES:
            word = (tr.get("word") or "").strip()
            if not word:
                continue
            g = None
            for t in tr.get("tags", []) or []:
                if t in GENDERS:
                    g = GENDERS[t]
                    break
            yield word, g


def first_gloss(entry):
    for sense in entry.get("senses", []):
        gl = sense.get("glosses") or sense.get("raw_glosses")
        if gl:
            return gl[0]
    return None


def build(args):
    de_nouns = load_german_nouns(args.german_nouns) if args.german_nouns else {}
    seen = set()
    out = []
    stats = Counter()

    for entry in iter_entries(args.input):
        stats["lines"] += 1
        # Keep only Italian lemmas.
        if (entry.get("lang_code") or "").lower() != "it" and \
           (entry.get("lang") or "").lower() != "italian" and \
           (entry.get("lang") or "").lower() != "italiano":
            continue
        stats["italian"] += 1
        it_word = (entry.get("word") or "").strip()
        pos = entry.get("pos") or ""
        if not it_word:
            continue

        translations = list(german_translations(entry))
        if not translations:
            continue
        stats["with_de"] += 1

        is_noun = pos in ("noun", "name", "proper noun")
        it_gender = find_gender(entry) if is_noun else None
        plural = is_plural(entry)
        it_disp = italian_display(it_word, it_gender, plural) if is_noun else it_word

        for de_word, de_gender in translations:
            if is_noun and not de_gender:
                de_gender = de_nouns.get(de_word.lower())
            de_disp = german_display(de_word, de_gender, plural) if is_noun else de_word

            key = (it_disp.lower(), de_disp.lower())
            if key in seen:
                continue
            seen.add(key)
            out.append({
                "it": it_disp,
                "de": de_disp,
                "pos": pos,
                "it_lemma": it_word,
                "de_lemma": de_word,
                "it_gender": it_gender,
                "de_gender": de_gender,
                "gloss_en": first_gloss(entry),
            })

    out.sort(key=lambda e: (e["pos"], e["it"].lower()))
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=1)
        fh.write("\n")

    print(f"lines read      : {stats['lines']}")
    print(f"italian lemmas  : {stats['italian']}")
    print(f"  with a DE tr. : {stats['with_de']}")
    print(f"pairs written   : {len(out)}  -> {args.out}")
    pos_counts = Counter(e["pos"] for e in out)
    print("by part of speech:", dict(pos_counts.most_common()))
    nouns_no_gender = sum(1 for e in out if e["pos"] == "noun" and not e["it_gender"])
    print(f"nouns missing IT gender: {nouns_no_gender}")


def inspect(args):
    """Print a few Italian entries that carry a German translation."""
    shown = 0
    for entry in iter_entries(args.input):
        if (entry.get("lang_code") or "").lower() != "it":
            continue
        if not list(german_translations(entry)):
            continue
        print(json.dumps({
            "word": entry.get("word"),
            "pos": entry.get("pos"),
            "lang_code": entry.get("lang_code"),
            "tags": entry.get("tags"),
            "sense_tags": [s.get("tags") for s in entry.get("senses", [])][:2],
            "translations_de": list(german_translations(entry))[:6],
            "keys": sorted(entry.keys()),
        }, ensure_ascii=False, indent=1))
        print("-" * 60)
        shown += 1
        if shown >= args.inspect:
            break
    if shown == 0:
        print("No Italian entries with German translations found. "
              "Is this the itwiktionary dump? Try --inspect on the raw schema:")
        _inspect_raw(args)


def _inspect_raw(args):
    for i, entry in enumerate(iter_entries(args.input)):
        if i >= 3:
            break
        print(json.dumps(entry, ensure_ascii=False)[:800])
        print("-" * 60)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("input", help="kaikki Wiktextract dump (.jsonl or .jsonl.gz)")
    p.add_argument("--out", default="assets/vocab_it_de.json",
                   help="output JSON path (default: assets/vocab_it_de.json)")
    p.add_argument("--german-nouns", metavar="CSV",
                   help="optional german-nouns CSV to fill missing DE gender")
    p.add_argument("--inspect", type=int, metavar="N", default=0,
                   help="print N sample IT->DE entries and exit (no output file)")
    args = p.parse_args(argv)

    if args.inspect:
        inspect(args)
    else:
        build(args)


if __name__ == "__main__":
    main()
