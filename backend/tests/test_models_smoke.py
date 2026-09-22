"""Test de fumée du modèle de données (Lot 1).

Objectif volontairement modeste : monter tout le schéma sur une base SQLite en
mémoire et insérer une ligne dans chacune des tables, pour attraper tôt une
incohérence de modèle (clé étrangère qui ne tombe pas en face, contrainte
impossible à satisfaire, relation mal orientée). La suite de tests réelle —
règles métier, cas limites, validation de deck — est du ressort de `qa-tests`
et du Lot 2.

Deux vérifications dépassent l'insertion nue, parce qu'elles portent sur les
décisions de CLAUDE.md §11 que ce lot devait trancher :

* une carte absente de la collection ne peut pas entrer dans un deck ;
* la même carte peut entrer dans un deck en deux langues différentes.
"""

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import create_app_engine
from app.models import (
    Base,
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
    Deck,
    DeckCard,
    DeckPolicy,
    DeckStatus,
    DeletedDeckCard,
    Discipline,
    Game,
    Language,
    Participation,
    Player,
    PrintOccurrence,
    RoundType,
    Sect,
    SyncOperation,
    SyncOperationStatus,
    SyncOperationType,
    SyncResourceKind,
    Tournament,
    TournamentFormat,
    Venue,
)


@pytest.fixture
def session():
    """Session sur une base en mémoire, schéma créé depuis les métadonnées.

    Passe par `create_app_engine` et non `create_engine` directement, pour
    hériter du `PRAGMA foreign_keys = ON` : sans lui SQLite ignore les clés
    étrangères et le test ne prouverait rien.
    """
    engine = create_app_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db_session:
        yield db_session
    engine.dispose()


@pytest.fixture
def seeded(session):
    """Une ligne dans chaque table, reliées entre elles."""
    language_en = Language(code="EN", label="Anglais", sort_order=10)
    language_fr = Language(code="FR", label="Français", sort_order=20)
    clan = Clan(name="Ventrue", abbrev="VEN")
    sect = Sect(name="Camarilla")
    discipline = Discipline(name="Dominate", abbrev="dom")
    card_type = CardType(name="Action")
    card_set = CardSet(
        abbrev="FN",
        full_name="Final Nights",
        release_date=date(2001, 6, 11),
        company="White Wolf",
    )
    venue = Venue(name="Club de test", city="Nantes")
    session.add_all(
        [language_en, language_fr, clan, sect, discipline, card_type, card_set, venue]
    )
    session.flush()

    card = Card(
        vekn_id=200001,
        name="Aabbt Kindred",
        category=CardCategory.CRYPT,
        clan=clan,
        sect=sect,
        capacity=4,
        group_code="G2",
        card_text="Independent.",
        image_url="https://static.krcg.org/card/aabbtkindredg2.jpg",
    )
    session.add(card)
    session.flush()

    bundle = Bundle(
        card_set_id=card_set.id, code="PS", name="Followers of Set", size=89
    )
    printing = CardPrinting(card_id=card.id, card_set_id=card_set.id)
    session.add_all([bundle, printing])
    session.flush()

    session.add_all(
        [
            CardTypeLink(card_id=card.id, card_type_id=card_type.id),
            CardDisciplineLink(
                card_id=card.id, discipline_id=discipline.id, superior=True
            ),
            CardPrintingOccurrence(
                card_printing_id=printing.id,
                occurrence_type=PrintOccurrence.PRECON,
                bundle_id=bundle.id,
                copies=2,
            ),
            CardTranslation(
                card_id=card.id, language_code="FR", name="Parenté Aabbt"
            ),
            CardCopy(
                card_id=card.id,
                language_code="EN",
                quantity_owned=4,
                proxy_allowed=False,
            ),
            # Cas proxy : rien en stock, mais le proxy est autorisé.
            CardCopy(
                card_id=card.id,
                language_code="FR",
                quantity_owned=0,
                proxy_allowed=True,
            ),
        ]
    )

    deck = Deck(
        name="Ventrue Grinder",
        discriminator="8561",
        created_on=date(2026, 1, 15),
        status=DeckStatus.ACTIVE,
        archetype="Vote",
    )
    # Un deck supprimé, dont la decklist a été figée : c'est la seule façon
    # d'avoir une ligne dans `deleted_deck_card`.
    gone = Deck(
        name="Ventrue Grinder",
        discriminator="0042",
        status=DeckStatus.DRAFT,
        archived_at=datetime(2026, 1, 20, tzinfo=UTC),
        deleted_at=datetime(2026, 1, 21, tzinfo=UTC),
    )
    player = Player(name="Moi", is_me=True)
    tournament = Tournament(
        name="Tournoi de test",
        start_date=date(2026, 2, 1),
        deck_policy=DeckPolicy.MONO,
        format=TournamentFormat.CONSTRUCTED,
        venue=venue,
        round_count=2,
    )
    session.add_all([deck, gone, player, tournament])
    session.flush()

    session.add_all(
        [
            DeckCard(
                deck_id=deck.id,
                card_id=card.id,
                language_code="EN",
                quantity=4,
                proxy_quantity=0,
            ),
            DeletedDeckCard(
                deck_id=gone.id,
                card_id=card.id,
                language_code="EN",
                quantity=4,
                proxy_quantity=0,
            ),
        ]
    )

    game = Game(
        played_at=datetime(2026, 2, 1, 14, 0, tzinfo=UTC),
        venue=venue,
        tournament=tournament,
        round_number=1,
        round_type=RoundType.PRELIMINARY,
        player_count=5,
    )
    session.add(game)
    session.flush()

    session.add(
        Participation(
            game_id=game.id,
            player_id=player.id,
            deck_id=deck.id,
            seat=3,
            victory_points=2.5,
            game_win=True,
        )
    )

    # Journal de la file hors ligne (Lot 3) : la création du deck ci-dessus,
    # telle qu'elle serait revenue d'un `POST /sync`. Aucune clé étrangère —
    # `deck_id` n'est qu'un identifiant recopié.
    session.add(
        SyncOperation(
            operation_id="0f8f8b8e-1111-4222-8333-444444444444",
            batch_id="6f1d2a4e-0e9e-4a1a-9a0f-2f7b3c4d5e6f",
            operation_type=SyncOperationType.DECK_CREATE,
            request_hash="a" * 64,
            status=SyncOperationStatus.APPLIED,
            client_ref="ref-ventrue-grinder",
            resource_kind=SyncResourceKind.DECK,
            deck_id=deck.id,
            recorded_at=datetime(2026, 2, 1, 19, 0, tzinfo=UTC),
        )
    )
    session.commit()
    return {"card": card, "deck": deck, "game": game, "player": player}


def test_every_table_accepts_a_row(session, seeded):
    """Toutes les tables du modèle contiennent au moins une ligne."""
    empty = [
        table.name
        for table in Base.metadata.sorted_tables
        if session.execute(select(table).limit(1)).first() is None
    ]
    assert empty == []


def test_metadata_creates_on_a_blank_database():
    """`create_all` passe sur une base vierge, sans dépendance d'ordre."""
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    engine.dispose()


def test_deck_card_requires_a_collection_entry(session, seeded):
    """Une carte hors collection ne peut pas entrer dans un deck (§11 point 2).

    La carte existe au catalogue et la langue aussi, mais aucun exemplaire
    espagnol n'est déclaré : la clé étrangère composite vers `card_copy` doit
    refuser la ligne.
    """
    session.add(Language(code="ES", label="Espagnol", sort_order=30))
    session.commit()

    session.add(
        DeckCard(
            deck_id=seeded["deck"].id,
            card_id=seeded["card"].id,
            language_code="ES",
            quantity=1,
        )
    )
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


def test_deck_mixes_languages_for_the_same_card(session, seeded):
    """Un même deck accepte la même carte en plusieurs langues (§11 point 4)."""
    session.add(
        DeckCard(
            deck_id=seeded["deck"].id,
            card_id=seeded["card"].id,
            language_code="FR",
            quantity=2,
            proxy_quantity=2,
        )
    )
    session.commit()

    lines = session.scalars(
        select(DeckCard).where(DeckCard.deck_id == seeded["deck"].id)
    ).all()
    assert sorted(line.language_code for line in lines) == ["EN", "FR"]
    assert sum(line.quantity for line in lines) == 6
