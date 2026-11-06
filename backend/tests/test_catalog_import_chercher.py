"""Import du catalogue, lot Chercher : secte dérivée (P13), seconde source (P15).

Contre le fixture krcg habituel (dix cartes, inchangé) et un échantillon de
`vteslibmeta.csv` (`tests/fixtures/vteslibmeta_sample.csv`). L'échantillon a
l'en-tête et les guillemets du vrai fichier ; ses lignes sont choisies pour
exercer chaque issue de la jointure, et les quatre premières associent à des
cartes du fixture des exigences réelles du fichier qui ne sont pas les leurs :

* `100002` 419 Operation, `prince,justicar` : appliquée ;
* `102308` Absolute Tyranny, `non-anarch,titled` : appliquée ;
* `100111` « Aura Absorbtion » (sic), `imbued` : nom divergent, appliquée et
  signalée ;
* `200001` Aabbt Kindred : carte de crypte, ignorée et signalée ;
* `100057` Anarch Secession (ligne réelle) : identifiant absent du fixture,
  ignorée et signalée ;
* `100002` une seconde fois : doublon, ignoré et signalé.

Awe et la carte synthétique `100999` n'ont pas de ligne : sans exigence.
"""

import copy
import json
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.models import Card, Sect
from app.services.catalog_import import (
    LIBRARY_META_URL,
    LibraryMetaIssue,
    LibraryMetaReport,
    LibraryMetaRow,
    PlaceholderCard,
    import_catalog,
    parse_library_meta,
    same_card_name,
)

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def krcg():
    def load(name):
        return json.loads((FIXTURES / name).read_text(encoding="utf-8"))

    return load("krcg_vtes.json"), load("krcg_expansions.json")


@pytest.fixture
def library_meta():
    return parse_library_meta(
        (FIXTURES / "vteslibmeta_sample.csv").read_text(encoding="utf-8")
    )


def requirements(db) -> dict[int, str | None]:
    return dict(db.execute(select(Card.vekn_id, Card.library_requirement)).all())


def sects(db) -> dict[int, str | None]:
    return {
        card.vekn_id: card.sect.name if card.sect else None
        for card in db.scalars(select(Card))
    }


# --------------------------------------------------------------------------
# Secte dérivée (P13)
# --------------------------------------------------------------------------


def test_every_crypt_card_of_the_fixture_gets_its_sect(db, krcg):
    report = import_catalog(db, *krcg)

    assert sects(db) == {
        200001: "Independent",  # Aabbt Kindred
        200025: "Camarilla",  # Aidan Lyle
        200102: "Imbued",  # Anna "Dictatrix11" Suljic
        201343: "Sabbat",  # Tarbaby Jack
        201733: "Sabbat",  # Aaradhya, « Sabbat cardinal: »
        100002: None,
        100119: None,
        102308: None,
        100111: None,
        100999: None,
    }
    assert report.crypt_sects == {
        "Independent": 1,
        "Camarilla": 1,
        "Imbued": 1,
        "Sabbat": 2,
    }
    assert report.unknown_sect_cards == []


def test_the_sect_table_is_filled_once_and_reused_on_replay(db, krcg):
    import_catalog(db, *krcg)
    first = {s.name: s.id for s in db.scalars(select(Sect))}
    import_catalog(db, *krcg)

    assert {s.name: s.id for s in db.scalars(select(Sect))} == first
    assert set(first) == {"Independent", "Camarilla", "Imbued", "Sabbat"}


def test_a_vampire_without_a_known_sect_is_signalled_not_guessed(db, krcg):
    vtes, expansions = copy.deepcopy(krcg)
    aidan = next(c for c in vtes if c["id"] == 200025)
    aidan["text"] = "During your unlock phase, Aidan gains 1 blood."

    report = import_catalog(db, vtes, expansions)

    assert sects(db)[200025] is None
    assert report.unknown_sect_cards == [PlaceholderCard(200025, "Aidan Lyle")]
    assert "Camarilla" not in report.crypt_sects


def test_a_replay_realigns_a_sect_whose_text_changed(db, krcg):
    import_catalog(db, *krcg)
    vtes, expansions = copy.deepcopy(krcg)
    next(c for c in vtes if c["id"] == 200025)["text"] = "Anarch: nouveau texte."

    import_catalog(db, vtes, expansions)

    assert sects(db)[200025] == "Anarch"


# --------------------------------------------------------------------------
# Lecture de vteslibmeta.csv
# --------------------------------------------------------------------------


def test_the_sample_is_read_row_by_row(library_meta):
    assert library_meta[0] == LibraryMetaRow(
        "100002", "419 Operation", "prince,justicar"
    )
    assert len(library_meta) == 6


def test_the_url_is_pinned_on_the_official_repository():
    assert LIBRARY_META_URL == (
        "https://raw.githubusercontent.com/GiottoVerducci/vtescsv/main/vteslibmeta.csv"
    )


@pytest.mark.parametrize(
    "text",
    [
        "",
        '"Id","Name"\n"1","X"\n',
        '"id","name","requirement"\n',
        '"Id","Name","Requirement","Extra"\n',
    ],
)
def test_an_unexpected_header_is_refused(text):
    with pytest.raises(ValueError, match="en-tête inattendu"):
        parse_library_meta(text)


def test_a_byte_order_mark_and_blank_lines_are_tolerated():
    rows = parse_library_meta('﻿"Id","Name","Requirement"\n\n"1","X"," sabbat "\n')
    assert rows == [LibraryMetaRow("1", "X", "sabbat")]


def test_a_row_without_three_fields_reads_as_an_unknown_identifier():
    rows = parse_library_meta('"Id","Name","Requirement"\n"1","X"\n')
    assert rows == [LibraryMetaRow("", "1,X", "")]


@pytest.mark.parametrize(
    ("catalog_name", "csv_name", "same"),
    [
        ("Awe", "Awe", True),
        ("The Embrace", "Embrace, The", True),
        ("The World's a Canvas", "World's a Canvas, The", True),
        ("Awe", "Awe, The", False),
        ("Aura Absorption", "Aura Absorbtion", False),
        ("awe", "Awe", False),
    ],
)
def test_names_are_compared_with_the_article_put_back_in_front(
    catalog_name, csv_name, same
):
    assert same_card_name(catalog_name, csv_name) is same


# --------------------------------------------------------------------------
# Jointure et rapport (P15)
# --------------------------------------------------------------------------


def test_requirements_are_joined_by_vekn_identifier(db, krcg, library_meta):
    report = import_catalog(db, *krcg, library_meta)

    assert requirements(db) == {
        100002: "prince,justicar",
        102308: "non-anarch,titled",
        100111: "imbued",
        100119: None,
        100999: None,
        200001: None,
        200025: None,
        200102: None,
        201343: None,
        201733: None,
    }
    assert report.library_requirements == 3


def test_every_discrepancy_is_reported_without_failing(db, krcg, library_meta):
    report = import_catalog(db, *krcg, library_meta)

    assert report.library_meta_issues == [
        LibraryMetaReport(
            "100111",
            "Aura Absorbtion",
            LibraryMetaIssue.NAME_MISMATCH,
            "Aura Absorption",
        ),
        LibraryMetaReport(
            "200001", "Aabbt Kindred", LibraryMetaIssue.CRYPT_CARD, "Aabbt Kindred"
        ),
        LibraryMetaReport("100057", "Anarch Secession", LibraryMetaIssue.UNKNOWN_ID),
        LibraryMetaReport(
            "100002", "419 Operation", LibraryMetaIssue.DUPLICATE_ID, "419 Operation"
        ),
    ]


def test_an_unreadable_identifier_is_reported_as_unknown(db, krcg):
    rows = [LibraryMetaRow("12a", "X", "sabbat"), LibraryMetaRow("", "Y", "anarch")]
    report = import_catalog(db, *krcg, rows)

    assert [i.reason for i in report.library_meta_issues] == [
        LibraryMetaIssue.UNKNOWN_ID,
        LibraryMetaIssue.UNKNOWN_ID,
    ]
    assert report.library_requirements == 0


def test_an_empty_requirement_reads_as_none(db, krcg):
    import_catalog(db, *krcg, [LibraryMetaRow("100119", "Awe", "")])
    assert requirements(db)[100119] is None


def test_a_replay_rewrites_the_same_values_without_change(db, krcg, library_meta):
    import_catalog(db, *krcg, library_meta)
    before = requirements(db)
    cards_before = db.scalar(select(func.count()).select_from(Card))

    report = import_catalog(db, *krcg, library_meta)

    assert requirements(db) == before
    assert db.scalar(select(func.count()).select_from(Card)) == cards_before
    assert report.library_requirements == 3


def test_a_row_dropped_from_the_file_clears_the_requirement(db, krcg, library_meta):
    import_catalog(db, *krcg, library_meta)
    kept = [row for row in library_meta if row.row_id != "102308"]

    import_catalog(db, *krcg, kept)

    assert requirements(db)[102308] is None
    assert requirements(db)[100002] == "prince,justicar"


def test_a_krcg_only_import_leaves_the_requirements_untouched(db, krcg, library_meta):
    import_catalog(db, *krcg, library_meta)
    before = requirements(db)

    report = import_catalog(db, *krcg)

    assert requirements(db) == before
    assert report.library_requirements is None
    assert report.library_meta_issues == []


def test_a_failed_import_leaves_the_requirements_untouched(db, krcg, library_meta):
    import_catalog(db, *krcg, library_meta)
    before = requirements(db)
    vtes, expansions = copy.deepcopy(krcg)
    vtes.append({"id": 300000})  # carte sans « kind » : l'import lève

    with pytest.raises(KeyError):
        import_catalog(db, vtes, expansions, [])

    assert requirements(db) == before
