# gurchon-hall

Suivi de pratique *Vampire: The Eternal Struggle* (collection, decks, parties,
tournois), développé comme pilote pour dérisquer une PWA offline-first avant
de porter l'approche sur barrins-project.

Stack : React + TypeScript (Vite) côté front, FastAPI + SQLAlchemy + SQLite
côté back, contrat OpenAPI partagé entre les deux, IndexedDB (Dexie) pour le
stockage hors-ligne.

Le détail complet — objectifs, modèle de données, contrat d'API, agents et
skills Claude Code, roadmap — est dans [CLAUDE.md](CLAUDE.md). Les conventions
de travail pour les agents sont dans [AGENTS.md](AGENTS.md).

## État actuel

Lots 0 à 6 livrés (détail et restes à vérifier dans CLAUDE.md §12) :

- catalogue krcg importé, collection comptée par carte × langue × extension,
  decks avec légalité, archivage et proxies ;
- PWA offline-first : app shell en cache, saisie hors ligne dans IndexedDB,
  file d'opérations rejouée vers `POST /sync` au retour du réseau ;
- UI mobile et bureau (design system Nocturne) ;
- comptes (inscription, connexion, session dans un cookie `HttpOnly`) et
  cloisonnement des données par compte.

Les parties et tournois (Lot 7) ne sont pas encore commencés. La PWA a été
vérifiée à la main le 2026-10-28, dans Chrome DevTools et sur téléphone (voir
« Vérification manuelle » plus bas).

## Installation

Prérequis : Python 3.14, [uv](https://docs.astral.sh/uv/) et Node.js
(20.19+ ou 22.12+, exigé par Vite 8 ; 22 en CI, testé aussi en 24) installés
sur la machine.

```powershell
.\scripts\run.ps1 install
```

```bash
./scripts/run.sh install
```

`scripts/run.ps1` (Windows) et `scripts/run.sh` (Linux/macOS/WSL) sont le
point d'entrée unique du tooling de ce dépôt, avec une sous-commande par
action : `install`, `test`, `build`, `dev` (détaillées ci-dessous).

La commande `install` installe le backend avec `uv sync --extra dev` (crée `backend/.venv`
et l'installe à partir de `backend/uv.lock`, dépendances de dev incluses —
pytest, httpx, ruff), et installe les dépendances du frontend (`npm ci` dans
`frontend/`). Il peut être relancé sans risque après avoir tiré des
changements qui touchent `pyproject.toml`, `uv.lock` ou `package.json`.

Le backend est géré par `uv` (pas `pip`/`venv` manuel) : `backend/uv.lock`
verrouille toutes les versions résolues et doit être commité comme
`package-lock.json` côté frontend. Toute commande Python du backend passe par
`uv run` (ex. `uv run pytest`, `uv run ruff check .`) depuis `backend/`, pour
s'exécuter dans le même environnement verrouillé qu'en CI.

## Développement local

La sous-commande `dev` lance le backend et le frontend en parallèle,
accessibles à la fois en local et depuis le réseau Wifi (pratique pour tester
l'installation PWA sur un téléphone).

```powershell
.\scripts\run.ps1 dev
```

```bash
./scripts/run.sh dev
```

Le backend écoute sur `http://localhost:8000` (et sur l'IP réseau locale
détectée automatiquement), le frontend sur `http://localhost:5173`. Le script
calcule et exporte `BACKEND_CORS_ORIGINS` à la volée pour que le backend
accepte les requêtes venant de ces deux origines. Ports personnalisables via
`-BackendPort`/`-FrontendPort` (`run.ps1`) ou les variables d'environnement
`BACKEND_PORT`/`FRONTEND_PORT` (`run.sh`).

### Première connexion (comptes, Lot 6)

Depuis le Lot 6, toute route métier exige une session : au premier lancement,
l'application affiche un mur de connexion. Deux cas, selon la base utilisée :

- **Base de développement existante** (`backend/vtes.db`, celle qui contient la
  vraie collection) : une fois migrée (`uv run alembic upgrade head`), ses
  données appartiennent au compte historique (`id = 1`), dont le mot de passe
  est volontairement inutilisable tant qu'il n'a pas été réclamé. Le réclamer
  avec une vraie adresse, un nom et un mot de passe (voir
  `docs/deploiement.md` et `backend/scripts/manage_accounts.py`) :

  ```bash
  uv run python scripts/manage_accounts.py claim-legacy --email <adresse> --username <nom>
  ```

- **Base neuve** (migrée puis vide, ou après `scripts/import_catalog.py` sans
  stock ni deck) : l'inscription est ouverte, un simple `POST /inscription`
  (formulaire « Créer un compte » du mur de connexion) suffit à créer un
  compte utilisable aussitôt.

### Comment le frontend atteint le backend en dev

Le projet retient les **appels directs vers l'origine du backend**, ouverts
via CORS (`BACKEND_CORS_ORIGINS`, voir `backend/app/main.py`), plutôt qu'un
proxy Vite (`server.proxy`) qui ferait apparaître l'API en même origine que le
frontend. Deux raisons à ce choix, déjà engagées dans le code existant :

- `scripts/run.ps1 dev` / `run.sh dev` calculent dynamiquement la liste des origines
  autorisées (localhost, 127.0.0.1, IP Wifi locale) pour permettre les tests
  d'installation PWA sur téléphone ; ce mécanisme n'a de sens que si le front
  appelle le backend cross-origin. Un proxy Vite rendrait cette configuration
  inutile mais imposerait de garder le frontend et le backend sur la même
  machine/porte d'entrée, y compris en production.
- Garder le frontend (statique, déployable seul derrière n'importe quel
  hébergeur HTTPS) et le backend (FastAPI/uvicorn, avec son propre certificat)
  strictement découplés évite d'avoir à faire reposer l'installabilité PWA sur
  la présence d'un reverse proxy applicatif : seule l'origine qui sert le
  frontend a besoin d'HTTPS pour l'installation (voir plus bas), le backend
  peut être servi séparément.

Le client TS généré (`frontend/src/api-client/client.ts`) appelle donc le
backend à l'adresse donnée par `VITE_API_BASE_URL` (défaut
`http://localhost:8000`). Depuis le Lot 6, il envoie le cookie de session
(`credentials: "include"`) et le backend répond avec `allow_credentials` sur la
liste fermée d'origines. Conséquence pratique : ouvrir le front sur
`localhost` et l'API sur `127.0.0.1` (ou l'inverse) casse la session sans
message, les deux noms étant des sites distincts pour le navigateur.

## Tests

```powershell
.\scripts\run.ps1 test
```

```bash
./scripts/run.sh test
```

La sous-commande `test` lance, dans le même ordre que la CI : le lint backend (`uv run ruff check .`),
les tests backend (`uv run pytest`), le garde-fou de contrat
(`uv run python scripts/export_openapi.py --check`), le lint frontend
(`npm run lint`, ESLint), puis les tests frontend (`npm run test`,
`npm run test:e2e`) **si** ces scripts existent déjà dans
`frontend/package.json` — sinon l'étape correspondante est annoncée comme
ignorée plutôt que de faire échouer le script. Option `-SkipFrontendE2e` /
`--skip-frontend-e2e` pour sauter les tests Playwright (plus lents,
nécessitent les navigateurs Playwright installés localement via
`npx playwright install`).

## Build et validation d'installabilité PWA

```powershell
.\scripts\run.ps1 build
```

```bash
./scripts/run.sh build
```

La sous-commande `build` vérifie que le backend s'importe correctement, build le frontend
(`npm run build`, produit `frontend/dist`), puis valide l'installabilité du
build avec `scripts/check-pwa-installability.mjs` :

- présence et validité JSON du `manifest.webmanifest` (champs `name`,
  `short_name`, `start_url`, `display`, `icons`) ;
- icônes du manifest réellement présentes dans le build et dont les
  dimensions PNG réelles correspondent aux tailles déclarées, avec au moins
  une icône ≥ 192×192 et une ≥ 512×512 (seuils utilisés par Chrome/Android
  pour proposer l'installation) ;
- présence d'une icône `maskable` (recommandé, pas bloquant) ;
- présence d'un service worker généré (`sw.js`) ;
- `index.html` référence bien le manifest.

Ce script peut aussi être pointé sur un déploiement en ligne :

```bash
node scripts/check-pwa-installability.mjs --url https://exemple.tld
```

Dans ce mode, il vérifie en plus que l'URL est servie en HTTPS (sauf
`localhost`) et que la page, le manifest et le service worker y sont
accessibles.

**Rappel factuel** : la catégorie « PWA » de Lighthouse a été retirée en
v12 ; il n'existe plus de « score PWA » à obtenir, et ce projet n'en vise
aucun. La validation ci-dessus porte sur les critères réels d'installabilité,
pas sur un score.

### Vérification manuelle

Le script ne remplace pas un contrôle dans un vrai navigateur. Restent
volontairement non automatisés, à vérifier via le panneau **Application** de
Chrome DevTools et/ou un test d'installation sur téléphone. Fait le 2026-10-28
(panneau Application, coupure réseau réelle, installation sur téléphone) ; à
refaire après un changement du manifest ou du service worker :

- enregistrement effectif du service worker au runtime (pas seulement sa
  présence sur disque) ;
- comportement hors-ligne réel après un premier chargement (app shell servi
  depuis le cache, cf. Lot 3 pour la synchronisation des écritures) ;
- apparition de l'invite d'installation (« Ajouter à l'écran d'accueil ») et
  déroulé de l'installation sur un appareil réel ;
- contenu effectif du `Storage` (cache Workbox, base IndexedDB du compte
  connecté, `gurchon-hall-offline-u<id>`).

Le comportement hors ligne de l'application (coupure, saisie, rechargement,
rejeu) est en revanche couvert par les tests Playwright contre un vrai back
(`frontend/tests/e2e-real/`) ; ce qui reste manuel, c'est la vérification dans
un navigateur réel et l'installation sur téléphone.

## HTTPS

- **Hors `localhost`** : HTTPS est requis pour que le service worker
  s'enregistre et que la PWA soit installable. C'est une exigence du
  navigateur, pas une option de configuration du projet.
- **En dev** (`localhost`/`127.0.0.1`, y compris l'IP Wifi locale utilisée par
  `scripts/run.ps1 dev`/`run.sh dev` pour les tests sur téléphone) : les navigateurs
  traitent `localhost` comme un contexte sécurisé même en HTTP, donc aucune
  configuration HTTPS locale n'est nécessaire pour développer ou tester
  l'installation depuis le même réseau. Attention : une IP Wifi (ex.
  `192.168.x.x`) n'est **pas** traitée comme `localhost` par tous les
  navigateurs mobiles — si l'installation ne se propose pas sur téléphone via
  l'IP locale alors qu'elle fonctionne sur `localhost` desktop, c'est la cause
  la plus probable, pas un bug de configuration.
- **Déploiement** : prévu au Lot 11, par un playbook Ansible qui réutilise
  l'infrastructure de déploiement de barrins-project, où gurchon-hall sera
  hébergé temporairement (CLAUDE.md §12). La contrainte reste la même : le
  frontend doit être servi en HTTPS pour être installable, et le cookie de
  session `__Host-` exige lui aussi HTTPS hors `localhost`.

## Variables d'environnement

Le backend lit ses options directement dans l'environnement du processus
(`os.getenv`, pas de fichier `.env` chargé automatiquement — aucune dépendance
du projet ne le fait). `backend/.env.example` documente chaque variable avec sa
valeur par défaut et son usage ; pour s'en servir, exporter la variable voulue
avant de lancer une commande (`export X=...` en bash, `$env:X = "..."` en
PowerShell) plutôt que de s'attendre à ce qu'un fichier soit lu tout seul.
Résumé :

- `DATABASE_URL` : URL SQLAlchemy de la base (défaut `backend/vtes.db`).
- `BACKEND_CORS_ORIGINS` : origines autorisées, séparées par des virgules (voir
  plus haut).
- `SESSION_COOKIE_SECURE` (Lot 6, défaut vrai) : attribut `Secure` du cookie de
  session. Chrome et Firefox sont réputés accepter un cookie `Secure` sur
  `http://localhost`, ce qui a été vérifié à la main le 2026-10-28 sur le
  navigateur en usage (`backend/.env.example`, CLAUDE.md §11 Lot 6). Si
  une connexion semble réussir (`POST /connexion` rend 200 avec un
  `Set-Cookie`) mais qu'un appel suivant rend quand même 401, mettre cette
  variable à `false` en développement local sur `http://localhost` est le
  premier réflexe. Hors `localhost`, HTTPS est de toute façon requis pour la
  PWA (voir plus haut) : garder la valeur par défaut en production.
- `ARGON2_MEMORY_COST_KIB`, `ARGON2_TIME_COST`, `ARGON2_PARALLELISM` (Lot 6,
  défauts 65536 / 3 / 4, alignés sur barrins-project) : coûts du hachage
  Argon2id des mots de passe. La CI les abaisse (voir plus bas) ; le
  développement local et la production gardent les défauts.
- `LOGIN_RATE_LIMIT`, `SIGNUP_RATE_LIMIT` (Lot 6, défaut `5/minute` chacune) :
  débit autorisé pour `POST /connexion` et `POST /inscription`, par adresse IP,
  en mémoire du processus (`slowapi`).

## Intégration continue

`.github/workflows/ci.yml` définit deux jobs, sur push/PR vers `main` :

- **backend** : `astral-sh/setup-uv` (avec cache), `uv sync --extra dev`,
  `uv run ruff check .`, `uv run pytest`, puis
  `uv run python scripts/export_openapi.py --check` en étape séparée
  (garde-fou contract-first explicite, même si un test pytest le couvre
  déjà) ;
- **frontend** : `npm ci`, `npm run lint` (ESLint), build, validation
  d'installabilité PWA, puis tests `vitest` et `test:e2e` (Playwright) —
  détectés dynamiquement dans `frontend/package.json` plutôt que présumés,
  avec un avertissement CI explicite si l'un de ces scripts venait à
  manquer.

Dependabot (`.github/dependabot.yml`) suit les dépendances via l'écosystème
natif `uv` (pas `pip`) pour `backend/uv.lock`, l'écosystème `npm` pour
`frontend/package-lock.json`, et l'écosystème `github-actions` pour les
workflows.

**Coûts Argon2 réduits en CI (Lot 6)** : `.github/workflows/ci.yml` positionne
`ARGON2_MEMORY_COST_KIB=8192` et `ARGON2_TIME_COST=1` au niveau du workflow
(donc pour les deux jobs, y compris le vrai back lancé par les e2e
`real-backend`). Sans cela, la suite `pytest` est passée de quelques minutes à
8 min 26 s une fois l'authentification posée : la quasi-totalité des tests
passe maintenant par un hachage Argon2 à coût plein (65536 KiB, time_cost=3),
puisqu'aucun test ne surcharge ces variables aujourd'hui
(`backend/tests/conftest.py`). Les valeurs choisies restent au-dessus d'un
minimum dérisoire (le mécanisme Argon2 reste réellement exercé, pas contourné)
; le développement local et la production gardent les défauts documentés dans
`backend/.env.example`. Si la durée de la suite pytest redevient gênante, une
autre option, non retenue ici, serait qu'une fixture pytest surcharge ces
variables directement (hors du périmètre DevOps : relève de qa-tests ou
backend-fastapi, cf. `backend/tests/conftest.py`).

## Déploiement

`docs/deploiement.md` fixe l'ordre à respecter pour une mise en service (Lot 6,
comptes) : migrer, réclamer le compte historique par CLI, puis seulement
ouvrir l'application. Le Lot 11 (CLAUDE.md §12) détaillera le reste
(hébergement, HTTPS, playbook Ansible) ; cette note ne couvre que l'ordre des
opérations et les variables d'environnement liées aux comptes et à la PWA.

## Portage vers Barrin (aperçu)

La couche offline (config `vite-plugin-pwa`/Workbox dans `frontend/vite.config.ts`,
paquet `frontend/src/offline/` : enregistrement du service worker, base Dexie,
file d'attente et moteur de rejeu, avec un cœur générique séparé de
l'adaptateur VtES) est pensée pour être transplantée sur barrins-project avec un
minimum d'adaptation. Son API et les points d'ajustement (préfixes de routes
API notamment) sont décrits dans `frontend/src/offline/README.md` ; le portage
lui-même est le Lot 10. Les scripts `scripts/run.ps1`/`run.sh` de ce dépôt
n'ont aucune dépendance au domaine VtES et sont directement réutilisables tels
quels sur un monorepo Vite + FastAPI équivalent.
