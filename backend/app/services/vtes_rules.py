"""Règles métier VtES — fonctions pures, sans base ni HTTP (skill `regles-vtes`).

Périmètre du Lot 2 : la légalité d'un deck. Les règles de score (VP, Game Win)
et de tournoi arrivent avec le Lot 4.

Seuils (CLAUDE.md §5) : crypt ≥ 12 cartes ; library entre 60 et 90 cartes,
bornes incluses. Les proxies comptent : un proxy tient la place de la carte.
"""

CRYPT_MINIMUM = 12
LIBRARY_MINIMUM = 60
LIBRARY_MAXIMUM = 90


def deck_issues(crypt_count: int, library_count: int) -> list[str]:
    """Raisons pour lesquelles un deck n'est pas légal ; vide s'il l'est."""
    issues: list[str] = []
    if crypt_count < CRYPT_MINIMUM:
        issues.append(
            f"Crypt trop petite : {crypt_count} carte(s), {CRYPT_MINIMUM} minimum."
        )
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
    return issues


def deck_is_legal(crypt_count: int, library_count: int) -> bool:
    """Crypt ≥ 12 et library entre 60 et 90 (inclus)."""
    return not deck_issues(crypt_count, library_count)
