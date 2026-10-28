"""Tests de `app.services.auth` (Lot 6, étape A2).

Mots de passe, sessions, comptes — indépendamment du transport HTTP (cf.
`tests/test_auth_routes.py` pour les routes).
"""

from datetime import timedelta

import pytest

from app.models.account import SESSION_LIFETIME, UNUSABLE_PASSWORD_HASH
from app.models.enums import UserRole
from app.services import auth
from app.services.errors import ConflictError
from tests.auth_helpers import DEFAULT_PASSWORD, make_account

# ---------------------------------------------------------------------------
# Mots de passe
# ---------------------------------------------------------------------------


def test_hash_and_verify_password_round_trip():
    hashed = auth.hash_password("Correct-Horse-1!")
    assert hashed != "Correct-Horse-1!"
    assert auth.verify_password("Correct-Horse-1!", hashed)
    assert not auth.verify_password("wrong", hashed)


def test_verify_password_never_raises_on_an_invalid_hash():
    """Le `!` du compte historique (D6) doit échouer sans jamais lever."""
    assert auth.verify_password("anything", UNUSABLE_PASSWORD_HASH) is False
    assert auth.verify_password("anything", "not-a-phc-string-at-all") is False


def test_needs_rehash_is_false_for_a_freshly_produced_hash():
    hashed = auth.hash_password("Correct-Horse-1!")
    assert auth.needs_rehash(hashed) is False


def test_needs_rehash_never_raises_on_an_invalid_hash():
    assert auth.needs_rehash(UNUSABLE_PASSWORD_HASH) is False


def test_dummy_verify_never_raises():
    auth.dummy_verify("whatever the caller typed")


# ---------------------------------------------------------------------------
# Comptes
# ---------------------------------------------------------------------------


def test_create_account_hashes_the_password_and_forces_the_role(db):
    account = auth.create_account(
        db, email="a@example.com", username="alice", password="Correct-Horse-1!"
    )
    assert account.id is not None
    assert account.password_hash != "Correct-Horse-1!"
    assert account.role == UserRole.USER


def test_create_account_rejects_a_duplicate_email(db):
    auth.create_account(
        db, email="a@example.com", username="alice", password="Correct-Horse-1!"
    )
    with pytest.raises(ConflictError):
        auth.create_account(
            db,
            email="a@example.com",
            username="someoneelse",
            password="Correct-Horse-1!",
        )


def test_create_account_rejects_a_duplicate_username(db):
    auth.create_account(
        db, email="a@example.com", username="alice", password="Correct-Horse-1!"
    )
    with pytest.raises(ConflictError):
        auth.create_account(
            db,
            email="someone-else@example.com",
            username="alice",
            password="Correct-Horse-1!",
        )


def test_authenticate_succeeds_with_the_right_password(db):
    make_account(db, email="a@example.com", password="Correct-Horse-1!")
    account = auth.authenticate(db, email="a@example.com", password="Correct-Horse-1!")
    assert account is not None
    assert account.email == "a@example.com"


def test_authenticate_fails_with_the_wrong_password(db):
    make_account(db, email="a@example.com", password="Correct-Horse-1!")
    assert auth.authenticate(db, email="a@example.com", password="wrong") is None


def test_authenticate_fails_for_an_unknown_email_without_raising(db):
    # Pas de compte du tout : passe par `dummy_verify`, ne doit pas lever.
    account = auth.authenticate(db, email="nobody@example.com", password="whatever")
    assert account is None


def test_set_password_revokes_every_session(db):
    account = make_account(db)
    _session_a, token_a = auth.create_session(db, account)
    _session_b, token_b = auth.create_session(db, account)

    auth.set_password(db, account, "Another-Secret-2!")

    db.refresh(account)
    assert auth.verify_password("Another-Secret-2!", account.password_hash)
    assert auth.resolve_session(db, token_a) is None
    assert auth.resolve_session(db, token_b) is None
    # Plus rien à révoquer : `set_password` les a déjà toutes supprimées.
    assert auth.revoke_all_sessions(db, account.id) == 0


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------


def test_create_session_sets_a_fixed_fourteen_day_expiry(db):
    account = make_account(db)
    session, token = auth.create_session(db, account)
    assert token
    assert session.expires_at - session.created_at == SESSION_LIFETIME


def test_resolve_session_finds_a_freshly_created_session(db):
    account = make_account(db)
    _session, token = auth.create_session(db, account)
    resolved = auth.resolve_session(db, token)
    assert resolved is not None
    assert resolved.user_id == account.id


def test_resolve_session_returns_none_for_an_unknown_token(db):
    assert auth.resolve_session(db, "this-token-does-not-exist") is None


def test_resolve_session_purges_and_rejects_an_expired_session(db):
    account = make_account(db)
    session, token = auth.create_session(db, account)
    # On vieillit la session à la main : l'échéance est fixe (D1), rien ne la
    # repousse, donc le seul moyen de tester l'expiration est de la forcer.
    # `expires_at > created_at` reste vrai (CHECK) : les deux reculent ensemble.
    session.created_at = session.created_at - timedelta(days=20)
    session.expires_at = session.created_at + SESSION_LIFETIME
    db.add(session)
    db.commit()

    assert auth.resolve_session(db, token) is None
    # Purgée au passage : plus aucune trace de la ligne.
    assert auth.purge_expired_sessions(db, account.id) == 0


def test_delete_session_is_idempotent(db):
    account = make_account(db)
    _session, token = auth.create_session(db, account)

    auth.delete_session(db, token)
    assert auth.resolve_session(db, token) is None
    # Un deuxième appel, sur un jeton déjà supprimé, ne doit pas lever.
    auth.delete_session(db, token)


def test_purge_expired_sessions_only_removes_expired_ones(db):
    account = make_account(db)
    _fresh_session, fresh_token = auth.create_session(db, account)
    stale_session, _stale_token = auth.create_session(db, account)
    stale_session.created_at = stale_session.created_at - timedelta(days=20)
    stale_session.expires_at = stale_session.created_at + SESSION_LIFETIME
    db.add(stale_session)
    db.commit()

    removed = auth.purge_expired_sessions(db, account.id)

    assert removed == 1
    assert auth.resolve_session(db, fresh_token) is not None


def test_revoke_all_sessions_removes_every_session_of_the_account(db):
    account = make_account(db)
    other = make_account(db, email="other@example.com", username="other")
    _session_a, token_a = auth.create_session(db, account)
    _session_b, token_b = auth.create_session(db, account)
    _session_c, token_c = auth.create_session(db, other)

    removed = auth.revoke_all_sessions(db, account.id)

    assert removed == 2
    assert auth.resolve_session(db, token_a) is None
    assert auth.resolve_session(db, token_b) is None
    # La session d'un autre compte n'est pas touchée.
    assert auth.resolve_session(db, token_c) is not None


def test_session_token_hash_is_the_only_thing_stored(db):
    account = make_account(db)
    session, token = auth.create_session(db, account)
    assert session.token_hash != token
    assert session.token_hash == auth.hash_session_token(token)


def test_default_password_satisfies_the_api_complexity_rule():
    """Garde-fou sur l'aide de test elle-même : si la règle de complexité
    change, `DEFAULT_PASSWORD` doit continuer à la satisfaire."""
    from app.schemas.account import check_password_complexity

    check_password_complexity(DEFAULT_PASSWORD)
