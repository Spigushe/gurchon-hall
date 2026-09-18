---
name: modele-donnees
description: Modéliser les entités relationnelles du suivi VtES en SQLAlchemy 2.0 (style Mapped/mapped_column), avec conventions de nommage, clés, relations et clés composites. À utiliser pour créer ou faire évoluer le schéma de données.
---

# Modèle de données (SQLAlchemy 2.0)

## Conventions
- Tables et colonnes en **anglais technique**, `snake_case`.
- PK entière `id` par défaut ; `Stock` a une **PK composite** `(carte_id, langue)`.
- FK explicites, `ForeignKey`, avec relations déclarées des deux côtés.
- Types clairs (`str`, `int`, `bool`, `datetime`, `date`), nullabilité explicite.

## Style 2.0 (typé)
```python
from datetime import datetime
from sqlalchemy import ForeignKey
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

class Base(DeclarativeBase): ...

class Carte(Base):
    __tablename__ = "carte"
    id: Mapped[int] = mapped_column(primary_key=True)
    nom: Mapped[str]
    nom_fr: Mapped[str | None]
    categorie: Mapped[str]  # "crypt" | "library"
    # ...

class Stock(Base):
    __tablename__ = "stock"
    carte_id: Mapped[int] = mapped_column(ForeignKey("carte.id"), primary_key=True)
    langue: Mapped[str] = mapped_column(primary_key=True)  # "EN" | "FR"
    quantite: Mapped[int] = mapped_column(default=0)
```

## Entités
Voir `CLAUDE.md` §6 : `Carte`, `Stock`, `Deck`, `DeckCarte`, `Joueur`, `Tournoi`,
`Partie`, `Participation`, + tables de référence.

## Pièges
- Ne pas encoder dans le schéma les règles portant sur plusieurs lignes (deck
  ≥ 12, tournoi mono-deck) : elles vont dans les services de validation (skill
  `regles-vtes`).
- Tout changement de schéma → migration Alembic (skill `migrations-alembic`),
  jamais de modif directe.
- Vérifier la syntaxe SQLAlchemy 2.0 contre la doc de la version figée au projet.
