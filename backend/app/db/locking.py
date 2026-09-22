"""Verrou d'écriture : une transaction qui tient la base seule pour écrire.

**Le problème** (limite connue n° 1 du §11 de CLAUDE.md). Les services de stock
et de decks « vérifient puis écrivent » : ils lisent ce qui est alloué, jugent
qu'il reste assez d'exemplaires, puis écrivent. Entre la lecture et l'écriture,
une autre requête peut faire la même chose ; ensemble elles sur-allouent une
entrée que chacune, séparément, avait trouvée suffisante. Aucune contrainte de
base ne l'interdit (la somme porte sur plusieurs lignes).

**Le mécanisme.** SQLite n'a qu'un écrivain à la fois, mais par défaut ne le
sait qu'au premier `INSERT` / `UPDATE` / `DELETE` : les lectures qui précèdent
sont faites sans verrou, donc sur un état que d'autres peuvent changer. La
parade est `BEGIN IMMEDIATE`, qui prend le verrou d'écriture **avant toute
lecture** : le contrôle et l'écriture voient alors le même état, et un
concurrent qui veut lui aussi écrire attend (au plus le `timeout` du pilote,
5 s par défaut) au lieu de s'intercaler. Les lecteurs ne sont pas bloqués avant
le commit.

**Pourquoi une connexion et un `SAVEPOINT` par opération.** Les services
appellent `db.commit()` et `db.rollback()` eux-mêmes ; branchés sur une session
ordinaire, chacun de leurs commits libérerait le verrou. La session rendue ici
est liée à une connexion dont la transaction externe est ouverte à la main
(`join_transaction_mode="create_savepoint"`) : le `commit()` d'un service ne
fait que **relâcher un point de sauvegarde**, son `rollback()` n'annule que ce
point-là, et le vrai `COMMIT` n'a lieu qu'à la sortie du bloc. Conséquences :

* le verrou est tenu du début à la fin du bloc, quoi que fassent les services ;
* une opération refusée s'annule seule (rien de partiel ne reste), sans
  entraîner ce qui a été fait avant elle dans le même bloc ;
* tout ce qui est écrit dans le bloc — effets métier *et* journal — est validé
  ou perdu **ensemble** : pas de fenêtre où une opération serait appliquée sans
  que le journal le sache, ce qui ferait rejouer un versement de produit.

Le pilote `sqlite3` de Python n'ouvre de transaction qu'à la première écriture
(mode historique) ; `BEGIN IMMEDIATE` émis explicitement en ouvre une tout de
suite, et il n'en ouvre pas de seconde ensuite. Les `SAVEPOINT` s'y emboîtent
donc proprement — ce que le mode historique ne garantit pas quand un
`SAVEPOINT` ouvre lui-même la transaction (son `RELEASE` validerait alors pour
de bon).

**Périmètre.** Le verrou protège ce qui passe par ce bloc, c'est-à-dire
`POST /sync`. Les routes en ligne (`POST /decks/{id}/cartes`, …) écrivent sans
lui : une course entre une route en ligne et un lot reste possible, seule la
course entre deux lots est fermée. Cf. le rapport du Lot 3.

Propre à SQLite. Sur Postgres (§2 : migration possible), l'équivalent serait un
verrou consultatif (`pg_advisory_xact_lock`) ou `SELECT … FOR UPDATE` sur les
lignes d'`card_copy` : le bloc refuse d'ouvrir plutôt que de faire semblant.
"""

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session


class WriteLockTimeout(Exception):
    """Le verrou d'écriture n'a pas été obtenu dans le délai du pilote."""


@contextmanager
def serialized_writes(engine: Engine) -> Iterator[Session]:
    """Ouvre une transaction d'écriture exclusive et rend une session dedans.

    À la sortie normale, tout est validé d'un `COMMIT` ; sur exception, tout est
    annulé et l'exception repart. `WriteLockTimeout` si le verrou reste pris
    au-delà du délai d'attente du pilote (une autre écriture est en cours).

    La session est configurée comme `SessionLocal` (`autoflush=False`), mais
    laisse `expire_on_commit` à son défaut : les objets sont relus après chaque
    commit de service, ce qui écarte tout état périmé d'une opération à
    l'autre.
    """
    if engine.dialect.name != "sqlite":
        raise NotImplementedError(
            "serialized_writes ne sait prendre le verrou d'écriture que sur "
            f"SQLite, pas sur {engine.dialect.name!r}."
        )
    with engine.connect() as connection:
        try:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
        except OperationalError as error:
            connection.rollback()
            raise WriteLockTimeout(str(error.orig)) from error
        try:
            with Session(
                bind=connection,
                join_transaction_mode="create_savepoint",
                autoflush=False,
            ) as session:
                yield session
        except BaseException:
            connection.rollback()
            raise
        connection.commit()
