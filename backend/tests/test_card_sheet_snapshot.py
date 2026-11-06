"""Instantané de la fiche `GET /cartes/{id}` (lot Chercher, A1, B1).

`CardRead` a gardé ses propriétés en A1, à l'exigence de bibliothèque près, mais
l'ordre de ses propriétés a changé (Pydantic range les champs hérités en
premier) : la comparaison porte sur le **contenu**, jamais sur le texte. Trois
fiches de la fixture krcg et de l'échantillon vtescsv : un vampire à
disciplines supérieures, une carte à exigence de titre, une carte à deux types.

Les identifiants techniques sont retirés : ils dépendent de l'ordre
d'insertion de l'import et ne disent rien du contenu. Les types et les
disciplines gardent leur ordre, défini depuis B1 ; impressions, occurrences et
traductions, sans ordre défini, sont comparées triées.

Pour régénérer l'instantané après un changement voulu de la fiche :
`uv run python -m tests.test_card_sheet_snapshot`.
"""

import json
from pathlib import Path

import pytest

from app.services.catalog_import import import_catalog, parse_library_meta

FIXTURES = Path(__file__).parent / "fixtures"
SNAPSHOT = FIXTURES / "card_sheet_snapshot.json"
SHEETS = (200025, 100002, 102308)  # Aidan Lyle, 419 Operation, Tyranny
UNORDERED = {"printings", "occurrences", "translations"}


def _is_technical_id(key: str) -> bool:
    return key == "id" or key.endswith("_id") or key.endswith("_ids")


def normalized(value):
    """Fiche sans identifiants techniques, listes sans ordre défini triées."""
    if isinstance(value, dict):
        return {
            key: _normalized_field(key, item)
            for key, item in value.items()
            if not _is_technical_id(key)
        }
    if isinstance(value, list):
        return [normalized(item) for item in value]
    return value


def _normalized_field(key: str, item):
    result = normalized(item)
    if key in UNORDERED:
        result.sort(key=lambda entry: json.dumps(entry, sort_keys=True))
    return result


def import_fixture(db) -> None:
    vtes = json.loads((FIXTURES / "krcg_vtes.json").read_text(encoding="utf-8"))
    expansions = json.loads(
        (FIXTURES / "krcg_expansions.json").read_text(encoding="utf-8")
    )
    meta = parse_library_meta(
        (FIXTURES / "vteslibmeta_sample.csv").read_text(encoding="utf-8")
    )
    import_catalog(db, vtes, expansions, meta)


def read_sheets(api) -> dict[str, dict]:
    ids = {card["vekn_id"]: card["id"] for card in api.get("/cartes").json()}
    return {
        str(vekn_id): normalized(api.get(f"/cartes/{ids[vekn_id]}").json())
        for vekn_id in SHEETS
    }


@pytest.fixture
def catalog(db):
    import_fixture(db)


def test_card_sheets_match_the_snapshot(api, catalog):
    expected = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    assert read_sheets(api) == expected


def test_a_sheet_reads_the_same_twice(api, catalog):
    """Même réponse d'un appel à l'autre, au texte près : l'ordre des types et
    des disciplines ne dépend plus du plan de requête (B1)."""
    ids = {card["vekn_id"]: card["id"] for card in api.get("/cartes").json()}
    first = api.get(f"/cartes/{ids[200025]}").content
    assert api.get(f"/cartes/{ids[200025]}").content == first


if __name__ == "__main__":  # pragma: no cover - régénération à la main
    import shutil
    import tempfile

    from fastapi.testclient import TestClient
    from sqlalchemy.orm import Session

    from app.db.session import create_app_engine, get_session
    from app.main import app
    from app.models import Base

    with tempfile.TemporaryDirectory() as folder:
        engine = create_app_engine(f"sqlite+pysqlite:///{folder}/snapshot.db")
        Base.metadata.create_all(engine)
        with Session(engine) as session:
            import_fixture(session)

        def override_session():
            with Session(engine, expire_on_commit=False) as session:
                yield session

        app.dependency_overrides[get_session] = override_session
        # Sans `with` : le lifespan, qui contrôlerait la révision de
        # `backend/vtes.db`, ne tourne pas ; seule la base jetable est lue.
        sheets = read_sheets(TestClient(app))
        engine.dispose()
        shutil.rmtree(folder, ignore_errors=True)
    SNAPSHOT.write_text(
        json.dumps(sheets, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Instantané écrit : {SNAPSHOT}")
