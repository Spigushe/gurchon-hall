"""Valeurs par défaut, horodatage et conventions de nommage du modèle."""

import time
from datetime import UTC, date, datetime, timedelta, timezone

import pytest
from sqlalchemy import (
    CheckConstraint,
    ForeignKeyConstraint,
    PrimaryKeyConstraint,
    UniqueConstraint,
    inspect,
)

from app.models import (
    Base,
    CardCategory,
    CardCopy,
    CostType,
    DeckCard,
    DeckPolicy,
    DeckStatus,
    DeletedDeckCard,
    Language,
    Participation,
    Player,
    RoundType,
    TournamentFormat,
)
from tests.helpers import (
    add_languages,
    make_card,
    make_copy,
    make_deck,
    make_game,
    make_player,
    make_tournament,
)

# --------------------------------------------------------------------------
# Valeurs par défaut posées par le modèle
# --------------------------------------------------------------------------


def test_deck_defaults_to_draft(db):
    deck = make_deck(db)
    db.commit()
    assert deck.status is DeckStatus.DRAFT


def test_deck_is_neither_archived_nor_deleted_by_default(db):
    deck = make_deck(db)
    db.commit()
    db.refresh(deck)
    assert deck.archived_at is None
    assert deck.deleted_at is None


def test_tournament_defaults_to_mono_deck_and_constructed(db):
    tournament = make_tournament(db)
    db.commit()
    assert tournament.deck_policy is DeckPolicy.MONO
    assert tournament.format is TournamentFormat.CONSTRUCTED


def test_game_defaults_to_casual_round(db):
    game = make_game(db)
    db.commit()
    assert game.round_type is RoundType.CASUAL


def test_card_boolean_defaults_are_false(db):
    card = make_card(db)
    db.commit()
    assert card.advanced is False
    assert card.burn_option is False


def test_card_copy_defaults_to_nothing_owned_and_no_proxy(db):
    add_languages(db)
    card = make_card(db)
    copy = CardCopy(card_id=card.id, language_code="EN")
    db.add(copy)
    db.commit()
    assert copy.quantity_owned == 0
    assert copy.proxy_allowed is False


def test_deck_card_defaults_to_one_copy_without_proxy(db):
    add_languages(db)
    card = make_card(db)
    make_copy(db, card, "EN", quantity_owned=1)
    deck = make_deck(db)
    line = DeckCard(deck_id=deck.id, card_id=card.id, language_code="EN")
    db.add(line)
    db.commit()
    assert (line.quantity, line.proxy_quantity) == (1, 0)


def test_deleted_deck_card_has_the_same_defaults(db):
    """La decklist figée est une copie : mêmes valeurs par défaut."""
    add_languages(db)
    card = make_card(db)
    deck = make_deck(db, deleted_at=datetime(2026, 1, 1))
    line = DeletedDeckCard(deck_id=deck.id, card_id=card.id, language_code="EN")
    db.add(line)
    db.commit()
    assert (line.quantity, line.proxy_quantity) == (1, 0)


def test_player_is_not_me_by_default(db):
    player = Player(name="Quelqu'un")
    db.add(player)
    db.commit()
    assert player.is_me is False


def test_language_sort_order_defaults_to_zero(db):
    db.add(Language(code="DE", label="Allemand"))
    db.commit()
    assert db.get(Language, "DE").sort_order == 0


def test_participation_results_default_to_unknown(db):
    game, player = make_game(db), make_player(db)
    participation = Participation(game_id=game.id, player_id=player.id)
    db.add(participation)
    db.commit()
    assert participation.game_win is None
    assert participation.victory_points is None


# --------------------------------------------------------------------------
# Horodatage (TimestampMixin : deck, tournoi, partie)
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "factory",
    [
        pytest.param(make_deck, id="deck"),
        pytest.param(make_tournament, id="tournament"),
        pytest.param(make_game, id="game"),
    ],
)
def test_user_entities_are_timestamped_on_insert(db, factory):
    entity = factory(db)
    db.commit()
    assert isinstance(entity.created_at, datetime)
    assert isinstance(entity.updated_at, datetime)
    now = datetime.now(UTC).replace(tzinfo=None)
    assert abs(entity.created_at - now) < timedelta(minutes=1)


@pytest.mark.parametrize(
    ("factory", "field", "value"),
    [
        pytest.param(make_deck, "notes", "modifié", id="deck"),
        pytest.param(make_tournament, "notes", "modifié", id="tournament"),
        pytest.param(make_game, "notes", "modifié", id="game"),
    ],
)
def test_updated_at_moves_on_update_but_created_at_does_not(db, factory, field, value):
    entity = factory(db)
    db.commit()
    created, updated = entity.created_at, entity.updated_at

    time.sleep(0.01)
    setattr(entity, field, value)
    db.commit()
    db.refresh(entity)

    assert entity.created_at == created
    assert entity.updated_at > updated


def test_catalogue_and_collection_tables_are_not_timestamped(db_engine):
    """Le catalogue est un import reproductible : pas d'audit ligne à ligne."""
    inspector = inspect(db_engine)
    for table in (
        "card",
        "card_copy",
        "deck_card",
        "deleted_deck_card",
        "participation",
        "player",
    ):
        names = {column["name"] for column in inspector.get_columns(table)}
        assert not names & {"created_at", "updated_at"}, table


def test_game_played_at_preserves_the_instant_across_timezones(db):
    """Contrat tranché au Lot 1 : les colonnes date-heure contiennent de l'UTC
    naïf, et un instant *aware* est converti à l'écriture (`UtcDateTime`).
    14:00+02:00 est donc stocké 12:00 et relu comme le même instant."""
    paris = timezone(timedelta(hours=2))
    sent = datetime(2026, 2, 1, 14, 0, tzinfo=paris)
    game = make_game(db, played_at=sent)
    db.commit()
    db.expire_all()
    read_back = game.played_at
    assert read_back.tzinfo is None, "le stockage est de l'UTC naïf"
    assert read_back == datetime(2026, 2, 1, 12, 0)
    assert read_back.replace(tzinfo=UTC) == sent


def test_game_played_at_roundtrips_a_naive_datetime(db):
    """Une valeur naïve est déjà de l'UTC par convention : aucun décalage."""
    sent = datetime(2026, 2, 1, 14, 30, 15)
    game = make_game(db, played_at=sent)
    db.commit()
    db.expire_all()
    assert game.played_at == sent


def test_date_columns_roundtrip(db):
    tournament = make_tournament(
        db, start_date=date(2026, 3, 14), end_date=date(2026, 3, 15)
    )
    db.commit()
    db.expire_all()
    assert (tournament.start_date, tournament.end_date) == (
        date(2026, 3, 14),
        date(2026, 3, 15),
    )


def test_victory_points_keep_half_points(db):
    game, player = make_game(db), make_player(db)
    participation = Participation(
        game_id=game.id, player_id=player.id, victory_points=2.5
    )
    db.add(participation)
    db.commit()
    db.expire_all()
    assert participation.victory_points == 2.5


def test_library_cost_keeps_variable_cost_x(db):
    """Le montant du coût est textuel pour ne pas perdre les « X » du catalogue.

    krcg ne donne qu'un coût par carte (`{"type": ..., "value": ...}`) : le
    type et la valeur vivent donc dans deux colonnes, pas trois colonnes par
    type de coût.
    """
    card = make_card(
        db,
        "Blood Rage",
        category=CardCategory.LIBRARY,
        cost_type=CostType.BLOOD,
        cost_value="X",
    )
    db.commit()
    db.expire_all()
    assert (card.cost_type, card.cost_value) == (CostType.BLOOD, "X")


def test_library_flags_default_to_false(db):
    """`burn_option` et `trifle` sont des marqueurs, jamais nuls."""
    card = make_card(db, "Villein", category=CardCategory.LIBRARY)
    db.commit()
    db.expire_all()
    assert card.burn_option is False and card.trifle is False
    assert card.cost_type is None and card.cost_value is None


# --------------------------------------------------------------------------
# Convention de nommage des contraintes (nécessaire au mode batch d'Alembic)
# --------------------------------------------------------------------------

PREFIXES = {
    PrimaryKeyConstraint: "pk_",
    ForeignKeyConstraint: "fk_",
    UniqueConstraint: "uq_",
    CheckConstraint: "ck_",
}


def named_constraints():
    for table in Base.metadata.sorted_tables:
        for constraint in table.constraints:
            yield table, constraint


def test_every_constraint_has_a_name_with_the_expected_prefix():
    for table, constraint in named_constraints():
        prefix = PREFIXES[type(constraint)]
        assert constraint.name, f"{table.name}: contrainte anonyme {constraint!r}"
        assert str(constraint.name).startswith(prefix + table.name), (
            f"{table.name}: {constraint.name}"
        )


def test_every_index_has_a_name():
    for table in Base.metadata.sorted_tables:
        for index in table.indexes:
            assert index.name, f"{table.name}: index anonyme"


def test_model_registry_covers_twenty_two_tables():
    """Filet : le modèle décrit 22 tables, ni plus ni moins."""
    assert len(Base.metadata.tables) == 22
    assert set(Base.metadata.tables) == {
        "language",
        "clan",
        "discipline",
        "sect",
        "card_type",
        "card_set",
        "bundle",
        "venue",
        "card",
        "card_type_link",
        "card_discipline_link",
        "card_printing",
        "card_printing_occurrence",
        "card_translation",
        "card_copy",
        "deck",
        "deck_card",
        "deleted_deck_card",
        "player",
        "tournament",
        "game",
        "participation",
    }
