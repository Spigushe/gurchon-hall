# gurchon-hall

Suivi de pratique *Vampire: The Eternal Struggle* : la collection, comptée par
carte, langue et extension, les decks, les parties et les tournois. L'outil est
en production depuis la v1.0.0 (2026-11-17) sur
[gurchon.spigushe.com](https://gurchon.spigushe.com), et la version en ligne est
la v1.1.1 (2026-11-21).

C'est une PWA *offline-first* : on saisit une partie au club, sans réseau
fiable, et elle se synchronise au retour de la connexion. Ce n'est pas une
option, c'est une exigence de l'outil.

Stack : React + TypeScript (Vite) côté front, FastAPI + SQLAlchemy + SQLite
côté back, contrat OpenAPI partagé entre les deux, IndexedDB (Dexie) pour le
stockage hors ligne.

Le détail complet (objectifs, modèle de données, contrat d'API, décisions,
agents et skills Claude Code, feuille de route) est dans
[CLAUDE.md](CLAUDE.md). Les conventions de travail pour les agents sont dans
[AGENTS.md](AGENTS.md).

Les assistants compatibles MCP peuvent utiliser Primogen, le serveur public de
KRCG pour les cartes, les règles et leurs rulings. Il est configuré au niveau du
projet dans [`.mcp.json`](.mcp.json) et n'est pas une dépendance de l'application.

## État actuel

Livré jusqu'au Lot 13, dont la mise en ligne (v1.2.0) est en cours (détail et limites connues au §12 de CLAUDE.md) :

- catalogue complet importé depuis krcg, avec une recherche hors ligne aux
  filtres de VDB (onglet Chercher) ;
- collection par carte × langue × extension, versement d'un produit entier ;
- decks avec légalité VEKN, proxies, archivage, composition en tableaux à
  icônes, import depuis VDB (texte collé, fichier ou lien de deck) et export
  aux formats `TEXT`, `TWD`, `JOL` et `LACKEY` de VDB ;
- partage d'une decklist par un lien public, vivant ou figé, lu sans compte :
  révision par l'adresse, duplication et comparaison avec un de ses decks ;
- parties et tournois du point de vue du joueur (VP, GW, siège, classement,
  mono ou multi-deck), liste jouée figée en versions numérotées, bilan par
  deck, lieu, mois, position à la table et adversaire ;
- comptes : inscription, connexion, sessions de 14 jours sans usage et
  90 jours au plus, changement de mot de passe, liste et fermeture des
  sessions, export complet du compte en JSON ;
- PWA : app shell en cache, saisie hors ligne dans IndexedDB, file
  d'opérations rejouée vers `POST /sync` au retour du réseau, mise à jour de
  l'application proposée par un bandeau, qui attend que les saisies en file
  soient synchronisées ;
- UI mobile et bureau (design system Nocturne).

La suite (inventaires et classeurs, decks par inventaire, import d'une
collection VDB, liste des manques) est la feuille de route de la v2, au §12 de
CLAUDE.md.

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
action : `install`, `test`, `crap`, `build`, `dev`, `preview` (détaillées
ci-dessous).

La commande `install` installe le backend avec `uv sync --extra dev` (crée
`backend/.venv` à partir de `backend/uv.lock`, dépendances de dev incluses :
pytest, httpx, ruff, coverage), et installe les dépendances du frontend
(`npm ci` dans `frontend/`). Elle se relance sans risque après avoir tiré des
changements qui touchent `pyproject.toml`, `uv.lock` ou `package.json`.

Le backend est géré par `uv` (pas `pip`/`venv` à la main) : `backend/uv.lock`
verrouille toutes les versions résolues et se commite comme
`package-lock.json` côté frontend. Toute commande Python du backend passe par
`uv run` (ex. `uv run pytest`, `uv run ruff check .`) depuis `backend/`, pour
tourner dans le même environnement verrouillé qu'en CI.

Une base neuve se prépare depuis `backend/` par
`uv run alembic upgrade head`, puis `uv run python scripts/import_catalog.py`
pour importer le catalogue. Sans `DATABASE_URL`, ces commandes visent
`backend/vtes.db`. L'API refuse de démarrer contre une base qui n'est pas à la
dernière révision.

## Développement local

La sous-commande `dev` lance le backend et le frontend en parallèle,
accessibles à la fois en local et depuis le réseau Wifi (pratique pour essayer
l'application sur un téléphone).

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

Le serveur de dev Vite n'a pas de service worker : pour vérifier le hors-ligne et
l'installation sur un téléphone, il faut le build. La sous-commande `preview` le
refait, puis lance le backend et `vite preview` (port 4173, `-PreviewPort` ou
`PREVIEW_PORT`), avec les mêmes réglages de CORS et de cookie que `dev` :

```powershell
.\scripts\run.ps1 preview            # -SkipBuild pour servir le build existant
```

```bash
./scripts/run.sh preview             # --skip-build pour servir le build existant
```

Les deux sous-commandes autorisent en CORS les ports 5173 et 4173 sur chaque hôte,
si bien qu'un `npm run preview` lancé à part fonctionne aussi derrière `dev`. Le build
fige `VITE_API_BASE_URL` : pour un téléphone, `frontend/.env.local` doit viser l'IP du
poste sur le réseau, et `preview` prévient si elle n'y figure pas.

### Première connexion

Toute route métier exige une session : au premier lancement, l'application
affiche un mur de connexion. Deux cas, selon la base utilisée :

- **Base neuve** : l'inscription est ouverte, le formulaire « Créer un
  compte » du mur de connexion suffit, et le compte est utilisable aussitôt.
  Un compte peut aussi se créer en ligne de commande
  (`uv run python scripts/manage_accounts.py create`).
- **Base d'avant le Lot 6** : une fois migrée, ses données appartiennent au
  compte historique (`id = 1`), dont le mot de passe est volontairement
  inutilisable tant qu'il n'a pas été réclamé :

  ```bash
  uv run python scripts/manage_accounts.py claim-legacy --email <adresse> --username <nom>
  ```

`manage_accounts.py` gère aussi les mots de passe, les rôles et les sessions ;
le mot de passe se saisit toujours au clavier, jamais en argument.

### Comment le frontend atteint le backend

Le projet retient les **appels directs vers l'origine du backend**, ouverts
via CORS (`BACKEND_CORS_ORIGINS`, voir `backend/app/main.py`), plutôt qu'un
proxy Vite (`server.proxy`) qui ferait apparaître l'API en même origine que le
frontend. C'est aussi la disposition de la production : la PWA sur
`gurchon.spigushe.com`, l'API sur `api-gurchon.spigushe.com`.

- `scripts/run.ps1 dev|preview` / `run.sh dev|preview` calculent la liste des
  origines autorisées (localhost, 127.0.0.1, IP Wifi locale) pour les essais
  sur téléphone ; ce mécanisme n'a de sens que si le front appelle le backend
  d'une autre origine.
- Le frontend (statique) et le backend (FastAPI/uvicorn) restent découplés et
  se déploient chacun de leur côté.

Le client TS généré (`frontend/src/api-client/client.ts`) appelle donc le
backend à l'adresse donnée par `VITE_API_BASE_URL` (défaut
`http://localhost:8000`). Il envoie le cookie de session
(`credentials: "include"`), et le backend répond avec `allow_credentials` sur la
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

La sous-commande `test` lance, dans le même ordre que la CI : le lint backend
(`uv run ruff check .`), les tests backend sous couverture
(`uv run coverage run -m pytest`) suivis du contrôle du score CRAP, le
garde-fou de contrat (`uv run python scripts/export_openapi.py --check`), le
lint frontend (`npm run lint`, ESLint), le contrôle de types des tests
(`npm run typecheck:tests`), puis les tests frontend (`npm run test:coverage`
suivi de `npm run crap`, puis `npm run test:e2e`). Option `-SkipFrontendE2e` /
`--skip-frontend-e2e` pour sauter les tests Playwright, plus lents, qui
demandent les navigateurs Playwright installés localement
(`npx playwright install`).

Sous Windows, vitest se lance depuis PowerShell, dans un chemin en `C:\…` :
depuis Git Bash, en `/c/…`, chaque fichier de test échoue.

La sous-commande `crap` (`.\scripts\run.ps1 crap`, `./scripts/run.sh crap`)
ne lance que les tests unitaires des deux couches sous couverture et le
contrôle du score CRAP : complexité cyclomatique croisée avec la couverture,
fonction par fonction, seuil 30, comparée aux références de
`docs/qa-baselines/crap/`. Règles de comptage et politique de la référence
dans `docs/qa-crap.md`.

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
node scripts/check-pwa-installability.mjs --url https://gurchon.spigushe.com
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
volontairement non automatisés, à vérifier dans le panneau **Application** de
Chrome DevTools et par une installation sur téléphone, à refaire après un
changement du manifest, du service worker ou du miroir Dexie :

- enregistrement effectif du service worker au runtime (pas seulement sa
  présence sur disque) ;
- comportement hors ligne réel après un premier chargement ;
- apparition de l'invite d'installation et déroulé de l'installation sur un
  appareil réel ;
- contenu effectif du `Storage` (cache Workbox, base IndexedDB du compte
  connecté, `gurchon-hall-offline-u<id>`) ;
- une saisie laissée en file avant une mise à jour se rejoue sans perte après.

Dernières vérifications : en HTTPS sur la production, le 2026-11-17 (v1.0.0)
puis le 2026-11-20 (v1.1.0, avec une saisie en file rejouée après la mise à
jour).

Le comportement hors ligne de l'application (coupure, saisie, rechargement,
rejeu) est en revanche couvert par les tests Playwright contre un vrai back
(`frontend/tests/e2e-real/`).

## HTTPS

- **Hors `localhost`** : HTTPS est requis pour que le service worker
  s'enregistre et que la PWA soit installable. C'est une exigence du
  navigateur, pas une option de configuration du projet. Le cookie de session
  `__Host-` l'exige aussi, de même que le presse-papiers (« Copier » de
  l'export VDB) et `navigator.storage.persist()`.
- **En dev** (`localhost`/`127.0.0.1`) : les navigateurs traitent `localhost`
  comme un contexte sécurisé même en HTTP, aucune configuration HTTPS locale
  n'est nécessaire. Une IP Wifi (ex. `192.168.x.x`) n'est **pas** traitée
  comme `localhost` : sur un téléphone en `http://` par l'IP locale, pas de
  service worker, pas d'installation, et « Copier » se replie sur la
  sélection du texte. Ce n'est pas un bug de configuration.
- **En production** : certificats Let's Encrypt posés par le playbook de
  déploiement (voir plus bas).

## Variables d'environnement

Le backend lit ses options directement dans l'environnement du processus
(`os.getenv`, pas de fichier `.env` chargé automatiquement).
`backend/.env.example` documente chaque variable avec sa valeur par défaut et
son usage ; pour s'en servir, exporter la variable voulue avant de lancer une
commande (`export X=...` en bash, `$env:X = "..."` en PowerShell). Résumé :

- `DATABASE_URL` : URL SQLAlchemy de la base (défaut `backend/vtes.db`).
- `SCHEMA_REVISION_CHECK` (défaut vrai) : l'API refuse de démarrer contre une
  base qui n'est pas à la dernière révision Alembic ; `false` ramène l'arrêt à
  un avertissement, réservé aux tests.
- `BACKEND_CORS_ORIGINS` : origines autorisées, séparées par des virgules (voir
  plus haut).
- `SESSION_COOKIE_SECURE` (défaut vrai) : attribut `Secure` du cookie de
  session. Chrome et Firefox acceptent un cookie `Secure` sur
  `http://localhost` (vérifié le 2026-10-28). Si une connexion semble réussir
  mais qu'un appel suivant rend quand même 401, le passer à `false` en
  développement local est le premier réflexe. Garder la valeur par défaut en
  production.
- `SESSION_IDLE_DAYS`, `SESSION_MAX_DAYS` (Lot 12, défauts 14 et 90) : une
  session expire après tant de jours sans usage, et au plus tard tant de jours
  après la connexion. L'API refuse de démarrer si la première dépasse la
  seconde.
- `ARGON2_MEMORY_COST_KIB`, `ARGON2_TIME_COST`, `ARGON2_PARALLELISM` (défauts
  65536 / 3 / 4) : coûts du hachage Argon2id des mots de passe. La CI les
  abaisse (voir plus bas) ; le développement local et la production gardent
  les défauts.
- `LOGIN_RATE_LIMIT`, `SIGNUP_RATE_LIMIT`, `PASSWORD_CHANGE_RATE_LIMIT`
  (défaut `5/minute` chacune) et `VDB_RATE_LIMIT` (défaut `20/minute`) : débit
  autorisé pour `POST /connexion`, `POST /inscription`,
  `POST /moi/mot-de-passe` et `GET /vdb/decks/{id}`, par adresse IP, en
  mémoire du processus (`slowapi`).
- `LOG_LEVEL` (défaut `INFO`) et `LOG_FORMAT` (`json` par défaut, ou `text`) :
  journaux de l'API sur la sortie standard, une ligne par requête
  (`http.request`) et une par lot `/sync` (`sync.batch`), sans corps de
  requête, adresse IP ni mot de passe.
- `VDB_STUB_DIR` : jamais en production. Fait lire à `GET /vdb/decks/{id}` un
  dossier de réponses au lieu de joindre vdb.im (tests e2e,
  `scripts/vdb_stub.py`).

En production, l'unité systemd pose en plus `FORWARDED_ALLOW_IPS=127.0.0.1`
(uvicorn prend l'adresse du client dans `X-Forwarded-For` posé par nginx) et
`UVICORN_ACCESS_LOG=false` (les journaux d'accès d'uvicorn doubleraient
`http.request`).

## Intégration continue

`.github/workflows/ci.yml` définit deux jobs, sur push vers `main` et sur
chaque PR :

- **backend** : `astral-sh/setup-uv` (avec cache), `uv sync --extra dev`,
  `uv run ruff check .`, `uv run coverage run -m pytest` puis le score CRAP
  (`scripts/crap_report.py`), puis
  `uv run python scripts/export_openapi.py --check` en étape séparée
  (garde-fou contract-first explicite, même si un test pytest le couvre
  déjà) ;
- **frontend** : `npm ci`, `npm run lint` (ESLint), `npm run typecheck:tests`,
  build, validation d'installabilité PWA, puis tests `vitest` sous couverture,
  score CRAP (`npm run crap`) et `test:e2e` (Playwright, dont les projets qui
  tournent contre un vrai back sur base éphémère, d'où l'installation du
  backend dans ce job aussi).

Dependabot (`.github/dependabot.yml`) suit les dépendances via l'écosystème
natif `uv` (pas `pip`) pour `backend/uv.lock`, l'écosystème `npm` pour
`frontend/package-lock.json`, et l'écosystème `github-actions` pour les
workflows.

**Coûts Argon2 réduits en CI** : `.github/workflows/ci.yml` positionne
`ARGON2_MEMORY_COST_KIB=8192` et `ARGON2_TIME_COST=1` au niveau du workflow
(donc pour les deux jobs, y compris le vrai back lancé par les e2e). Presque
tous les tests passent par un hachage Argon2, et à coût plein la suite pytest
durait plusieurs minutes de plus. Les valeurs choisies restent au-dessus d'un
minimum dérisoire, pour que le mécanisme soit réellement exercé ; le
développement local et la production gardent les défauts.

## Déploiement

Le playbook Ansible `ops/gurchon_hall.yml` met l'application en ligne sur un
VPS : la PWA sur `gurchon.spigushe.com`, l'API sur `api-gurchon.spigushe.com`,
et un staging sur les mêmes noms suffixés de `-staging`. Le dossier `ops/` est
autonome (rôles, inventaire, collection requise) ; seul le jeton GitHub,
ignoré par git, est à fournir.

- **Production** : la dernière release GitHub complète (une pré-release est
  ignorée), front et API ensemble.
- **Staging** : la branche `main` (`-e deploy_env=staging`).
- **À chaque passage** : sauvegarde de la base SQLite, migration Alembic,
  import du catalogue krcg, puis redémarrage de l'API.
- **Sauvegardes** : une avant chaque déploiement et une chaque nuit, gardées
  quatorze jours sur le VPS ; `ops/fetch_backups.sh` les recopie sur le poste,
  dans `ops/sauvegardes/` (ignoré par git).

Commandes, ordre d'une première mise en service, journaux, restauration d'une
sauvegarde et retour arrière : [docs/deploiement.md](docs/deploiement.md).

## Couche offline

La couche offline (config `vite-plugin-pwa`/Workbox dans
`frontend/vite.config.ts`, paquet `frontend/src/offline/` : enregistrement du
service worker, base Dexie, file d'attente et moteur de rejeu) sépare un cœur
générique (`core/`, `react/`), qui ne connaît rien de VtES, de l'adaptateur du
domaine (`vtes/`). Son API, ce qu'elle garantit, le multi-compte, le
versionnage du schéma IndexedDB et le service worker sont décrits dans
`frontend/src/offline/README.md`.
