"""Comptabilité du stock sur tout le cycle de vie d'un deck, et decklist figée.

Invariant contrôlé après chaque étape : pour chaque entrée de collection, la
somme des exemplaires réels (`quantity - proxy_quantity`) des lignes de decks
vivants ne dépasse pas `quantity_owned`, et un proxy n'existe que là où
`proxy_allowed` est vrai. Les tests lisent la base par leur propre session `db`,
indépendante de celle de l'API : ils ne voient que ce qui a été validé.
"""

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import CardCopy, Deck, DeckCard, DeletedDeckCard
from app.services import stock
from tests.helpers import add_languages, make_card, make_copy, make_deck

MAX_INT = 2**31 - 1


def add_line(api, deck_id, card_id, language="EN", quantity=1, proxy=0):
    return api.post(
        f"/decks/{deck_id}/cartes",
        json={
            "card_id": card_id,
            "language_code": language,
            "quantity": quantity,
            "proxy_quantity": proxy,
        },
    )


def patch_line(api, deck_id, card_id, language="EN", **fields):
    return api.patch(f"/decks/{deck_id}/cartes/{card_id}/{language}", json=fields)


def set_stock(api, card, language, **fields):
    """Statut HTTP d'un `PATCH /stock/{carte}/{langue}`."""
    return api.patch(f"/stock/{card.id}/{language}", json=fields).status_code


def archive(api, deck_id):
    response = api.patch(f"/decks/{deck_id}", json={"archived": True})
    assert response.status_code == 200
    return response


def unarchive(api, deck_id):
    response = api.patch(f"/decks/{deck_id}", json={"archived": False})
    assert response.status_code == 200
    return response


def delete_deck(api, deck_id):
    archive(api, deck_id)
    response = api.delete(f"/decks/{deck_id}")
    assert response.status_code == 204


def free(db, card, language="EN"):
    """Exemplaires réels encore disponibles pour l'entrée (carte, langue)."""
    db.rollback()  # fin de la transaction courante : on relit la base
    copy = db.get(CardCopy, (card.id, language))
    return copy.quantity_owned - stock.allocated_real(db, card.id, language)


def assert_stock_invariant(db):
    db.rollback()
    used = {
        (card_id, language): total
        for card_id, language, total in db.execute(
            select(
                DeckCard.card_id,
                DeckCard.language_code,
                func.sum(DeckCard.quantity - DeckCard.proxy_quantity),
            ).group_by(DeckCard.card_id, DeckCard.language_code)
        )
    }
    for copy in db.scalars(select(CardCopy)):
        key = (copy.card_id, copy.language_code)
        assert used.get(key, 0) <= copy.quantity_owned, key
    for line in db.scalars(select(DeckCard)):
        if line.proxy_quantity:
            copy = db.get(CardCopy, (line.card_id, line.language_code))
            assert copy.proxy_allowed, (line.card_id, line.language_code)


def frozen_lines(db, deck_id):
    db.rollback()
    rows = db.scalars(
        select(DeletedDeckCard)
        .where(DeletedDeckCard.deck_id == deck_id)
        .order_by(DeletedDeckCard.card_id, DeletedDeckCard.language_code)
    )
    return [(r.card_id, r.language_code, r.quantity, r.proxy_quantity) for r in rows]


def live_lines(db, deck_id):
    db.rollback()
    rows = db.scalars(
        select(DeckCard)
        .where(DeckCard.deck_id == deck_id)
        .order_by(DeckCard.card_id, DeckCard.language_code)
    )
    return [(r.card_id, r.language_code, r.quantity, r.proxy_quantity) for r in rows]


# --- Le cycle complet --------------------------------------------------------


def test_stock_accounting_holds_through_the_whole_deck_lifecycle(api, db):
    add_languages(db, "EN", "FR")
    card = make_card(db, "Cycle")
    make_copy(db, card, "EN", quantity_owned=4, proxy_allowed=True)
    make_copy(db, card, "FR", quantity_owned=1, proxy_allowed=True)
    first = make_deck(db, "Premier")
    second = make_deck(db, "Second")
    db.commit()

    # Création puis ajout de lignes : EN 4 dont 1 proxy = 3 réels ; FR 2 dont
    # 1 proxy = 1 réel.
    assert add_line(api, first.id, card.id, "EN", 4, 1).status_code == 201
    assert add_line(api, first.id, card.id, "FR", 2, 1).status_code == 201
    assert (free(db, card, "EN"), free(db, card, "FR")) == (1, 0)
    assert_stock_invariant(db)

    # Un autre deck ne peut prendre que ce qui reste.
    too_many = add_line(api, second.id, card.id, "EN", 2)
    assert too_many.status_code == 409
    assert "1 disponible" in too_many.json()["detail"]
    assert add_line(api, second.id, card.id, "EN", 1).status_code == 201
    assert free(db, card, "EN") == 0
    assert_stock_invariant(db)

    # Archivage, désarchivage, réarchivage : rien ne se libère ni ne se double.
    archive(api, first.id)
    assert (free(db, card, "EN"), free(db, card, "FR")) == (0, 0)
    assert patch_line(api, second.id, card.id, quantity=2).status_code == 409
    unarchive(api, first.id)
    assert (free(db, card, "EN"), free(db, card, "FR")) == (0, 0)
    archive(api, first.id)
    assert (free(db, card, "EN"), free(db, card, "FR")) == (0, 0)
    assert_stock_invariant(db)

    # La possession ne peut pas descendre sous ce qui est alloué (3 + 1).
    assert set_stock(api, card, "EN", quantity_owned=3) == 409
    assert set_stock(api, card, "EN", quantity_owned=4) == 200

    # Suppression : réels ET proxies redeviennent disponibles.
    assert api.delete(f"/decks/{first.id}").status_code == 204
    assert (free(db, card, "EN"), free(db, card, "FR")) == (3, 1)
    assert stock.proxies_allocated(db, card.id, "EN") == 0
    assert stock.proxies_allocated(db, card.id, "FR") == 0
    assert_stock_invariant(db)

    # `quantity_owned` est réutilisable en entier par un autre deck.
    assert patch_line(api, second.id, card.id, quantity=4).status_code == 200
    assert free(db, card, "EN") == 0
    assert add_line(api, second.id, card.id, "FR", 1).status_code == 201
    assert free(db, card, "FR") == 0
    assert_stock_invariant(db)
    # Plus aucun proxy en deck : le proxy s'interdit à nouveau.
    forbidden = api.patch(f"/stock/{card.id}/FR", json={"proxy_allowed": False})
    assert forbidden.status_code == 200

    # La decklist figée du premier deck n'a pas bougé pendant tout cela.
    assert frozen_lines(db, first.id) == [
        (card.id, "EN", 4, 1),
        (card.id, "FR", 2, 1),
    ]

    # Et le second, archivé puis supprimé à son tour, rend tout.
    delete_deck(api, second.id)
    assert (free(db, card, "EN"), free(db, card, "FR")) == (4, 1)
    assert_stock_invariant(db)


def test_archiving_alone_never_frees_the_stock(api, db):
    add_languages(db, "EN")
    card = make_card(db)
    make_copy(db, card, quantity_owned=3)
    deck = make_deck(db)
    other = make_deck(db, "Autre")
    db.commit()
    assert add_line(api, deck.id, card.id, quantity=3).status_code == 201
    archive(api, deck.id)

    assert add_line(api, other.id, card.id, quantity=1).status_code == 409
    assert api.delete(f"/stock/{card.id}/EN").status_code == 409
    assert free(db, card) == 0


def test_switching_a_line_between_real_and_proxy_moves_the_stock(api, db):
    add_languages(db, "EN")
    card = make_card(db)
    make_copy(db, card, quantity_owned=4, proxy_allowed=True)
    deck = make_deck(db)
    other = make_deck(db, "Autre")
    db.commit()
    assert add_line(api, deck.id, card.id, quantity=4).status_code == 201
    assert add_line(api, other.id, card.id, quantity=1).status_code == 409

    # Tout en proxy : les 4 exemplaires réels sont rendus.
    assert patch_line(api, deck.id, card.id, proxy_quantity=4).status_code == 200
    assert free(db, card) == 4
    assert add_line(api, other.id, card.id, quantity=4).status_code == 201
    assert_stock_invariant(db)

    # Repasser en réel n'est plus possible : l'autre deck a pris les exemplaires.
    back = patch_line(api, deck.id, card.id, proxy_quantity=0)
    assert back.status_code == 409
    assert live_lines(db, deck.id) == [(card.id, "EN", 4, 4)]
    assert_stock_invariant(db)


def test_an_all_proxy_line_consumes_no_real_copy(api, db):
    add_languages(db, "EN")
    card = make_card(db)
    make_copy(db, card, quantity_owned=1, proxy_allowed=True)
    deck = make_deck(db)
    other = make_deck(db, "Autre")
    db.commit()

    assert add_line(api, deck.id, card.id, quantity=3, proxy=3).status_code == 201
    assert free(db, card) == 1
    assert add_line(api, other.id, card.id, quantity=1).status_code == 201
    assert_stock_invariant(db)


def test_the_stock_boundary_accepts_two_to_the_31_minus_one(api, db):
    add_languages(db, "EN")
    card = make_card(db)
    make_copy(db, card, quantity_owned=MAX_INT)
    first = make_deck(db)
    second = make_deck(db, "Autre")
    db.commit()

    assert add_line(api, first.id, card.id, quantity=MAX_INT).status_code == 201
    assert free(db, card) == 0
    assert add_line(api, second.id, card.id, quantity=1).status_code == 409
    assert set_stock(api, card, "EN", quantity_owned=0) == 409

    delete_deck(api, first.id)
    assert free(db, card) == MAX_INT
    assert add_line(api, second.id, card.id, quantity=MAX_INT).status_code == 201
    assert_stock_invariant(db)


# --- La decklist figée -------------------------------------------------------


def test_the_frozen_decklist_is_exactly_the_deck_at_deletion_time(api, db):
    add_languages(db, "EN", "FR", "ES")
    crypt = make_card(db, "Vampire")
    library = make_card(db, "Livre", category="library")
    for language, owned in (("EN", 5), ("FR", 3), ("ES", 2)):
        make_copy(db, crypt, language, quantity_owned=owned, proxy_allowed=True)
    make_copy(db, library, "EN", quantity_owned=9)
    deck = make_deck(db)
    bystander = make_deck(db, "Voisin")
    db.commit()
    for language, quantity, proxy in (("EN", 5, 2), ("FR", 3, 0), ("ES", 4, 4)):
        added = add_line(api, deck.id, crypt.id, language, quantity, proxy)
        assert added.status_code == 201
    assert add_line(api, deck.id, library.id, "EN", 7).status_code == 201
    # Un retrait et une modification avant la suppression : c'est l'état final
    # qui est figé, pas l'historique.
    assert api.delete(f"/decks/{deck.id}/cartes/{crypt.id}/FR").status_code == 204
    assert patch_line(api, deck.id, crypt.id, "EN", quantity=4).status_code == 200
    # Un autre deck partage une entrée : il ne doit pas être touché.
    assert add_line(api, bystander.id, crypt.id, "EN", 1).status_code == 201
    expected = [
        (crypt.id, "EN", 4, 2),
        (crypt.id, "ES", 4, 4),
        (library.id, "EN", 7, 0),
    ]
    assert live_lines(db, deck.id) == expected

    delete_deck(api, deck.id)

    assert frozen_lines(db, deck.id) == expected
    assert live_lines(db, deck.id) == []
    assert live_lines(db, bystander.id) == [(crypt.id, "EN", 1, 0)]
    assert frozen_lines(db, bystander.id) == []
    body = api.get(f"/decks/{deck.id}").json()
    assert [
        (c["card_id"], c["language_code"], c["quantity"], c["proxy_quantity"])
        for c in body["cards"]
    ] == [
        (crypt.id, "EN", 4, 2),
        (crypt.id, "ES", 4, 4),
        (library.id, "EN", 7, 0),
    ]
    keys = [(c["card_id"], c["language_code"]) for c in body["cards"]]
    assert len(keys) == len(set(keys))  # aucun doublon


def test_the_frozen_decklist_ignores_later_stock_changes(api, db):
    add_languages(db, "EN", "FR")
    card = make_card(db)
    make_copy(db, card, "EN", quantity_owned=3)
    make_copy(db, card, "FR", quantity_owned=0, proxy_allowed=True)
    deck = make_deck(db)
    db.commit()
    assert add_line(api, deck.id, card.id, "EN", 3).status_code == 201
    assert add_line(api, deck.id, card.id, "FR", 2, 2).status_code == 201
    delete_deck(api, deck.id)
    before = api.get(f"/decks/{deck.id}").json()["cards"]

    # Le stock bouge dans tous les sens, jusqu'à disparaître.
    assert set_stock(api, card, "EN", quantity_owned=9) == 200
    assert set_stock(api, card, "EN", quantity_owned=0) == 200
    assert set_stock(api, card, "FR", proxy_allowed=False) == 200
    assert api.delete(f"/stock/{card.id}/EN").status_code == 204
    assert api.delete(f"/stock/{card.id}/FR").status_code == 204
    # Puis une entrée neuve, avec d'autres chiffres, et un autre deck qui l'utilise.
    make_copy_via_api = api.post(
        "/stock", json={"card_id": card.id, "language_code": "EN", "quantity_owned": 1}
    )
    assert make_copy_via_api.status_code == 201
    other = make_deck(db, "Autre")
    db.commit()
    assert add_line(api, other.id, card.id, "EN", 1).status_code == 201

    assert api.get(f"/decks/{deck.id}").json()["cards"] == before
    assert frozen_lines(db, deck.id) == [
        (card.id, "EN", 3, 0),
        (card.id, "FR", 2, 2),
    ]


def test_deleting_a_large_deck_freezes_every_line(api, db):
    add_languages(db, "EN")
    deck = make_deck(db)
    cards = [make_card(db, f"Carte {index:03d}") for index in range(150)]
    for card in cards:
        make_copy(db, card, quantity_owned=2)
    db.commit()
    for card in cards:
        assert add_line(api, deck.id, card.id, quantity=2).status_code == 201

    delete_deck(api, deck.id)

    assert len(frozen_lines(db, deck.id)) == 150
    assert live_lines(db, deck.id) == []
    body = api.get(f"/decks/{deck.id}").json()
    assert len(body["cards"]) == 150
    assert {c["quantity"] for c in body["cards"]} == {2}
    assert_stock_invariant(db)


def test_the_stock_entries_of_a_deleted_deck_can_be_recreated_and_reused(api, db):
    add_languages(db, "EN")
    card = make_card(db)
    make_copy(db, card, quantity_owned=2)
    old = make_deck(db, "Ancien")
    db.commit()
    assert add_line(api, old.id, card.id, quantity=2).status_code == 201
    delete_deck(api, old.id)
    assert api.delete(f"/stock/{card.id}/EN").status_code == 204

    created = api.post(
        "/stock", json={"card_id": card.id, "language_code": "EN", "quantity_owned": 1}
    )
    assert created.status_code == 201
    new = make_deck(db, "Neuf")
    db.commit()

    assert add_line(api, new.id, card.id, quantity=2).status_code == 409  # 1 seul
    assert add_line(api, new.id, card.id, quantity=1).status_code == 201
    assert_stock_invariant(db)


def test_delete_runs_in_a_single_commit(api, db, monkeypatch):
    add_languages(db, "EN")
    card = make_card(db)
    make_copy(db, card, quantity_owned=2)
    deck = make_deck(db)
    db.commit()
    assert add_line(api, deck.id, card.id, quantity=2).status_code == 201
    archive(api, deck.id)
    commits = []
    real_commit = Session.commit

    def counting_commit(self):
        commits.append(1)
        return real_commit(self)

    monkeypatch.setattr(Session, "commit", counting_commit)

    assert api.delete(f"/decks/{deck.id}").status_code == 204

    # Copie, suppression des lignes vivantes et `deleted_at` : un seul commit,
    # donc jamais de deck à moitié figé.
    assert len(commits) == 1


def test_a_failure_after_the_copy_leaves_the_deck_untouched(api, db, monkeypatch):
    add_languages(db, "EN")
    card = make_card(db)
    make_copy(db, card, quantity_owned=2)
    deck = make_deck(db)
    db.commit()
    assert add_line(api, deck.id, card.id, quantity=2).status_code == 201
    archive(api, deck.id)

    def failing_commit(self):
        raise RuntimeError("panne au commit")

    monkeypatch.setattr(Session, "commit", failing_commit)
    with pytest.raises(RuntimeError):
        api.delete(f"/decks/{deck.id}")
    monkeypatch.undo()

    db.rollback()
    assert db.get(Deck, deck.id).deleted_at is None
    assert live_lines(db, deck.id) == [(card.id, "EN", 2, 0)]
    assert frozen_lines(db, deck.id) == []
    assert free(db, card) == 0  # le stock n'a pas été libéré
