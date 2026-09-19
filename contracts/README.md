# Contrat d'API

Ce dossier contient `openapi.json`, la description OpenAPI de l'API du projet.
C'est le document de référence partagé entre le back et le front : ce qui n'y
figure pas n'existe pas pour le front, et ce qui y change est un changement
d'API.

## Un fichier généré, jamais écrit à la main

`openapi.json` est produit à partir de l'application FastAPI, elle-même décrite
par des schémas Pydantic v2. La chaîne est à sens unique :

```
schémas Pydantic (backend/app/schemas/) → app.openapi() → contracts/openapi.json → client TypeScript (frontend)
```

Modifier `openapi.json` directement n'a donc aucun effet sur le comportement de
l'API : la modification serait écrasée à la prochaine génération. Pour changer le
contrat, on change les schémas Pydantic et les déclarations de route, puis on
régénère.

Le fichier est versionné dans git. C'est volontaire : le diff de `openapi.json`
dans une pull request est la façon la plus directe de voir qu'une API a bougé, et
de repérer une rupture involontaire.

## Régénérer

Depuis `backend/`, avec l'environnement Python du projet actif :

```
python scripts/export_openapi.py
```

Le script importe l'application FastAPI, sérialise son schéma OpenAPI et écrit
`contracts/openapi.json` à la racine du dépôt. Il accepte aussi `--check`, qui ne
réécrit rien et sort en erreur si le fichier versionné ne correspond plus à
l'application : c'est la vérification à brancher en CI pour empêcher le contrat
de dériver du code.

## Côté front

Le front ne réécrit jamais les types d'API à la main. Il consomme un client
TypeScript généré depuis ce fichier.

**Outil retenu (Lot 1)** : `openapi-typescript` + `openapi-fetch`.
`openapi-typescript` ne génère que des *types* TS depuis `openapi.json` (pas de
classe client par endpoint) ; `openapi-fetch` est un wrapper `fetch` très léger
qui consomme ces types pour offrir des appels typés (`apiClient.GET("/health")`,
etc.). Ce duo a été choisi pour rester cohérent avec un projet Vite minimal et
pour ne pas entrer en tension avec la future couche offline (IndexedDB/sync,
Lot 3, agent pwa-offline) : celle-ci gère elle-même le cycle de vie des requêtes
(file d'attente, rejeu, idempotence), donc un générateur de client plus
opinionated (SDK avec sa propre gestion de requêtes/erreurs) aurait ajouté une
couche à contourner plutôt qu'à réutiliser.

Emplacement et commande, depuis `frontend/` :

```
npm run generate:client
```

qui exécute `openapi-typescript ../contracts/openapi.json -o ./src/api-client/schema.d.ts --default-non-nullable false`
et écrit les types dans `frontend/src/api-client/schema.d.ts`. Le wrapper
`frontend/src/api-client/client.ts` instancie `openapi-fetch` avec le type
`paths` généré et une `baseUrl` configurable via `VITE_API_BASE_URL` (par
défaut `http://localhost:8000`, le port de dev du backend, cf.
`scripts/dev.ps1` / `scripts/dev.sh`).

**Politique de commit de `schema.d.ts`** : versionné dans git, pour la même
raison qu'`openapi.json` l'est (cf. plus haut) — le diff du fichier généré dans
une pull request montre directement l'effet d'un changement de contrat côté
types front, sans obliger chaque relecteur à relancer la génération pour
vérifier. Générer ce fichier est déterministe (même entrée → même sortie,
vérifié en relançant `npm run generate:client` deux fois de suite sans diff) et
rapide (pas d'appel réseau, pas de build), donc committer n'introduit pas de
risque de dérive silencieuse : toute divergence entre `openapi.json` et
`schema.d.ts` versionnés serait visible comme un diff non regénéré, repérable
en CI en rejouant la commande et en comparant (même logique que le `--check`
d'`export_openapi.py` côté back). Le fichier est néanmoins marqué comme généré
(en-tête « Do not make direct changes ») et exclu du lint applicatif
(`eslint.config.js`, `globalIgnores`) : jamais modifié à la main, jamais
retouché pour satisfaire une règle de style.

## État actuel (Lot 2)

L'API expose `GET /health` et les ressources du Lot 2 : catalogue (`/cartes`,
`/bundles`, `/langues`), collection (`/stock`) et decks (`/decks`, avec leur
composition et leur légalité). La liste des routes et des règles d'erreur est au §7
de `CLAUDE.md`. Les parties, tournois et la synchronisation (`/sync`) arrivent aux
lots suivants.

Deux conventions à connaître en lisant le contrat :

- les 404 et 409 portent le schéma `ErrorResponse` (`{"detail": "…"}`) ; les 422
  gardent le format standard de FastAPI (`HTTPValidationError`), y compris ceux que
  le service produit pour une règle qui dépend de l'état des données ;
- chaque opération a un `operationId` en camelCase anglais (`listCards`,
  `addDeckCard`…), qu'un test fige : le renommer casserait les appels du client.
