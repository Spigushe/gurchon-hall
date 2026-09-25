"""Comptabilité du stock sur tout le cycle de vie d'un deck, et decklist figée.

Invariant contrôlé après chaque étape : pour chaque entrée de collection, la
somme des exemplaires réels (`quantity - proxy_quantity`) des lignes de decks
vivants ne dépasse pas `quantity_owned`, et un proxy n'existe que dans un deck
dont `proxy_allowed` est vrai (Lot 4 : propriété du deck, pas de l'entrée de
collection). Les tests lisent la base par leur propre session `db`,
indépendante de celle de l'API : ils ne voient que ce qui a été validé.
"""

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import CardCopy, Deck, DeckCard, DeletedDeckCard
from app.services import stock
from tests.helpers import add_languages, make_card, make_copy, make_deck

MAX_INT = 2**31 - 1


def add_line(
    api, deck_id, card_id, language="EN", quantity=1, proxy=0, *, card_set_id
):
    return api.post(
        f"/decks/{deck_id}/cartes",
        json={
            "card_id": card_id,
            "language_code": language,
            "card_set_id": card_set_id,
            "quantity": quantity,
            "proxy_quantity": proxy,
        },
    )


def patch_line(api, deck_id, card_id, language="EN", *, card_set_id, **fields):
    url = f"/decks/{deck_id}/cartes/{card_id}/{language}/{card_set_id}"
    return api.patch(url, json=fields)


def set_stock(api, card, language, *, card_set_id, **fields):
    """Statut HTTP d'un `PATCH /stock/{carte}/{langue}/{extension}`."""
    url = f"/stock/{card.id}/{language}/{card_set_id}"
    return api.patch(url, json=fields).status_code


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


def free(db, card, language="EN", *, card_set_id):
    """Exemplaires réels encore disponibles pour l'entrée (carte, langue, extension)."""
    db.rollback()  # fin de la transaction courante : on relit la base
    copy = db.get(CardCopy, (card.id, language, card_set_id))
    return copy.quantity_owned - stock.allocated_real(
        db, card.id, language, card_set_id
    )


def assert_stock_invariant(db):
    db.rollback()
    used = {
        (card_id, language, card_set_id): total
        for card_id, language, card_set_id, total in db.execute(
            select(
                DeckCard.card_id,
                DeckCard.language_code,
                DeckCard.card_set_id,
                func.sum(DeckCard.quantity - DeckCard.proxy_quantity),
            ).group_by(
                DeckCard.card_id, DeckCard.language_code, DeckCard.card_set_id
            )
        )
    }
    for copy in db.scalars(select(CardCopy)):
        key = (copy.card_id, copy.language_code, copy.card_set_id)
        assert used.get(key, 0) <= copy.quantity_owned, key
    for line in db.scalars(select(DeckCard)):
        if line.proxy_quantity:
            deck = db.get(Deck, line.deck_id)
            assert deck.proxy_allowed, (line.deck_id, line.card_id, line.language_code)


def frozen_lines(db, deck_id):
    db.rollback()
    rows = db.scalars(
        select(DeletedDeckCard)
        .where(DeletedDeckCard.deck_id == deck_id)
        .order_by(
            DeletedDeckCard.card_id,
            DeletedDeckCard.language_code,
            DeletedDeckCard.card_set_id,
        )
    )
    return [(r.card_id, r.language_code, r.quantity, r.proxy_quantity) for r in rows]


def live_lines(db, deck_id):
    db.rollback()
    rows = db.scalars(
        select(DeckCard)
        .where(DeckCard.deck_id == deck_id)
        .order_by(DeckCard.card_id, DeckCard.language_code, DeckCard.card_set_id)
    )
    return [(r.card_id, r.language_code, r.quantity, r.proxy_quantity) for r in rows]


# --- Le cycle complet --------------------------------------------------------


def test_stock_accounting_holds_through_the_whole_deck_lifecycle(api, db):
    add_languages(db, "EN", "FR")
    card = make_card(db, "Cycle")
    en_copy = make_copy(db, card, "EN", quantity_owned=4)
    fr_copy = make_copy(db, card, "FR", quantity_owned=1)
    en_set, fr_set = en_copy.card_set_id, fr_copy.card_set_id
    first = make_deck(db, "Premier", proxy_allowed=True)
    second = make_deck(db, "Second")
    db.commit()

    # Création puis ajout de lignes : EN 4 dont 1 proxy = 3 réels ; FR 2 dont
    # 1 proxy = 1 réel.
    added_en = add_line(api, first.id, card.id, "EN", 4, 1, card_set_id=en_set)
    assert added_en.status_code == 201
    added_fr = add_line(api, first.id, card.id, "FR", 2, 1, card_set_id=fr_set)
    assert added_fr.status_code == 201
    en_free = free(db, card, "EN", card_set_id=en_set)
    fr_free = free(db, card, "FR", card_set_id=fr_set)
    assert (en_free, fr_free) == (1, 0)
    assert_stock_invariant(db)

    # Un autre deck ne peut prendre que ce qui reste.
    too_many = add_line(api, second.id, card.id, "EN", 2, card_set_id=en_set)
    assert too_many.status_code == 409
    assert "1 disponible" in too_many.json()["detail"]
    added = add_line(api, second.id, card.id, "EN", 1, card_set_id=en_set)
    assert added.status_code == 201
    assert free(db, card, "EN", card_set_id=en_set) == 0
    assert_stock_invariant(db)

    # Archivage, désarchivage, réarchivage : rien ne se libère ni ne se double.
    archive(api, first.id)
    en_free = free(db, card, "EN", card_set_id=en_set)
    fr_free = free(db, card, "FR", card_set_id=fr_set)
    assert (en_free, fr_free) == (0, 0)
    blocked = patch_line(api, second.id, card.id, card_set_id=en_set, quantity=2)
    assert blocked.status_code == 409
    unarchive(api, first.id)
    en_free = free(db, card, "EN", card_set_id=en_set)
    fr_free = free(db, card, "FR", card_set_id=fr_set)
    assert (en_free, fr_free) == (0, 0)
    archive(api, first.id)
    en_free = free(db, card, "EN", card_set_id=en_set)
    fr_free = free(db, card, "FR", card_set_id=fr_set)
    assert (en_free, fr_free) == (0, 0)
    assert_stock_invariant(db)

    # La possession ne peut pas descendre sous ce qui est alloué (3 + 1).
    assert set_stock(api, card, "EN", card_set_id=en_set, quantity_owned=3) == 409
    assert set_stock(api, card, "EN", card_set_id=en_set, quantity_owned=4) == 200

    # Suppression : réels ET proxies redeviennent disponibles.
    assert api.delete(f"/decks/{first.id}").status_code == 204
    en_free = free(db, card, "EN", card_set_id=en_set)
    fr_free = free(db, card, "FR", card_set_id=fr_set)
    assert (en_free, fr_free) == (3, 1)
    assert stock.proxies_allocated(db, card.id, "EN", en_set) == 0
    assert stock.proxies_allocated(db, card.id, "FR", fr_set) == 0
    assert_stock_invariant(db)

    # `quantity_owned` est réutilisable en entier par un autre deck.
    grown = patch_line(api, second.id, card.id, card_set_id=en_set, quantity=4)
    assert grown.status_code == 200
    assert free(db, card, "EN", card_set_id=en_set) == 0
    added_fr2 = add_line(api, second.id, card.id, "FR", 1, card_set_id=fr_set)
    assert added_fr2.status_code == 201
    assert free(db, card, "FR", card_set_id=fr_set) == 0
    assert_stock_invariant(db)

    # La decklist figée du premier deck n'a pas bougé pendant tout cela.
    assert frozen_lines(db, first.id) == [
        (card.id, "EN", 4, 1),
        (card.id, "FR", 2, 1),
    ]

    # Et le second, archivé puis supprimé à son tour, rend tout.
    delete_deck(api, second.id)
    en_free = free(db, card, "EN", card_set_id=en_set)
    fr_free = free(db, card, "FR", card_set_id=fr_set)
    assert (en_free, fr_free) == (4, 1)
    assert_stock_invariant(db)


def test_archiving_alone_never_frees_the_stock(api, db):
    add_languages(db, "EN")
    card = make_card(db)
    copy = make_copy(db, card, quantity_owned=3)
    card_set_id = copy.card_set_id
    deck = make_deck(db)
    other = make_deck(db, "Autre")
    db.commit()
    added = add_line(api, deck.id, card.id, quantity=3, card_set_id=card_set_id)
    assert added.status_code == 201
    archive(api, deck.id)

    blocked = add_line(api, other.id, card.id, quantity=1, card_set_id=card_set_id)
    assert blocked.status_code == 409
    assert api.delete(f"/stock/{card.id}/EN/{card_set_id}").status_code == 409
    assert free(db, card, card_set_id=card_set_id) == 0


def test_two_printings_of_the_same_card_and_language_have_independent_allocations(
    api, db
):
    """Lot 4 : deux impressions de la même carte et de la même langue sont
    deux pools de stock séparés. Épuiser l'un ne doit ni permettre de piocher
    dans l'autre, ni être débloqué par lui — chaque refus se compte sur sa
    propre impression."""
    add_languages(db, "EN")
    card = make_card(db)
    first = make_copy(db, card, "EN", quantity_owned=3)  # première impression
    second = make_copy(
        db, card, "EN", quantity_owned=2, card_set_id=None
    )  # seconde impression, propre extension
    assert first.card_set_id != second.card_set_id
    first_set, second_set = first.card_set_id, second.card_set_id
    first_deck = make_deck(db, "Sous la première impression")
    second_deck = make_deck(db, "Sous la seconde")
    db.commit()

    # La première impression est intégralement allouée...
    added_first = add_line(
        api, first_deck.id, card.id, quantity=3, card_set_id=first_set
    )
    assert added_first.status_code == 201
    # ...un deck qui en redemande sous la MÊME impression est refusé, même si
    # la seconde impression a encore 2 exemplaires libres.
    blocked = add_line(api, second_deck.id, card.id, quantity=1, card_set_id=first_set)
    assert blocked.status_code == 409
    assert free(db, card, card_set_id=first_set) == 0
    assert free(db, card, card_set_id=second_set) == 2

    # La seconde impression, elle, reste allouable indépendamment.
    added_second = add_line(
        api, second_deck.id, card.id, quantity=2, card_set_id=second_set
    )
    assert added_second.status_code == 201
    assert free(db, card, card_set_id=second_set) == 0
    assert_stock_invariant(db)

    # Baisser le stock de la première impression sous ce qu'elle alloue est
    # refusé ; celui de la seconde n'est pas concerné.
    assert set_stock(api, card, "EN", card_set_id=first_set, quantity_owned=2) == 409
    assert set_stock(api, card, "EN", card_set_id=second_set, quantity_owned=2) == 200

    # Une fois la seconde impression libérée par son deck, son entrée se
    # supprime ; celle de la première, encore allouée, reste refusée.
    released = api.delete(
        f"/decks/{second_deck.id}/cartes/{card.id}/EN/{second_set}"
    )
    assert released.status_code == 204
    assert api.delete(f"/stock/{card.id}/EN/{first_set}").status_code == 409
    assert api.delete(f"/stock/{card.id}/EN/{second_set}").status_code == 204


def test_switching_a_line_between_real_and_proxy_moves_the_stock(api, db):
    add_languages(db, "EN")
    card = make_card(db)
    copy = make_copy(db, card, quantity_owned=4)
    card_set_id = copy.card_set_id
    deck = make_deck(db, proxy_allowed=True)
    other = make_deck(db, "Autre")
    db.commit()
    added = add_line(api, deck.id, card.id, quantity=4, card_set_id=card_set_id)
    assert added.status_code == 201
    blocked = add_line(api, other.id, card.id, quantity=1, card_set_id=card_set_id)
    assert blocked.status_code == 409

    # Tout en proxy : les 4 exemplaires réels sont rendus.
    all_proxy = patch_line(
        api, deck.id, card.id, card_set_id=card_set_id, proxy_quantity=4
    )
    assert all_proxy.status_code == 200
    assert free(db, card, card_set_id=card_set_id) == 4
    taken = add_line(api, other.id, card.id, quantity=4, card_set_id=card_set_id)
    assert taken.status_code == 201
    assert_stock_invariant(db)

    # Repasser en réel n'est plus possible : l'autre deck a pris les exemplaires.
    back = patch_line(api, deck.id, card.id, card_set_id=card_set_id, proxy_quantity=0)
    assert back.status_code == 409
    assert live_lines(db, deck.id) == [(card.id, "EN", 4, 4)]
    assert_stock_invariant(db)


def test_an_all_proxy_line_consumes_no_real_copy(api, db):
    add_languages(db, "EN")
    card = make_card(db)
    copy = make_copy(db, card, quantity_owned=1)
    card_set_id = copy.card_set_id
    deck = make_deck(db, proxy_allowed=True)
    other = make_deck(db, "Autre")
    db.commit()

    added = add_line(
        api, deck.id, card.id, quantity=3, proxy=3, card_set_id=card_set_id
    )
    assert added.status_code == 201
    assert free(db, card, card_set_id=card_set_id) == 1
    other_added = add_line(api, other.id, card.id, quantity=1, card_set_id=card_set_id)
    assert other_added.status_code == 201
    assert_stock_invariant(db)


def test_the_stock_boundary_accepts_two_to_the_31_minus_one(api, db):
    add_languages(db, "EN")
    card = make_card(db)
    copy = make_copy(db, card, quantity_owned=MAX_INT)
    card_set_id = copy.card_set_id
    first = make_deck(db)
    second = make_deck(db, "Autre")
    db.commit()

    added = add_line(api, first.id, card.id, quantity=MAX_INT, card_set_id=card_set_id)
    assert added.status_code == 201
    assert free(db, card, card_set_id=card_set_id) == 0
    blocked = add_line(api, second.id, card.id, quantity=1, card_set_id=card_set_id)
    assert blocked.status_code == 409
    lowered = set_stock(api, card, "EN", card_set_id=card_set_id, quantity_owned=0)
    assert lowered == 409

    delete_deck(api, first.id)
    assert free(db, card, card_set_id=card_set_id) == MAX_INT
    reused = add_line(
        api, second.id, card.id, quantity=MAX_INT, card_set_id=card_set_id
    )
    assert reused.status_code == 201
    assert_stock_invariant(db)


# --- La decklist figée -------------------------------------------------------


def test_the_frozen_decklist_is_exactly_the_deck_at_deletion_time(api, db):
    add_languages(db, "EN", "FR", "ES")
    crypt = make_card(db, "Vampire")
    library = make_card(db, "Livre", category="library")
    crypt_sets = {
        language: make_copy(db, crypt, language, quantity_owned=owned).card_set_id
        for language, owned in (("EN", 5), ("FR", 3), ("ES", 2))
    }
    library_set = make_copy(db, library, "EN", quantity_owned=9).card_set_id
    deck = make_deck(db, proxy_allowed=True)
    bystander = make_deck(db, "Voisin")
    db.commit()
    for language, quantity, proxy in (("EN", 5, 2), ("FR", 3, 0), ("ES", 4, 4)):
        added = add_line(
            api, deck.id, crypt.id, language, quantity, proxy,
            card_set_id=crypt_sets[language],
        )
        assert added.status_code == 201
    added_library = add_line(
        api, deck.id, library.id, "EN", 7, card_set_id=library_set
    )
    assert added_library.status_code == 201
    # Un retrait et une modification avant la suppression : c'est l'état final
    # qui est figé, pas l'historique.
    fr_line = f"/decks/{deck.id}/cartes/{crypt.id}/FR/{crypt_sets['FR']}"
    assert api.delete(fr_line).status_code == 204
    patched = patch_line(
        api, deck.id, crypt.id, "EN", card_set_id=crypt_sets["EN"], quantity=4
    )
    assert patched.status_code == 200
    # Un autre deck partage une entrée : il ne doit pas être touché.
    shared = add_line(
        api, bystander.id, crypt.id, "EN", 1, card_set_id=crypt_sets["EN"]
    )
    assert shared.status_code == 201
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
    en_copy = make_copy(db, card, "EN", quantity_owned=3)
    fr_copy = make_copy(db, card, "FR", quantity_owned=0)
    en_set, fr_set = en_copy.card_set_id, fr_copy.card_set_id
    deck = make_deck(db, proxy_allowed=True)
    db.commit()
    added_en = add_line(api, deck.id, card.id, "EN", 3, card_set_id=en_set)
    assert added_en.status_code == 201
    added_fr = add_line(api, deck.id, card.id, "FR", 2, 2, card_set_id=fr_set)
    assert added_fr.status_code == 201
    delete_deck(api, deck.id)
    before = api.get(f"/decks/{deck.id}").json()["cards"]

    # Le stock bouge dans tous les sens, jusqu'à disparaître.
    assert set_stock(api, card, "EN", card_set_id=en_set, quantity_owned=9) == 200
    assert set_stock(api, card, "EN", card_set_id=en_set, quantity_owned=0) == 200
    assert api.delete(f"/stock/{card.id}/EN/{en_set}").status_code == 204
    assert api.delete(f"/stock/{card.id}/FR/{fr_set}").status_code == 204
    # Puis une entrée neuve, avec d'autres chiffres, et un autre deck qui l'utilise.
    make_copy_via_api = api.post(
        "/stock",
        json={
            "card_id": card.id,
            "language_code": "EN",
            "card_set_id": en_set,
            "quantity_owned": 1,
        },
    )
    assert make_copy_via_api.status_code == 201
    other = make_deck(db, "Autre")
    db.commit()
    reused = add_line(api, other.id, card.id, "EN", 1, card_set_id=en_set)
    assert reused.status_code == 201

    assert api.get(f"/decks/{deck.id}").json()["cards"] == before
    assert frozen_lines(db, deck.id) == [
        (card.id, "EN", 3, 0),
        (card.id, "FR", 2, 2),
    ]


def test_deleting_a_large_deck_freezes_every_line(api, db):
    add_languages(db, "EN")
    deck = make_deck(db)
    cards = [make_card(db, f"Carte {index:03d}") for index in range(150)]
    card_sets = {
        card.id: make_copy(db, card, quantity_owned=2).card_set_id for card in cards
    }
    db.commit()
    for card in cards:
        added = add_line(
            api, deck.id, card.id, quantity=2, card_set_id=card_sets[card.id]
        )
        assert added.status_code == 201

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
    copy = make_copy(db, card, quantity_owned=2)
    card_set_id = copy.card_set_id
    old = make_deck(db, "Ancien")
    db.commit()
    added = add_line(api, old.id, card.id, quantity=2, card_set_id=card_set_id)
    assert added.status_code == 201
    delete_deck(api, old.id)
    assert api.delete(f"/stock/{card.id}/EN/{card_set_id}").status_code == 204

    created = api.post(
        "/stock",
        json={
            "card_id": card.id,
            "language_code": "EN",
            "card_set_id": card_set_id,
            "quantity_owned": 1,
        },
    )
    assert created.status_code == 201
    new = make_deck(db, "Neuf")
    db.commit()

    too_many = add_line(api, new.id, card.id, quantity=2, card_set_id=card_set_id)
    assert too_many.status_code == 409  # 1 seul
    added_new = add_line(api, new.id, card.id, quantity=1, card_set_id=card_set_id)
    assert added_new.status_code == 201
    assert_stock_invariant(db)


def test_delete_runs_in_a_single_commit(api, db, monkeypatch):
    add_languages(db, "EN")
    card = make_card(db)
    copy = make_copy(db, card, quantity_owned=2)
    deck = make_deck(db)
    db.commit()
    added = add_line(api, deck.id, card.id, quantity=2, card_set_id=copy.card_set_id)
    assert added.status_code == 201
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
    copy = make_copy(db, card, quantity_owned=2)
    deck = make_deck(db)
    db.commit()
    added = add_line(api, deck.id, card.id, quantity=2, card_set_id=copy.card_set_id)
    assert added.status_code == 201
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
    assert free(db, card, card_set_id=copy.card_set_id) == 0  # le stock non libéré
