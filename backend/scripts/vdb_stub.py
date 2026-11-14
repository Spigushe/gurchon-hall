"""Prépare le dossier de la lecture simulée de VDB (`VDB_STUB_DIR`, Lot 9).

Sous `VDB_STUB_DIR`, la route `GET /vdb/decks/{id}` ne joint pas vdb.im : elle
lit `<dossier>/<id>.json` (`app.services.vdb_client`). Ce script remplit ce
dossier à partir des réponses réelles de l'API de VDB relevées le 2026-11-13
(`frontend/tests/fixtures/vdb/*-api.json`), chacune rangée sous l'identifiant
qu'elle porte (`deckid`). Il sert à faire tourner le back **sans réseau** :
développement hors connexion, recette à la main, e2e contre le vrai back.

Usage, depuis `backend/` :

    uv run python scripts/vdb_stub.py DOSSIER [--etat avant|apres]

Le dossier est créé au besoin. Il contient alors quatre decks :

- `4fc0ee5e9` : le deck de référence (`ref-api.json`) ;
- `31203cb9e` : le deck des cas difficiles, dans l'état choisi : `avant`
  (`maj-avant-api.json`, mêmes cartes que `difficile-api.json`, par défaut)
  ou `apres` (`maj-apres-api.json`, après sa modification dans VDB) ;
- `12761` : un deck de la TWDA (`twda-api.json`) ;
- `SV5:PCaine` : un précon (`precon-api.json`, fichier `SV5_PCaine.json`).

Tout autre identifiant rend « Deck VDB introuvable. » (404), comme chez VDB.

Pour éprouver la **mise à jour depuis VDB** (P7) : importer `31203cb9e` dans
l'état `avant`, relancer le script avec `--etat apres`, puis « Mettre à jour
depuis VDB ». Le back n'a pas à redémarrer : la route relit le fichier à
chaque appel, et le script écrit chaque fichier d'un bloc (fichier
temporaire puis renommage), si bien qu'une lecture ne tombe jamais sur un
fichier à moitié écrit.

Chaque réponse est relue par `parse_vdb_deck` avant d'être écrite : une
fixture qui ne passerait pas la route fait échouer le script.

Puis lancer le back avec la variable posée, par exemple sous PowerShell :

    $env:VDB_STUB_DIR = "$PWD\\.vdb-stub"; ..\\scripts\\run.ps1 dev

`backend/.vdb-stub/` est ignoré par git et sert de dossier par défaut
conseillé. Réglage de test, jamais posé en production.
"""

import argparse
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.services.vdb_client import parse_vdb_deck, stub_file_name  # noqa: E402

FIXTURES_DIR = BACKEND_DIR.parent / "frontend" / "tests" / "fixtures" / "vdb"

COMMON_FIXTURES = ("ref-api.json", "twda-api.json", "precon-api.json")
STATE_FIXTURES = {"avant": "maj-avant-api.json", "apres": "maj-apres-api.json"}


def _write_atomically(path: Path, body: bytes) -> None:
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_bytes(body)
    os.replace(temporary, path)


def prepare_stub(
    directory: Path, state: str = "avant", fixtures_dir: Path = FIXTURES_DIR
) -> list[tuple[str, Path]]:
    """Écrit les réponses simulées dans `directory` ; rend, dans l'ordre
    d'écriture, l'identifiant de chaque deck et le fichier qui le sert."""
    if state not in STATE_FIXTURES:
        raise ValueError(f"État inconnu : {state!r} (avant ou apres).")
    directory.mkdir(parents=True, exist_ok=True)
    written = []
    for name in (*COMMON_FIXTURES, STATE_FIXTURES[state]):
        body = (fixtures_dir / name).read_bytes()
        deck = parse_vdb_deck(body, fetched_at=datetime.now(UTC))
        target = directory / stub_file_name(deck.vdb_deck_id)
        _write_atomically(target, body)
        written.append((deck.vdb_deck_id, target))
    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("directory", type=Path, help="dossier de VDB_STUB_DIR")
    parser.add_argument(
        "--etat",
        choices=sorted(STATE_FIXTURES),
        default="avant",
        help="état du deck 31203cb9e (avant ou après sa modification chez VDB)",
    )
    args = parser.parse_args(argv)
    for vdb_deck_id, target in prepare_stub(args.directory, args.etat):
        print(f"{vdb_deck_id} -> {target}")
    print(f"VDB_STUB_DIR={args.directory.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
