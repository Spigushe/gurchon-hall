"""Contraintes du schéma : ce que la base refuse, indépendamment du code appelant.

Périmètre (Lot 1) : clés primaires composites, clés étrangères avec
`PRAGMA foreign_keys` actif, contraintes `CHECK` (bornes et énumérations
fermées), unicité (dont l'index partiel du joueur « Moi »), nullabilité.

Ce qui est volontairement hors de ce fichier : les règles qui portent sur
plusieurs lignes (deck crypt >= 12, library 60-90, somme allouée <= possédé +
proxy, tournoi mono-deck, cohérence VP/GW). Elles ne sont pas dans le schéma
au Lot 1 (elles arrivent avec les services du Lot 2, skill `regles-vtes`) et ne
sont donc pas testées ici comme si elles existaient. La règle du Game Win reste
[à confirmer] : rien ici ne la suppose.

Les violations sont provoquées en SQL brut quand l'ORM les intercepterait avant
la base (type `Enum` avec `validate_strings`, identity map sur les clés
primaires) : c'est bien la base qu'on veut éprouver.
"""

from datetime import date, datetime

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError, StatementError

from app.models import (
    Bundle,
    Card,
    CardCategory,
    CardCopy,
    CardDisciplineLink,
    CardPrinting,
    CardPrintingOccurrence,
    CardSet,
    CardTranslation,
    CardType,
    CardTypeLink,
    Clan,
    CostType,
    Deck,
    DeckCard,
    DeckPolicy,
    DeckStatus,
    DeletedDeckCard,
    Discipline,
    DisciplineRequirement,
    Game,
    Language,
    Participation,
    Player,
    PrintOccurrence,
    RoundType,
    Sect,
    Tournament,
    TournamentFormat,
    Venue,
)
from app.models.base import utcnow
from tests.helpers import (
    add_languages,
    make_card,
    make_copy,
    make_deck,
    make_game,
    make_player,
    make_printing,
    make_tournament,
)


def run_sql(db, sql: str, **params):
    """Exécute du SQL brut, en contournant les validations de l'ORM."""
    return db.execute(text(sql), params)


# --------------------------------------------------------------------------
# PRAGMA foreign_keys
# --------------------------------------------------------------------------


def test_foreign_keys_pragma_is_on_for_every_connection(db_engine):
    """L'écouteur de `app.db.session` s'applique à chaque connexion du moteur."""
    for _ in range(3):
        with db_engine.connect() as connection:
            assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1


def test_foreign_key_is_really_enforced(db):
    """Preuve de bout en bout : sans le PRAGMA, cette insertion passerait."""
    with pytest.raises(IntegrityError):
        run_sql(
            db,
            "INSERT INTO card_copy (card_id, language_code, card_set_id,"
            " quantity_owned) VALUES (999, 'EN', 1, 1)",
        )


# --------------------------------------------------------------------------
# card_copy : clé primaire composite (card_id, language_code)
# --------------------------------------------------------------------------


def test_card_copy_primary_key_is_card_and_language(db_engine):
    columns = inspect(db_engine).get_pk_constraint("card_copy")
    assert columns["constrained_columns"] == ["card_id", "language_code", "card_set_id"]


def test_card_copy_rejects_duplicate_card_and_language(db):
    add_languages(db)
    card = make_card(db)
    copy = make_copy(db, card, "EN")
    with pytest.raises(IntegrityError):
        run_sql(
            db,
            "INSERT INTO card_copy (card_id, language_code, card_set_id,"
            " quantity_owned) VALUES (:c, 'EN', :s, 2)",
            c=card.id,
            s=copy.card_set_id,
        )


def test_card_copy_accepts_same_card_in_another_language(db):
    add_languages(db)
    card = make_card(db)
    printing = make_printing(db, card)
    make_copy(db, card, "EN", card_set_id=printing.card_set_id)
    make_copy(db, card, "FR", card_set_id=printing.card_set_id)
    assert db.query(CardCopy).filter_by(card_id=card.id).count() == 2


def test_card_copy_accepts_same_language_for_another_card(db):
    add_languages(db)
    make_copy(db, make_card(db, "A"), "EN")
    make_copy(db, make_card(db, "B"), "EN")
    assert db.query(CardCopy).count() == 2


def test_card_copy_requires_existing_card(db):
    add_languages(db)
    card_set = CardSet(abbrev="TS")
    db.add(card_set)
    db.flush()
    db.add(
        CardCopy(card_id=424242, language_code="EN", card_set_id=card_set.id)
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_card_copy_requires_existing_language(db):
    """Impression réelle posée exprès : seule la langue doit faire échouer."""
    add_languages(db)
    card = make_card(db)
    printing = make_printing(db, card)
    db.add(
        CardCopy(
            card_id=card.id, language_code="ZZ", card_set_id=printing.card_set_id
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_card_copy_requires_a_real_printing(db):
    """Lot 4, D2 : la FK composite vers `card_printing` refuse une extension où
    la carte n'a pas été imprimée — le dernier filet derrière le contrôle
    applicatif (`catalog.get_printing`, § B1/B2)."""
    add_languages(db)
    card = make_card(db)
    card_set = CardSet(abbrev="TS")
    db.add(card_set)
    db.flush()
    db.add(CardCopy(card_id=card.id, language_code="EN", card_set_id=card_set.id))
    with pytest.raises(IntegrityError):
        db.flush()


def test_card_copy_accepts_a_zero_owned_entry(db):
    """0 exemplaire possédé : le cas « joué uniquement en proxy » (§11.2). Le
    proxy lui-même s'autorise sur le deck, pas ici (Lot 4)."""
    add_languages(db)
    copy = make_copy(db, make_card(db), "EN", quantity_owned=0)
    db.commit()
    db.refresh(copy)
    assert copy.quantity_owned == 0


def test_card_copy_rejects_negative_quantity(db):
    add_languages(db)
    card = make_card(db)
    printing = make_printing(db, card)
    db.add(
        CardCopy(
            card_id=card.id,
            language_code="EN",
            card_set_id=printing.card_set_id,
            quantity_owned=-1,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


# --------------------------------------------------------------------------
# deck_card : PK (deck_id, card_id, language_code, card_set_id, Lot 4) et FK
# composite -> card_copy
# --------------------------------------------------------------------------


def test_deck_card_primary_key_is_deck_card_and_language(db_engine):
    columns = inspect(db_engine).get_pk_constraint("deck_card")
    assert columns["constrained_columns"] == [
        "deck_id",
        "card_id",
        "language_code",
        "card_set_id",
    ]


def test_deck_card_foreign_key_to_card_copy_is_composite(db_engine):
    """La FK vers la collection est bien une seule contrainte à trois colonnes."""
    foreign_keys = inspect(db_engine).get_foreign_keys("deck_card")
    to_copy = [fk for fk in foreign_keys if fk["referred_table"] == "card_copy"]
    assert len(to_copy) == 1
    assert to_copy[0]["constrained_columns"] == [
        "card_id",
        "language_code",
        "card_set_id",
    ]
    assert to_copy[0]["referred_columns"] == [
        "card_id",
        "language_code",
        "card_set_id",
    ]
    # Pas de FK directe vers `card` : l'intégrité passe par card_copy.
    assert not [fk for fk in foreign_keys if fk["referred_table"] == "card"]


def test_deck_card_rejects_duplicate_line(db):
    add_languages(db)
    card = make_card(db)
    copy = make_copy(db, card, "EN", quantity_owned=4)
    deck = make_deck(db)
    insert = (
        "INSERT INTO deck_card (deck_id, card_id, language_code, card_set_id,"
        " quantity, proxy_quantity) VALUES (:d, :c, 'EN', :s, 1, 0)"
    )
    run_sql(db, insert, d=deck.id, c=card.id, s=copy.card_set_id)
    with pytest.raises(IntegrityError):
        run_sql(db, insert, d=deck.id, c=card.id, s=copy.card_set_id)


def test_deck_card_rejects_card_absent_from_collection(db):
    """Carte au catalogue, langue connue, mais aucun exemplaire déclaré."""
    add_languages(db)
    card = make_card(db)
    printing = make_printing(db, card)
    deck = make_deck(db)
    db.add(
        DeckCard(
            deck_id=deck.id,
            card_id=card.id,
            language_code="EN",
            card_set_id=printing.card_set_id,
            quantity=1,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_deck_card_rejects_language_missing_from_collection(db):
    """La carte est en collection en EN seulement : la FR est refusée en deck."""
    add_languages(db)
    card = make_card(db)
    copy = make_copy(db, card, "EN")
    deck = make_deck(db)
    db.add(
        DeckCard(
            deck_id=deck.id,
            card_id=card.id,
            language_code="FR",
            card_set_id=copy.card_set_id,
            quantity=1,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_deck_card_rejects_other_cards_collection_entry(db):
    """L'entrée de collection d'une autre carte ne couvre pas celle-ci."""
    add_languages(db)
    owned = make_card(db, "Possédée")
    other = make_card(db, "Autre")
    copy = make_copy(db, owned, "EN")
    deck = make_deck(db)
    db.add(
        DeckCard(
            deck_id=deck.id,
            card_id=other.id,
            language_code="EN",
            card_set_id=copy.card_set_id,
            quantity=1,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_deck_card_requires_existing_deck(db):
    add_languages(db)
    card = make_card(db)
    copy = make_copy(db, card, "EN")
    db.add(
        DeckCard(
            deck_id=777,
            card_id=card.id,
            language_code="EN",
            card_set_id=copy.card_set_id,
            quantity=1,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_deck_card_accepts_same_card_in_two_languages(db):
    """§11.4 : un deck peut mêler les langues d'une même carte."""
    add_languages(db)
    card = make_card(db)
    printing = make_printing(db, card)
    make_copy(db, card, "EN", quantity_owned=2, card_set_id=printing.card_set_id)
    make_copy(db, card, "FR", quantity_owned=2, card_set_id=printing.card_set_id)
    deck = make_deck(db)
    db.add_all(
        [
            DeckCard(
                deck_id=deck.id,
                card_id=card.id,
                language_code="EN",
                card_set_id=printing.card_set_id,
                quantity=2,
            ),
            DeckCard(
                deck_id=deck.id,
                card_id=card.id,
                language_code="FR",
                card_set_id=printing.card_set_id,
                quantity=1,
            ),
        ]
    )
    db.commit()
    assert db.query(DeckCard).filter_by(deck_id=deck.id).count() == 2


def test_deck_card_accepts_proxy_line_backed_by_a_proxy_only_copy(db):
    add_languages(db)
    card = make_card(db)
    copy = make_copy(db, card, "FR", quantity_owned=0)
    deck = make_deck(db, proxy_allowed=True)
    db.add(
        DeckCard(
            deck_id=deck.id,
            card_id=card.id,
            language_code="FR",
            card_set_id=copy.card_set_id,
            quantity=3,
            proxy_quantity=3,
        )
    )
    db.commit()


def test_same_card_can_be_in_several_decks(db):
    add_languages(db)
    card = make_card(db)
    copy = make_copy(db, card, "EN", quantity_owned=4)
    first, second = make_deck(db, "Un"), make_deck(db, "Deux")
    db.add_all(
        [
            DeckCard(
                deck_id=first.id,
                card_id=card.id,
                language_code="EN",
                card_set_id=copy.card_set_id,
                quantity=2,
            ),
            DeckCard(
                deck_id=second.id,
                card_id=card.id,
                language_code="EN",
                card_set_id=copy.card_set_id,
                quantity=2,
            ),
        ]
    )
    db.commit()


@pytest.mark.parametrize(
    ("quantity", "proxy_quantity"),
    [
        pytest.param(0, 0, id="quantity-zero"),
        pytest.param(-1, 0, id="quantity-negative"),
        pytest.param(2, -1, id="proxy-negative"),
        pytest.param(2, 3, id="proxy-above-quantity"),
    ],
)
def test_deck_card_check_rejects_invalid_quantities(db, quantity, proxy_quantity):
    add_languages(db)
    card = make_card(db)
    copy = make_copy(db, card, "EN", quantity_owned=4)
    deck = make_deck(db)
    db.add(
        DeckCard(
            deck_id=deck.id,
            card_id=card.id,
            language_code="EN",
            card_set_id=copy.card_set_id,
            quantity=quantity,
            proxy_quantity=proxy_quantity,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


@pytest.mark.parametrize(
    ("quantity", "proxy_quantity"),
    [(1, 0), (1, 1), (3, 2), (3, 3)],
)
def test_deck_card_check_accepts_boundary_quantities(db, quantity, proxy_quantity):
    add_languages(db)
    card = make_card(db)
    copy = make_copy(db, card, "EN", quantity_owned=0)
    deck = make_deck(db, proxy_allowed=True)
    db.add(
        DeckCard(
            deck_id=deck.id,
            card_id=card.id,
            language_code="EN",
            card_set_id=copy.card_set_id,
            quantity=quantity,
            proxy_quantity=proxy_quantity,
        )
    )
    db.flush()


# --------------------------------------------------------------------------
# deleted_deck_card : la decklist figée ne retient plus la collection
# --------------------------------------------------------------------------


def test_deleted_deck_card_primary_key_is_deck_card_and_language(db_engine):
    columns = inspect(db_engine).get_pk_constraint("deleted_deck_card")
    assert columns["constrained_columns"] == [
        "deck_id",
        "card_id",
        "language_code",
        "card_set_id",
    ]


def test_deleted_deck_card_has_no_foreign_key_to_the_collection(db_engine):
    keys = inspect(db_engine).get_foreign_keys("deleted_deck_card")
    # `card_set` (Lot 4, D1) : l'extension reste connue, sans réserver de stock
    # (pas de FK vers `card_copy` ni `card_printing`).
    assert {fk["referred_table"] for fk in keys} == {
        "deck",
        "card",
        "language",
        "card_set",
    }


def test_deleted_deck_card_accepts_a_line_without_any_collection_entry(db):
    """Le cas nominal : la carte n'est plus en stock, la ligne figée demeure."""
    add_languages(db)
    card = make_card(db)
    card_set = CardSet(abbrev="TS")
    db.add(card_set)
    db.flush()
    deck = make_deck(db, deleted_at=utcnow())
    db.add(
        DeletedDeckCard(
            deck_id=deck.id,
            card_id=card.id,
            language_code="EN",
            card_set_id=card_set.id,
            quantity=2,
        )
    )
    db.commit()
    assert db.query(DeletedDeckCard).count() == 1


def test_deleting_a_collection_entry_no_longer_trips_on_a_frozen_line(db):
    """Une ligne vivante bloque la suppression du stock ; une ligne figée, non."""
    add_languages(db)
    card = make_card(db)
    copy = make_copy(db, card, "EN", quantity_owned=2)
    deck = make_deck(db)
    db.add(
        DeckCard(
            deck_id=deck.id,
            card_id=card.id,
            language_code="EN",
            card_set_id=copy.card_set_id,
            quantity=2,
        )
    )
    db.commit()

    db.delete(copy)
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()

    # Même situation, mais la composition a été figée à la suppression du deck.
    db.query(DeckCard).delete()
    db.add(
        DeletedDeckCard(
            deck_id=deck.id,
            card_id=card.id,
            language_code="EN",
            card_set_id=copy.card_set_id,
            quantity=2,
        )
    )
    db.commit()

    db.delete(db.get(CardCopy, (card.id, "EN", copy.card_set_id)))
    db.commit()

    assert db.query(DeletedDeckCard).count() == 1


def test_deleted_deck_card_disappears_with_its_deck(db):
    """`ON DELETE CASCADE` : une suppression *physique* du deck emporte tout."""
    add_languages(db)
    card = make_card(db)
    card_set = CardSet(abbrev="TS")
    db.add(card_set)
    db.flush()
    deck = make_deck(db, deleted_at=utcnow())
    db.add(
        DeletedDeckCard(
            deck_id=deck.id,
            card_id=card.id,
            language_code="EN",
            card_set_id=card_set.id,
            quantity=1,
        )
    )
    db.commit()

    run_sql(db, "DELETE FROM deck WHERE id = :id", id=deck.id)
    db.commit()
    assert db.query(DeletedDeckCard).count() == 0


@pytest.mark.parametrize(
    ("quantity", "proxy_quantity"),
    [
        pytest.param(0, 0, id="quantity-zero"),
        pytest.param(-1, 0, id="quantity-negative"),
        pytest.param(2, -1, id="proxy-negative"),
        pytest.param(2, 3, id="proxy-above-quantity"),
    ],
)
def test_deleted_deck_card_check_rejects_invalid_quantities(
    db, quantity, proxy_quantity
):
    add_languages(db)
    card = make_card(db)
    card_set = CardSet(abbrev="TS")
    db.add(card_set)
    db.flush()
    deck = make_deck(db, deleted_at=utcnow())
    db.add(
        DeletedDeckCard(
            deck_id=deck.id,
            card_id=card.id,
            language_code="EN",
            card_set_id=card_set.id,
            quantity=quantity,
            proxy_quantity=proxy_quantity,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_deleted_deck_card_still_requires_a_known_card_and_language(db):
    add_languages(db)
    card_set = CardSet(abbrev="TS")
    db.add(card_set)
    db.flush()
    deck = make_deck(db, deleted_at=utcnow())
    db.add(
        DeletedDeckCard(
            deck_id=deck.id,
            card_id=999,
            language_code="EN",
            card_set_id=card_set.id,
            quantity=1,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()
    card = make_card(db)
    deck = make_deck(db, deleted_at=utcnow())
    db.add(
        DeletedDeckCard(
            deck_id=deck.id,
            card_id=card.id,
            language_code="ZZ",
            card_set_id=card_set.id,
            quantity=1,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_deleted_deck_card_still_requires_a_known_card_set(db):
    """Lot 4, D1 : `card_set_id` fait partie de la clé et garde sa FK."""
    add_languages(db)
    card = make_card(db)
    deck = make_deck(db, deleted_at=utcnow())
    db.add(
        DeletedDeckCard(
            deck_id=deck.id,
            card_id=card.id,
            language_code="EN",
            card_set_id=424242,
            quantity=1,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


# --------------------------------------------------------------------------
# Autres CHECK bornés
# --------------------------------------------------------------------------


@pytest.mark.parametrize("player_count", [-1, 0, 1])
def test_game_rejects_fewer_than_two_players(db, player_count):
    db.add(Game(played_at=datetime(2026, 1, 1, 20), player_count=player_count))
    with pytest.raises(IntegrityError):
        db.flush()


@pytest.mark.parametrize("player_count", [2, 4, 5, 6])
def test_game_accepts_two_or_more_players(db, player_count):
    """Le schéma ne fixe pas 4-5 joueurs (§5 : standard, pas contrainte)."""
    make_game(db, player_count=player_count)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        pytest.param("victory_points", -0.5, id="vp-negative"),
        pytest.param("seat", 0, id="seat-zero"),
        pytest.param("seat", -2, id="seat-negative"),
    ],
)
def test_participation_check_rejects_out_of_range(db, field, value):
    game = make_game(db)
    player = make_player(db)
    db.add(Participation(game_id=game.id, player_id=player.id, **{field: value}))
    with pytest.raises(IntegrityError):
        db.flush()


@pytest.mark.parametrize(
    ("victory_points", "seat"),
    [(0, 1), (0.5, 2), (2.5, 5), (None, None)],
)
def test_participation_accepts_boundaries_and_half_points(db, victory_points, seat):
    game = make_game(db)
    player = make_player(db)
    participation = Participation(
        game_id=game.id, player_id=player.id, victory_points=victory_points, seat=seat
    )
    db.add(participation)
    db.commit()
    db.refresh(participation)
    assert participation.victory_points == victory_points


# --------------------------------------------------------------------------
# Enums fermés : CHECK nommé en base
# --------------------------------------------------------------------------

# (table, colonne, nom de contrainte attendu, enum, colonnes obligatoires valides)
ENUM_COLUMNS = [
    pytest.param(
        "card",
        "category",
        "ck_card_card_category",
        CardCategory,
        {"vekn_id": 1, "name": "X", "advanced": 0, "burn_option": 0, "trifle": 0},
        id="card.category",
    ),
    pytest.param(
        "card",
        "cost_type",
        "ck_card_cost_type",
        CostType,
        {
            "vekn_id": 1,
            "name": "X",
            "category": "library",
            "advanced": 0,
            "burn_option": 0,
            "trifle": 0,
        },
        id="card.cost_type",
    ),
    pytest.param(
        "card",
        "discipline_requirement",
        "ck_card_discipline_requirement",
        DisciplineRequirement,
        {
            "vekn_id": 1,
            "name": "X",
            "category": "library",
            "advanced": 0,
            "burn_option": 0,
            "trifle": 0,
        },
        id="card.discipline_requirement",
    ),
    pytest.param(
        "deck",
        "status",
        "ck_deck_deck_status",
        DeckStatus,
        {"name": "X", "discriminator": "0001"},
        id="deck.status",
    ),
    pytest.param(
        "tournament",
        "deck_policy",
        "ck_tournament_deck_policy",
        DeckPolicy,
        {"name": "X", "start_date": "2026-01-01", "format": "constructed"},
        id="tournament.deck_policy",
    ),
    pytest.param(
        "tournament",
        "format",
        "ck_tournament_tournament_format",
        TournamentFormat,
        {"name": "X", "start_date": "2026-01-01", "deck_policy": "mono"},
        id="tournament.format",
    ),
    pytest.param(
        "game",
        "round_type",
        "ck_game_round_type",
        RoundType,
        {"played_at": "2026-01-01 20:00:00", "player_count": 4},
        id="game.round_type",
    ),
]


def insert_row(db, table: str, values: dict) -> None:
    columns = ", ".join(values)
    placeholders = ", ".join(f":{name}" for name in values)
    run_sql(db, f"INSERT INTO {table} ({columns}) VALUES ({placeholders})", **values)


@pytest.mark.parametrize(
    ("table", "column", "constraint", "enum", "base"), ENUM_COLUMNS
)
def test_enum_column_has_a_named_check_constraint(
    db_engine, table, column, constraint, enum, base
):
    checks = inspect(db_engine).get_check_constraints(table)
    by_name = {check["name"]: check["sqltext"] for check in checks}
    assert constraint in by_name
    # La contrainte liste exactement les valeurs de l'enum, ni plus ni moins.
    for member in enum:
        assert f"'{member.value}'" in by_name[constraint]
    assert by_name[constraint].count("'") == 2 * len(enum)


@pytest.mark.parametrize(
    ("table", "column", "constraint", "enum", "base"), ENUM_COLUMNS
)
@pytest.mark.parametrize("bogus", ["bogus", "", "CRYPT", "Active"])
def test_enum_column_rejects_invalid_value_in_database(
    db, table, column, constraint, enum, base, bogus
):
    with pytest.raises(IntegrityError) as excinfo:
        insert_row(db, table, {**base, column: bogus})
    assert "CHECK" in str(excinfo.value)


@pytest.mark.parametrize(
    ("table", "column", "constraint", "enum", "base"), ENUM_COLUMNS
)
def test_enum_column_accepts_every_member_value(
    db, table, column, constraint, enum, base
):
    for index, member in enumerate(enum):
        row = {**base, column: member.value}
        # `card.vekn_id` est unique, le couple nom + discriminant d'un deck
        # aussi : varier la clé naturelle.
        if table == "card":
            row["vekn_id"] = index + 1
        if table == "deck":
            row["name"] = f"deck-{index}"
        insert_row(db, table, row)


@pytest.mark.parametrize(
    ("factory", "field"),
    [
        pytest.param(
            lambda: Deck(name="X", discriminator="0001"),
            "status",
            id="deck.status",
        ),
        pytest.param(
            lambda: Tournament(name="X", start_date=date(2026, 1, 1)),
            "deck_policy",
            id="tournament.deck_policy",
        ),
        pytest.param(
            lambda: Tournament(name="X", start_date=date(2026, 1, 1)),
            "format",
            id="tournament.format",
        ),
        pytest.param(
            lambda: Game(played_at=datetime(2026, 1, 1), player_count=4),
            "round_type",
            id="game.round_type",
        ),
        pytest.param(
            lambda: Card(vekn_id=1, name="X"),
            "category",
            id="card.category",
        ),
    ],
)
def test_enum_invalid_string_is_also_refused_by_the_orm(db, factory, field):
    """Double garde : l'ORM refuse avant même d'émettre le SQL."""
    obj = factory()
    setattr(obj, field, "bogus")
    db.add(obj)
    with pytest.raises((LookupError, StatementError)):
        db.flush()


def test_enum_values_are_stored_as_values_not_member_names(db):
    """`CardCategory.CRYPT` est stocké « crypt » : la base reste lisible."""
    make_card(db, category=CardCategory.CRYPT)
    make_deck(db, status=DeckStatus.ACTIVE)
    make_tournament(db, deck_policy=DeckPolicy.MULTI, format=TournamentFormat.DRAFT)
    make_game(db, round_type=RoundType.FINAL)
    db.commit()
    assert run_sql(db, "SELECT category FROM card").scalar() == "crypt"
    assert run_sql(db, "SELECT status FROM deck").scalar() == "active"
    row = run_sql(db, "SELECT deck_policy, format FROM tournament").one()
    assert tuple(row) == ("multi", "draft")
    assert run_sql(db, "SELECT round_type FROM game").scalar() == "final"


def test_language_is_an_open_list_without_check_constraint(db_engine, db):
    """§11.2 : la liste des langues n'est pas fermée, aucune contrainte CHECK.

    Ajouter une langue est une simple insertion de ligne.
    """
    inspector = inspect(db_engine)
    assert inspector.get_check_constraints("language") == []
    assert not [
        check
        for table in ("card_copy", "card_translation")
        for check in inspector.get_check_constraints(table)
        if "language" in check["sqltext"]
    ]

    db.add(Language(code="DE", label="Allemand", sort_order=40))
    db.commit()
    assert db.get(Language, "DE") is not None


def test_language_code_is_the_primary_key(db):
    add_languages(db, "EN")
    db.add(Language(code="EN", label="Doublon"))
    with pytest.raises(IntegrityError):
        db.flush()


# --------------------------------------------------------------------------
# Joueur « Moi » : index unique partiel
# --------------------------------------------------------------------------


def test_player_is_me_partial_unique_index_exists(db):
    sql = run_sql(
        db, "SELECT sql FROM sqlite_master WHERE name = 'ux_player_is_me'"
    ).scalar()
    assert sql is not None
    assert "UNIQUE" in sql.upper()
    assert "WHERE is_me = 1" in sql


def test_second_me_is_rejected(db):
    make_player(db, "Moi", is_me=True)
    db.add(Player(name="Autre moi", is_me=True))
    with pytest.raises(IntegrityError):
        db.flush()


def test_many_non_me_players_are_accepted(db):
    for index in range(5):
        make_player(db, f"Adversaire {index}", is_me=False)
    db.commit()
    assert db.query(Player).count() == 5


def test_one_me_and_many_others_are_accepted(db):
    make_player(db, "Moi", is_me=True)
    for index in range(3):
        make_player(db, f"Adversaire {index}")
    db.commit()
    assert db.query(Player).filter_by(is_me=True).count() == 1


def test_me_can_be_handed_over_to_another_player(db):
    old = make_player(db, "Ancien moi", is_me=True)
    new = make_player(db, "Nouveau moi")
    old.is_me = False
    db.flush()
    new.is_me = True
    db.commit()
    assert db.query(Player).filter_by(is_me=True).one().name == "Nouveau moi"


def test_me_slot_is_freed_when_me_is_deleted(db):
    me = make_player(db, "Moi", is_me=True)
    db.delete(me)
    db.flush()
    make_player(db, "Moi bis", is_me=True)


def test_player_name_is_unique(db):
    make_player(db, "Alice")
    db.add(Player(name="Alice"))
    with pytest.raises(IntegrityError):
        db.flush()


# --------------------------------------------------------------------------
# Unicité
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "model",
    [
        pytest.param(lambda: Clan(name="Ventrue"), id="clan.name"),
        pytest.param(lambda: Discipline(name="Dominate"), id="discipline.name"),
        pytest.param(lambda: Sect(name="Camarilla"), id="sect.name"),
        pytest.param(lambda: CardType(name="Action"), id="card_type.name"),
        pytest.param(lambda: CardSet(abbrev="FN"), id="card_set.abbrev"),
        pytest.param(lambda: Venue(name="Club"), id="venue.name"),
        pytest.param(
            lambda: Deck(name="Grinder", discriminator="8561"),
            id="deck.name_discriminator",
        ),
    ],
)
def test_natural_keys_are_unique(db, model):
    db.add(model())
    db.flush()
    db.add(model())
    with pytest.raises(IntegrityError):
        db.flush()


# --------------------------------------------------------------------------
# Deck : nom libre, discriminant obligatoire
# --------------------------------------------------------------------------


def test_two_decks_may_share_a_name_with_different_discriminators(db):
    """Le nom seul n'identifie rien : deux « Grinder » cohabitent."""
    make_deck(db, "Grinder", discriminator="0001")
    make_deck(db, "Grinder", discriminator="8561")
    db.commit()

    assert db.query(Deck).filter_by(name="Grinder").count() == 2


def test_a_deleted_deck_keeps_its_name_and_discriminator(db):
    """Contrairement à l'index partiel d'avant : l'identité n'est pas recyclée."""
    make_deck(db, "Grinder", discriminator="0001", deleted_at=utcnow())
    db.commit()

    db.add(Deck(name="Grinder", discriminator="0001"))
    with pytest.raises(IntegrityError):
        db.flush()


def test_an_archived_deck_also_keeps_its_pair(db):
    make_deck(db, "Grinder", discriminator="0001", archived_at=utcnow())
    db.add(Deck(name="Grinder", discriminator="0001"))
    with pytest.raises(IntegrityError):
        db.flush()


def test_deck_name_uniqueness_is_a_plain_unique_constraint(db_engine):
    """Plus d'index partiel : une contrainte ordinaire sur le couple."""
    inspector = inspect(db_engine)
    indexes = {ix["name"] for ix in inspector.get_indexes("deck")}
    assert "uq_deck_name_not_deleted" not in indexes
    uniques = {
        tuple(uq["column_names"]): uq["name"]
        for uq in inspector.get_unique_constraints("deck")
    }
    assert uniques == {("name", "discriminator"): "uq_deck_name_discriminator"}


def test_deck_requires_a_discriminator(db):
    db.add(Deck(name="Sans discriminant"))
    with pytest.raises(IntegrityError) as excinfo:
        db.flush()
    assert "NOT NULL" in str(excinfo.value)


@pytest.mark.parametrize("value", ["0001", "0042", "9999", "1234"])
def test_deck_accepts_four_digit_discriminators(db, value):
    make_deck(db, "Grinder", discriminator=value)
    db.commit()


@pytest.mark.parametrize(
    "value", ["", "1", "42", "00042", "abcd", "004a", "12 4", "0000", " 001"]
)
def test_deck_refuses_anything_but_four_digits(db, value):
    db.add(Deck(name="Grinder", discriminator=value))
    with pytest.raises(IntegrityError) as excinfo:
        db.flush()
    assert "CHECK" in str(excinfo.value)


def test_card_vekn_id_is_unique(db):
    db.add(Card(vekn_id=42, name="A", category=CardCategory.LIBRARY))
    db.flush()
    db.add(Card(vekn_id=42, name="B", category=CardCategory.LIBRARY))
    with pytest.raises(IntegrityError):
        db.flush()


def test_card_name_is_not_unique(db):
    """79 noms du catalogue VEKN sont partagés : `name` n'est qu'indexé."""
    db.add_all(
        [
            Card(vekn_id=1, name="Anarch Convert", category=CardCategory.CRYPT),
            Card(vekn_id=2, name="Anarch Convert", category=CardCategory.LIBRARY),
        ]
    )
    db.flush()


def test_card_name_is_indexed(db_engine):
    indexes = {ix["name"]: ix for ix in inspect(db_engine).get_indexes("card")}
    assert indexes["ix_card_name"]["column_names"] == ["name"]
    assert not indexes["ix_card_name"]["unique"]


def test_card_identity_triplet_is_indexed_but_not_unique(db):
    """(nom, groupe, advanced) identifie un vampire — sans l'imposer à l'import.

    Le triplet est unique sur les 1785 cartes de crypt de krcg, mais un doublon
    apparu chez eux ne doit pas faire échouer l'import : l'index n'est pas
    unique, et la base accepte donc la ligne en double.
    """
    indexes = {ix["name"]: ix for ix in inspect(db.get_bind()).get_indexes("card")}
    index = indexes["ix_card_name_group_code_advanced"]
    assert index["column_names"] == ["name", "group_code", "advanced"]
    assert not index["unique"]

    make_card(db, "Theo Bell", group_code="G2", advanced=False)
    make_card(db, "Theo Bell", group_code="G2", advanced=True)
    make_card(db, "Theo Bell", group_code="G6", advanced=False)
    make_card(db, "Theo Bell", group_code="G6", advanced=False)  # doublon toléré
    db.commit()
    assert db.query(Card).filter_by(name="Theo Bell").count() == 4


def test_card_legal_from_is_optional(db):
    """Aucune information = carte légale : la colonne est nullable."""
    card = make_card(db, "Neuve", legal_from=date(2026, 1, 1))
    other = make_card(db, "Ancienne")
    db.commit()
    assert card.legal_from == date(2026, 1, 1)
    assert other.legal_from is None


def test_card_printing_is_unique_per_card_and_set(db):
    """Une seule ligne par couple carte × extension.

    L'unicité ne porte plus sur une colonne nullable : elle est donc
    réellement appliquée, là où un `rarity` à NULL laissait passer autant de
    doublons qu'on voulait (SQLite tient deux NULL pour distincts). Les
    différentes façons d'obtenir la carte dans cette extension vivent
    maintenant dans `card_printing_occurrence`.
    """
    card = make_card(db)
    card_set = CardSet(abbrev="FN")
    other_set = CardSet(abbrev="CE")
    db.add_all([card_set, other_set])
    db.flush()
    db.add(CardPrinting(card_id=card.id, card_set_id=card_set.id))
    db.add(CardPrinting(card_id=card.id, card_set_id=other_set.id))
    db.flush()  # la même carte dans une autre extension est légitime
    db.add(CardPrinting(card_id=card.id, card_set_id=card_set.id))
    with pytest.raises(IntegrityError):
        db.flush()


def test_bundle_is_unique_per_set_and_code(db):
    """Le code d'un produit n'est unique qu'au sein de son extension.

    « PV » désigne un précon Ventrue dans plusieurs extensions, et 14
    extensions ont un précon au code vide : la chaîne vide, plutôt que NULL,
    garde la contrainte opérante.
    """
    first = CardSet(abbrev="SW")
    second = CardSet(abbrev="CE")
    db.add_all([first, second])
    db.flush()
    db.add(Bundle(card_set_id=first.id, code="PV", name="Ventrue antitribu"))
    db.add(Bundle(card_set_id=second.id, code="PV", name="Ventrue"))
    db.add(Bundle(card_set_id=first.id, code="", name="Précon sans code"))
    db.flush()
    db.add(Bundle(card_set_id=first.id, code="PV"))
    with pytest.raises(IntegrityError):
        db.flush()


def test_bundle_with_an_empty_code_still_collides_with_itself(db):
    """Deux précons sans code dans la même extension restent impossibles."""
    card_set = CardSet(abbrev="BSC")
    db.add(card_set)
    db.flush()
    db.add(Bundle(card_set_id=card_set.id, code=""))
    db.flush()
    db.add(Bundle(card_set_id=card_set.id, code=""))
    with pytest.raises(IntegrityError):
        db.flush()


@pytest.mark.parametrize(
    ("column", "value"),
    [
        pytest.param("copies", 0, id="copies-zero"),
        pytest.param("copies", -1, id="copies-negative"),
        pytest.param("multiplier", 0, id="multiplier-zero"),
        pytest.param("multiplier", -1.0, id="multiplier-negative"),
    ],
)
def test_printing_occurrence_check_rejects_out_of_range(db, column, value):
    card = make_card(db)
    card_set = CardSet(abbrev="FN")
    db.add(card_set)
    db.flush()
    printing = CardPrinting(card_id=card.id, card_set_id=card_set.id)
    db.add(printing)
    db.flush()
    db.add(
        CardPrintingOccurrence(
            card_printing_id=printing.id,
            occurrence_type=PrintOccurrence.PRECON,
            **{column: value},
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_printing_occurrence_accepts_the_three_shapes(db):
    """Booster, précon et promo n'utilisent pas les mêmes colonnes.

    Le demi-multiplicateur est réel : deux cartes n'apparaissent qu'une fois
    sur deux boosters.
    """
    card = make_card(db)
    card_set = CardSet(abbrev="FN")
    db.add(card_set)
    db.flush()
    bundle = Bundle(card_set_id=card_set.id, code="PS", name="Followers of Set")
    printing = CardPrinting(card_id=card.id, card_set_id=card_set.id)
    db.add_all([bundle, printing])
    db.flush()
    db.add_all(
        [
            CardPrintingOccurrence(
                card_printing_id=printing.id,
                occurrence_type=PrintOccurrence.RARITY,
                frequency="U",
                multiplier=0.5,
            ),
            CardPrintingOccurrence(
                card_printing_id=printing.id,
                occurrence_type=PrintOccurrence.PRECON,
                bundle_id=bundle.id,
                copies=2,
            ),
            CardPrintingOccurrence(
                card_printing_id=printing.id,
                occurrence_type=PrintOccurrence.SINGLE,
                released_on=date(2021, 3, 7),
            ),
        ]
    )
    db.commit()
    assert len(printing.occurrences) == 3
    assert [o.copies for o in bundle.card_occurrences] == [2]


def test_participation_player_is_unique_per_game(db):
    game, player = make_game(db), make_player(db)
    db.add(Participation(game_id=game.id, player_id=player.id))
    db.flush()
    db.add(Participation(game_id=game.id, player_id=player.id))
    with pytest.raises(IntegrityError):
        db.flush()


def test_participation_seat_is_unique_per_game(db):
    game = make_game(db)
    first, second = make_player(db, "A"), make_player(db, "B")
    db.add(Participation(game_id=game.id, player_id=first.id, seat=2))
    db.flush()
    db.add(Participation(game_id=game.id, player_id=second.id, seat=2))
    with pytest.raises(IntegrityError):
        db.flush()


def test_participation_same_seat_and_player_across_games_is_fine(db):
    first_game, second_game = make_game(db), make_game(db)
    player = make_player(db)
    db.add_all(
        [
            Participation(game_id=first_game.id, player_id=player.id, seat=2),
            Participation(game_id=second_game.id, player_id=player.id, seat=2),
        ]
    )
    db.flush()


def test_participation_seat_may_stay_unknown_for_several_players(db):
    """Le siège est facultatif : plusieurs `NULL` dans une partie sont légitimes."""
    game = make_game(db)
    db.add_all(
        [
            Participation(game_id=game.id, player_id=make_player(db, f"J{i}").id)
            for i in range(4)
        ]
    )
    db.flush()


# --------------------------------------------------------------------------
# Nullabilité
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "factory",
    [
        pytest.param(
            lambda: Card(vekn_id=1, category=CardCategory.CRYPT), id="card.name"
        ),
        pytest.param(
            lambda: Card(name="X", category=CardCategory.CRYPT), id="card.vekn_id"
        ),
        pytest.param(lambda: Card(vekn_id=1, name="X"), id="card.category"),
        pytest.param(lambda: Deck(discriminator="0001"), id="deck.name"),
        pytest.param(lambda: Deck(name="X"), id="deck.discriminator"),
        pytest.param(lambda: Player(), id="player.name"),
        pytest.param(lambda: Language(code="ZZ"), id="language.label"),
        pytest.param(lambda: Venue(), id="venue.name"),
        pytest.param(lambda: Tournament(name="X"), id="tournament.start_date"),
        pytest.param(
            lambda: Tournament(start_date=date(2026, 1, 1)), id="tournament.name"
        ),
        pytest.param(lambda: Game(player_count=4), id="game.played_at"),
        pytest.param(
            lambda: Game(played_at=datetime(2026, 1, 1)), id="game.player_count"
        ),
        pytest.param(
            lambda: CardTranslation(card_id=1, language_code="EN"),
            id="translation.name",
        ),
    ],
)
def test_required_columns_reject_null(db, factory):
    add_languages(db)
    make_card(db)  # fournit un card_id valide pour les cas qui en ont besoin
    db.add(factory())
    with pytest.raises(IntegrityError) as excinfo:
        db.flush()
    assert "NOT NULL" in str(excinfo.value)


def test_participation_requires_game_and_player(db):
    game, player = make_game(db), make_player(db)
    db.add(Participation(player_id=player.id))
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()
    game, player = make_game(db), make_player(db)
    db.add(Participation(game_id=game.id))
    with pytest.raises(IntegrityError):
        db.flush()


def test_adversary_participation_may_be_almost_empty(db):
    """§11.3 : pour un adversaire, ni deck, ni VP, ni GW, ni siège."""
    game, player = make_game(db), make_player(db, "Adversaire")
    participation = Participation(game_id=game.id, player_id=player.id)
    db.add(participation)
    db.commit()
    db.refresh(participation)
    assert participation.deck_id is None
    assert participation.victory_points is None
    assert participation.game_win is None
    assert participation.seat is None


def test_game_and_tournament_optional_columns_accept_null(db):
    tournament = make_tournament(db)
    game = make_game(db)
    db.commit()
    assert tournament.end_date is None and tournament.venue_id is None
    assert tournament.round_count is None and tournament.my_ranking is None
    assert game.tournament_id is None and game.round_number is None


# --------------------------------------------------------------------------
# Clés étrangères simples
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "factory",
    [
        pytest.param(
            lambda: Game(
                played_at=datetime(2026, 1, 1), player_count=4, tournament_id=999
            ),
            id="game.tournament_id",
        ),
        pytest.param(
            lambda: Game(played_at=datetime(2026, 1, 1), player_count=4, venue_id=999),
            id="game.venue_id",
        ),
        pytest.param(
            lambda: Tournament(name="X", start_date=date(2026, 1, 1), venue_id=999),
            id="tournament.venue_id",
        ),
        pytest.param(
            lambda: Card(vekn_id=1, name="X", category=CardCategory.CRYPT, clan_id=999),
            id="card.clan_id",
        ),
        pytest.param(
            lambda: Card(vekn_id=1, name="X", category=CardCategory.CRYPT, sect_id=999),
            id="card.sect_id",
        ),
        pytest.param(
            lambda: CardTypeLink(card_id=999, card_type_id=999), id="card_type_link"
        ),
        pytest.param(
            lambda: CardDisciplineLink(card_id=999, discipline_id=999),
            id="card_discipline_link",
        ),
        pytest.param(
            lambda: CardPrinting(card_id=999, card_set_id=999), id="card_printing"
        ),
        pytest.param(
            lambda: CardTranslation(card_id=999, language_code="EN", name="X"),
            id="card_translation",
        ),
    ],
)
def test_dangling_foreign_keys_are_rejected(db, factory):
    add_languages(db)
    db.add(factory())
    with pytest.raises(IntegrityError):
        db.flush()


@pytest.mark.parametrize("missing", ["game_id", "player_id", "deck_id"])
def test_participation_foreign_keys_are_rejected_when_dangling(db, missing):
    game, player = make_game(db), make_player(db)
    ids = {"game_id": game.id, "player_id": player.id, "deck_id": None}
    ids[missing] = 999
    db.add(Participation(**ids))
    with pytest.raises(IntegrityError):
        db.flush()


def test_card_translation_requires_existing_language(db):
    add_languages(db, "EN")
    card = make_card(db)
    db.add(CardTranslation(card_id=card.id, language_code="FR", name="Nom"))
    with pytest.raises(IntegrityError):
        db.flush()


def test_card_translation_is_unique_per_card_and_language(db):
    add_languages(db)
    card = make_card(db)
    db.add(CardTranslation(card_id=card.id, language_code="FR", name="Un"))
    db.flush()
    db.add(CardTranslation(card_id=card.id, language_code="FR", name="Deux"))
    with pytest.raises(IntegrityError):
        db.flush()


def test_link_tables_reject_duplicates(db):
    card = make_card(db)
    card_type, discipline = CardType(name="Action"), Discipline(name="Dominate")
    db.add_all([card_type, discipline])
    db.flush()
    db.add_all(
        [
            CardTypeLink(card_id=card.id, card_type_id=card_type.id),
            CardDisciplineLink(card_id=card.id, discipline_id=discipline.id),
        ]
    )
    db.flush()
    db.expunge_all()
    db.add(CardTypeLink(card_id=card.id, card_type_id=card_type.id))
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()
    db.add(CardDisciplineLink(card_id=card.id, discipline_id=discipline.id))
    with pytest.raises(IntegrityError):
        db.flush()
