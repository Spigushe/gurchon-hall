---
name: tests-backend
description: Tests backend avec pytest — unités, services, conformité au contrat, avec base SQLite de test isolée. Couvre en priorité les règles VtES et l'idempotence de /sync. À utiliser pour écrire ou vérifier les tests serveur.
---

# Tests backend (pytest)

## Base de test
- Fichier SQLite jetable par test (`db_engine`, copié d'un gabarit au schéma
  vierge créé une fois par session), fixtures dans `backend/tests/conftest.py` :
  `db`, `api` (`TestClient` sur la base du test), `world` (graphe d'objets déjà
  persisté), `api_client_factory` (plusieurs clients sur la même base).
- Session et comptes (Lot 6) : aides dans `tests/auth_helpers.py` ; les compteurs
  de limitation de débit sont remis à zéro entre deux tests.
- Lancer depuis `backend/` : `uv run pytest`. En CI, les coûts Argon2 sont
  abaissés (`ARGON2_MEMORY_COST_KIB=8192`, `ARGON2_TIME_COST=1`) ; en local, les
  exporter de même si la suite est trop lente.

## Couverture prioritaire
- **Règles VtES** (skill `regles-vtes`) : un test par règle.
  - deck légal / illégal sur les cinq règles (crypt < 12, groupes non
    adjacents, library < 60 ou > 90, carte bannie, carte pas encore légale,
    avec les bornes de date jour inclus) ;
  - tournoi mono-deck respecté / violé ;
  - calcul VP ; Game Win **[à confirmer]** testé comme paramétrable.
- **`/sync` idempotent** : rejouer deux fois la même opération (même clé
  d'idempotence) laisse le même état ; vérifier explicitement.
- Conformité des réponses au `response_model` (le contrat tient) ;
  `test_openapi_contract.py` vérifie que `contracts/openapi.json` est à jour.
- **Isolation entre comptes** (Lot 6) : toute route privée entre dans
  `test_lot6_authorization_matrix.py` (401 sans session, 404 pour un autre
  compte, isolation de `/sync`).
- Limites assumées documentées par `xfail(strict=True)` (2 aujourd'hui, §11) :
  ne pas les « corriger » en retirant le marqueur.

## Organisation
`backend/tests/`, un fichier par sujet (`test_api_*`, `test_sync_*`,
`test_models_*`, `test_migrations.py`…) ; fixtures partagées dans `conftest.py`,
aides dans `helpers.py` et `auth_helpers.py`, fixture krcg figée dans
`fixtures/`.

## Rôle
`qa-tests` conçoit et écrit ; les corrections de code reviennent à l'agent de la
couche concernée (backend-fastapi / architecte-contrat).
