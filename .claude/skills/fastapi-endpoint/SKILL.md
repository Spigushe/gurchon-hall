---
name: fastapi-endpoint
description: Pattern d'ajout d'un endpoint FastAPI conforme au contrat — router + schéma Pydantic + service + test, avec injection de session DB et gestion des codes HTTP. À utiliser pour créer ou modifier la logique serveur.
---

# Endpoint FastAPI

## Structure
Séparer les responsabilités :
- **router** (`app/routers/…`) : déclare les routes, valide via schémas, appelle
  le service. Pas de logique métier ici.
- **service** (`app/services/…`) : logique et accès données ; réutilise les
  validations VtES (skill `regles-vtes`).
- **schémas** (`app/schemas/…`) : Pydantic v2, entrée et `response_model`.

```python
router = APIRouter(prefix="/decks", tags=["decks"], responses=UNAUTHENTICATED)

@router.post(
    "",
    response_model=DeckRead,
    status_code=201,
    operation_id="createDeck",
    summary="Crée un deck",
    responses={**CONFLICT, **FORBIDDEN_ORIGIN},
)
def create_deck(payload: DeckCreate, db: DbSession, user: CurrentUser):
    return decks.create_deck(db, user.id, payload)
```

`DbSession`, `CurrentUser`, `PathId` et les réponses documentées (`NOT_FOUND`,
`CONFLICT`, `UNAUTHENTICATED`, `FORBIDDEN_ORIGIN`) viennent de
`app/routers/common.py`.

## Règles
- Toujours un `response_model` explicite et un `operation_id` en camelCase
  anglais (un test les fige ; le client TS en dépend). Chemins en français.
- Schémas d'entrée hérités de `WriteModel`, de lecture de `ReadModel`
  (`app/schemas/base.py`) : champs inconnus refusés, sorties complètes, dates UTC
  suffixées « Z ».
- **Session et propriétaire (Lot 6)** : toute route privée injecte `CurrentUser`
  et passe `user.id` au service, qui filtre chaque requête par compte. La
  ressource d'un autre compte rend 404 avec le message d'un identifiant inconnu,
  jamais 403. Aucun `user_id` dans un corps.
- Le service lève `NotFoundError`, `ConflictError` ou `InvalidRequestError`
  (`app/services/errors.py`), que `app.main` traduit en 404, 409 ou 422.
- Appliquer les règles VtES via les fonctions de validation, ne pas les redéfinir.
- `/sync` : opérations **idempotentes** (clé d'idempotence fournie par le client ;
  rejouer deux fois la même opération laisse le même état). Un refus y est un
  verdict dans une 200, jamais un 404 ou un 409.

## Faire à chaque endpoint
- Écrire le **test** en même temps (skill `tests-backend`), et ajouter la route à
  la matrice d'autorisation (`tests/test_lot6_authorization_matrix.py`).
- Régénérer `contracts/openapi.json` si l'API a changé (skill `contrat-openapi`).

## Ne pas faire
Modifier le schéma/contrat (→ architecte-contrat) ; mettre de la logique dans le router.
