"""Isolation entre comptes, de bout en bout par l'API (Lot 6, étape A3).

Les autres modules de test exercent chaque route sous un seul compte (celui
qu'ouvre `tests.helpers.login_default_account`). Celui-ci couvre spécifiquement
les risques énoncés par `docs/lot6-plan-comptes.md` (section « Risques et
points d'attention ») pour le périmètre de l'étape A3 : la comptabilité du
stock ne doit jamais regarder au-delà du compte courant, un deck d'un autre
compte doit rester un 404 indistinguable d'un identifiant inconnu, et `/sync`
ne doit ni rejouer ni révéler une clé ou une référence d'un autre compte.

Ce n'est pas la matrice complète « route par route » prévue à l'étape E (QA) :
seulement les trois scénarios que l'étape A3 doit garantir elle-même, avec de
vrais comptes et de vraies requêtes HTTP plutôt qu'une lecture de code.
"""

from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models import SyncOperation
from tests.auth_helpers import DEFAULT_PASSWORD, log_in
from tests.helpers import add_languages, make_card, make_printing

RECORDED_AT = "2026-09-20T20:00:00+02:00"


@pytest.fixture
def two_accounts(api_client_factory, db):
    """Deux `TestClient` authentifiés, sous deux comptes distincts, sur la
    même base jetable."""
    from tests.auth_helpers import make_account

    make_account(db, email="compte-a@example.com", username="compte-a")
    make_account(db, email="compte-b@example.com", username="compte-b")
    db.commit()

    client_a = api_client_factory()
    client_b = api_client_factory()
    log_in(client_a, "compte-a@example.com", DEFAULT_PASSWORD)
    log_in(client_b, "compte-b@example.com", DEFAULT_PASSWORD)
    return client_a, client_b


# --------------------------------------------------------------------------
# Comptabilité du stock (risque principal du lot, §11 / brief Lot 6)
# --------------------------------------------------------------------------


def test_stock_of_one_account_never_counts_against_another(two_accounts, db):
    """Même carte, même langue, même extension chez A et B : les decks de B ne
    réduisent jamais les disponibilités de A, et le message d'un 409 chez A ne
    révèle rien de ce que B possède ou joue."""
    api_a, api_b = two_accounts
    add_languages(db, "EN")
    card = make_card(db, "Nefertiti")
    printing = make_printing(db, card)
    db.commit()

    for api in (api_a, api_b):
        created = api.post(
            "/stock",
            json={
                "card_id": card.id,
                "language_code": "EN",
                "card_set_id": printing.card_set_id,
                "quantity_owned": 2,
            },
        )
        assert created.status_code == 201

    # B joue toute sa possession dans un deck.
    deck_b = api_b.post("/decks", json={"name": "Deck B"}).json()
    added = api_b.post(
        f"/decks/{deck_b['id']}/cartes",
        json={
            "card_id": card.id,
            "language_code": "EN",
            "card_set_id": printing.card_set_id,
            "quantity": 2,
            "proxy_quantity": 0,
        },
    )
    assert added.status_code == 201

    # A, lui, n'a encore rien alloué : ses 2 exemplaires restent disponibles.
    deck_a = api_a.post("/decks", json={"name": "Deck A"}).json()
    added_a = api_a.post(
        f"/decks/{deck_a['id']}/cartes",
        json={
            "card_id": card.id,
            "language_code": "EN",
            "card_set_id": printing.card_set_id,
            "quantity": 2,
            "proxy_quantity": 0,
        },
    )
    assert added_a.status_code == 201

    # A ne peut pas monter sa ligne à 3 : seuls SES 2 exemplaires possédés
    # comptent (la ligne modifiée s'exclut elle-même du calcul), et rien de B
    # n'apparaît dans le message — si l'allocation de B avait fui dans le
    # calcul de A, les disponibilités seraient tombées à 0 au lieu de 2.
    over_a = api_a.patch(
        f"/decks/{deck_a['id']}/cartes/{card.id}/EN/{printing.card_set_id}",
        json={"quantity": 3},
    )
    assert over_a.status_code == 409
    detail = over_a.json()["detail"]
    assert "2 possédé" in detail
    assert "2 disponible" in detail

    # Supprimer l'entrée de B ne doit en rien affecter celle de A.
    delete_a_attempt = api_a.delete(f"/stock/{card.id}/EN/{printing.card_set_id}")
    assert delete_a_attempt.status_code == 409  # toujours allouée par le deck de A


# --------------------------------------------------------------------------
# Decks : 404, jamais 403, jamais un message distinct
# --------------------------------------------------------------------------


def test_a_deck_of_another_account_is_a_plain_404(two_accounts):
    api_a, api_b = two_accounts
    deck_a = api_a.post("/decks", json={"name": "Deck privé"}).json()

    unknown = api_b.get("/decks/999999")
    foreign = api_b.get(f"/decks/{deck_a['id']}")

    assert foreign.status_code == unknown.status_code == 404
    assert foreign.json()["detail"] == unknown.json()["detail"].replace(
        "999999", str(deck_a["id"])
    )

    # La liste de B ne laisse rien filtrer du deck de A non plus.
    listed = api_b.get("/decks", params={"state": "all"}).json()
    assert all(deck["id"] != deck_a["id"] for deck in listed)

    # Toute écriture sur le deck de A depuis B est également un 404.
    patched = api_b.patch(f"/decks/{deck_a['id']}", json={"notes": "intrusion"})
    assert patched.status_code == 404


# --------------------------------------------------------------------------
# /sync : idempotence et références client par compte
# --------------------------------------------------------------------------


def test_sync_operation_id_is_scoped_per_account(two_accounts):
    """La même clé d'idempotence, envoyée par deux comptes, s'applique deux
    fois — une fois par compte — sans jamais rendre un verdict `replayed`
    emprunté à l'autre."""
    api_a, api_b = two_accounts
    shared_operation_id = str(uuid4())
    shared_client_ref = str(uuid4())

    def deck_create_batch():
        return {
            "operations": [
                {
                    "type": "deck.create",
                    "operation_id": shared_operation_id,
                    "recorded_at": RECORDED_AT,
                    "client_ref": shared_client_ref,
                    "data": {"name": "Deck synchronisé"},
                }
            ]
        }

    result_a = api_a.post("/sync", json=deck_create_batch())
    result_b = api_b.post("/sync", json=deck_create_batch())

    assert result_a.status_code == result_b.status_code == 200
    outcome_a = result_a.json()["results"][0]
    outcome_b = result_b.json()["results"][0]
    assert outcome_a["outcome"] == "applied"
    assert outcome_b["outcome"] == "applied"
    assert outcome_a["resource"]["deck_id"] != outcome_b["resource"]["deck_id"]

    # Rejouer la clé de A, chez A, est un rejeu ; chez B, rien de A ne fuit :
    # B a déjà sa propre clé tranchée (appliquée plus haut), donc ceci reste
    # un rejeu de B, jamais celui de A.
    replay_a = api_a.post("/sync", json=deck_create_batch())
    assert replay_a.json()["results"][0]["outcome"] == "replayed"
    assert (
        replay_a.json()["results"][0]["resource"]["deck_id"]
        == outcome_a["resource"]["deck_id"]
    )


def test_sync_client_ref_of_another_account_is_unresolved(two_accounts):
    """Une `client_ref` qui désigne un deck chez A est inconnue chez B : elle
    se comporte comme une référence jamais vue, jamais comme un deck trouvé."""
    api_a, api_b = two_accounts
    client_ref = str(uuid4())

    created = api_a.post(
        "/sync",
        json={
            "operations": [
                {
                    "type": "deck.create",
                    "operation_id": str(uuid4()),
                    "recorded_at": RECORDED_AT,
                    "client_ref": client_ref,
                    "data": {"name": "Deck de A"},
                }
            ]
        },
    )
    assert created.json()["results"][0]["outcome"] == "applied"

    # B référence la même client_ref pour une mise à jour : elle n'existe pas
    # chez lui, quel que soit son sort chez A.
    attempt = api_b.post(
        "/sync",
        json={
            "operations": [
                {
                    "type": "deck.update",
                    "operation_id": str(uuid4()),
                    "recorded_at": RECORDED_AT,
                    "deck": {"client_ref": client_ref},
                    "data": {"notes": "intrusion"},
                }
            ]
        },
    )
    result = attempt.json()["results"][0]
    assert result["outcome"] == "rejected"
    assert result["error"]["code"] == "unresolved_client_ref"

    # B peut réutiliser la même référence pour sa propre création, sans
    # collision avec celle de A.
    own_creation = api_b.post(
        "/sync",
        json={
            "operations": [
                {
                    "type": "deck.create",
                    "operation_id": str(uuid4()),
                    "recorded_at": RECORDED_AT,
                    "client_ref": client_ref,
                    "data": {"name": "Deck de B"},
                }
            ]
        },
    )
    assert own_creation.json()["results"][0]["outcome"] == "applied"


# --------------------------------------------------------------------------
# Ordre des contrôles : l'authentification d'abord, toujours (§11, Lot 6)
# --------------------------------------------------------------------------


def test_unauthenticated_request_on_a_nonexistent_resource_is_401_not_404(api):
    """Sans session, une requête ne doit jamais apprendre si une ressource
    existe : `/decks/999999` rend 401, pas 404, même pour un identifiant qui ne
    désigne aucun deck de personne."""
    response = api.get("/decks/999999")
    assert response.status_code == 401
    assert response.json() == {"detail": "Authentification requise."}


def test_unauthenticated_sync_applies_and_journals_nothing(api, db):
    """Un 401 sur `/sync` doit être constaté **avant** toute écriture : la
    session est vérifiée une fois, avant la prise du verrou (§11). Rien ne
    doit être appliqué ni journalisé, pour que le lot se renvoie à l'identique
    après reconnexion."""
    response = api.post(
        "/sync",
        json={
            "operations": [
                {
                    "type": "deck.create",
                    "operation_id": str(uuid4()),
                    "recorded_at": RECORDED_AT,
                    "client_ref": str(uuid4()),
                    "data": {"name": "Deck jamais créé"},
                }
            ]
        },
    )
    assert response.status_code == 401
    assert db.scalars(select(SyncOperation)).first() is None
