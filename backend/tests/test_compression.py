"""Compression des réponses (lot Chercher, A2, livrée à l'étape B1).

`GZipMiddleware` est la couche la plus externe de l'application : on vérifie
qu'elle compresse ce qui doit l'être, laisse en clair ce qui est court ou ce
que le client n'accepte pas compressé, et ne retire ni l'exposition CORS de
`Retry-After` ni `Cache-Control: private, no-store`.

`TestClient` (httpx) décompresse de lui-même : `response.json()` lit donc le
corps décompressé, et c'est l'en-tête `Content-Encoding` qui dit ce qui a
transité.
"""

import json
from pathlib import Path

import pytest

from app.main import GZIP_MINIMUM_SIZE
from app.services.catalog_import import import_catalog
from tests.auth_helpers import authenticated_api, make_account
from tests.helpers import add_languages, make_copy

FIXTURES = Path(__file__).parent / "fixtures"
ALLOWED_ORIGIN = "http://localhost:5173"
GZIP = {"Accept-Encoding": "gzip"}


@pytest.fixture
def catalog_in_db(db):
    vtes = json.loads((FIXTURES / "krcg_vtes.json").read_text(encoding="utf-8"))
    expansions = json.loads(
        (FIXTURES / "krcg_expansions.json").read_text(encoding="utf-8")
    )
    import_catalog(db, vtes, expansions)


def test_a_catalog_page_is_compressed_when_the_client_accepts_it(
    api, catalog_in_db
):
    plain = api.get("/cartes", headers={"Accept-Encoding": "identity"})
    compressed = api.get("/cartes", headers=GZIP)

    assert len(plain.content) > GZIP_MINIMUM_SIZE
    assert "content-encoding" not in plain.headers
    assert compressed.headers["content-encoding"] == "gzip"
    assert "Accept-Encoding" in compressed.headers["vary"]
    # Le corps transmis est plus court que le JSON, et se relit à l'identique.
    assert int(compressed.headers["content-length"]) < len(plain.content) / 3
    assert compressed.json() == plain.json()


def test_a_short_response_stays_uncompressed(api):
    response = api.get("/health", headers=GZIP)

    assert response.status_code == 200
    assert len(response.content) < GZIP_MINIMUM_SIZE
    assert "content-encoding" not in response.headers


def test_compression_keeps_the_cors_headers(api, catalog_in_db):
    response = api.get("/cartes", headers={**GZIP, "Origin": ALLOWED_ORIGIN})

    assert response.headers["content-encoding"] == "gzip"
    assert response.headers["access-control-allow-origin"] == ALLOWED_ORIGIN
    assert response.headers["access-control-allow-credentials"] == "true"
    assert "Retry-After" in response.headers["access-control-expose-headers"]


def test_compression_keeps_cache_control_on_an_authenticated_response(
    api, db, catalog_in_db
):
    from sqlalchemy import select

    from app.models import Card

    add_languages(db, "EN")  # l'import ne crée que FR et ES
    _, account = authenticated_api(api, db)
    for card in db.scalars(select(Card)):
        printing = card.printings[0]
        for language in ("EN", "FR"):
            make_copy(
                db,
                card,
                language,
                card_set_id=printing.card_set_id,
                user_id=account.id,
            )
    db.commit()

    response = api.get("/stock", headers=GZIP)

    assert response.status_code == 200
    assert len(response.json()) == 20
    assert response.headers["content-encoding"] == "gzip"
    assert response.headers["cache-control"] == "private, no-store"


def test_a_rate_limited_answer_keeps_its_exposed_retry_after(api, db):
    make_account(db, email="debit@example.com", username="debit")
    attempt = {"email": "debit@example.com", "password": "Mauvais-mot-2-passe!"}
    headers = {**GZIP, "Origin": ALLOWED_ORIGIN}

    statuses = [
        api.post("/connexion", json=attempt, headers=headers) for _ in range(6)
    ]

    limited = statuses[-1]
    assert limited.status_code == 429
    assert int(limited.headers["retry-after"]) > 0
    assert "Retry-After" in limited.headers["access-control-expose-headers"]
