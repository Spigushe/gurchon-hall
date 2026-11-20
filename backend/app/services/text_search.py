"""Recherche « contient » sans tenir compte de la casse ni des accents.

Point unique des quatre recherches `q` (cartes, produits, collection, decks).
SQLite ne replie la casse que pour l'ASCII (`ilike`) et ne connaît pas les
accents : on compare donc `fold_text(colonne)`, fonction SQL enregistrée à la
connexion (`app.db.session`), à un motif construit à partir du texte cherché
passé par la **même** normalisation (`app.db.folding.fold_text`).

Ordre important : le texte est normalisé *puis* ses jokers sont échappés. Un
`%` ou un `_` saisi reste littéral, y compris ceux que la normalisation ferait
apparaître (« ％ » pleine chasse devient « % » en NFKD).

Base cible : l'équivalent Postgres serait `unaccent(lower(colonne)) LIKE ...`
(extension `unaccent`), à prévoir si la base migre (§2). La recherche locale du
Lot 3 (IndexedDB) devra appliquer la même normalisation côté front.

Depuis le Lot 12 (A7), le module porte aussi l'ordre d'affichage des noms :
`folded_order` trie par nom replié, puis par nom brut pour départager deux noms
qui ne diffèrent que par la casse ou un accent. Le miroir local suit la même
règle (`compareFolded`), sur la table de cas commune
`backend/tests/fixtures/folded_sort_cases.json`.
"""

from sqlalchemy import ColumnElement, func
from sqlalchemy.orm import InstrumentedAttribute

from app.db.folding import fold_text


def like_pattern(text: str) -> str:
    """Motif `LIKE` « contient » du texte normalisé, jokers neutralisés."""
    folded = fold_text(text)
    escaped = folded.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def contains_folded(column: InstrumentedAttribute, text: str) -> ColumnElement[bool]:
    """Condition : `column` contient `text`, casse et accents ignorés."""
    return func.fold_text(column).like(like_pattern(text), escape="\\")


def equals_folded(column: InstrumentedAttribute, text: str) -> ColumnElement[bool]:
    """Condition : `column` égale `text`, casse et accents ignorés.

    Comparaison de noms (Lot 7, P5) : « Marc » et « marc » sont le même joueur,
    alors que la contrainte d'unicité de la base, elle, reste sensible à la
    casse. Même normalisation que la recherche, des deux côtés ; pas de motif,
    donc aucun joker à neutraliser.
    """
    return func.fold_text(column) == fold_text(text)


def folded_order(column: InstrumentedAttribute) -> tuple[ColumnElement, ...]:
    """Clés de tri d'un nom : replié d'abord, brut ensuite (Lot 12, A7).

    `ORDER BY name` suivait la collation binaire de SQLite : majuscules avant
    minuscules, « Élan » après « Zoé ». Le nom replié range « Élan » entre
    « Dame » et « Zoé » ; le nom brut, comparé point de code par point de code,
    rend l'ordre stable entre « Abbot » et « abbot ». Les clés propres à chaque
    liste (groupe, identifiant, langue…) suivent, à la charge de l'appelant.
    `fold_text` s'appelle en Python pour chaque ligne : mesuré sur le catalogue
    complet au Lot 12 (`docs/lot12-plan-consolidation.md`, « Livré à B4 »).
    """
    return (func.fold_text(column), column)
