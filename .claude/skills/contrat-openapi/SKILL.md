---
name: contrat-openapi
description: Piloter le contrat en approche contract-first — schémas Pydantic v2 → OpenAPI exposé par FastAPI → client TypeScript typé côté front. À utiliser dès qu'une API est créée ou modifiée, pour garder back et front alignés.
---

# Contrat OpenAPI (contract-first)

## Principe
Le contrat OpenAPI est **la source de vérité** partagée. Toute évolution d'API
commence par le contrat, avant l'implémentation back ou front.

## Flux
1. Définir/mettre à jour les **schémas Pydantic v2** (`backend/app/schemas/`).
2. Exporter l'OpenAPI vers `contracts/openapi.json` (versionné), depuis
   `backend/` : `uv run python scripts/export_openapi.py` (`--check` pour
   vérifier sans écrire ; tourne en CI et dans pytest).
3. Régénérer le **client TypeScript typé**, depuis `frontend/` :
   `npm run generate:client` (écrit `src/api-client/schema.d.ts`, versionné ;
   `tests/unit/api-client/schema-sync.test.ts` échoue s'il a dérivé).

## Génération du client TS
Outil figé au Lot 1 : `openapi-typescript` (types) + `openapi-fetch` (wrapper,
`src/api-client/client.ts`, `credentials: "include"` depuis le Lot 6).
`openapi-typescript` tourne avec `--default-non-nullable false`, sans quoi un
champ de requête à valeur par défaut deviendrait obligatoire côté TypeScript. Ne
pas introduire un second générateur.

## Conventions du contrat (§7 de CLAUDE.md)
- Chemins en français, `operationId` en camelCase anglais.
- Sorties complètes : un champ de lecture à valeur par défaut est obligatoire en
  réponse (`ReadModel`, `json_schema_serialization_defaults_required`).
- Dates-heures sortantes en UTC suffixé « Z ».
- Bornes plutôt que 500 : entiers plafonnés à `MAX_DB_INT`, textes obligatoires
  rognés puis refusés s'ils sont vides (`RequiredText`).
- Erreurs : `ErrorResponse` pour 401/403/404/409/429/503, format FastAPI pour 422.
- Session déclarée comme schéma de sécurité `sessionCookie` ; aucun `user_id`
  dans un corps.

## Règles
- Le front **ne réécrit jamais** les types d'API à la main : il consomme le
  client généré.
- `contracts/openapi.json` est commité et sert de diff de contrat à la revue.
- Un changement de schéma Pydantic qui casse le contrat est un changement
  d'API : passer par l'architecte-contrat, régénérer client + tests de contrat.

## Pièges
- Bien fixer `response_model` et les schémas d'entrée pour que l'OpenAPI soit
  précis (sinon le client généré est flou).
- Pydantic v2 : `ConfigDict(from_attributes=True)` pour mapper depuis les objets
  ORM (déjà posé sur `ReadModel`).
- Une nouvelle ressource au contrat doit entrer dans
  `frontend/src/offline/apiRoutes.ts` (denylist du service worker) : un test
  compare les deux.
