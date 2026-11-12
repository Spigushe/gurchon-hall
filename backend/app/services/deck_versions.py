"""Versions jouées d'un deck (Lot 8, A3, A4, A9).

**Gel.** `freeze_decklist` agrège les lignes vivantes d'un deck par carte (quantité
totale, sans langue, extension ni proxy, P2), compare le résultat à la dernière
version du deck, la réutilise si elle est identique, sinon crée la suivante. Un deck
supprimé se fige depuis `deleted_deck_card`. Rien n'est validé ici : l'appelant
garde la transaction (comme `refs.resolve_player`).

**Règle du tournoi** (P3, A9, « Précisions pour B1 »). Dans un tournoi, un deck n'a
qu'une version : la ligne `tournament_deck_version` existe si et seulement si une
partie du tournoi joue ce deck, et toutes ces parties portent cette version.
`assign_versions` décide la version de chaque deck d'une partie qu'on écrit ;
`hand_over` rétablit le second invariant une fois la partie écrite (la ligne passe à
la partie restante au plus petit identifiant, ou disparaît). Comme la clé étrangère
`frozen_by_game_id` ne cascade pas, la base refuse sans lui de supprimer la partie
qui a figé.

`autoflush` est coupé sur la session de l'application : chaque lecture qui suit une
écriture passe par un `flush` explicite.
"""

from collections import Counter

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models import (
    Card,
    Deck,
    DeckCard,
    DeckVersion,
    DeckVersionCard,
    DeletedDeckCard,
    Game,
    Participation,
    TournamentDeckVersion,
)
from app.models.base import utcnow
from app.models.enums import CardCategory
from app.schemas.collection import DeckVersionCardRead, DeckVersionRead

# --------------------------------------------------------------------------
# Gel
# --------------------------------------------------------------------------


def _current_list(db: Session, deck: Deck) -> dict[int, int]:
    """`card_id -> quantité totale` de la liste vivante, ou figée si le deck est
    supprimé."""
    line_type = DeletedDeckCard if deck.deleted_at is not None else DeckCard
    rows = db.execute(
        select(line_type.card_id, func.sum(line_type.quantity))
        .where(line_type.deck_id == deck.id)
        .group_by(line_type.card_id)
    )
    return {card_id: int(total) for card_id, total in rows}


def _latest(db: Session, deck_id: int) -> DeckVersion | None:
    return db.scalars(
        select(DeckVersion)
        .where(DeckVersion.deck_id == deck_id)
        .order_by(DeckVersion.number.desc())
        .limit(1)
    ).first()


def _same_list(version: DeckVersion, current: dict[int, int]) -> bool:
    return {card.card_id: card.quantity for card in version.cards} == current


def freeze_decklist(db: Session, deck: Deck, user_id: int) -> DeckVersion:
    """La version qui correspond à la liste courante du deck : la dernière si elle
    est identique, sinon la suivante (numéro + 1). Un deck vide donne une version
    sans carte, réutilisée tant qu'il reste vide."""
    current = _current_list(db, deck)
    latest = _latest(db, deck.id)
    if latest is not None and _same_list(latest, current):
        return latest
    version = DeckVersion(
        user_id=user_id,
        deck_id=deck.id,
        number=1 if latest is None else latest.number + 1,
        cards=[
            DeckVersionCard(card_id=card_id, quantity=quantity)
            for card_id, quantity in sorted(current.items())
        ],
    )
    db.add(version)
    db.flush()
    return version


# --------------------------------------------------------------------------
# Version d'un deck dans une partie et dans un tournoi
# --------------------------------------------------------------------------


def versions_of(game: Game) -> dict[int, int]:
    """`deck_id -> version` de la table actuelle d'une partie (une seule version
    par deck dans une partie, quelle que soit la ligne qui le joue)."""
    return {
        p.deck_id: p.deck_version_id
        for p in game.participations
        if p.deck_id is not None and p.deck_version_id is not None
    }


def _tournament_row(
    db: Session, tournament_id: int, deck_id: int
) -> TournamentDeckVersion | None:
    return db.get(TournamentDeckVersion, (tournament_id, deck_id))


def _inherited(
    db: Session, tournament_id: int | None, deck_id: int, previous: dict[int, int]
) -> int | None:
    """La version déjà décidée pour ce deck : celle du tournoi qui prime, sinon
    celle que la partie avait déjà."""
    if tournament_id is not None:
        row = _tournament_row(db, tournament_id, deck_id)
        if row is not None:
            return row.deck_version_id
    return previous.get(deck_id)


def _bind_tournament(
    db: Session,
    user_id: int,
    tournament_id: int,
    deck_id: int,
    version_id: int,
    game_id: int,
) -> TournamentDeckVersion:
    """La ligne du tournoi pour ce deck, créée (figée par cette partie) si elle
    manque, sinon rendue telle quelle."""
    row = _tournament_row(db, tournament_id, deck_id)
    if row is None:
        row = TournamentDeckVersion(
            user_id=user_id,
            tournament_id=tournament_id,
            deck_id=deck_id,
            deck_version_id=version_id,
            frozen_by_game_id=game_id,
        )
        db.add(row)
        db.flush()
    return row


def _realign(
    db: Session, user_id: int, tournament_id: int, deck_id: int, version_id: int
) -> None:
    """Toutes les participations du tournoi qui jouent ce deck prennent cette
    version ; chaque partie dont une ligne change voit son `updated_at` touché,
    sans quoi le miroir ne relirait pas sa table (A6)."""
    stale = db.scalars(
        select(Participation)
        .join(
            Game,
            and_(
                Game.id == Participation.game_id,
                Game.user_id == Participation.user_id,
            ),
        )
        .where(
            Participation.user_id == user_id,
            Participation.deck_id == deck_id,
            Game.tournament_id == tournament_id,
            or_(
                Participation.deck_version_id.is_(None),
                Participation.deck_version_id != version_id,
            ),
        )
    ).all()
    touched = {p.game_id for p in stale}
    for participation in stale:
        participation.deck_version_id = version_id
    for game_id in touched:
        db.get(Game, game_id).updated_at = utcnow()
    db.flush()


def _refreeze(
    db: Session,
    user_id: int,
    game_id: int,
    tournament_id: int | None,
    deck: Deck,
) -> int:
    """Regel d'un deck : la liste courante devient sa version, pour cette partie
    seulement en amicale, pour tout le tournoi sinon."""
    fresh = freeze_decklist(db, deck, user_id)
    if tournament_id is not None:
        row = _bind_tournament(db, user_id, tournament_id, deck.id, fresh.id, game_id)
        row.deck_version_id = fresh.id
        row.frozen_by_game_id = game_id
        db.flush()
        db.expire(row)
        _realign(db, user_id, tournament_id, deck.id, fresh.id)
    return fresh.id


def _decide(
    db: Session,
    user_id: int,
    game: Game,
    tournament_id: int | None,
    deck: Deck,
    previous: dict[int, int],
    refreeze: bool,
) -> int:
    version_id = _inherited(db, tournament_id, deck.id, previous)
    if version_id is None:
        version_id = freeze_decklist(db, deck, user_id).id
    if tournament_id is not None:
        _bind_tournament(db, user_id, tournament_id, deck.id, version_id, game.id)
    if refreeze:
        version_id = _refreeze(db, user_id, game.id, tournament_id, deck)
    return version_id


def assign_versions(
    db: Session,
    user_id: int,
    game: Game,
    tournament_id: int | None,
    deck_ids: set[int],
    previous: dict[int, int],
    *,
    refreeze: bool = False,
) -> dict[int, int]:
    """`deck_id -> version` pour chaque deck de la table, état final de l'écriture.

    La version du tournoi prime ; sinon la version que la partie avait déjà (table
    remplacée, partie qui quitte ou change de tournoi) ; sinon le deck se fige. Dans
    un tournoi, la version décidée devient celle du tournoi s'il n'en avait pas. Le
    regel (`refreeze`) passe en dernier, sur l'état final. `game` doit être flushée.
    """
    return {
        deck_id: _decide(
            db,
            user_id,
            game,
            tournament_id,
            db.get(Deck, deck_id),
            previous,
            refreeze,
        )
        for deck_id in sorted(deck_ids)
    }


def _games_playing(db: Session, user_id: int, row: TournamentDeckVersion):
    """Requête : les parties du tournoi qui jouent le deck de cette ligne."""
    return (
        select(Game.id)
        .join(
            Participation,
            and_(
                Participation.game_id == Game.id,
                Participation.user_id == Game.user_id,
            ),
        )
        .where(
            Game.user_id == user_id,
            Game.tournament_id == row.tournament_id,
            Participation.deck_id == row.deck_id,
        )
    )


def hand_over(
    db: Session,
    user_id: int,
    game_id: int,
    tournament_ids: set[int],
    *,
    leaving: bool = False,
) -> None:
    """Rétablit « une ligne si et seulement si une partie joue le deck » pour les
    lignes que cette partie a figées et qu'elle ne justifie plus : elles passent à
    la partie restante au plus petit identifiant (même version), ou disparaissent.
    À appeler une fois l'état final de la partie flushé ; `leaving` dit que la
    partie va être supprimée (sa table existe encore, on l'ignore)."""
    if not tournament_ids:
        return
    rows = db.scalars(
        select(TournamentDeckVersion).where(
            TournamentDeckVersion.user_id == user_id,
            TournamentDeckVersion.tournament_id.in_(tournament_ids),
            TournamentDeckVersion.frozen_by_game_id == game_id,
        )
    ).all()
    for row in rows:
        playing = _games_playing(db, user_id, row)
        if not leaving and db.scalar(playing.where(Game.id == game_id)) is not None:
            continue
        successor = db.scalar(
            select(func.min(playing.where(Game.id != game_id).subquery().c.id))
        )
        if successor is None:
            db.delete(row)
        else:
            row.frozen_by_game_id = successor
    db.flush()


def tournament_versions(
    db: Session, user_id: int, tournament_id: int
) -> list[TournamentDeckVersion]:
    """Les lignes du tournoi, triées par deck."""
    return list(
        db.scalars(
            select(TournamentDeckVersion)
            .where(
                TournamentDeckVersion.user_id == user_id,
                TournamentDeckVersion.tournament_id == tournament_id,
            )
            .order_by(TournamentDeckVersion.deck_id)
            .execution_options(populate_existing=True)
        )
    )


# --------------------------------------------------------------------------
# Lecture : `GET /decks/{id}/versions`
# --------------------------------------------------------------------------


def read_versions(db: Session, deck_id: int) -> list[DeckVersionRead]:
    """Les versions du deck par numéro croissant, cartes par identifiant croissant,
    comptes crypte et bibliothèque compris."""
    versions = list(
        db.scalars(
            select(DeckVersion)
            .where(DeckVersion.deck_id == deck_id)
            .order_by(DeckVersion.number)
            .execution_options(populate_existing=True)
        )
    )
    categories = _categories(db, versions)
    return [_to_read(v, categories) for v in versions]


def _categories(db: Session, versions: list[DeckVersion]) -> dict[int, CardCategory]:
    cards = {card.card_id for v in versions for card in v.cards}
    if not cards:
        return {}
    rows = db.execute(select(Card.id, Card.category).where(Card.id.in_(cards)))
    return {card_id: category for card_id, category in rows}


def _to_read(
    version: DeckVersion, categories: dict[int, CardCategory]
) -> DeckVersionRead:
    totals = Counter()
    for card in version.cards:
        totals[categories[card.card_id]] += card.quantity
    return DeckVersionRead(
        id=version.id,
        deck_id=version.deck_id,
        number=version.number,
        created_at=version.created_at,
        crypt_count=totals[CardCategory.CRYPT],
        library_count=totals[CardCategory.LIBRARY],
        cards=[
            DeckVersionCardRead(card_id=c.card_id, quantity=c.quantity)
            for c in version.cards
        ],
    )
