---
name: tests-backend
description: Tests backend avec pytest — unités, services, conformité au contrat, avec base SQLite de test isolée. Couvre en priorité les règles VtES et l'idempotence de /sync. À utiliser pour écrire ou vérifier les tests serveur.
---

# Tests backend (pytest)

## Base de test
- SQLite dédiée (en mémoire ou fichier temporaire), recréée par test/session.
- Isolation par transaction avec rollback, ou base neuve par test.
- Client HTTP de test FastAPI (`TestClient` / httpx) pour les tests d'endpoint.

## Couverture prioritaire
- **Règles VtES** (skill `regles-vtes`) : un test par règle.
  - deck légal / illégal (crypt < 12, library < 60 ou > 90) ;
  - tournoi mono-deck respecté / violé ;
  - calcul VP ; Game Win **[à confirmer]** testé comme paramétrable.
- **`/sync` idempotent** : rejouer deux fois la même opération (même clé
  d'idempotence) laisse le même état ; vérifier explicitement.
- Conformité des réponses au `response_model` (le contrat tient).

## Organisation
`backend/tests/` en miroir de `app/` ; fixtures partagées dans `conftest.py`.

## Rôle
`qa-tests` conçoit et écrit ; les corrections de code reviennent à l'agent de la
couche concernée (backend-fastapi / architecte-contrat).
