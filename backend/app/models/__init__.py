"""Modèles SQLAlchemy 2.0 du suivi VtES.

Importer ce package suffit à peupler `Base.metadata` avec toutes les tables :
c'est ce dont dépendent l'autogenerate d'Alembic (`migrations/env.py`) et les
tests qui créent un schéma en mémoire.

Découpage :

* `reference` — listes de référence (langues, clans, disciplines, extensions…) ;
* `catalog`   — le catalogue VEKN, identité de carte sans langue ;
* `collection`— la collection possédée (langue, proxy) et les decks ;
* `play`      — joueurs, parties, tournois, participations.
"""

from app.models.base import Base, TimestampMixin
from app.models.catalog import (
    Card,
    CardDisciplineLink,
    CardPrinting,
    CardPrintingOccurrence,
    CardTranslation,
    CardTypeLink,
)
from app.models.collection import CardCopy, Deck, DeckCard
from app.models.enums import (
    CardCategory,
    CostType,
    DeckPolicy,
    DeckStatus,
    DisciplineRequirement,
    PrintOccurrence,
    RoundType,
    TournamentFormat,
)
from app.models.play import Game, Participation, Player, Tournament
from app.models.reference import (
    Bundle,
    CardSet,
    CardType,
    Clan,
    Discipline,
    Language,
    Sect,
    Venue,
)

__all__ = [
    "Base",
    "Bundle",
    "Card",
    "CardCategory",
    "CardCopy",
    "CardDisciplineLink",
    "CardPrinting",
    "CardPrintingOccurrence",
    "CardSet",
    "CardTranslation",
    "CardType",
    "CardTypeLink",
    "Clan",
    "CostType",
    "Deck",
    "DeckCard",
    "DeckPolicy",
    "DeckStatus",
    "Discipline",
    "DisciplineRequirement",
    "Game",
    "Language",
    "Participation",
    "Player",
    "PrintOccurrence",
    "RoundType",
    "Sect",
    "TimestampMixin",
    "TournamentFormat",
    "Tournament",
    "Venue",
]
