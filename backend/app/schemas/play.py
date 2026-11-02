"""Schémas des joueurs, parties, tournois et participations (Lot 7).

Note sur les date-heures entrantes : `played_at` exige un instant **avec
fuseau** et le convertit en UTC. Une partie saisie hors ligne à 20h à Paris et
synchronisée le lendemain depuis un autre fuseau doit désigner le même instant
qu'au moment de la saisie ; sans fuseau, « 20:00 » est ambigu et la file de
synchronisation du Lot 3 n'a aucun moyen de trancher. Le stockage, lui, est de
l'UTC naïf (cf. `app.models.types.UtcDateTime`).

`AwareDateTime`, qui porte cette règle, vivait ici ; il est passé dans
`app.schemas.base` au Lot 3, la file de synchronisation en ayant besoin pour
`recorded_at` (`app.schemas.sync`) — deux familles de charges utiles, un seul
endroit où la règle est écrite.

**Désignations plutôt qu'identifiants.** Les écritures désignent le lieu, le
tournoi, chaque joueur et chaque deck par une référence (`app.schemas.refs`) :
l'identifiant serveur, ou la référence client d'un objet créé hors ligne. Les
opérations `/sync` réutilisent ces charges utiles telles quelles (principe du
Lot 3), et une partie saisie au club désigne presque toujours un lieu, un
tournoi ou un adversaire créés dans la même soirée, sans réseau. Les lectures,
elles, rendent des identifiants.

Une écriture **en ligne** ne désigne que par identifiant : une `client_ref` y
est refusée (422, contrôle du service). Le client n'écrit que par la file
(CLAUDE.md §10), et seule `/sync` connaît les références qu'il a créées.

**Le schéma vérifie la forme, le service les règles.** Les schémas ne portent
que des bornes de champ et la règle « exactement une désignation » des
références. Toutes les règles de partie et de tournoi (fonctions pures de
`app.services.vtes_rules`) s'appliquent au service, à la création comme à la
modification. Ce n'est pas qu'une question de place : par `/sync`, un schéma
qui refuse fait échouer le **lot entier** en 422, sans verdict, alors qu'un
refus du service est le verdict `invalid` d'une seule opération, avec son
message, que l'écran Synchronisation sait corriger (décision du 2026-10-29,
après la revue de l'étape A2).
"""

from datetime import date, datetime

from pydantic import Field

from app.models.enums import (
    DeckPolicy,
    EventTier,
    FinalDeckRule,
    RoundType,
    TournamentFormat,
)
from app.schemas.base import (
    MAX_DB_INT,
    UNSET,
    AwareDateTime,
    ReadModel,
    RequiredText,
    WriteModel,
)
from app.schemas.refs import DeckRef, ParticipantRef, TournamentRef, VenueRef
from app.services.vtes_rules import VP_STEP

MAX_TABLE_SIZE = 6
"""Plus grande table que l'outil accepte. Borne de saisie, pas règle VEKN (une
table de tournoi compte 4 ou 5 joueurs) : elle refuse une faute de frappe, un
42 au lieu d'un 4, et borne du même coup sièges, VP et lignes de table."""



# --------------------------------------------------------------------------
# Joueurs
# --------------------------------------------------------------------------


class PlayerRead(ReadModel):
    """Un joueur : le « Moi » du compte, ou un adversaire nommé."""

    id: int
    name: str
    is_me: bool = Field(
        description=(
            "Vrai pour le seul joueur qui est l'utilisateur. Créé par le serveur, "
            "il ne se crée ni ne se supprime par l'API."
        )
    )
    game_count: int = Field(
        description=(
            "Parties où ce joueur figure à la table, calculé par le serveur. Un "
            "adversaire qui figure à une table ne se supprime pas."
        )
    )


class PlayerCreate(WriteModel):
    """Création d'un adversaire. Le « Moi » existe déjà (A1)."""

    name: RequiredText = Field(max_length=80)


class PlayerUpdate(WriteModel):
    """Renommage d'un joueur, « Moi » compris. Le nom est facultatif mais non
    nullable : la colonne est NOT NULL, donc facultatif ne veut pas dire
    « effaçable »."""

    name: RequiredText = Field(default=UNSET, max_length=80)


# --------------------------------------------------------------------------
# Participations : une ligne de la table
# --------------------------------------------------------------------------


class ParticipationSummary(ReadModel):
    """Ma ligne d'une partie, en résumé : ce qu'une liste affiche."""

    deck_id: int | None = None
    seat: int | None = None
    victory_points: float | None = None
    game_win: bool | None = None


class ParticipationRead(ReadModel):
    """La place d'un joueur sur une partie.

    Seule ma ligne porte un résultat (VP, GW) : on ne suit pas la performance
    des joueurs rencontrés (A13). Une ligne d'adversaire peut porter l'un de mes
    decks, prêté pour la partie (P4).
    """

    id: int
    game_id: int
    player_id: int
    is_me: bool = Field(description="Vrai pour ma ligne, la seule à porter VP et GW.")
    deck_id: int | None = None
    seat: int | None = Field(
        default=None,
        description="Siège à la table, 1 = premier joueur.",
    )
    victory_points: float | None = Field(
        default=None,
        description=(
            "Mes VP, par demi-points ; toujours nul sur une ligne d'adversaire."
        ),
    )
    game_win: bool | None = Field(
        default=None,
        description="Mon Game Win ; toujours nul sur une ligne d'adversaire.",
    )
    notes: str | None = None


class ParticipationCreate(WriteModel):
    """Une ligne de la table, dans une partie saisie ou remplacée d'un bloc.

    `player` désigne le joueur : `{"me": true}`, un adversaire par `player_id`,
    ou, par `/sync`, un adversaire créé hors ligne par `client_ref`. `deck` est
    mon deck sur ma ligne, un deck prêté sur celle d'un adversaire (P4).
    `victory_points` et `game_win` ne sont acceptés que sur ma ligne (A13) ;
    laissé vide, le GW est posé par le serveur quand il est certain (A4). Table
    (exactement une ligne « Moi », joueurs et sièges distincts), bornes
    relatives à la table et GW : contrôles du service, après résolution des
    joueurs (`vtes_rules.table_issues`).
    """

    player: ParticipantRef
    deck: DeckRef | None = None
    seat: int | None = Field(default=None, ge=1, le=MAX_TABLE_SIZE)
    victory_points: float | None = Field(
        default=None, ge=0, le=MAX_TABLE_SIZE, multiple_of=VP_STEP
    )
    game_win: bool | None = None
    notes: str | None = None


TableLines = list[ParticipationCreate]

_TABLE_FIELD = {
    "min_length": 1,
    "max_length": MAX_TABLE_SIZE,
    "description": (
        "La table entière, ma ligne comprise (exactement une). Les adversaires "
        "sont facultatifs : une table peut se réduire à ma seule participation."
    ),
}


class GameTableReplace(WriteModel):
    """Remplacement de la table d'une partie (`PUT /parties/{id}/participations`).

    La table se remplace d'un bloc, jamais ligne à ligne (A3) : c'est la seule
    façon de vérifier les règles qui portent sur toute la table sans état
    intermédiaire faux.
    """

    participations: TableLines = Field(**_TABLE_FIELD)


# --------------------------------------------------------------------------
# Parties
# --------------------------------------------------------------------------


class GameRead(ReadModel):
    """Une partie, telle qu'une liste l'affiche : ma ligne en résumé et le nom
    du tournoi, pour lire une liste sans un appel par partie."""

    id: int
    played_at: datetime
    venue_id: int | None = None
    tournament_id: int | None = None
    tournament_name: str | None = None
    round_number: int | None = None
    round_type: RoundType
    player_count: int
    me: ParticipationSummary = Field(description="Ma ligne de la table, en résumé.")
    notes: str | None = None
    created_at: datetime
    updated_at: datetime


class GameDetailRead(GameRead):
    """Une partie avec la table complète."""

    participations: list[ParticipationRead] = []


class GameCreate(WriteModel):
    """Création d'une partie, table comprise.

    Au club, une partie se saisit d'une traite, souvent hors ligne, et la file
    de synchronisation a tout intérêt à rejouer une seule opération plutôt que
    six. Une partie hors tournoi est amicale ; une partie de tournoi est une
    préliminaire numérotée ou une finale (A6, contrôle du service).
    """

    played_at: AwareDateTime = Field(
        description="Instant de la partie, fuseau obligatoire, normalisé en UTC.",
    )
    venue: VenueRef | None = None
    tournament: TournamentRef | None = None
    round_number: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    round_type: RoundType = RoundType.CASUAL
    player_count: int = Field(
        ge=2,
        le=MAX_TABLE_SIZE,
        description="Joueurs à la table : 4 ou 5 en tournoi, de 2 à 6 acceptés.",
    )
    notes: str | None = None
    participations: TableLines = Field(**_TABLE_FIELD)


class GameUpdate(WriteModel):
    """Modification d'une partie, hors table (`PUT …/participations` pour elle).

    `played_at`, `round_type` et `player_count` sont facultatifs mais non
    nullables ; le lieu, le tournoi, la ronde et les notes peuvent, eux, être
    remis à `null`. Tournoi et ronde se contrôlent sur l'état fusionné, au
    service.
    """

    played_at: AwareDateTime = UNSET
    venue: VenueRef | None = None
    tournament: TournamentRef | None = None
    round_number: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    round_type: RoundType = UNSET
    player_count: int = Field(default=UNSET, ge=2, le=MAX_TABLE_SIZE)
    notes: str | None = None


# --------------------------------------------------------------------------
# Tournois
# --------------------------------------------------------------------------


class TournamentSummary(ReadModel):
    """Mon bilan d'un tournoi (A12), calculé par le serveur.

    GW puis VP des préliminaires, dans l'ordre du classement VEKN réduit à ses
    deux premiers critères (pas de points de tournoi, P7) ; puis le nombre de
    rondes jouées et la finale. Des VP non saisis comptent pour 0.
    """

    preliminary_game_wins: int
    preliminary_victory_points: float
    rounds_played: int = Field(description="Rondes préliminaires jouées.")
    final_victory_points: float | None = Field(
        default=None, description="Mes VP en finale ; nul sans finale."
    )
    final_game_win: bool | None = Field(
        default=None, description="Mon GW en finale ; nul sans finale."
    )


class TournamentRead(ReadModel):
    """Un tournoi et mon bilan."""

    id: int
    name: str
    start_date: date
    end_date: date | None = None
    venue_id: int | None = None
    deck_policy: DeckPolicy = Field(
        description=(
            "Mono-deck : le même deck sur toutes mes rondes, finale comprise. "
            "Multi : deck libre par ronde."
        )
    )
    format: TournamentFormat
    event_tier: EventTier = Field(
        description=(
            "Niveau du tournoi. Le multi-deck est interdit en championnat "
            "national, en Grand Prix et en championnat continental."
        )
    )
    final_deck_rule: FinalDeckRule | None = Field(
        default=None,
        description=(
            "Règle du deck de finale annoncée par l'organisateur, en multi-deck "
            "seulement ; nulle tant qu'elle n'est pas connue."
        ),
    )
    round_count: int | None = None
    player_count: int | None = Field(
        default=None,
        description="Nombre de joueurs du tournoi, souvent inconnu à l'arrivée.",
    )
    my_ranking: int | None = None
    my_summary: TournamentSummary
    notes: str | None = None
    created_at: datetime
    updated_at: datetime


class TournamentDetailRead(TournamentRead):
    """Un tournoi, mes parties dans l'ordre des rondes (finale en dernier) et
    les decks admis en finale."""

    games: list[GameRead] = []
    admissible_final_decks: list[int] | None = Field(
        default=None,
        description=(
            "Decks que ma finale peut jouer, en multi-deck selon la règle "
            "annoncée ; nul quand rien n'est contrôlable (mono-deck, règle "
            "inconnue, aucune préliminaire jouée avec un deck)."
        ),
    )



class TournamentCreate(WriteModel):
    """Création d'un tournoi.

    Niveau et multi-deck, règle de finale, dates et classement se contrôlent au
    service (A11, A12), comme pour une modification, qui se contrôle en plus
    sur l'état fusionné et contre les parties.
    """

    name: RequiredText = Field(max_length=120)
    start_date: date
    end_date: date | None = None
    venue: VenueRef | None = None
    deck_policy: DeckPolicy = DeckPolicy.MONO
    format: TournamentFormat = TournamentFormat.CONSTRUCTED
    event_tier: EventTier = EventTier.STANDARD
    final_deck_rule: FinalDeckRule | None = None
    round_count: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    player_count: int | None = Field(default=None, ge=2, le=MAX_DB_INT)
    my_ranking: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    notes: str | None = None


class TournamentUpdate(WriteModel):
    """Modification partielle d'un tournoi.

    `name`, `start_date`, `deck_policy`, `format` et `event_tier` sont
    facultatifs mais non nullables ; la date de fin, le lieu, la règle du deck
    de finale, le nombre de rondes, le nombre de joueurs, le classement et les
    notes acceptent `null`.
    """

    name: RequiredText = Field(default=UNSET, max_length=120)
    start_date: date = UNSET
    end_date: date | None = None
    venue: VenueRef | None = None
    deck_policy: DeckPolicy = UNSET
    format: TournamentFormat = UNSET
    event_tier: EventTier = UNSET
    final_deck_rule: FinalDeckRule | None = None
    round_count: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    player_count: int | None = Field(default=None, ge=2, le=MAX_DB_INT)
    my_ranking: int | None = Field(default=None, ge=1, le=MAX_DB_INT)
    notes: str | None = None
