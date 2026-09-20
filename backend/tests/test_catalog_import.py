"""Import du catalogue krcg, contre un fixture de vraies cartes.

`tests/fixtures/` contient un échantillon figé de `vtes.json` /
`expansions.json` (neuf cartes choisies pour couvrir les cas limites : crypt,
imbued, coût « X », prérequis combo/choix, carte bannie, traductions fr/es,
précons, promos). Le schéma krcg est versionné par un mainteneur unique
(CLAUDE.md §11) : ce test est ce qui alerte quand il dérive.
"""

import copy
import json
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.models import (
    Bundle,
    Card,
    CardCategory,
    CardCopy,
    CardPrintingOccurrence,
    CardSet,
    CardTranslation,
    CostType,
    Deck,
    Discipline,
    DisciplineRequirement,
    Language,
    PrintOccurrence,
)
from app.services import decks
from app.services.catalog_import import _date_or_none, import_catalog
from tests.helpers import add_languages

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def krcg():
    def load(name):
        return json.loads((FIXTURES / name).read_text(encoding="utf-8"))

    return load("krcg_vtes.json"), load("krcg_expansions.json")


@pytest.fixture
def imported(db, krcg):
    report = import_catalog(db, *krcg)
    return report


def card_by_name(db, name):
    return db.scalars(select(Card).where(Card.name == name)).one()


def count(db, model):
    return db.scalar(select(func.count()).select_from(model))


def test_report_counts_what_was_imported(imported, krcg):
    vtes, expansions = krcg
    assert imported.cards_created == len(vtes) == 9
    assert imported.cards_updated == 0
    assert imported.card_sets == len(expansions)
    assert imported.translations == 2  # Aidan Lyle en fr et es


def test_crypt_card_fields(db, imported):
    card = card_by_name(db, "Aabbt Kindred")
    assert card.category is CardCategory.CRYPT
    assert card.vekn_id == 200001
    assert card.capacity == 4
    assert card.group_code == "G2"
    assert card.advanced is False
    assert card.clan.name == "Ministry"
    assert card.image_url == "https://static.krcg.org/card/aabbtkindredg2.jpg"
    assert card.artist == "Lawrence Snelly"
    assert card.title is None and card.path is None
    assert card.sect_id is None  # krcg ne fournit pas la sect
    assert card.cost_type is None and card.discipline_requirement is None


def test_crypt_disciplines_keep_the_superior_flag_from_the_code_case(db, imported):
    card = card_by_name(db, "Aabbt Kindred")
    levels = {
        link.discipline.abbrev: link.superior for link in card.discipline_links
    }
    assert levels == {"for": False, "pre": False, "ser": False}

    aidan = card_by_name(db, "Aidan Lyle")
    levels = {link.discipline.abbrev: link.superior for link in aidan.discipline_links}
    assert levels == {"dom": False, "aus": True, "chi": True, "tha": True}


def test_disciplines_get_their_full_name(db, imported):
    names = dict(db.execute(select(Discipline.abbrev, Discipline.name)).all())
    assert names["aus"] == "Auspex"
    assert names["tha"] == "Thaumaturgy"


def test_imbued_is_a_crypt_card_with_the_imbued_type(db, imported):
    card = db.scalars(select(Card).where(Card.name.like("Anna%"))).one()
    assert card.category is CardCategory.CRYPT
    assert [t.name for t in card.types] == ["Imbued"]
    assert card.clan.name == "Martyr"


def test_library_card_with_clan_requirement_and_no_discipline(db, imported):
    card = card_by_name(db, "419 Operation")
    assert card.category is CardCategory.LIBRARY
    assert card.clan_requirement == "Osebo"
    assert card.clan is None
    assert card.cost_type is None and card.cost_value is None
    # « Mono » sans discipline listée = pas de prérequis.
    assert card.discipline_requirement is None
    assert card.discipline_links == []


def test_x_cost_stays_textual(db, imported):
    card = card_by_name(db, "Awe")
    assert card.cost_type is CostType.BLOOD
    assert card.cost_value == "X"


def test_discipline_requirements_and_multiple_types(db, imported):
    combo = card_by_name(db, "Absolute Tyranny")
    choice = card_by_name(db, "Aura Absorption")
    assert combo.discipline_requirement is DisciplineRequirement.COMBO
    assert choice.discipline_requirement is DisciplineRequirement.CHOICE
    assert len(choice.types) == 2
    assert len(choice.discipline_links) >= 2
    assert all(not link.superior for link in choice.discipline_links)


def test_banned_card_carries_its_date(db, imported):
    banned = db.scalars(select(Card).where(Card.banned_on.is_not(None))).all()
    assert banned and all(isinstance(card.banned_on, date) for card in banned)


def test_legal_date_is_imported_as_legal_from(db, imported, krcg):
    vtes, _ = krcg
    expected = {c["printed_name"]: c["legal"] for c in vtes}

    for name, legal in expected.items():
        assert card_by_name(db, name).legal_from == date.fromisoformat(legal), name


def test_replay_updates_and_clears_legal_from(db, krcg):
    vtes, expansions = krcg
    import_catalog(db, vtes, expansions)
    changed = copy.deepcopy(vtes)
    aabbt = next(c for c in changed if c["printed_name"] == "Aabbt Kindred")
    other = next(c for c in changed if c["printed_name"] != "Aabbt Kindred")
    aabbt["legal"] = "2031-01-02"
    other["legal"] = None
    import_catalog(db, changed, expansions)

    assert card_by_name(db, "Aabbt Kindred").legal_from == date(2031, 1, 2)
    assert card_by_name(db, other["printed_name"]).legal_from is None


def test_crypt_title_is_imported(db, imported):
    card = card_by_name(db, "Aaradhya, The Callous Tyrant")
    assert card.title


def test_translations_use_normalized_language_codes(db, imported):
    aidan = card_by_name(db, "Aidan Lyle")
    codes = sorted(t.language_code for t in aidan.translations)
    assert codes == ["ES", "FR"]
    fr = next(t for t in aidan.translations if t.language_code == "FR")
    assert fr.card_text.startswith("Camarilla")
    assert fr.image_url is None  # url vide chez krcg = pas de scan localisé
    assert db.get(Language, "FR") is not None


def test_printings_and_occurrences(db, imported):
    aabbt = card_by_name(db, "Aabbt Kindred")
    printings = {p.card_set.abbrev: p for p in aabbt.printings}
    assert set(printings) == {"FN", "POD"}

    (rarity,) = printings["FN"].occurrences
    assert rarity.occurrence_type is PrintOccurrence.RARITY
    assert (rarity.frequency, rarity.multiplier) == ("U", 2.0)

    (single,) = printings["POD"].occurrences
    assert single.occurrence_type is PrintOccurrence.SINGLE
    assert single.released_on == date(2021, 3, 7)


def test_precon_occurrences_point_to_their_bundle_with_copies(db, imported):
    aidan = card_by_name(db, "Aidan Lyle")
    precons = [
        occ
        for printing in aidan.printings
        for occ in printing.occurrences
        if occ.occurrence_type is PrintOccurrence.PRECON
    ]
    by_set = {occ.printing.card_set.abbrev: occ for occ in precons}
    assert by_set["FB"].bundle.code == "PTr"
    assert by_set["FB"].copies == 1
    # Un précon sans code propre : `code` vide, jamais nul.
    assert by_set["KoTR"].bundle.code == "B"


def test_card_sets_are_keyed_by_abbrev_not_by_krcg_id(db, imported):
    promo = db.scalars(select(CardSet).where(CardSet.abbrev == "Promo")).one()
    pod = db.scalars(select(CardSet).where(CardSet.abbrev == "POD")).one()
    assert promo.id != pod.id
    assert pod.full_name == "Print on Demand"
    assert pod.company is None and pod.release_date is None


def test_bundles_carry_name_and_size(db, imported):
    bundle = db.scalars(
        select(Bundle).join(CardSet).where(CardSet.abbrev == "FB", Bundle.code == "PTr")
    ).one()
    assert bundle.name
    assert bundle.size and bundle.size >= 1


def test_replay_creates_no_duplicates(db, krcg):
    import_catalog(db, *krcg)
    tables = (
        Card,
        CardSet,
        Bundle,
        CardTranslation,
        CardPrintingOccurrence,
    )
    before = {model: count(db, model) for model in tables}
    report = import_catalog(db, *krcg)

    assert report.cards_created == 0
    assert report.cards_updated == len(krcg[0])
    assert {model: count(db, model) for model in tables} == before


def test_replay_updates_changed_cards_and_realigns_links(db, krcg):
    vtes, expansions = krcg
    import_catalog(db, vtes, expansions)
    card_id = card_by_name(db, "Aabbt Kindred").id

    changed = copy.deepcopy(vtes)
    aabbt = next(c for c in changed if c["printed_name"] == "Aabbt Kindred")
    aabbt["text"] = "Nouveau texte."
    aabbt["capacity"] = 5
    aabbt["disciplines"] = ["FOR", "cel"]  # pre/ser retirées, cel ajoutée, FOR sup.
    aabbt["prints"] = [p for p in aabbt["prints"] if p["set"]["code"] == "FN"]
    import_catalog(db, changed, expansions)

    card = db.get(Card, card_id)
    assert (card.card_text, card.capacity) == ("Nouveau texte.", 5)
    levels = {link.discipline.abbrev: link.superior for link in card.discipline_links}
    assert levels == {"for": True, "cel": False}
    assert [p.card_set.abbrev for p in card.printings] == ["FN"]


def test_replay_keeps_translations_absent_from_the_new_source(db, krcg):
    vtes, expansions = krcg
    import_catalog(db, vtes, expansions)

    trimmed = copy.deepcopy(vtes)
    for raw in trimmed:
        raw["i18n"] = {}
    report = import_catalog(db, trimmed, expansions)

    assert report.translations == 0
    assert count(db, CardTranslation) == 2  # jamais supprimées par l'import


def test_replay_upserts_translations_and_falls_back_on_new_languages(db, krcg):
    vtes, expansions = krcg
    import_catalog(db, vtes, expansions)

    changed = copy.deepcopy(vtes)
    aidan = next(c for c in changed if c["printed_name"] == "Aidan Lyle")
    aidan["i18n"]["fr"]["text"] = "Texte corrigé."
    aidan["i18n"]["de"] = {"name": "Aidan Lyle", "text": "Deutsch"}
    import_catalog(db, changed, expansions)

    card = card_by_name(db, "Aidan Lyle")
    translations = {t.language_code: t for t in card.translations}
    assert translations["FR"].card_text == "Texte corrigé."
    assert translations["DE"].card_text == "Deutsch"
    assert db.get(Language, "DE") is not None  # table de langues ouverte


def test_cards_missing_from_the_source_are_kept(db, krcg):
    vtes, expansions = krcg
    import_catalog(db, vtes, expansions)
    import_catalog(db, vtes[:1], expansions)
    assert count(db, Card) == len(vtes)


def test_failed_import_leaves_the_catalog_untouched(db, krcg):
    vtes, expansions = krcg
    broken = copy.deepcopy(vtes)
    del broken[-1]["printed_name"]

    with pytest.raises(KeyError):
        import_catalog(db, broken, expansions)

    assert count(db, Card) == 0
    assert count(db, CardSet) == 0


def test_expansion_cited_by_a_card_but_absent_from_the_source_is_created(db, krcg):
    vtes, expansions = krcg
    known = [e for e in expansions if e["code"] not in ("FN", "FB")]

    report = import_catalog(db, vtes, known)

    assert report.cards_created == len(vtes)
    fn = db.scalars(select(CardSet).where(CardSet.abbrev == "FN")).one()
    assert fn.full_name is None and fn.release_date is None and fn.company is None
    aabbt = card_by_name(db, "Aabbt Kindred")
    assert {p.card_set.abbrev for p in aabbt.printings} == {"FN", "POD"}
    # Le précon d'une extension elle-même absente est créé à la volée aussi.
    aidan = card_by_name(db, "Aidan Lyle")
    codes = {
        occ.bundle.code
        for printing in aidan.printings
        for occ in printing.occurrences
        if occ.occurrence_type is PrintOccurrence.PRECON
    }
    assert "PTr" in codes


def test_replay_with_a_missing_expansion_does_not_duplicate_it(db, krcg):
    vtes, expansions = krcg
    known = [e for e in expansions if e["code"] != "FN"]
    import_catalog(db, vtes, known)
    import_catalog(db, vtes, known)

    assert count(db, CardSet) == len(known) + 1
    assert db.scalars(select(CardSet).where(CardSet.abbrev == "FN")).one()


@pytest.mark.parametrize("value", ["2020-01", "", None, "pas une date", "2020-13-40"])
def test_partial_or_invalid_dates_read_as_unknown(value):
    assert _date_or_none(value) is None


def test_full_iso_date_is_still_parsed():
    assert _date_or_none("2021-03-07") == date(2021, 3, 7)


def test_date_helper_does_not_mask_other_errors():
    with pytest.raises(TypeError):
        _date_or_none(20210307)


def test_import_survives_partial_dates_everywhere(db, krcg):
    vtes, expansions = krcg
    vtes, expansions = copy.deepcopy(vtes), copy.deepcopy(expansions)
    next(e for e in expansions if e["code"] == "FN")["release_date"] = "2001-06"
    fb = next(e for e in expansions if e["code"] == "FB")
    next(iter(fb["bundles"].values()))["release_date"] = "2019"
    aabbt = next(c for c in vtes if c["printed_name"] == "Aabbt Kindred")
    aabbt["banned"] = "2020-01"
    aabbt["legal"] = "2001-07"
    next(p for p in aabbt["prints"] if p["set"]["code"] == "POD")["occurrences"][0][
        "date"
    ] = ""

    report = import_catalog(db, vtes, expansions)

    assert report.cards_created == len(vtes)
    card = card_by_name(db, "Aabbt Kindred")
    assert card.banned_on is None
    assert card.legal_from is None  # date partielle : carte tenue pour légale
    fn = db.scalars(select(CardSet).where(CardSet.abbrev == "FN")).one()
    assert fn.release_date is None
    pod = next(p for p in card.printings if p.card_set.abbrev == "POD")
    assert pod.occurrences[0].released_on is None


def test_ban_and_legal_dates_land_in_their_own_columns(db, imported):
    tarbaby = card_by_name(db, "Tarbaby Jack")

    assert tarbaby.banned_on == date(2020, 8, 1)
    assert tarbaby.legal_from == date(2003, 12, 17)
    # Une carte non bannie n'hérite jamais d'une date de ban.
    assert card_by_name(db, "Aabbt Kindred").banned_on is None


def test_a_missing_legal_key_reads_as_unknown_and_a_replay_clears_the_date(db, krcg):
    vtes, expansions = krcg
    import_catalog(db, vtes, expansions)
    assert card_by_name(db, "Aabbt Kindred").legal_from is not None

    changed = copy.deepcopy(vtes)
    for raw in changed:
        raw.pop("legal", None)  # clé absente, et non `null`
    import_catalog(db, changed, expansions)

    assert card_by_name(db, "Aabbt Kindred").legal_from is None


def test_replaying_the_same_source_keeps_every_legal_date(db, krcg):
    vtes, expansions = krcg
    import_catalog(db, vtes, expansions)
    first = {c.name: c.legal_from for c in db.scalars(select(Card))}

    import_catalog(db, vtes, expansions)

    assert {c.name: c.legal_from for c in db.scalars(select(Card))} == first
    assert all(first.values())


def test_an_imported_legal_date_drives_the_deck_legality(api, db, krcg):
    """La chaîne complète : krcg `legal` -> `legal_from` -> verdict de légalité."""
    vtes, expansions = krcg
    vtes = copy.deepcopy(vtes)
    next(c for c in vtes if c["printed_name"] == "Aabbt Kindred")["legal"] = (
        "2099-01-01"
    )
    import_catalog(db, vtes, expansions)
    add_languages(db, "EN")
    aabbt = card_by_name(db, "Aabbt Kindred")
    db.add(CardCopy(card_id=aabbt.id, language_code="EN", quantity_owned=12))
    deck = Deck(name="Futur", discriminator="0001")
    db.add(deck)
    db.commit()
    added = api.post(
        f"/decks/{deck.id}/cartes",
        json={"card_id": aabbt.id, "language_code": "EN", "quantity": 12},
    )
    assert added.status_code == 201

    eve = decks.get_legality(db, deck.id, on=date(2098, 12, 31))
    day = decks.get_legality(db, deck.id, on=date(2099, 1, 1))

    assert [c.name for c in eve.not_yet_legal_cards] == ["Aabbt Kindred"]
    assert eve.is_legal is False
    assert day.not_yet_legal_cards == []
