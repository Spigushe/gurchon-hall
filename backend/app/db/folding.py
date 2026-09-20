"""Normalisation des textes pour la recherche : sans casse, sans accents.

Une seule fonction, utilisée des deux côtés d'une recherche : en Python sur le
texte tapé, et en SQL (enregistrée sous le nom `fold_text` sur chaque connexion
SQLite, cf. `app.db.session`) sur la colonne. Les deux côtés se replient donc
de la même façon, par construction.

Ce module vit dans `app.db` (et non dans les services) pour que `session.py`
puisse l'importer sans dépendre de la couche de services.

Portée réelle, à ne pas sur-promettre : la décomposition NFKD sépare les lettres
de leurs marques (é -> e + accent, ç -> c + cédille, ñ -> n + tilde), les marques
sont retirées, puis `casefold()` replie la casse (ß -> ss, Ł -> ł). Les lettres
qui ne se décomposent pas restent telles quelles : « œ » et « ł » ne deviennent
ni « oe » ni « l ».

Deux évolutions à garder en tête :

* si la base migre vers Postgres (§2), l'équivalent serait l'extension
  `unaccent` (plus `lower`), à brancher au même point d'appel
  (`app.services.text_search`) ;
* la recherche locale du Lot 3 (IndexedDB, côté front) devra appliquer la même
  normalisation (`normalize("NFKD")`, retrait de `\\p{M}`, `toLowerCase`) pour
  que hors-ligne et en ligne trouvent les mêmes cartes.
"""

import unicodedata


def _strip_marks(text: str) -> str:
    return "".join(char for char in text if not unicodedata.combining(char))


def fold_text(text: str | None) -> str | None:
    """Texte sans casse ni accents ; `None` reste `None` (colonne NULL en SQL)."""
    if text is None:
        return None
    # Le second retrait des marques rattrape celles que `casefold` fait naître
    # (« İ » devient « i » + point combinant).
    return _strip_marks(_strip_marks(unicodedata.normalize("NFKD", text)).casefold())
