"""Routes `/joueurs` et `/lieux` (Lot 7, étape B1) et « Moi » à l'inscription.

Couvre : le « Moi » créé avec le compte (route et service), jamais dupliqué ni
supprimable, la comparaison des noms repliés (P5), les compteurs du Carnet, les
refus de suppression avec leurs messages, l'isolation entre comptes.
"""

import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import select

from app.models import Game, Participation, Player, Tournament, UserAccount, Venue
from app.models.enums import RoundType
from app.services import auth, players
from app.services.errors import ConflictError
from tests.auth_helpers import DEFAULT_PASSWORD, log_in, make_account

SIGN_UP = {
    "email": "nouveau@example.com",
    "username": "nouveau",
    "password": DEFAULT_PASSWORD,
}


def _account_with_me(db, email, username):
    account = make_account(db, email=email, username=username)
    players.get_or_create_me(db, account.id, account.username)
    db.commit()
    return account


@pytest.fixture
def two_accounts(api_client_factory, db):
    a = _account_with_me(db, "carnet-a@example.com", "carnet-a")
    b = _account_with_me(db, "carnet-b@example.com", "carnet-b")
    client_a = api_client_factory()
    client_b = api_client_factory()
    log_in(client_a, "carnet-a@example.com")
    log_in(client_b, "carnet-b@example.com")
    return client_a, client_b, a, b


@pytest.fixture
def api_me(api, db):
    """Un client connecté, dont le compte a son « Moi »."""
    account = _account_with_me(db, "moi@example.com", "moi-meme")
    log_in(api, "moi@example.com")
    return api, account


def _game(db, user_id, *, venue=None, tournament=None, players_=()):
    game = Game(
        user_id=user_id,
        played_at=datetime(2026, 10, 1, 20, tzinfo=UTC),
        venue_id=venue.id if venue else None,
        tournament_id=tournament.id if tournament else None,
        round_type=RoundType.FINAL if tournament else RoundType.CASUAL,
        player_count=4,
    )
    db.add(game)
    db.flush()
    for player in players_:
        db.add(Participation(user_id=user_id, game_id=game.id, player_id=player.id))
    db.flush()
    return game


# ---------------------------------------------------------------------------
# « Moi » à la création du compte (A1)
# ---------------------------------------------------------------------------


def test_sign_up_creates_the_me_player_named_after_the_username(api, db):
    assert api.post("/inscription", json=SIGN_UP).status_code == 201
    listed = api.get("/joueurs").json()
    assert [(p["name"], p["is_me"], p["game_count"]) for p in listed] == [
        ("nouveau", True, 0)
    ]


def test_create_account_service_creates_exactly_one_me(db):
    account = auth.create_account(
        db, email="svc@example.com", username="svc-user", password=DEFAULT_PASSWORD
    )
    mine = db.scalars(select(Player).where(Player.user_id == account.id)).all()
    assert [(p.name, p.is_me) for p in mine] == [("svc-user", True)]


def test_a_refused_sign_up_leaves_no_orphan_player(api, db):
    api.post("/inscription", json=SIGN_UP)
    again = api.post("/inscription", json={**SIGN_UP, "email": "autre@example.com"})
    assert again.status_code == 409
    assert db.scalars(select(Player)).all().__len__() == 1


def test_get_or_create_me_is_idempotent(db):
    account = make_account(db, email="idem@example.com", username="idem")
    first = players.get_or_create_me(db, account.id)
    second = players.get_or_create_me(db, account.id)
    assert first.id == second.id
    assert first.name == "idem"


def test_get_or_create_me_avoids_a_name_taken_by_an_opponent(db):
    account = make_account(db, email="clash@example.com", username="clash")
    db.add(Player(user_id=account.id, name="Clash"))
    db.flush()
    me = players.get_or_create_me(db, account.id)
    assert me.is_me and me.name == "clash (2)"


def test_manage_accounts_create_makes_the_me_player(db_engine, monkeypatch):
    """`manage_accounts.py create` passe par `create_account` : même « Moi »."""
    from sqlalchemy.orm import Session

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
    import manage_accounts

    monkeypatch.setattr(manage_accounts, "SessionLocal", lambda: Session(db_engine))
    monkeypatch.setattr(manage_accounts, "_read_new_password", lambda: DEFAULT_PASSWORD)
    args = manage_accounts.argparse.Namespace(
        email="cli@example.com", username="cli-user", role="user"
    )
    assert manage_accounts.cmd_create(args) == 0
    with Session(db_engine) as check:
        account = check.scalar(
            select(UserAccount).where(UserAccount.email == "cli@example.com")
        )
        me = check.scalars(select(Player).where(Player.user_id == account.id)).all()
        assert [(p.name, p.is_me) for p in me] == [("cli-user", True)]


def test_manage_accounts_check_me_lists_and_fixes(db_engine, monkeypatch, capsys):
    from sqlalchemy.orm import Session

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
    import manage_accounts

    monkeypatch.setattr(manage_accounts, "SessionLocal", lambda: Session(db_engine))
    with Session(db_engine) as setup:
        make_account(setup, email="sans@example.com", username="sans-moi")
    ns = manage_accounts.argparse.Namespace
    assert manage_accounts.cmd_check_me(ns(fix=False)) == 1
    assert "sans-moi" in capsys.readouterr().out
    assert manage_accounts.cmd_check_me(ns(fix=True)) == 0
    assert manage_accounts.cmd_check_me(ns(fix=False)) == 0


def test_claim_legacy_renames_the_me_player_posed_by_the_migration(
    db_engine, monkeypatch
):
    from sqlalchemy.orm import Session

    from app.models.account import LEGACY_ACCOUNT_ID, UNUSABLE_PASSWORD_HASH

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
    import manage_accounts

    with Session(db_engine) as setup:
        legacy = UserAccount(
            id=LEGACY_ACCOUNT_ID,
            email="compte-historique@gurchon-hall.invalid",
            username="compte-historique",
            password_hash=UNUSABLE_PASSWORD_HASH,
        )
        setup.add(legacy)
        setup.flush()
        setup.add(Player(user_id=legacy.id, name="compte-historique", is_me=True))
        setup.commit()
    monkeypatch.setattr(manage_accounts, "SessionLocal", lambda: Session(db_engine))
    monkeypatch.setattr(manage_accounts, "_read_new_password", lambda: DEFAULT_PASSWORD)
    args = manage_accounts.argparse.Namespace(
        email="martin@example.com", username="martin"
    )
    assert manage_accounts.cmd_claim_legacy(args) == 0
    with Session(db_engine) as check:
        me = check.scalars(
            select(Player).where(Player.user_id == LEGACY_ACCOUNT_ID)
        ).all()
        assert [(p.name, p.is_me) for p in me] == [("martin", True)]


def test_manage_accounts_script_runs_as_a_program():
    """Le nouveau sous-commande est câblée : `--help` la liste."""
    script = Path(__file__).resolve().parent.parent / "scripts" / "manage_accounts.py"
    result = subprocess.run(
        [sys.executable, "-I", str(script), "check-me", "--help"],
        capture_output=True,
        text=True,
        cwd=script.parent.parent,
    )
    assert result.returncode == 0 and "--fix" in result.stdout


# ---------------------------------------------------------------------------
# /joueurs
# ---------------------------------------------------------------------------


def test_players_list_puts_me_first_then_sorts_by_folded_name(api_me):
    api, _ = api_me
    for name in ("Zoé", "élodie", "Bob"):
        assert api.post("/joueurs", json={"name": name}).status_code == 201
    names = [p["name"] for p in api.get("/joueurs").json()]
    assert names == ["moi-meme", "Bob", "élodie", "Zoé"]


def test_players_search_ignores_case_and_accents(api_me):
    api, _ = api_me
    api.post("/joueurs", json={"name": "Élodie"})
    api.post("/joueurs", json={"name": "Bob"})
    found = api.get("/joueurs", params={"q": "ELO"}).json()
    assert [p["name"] for p in found] == ["Élodie"]


def test_create_player_trims_the_name_and_rejects_is_me(api_me):
    api, _ = api_me
    created = api.post("/joueurs", json={"name": "  Marc  "})
    assert created.status_code == 201
    assert created.json() == {"id": created.json()["id"], "name": "Marc",
                              "is_me": False, "game_count": 0}
    forged = api.post("/joueurs", json={"name": "Autre moi", "is_me": True})
    assert forged.status_code == 422
    assert api.post("/joueurs", json={"name": "   "}).status_code == 422


@pytest.mark.parametrize("duplicate", ["Marc", "marc", "MARC", " marc "])
def test_create_player_rejects_a_folded_duplicate(api_me, duplicate):
    api, _ = api_me
    api.post("/joueurs", json={"name": "Marc"})
    response = api.post("/joueurs", json={"name": duplicate})
    assert response.status_code == 409
    assert "Marc" in response.json()["detail"]


def test_create_player_rejects_accent_only_difference(api_me):
    api, _ = api_me
    api.post("/joueurs", json={"name": "Élodie"})
    assert api.post("/joueurs", json={"name": "elodie"}).status_code == 409


def test_create_player_named_like_me_is_refused_with_the_me_message(api_me):
    api, _ = api_me
    response = api.post("/joueurs", json={"name": "Moi-Meme"})
    assert response.status_code == 409
    assert response.json()["detail"] == players.ME_NAME_TAKEN


def test_the_me_player_is_never_duplicated(api_me, db):
    api, account = api_me
    api.post("/joueurs", json={"name": "Marc"})
    assert db.scalars(
        select(Player).where(Player.user_id == account.id, Player.is_me.is_(True))
    ).all().__len__() == 1


def test_rename_player_and_me(api_me):
    api, _ = api_me
    marc = api.post("/joueurs", json={"name": "Marc"}).json()
    renamed = api.patch(f"/joueurs/{marc['id']}", json={"name": "Marc F."})
    assert renamed.status_code == 200 and renamed.json()["name"] == "Marc F."
    me = api.get("/joueurs").json()[0]
    assert me["is_me"]
    renamed_me = api.patch(f"/joueurs/{me['id']}", json={"name": "Martin"})
    assert renamed_me.status_code == 200
    assert renamed_me.json()["is_me"] is True
    assert renamed_me.json()["name"] == "Martin"


def test_rename_to_a_folded_duplicate_is_refused_but_recasing_self_is_fine(api_me):
    api, _ = api_me
    marc = api.post("/joueurs", json={"name": "Marc"}).json()
    luc = api.post("/joueurs", json={"name": "Luc"}).json()
    assert api.patch(f"/joueurs/{luc['id']}", json={"name": "marc"}).status_code == 409
    again = api.patch(f"/joueurs/{marc['id']}", json={"name": "MARC"})
    assert again.status_code == 200 and again.json()["name"] == "MARC"


def test_rename_to_the_me_name_is_refused(api_me):
    api, _ = api_me
    marc = api.post("/joueurs", json={"name": "Marc"}).json()
    response = api.patch(f"/joueurs/{marc['id']}", json={"name": "MOI-MEME"})
    assert response.status_code == 409
    assert response.json()["detail"] == players.ME_NAME_TAKEN


def test_update_player_rejects_is_me_and_null_name(api_me):
    api, _ = api_me
    marc = api.post("/joueurs", json={"name": "Marc"}).json()
    assert api.patch(f"/joueurs/{marc['id']}", json={"is_me": True}).status_code == 422
    assert api.patch(f"/joueurs/{marc['id']}", json={"name": None}).status_code == 422
    empty = api.patch(f"/joueurs/{marc['id']}", json={})
    assert empty.status_code == 200 and empty.json()["name"] == "Marc"


def test_get_player_and_unknown_id(api_me):
    api, _ = api_me
    marc = api.post("/joueurs", json={"name": "Marc"}).json()
    assert api.get(f"/joueurs/{marc['id']}").json() == marc
    missing = api.get("/joueurs/999999")
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Joueur 999999 introuvable."


def test_delete_player_free_then_gone(api_me):
    api, _ = api_me
    marc = api.post("/joueurs", json={"name": "Marc"}).json()
    assert api.delete(f"/joueurs/{marc['id']}").status_code == 204
    assert api.get(f"/joueurs/{marc['id']}").status_code == 404
    assert api.delete(f"/joueurs/{marc['id']}").status_code == 404


def test_delete_me_is_refused(api_me):
    api, _ = api_me
    me = api.get("/joueurs").json()[0]
    response = api.delete(f"/joueurs/{me['id']}")
    assert response.status_code == 409
    assert "jamais supprimé" in response.json()["detail"]
    assert api.get(f"/joueurs/{me['id']}").status_code == 200


def test_game_count_and_delete_refused_when_seated(api_me, db):
    api, account = api_me
    marc = api.post("/joueurs", json={"name": "Marc F."}).json()
    me = api.get("/joueurs").json()[0]
    marc_row = db.get(Player, marc["id"])
    me_row = db.get(Player, me["id"])
    for _ in range(6):
        _game(db, account.id, players_=(me_row, marc_row))
    db.commit()

    listed = {p["name"]: p["game_count"] for p in api.get("/joueurs").json()}
    assert listed == {"moi-meme": 6, "Marc F.": 6}
    assert api.get(f"/joueurs/{marc['id']}").json()["game_count"] == 6
    refused = api.delete(f"/joueurs/{marc['id']}")
    assert refused.status_code == 409
    assert refused.json()["detail"] == (
        "Marc F. figure à 6 tables : retirez-le d'abord de ces parties pour le "
        "supprimer."
    )


def test_delete_player_message_in_the_singular(api_me, db):
    api, account = api_me
    marc = api.post("/joueurs", json={"name": "Marc"}).json()
    _game(db, account.id, players_=(db.get(Player, marc["id"]),))
    db.commit()
    detail = api.delete(f"/joueurs/{marc['id']}").json()["detail"]
    assert detail.startswith("Marc figure à 1 table :")


# ---------------------------------------------------------------------------
# /lieux
# ---------------------------------------------------------------------------


def test_venue_crud_roundtrip(api_me):
    api, _ = api_me
    created = api.post(
        "/lieux", json={"name": " Le Bar à Dés ", "city": "Lyon", "notes": "mardi"}
    )
    assert created.status_code == 201
    venue = created.json()
    assert venue["name"] == "Le Bar à Dés"
    assert (venue["game_count"], venue["tournament_count"]) == (0, 0)
    assert api.get(f"/lieux/{venue['id']}").json() == venue

    patched = api.patch(f"/lieux/{venue['id']}", json={"city": None, "notes": "jeudi"})
    assert patched.status_code == 200
    assert patched.json()["city"] is None and patched.json()["notes"] == "jeudi"
    assert patched.json()["name"] == "Le Bar à Dés"

    assert api.delete(f"/lieux/{venue['id']}").status_code == 204
    assert api.get(f"/lieux/{venue['id']}").status_code == 404


def test_venue_name_folded_duplicate_is_refused(api_me):
    api, _ = api_me
    api.post("/lieux", json={"name": "Le Bar à Dés"})
    assert api.post("/lieux", json={"name": "le bar a des"}).status_code == 409
    other = api.post("/lieux", json={"name": "Club"}).json()
    clash = api.patch(f"/lieux/{other['id']}", json={"name": "LE BAR À DÉS"})
    assert clash.status_code == 409
    same = api.patch(f"/lieux/{other['id']}", json={"name": "CLUB"})
    assert same.status_code == 200 and same.json()["name"] == "CLUB"


def test_venue_list_search_and_order(api_me):
    api, _ = api_me
    for name in ("Zinc", "Éclair", "Bar"):
        api.post("/lieux", json={"name": name})
    assert [v["name"] for v in api.get("/lieux").json()] == ["Bar", "Éclair", "Zinc"]
    found = api.get("/lieux", params={"q": "ecl"}).json()
    assert [v["name"] for v in found] == ["Éclair"]


def test_venue_rejects_unknown_fields_and_unknown_id(api_me):
    api, _ = api_me
    assert api.post("/lieux", json={"name": "X", "user_id": 2}).status_code == 422
    assert api.patch("/lieux/1", json={"name": None}).status_code in (404, 422)
    missing = api.get("/lieux/999999")
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Lieu 999999 introuvable."


def test_venue_counters_and_delete_refused(api_me, db):
    api, account = api_me
    venue = api.post("/lieux", json={"name": "Le Bar à Dés"}).json()
    row = db.get(Venue, venue["id"])
    tournament = Tournament(
        user_id=account.id, name="Open", start_date=datetime(2026, 10, 1).date(),
        venue_id=row.id,
    )
    db.add(tournament)
    db.flush()
    me = players.get_or_create_me(db, account.id)
    for _ in range(7):
        _game(db, account.id, venue=row, players_=(me,))
    db.commit()

    counted = api.get(f"/lieux/{venue['id']}").json()
    assert (counted["game_count"], counted["tournament_count"]) == (7, 1)
    assert api.get("/lieux").json()[0]["game_count"] == 7
    refused = api.delete(f"/lieux/{venue['id']}")
    assert refused.status_code == 409
    assert refused.json()["detail"] == (
        "Le Bar à Dés sert à 7 parties et 1 tournoi : impossible de le supprimer."
    )


def test_venue_referenced_by_a_tournament_only(api_me, db):
    api, account = api_me
    venue = api.post("/lieux", json={"name": "Club"}).json()
    db.add(Tournament(
        user_id=account.id, name="Open", start_date=datetime(2026, 10, 1).date(),
        venue_id=venue["id"],
    ))
    db.commit()
    detail = api.delete(f"/lieux/{venue['id']}").json()["detail"]
    assert detail == "Club sert à 1 tournoi : impossible de le supprimer."


# ---------------------------------------------------------------------------
# Isolation entre comptes
# ---------------------------------------------------------------------------


def test_players_are_isolated_between_accounts(two_accounts):
    api_a, api_b, _, _ = two_accounts
    marc = api_a.post("/joueurs", json={"name": "Marc"}).json()
    unknown = api_b.get("/joueurs/999999")

    for response in (
        api_b.get(f"/joueurs/{marc['id']}"),
        api_b.patch(f"/joueurs/{marc['id']}", json={"name": "Pirate"}),
        api_b.delete(f"/joueurs/{marc['id']}"),
    ):
        assert response.status_code == 404
        assert response.json()["detail"] == f"Joueur {marc['id']} introuvable."
    assert unknown.json()["detail"] == "Joueur 999999 introuvable."
    assert [p["name"] for p in api_b.get("/joueurs").json()] == ["carnet-b"]
    # B peut créer son propre « Marc » : le nom est unique par compte.
    assert api_b.post("/joueurs", json={"name": "Marc"}).status_code == 201
    assert api_a.get(f"/joueurs/{marc['id']}").json()["name"] == "Marc"


def test_venues_are_isolated_between_accounts(two_accounts):
    api_a, api_b, _, _ = two_accounts
    venue = api_a.post("/lieux", json={"name": "Club"}).json()
    for response in (
        api_b.get(f"/lieux/{venue['id']}"),
        api_b.patch(f"/lieux/{venue['id']}", json={"city": "Paris"}),
        api_b.delete(f"/lieux/{venue['id']}"),
    ):
        assert response.status_code == 404
        assert response.json()["detail"] == f"Lieu {venue['id']} introuvable."
    assert api_b.get("/lieux").json() == []
    assert api_b.post("/lieux", json={"name": "Club"}).status_code == 201


def test_counters_do_not_leak_between_accounts(two_accounts, db):
    api_a, api_b, a, b = two_accounts
    marc_b = api_b.post("/joueurs", json={"name": "Marc"}).json()
    me_b = players.get_me(db, b.id)
    _game(db, b.id, players_=(me_b, db.get(Player, marc_b["id"])))
    db.commit()
    marc_a = api_a.post("/joueurs", json={"name": "Marc"}).json()
    assert marc_a["game_count"] == 0
    assert api_a.get(f"/joueurs/{marc_a['id']}").json()["game_count"] == 0


def test_equals_folded_used_by_service_conflict(db):
    account = _account_with_me(db, "svc2@example.com", "svc2")
    db.add(Player(user_id=account.id, name="Marc"))
    db.commit()
    assert players.find_by_name(db, account.id, "marc") is not None
    with pytest.raises(ConflictError):
        players._check_name_free(db, account.id, "MARC")
