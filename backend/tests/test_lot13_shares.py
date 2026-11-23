"""Lot 13, étapes B1 et B2 : les liens publics vers une decklist
(`docs/lot13-plan-partage.md`, P1 à P5, A3 à A5).

Ce que ce fichier éprouve :

* la création d'un lien vivant ou figé (liste courante ou version jouée),
  le tirage du jeton et son nouvel essai sur collision ;
* le cycle de vie (P5) : un vivant suit le deck, un figé ne bouge pas, un deck
  archivé reste partagé, la suppression d'un deck retire ses vivants et garde
  ses figés ;
* les trois purges, la sélection refusée en entier, l'isolation entre comptes ;
* la lecture publique : 404 uniforme, 422 de forme, cookie sans effet, en-têtes,
  limite de débit, nom d'utilisateur toujours présent, notes selon l'option,
  `reprinted_card_ids` ;
* l'export du compte, sans jeton.
"""

import re

import pytest
from sqlalchemy import func, select

from app.models import (
    DeckArchetype,
    DeckCard,
    DeckShare,
    DeckShareCard,
    DeckShareKind,
    DeckVersion,
    DeckVersionCard,
)
from app.models.share import SHARE_TOKEN_ALPHABET
from app.schemas.share import DeckShareCreate, SharePurgeScope
from app.services import shares as share_service
from app.services.errors import ConflictError
from tests.auth_helpers import DEFAULT_PASSWORD, log_in, make_account
from tests.helpers import (
    add_languages,
    make_card,
    make_card_set,
    make_deck,
    make_printing,
)

NOT_FOUND = "Liste introuvable."


@pytest.fixture
def owner(db):
    return make_account(db, email="proprio@example.com", username="proprio")


@pytest.fixture
def me_api(api, owner):
    log_in(api, "proprio@example.com")
    return api


@pytest.fixture
def stranger(db):
    return make_account(db, email="etranger@example.com", username="etranger")


@pytest.fixture
def stranger_api(api_client_factory, stranger):
    client = api_client_factory()
    log_in(client, "etranger@example.com", DEFAULT_PASSWORD)
    return client


@pytest.fixture
def catalog(db):
    """Une crypte (dont un vampire réimprimé), une carte de bibliothèque, deux
    extensions et deux langues."""
    add_languages(db, "EN", "FR")
    kot = make_card_set(db, "KoT")
    v5 = make_card_set(db, "V5")
    old = make_card(db, "Theo Bell", group_code="2", advanced=False)
    new = make_card(db, "Theo Bell", group_code="6", advanced=False)
    adv = make_card(db, "Theo Bell", group_code="2", advanced=True)
    govern = make_card(db, "Govern the Unaligned", category="library")
    for card in (old, new, adv):
        make_printing(db, card, kot)
    make_printing(db, govern, kot)
    make_printing(db, govern, v5)
    db.commit()
    # `vekn_id` croissant : `old` est la version d'origine de « Theo Bell ».
    assert old.vekn_id < new.vekn_id
    return {"kot": kot, "v5": v5, "old": old, "new": new, "adv": adv, "govern": govern}


def add_line(db, deck, card, card_set, quantity, language="EN", proxies=0):
    db.add(
        DeckCard(
            deck_id=deck.id,
            user_id=deck.user_id,
            card_id=card.id,
            language_code=language,
            card_set_id=card_set.id,
            quantity=quantity,
            proxy_quantity=proxies,
        )
    )
    db.flush()


@pytest.fixture
def deck(db, owner, catalog):
    """Un deck de 6 cartes : 2 + 1 Govern en deux langues et deux extensions,
    plus 3 « Theo Bell » G6."""
    deck = make_deck(
        db,
        "Banu Princes",
        user_id=owner.id,
        archetype=DeckArchetype.BLEED,
        notes="Notes privées",
    )
    add_line(db, deck, catalog["govern"], catalog["kot"], 2, "EN")
    add_line(db, deck, catalog["govern"], catalog["v5"], 1, "FR")
    add_line(db, deck, catalog["new"], catalog["kot"], 3, "EN")
    db.commit()
    return deck


def create(api, deck, **body):
    body.setdefault("kind", "live")
    response = api.post(f"/decks/{deck.id}/partages", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def read(api, token):
    return api.get(f"/listes/{token}")


def quantities(body) -> dict[int, int]:
    return {line["card"]["id"]: line["quantity"] for line in body["cards"]}


def archive_and_delete(api, deck):
    assert api.patch(f"/decks/{deck.id}", json={"archived": True}).status_code == 200
    assert api.delete(f"/decks/{deck.id}").status_code == 204


# --- Création ----------------------------------------------------------------


def test_a_token_has_eight_characters_of_the_alphabet(me_api, deck):
    tokens = {create(me_api, deck)["token"] for _ in range(30)}
    assert len(tokens) == 30
    for token in tokens:
        assert re.fullmatch(r"[A-Za-z0-9_]{8}", token)
    assert set(share_service.pick_token()) <= set(SHARE_TOKEN_ALPHABET)


def test_a_live_share_returns_its_token_and_the_state_of_its_deck(me_api, deck):
    share = create(me_api, deck)
    assert share["kind"] == "live"
    assert share["show_notes"] is False
    assert share["frozen_name"] is None
    assert share["deck_version_number"] is None
    assert share["deck"] == {
        "id": deck.id,
        "name": "Banu Princes",
        "discriminator": deck.discriminator,
        "archived_at": None,
        "deleted_at": None,
    }
    assert share["created_at"].endswith("Z")


def test_a_frozen_share_copies_name_archetype_and_the_summed_list(db, me_api, deck):
    share = create(me_api, deck, kind="frozen")
    assert share["frozen_name"] == "Banu Princes"
    copied = {
        line.card_id: line.quantity
        for line in db.scalars(
            select(DeckShareCard).where(DeckShareCard.deck_share_id == share["id"])
        )
    }
    # Langues et extensions confondues, comme `freeze_decklist` du Lot 8.
    assert sorted(copied.values()) == [3, 3]


def test_a_frozen_share_of_a_played_version_copies_that_version(
    db, me_api, deck, catalog
):
    version = DeckVersion(user_id=deck.user_id, deck_id=deck.id, number=1)
    version.cards = [DeckVersionCard(card_id=catalog["govern"].id, quantity=5)]
    db.add(version)
    db.commit()

    share = create(me_api, deck, kind="frozen", deck_version_number=1)
    assert share["deck_version_number"] == 1
    body = read(me_api, share["token"]).json()
    assert quantities(body) == {catalog["govern"].id: 5}
    # La version elle-même n'a pas bougé et aucune version n'est née du partage.
    assert db.scalar(select(func.count()).select_from(DeckVersion)) == 1


def test_an_unknown_version_number_is_a_404(me_api, deck):
    response = me_api.post(
        f"/decks/{deck.id}/partages", json={"kind": "frozen", "deck_version_number": 4}
    )
    assert response.status_code == 404
    assert response.json()["detail"] == f"Version 4 du deck {deck.id} introuvable."


def test_the_frozen_notes_are_not_kept_unless_shown(db, me_api, deck):
    hidden = create(me_api, deck, kind="frozen")
    shown = create(me_api, deck, kind="frozen", show_notes=True)
    rows = {
        share.id: share.frozen_notes
        for share in db.scalars(select(DeckShare))
    }
    assert rows[hidden["id"]] is None
    assert rows[shown["id"]] == "Notes privées"


def test_a_token_collision_draws_again(db, owner, deck):
    first = share_service.create_deck_share(
        db, owner.id, deck.id, DeckShareCreate(kind=DeckShareKind.LIVE)
    )
    draws = iter([first.token, first.token, "Zz9_Zz9_"])

    second = share_service.create_deck_share(
        db,
        owner.id,
        deck.id,
        DeckShareCreate(kind=DeckShareKind.FROZEN),
        pick=lambda: next(draws),
    )

    assert second.token == "Zz9_Zz9_"
    assert next(draws, None) is None
    assert {s.token for s in db.scalars(select(DeckShare))} == {
        first.token,
        "Zz9_Zz9_",
    }


def test_twenty_collisions_end_in_a_409(db, owner, deck):
    taken = share_service.create_deck_share(
        db, owner.id, deck.id, DeckShareCreate(kind=DeckShareKind.LIVE)
    ).token
    calls = []

    def always_taken():
        calls.append(1)
        return taken

    with pytest.raises(ConflictError):
        share_service.create_deck_share(
            db,
            owner.id,
            deck.id,
            DeckShareCreate(kind=DeckShareKind.LIVE),
            pick=always_taken,
        )
    assert len(calls) == share_service.SHARE_TOKEN_ATTEMPTS
    assert db.scalar(select(func.count()).select_from(DeckShare)) == 1


def test_an_archived_deck_can_be_shared(me_api, deck):
    assert me_api.patch(f"/decks/{deck.id}", json={"archived": True}).status_code == 200
    live = create(me_api, deck)
    frozen = create(me_api, deck, kind="frozen")
    assert read(me_api, live["token"]).status_code == 200
    assert read(me_api, frozen["token"]).status_code == 200
    assert live["deck"]["archived_at"] is not None


def test_a_deleted_deck_cannot_be_shared_but_lists_its_frozen_shares(me_api, deck):
    live = create(me_api, deck)
    frozen = create(me_api, deck, kind="frozen")
    archive_and_delete(me_api, deck)

    response = me_api.post(f"/decks/{deck.id}/partages", json={"kind": "live"})
    assert response.status_code == 409

    listed = me_api.get(f"/decks/{deck.id}/partages")
    assert listed.status_code == 200
    assert [share["id"] for share in listed.json()] == [frozen["id"]]
    assert listed.json()[0]["deck"]["deleted_at"] is not None
    assert live["id"] not in [share["id"] for share in listed.json()]


# --- Lecture publique : contenu ----------------------------------------------


def test_a_live_share_follows_the_deck(db, me_api, deck, catalog):
    token = create(me_api, deck)["token"]
    before = read(me_api, token).json()
    assert sum(before["cards"][i]["quantity"] for i in range(2)) == 6

    add_line(db, deck, catalog["old"], catalog["kot"], 2)
    deck.name = "Renommé"
    db.commit()

    after = read(me_api, token).json()
    assert after["name"] == "Renommé"
    assert sum(line["quantity"] for line in after["cards"]) == 8


def test_a_frozen_share_does_not_move(db, me_api, deck, catalog):
    token = create(me_api, deck, kind="frozen")["token"]
    before = read(me_api, token).json()

    add_line(db, deck, catalog["old"], catalog["kot"], 2)
    deck.name = "Renommé"
    deck.archetype = DeckArchetype.VOTE
    db.commit()

    assert read(me_api, token).json() == before
    assert before["name"] == "Banu Princes"
    assert before["archetype"] == "bleed"
    assert before["kind"] == "frozen"
    assert before["frozen_at"].endswith("Z")


def test_the_public_body_has_cards_summed_and_no_private_field(me_api, deck, catalog):
    body = read(me_api, create(me_api, deck)["token"]).json()
    assert set(body) == {
        "name",
        "archetype",
        "kind",
        "frozen_at",
        "author",
        "notes",
        "cards",
        "reprinted_card_ids",
    }
    assert body["frozen_at"] is None
    assert quantities(body) == {catalog["govern"].id: 3, catalog["new"].id: 3}
    assert [line["card"]["id"] for line in body["cards"]] == sorted(
        [catalog["govern"].id, catalog["new"].id]
    )
    first = body["cards"][0]["card"]
    assert {"name", "category", "group_code", "card_set_ids"} <= set(first)
    assert "discriminator" not in body
    assert "user_id" not in str(body)


def test_the_author_is_the_username_read_at_consultation(db, me_api, owner, deck):
    live = create(me_api, deck)["token"]
    frozen = create(me_api, deck, kind="frozen")["token"]
    assert read(me_api, live).json()["author"] == "proprio"
    assert read(me_api, frozen).json()["author"] == "proprio"

    owner.username = "nouveau-nom"
    db.commit()
    assert read(me_api, live).json()["author"] == "nouveau-nom"
    assert read(me_api, frozen).json()["author"] == "nouveau-nom"


@pytest.mark.parametrize("kind", ["live", "frozen"])
def test_notes_follow_the_option(me_api, deck, kind):
    hidden = read(me_api, create(me_api, deck, kind=kind)["token"]).json()
    shown = read(
        me_api, create(me_api, deck, kind=kind, show_notes=True)["token"]
    ).json()
    assert hidden["notes"] is None
    assert shown["notes"] == "Notes privées"


def test_a_reprinted_vampire_is_marked_but_not_its_original_nor_its_advanced(
    db, me_api, deck, catalog
):
    add_line(db, deck, catalog["old"], catalog["kot"], 1)
    add_line(db, deck, catalog["adv"], catalog["kot"], 1)
    db.commit()
    body = read(me_api, create(me_api, deck)["token"]).json()
    assert body["reprinted_card_ids"] == [catalog["new"].id]


def test_an_empty_deck_gives_an_empty_list(db, me_api, owner):
    empty = make_deck(db, "Vide", user_id=owner.id)
    db.commit()
    for kind in ("live", "frozen"):
        body = read(me_api, create(me_api, empty, kind=kind)["token"]).json()
        assert body["cards"] == []
        assert body["reprinted_card_ids"] == []


def test_a_live_share_of_a_deleted_deck_is_gone_and_a_frozen_one_stays(me_api, deck):
    live = create(me_api, deck)["token"]
    frozen = create(me_api, deck, kind="frozen")["token"]
    archive_and_delete(me_api, deck)

    assert read(me_api, live).status_code == 404
    survivor = read(me_api, frozen)
    assert survivor.status_code == 200
    assert survivor.json()["name"] == "Banu Princes"


def test_deleting_a_deck_by_sync_also_revokes_its_live_shares(db, me_api, deck):
    from uuid import uuid4

    live = create(me_api, deck)["token"]
    frozen = create(me_api, deck, kind="frozen")["token"]
    assert me_api.patch(f"/decks/{deck.id}", json={"archived": True}).status_code == 200
    response = me_api.post(
        "/sync",
        json={
            "operations": [
                {
                    "type": "deck.delete",
                    "operation_id": str(uuid4()),
                    "recorded_at": "2026-11-20T10:00:00Z",
                    "deck": {"deck_id": deck.id},
                }
            ]
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["results"][0]["outcome"] == "applied"
    assert read(me_api, live).status_code == 404
    assert read(me_api, frozen).status_code == 200


# --- Lecture publique : forme de la route ------------------------------------


def test_an_unknown_and_a_purged_token_give_the_same_404(me_api, deck):
    token = create(me_api, deck)["token"]
    unknown = read(me_api, "inconnu_")
    assert unknown.status_code == 404
    assert unknown.json() == {"detail": NOT_FOUND}

    assert me_api.delete("/moi/partages?scope=all").status_code == 200
    purged = read(me_api, token)
    assert purged.status_code == 404
    assert purged.json() == unknown.json()


def test_the_cache_headers_are_public_and_never_private(api, me_api, deck):
    token = create(me_api, deck)["token"]
    for client in (me_api, api):
        response = read(client, token)
        assert response.headers["cache-control"] == "public, max-age=60"
        assert response.headers["x-robots-tag"] == "noindex"
    # Le même cookie de session ne fait pas apparaître `private` sur la liste,
    # alors que la même session le pose sur une route privée.
    assert me_api.get("/moi/partages").headers["cache-control"] == "private, no-store"


def test_the_rate_limit_answers_429_with_retry_after(api, me_api, deck, monkeypatch):
    token = create(me_api, deck)["token"]
    monkeypatch.setenv("SHARED_LIST_RATE_LIMIT", "3/minute")
    api.cookies.clear()
    statuses = [read(api, token).status_code for _ in range(5)]
    assert statuses == [200, 200, 200, 429, 429]
    limited = read(api, token)
    assert "retry-after" in limited.headers
    # L'ordre est 422, puis la limite : un jeton mal formé ne consomme rien.
    assert api.get("/listes/mal-formé").status_code == 422


def test_the_rate_limit_comes_before_the_404(api, monkeypatch):
    monkeypatch.setenv("SHARED_LIST_RATE_LIMIT", "2/minute")
    assert [read(api, "inconnu_").status_code for _ in range(3)] == [404, 404, 429]


def test_the_default_rate_limit_is_sixty_per_minute(monkeypatch):
    from app.services.rate_limit import shared_list_rate_limit

    monkeypatch.delenv("SHARED_LIST_RATE_LIMIT", raising=False)
    assert shared_list_rate_limit() == "60/minute"


# --- Routes sous session : isolation -----------------------------------------


def test_another_accounts_deck_is_a_plain_404(me_api, stranger_api, deck):
    unknown = stranger_api.get("/decks/999999/partages")
    assert unknown.status_code == 404
    for response in (
        stranger_api.get(f"/decks/{deck.id}/partages"),
        stranger_api.post(f"/decks/{deck.id}/partages", json={"kind": "live"}),
    ):
        assert response.status_code == 404
        assert response.json()["detail"] == f"Deck {deck.id} introuvable."
    assert unknown.json()["detail"] == "Deck 999999 introuvable."


def test_the_lists_only_show_the_accounts_own_links(
    db, me_api, stranger_api, stranger, deck
):
    mine = create(me_api, deck)
    other = make_deck(db, "Autre", user_id=stranger.id)
    db.commit()
    theirs = create(stranger_api, other, kind="frozen")

    assert [s["id"] for s in me_api.get("/moi/partages").json()] == [mine["id"]]
    assert [s["id"] for s in stranger_api.get("/moi/partages").json()] == [theirs["id"]]


def test_the_lists_run_from_newest_to_oldest_and_include_deleted_decks(
    me_api, deck, db, owner
):
    first = create(me_api, deck)
    second = create(me_api, deck, kind="frozen")
    gone = make_deck(db, "Parti", user_id=owner.id)
    db.commit()
    third = create(me_api, gone, kind="frozen")
    archive_and_delete(me_api, gone)

    listed = me_api.get("/moi/partages").json()
    assert [s["id"] for s in listed] == [third["id"], second["id"], first["id"]]
    assert listed[0]["deck"]["deleted_at"] is not None
    assert [s["id"] for s in me_api.get(f"/decks/{deck.id}/partages").json()] == [
        second["id"],
        first["id"],
    ]


# --- Purges ------------------------------------------------------------------


def purge(api, query):
    return api.delete(f"/moi/partages?{query}")


@pytest.fixture
def mixed(db, me_api, owner, deck):
    """Un vivant et un figé d'un deck vivant, un figé d'un deck supprimé."""
    live = create(me_api, deck)
    frozen = create(me_api, deck, kind="frozen")
    gone = make_deck(db, "Parti", user_id=owner.id)
    db.commit()
    survivor = create(me_api, gone, kind="frozen")
    archive_and_delete(me_api, gone)
    return live, frozen, survivor


def remaining(db) -> set[int]:
    db.expire_all()
    return set(db.scalars(select(DeckShare.id)))


def test_a_selection_purges_exactly_its_links(db, me_api, mixed):
    live, frozen, survivor = mixed
    response = purge(me_api, f"scope=selected&share_id={live['id']}")
    assert response.status_code == 200
    assert response.json() == {"revoked": 1}
    assert remaining(db) == {frozen["id"], survivor["id"]}
    assert read(me_api, live["token"]).status_code == 404
    assert read(me_api, frozen["token"]).status_code == 200


def test_a_selection_counts_a_repeated_link_once(db, me_api, mixed):
    live, frozen, _ = mixed
    query = f"scope=selected&share_id={live['id']}&share_id={live['id']}"
    assert purge(me_api, query).json() == {"revoked": 1}


def test_a_selection_is_refused_whole_for_an_unknown_link(db, me_api, mixed):
    live, _, _ = mixed
    before = remaining(db)
    response = purge(me_api, f"scope=selected&share_id={live['id']}&share_id=999999")
    assert response.status_code == 404
    assert response.json()["detail"] == "Lien 999999 introuvable."
    assert remaining(db) == before


def test_a_selection_is_refused_whole_for_another_accounts_link(
    db, me_api, stranger_api, stranger, mixed
):
    live, _, _ = mixed
    other = make_deck(db, "Autre", user_id=stranger.id)
    db.commit()
    theirs = create(stranger_api, other)
    before = remaining(db)

    response = purge(
        me_api, f"scope=selected&share_id={live['id']}&share_id={theirs['id']}"
    )

    assert response.status_code == 404
    assert response.json()["detail"] == f"Lien {theirs['id']} introuvable."
    assert remaining(db) == before
    unknown = purge(me_api, "scope=selected&share_id=999999")
    assert unknown.json()["detail"] == "Lien 999999 introuvable."


def test_a_selection_takes_the_links_of_deleted_decks_too(db, me_api, mixed):
    # P5 amendée à F (2026-11-22) : un lien d'un deck supprimé se purge à l'unité.
    live, frozen, survivor = mixed
    response = purge(
        me_api, f"scope=selected&share_id={live['id']}&share_id={survivor['id']}"
    )
    assert response.status_code == 200
    assert response.json() == {"revoked": 2}
    assert remaining(db) == {frozen["id"]}
    assert read(me_api, survivor["token"]).status_code == 404


def test_a_selection_purges_one_link_of_a_deleted_deck_and_keeps_the_other(
    db, me_api, deck
):
    first = create(me_api, deck, kind="frozen")
    second = create(me_api, deck, kind="frozen")
    archive_and_delete(me_api, deck)
    response = purge(me_api, f"scope=selected&share_id={first['id']}")
    assert response.json() == {"revoked": 1}
    assert remaining(db) == {second["id"]}
    assert read(me_api, first["token"]).status_code == 404
    assert read(me_api, second["token"]).status_code == 200


def test_a_selection_with_a_deleted_decks_link_is_still_refused_whole(
    db, me_api, mixed
):
    _, _, survivor = mixed
    before = remaining(db)
    response = purge(
        me_api, f"scope=selected&share_id={survivor['id']}&share_id=999999"
    )
    assert response.status_code == 404
    assert remaining(db) == before


def test_the_purge_of_deleted_decks_only_touches_their_frozen_links(
    db, me_api, mixed
):
    live, frozen, survivor = mixed
    assert purge(me_api, "scope=deleted_decks").json() == {"revoked": 1}
    assert remaining(db) == {live["id"], frozen["id"]}
    assert purge(me_api, "scope=deleted_decks").json() == {"revoked": 0}


def test_the_total_purge_empties_the_account_and_is_idempotent(db, me_api, mixed):
    assert purge(me_api, "scope=all").json() == {"revoked": 3}
    assert remaining(db) == set()
    assert db.scalar(select(func.count()).select_from(DeckShareCard)) == 0
    assert purge(me_api, "scope=all").json() == {"revoked": 0}


@pytest.mark.parametrize("scope", ["all", "deleted_decks"])
def test_the_purges_stay_within_the_account(
    db, me_api, stranger_api, stranger, deck, scope
):
    create(me_api, deck, kind="frozen")
    other = make_deck(db, "Autre", user_id=stranger.id)
    db.commit()
    theirs = create(stranger_api, other, kind="frozen")
    archive_and_delete(stranger_api, other)

    purge(me_api, f"scope={scope}")

    assert theirs["id"] in remaining(db)


def test_purge_service_accepts_the_enum_scope(db, owner, deck):
    share_service.create_deck_share(
        db, owner.id, deck.id, DeckShareCreate(kind=DeckShareKind.LIVE)
    )
    assert share_service.purge_shares(db, owner.id, SharePurgeScope.ALL) == 1


# --- Export du compte --------------------------------------------------------


def test_the_export_carries_the_shares_but_never_their_token(db, me_api, deck):
    live = create(me_api, deck)
    frozen = create(me_api, deck, kind="frozen", show_notes=True)

    response = me_api.get("/moi/export")
    body = response.json()

    assert body["format_version"] == 3  # 3 depuis le lot Compte-rendu (A7)
    assert live["token"] not in response.text
    assert frozen["token"] not in response.text
    assert "token" not in str(body["shares"])
    by_id = {share["id"]: share for share in body["shares"]}
    assert by_id[live["id"]]["kind"] == "live"
    assert by_id[live["id"]]["cards"] == []
    exported = by_id[frozen["id"]]
    assert exported["deck_id"] == body["decks"][0]["id"]
    assert exported["frozen_name"] == "Banu Princes"
    assert exported["frozen_archetype"] == "bleed"
    assert exported["frozen_notes"] == "Notes privées"
    assert exported["show_notes"] is True
    assert sorted(card["quantity"] for card in exported["cards"]) == [3, 3]
    assert {"vekn_id", "card_name", "quantity"} == set(exported["cards"][0])


def test_the_export_leaves_out_another_accounts_shares(
    db, me_api, stranger_api, stranger, deck
):
    other = make_deck(db, "Autre", user_id=stranger.id)
    db.commit()
    create(stranger_api, other, kind="frozen")
    assert me_api.get("/moi/export").json()["shares"] == []


# --- Étape E : cycle de vie bout en bout et formes de jeton --------------------


@pytest.mark.parametrize("token", ["aB3x_9p", "aB3x_9pQQ", "aB3x-9pQ", "aB3x_9pé"])
def test_a_malformed_token_is_a_422_with_or_without_a_session(api, me_api, token):
    # `me_api` ouvre une session sur le même client : le cookie est présent.
    with_cookie = api.get(f"/listes/{token}")
    api.cookies.clear()
    without_cookie = api.get(f"/listes/{token}")
    assert with_cookie.status_code == without_cookie.status_code == 422
    assert "private" not in without_cookie.headers.get("cache-control", "")


def test_the_frozen_link_of_a_deleted_deck_is_read_until_the_purge_of_deleted_decks(
    me_api, api_client_factory, deck
):
    live = create(me_api, deck)
    frozen = create(me_api, deck, kind="frozen")
    archive_and_delete(me_api, deck)

    visitor = api_client_factory()
    assert read(visitor, live["token"]).status_code == 404
    assert read(visitor, frozen["token"]).status_code == 200

    assert purge(me_api, "scope=deleted_decks").json() == {"revoked": 1}
    assert read(visitor, frozen["token"]).status_code == 404


def test_a_selection_purges_the_links_of_an_archived_deck(db, me_api, deck):
    assert me_api.patch(f"/decks/{deck.id}", json={"archived": True}).status_code == 200
    live = create(me_api, deck)
    frozen = create(me_api, deck, kind="frozen")

    response = purge(me_api, f"scope=selected&share_id={live['id']}")

    assert response.json() == {"revoked": 1}
    assert remaining(db) == {frozen["id"]}
    assert read(me_api, live["token"]).status_code == 404
    assert read(me_api, frozen["token"]).status_code == 200
