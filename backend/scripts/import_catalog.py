"""Importe (ou met à jour) le catalogue de cartes depuis krcg.

Usage, depuis `backend/` :

    uv run python scripts/import_catalog.py                 # télécharge krcg
    uv run python scripts/import_catalog.py --from-dir DIR  # fichiers locaux
    uv run python scripts/import_catalog.py --json          # rapport en JSON

Rejouable sans risque : c'est un upsert (cf. `app.services.catalog_import`).
La base visée est celle de `DATABASE_URL` (défaut : `backend/vtes.db`) ; le
schéma doit exister (`uv run alembic upgrade head`).

`--json` sort le rapport sur la sortie standard au lieu du résumé en texte,
pour un déclenchement sans humain devant la console (le serveur déployé,
Lot 11). Dans les deux cas, une carte sous extension tampon (D2b) ou à
réattribuer (D2c) est signalée en avertissement sur la sortie d'erreur, sans
faire échouer l'import.
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
    ImportReport,
    fetch_krcg_sources,
    import_catalog,
)


def _read_local(directory: Path) -> tuple[list[dict], list[dict]]:
    def load(name: str) -> list[dict]:
        with (directory / name).open(encoding="utf-8") as f:
            return json.load(f)

    return load("vtes.json"), load("expansions.json")


def _report_dict(report: ImportReport) -> dict:
    return {
        "cards": report.cards,
        "cards_created": report.cards_created,
        "cards_updated": report.cards_updated,
        "card_sets": report.card_sets,
        "bundles": report.bundles,
        "translations": report.translations,
        "placeholder_cards": [
            {"vekn_id": c.vekn_id, "name": c.name} for c in report.placeholder_cards
        ],
        "reassign_cards": [
            {"vekn_id": c.vekn_id, "name": c.name} for c in report.reassign_cards
        ],
    }


def _warn_placeholders(report: ImportReport) -> None:
    if report.placeholder_cards:
        names = ", ".join(
            f"{c.name} (#{c.vekn_id})" for c in report.placeholder_cards
        )
        print(
            f"Avertissement : {len(report.placeholder_cards)} carte(s) sans "
            f"impression connue chez krcg, rangée(s) sous l'extension tampon : "
            f"{names}. À corriger côté source (krcg) puis à réimporter.",
            file=sys.stderr,
        )
    if report.reassign_cards:
        names = ", ".join(f"{c.name} (#{c.vekn_id})" for c in report.reassign_cards)
        print(
            f"Avertissement : {len(report.reassign_cards)} carte(s) à "
            f"réattribuer : une impression tampon reste utilisée par le stock "
            f"alors qu'une impression réelle est désormais connue : {names}.",
            file=sys.stderr,
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--from-dir",
        type=Path,
        help="Dossier contenant vtes.json et expansions.json (pas de téléchargement).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Rapport en JSON sur la sortie standard, au lieu du résumé en texte.",
    )
    args = parser.parse_args()

    vtes, expansions = (
        _read_local(args.from_dir) if args.from_dir else fetch_krcg_sources()
    )
    with SessionLocal() as session:
        report = import_catalog(session, vtes, expansions)

    if args.json:
        print(json.dumps(_report_dict(report), ensure_ascii=False))
    else:
        print(
            f"Catalogue importé : {report.cards} cartes "
            f"({report.cards_created} nouvelles, {report.cards_updated} mises à jour), "
            f"{report.card_sets} extensions, {report.bundles} produits, "
            f"{report.translations} traductions."
        )
    _warn_placeholders(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
