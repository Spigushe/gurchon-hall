# CLAUDE.md — Suivi VtES (React + FastAPI + PWA)

> Fichier de contexte projet pour Claude Code. Décrit l'objectif, la stack, le
> modèle de données, le contrat d'API, les agents et les skills. À lire avant
> toute intervention.

**État actuel** : **Lots 0, 1 et 2 livrés** (le Lot 2 est côté back et contrat : pas d'UI).
Lot 0 : squelette monorepo, FastAPI `/health`, React/Vite, PWA installable. Lot 1 :
outillage (uv, ruff, ESLint), modèle relationnel SQLAlchemy (21 tables), migration
Alembic initiale, schémas Pydantic, chaîne de génération du client TS. Lot 2 : import
rejouable du catalogue krcg, routes catalogue / stock / decks, légalité de deck, versement
d'un bundle dans le stock, contrat et client TS enrichis. L'arborescence du §4 existe, avec
en plus `scripts/` (commandes unifiées) et `.github/` (CI, Dependabot).

Commandes réelles : un seul script par plateforme, `scripts/run.ps1 <install|test|build|dev>`
(équivalent `scripts/run.sh`). Back (depuis `backend/`, via uv) : `uv sync --extra dev`,
`uv run pytest` (639 tests), `uv run ruff check .`, `uv run alembic upgrade head`,
`uv run python scripts/import_catalog.py` (importe ou met à jour le catalogue krcg ;
`--from-dir` pour des fichiers locaux ; à lancer une fois la base migrée).
Front (depuis `frontend/`) : `npm run lint`, `npm run test` (vitest, 18 tests),
`npm run test:e2e` (Playwright, 6 tests dont le scénario offline),
`npm run generate:client` (régénère `src/api-client/schema.d.ts`).

**Routes existantes** : `/health`, `/cartes`, `/bundles`, `/langues`, `/stock`, `/decks`
(détail au §7). Aucune route `/joueurs`, `/tournois`, `/parties`, `/participations` ni `/sync` :
elles viennent aux Lots 3 et 4. Aucune UI métier ni couche offline IndexedDB avant le
Lot 3 (une UI d'écriture avant `/sync` violerait la convention offline du §10). Ne pas
supposer qu'elles existent.

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
possédés) ; VP/GW. La sémantique du proxy est tranchée depuis le Lot 2 (§11).
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

Livré au Lot 2 (chemins en français, `operationId` en anglais camelCase) :

| Route | Rôle |
|---|---|
| `GET /cartes`, `GET /cartes/{id}` | recherche (`q`, `category`, `clan_id`, `limit`, `offset`) et fiche complète du catalogue, en lecture seule |
| `GET /bundles`, `GET /bundles/{id}` | produits et leur contenu (carte × exemplaires) |
| `POST /bundles/{id}/stock` | verse le contenu d'un produit dans le stock (`language_code`, `count`) |
| `GET/POST /langues` | liste ouverte des langues |
| `GET/POST /stock`, `GET/PATCH/DELETE /stock/{card_id}/{language_code}` | collection, une entrée par carte et par langue |
| `GET/POST /decks`, `GET/PATCH/DELETE /decks/{id}` | decks ; le détail porte la composition |
| `GET /decks/{id}/legalite` | verdict crypt ≥ 12 / library 60–90 avec les seuils |
| `POST /decks/{id}/cartes`, `PATCH/DELETE /decks/{id}/cartes/{card_id}/{language_code}` | composition du deck |

Erreurs : 404 et 409 portent `ErrorResponse` (`{"detail": "…"}`) ; les 422 gardent le
format standard de FastAPI, y compris ceux que le service produit lui-même.

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

Tranchées pendant le Lot 2 :

- **Sémantique du proxy** : `card_copy.proxy_allowed` reste un booléen (autorise à jouer
  la carte en proxy, sans la posséder) ; le nombre de proxies vit sur la ligne de deck
  (`deck_card.proxy_quantity`). Un proxy n'est pas un exemplaire possédé. Une ligne de
  deck consomme donc `quantity - proxy_quantity` exemplaires réels, et la somme de ces
  consommations sur tous les decks ne peut pas dépasser `quantity_owned`. Refus en 409 :
  exemplaires insuffisants, proxy non autorisé, baisse du stock sous ce qui est alloué,
  interdiction du proxy alors qu'un deck en utilise, suppression d'une entrée encore
  utilisée.
- **Légalité et statut** : la légalité est calculée à la demande et ne bloque jamais la
  construction (un brouillon est incomplet par nature). Elle ne gate que le passage à
  `active`, en 409 ; un deck déjà actif peut ensuite évoluer librement. Les proxies
  comptent dans les effectifs. Règles dans `backend/app/services/vtes_rules.py`
  (fonctions pures). **Périmètre actuel : tailles seulement** (crypt ≥ 12, library 60–90).
- **Suppression d'un deck (comportement provisoire)** : refusée (409) s'il a servi dans
  une partie (la participation le référence) ; on le passe à `retired`. Sinon la
  composition part avec lui et les exemplaires retournent au stock. Ce comportement sera
  remplacé par le système d'archivage décrit juste après.

Décisions prises après la livraison du Lot 2, **pas encore implémentées** :

- **Validation de decklist étendue** : au-delà des tailles, le futur système vérifiera
  (a) crypt ≥ 12 cartes, (b) crypt limitée à **deux groupes adjacents** au plus, les cartes
  de groupe « Any » étant neutres, (c) library entre 60 et 90 cartes, (d) **aucune carte
  bannie**. Le modèle a déjà de quoi le porter : `card.group_code` (`G1`…`G7`, `Any`,
  importé de krcg) et `card.banned_on`. `DeckLegality.issues` est déjà une liste de
  messages, donc l'extension ne change pas la forme de la réponse. Les règles (b) et (d) sont
  à rédiger dans `regles-vtes` avec leurs cas limites **[à confirmer]** au règlement VEKN
  (que veut dire « adjacent » avec les groupes 1 à 7 ; une carte bannie l'est-elle depuis
  sa `banned_on` ou à la date du jour).
- **Archivage puis suppression logique des decks** : un deck s'archive d'abord, puis se
  « supprime » depuis l'archive, mais **ses données restent en base** (suppression
  logique, jamais de `DELETE` physique via l'API). Cela remplace le `DELETE /decks/{id}`
  actuel et supprime le cas « deck joué donc non supprimable » : l'historique des parties
  garde toujours son deck. Cela demande une évolution du modèle (nouvelle migration : un
  état ou des horodatages d'archivage / de suppression), du contrat (passage par
  `architecte-contrat` avant tout code) et du filtrage des listes. Questions à trancher à
  ce moment-là : un deck archivé ou supprimé libère-t-il ses exemplaires dans le stock ;
  son nom reste-t-il réservé (la colonne `deck.name` est unique) ; le statut `retired`
  existant se fond-il dans l'archivage ou reste-t-il distinct.
- **Catalogue en lecture seule côté API** : il ne bouge que par l'import
  (`scripts/import_catalog.py`, `app.services.catalog_import`). L'import est un upsert en
  une transaction ; il ne supprime jamais une carte ni une traduction absente de la source.
  Les noms complets des disciplines viennent d'une table du code (krcg ne publie que les
  codes trois lettres) ; un code inconnu retombe sur le code en majuscules. Le fixture de
  test (`backend/tests/fixtures/`) est un échantillon figé de neuf vraies cartes ; l'import
  complet a été vérifié à la main sur les 4149 cartes de krcg (rejeu sans doublon).
- **Client TS** : `openapi-typescript` est lancé avec `--default-non-nullable false`. Sans
  cela, un champ de requête qui a une valeur par défaut (`proxy_quantity`, `quantity_owned`…)
  devenait obligatoire dans le type TypeScript alors que le contrat le déclare optionnel.
- **Non idempotent pour l'instant** : `POST /bundles/{id}/stock` additionne à chaque appel.
  L'idempotence des écritures rejouées relève de `/sync` (Lot 3).
- Pas de nouvelle migration : le modèle du Lot 1 n'a pas bougé.

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
3. **Lot 2 — CRUD** — *livré (back et contrat, sans UI).* Import du catalogue krcg
   (rejouable, cf. §11.1), stock (EN/FR), decks + composition, validation de deck (règles
   `regles-vtes`), versement d'un bundle dans le stock. Le contrat OpenAPI compte 22
   opérations, le client TS est régénéré. Les points laissés par la QA du Lot 1 sont
   traités : `proxy_quantity <= quantity` revérifié après fusion avec la ligne existante
   (422), objets ORM créés avec un `db.add` explicite. Reste à faire : une UI de
   consultation (catalogue, collection, decks) peut venir avant le Lot 3, mais toute
   écriture côté front attend la couche offline. Reste aussi à lancer l'import réel sur la
   base de dev (`alembic upgrade head` puis `scripts/import_catalog.py`). Deux chantiers
   décidés mais non planifiés (détail au §11) : la validation de decklist étendue
   (groupes adjacents, cartes bannies) et l'archivage / suppression logique des decks.
4. **Lot 3 — Offline-first** : IndexedDB, saisie hors-ligne, `POST /sync`, conflits/idempotence.
5. **Lot 4 — Parties & tournois** : saisie, mono/multi-deck, participations.
6. **Lot 5 — Analyse** : perf par deck, historique par lieu/date.
7. **Lot 6 — Portage** : packager le socle offline pour barrins-project.
