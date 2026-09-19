"""Bases communes aux schémas Pydantic v2.

Convention de nommage, qui devient telle quelle le nom des schémas dans
l'OpenAPI puis dans le client TypeScript généré :

* `<Entité>Read`   — ce que l'API renvoie (mappé depuis l'ORM) ;
* `<Entité>Create` — charge utile de création ;
* `<Entité>Update` — modification partielle : tous les champs optionnels, et
  `None` explicite signifie « efface la valeur », d'où `exclude_unset` à
  l'application côté service.

Corollaire du « `None` efface » : un champ adossé à une colonne NOT NULL ne
doit **pas** accepter `null`, sinon le service écrirait NULL et la base
répondrait par une erreur d'intégrité (500) là où le client méritait un 422.
Ces champs-là s'écrivent `champ: str = UNSET` : facultatifs, mais non
nullables. Voir `UNSET` ci-dessous.

Aucun de ces schémas n'est branché à une route au Lot 1 : ils décrivent le
contrat que le Lot 2 implémentera, sans encore l'exposer.
"""

from typing import Any

from pydantic import BaseModel, ConfigDict

UNSET: Any = None
"""Sentinelle « champ non fourni » pour les champs facultatifs non nullables.

Pydantic ne valide pas les valeurs par défaut : `champ: str = UNSET` est donc
absent par défaut (`model_fields_set` ne le contient pas, `exclude_unset`
l'omet) tout en refusant `{"champ": null}` à l'entrée, puisque `null` n'est
pas un `str`. Le typage `Any` est là pour que l'annotation reste honnête —
`str`, et non `str | None` — jusque dans l'OpenAPI et le client TypeScript.
"""


class ReadModel(BaseModel):
    """Schéma de lecture, alimenté depuis un objet SQLAlchemy."""

    model_config = ConfigDict(from_attributes=True)


class WriteModel(BaseModel):
    """Schéma d'écriture.

    `extra="forbid"` fait échouer une charge utile qui contient un champ
    inconnu, au lieu de l'ignorer en silence — précieux face à un client
    offline qui rejoue une file d'attente construite par une version
    antérieure du front.
    """

    model_config = ConfigDict(extra="forbid")
