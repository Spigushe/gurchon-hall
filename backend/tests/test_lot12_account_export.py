"""Lot 12, étape B2 : l'export du compte, `GET /moi/export` (P3, A4).

Ce que ce fichier éprouve (`docs/lot12-plan-consolidation.md`) :

* la réponse : pièce jointe nommée `gurchon-hall-<username>-<date>.json`,
  `Cache-Control: private, no-store`, corps conforme à `AccountExport` ;
* le contenu par domaine : collection, decks vivants, archivés et supprimés
  (un deck supprimé avec sa liste figée), versions jouées sous leur deck,
  joueurs, lieux, tournois avec la version de chaque deck joué, parties avec
  leur table triée par siège, adversaire non nommé compris ;
* une carte par `vekn_id` et nom, une extension par abréviation, un clan par
  son nom : jamais un identifiant du catalogue ;
* l'isolation : rien d'un second compte, ni hachage, ni session, ni
  identifiant de compte ;
* la couverture : toute table qui porte un `user_id` est exportée ou exclue
  par décision écrite, pour qu'une table ajoutée au Lot 14 ne soit pas
  oubliée en silence ;
* la révision de la base, lue dans `alembic_version`.
"""

import json
import re
from datetime import UTC, datetime

import pytest
from sqlalchemy import text

from app.models import Base
from app.models.collection import DeckCard
from app.models.reference import Clan
from app.schemas.account_export import AccountExport
from app.services import account_export as export_service
from app.services import players
from tests.auth_helpers import log_in, make_account
from tests.helpers import (
    add_languages,
    make_card,
    make_card_set,
    make_copy,
    make_deck,
    make_printing,
)

EMAIL = "export@example.com"
OTHER_EMAIL = "autre@example.com"
PLAYED = "2026-10-24T20:00:00+02:00"

# Tables privées couvertes par l'export, et celles qui en sont exclues par
# décision (P3, A4). Toute table à `user_id` doit figurer dans l'une des deux.
EXPORTED_TABLES = {
    "card_copy",
    "deck",
    "deck_card",
    "deck_version",
    "player",
    "venue",
    "tournament",
    "game",
    "participation",
    "tournament_deck_version",
    "deck_share",  # Lot 13, A5 : sans le jeton
    "tournament_report",  # lot Compte-rendu, A7 : sans le jeton
}
EXCLUDED_TABLES = {
    "auth_session",  # les sessions : un secret, pas une donnée de l'utilisateur
    "sync_operation",  # le journal : technique, volumineux, sans valeur lisible
}
# Tables privées sans `user_id`, lues à travers leur deck (ou leur lien, Lot 13).
EXPORTED_THROUGH_DECK = {
    "deleted_deck_card",
    "deck_version_card",
    "deck_share_card",
    "tournament_report_version",
}


def _account(db, email, username):
    account = make_account(db, email=email, username=username)
    players.get_or_create_me(db, account.id, account.username)
    db.commit()
    return account


@pytest.fixture
def account(db):
    return _account(db, EMAIL, "exporteur")


@pytest.fixture
def me_api(api, account):
    log_in(api, EMAIL)
    return api


@pytest.fixture
def catalog(db):
    add_languages(db, "EN", "FR")
    kot = make_card_set(db, "KoT")
    v5 = make_card_set(db, "V5")
    theo = make_card(db, "Theo Bell", group_code="2")
    bleed = make_card(db, "Govern the Unaligned", category="library")
    make_printing(db, theo, kot)
    make_printing(db, bleed, kot)
    make_printing(db, bleed, v5)
    clan = Clan(name="Tremere", abbrev="TRE")
    db.add(clan)
    db.commit()
    return {"kot": kot, "v5": v5, "theo": theo, "bleed": bleed, "clan": clan}


def _export(api) -> dict:
    response = api.get("/moi/export")
    assert response.status_code == 200, response.text
    return response.json()


def _line(db, deck, card, card_set, language="EN", quantity=1, proxies=0):
    deck.cards.append(
        DeckCard(
            card_id=card.id,
            language_code=language,
            card_set_id=card_set.id,
            quantity=quantity,
            proxy_quantity=proxies,
        )
    )
    db.flush()


@pytest.fixture
def filled(db, me_api, account, catalog):
    """Un compte qui a un peu de tout, construit par la base et par l'API."""
    c = catalog
    make_copy(db, c["theo"], "EN", 2, card_set_id=c["kot"].id, user_id=account.id)
    make_copy(db, c["bleed"], "FR", 3, card_set_id=c["v5"].id, user_id=account.id)
    played = make_deck(db, "Banu Princes", True, user_id=account.id)
    _line(db, played, c["theo"], c["kot"], quantity=2)
    _line(db, played, c["bleed"], c["v5"], "FR", quantity=4, proxies=1)
    gone = make_deck(db, "Ancien deck", True, user_id=account.id)
    _line(db, gone, c["bleed"], c["kot"], quantity=3, proxies=3)
    db.commit()
    assert me_api.patch(f"/decks/{gone.id}", json={"archived": True}).is_success
    assert me_api.delete(f"/decks/{gone.id}").status_code == 204
    shelved = me_api.post("/decks", json={"name": "Rangé"}).json()
    assert me_api.patch(f"/decks/{shelved['id']}", json={"archived": True}).is_success

    venue = me_api.post("/lieux", json={"name": "Club", "city": "Lyon"}).json()
    marc = me_api.post("/joueurs", json={"name": "Marc"}).json()
    tournament = me_api.post(
        "/tournois",
        json={
            "name": "Open de Lyon",
            "start_date": "2026-10-24",
            "venue": {"venue_id": venue["id"]},
        },
    ).json()
    game = me_api.post(
        "/parties",
        json={
            "played_at": PLAYED,
            "player_count": 5,
            "tournament": {"tournament_id": tournament["id"]},
            "venue": {"venue_id": venue["id"]},
            "round_type": "preliminary",
            "round_number": 1,
            "participations": [
                {
                    "seat": 3,
                    "opponent_deck_archetype": "bleed",
                    "opponent_clan_id": c["clan"].id,
                },
                {"player": {"player_id": marc["id"]}, "seat": 2},
                {
                    "player": {"me": True},
                    "seat": 1,
                    "deck": {"deck_id": played.id},
                    "victory_points": 3,
                },
            ],
        },
    )
    assert game.status_code == 201, game.text
    return {
        "played": played.id,
        "gone": gone.id,
        "shelved": shelved["id"],
        "venue": venue["id"],
        "marc": marc["id"],
        "tournament": tournament["id"],
        "game": game.json()["id"],
    }


# --- La réponse --------------------------------------------------------------


def test_the_export_is_an_attachment_named_after_the_account_and_the_day(me_api):
    response = me_api.get("/moi/export")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.headers["Cache-Control"] == "private, no-store"
    day = datetime.now(UTC).date().isoformat()
    assert response.headers["Content-Disposition"] == (
        f'attachment; filename="gurchon-hall-exporteur-{day}.json"'
    )
    AccountExport.model_validate(response.json())


def test_a_cross_origin_client_can_read_the_file_name(me_api):
    # Le front et l'API sont sur deux hôtes (Lot 11) : sans `expose_headers`, le
    # navigateur cacherait l'en-tête au client, qui reprend ce nom (Lot 12, D1).
    response = me_api.get("/moi/export", headers={"Origin": "http://localhost:5173"})

    assert response.status_code == 200
    exposed = response.headers["access-control-expose-headers"]
    assert "Content-Disposition" in exposed
    assert "Retry-After" in exposed


def test_the_file_name_takes_the_utc_day_of_the_export():
    late = datetime(2026, 11, 18, 23, 30, tzinfo=UTC)
    assert export_service.export_filename("lea-v", late) == (
        "gurchon-hall-lea-v-2026-11-18.json"
    )


def test_an_empty_account_exports_its_account_and_its_me(me_api, account):
    body = _export(me_api)

    assert body["format_version"] == 3
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z", body["exported_at"])
    assert body["account"] == {
        "email": EMAIL,
        "username": "exporteur",
        "role": "user",
        "created_at": body["account"]["created_at"],
        "display_name": None,
    }
    assert body["players"] == [
        {"id": body["players"][0]["id"], "name": "exporteur", "is_me": True}
    ]
    for key in ("collection", "decks", "venues", "tournaments", "games"):
        assert body[key] == []


def test_the_export_requires_a_session(api):
    response = api.get("/moi/export")
    assert response.status_code == 401
    assert "Content-Disposition" not in response.headers


# --- Le contenu par domaine --------------------------------------------------


def test_the_collection_names_cards_by_vekn_id_and_sets_by_abbreviation(
    me_api, filled, catalog
):
    collection = _export(me_api)["collection"]

    assert collection == [
        {
            "vekn_id": catalog["bleed"].vekn_id,
            "card_name": "Govern the Unaligned",
            "language_code": "FR",
            "card_set_abbrev": "V5",
            "quantity_owned": 3,
            "notes": None,
        },
        {
            "vekn_id": catalog["theo"].vekn_id,
            "card_name": "Theo Bell",
            "language_code": "EN",
            "card_set_abbrev": "KoT",
            "quantity_owned": 2,
            "notes": None,
        },
    ]


def test_every_deck_is_there_archived_and_deleted_included(me_api, filled):
    decks = {deck["id"]: deck for deck in _export(me_api)["decks"]}

    assert list(decks) == sorted(decks)
    assert set(decks) == {filled["played"], filled["gone"], filled["shelved"]}
    assert decks[filled["played"]]["archived_at"] is None
    assert decks[filled["played"]]["proxy_allowed"] is True
    assert decks[filled["shelved"]]["archived_at"] is not None
    assert decks[filled["shelved"]]["deleted_at"] is None
    assert decks[filled["gone"]]["deleted_at"] is not None


def test_a_live_deck_carries_its_lines(me_api, filled, catalog):
    deck = next(d for d in _export(me_api)["decks"] if d["id"] == filled["played"])

    assert deck["cards"] == [
        {
            "vekn_id": catalog["bleed"].vekn_id,
            "card_name": "Govern the Unaligned",
            "language_code": "FR",
            "card_set_abbrev": "V5",
            "quantity": 4,
            "proxy_quantity": 1,
        },
        {
            "vekn_id": catalog["theo"].vekn_id,
            "card_name": "Theo Bell",
            "language_code": "EN",
            "card_set_abbrev": "KoT",
            "quantity": 2,
            "proxy_quantity": 0,
        },
    ]


def test_a_deleted_deck_carries_its_frozen_list(me_api, filled, catalog):
    deck = next(d for d in _export(me_api)["decks"] if d["id"] == filled["gone"])

    assert deck["cards"] == [
        {
            "vekn_id": catalog["bleed"].vekn_id,
            "card_name": "Govern the Unaligned",
            "language_code": "EN",
            "card_set_abbrev": "KoT",
            "quantity": 3,
            "proxy_quantity": 3,
        }
    ]


def test_played_versions_are_stored_under_their_deck(me_api, filled, catalog):
    decks = {deck["id"]: deck for deck in _export(me_api)["decks"]}

    (version,) = decks[filled["played"]]["versions"]
    assert version["number"] == 1
    assert version["cards"] == [
        {
            "vekn_id": catalog["bleed"].vekn_id,
            "card_name": "Govern the Unaligned",
            "quantity": 4,
        },
        {"vekn_id": catalog["theo"].vekn_id, "card_name": "Theo Bell", "quantity": 2},
    ]
    assert decks[filled["gone"]]["versions"] == []


def test_the_address_book_is_there(me_api, filled):
    body = _export(me_api)

    assert [(p["name"], p["is_me"]) for p in body["players"]] == [
        ("exporteur", True),
        ("Marc", False),
    ]
    assert body["venues"] == [
        {"id": filled["venue"], "name": "Club", "city": "Lyon", "notes": None}
    ]


def test_a_tournament_names_the_version_of_each_deck_played(me_api, filled):
    (tournament,) = _export(me_api)["tournaments"]

    assert tournament["id"] == filled["tournament"]
    assert tournament["name"] == "Open de Lyon"
    assert tournament["start_date"] == "2026-10-24"
    assert tournament["venue_id"] == filled["venue"]
    assert tournament["deck_versions"] == [
        {
            "deck_id": filled["played"],
            "deck_version_number": 1,
            "frozen_by_game_id": filled["game"],
        }
    ]
    assert "my_summary" not in tournament


def test_a_game_carries_its_table_sorted_by_seat(me_api, filled):
    (game,) = _export(me_api)["games"]

    assert game["id"] == filled["game"]
    assert game["played_at"] == "2026-10-24T18:00:00Z"
    assert game["tournament_id"] == filled["tournament"]
    assert game["round_type"] == "preliminary"
    assert game["round_number"] == 1
    me, marc, unnamed = game["participations"]
    assert me == {
        "player_id": me["player_id"],
        "is_me": True,
        "seat": 1,
        "deck_id": filled["played"],
        "deck_version_number": 1,
        "victory_points": 3.0,
        "game_win": True,
        "opponent_deck_name": None,
        "opponent_deck_archetype": None,
        "opponent_clan": None,
        "notes": None,
    }
    assert marc["player_id"] == filled["marc"]
    assert (marc["is_me"], marc["seat"]) == (False, 2)
    assert unnamed["player_id"] is None
    assert unnamed["is_me"] is False
    assert unnamed["opponent_deck_archetype"] == "bleed"
    assert unnamed["opponent_clan"] == "Tremere"


def test_unseated_lines_come_last(me_api, account):
    response = me_api.post(
        "/parties",
        json={
            "played_at": PLAYED,
            "player_count": 4,
            "participations": [
                {"opponent_deck_name": "Sans siège"},
                {"player": {"me": True}, "seat": 2},
            ],
        },
    )
    assert response.status_code == 201, response.text

    (game,) = _export(me_api)["games"]
    assert [p["seat"] for p in game["participations"]] == [2, None]


# --- Isolation et secrets ----------------------------------------------------


def _other_account_data(db, other, catalog):
    kot = catalog["kot"].id
    make_copy(db, catalog["theo"], "FR", 9, card_set_id=kot, user_id=other.id)
    make_deck(db, "Deck de l'autre", user_id=other.id)
    db.commit()


def test_nothing_of_another_account_enters_the_export(
    db, api_client_factory, filled, catalog
):
    other = _account(db, OTHER_EMAIL, "autre")
    _other_account_data(db, other, catalog)
    client = api_client_factory()
    log_in(client, OTHER_EMAIL)
    assert client.post("/lieux", json={"name": "Chez l'autre"}).status_code == 201

    other_body = _export(client)
    assert other_body["account"]["email"] == OTHER_EMAIL
    assert [e["quantity_owned"] for e in other_body["collection"]] == [9]
    assert [d["name"] for d in other_body["decks"]] == ["Deck de l'autre"]
    assert [v["name"] for v in other_body["venues"]] == ["Chez l'autre"]
    assert [p["name"] for p in other_body["players"]] == ["autre"]
    assert other_body["tournaments"] == other_body["games"] == []


def test_mine_does_not_see_the_other_account_either(db, me_api, filled, catalog):
    other = _account(db, OTHER_EMAIL, "autre")
    _other_account_data(db, other, catalog)

    body = _export(me_api)
    assert 9 not in [e["quantity_owned"] for e in body["collection"]]
    assert "Deck de l'autre" not in [d["name"] for d in body["decks"]]
    assert "autre" not in [p["name"] for p in body["players"]]


def test_the_export_carries_no_secret_nor_account_identifier(
    db, me_api, account, filled
):
    raw = me_api.get("/moi/export").text
    db.refresh(account)

    assert account.password_hash not in raw
    for word in ("password", "token", "user_id", "session"):
        assert word not in raw
    stored_hashes = db.execute(text("SELECT token_hash FROM auth_session")).scalars()
    for token_hash in stored_hashes:
        assert token_hash not in raw
    assert "id" not in json.loads(raw)["account"]


# --- Couverture des tables privées -------------------------------------------


def test_every_private_table_is_exported_or_excluded_on_purpose():
    with_owner = {
        table.name for table in Base.metadata.sorted_tables if "user_id" in table.c
    }
    assert with_owner == EXPORTED_TABLES | EXCLUDED_TABLES, (
        "Une table privée a été ajoutée ou retirée : l'exporter dans "
        "app/services/account_export.py, ou l'exclure par décision écrite "
        "(docs/lot12-plan-consolidation.md, A4), puis mettre ce test à jour."
    )
    assert EXPORTED_THROUGH_DECK <= set(Base.metadata.tables)


# --- Révision de la base -----------------------------------------------------


def test_the_revision_is_unknown_without_an_alembic_table(me_api):
    assert _export(me_api)["schema_revision"] == export_service.UNKNOWN_REVISION


def test_the_revision_is_read_from_the_database(db, me_api):
    db.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"))
    db.execute(text("INSERT INTO alembic_version VALUES ('c4e8a1f2d7b3')"))
    db.commit()

    assert _export(me_api)["schema_revision"] == "c4e8a1f2d7b3"
