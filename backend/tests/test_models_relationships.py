"""Relations ORM, cascades et suppressions.

Deux niveaux à distinguer, car ils ne racontent pas la même chose :

* la cascade **ORM** (`cascade="all, delete-orphan"`), qui agit quand on passe
  par `session.delete(...)` ;
* la cascade **base** (`ON DELETE CASCADE`), qui agit même en SQL brut, ce qui
  compte pour les futures migrations de données et pour le rejeu de `/sync`.

Là où le modèle ne définit aucune cascade (`RESTRICT` par défaut), on vérifie
que la base refuse la suppression d'une ligne encore référencée.
"""

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.models import (
    Card,
    CardCopy,
    CardDisciplineLink,
    CardPrinting,
    CardSet,
    CardTranslation,
    CardType,
    CardTypeLink,
    Clan,
    Deck,
    DeckCard,
    Discipline,
    Game,
    Language,
    Participation,
    Player,
    Tournament,
    Venue,
)
from tests.helpers import (
    add_languages,
    make_card,
    make_deck,
    make_game,
    make_player,
    make_tournament,
)


def count(db, model) -> int:
    return db.scalar(select(func.count()).select_from(model))


# --------------------------------------------------------------------------
# Relations bidirectionnelles
# --------------------------------------------------------------------------


def test_deck_cards_and_deck_card_deck_are_mirrors(db, world):
    assert world.deck.cards == [world.deck_card]
    assert world.deck_card.deck is world.deck


def test_card_copy_deck_allocations_and_deck_card_card_copy_are_mirrors(db, world):
    assert world.copy_en.deck_allocations == [world.deck_card]
    assert world.deck_card.card_copy is world.copy_en
    # La copie FR n'est allouée à aucun deck.
    assert world.copy_fr.deck_allocations == []


def test_game_participations_and_participation_game_are_mirrors(db, world):
    assert sorted(p.id for p in world.game.participations) == sorted(
        [world.mine.id, world.theirs.id]
    )
    assert world.mine.game is world.game


def test_tournament_games_and_game_tournament_are_mirrors(db, world):
    assert world.tournament.games == [world.game]
    assert world.game.tournament is world.tournament


@pytest.mark.parametrize(
    ("collection", "child_attr"),
    [
        ("type_links", "card_type"),
        ("discipline_links", "discipline"),
        ("printings", "card_set"),
        ("translations", "language"),
    ],
)
def test_card_child_collections_point_back_to_the_card(
    db, world, collection, child_attr
):
    children = getattr(world.card, collection)
    assert len(children) == 1
    assert children[0].card is world.card
    assert getattr(children[0], child_attr) is not None


def test_in_memory_append_sets_the_other_side_before_flush(db, world):
    """Le `back_populates` synchronise les deux côtés sans passer par la base."""
    other = make_deck(db, "Autre deck")
    line = DeckCard(card_id=world.card.id, language_code="EN", quantity=1)
    other.cards.append(line)
    assert line.deck is other
    db.flush()
    assert line.deck_id == other.id


def test_new_participation_is_appended_to_game_collection(db, world):
    extra = make_player(db, "Troisième")
    assert len(world.game.participations) == 2  # charge la collection
    participation = Participation(player=extra, game=world.game, seat=5)
    assert participation in world.game.participations
    db.add(participation)  # SQLAlchemy 2.0 : le backref n'ajoute plus à la session
    db.commit()
    assert count(db, Participation) == 3


def test_read_only_shortcuts_resolve_through_link_tables(db, world):
    """`Card.types`, `Card.disciplines` et `DeckCard.card` sont en lecture seule."""
    assert [t.name for t in world.card.types] == ["Action"]
    assert [d.name for d in world.card.disciplines] == ["Dominate"]
    assert world.deck_card.card is world.card


def test_card_relations_load_clan_and_sect(db, world):
    assert world.card.clan.name == "Ventrue"
    assert world.card.sect.name == "Camarilla"


def test_participation_relations(db, world):
    assert world.mine.player is world.me
    assert world.mine.deck is world.deck
    assert world.theirs.deck is None


def test_card_copy_relations_load_card_and_language(db, world):
    assert world.copy_fr.card is world.card
    assert world.copy_fr.language.code == "FR"


def test_venue_is_reachable_from_game_and_tournament(db, world):
    assert world.game.venue is world.venue
    assert world.tournament.venue is world.venue


# --------------------------------------------------------------------------
# Cascade ORM : deck -> deck_card, game -> participation, card -> enfants
# --------------------------------------------------------------------------


def test_deleting_a_deck_deletes_its_lines_but_not_the_collection(db, world):
    """Le deck ne consomme la collection qu'en l'empruntant : elle survit."""
    # Le deck est référencé par une participation ; on la détache d'abord.
    world.mine.deck_id = None
    db.flush()

    db.delete(world.deck)
    db.commit()

    assert count(db, Deck) == 0
    assert count(db, DeckCard) == 0
    assert count(db, CardCopy) == 2
    assert count(db, Card) == 1


def test_removing_a_line_from_a_deck_deletes_the_row(db, world):
    """`delete-orphan` : sortir la ligne de `deck.cards` la supprime."""
    world.deck.cards.remove(world.deck_card)
    db.commit()
    assert count(db, DeckCard) == 0
    assert count(db, CardCopy) == 2


def test_deleting_a_game_deletes_its_participations(db, world):
    db.delete(world.game)
    db.commit()
    assert count(db, Game) == 0
    assert count(db, Participation) == 0
    # Joueurs, deck et tournoi ne sont pas touchés.
    assert count(db, Player) == 2
    assert count(db, Deck) == 1
    assert count(db, Tournament) == 1


def test_removing_a_participation_from_a_game_deletes_the_row(db, world):
    world.game.participations.remove(world.theirs)
    db.commit()
    assert count(db, Participation) == 1


def test_deleting_a_card_deletes_catalogue_children(db, world):
    """Types, disciplines, impressions et traductions suivent la carte.

    La carte de `world` est en collection : on retire d'abord ses copies et le
    deck qui les alloue (la suppression d'une carte possédée est refusée, cf.
    plus bas).
    """
    world.mine.deck_id = None
    db.flush()
    db.delete(world.deck)
    db.flush()
    db.delete(world.copy_en)
    db.delete(world.copy_fr)
    db.flush()

    db.delete(world.card)
    db.commit()

    assert count(db, Card) == 0
    for model in (CardTypeLink, CardDisciplineLink, CardPrinting, CardTranslation):
        assert count(db, model) == 0
    # Les tables de référence ne sont pas des enfants de la carte.
    for model in (CardType, Discipline, CardSet, Clan, Language):
        assert count(db, model) >= 1


# --------------------------------------------------------------------------
# Cascade base (ON DELETE CASCADE), en SQL brut
# --------------------------------------------------------------------------


def test_database_cascades_deck_delete_to_deck_card(db, world):
    db.execute(text("UPDATE participation SET deck_id = NULL"))
    db.execute(text("DELETE FROM deck WHERE id = :id"), {"id": world.deck.id})
    assert db.execute(text("SELECT COUNT(*) FROM deck_card")).scalar() == 0
    assert db.execute(text("SELECT COUNT(*) FROM card_copy")).scalar() == 2


def test_database_cascades_game_delete_to_participation(db, world):
    db.execute(text("DELETE FROM game WHERE id = :id"), {"id": world.game.id})
    assert db.execute(text("SELECT COUNT(*) FROM participation")).scalar() == 0
    assert db.execute(text("SELECT COUNT(*) FROM player")).scalar() == 2


def test_database_cascades_card_delete_to_catalogue_children(db):
    add_languages(db)
    card = make_card(db)
    card_type, discipline, card_set = (
        CardType(name="Action"),
        Discipline(name="Dominate"),
        CardSet(abbrev="FN"),
    )
    db.add_all([card_type, discipline, card_set])
    db.flush()
    db.add_all(
        [
            CardTypeLink(card_id=card.id, card_type_id=card_type.id),
            CardDisciplineLink(card_id=card.id, discipline_id=discipline.id),
            CardPrinting(card_id=card.id, card_set_id=card_set.id),
            CardTranslation(card_id=card.id, language_code="FR", name="Nom"),
        ]
    )
    db.commit()

    db.execute(text("DELETE FROM card WHERE id = :id"), {"id": card.id})

    for table in (
        "card_type_link",
        "card_discipline_link",
        "card_printing",
        "card_translation",
    ):
        assert db.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar() == 0
    # Les lignes de référence, elles, restent.
    assert db.execute(text("SELECT COUNT(*) FROM card_type")).scalar() == 1


# --------------------------------------------------------------------------
# Pas de cascade : la base refuse de supprimer ce qui est encore référencé
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("sql", "why"),
    [
        pytest.param(
            "DELETE FROM card_copy WHERE language_code = 'EN'",
            "exemplaire alloué à un deck",
            id="card_copy-used-by-deck_card",
        ),
        pytest.param(
            "DELETE FROM card", "carte présente en collection", id="card-in-collection"
        ),
        pytest.param("DELETE FROM deck", "deck joué dans une partie", id="deck-played"),
        pytest.param(
            "DELETE FROM player WHERE is_me = 1",
            "joueur ayant participé",
            id="player-with-participation",
        ),
        pytest.param(
            "DELETE FROM tournament",
            "tournoi qui contient des parties",
            id="tournament-with-games",
        ),
        pytest.param("DELETE FROM venue", "lieu utilisé", id="venue-in-use"),
        pytest.param(
            "DELETE FROM clan", "clan utilisé par une carte", id="clan-in-use"
        ),
        pytest.param("DELETE FROM sect", "sect utilisée", id="sect-in-use"),
        pytest.param(
            "DELETE FROM language WHERE code = 'EN'",
            "langue utilisée par la collection",
            id="language-in-use",
        ),
        pytest.param(
            "DELETE FROM card_type", "type porté par une carte", id="card_type-in-use"
        ),
        pytest.param(
            "DELETE FROM discipline", "discipline liée", id="discipline-in-use"
        ),
        pytest.param(
            "DELETE FROM card_set", "extension imprimée", id="card_set-in-use"
        ),
    ],
)
def test_referenced_rows_cannot_be_deleted(db, world, sql, why):
    with pytest.raises(IntegrityError):
        db.execute(text(sql))


def test_orm_delete_of_an_allocated_card_copy_does_not_go_through(db, world):
    """Supprimer via l'ORM une copie encore allouée à un deck échoue.

    `CardCopy.deck_allocations` est déclarée `passive_deletes="all"` : l'ORM
    n'essaie pas de réécrire `deck_card` avant le DELETE et laisse la base
    trancher. On obtient donc la même `IntegrityError` qu'en SQL brut.
    """
    db.delete(world.copy_en)
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()
    assert count(db, CardCopy) == 2
    assert count(db, DeckCard) == 1


def test_deleting_a_card_copy_that_is_not_allocated_is_fine(db, world):
    """L'exemplaire FR (proxy autorisé, 0 possédé) n'est dans aucun deck."""
    db.delete(world.copy_fr)
    db.commit()
    assert count(db, CardCopy) == 1


def test_orm_delete_of_a_tournament_with_games_does_not_go_through(db, world):
    """Même règle côté tournoi : la base refuse, l'ORM ne détache pas.

    Sans `passive_deletes="all"`, l'ORM aurait mis `game.tournament_id` à NULL
    et la suppression aurait « réussi » en faisant disparaître la ronde et le
    rattachement des parties.
    """
    db.delete(world.tournament)
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()
    assert count(db, Tournament) == 1
    assert world.game.tournament_id == world.tournament.id


def test_deleting_a_tournament_without_games_is_fine(db):
    tournament = make_tournament(db)
    db.delete(tournament)
    db.commit()
    assert count(db, Tournament) == 0


def test_deleting_a_venue_that_nothing_references_is_fine(db):
    venue = Venue(name="Vide")
    db.add(venue)
    db.flush()
    db.delete(venue)
    db.commit()


# --------------------------------------------------------------------------
# Un tournoi, ses parties, mes decks
# --------------------------------------------------------------------------


def test_game_can_exist_outside_any_tournament(db):
    game = make_game(db)
    db.commit()
    assert game.tournament is None


def test_tournament_collects_several_games_in_round_order(db):
    tournament = make_tournament(db)
    for round_number in (1, 2, 3):
        make_game(db, tournament_id=tournament.id, round_number=round_number)
    db.commit()
    db.refresh(tournament)
    assert sorted(g.round_number for g in tournament.games) == [1, 2, 3]


def test_one_player_can_sit_at_many_games_with_different_decks(db):
    """Le schéma laisse le deck libre d'une partie à l'autre.

    (La contrainte mono-deck d'un tournoi est une règle de service, Lot 2.)
    """
    me = make_player(db, "Moi", is_me=True)
    first, second = make_deck(db, "Un"), make_deck(db, "Deux")
    for game_deck in (first, second):
        game = make_game(db)
        db.add(Participation(game_id=game.id, player_id=me.id, deck_id=game_deck.id))
    db.commit()
    assert count(db, Participation) == 2


def test_full_table_of_five_can_be_recorded(db):
    game = make_game(db, player_count=5)
    for seat in range(1, 6):
        db.add(
            Participation(
                game_id=game.id, player_id=make_player(db, f"J{seat}").id, seat=seat
            )
        )
    db.commit()
    db.refresh(game)
    assert sorted(p.seat for p in game.participations) == [1, 2, 3, 4, 5]
