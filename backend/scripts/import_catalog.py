"""Importe (ou met à jour) le catalogue de cartes depuis krcg et vtescsv.

Usage, depuis `backend/` :

    uv run python scripts/import_catalog.py                 # télécharge
    uv run python scripts/import_catalog.py --from-dir DIR  # fichiers locaux
    uv run python scripts/import_catalog.py --json          # rapport en JSON

Sans `--from-dir`, trois fichiers sont téléchargés avant de toucher la base :
`vtes.json` et `expansions.json` de krcg, et `vteslibmeta.csv` de vtescsv
(exigences des cartes de bibliothèque, lot Chercher) ; l'échec de l'un fait
échouer l'import. Avec `--from-dir`, `vtes.json` et `expansions.json` sont
obligatoires et `vteslibmeta.csv` facultatif : absent, les exigences déjà en
base restent telles quelles, ce que la sortie d'erreur signale.

Rejouable sans risque : c'est un upsert (cf. `app.services.catalog_import`).
La base visée est celle de `DATABASE_URL` (défaut : `backend/vtes.db`) ; le
schéma doit exister (`uv run alembic upgrade head`).

`--json` sort le rapport sur la sortie standard au lieu du résumé en texte,
pour un déclenchement sans humain devant la console (le serveur déployé,
Lot 11). Dans les deux cas, une carte sous extension tampon (D2b) ou à
réattribuer (D2c), un vampire dont la secte n'a pas pu être dérivée, et une
ligne de `vteslibmeta.csv` en écart avec krcg sont signalés en avertissement
sur la sortie d'erreur, sans faire échouer l'import.
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
    LIBRARY_META_FILE,
    ImportReport,
    LibraryMetaRow,
    fetch_krcg_sources,
    fetch_library_meta,
    import_catalog,
    parse_library_meta,
)

Sources = tuple[list[dict], list[dict], list[LibraryMetaRow] | None]


def _read_local(directory: Path) -> Sources:
    def load(name: str) -> list[dict]:
        with (directory / name).open(encoding="utf-8") as f:
            return json.load(f)

    meta_path = directory / LIBRARY_META_FILE
    library_meta = (
        parse_library_meta(meta_path.read_text(encoding="utf-8-sig"))
        if meta_path.is_file()
        else None
    )
    return load("vtes.json"), load("expansions.json"), library_meta


def _download() -> Sources:
    vtes, expansions = fetch_krcg_sources()
    return vtes, expansions, parse_library_meta(fetch_library_meta())


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
        "crypt_sects": dict(sorted(report.crypt_sects.items())),
        "unknown_sect_cards": [
            {"vekn_id": c.vekn_id, "name": c.name} for c in report.unknown_sect_cards
        ],
        "library_requirements": report.library_requirements,
        "library_meta_issues": [
            {
                "id": issue.row_id,
                "name": issue.name,
                "reason": issue.reason,
                "catalog_name": issue.catalog_name,
            }
            for issue in report.library_meta_issues
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


def _warn_lot_chercher(report: ImportReport) -> None:
    """Secte non dérivée, exigences non lues ou en écart (lot Chercher)."""
    if report.unknown_sect_cards:
        names = ", ".join(
            f"{c.name} (#{c.vekn_id})" for c in report.unknown_sect_cards
        )
        print(
            f"Avertissement : {len(report.unknown_sect_cards)} carte(s) de "
            f"crypte dont le texte ne commence pas par une secte connue, "
            f"laissée(s) sans secte : {names}.",
            file=sys.stderr,
        )
    if report.library_requirements is None:
        print(
            f"Avertissement : {LIBRARY_META_FILE} absent, exigences des cartes "
            "de bibliothèque laissées telles quelles.",
            file=sys.stderr,
        )
    if report.library_meta_issues:
        lines = "; ".join(
            f"{i.reason} #{i.row_id or '?'} {i.name!r}"
            + (f" (krcg : {i.catalog_name!r})" if i.catalog_name else "")
            for i in report.library_meta_issues
        )
        print(
            f"Avertissement : {len(report.library_meta_issues)} ligne(s) de "
            f"{LIBRARY_META_FILE} en écart avec le catalogue : {lines}.",
            file=sys.stderr,
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--from-dir",
        type=Path,
        help=(
            "Dossier contenant vtes.json et expansions.json, et facultativement "
            "vteslibmeta.csv (pas de téléchargement)."
        ),
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Rapport en JSON sur la sortie standard, au lieu du résumé en texte.",
    )
    args = parser.parse_args()

    vtes, expansions, library_meta = (
        _read_local(args.from_dir) if args.from_dir else _download()
    )
    with SessionLocal() as session:
        report = import_catalog(session, vtes, expansions, library_meta)

    if args.json:
        print(json.dumps(_report_dict(report), ensure_ascii=False))
    else:
        print(
            f"Catalogue importé : {report.cards} cartes "
            f"({report.cards_created} nouvelles, {report.cards_updated} mises à jour), "
            f"{report.card_sets} extensions, {report.bundles} produits, "
            f"{report.translations} traductions, "
            f"{sum(report.crypt_sects.values())} sectes de crypte, "
            f"{report.library_requirements or 0} exigences de bibliothèque."
        )
    _warn_placeholders(report)
    _warn_lot_chercher(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
