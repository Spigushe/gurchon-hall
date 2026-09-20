"""Recherche `q` sans casse ni accents : cartes, produits, collection, decks.

Une seule normalisation (`fold_text`), appliquée au texte cherché en Python et à
la colonne en SQL. Ces tests fixent son comportement réel, y compris ses limites
(lettres qui ne se décomposent pas), sans promettre davantage.
"""

from datetime import date

import pytest
from sqlalchemy import select, text

from app.db.folding import fold_text
from app.db.session import create_app_engine
from app.models import Bundle, CardSet
from app.services.text_search import like_pattern
from tests.helpers import add_languages, make_card, make_copy, make_deck

# --- La fonction de normalisation --------------------------------------------


@pytest.mark.parametrize(
    ("raw", "folded"),
    [
        ("Élan vital", "elan vital"),
        ("ÉLAN", "elan"),
        ("École", "ecole"),
        ("Niño", "nino"),
        ("Ça", "ca"),
        ("Éloïse", "eloise"),
        ("Straße", "strasse"),
        ("İstanbul", "istanbul"),
        ("ﬁn", "fin"),
        ("Plain", "plain"),
        ("", ""),
    ],
)
def test_fold_text_drops_case_and_accents(raw, folded):
    assert fold_text(raw) == folded


def test_fold_text_keeps_a_null_as_a_null():
    assert fold_text(None) is None


@pytest.mark.parametrize(
    ("raw", "folded"),
    [
        # Ces lettres n'ont pas de décomposition : NFKD ne les ramène pas à l'ASCII.
        ("œ", "œ"),
        ("Œuvre", "œuvre"),
        ("Ł", "ł"),
        ("Øystein", "øystein"),
    ],
)
def test_fold_text_leaves_letters_without_decomposition_alone(raw, folded):
    assert fold_text(raw) == folded


def test_fold_text_is_idempotent():
    once = fold_text("Élan Œuvre Łódź İ ß")
    assert fold_text(once) == once


def test_the_pattern_is_folded_before_its_wildcards_are_escaped():
    assert like_pattern("ÉLAN") == "%elan%"
    assert like_pattern("100%") == "%100\\%%"
    assert like_pattern("a_b") == "%a\\_b%"
    assert like_pattern("a\\b") == "%a\\\\b%"
    # « ％ » pleine chasse devient « % » en NFKD : il doit rester littéral.
    assert like_pattern("％") == "%\\%%"


# --- La fonction SQL ----------------------------------------------------------


def test_fold_text_is_registered_on_every_engine_connection(tmp_path):
    engine = create_app_engine(f"sqlite+pysqlite:///{(tmp_path / 'f.db').as_posix()}")
    try:
        with engine.connect() as connection:
            row = connection.execute(
                text("SELECT fold_text('Élan Niño'), fold_text(NULL)")
            ).one()
        assert tuple(row) == ("elan nino", None)
    finally:
        engine.dispose()


def test_fold_text_is_available_on_the_test_database(db):
    assert db.scalar(text("SELECT fold_text('ÉCOLE')")) == "ecole"


# --- Données -----------------------------------------------------------------

CARD_NAMES = ["Élan vital", "École de sang", "Niño", "Ça ira", "Plain", "100% Bleed"]
# Noms sans accent contre texte cherché accentué, et inversement.
EXTRA_NAMES = ["Under_score", "Elan brut", "Łódź", "Œuvre"]
ALL_NAMES = CARD_NAMES + EXTRA_NAMES


@pytest.fixture
def searchable(db):
    """Un catalogue, un stock, des decks et des produits aux noms accentués."""
    add_languages(db, "EN")
    card_set = CardSet(abbrev="TS", full_name="Set", release_date=date(2020, 1, 1))
    db.add(card_set)
    db.flush()
    for number, name in enumerate(CARD_NAMES):
        make_copy(db, make_card(db, name))
        make_deck(db, name)
        db.add(Bundle(card_set_id=card_set.id, code=f"B{number}", name=name, size=1))
    for number, name in enumerate(EXTRA_NAMES, start=len(CARD_NAMES)):
        make_copy(db, make_card(db, name))
        make_deck(db, name)
        db.add(Bundle(card_set_id=card_set.id, code=f"B{number}", name=name, size=1))
    db.commit()


def card_names(api, **params):
    return sorted(item["name"] for item in api.get("/cartes", params=params).json())


def stock_names(api, **params):
    body = api.get("/stock", params=params).json()
    return sorted(item["card"]["name"] for item in body)


def deck_names(api, **params):
    return sorted(item["name"] for item in api.get("/decks", params=params).json())


def bundle_names(api, **params):
    return sorted(item["name"] for item in api.get("/bundles", params=params).json())


LISTERS = [card_names, stock_names, deck_names, bundle_names]
LISTER_IDS = ["cartes", "stock", "decks", "bundles"]


# --- Casse et accents, pour chacune des quatre recherches ---------------------


@pytest.mark.parametrize("lister", LISTERS, ids=LISTER_IDS)
@pytest.mark.parametrize("q", ["élan", "ÉLAN", "Élan", "elan", "ELAN", "éLAN"])
def test_case_and_accents_are_ignored_for_elan(api, searchable, lister, q):
    # « Élan vital » (accentué) et « Elan brut » (sans accent) : les deux matchent.
    assert lister(api, q=q) == ["Elan brut", "Élan vital"]


@pytest.mark.parametrize("lister", LISTERS, ids=LISTER_IDS)
@pytest.mark.parametrize(
    ("q", "expected"),
    [
        ("ecole", ["École de sang"]),
        ("École", ["École de sang"]),
        ("ÉCOLE", ["École de sang"]),
        ("nino", ["Niño"]),
        ("NIÑO", ["Niño"]),
        ("ca", ["Ça ira"]),
        # « ç » se replie en « c » : tout nom contenant un « c » correspond.
        ("ç", ["Under_score", "Ça ira", "École de sang"]),
        ("Ç", ["Under_score", "Ça ira", "École de sang"]),
        ("plain", ["Plain"]),
    ],
)
def test_other_accented_names(api, searchable, lister, q, expected):
    assert lister(api, q=q) == expected


@pytest.mark.parametrize("lister", LISTERS, ids=LISTER_IDS)
def test_letters_without_decomposition_match_only_themselves(api, searchable, lister):
    # Comportement réel de NFKD + casefold : la casse est repliée, mais « ł » et
    # « œ » ne valent ni « l » ni « oe ».
    assert lister(api, q="ł") == ["Łódź"]
    assert lister(api, q="Ł") == ["Łódź"]
    assert lister(api, q="œ") == ["Œuvre"]
    assert lister(api, q="ŒUVRE") == ["Œuvre"]
    assert lister(api, q="oe") == []
    assert lister(api, q="lodz") == []


@pytest.mark.parametrize("lister", LISTERS, ids=LISTER_IDS)
def test_a_missing_substring_finds_nothing(api, searchable, lister):
    assert lister(api, q="zzz") == []


@pytest.mark.parametrize("lister", LISTERS, ids=LISTER_IDS)
def test_wildcards_stay_literal(api, searchable, lister):
    assert lister(api, q="%") == ["100% Bleed"]
    assert lister(api, q="_") == ["Under_score"]
    assert lister(api, q="%%") == []
    assert lister(api, q="e_l") == []
    assert lister(api, q="100%") == ["100% Bleed"]
    # Un joker accompagné d'un texte accentué : normalisé, puis échappé.
    assert lister(api, q="É%") == []
    assert lister(api, q="％") == ["100% Bleed"]


@pytest.mark.parametrize("lister", LISTERS, ids=LISTER_IDS)
def test_ascii_searches_give_the_same_results_as_before(api, searchable, lister):
    assert lister(api, q="PLAIN") == ["Plain"]
    assert lister(api, q="bleed") == ["100% Bleed"]
    assert lister(api, q="score") == ["Under_score"]
    assert lister(api, q="ain") == ["Plain"]
    assert lister(api) == sorted(ALL_NAMES)


# --- Cohérence entre les recherches ------------------------------------------


@pytest.mark.parametrize("q", ["élan", "ÉLAN", "nino", "ecole", "ç", "œ", "%", "_"])
def test_stock_and_catalog_searches_agree(api, searchable, q):
    assert stock_names(api, q=q) == card_names(api, q=q)


def test_the_stock_search_still_combines_with_its_other_filters(api, searchable):
    assert stock_names(api, q="ÉLAN", language_code="fr") == []
    assert stock_names(api, q="ÉLAN", language_code="en") == ["Elan brut", "Élan vital"]
    assert stock_names(api, q="élan", category="crypt") == ["Elan brut", "Élan vital"]
    assert stock_names(api, q="élan", category="library") == []


def test_the_folded_search_keeps_the_existing_order_and_pagination(api, searchable):
    ordered = [item["name"] for item in api.get("/cartes", params={"q": "e"}).json()]
    assert ordered == sorted(ordered)
    page = api.get("/cartes", params={"q": "e", "limit": 2, "offset": 1}).json()
    assert [item["name"] for item in page] == ordered[1:3]


def test_the_search_runs_through_the_sql_function(db, searchable):
    from app.models import Card
    from app.services.text_search import contains_folded

    found = db.scalars(select(Card.name).where(contains_folded(Card.name, "ÉLAN")))
    assert sorted(found) == ["Elan brut", "Élan vital"]
