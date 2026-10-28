"""Fabriques de données partagées par les tests de modèles et de schémas.

Ce ne sont pas des fixtures : des fonctions simples, appelables avec des
valeurs explicites quand un test veut contrôler un champ précis.

**Propriétaire par défaut (Lot 6).** `card_copy`, `deck`, `player`,
`tournament` et `game` portent désormais un `user_id` obligatoire
(`docs/lot6-plan-comptes.md`). Les fabriques correspondantes (`make_copy`,
`make_deck`, `make_player`, `make_tournament`, `make_game`) acceptent un
paramètre `user_id: int | None = None` : omis, elles l'attribuent au **compte
de test par défaut** (`default_user_id`), créé au besoin, une fois par base de
test. C'est un choix délibéré, différent de celui des services (qui, eux,
n'ont pas de valeur par défaut, cf. `app.services.stock`,
`app.services.decks`) : ici, l'objectif est de ne **pas** casser les dizaines
d'appels existants qui ignorent la notion de compte, tout en permettant à un
test d'isolation d'en passer un second explicitement. Le compte par défaut est
le même que celui que `tests.auth_helpers.authenticated_api` ouvre avec ses
arguments par défaut (même adresse), afin que `world` (dont les lignes sont
attribuées à ce compte) et un `api` authentifié par défaut désignent le même
propriétaire — voir `login_default_account` ci-dessous, utilisé par les
modules de test qui ont besoin d'un `api` déjà connecté.
"""

from datetime import date, datetime
from itertools import count, cycle
from types import SimpleNamespace

from sqlalchemy import select
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
from app.models.account import UserAccount

_vekn_ids = count(100_000)
# Le discriminant d'un deck est posé par le service (quatre chiffres tirés au
# sort, uniques au sein d'un nom). Les tests, eux, n'ont pas de service : on les
# distribue dans l'ordre, ce qui suffit à ne jamais retomber sur le même couple.
_discriminators = cycle(f"{number:04d}" for number in range(1, 10_000))

# Mêmes valeurs par défaut que `tests.auth_helpers.make_account` /
# `authenticated_api` : un seul et même compte de test, qu'on y accède par
# cette fonction ou en ouvrant une session par l'API.
DEFAULT_ACCOUNT_EMAIL = "joueur@example.com"
DEFAULT_ACCOUNT_USERNAME = "joueur"


def default_user_id(session: Session) -> int:
    """Identifiant du compte de test par défaut, créé au besoin.

    Cherché par adresse (unique) avant d'être créé, pour rester idempotent au
    sein d'une même base de test : `populate_world` et des fabriques appelées
    indépendamment dans le même test doivent désigner le même compte.
    """
    from tests.auth_helpers import make_account  # import tardif : évite un cycle

    account = session.scalars(
        select(UserAccount).where(UserAccount.email == DEFAULT_ACCOUNT_EMAIL)
    ).one_or_none()
    if account is None:
        account = make_account(
            session, email=DEFAULT_ACCOUNT_EMAIL, username=DEFAULT_ACCOUNT_USERNAME
        )
    return account.id


def login_default_account(api, db: Session):
    """Connecte `api` sous le compte de test par défaut (créé au besoin).

    Pensé pour être appelé par une fixture `api` locale, qui *surcharge* celle
    de `tests.conftest` dans les modules dont les routes exigent désormais une
    session (`/stock`, `/decks`, `/sync`, Lot 6) mais qui ne testent pas
    l'authentification elle-même : voir le patron pytest « override a fixture
    on a test module level ».
    """
    from tests.auth_helpers import DEFAULT_PASSWORD, log_in

    default_user_id(db)
    db.commit()
    log_in(api, DEFAULT_ACCOUNT_EMAIL, DEFAULT_PASSWORD)
    return api


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


_card_set_abbrevs = count(1)


def make_card_set(session: Session, abbrev: str | None = None, **fields) -> CardSet:
    """Une extension du catalogue, `abbrev` unique généré si omis."""
    if abbrev is None:
        abbrev = f"TS{next(_card_set_abbrevs)}"
    card_set = CardSet(abbrev=abbrev, **fields)
    session.add(card_set)
    session.flush()
    return card_set


def make_printing(
    session: Session, card: Card, card_set: CardSet | None = None, **fields
) -> CardPrinting:
    """Une impression (carte × extension) ; l'extension est créée si omise.

    C'est ce que la FK composite de `card_copy` vers `card_printing` (Lot 4,
    D2) exige avant toute entrée de collection.
    """
    if card_set is None:
        card_set = make_card_set(session)
    printing = CardPrinting(card_id=card.id, card_set_id=card_set.id, **fields)
    session.add(printing)
    session.flush()
    return printing


def make_copy(
    session: Session,
    card: Card,
    language_code: str = "EN",
    quantity_owned: int = 1,
    card_set_id: int | None = None,
    user_id: int | None = None,
) -> CardCopy:
    """Une entrée de collection. Sans `card_set_id`, une impression de test
    est créée pour la carte (extension neuve), comme `make_card` génère son
    propre `vekn_id`. Sans `user_id`, attribuée au compte de test par défaut
    (`default_user_id`, Lot 6)."""
    if card_set_id is None:
        card_set_id = make_printing(session, card).card_set_id
    if user_id is None:
        user_id = default_user_id(session)
    copy = CardCopy(
        user_id=user_id,
        card_id=card.id,
        language_code=language_code,
        card_set_id=card_set_id,
        quantity_owned=quantity_owned,
    )
    session.add(copy)
    session.flush()
    return copy


def make_deck(
    session: Session,
    name: str = "Deck de test",
    proxy_allowed: bool = False,
    user_id: int | None = None,
    **fields,
) -> Deck:
    """Sans `user_id`, attribué au compte de test par défaut (Lot 6)."""
    fields.setdefault("discriminator", next(_discriminators))
    if user_id is None:
        user_id = default_user_id(session)
    deck = Deck(user_id=user_id, name=name, proxy_allowed=proxy_allowed, **fields)
    session.add(deck)
    session.flush()
    return deck


def make_player(
    session: Session,
    name: str = "Joueur",
    is_me: bool = False,
    user_id: int | None = None,
) -> Player:
    """Sans `user_id`, attribué au compte de test par défaut (Lot 6)."""
    if user_id is None:
        user_id = default_user_id(session)
    player = Player(user_id=user_id, name=name, is_me=is_me)
    session.add(player)
    session.flush()
    return player


def make_tournament(
    session: Session, name: str = "Tournoi", user_id: int | None = None, **fields
) -> Tournament:
    """Sans `user_id`, attribué au compte de test par défaut (Lot 6)."""
    fields.setdefault("start_date", date(2026, 2, 1))
    if user_id is None:
        user_id = default_user_id(session)
    tournament = Tournament(user_id=user_id, name=name, **fields)
    session.add(tournament)
    session.flush()
    return tournament


def make_game(session: Session, user_id: int | None = None, **fields) -> Game:
    """Sans `user_id`, attribué au compte de test par défaut (Lot 6)."""
    fields.setdefault("played_at", datetime(2026, 2, 1, 14, 0))
    fields.setdefault("player_count", 5)
    if user_id is None:
        user_id = default_user_id(session)
    game = Game(user_id=user_id, **fields)
    session.add(game)
    session.flush()
    return game


def make_venue(
    session: Session, name: str = "Club", user_id: int | None = None, **fields
) -> Venue:
    """Sans `user_id`, attribué au compte de test par défaut (Lot 6)."""
    if user_id is None:
        user_id = default_user_id(session)
    venue = Venue(user_id=user_id, name=name, **fields)
    session.add(venue)
    session.flush()
    return venue


def populate_world(session: Session) -> SimpleNamespace:
    """Une ligne dans chaque table, reliées entre elles, et committées.

    Le deck contient la carte en EN (4 exemplaires possédés) ; la même carte
    existe aussi en FR en collection, à 0 exemplaire (cas normal d'une carte
    qui ne serait jouée qu'en proxy — l'autorisation vit sur le deck, Lot 4).

    Toutes les lignes privées (Lot 6) appartiennent au **compte de test par
    défaut** (`default_user_id`, créé ici en tout premier) : `world.account`
    l'expose, pour les tests qui veulent s'y connecter explicitement
    (`tests.auth_helpers.log_in`) plutôt que par la fixture `api` surchargée
    (`login_default_account`).
    """
    user_id = default_user_id(session)
    session.commit()
    account = session.get(UserAccount, user_id)
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
    venue = Venue(user_id=user_id, name="Club de test", city="Nantes", notes="Le jeudi")
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
    copy_en = make_copy(
        session,
        card,
        "EN",
        quantity_owned=4,
        card_set_id=printing.card_set_id,
        user_id=user_id,
    )
    copy_fr = make_copy(
        session,
        card,
        "FR",
        quantity_owned=0,
        card_set_id=printing.card_set_id,
        user_id=user_id,
    )

    deck = make_deck(
        session,
        name="Ventrue Grinder",
        created_on=date(2026, 1, 15),
        status=DeckStatus.ACTIVE,
        archetype="Vote",
        user_id=user_id,
    )
    deck_card = DeckCard(
        deck_id=deck.id,
        user_id=user_id,
        card_id=card.id,
        language_code="EN",
        card_set_id=printing.card_set_id,
        quantity=4,
    )
    session.add(deck_card)

    me = make_player(session, "Moi", is_me=True, user_id=user_id)
    opponent = make_player(session, "Adversaire", user_id=user_id)
    tournament = make_tournament(
        session,
        name="Tournoi de test",
        deck_policy=DeckPolicy.MONO,
        format=TournamentFormat.CONSTRUCTED,
        venue_id=venue.id,
        round_count=2,
        user_id=user_id,
    )
    game = make_game(
        session,
        played_at=datetime(2026, 2, 1, 14, 0),
        venue_id=venue.id,
        tournament_id=tournament.id,
        round_number=1,
        round_type=RoundType.PRELIMINARY,
        player_count=5,
        user_id=user_id,
    )
    mine = Participation(
        user_id=user_id,
        game_id=game.id,
        player_id=me.id,
        deck_id=deck.id,
        seat=3,
        victory_points=2.5,
        game_win=True,
    )
    theirs = Participation(
        user_id=user_id, game_id=game.id, player_id=opponent.id, seat=1
    )
    session.add_all([mine, theirs])
    session.commit()

    return SimpleNamespace(
        account=account,
        user_id=user_id,
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
