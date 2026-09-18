# CLAUDE.md — Suivi VtES (React + FastAPI + PWA)

> Fichier de contexte projet pour Claude Code. Décrit l'objectif, la stack, le
> modèle de données, le contrat d'API, les agents et les skills. À lire avant
> toute intervention.

**État actuel** : **Lot 0 livré** (squelette monorepo + FastAPI `/health` + React/Vite
+ PWA installable), non committé à ce stade. L'arborescence du §4 existe, avec en plus
`scripts/` (commandes unifiées) et `.github/` (CI, Dependabot).

Commandes réelles : `scripts/install.ps1`, `scripts/test.ps1`, `scripts/build.ps1`
(équivalents `.sh` fournis). Back : `python -m pytest` depuis `backend/` (8 tests).
Front : `npm run test` (vitest, 10 tests) et `npm run test:e2e` (Playwright, 6 tests,
dont le scénario offline) depuis `frontend/`.

Le Lot 0 n'a **pas** de base de données, de modèle de données, de client TS généré ni
de couche offline IndexedDB : ce sont les Lots 1 et 3. Ne pas supposer qu'ils existent.

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

Entités et champs clés (détail complet maintenu côté agent architecte-contrat) :

| Entité | Champs clés | Rôle |
|---|---|---|
| `Carte` | id, nom, nom_fr, categorie (Crypt/Library), type, clan, sect, capacite, groupe, texte | catalogue, identité indépendante de la langue |
| `Stock` | carte_id, langue (EN/FR), quantite | inventaire par langue (PK composite carte+langue) |
| `Deck` | id, nom, date_creation, statut, archetype, notes | decks joués |
| `DeckCarte` | deck_id, carte_id, quantite, [langue?] | composition (decklist) |
| `Joueur` | id, nom, est_moi | au minimum « Moi » |
| `Tournoi` | id, nom, date_debut, date_fin, lieu, type_deck (Mono/Multi), format, nb_rondes, mon_classement | groupe de parties |
| `Partie` | id, date_heure, lieu, tournoi_id?, numero_ronde?, type_ronde, nb_joueurs, notes | une partie |
| `Participation` | id, partie_id, joueur_id, deck_id?, siege, vp, gw, notes | 1 ligne par joueur présent |

Tables de référence (listes fermées) : `Clan`, `Discipline`, `Sect`, `TypeCarte`,
`Extension`, `Lieu`, `Langue`. Normalisation many-to-many optionnelle en v1 pour
`CarteType` et `CarteDiscipline` (sinon champ texte, à normaliser plus tard).

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

1. **Catalogue cartes complet**, importé depuis les CSV VEKN maintenus par
   GiottoVerducci (pas de saisie manuelle du catalogue) :

   ```python
   CSV_SOURCES: dict[str, str] = {
       "vtessets.csv": "https://github.com/GiottoVerducci/vtescsv/raw/refs/heads/main/vtessets.csv",
       "vtescrypt.csv": "https://github.com/GiottoVerducci/vtescsv/raw/refs/heads/main/vtescrypt.csv",
       "vteslib.csv": "https://github.com/GiottoVerducci/vtescsv/raw/refs/heads/main/vteslib.csv",
       "vteslibmeta.csv": "https://github.com/GiottoVerducci/vtescsv/raw/refs/heads/main/vteslibmeta.csv",
   }
   ```

2. **Une carte doit être en collection pour être ajoutée à un deck** — la
   composition d'un deck s'appuie donc sur le stock possédé, pas sur une liste
   logique déconnectée. Un **statut « proxy »** est nécessaire pour suivre les
   cartes jouées en proxy (donc dans un deck sans être réellement possédées).
   Langues possibles pour une carte : **FR, ES, EN, ou autre** — énumération
   exacte à confirmer une fois le catalogue (point 1) importé et les langues
   réellement présentes dans les CSV connues.
3. **Adversaires** : on suit uniquement **mes propres parties/résultats**, pas
   les decks ou résultats détaillés des autres joueurs.
4. **Langue au niveau de la carte** (pas seulement du stock ni du deck) : un
   deck peut donc contenir des cartes de langues différentes d'un exemplaire à
   l'autre.

*Implication pour le modèle §6, à reprendre par l'architecte-contrat au Lot 1* :
ces décisions changent la portée de `Carte` (dimension langue), de `Stock`
(statut proxy, lien plus direct au deck) et de `DeckCarte` (allocation depuis
le stock plutôt que simple liste logique) — le tableau §6 reste tel quel pour
l'instant et sera révisé à ce moment-là.

---

## 12. Roadmap

1. **Lot 0 — Squelette + PWA minimale** — *livré, en attente de validation manuelle.*
   Monorepo, FastAPI `/health`, React+Vite, manifest + service worker, tests
   automatisés (pytest, vitest, Playwright offline), CI. Reste à confirmer à la main
   dans Chrome DevTools : panneau Application (manifest sans avertissement, SW
   *activated*), coupure réseau réelle, prompt d'installation sur mobile via HTTPS.
2. **Lot 1 — Contrat & modèle** : entités, schémas Pydantic, OpenAPI, migrations,
   client TS généré.
   Dettes de tooling à traiter en ouverture de lot, avant le modèle :
   - **lockfile backend** — `pyproject.toml` n'a que des ranges. Piste retenue :
     migration vers `uv` + `uv.lock`, qui donnerait aussi un écosystème Dependabot
     fiable. Tant que `uv.lock` n'existe pas, l'entrée `pip` de `.github/dependabot.yml`
     porte sur un `pyproject.toml` PEP 621 nu : **son comportement réel est à vérifier
     au premier run**, pas à supposer.
   - **lint** — aucun outillage (ni ESLint, ni ruff). À choisir avant que chaque
     couche ne diverge, puis à câbler en CI.
3. **Lot 2 — CRUD** : stock (EN/FR), decks + composition, avec validation de deck.
4. **Lot 3 — Offline-first** : IndexedDB, saisie hors-ligne, `POST /sync`, conflits/idempotence.
5. **Lot 4 — Parties & tournois** : saisie, mono/multi-deck, participations.
6. **Lot 5 — Analyse** : perf par deck, historique par lieu/date.
7. **Lot 6 — Portage** : packager le socle offline pour barrins-project.
