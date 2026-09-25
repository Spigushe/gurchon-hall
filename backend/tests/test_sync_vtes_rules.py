"""Les règles VtES traversées par `POST /sync`, une par une.

`test_sync_service.py` pose la sémantique de la file ; `test_vtes_rules.py` et
`test_deck_legality_audit.py` figent les règles elles-mêmes, en ligne. Ici on
prouve que **chaque règle qui gate une écriture** tient aussi quand l'écriture
arrive par la file : `/sync` ne les assouplit ni ne les durcit (document de
contrat, « Politique de conflit »).

Règles couvertes, cf. CLAUDE.md §5 et §11 :

* légalité de deck, cinq règles : crypt ≥ 12, groupes adjacents, library 60 à 90,
  carte bannie, carte pas encore légale, avec leurs frontières ;
* la légalité ne gate que le **passage à actif** (jamais la construction, jamais
  un deck déjà actif), et les proxies comptent dans les effectifs ;
* comptabilité du stock : exemplaires réels seulement (les proxies n'en
  consomment pas), suppression et interdiction du proxy refusées tant qu'un deck
  en dépend, deck archivé qui retient, deck supprimé qui rend ;
* aucune règle marquée « [à confirmer] » n'est ici : VP/GW et tournoi mono-deck
  n'ont pas de route (Lot 4), donc rien à traverser par `/sync`.
"""

from datetime import date, timedelta

import pytest

from app.services import decks, stock
from tests.helpers import make_card, make_copy
from tests.test_deck_legality_audit import DAY, LIBRARY, build, crypt, library
from tests.test_sync_service import op, sync_batch


@pytest.fixture
def frozen_today(monkeypatch):
    """Le service croit que nous sommes le 15 juin 2026 : aucune horloge réelle."""
    monkeypatch.setattr(decks, "_today", lambda: DAY)
    return DAY


def activate(api, deck_id: int) -> dict:
    return sync_batch(
        api, op("deck.update", deck={"deck_id": deck_id}, data={"status": "active"})
    )["results"][0]


def status_of(api, deck_id: int) -> str:
    return api.get(f"/decks/{deck_id}").json()["status"]


# --------------------------------------------------------------------------
# Légalité : le passage à actif traverse les cinq règles
# --------------------------------------------------------------------------


def test_a_legal_deck_activates_through_the_queue(api, db, frozen_today):
    deck = build(api, db, crypt(quantity=12), library(quantity=60))

    result = activate(api, deck.id)

    assert result["outcome"] == "applied"
    assert status_of(api, deck.id) == "active"


@pytest.mark.parametrize(
    ("crypt_quantity", "library_quantity", "legal"),
    [
        (12, 60, True),  # les deux minimums, inclus
        (11, 60, False),  # crypt trop petite d'une carte
        (12, 59, False),  # library trop petite d'une carte
        (12, 90, True),  # maximum de library, inclus
        (12, 91, False),  # library trop grande d'une carte
    ],
)
def test_the_size_boundaries_hold_through_the_queue(
    api, db, frozen_today, crypt_quantity, library_quantity, legal
):
    deck = build(
        api, db, crypt(quantity=crypt_quantity), library(quantity=library_quantity)
    )

    result = activate(api, deck.id)

    assert (result["outcome"] == "applied") is legal
    assert status_of(api, deck.id) == ("active" if legal else "draft")
    if not legal:
        assert result["error"]["code"] == "conflict"
        assert "Un deck illégal ne peut pas être actif" in result["error"]["message"]
        assert "trop" in result["error"]["message"]


@pytest.mark.parametrize(
    ("groups", "legal"),
    [
        (["G2"], True),  # un seul groupe
        (["G2", "G3"], True),  # deux groupes adjacents
        (["G6", "G7"], True),  # la dernière paire adjacente
        (["G2", "G4"], False),  # jamais 2 + 4
        (["G1", "G2", "G3"], False),  # jamais trois groupes
        (["G3", "ANY"], True),  # « Any » est neutre
    ],
)
def test_the_adjacent_groups_rule_holds_through_the_queue(
    api, db, frozen_today, groups, legal
):
    """Douze cartes de crypt réparties sur les groupes demandés."""
    per_group, remainder = divmod(12, len(groups))
    specs = [
        crypt(
            name=f"Vampire {group}",
            quantity=per_group + (i < remainder),
            group=group,
        )
        for i, group in enumerate(groups)
    ]
    deck = build(api, db, *specs, library(quantity=60))

    result = activate(api, deck.id)

    assert (result["outcome"] == "applied") is legal
    if not legal:
        assert "Groupes de crypt incompatibles" in result["error"]["message"]


@pytest.mark.parametrize(
    ("offset", "refused"),
    # `banned_on` = aujourd'hui + offset : banni à partir de sa date, jour inclus.
    [(-1, True), (0, True), (1, False)],
)
def test_a_banned_card_blocks_activation_from_its_ban_day(
    api, db, frozen_today, offset, refused
):
    deck = build(
        api,
        db,
        crypt(name="Bannie", banned_on=DAY + timedelta(days=offset)),
        library(),
    )

    result = activate(api, deck.id)

    assert (result["outcome"] == "rejected") is refused
    if refused:
        assert result["error"]["code"] == "conflict"
        assert "bannie" in result["error"]["message"]
        assert "Bannie" in result["error"]["message"]


@pytest.mark.parametrize(
    ("offset", "refused"),
    # `legal_from` = aujourd'hui + offset : jouable à partir de sa date, jour inclus.
    [(-1, False), (0, False), (1, True)],
)
def test_a_card_not_yet_legal_blocks_activation_until_its_legal_day(
    api, db, frozen_today, offset, refused
):
    deck = build(
        api,
        db,
        crypt(name="Trop tôt", legal_from=DAY + timedelta(days=offset)),
        library(),
    )

    result = activate(api, deck.id)

    assert (result["outcome"] == "rejected") is refused
    if refused:
        assert "pas encore légale" in result["error"]["message"]


def test_a_card_without_dates_is_playable(api, db, frozen_today):
    deck = build(
        api,
        db,
        crypt(name="Sans date", banned_on=None, legal_from=None),
        library(),
    )

    assert activate(api, deck.id)["outcome"] == "applied"


def test_a_ban_that_starts_after_the_evaluation_day_is_not_a_ban_yet(
    api, db, frozen_today
):
    """`banned_on` s'évalue au jour du serveur : le futur n'interdit rien."""
    deck = build(
        api,
        db,
        crypt(name="Bientôt bannie", banned_on=date(2030, 1, 1)),
        library(),
    )

    assert activate(api, deck.id)["outcome"] == "applied"


# --------------------------------------------------------------------------
# La légalité ne gate que le passage à actif
# --------------------------------------------------------------------------


def test_building_an_illegal_deck_is_never_blocked_through_the_queue(api, db, world):
    """Un brouillon est incomplet par nature : la composition n'est pas gardée."""
    card = make_card(db, "Carte seule", LIBRARY)
    copy = make_copy(db, card, "EN", quantity_owned=1)
    db.commit()
    deck_id = sync_batch(
        api, op("deck.create", client_ref="brouillon", data={"name": "Incomplet"})
    )["results"][0]["resource"]["deck_id"]

    result = sync_batch(
        api,
        op(
            "deck_card.upsert",
            deck={"deck_id": deck_id},
            data={
                "card_id": card.id,
                "language_code": "EN",
                "card_set_id": copy.card_set_id,
                "quantity": 1,
            },
        ),
    )["results"][0]

    assert result["outcome"] == "applied"
    legality = api.get(f"/decks/{deck_id}/legalite").json()
    assert legality["is_legal"] is False


def test_an_active_deck_that_turns_illegal_stays_editable_through_the_queue(
    api, db, frozen_today
):
    """Déjà actif, le deck n'est plus re-jugé : c'est à l'UI de l'afficher."""
    deck = build(api, db, crypt(quantity=12), library(quantity=60))
    assert activate(api, deck.id)["outcome"] == "applied"
    line = api.get(f"/decks/{deck.id}").json()["cards"][0]
    card_id, card_set_id = line["card_id"], line["card_set_id"]

    result = sync_batch(
        api,
        op(
            "deck_card.delete",
            deck={"deck_id": deck.id},
            card_id=card_id,
            language_code="EN",
            card_set_id=card_set_id,
        ),
        op(
            "deck.update",
            deck={"deck_id": deck.id},
            data={"notes": "encore actif"},
        ),
    )

    assert [r["outcome"] for r in result["results"]] == ["applied", "applied"]
    assert status_of(api, deck.id) == "active"
    assert api.get(f"/decks/{deck.id}/legalite").json()["is_legal"] is False


def test_proxies_count_in_the_deck_sizes_through_the_queue(api, db, frozen_today):
    """Douze vampires de crypt dont six proxies : l'effectif est de douze."""
    deck = build(api, db, crypt(quantity=12), library(quantity=60))
    lines = api.get(f"/decks/{deck.id}").json()["cards"]
    crypt_line = next(line for line in lines if line["quantity"] == 12)
    card_id, card_set_id = crypt_line["card_id"], crypt_line["card_set_id"]

    def own(quantity: int) -> dict:
        return op(
            "stock.upsert",
            data={
                "card_id": card_id,
                "language_code": "EN",
                "card_set_id": card_set_id,
                "quantity_owned": quantity,
            },
        )

    # Douze exemplaires alloués : on ne peut pas en posséder six...
    assert sync_batch(api, own(6))["results"][0]["error"]["code"] == "conflict"
    # ... sauf à en mettre six en proxy dans le deck, d'abord (le deck doit
    # d'abord autoriser les proxies — Lot 4 : propriété du deck).
    body = sync_batch(
        api,
        own(12),  # le proxy doit être autorisé avant d'être utilisé
        op(
            "deck.update",
            deck={"deck_id": deck.id},
            data={"proxy_allowed": True},
        ),
        op(
            "deck_card.upsert",
            deck={"deck_id": deck.id},
            data={
                "card_id": card_id,
                "language_code": "EN",
                "card_set_id": card_set_id,
                "quantity": 12,
                "proxy_quantity": 6,
            },
        ),
        own(6),
    )
    assert [r["outcome"] for r in body["results"]] == ["applied"] * 4
    assert activate(api, deck.id)["outcome"] == "applied"
    legality = api.get(f"/decks/{deck.id}/legalite").json()
    assert legality["crypt_count"] == 12


# --------------------------------------------------------------------------
# Comptabilité du stock
# --------------------------------------------------------------------------


def test_a_proxy_consumes_no_owned_copy_through_the_queue(api, db, world):
    """4 possédés : une ligne de 6 dont 2 proxies consomme 4 réels, pas 6."""
    card = world.card
    card_set_id = world.printing.card_set_id
    # `world.deck` alloue déjà les 4 exemplaires EN : on le vide pour repartir,
    # et on autorise les proxies sur le deck (Lot 4).
    sync_batch(
        api,
        op(
            "deck_card.delete",
            deck={"deck_id": world.deck.id},
            card_id=card.id,
            language_code="EN",
            card_set_id=card_set_id,
        ),
        op(
            "stock.upsert",
            data={
                "card_id": card.id,
                "language_code": "EN",
                "card_set_id": card_set_id,
                "quantity_owned": 4,
            },
        ),
        op(
            "deck.update",
            deck={"deck_id": world.deck.id},
            data={"proxy_allowed": True},
        ),
    )
    assert stock.allocated_real(db, card.id, "EN", card_set_id) == 0

    result = sync_batch(
        api,
        op(
            "deck_card.upsert",
            deck={"deck_id": world.deck.id},
            data={
                "card_id": card.id,
                "language_code": "EN",
                "card_set_id": card_set_id,
                "quantity": 6,
                "proxy_quantity": 2,
            },
        ),
        op(  # une ligne de 7 dont 2 proxies demanderait 5 réels : refusée
            "deck_card.upsert",
            deck={"deck_id": world.deck.id},
            data={
                "card_id": card.id,
                "language_code": "EN",
                "card_set_id": card_set_id,
                "quantity": 7,
                "proxy_quantity": 2,
            },
        ),
    )

    assert [r["outcome"] for r in result["results"]] == ["applied", "rejected"]
    assert "insuffisants" in result["results"][1]["error"]["message"]
    db.expire_all()
    assert stock.allocated_real(db, card.id, "EN", card_set_id) == 4


def test_a_stock_entry_used_by_a_deck_cannot_be_removed_through_the_queue(
    api, db, world
):
    card = world.card
    card_set_id = world.printing.card_set_id

    refused = sync_batch(
        api,
        op(
            "stock.delete",
            card_id=card.id,
            language_code="EN",
            card_set_id=card_set_id,
        ),
    )["results"][0]
    assert refused["error"]["code"] == "conflict"

    # Le deck lâche la carte : la même suppression, sous une nouvelle clé, passe.
    released = sync_batch(
        api,
        op(
            "deck_card.delete",
            deck={"deck_id": world.deck.id},
            card_id=card.id,
            language_code="EN",
            card_set_id=card_set_id,
        ),
        op(
            "stock.delete",
            card_id=card.id,
            language_code="EN",
            card_set_id=card_set_id,
        ),
    )
    assert [r["outcome"] for r in released["results"]] == ["applied", "applied"]
    assert api.get("/stock", params={"language_code": "EN"}).json() == []


def test_the_proxy_authorization_lives_on_the_deck_not_the_stock_entry(api, db, world):
    """Lot 4 : `stock.upsert` ne porte plus l'autorisation de proxy ; c'est
    `deck.update` qui la refuse tant qu'une ligne du deck en joue (le refus
    lui-même est couvert par `test_sync_service.py::
    test_disabling_proxy_on_a_deck_that_plays_one_is_refused`)."""
    card = world.card
    card_set_id = world.printing.card_set_id
    # FR : 0 exemplaire possédé, et un deck qui l'emploie en proxy.
    sync_batch(
        api,
        op(
            "deck.update",
            deck={"deck_id": world.deck.id},
            data={"proxy_allowed": True},
        ),
        op(
            "deck_card.upsert",
            deck={"deck_id": world.deck.id},
            data={
                "card_id": card.id,
                "language_code": "FR",
                "card_set_id": card_set_id,
                "quantity": 2,
                "proxy_quantity": 2,
            },
        ),
    )

    # L'entrée de stock elle-même ne retient plus rien du proxy.
    accepted = sync_batch(
        api,
        op(
            "stock.upsert",
            data={
                "card_id": card.id,
                "language_code": "FR",
                "card_set_id": card_set_id,
                "quantity_owned": 0,
            },
        ),
    )["results"][0]
    assert accepted["outcome"] == "applied"

    refused = sync_batch(
        api,
        op(
            "deck.update",
            deck={"deck_id": world.deck.id},
            data={"proxy_allowed": False},
        ),
    )["results"][0]
    assert refused["error"]["code"] == "conflict"
    assert "proxy" in refused["error"]["message"]


def test_an_archived_deck_keeps_its_copies_and_a_deleted_one_gives_them_back(
    api, db, world
):
    card = world.card
    card_set_id = world.printing.card_set_id
    deck = {"deck_id": world.deck.id}
    lower = op(
        "stock.upsert",
        data={
            "card_id": card.id,
            "language_code": "EN",
            "card_set_id": card_set_id,
            "quantity_owned": 1,
        },
    )

    # Archivé : les 4 exemplaires restent réservés, on ne descend pas à 1.
    sync_batch(api, op("deck.update", deck=deck, data={"archived": True}))
    kept = sync_batch(api, lower)["results"][0]
    assert kept["error"]["code"] == "conflict"
    assert "alloués" in kept["error"]["message"]

    # Supprimé (logiquement) : la decklist figée ne retient plus rien.
    sync_batch(api, op("deck.delete", deck=deck))
    lower_again = op(
        "stock.upsert",
        data={
            "card_id": card.id,
            "language_code": "EN",
            "card_set_id": card_set_id,
            "quantity_owned": 1,
        },
    )
    given_back = sync_batch(api, lower_again)["results"][0]
    assert given_back["outcome"] == "applied"


def test_languages_are_counted_separately_through_the_queue(api, db, world):
    """4 EN alloués au deck : 3 FR de plus forment un stock à part."""
    card = world.card
    card_set_id = world.printing.card_set_id
    sync_batch(
        api,
        op(
            "stock.upsert",
            data={
                "card_id": card.id,
                "language_code": "FR",
                "card_set_id": card_set_id,
                "quantity_owned": 3,
            },
        ),
    )

    over_en = sync_batch(
        api,
        op(
            "deck_card.upsert",
            deck={"deck_id": world.deck.id},
            data={
                "card_id": card.id,
                "language_code": "EN",
                "card_set_id": card_set_id,
                "quantity": 5,
            },
        ),
    )["results"][0]
    fr_line = sync_batch(
        api,
        op(
            "deck_card.upsert",
            deck={"deck_id": world.deck.id},
            data={
                "card_id": card.id,
                "language_code": "FR",
                "card_set_id": card_set_id,
                "quantity": 3,
            },
        ),
    )["results"][0]

    assert over_en["error"]["code"] == "conflict"  # 5 EN pour 4 possédés
    assert fr_line["outcome"] == "applied"  # les FR sont un stock à part
