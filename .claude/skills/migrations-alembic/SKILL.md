---
name: migrations-alembic
description: Créer, relire et appliquer des migrations Alembic sûres sur SQLite (autogenerate, batch operations, tests up/down). À utiliser pour tout changement de schéma de base de données.
---

# Migrations Alembic

## Règle d'or
Aucune modification de schéma sans migration. Le schéma en base doit toujours
correspondre à une révision Alembic.

## Workflow
1. Modifier les modèles SQLAlchemy.
2. Générer : `alembic revision --autogenerate -m "message clair"`.
3. **Relire le script généré** : l'autogenerate se trompe (types, index,
   renommages vus comme drop+add). Corriger à la main si besoin.
4. Appliquer : `alembic upgrade head`. Revenir : `alembic downgrade -1`.

## Spécifique SQLite
SQLite ne supporte pas tous les `ALTER TABLE`. Activer le **mode batch** pour que
les altérations passent par table temporaire :
```python
# env.py : context.configure(..., render_as_batch=True)
```
Vérifier ce point dès la première migration modifiant une colonne.

## Bonnes pratiques
- Une intention = une révision ; messages explicites.
- Tester `upgrade` puis `downgrade` sur une base jetable.
- Ne pas éditer une révision déjà appliquée/partagée : en créer une nouvelle.
- Vérifier les commandes contre la version d'Alembic figée au projet.
