"""Export complet d'un compte (Lot 12, étape B2, P3 et A4).

Une fonction par domaine, chacune une lecture **du seul compte** : `user_id`
est un paramètre obligatoire, sans valeur par défaut, comme dans la
comptabilité du stock (`services/stock.py`), pour qu'un oubli échoue au typage
au lieu de lire toute la base. Chaque lecture joint le catalogue une fois, par
une requête à colonnes, plutôt que de charger les relations ligne à ligne :
une collection de quelques centaines d'entrées reste une poignée de requêtes.

La forme du fichier et ses choix (une carte par `vekn_id` et nom, une
extension par abréviation, des identifiants privés qui ne valent que dans le
fichier) sont décrits dans `app.schemas.account_export`.

Ordre des listes, pour qu'un fichier se relise et se compare d'un export à
l'autre : la collection par nom de carte (replié, puis brut, comme les
listes de l'API depuis le Lot 12, A7) puis identifiant VEKN, langue et
extension ; les ressources privées par identifiant, sauf les tournois (date de
début) et les parties (date de jeu), dans l'ordre où l'on les cherche ; une
table de partie par siège, les sans-siège en dernier, comme `GET /parties/{id}`.
"""

from collections import defaultdict
from datetime import UTC, datetime

from alembic.runtime.migration import MigrationContext
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, aliased, joinedload, lazyload

from app.models.account import UserAccount
from app.models.catalog import Card
from app.models.collection import (
    CardCopy,
    Deck,
    DeckCard,
    DeckVersion,
    DeckVersionCard,
    DeletedDeckCard,
)
from app.models.play import (
    Game,
    Participation,
    Player,
    Tournament,
    TournamentDeckVersion,
)
from app.models.reference import CardSet, Clan, Venue
from app.models.share import DeckShare, DeckShareCard
from app.schemas.account_export import (
    ACCOUNT_EXPORT_FORMAT_VERSION,
    AccountExport,
    ExportedAccount,
    ExportedCollectionEntry,
    ExportedDeck,
    ExportedDeckLine,
    ExportedDeckShare,
    ExportedDeckShareCard,
    ExportedDeckVersion,
    ExportedDeckVersionCard,
    ExportedGame,
    ExportedParticipation,
    ExportedPlayer,
    ExportedTournament,
    ExportedTournamentDeckVersion,
    ExportedVenue,
)
from app.services.text_search import folded_order

UNKNOWN_REVISION = "inconnue"
"""Révision écrite quand la base n'a pas de table `alembic_version` : base de
test créée par `create_all`, ou contrôle de révision coupé. En service, l'API
refuse de démarrer sans elle (`app.db.schema_check`)."""


def _scalar_fields(obj, schema: type[BaseModel], *nested: str) -> dict:
    """Les champs de `schema` lus sur l'objet ORM, sauf les listes imbriquées
    `nested`, que l'appelant remplit depuis ses propres lectures : les laisser
    à `model_validate` chargerait les relations ORM du même nom, ligne à
    ligne et dans une forme qui n'est pas celle du fichier."""
    return {
        name: getattr(obj, name) for name in schema.model_fields if name not in nested
    }


def schema_revision(db: Session) -> str:
    """Révision Alembic de la base, lue sur la connexion de la requête.

    Lue et non supposée égale à la tête des scripts : le fichier dit ce que
    la base était, et `SCHEMA_REVISION_CHECK=false` laisse démarrer l'API sur
    une base en retard."""
    heads = MigrationContext.configure(db.connection()).get_current_heads()
    return ", ".join(sorted(heads)) or UNKNOWN_REVISION


# --- Collection --------------------------------------------------------------


def export_collection(db: Session, *, user_id: int) -> list[ExportedCollectionEntry]:
    rows = db.execute(
        select(CardCopy, Card.vekn_id, Card.name, CardSet.abbrev)
        .join(Card, Card.id == CardCopy.card_id)
        .join(CardSet, CardSet.id == CardCopy.card_set_id)
        .where(CardCopy.user_id == user_id)
        .order_by(
            *folded_order(Card.name),
            Card.vekn_id,
            CardCopy.language_code,
            CardSet.abbrev,
        )
    )
    return [
        ExportedCollectionEntry(
            vekn_id=vekn_id,
            card_name=name,
            language_code=copy.language_code,
            card_set_abbrev=abbrev,
            quantity_owned=copy.quantity_owned,
            notes=copy.notes,
        )
        for copy, vekn_id, name, abbrev in rows
    ]


# --- Decks, leurs lignes et leurs versions -----------------------------------


def _line(row: DeckCard | DeletedDeckCard, vekn_id: int, name: str, abbrev: str):
    return ExportedDeckLine(
        vekn_id=vekn_id,
        card_name=name,
        language_code=row.language_code,
        card_set_abbrev=abbrev,
        quantity=row.quantity,
        proxy_quantity=row.proxy_quantity,
    )


def _lines_by_deck(db: Session, model, owned) -> dict[int, list[ExportedDeckLine]]:
    """Lignes de `model` (`DeckCard` ou `DeletedDeckCard`) rangées par deck,
    restreintes au compte par la condition `owned`."""
    rows = db.execute(
        select(model, Card.vekn_id, Card.name, CardSet.abbrev)
        .join(Card, Card.id == model.card_id)
        .join(CardSet, CardSet.id == model.card_set_id)
        .where(owned)
        .order_by(
            model.deck_id,
            *folded_order(Card.name),
            Card.vekn_id,
            model.language_code,
            CardSet.abbrev,
        )
    )
    lines: dict[int, list[ExportedDeckLine]] = defaultdict(list)
    for row, vekn_id, name, abbrev in rows:
        lines[row.deck_id].append(_line(row, vekn_id, name, abbrev))
    return lines


def _live_lines(db: Session, *, user_id: int) -> dict[int, list[ExportedDeckLine]]:
    return _lines_by_deck(db, DeckCard, DeckCard.user_id == user_id)


def _frozen_lines(db: Session, *, user_id: int) -> dict[int, list[ExportedDeckLine]]:
    # `deleted_deck_card` n'a pas de `user_id` : elle se lit par son deck.
    owned_decks = select(Deck.id).where(Deck.user_id == user_id)
    return _lines_by_deck(db, DeletedDeckCard, DeletedDeckCard.deck_id.in_(owned_decks))


def _versions_by_deck(
    db: Session, *, user_id: int
) -> dict[int, list[ExportedDeckVersion]]:
    versions = db.scalars(
        select(DeckVersion)
        .where(DeckVersion.user_id == user_id)
        .order_by(DeckVersion.deck_id, DeckVersion.number)
    ).all()
    cards: dict[int, list[ExportedDeckVersionCard]] = defaultdict(list)
    rows = db.execute(
        select(DeckVersionCard, Card.vekn_id, Card.name)
        .join(Card, Card.id == DeckVersionCard.card_id)
        .join(DeckVersion, DeckVersion.id == DeckVersionCard.deck_version_id)
        .where(DeckVersion.user_id == user_id)
        .order_by(*folded_order(Card.name), Card.vekn_id)
    )
    for row, vekn_id, name in rows:
        cards[row.deck_version_id].append(
            ExportedDeckVersionCard(
                vekn_id=vekn_id, card_name=name, quantity=row.quantity
            )
        )
    by_deck: dict[int, list[ExportedDeckVersion]] = defaultdict(list)
    for version in versions:
        by_deck[version.deck_id].append(
            ExportedDeckVersion(
                number=version.number,
                created_at=version.created_at,
                cards=cards.get(version.id, []),
            )
        )
    return by_deck


def export_decks(db: Session, *, user_id: int) -> list[ExportedDeck]:
    """Tous les decks du compte, archivés et supprimés compris.

    Un deck vivant porte ses lignes ; un deck supprimé, sa liste figée à la
    suppression (il n'a plus de ligne vivante)."""
    live = _live_lines(db, user_id=user_id)
    frozen = _frozen_lines(db, user_id=user_id)
    versions = _versions_by_deck(db, user_id=user_id)
    decks = db.scalars(select(Deck).where(Deck.user_id == user_id).order_by(Deck.id))
    exported = []
    for deck in decks:
        lines = frozen if deck.deleted_at is not None else live
        exported.append(
            ExportedDeck(
                **_scalar_fields(deck, ExportedDeck, "cards", "versions"),
                cards=lines.get(deck.id, []),
                versions=versions.get(deck.id, []),
            )
        )
    return exported


# --- Carnet : joueurs et lieux -----------------------------------------------


def export_players(db: Session, *, user_id: int) -> list[ExportedPlayer]:
    players = db.scalars(
        select(Player).where(Player.user_id == user_id).order_by(Player.id)
    )
    return [ExportedPlayer.model_validate(player) for player in players]


def export_venues(db: Session, *, user_id: int) -> list[ExportedVenue]:
    venues = db.scalars(
        select(Venue).where(Venue.user_id == user_id).order_by(Venue.id)
    )
    return [ExportedVenue.model_validate(venue) for venue in venues]


# --- Tournois et parties -----------------------------------------------------


def _tournament_versions(
    db: Session, *, user_id: int
) -> dict[int, list[ExportedTournamentDeckVersion]]:
    rows = db.execute(
        select(TournamentDeckVersion, DeckVersion.number)
        .join(DeckVersion, DeckVersion.id == TournamentDeckVersion.deck_version_id)
        .where(TournamentDeckVersion.user_id == user_id)
        .order_by(TournamentDeckVersion.tournament_id, TournamentDeckVersion.deck_id)
    )
    by_tournament: dict[int, list[ExportedTournamentDeckVersion]] = defaultdict(list)
    for row, number in rows:
        by_tournament[row.tournament_id].append(
            ExportedTournamentDeckVersion(
                deck_id=row.deck_id,
                deck_version_number=number,
                frozen_by_game_id=row.frozen_by_game_id,
            )
        )
    return by_tournament


def export_tournaments(db: Session, *, user_id: int) -> list[ExportedTournament]:
    versions = _tournament_versions(db, user_id=user_id)
    tournaments = db.scalars(
        select(Tournament)
        .where(Tournament.user_id == user_id)
        .order_by(Tournament.start_date, Tournament.id)
    )
    exported = []
    for tournament in tournaments:
        exported.append(
            ExportedTournament(
                **_scalar_fields(tournament, ExportedTournament, "deck_versions"),
                deck_versions=versions.get(tournament.id, []),
            )
        )
    return exported


def _participation(
    row: Participation,
    is_me: bool | None,
    version_number: int | None,
    clan_name: str | None,
) -> ExportedParticipation:
    return ExportedParticipation(
        player_id=row.player_id,
        is_me=bool(is_me),
        seat=row.seat,
        deck_id=row.deck_id,
        deck_version_number=version_number,
        victory_points=row.victory_points,
        game_win=row.game_win,
        opponent_deck_name=row.opponent_deck_name,
        opponent_deck_archetype=row.opponent_deck_archetype,
        opponent_clan=clan_name,
        notes=row.notes,
    )


def _tables_by_game(
    db: Session, *, user_id: int
) -> dict[int, list[ExportedParticipation]]:
    # Les relations de `Participation` chargent joueur et version d'office
    # (`lazy="joined"`) ; `lazyload("*")` les coupe, les trois colonnes utiles
    # venant des jointures explicites.
    player = aliased(Player)
    rows = db.execute(
        select(Participation, player.is_me, DeckVersion.number, Clan.name)
        .outerjoin(
            player,
            (player.id == Participation.player_id)
            & (player.user_id == Participation.user_id),
        )
        .outerjoin(DeckVersion, DeckVersion.id == Participation.deck_version_id)
        .outerjoin(Clan, Clan.id == Participation.opponent_clan_id)
        .where(Participation.user_id == user_id)
        .order_by(
            Participation.game_id,
            Participation.seat.is_(None),
            Participation.seat,
            Participation.id,
        )
        .options(lazyload("*"))
    )
    tables: dict[int, list[ExportedParticipation]] = defaultdict(list)
    for row, is_me, number, clan_name in rows:
        tables[row.game_id].append(_participation(row, is_me, number, clan_name))
    return tables


def export_games(db: Session, *, user_id: int) -> list[ExportedGame]:
    tables = _tables_by_game(db, user_id=user_id)
    games = db.scalars(
        select(Game).where(Game.user_id == user_id).order_by(Game.played_at, Game.id)
    )
    exported = []
    for game in games:
        exported.append(
            ExportedGame(
                **_scalar_fields(game, ExportedGame, "participations"),
                participations=tables.get(game.id, []),
            )
        )
    return exported


# --- Liens publics (Lot 13, A5) -----------------------------------------------


def export_shares(db: Session, *, user_id: int) -> list[ExportedDeckShare]:
    """Les liens du compte, supprimés compris, **sans leur jeton** : un jeton
    suffit à lire la liste, et le fichier peut traîner. `deck_share_card` n'a
    pas de `user_id` : elle se lit par son lien."""
    cards: dict[int, list[ExportedDeckShareCard]] = defaultdict(list)
    rows = db.execute(
        select(DeckShareCard, Card.vekn_id, Card.name)
        .join(Card, Card.id == DeckShareCard.card_id)
        .join(DeckShare, DeckShare.id == DeckShareCard.deck_share_id)
        .where(DeckShare.user_id == user_id)
        .order_by(*folded_order(Card.name), Card.vekn_id)
    )
    for row, vekn_id, name in rows:
        cards[row.deck_share_id].append(
            ExportedDeckShareCard(
                vekn_id=vekn_id, card_name=name, quantity=row.quantity
            )
        )
    shares = db.scalars(
        select(DeckShare)
        .where(DeckShare.user_id == user_id)
        .options(joinedload(DeckShare.deck_version))
        .order_by(DeckShare.id)
    )
    return [
        ExportedDeckShare(
            id=share.id,
            deck_id=share.deck_id,
            kind=share.kind,
            show_notes=share.show_notes,
            created_at=share.created_at,
            frozen_name=share.frozen_name,
            frozen_archetype=share.frozen_archetype,
            frozen_notes=share.frozen_notes,
            deck_version_number=(
                share.deck_version.number if share.deck_version else None
            ),
            cards=cards.get(share.id, []),
        )
        for share in shares
    ]


# --- Assemblage --------------------------------------------------------------


def export_account(
    db: Session, account: UserAccount, *, now: datetime | None = None
) -> AccountExport:
    """Le fichier entier, pour le compte `account` seul."""
    user_id = account.id
    return AccountExport(
        format_version=ACCOUNT_EXPORT_FORMAT_VERSION,
        exported_at=now or datetime.now(UTC),
        schema_revision=schema_revision(db),
        account=ExportedAccount.model_validate(account),
        collection=export_collection(db, user_id=user_id),
        decks=export_decks(db, user_id=user_id),
        players=export_players(db, user_id=user_id),
        venues=export_venues(db, user_id=user_id),
        tournaments=export_tournaments(db, user_id=user_id),
        games=export_games(db, user_id=user_id),
        shares=export_shares(db, user_id=user_id),
    )


def export_filename(username: str, exported_at: datetime) -> str:
    """`gurchon-hall-<username>-<AAAA-MM-JJ>.json`, date UTC de l'export.

    Le nom d'utilisateur suit `^[A-Za-z0-9_-]{3,32}$` (Lot 6) : rien à
    échapper dans l'en-tête `Content-Disposition`."""
    day = exported_at.astimezone(UTC).date().isoformat()
    return f"gurchon-hall-{username}-{day}.json"
