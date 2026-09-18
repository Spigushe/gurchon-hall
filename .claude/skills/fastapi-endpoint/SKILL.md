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
router = APIRouter(prefix="/decks", tags=["decks"])

@router.post("", response_model=DeckOut, status_code=201)
def creer_deck(payload: DeckIn, db: Session = Depends(get_db)):
    return service.creer_deck(db, payload)
```

## Règles
- Toujours un `response_model` explicite (précise l'OpenAPI → client typé net).
- Codes HTTP corrects (201 création, 404 introuvable, 409 conflit, 422 validation).
- Appliquer les règles VtES via les fonctions de validation, ne pas les redéfinir.
- `/sync` : opérations **idempotentes** (clé d'idempotence fournie par le client ;
  rejouer deux fois la même opération laisse le même état).

## Faire à chaque endpoint
- Écrire le **test** en même temps (skill `tests-backend`).
- Régénérer `contracts/openapi.json` si l'API a changé (skill `contrat-openapi`).

## Ne pas faire
Modifier le schéma/contrat (→ architecte-contrat) ; mettre de la logique dans le router.
