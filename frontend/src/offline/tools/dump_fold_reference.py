"""Exporte la référence Python du repli de texte, pour le portage TypeScript.

Usage, depuis `backend/` :

    uv run python ../frontend/src/offline/tools/dump_fold_reference.py \
        --source <fold-source.json> \
        --fixture ../frontend/tests/unit/offline/fixtures/fold-parity.json

* `--source` : entrée de `gen_fold_data.mjs`, qui produit `core/foldData.ts`
  (classes de combinaison et repli de casse complet de cette version d'Unicode) ;
* `--fixture` : pour chaque point de code que `app.db.folding.fold_text` modifie,
  sa valeur repliée. Le test de parité de vitest la rejoue sur tout l'espace
  Unicode : c'est ce qui prouve que le TypeScript replie comme le back.

À relancer quand la version de Python (donc d'Unicode) change côté back.
"""

import argparse
import json
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "backend"))

from app.db.folding import fold_text  # noqa: E402

SURROGATES = range(0xD800, 0xE000)


def combining_ranges() -> list[list[int]]:
    """Plages de points de code dont la classe de combinaison n'est pas nulle."""
    ranges: list[list[int]] = []
    for cp in range(0x110000):
        if cp in SURROGATES or not unicodedata.combining(chr(cp)):
            continue
        if ranges and ranges[-1][1] == cp - 1:
            ranges[-1][1] = cp
        else:
            ranges.append([cp, cp])
    return ranges


def casefold_map() -> dict[str, str]:
    result = {}
    for cp in range(0x110000):
        if cp in SURROGATES:
            continue
        char = chr(cp)
        folded = char.casefold()
        if folded != char:
            result[f"{cp:x}"] = folded
    return result


def unassigned_ranges() -> list[list[int]]:
    """Plages de points de code non assignés dans cette version d'Unicode.

    Un moteur JS plus récent que Python peut connaître un caractère que ce
    dernier ignore : c'est le seul écart toléré par le test de parité.
    """
    ranges: list[list[int]] = []
    for cp in range(0x110000):
        if cp in SURROGATES or unicodedata.category(chr(cp)) != "Cn":
            continue
        if ranges and ranges[-1][1] == cp - 1:
            ranges[-1][1] = cp
        else:
            ranges.append([cp, cp])
    return ranges


def fold_fixture() -> dict[str, str]:
    result = {}
    for cp in range(0x110000):
        if cp in SURROGATES:
            continue
        char = chr(cp)
        folded = fold_text(char)
        if folded != char:
            result[f"{cp:x}"] = folded
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--fixture", required=True, type=Path)
    args = parser.parse_args()

    source = {
        "unicode_version": unicodedata.unidata_version,
        "python": sys.version.split()[0],
        "combining": combining_ranges(),
        "casefold": casefold_map(),
    }
    args.source.parent.mkdir(parents=True, exist_ok=True)
    args.source.write_text(json.dumps(source, ensure_ascii=False), encoding="utf-8")

    fixture = {
        "unicode_version": unicodedata.unidata_version,
        "python": sys.version.split()[0],
        "unassigned": unassigned_ranges(),
        "changed": fold_fixture(),
    }
    args.fixture.parent.mkdir(parents=True, exist_ok=True)
    args.fixture.write_text(
        json.dumps(fixture, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        f"Unicode {unicodedata.unidata_version} : "
        f"{len(source['combining'])} plages, "
        f"{len(source['casefold'])} replis, "
        f"{len(fixture['changed'])} points modifiés."
    )


if __name__ == "__main__":
    main()
