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

from datetime import UTC, datetime
from typing import Annotated, Any

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    StringConstraints,
    field_validator,
)

UNSET: Any = None
"""Sentinelle « champ non fourni » pour les champs facultatifs non nullables.

Pydantic ne valide pas les valeurs par défaut : `champ: str = UNSET` est donc
absent par défaut (`model_fields_set` ne le contient pas, `exclude_unset`
l'omet) tout en refusant `{"champ": null}` à l'entrée, puisque `null` n'est
pas un `str`. Le typage `Any` est là pour que l'annotation reste honnête —
`str`, et non `str | None` — jusque dans l'OpenAPI et le client TypeScript.
"""

RequiredText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
"""Texte de saisie obligatoire : rogné des espaces de bord, puis non vide.

`min_length=1` seul laissait passer `"   "` — un deck nommé de trois espaces,
introuvable à la recherche et invisible dans une liste. L'ordre compte : le
rognage précède les deux contrôles de longueur, donc `" Grinder "` devient
`"Grinder"` et `"  " + "x" * 120` est refusé comme trop long, pas accepté
parce que ses bords ne comptent pas.

Le plafond reste porté par le champ (`Field(max_length=…)`), qui varie d'une
colonne à l'autre ; il s'ajoute à ces contraintes au lieu de les remplacer.
Réservé aux champs **obligatoires et non nullables** : un champ facultatif
effaçable (`notes`, `archetype`, `city`) doit pouvoir valoir `null`, et une
chaîne vide y reste une façon légitime de dire « rien ».

Vaut aussi pour les codes, pas seulement pour les libellés affichés : un code
de langue blanc (`"  "`) n'est pas une langue — une carte a toujours une langue
d'impression — et passait jusqu'ici la validation pour ressortir en 404
« langue inconnue », loin de la saisie fautive.
"""

MAX_DB_INT = 2**31 - 1
"""Plus grand entier qu'une colonne `INTEGER` accepte partout (SQLite, Postgres).

Plafond des entiers entrants : un identifiant ou une quantité au-delà n'a
aucune chance d'exister en base, et sans borne il part jusqu'au pilote, qui le
refuse par une erreur d'exécution (500). Borné ici, le client reçoit un 422.
"""


def _to_utc(value: datetime) -> datetime:
    """Refuse un instant sans fuseau, et normalise le reste en UTC."""
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(
            "un fuseau est obligatoire (ex. 2026-02-01T20:00:00+01:00 ou "
            "2026-02-01T19:00:00Z) : sans lui, l'instant est ambigu."
        )
    return value.astimezone(UTC)


AwareDateTime = Annotated[datetime, AfterValidator(_to_utc)]
"""Date-heure d'entrée : fuseau obligatoire, normalisée en UTC.

Posée ici, et non dans un seul module de schémas, parce que deux familles de
charges utiles en dépendent : l'instant d'une partie (`app.schemas.play`) et
celui d'une saisie hors ligne rejouée (`app.schemas.sync`). Ce sont justement
les deux cas où la valeur traverse un fuseau — saisie au club le soir,
synchronisée ailleurs le lendemain.
"""


class ReadModel(BaseModel):
    """Schéma de lecture, alimenté depuis un objet SQLAlchemy.

    `json_schema_serialization_defaults_required` règle un travers du contrat :
    un champ à valeur par défaut (`cards: list[...] = []`, `archived_at: ... =
    None`) est *facultatif* à la validation, mais la réponse le contient
    **toujours** — la sérialisation part d'un modèle complet. Sans l'option,
    l'OpenAPI les déclare non requis et le client TypeScript les rend
    optionnels : le front écrit alors des `?.` et des gardes pour des champs
    qui ne manquent jamais.

    L'option n'agit que sur le schéma de *sérialisation*, celui que FastAPI
    utilise pour les réponses ; les schémas d'entrée (`WriteModel`) gardent
    leurs champs facultatifs. Vérifié sur Pydantic 2.13 / FastAPI 0.141.
    """

    model_config = ConfigDict(
        from_attributes=True,
        json_schema_serialization_defaults_required=True,
    )

    @field_validator("*", mode="after")
    @classmethod
    def _datetimes_are_explicit_utc(cls, value: Any) -> Any:
        """Toute date-heure sortante est un instant UTC, suffixé « Z ».

        Le correctif est posé ici, et non dans `UtcDateTime`, parce que le
        défaut est un défaut de *contrat* : la même colonne sortait tantôt
        « …T17:47:27Z » (valeur posée en Python par `utcnow()`, donc *aware*),
        tantôt « …T17:47:27 » (même valeur relue depuis SQLite, donc naïve).
        Pydantic n'écrit le « Z » que sur un instant *aware*. Normaliser à
        l'entrée du schéma de lecture rend les deux chemins identiques sans
        toucher à la convention de stockage (UTC naïf, cf.
        `app.models.types`), aux comparaisons côté service, ni au JSON Schema
        produit (`format: date-time` dans les deux cas).

        Une valeur naïve est de l'UTC par convention : on lui attache le
        fuseau. Une valeur déjà *aware* est ramenée à UTC, pour qu'aucune
        réponse ne sorte en « +02:00 ».
        """
        if isinstance(value, datetime):
            if value.tzinfo is None:
                return value.replace(tzinfo=UTC)
            return value.astimezone(UTC)
        return value


class WriteModel(BaseModel):
    """Schéma d'écriture.

    `extra="forbid"` fait échouer une charge utile qui contient un champ
    inconnu, au lieu de l'ignorer en silence — précieux face à un client
    offline qui rejoue une file d'attente construite par une version
    antérieure du front.
    """

    model_config = ConfigDict(extra="forbid")
