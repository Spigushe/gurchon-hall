"""Pratique de jeu : joueurs, parties, tournois, participations.

Portée volontairement réduite côté adversaires (CLAUDE.md §11 point 3) : on
suit **mes** parties et **mes** résultats, VP et GW seulement (Lot 7, P7 : ni
points de tournoi, ni place à la table). `Player` sert surtout à identifier
« Moi » et, au besoin, à mettre un nom en face d'un siège ; on ne modélise pas
les résultats des adversaires. Une `Participation` d'adversaire reste donc
sans VP ni GW, ce que le service impose (Lot 7, A13) ; elle peut porter l'un
de **mes** decks, prêté pour la partie (P4), ou, depuis le Lot 8, une
description du deck adverse (clan principal, archétype, nom), et peut même ne
désigner aucun joueur du carnet (P6 : « Joueur non nommé »).

**Versions jouées (Lot 8).** Toute ligne qui désigne un deck pointe la
version figée de ce deck (`deck_version_id`). Dans un tournoi, un deck n'a
qu'une version, figée à sa première partie : `TournamentDeckVersion` la porte,
avec la partie qui l'a figée (A9).

**« Moi » existe toujours (Lot 7, A1).** Un compte a exactement un joueur
`is_me`, créé par le serveur : par la révision R10 pour les comptes
antérieurs, à l'inscription pour les suivants.

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

from app.models.base import NEVER_REUSE_IDS, Base, TimestampMixin
from app.models.collection import Deck, DeckVersion
from app.models.enums import (
    DeckArchetype,
    DeckPolicy,
    EventTier,
    FinalDeckRule,
    RoundType,
    TournamentFormat,
    enum_column,
)
from app.models.reference import Clan, Venue
from app.models.types import UtcDateTime

# Condition de l'index partiel « un seul Moi par compte ». `is_me = 1` est
# l'écriture SQLite d'un booléen vrai ; Postgres refuserait de comparer un
# booléen à un entier, d'où sa variante propre.
_IS_ME = text("is_me = 1")
_IS_ME_POSTGRES = text("is_me")

# Conditions des index partiels de `game` (Lot 7, A6) : une préliminaire par
# numéro de ronde, une finale par tournoi. Même texte pour les deux moteurs.
_PRELIMINARY = text("round_type = 'preliminary'")
_FINAL = text("round_type = 'final'")


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
        # Identifiant jamais réattribué après une suppression (Lot 7, R11).
        NEVER_REUSE_IDS,
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user_account.id"))
    name: Mapped[str] = mapped_column(String(80))
    is_me: Mapped[bool] = mapped_column(default=False)


class Tournament(Base, TimestampMixin):
    """Un tournoi : des parties consécutives, éventuellement une finale.

    Niveau et règle du deck de finale (Lot 7, A11) : les deux contraintes
    croisées ci-dessous ne portent que sur la ligne, et la base les tient. Le
    contrôle des decks joués, lui, porte sur plusieurs parties et reste au
    service.
    """

    __tablename__ = "tournament"
    __table_args__ = (
        CheckConstraint("round_count >= 1", name="round_count_positive"),
        CheckConstraint("my_ranking >= 1", name="my_ranking_positive"),
        CheckConstraint("player_count >= 2", name="player_count_minimum"),
        # La règle du deck de finale n'a de sens qu'en multi-deck.
        CheckConstraint(
            "deck_policy = 'multi' OR final_deck_rule IS NULL",
            name="final_deck_rule_only_multi",
        ),
        # Multi-deck interdit hors tournoi standard (VEKN 3.1.5).
        CheckConstraint(
            "deck_policy = 'mono' OR event_tier = 'standard'",
            name="multi_only_standard_tier",
        ),
        ForeignKeyConstraint(["venue_id", "user_id"], ["venue.id", "venue.user_id"]),
        # Cible de la clé composite de `game`.
        UniqueConstraint("id", "user_id"),
        # Identifiant jamais réattribué après une suppression (Lot 7, R11).
        NEVER_REUSE_IDS,
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
    # Défaut aussi côté base, comme `deck.proxy_allowed` : une insertion qui
    # ignore le niveau (SQL brut, outil) obtient le tournoi standard.
    event_tier: Mapped[EventTier] = mapped_column(
        enum_column(EventTier, "event_tier"),
        default=EventTier.STANDARD,
        server_default=EventTier.STANDARD.value,
    )
    final_deck_rule: Mapped[FinalDeckRule | None] = mapped_column(
        enum_column(FinalDeckRule, "final_deck_rule")
    )
    round_count: Mapped[int | None] = mapped_column()
    player_count: Mapped[int | None] = mapped_column()
    """Nombre d'inscrits (Lot 7, P6) : souvent inconnu à l'arrivée, d'où nul
    permis ; borne du classement saisi."""
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
        # Tournoi et ronde se tiennent (Lot 7, A6) : une amicale n'a pas de
        # tournoi, une partie de tournoi est une préliminaire ou la finale, et
        # seule une préliminaire porte un numéro de ronde.
        CheckConstraint(
            "(round_type = 'casual') = (tournament_id IS NULL)",
            name="casual_iff_no_tournament",
        ),
        CheckConstraint(
            "(round_type = 'preliminary') = (round_number IS NOT NULL)",
            name="round_number_iff_preliminary",
        ),
        Index(
            "ux_game_preliminary_round",
            "user_id",
            "tournament_id",
            "round_number",
            unique=True,
            sqlite_where=_PRELIMINARY,
            postgresql_where=_PRELIMINARY,
        ),
        Index(
            "ux_game_final",
            "user_id",
            "tournament_id",
            unique=True,
            sqlite_where=_FINAL,
            postgresql_where=_FINAL,
        ),
        ForeignKeyConstraint(["venue_id", "user_id"], ["venue.id", "venue.user_id"]),
        ForeignKeyConstraint(
            ["tournament_id", "user_id"],
            ["tournament.id", "tournament.user_id"],
        ),
        # Cible de la clé composite de `participation`.
        UniqueConstraint("id", "user_id"),
        # Identifiant jamais réattribué après une suppression (Lot 7, R11).
        NEVER_REUSE_IDS,
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
    # `lazy="joined"` : `GameRead.tournament_name` lit le tournoi de chaque
    # partie d'une liste ; sans jointure, une requête par partie (Lot 7, B2).
    tournament: Mapped[Tournament | None] = relationship(
        back_populates="games",
        primaryjoin=(
            "and_(Game.tournament_id == Tournament.id, "
            "Game.user_id == Tournament.user_id)"
        ),
        foreign_keys="Game.tournament_id",
        lazy="joined",
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

    # Lectures dérivées pour `GameRead` (Lot 7) : de la navigation, aucun
    # calcul. Le service charge `participations`, leurs joueurs et le tournoi
    # d'avance, sans quoi une liste ferait une requête par partie.

    @property
    def me(self) -> Participation | None:
        """Ma ligne de la table ; une partie en a toujours une (A2)."""
        return next((p for p in self.participations if p.is_me), None)

    @property
    def tournament_name(self) -> str | None:
        return self.tournament.name if self.tournament is not None else None


class Participation(Base):
    """La place et le résultat d'un joueur sur une partie.

    `victory_points` est un flottant : le barème du §5 accorde des demi-points
    (0,5 VP par survivant en fin de partie ou par retrait). `game_win` est
    déclaré par le joueur et stocké : sans les VP des adversaires, le serveur ne
    peut le déduire que lorsqu'il est certain (plus de la moitié des VP que la
    table peut distribuer et au moins 2, CLAUDE.md §5). Ces contrôles, comme
    l'absence de VP et de GW sur la ligne d'un adversaire, sont des règles de
    service (Lot 7, A4 et A13).

    **Lot 8.** `deck_version_id` désigne la liste figée du deck joué ; la clé
    composite (`deck_version_id`, `deck_id`, `user_id`) garantit qu'elle est
    une version **de ce deck** et de ce compte, et le CHECK
    `version_requires_deck` couvre le cas où `deck_id` est nul, que
    `MATCH SIMPLE` laisserait passer. Les trois champs `opponent_*` décrivent
    le deck d'un adversaire (P5) ; `player_id` devient facultatif (P6).
    Restent au service, comme A13 : champs adverses refusés sur ma ligne et
    sur une ligne qui joue un de mes decks prêtés, une ligne sans joueur
    porte un siège ou un deck, exactement une ligne du « Moi » par partie.
    L'unicité (`game_id`, `player_id`) tient avec plusieurs lignes sans
    joueur : SQLite ne compare pas les NULL entre eux.
    """

    __tablename__ = "participation"
    __table_args__ = (
        UniqueConstraint("game_id", "player_id"),
        UniqueConstraint("game_id", "seat"),
        CheckConstraint("victory_points >= 0", name="victory_points_positive"),
        CheckConstraint("seat >= 1", name="seat_positive"),
        CheckConstraint(
            "deck_version_id IS NULL OR deck_id IS NOT NULL",
            name="version_requires_deck",
        ),
        ForeignKeyConstraint(
            ["game_id", "user_id"],
            ["game.id", "game.user_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(["player_id", "user_id"], ["player.id", "player.user_id"]),
        ForeignKeyConstraint(["deck_id", "user_id"], ["deck.id", "deck.user_id"]),
        ForeignKeyConstraint(
            ["deck_version_id", "deck_id", "user_id"],
            ["deck_version.id", "deck_version.deck_id", "deck_version.user_id"],
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user_account.id"))
    game_id: Mapped[int] = mapped_column()
    # Nul pour un adversaire dont on ignore le nom (Lot 8, P6).
    player_id: Mapped[int | None] = mapped_column()
    deck_id: Mapped[int | None] = mapped_column(index=True)
    deck_version_id: Mapped[int | None] = mapped_column()
    seat: Mapped[int | None] = mapped_column()
    victory_points: Mapped[float | None] = mapped_column(Float())
    game_win: Mapped[bool | None] = mapped_column()
    # Deck d'un adversaire (Lot 8, P5) : le nom est gardé pour mémoire et
    # n'entre dans aucun axe d'analyse ; clan principal et archétype, si.
    opponent_deck_name: Mapped[str | None] = mapped_column(String(120))
    opponent_deck_archetype: Mapped[DeckArchetype | None] = mapped_column(
        enum_column(DeckArchetype, "deck_archetype")
    )
    opponent_clan_id: Mapped[int | None] = mapped_column(ForeignKey("clan.id"))
    notes: Mapped[str | None] = mapped_column(Text())

    game: Mapped[Game] = relationship(
        back_populates="participations",
        primaryjoin=(
            "and_(Participation.game_id == Game.id, "
            "Participation.user_id == Game.user_id)"
        ),
        foreign_keys="Participation.game_id",
    )
    # `lazy="joined"` : `is_me` et `Game.me` lisent le joueur de chaque ligne.
    player: Mapped[Player | None] = relationship(
        primaryjoin=(
            "and_(Participation.player_id == Player.id, "
            "Participation.user_id == Player.user_id)"
        ),
        foreign_keys="Participation.player_id",
        lazy="joined",
    )
    deck: Mapped[Deck | None] = relationship(
        primaryjoin=(
            "and_(Participation.deck_id == Deck.id, "
            "Participation.user_id == Deck.user_id)"
        ),
        foreign_keys="Participation.deck_id",
    )
    # Lecture seule : `deck_version_id` est posé par le service de gel, et la
    # version ne s'écrit jamais à travers la ligne qui la joue. `lazy="joined"`
    # : `ParticipationSummary.deck_version_number` la lit pour chaque partie
    # d'une liste.
    deck_version: Mapped[DeckVersion | None] = relationship(
        primaryjoin="Participation.deck_version_id == DeckVersion.id",
        foreign_keys="Participation.deck_version_id",
        viewonly=True,
        lazy="joined",
    )
    opponent_clan: Mapped[Clan | None] = relationship()

    @property
    def is_me(self) -> bool:
        """Ma ligne, la seule à porter VP et GW (A13) ; lu pour
        `ParticipationRead`. Une ligne sans joueur (P6) n'est jamais la
        mienne."""
        return self.player is not None and self.player.is_me

    @property
    def deck_version_number(self) -> int | None:
        """Numéro de la version jouée (« v3 »), lu pour `ParticipationRead`."""
        return self.deck_version.number if self.deck_version is not None else None


class TournamentDeckVersion(Base):
    """La version d'un deck dans un tournoi, et la partie qui l'a figée (A9).

    Règle de P3 : dans un tournoi, la liste figée à la première partie où un
    deck est joué est la version de ce deck pour toutes les autres parties du
    tournoi, finale comprise. La clé primaire (`tournament_id`, `deck_id`) la
    tient en base : une seule version par deck et par tournoi. « Première »
    veut dire la première **figée**, pas la ronde au plus petit numéro, d'où
    `frozen_by_game_id`, que l'écran nomme (« figée à la ronde 2 ») et que
    rien d'autre ne permettrait de retrouver après un regel.

    Clés composites vers le tournoi, la version (qui doit être celle du deck,
    par `deck_id`) et la partie, toutes du même compte. Aucune ne cascade :
    supprimer la partie qui a figé est refusé par la base tant que la ligne la
    désigne, et c'est au service de la faire passer à la partie suivante du
    tournoi avec ce deck, ou de la retirer s'il n'en reste aucune.
    """

    __tablename__ = "tournament_deck_version"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tournament_id", "user_id"],
            ["tournament.id", "tournament.user_id"],
        ),
        ForeignKeyConstraint(
            ["deck_version_id", "deck_id", "user_id"],
            ["deck_version.id", "deck_version.deck_id", "deck_version.user_id"],
        ),
        ForeignKeyConstraint(
            ["frozen_by_game_id", "user_id"],
            ["game.id", "game.user_id"],
        ),
    )

    tournament_id: Mapped[int] = mapped_column(primary_key=True)
    deck_id: Mapped[int] = mapped_column(primary_key=True)
    # Pas de clé étrangère simple : les composites l'impliquent toutes.
    user_id: Mapped[int] = mapped_column()
    deck_version_id: Mapped[int] = mapped_column()
    # Indexée : supprimer une partie demande « quelles versions a-t-elle
    # figées ? ».
    frozen_by_game_id: Mapped[int] = mapped_column(index=True)

    deck_version: Mapped[DeckVersion] = relationship(
        primaryjoin="TournamentDeckVersion.deck_version_id == DeckVersion.id",
        foreign_keys="TournamentDeckVersion.deck_version_id",
        viewonly=True,
        lazy="joined",
    )
    frozen_by_game: Mapped[Game] = relationship(
        primaryjoin="TournamentDeckVersion.frozen_by_game_id == Game.id",
        foreign_keys="TournamentDeckVersion.frozen_by_game_id",
        viewonly=True,
    )

    @property
    def deck_version_number(self) -> int:
        """Numéro de la version du tournoi, lu pour `TournamentDeckVersionRead`."""
        return self.deck_version.number
