"""Erreurs métier, indépendantes du transport HTTP.

Les services lèvent ces exceptions ; `app.main` les traduit en réponses. Le
corps d'erreur est toujours celui déclaré dans le contrat :

* 404 et 409 — `ErrorResponse` (`{"detail": "<message>"}`) ;
* 422 — le format standard de FastAPI (`detail` = liste de `loc`/`msg`/`type`),
  identique à celui des erreurs de validation Pydantic, pour que le client n'ait
  qu'une seule forme de 422 à gérer.
"""


class DomainError(Exception):
    """Base des erreurs métier ; `status_code` est celui de la réponse HTTP."""

    status_code: int = 400

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class NotFoundError(DomainError):
    """Ressource introuvable (404)."""

    status_code = 404


class ConflictError(DomainError):
    """L'opération est cohérente en soi mais contredit l'état des données (409).

    Doublon, exemplaires insuffisants, entrée encore allouée à un deck…
    """

    status_code = 409


class InvalidRequestError(DomainError):
    """Charge utile invalide d'une façon que seul le service peut voir (422).

    Typiquement une règle portant sur la valeur *fusionnée* avec la ligne
    existante, là où le schéma Pydantic ne voit que les champs reçus.
    """

    status_code = 422

    def __init__(self, message: str, loc: tuple[str, ...] = ("body",)) -> None:
        super().__init__(message)
        self.loc = loc
