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
TypeScript généré depuis ce fichier. Le choix de l'outil de génération et la
commande associée sont fixés au Lot 1, en même temps que les premières ressources
métier ; au Lot 0, le contrat se limite à l'endpoint de santé et aucun client
n'est encore généré.

## État actuel (Lot 0)

L'API expose `GET /health`, qui renvoie l'état du service et sa version. Cet
endpoint sert de test de bout en bout du squelette et, plus tard, de sonde de
connectivité pour la partie hors-ligne. Les ressources métier — cartes, stock,
decks, parties, tournois, synchronisation — arrivent au Lot 1 et suivent la même
règle : contrat d'abord, implémentation ensuite.
