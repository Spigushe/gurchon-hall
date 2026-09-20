"""Discriminant de deck, au niveau du service, avec le tirage injecté (`pick=`).

Les tests HTTP de `test_api_deck_lifecycle.py` passent par un remplacement
global de `pick_discriminator` ; ceux-ci exercent le paramètre `pick` de
`create_deck` / `update_deck`, et l'unicité (nom, discriminant) contre les decks
supprimés.
"""

import re
from datetime import UTC, datetime

import pytest
from sqlalchemy import func, insert, select

from app.models import Deck
from app.schemas.collection import DeckCreate, DeckUpdate
from app.services import decks
from app.services.errors import ConflictError
from tests.helpers import make_deck


def spy(*values):
    """Un tirage qui rend ces valeurs dans l'ordre (la dernière se répète).

    Renvoie (fonction de tirage, liste des ensembles « pris » reçus).
    """
    seen = []
    remaining = list(values)

    def pick(taken):
        seen.append(set(taken))
        return remaining.pop(0) if len(remaining) > 1 else remaining[0]

    return pick, seen


def count_decks(db):
    db.rollback()
    return db.scalar(select(func.count()).select_from(Deck))


def deleted(db, name, discriminator):
    return make_deck(
        db,
        name,
        discriminator=discriminator,
        archived_at=datetime.now(UTC),
        deleted_at=datetime.now(UTC),
    )


def fill_name(db, name, *, skipping=(), deleted_at=None):
    """Prend tous les discriminants du nom, sauf ceux de `skipping`."""
    db.execute(
        insert(Deck),
        [
            {"name": name, "discriminator": f"{n:04d}", "deleted_at": deleted_at}
            for n in range(1, 10_000)
            if f"{n:04d}" not in skipping
        ],
    )
    db.commit()


# --- Tirage ------------------------------------------------------------------


def test_create_deck_uses_the_injected_picker(db):
    pick, seen = spy("0500")

    deck = decks.create_deck(db, DeckCreate(name="Alpha"), pick=pick)

    assert deck.discriminator == "0500"
    assert seen == [set()]
    db.rollback()
    assert db.scalars(select(Deck.discriminator)).all() == ["0500"]


def test_the_picker_sees_the_live_archived_and_deleted_discriminators_of_the_name(db):
    make_deck(db, "Alpha", discriminator="0001")
    make_deck(db, "Alpha", discriminator="0002", archived_at=datetime.now(UTC))
    deleted(db, "Alpha", "0003")
    make_deck(db, "Beta", discriminator="0004")
    db.commit()
    pick, seen = spy("0500")

    decks.create_deck(db, DeckCreate(name="Alpha"), pick=pick)

    assert seen == [{"0001", "0002", "0003"}]  # rien de « Beta »


def test_the_real_picker_only_returns_four_digits_never_zero():
    draws = {decks.pick_discriminator(set()) for _ in range(300)}

    assert all(re.fullmatch(r"\d{4}", d) for d in draws)
    assert "0000" not in draws
    assert len(draws) > 100  # tiré au hasard, pas constant


def test_the_only_free_discriminator_is_the_one_attributed(db):
    # Vivants et supprimés mêlés : « 4242 » est le seul libre.
    fill_name(db, "Plein", skipping={"4242"})
    db.execute(
        Deck.__table__.update()
        .where(Deck.name == "Plein", Deck.discriminator < "5000")
        .values(deleted_at=datetime.now(UTC))
    )
    db.commit()

    deck = decks.create_deck(db, DeckCreate(name="Plein"))

    assert deck.discriminator == "4242"


def test_homonyms_all_get_different_discriminators(db):
    created = [decks.create_deck(db, DeckCreate(name="Même nom")) for _ in range(25)]

    assert len({d.discriminator for d in created}) == 25


# --- Retry et abandon --------------------------------------------------------


def test_create_retries_through_the_injected_picker(db):
    make_deck(db, "Alpha", discriminator="0042")
    db.commit()
    # Le tirage retombe deux fois sur un couple pris : la base refuse, on réessaie.
    pick, seen = spy("0042", "0042", "0043")

    deck = decks.create_deck(db, DeckCreate(name="Alpha"), pick=pick)

    assert deck.discriminator == "0043"
    assert len(seen) == 3
    assert count_decks(db) == 2


def test_create_gives_up_after_exactly_the_attempt_limit(db):
    make_deck(db, "Alpha", discriminator="0042")
    db.commit()
    pick, seen = spy("0042")

    with pytest.raises(ConflictError) as error:
        decks.create_deck(db, DeckCreate(name="Alpha"), pick=pick)

    assert len(seen) == decks.DISCRIMINATOR_ATTEMPTS == 20
    assert "20" in error.value.message
    assert count_decks(db) == 1
    # La session reste utilisable après tous ces rollbacks.
    assert decks.create_deck(db, DeckCreate(name="Alpha")).discriminator != "0042"


def test_rename_uses_the_injected_picker_when_the_couple_is_taken(db):
    make_deck(db, "Alpha", discriminator="0001")
    other = make_deck(db, "Beta", discriminator="0001")
    db.commit()
    pick, seen = spy("0777")

    renamed = decks.update_deck(db, other.id, DeckUpdate(name="Alpha"), pick=pick)

    assert (renamed.name, renamed.discriminator) == ("Alpha", "0777")
    assert seen == [{"0001"}]


def test_rename_does_not_draw_when_the_discriminator_is_free_under_the_new_name(db):
    make_deck(db, "Alpha", discriminator="0001")
    other = make_deck(db, "Beta", discriminator="0002")
    db.commit()
    pick, seen = spy("0999")

    renamed = decks.update_deck(db, other.id, DeckUpdate(name="Alpha"), pick=pick)

    assert renamed.discriminator == "0002"
    assert seen == []


def test_rename_to_the_same_name_neither_draws_nor_changes_anything(db):
    deck = make_deck(db, "Alpha", discriminator="0123")
    db.commit()
    pick, seen = spy("0999")

    decks.update_deck(db, deck.id, DeckUpdate(name="Alpha"), pick=pick)

    assert seen == []
    db.rollback()
    assert db.get(Deck, deck.id).discriminator == "0123"


def test_the_renamed_deck_does_not_collide_with_itself(db):
    # Le deck ne compte pas parmi les « pris » du nom qu'il quitte ou rejoint.
    deck = make_deck(db, "Alpha", discriminator="0001")
    db.commit()
    pick, seen = spy("0999")

    decks.update_deck(db, deck.id, DeckUpdate(name="Beta"), pick=pick)

    assert seen == []
    db.rollback()
    assert db.get(Deck, deck.id).discriminator == "0001"


def test_rename_retries_and_keeps_the_other_fields(db, monkeypatch):
    make_deck(db, "Alpha", discriminator="0001")
    other = make_deck(db, "Beta", discriminator="0001")
    db.commit()
    # Course simulée : le service croit le couple libre, la base refuse.
    real = decks._taken_discriminators
    calls = []

    def blind_once(db_, name, *, excluding_id=None):
        calls.append(name)
        return set() if len(calls) == 1 else real(db_, name, excluding_id=excluding_id)

    pick, _ = spy("0008")
    monkeypatch.setattr(decks, "_taken_discriminators", blind_once)

    renamed = decks.update_deck(
        db, other.id, DeckUpdate(name="Alpha", notes="gardée"), pick=pick
    )

    assert (renamed.name, renamed.discriminator, renamed.notes) == (
        "Alpha",
        "0008",
        "gardée",
    )
    assert len(calls) == 2


def test_renaming_frees_the_old_names_discriminator(db):
    deck = make_deck(db, "Alpha", discriminator="0001")
    db.commit()
    decks.update_deck(db, deck.id, DeckUpdate(name="Beta"))
    pick, seen = spy("0001")

    created = decks.create_deck(db, DeckCreate(name="Alpha"), pick=pick)

    assert seen == [set()]  # plus rien de pris sous « Alpha »
    assert created.discriminator == "0001"


def test_two_homonyms_renamed_apart_and_together_stay_distinct(db):
    first = make_deck(db, "Alpha", discriminator="0001")
    second = make_deck(db, "Beta", discriminator="0001")
    db.commit()

    decks.update_deck(db, first.id, DeckUpdate(name="Gamma"))
    decks.update_deck(db, second.id, DeckUpdate(name="Gamma"))  # 0001 pris chez Gamma

    db.rollback()
    couples = {(d.name, d.discriminator) for d in db.scalars(select(Deck))}
    assert len(couples) == 2
    assert {name for name, _ in couples} == {"Gamma"}


# --- Saturation --------------------------------------------------------------


def test_deleted_decks_still_count_toward_saturation(db):
    fill_name(db, "Saturé", deleted_at=datetime.now(UTC))

    with pytest.raises(ConflictError) as error:
        decks.create_deck(db, DeckCreate(name="Saturé"))

    assert "9999" in error.value.message
    assert decks.create_deck(db, DeckCreate(name="Autre")).discriminator


def test_a_deleted_discriminator_is_never_handed_out_again(db):
    # Tout est pris sauf « 1234 », que porte un deck supprimé : créer un homonyme
    # est refusé, plutôt que de réattribuer le couple du deck supprimé.
    fill_name(db, "Plein", skipping={"1234"})
    deleted(db, "Plein", "1234")
    db.commit()

    with pytest.raises(ConflictError):
        decks.create_deck(db, DeckCreate(name="Plein"))

    assert count_decks(db) == 9999


def test_saturation_is_refused_on_rename_and_leaves_the_deck_alone(db):
    fill_name(db, "Saturé", deleted_at=datetime.now(UTC))
    other = make_deck(db, "Autre", discriminator="0001", notes="avant")
    db.commit()

    with pytest.raises(ConflictError):
        decks.update_deck(db, other.id, DeckUpdate(name="Saturé", notes="après"))

    db.rollback()
    kept = db.get(Deck, other.id)
    assert (kept.name, kept.discriminator, kept.notes) == ("Autre", "0001", "avant")
