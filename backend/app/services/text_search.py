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
