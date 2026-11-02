"""Matrice d'autorisation complète, route par route (Lot 6, étape E, QA).

`test_lot6_isolation.py` documente lui-même son périmètre réduit : « les
trois scénarios que l'étape A3 doit garantir elle-même », pas la matrice
complète. Celui-ci la complète, en énumérant systématiquement, pour chaque
route protégée du contrat (§7 et §11 du plan `docs/lot6-plan-comptes.md`) :

* **401** sans aucune session, sur chaque route protégée, avec le même
  message (« Authentification requise. »), jamais un autre code — y compris
  sur un identifiant qui ne désigne la ressource de personne (§11, « l'ordre
  des contrôles ») ;
* **404**, jamais 403, pour toute ressource d'un autre compte, avec le même
  message qu'un identifiant inconnu ;
* une **liste** d'un compte qui ignore totalement l'autre ;
* les points de la section « Tests attendus (E) » non couverts ailleurs :
  rôles (`POST /langues`, cumulé avec `tests/test_auth_routes.py`),
  comptabilité du stock côté 404/liste, `/sync` au complet (idempotence et
  références client par compte, `mismatched_replay` seulement intra-compte,
  401 qui n'applique ni ne journalise rien).

Ce que ce fichier ne refait pas, parce que c'est déjà testé ailleurs et que
dupliquer n'ajoute rien :

* le discriminant par compte (D2) — `test_deck_discriminator_service.py`,
  `test_two_accounts_can_share_the_same_name_and_discriminator` et
  `test_saturating_one_accounts_discriminators_does_not_affect_another` ;
* les FK composites du Lot 7 — `test_models_constraints.py`,
  `test_participation_deck_fk_rejects_deck_of_another_account` et les tests
  voisins, plus leur pendant migration dans `test_migrations.py`
  (`test_a_participation_cannot_point_at_another_accounts_deck`) ;
* les rôles de `POST /langues` (401 sans session, 403 pour `user`, 201 pour
  `admin`) — `test_auth_routes.py` ; ce fichier n'ajoute que le rappel dans la
  liste de balayage 401 et une vérification explicite que la comparaison se
  fait par niveau, pas par nom. Le compte historique `admin` après migration
  (D6) est vérifié par lecture directe dans
  `test_migrations.py::test_head_creates_the_legacy_account` ; aucune fixture
  de base migrée n'est disponible ici pour le refaire de bout en bout par
  l'API.
"""

from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models import SyncOperation
from app.models.enums import UserRole
from tests.auth_helpers import DEFAULT_PASSWORD, log_in, make_account
from tests.helpers import add_languages, make_card, make_printing

RECORDED_AT = "2026-09-20T20:00:00+02:00"
UNAUTHENTICATED_BODY = {"detail": "Authentification requise."}


@pytest.fixture
def two_accounts(api_client_factory, db):
    """Deux `TestClient` authentifiés, sous deux comptes distincts, sur la
    même base jetable (même patron que `test_lot6_isolation.py`)."""
    make_account(db, email="matrice-a@example.com", username="matrice-a")
    make_account(db, email="matrice-b@example.com", username="matrice-b")
    db.commit()

    client_a = api_client_factory()
    client_b = api_client_factory()
    log_in(client_a, "matrice-a@example.com", DEFAULT_PASSWORD)
    log_in(client_b, "matrice-b@example.com", DEFAULT_PASSWORD)
    return client_a, client_b


def _deck_create_operation(name: str) -> dict:
    return {
        "type": "deck.create",
        "operation_id": str(uuid4()),
        "recorded_at": RECORDED_AT,
        "client_ref": str(uuid4()),
        "data": {"name": name},
    }


# ---------------------------------------------------------------------------
# 401 : balayage de toutes les routes protégées, sans aucune session
# ---------------------------------------------------------------------------

# Une route par entrée du contrat qui exige une session (§7, tableau « Ce qui
# est public, ce qui est protégé »). Les corps sont des formes valides du
# schéma d'écriture : l'authentification doit être tranchée avant toute
# validation de corps ou de chemin (§11, « l'ordre des contrôles »), donc un
# 401 doit sortir même d'une requête par ailleurs recevable.
_PROTECTED_ROUTES = [
    ("GET", "/stock", None),
    (
        "POST",
        "/stock",
        {
            "card_id": 1,
            "language_code": "EN",
            "card_set_id": 1,
            "quantity_owned": 1,
        },
    ),
    ("GET", "/stock/1/EN/1", None),
    ("PATCH", "/stock/1/EN/1", {"quantity_owned": 2}),
    ("DELETE", "/stock/1/EN/1", None),
    ("GET", "/decks", None),
    ("POST", "/decks", {"name": "Deck"}),
    ("GET", "/decks/1", None),
    ("PATCH", "/decks/1", {"notes": "x"}),
    ("DELETE", "/decks/1", None),
    ("GET", "/decks/1/legalite", None),
    (
        "POST",
        "/decks/1/cartes",
        {"card_id": 1, "language_code": "EN", "card_set_id": 1, "quantity": 1},
    ),
    ("PATCH", "/decks/1/cartes/1/EN/1", {"quantity": 2}),
    ("DELETE", "/decks/1/cartes/1/EN/1", None),
    ("POST", "/bundles/1/stock", {"language_code": "EN", "count": 1}),
    ("POST", "/sync", {"operations": [_deck_create_operation("Deck sans session")]}),
    ("GET", "/moi", None),
    ("POST", "/langues", {"code": "DE", "label": "Allemand"}),
    # Lot 7, étape B1 : le Carnet.
    ("GET", "/joueurs", None),
    ("POST", "/joueurs", {"name": "Marc"}),
    ("GET", "/joueurs/1", None),
    ("PATCH", "/joueurs/1", {"name": "Marc F."}),
    ("DELETE", "/joueurs/1", None),
    ("GET", "/lieux", None),
    ("POST", "/lieux", {"name": "Le Bar à Dés"}),
    ("GET", "/lieux/1", None),
    ("PATCH", "/lieux/1", {"city": "Lyon"}),
    ("DELETE", "/lieux/1", None),
    # Lot 7, étape B2 : tournois et parties.
    ("GET", "/tournois", None),
    ("POST", "/tournois", {"name": "Open", "start_date": "2026-10-24"}),
    ("GET", "/tournois/1", None),
    ("PATCH", "/tournois/1", {"notes": "x"}),
    ("DELETE", "/tournois/1", None),
    ("GET", "/parties", None),
    (
        "POST",
        "/parties",
        {
            "played_at": "2026-10-24T20:00:00+02:00",
            "player_count": 5,
            "participations": [{"player": {"me": True}}],
        },
    ),
    ("GET", "/parties/1", None),
    ("PATCH", "/parties/1", {"notes": "x"}),
    (
        "PUT",
        "/parties/1/participations",
        {"participations": [{"player": {"me": True}}]},
    ),
    ("DELETE", "/parties/1", None),
]


@pytest.mark.parametrize(
    "method,path,body",
    _PROTECTED_ROUTES,
    ids=[f"{m} {p}" for m, p, _ in _PROTECTED_ROUTES],
)
def test_every_protected_route_rejects_an_unauthenticated_request(
    api, method, path, body
):
    """Sans session, chaque route protégée rend 401 avec le même message —
    jamais 404 pour un identifiant inconnu, jamais 403, jamais 422 : le
    contrôle de session précède toute autre validation."""
    response = api.request(method, path, json=body)
    assert response.status_code == 401, f"{method} {path} -> {response.status_code}"
    assert response.json() == UNAUTHENTICATED_BODY


def test_public_routes_need_no_session_at_all(api):
    """Contrepoint du balayage ci-dessus : le catalogue partagé reste
    accessible sans aucune session (§7, P5)."""
    assert api.get("/cartes").status_code == 200
    assert api.get("/extensions").status_code == 200
    assert api.get("/bundles").status_code == 200
    assert api.get("/langues").status_code == 200
    assert api.get("/health").status_code == 200


# ---------------------------------------------------------------------------
# 404, jamais 403 : chaque route de deck sur une ressource d'un autre compte
# ---------------------------------------------------------------------------


def _not_found_message(deck_id: int) -> str:
    return f"Deck {deck_id} introuvable."


def test_deck_routes_all_render_a_plain_404_for_another_accounts_deck(two_accounts):
    """Étend `test_lot6_isolation.py` (qui ne couvre que `GET` et `PATCH`) à
    **toutes** les routes de `/decks/{id}` : légalité, composition comprise."""
    api_a, api_b = two_accounts
    deck_a = api_a.post("/decks", json={"name": "Deck privé A"}).json()
    deck_id = deck_a["id"]
    reference = api_b.get("/decks/999999")
    assert reference.status_code == 404
    expected_message = reference.json()["detail"]
    assert expected_message == _not_found_message(999999)

    checks = [
        api_b.get(f"/decks/{deck_id}"),
        api_b.patch(f"/decks/{deck_id}", json={"notes": "intrusion"}),
        api_b.delete(f"/decks/{deck_id}"),
        api_b.get(f"/decks/{deck_id}/legalite"),
        api_b.post(
            f"/decks/{deck_id}/cartes",
            json={
                "card_id": 1,
                "language_code": "EN",
                "card_set_id": 1,
                "quantity": 1,
            },
        ),
        api_b.patch(f"/decks/{deck_id}/cartes/1/EN/1", json={"quantity": 2}),
        api_b.delete(f"/decks/{deck_id}/cartes/1/EN/1"),
    ]
    for response in checks:
        assert response.status_code == 404, response.request.url
        assert response.json()["detail"] == _not_found_message(deck_id)


def test_player_and_venue_routes_render_a_plain_404_for_another_accounts_row(
    two_accounts,
):
    """Lot 7, B1 : mêmes garanties que pour les decks, sur le Carnet. Le détail
    complet (listes, compteurs) est dans `test_players_venues_routes.py`."""
    api_a, api_b = two_accounts
    player = api_a.post("/joueurs", json={"name": "Marc"}).json()
    venue = api_a.post("/lieux", json={"name": "Club"}).json()
    for base, row, label in (
        ("/joueurs", player, "Joueur"),
        ("/lieux", venue, "Lieu"),
    ):
        for response in (
            api_b.get(f"{base}/{row['id']}"),
            api_b.patch(f"{base}/{row['id']}", json={"name": "Intrus"}),
            api_b.delete(f"{base}/{row['id']}"),
        ):
            assert response.status_code == 404, response.request.url
            assert response.json()["detail"] == f"{label} {row['id']} introuvable."


def test_tournament_and_game_routes_render_a_plain_404_for_another_accounts_row(
    two_accounts,
):
    """Lot 7, B2 : tournois et parties, y compris par une référence imbriquée
    (une partie de B qui vise le deck, le tournoi, le lieu ou le joueur de A).
    Le détail des refus est dans `test_play_routes.py`."""
    api_a, api_b = two_accounts
    tournament = api_a.post(
        "/tournois", json={"name": "Open", "start_date": "2026-10-24"}
    ).json()
    deck = api_a.post("/decks", json={"name": "Deck privé A"}).json()
    venue = api_a.post("/lieux", json={"name": "Bar"}).json()
    marc = api_a.post("/joueurs", json={"name": "Marc"}).json()
    game = api_a.post(
        "/parties",
        json={
            "played_at": "2026-10-24T20:00:00+02:00",
            "player_count": 5,
            "participations": [{"player": {"me": True}}],
        },
    ).json()
    table = {"participations": [{"player": {"me": True}}]}
    for response, noun, ident in (
        (api_b.get(f"/tournois/{tournament['id']}"), "Tournoi", tournament["id"]),
        (api_b.get(f"/parties/{game['id']}"), "Partie", game["id"]),
        (
            api_b.put(f"/parties/{game['id']}/participations", json=table),
            "Partie",
            game["id"],
        ),
        (api_b.delete(f"/parties/{game['id']}"), "Partie", game["id"]),
    ):
        assert response.status_code == 404, response.request.url
        assert response.json()["detail"] == f"{noun} {ident} introuvable."
    base = {
        "played_at": "2026-10-24T20:00:00+02:00",
        "player_count": 5,
        "participations": [{"player": {"me": True}}],
    }
    nested = [
        (
            {"tournament": {"tournament_id": tournament["id"]}, "round_type": "final"},
            "Tournoi",
        ),
        ({"venue": {"venue_id": venue["id"]}}, "Lieu"),
        (
            {
                "participations": [
                    {"player": {"me": True}, "deck": {"deck_id": deck["id"]}}
                ]
            },
            "Deck",
        ),
        (
            {
                "participations": [
                    {"player": {"me": True}},
                    {"player": {"player_id": marc["id"]}},
                ]
            },
            "Joueur",
        ),
    ]
    for extra, noun in nested:
        response = api_b.post("/parties", json={**base, **extra})
        assert response.status_code == 404, extra
        assert response.json()["detail"].startswith(f"{noun} ")
    assert api_b.get("/parties").json() == []
    assert api_b.get("/tournois").json() == []


def test_deck_list_of_b_never_shows_a_s_deck(two_accounts):
    api_a, api_b = two_accounts
    deck_a = api_a.post("/decks", json={"name": "Deck privé A"}).json()
    api_b.post("/decks", json={"name": "Deck de B"})

    listed = api_b.get("/decks", params={"state": "all"}).json()

    assert all(deck["id"] != deck_a["id"] for deck in listed)
    assert any(deck["name"] == "Deck de B" for deck in listed)


# ---------------------------------------------------------------------------
# Stock : une clé (carte, langue, extension) possédée par A n'existe pas
# chez B, et le message ne distingue pas ce cas d'une clé réellement
# inconnue.
# ---------------------------------------------------------------------------


def test_stock_entry_of_a_is_a_plain_404_for_b(two_accounts, db):
    """`GET`/`PATCH`/`DELETE` d'une entrée que seul A possède : B reçoit le
    même 404, au même message, qu'une clé qui n'existe pour personne — rien
    ne doit distinguer « cette clé est à quelqu'un d'autre » de « cette clé
    n'existe pas »."""
    api_a, api_b = two_accounts
    add_languages(db, "EN")
    card = make_card(db, "Nefertiti")
    printing = make_printing(db, card)
    db.commit()
    key = f"{card.id}/EN/{printing.card_set_id}"

    created = api_a.post(
        "/stock",
        json={
            "card_id": card.id,
            "language_code": "EN",
            "card_set_id": printing.card_set_id,
            "quantity_owned": 3,
        },
    )
    assert created.status_code == 201

    truly_unknown = api_b.get(f"/stock/{card.id}/EN/999999")
    assert truly_unknown.status_code == 404

    get_response = api_b.get(f"/stock/{key}")
    patch_response = api_b.patch(f"/stock/{key}", json={"quantity_owned": 1})
    delete_response = api_b.delete(f"/stock/{key}")

    for response in (get_response, patch_response, delete_response):
        assert response.status_code == 404, response.request.url
        assert response.json()["detail"] == truly_unknown.json()["detail"].replace(
            "999999", str(printing.card_set_id)
        )


def test_stock_list_of_b_never_shows_a_s_entries(two_accounts, db):
    api_a, api_b = two_accounts
    add_languages(db, "EN")
    card = make_card(db, "Nefertiti")
    printing = make_printing(db, card)
    db.commit()
    api_a.post(
        "/stock",
        json={
            "card_id": card.id,
            "language_code": "EN",
            "card_set_id": printing.card_set_id,
            "quantity_owned": 3,
        },
    )

    listed = api_b.get("/stock").json()

    assert listed == []


# ---------------------------------------------------------------------------
# Rôles : `POST /langues` (cumulé avec `test_auth_routes.py`)
# ---------------------------------------------------------------------------


def test_create_language_by_role_level_not_by_name(api_client_factory, db):
    """401 sans session, 403 pour `user`, 201 pour `admin` : la comparaison se
    fait par niveau (`role.level`), jamais par le nom du rôle (§11, P4)."""
    make_account(
        db, email="role-user@example.com", username="role-user", role=UserRole.USER
    )
    make_account(
        db, email="role-admin@example.com", username="role-admin", role=UserRole.ADMIN
    )
    db.commit()

    anonymous = api_client_factory()
    user_client = api_client_factory()
    admin_client = api_client_factory()
    log_in(user_client, "role-user@example.com", DEFAULT_PASSWORD)
    log_in(admin_client, "role-admin@example.com", DEFAULT_PASSWORD)

    body = {"code": "DE", "label": "Allemand"}
    assert anonymous.post("/langues", json=body).status_code == 401
    assert user_client.post("/langues", json=body).status_code == 403
    assert admin_client.post("/langues", json=body).status_code == 201


# ---------------------------------------------------------------------------
# `/sync` au complet : idempotence et références par compte
# ---------------------------------------------------------------------------


def test_sync_mismatched_replay_is_only_detected_within_an_account(two_accounts):
    """Même `operation_id`, corps différents, envoyés par deux comptes
    différents : chacun est neuf pour son compte, ce n'est jamais un
    `mismatched_replay` — ce verdict ne doit comparer qu'au sein d'un même
    compte (§11, « Les oracles d'existence »)."""
    api_a, api_b = two_accounts
    shared_operation_id = str(uuid4())

    # Corps fixes (y compris leur `client_ref`) : la clé d'idempotence porte
    # sur le corps entier, un `client_ref` régénéré à chaque appel aurait fait
    # paraître A « différent de lui-même » au rejeu et faussé le test.
    body_a = {
        "operations": [
            {
                "type": "deck.create",
                "operation_id": shared_operation_id,
                "recorded_at": RECORDED_AT,
                "client_ref": str(uuid4()),
                "data": {"name": "Deck de A"},
            }
        ]
    }
    body_b = {
        "operations": [
            {
                "type": "deck.create",
                "operation_id": shared_operation_id,
                "recorded_at": RECORDED_AT,
                "client_ref": str(uuid4()),
                "data": {"name": "Deck de B"},
            }
        ]
    }

    result_a = api_a.post("/sync", json=body_a)
    # Même clé, corps différent (nom et `client_ref` différents), chez un
    # autre compte : un `mismatched_replay` serait une fuite (il révélerait
    # que la clé existe déjà ailleurs). Ça doit être une application neuve.
    result_b = api_b.post("/sync", json=body_b)

    outcome_a = result_a.json()["results"][0]
    outcome_b = result_b.json()["results"][0]
    assert outcome_a["outcome"] == "applied"
    assert outcome_b["outcome"] == "applied"
    assert outcome_a["resource"]["deck_id"] != outcome_b["resource"]["deck_id"]

    # Rejouer chez A, à l'identique, reste un rejeu ordinaire (même compte,
    # même corps) : la clé de B ne l'a pas perturbée.
    replay_a = api_a.post("/sync", json=body_a)
    assert replay_a.json()["results"][0]["outcome"] == "replayed"

    # Rejouer chez A avec le corps de B (même clé, compte de A, corps
    # différent du sien) : cette fois c'est bien un `mismatched_replay`, intra
    # compte.
    conflicting = api_a.post("/sync", json=body_b)
    assert conflicting.json()["results"][0]["outcome"] == "rejected"
    assert conflicting.json()["results"][0]["error"]["code"] == "mismatched_replay"


def test_sync_client_ref_shared_by_both_accounts_resolves_separately(two_accounts):
    """La même `client_ref`, utilisée par A et par B, désigne un deck chez
    chacun — jamais le même, jamais celui de l'autre."""
    api_a, api_b = two_accounts
    shared_ref = str(uuid4())

    def create(name: str) -> dict:
        return {
            "operations": [
                {
                    "type": "deck.create",
                    "operation_id": str(uuid4()),
                    "recorded_at": RECORDED_AT,
                    "client_ref": shared_ref,
                    "data": {"name": name},
                }
            ]
        }

    created_a = api_a.post("/sync", json=create("Deck A")).json()["results"][0]
    created_b = api_b.post("/sync", json=create("Deck B")).json()["results"][0]
    assert created_a["outcome"] == created_b["outcome"] == "applied"
    deck_id_a = created_a["resource"]["deck_id"]
    deck_id_b = created_b["resource"]["deck_id"]
    assert deck_id_a != deck_id_b

    def update_via_ref() -> dict:
        return {
            "operations": [
                {
                    "type": "deck.update",
                    "operation_id": str(uuid4()),
                    "recorded_at": RECORDED_AT,
                    "deck": {"client_ref": shared_ref},
                    "data": {"notes": "touché"},
                }
            ]
        }

    updated_a = api_a.post("/sync", json=update_via_ref()).json()["results"][0]
    updated_b = api_b.post("/sync", json=update_via_ref()).json()["results"][0]
    assert updated_a["resource"]["deck_id"] == deck_id_a
    assert updated_b["resource"]["deck_id"] == deck_id_b

    assert api_a.get(f"/decks/{deck_id_a}").json()["notes"] == "touché"
    assert api_b.get(f"/decks/{deck_id_b}").json()["notes"] == "touché"


def test_sync_operation_id_applied_by_a_then_by_b_counts_twice(two_accounts):
    """Même `operation_id`, même corps, envoyé par A puis par B : s'applique
    deux fois, une fois par compte — jamais un rejeu emprunté à l'autre."""
    api_a, api_b = two_accounts
    shared_operation_id = str(uuid4())

    def batch() -> dict:
        return {
            "operations": [
                {
                    "type": "deck.create",
                    "operation_id": shared_operation_id,
                    "recorded_at": RECORDED_AT,
                    "client_ref": str(uuid4()),
                    "data": {"name": "Même clé, deux comptes"},
                }
            ]
        }

    outcome_a = api_a.post("/sync", json=batch()).json()["results"][0]
    outcome_b = api_b.post("/sync", json=batch()).json()["results"][0]

    assert outcome_a["outcome"] == "applied"
    assert outcome_b["outcome"] == "applied"
    assert outcome_a["resource"]["deck_id"] != outcome_b["resource"]["deck_id"]
    assert api_a.get(f"/decks/{outcome_a['resource']['deck_id']}").status_code == 200
    assert api_b.get(f"/decks/{outcome_b['resource']['deck_id']}").status_code == 200


def test_unauthenticated_sync_never_touches_the_journal_even_with_a_full_batch(
    api, db
):
    """Variante de `test_lot6_isolation.py` (qui n'envoie qu'une opération) :
    un lot de plusieurs opérations, toutes différentes, ne laisse rien non
    plus dans le journal sans session — pas d'application partielle."""
    response = api.post(
        "/sync",
        json={
            "operations": [
                _deck_create_operation("Jamais créé 1"),
                _deck_create_operation("Jamais créé 2"),
            ]
        },
    )
    assert response.status_code == 401
    assert db.scalars(select(SyncOperation)).first() is None
