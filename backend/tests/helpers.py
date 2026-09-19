"""Fabriques de données partagées par les tests de modèles et de schémas.

Ce ne sont pas des fixtures : des fonctions simples, appelables avec des
valeurs explicites quand un test veut contrôler un champ précis.
"""

from datetime import date, datetime
from itertools import count
from types import SimpleNamespace

from sqlalchemy.orm import Session

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
    Deck,
    DeckCard,
    DeckPolicy,
    DeckStatus,
    Discipline,
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

_vekn_ids = count(100_000)


def add_languages(session: Session, *codes: str) -> None:
    """Insère des langues (par défaut EN et FR), comme le ferait la migration."""
    labels = {"EN": "Anglais", "FR": "Français", "ES": "Espagnol", "XX": "Autre"}
    for order, code in enumerate(codes or ("EN", "FR"), start=1):
        session.add(Language(code=code, label=labels.get(code, code), sort_order=order))
    session.flush()


def make_card(
    session: Session,
    name: str = "Aabbt Kindred",
    category: CardCategory = CardCategory.CRYPT,
    **fields,
) -> Card:
    """Une carte du catalogue, `vekn_id` unique généré."""
    card = Card(vekn_id=next(_vekn_ids), name=name, category=category, **fields)
    session.add(card)
    session.flush()
    return card


def make_copy(
    session: Session,
    card: Card,
    language_code: str = "EN",
    quantity_owned: int = 1,
    proxy_allowed: bool = False,
) -> CardCopy:
    copy = CardCopy(
        card_id=card.id,
        language_code=language_code,
        quantity_owned=quantity_owned,
        proxy_allowed=proxy_allowed,
    )
    session.add(copy)
    session.flush()
    return copy


def make_deck(session: Session, name: str = "Deck de test", **fields) -> Deck:
    deck = Deck(name=name, **fields)
    session.add(deck)
    session.flush()
    return deck


def make_player(session: Session, name: str = "Joueur", is_me: bool = False) -> Player:
    player = Player(name=name, is_me=is_me)
    session.add(player)
    session.flush()
    return player


def make_tournament(session: Session, name: str = "Tournoi", **fields) -> Tournament:
    fields.setdefault("start_date", date(2026, 2, 1))
    tournament = Tournament(name=name, **fields)
    session.add(tournament)
    session.flush()
    return tournament


def make_game(session: Session, **fields) -> Game:
    fields.setdefault("played_at", datetime(2026, 2, 1, 14, 0))
    fields.setdefault("player_count", 5)
    game = Game(**fields)
    session.add(game)
    session.flush()
    return game


def populate_world(session: Session) -> SimpleNamespace:
    """Une ligne dans chaque table, reliées entre elles, et committées.

    Le deck contient la carte en EN (4 exemplaires possédés) ; la même carte
    existe aussi en FR en collection, à 0 exemplaire avec proxy autorisé.
    """
    add_languages(session, "EN", "FR")
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
    venue = Venue(name="Club de test", city="Nantes", notes="Le jeudi")
    session.add_all([clan, sect, discipline, card_type, card_set, venue])
    session.flush()

    card = make_card(
        session,
        clan=clan,
        sect=sect,
        capacity=4,
        group_code="2",
        card_text="Independent.",
        image_url="https://static.krcg.org/card/aabbtkindredg2.jpg",
    )
    bundle = Bundle(
        card_set_id=card_set.id,
        code="PS",
        name="Followers of Set",
        size=89,
    )
    printing = CardPrinting(
        card_id=card.id,
        card_set_id=card_set.id,
        image_url="https://static.krcg.org/card/set/final-nights/aabbtkindredg2.jpg",
    )
    session.add_all([bundle, printing])
    session.flush()
    session.add_all(
        [
            CardTypeLink(card_id=card.id, card_type_id=card_type.id),
            CardDisciplineLink(
                card_id=card.id, discipline_id=discipline.id, superior=True
            ),
            # La carte s'obtient de deux façons dans cette extension : en
            # booster, et à deux exemplaires dans le précon.
            CardPrintingOccurrence(
                card_printing_id=printing.id,
                occurrence_type=PrintOccurrence.RARITY,
                frequency="U",
                multiplier=2.0,
            ),
            CardPrintingOccurrence(
                card_printing_id=printing.id,
                occurrence_type=PrintOccurrence.PRECON,
                bundle_id=bundle.id,
                copies=2,
            ),
            CardTranslation(
                card_id=card.id,
                language_code="FR",
                name="Parenté Aabbt",
                card_text="Indépendant.",
                flavor_text="Le sang des anciens.",
                image_url="https://static.krcg.org/card/fr/aabbtkindredg2.jpg",
            ),
        ]
    )
    copy_en = make_copy(session, card, "EN", quantity_owned=4)
    copy_fr = make_copy(session, card, "FR", quantity_owned=0, proxy_allowed=True)

    deck = make_deck(
        session,
        name="Ventrue Grinder",
        created_on=date(2026, 1, 15),
        status=DeckStatus.ACTIVE,
        archetype="Vote",
    )
    deck_card = DeckCard(
        deck_id=deck.id, card_id=card.id, language_code="EN", quantity=4
    )
    session.add(deck_card)

    me = make_player(session, "Moi", is_me=True)
    opponent = make_player(session, "Adversaire")
    tournament = make_tournament(
        session,
        name="Tournoi de test",
        deck_policy=DeckPolicy.MONO,
        format=TournamentFormat.CONSTRUCTED,
        venue_id=venue.id,
        round_count=2,
    )
    game = make_game(
        session,
        played_at=datetime(2026, 2, 1, 14, 0),
        venue_id=venue.id,
        tournament_id=tournament.id,
        round_number=1,
        round_type=RoundType.PRELIMINARY,
        player_count=5,
    )
    mine = Participation(
        game_id=game.id,
        player_id=me.id,
        deck_id=deck.id,
        seat=3,
        victory_points=2.5,
        game_win=True,
    )
    theirs = Participation(game_id=game.id, player_id=opponent.id, seat=1)
    session.add_all([mine, theirs])
    session.commit()

    return SimpleNamespace(
        clan=clan,
        sect=sect,
        discipline=discipline,
        card_type=card_type,
        card_set=card_set,
        bundle=bundle,
        printing=printing,
        venue=venue,
        card=card,
        copy_en=copy_en,
        copy_fr=copy_fr,
        deck=deck,
        deck_card=deck_card,
        me=me,
        opponent=opponent,
        tournament=tournament,
        game=game,
        mine=mine,
        theirs=theirs,
    )
