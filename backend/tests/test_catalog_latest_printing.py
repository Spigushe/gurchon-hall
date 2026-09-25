"""`catalog.latest_card_set_id` (Lot 4, décision D2a).

Les trois règles, dans l'ordre : date effective la plus récente, puis une
extension datée avant une extension sans date à égalité, puis l'abréviation
par ordre alphabétique. L'extension tampon (D2b) ne compte que si elle est la
seule impression de la carte.

Le plan de lot (`docs/lot4-plan-inventaire.md`) cite quatre égalités réelles du
catalogue complet (*Ashur Tablets*, *Emerald Legionnaire*, *Carlton Van Wyk*,
*The Unmasking*), vérifiées à la main sur les 4149 cartes de krcg (§11 de
CLAUDE.md). Le fixture de test backend n'embarque qu'un échantillon de dix
cartes (`tests/fixtures/`) : les reproduire à l'identique demanderait le
catalogue complet. Les tests ci-dessous exercent donc les trois mêmes règles,
y compris les deux points de bascule (extension datée contre non datée,
abréviation alphabétique), sur des données synthétiques qui isolent chaque
règle. Trou de couverture assumé, à signaler : aucun test ne rejoue les quatre
cas réels nommés par le plan contre le catalogue krcg complet.
"""

from datetime import date

import pytest
from sqlalchemy import select

from app.models import Card, CardPrintingOccurrence, CardSet
from app.models.enums import PrintOccurrence
from app.services.catalog import latest_card_set_id
from tests.helpers import make_card, make_card_set, make_printing


def occurrence(db, printing, released_on=None):
    row = CardPrintingOccurrence(
        card_printing_id=printing.id,
        occurrence_type=PrintOccurrence.SINGLE,
        released_on=released_on,
    )
    db.add(row)
    db.flush()
    return row


def loaded_card(db, card_id: int) -> Card:
    """Un `Card` avec `printings` (et leurs `card_set`/`occurrences`) chargés,
    comme l'exige `latest_card_set_id` (pas de requête cachée)."""
    db.expire_all()
    return db.scalars(select(Card).where(Card.id == card_id)).unique().one()


def test_rule_1_the_most_recent_effective_date_wins(db):
    """Une occurrence datée plus tard qu'une autre extension l'emporte, même
    si son extension est plus ancienne (date effective = max des occurrences,
    à défaut la date de sortie de l'extension)."""
    card = make_card(db, "Carte à deux versions")
    old_set = make_card_set(db, "OLD", release_date=None)
    new_set = make_card_set(db, "NEW", release_date=None)
    old_printing = make_printing(db, card, old_set)
    new_printing = make_printing(db, card, new_set)
    occurrence(db, old_printing, released_on=None)
    occurrence(db, new_printing, released_on=None)
    db.commit()
    # Sans date d'occurrence, on retombe sur `release_date` de l'extension.
    old_set.release_date = date(2000, 1, 1)
    new_set.release_date = date(2010, 1, 1)
    db.commit()

    assert latest_card_set_id(loaded_card(db, card.id)) == new_set.id


def test_rule_1_an_occurrence_date_overrides_the_set_release_date(db):
    """Une réédition en solo (occurrence `single`, promo tardive) peut dater
    plus tard que la sortie officielle de sa propre extension."""

    card = make_card(db, "Carte rééditée en promo")
    old_set = make_card_set(db, "BOOSTER", release_date=date(2020, 1, 1))
    promo_set = make_card_set(db, "PROMO", release_date=date(2000, 1, 1))
    old_printing = make_printing(db, card, old_set)
    promo_printing = make_printing(db, card, promo_set)
    occurrence(db, old_printing, released_on=None)
    # La promo elle-même paraît bien après le booster, malgré la date de
    # l'extension « Promo » (regroupée, non datée en soi ici : 2000-01-01,
    # antérieure) : c'est l'occurrence qui fait foi.
    occurrence(db, promo_printing, released_on=date(2023, 6, 1))
    db.commit()

    assert latest_card_set_id(loaded_card(db, card.id)) == promo_set.id


def test_rule_2_a_dated_extension_wins_a_tie_over_an_undated_one(db):
    """À date effective égale, une extension datée (produit commercial)
    passe avant une extension sans date (Promo, POD)."""

    card = make_card(db, "Carte égalité datée")
    dated_set = make_card_set(db, "COM", release_date=date(2021, 3, 7))
    undated_set = make_card_set(db, "POD", release_date=None)
    dated_printing = make_printing(db, card, dated_set)
    undated_printing = make_printing(db, card, undated_set)
    # Même date effective des deux côtés (2021-03-07).
    occurrence(db, dated_printing, released_on=None)
    occurrence(db, undated_printing, released_on=date(2021, 3, 7))
    db.commit()

    assert latest_card_set_id(loaded_card(db, card.id)) == dated_set.id


def test_rule_3_alphabetical_abbreviation_breaks_a_remaining_tie(db):
    """À date effective et statut « datée » égaux des deux côtés, l'abréviation
    d'extension par ordre alphabétique tranche (stable d'une base à l'autre)."""

    card = make_card(db, "Carte égalité alphabétique")
    same_date = date(2019, 2, 16)
    set_b = make_card_set(db, "SP", release_date=same_date)
    set_a = make_card_set(db, "Ant1", release_date=same_date)
    make_printing(db, card, set_b)
    make_printing(db, card, set_a)
    db.commit()

    # « Ant1 » précède « SP » dans l'ordre alphabétique des abréviations.
    assert latest_card_set_id(loaded_card(db, card.id)) == set_a.id


def test_the_placeholder_extension_only_counts_when_it_is_the_only_printing(db):
    """D2b : une impression tampon n'entre en jeu que si elle est la seule
    impression connue de la carte, même si elle porte une date récente."""

    card = make_card(db, "Carte avec tampon et vraie impression")
    real_set = make_card_set(db, "REAL", release_date=date(2000, 1, 1))
    placeholder = CardSet(
        abbrev="TAMPON", is_placeholder=True, release_date=date(2099, 1, 1)
    )
    db.add(placeholder)
    db.flush()
    make_printing(db, card, real_set)
    make_printing(db, card, placeholder)
    db.commit()

    # Le tampon est ignoré malgré sa date « la plus récente ».
    assert latest_card_set_id(loaded_card(db, card.id)) == real_set.id

    # Seule impression restante : le tampon devient la seule candidate.
    only_placeholder = make_card(db, "Carte uniquement tampon")
    make_printing(db, only_placeholder, placeholder)
    db.commit()
    assert latest_card_set_id(loaded_card(db, only_placeholder.id)) == placeholder.id


def test_a_card_without_any_printing_is_a_programming_error(db):
    """Ne devrait jamais arriver une fois l'import en place (D2b garantit au
    moins une impression, réelle ou tampon) : `NotImplementedError` plutôt
    qu'un verdict silencieux."""
    card = make_card(db, "Carte fantôme, sans impression")
    db.commit()

    with pytest.raises(NotImplementedError):
        latest_card_set_id(loaded_card(db, card.id))
