"""Écriture en ligne pendant un lot : la limite connue du verrou, figée par des tests.

`docs/lot3-sync-contrat.md` (« Limites connues du verrou ») la décrit : le verrou
d'écriture ne ferme que la course **entre deux lots**. Les routes en ligne
(`POST /decks/{id}/cartes`, `PATCH /stock/...`) écrivent sur une session
ordinaire, sans `serialized_writes` : une écriture faite dans l'interface pendant
qu'un lot se synchronise n'est pas sérialisée avec lui.

Ces tests **documentent** cette limite, ils ne la corrigent pas (décision du Lot 3,
« sans effet en usage mono-utilisateur séquentiel ») :

* `test_the_stock_accounting_race_between_a_route_and_a_batch_is_open` est un
  `xfail(strict=True)` qui exprime l'invariant voulu (jamais plus d'exemplaires
  alloués que possédés). Il échoue aujourd'hui ; le jour où les routes en ligne
  passent par le verrou, il passera, `strict` le signalera, et la limite sera à
  retirer du document de contrat et de CLAUDE.md §11 ;
* `test_an_online_write_meeting_a_batch_fails_with_a_500_not_a_503` fige l'autre
  face : une route en ligne qui tombe sur le verrou tenu par un lot n'a pas le
  503 + `Retry-After` de `/sync` ; l'erreur du pilote sort telle quelle.
"""

import threading
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.db.locking import serialized_writes
from app.db.session import get_session
from app.main import app
from app.models import CardCategory
from app.services import decks, stock
from tests.helpers import add_languages, make_card, make_copy, make_deck
from tests.test_sync_service import op, sync_batch


@pytest.mark.xfail(
    strict=True,
    reason=(
        "Limite connue du Lot 3 : les routes en ligne écrivent hors du verrou "
        "d'écriture de /sync (docs/lot3-sync-contrat.md, « Limites connues du "
        "verrou »). Une ligne de deck saisie en ligne peut sur-allouer une entrée "
        "qu'un lot vient de consommer."
    ),
)
def test_the_stock_accounting_race_between_a_route_and_a_batch_is_open(api, db):
    """3 exemplaires possédés ; une route en ligne et un lot en veulent 3 chacun.

    La route en ligne contrôle la disponibilité (3 libres), puis attend ; le lot
    passe entièrement dans l'intervalle (3 libres aussi, la route n'a encore rien
    écrit) ; la route écrit enfin : 6 alloués pour 3 possédés. Les deux temps de
    la course sont forcés par des événements, pas par la chance.
    """
    add_languages(db, "EN", "FR")
    card = make_card(db, "Rare Copy", CardCategory.LIBRARY)
    make_copy(db, card, "EN", quantity_owned=3)
    online_deck = make_deck(db, "Saisie en ligne")
    queued_deck = make_deck(db, "Saisie en file")
    db.commit()
    card_id, online_id, queued_id = card.id, online_deck.id, queued_deck.id

    checked = threading.Event()
    batch_done = threading.Event()
    check = decks._check_allocation
    calls: list[int] = []

    def pause_after_the_first_check(*args, **kwargs):
        check(*args, **kwargs)
        calls.append(1)
        if len(calls) == 1:  # la route en ligne, partie la première
            checked.set()
            batch_done.wait(timeout=10)

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(decks, "_check_allocation", pause_after_the_first_check)
        online_response: list = []

        def online_write():
            online_response.append(
                api.post(
                    f"/decks/{online_id}/cartes",
                    json={"card_id": card_id, "language_code": "EN", "quantity": 3},
                )
            )

        thread = threading.Thread(target=online_write)
        thread.start()
        assert checked.wait(timeout=10)
        # Le lot passe pendant la pause de la route en ligne.
        result = sync_batch(
            api,
            op(
                "deck_card.upsert",
                deck={"deck_id": queued_id},
                data={"card_id": card_id, "language_code": "EN", "quantity": 3},
            ),
        )["results"][0]
        batch_done.set()
        thread.join(timeout=10)

    assert result["outcome"] == "applied"
    db.expire_all()
    # L'invariant voulu : jamais plus d'exemplaires alloués que possédés.
    assert stock.allocated_real(db, card_id, "EN") <= 3


def test_an_online_write_meeting_a_batch_fails_with_a_500_not_a_503(db_engine, db):
    """Un lot tient le verrou : la route en ligne n'a ni attente propre ni 503 propre.

    Elle attend le délai du pilote (ici 0,2 s) puis l'erreur `database is locked`
    sort du service sans être traduite : en production, un 500. Rien n'est écrit.
    """
    add_languages(db, "EN", "FR")
    card = make_card(db, "Rare Copy", CardCategory.LIBRARY)
    make_copy(db, card, "EN", quantity_owned=3)
    db.commit()
    card_id = card.id
    impatient = create_engine(db_engine.url, connect_args={"timeout": 0.2})

    def session_on_impatient():
        with Session(impatient, autoflush=False, expire_on_commit=False) as session:
            yield session

    app.dependency_overrides[get_session] = session_on_impatient
    try:
        with TestClient(app) as client:
            with serialized_writes(db_engine):  # un lot est en cours
                started = time.perf_counter()
                with pytest.raises(OperationalError, match="database is locked"):
                    client.patch(
                        f"/stock/{card_id}/EN", json={"quantity_owned": 9}
                    )
                waited = time.perf_counter() - started
            # Le verrou est rendu : la même écriture passe, rien n'avait été écrit.
            db.expire_all()
            assert stock.get_copy(db, card_id, "EN").quantity_owned == 3
            assert (
                client.patch(
                    f"/stock/{card_id}/EN", json={"quantity_owned": 9}
                ).status_code
                == 200
            )
        assert waited >= 0.1  # il a attendu le délai du pilote avant d'échouer
    finally:
        app.dependency_overrides.clear()
        impatient.dispose()
