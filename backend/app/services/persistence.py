"""Écriture en base : traduction des refus d'intégrité en erreur métier.

Un service vérifie d'abord (doublon, stock…) puis écrit ; entre les deux, une
requête concurrente peut passer. La base a le dernier mot (index uniques, clés
étrangères) : son refus doit devenir un 409 lisible, pas un 500.
"""

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.services.errors import ConflictError


@contextmanager
def integrity_as_conflict(db: Session, message: str) -> Iterator[None]:
    """Convertit une `IntegrityError` levée dans le bloc en `ConflictError`.

    La session est annulée avant de lever, pour rester utilisable.
    """
    try:
        yield
    except IntegrityError as error:
        db.rollback()
        raise ConflictError(message) from error


def commit_or_conflict(db: Session, message: str) -> None:
    """`db.commit()`, avec un refus d'intégrité traduit en 409 (`message`)."""
    with integrity_as_conflict(db, message):
        db.commit()
