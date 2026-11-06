"""Règles du catalogue du lot Chercher : légalité d'une carte, secte, exigence.

Trois fonctions pures de `app.services.vtes_rules`, chacune sur sa table de
cas (`tests/fixtures/`) :

* `card_legality` sur `card_legality_cases.json`, table commune avec la
  jumelle TypeScript de l'étape C1b (A5) ;
* `crypt_sect` sur `crypt_sect_cases.json` (P13) ;
* `library_requirement` sur `library_requirement_cases.json` (P15).

Les deux dernières n'ont pas de jumelle : le client reçoit la secte et les
listes déjà lues par le serveur (A3, option 3).
"""

import json
from datetime import date
from pathlib import Path

import pytest

from app.services.vtes_rules import (
    SECTS,
    TITLE_SECTS,
    CardLegality,
    LibraryRequirement,
    banned_cards,
    card_legality,
    crypt_sect,
    library_requirement,
    not_yet_legal_cards,
)

FIXTURES = Path(__file__).parent / "fixtures"


def load_cases(name: str) -> list[dict]:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))["cases"]


LEGALITY_CASES = load_cases("card_legality_cases.json")
SECT_CASES = load_cases("crypt_sect_cases.json")
REQUIREMENT_CASES = load_cases("library_requirement_cases.json")


def iso(value: str | None) -> date | None:
    return date.fromisoformat(value) if value is not None else None


# --------------------------------------------------------------------------
# Légalité d'une carte à une date (A5)
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "case", LEGALITY_CASES, ids=[c["description"] for c in LEGALITY_CASES]
)
def test_card_legality_follows_the_shared_case_table(case):
    verdict = card_legality(
        iso(case["banned_on"]), iso(case["legal_from"]), iso(case["on"])
    )
    assert verdict == CardLegality(**case["expected"])
    assert verdict._asdict() == case["expected"]


def test_the_case_table_covers_every_combination_of_results():
    seen = {
        (c["expected"]["banned"], c["expected"]["not_yet_legal"])
        for c in LEGALITY_CASES
    }
    assert seen == {(False, False), (True, False), (False, True), (True, True)}


def test_the_case_table_is_plain_json_for_the_typescript_twin():
    """Dates en chaînes ISO ou `null`, attendus booléens : rien qu'un test
    TypeScript ne lise tel quel."""
    for case in LEGALITY_CASES:
        assert set(case) == {
            "description",
            "banned_on",
            "legal_from",
            "on",
            "expected",
        }
        for key in ("banned_on", "legal_from", "on"):
            value = case[key]
            assert value is None or date.fromisoformat(value).isoformat() == value
        assert case["on"] is not None
        assert set(case["expected"]) == {"banned", "not_yet_legal"}


@pytest.mark.parametrize(
    "case", LEGALITY_CASES, ids=[c["description"] for c in LEGALITY_CASES]
)
def test_deck_legality_lists_agree_with_card_legality(case):
    """`banned_cards` et `not_yet_legal_cards` (et donc `/legalite`) rendent
    les mêmes verdicts que `card_legality`, carte par carte."""
    on = iso(case["on"])
    label = "Carte"
    banned = banned_cards([(label, iso(case["banned_on"]))], on)
    not_yet = not_yet_legal_cards([(label, iso(case["legal_from"]))], on)
    assert (bool(banned), bool(not_yet)) == (
        case["expected"]["banned"],
        case["expected"]["not_yet_legal"],
    )


def test_card_legality_unpacks_as_a_pair():
    banned, not_yet_legal = card_legality(
        date(1995, 11, 1), date(1996, 1, 14), date(1995, 12, 25)
    )
    assert (banned, not_yet_legal) == (True, True)


# --------------------------------------------------------------------------
# Secte d'une carte de crypte (P13)
# --------------------------------------------------------------------------


@pytest.mark.parametrize("case", SECT_CASES, ids=[c["description"] for c in SECT_CASES])
def test_crypt_sect_follows_its_case_table(case):
    assert crypt_sect(case["text"], imbued=case["imbued"]) == case["expected"]


def test_the_sect_table_names_the_six_merged_vampires():
    merged = [c for c in SECT_CASES if "[MERGED]" in (c["text"] or "")]
    assert len(merged) == 6
    for case in merged:
        face, fused = case["text"].split("[MERGED]")
        assert crypt_sect(fused, imbued=False) not in (None, case["expected"])


def test_every_sect_of_the_vocabulary_is_reached_by_the_table():
    assert {c["expected"] for c in SECT_CASES} - {None} == set(SECTS)


# --------------------------------------------------------------------------
# Exigence d'une carte de bibliothèque (P15)
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "case", REQUIREMENT_CASES, ids=[c["description"] for c in REQUIREMENT_CASES]
)
def test_library_requirement_follows_its_case_table(case):
    expected = case["expected"]
    assert library_requirement(case["raw"]) == LibraryRequirement(
        sects=tuple(expected["sects"]),
        titles=tuple(expected["titles"]),
        titled=expected["titled"],
        non_titled=expected["non_titled"],
        other=tuple(expected["other"]),
    )


def test_a_title_always_implies_a_sect_of_the_vocabulary():
    for title, sect in TITLE_SECTS.values():
        assert sect in SECTS, title
        assert library_requirement(title).sects == (sect,)


def test_titles_cover_the_vdb_vote_scale():
    """Le barème des votes de VDB (P1) nomme quinze titres : chacun a sa
    secte ici, sous le nom que krcg donne au titre d'un vampire."""
    vdb_scale = {
        "primogen", "prince", "justicar", "imperator", "inner circle",
        "bishop", "archbishop", "priscus", "cardinal", "regent",
        "1 vote", "2 votes", "magaji", "kholo", "baron",
    }
    assert set(TITLE_SECTS) == vdb_scale


VAMPIRE_SECTS = tuple(sect for sect in SECTS if sect != "Imbued")


@pytest.mark.parametrize("sect", VAMPIRE_SECTS)
def test_an_exclusion_requires_every_other_vampire_sect(sect):
    """« non-anarch » : toute secte de vampire sauf Anarch (décision de
    l'utilisateur du 2026-11-03). Une secte est donc exigée (pas de réponse à
    « non requise »), jamais l'exclue ni Imbued, et la valeur ne reste pas dans
    les autres."""
    requirement = library_requirement(f"non-{sect.lower()}")
    assert requirement.sects == tuple(s for s in VAMPIRE_SECTS if s != sect)
    assert requirement.other == ()


@pytest.mark.parametrize("title", sorted(TITLE_SECTS))
def test_an_exclusion_only_narrows_the_sect_a_title_implies(title):
    """`required_sects` reste « l'une de » : une exclusion ne l'élargit jamais
    au-delà de la secte qu'un titre implique."""
    implied = TITLE_SECTS[title][1]
    for sect in VAMPIRE_SECTS:
        sects = library_requirement(f"non-{sect.lower()},{title}").sects
        assert sects == (() if sect == implied else (implied,))


def test_the_sample_file_values_are_all_read_without_error():
    """Toutes les valeurs de l'échantillon de `vteslibmeta.csv` se lisent."""
    lines = (FIXTURES / "vteslibmeta_sample.csv").read_text(encoding="utf-8")
    for line in lines.splitlines()[1:]:
        raw = line.rsplit('","', 1)[1].rstrip('"')
        assert isinstance(library_requirement(raw), LibraryRequirement)
