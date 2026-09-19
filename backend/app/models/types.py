"""Types de colonnes maison.

`UtcDateTime` existe pour une raison précise : SQLite n'a pas de type
date-heure, et le dialecte SQLAlchemy sérialise un `datetime` en texte **sans
son fuseau**. Un instant envoyé en `14:00+02:00` était donc stocké « 14:00 »
et relu comme 14:00 UTC — l'instant se déplaçait de deux heures, en silence.

Convention retenue au Lot 1 : **toutes les colonnes date-heure contiennent de
l'UTC, en valeur naïve**. Le type ci-dessous la rend inviolable côté écriture,
quelle que soit la couche qui insère (ORM, script d'import, migration). La
lecture rend un `datetime` naïf, à interpréter comme de l'UTC : on ne renvoie
pas d'objet *aware* pour que les valeurs relues restent comparables entre
elles et avec `datetime.utcnow()`-like, sans dépendre de la connaissance du
fuseau par l'appelant.

Le contrat d'API, lui, est plus strict : `GameCreate.played_at` exige un
datetime *aware* et le normalise en UTC (cf. `app.schemas.play`). Une saisie
hors ligne rejouée plus tard depuis un autre fuseau désigne ainsi toujours le
même instant — ce dont la synchronisation du Lot 3 a besoin.
"""

from datetime import UTC, datetime

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator


class UtcDateTime(TypeDecorator):
    """`DateTime` qui convertit tout instant *aware* en UTC naïf à l'écriture."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            # Valeur naïve : déjà de l'UTC par convention, on n'invente pas de
            # fuseau local qui rendrait le résultat dépendant de la machine.
            return value
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:
        return value
