"""Règles métier VtES — fonctions pures, sans base ni HTTP (skill `regles-vtes`).

Périmètre : la légalité d'un deck (CLAUDE.md §5, Lot 2) et celle d'une carte
seule à une date (lot Chercher, A5), puis le score d'une partie et les
contrôles de tournoi (Lot 7, plus bas), enfin la secte d'une carte de crypte et
l'exigence d'une carte de bibliothèque (lot Chercher, P13 et P15, en fin de
module). Ces derniers suivent les
règles de tournoi de la VEKN (vekn.net/tournament-rules), relues le 2026-10-28 et
adoptées pour le Lot 7 ; les sections sont citées entre parenthèses.

Légalité d'un deck, cinq règles :

* crypt ≥ 12 cartes ;
* crypt limitée à **deux groupes au plus, et adjacents** (1+2, 2+3, …, 6+7 ;
  jamais 2+4) — un seul groupe est toujours permis, les cartes de groupe « Any »
  sont neutres ;
* library entre 60 et 90 cartes, bornes incluses ;
* aucune carte bannie : une carte l'est **à partir de sa `banned_on`**, c'est-à-dire
  dès que la date d'évaluation atteint ou dépasse cette date ;
* aucune carte pas encore légale : une carte l'est **à partir de sa
  `legal_from`**, donc une date strictement postérieure à la date d'évaluation
  la rend injouable. Sans date, la carte est tenue pour légale — la liste krcg
  paraît après la sortie commerciale, l'absence n'y vaut pas interdiction.

Les deux dates suivent la même convention (« à partir de »), et toutes deux se
lisent à une **date d'évaluation** passée en paramètre, jamais à l'horloge : un
verdict doit pouvoir être rejoué à l'identique, en test comme dans un historique.

Les proxies comptent dans les effectifs : un proxy tient la place de la carte.

Les cartes circulent ici sous forme de **libellés déjà formés** (cf.
`card_label`) : ces fonctions n'ont pas à connaître le modèle, et un nom seul ne
désigne pas une carte de crypt (trois « Theo Bell » distincts au catalogue).
"""

import re
from collections.abc import Collection, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import date
from typing import NamedTuple

from app.models.enums import DeckPolicy, EventTier, FinalDeckRule, RoundType

CRYPT_MINIMUM = 12
LIBRARY_MINIMUM = 60
LIBRARY_MAXIMUM = 90

_GROUP_CODE = re.compile(r"G([0-9]+)")
"""`[0-9]` et non `\\d` : `\\d` couvre les chiffres Unicode, et « G٣ » n'est pas
un code de groupe. Lu avec `fullmatch`, qui ne tolère pas non plus le saut de
ligne final qu'un `$` aurait laissé passer."""


def crypt_group(group_code: str | None) -> int | None:
    """Numéro de groupe d'une carte de crypt (`"G3"` → 3) ; `None` si neutre.

    « Any » (deux cartes chez krcg) et toute valeur absente ou inattendue sont
    neutres : elles ne comptent dans aucun groupe.
    """
    match = _GROUP_CODE.fullmatch(group_code or "")
    return int(match.group(1)) if match else None


def card_label(
    name: str, group_code: str | None = None, advanced: bool = False
) -> str:
    """Libellé qui désigne une carte sans ambiguïté.

    « Theo Bell (G2) », « Theo Bell (G2, Adv) », et le nom seul pour une carte
    de library ou un vampire de groupe « Any » — le triplet (nom, groupe,
    *advanced*) est unique sur les cartes de crypt du catalogue.
    """
    marks: list[str] = []
    if group_code and crypt_group(group_code) is not None:
        marks.append(group_code)
    if advanced:
        marks.append("Adv")
    return f"{name} ({', '.join(marks)})" if marks else name


def group_issues(groups: Collection[int]) -> list[str]:
    """Erreurs sur les groupes de la crypt : au plus deux, et consécutifs."""
    distinct = sorted(set(groups))
    if len(distinct) <= 1:
        return []
    if len(distinct) == 2 and distinct[1] - distinct[0] == 1:
        return []
    names = ", ".join(f"G{group}" for group in distinct)
    return [
        f"Groupes de crypt incompatibles : {names}. Deux groupes adjacents au "
        "plus (G1+G2, G2+G3…), « Any » mis à part."
    ]


def _is_banned(banned_on: date | None, on: date) -> bool:
    """Bannie **à partir de** `banned_on`, jour compris ; jamais sans date."""
    return banned_on is not None and banned_on <= on


def _is_not_yet_legal(legal_from: date | None, on: date) -> bool:
    """Pas encore légale tant que `legal_from` est **strictement** postérieure
    à `on` ; légale sans date."""
    return legal_from is not None and legal_from > on


class CardLegality(NamedTuple):
    """Verdict de légalité d'une carte seule à une date (lot Chercher, A5).

    Deux booléens qui **ne s'excluent pas** : *Playing for Keeps*, bannie le
    1995-11-01 et légale à partir du 1996-01-14, est les deux à la fois entre
    ces deux dates. La carte est légale quand aucun des deux n'est vrai. Un
    n-uplet nommé : `banned, not_yet_legal = card_legality(...)` se lit aussi.
    """

    banned: bool
    not_yet_legal: bool


def card_legality(
    banned_on: date | None, legal_from: date | None, on: date
) -> CardLegality:
    """Légalité d'une carte à la date `on` (lot Chercher, A5).

    Même règle que `banned_cards` et `not_yet_legal_cards`, qui passent par
    les mêmes deux prédicats. La date est un paramètre : seul l'appelant lit
    l'horloge, à la date UTC (`_today()` côté service).

    Une jumelle TypeScript (`frontend/src/offline/vtes/`, étape C1b) compare
    des chaînes ISO `YYYY-MM-DD` ; les deux lisent la même table de cas,
    `backend/tests/fixtures/card_legality_cases.json`.
    """
    return CardLegality(
        banned=_is_banned(banned_on, on),
        not_yet_legal=_is_not_yet_legal(legal_from, on),
    )


def banned_cards(cards: Iterable[tuple[str, date | None]], on: date) -> list[str]:
    """Libellés (triés, sans doublon) des cartes bannies à la date `on`.

    `cards` : couples (libellé, `banned_on`), le libellé venant de `card_label`.
    Une carte est bannie **à partir de** cette date, jour compris ; sans date,
    elle ne l'est jamais, et une date future ne l'est pas encore.
    """
    return sorted({name for name, banned_on in cards if _is_banned(banned_on, on)})


def not_yet_legal_cards(
    cards: Iterable[tuple[str, date | None]], on: date
) -> list[str]:
    """Libellés (triés, sans doublon) des cartes pas encore légales le jour `on`.

    `cards` : couples (libellé, `legal_from`). Une carte est légale **à partir
    de** cette date, jour compris ; elle ne l'est donc pas encore si la date
    est strictement postérieure à `on`. Sans date, elle est tenue pour légale :
    la liste krcg paraît après la sortie commerciale, et l'absence d'information
    ne vaut pas interdiction.
    """
    return sorted(
        {name for name, legal_from in cards if _is_not_yet_legal(legal_from, on)}
    )


def deck_issues(
    crypt_count: int,
    library_count: int,
    *,
    crypt_groups: Collection[int] = (),
    banned: Collection[str] = (),
    not_yet_legal: Collection[str] = (),
) -> list[str]:
    """Raisons pour lesquelles un deck n'est pas légal ; vide s'il l'est.

    `crypt_groups` reçoit des **numéros** (2, 3) ; le format « G2 » n'apparaît
    que dans les messages. `banned` et `not_yet_legal` reçoivent des libellés
    déjà formés (`card_label`).
    """
    issues: list[str] = []
    if crypt_count < CRYPT_MINIMUM:
        issues.append(
            f"Crypt trop petite : {crypt_count} carte(s), {CRYPT_MINIMUM} minimum."
        )
    issues.extend(group_issues(crypt_groups))
    if library_count < LIBRARY_MINIMUM:
        issues.append(
            f"Library trop petite : {library_count} carte(s), "
            f"{LIBRARY_MINIMUM} minimum."
        )
    elif library_count > LIBRARY_MAXIMUM:
        issues.append(
            f"Library trop grande : {library_count} carte(s), "
            f"{LIBRARY_MAXIMUM} maximum."
        )
    if banned:
        issues.append(f"Carte(s) bannie(s) : {', '.join(sorted(banned))}.")
    if not_yet_legal:
        labels = ", ".join(sorted(not_yet_legal))
        issues.append(f"Carte(s) pas encore légale(s) : {labels}.")
    return issues


def deck_is_legal(
    crypt_count: int,
    library_count: int,
    *,
    crypt_groups: Collection[int] = (),
    banned: Collection[str] = (),
    not_yet_legal: Collection[str] = (),
) -> bool:
    """Toutes les règles ci-dessus sont respectées."""
    return not deck_issues(
        crypt_count,
        library_count,
        crypt_groups=crypt_groups,
        banned=banned,
        not_yet_legal=not_yet_legal,
    )


# --------------------------------------------------------------------------
# Score d'une partie (Lot 7)
# --------------------------------------------------------------------------
#
# On ne suit que ses propres VP et son propre GW (P7 du plan du Lot 7) : ni les
# VP des adversaires, ni la place à la table, ni les points de tournoi. Les
# seuls contrôles possibles sont ceux qui se tirent de mes VP et de la taille
# de la table.

GAME_WIN_MINIMUM_VP = 2.0
"""Seuil du Game Win, à toute table (3.7.1). Constante nommée : une évolution du
règlement ne touche que cette ligne et son double TypeScript
(`frontend/src/offline/vtes/`, A14 du plan du Lot 7)."""

VP_STEP = 0.5
"""Tous les VP sont des multiples de 0,5 (3.7.2)."""

FINAL_TABLE_SIZE = 5
"""La table finale réunit les cinq mieux classés (3.1)."""

MULTI_DECK_FORBIDDEN_TIERS = frozenset(
    {
        EventTier.NATIONAL_CHAMPIONSHIP,
        EventTier.GRAND_PRIX,
        EventTier.CONTINENTAL_CHAMPIONSHIP,
    }
)
"""Niveaux où le multi-deck est interdit (3.1.5)."""


def _vp(value: float) -> str:
    """« 2,5 » : les messages parlent français, virgule décimale comprise."""
    return f"{value:g}".replace(".", ",")


def vp_issues(player_count: int, vp: float | None) -> list[str]:
    """Mes VP sont positifs, par demi-points, au plus la taille de la table (A5).

    Une table de *n* joueurs distribue au plus *n* VP en tout, donc un joueur
    seul n'en dépasse jamais *n*. Des VP non saisis ne sont pas une erreur.
    """
    if vp is None:
        return []
    issues: list[str] = []
    if vp < 0:
        issues.append(f"VP négatifs : {_vp(vp)}.")
    if vp % VP_STEP != 0:
        issues.append(f"VP par demi-points seulement : {_vp(vp)} n'en est pas un.")
    if vp > player_count:
        issues.append(
            f"{_vp(vp)} VP à une table de {player_count} joueurs : "
            f"{player_count} au plus."
        )
    return issues


def certain_game_win(
    player_count: int, vp: float | None, minimum: float = GAME_WIN_MINIMUM_VP
) -> bool | None:
    """`True` quand mon GW est certain, `None` quand rien ne le dit (A4).

    Avec plus de la moitié des VP que la table peut encore distribuer, je suis
    forcément seul en tête ; avec au moins `minimum` VP en plus, j'ai le GW.
    Hors de ce cas, le GW dépend des VP des autres, qu'on ne saisit pas, et la
    déclaration fait foi. Jamais `False` : moins de 2 VP interdit le GW, mais
    c'est `game_win_issues` qui le dit, pas une déduction.

    Règle **déduite** du barème 3.7.2, qui ne l'écrit pas (correction du
    2026-11-02, décidée par l'utilisateur). Une table de *n* joueurs distribue
    au plus *n* VP. Une demi-VP ne vient que d'une fin au temps (0,5 à chaque
    survivant, deux au moins) ou d'un retrait (0,5 au joueur, rien à son
    prédateur) : chacun de ces cas ôte au moins 0,5 VP au total, qui vaut alors
    au plus *n* − 1 ou *n* − 0,5. Avec des VP non entières, le total de la table
    est donc borné par *n* − 0,5, et je suis seul en tête dès que
    `vp > (n − 0,5) − vp` ; avec des VP entières, la borne reste *n*. Seuils
    obtenus : 2 VP à deux et à trois, 2,5 VP à quatre **et à cinq**, 3,5 VP à
    six. Vérifiés par énumération de toutes les fins de partie possibles
    (`backend/tests/test_vtes_rules_play.py`).
    """
    if vp is None or vp < minimum:
        return None
    table_total = player_count - VP_STEP if vp % 1 == VP_STEP else player_count
    if vp > table_total - vp:
        return True
    return None


def game_win_issues(
    player_count: int, vp: float | None, declared: bool | None
) -> list[str]:
    """Ce qui contredit le GW déclaré (A4).

    Un GW suppose au moins 2 VP, donc des VP saisis ; un GW certain ne peut pas
    être déclaré absent. Un GW laissé vide n'est jamais une erreur : le service
    le résout par `resolved_game_win`.
    """
    if declared is True and (vp is None or vp < GAME_WIN_MINIMUM_VP):
        shown = "sans VP saisis" if vp is None else f"avec {_vp(vp)} VP"
        return [
            f"Game Win {shown} : il en faut au moins {_vp(GAME_WIN_MINIMUM_VP)}."
        ]
    if declared is False and certain_game_win(player_count, vp):
        return [
            f"{_vp(vp)} VP à une table de {player_count} joueurs : seul en tête "
            f"avec au moins {_vp(GAME_WIN_MINIMUM_VP)} VP, le Game Win est acquis."
        ]
    return []


def resolved_game_win(
    player_count: int, vp: float | None, declared: bool | None
) -> bool | None:
    """Le GW à enregistrer : la déclaration, ou à défaut le GW certain."""
    return declared if declared is not None else certain_game_win(player_count, vp)


# --------------------------------------------------------------------------
# Rondes et tournois (Lot 7)
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class RoundResult:
    """Ma participation à une ronde, réduite à ce que les règles regardent."""

    deck_id: int | None
    victory_points: float | None
    game_win: bool | None


@dataclass(frozen=True)
class TournamentTally:
    """Mon bilan d'un tournoi (A12) : GW et VP des préliminaires, puis la finale.

    L'ordre est celui du classement VEKN des préliminaires, réduit à ses deux
    premiers critères (3.1 ; les TP ne sont pas suivis). `final_*` sont nuls
    sans finale.
    """

    preliminary_game_wins: int
    preliminary_victory_points: float
    rounds_played: int
    final_victory_points: float | None
    final_game_win: bool | None


def round_issues(
    round_type: RoundType,
    in_tournament: bool,
    round_number: int | None,
    round_count: int | None = None,
) -> list[str]:
    """Tournoi et ronde se tiennent (A6).

    Une partie hors tournoi est amicale ; une partie de tournoi est une
    préliminaire numérotée ou une finale sans numéro. Le numéro ne dépasse pas
    le nombre de rondes prévues, s'il est connu. L'unicité d'une ronde parmi mes
    parties du tournoi est l'affaire des index de la base.
    """
    issues: list[str] = []
    if round_type is RoundType.CASUAL and in_tournament:
        issues.append(
            "Une partie de tournoi est une préliminaire ou une finale, pas une "
            "partie amicale."
        )
    if round_type is not RoundType.CASUAL and not in_tournament:
        issues.append("Une préliminaire ou une finale appartient à un tournoi.")
    if round_type is RoundType.PRELIMINARY and round_number is None:
        issues.append("Une ronde préliminaire porte son numéro.")
    if round_type is not RoundType.PRELIMINARY and round_number is not None:
        issues.append("Seule une ronde préliminaire porte un numéro.")
    if (
        round_type is RoundType.PRELIMINARY
        and round_number is not None
        and round_count is not None
        and round_number > round_count
    ):
        issues.append(f"Ronde {round_number} d'un tournoi en {round_count} ronde(s).")
    return issues


@dataclass(frozen=True)
class TableLine:
    """Une ligne de table, une fois le joueur résolu en identifiant. Une ligne
    d'adversaire non nommé (Lot 8, P6) n'a pas de joueur."""

    player_id: int | None
    is_me: bool
    seat: int | None


def table_issues(player_count: int, lines: Iterable[TableLine]) -> list[str]:
    """Une table se tient (A2, A5) : exactement une ligne « Moi », aucun joueur
    ni siège répété (une ligne sans joueur n'a pas d'identité à répéter), au plus
    `player_count` lignes et sièges.

    À appeler **après** la résolution des joueurs : un adversaire désigné une
    fois par identifiant et une fois par référence client, ou un « Moi »
    désigné par son identifiant, ne se voient qu'une fois résolus.
    """
    lines = list(lines)
    issues: list[str] = []
    mine = sum(1 for line in lines if line.is_me)
    if mine == 0:
        issues.append("La table ne contient pas ma participation.")
    elif mine > 1:
        issues.append("La table contient plusieurs fois ma participation.")
    players = [line.player_id for line in lines if line.player_id is not None]
    if len(players) != len(set(players)):
        issues.append("La table désigne plusieurs fois le même joueur.")
    seats = [line.seat for line in lines if line.seat is not None]
    if len(seats) != len(set(seats)):
        issues.append("Deux joueurs de la table occupent le même siège.")
    if len(lines) > player_count:
        issues.append(
            f"{len(lines)} lignes pour une table de {player_count} joueurs."
        )
    if any(seat > player_count for seat in seats):
        issues.append(
            f"Siège au-delà de la table : {player_count} joueurs, sièges 1 à "
            f"{player_count}."
        )
    return issues


def date_range_issues(start_date: date, end_date: date | None) -> list[str]:
    """Un tournoi ne finit pas avant d'avoir commencé."""
    if end_date is not None and end_date < start_date:
        return [
            f"Fin du tournoi ({end_date:%d/%m/%Y}) avant son début "
            f"({start_date:%d/%m/%Y})."
        ]
    return []


def _deck_label(deck_id: int, labels: Mapping[int, str]) -> str:
    return labels.get(deck_id, f"deck {deck_id}")


def _deck_list(deck_ids: Iterable[int], labels: Mapping[int, str]) -> str:
    return ", ".join(sorted(_deck_label(deck_id, labels) for deck_id in deck_ids))


def mono_deck_issues(
    deck_ids: Iterable[int | None], labels: Mapping[int, str] | None = None
) -> list[str]:
    """Un tournoi mono-deck se joue avec un seul deck, finale comprise (A7).

    `deck_ids` : les decks de **mes** participations ; un deck prêté à un
    adversaire n'en fait pas partie (P4). Une ronde sans deck saisi est ignorée.
    `labels` donne le nom des decks pour le message.
    """
    distinct = {deck_id for deck_id in deck_ids if deck_id is not None}
    if len(distinct) <= 1:
        return []
    return [
        "Tournoi mono-deck joué avec plusieurs decks : "
        f"{_deck_list(distinct, labels or {})}."
    ]


def multi_deck_tier_issues(deck_policy: DeckPolicy, event_tier: EventTier) -> list[str]:
    """Le multi-deck est interdit à trois niveaux de championnat (3.1.5, A11)."""
    if deck_policy is DeckPolicy.MULTI and event_tier in MULTI_DECK_FORBIDDEN_TIERS:
        return [
            "Multi-deck interdit en championnat national, en Grand Prix et en "
            "championnat continental."
        ]
    return []


def final_deck_rule_issues(
    deck_policy: DeckPolicy, rule: FinalDeckRule | None
) -> list[str]:
    """Une règle de deck en finale n'a de sens qu'en multi-deck (3.1.5a, A11)."""
    if deck_policy is DeckPolicy.MONO and rule is not None:
        return [
            "Règle de deck en finale annoncée pour un tournoi mono-deck : elle "
            "ne vaut qu'en multi-deck."
        ]
    return []


def admissible_final_decks(
    rule: FinalDeckRule | None, preliminaries: Iterable[RoundResult]
) -> set[int] | None:
    """Les decks que ma finale peut jouer en multi-deck (3.1.5a, A11).

    `None` quand rien n'est contrôlable : règle inconnue, aucune préliminaire
    jouée avec un deck, ou une saisie incomplète qui pourrait changer la
    réponse. Un ensemble vide ne se produit pas, mais ne dirait pas la même
    chose (aucun deck admis).

    * choix libre : n'importe quel deck de mes préliminaires. Une ronde sans
      deck saisi a pu être jouée avec n'importe lequel : rien n'est contrôlable.
    * meilleur deck : celui de ma meilleure ronde, comparée par GW puis VP. Le
      TP, troisième critère, n'est pas suivi : tous les decks à égalité sur GW
      et VP sont admis, comme l'issue du tirage au sort qui les départagerait.
      Un GW non saisi vaut « pas de GW ».

    Le contrôle peut être plus permissif que le règlement, jamais plus strict :
    une ronde dont les VP manquent peut être la meilleure, son deck est admis ;
    une ronde sans deck qui pourrait égaler la meilleure (VP manquants, ou
    score au moins égal) rend le contrôle impossible, puisque le deck qu'elle
    imposerait est inconnu.
    """
    played = [round_ for round_ in preliminaries if round_.deck_id is not None]
    deckless = [round_ for round_ in preliminaries if round_.deck_id is None]
    if rule is None or not played:
        return None
    if rule is FinalDeckRule.FREE_CHOICE:
        return None if deckless else {round_.deck_id for round_ in played}

    def score(round_: RoundResult) -> tuple[bool, float]:
        return (round_.game_win is True, round_.victory_points or 0.0)

    known = [round_ for round_ in played if round_.victory_points is not None]
    unknown = {round_.deck_id for round_ in played if round_.victory_points is None}
    best = max((score(round_) for round_ in known), default=None)
    for round_ in deckless:
        if best is None or round_.victory_points is None or score(round_) >= best:
            return None
    return unknown | {round_.deck_id for round_ in known if score(round_) == best}


def final_deck_issues(
    rule: FinalDeckRule | None,
    preliminaries: Iterable[RoundResult],
    final_deck_id: int | None,
    labels: Mapping[int, str] | None = None,
) -> list[str]:
    """Le deck de ma finale respecte la règle annoncée (A11).

    Une finale sans deck saisi n'est pas contrôlée, ni une finale dont les
    decks admis ne sont pas calculables (`admissible_final_decks` à `None`).
    Le message nomme le ou les decks admis.
    """
    admissible = admissible_final_decks(rule, preliminaries)
    if final_deck_id is None or admissible is None or final_deck_id in admissible:
        return []
    labels = labels or {}
    played = _deck_label(final_deck_id, labels)
    allowed = _deck_list(admissible, labels)
    if rule is FinalDeckRule.FREE_CHOICE:
        return [
            f"Finale jouée avec {played}, qui n'a joué aucune préliminaire ; "
            f"deck(s) admis : {allowed}."
        ]
    return [
        f"Finale jouée avec {played} ; meilleur deck des préliminaires : {allowed}."
    ]


def ranking_issues(
    my_ranking: int | None,
    player_count: int | None,
    played_final: bool,
    final_game_win: bool | None,
) -> list[str]:
    """Mon classement final saisi est plausible (3.7.5, A12).

    Il ne dépasse pas le nombre de joueurs ; un finaliste est classé de 1 à 5
    (les battus sont deuxièmes ex aequo au règlement, mais beaucoup
    d'organisateurs publient un ordre complet) ; un GW en finale implique la
    victoire, puisqu'il suppose strictement le plus de VP de la table. L'inverse
    ne se contrôle pas : on gagne une finale sans GW, avec 1,5 VP seul en tête.
    """
    if my_ranking is None:
        return []
    issues: list[str] = []
    if player_count is not None and my_ranking > player_count:
        issues.append(f"Classé {my_ranking}e d'un tournoi de {player_count} joueurs.")
    if played_final and my_ranking > FINAL_TABLE_SIZE:
        issues.append(
            f"Classé {my_ranking}e après avoir joué la finale : un finaliste "
            f"finit entre 1 et {FINAL_TABLE_SIZE}."
        )
    if played_final and final_game_win is True and my_ranking != 1:
        issues.append(
            f"Classé {my_ranking}e avec un Game Win en finale : le GW de finale "
            "donne la victoire."
        )
    return issues


def tournament_summary(
    preliminaries: Iterable[RoundResult], final: RoundResult | None
) -> TournamentTally:
    """Mon bilan d'un tournoi (A12). Des VP non saisis comptent pour 0."""
    rounds = list(preliminaries)
    return TournamentTally(
        preliminary_game_wins=sum(1 for r in rounds if r.game_win is True),
        preliminary_victory_points=sum(r.victory_points or 0.0 for r in rounds),
        rounds_played=len(rounds),
        final_victory_points=None if final is None else final.victory_points or 0.0,
        final_game_win=None if final is None else final.game_win is True,
    )


# --------------------------------------------------------------------------
# Secte et exigences des cartes (lot Chercher, P13 et P15)
# --------------------------------------------------------------------------
#
# Deux lectures du catalogue faites une seule fois, côté serveur : la secte
# d'une carte de crypte, dérivée de son texte à l'import (krcg ne la publie
# pas), et l'exigence d'une carte de bibliothèque (`vteslibmeta.csv` de
# vtescsv), lue à chaque sortie de `GET /cartes`. Le client ne fait que
# comparer des listes : aucune de ces deux règles n'a de jumelle TypeScript.
# Les deux suivent VDB (`smeea/vdb`, `update/generate_crypt.py` et
# `update/generate_library.py`, relus le 2026-11-03), aux écarts près que
# chaque docstring signale.

SECTS: tuple[str, ...] = (
    "Camarilla",
    "Sabbat",
    "Laibon",
    "Independent",
    "Anarch",
    "Imbued",
)
"""Noms canoniques des sectes, dans l'ordre de VDB. Ce sont aussi les noms de
la table `sect` et ceux des sectes exigées par une carte de bibliothèque : le
client compare les deux côtés avec le même vocabulaire."""

IMBUED_SECT = "Imbued"

_SECT_BY_KEY = {sect.casefold(): sect for sect in SECTS}
_VAMPIRE_SECTS = frozenset(SECTS) - {IMBUED_SECT}
_WORDS = re.compile(r"\W+")


def crypt_sect(card_text: str | None, *, imbued: bool) -> str | None:
    """Secte d'une carte de crypte, dérivée du texte comme le fait VDB (P13).

    Un *imbued* est « Imbued ». Un vampire prend le premier mot de son texte,
    ou le second quand le premier est « Advanced » (« Advanced, Sabbat: … »),
    s'il nomme l'une des cinq sectes de vampire ; la casse est normalisée.
    Sinon `None` : l'import signale la carte, il ne devine pas.

    Un *advanced* dont le texte fusionné (`[MERGED]`) change de secte garde
    celle de sa face, comme chez VDB : six cartes au 2026-11-03, listées dans
    `backend/tests/fixtures/crypt_sect_cases.json`.
    """
    if imbued:
        return IMBUED_SECT
    words = [word for word in _WORDS.split(card_text or "") if word]
    if words[:1] == ["Advanced"]:
        words = words[1:]
    sect = _SECT_BY_KEY.get(words[0].casefold()) if words else None
    return sect if sect in _VAMPIRE_SECTS else None


TITLE_SECTS: Mapping[str, tuple[str, str]] = {
    "primogen": ("Primogen", "Camarilla"),
    "prince": ("Prince", "Camarilla"),
    "justicar": ("Justicar", "Camarilla"),
    "imperator": ("Imperator", "Camarilla"),
    "inner circle": ("Inner Circle", "Camarilla"),
    "bishop": ("Bishop", "Sabbat"),
    "archbishop": ("Archbishop", "Sabbat"),
    "priscus": ("Priscus", "Sabbat"),
    "cardinal": ("Cardinal", "Sabbat"),
    "regent": ("Regent", "Sabbat"),
    "1 vote": ("1 Vote", "Independent"),
    "2 votes": ("2 Votes", "Independent"),
    "magaji": ("Magaji", "Laibon"),
    "kholo": ("Kholo", "Laibon"),
    "baron": ("Baron", "Anarch"),
}
"""Titre exigé (clé en minuscules, comme dans `vteslibmeta.csv`) → nom du
titre tel que krcg l'écrit sur les vampires (`card.title`), et secte que le
titre implique.

Table de VDB (`generate_library.py`, `title_sects`), à une correction près :
VDB range « bishop » dans la Camarilla, alors que l'évêque est un titre du
Sabbat. Sans effet sur les données au 2026-11-03, aucune ligne du fichier
n'exigeant « bishop » ; noté pour le cas où l'une apparaîtrait."""

_TITLED = "titled"
_NON_TITLED = "non-titled"
_EXCLUSION = "non-"


@dataclass(frozen=True, slots=True)
class LibraryRequirement:
    """Exigence d'une carte de bibliothèque envers le vampire qui la joue.

    * `sects` : sectes exigées, l'une **ou** l'autre (« Independent,anarch »),
      dans l'ordre de `SECTS`. Elles comprennent celles qu'un titre exigé
      implique, et tiennent compte des exclusions (« non-anarch » : toute
      secte de vampire sauf Anarch) ;
    * `titles` : titres précis exigés, l'un ou l'autre, noms de `TITLE_SECTS`,
      dans l'ordre du fichier ;
    * `titled` : un titre quelconque (`titled`) ; `non_titled` : aucun titre
      (`non-titled`) ;
    * `other` : tout le reste, tel qu'écrit dans le fichier, dans l'ordre :
      `non-sterile`, `non-red list`, `1 Gehenna`, `capacity 5 or more`,
      `black hand`, `seraph`… Ces valeurs ne sont pas filtrables dans le lot
      Chercher.

    Deux valeurs de catégories différentes se cumulent (« sabbat,titled » :
    un vampire du Sabbat **et** titré).
    """

    sects: tuple[str, ...] = ()
    titles: tuple[str, ...] = ()
    titled: bool = False
    non_titled: bool = False
    other: tuple[str, ...] = ()


@dataclass
class _RequirementParts:
    """Valeurs d'une exigence triées par catégorie, avant composition."""

    sects: set[str] = field(default_factory=set)
    excluded: set[str] = field(default_factory=set)
    titles: list[str] = field(default_factory=list)
    flags: dict[str, bool] = field(
        default_factory=lambda: {_TITLED: False, _NON_TITLED: False}
    )
    other: list[str] = field(default_factory=list)

    def add(self, value: str) -> None:
        key = value.casefold()
        excluded = _SECT_BY_KEY.get(key.removeprefix(_EXCLUSION))
        if key in self.flags:
            self.flags[key] = True
        elif key in _SECT_BY_KEY:
            self.sects.add(_SECT_BY_KEY[key])
        elif key.startswith(_EXCLUSION) and excluded is not None:
            self.excluded.add(excluded)
        elif key in TITLE_SECTS:
            title, sect = TITLE_SECTS[key]
            self.sects.add(sect)
            self.titles.append(title)
        else:
            self.other.append(value)

    def required_sects(self) -> tuple[str, ...]:
        """Sectes exigées, l'une ou l'autre. Une exclusion se retire des
        sectes exigées par ailleurs ; s'il n'y en a pas, elle se lit sur les
        cinq sectes de vampire (`non-anarch` : Camarilla, Sabbat, Laibon ou
        Independent ; pas Imbued, ces cartes visant un vampire)."""
        base = self.sects or (_VAMPIRE_SECTS if self.excluded else set())
        return tuple(sect for sect in SECTS if sect in base - self.excluded)


def library_requirement(raw: str | None) -> LibraryRequirement:
    """Découpe une exigence brute de `vteslibmeta.csv` (lot Chercher, P15).

    Valeurs séparées par des virgules, comparées sans tenir compte de la casse
    ni des espaces de bord (« Independent » et « independent »). Un titre
    exigé implique sa secte (`TITLE_SECTS`) : une carte qui exige un Prince
    exige un vampire de la Camarilla. Une exclusion de secte (« non-anarch »)
    exige toute **autre** secte de vampire, décidé par l'utilisateur le
    2026-11-03 : la carte ne répond ni à Anarch ni à « non requise », mais à
    chacune des quatre autres sectes de vampire ; avec une secte exigée par
    ailleurs (« non-anarch,prince »), elle la restreint au lieu de l'élargir.
    `None` ou une chaîne vide : aucune exigence.

    Écart à VDB : VDB lit les exclusions par sous-chaîne, si bien qu'une carte
    « non-anarch » n'y répond ni à « non requise » (comme ici) ni à Camarilla
    ou Sabbat (contrairement à ici).
    """
    parts = _RequirementParts()
    for value in (part.strip() for part in (raw or "").split(",")):
        if value:
            parts.add(value)
    return LibraryRequirement(
        sects=parts.required_sects(),
        titles=tuple(dict.fromkeys(parts.titles)),
        titled=parts.flags[_TITLED],
        non_titled=parts.flags[_NON_TITLED],
        other=tuple(dict.fromkeys(parts.other)),
    )
