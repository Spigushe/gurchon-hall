# gurchon-hall

Suivi de pratique *Vampire: The Eternal Struggle* (collection, decks, parties,
tournois), développé comme pilote pour dérisquer une PWA offline-first avant
de porter l'approche sur barrins-project.

Stack prévue : React + TypeScript (Vite) côté front, FastAPI + SQLAlchemy +
SQLite côté back, contrat OpenAPI partagé entre les deux, IndexedDB (Dexie)
pour le stockage hors-ligne.

Le détail complet — objectifs, modèle de données, contrat d'API, agents et
skills Claude Code, roadmap — est dans [CLAUDE.md](CLAUDE.md). Les conventions
de travail pour les agents sont dans [AGENTS.md](AGENTS.md).

## État actuel

Lot 0 en cours de finalisation (voir CLAUDE.md §12) : backend FastAPI minimal
(`GET /health`, contrat OpenAPI exporté), frontend React + Vite avec manifest
et service worker (PWA) en place, contrat d'API versionné dans `contracts/`.
Le tooling de build/test/CI et la validation d'installabilité décrits
ci-dessous font partie de cette finalisation.

## Installation

Prérequis : Python 3.14, [uv](https://docs.astral.sh/uv/) et Node.js (18+,
testé avec la version 22/24) installés sur la machine.

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

Ce point n'a pas encore d'effet concret en Lot 0 (aucun appel API n'est câblé
côté frontend : `contracts/README.md` précise que le client TS généré arrive
au Lot 1). Il documente la direction à suivre quand ce client sera introduit.

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

### Limites — vérification manuelle restante

Le script ne remplace pas un contrôle dans un vrai navigateur. Restent
volontairement non automatisés, à vérifier via le panneau **Application** de
Chrome DevTools et/ou un test d'installation sur téléphone :

- enregistrement effectif du service worker au runtime (pas seulement sa
  présence sur disque) ;
- comportement hors-ligne réel après un premier chargement (app shell servi
  depuis le cache, cf. Lot 3 pour la synchronisation des écritures) ;
- apparition de l'invite d'installation (« Ajouter à l'écran d'accueil ») et
  déroulé de l'installation sur un appareil réel ;
- contenu effectif du `Storage` (cache Workbox, IndexedDB une fois introduit
  au Lot 3).

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
- **Déploiement** : aucune plateforme cible n'est encore choisie pour ce pilote
  (hors périmètre du Lot 0). Quel que soit l'hébergeur retenu pour la suite,
  la contrainte reste la même : le frontend doit être servi en HTTPS pour être
  installable. La plupart des hébergeurs statiques (Netlify, Vercel, GitHub
  Pages, Cloudflare Pages…) fournissent un certificat automatiquement ; un
  hébergement maison nécessiterait un reverse proxy TLS (ex. Caddy, qui
  provisionne Let's Encrypt automatiquement) devant `uvicorn` côté backend et
  devant les fichiers statiques du frontend.

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

Ce fichier est présent dans le dépôt mais n'a pas encore été poussé sur
GitHub ni activé côté organisation : à committer et pousser explicitement
quand la CI doit démarrer.

## Portage vers Barrin (aperçu)

La couche offline (config `vite-plugin-pwa`/Workbox dans `frontend/vite.config.ts`,
enregistrement du service worker dans `frontend/src/offline/`) est pensée pour
être transplantée sur barrins-project avec un minimum d'adaptation : voir les
commentaires dédiés dans ces fichiers pour les points d'ajustement (préfixes de
routes API notamment). Les scripts `scripts/run.ps1`/`run.sh` de ce dépôt
n'ont aucune dépendance au domaine VtES et sont directement réutilisables tels
quels sur un monorepo Vite + FastAPI équivalent.
