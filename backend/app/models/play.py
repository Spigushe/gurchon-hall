"""Pratique de jeu : joueurs, parties, tournois, participations.

Portée volontairement réduite côté adversaires (CLAUDE.md §11 point 3) : on
suit **mes** parties et **mes** résultats. `Player` sert surtout à identifier
« Moi » et, au besoin, à mettre un nom en face d'un siège ; on ne modélise ni
les decks des adversaires, ni le détail de leurs résultats. Une `Participation`
d'adversaire peut donc rester quasi vide (pas de deck, pas de VP) sans que ce
soit une anomalie.

**Propriétaire (Lot 6, décision D7).** Les quatre tables portent un `user_id`
dès maintenant, alors qu'elles sont encore vides et sans route : le Lot 7
n'aura aucune migration de propriété à écrire. Les adversaires restent des noms
propres au compte. Les liens entre ces tables passent par des clés étrangères
**composites** (`(x_id, user_id)` vers `(id, user_id)`) : la base refuse
qu'une partie pointe le tournoi ou le lieu d'un autre compte, ou qu'une
participation pointe sa partie, son joueur ou son deck. Une colonne `x_id`
nulle désactive le contrôle (`MATCH SIMPLE` de SQLite) : c'est voulu pour une
partie amicale sans tournoi ni lieu, ou un adversaire sans deck.

Les relations ORM correspondantes ne recopient que `x_id` : la condition sur
`user_id` figure dans leur jointure mais n'y est pas « étrangère ». Sans cela,
deux relations d'une même table (partie → tournoi, partie → lieu)
prétendraient chacune écrire `user_id`, ce que SQLAlchemy signale comme un
conflit. Le compte est posé par le service, une fois, sur chaque ligne.
"""

from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.collection import Deck
from app.models.enums import DeckPolicy, RoundType, TournamentFormat, enum_column
from app.models.reference import Venue
from app.models.types import UtcDateTime

# Condition de l'index partiel « un seul Moi par compte ». `is_me = 1` est
# l'écriture SQLite d'un booléen vrai ; Postgres refuserait de comparer un
# booléen à un entier, d'où sa variante propre.
_IS_ME = text("is_me = 1")
_IS_ME_POSTGRES = text("is_me")


class Player(Base):
    """Un joueur. Au minimum « Moi » (`is_me = True`), un par compte."""

    __tablename__ = "player"
    __table_args__ = (
        # Un seul « Moi » **par compte**. Index unique partiel sur `user_id` :
        # les lignes `is_me = False` ne sont pas contraintes.
        Index(
            "ux_player_is_me",
            "user_id",
            unique=True,
            sqlite_where=_IS_ME,
            postgresql_where=_IS_ME_POSTGRES,
        ),
        UniqueConstraint("user_id", "name"),
        # Cible de la clé composite de `participation`.
        UniqueConstraint("id", "user_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user_account.id"))
    name: Mapped[str] = mapped_column(String(80))
    is_me: Mapped[bool] = mapped_column(default=False)


class Tournament(Base, TimestampMixin):
    """Un tournoi : des parties consécutives, éventuellement une finale."""

    __tablename__ = "tournament"
    __table_args__ = (
        CheckConstraint("round_count >= 1", name="round_count_positive"),
        CheckConstraint("my_ranking >= 1", name="my_ranking_positive"),
        ForeignKeyConstraint(["venue_id", "user_id"], ["venue.id", "venue.user_id"]),
        # Cible de la clé composite de `game`.
        UniqueConstraint("id", "user_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user_account.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    start_date: Mapped[date] = mapped_column()
    end_date: Mapped[date | None] = mapped_column()
    venue_id: Mapped[int | None] = mapped_column()
    deck_policy: Mapped[DeckPolicy] = mapped_column(
        enum_column(DeckPolicy, "deck_policy"),
        default=DeckPolicy.MONO,
    )
    format: Mapped[TournamentFormat] = mapped_column(
        enum_column(TournamentFormat, "tournament_format"),
        default=TournamentFormat.CONSTRUCTED,
    )
    round_count: Mapped[int | None] = mapped_column()
    my_ranking: Mapped[int | None] = mapped_column()
    notes: Mapped[str | None] = mapped_column(Text())

    venue: Mapped[Venue | None] = relationship(
        primaryjoin=(
            "and_(Tournament.venue_id == Venue.id, Tournament.user_id == Venue.user_id)"
        ),
        foreign_keys="Tournament.venue_id",
    )
    # `passive_deletes="all"` : supprimer un tournoi qui contient des parties
    # doit échouer, pas détacher les parties en silence. Sans cette option,
    # l'ORM tenterait de passer `game.tournament_id` à NULL — une partie
    # perdrait sa ronde et son classement sans que personne ne l'ait demandé.
    # La base refuse déjà (pas de ON DELETE), l'ORM s'aligne.
    games: Mapped[list[Game]] = relationship(
        back_populates="tournament",
        passive_deletes="all",
        primaryjoin=(
            "and_(Tournament.id == Game.tournament_id, "
            "Tournament.user_id == Game.user_id)"
        ),
        foreign_keys="Game.tournament_id",
    )


class Game(Base, TimestampMixin):
    """Une partie, en tournoi (`tournament_id` renseigné) ou en amical."""

    __tablename__ = "game"
    __table_args__ = (
        # Volontairement large : 4 à 5 joueurs est le standard (§5), pas une
        # contrainte de schéma. On refuse seulement l'absurde.
        CheckConstraint("player_count >= 2", name="player_count_minimum"),
        CheckConstraint("round_number >= 1", name="round_number_positive"),
        ForeignKeyConstraint(["venue_id", "user_id"], ["venue.id", "venue.user_id"]),
        ForeignKeyConstraint(
            ["tournament_id", "user_id"],
            ["tournament.id", "tournament.user_id"],
        ),
        # Cible de la clé composite de `participation`.
        UniqueConstraint("id", "user_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user_account.id"), index=True)
    # UTC naïf, comme toute date-heure du modèle : un instant *aware* est
    # converti à l'écriture (cf. `app.models.types.UtcDateTime`).
    played_at: Mapped[datetime] = mapped_column(UtcDateTime())
    venue_id: Mapped[int | None] = mapped_column()
    tournament_id: Mapped[int | None] = mapped_column(index=True)
    round_number: Mapped[int | None] = mapped_column()
    round_type: Mapped[RoundType] = mapped_column(
        enum_column(RoundType, "round_type"),
        default=RoundType.CASUAL,
    )
    player_count: Mapped[int] = mapped_column()
    notes: Mapped[str | None] = mapped_column(Text())

    venue: Mapped[Venue | None] = relationship(
        primaryjoin="and_(Game.venue_id == Venue.id, Game.user_id == Venue.user_id)",
        foreign_keys="Game.venue_id",
    )
    tournament: Mapped[Tournament | None] = relationship(
        back_populates="games",
        primaryjoin=(
            "and_(Game.tournament_id == Tournament.id, "
            "Game.user_id == Tournament.user_id)"
        ),
        foreign_keys="Game.tournament_id",
    )
    participations: Mapped[list[Participation]] = relationship(
        back_populates="game",
        cascade="all, delete-orphan",
        primaryjoin=(
            "and_(Game.id == Participation.game_id, "
            "Game.user_id == Participation.user_id)"
        ),
        foreign_keys="Participation.game_id",
    )


class Participation(Base):
    """La place et le résultat d'un joueur sur une partie.

    `victory_points` est un flottant : le barème du §5 accorde des demi-points
    (0,5 VP par survivant en fin de partie). `game_win` est stocké plutôt que
    recalculé à la volée, mais reste nullable tant que la table n'est pas
    complètement saisie ; son calcul est une règle de service (Lot 2), et la
    règle VEKN exacte est marquée [à confirmer] au §5.
    """

    __tablename__ = "participation"
    __table_args__ = (
        UniqueConstraint("game_id", "player_id"),
        UniqueConstraint("game_id", "seat"),
        CheckConstraint("victory_points >= 0", name="victory_points_positive"),
        CheckConstraint("seat >= 1", name="seat_positive"),
        ForeignKeyConstraint(
            ["game_id", "user_id"],
            ["game.id", "game.user_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(["player_id", "user_id"], ["player.id", "player.user_id"]),
        ForeignKeyConstraint(["deck_id", "user_id"], ["deck.id", "deck.user_id"]),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user_account.id"))
    game_id: Mapped[int] = mapped_column()
    player_id: Mapped[int] = mapped_column()
    deck_id: Mapped[int | None] = mapped_column(index=True)
    seat: Mapped[int | None] = mapped_column()
    victory_points: Mapped[float | None] = mapped_column(Float())
    game_win: Mapped[bool | None] = mapped_column()
    notes: Mapped[str | None] = mapped_column(Text())

    game: Mapped[Game] = relationship(
        back_populates="participations",
        primaryjoin=(
            "and_(Participation.game_id == Game.id, "
            "Participation.user_id == Game.user_id)"
        ),
        foreign_keys="Participation.game_id",
    )
    player: Mapped[Player] = relationship(
        primaryjoin=(
            "and_(Participation.player_id == Player.id, "
            "Participation.user_id == Player.user_id)"
        ),
        foreign_keys="Participation.player_id",
    )
    deck: Mapped[Deck | None] = relationship(
        primaryjoin=(
            "and_(Participation.deck_id == Deck.id, "
            "Participation.user_id == Deck.user_id)"
        ),
        foreign_keys="Participation.deck_id",
    )
