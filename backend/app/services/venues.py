"""Lieux de jeu (Lot 7, B1), privés à chaque compte depuis le Lot 6.

Même patron que `app.services.players` : scopés au compte (404 pour le lieu d'un
autre compte), noms comparés repliés avant d'écrire (P5 : « Le Bar à Dés » et
« le bar a des » sont le même lieu), 409 en ligne sur un doublon. Un lieu
référencé par une partie ou un tournoi ne se supprime pas (A9).
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Game, Tournament, Venue
from app.schemas.reference import VenueCreate, VenueRead, VenueUpdate
from app.services.errors import ConflictError, NotFoundError
from app.services.persistence import commit_or_conflict, integrity_as_conflict
from app.services.text_search import contains_folded, equals_folded


def _not_found(venue_id: int) -> NotFoundError:
    return NotFoundError(f"Lieu {venue_id} introuvable.")


def _games():
    return (
        select(func.count(Game.id))
        .where(Game.venue_id == Venue.id, Game.user_id == Venue.user_id)
        .correlate(Venue)
        .scalar_subquery()
    )


def _tournaments():
    return (
        select(func.count(Tournament.id))
        .where(Tournament.venue_id == Venue.id, Tournament.user_id == Venue.user_id)
        .correlate(Venue)
        .scalar_subquery()
    )


def _read(venue: Venue, game_count: int, tournament_count: int) -> VenueRead:
    return VenueRead(
        id=venue.id,
        name=venue.name,
        city=venue.city,
        notes=venue.notes,
        game_count=game_count,
        tournament_count=tournament_count,
    )


def find_by_name(
    db: Session, user_id: int, name: str, *, exclude_id: int | None = None
) -> Venue | None:
    """Lieu du compte dont le nom replié égale `name` replié."""
    stmt = select(Venue).where(
        Venue.user_id == user_id, equals_folded(Venue.name, name)
    )
    if exclude_id is not None:
        stmt = stmt.where(Venue.id != exclude_id)
    return db.scalars(stmt.order_by(Venue.id)).first()


def _check_name_free(
    db: Session, user_id: int, name: str, *, exclude_id: int | None = None
) -> None:
    existing = find_by_name(db, user_id, name, exclude_id=exclude_id)
    if existing is not None:
        raise ConflictError(f"Un lieu nommé {existing.name!r} existe déjà.")


def _load(db: Session, user_id: int, venue_id: int) -> Venue:
    venue = db.scalar(
        select(Venue).where(Venue.id == venue_id, Venue.user_id == user_id)
    )
    if venue is None:
        raise _not_found(venue_id)
    return venue


def _counts(db: Session, venue: Venue) -> tuple[int, int]:
    games = db.scalar(
        select(func.count(Game.id)).where(
            Game.venue_id == venue.id, Game.user_id == venue.user_id
        )
    )
    tournaments = db.scalar(
        select(func.count(Tournament.id)).where(
            Tournament.venue_id == venue.id, Tournament.user_id == venue.user_id
        )
    )
    return games or 0, tournaments or 0


def list_venues(db: Session, user_id: int, *, q: str | None = None) -> list[VenueRead]:
    stmt = select(Venue, _games(), _tournaments()).where(Venue.user_id == user_id)
    if q:
        stmt = stmt.where(contains_folded(Venue.name, q))
    stmt = stmt.order_by(func.fold_text(Venue.name), Venue.id)
    return [_read(venue, g, t) for venue, g, t in db.execute(stmt).all()]


def get_venue(db: Session, user_id: int, venue_id: int) -> VenueRead:
    venue = _load(db, user_id, venue_id)
    return _read(venue, *_counts(db, venue))


def create_venue(db: Session, user_id: int, payload: VenueCreate) -> VenueRead:
    _check_name_free(db, user_id, payload.name)
    venue = Venue(user_id=user_id, **payload.model_dump())
    db.add(venue)
    commit_or_conflict(db, f"Un lieu nommé {payload.name!r} existe déjà.")
    db.refresh(venue)
    return _read(venue, 0, 0)


def update_venue(
    db: Session, user_id: int, venue_id: int, payload: VenueUpdate
) -> VenueRead:
    venue = _load(db, user_id, venue_id)
    changes = payload.model_dump(exclude_unset=True)
    name = changes.get("name")
    if name is not None and name != venue.name:
        _check_name_free(db, user_id, name, exclude_id=venue.id)
    for field, value in changes.items():
        setattr(venue, field, value)
    if changes:
        commit_or_conflict(db, f"Un lieu nommé {name!r} existe déjà.")
    return _read(venue, *_counts(db, venue))


def delete_venue(db: Session, user_id: int, venue_id: int) -> None:
    venue = _load(db, user_id, venue_id)
    games, tournaments = _counts(db, venue)
    if games or tournaments:
        parts = []
        if games:
            parts.append("1 partie" if games == 1 else f"{games} parties")
        if tournaments:
            parts.append("1 tournoi" if tournaments == 1 else f"{tournaments} tournois")
        raise ConflictError(
            f"{venue.name} sert à {' et '.join(parts)} : impossible de le supprimer."
        )
    message = f"{venue.name} est encore utilisé : impossible de le supprimer."
    db.delete(venue)
    with integrity_as_conflict(db, message):
        db.commit()
