# Score CRAP

Mis en place le 2026-11-02, pendant le Lot 7. Ce document fixe ce que l'on mesure,
comment on le compte et ce qui fait échouer la CI. L'agent `qa-tests` en est le
propriétaire.

## Ce que mesure le score

CRAP (*Change Risk Anti-Patterns*) est une métrique d'Alberto Savoia et Bob Evans
(crap4j, 2007), reprise par Robert C. Martin. Elle croise, pour chaque fonction, la
complexité cyclomatique et la couverture par les tests :

```text
CRAP(f) = comp(f)² × (1 − cov(f))³ + comp(f)
```

avec `cov` entre 0 et 1. Une fonction entièrement couverte vaut sa complexité. Une
fonction de complexité 5 jamais exécutée par un test vaut 30. À complexité 10, il
faut un peu plus de 40 % de couverture pour repasser sous 30.

Le seuil retenu est celui de crap4j : **une fonction est en défaut au-delà de 30**
(strictement). Corollaire à garder en tête, une fonction de complexité 31 reste en
défaut même couverte à 100 % : la seule correction est de la découper.

## Règles de comptage

Deux analyseurs, un par langage, appliquent les mêmes règles :
`backend/scripts/crap_report.py` (module `ast` de Python) et
`frontend/scripts/crap-report.mjs` (compilateur TypeScript déjà installé). Leurs
tests (`backend/tests/test_crap_report.py`, `frontend/tests/unit/crapReport.test.ts`)
reprennent les mêmes cas, pour que les deux comptes ne divergent pas en silence.

La complexité est celle de McCabe : 1, plus un point par décision trouvée dans le
corps de la fonction.

| Décision | Python | TypeScript |
| --- | --- | --- |
| condition | `if`, `elif`, `x if c else y` | `if`, `else if`, `c ? x : y` |
| boucle | `for`, `async for`, `while` | `for`, `for…in`, `for…of`, `while`, `do` |
| exception | chaque `except` | `catch` |
| aiguillage | chaque `case`, sauf le joker `case _:` sans garde | chaque `case`, jamais `default` |
| opérateur logique | chaque opérande en plus dans `and` / `or` | chaque `&&`, `\|\|`, `??`, `&&=`, `\|\|=`, `??=` |
| compréhension | chaque `for` et chaque `if` | (sans objet) |

Ne comptent pas : le chaînage optionnel `?.`, les valeurs par défaut des paramètres
et les décorateurs. ESLint compte `?.` et les valeurs par défaut depuis sa version 9 ;
on s'en écarte pour garder un seul barème entre les deux couches, et parce que `?.`,
présent partout dans le front, aurait gonflé le score sans désigner un vrai chemin
à tester.

Une fonction imbriquée (callback, fonction locale, méthode d'une classe) est une
fonction à part, qui ne compte ni dans la complexité ni dans la couverture de celle
qui la contient. Une lambda Python reste comptée dans sa fonction.

La couverture est celle des instructions du corps de la fonction, imbriquées
exclues : coverage.py en lignes côté back, le fournisseur v8 de vitest en
instructions côté front. Côté back, la ligne `def` et les décorateurs sont retirés,
car coverage.py les marque exécutés dès l'import du module : sans ce retrait, une
fonction jamais appelée paraîtrait en partie couverte. Un fichier absent du rapport
de couverture est tenu pour non couvert.

Chaque fonction est désignée par son fichier et un nom qualifié, jamais par un
numéro de ligne, pour qu'un ajout plus haut dans le fichier ne la fasse pas passer
pour une nouvelle : `app/services/sync.py::_execute_play`,
`src/offline/vtes/overlay.ts::project.apply`. Une fonction anonyme prend le nom de
son contexte (`Page.useEffect(callback)`, `Page.onClick`, `compareGames.<retournée>`),
et deux homonymes dans la même portée reçoivent un suffixe (`transform#2`).

## Ce qui fait échouer

La règle est un cliquet. Une référence par couche, versionnée dans
`docs/qa-baselines/crap/backend.json` et `docs/qa-baselines/crap/frontend.json`,
liste les fonctions déjà au-dessus de 30 avec leur score. Le contrôle échoue (code
de sortie 1) dans deux cas :

1. une fonction dépasse 30 sans figurer dans la référence ;
2. une fonction de la référence a un score plus haut que celui retenu.

Une entrée qui a baissé ou disparu ne fait pas échouer, mais le rapport la signale :
il faut alors resserrer la référence (`--update-baseline`) dans le même changement,
pour que le gain ne puisse plus être reperdu.

Réécrire la référence pour y **ajouter** une fonction ou **relever** un score n'est
pas une façon de faire passer la CI. C'est une décision, à justifier dans la PR
(par exemple : composant de formulaire dont la complexité vient du JSX, et dont les
chemins sont couverts par les e2e), et que `qa-tests` valide. Par défaut, une
fonction en défaut se corrige par des tests si elle manque de couverture, ou par un
découpage si sa complexité dépasse 30. La correction revient à l'agent de la couche
concernée, comme pour un test rouge.

## Commandes

Back, depuis `backend/` :

```sh
uv run coverage run -m pytest        # suite complète sous couverture (.coverage)
uv run coverage json -q              # écrit coverage.json
uv run python scripts/crap_report.py # rapport, puis contrôle de la référence
```

Front, depuis `frontend/` :

```sh
npm run test:coverage   # vitest sous couverture (coverage/coverage-final.json)
npm run crap            # rapport, puis contrôle de la référence
```

Les deux rapports acceptent `--top <n>` (nombre de pires fonctions affichées, 15 par
défaut), `--json <fichier>` (tous les scores, pour une analyse plus fine),
`--threshold <n>` et `--update-baseline`. Depuis la racine, `scripts/run.ps1 crap`
(ou `scripts/run.sh crap`) enchaîne les deux couches, et `scripts/run.ps1 test` fait
désormais tourner pytest et vitest sous couverture puis passe le contrôle. La CI fait
de même dans ses deux jobs.

## État de départ (2026-11-02)

Back : 305 fonctions dans `app/`, aucune au-dessus de 30, la pire étant
`vtes_rules.py::admissible_final_decks` (complexité 21, couverte à 100 %). La
couverture globale de `app/` est de 99 %. La référence est vide : toute fonction qui
dépasse 30 fait échouer la CI.

Front : 1439 fonctions dans `src/`, 13 au-dessus de 30, toutes dans la référence.
Deux seulement pourraient en sortir par des tests, leur complexité restant sous 30 :
`CorrectionForm.submit` (96 : complexité 20, couverte à 43 %) et le comparateur rendu
par `compareGames` dans `GamesPage.tsx` (34,1 : complexité 13, couverte à 50 %). Les
onze autres ont une complexité de 31 à 77 et ne sortiront de la référence que par un
découpage, couverture ou non : la pire, `describeOperation` (159,5), cumule une
complexité de 64 et 71 % de couverture, et la plupart des suivantes sont des
composants de page ou de formulaire déjà couverts à 100 % (`GameFormBody` : 77).

## Limites connues

- **Le front ne compte que la couverture de vitest.** Les e2e Playwright n'entrent
  pas dans la mesure : un chemin testé seulement de bout en bout paraît non couvert.
  Cela pénalise surtout les composants que les tests unitaires ne montent pas.
- **Couverture en lignes, pas en branches.** Une ligne qui porte une condition
  compte comme couverte dès qu'elle est exécutée, quelle que soit la branche prise.
  C'est la mesure d'origine de crap4j, plus simple et identique entre les deux
  couches.
- **Le JSX pèse lourd.** Chaque `cond && <X />` et chaque ternaire de rendu est une
  décision, ce qui place mécaniquement les gros composants au-dessus de 30. C'est
  voulu : ce sont aussi les fonctions les plus pénibles à modifier.
- **Le score dépend de la suite de tests.** Un test supprimé ou devenu instable peut
  faire monter le score d'une fonction de la référence et faire échouer le contrôle
  sans qu'une ligne de code de production ait changé. Le message du rapport donne
  l'ancien et le nouveau score pour retrouver la cause.
- **Durée.** Le surcoût de la couverture est faible (mesures au §11 de
  `CLAUDE.md` : à peu près nul pour pytest, 7 % pour vitest).
