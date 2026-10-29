"""Joueurs : le « Moi » du compte et les adversaires nommés (Lot 7, B1).

Tout est scopé au compte : un joueur d'un autre compte est introuvable (404),
avec le message d'un identifiant inconnu.

**Le « Moi » existe toujours (A1).** `get_or_create_me` le crée au besoin et ne
fait que `flush` : l'appelant garde la main sur la transaction (l'inscription le
crée avec le compte, `/sync` et les parties le résolvent pour `{"me": true}`).

**Noms comparés repliés (P5).** « Marc » et « marc » sont le même joueur :
création et renommage comparent par `fold_text` avant d'écrire, alors que la
contrainte d'unicité de la base (`user_id`, `name`) reste sensible à la casse.
La création en ligne refuse le doublon (409) ; l'upsert de `/sync` (B3)
réutilise `find_by_name` et `ME_NAME_TAKEN`.
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Participation, Player, UserAccount
from app.schemas.play import PlayerCreate, PlayerRead, PlayerUpdate
from app.services.errors import ConflictError, NotFoundError
from app.services.persistence import commit_or_conflict, integrity_as_conflict
from app.services.text_search import contains_folded, equals_folded

ME_NAME_TAKEN = "Ce nom est déjà porté par votre joueur Moi."
"""Refus d'un nom replié identique à celui du « Moi » : création en ligne, et
`player.create` de `/sync` (le « Moi » est exclu de l'upsert, P5)."""


def _not_found(player_id: int) -> NotFoundError:
    return NotFoundError(f"Joueur {player_id} introuvable.")


def _game_count():
    """Sous-requête corrélée : tables où le joueur figure."""
    return (
        select(func.count(Participation.id))
        .where(
            Participation.player_id == Player.id,
            Participation.user_id == Player.user_id,
        )
        .correlate(Player)
        .scalar_subquery()
    )


def _read(player: Player, game_count: int) -> PlayerRead:
    return PlayerRead(
        id=player.id, name=player.name, is_me=player.is_me, game_count=game_count
    )


def get_me(db: Session, user_id: int) -> Player | None:
    return db.scalar(
        select(Player).where(Player.user_id == user_id, Player.is_me.is_(True))
    )


def get_or_create_me(db: Session, user_id: int, username: str | None = None) -> Player:
    """Le « Moi » du compte, créé s'il manque (nom de départ : `username`).

    `username` est lu sur le compte quand il n'est pas fourni. Si un adversaire
    porte déjà ce nom replié (compte ancien sans « Moi »), le nom reçoit un
    suffixe plutôt que d'échouer. Ne valide pas : `flush` seulement.
    """
    me = get_me(db, user_id)
    if me is not None:
        return me
    if username is None:
        account = db.get(UserAccount, user_id)
        if account is None:
            raise NotFoundError(f"Compte {user_id} introuvable.")
        username = account.username
    name = username
    suffix = 1
    while find_by_name(db, user_id, name) is not None:
        suffix += 1
        name = f"{username} ({suffix})"
    me = Player(user_id=user_id, name=name, is_me=True)
    db.add(me)
    db.flush()
    return me


def find_by_name(
    db: Session, user_id: int, name: str, *, exclude_id: int | None = None
) -> Player | None:
    """Joueur du compte dont le nom replié égale `name` replié, « Moi » compris."""
    stmt = select(Player).where(
        Player.user_id == user_id, equals_folded(Player.name, name)
    )
    if exclude_id is not None:
        stmt = stmt.where(Player.id != exclude_id)
    return db.scalars(stmt.order_by(Player.id)).first()


def _check_name_free(
    db: Session, user_id: int, name: str, *, exclude_id: int | None = None
) -> None:
    existing = find_by_name(db, user_id, name, exclude_id=exclude_id)
    if existing is None:
        return
    if existing.is_me:
        raise ConflictError(ME_NAME_TAKEN)
    raise ConflictError(f"Un joueur nommé {existing.name!r} existe déjà.")


def _load(db: Session, user_id: int, player_id: int) -> Player:
    player = db.scalar(
        select(Player).where(Player.id == player_id, Player.user_id == user_id)
    )
    if player is None:
        raise _not_found(player_id)
    return player


def _count_for(db: Session, player: Player) -> int:
    return (
        db.scalar(
            select(func.count(Participation.id)).where(
                Participation.player_id == player.id,
                Participation.user_id == player.user_id,
            )
        )
        or 0
    )


def list_players(
    db: Session, user_id: int, *, q: str | None = None
) -> list[PlayerRead]:
    """Joueurs du compte, « Moi » en tête, puis par nom replié."""
    stmt = select(Player, _game_count()).where(Player.user_id == user_id)
    if q:
        stmt = stmt.where(contains_folded(Player.name, q))
    stmt = stmt.order_by(Player.is_me.desc(), func.fold_text(Player.name), Player.id)
    return [_read(player, count) for player, count in db.execute(stmt).all()]


def get_player(db: Session, user_id: int, player_id: int) -> PlayerRead:
    player = _load(db, user_id, player_id)
    return _read(player, _count_for(db, player))


def create_player(db: Session, user_id: int, payload: PlayerCreate) -> PlayerRead:
    """Crée un adversaire ; 409 si un joueur de même nom replié existe."""
    _check_name_free(db, user_id, payload.name)
    player = Player(user_id=user_id, name=payload.name, is_me=False)
    db.add(player)
    commit_or_conflict(db, f"Un joueur nommé {payload.name!r} existe déjà.")
    db.refresh(player)
    return _read(player, 0)


def update_player(
    db: Session, user_id: int, player_id: int, payload: PlayerUpdate
) -> PlayerRead:
    """Renomme un joueur, « Moi » compris ; 409 si le nom replié est pris par un
    autre joueur."""
    player = _load(db, user_id, player_id)
    changes = payload.model_dump(exclude_unset=True)
    name = changes.get("name")
    if name is not None and name != player.name:
        _check_name_free(db, user_id, name, exclude_id=player.id)
        player.name = name
        commit_or_conflict(db, f"Un joueur nommé {name!r} existe déjà.")
    return _read(player, _count_for(db, player))


def delete_player(db: Session, user_id: int, player_id: int) -> None:
    """Supprime un adversaire ; 409 pour le « Moi » et pour un joueur présent à
    une table (A9)."""
    player = _load(db, user_id, player_id)
    if player.is_me:
        raise ConflictError("Votre joueur Moi est renommable, jamais supprimé.")
    count = _count_for(db, player)
    if count:
        tables = "1 table" if count == 1 else f"{count} tables"
        raise ConflictError(
            f"{player.name} figure à {tables} : retirez-le d'abord de ces parties "
            "pour le supprimer."
        )
    db.delete(player)
    with integrity_as_conflict(
        db, f"{player.name} figure à une table : impossible de le supprimer."
    ):
        db.commit()
