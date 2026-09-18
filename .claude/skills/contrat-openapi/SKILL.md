---
name: contrat-openapi
description: Piloter le contrat en approche contract-first — schémas Pydantic v2 → OpenAPI exposé par FastAPI → client TypeScript typé côté front. À utiliser dès qu'une API est créée ou modifiée, pour garder back et front alignés.
---

# Contrat OpenAPI (contract-first)

## Principe
Le contrat OpenAPI est **la source de vérité** partagée. Toute évolution d'API
commence par le contrat, avant l'implémentation back ou front.

## Flux
1. Définir/mettre à jour les **schémas Pydantic v2** (back).
2. FastAPI expose l'OpenAPI sur `/openapi.json` ; l'exporter vers
   `contracts/openapi.json` (versionné).
3. Régénérer le **client TypeScript typé** côté front à partir de ce fichier.

## Génération du client TS
Plusieurs outils possibles (`openapi-typescript` + `openapi-fetch`, `orval`,
`@hey-api/openapi-ts`, …). **Choisir un outil et le figer au démarrage** ; ne pas
mélanger. Vérifier la commande exacte dans la doc de l'outil retenu — ne pas
supposer la CLI de mémoire.

## Règles
- Le front **ne réécrit jamais** les types d'API à la main : il consomme le
  client généré.
- `contracts/openapi.json` est commité et sert de diff de contrat à la revue.
- Un changement de schéma Pydantic qui casse le contrat est un changement
  d'API : passer par l'architecte-contrat, régénérer client + tests de contrat.

## Pièges
- Bien fixer `response_model` et les schémas d'entrée pour que l'OpenAPI soit
  précis (sinon le client généré est flou).
- Pydantic v2 : `ConfigDict(from_attributes=True)` pour mapper depuis les objets ORM.
