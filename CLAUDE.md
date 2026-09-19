# CLAUDE.md — Suivi VtES (React + FastAPI + PWA)

> Fichier de contexte projet pour Claude Code. Décrit l'objectif, la stack, le
> modèle de données, le contrat d'API, les agents et les skills. À lire avant
> toute intervention.

**État actuel** : **Lots 0 et 1 livrés.**
Lot 0 : squelette monorepo, FastAPI `/health`, React/Vite, PWA installable. Lot 1 :
outillage (uv, ruff, ESLint), modèle relationnel SQLAlchemy (21 tables), migration
Alembic initiale, schémas Pydantic, chaîne de génération du client TS. L'arborescence
du §4 existe, avec en plus `scripts/` (commandes unifiées) et `.github/` (CI, Dependabot).

Commandes réelles : un seul script par plateforme, `scripts/run.ps1 <install|test|build|dev>`
(équivalent `scripts/run.sh`). Back (depuis `backend/`, via uv) : `uv sync --extra dev`,
`uv run pytest` (520 tests), `uv run ruff check .`, `uv run alembic upgrade head`.
Front (depuis `frontend/`) : `npm run lint`, `npm run test` (vitest, 16 tests),
`npm run test:e2e` (Playwright, 6 tests dont le scénario offline),
`npm run generate:client` (régénère `src/api-client/schema.d.ts`).

**Aucun endpoint métier n'existe encore** : l'API n'expose que `/health`, donc
`contracts/openapi.json` et le client TS généré ne couvrent que cette route. Les
routes `/cartes`, `/stock`, `/decks`… arrivent au Lot 2 ; les schémas Pydantic du
Lot 1 (`backend/app/schemas/`) sont prêts mais non branchés. Pas de couche offline
IndexedDB ni de `/sync` avant le Lot 3. Ne pas supposer qu'ils existent.

---

## 1. Objectif du projet

Deux objectifs, dans cet ordre de priorité :

1. **Pilote PWA** — servir de projet-test à faible enjeu pour dérisquer une
   **PWA offline-first** avant de porter l'approche sur **barrins-project**
   (déjà en React/FastAPI). La mécanique validée ici (service worker, stockage
   local, synchronisation) doit être **directement réutilisable** sur Barrin.
2. **Outil VtES** — suivre la pratique de *Vampire: The Eternal Struggle* :
   collection (stock **EN et FR séparés**), decks, composition des decks,
   parties (quand / où / quel deck / quel résultat) et **tournois** regroupant
   des parties consécutives (mono-deck ou multi-deck).

Le domaine VtES est un support réel mais **secondaire** au regard de l'objectif
pilote : à chaque arbitrage, privilégier ce qui rend le transfert vers Barrin
plus fiable.

---

## 2. Stack technique

| Couche | Choix | Notes |
|---|---|---|
| Front | **React + TypeScript (Vite)** | même socle que barrins-project |
| PWA | **vite-plugin-pwa** (Workbox) | manifest + service worker |
| Stockage client | **IndexedDB** (via Dexie) | données locales + file d'attente offline |
| Back | **FastAPI + Pydantic v2** | contrat OpenAPI généré |
| ORM / DB | **SQLAlchemy 2.0 + Alembic + SQLite** | mono-utilisateur ; migration Postgres possible plus tard |
| Client API | **client TS typé généré** depuis l'OpenAPI | contract-first, pas de types réécrits à la main |

> Versions précises à figer au démarrage (lockfiles). Ne pas épingler ici des
> numéros de version de mémoire : les fixer via `package.json` / `pyproject.toml`
> au moment de l'init.

**Rappel factuel PWA** : une PWA relève du **front-end** (manifest + service
worker + HTTPS). Elle n'impose rien au back-end ; FastAPI sert l'API, le service
worker gère cache et hors-ligne côté navigateur. **HTTPS est requis** (sauf
`localhost` en dev).

---

## 3. Objectif pilote : ce qui doit être dérisqué

La partie difficile (et la vraie raison du projet) est l'**offline-first** :

1. **App shell en cache** — l'appli s'ouvre et s'affiche sans réseau (precache Workbox).
2. **Saisie hors-ligne** — enregistrer une partie / un tournoi au club sans
   connexion fiable, stockée en **IndexedDB**.
3. **Synchronisation** — rejouer la file d'attente vers l'API au retour du
   réseau, avec gestion des conflits et de l'idempotence.
4. **Installabilité** — manifest valide, service worker enregistré, HTTPS,
   installable sur téléphone. Vérification via le panneau Application de Chrome
   DevTools : la catégorie PWA de Lighthouse a été retirée en v12, donc pas de
   « score PWA » à viser.

Critère de réussite du pilote : ces 4 points passent des tests automatisés et la
validation d'installabilité (critères manifest + service worker + HTTPS), et le
code offline est packagé de façon réutilisable pour Barrin.

---

## 4. Architecture du dépôt (monorepo)

```
/
├─ CLAUDE.md                  ← ce fichier
├─ backend/                   ← FastAPI, SQLAlchemy, Alembic, tests pytest
│  ├─ app/ (routers, models, schemas, services, db)
│  └─ tests/
├─ frontend/                  ← React + Vite + TS, PWA, tests vitest/playwright
│  ├─ src/ (features, components, api-client généré, offline/)
│  └─ tests/
├─ contracts/openapi.json     ← source du contrat (généré depuis le back)
├─ scripts/                   ← commandes unifiées (install/test/build/dev, .ps1 + .sh)
│                               et check-pwa-installability.mjs
├─ .github/                   ← workflow CI + Dependabot
└─ .claude/
   ├─ agents/                 ← 1 fichier .md par agent (voir §8)
   └─ skills/                 ← 1 dossier SKILL.md par skill (voir §9)
```

---

## 5. Glossaire et règles VtES

Repères de conception. Les points **[à confirmer]** doivent être vérifiés dans le
règlement officiel VEKN en vigueur avant d'être codés en règles dures — donnés
ici comme repères, pas comme vérités arrêtées.

- **Carte** : deux catégories — **Crypt** (vampires / *imbued* : capacité, groupe,
  clan, disciplines, sect) et **Library** (un ou plusieurs types : Master, Action,
  Action Modifier, Ally, Combat, Equipment, Event, Political Action, Power,
  Reaction, Retainer).
- **Deck** : **Crypt ≥ 12** cartes ; **Library entre 60 et 90** cartes.
- **Partie** : en général **4 à 5 joueurs** (5 = table idéale). Table directionnelle
  (proie / prédateur) → siège éventuellement pertinent à enregistrer.
- **Score** : **1 VP** par joueur évincé ; **+1 VP** au dernier survivant ; **+0.5 VP**
  à chaque joueur encore en lice à la fin de la partie.
- **Game Win (GW)** : au joueur ayant **strictement plus de VP** que tous les
  autres à la table (pas de GW en cas d'égalité en tête). Mininum de 2 VP à 4 joueurs
  et 2,5 VP à 5 joueurs.
- **Tournoi** : rondes préliminaires + finale (table finale de 4 ou 5). Classement
  par GW puis VP. Format exact **construit** ou **draft**, variable selon l'organisateur.
- **Mono / multi-deck** : mono = même deck sur toutes les parties du tournoi ;
  multi = deck variable d'une ronde à l'autre, valable sur des tournois jusqu'à 12
  joueurs (au-delà, mono-deck obligatoire pour que le tournoi soit sanctionné).
- **Langues** : stock compté séparément **EN** et **FR** ; l'identité d'une carte
  (nom, règles, clan…) est indépendante de la langue.

Ces règles métier sont la responsabilité de l'agent **architecte-contrat** (skill
`regles-vtes`).

---

## 6. Modèle de données (relationnel)

Modèle **livré au Lot 1** : `backend/app/models/` (SQLAlchemy 2.0), migration
initiale `backend/migrations/versions/*_schema_initial_du_suivi_vtes.py`, 21 tables,
noms en anglais technique. Les noms français de l'ancien tableau ne servent plus que
de repère de vocabulaire (`Stock` → `card_copy`, `DeckCarte` → `deck_card`, etc.).

| Domaine | Tables | Points clés |
|---|---|---|
| Référence | `language`, `clan`, `discipline`, `sect`, `card_type`, `card_set`, `venue`, `bundle` | `language` est une table ouverte (seed EN/FR/ES/XX « autre »), pas un enum ; `bundle` = produit (précon) rattaché à une extension |
| Catalogue | `card`, `card_type_link`, `card_discipline_link`, `card_printing`, `card_printing_occurrence`, `card_translation` | `card` = identité indépendante de la langue, clé naturelle `vekn_id` ; `card_translation` (nom, texte, flavor, image par langue) ; impressions = carte × extension, avec occurrences détaillées (rareté, précon + copies, date) |
| Collection | `card_copy`, `deck`, `deck_card` | `card_copy` PK (carte, langue) : `quantity_owned` + `proxy_allowed` ; `deck_card` PK (deck, carte, langue) avec **FK composite vers `card_copy`** : une carte hors collection est refusée en deck, un deck mélange les langues ; `quantity` + `proxy_quantity` |
| Pratique | `player`, `tournament`, `game`, `participation` | un seul « Moi » (index unique partiel) ; `participation.game_win` stocké mais non calculé |

Choix transverses : dates/heures stockées en **UTC** (les schémas d'entrée exigent un
fuseau et normalisent) ; enums fermés (catégorie de carte, statut de deck, mono/multi,
format, type de ronde, type de coût, exigence de discipline, type d'occurrence) portés
par des CHECK nommés en base ; SQLite avec `PRAGMA foreign_keys = ON` sur chaque
connexion (`backend/app/db/session.py`). Le contenu d'un bundle n'est pas une table :
c'est la projection des occurrences `precon` qui le désignent (`BundleContentRead`),
au format carte × exemplaires, entrée prévue pour verser un produit dans le stock.

Points ouverts, **[à confirmer]** : `card.sect_id` nullable et non importé (aucune
source ne fournit la sect) ; énumération réelle des langues (dépend des exemplaires
possédés) ; sémantique exacte du proxy (booléen par carte et langue aujourd'hui, à
trancher avant le Lot 2 si un nombre de proxies possédés est voulu) ; VP/GW.
Le prérequis de titre/sect/capacité des cartes Library n'est pas structuré (krcg ne
l'expose pas, il reste dans le texte de carte).

**Règles portant sur plusieurs lignes** (non exprimables en simples contraintes de
colonne) → à implémenter en logique de service + tests :
- deck valide (crypt ≥ 12 ; library 60–90) ;
- tournoi mono-deck → toutes mes participations pointent le même deck ;
- cohérence VP/GW **[à confirmer]** ;
- réconciliation stock ↔ decks (optionnel, cf. §11).

---

## 7. Contrat d'API (contract-first)

Le **contrat OpenAPI est la source de vérité** partagée front/back. Flux :
schémas Pydantic → OpenAPI (`contracts/openapi.json`) → client TS typé côté front.
Aucun type d'API réécrit à la main côté front.

Ressources principales (REST) : `/cartes`, `/stock`, `/decks`,
`/decks/{id}/cartes`, `/joueurs`, `/tournois`, `/parties`,
`/parties/{id}/participations`. Endpoint de synchronisation pour la file offline :
`POST /sync` (opérations idempotentes, clé d'idempotence côté client).

Toute évolution du contrat passe par l'agent **architecte-contrat** avant
implémentation front/back.

---

## 8. Agents

Modèle d'orchestration : le **chef d'orchestre** planifie, découpe et **délègue**
via l'outil `Task`, puis revoit l'intégration. Il n'écrit pas de code métier. Les
agents spécialisés travaillent chacun dans leur couche, derrière le contrat d'API.

Chaque agent est défini dans `.claude/agents/<nom>.md` (frontmatter YAML
`name` / `description` / `tools` / `model`, puis system prompt).

| Agent | Fichier | Périmètre | Modèle |
|---|---|---|---|
| **Orchestrateur** (chef d'orchestre) | `orchestrateur.md` | plan, découpage, délégation, revue d'intégration, maintien de CLAUDE.md | opus |
| **Architecte contrat & données** | `architecte-contrat.md` | modèle SQLAlchemy, Alembic, schémas Pydantic, OpenAPI, **règles VtES** | opus |
| **Backend FastAPI** | `backend-fastapi.md` | routers, services, persistance, validation | sonnet |
| **Frontend React** | `frontend-react.md` | UI, composants, formulaires, vues, client typé | sonnet |
| **PWA & Offline** | `pwa-offline.md` | manifest, service worker, IndexedDB, sync, installabilité | sonnet |
| **QA & Tests** | `qa-tests.md` | stratégie de test, pytest, vitest, e2e Playwright (offline) | sonnet |
| **DevOps & Déploiement** | `devops-deploiement.md` | monorepo, CI/CD, HTTPS, audit Lighthouse, portage Barrin | sonnet |

Total : 1 chef d'orchestre + 6 agents spécialisés.

---

## 9. Skills fondamentales

Skills = modules `SKILL.md` réutilisables dans `.claude/skills/`. À **créer** pour
le projet (sauf `ecriture-naturelle`, déjà existante côté utilisateur). Chaque
skill a un **agent propriétaire** (owner) et des **agents consommateurs**.

| Skill | Rôle | Owner | Consommateurs |
|---|---|---|---|
| `orchestration` | découpage, backlog, handoffs, revue d'intégration | Orchestrateur | — |
| `modele-donnees` | schéma relationnel, SQLAlchemy 2.0, conventions de nommage | Architecte | Backend |
| `contrat-openapi` | contract-first : Pydantic ↔ OpenAPI ↔ client TS typé | Architecte | Backend, Frontend |
| `migrations-alembic` | créer / appliquer / relire des migrations sûres | Architecte | Backend |
| `regles-vtes` | règles métier (légalité deck, VP/GW, tournoi mono/multi) | Architecte | Backend, QA |
| `fastapi-endpoint` | pattern endpoint (router + schema + service + test) | Backend | — |
| `react-feature` | pattern composant / état / formulaire / consommation client | Frontend | PWA |
| `pwa-offline` | service worker Workbox, IndexedDB/Dexie, sync, installabilité | PWA | QA, DevOps |
| `tests-backend` | pytest : unités, services, contrat | QA | Backend |
| `tests-frontend` | vitest + Testing Library ; Playwright e2e (dont offline) | QA | Frontend |
| `ci-cd-deploiement` | build, HTTPS, gate Lighthouse PWA, déploiement | DevOps | — |
| `ecriture-naturelle` *(existant)* | docs / README lisibles, sans marqueurs IA | Orchestrateur | tous (docs) |

Vue par agent :

- **Orchestrateur** : `orchestration`, `ecriture-naturelle`.
- **Architecte contrat** : `modele-donnees`, `contrat-openapi`, `migrations-alembic`, `regles-vtes`.
- **Backend** : `fastapi-endpoint`, `contrat-openapi`, `migrations-alembic`, `regles-vtes`, `tests-backend`.
- **Frontend** : `react-feature`, `contrat-openapi`, `tests-frontend`.
- **PWA & Offline** : `pwa-offline`, `react-feature`.
- **QA & Tests** : `tests-backend`, `tests-frontend`, `pwa-offline`, `regles-vtes`.
- **DevOps** : `ci-cd-deploiement`, `pwa-offline`.

---

## 10. Conventions

- **Contract-first** : toute évolution d'API commence par le contrat OpenAPI.
- **Nommage** : code et schéma en anglais technique côté implémentation ;
  libellés UI et docs en français.
- **Tests** : toute règle métier VtES a un test dédié (côté back et, si visible, e2e).
- **Migrations** : jamais de modif de schéma sans migration Alembic.
- **Offline** : toute écriture front doit fonctionner hors-ligne puis se
  synchroniser (pas d'appel API bloquant dans le chemin de saisie).
- **Docs** rédigées avec la skill `ecriture-naturelle`.

---

## 11. Décisions

**Tranchées** : stack React + FastAPI + SQLite ; PWA offline-first comme objectif
pilote ; contract-first ; monorepo.

Tranchées pendant le Lot 0 :

- **Python 3.14** (`requires-python = ">=3.14"`) : seule version présente sur la
  machine. Corollaire : **ne plus écrire `from __future__ import annotations`** dans
  le code backend — l'évaluation différée des annotations est native en 3.14 (PEP 649).
- **Pas de préfixe `/api`** sur les routes (cohérent avec §7). Conséquence PWA : les
  routes API doivent rester hors precache et hors fallback de navigation du service
  worker (`navigateFallbackDenylist`), sans quoi le SW les intercepte.
- **Service worker en `autoUpdate`** (pas d'UI « nouvelle version » au Lot 0), avec un
  point d'extension documenté si Barrin a besoin du mode `prompt`.
- **CORS** piloté par la variable d'environnement `BACKEND_CORS_ORIGINS` (défaut dev :
  `localhost:5173` + `127.0.0.1:5173`), non permissif en production.
- **Contrat** : `contracts/openapi.json` est généré par `backend/scripts/export_openapi.py`,
  jamais écrit à la main ; le mode `--check` sert de garde-fou en CI et en test.

Tranchées (contexte VtES, avant Lot 1) :

1. **Catalogue cartes complet**, importé (pas de saisie manuelle du catalogue) depuis
   **krcg**, source unique — décision prise pendant le Lot 1, en remplacement des
   quatre CSV GiottoVerducci (`vtescsv`) initialement prévus :

   ```python
   KRCG_SOURCES: dict[str, str] = {
       "vtes.json": "https://static.krcg.org/data/v5/vtes.json",
       "expansions.json": "https://static.krcg.org/data/v5/expansions.json",
   }
   ```

   Pourquoi : un seul jeu de fichiers, à jour plus souvent, avec traductions,
   impressions et produits déjà structurés (licence MIT). `id` krcg = id VEKN.
   Contrepartie : schéma tiers versionné (`v5`, mainteneur unique) → figer l'URL et
   tester l'import contre un fixture. krcg dérive lui-même de `vtescsv`.
   Traductions (vérifié le 2026-09-18) : **fr et es uniquement**, sur ~428 cartes sur
   4149 — elles n'existent que pour les sets imprimés dans ces langues et la couverture
   grandira. L'import du Lot 2 doit donc être **rejouable** (upsert de
   `card_translation`, repli sur le nom EN) et normaliser les codes de langue
   (krcg `fr` → table `language` `FR`). Non importés par choix : `rulings`,
   `name_variants`, `variants`, `legal`, `formats`.

2. **Une carte doit être en collection pour être ajoutée à un deck** — la
   composition d'un deck s'appuie donc sur le stock possédé, pas sur une liste
   logique déconnectée. Un **statut « proxy »** est nécessaire pour suivre les
   cartes jouées en proxy (donc dans un deck sans être réellement possédées).
   Langues possibles pour une carte : **FR, ES, EN, ou autre** — les traductions
   officielles disponibles (krcg / vekn.net) sont fr et es ; « autre » reste
   possible pour les exemplaires possédés, d'où une table `language` ouverte.
3. **Adversaires** : on suit uniquement **mes propres parties/résultats**, pas
   les decks ou résultats détaillés des autres joueurs.
4. **Langue au niveau de la carte** (pas seulement du stock ni du deck) : un
   deck peut donc contenir des cartes de langues différentes d'un exemplaire à
   l'autre.

*Résolu au Lot 1* : le modèle §6 a été révisé en conséquence — catalogue
(`card`, sans langue) distinct des exemplaires possédés (`card_copy`, par langue,
avec statut proxy), et composition de deck allouée depuis ces exemplaires
(`deck_card`, FK composite vers `card_copy`).

Tranchées pendant le Lot 1 :

- **Tooling backend** : migration vers **uv** (`backend/uv.lock`, `uv sync --extra dev`
  car `dev` est un extra et non un groupe de dépendances) ; Dependabot utilise
  l'écosystème natif `uv` (vérifié dans la doc GitHub, pas `pip`).
- **Lint** : **ruff** (`E`, `F`, `I`, `UP`, `target-version = "py314"`) côté back,
  **ESLint 10** flat config + typescript-eslint côté front, tous deux dans la CI.
  Limite connue : `ruff format` (ruff 0.16.8) corrompt `except (A, B):` sous cible
  py314 — ne pas l'appliquer tant que ce n'est pas corrigé ; seul `ruff check` est câblé.
- **Client TS** : `openapi-typescript` (types) + `openapi-fetch` (wrapper), versionnés
  dans `frontend/src/api-client/` ; un test vitest vérifie que `schema.d.ts` suit
  `contracts/openapi.json`.
- **Scripts** : un point d'entrée unique `scripts/run.ps1` / `run.sh` avec sous-commandes.
- **Alembic** : `render_as_batch=True` (SQLite). La révision initiale a été amendée en
  place pendant le lot car jamais committée ; à partir du premier commit, toute
  évolution passe par une **nouvelle révision**.

---

## 12. Roadmap

1. **Lot 0 — Squelette + PWA minimale** — *livré, en attente de validation manuelle.*
   Monorepo, FastAPI `/health`, React+Vite, manifest + service worker, tests
   automatisés (pytest, vitest, Playwright offline), CI. Reste à confirmer à la main
   dans Chrome DevTools : panneau Application (manifest sans avertissement, SW
   *activated*), coupure réseau réelle, prompt d'installation sur mobile via HTTPS.
2. **Lot 1 — Contrat & modèle** — *livré.* Dettes de tooling soldées
   (uv + `uv.lock`, ruff, ESLint, scripts unifiés), modèle de 21 tables, migration
   initiale, schémas Pydantic, chaîne de génération du client TS. Aucune route ajoutée :
   le contrat reste limité à `/health`. CI (`astral-sh/setup-uv`, ruff, ESLint, tests)
   vérifiée verte au premier push. Reste à confirmer : le premier run réel de
   Dependabot en mode `uv` (onglet Dependabot du dépôt).
3. **Lot 2 — CRUD** : import du catalogue krcg (rejouable, cf. §11.1), stock (EN/FR),
   decks + composition, avec validation de deck (règles `regles-vtes`), versement d'un
   bundle dans le stock. Premières routes : le contrat OpenAPI et le client TS
   s'enrichissent ici. Reprendre les points laissés par la QA du Lot 1 : le service doit
   pré-vérifier `proxy_quantity <= quantity` en modification partielle, et créer les
   objets ORM avec un `db.add` explicite.
4. **Lot 3 — Offline-first** : IndexedDB, saisie hors-ligne, `POST /sync`, conflits/idempotence.
5. **Lot 4 — Parties & tournois** : saisie, mono/multi-deck, participations.
6. **Lot 5 — Analyse** : perf par deck, historique par lieu/date.
7. **Lot 6 — Portage** : packager le socle offline pour barrins-project.
