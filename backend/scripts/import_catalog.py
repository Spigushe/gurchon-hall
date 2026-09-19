"""Importe (ou met à jour) le catalogue de cartes depuis krcg.

Usage, depuis `backend/` :

    uv run python scripts/import_catalog.py                 # télécharge krcg
    uv run python scripts/import_catalog.py --from-dir DIR  # fichiers locaux

Rejouable sans risque : c'est un upsert (cf. `app.services.catalog_import`).
La base visée est celle de `DATABASE_URL` (défaut : `backend/vtes.db`) ; le
schéma doit exister (`uv run alembic upgrade head`).
"""

import argparse
import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent

# Permet d'exécuter le script directement, sans avoir installé le paquet `app`.
sys.path.insert(0, str(BACKEND_DIR))

from app.db.session import SessionLocal  # noqa: E402
from app.services.catalog_import import (  # noqa: E402
    fetch_krcg_sources,
    import_catalog,
)


def _read_local(directory: Path) -> tuple[list[dict], list[dict]]:
    def load(name: str) -> list[dict]:
        with (directory / name).open(encoding="utf-8") as f:
            return json.load(f)

    return load("vtes.json"), load("expansions.json")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--from-dir",
        type=Path,
        help="Dossier contenant vtes.json et expansions.json (pas de téléchargement).",
    )
    args = parser.parse_args()

    vtes, expansions = (
        _read_local(args.from_dir) if args.from_dir else fetch_krcg_sources()
    )
    with SessionLocal() as session:
        report = import_catalog(session, vtes, expansions)

    print(
        f"Catalogue importé : {report.cards} cartes "
        f"({report.cards_created} nouvelles, {report.cards_updated} mises à jour), "
        f"{report.card_sets} extensions, {report.bundles} produits, "
        f"{report.translations} traductions."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
