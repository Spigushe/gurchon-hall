---
name: modele-donnees
description: Modéliser les entités relationnelles du suivi VtES en SQLAlchemy 2.0 (style Mapped/mapped_column), avec conventions de nommage, clés, relations et clés composites. À utiliser pour créer ou faire évoluer le schéma de données.
---

# Modèle de données (SQLAlchemy 2.0)

## Conventions
- Tables et colonnes en **anglais technique**, `snake_case` ; modèles dans
  `backend/app/models/` (un fichier par domaine : `account`, `reference`,
  `catalog`, `collection`, `play`, `sync`).
- Toutes les tables héritent de `Base` (`app/models/base.py`), qui pose une
  **convention de nommage des contraintes** : sans elle, SQLite donne des noms
  anonymes qu'une migration ne sait pas cibler.
- PK entière `id` par défaut ; PK composites là où l'identité est naturelle
  (`card_copy` : `user_id`, `card_id`, `language_code`, `card_set_id`).
- Enums fermés portés par des **CHECK nommés** ; `language` reste une table
  ouverte, pas un enum.
- Dates-heures en UTC (`UtcDateTime`, `TimestampMixin` pour les entités saisies).
- **Propriétaire par compte (Lot 6)** : toute donnée privée porte `user_id`, ses
  unicités sont par compte, et les FK entre données privées sont composites
  (`…_id`, `user_id`) pour que la base refuse un lien vers la donnée d'un autre
  compte. Le catalogue et les tables de référence (sauf `venue`) sont partagés.

## Style 2.0 (typé), extrait réel
```python
class CardCopy(Base):
    __tablename__ = "card_copy"
    __table_args__ = (
        ForeignKeyConstraint(
            ["card_id", "card_set_id"],
            ["card_printing.card_id", "card_printing.card_set_id"],
        ),
        CheckConstraint("quantity_owned >= 0", name="quantity_owned_positive"),
    )

    user_id: Mapped[int] = mapped_column(ForeignKey("user_account.id"), primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("card.id"), primary_key=True)
    language_code: Mapped[str] = mapped_column(ForeignKey("language.code"), primary_key=True)
    card_set_id: Mapped[int] = mapped_column(primary_key=True)
    quantity_owned: Mapped[int] = mapped_column(default=0)
```

## Entités
Voir `CLAUDE.md` §6 (25 tables) : comptes (`user_account`, `auth_session`),
référence, catalogue (`card`, `card_printing`, `card_translation`…), collection
(`card_copy`, `deck`, `deck_card`, `deleted_deck_card`), pratique (`player`,
`tournament`, `game`, `participation`, encore vides avant le Lot 7) et
`sync_operation`.

## Pièges
- Ne pas encoder dans le schéma les règles portant sur plusieurs lignes (crypt
  ≥ 12, comptabilité du stock, tournoi mono-deck) : elles vont dans les services
  de validation (skill `regles-vtes`, `services/stock.py`).
- Pas de trigger SQLite pour simuler une contrainte conditionnelle : invisible à
  SQLAlchemy et à l'autogénération, et dette de portage pour Barrin (§11).
- Tout changement de schéma → migration Alembic (skill `migrations-alembic`),
  jamais de modif directe.
- Vérifier la syntaxe SQLAlchemy 2.0 contre la doc de la version figée au projet.
