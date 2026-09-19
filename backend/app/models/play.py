"""Pratique de jeu : joueurs, parties, tournois, participations.

Portée volontairement réduite côté adversaires (CLAUDE.md §11 point 3) : on
suit **mes** parties et **mes** résultats. `Player` sert surtout à identifier
« Moi » et, au besoin, à mettre un nom en face d'un siège ; on ne modélise ni
les decks des adversaires, ni le détail de leurs résultats. Une `Participation`
d'adversaire peut donc rester quasi vide (pas de deck, pas de VP) sans que ce
soit une anomalie.
"""

from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Float,
    ForeignKey,
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


class Player(Base):
    """Un joueur. Au minimum « Moi » (`is_me = True`)."""

    __tablename__ = "player"
    __table_args__ = (
        # Un seul « Moi ». Index unique partiel : les lignes `is_me = False`
        # ne sont pas contraintes.
        Index("ux_player_is_me", "is_me", unique=True, sqlite_where=text("is_me = 1")),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    is_me: Mapped[bool] = mapped_column(default=False)


class Tournament(Base, TimestampMixin):
    """Un tournoi : des parties consécutives, éventuellement une finale."""

    __tablename__ = "tournament"
    __table_args__ = (
        CheckConstraint("round_count >= 1", name="round_count_positive"),
        CheckConstraint("my_ranking >= 1", name="my_ranking_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    start_date: Mapped[date] = mapped_column()
    end_date: Mapped[date | None] = mapped_column()
    venue_id: Mapped[int | None] = mapped_column(ForeignKey("venue.id"))
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

    venue: Mapped[Venue | None] = relationship()
    # `passive_deletes="all"` : supprimer un tournoi qui contient des parties
    # doit échouer, pas détacher les parties en silence. Sans cette option,
    # l'ORM tenterait de passer `game.tournament_id` à NULL — une partie
    # perdrait sa ronde et son classement sans que personne ne l'ait demandé.
    # La base refuse déjà (pas de ON DELETE), l'ORM s'aligne.
    games: Mapped[list[Game]] = relationship(
        back_populates="tournament",
        passive_deletes="all",
    )


class Game(Base, TimestampMixin):
    """Une partie, en tournoi (`tournament_id` renseigné) ou en amical."""

    __tablename__ = "game"
    __table_args__ = (
        # Volontairement large : 4 à 5 joueurs est le standard (§5), pas une
        # contrainte de schéma. On refuse seulement l'absurde.
        CheckConstraint("player_count >= 2", name="player_count_minimum"),
        CheckConstraint("round_number >= 1", name="round_number_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # UTC naïf, comme toute date-heure du modèle : un instant *aware* est
    # converti à l'écriture (cf. `app.models.types.UtcDateTime`).
    played_at: Mapped[datetime] = mapped_column(UtcDateTime())
    venue_id: Mapped[int | None] = mapped_column(ForeignKey("venue.id"))
    tournament_id: Mapped[int | None] = mapped_column(
        ForeignKey("tournament.id"),
        index=True,
    )
    round_number: Mapped[int | None] = mapped_column()
    round_type: Mapped[RoundType] = mapped_column(
        enum_column(RoundType, "round_type"),
        default=RoundType.CASUAL,
    )
    player_count: Mapped[int] = mapped_column()
    notes: Mapped[str | None] = mapped_column(Text())

    venue: Mapped[Venue | None] = relationship()
    tournament: Mapped[Tournament | None] = relationship(back_populates="games")
    participations: Mapped[list[Participation]] = relationship(
        back_populates="game",
        cascade="all, delete-orphan",
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
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    game_id: Mapped[int] = mapped_column(ForeignKey("game.id", ondelete="CASCADE"))
    player_id: Mapped[int] = mapped_column(ForeignKey("player.id"))
    deck_id: Mapped[int | None] = mapped_column(ForeignKey("deck.id"), index=True)
    seat: Mapped[int | None] = mapped_column()
    victory_points: Mapped[float | None] = mapped_column(Float())
    game_win: Mapped[bool | None] = mapped_column()
    notes: Mapped[str | None] = mapped_column(Text())

    game: Mapped[Game] = relationship(back_populates="participations")
    player: Mapped[Player] = relationship()
    deck: Mapped[Deck | None] = relationship()
