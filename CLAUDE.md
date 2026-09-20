# CLAUDE.md — Suivi VtES (React + FastAPI + PWA)

> Fichier de contexte projet pour Claude Code. Décrit l'objectif, la stack, le
> modèle de données, le contrat d'API, les agents et les skills. À lire avant
> toute intervention.

**État actuel** : **Lots 0, 1 et 2 livrés** — le Lot 2 en deux passes, côté back et
contrat : pas d'UI. Lot 0 : squelette monorepo, FastAPI `/health`, React/Vite, PWA installable. Lot 1 :
outillage (uv, ruff, ESLint), modèle relationnel SQLAlchemy, migration Alembic
initiale, schémas Pydantic, chaîne de génération du client TS. Lot 2 : import
rejouable du catalogue krcg, routes catalogue / stock / decks, légalité de deck (cinq
règles), cycle de vie des decks (discriminant tiré par le serveur, archivage puis
suppression logique), versement d'un bundle dans le stock, contrat et client TS
enrichis. Le modèle compte **22 tables** et trois révisions Alembic. L'arborescence du
§4 existe, avec en plus `scripts/` (commandes unifiées) et `.github/` (CI, Dependabot).

Commandes réelles : un seul script par plateforme, `scripts/run.ps1 <install|test|build|dev>`
(équivalent `scripts/run.sh`). Back (depuis `backend/`, via uv) : `uv sync --extra dev`,
`uv run pytest` (1358 tests verts et 1 `xfail` attendu, cf. §11 « limites connues »),
`uv run ruff check .`, `uv run alembic upgrade head`,
`uv run python scripts/import_catalog.py` (importe ou met à jour le catalogue krcg ;
`--from-dir` pour des fichiers locaux ; à lancer une fois la base migrée).
Front (depuis `frontend/`) : `npm run lint`, `npm run test` (vitest, 21 tests),
`npm run test:e2e` (Playwright, 6 tests dont le scénario offline),
`npm run generate:client` (régénère `src/api-client/schema.d.ts`).

**Avant de lancer Alembic** : sans `DATABASE_URL`, la commande vise `backend/vtes.db`,
la base de développement. Vérifier la variable avant toute migration. Cette base est
en place, à la révision `5dc50e3c1701`, catalogue krcg importé (4149 cartes) et aucun
deck. Une base plus ancienne se remet à niveau par `uv run alembic upgrade head`, les
deux migrations de la passe 2 s'en chargeant ; une base repartie de zéro se reconstruit
par ce même `upgrade head` suivi de `uv run python scripts/import_catalog.py`.

**Routes existantes** : `/health`, `/cartes`, `/bundles`, `/langues`, `/stock`, `/decks`
— 22 opérations au contrat, détail au §7. Aucune route `/joueurs`, `/tournois`,
`/parties`, `/participations` ni `/sync` : elles viennent aux Lots 3 et 4. Aucune UI
métier ni couche offline IndexedDB avant le Lot 3 (une UI d'écriture avant `/sync`
violerait la convention offline du §10). Ne pas supposer qu'elles existent.

---

## 1. Objectif du projet

Deux objectifs, dans cet ordre de priorité :

1. **Pilote PWA** — servir de projet-test à faible enjeu pour dérisquer une
   **PWA offline-first** avant de porter l'approche sur **barrins-project**
   (déjà en React/FastAPI). La mécanique validée ici (service worker, stockage
   local, synchronisation) doit être **directement réutilisable** sur Barrin.
2. **Outil VtES** — suivre la pratique de *Vampire: The Eternal Struggle* :
   collection (stock **compté séparément par langue**), decks, composition des decks,
   parties (quand / où / quel deck / quel résultat) et **tournois** regroupant
   des parties consécutives (mono-deck ou multi-deck).

Le domaine VtES est un support réel mais **secondaire** au regard de l'objectif
pilote : à chaque arbitrage, privilégier ce qui rend le transfert vers Barrin
plus fiable.

---

## 2. Stack technique

| Couche | Choix | Notes |
| --- | --- | --- |
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

```text
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
- **Deck** : cinq règles, toutes vérifiées par le code depuis le Lot 2 passe 2
  (`backend/app/services/vtes_rules.py`, fonctions pures) — **Crypt ≥ 12** cartes ;
  crypt limitée à deux groupes **adjacents** au plus (1+2, 2+3, …, 6+7 ; jamais 2+4 ;
  un seul groupe toujours permis, les cartes de groupe « Any » étant neutres) ;
  **Library entre 60 et 90** cartes ; aucune carte **bannie** (à partir de sa
  `banned_on`, jour inclus) ; aucune carte **pas encore légale** (jouable à partir de sa
  `legal_from`, jour inclus). Les deux dates se lisent à une date d'évaluation passée
  en paramètre, et une carte sans date est tenue pour jouable. Les proxies comptent
  dans les effectifs.
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
- **Langues** : stock compté séparément par langue — **FR**, **EN**, **ES** ou
  « autre » (`XX`) —, la liste restant ouverte puisque `language` est une table et
  non un enum. Toute entrée de collection porte un code de langue, jamais vide.
  L'identité d'une carte (nom, règles, clan…) est indépendante de la langue.

Ces règles métier sont la responsabilité de l'agent **architecte-contrat** (skill
`regles-vtes`).

---

## 6. Modèle de données (relationnel)

Modèle **livré au Lot 1** : `backend/app/models/` (SQLAlchemy 2.0), migration
initiale `backend/migrations/versions/*_schema_initial_du_suivi_vtes.py`, noms en
anglais technique. Les noms français de l'ancien tableau ne servent plus que de
repère de vocabulaire (`Stock` → `card_copy`, `DeckCarte` → `deck_card`, etc.).

Le Lot 2 passe 2 l'a étendu par deux révisions, à la suite de la révision initiale
`a59a3613de12` : `de3b00e38c8d` (archivage et suppression logique des decks) puis
`5dc50e3c1701` (discriminant de deck, decklist figée, `card.legal_from`, statuts).
Le modèle compte désormais **22 tables**.

| Domaine | Tables | Points clés |
| --- | --- | --- |
| Référence | `language`, `clan`, `discipline`, `sect`, `card_type`, `card_set`, `venue`, `bundle` | `language` est une table ouverte (seed EN/FR/ES/XX « autre »), pas un enum ; `bundle` = produit (précon) rattaché à une extension |
| Catalogue | `card`, `card_type_link`, `card_discipline_link`, `card_printing`, `card_printing_occurrence`, `card_translation` | `card` = identité indépendante de la langue, clé naturelle `vekn_id` ; dates de légalité `banned_on` et `legal_from` ; index non unique `ix_card_name_group_code_advanced` (retrouver un vampire par son triplet nom + groupe + advanced) ; `card_translation` (nom, texte, flavor, image par langue) ; impressions = carte × extension, avec occurrences détaillées (rareté, précon + copies, date) |
| Collection | `card_copy`, `deck`, `deck_card`, `deleted_deck_card` | `card_copy` PK (carte, langue) : `quantity_owned` + `proxy_allowed` ; `deck_card` PK (deck, carte, langue) avec **FK composite vers `card_copy`** : une carte hors collection est refusée en deck, un deck mélange les langues ; `quantity` + `proxy_quantity` ; `deleted_deck_card` reprend les mêmes colonnes **sans lien vers `card_copy`** — la decklist figée d'un deck supprimé ne réserve plus rien |
| Pratique | `player`, `tournament`, `game`, `participation` | un seul « Moi » (index unique partiel) ; `participation.game_win` stocké mais non calculé |

**Identité et cycle de vie d'un deck** (passe 2) : `deck.name` n'est plus unique ; il
est accompagné d'un `discriminator` de quatre chiffres (« 0001 » à « 9999 », le format
est garanti par un CHECK), tiré par le serveur, et c'est le couple (nom, discriminant)
qui est unique — sur **tous** les decks, supprimés compris. Deux horodatages UTC portent
le cycle de vie, indépendamment du statut : `archived_at` (rangé) et `deleted_at`
(supprimé logiquement). `DeckStatus` se réduit donc à `draft` et `active` : « rangé »
et « supprimé » sont des dates, pas des statuts, et désarchiver n'oblige pas à deviner
quel statut restaurer.

Choix transverses : dates/heures stockées en **UTC** (les schémas d'entrée exigent un
fuseau et normalisent, les schémas de lecture ressortent un instant explicite suffixé
« Z ») ; enums fermés (catégorie de carte, statut de deck, mono/multi,
format, type de ronde, type de coût, exigence de discipline, type d'occurrence) portés
par des CHECK nommés en base ; SQLite avec `PRAGMA foreign_keys = ON` sur chaque
connexion (`backend/app/db/session.py`) — sauf pendant une migration, où
`migrations/env.py` les coupe le temps du mode batch (qui recrée les tables, et vidait
`deck_card` en cascade) puis passe un `PRAGMA foreign_key_check` avant de rendre la
main. Le contenu d'un bundle n'est pas une table :
c'est la projection des occurrences `precon` qui le désignent (`BundleContentRead`),
au format carte × exemplaires, entrée prévue pour verser un produit dans le stock.

Points ouverts, **[à confirmer]** : `card.sect_id` nullable et non importé (aucune
source ne fournit la sect) ; énumération réelle des langues (dépend des exemplaires
possédés) ; VP/GW. La sémantique du proxy est tranchée depuis le Lot 2 (§11).
Le prérequis de titre/sect/capacité des cartes Library n'est pas structuré (krcg ne
l'expose pas, il reste dans le texte de carte).

**Règles portant sur plusieurs lignes** (non exprimables en simples contraintes de
colonne) → en logique de service + tests :

- deck légal, les cinq règles du §5 — *fait au Lot 2* (`services/vtes_rules.py`) ;
- comptabilité du stock : la somme des exemplaires réels alloués à travers les decks
  vivants ne dépasse pas `quantity_owned` — *fait au Lot 2* (`services/stock.py`) ;
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

Livré au Lot 2 (chemins en français, `operationId` en anglais camelCase),
22 opérations sur 14 chemins :

| Route | Rôle |
| --- | --- |
| `GET /cartes`, `GET /cartes/{id}` | recherche (`q`, `category`, `clan_id`, `limit`, `offset`) et fiche complète du catalogue, en lecture seule |
| `GET /bundles`, `GET /bundles/{id}` | produits et leur contenu (carte × exemplaires) |
| `POST /bundles/{id}/stock` | verse le contenu d'un produit dans le stock (`language_code`, `count`) ; 409 si un total dépasserait le plafond entier |
| `GET/POST /langues` | liste ouverte des langues |
| `GET/POST /stock`, `GET/PATCH/DELETE /stock/{card_id}/{language_code}` | collection, une entrée par carte et par langue |
| `GET /decks` | liste filtrée par `state` (`active` par défaut, `archived`, `all`), `status` et `q` ; tri nom puis discriminant. Les decks supprimés n'y figurent jamais |
| `POST /decks` | crée un deck ; le discriminant est tiré par le serveur, jamais fourni par le client |
| `GET /decks/{id}` | deck et composition ; un deck supprimé se lit encore, en lecture seule, depuis sa decklist figée |
| `PATCH /decks/{id}` | modification partielle, et archivage ou désarchivage par le champ `archived` (`true` / `false`) |
| `DELETE /decks/{id}` | suppression **logique**, réservée à un deck archivé |
| `GET /decks/{id}/legalite` | verdict daté (`evaluated_on`) : les cinq règles du §5, les seuils, les groupes de crypt, les cartes bannies et pas encore légales, et `issues` en clair |
| `POST /decks/{id}/cartes`, `PATCH/DELETE /decks/{id}/cartes/{card_id}/{language_code}` | composition du deck |

Les routes `/decks/{id}/archiver` et `/decks/{id}/restaurer` n'existent pas :
l'archivage passe par le `PATCH`, seul point d'entrée de la modification d'un deck.

Erreurs : 404 et 409 portent `ErrorResponse` (`{"detail": "…"}`) ; les 422 gardent le
format standard de FastAPI, y compris ceux que le service produit lui-même.

Conventions du contrat, posées en passe 2 et valables pour toute ressource à venir :

- **Sorties complètes** : un champ de lecture à valeur par défaut est déclaré
  *obligatoire* en réponse (option Pydantic `json_schema_serialization_defaults_required`
  sur `ReadModel`), puisque la sérialisation le produit toujours. Côté TypeScript, plus
  de `?:` ni de gardes inutiles sur des champs qui ne manquent jamais.
- **Dates-heures sortantes** : toujours un instant UTC explicite, suffixé « Z », quelle
  que soit la façon dont la valeur a été obtenue (posée en Python ou relue de SQLite,
  où le stockage reste du UTC naïf).
- **Bornes plutôt que 500** : identifiants, quantités, `count`, `offset` sont plafonnés
  à `MAX_DB_INT` (2³¹ − 1) et les identifiants valent au moins 1 ; au-delà, le client
  reçoit un 422 au lieu d'une erreur du pilote de base. Les noms et les codes de langue
  obligatoires sont rognés de leurs espaces de bord puis refusés s'ils sont vides
  (`RequiredText`).
- **Recherche `q` insensible à la casse et aux accents** sur les quatre routes qui
  l'acceptent (`/cartes`, `/bundles`, `/stock`, `/decks`) : « elan », « ÉLAN » et
  « élan » trouvent « Élan vital ». Détail au §11.

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
| --- | --- | --- | --- |
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
| --- | --- | --- | --- |
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

Tranchées pendant le Lot 2, passe 1 :

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
  `active`, en 409, que ce soit à la création ou par `PATCH` ; un deck déjà actif peut
  ensuite devenir illégal sans que rien ne le signale — c'est à l'UI de l'afficher. Les
  proxies comptent dans les effectifs. Règles dans
  `backend/app/services/vtes_rules.py`, en fonctions pures.
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
- **`POST /bundles/{id}/stock` non idempotent** : il additionne le produit à chaque
  appel. L'idempotence des écritures rejouées relève de `/sync` (Lot 3).

Tranchées pendant le Lot 2, passe 2 :

- **Identité d'un deck : un discriminant, pas un nom unique**. Rien n'oblige un joueur à
  inventer un nom neuf à chaque itération d'un archétype : deux decks peuvent porter le
  même nom, et un discriminant de quatre chiffres les distingue (« Malkavien 2022#8561 »,
  comme un pseudo Discord). Il est tiré par le serveur, jamais fourni par le client ; le
  service réessaie si la base refuse le couple (course entre deux requêtes) et rend un 409
  après vingt essais, ou si les 9999 discriminants d'un nom sont pris. Renommer conserve le
  discriminant, sauf collision. L'unicité (nom, discriminant) vaut sur **tous** les decks,
  supprimés compris : rien ne réattribue l'identité d'affichage d'un deck disparu.
- **Archivage, puis suppression logique**. Un deck s'archive par
  `PATCH /decks/{id}` `{"archived": true}` — opération idempotente, qui garde la date
  d'origine si on la rejoue ; `false` le sort de l'archive et remet `archived_at` à NULL.
  Un deck archivé refuse toute autre modification (409), sauf dans une requête qui le
  désarchive au passage. `DELETE /decks/{id}` n'accepte qu'un deck archivé (409 sinon) et
  ne supprime rien physiquement : dans une transaction, la decklist est recopiée dans
  `deleted_deck_card`, les lignes vivantes de `deck_card` disparaissent et `deleted_at`
  est posé. Les participations restent : l'historique des parties garde son deck, et le
  cas « deck joué donc non supprimable » n'existe plus.
- **Ce qu'un deck retient du stock** : un deck archivé garde ses exemplaires alloués,
  proxies compris ; un deck supprimé les rend tous, puisque sa decklist figée ne référence
  plus `card_copy`. Corollaire voulu : supprimer une entrée de stock n'est jamais bloqué
  par un deck supprimé.
- **Un deck supprimé reste lisible**, par `GET /decks/{id}` seulement, en lecture seule :
  `deleted_at` est renseigné et `cards` vient de la decklist figée. Il n'apparaît dans
  aucune liste, quel que soit `state` ; toute écriture et `/legalite` répondent 409 ; un
  identifiant inconnu reste un 404. Il n'est ni modifiable ni réactivable.
- **Statuts réduits à `draft` et `active`** : `retired` a disparu, et « archivé » n'a
  jamais été un statut — ce sont des dates (`archived_at`, `deleted_at`). Les decks
  `retired` existants ont été convertis par la migration en `active` archivés à leur
  `updated_at`.
- **Légalité étendue aux cinq règles du §5**, avec une réponse `DeckLegality` enrichie :
  `evaluated_on` (la date du verdict), `crypt_groups` (`["G2", "G3"]`), `banned_cards` et
  `not_yet_legal_cards` en cartes entières (`CardSummary`) et non en noms — « Theo Bell »
  ne désigne rien sans son groupe, et le triplet nom + groupe + *advanced* est unique sur
  les 1785 cartes de crypt de krcg (vérifié). Les `issues` gardent des libellés lisibles
  (« Theo Bell (G2, Adv) »). Tous ces champs sont obligatoires en sortie.
- **`legal` de krcg importé dans `card.legal_from`** : une carte n'est jouable qu'à partir
  de cette date, jour inclus ; sans date, elle est tenue pour légale. La liste krcg paraît
  après la sortie commerciale d'un set, et on applique la règle telle quelle plutôt que
  d'inventer une tolérance. L'import crée au passage les extensions absentes de
  `expansions.json` et tolère les dates partielles (« 2020-01 » vaut « inconnue »).
- **Plages d'identifiants VEKN/krcg** — *repère, pas règle codée* : sur les données
  actuelles, 100000–199999 sont des cartes de library (2364) et 200000–299999 des cartes
  de crypt (1785) ; rien au-delà (chez krcg, 300000+ numérote les extensions). Les cartes
  de playtest, évoquées autour de 300000–399999, ne sont **pas** gérées : pas de catégorie
  playtest, et aucune validation de `vekn_id` à l'import.
- **Conventions de contrat** (champs de lecture obligatoires, dates-heures en UTC suffixé
  « Z », bornes entières rendues en 422) : décrites au §7, elles valent pour toutes les
  ressources à venir.
- **Migrations SQLite** : `migrations/env.py` coupe `PRAGMA foreign_keys` le temps d'une
  migration puis passe un `foreign_key_check`. Sans cela, le mode batch — qui recrée la
  table `deck` — vidait `deck_card` en cascade.

Tranchées après la clôture du Lot 2, en reprise des limites connues :

- **Recherche insensible à la casse et aux accents**. Les recherches `q` de `/cartes`,
  `/bundles`, `/stock` et `/decks` passent toutes par `app.services.text_search`
  (`contains_folded`, `like_pattern`), qui compare le texte cherché et la colonne après
  la même normalisation : décomposition NFKD, retrait des marques combinantes,
  `casefold()`. Elle est écrite une fois (`app.db.folding.fold_text`) et enregistrée
  comme fonction SQLite `fold_text` dans l'écouteur `connect` de `app.db.session`, donc
  disponible pour l'application, les tests et les migrations. « elan », « ÉLAN » et
  « élan » trouvent « Élan vital ». Limite assumée et figée par des tests : les lettres
  qui ne se décomposent pas restent elles-mêmes — « oe » ne trouve pas « Œuvre »,
  « lodz » ne trouve pas « Łódź ». Les jokers `%`, `_` et `\` saisis restent littéraux
  (échappement après normalisation). Deux suites à prévoir : côté base, l'équivalent
  Postgres serait l'extension `unaccent` si la migration du §2 a lieu ; côté front, la
  recherche locale du Lot 3 (IndexedDB) devra appliquer **la même** normalisation, sinon
  un même texte ne donnerait pas les mêmes résultats en ligne et hors ligne.
- **Un code de langue n'est jamais vide**. Une carte a toujours une langue d'impression :
  `LanguageCreate.code` et les `language_code` de `CardCopyCreate`, `DeckCardCreate` et
  `BundleDeposit` sont des `RequiredText` (rognage puis non vide, 8 caractères au plus
  une fois rogné). Une saisie faite d'espaces rend désormais un 422, là où elle créait
  une langue au code blanc ou finissait en 404. La normalisation en majuscules reste au
  service. Reste, mineur et volontaire : un code blanc passé par le chemin ou la query
  (`/stock/{card_id}/%20%20`, `GET /stock?language_code=`) rend un 404 ou une liste
  vide — c'est une recherche par clé, pas une saisie.

Limites connues et décisions en attente, à la clôture du Lot 2 :

1. **Comptabilité du stock non atomique** : « vérifier puis écrire ». Deux requêtes
   concurrentes peuvent chacune voir assez d'exemplaires et, ensemble, sur-allouer une
   entrée ; aucune contrainte de base ne l'interdit, la somme portant sur plusieurs lignes.
   Sans effet en usage mono-utilisateur séquentiel, à traiter avec `/sync` (Lot 3), qui
   sérialisera les écritures. Documenté dans `backend/app/services/stock.py`.
2. **`POST /bundles/{id}/stock` reste non idempotent** (cf. ci-dessus, Lot 3).
3. **Les migrations de la passe 2 ne se rejouent pas hors ligne** (`upgrade head --sql`) :
   le mode batch de SQLite exige une vraie base, et le rattrapage des discriminants est
   écrit en Python. Un test `xfail` documente la limite — c'est le seul qui reste.
4. **Le `downgrade` de `5dc50e3c1701` supprime `deleted_deck_card`** : les decks supprimés
   redeviendraient des decks vivants sans composition. À garder en tête avant tout retour
   arrière sur une base qui compte.
5. **Les tris restent sensibles à la casse et aux accents** : les `ORDER BY name` des
   listes (cartes, collection, decks) s'appuient sur la collation par défaut de SQLite,
   qui range les majuscules avant les minuscules et « Élan » après « Zoé ». Seule la
   recherche est normalisée, pas l'ordre d'affichage. Dette connue, non traitée.
6. **`banned_on` et `legal_from` ne sont évalués qu'à la date du jour** : les fonctions
   pures prennent une date d'évaluation, mais l'API n'expose pas ce paramètre. Un verdict
   rétrospectif (« ce deck était-il légal en mars ? ») demanderait de l'ouvrir.

---

## 12. Roadmap

1. **Lot 0 — Squelette + PWA minimale** — *livré, en attente de validation manuelle.*
   Monorepo, FastAPI `/health`, React+Vite, manifest + service worker, tests
   automatisés (pytest, vitest, Playwright offline), CI. Reste à confirmer à la main
   dans Chrome DevTools : panneau Application (manifest sans avertissement, SW
   *activated*), coupure réseau réelle, prompt d'installation sur mobile via HTTPS.
2. **Lot 1 — Contrat & modèle** — *livré.* Dettes de tooling soldées
   (uv + `uv.lock`, ruff, ESLint, scripts unifiés), modèle de 21 tables à l'époque (22
   depuis le Lot 2), migration initiale, schémas Pydantic, chaîne de génération du client
   TS. Aucune route ajoutée :
   le contrat reste limité à `/health`. CI (`astral-sh/setup-uv`, ruff, ESLint, tests)
   vérifiée verte au premier push. Reste à confirmer : le premier run réel de
   Dependabot en mode `uv` (onglet Dependabot du dépôt).
3. **Lot 2 — CRUD** — *livré, passes 1 et 2 (back et contrat, sans UI).* Import du
   catalogue krcg (rejouable, cf. §11.1), stock par langue, decks + composition, versement
   d'un bundle dans le stock ; en passe 2, légalité de deck complète (les cinq règles du
   §5), discriminant de deck, archivage puis suppression logique, et les conventions de
   contrat du §7. Le contrat OpenAPI compte 22 opérations, le client TS est régénéré ;
   1358 tests backend et 21 tests vitest passent, avec un `xfail` assumé (§11). Les
   points laissés par la QA du Lot 1 sont traités : `proxy_quantity <= quantity` revérifié
   après fusion avec la ligne existante (422), objets ORM créés avec un `db.add` explicite.
   Deux limites relevées à la clôture ont été levées depuis : recherche insensible aux
   accents et codes de langue jamais vides (§11). Une UI de
   consultation (catalogue, collection, decks) peut venir avant le Lot 3, mais toute
   écriture côté front attend la couche offline.
4. **Lot 3 — Offline-first** : IndexedDB, saisie hors-ligne, `POST /sync`, conflits/idempotence.
   Point d'attention : la recherche locale sur IndexedDB doit replier casse et accents
   exactement comme le back (`fold_text` : NFKD, retrait des marques combinantes,
   `toLowerCase`), faute de quoi la même saisie donnerait des résultats différents selon
   qu'on est en ligne ou non.
5. **Lot 4 — Parties & tournois** : saisie, mono/multi-deck, participations.
6. **Lot 5 — Analyse** : perf par deck, historique par lieu/date.
7. **Lot 6 — Portage** : packager le socle offline pour barrins-project.
