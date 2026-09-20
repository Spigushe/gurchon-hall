"""Règles métier VtES — fonctions pures, sans base ni HTTP (skill `regles-vtes`).

Périmètre : la légalité d'un deck (CLAUDE.md §5). Les règles de score (VP, Game
Win) et de tournoi arrivent avec le Lot 4.

Cinq règles :

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
from collections.abc import Collection, Iterable
from datetime import date

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


def banned_cards(cards: Iterable[tuple[str, date | None]], on: date) -> list[str]:
    """Libellés (triés, sans doublon) des cartes bannies à la date `on`.

    `cards` : couples (libellé, `banned_on`), le libellé venant de `card_label`.
    Une carte est bannie **à partir de** cette date, jour compris ; sans date,
    elle ne l'est jamais, et une date future ne l'est pas encore.
    """
    return sorted({name for name, banned_on in cards if banned_on and banned_on <= on})


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
        {name for name, legal_from in cards if legal_from and legal_from > on}
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
