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

Depuis `backend/` :

```
uv run python scripts/export_openapi.py
```

Le script importe l'application FastAPI, sérialise son schéma OpenAPI et écrit
`contracts/openapi.json` à la racine du dépôt. Il accepte aussi `--check`, qui ne
réécrit rien et sort en erreur si le fichier versionné ne correspond plus à
l'application. Cette vérification tourne en CI (étape dédiée du job backend), dans
`scripts/run.ps1 test` / `run.sh test`, et dans un test pytest
(`backend/tests/test_openapi_contract.py`).

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
`paths` généré, une `baseUrl` configurable via `VITE_API_BASE_URL` (par
défaut `http://localhost:8000`, le port de dev du backend, cf.
`scripts/run.ps1 dev` / `scripts/run.sh dev`) et `credentials: "include"`,
pour que le cookie de session parte avec chaque requête (Lot 6).

**Politique de commit de `schema.d.ts`** : versionné dans git, pour la même
raison qu'`openapi.json` l'est (cf. plus haut) — le diff du fichier généré dans
une pull request montre directement l'effet d'un changement de contrat côté
types front, sans obliger chaque relecteur à relancer la génération pour
vérifier. Générer ce fichier est déterministe (même entrée → même sortie,
vérifié en relançant `npm run generate:client` deux fois de suite sans diff) et
rapide (pas d'appel réseau, pas de build), donc committer n'introduit pas de
risque de dérive silencieuse : toute divergence entre `openapi.json` et
`schema.d.ts` versionnés fait échouer un test vitest
(`frontend/tests/unit/api-client/schema-sync.test.ts`), qui joue côté front le
rôle du `--check` d'`export_openapi.py` côté back. Le fichier est néanmoins marqué comme généré
(en-tête « Do not make direct changes ») et exclu du lint applicatif
(`eslint.config.js`, `globalIgnores`) : jamais modifié à la main, jamais
retouché pour satisfaire une règle de style.

## État actuel (Lot 6)

Le contrat compte 28 opérations sur 20 chemins : `GET /health` ; le catalogue
(`/cartes`, `/extensions`, `/bundles`, `/langues`) ; la collection (`/stock`, une
entrée par carte, langue et extension) ; les decks (`/decks`, avec leur composition
et leur légalité) ; `POST /sync`, qui reçoit la file d'opérations hors ligne
(brief dans `docs/lot3-sync-contrat.md`) ; et les comptes (`/inscription`,
`/connexion`, `/deconnexion`, `/moi`). La liste des routes et des règles d'erreur
est au §7 de `CLAUDE.md`. Les parties et tournois (`/joueurs`, `/tournois`,
`/parties`) arrivent au Lot 7.

Depuis le Lot 6, toute route hors catalogue et authentification exige une session,
déclarée au contrat comme schéma de sécurité `sessionCookie` (`apiKey` en cookie).
Sans session, la réponse est un 401 avant tout autre contrôle ; une ressource d'un
autre compte rend 404, avec le même message qu'un identifiant inexistant. Aucun
corps ne porte de `user_id` : le propriétaire vient de la session.

Un deck se retire en deux temps. Archiver n'est pas une route à part : c'est un
`PATCH /decks/{id}` avec `{"archived": true}`, et `false` fait l'inverse. La liste
se filtre sur `state`, à trois valeurs — `active` (défaut), `archived`, `all`.
`DELETE /decks/{id}` n'accepte qu'un deck archivé (409 sinon) et n'est qu'une
suppression logique : la ligne reste en base, le deck sort de toutes les listes,
mais `GET /decks/{id}` continue de le rendre, en lecture seule, avec son
`deleted_at` renseigné — de quoi afficher un historique de parties sans trou.

Deux champs de lecture méritent un mot. `discriminator` est un nombre à quatre
chiffres tiré par le serveur, qui distingue deux decks de même nom : le nom seul
n'identifie plus rien, il s'affiche collé au discriminant (« Malkavien 2022#8561 »).
Et `GET /decks/{id}/legalite` ne renvoie plus un simple verdict : il date son
évaluation (`evaluated_on`, parce qu'un bannissement dépend du jour), liste les
groupes présents dans la crypt (`crypt_groups`, au format des cartes) et nomme les
cartes fautives (`banned_cards`, `not_yet_legal_cards`), en cartes entières plutôt
qu'en noms.

Trois conventions à connaître en lisant le contrat :

- toute date-heure sortante est un instant UTC explicite, suffixé « Z »
  (`2026-09-19T17:47:27Z`). Jamais d'heure locale, jamais de chaîne sans fuseau :
  le front la passe à `new Date()` sans la corriger, et la file de synchronisation
  du Lot 3 peut comparer deux horodatages sans les interpréter ;
- les 401, 403, 404, 409, 429 et 503 portent le schéma `ErrorResponse`
  (`{"detail": "…"}`) ; les 422 gardent le format standard de FastAPI
  (`HTTPValidationError`), y compris ceux que le service produit pour une règle qui
  dépend de l'état des données. `POST /sync` ne rend jamais 404 ni 409 : un refus y
  est un verdict dans le corps d'une 200 ;
- chaque opération a un `operationId` en camelCase anglais (`listCards`,
  `addDeckCard`…), qu'un test fige : le renommer casserait les appels du client.
