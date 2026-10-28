---
name: migrations-alembic
description: Créer, relire et appliquer des migrations Alembic sûres sur SQLite (autogenerate, batch operations, tests up/down). À utiliser pour tout changement de schéma de base de données.
---

# Migrations Alembic

## Règle d'or
Aucune modification de schéma sans migration. Le schéma en base doit toujours
correspondre à une révision Alembic.

## Workflow
Depuis `backend/`, toujours par `uv run`. **Vérifier `DATABASE_URL` avant toute
commande** : sans elle, Alembic vise `backend/vtes.db`, la base de développement
qui contient la vraie collection de l'utilisateur.
1. Modifier les modèles SQLAlchemy.
2. Générer : `uv run alembic revision --autogenerate -m "message clair"`.
3. **Relire le script généré** : l'autogenerate se trompe (types, index,
   renommages vus comme drop+add). Corriger à la main si besoin.
4. Appliquer : `uv run alembic upgrade head`. Revenir : `uv run alembic downgrade -1`.
5. Sur une base qui contient des données réelles : essayer d'abord sur une copie,
   et garder une sauvegarde datée de la base d'avant migration.

## Spécifique SQLite
SQLite ne supporte pas tous les `ALTER TABLE`. `env.py` active le **mode batch**
(`render_as_batch=True`), coupe `PRAGMA foreign_keys` le temps de la migration
(sans quoi la recréation de `deck` vidait `deck_card` en cascade) et passe un
`PRAGMA foreign_key_check` avant de rendre la main.

Depuis `f3a91c47b2de`, les révisions qui recréent une table le font **à la main**
(renommage, création, copie, suppression) plutôt que par le mode batch : celui-ci
recopie les contraintes dans un ordre qui change d'un processus à l'autre, et un
aller-retour comparé au texte près n'était vert qu'une fois sur deux. Bonus : la
montée se rend hors ligne (`upgrade <rev>:<rev> --sql`).

## Données existantes
- Une révision qui ne sait pas convertir des données refuse de tourner
  (`RuntimeError` avant toute modification) plutôt que de les perdre (Lot 4).
- Une révision qui les convertit le fait par une règle sans heuristique (Lot 6 :
  rattachement au compte `1` par valeur constante) ; sa descente refuse de tourner
  si elle perdrait de l'information.

## Bonnes pratiques
- Une intention = une révision ; messages explicites.
- Tester `upgrade` puis `downgrade` sur une base jetable
  (`backend/tests/test_migrations.py`).
- Ne pas éditer une révision déjà appliquée/partagée : en créer une nouvelle.
- Vérifier les commandes contre la version d'Alembic figée au projet.
