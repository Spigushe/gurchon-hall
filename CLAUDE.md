# CLAUDE.md — Suivi VtES (React + FastAPI + PWA)

> Fichier de contexte projet pour Claude Code. Décrit l'objectif, la stack, le
> modèle de données, le contrat d'API, les agents et les skills. À lire avant
> toute intervention.

**État actuel** : **Lots 0 à 5, 5bis, 5c et 6 livrés** (vérification manuelle de la
PWA faite le 2026-10-28 ; Lot 6 livré par la PR #39, §12). Lot 0 : squelette
monorepo, FastAPI `/health`, React/Vite, PWA installable. Lot 1 : outillage (uv, ruff, ESLint), modèle relationnel
SQLAlchemy, migration Alembic initiale, schémas Pydantic, chaîne de génération du
client TS. Lot 2 (deux passes, back et contrat, sans UI) : import rejouable du
catalogue krcg, routes catalogue / stock / decks, légalité de deck (cinq règles),
cycle de vie des decks (discriminant tiré par le serveur, archivage puis suppression
logique), versement d'un bundle dans le stock. Lot 3 : `POST /sync` (file d'opérations
idempotentes, verrou d'écriture par lot, conflits arbitrés par des motifs métier plutôt
que par une bascule en bloc), couche offline `frontend/src/offline/` (Dexie, file
d'attente, moteur de rejeu, recherche locale repliée comme le back), et première UI
métier (collection, decks) sur routeur à hash. Détail des décisions au §11, point
d'entrée du contrat de sync dans `docs/lot3-sync-contrat.md`, de la couche offline dans
`frontend/src/offline/README.md`. Lot 4 : l'autorisation de proxy passe de l'entrée de
stock au deck, et une entrée de collection est désormais identifiée par carte × langue ×
extension, de la base jusqu'à l'UI (plan dans `docs/lot4-plan-inventaire.md`). Lot 5 :
refonte mobile de l'UI sur le design system Nocturne, picker de cartes fusionné et
acquisition d'exemplaires depuis un deck, écran Synchronisation (plan dans
`docs/lot5-plan-design.md`, décisions au §11). Lot 5bis : passe bureau au-delà de
1024 px (handoff `docs/design-handoff/DESKTOP.md`, plan `docs/lot5bis-plan-design.md`).
Lot 5c : audit de symétrie fonctionnelle entre mobile et bureau, puis portage des écarts
(table d'écarts et verdicts dans `docs/lot5c-plan-design.md`). Une correction prise après le Lot 5
détache la ligne de deck de la collection : une carte entièrement jouée en proxy
n'exige plus d'entrée de stock (septième révision `f3a91c47b2de`, diagnostic et
conception dans `docs/issues/2026-09-29-lot4b-ligne-100-pourcent-proxy-refusee.md`). Lot 6 :
comptes (inscription ouverte, connexion, déconnexion, session serveur de 14 jours dans un
cookie `HttpOnly`), un propriétaire sur chaque donnée privée, cloisonnement de l'API
(404 pour la ressource d'un autre compte) et du client (une base IndexedDB par compte,
pause du moteur de sync sur 401, purge à la déconnexion) ; les données existantes sont
rattachées à un compte historique (plan dans `docs/lot6-plan-comptes.md`, décisions au
§11). Le modèle compte **25 tables** et neuf révisions Alembic. L'arborescence du §4 existe, avec en plus `scripts/` (commandes unifiées),
`.github/` (CI, Dependabot) et `docs/` (briefs de lot).

Commandes réelles : un seul script par plateforme, `scripts/run.ps1 <install|test|build|dev>`
(équivalent `scripts/run.sh`). Back (depuis `backend/`, via uv) : `uv sync --extra dev`,
`uv run pytest` (1719 tests verts et 2 `xfail` attendus, cf. §11 « limites connues »),
`uv run ruff check .`, `uv run alembic upgrade head`,
`uv run python scripts/import_catalog.py` (importe ou met à jour le catalogue krcg ;
`--from-dir` pour des fichiers locaux, `--json` pour un rapport lisible par un script ;
à lancer une fois la base migrée),
`uv run python scripts/manage_accounts.py <claim-legacy|create|set-password|set-role|revoke-sessions|purge-sessions>`
(comptes, Lot 6 ; le mot de passe se saisit au clavier par `getpass`, jamais en argument).
Front (depuis `frontend/`) : `npm run lint`, `npm run test` (vitest, 416 tests sur 30 fichiers),
`npm run test:e2e` (Playwright, 51 tests sur quatre projets : à 390 × 844, 8 dans
`chromium` et 26 contre un vrai back sur base éphémère — projet `real-backend`, cf.
`frontend/tests/e2e-real/` ; à 1440 × 900, 3 dans `desktop` et 14 dans
`desktop-real-backend`),
`npx tsc --noEmit -p tsconfig.app.json` (le `tsconfig.json` racine ne liste aucun
fichier : un `tsc --noEmit` sans `-p` ne vérifie rien),
`npm run generate:client` (régénère `src/api-client/schema.d.ts`).

**Avertissement provisoire, Lot 7 en cours** (à retirer à l'étape F de
`docs/lot7-plan-parties.md`) : depuis l'étape A1, la tête Alembic du code est
`783b24f9e769` (R10, « pratique de jeu »), alors que `backend/vtes.db` reste
volontairement à `89695b77ef45`. **Ne pas lancer `upgrade head` sur cette base**
avant l'étape F, qui fait l'essai sur copie, la sauvegarde datée et la
comparaison du journal, et pas avant que le code de l'étape B1 crée le « Moi »
à l'inscription. Ce qui suit sur la base de développement décrit son état réel,
à la révision du Lot 6.

**Avant de lancer Alembic** : sans `DATABASE_URL`, la commande vise `backend/vtes.db`,
la base de développement. Vérifier la variable avant toute migration. Cette base n'est
pas versionnée ; elle a été reconstruite le 2026-09-29 à la révision `b7e41d0c9a52`,
avec le catalogue krcg importé (4149 cartes, 51 extensions, 113 produits), puis migrée
le même jour à `f3a91c47b2de`, puis le 2026-10-02 à `89695b77ef45` (la tête, Lot 6),
après un essai sur une copie ; la sauvegarde d'avant migration est conservée dans
`backend/vtes.db.pre-lot6-20261002-201755.bak`. Elle contient la vraie collection de
l'utilisateur : 28 entrées de stock, le deck « Banu Princes » et ses 20 lignes, 58
opérations au journal de sync, toutes au compte historique (`user_account.id = 1`,
rôle `admin`). Les disponibilités du stock ont été comparées ligne à ligne avant et
après : identiques. Ce compte a été **réclamé par l'utilisateur le 2026-10-02**
(`manage_accounts.py claim-legacy`) : il porte désormais une vraie adresse, un nom et
un mot de passe, à la place de l'adresse provisoire
`compte-historique@gurchon-hall.invalid` et du mot de passe inutilisable posés par la
migration. Sur toute autre base migrée à la tête, la réclamation reste à faire avant
d'ouvrir l'application, depuis `backend/` :
`uv run python scripts/manage_accounts.py claim-legacy --email <adresse> --username <nom>`
(les deux options sont obligatoires ; saisie interactive du mot de passe), sans quoi
personne ne peut se connecter pour accéder à ces données ni rejouer les files des
appareils existants (elles attendent sans dommage). Une base plus ancienne
se remet à niveau par ce même `upgrade head` ; une base repartie de zéro se reconstruit
par `upgrade head` suivi de `uv run python scripts/import_catalog.py`.

**Piège vécu (2026-09-29)** : les deux migrations du Lot 4 (`6c9a178b7a1d`,
`b7e41d0c9a52`) ne convertissent aucune donnée et refusent de s'exécuter
(`RuntimeError`) si `card_copy`, `deck_card` ou `deleted_deck_card` contiennent une
ligne (D3, `docs/lot4-plan-inventaire.md`). Une base locale restée en retard sur ces
deux révisions à cause d'une ligne de test oubliée bloque du même coup l'import du
catalogue : le code sur `main` lit `card_set.is_placeholder` (ajoutée par
`b7e41d0c9a52`), absente tant que la base n'est pas à la tête, d'où une
`OperationalError: no such column: card_set.is_placeholder` sur
`scripts/import_catalog.py`. Remède : vider les trois tables (ou repartir d'une base
neuve), puis `upgrade head` avant de relancer l'import.

**Routes existantes** : `/health`, `/cartes`, `/bundles`, `/langues`, `/stock`, `/decks`,
`/extensions`, `/sync`, et depuis le Lot 6 `/inscription`, `/connexion`, `/deconnexion`,
`/moi` — 28 opérations au contrat, détail au §7. Hors catalogue et authentification,
toute route exige une session. Aucune route `/joueurs`, `/tournois`,
`/parties`, `/participations` : elles viennent au Lot 7. Une UI métier de consultation
et de saisie existe pour la collection et les decks (`frontend/src/features/`,
routeur à hash `/#/...`), ainsi que les écrans de compte du Lot 6 (connexion,
inscription, compte, déconnexion), mobile et bureau ; aucune UI joueurs/tournois/parties
avant le Lot 7.

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
| ORM / DB | **SQLAlchemy 2.0 + Alembic + SQLite** | multi-utilisateur depuis le Lot 6 (un propriétaire sur chaque donnée privée) ; migration Postgres possible plus tard |
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
├─ docs/                      ← briefs de lot (ex. lot3-sync-contrat.md), handoffs de
│                               design (design-handoff/, Lot 5 et 5bis), fiches
│                               d'incident (issues/), références QA (qa-baselines/)
│                               et note de mise en service (deploiement.md)
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

Les règles de partie et de tournoi (de « Partie » à « Mono / multi-deck »
ci-dessous) ont été relues le 2026-10-28 dans les règles de tournoi de la VEKN
(vekn.net/tournament-rules, sections citées entre parenthèses) et adoptées par
l'utilisateur pour le Lot 7 (P1 de `docs/lot7-plan-parties.md`). Elles ne sont
plus des repères à confirmer. Elles corrigent l'ancienne version de cette section
sur quatre points : seuil du GW, taille de la finale, VP de retrait, limite du
multi-deck.

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
  dans les effectifs. L'autorisation de jouer des proxies est une propriété du deck
  (`proxy_allowed`), car elle dépend du tournoi auquel le deck est destiné et non de
  la carte ou de la collection ; le nombre de proxies reste porté par chaque ligne
  (`proxy_quantity`), avec `quantity - proxy_quantity` exemplaires réels consommés.
  Une ligne qui n'en consomme aucun (tout en proxy) ne demande rien à la collection :
  elle n'exige ni entrée de stock ni acquisition, seulement un deck qui autorise les
  proxies. Un deck intégralement joué en proxy est donc légal et activable sans
  posséder une seule carte — conséquence assumée, pas effet de bord (la légalité ne
  regarde que la composition et le catalogue).
- **Partie** : en tournoi, **4 ou 5 joueurs** par table (5 = table idéale). Table
  directionnelle (proie / prédateur) → siège enregistré, facultatif. L'outil accepte
  de 2 à 6 joueurs pour une partie, borne de saisie et non règle VEKN.
- **Victory Points (VP)** (3.7.2) : **1 VP** au prédateur chaque fois que **sa proie**
  est évincée ; **1 VP** au dernier survivant ; **0,5 VP** à chaque joueur encore en
  lice à la fin du temps ; **0,5 VP** à un joueur qui se retire. Tous les VP sont des
  multiples de 0,5, et une table de *n* joueurs distribue au plus *n* VP, si bien
  qu'un joueur seul n'en dépasse jamais *n*.
- **Game Win (GW)** (3.7.1) : au joueur qui a **au moins 2 VP** et **strictement plus
  de VP** que chacun des autres ; pas de GW en cas d'égalité en tête. Le seuil vaut
  2 VP **à toute table** (l'ancien repère « 2,5 VP à 5 joueurs » était faux).
  Corollaire, seul contrôle possible sans les VP des autres : un joueur qui a plus de
  *n* / 2 VP est seul en tête, donc a le GW dès qu'il a aussi 2 VP (2,5 VP à quatre,
  3 VP à cinq).
- **Points de tournoi (TP)** (3.7.3) : 60 / 48 / 36 / 24 / 12 selon le rang à la
  table (à 4 joueurs, la 3e place est vide : 60 / 48 / 24 / 12), ex aequo moyennés.
  **Non suivis par l'outil** : on ne saisit que ses propres VP et GW, ni sa place à la
  table ni le score des adversaires (P7 du plan du Lot 7).
- **Tournoi** (3.1) : au moins trois rondes préliminaires, puis une table finale des
  **cinq** mieux classés, facultative sous 8 joueurs (3.1.6). Classement des
  préliminaires par GW, puis VP, puis TP ; l'outil s'arrête aux VP. Le vainqueur est
  celui qui a le plus de VP **en finale seulement**, une égalité étant départagée par
  le classement des préliminaires ; les autres finalistes sont deuxièmes ex aequo
  (3.7.5), même si beaucoup d'organisateurs publient un ordre complet. Format
  **construit** ou **draft**, au choix de l'organisateur.
- **Mono / multi-deck** (3.1.5) : mono = même deck sur toutes mes parties du
  tournoi, finale comprise ; multi = deck variable d'une ronde à l'autre, annoncé à
  l'avance, **interdit en championnat national, en Grand Prix et en championnat
  continental**. Le règlement ne connaît pas de limite à 12 joueurs, que l'ancienne
  version de cette section donnait à tort. En multi, l'organisateur annonce avant la
  ronde 1 la règle du deck en finale (3.1.5a) : **meilleur deck** (celui de la
  meilleure ronde préliminaire, comparée par GW, puis VP, puis TP ; égalité parfaite :
  tirage au sort) ou **choix libre** (n'importe quel deck joué en préliminaires).
  Sans TP, l'outil admet en finale tous les decks à égalité sur GW et VP.
- **Langues** : stock compté séparément par langue — **FR**, **EN**, **ES** ou
  « autre » (`XX`) —, la liste restant ouverte puisque `language` est une table et
  non un enum. Toute entrée de collection porte un code de langue, jamais vide.
  L'identité d'une carte (nom, règles, clan…) est indépendante de la langue. La table
  étant partagée entre comptes, l'ajout d'une langue est réservé au rôle `admin`
  depuis le Lot 6 (§7).

Le Lot 6 ne change aucune de ces règles : la légalité porte sur la composition et le
catalogue, qui est commun à tous les comptes. Seule la portée de la comptabilité du
stock et de l'identité d'un deck devient « par compte » (§6).

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
Le Lot 3 ajoute une quatrième révision, `8cc70f4bbbcc` : la table `sync_operation`,
journal d'idempotence de `/sync` (§7, §11), ce qui porte le modèle à 23 tables.
Cette révision ne touche qu'une table neuve, sans mode batch, et se rejoue hors ligne
(`upgrade 5dc50e3c1701:8cc70f4bbbcc --sql`), contrairement aux deux précédentes.
Le Lot 4 en ajoute deux, sans table nouvelle : `6c9a178b7a1d` (`proxy_allowed` passe de
`card_copy` à `deck`) puis `b7e41d0c9a52` (l'extension entre dans la clé du stock, et
`card_set.is_placeholder` marque l'extension tampon de l'import). Toutes deux passent
par le mode batch et ne convertissent aucune donnée : montée comme descente refusent de
s'exécuter (`RuntimeError`, avant toute modification) si `card_copy`, `deck_card` ou
`deleted_deck_card` contiennent des lignes (§11, Lot 4).
Une septième révision, `f3a91c47b2de`, détache `deck_card` de la collection : ses clés
étrangères visent `card_printing` (carte + extension) et `language` au lieu de
`card_copy`. Elle ne convertit aucune donnée et n'a pas de garde de vacuité — toute
ligne en place satisfaisait déjà les nouvelles contraintes —, donc elle **s'applique sur
une base peuplée**, et sa montée se rend même hors ligne
(`upgrade b7e41d0c9a52:f3a91c47b2de --sql`). Sa descente, elle, refuse de tourner
(`RuntimeError`) s'il existe une ligne tout-proxy sans entrée de collection : c'est
exactement ce que la clé étrangère restaurée interdirait.
Le Lot 6 ajoute les huitième et neuvième révisions. `32d62f354d89` (R8, « comptes et
sessions ») crée `user_account` et `auth_session` et insère le compte historique
(`id = 1`, rôle `admin`, mot de passe inutilisable `!`), sans toucher aux tables
existantes. `89695b77ef45` (R9, « propriétaire sur les données ») pose `user_id` sur
neuf tables et **convertit les données** : chaque ligne existante est rattachée au
compte `1` par une valeur constante, tables vides comprises, sans garde de vacuité.
C'est la première révision du projet qui réécrit des données métier (D5 du plan, §11
Lot 6). Comme `f3a91c47b2de`, les tables sont renommées puis recréées à la main, hors
mode batch, et la montée des deux révisions se rend hors ligne (`--sql`). Les
descentes refusent de tourner (`RuntimeError`, avant toute modification) dès qu'il
existe un autre compte que le compte historique (R8) ou une ligne qui lui appartient
(R9) : en pratique, on ne redescend pas sous le Lot 6 avec un second compte. Le modèle
compte **25 tables**.

| Domaine | Tables | Points clés |
| --- | --- | --- |
| Comptes | `user_account`, `auth_session` | Lot 6. `user_account` : `email` (identifiant de connexion, unique, rogné et mis en minuscules à l'écriture comme à la recherche), `username` (handle public unique, `^[A-Za-z0-9_-]{3,32}$`), `password_hash` (chaîne PHC Argon2id, `!` pour un mot de passe inutilisable), `role` (`user`/`admin`, CHECK nommé). `auth_session` : `user_id` (FK, `ON DELETE CASCADE`), `token_hash` (SHA-256 du jeton, unique ; jamais le jeton en clair), `created_at`, `expires_at` (connexion + 14 jours, jamais repoussé). Révoquer une session, c'est supprimer sa ligne |
| Référence | `language`, `clan`, `discipline`, `sect`, `card_type`, `card_set`, `venue`, `bundle` | tout est partagé entre comptes, sauf `venue`, privée à chaque compte depuis le Lot 6 (`user_id`, nom unique par compte) ; `language` est une table ouverte (seed EN/FR/ES/XX « autre »), pas un enum ; `bundle` = produit (précon) rattaché à une extension ; `card_set.is_placeholder` marque l'extension tampon créée par l'import pour une carte publiée sans impression (§11, Lot 4) |
| Catalogue | `card`, `card_type_link`, `card_discipline_link`, `card_printing`, `card_printing_occurrence`, `card_translation` | `card` = identité indépendante de la langue, clé naturelle `vekn_id` ; dates de légalité `banned_on` et `legal_from` ; index non unique `ix_card_name_group_code_advanced` (retrouver un vampire par son triplet nom + groupe + advanced) ; `card_translation` (nom, texte, flavor, image par langue) ; impressions = carte × extension, avec occurrences détaillées (rareté, précon + copies, date) |
| Collection | `card_copy`, `deck`, `deck_card`, `deleted_deck_card` | identité d'inventaire **carte × langue × extension** (Lot 4) : PK de `card_copy` (`card_id`, `language_code`, `card_set_id`), FK composite vers `card_printing`, si bien que la base refuse un exemplaire dans une extension où la carte n'a pas été imprimée ; `deck_card` reprend les trois colonnes dans sa PK, mais ses FK visent `card_printing` (carte + extension) et `language`, pas `card_copy` — une ligne entièrement jouée en proxy ne consomme rien et n'a donc pas d'entrée de collection en face (`f3a91c47b2de`) ; `deleted_deck_card` garde l'extension, avec une FK vers `card_set` seulement (une decklist figée ne réserve rien, pas même l'extension tampon) ; `deck.proxy_allowed` porte l'autorisation de proxy. Depuis le Lot 6 : `user_id` en tête de la PK de `card_copy` (`user_id`, `card_id`, `language_code`, `card_set_id`), si bien que deux comptes ont chacun leur entrée pour la même impression et la même langue ; `deck.user_id`, avec l'unicité `uq_deck_user_id_name_discriminator` et une unicité (`id`, `user_id`) qui sert de cible aux FK composites ; `deck_card.user_id`, copie de celui du deck garantie par la FK composite (`deck_id`, `user_id`) → `deck`, qui rend la correspondance avec `card_copy` à nouveau une égalité de quatre colonnes depuis que `f3a91c47b2de` a retiré la FK entre elles ; `deleted_deck_card` sans `user_id` (elle se lit par son deck et ne compte dans aucune somme) |
| Pratique | `player`, `tournament`, `game`, `participation` | encore vides, mais déjà munies de leur `user_id` (Lot 6, D7) pour que le Lot 7 n'ait aucune migration de propriété à écrire ; un seul « Moi » **par compte** (index unique partiel sur `user_id` où `is_me`) ; nom de joueur unique par compte ; FK composites (`…_id`, `user_id`) entre partie, tournoi, lieu, participation et deck, si bien que la base refuse qu'une partie pointe le deck ou le tournoi d'un autre compte (une colonne nullable à NULL désactive le contrôle, `MATCH SIMPLE`) ; `participation.game_win` stocké mais non calculé |
| Synchronisation | `sync_operation` | journal d'idempotence de `POST /sync` (Lot 3) : `operation_id` (clé, unique **par compte** depuis le Lot 6 : `uq_sync_operation_user_id_operation_id`), empreinte du corps reçu, verdict rendu (`applied`/`replayed`/`rejected`), `client_ref` et `deck_id` pour résoudre un deck créé hors ligne. Sans clé étrangère, en ajout seul : son `user_id` (Lot 6) est un identifiant, pas une relation, et l'index partiel des `client_ref` appliquées porte sur (`user_id`, `client_ref`). Reste portable pour Barrin et ne retient rien du cycle de vie des decks. Son `downgrade` supprime la table, donc le journal — à garder en tête avant tout retour arrière, comme pour `deleted_deck_card` (§11) |

**Identité et cycle de vie d'un deck** (passe 2) : `deck.name` n'est plus unique ; il
est accompagné d'un `discriminator` de quatre chiffres (« 0001 » à « 9999 », le format
est garanti par un CHECK), tiré par le serveur, et c'est le couple (nom, discriminant)
qui est unique parmi **tous les decks d'un même compte**, supprimés compris (Lot 6, D2 ;
au Lot 2, l'unicité valait sur toute la base). Le serveur tire le discriminant parmi
ceux que le compte n'a pas encore pris pour ce nom, et le 409 d'épuisement des 9999
discriminants ne compte que les decks du compte. Deux comptes peuvent donc avoir chacun
un « Banu Princes#1234 » : un deck ne se désigne plus de façon univoque sans son
propriétaire, à garder en tête pour l'import VDB (Lot 9). Deux horodatages UTC portent
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
possédés). VP et GW sont tranchés depuis la relecture VEKN du Lot 7 (§5). La sémantique du proxy est tranchée depuis le Lot 2, et portée par le
deck depuis le Lot 4 (§11).
Le prérequis de titre/sect/capacité des cartes Library n'est pas structuré (krcg ne
l'expose pas, il reste dans le texte de carte).

**Règles portant sur plusieurs lignes** (non exprimables en simples contraintes de
colonne) → en logique de service + tests :

- deck légal, les cinq règles du §5 — *fait au Lot 2* (`services/vtes_rules.py`) ;
- comptabilité du stock : pour **chaque compte** et chaque entrée de sa collection
  (carte × langue × extension), la somme des exemplaires réels
  (`quantity - proxy_quantity`) alloués par les decks vivants **de ce compte**
  (archivés compris) ne dépasse pas `quantity_owned`. Une ligne de deck qui consomme au
  moins un exemplaire réel exige une entrée du même compte ; les decks d'un autre
  compte n'entrent jamais dans la somme, ni dans le message d'un 409 — *fait au Lot 2,
  par impression au Lot 4, par compte au Lot 6* (`services/stock.py`, où toutes les
  fonctions de comptabilité prennent le compte en paramètre obligatoire, sans valeur par
  défaut, pour qu'un oubli échoue au typage au lieu de compter globalement) ;
- tournoi mono-deck → toutes mes participations pointent le même deck, « mes »
  désignant le joueur `is_me` du compte propriétaire du tournoi (Lot 6) ;
- cohérence VP/GW (§5 : VP en multiples de 0,5 et bornés par la table, GW à 2 VP au
  moins, GW certain au-delà de la moitié des VP de la table) — *prévu au Lot 7* ;
- multi-deck interdit aux trois niveaux de championnat, et deck de finale conforme à
  la règle annoncée (§5) — *prévu au Lot 7* ;
- réconciliation stock ↔ decks (optionnel, cf. §11).

---

## 7. Contrat d'API (contract-first)

Le **contrat OpenAPI est la source de vérité** partagée front/back. Flux :
schémas Pydantic → OpenAPI (`contracts/openapi.json`) → client TS typé côté front.
Aucun type d'API réécrit à la main côté front.

Ressources principales (REST) : `/cartes`, `/stock`, `/decks`,
`/decks/{id}/cartes`, `/joueurs`, `/tournois`, `/parties`,
`/parties/{id}/participations`. Endpoint de synchronisation pour la file offline :
`POST /sync` (opérations idempotentes, clé d'idempotence côté client) — livré au Lot 3.

Livré aux Lots 2 à 6 (chemins en français, `operationId` en anglais camelCase),
28 opérations sur 20 chemins :

| Route | Rôle |
| --- | --- |
| `POST /inscription` (`signUp`) | Lot 6. Crée un compte (`email`, `username`, `password`), actif aussitôt, rôle `user` posé par le serveur (un `role` envoyé rend 422, comme tout champ inconnu), et ouvre la session : 201 `UserRead` + `Set-Cookie` ; 409 adresse ou nom déjà pris ; 429 + `Retry-After` |
| `POST /connexion` (`logIn`) | Lot 6. Ouvre une session : 200 `UserRead` + `Set-Cookie` ; 401 unique pour une adresse inconnue et un mauvais mot de passe ; 429 + `Retry-After` |
| `POST /deconnexion` (`logOut`) | Lot 6. Supprime la session courante et efface le cookie ; 204 toujours, même sans session valide |
| `GET /moi` (`readCurrentUser`) | Lot 6. Compte de la session (`UserRead` : `id`, `email`, `username`, `role`, `created_at`) ; 401 sans session |
| `GET /cartes`, `GET /cartes/{id}` | recherche (`q`, `category`, `clan_id`, `limit`, `offset`) et fiche complète du catalogue, en lecture seule ; chaque carte porte `card_set_ids` (ses impressions) et `latest_card_set_id` (sa dernière version, §11 Lot 4) |
| `GET /extensions` | liste des extensions du catalogue, marqueur `is_placeholder` compris (Lot 4) |
| `GET /bundles`, `GET /bundles/{id}` | produits et leur contenu (carte × exemplaires) |
| `POST /bundles/{id}/stock` | verse le contenu d'un produit dans le stock (`language_code`, `count`), chaque carte sous l'extension du produit ; 409 si un total dépasserait le plafond entier |
| `GET/POST /langues` | liste ouverte des langues ; lecture publique, ajout réservé au rôle `admin` (403 pour un compte `user`, Lot 6) |
| `GET/POST /stock`, `GET/PATCH/DELETE /stock/{card_id}/{language_code}/{card_set_id}` | collection, une entrée par carte, langue et extension ; filtre `card_set_id` sur la liste ; 404 pour une extension où la carte n'a pas été imprimée |
| `GET /decks` | liste filtrée par `state` (`active` par défaut, `archived`, `all`), `status` et `q` ; tri nom puis discriminant. Les decks supprimés n'y figurent jamais |
| `POST /decks` | crée un deck, avec son autorisation de proxy (`proxy_allowed`, faux par défaut) ; le discriminant est tiré par le serveur, jamais fourni par le client |
| `GET /decks/{id}` | deck et composition ; un deck supprimé se lit encore, en lecture seule, depuis sa decklist figée |
| `PATCH /decks/{id}` | modification partielle, `proxy_allowed` compris (409 s'il est retiré à un deck qui joue des proxies), et archivage ou désarchivage par le champ `archived` (`true` / `false`) |
| `DELETE /decks/{id}` | suppression **logique**, réservée à un deck archivé |
| `GET /decks/{id}/legalite` | verdict daté (`evaluated_on`) : les cinq règles du §5, les seuils, les groupes de crypt, les cartes bannies et pas encore légales, et `issues` en clair |
| `POST /decks/{id}/cartes`, `PATCH/DELETE /decks/{id}/cartes/{card_id}/{language_code}/{card_set_id}` | composition du deck ; une ligne qui consomme au moins un exemplaire réel est allouée depuis l'entrée de stock du même triplet, une ligne entièrement en proxy n'en exige aucune (`f3a91c47b2de`) |
| `POST /sync` | lot d'opérations idempotentes de la file offline (huit types : `stock.upsert/delete`, `deck.create/update/delete`, `deck_card.upsert/delete`, `bundle.deposit`), avec `card_set_id` obligatoire partout où figure `language_code` depuis le Lot 4 ; un verdict par opération, jamais une bascule en bloc du lot. Détail complet au §11 et dans `docs/lot3-sync-contrat.md` |

Les routes `/decks/{id}/archiver` et `/decks/{id}/restaurer` n'existent pas :
l'archivage passe par le `PATCH`, seul point d'entrée de la modification d'un deck.

Erreurs : 404 et 409 portent `ErrorResponse` (`{"detail": "…"}`) ; les 422 gardent le
format standard de FastAPI, y compris ceux que le service produit lui-même. `POST /sync`
n'utilise jamais 404 ni 409 : un refus est un verdict dans le corps d'une 200, et un 503
(`ErrorResponse` + en-tête `Retry-After`, exposé en CORS) signale que rien n'a été
appliqué faute d'avoir obtenu le verrou d'écriture — le lot se renvoie alors à l'identique.

**Authentification et cloisonnement (Lot 6).** Sont publics `/health`, le catalogue en
lecture (`GET /cartes…`, `/extensions`, `/bundles…`, `GET /langues`) et les trois
routes `POST /inscription`, `/connexion`, `/deconnexion`. **Toute autre route exige une
session** : `/stock…`, `/decks…`, `POST /bundles/{id}/stock`, `POST /sync`, `GET /moi`,
`POST /langues`. La session voyage dans un cookie `HttpOnly`, `Secure`, `SameSite=Lax`
(`__Host-gurchon_session` ; `gurchon_session` si `SESSION_COOKIE_SECURE` est coupé),
déclaré au contrat comme schéma de sécurité `apiKey` en cookie ; le jeton n'apparaît
jamais dans un corps de réponse. Les contrôles se font dans cet ordre et rendent :

- **401** (`ErrorResponse`) sans session, ou pour une session inconnue, expirée ou
  supprimée. Il passe avant tout : sans session, `/decks/999999` rend 401, pas 404.
- **404, jamais 403**, pour une ressource d'un autre compte, avec le même message que
  pour un identifiant inexistant (« Deck 12 introuvable. »). Les listes ne montrent que
  les données du compte. Aucun chemin n'a changé et aucun corps ne porte de `user_id` :
  le propriétaire vient de la session, et un `user_id` envoyé rend 422.
- **403** dans deux cas seulement, qui ne portent sur aucune ressource et ne révèlent
  donc rien : un compte `user` sur `POST /langues` (« Droits insuffisants. »), et une
  écriture (`POST`, `PATCH`, `DELETE`) dont l'en-tête `Origin` n'est pas dans
  `BACKEND_CORS_ORIGINS`.

Toute réponse authentifiée porte `Cache-Control: private, no-store`, pour que le cache
HTTP du navigateur ne resserve pas les données d'un compte à un autre. CORS passe en
`allow_credentials`, avec la liste fermée d'origines. Côté `POST /sync`, la session est
vérifiée une fois, avant le verrou ; un 401 signifie, comme le 503, que rien n'a été
appliqué. L'idempotence et les références client sont par compte : une `operation_id`
ou une `client_ref` déjà utilisée par un autre compte se comporte comme une clé neuve
ou une référence inconnue (`not_found`), jamais comme un `replayed` ou un
`mismatched_replay`. Les huit types d'opérations ne changent pas ; section « Lot 6 »
dans `docs/lot3-sync-contrat.md`.

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
  (`RequiredText`). Depuis le Lot 6, l'adresse est validée (`EmailStr`, 320 caractères
  au plus) et le mot de passe, jamais rogné, fait de 12 à 128 caractères avec une
  minuscule, une majuscule, un chiffre et un symbole : la borne haute refuse une entrée
  démesurée avant qu'Argon2 ne la hache.
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

Skills = modules `SKILL.md` réutilisables dans `.claude/skills/`, tous créés dans le
dépôt (sauf `ecriture-naturelle`, qui existe côté utilisateur et non dans le dépôt). Chaque
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

2. **Une carte doit être en collection pour qu'un deck en consomme un exemplaire
  réel** — la composition d'un deck s'appuie donc sur le stock possédé, pas sur
  une liste logique déconnectée. Formulation d'origine, plus stricte (« pour être
  ajoutée à un deck »), corrigée après le Lot 5 : un deck qui autorise les proxies
  peut jouer une carte qu'on ne possède pas, et l'exiger quand même rendait la
  ligne tout-proxy impossible à écrire
  (`docs/issues/2026-09-29-lot4b-ligne-100-pourcent-proxy-refusee.md`). Le deck porte
  `proxy_allowed`, une autorisation globale indiquant qu'il est compatible avec un
  tournoi acceptant les proxies ; cette propriété ne décrit ni la carte ni l'entrée
  de collection. Le nombre de proxies reste porté par chaque ligne
  (`proxy_quantity`).
   Langues possibles pour une carte : **FR, ES, EN, ou autre** — les traductions
   officielles disponibles (krcg / vekn.net) sont fr et es ; « autre » reste
   possible pour les exemplaires possédés, d'où une table `language` ouverte.
3. **Adversaires** : on suit uniquement **mes propres parties/résultats**, pas
   les decks ou résultats détaillés des autres joueurs.
4. **Langue au niveau de la carte** (pas seulement du stock ni du deck) : un
   deck peut donc contenir des cartes de langues différentes d'un exemplaire à
   l'autre.

*Résolu au Lot 1* : le modèle §6 a été révisé en conséquence — catalogue
(`card`, sans langue) distinct des exemplaires possédés (`card_copy`, par langue),
et composition de deck allouée depuis ces exemplaires. La clé étrangère de
`deck_card` vers `card_copy`, qui inscrivait l'allocation dans le schéma, a été
remplacée après le Lot 5 par une clé vers `card_printing` : c'est désormais le
service qui exige une entrée quand la ligne consomme du réel (`f3a91c47b2de`).

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

- **Sémantique du proxy** : `deck.proxy_allowed` est un booléen global au deck, choisi
  selon le tournoi visé : certains tournois refusent les proxies, d'autres les
  acceptent. Le nombre de proxies vit sur la ligne de deck
  (`deck_card.proxy_quantity`), un proxy n'est pas un exemplaire possédé. Une ligne de
  deck consomme donc `quantity - proxy_quantity` exemplaires réels, et la somme de ces
  consommations sur tous les decks ne peut pas dépasser `quantity_owned`. Refus en 409 :
  exemplaires insuffisants, proxy non autorisé par le deck, baisse du stock sous ce qui
  est alloué, désactivation du proxy sur un deck qui en utilise, suppression d'une
  entrée encore utilisée. Cette propriété de deck permettra aussi d'identifier plus
  facilement les decks jouables dans un tournoi donné.
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
  *Remplacé au Lot 6 (D2)* : l'unicité vaut désormais parmi les decks d'un même compte,
  supprimés compris, et le tirage comme le 409 d'épuisement ne regardent que ce compte
  (§6, §11 Lot 6).
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

1. **Comptabilité du stock non atomique** — *soldée pour les écritures par lot au Lot 3,
   cf. ci-dessous ; reste ouverte entre un lot et une écriture en ligne.*
2. **`POST /bundles/{id}/stock` reste non idempotent** en appel direct — *soldée pour les
   écritures qui passent par `/sync` au Lot 3, cf. ci-dessous.*
3. **Les migrations de la passe 2 ne se rejouent pas hors ligne** (`upgrade head --sql`) :
   le mode batch de SQLite exige une vraie base, et le rattrapage des discriminants est
   écrit en Python. Un test `xfail` documente la limite. La migration du Lot 3
   (`8cc70f4bbbcc`) n'a pas cette limite (§6) ; c'est la seule des deux `xfail` restants
   qui porte encore sur ce point (le second, apparu au Lot 3, est décrit ci-dessous).
4. **Le `downgrade` de `5dc50e3c1701` supprime `deleted_deck_card`** : les decks supprimés
   redeviendraient des decks vivants sans composition. À garder en tête avant tout retour
   arrière sur une base qui compte. Le `downgrade` de `8cc70f4bbbcc` a le même effet sur le
   journal de sync (§6, §11).
5. **Les tris restent sensibles à la casse et aux accents** : les `ORDER BY name` des
   listes (cartes, collection, decks) s'appuient sur la collation par défaut de SQLite,
   qui range les majuscules avant les minuscules et « Élan » après « Zoé ». Seule la
   recherche est normalisée, pas l'ordre d'affichage. Dette connue, non traitée.
6. **`banned_on` et `legal_from` ne sont évalués qu'à la date du jour** : les fonctions
   pures prennent une date d'évaluation, mais l'API n'expose pas ce paramètre. Un verdict
   rétrospectif (« ce deck était-il légal en mars ? ») demanderait de l'ouvrir.

Tranchées pendant le Lot 3 :

- **Contrat de `/sync`** : une saisie hors ligne part dans une file IndexedDB ; au retour
  du réseau, le client envoie cette file en un lot ordonné et reçoit un verdict par
  opération. Rien d'autre ne redescend : après une synchronisation, le client est en
  ligne par construction et rafraîchit ce qui l'intéresse par les `GET` existants. Chaque
  opération porte un `operation_id` tiré par le client **à la saisie**, jamais régénéré ;
  le serveur le journalise (`sync_operation`, §6) avec une empreinte du corps reçu. Une
  clé déjà tranchée n'est pas réappliquée : verdict mémorisé, issue `replayed`. Une clé
  déjà vue avec un corps différent est une collision, pas un rejeu (`mismatched_replay`).
  Brief complet, tenu à jour par l'architecte-contrat : `docs/lot3-sync-contrat.md`.
- **Politique de conflit : la file fait foi, les invariants font loi.** Dernière écriture
  gagnante (les upserts portent l'état complet voulu, pas un delta), aucun arbitrage sur
  l'horloge ; les seuls refus sont ceux que le serveur aurait déjà opposés en ligne
  (proxy non autorisé, exemplaires insuffisants, deck archivé, discriminant en collision…).
  Un refus n'interrompt jamais le lot : les opérations suivantes s'appliquent. Trois
  issues (`applied` / `replayed` / `rejected`) ; un conflit est un **code d'erreur**, pas
  une quatrième issue — l'issue dit si l'écriture a eu lieu, le code dit pourquoi elle ne
  l'a pas eue. Pas de garde optimiste (comparaison d'une version connue par le client à
  la version serveur) : extension possible, non implémentée.
- **Désigner un deck créé hors ligne** : le client lui attribue une `client_ref` (UUID),
  que les opérations suivantes du même deck réemploient. La correspondance
  `client_ref` → `deck_id` est mémorisée au journal, pas seulement le temps d'une requête,
  et résolue en ignorant l'état courant du deck (renommé, archivé ou supprimé depuis) :
  le rejeu d'une création rend toujours la même identité qu'à l'origine. Une `client_ref`
  déjà prise par une création appliquée est refusée en conflit, sans écriture.
- **Verrou d'écriture par lot** (`backend/app/db/locking.py`, `serialized_writes`) :
  `BEGIN IMMEDIATE` tenu pour tout le lot, un point de sauvegarde par opération, un seul
  `COMMIT` final qui valide effets métier et journal ensemble — un versement de bundle
  n'est donc jamais appliqué sans être journalisé. Ferme la course entre deux lots
  concurrents (limite n°1 ci-dessus, *pour les lots*) ; mesuré à 4-5 ms par opération sur
  un lot de 200. Propre à SQLite : `NotImplementedError` sur un autre moteur (l'équivalent
  Postgres serait un verrou consultatif ou `SELECT … FOR UPDATE`). Si le verrou n'est pas
  obtenu sous 5 s, la route rend un 503 + `Retry-After` : rien n'a été appliqué, le lot se
  renvoie à l'identique sans risque (§7).
- **Limite non fermée, assumée** : la course entre un lot `/sync` et une écriture en
  ligne (`POST /decks/{id}/cartes`, `PATCH /stock/...`, qui n'utilisent pas le verrou)
  reste ouverte — la fermer sérialiserait toutes les écritures de l'application, jugé
  disproportionné pour ce lot. Documentée par un test `xfail(strict=True)`
  (`backend/tests/test_sync_online_race.py`), le second des deux `xfail` mentionnés au
  point 3 ci-dessus.
- **Couche offline** (`frontend/src/offline/`, packagée pour Barrin — cœur générique
  `core/`/`react/` sans dépendance au domaine VtES, adaptateur `vtes/`) : base Dexie,
  file d'attente (`Outbox`), moteur de rejeu par lots de 200 déclenché par le retour
  réseau, le premier plan, le démarrage ou une action manuelle, avec backoff (1 s à 60 s,
  jamais moins que le `Retry-After` reçu) et bissection sur un 422 pour n'isoler que
  l'opération fautive. Une table `settled` retient les opérations tranchées jusqu'à ce
  que le miroir local les reflète, pour éviter qu'un deck ou une quantité de stock ne
  disparaisse un instant après sa synchronisation. La recherche locale reproduit
  `fold_text` (§11, Lot 2) à l'identique, y compris ses deux écarts JS/Python
  (`casefold()` vs `toLowerCase()`, `\p{M}` vs `unicodedata.combining()`), comblés par des
  tables générées depuis le code Python (`frontend/src/offline/tools/`). Détail de l'API
  du paquet : `frontend/src/offline/README.md`.
- **Première UI métier** : collection et decks, sur un routeur à hash écrit à la main
  (`frontend/src/app/routes.ts`) — aucune route cliente ne porte le nom d'une ressource
  de l'API (`/decks`, `/stock`…), sans quoi elle ne s'ouvrirait plus hors ligne au
  rechargement (denylist du service worker, §11 Lot 0). Toute écriture passe par
  `useVtesOffline().actions`, jamais par un appel bloquant. La légalité d'un deck reste
  une lecture en ligne (calculée à la demande, §11 Lot 2) : indisponible hors ligne,
  affichée avec un avertissement quand le deck a des modifications non synchronisées.
- **Repli sur `XX` pour une langue inconnue** : décidé côté client uniquement, dans la
  file offline. Le serveur, lui, continue de répondre `not_found` pour une langue absente
  de la table `language` (comme en ligne, §11 Lot 2) — aucune règle nouvelle côté API.
- **`bundle.deposit` non idempotent en appel direct, sûr par `/sync`** : le rejeu d'un
  versement à travers la file ne double-compte plus (verdict mémorisé au journal), mais
  `POST /bundles/{id}/stock` appelé hors file reste tel quel (additionne à chaque appel).

Tranchées pendant le Lot 4 (plan et justification complète dans
`docs/lot4-plan-inventaire.md`, décisions validées le 2026-09-24) :

- **Le proxy est une propriété du deck.** `deck.proxy_allowed` remplace
  `card_copy.proxy_allowed`. Les refus 409 suivent : ajout ou modification d'une ligne à
  proxies dans un deck qui ne les autorise pas, retrait de l'autorisation à un deck qui en
  joue. Le refus qui portait sur l'entrée de stock a disparu.
- **L'extension élargit la clé primaire (D1).** Pas de clé technique : le client hors
  ligne désigne une entrée par des valeurs qu'il connaît, et les chemins restent lisibles.
- **Toute entrée pointe une impression réelle (D2).** La FK composite vers
  `card_printing` sert de dernier filet ; avant elle, le service rend un 404 (ou
  `not_found` par `/sync`), comme pour une langue inconnue. Un exemplaire dont on ignore
  l'extension se range sous une impression plausible, corrigée plus tard.
- **Une carte jouée en proxy entre sous sa dernière version (D2a).** L'UI prend
  `latest_card_set_id`, calculé une seule fois côté serveur (`services/catalog.py`) :
  date la plus récente des occurrences de l'impression, à défaut celle de l'extension,
  puis extension datée avant extension sans date, puis abréviation par ordre
  alphabétique. Le miroir local stocke la valeur au lieu de la recalculer, pour ne pas
  ouvrir d'écart entre en ligne et hors ligne comme celui de `fold_text`. C'est une
  valeur par défaut, pas une contrainte. La justification d'origine parlait d'une entrée
  de collection à 0 exemplaire : depuis `f3a91c47b2de`, une ligne tout-proxy n'en crée
  aucune, et c'est la **ligne de deck** qui a besoin de cette extension par défaut —
  l'extension reste dans sa clé, il faut bien en choisir une.
- **Extension tampon pour une carte sans impression (D2b, D2c).** L'import la crée au
  besoin (`is_placeholder`), la signale dans son rapport et en avertissement sans échouer,
  et la retire au rejeu une fois krcg corrigé si aucune entrée de stock ne l'utilise. C'est
  la seule suppression que l'import s'autorise. Aucune carte n'est concernée aujourd'hui.
- **Aucune conversion de données (D3).** La base ne contenait ni stock ni deck : les
  migrations refusent de tourner sur des tables non vides plutôt que de porter un code de
  conversion jamais exécuté. Choix de pilote, à ne pas reproduire sur Barrin.
- **Pas de compatibilité avec l'ancienne file (D4).** `card_set_id` est obligatoire dans
  toutes les écritures. Côté client, la base Dexie monte en versions 3 puis 4 : IndexedDB
  ne change pas la clé primaire d'un magasin existant, il faut le supprimer puis le
  recréer. Les miroirs sont vidés et rechargés, la file et `settled` ne sont pas
  réécrites. La marche à suivre sur une base en service (champ d'abord facultatif, le
  temps de vider les files) est décrite pour Barrin dans `frontend/src/offline/README.md`.
- **La source reste krcg, avec ses extensions (D6).** vtescsv a été évalué puis écarté.
  Limite acceptée : les 26 cartes qui ont plusieurs promos distinctes n'ont qu'une
  impression `Promo`, et leurs exemplaires promo se confondent dans le stock.

Limites connues à la clôture du Lot 4 :

- **Les identifiants du catalogue sont devenus des références.** L'import garde ceux des
  extensions et des impressions d'un rejeu à l'autre (vérifié sur la base de
  développement le 2026-09-25), mais un renommage d'abréviation chez krcg recréerait
  l'extension et laisserait orphelines les entrées de stock de l'ancienne.
- **Deux révisions de plus ne se rejouent pas hors ligne** (`upgrade head --sql`), à cause
  du mode batch ; le `xfail` existant couvre la plage, puisqu'il vise la tête.
- **Le handoff de design ne connaît pas l'extension** : l'UI du Lot 4 se contente d'un
  champ fonctionnel, le Lot 5 devra l'intégrer (noté dans `docs/lot5-plan-design.md`).
- **Sous OneDrive, uv et Playwright demandent une précaution.** Les liens physiques de uv
  échouent dans le dossier synchronisé (`UV_LINK_MODE=copy`). Les fichiers que OneDrive
  n'a pas réécrits localement apparaissent à Node comme des liens symboliques, et
  Playwright les ignore sans prévenir : un run e2e n'est vert qu'avec le bon nombre de
  tests.

Tranchées pendant le Lot 5 (plan dans `docs/lot5-plan-design.md`, handoff mobile
« 1b » dans `docs/design-handoff/MOBILE.md`, `docs/design-handoff-mobile/` avant le
renommage de l'étape 15 du Lot 5bis) :

- **Acquisition depuis un deck (Lot 4b, pris en cours de lot).** Une ligne de deck porte
  un nombre de copies et un compteur « déjà possédées » ; le reste est en proxy. À
  0 possédé, toute la ligne est en proxy, ce qui exige `proxy_allowed` sur le deck. Les
  exemplaires possédés se prennent d'abord dans le stock disponible
  (`useAvailableStock`, même comptabilité que le serveur), et seul le manque est acquis
  (`acquired_quantity`). Pas de composition dans `DeckCreate` : `deck.create` puis un
  `deck_card.upsert` par ligne dans le même lot, reliés par `client_ref`. Pas de nouveau
  type d'opération `/sync` ni de migration. Le client ne refuse pas une carte absente du
  stock sans acquisition : c'est le serveur qui tranche — `conflict` s'il manque des
  exemplaires réels, accepté si la ligne est tout en proxy (correction A1 ci-dessous).
  Brief dans `docs/lot4b-acquisition-depuis-deck.md`.
- **Picker fusionné, une carte à la fois.** `CardPicker` et l'ancien formulaire d'ajout
  limité au stock ne forment plus qu'un écran (`AddDeckCardForm`), qui cherche dans le
  catalogue entier. Le « panier » multi-cartes du handoff n'est pas repris.
- **Pas de menu overflow dans le détail de deck** : les actions restent des boutons
  explicites sous la composition, comme au Lot 3.
- **`Loading` signale le chargement par `aria-busy`, jamais par `role="status"`** : la
  coquille ne garde qu'un seul `role="status"`, sur lequel les e2e s'appuient.
- **Collection** : pilule flottante « Ajouter une carte » et bouton rond « Verser un
  produit » ; feuille de filtres langue + extension + tri-état possédé / à 0
  (`StockFilterSheet`), au-delà de ce que dessine le handoff.
- **Decks** : le sous-titre « N decks » compte la liste filtrée, pas le total ; le
  switch « Proxies autorisés » reste dans la feuille « Nouveau deck ».
- **Catalogue** : `CatalogPanel` reste accessible en forme compacte au pied de l'Atelier
  (retirer l'action de mise à jour aurait été un changement de comportement), et sur la
  Collection quand le catalogue local est vide. *Corrigé au Lot 5c* : ce texte disait
  « en forme pleine » sur la Collection ; les deux usages sont aujourd'hui compacts, et la
  forme pleine n'est plus rendue nulle part.
- **Thème et shell** : app uniquement sombre (le mode clair a été retiré), police Inter
  auto-hébergée (`@fontsource/inter`) et précachée (`woff2` ajouté aux `globPatterns`),
  couleurs du manifeste alignées sur le fond Nocturne (`#161826`), icônes
  `@phosphor-icons/react`.
- **Écarts au handoff mobile, actés** : pas de proxy par entrée de stock (propriété du
  deck depuis le Lot 4) ; extension intégrée à la feuille d'entrée (sélecteur, désactivé
  en modification), ce qui solde la limite « le handoff ne connaît pas l'extension » du
  Lot 4 ; méta de ligne de collection « Catégorie · langue · extension » ; langue non modifiable sur une entrée existante (elle fait partie de
  la clé) ; puces de langue EN/FR/ES/Autre partagées ; « proxies autorisés » et
  « archivé » rendus en texte dans la méta d'une ligne de deck, sans badge.
- **Écran « Chercher » reporté** à un lot à part, hors ligne complet sur un miroir
  enrichi (`docs/lot-chercher-brief.md`). Son onglet reste désactivé jusque-là.
- **`data-testid`** : 170 occurrences sur 23 fichiers à la clôture (108 sur 17 avant le
  lot) ; ce recensement sert de repère de non-régression au Lot 5bis.

Limites connues à la clôture du Lot 5 :

- **Vérification PWA manuelle non faite** : le contrôle automatisé
  (`scripts/check-pwa-installability.mjs`) passe, mais le panneau Application de Chrome
  DevTools, la coupure réseau réelle et l'invite d'installation sur mobile restent à
  vérifier à la main, comme au Lot 0. *Soldé le 2026-10-28* : les trois points ont été
  vérifiés à la main.
- **La suite Playwright tourne en `Desktop Chrome` (1280 × 720)**, alors que l'UI livrée
  est mobile. Sans conséquence tant qu'il n'y a pas de breakpoint ; l'étape 0 du Lot 5bis
  fixe une largeur mobile explicite avant d'en poser un. *Soldé au Lot 5bis* : les
  projets mobiles tournent à 390 × 844, les projets bureau à 1440 × 900
  (`frontend/playwright.config.ts`).

Tranchées à l'ouverture du Lot 5bis (2026-09-29), avant toute implémentation :

- **Le Lot 5bis ne conçoit pas d'équivalent mobile pour ce qu'il introduit.** S'il livre
  un écran, une action ou une interaction propre au bureau sans contrepartie sous
  1024 px, il livre et continue : il n'a ni à ouvrir un chantier de design mobile en
  cours de route, ni à se demander à chaque écran si le mobile suit. Rattraper ces écarts
  est le rôle d'un lot dédié, le **Lot 5c** (`docs/lot5c-plan-design.md`), qui audite la
  symétrie fonctionnelle une fois les deux passes livrées, **dans les deux sens** :
  bureau vers mobile, et mobile vers bureau — le handoff bureau ne décrivant que ce qui
  change au-delà de 1024 px, la passe peut laisser tomber sans le voir une action que le
  mobile propose aujourd'hui.
- **Trois verdicts possibles au Lot 5c, pas quatre** : porté, hors périmètre avec
  justification écrite, ou renvoyé à un autre lot. Un manque présent des **deux** côtés
  (l'écran Chercher, les données absentes du miroir : disciplines, types, coût, image par
  impression) n'est pas une asymétrie et ne relève pas de ce lot.
- **Ordre proposé : Lot 5bis, puis Lot 5c, puis Chercher.** Un écart de symétrie se
  corrige plus facilement tant que les deux passes sont fraîches, et Chercher, écran neuf
  écrit après le breakpoint, peut naître directement dans les deux dispositions au lieu
  d'être porté ensuite. Corollaire assumé : le lot Chercher livre ses deux dispositions
  lui-même, le Lot 5c étant un rattrapage ponctuel et non une habitude.

Tranchées pendant le Lot 5c (2026-10-01 ; table d'écarts complète, avec un verdict par
ligne, dans `docs/lot5c-plan-design.md`) :

- **Portés vers le mobile** : un lien vers l'écran Synchronisation dans l'alerte de
  l'Atelier quel que soit le motif (avant, seulement en cas de refus : hors ligne ou
  serveur injoignable, l'écran était inatteignable) ; la liste des opérations en
  attente ; clan, capacité et « dans N decks » dans la méta d'une ligne de collection ;
  compteurs d'onglets et total d'exemplaires ; tri de la collection, dans la feuille de
  filtres, par la même fonction pure que le tableau bureau (`stockSort.ts`) ;
  « Dans le deck : N » dans le picker ; comptes crypte et bibliothèque dans les decks en
  cours de l'Atelier.
- **Portés vers le bureau** : le détail de la légalité dans le deckbuilder (motifs,
  noms des cartes bannies et pas encore légales, alerte « deck actif illégal », note
  brouillon, modifications non synchronisées), seul écart où le bureau perdait une
  information métier ; la date de saisie d'une opération refusée ; un bouton
  « Changer » pour vider la carte choisie du picker, seule action qui n'était
  atteignable qu'au clavier ; discriminant et statut dans le tableau de l'Atelier.
- **Correction d'une note du Lot 5** : la méta d'une ligne de collection mobile n'avait
  pas clan et capacité au motif que « le miroir n'a ni clan ni capacité ». C'était faux
  à la clôture du Lot 5bis (`CardRow.clanName` et `capacity` existent) ; l'écart est
  porté.
- **Hors périmètre, justifiés** (à ne pas rouvrir comme des oublis) : les raccourcis
  clavier, puisqu'un téléphone n'a pas de clavier à écouter et que chaque raccourci a
  un bouton équivalent ; la disposition maître/détail des Decks, sans place utile sous
  1024 px, l'ouverture d'un deck existant aux deux largeurs ; les steppers −/+ de la
  collection mobile contre l'édition en place du bureau, la même action restant
  atteignable des deux côtés ; le retour « +N à l'instant » du bureau, le mobile ayant
  le sien ; les raccourcis de l'Atelier bureau, que le mobile remplace par la tab bar
  et les boutons flottants ; le verdict de légalité dans l'Atelier mobile, qui coûterait
  un appel serveur par deck.
- **Renvoyés au lot Chercher** : l'image de carte (`CardImage`, aperçu au survol et
  image de la carte choisie), y compris sa forme statique dans le picker mobile ; le
  champ de recherche global de la barre haute, qui ne faisait rien (ni filtre ni focus
  par `/`) et qui est **masqué** jusqu'à ce que Chercher le rétablisse.
- **Reliquat du Lot 5bis** : la légende des raccourcis `?`, annoncée par le handoff
  bureau, n'a été livrée dans aucun mode. Pas de lot dédié.
- **Défauts corrigés en passant** : `Entrée` sur la page Decks n'est plus écoutée qu'au
  bureau et jamais sur un contrôle interactif (option `ignoreTarget` de
  `useKeyboardShortcuts`, comportement par défaut inchangé) ; les raccourcis de
  l'Atelier ouvrent la feuille annoncée par une **intention dans la route à hash**
  (`#/collection?action=ajouter|verser`, `#/decks?action=nouveau`), consommée une seule
  fois par `history.replaceState` — elle reste côté client et ne touche pas le service
  worker ; la quantité du tableau de la collection s'édite au clavier, et l'aperçu
  d'image s'ouvre aussi au focus.
- **`data-testid`** : 193 identifiants statiques distincts à la clôture (176 avant le
  lot, au même mode de comptage ; 252 mentions sur 24 fichiers avant le lot en comptage
  brut). Aucun n'a disparu ; ce recensement sert de repère de non-régression.

Limites connues à la clôture du Lot 5c :

- **Un échec vitest isolé**, non reproduit en huit exécutions suivantes, n'a pas été
  attribué à un test. À identifier s'il revient (relancer avec la sortie complète).
- **Refus « Deck inconnu »** observé après la suppression d'un deck qui avait des lignes
  en attente : hors du Lot 5c, ouvert pour pwa-offline dans
  `docs/issues/2026-10-01-deck-inconnu-apres-suppression.md`. *Soldé le 2026-10-01, cf.
  l'entrée « Tranchées en correction, hors lot (2026-10-01) » ci-dessous.*

Tranchées en correction, hors lot (2026-10-01) — **un refus visant un deck supprimé
depuis**. Diagnostic et scénario dans
`docs/issues/2026-10-01-deck-inconnu-apres-suppression.md` :

- **Le refus était légitime, le libellé fautif.** La ligne avait été refusée pour une
  raison sans lien avec la suppression (exemplaires insuffisants, un autre appareil
  ayant réservé l'exemplaire pendant la coupure). Le lot part dans l'ordre de saisie,
  sans réordonnancement ni fusion : les lignes valides passent avant la suppression. Un
  renvoi après la suppression est refusé en `conflict`, comme `POST /decks/{id}/cartes`
  sur un deck supprimé l'aurait été en ligne (409). Aucun changement de contrat ni de
  backend.
- **« Deck deck inconnu » était un défaut d'assemblage côté client**
  (`frontend/src/features/sync/useOperationLabels.ts`) : un deck créé hors ligne, puis
  supprimé, n'est plus dans le miroir et sa création, appliquée, n'est plus en file ; il
  ne reste qu'une `client_ref`, et le repli « deck inconnu » était préfixé par « Deck ».
  Le libellé devient « Deck introuvable localement (supprimé ?) : … ». Le miroir ne
  garde pas les decks supprimés, donc le nom exact n'est pas retrouvable.
- **Pas de purge de la file à la suppression d'un deck.** Retirer les lignes d'un deck
  qu'on supprime réécrirait la file et contredirait « la file fait foi » ; c'est inutile
  de surcroît, puisque l'ordre de saisie fait déjà passer les lignes valides. Une ligne
  refusée se règle par « Abandonner » sur l'écran Synchronisation.
- **Piste non retenue, possible plus tard** : masquer « Renvoyer tel quel » quand le deck
  visé est connu comme supprimé. Le renvoi est inoffensif (refus de même nature), donc
  pas prioritaire.

Tranchées en correction, hors lot (2026-09-29) — **la ligne de deck se détache de la
collection**. Diagnostic, pistes écartées et conception dans
`docs/issues/2026-09-29-lot4b-ligne-100-pourcent-proxy-refusee.md` (piste « A1 ») ; l'essentiel
tient en quelques points :

- **Le défaut.** Une ligne de deck entièrement jouée en proxy, pour une carte absente de
  la collection, était **impossible à écrire** : sans `acquired_quantity`, le serveur
  répondait « la carte n'est pas en collection » ; avec, la valeur dépassait la borne des
  exemplaires réels ajoutés, qui vaut zéro pour une telle ligne. Aucune valeur du champ ne
  passait. Constaté sur 19 opérations refusées du deck « Banu Princes ».
- **La correction.** `deck_card` ne pointe plus `card_copy` : ses clés étrangères visent
  `card_printing` (carte + extension, la même contrainte que porte `card_copy`, D2) et
  `language`. Une ligne qui ne consomme aucun exemplaire réel ne crée et n'exige donc
  aucune entrée de collection. `DeletedDeckCard` faisait déjà exactement cela depuis le
  Lot 2 ; le patron était écrit, il restait à l'appliquer aux lignes vivantes.
- **Piste écartée : l'entrée fantôme à `quantity_owned = 0`.** Elle aurait fait
  apparaître en collection une carte qu'on ne possède pas, du seul fait qu'un deck la
  joue en proxy. Écartée aussi l'idée de deux triggers SQLite reproduisant une clé
  étrangère conditionnelle : du DDL invisible à SQLAlchemy et à l'autogénération
  Alembic, donc une dette de portage vers Barrin pour un risque déjà couvert.
- **Ce que la comptabilité du stock y perd, et ce qu'elle n'y perd pas.** L'invariant du
  §6 tient sans modification : une ligne tout-proxy compte pour 0, et les sommes traitent
  déjà une clé absente comme une somme vide. En revanche la base ne garantit plus qu'une
  ligne de deck référence un exemplaire existant — ce sont les services qui le font. La
  course « suppression d'une entrée pendant l'ajout d'une ligne réelle » devient possible
  en écriture directe, ce qui élargit une brèche déjà documentée (§11 Lot 3, avec son
  `xfail`) plutôt que d'en ouvrir une nouvelle ; elle reste fermée pour les lots `/sync`
  par le verrou d'écriture.
- **Deux conséquences à connaître.** `deck_card` devient un second endroit où vivent des
  triplets carte × langue × extension sans entrée de collection, à côté de
  `deleted_deck_card`. Et il n'existe plus de vue transversale « les cartes que je joue en
  proxy » : plus aucune ligne de collection à filtrer pour ça, il faudrait une lecture
  dérivée si le besoin se confirme.
- **Migration.** Septième révision, `f3a91c47b2de`, sur `deck_card` seule : aucune
  conversion, aucune garde de vacuité, applicable sur une base peuplée (§6). La table est
  renommée puis recréée à la main plutôt que passée au mode batch d'Alembic : celui-ci
  recopie les contraintes dans un ordre qui change d'un processus à l'autre, ce qui
  rendrait un aller-retour comparé au texte près vert une fois sur deux (mesuré). Effet
  de bord bienvenu : la montée se rend hors ligne, ce qu'aucune révision depuis la
  première ne savait faire.

Tranchées pendant le Lot 6 (décisions prises le 2026-10-01 ; plan, justifications et
points d'interprétation dans `docs/lot6-plan-comptes.md`, qui fait foi pour le détail) :

- **Ordre des lots (D0).** Le Lot 6 a démarré juste après le Lot 5c, **avant** le lot
  Chercher, qui reste reporté. Écart assumé à l'ordre proposé à l'ouverture du Lot 5bis
  (5c, Chercher, Lot 6), noté comme un fait. Venu après le breakpoint bureau, le Lot 6 a
  livré ses écrans dans les deux dispositions et ne laisse rien à un lot de symétrie.
- **Une session serveur unique, pas de JWT (D1, P3).** Un jeton opaque de 32 octets dans
  un cookie `HttpOnly`, `Secure`, `SameSite=Lax`, dont seule l'empreinte SHA-256 est en
  base (`auth_session`) : une copie de `vtes.db` ne donne aucune session utilisable.
  Durée **14 jours fixes** à compter de la connexion, jamais repoussée ; une requête
  authentifiée n'écrit donc rien et n'attend pas le verrou d'écriture. Révoquer, c'est
  supprimer la ligne, avec effet immédiat. Pas de paire access/refresh : un JWT aurait
  porté la validité dans le jeton et demandé une liste noire pour révoquer, sans rien
  gagner sur une application à une seule API.
- **Hachage et protection de la connexion, alignés sur barrins-project (P1).** Argon2id
  par `argon2-cffi`, coûts de Barrin surchargeables (`ARGON2_MEMORY_COST_KIB`,
  `ARGON2_TIME_COST`, `ARGON2_PARALLELISM`), `needs_rehash` à chaque connexion réussie.
  Une vérification factice (`dummy_verify`) égalise le temps de réponse d'une adresse
  inconnue, et un seul message 401 couvre les deux cas. Limitation de débit `slowapi`
  par IP sur `POST /connexion` et `POST /inscription` (`LOGIN_RATE_LIMIT`,
  `SIGNUP_RATE_LIMIT`, 5 par minute par défaut). En CI, les coûts Argon2 sont abaissés
  pour la vitesse de la suite pytest, presque tous les tests passant désormais par un
  hachage.
- **Périmètre du compte (P2).** L'adresse e-mail est l'identifiant de connexion, un nom
  d'utilisateur séparé sert de handle public. Inscription ouverte, sans invitation ni
  vérification d'e-mail : le compte est actif et la session ouverte dès la réponse. Le
  serveur pose le rôle `user` lui-même. Oracle accepté : un 409 « adresse déjà
  utilisée » révèle qu'un compte existe, ce qui est inhérent à une inscription ouverte.
  Pas de changement de mot de passe par l'API, pas de suppression de compte :
  réinitialisation, rôles et sessions passent par `backend/scripts/manage_accounts.py`
  (`set-password` révoque toutes les sessions du compte).
- **Rôle à deux niveaux, `user` et `admin` (P4).** `StrEnum` avec une propriété
  `.level` et une dépendance fabriquée `require_role(min_role)`, comme chez Barrin, pour
  qu'un niveau intermédiaire puisse s'insérer plus tard. Il ne sert qu'à réserver
  `POST /langues`, la table `language` étant partagée. Aucune route ne modifie un rôle :
  un second administrateur se crée par `set-role`.
- **Partagé ou privé (P5).** Le catalogue, les extensions, les produits et les langues
  restent partagés et lisibles sans session. Collection, decks, journal de sync, et
  `venue`, sont privés à chaque compte : un lieu est une saisie de l'utilisateur, pas une
  référence publique.
- **Discriminant de deck unique par compte (D2)**, et non plus sur toute la base :
  reformulation de la règle du Lot 2 passe 2 ci-dessus, détail au §6. Avec une unicité
  globale, les decks d'un compte auraient pu épuiser les 9999 discriminants d'un nom
  chez un autre, et le 409 serait devenu un oracle.
- **Comptabilité du stock par compte** : nouvelle formulation au §6. Une somme restée
  globale aurait laissé les decks de B empêcher A de baisser sa quantité, et le message
  du 409 aurait révélé à A ce que B joue.
- **Les données existantes sont converties, pas refusées (D5).** Le Lot 4 refusait de
  migrer des tables non vides parce qu'il n'y avait rien à convertir et qu'un
  rattachement à une extension aurait exigé une heuristique ; ici la base contient la
  vraie collection et chaque ligne n'a qu'un seul propriétaire possible, si bien que la
  conversion se réduit à un `UPDATE` à valeur constante. C'est aussi le modèle que
  Barrin suivra pour son propre passage au multi-utilisateur sur une base en service.
  Le journal `sync_operation` est converti comme le reste, sans quoi une opération déjà
  tranchée qui attend encore dans une file (réponse perdue) serait réappliquée.
- **Un compte historique reçoit ces données (D6)** : `id = 1`, rôle `admin`, adresse
  `compte-historique@gurchon-hall.invalid` (domaine réservé), mot de passe inutilisable.
  Il se réclame par `manage_accounts.py claim-legacy`, jamais par la première
  inscription, qui aurait sinon hérité de la collection. La migration ne connaît aucun
  secret et se rejoue à l'identique partout.
- **Propriétaire posé dès maintenant sur les tables du Lot 7 (D7)** : `player`,
  `tournament`, `game`, `participation` et `venue`, encore vides, ont leur `user_id`.
  Le Lot 7 n'aura aucune migration de propriété à écrire et ses routes naîtront scopées.
- **Côté client, une base IndexedDB par compte** (`gurchon-hall-offline-u<id>`, par
  l'option `dbName` du runtime). Si la session de A expire et que B se connecte sur le
  même navigateur, la file de A dort dans la base de A et n'est jamais envoyée sous la
  session de B. La base d'avant le Lot 6 n'est adoptée par aucun compte d'office : à la
  première connexion, l'application propose de rattacher ses opérations en file, qui
  sont recopiées sans modification (mêmes clés, mêmes empreintes, un rejeu reste un
  rejeu). Le client garde une copie non secrète du dernier `GET /moi` pour savoir, hors
  ligne, qui est connecté.
- **401 = pause du moteur de sync.** Le transport gagne un état `unauthenticated`,
  générique et donc réutilisable par Barrin. Le moteur se met en pause (statut
  `auth_required`) : pas de backoff, **jamais de bissection**, **jamais de refus
  local**, aucune opération ne sort de la file ; le rejeu reprend après une connexion
  réussie. Les rafraîchissements de miroir qui reçoivent un 401 gardent les miroirs
  tels quels. Hors ligne, la session ne compte pas : l'application lit et saisit comme
  avant. Un 401 constaté avec une file non vide laisse l'application ouverte avec un
  bandeau de reconnexion ; avec une file vide, il affiche l'écran de connexion sans
  purger la base locale.
- **Déconnexion : avertir, puis purger sur confirmation (D3).** Si la file contient des
  opérations non tranchées, en attente ou refusées, la déconnexion en donne le nombre et
  prévient qu'elles seront perdues. Sur confirmation, `POST /deconnexion` part d'abord,
  puis la base IndexedDB du compte est supprimée en entier (miroirs, file, `settled`,
  correspondances `client_ref`) ; sans confirmation, rien ne bouge. La déconnexion est
  **refusée hors ligne** : le cookie étant `HttpOnly`, le client ne peut ni l'effacer ni
  faire supprimer la session, et purger la base en le laissant en place renverrait au
  retour du réseau des requêtes sous le compte précédent. Le precache du service worker
  ne contient que la coquille et n'est pas purgé. C'est la seule purge de la file que le
  projet s'autorise, et elle est demandée explicitement par l'utilisateur ; elle ne
  contredit pas la décision du 2026-10-01 de ne pas purger la file à la suppression
  d'un deck.
- **Ordre de mise en service** : migrer, puis réclamer le compte historique, **avant**
  d'ouvrir l'application. Migration et réclamation faites le 2026-10-02 sur
  `backend/vtes.db` (en-tête de ce fichier).

Limites connues à la clôture du Lot 6 :

- **Le verrou d'écriture de `/sync` reste global à la base SQLite**, limite acceptée :
  le lot d'un compte fait attendre celui d'un autre, au pire jusqu'au 503 +
  `Retry-After` après 5 s (environ une seconde pour un lot plein de 200). Les invariants
  étant tous par compte, un portage Postgres pourrait prendre un verrou consultatif par
  compte (`pg_advisory_xact_lock(user_id)`). La course entre un lot et une écriture en
  ligne (§11 Lot 3, `xfail` de `test_sync_online_race.py`) reste ouverte, sans
  s'élargir entre comptes puisque deux comptes ne partagent aucune ligne écrite.
- **Flakiness vitest résiduelle, même nature qu'au Lot 5c, pas une régression du
  Lot 6** : deux exécutions de la suite complète sur quatre ont vu échouer un test,
  chaque fois différent et sans rapport avec l'authentification, sans reproduction en
  isolation. Toujours à attribuer s'il revient.
- **Cookie `Secure` sur `http://localhost`** : Chrome et Firefox sont documentés comme
  l'acceptant ; *vérifié à la main le 2026-10-28* sur le navigateur en usage (connexion
  puis application utilisable, sans 401 sur `GET /moi`). Un autre navigateur ou une
  autre version pourrait se comporter autrement. Symptôme d'un refus : connexion
  réussie puis 401 immédiat sur `GET /moi`. Repli :
  `SESSION_COOKIE_SECURE=false` en développement local (`backend/.env.example`). Mélanger
  `localhost` et `127.0.0.1` casse aussi la session sans message (deux sites distincts).
- **Limitation de débit en mémoire du processus** : compteurs remis à zéro au
  redémarrage et non partagés entre processus, acceptable pour un uvicorn à un seul
  processus ; derrière le proxy de Barrin, l'IP viendra de `X-Forwarded-For`, à
  configurer au Lot 11.
- **Identifiants séquentiels sur toute la base** : un compte peut estimer le nombre total
  de decks créés en regardant croître les siens. Rien d'autre n'en découle, tout
  identifiant étranger rendant 404.
- **Les descentes de R8 et R9 sont bloquées dès qu'un second compte existe** (§6). Les
  formes de migration écrites à la main (renommage puis copie) et les FK composites
  sont propres à SQLite et seraient à réécrire pour Postgres.
- **Tests de référence** : la matrice d'autorisation complète, route par route, est dans
  `backend/tests/test_lot6_authorization_matrix.py` (401 sans session, 404 pour un autre
  compte, 403 de rôle sur `POST /langues`, isolation de `/sync`) ; les tests d'isolation
  ciblés de l'étape A3 restent dans `backend/tests/test_lot6_isolation.py`, de portée
  plus réduite ; les trois scénarios de bout en bout sont dans
  `frontend/tests/e2e-real/lot6-comptes.spec.ts`.

---

## 12. Roadmap

1. **Lot 0 — Squelette + PWA minimale** — *livré.*
   Monorepo, FastAPI `/health`, React+Vite, manifest + service worker, tests
   automatisés (pytest, vitest, Playwright offline), CI. Vérifié à la main le
   2026-10-28 : panneau Application de Chrome DevTools (manifest sans avertissement,
   SW *activated*), coupure réseau réelle, invite d'installation sur mobile.
2. **Lot 1 — Contrat & modèle** — *livré.* Dettes de tooling soldées
   (uv + `uv.lock`, ruff, ESLint, scripts unifiés), modèle de 21 tables à l'époque (22
   depuis le Lot 2), migration initiale, schémas Pydantic, chaîne de génération du client
   TS. Aucune route ajoutée :
   le contrat reste limité à `/health`. CI (`astral-sh/setup-uv`, ruff, ESLint, tests)
   vérifiée verte au premier push. Dependabot en mode `uv` est confirmé : il ouvre des
   PR sur `backend/uv.lock` (branches `dependabot/uv/backend/…`).
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
4. **Lot 3 — Offline-first** — *livré.* `POST /sync` (23e opération du contrat, journal
   d'idempotence `sync_operation`, verrou d'écriture par lot), couche offline
   `frontend/src/offline/` (Dexie, file d'attente, moteur de rejeu, recherche repliée
   comme `fold_text`), première UI métier (collection, decks) sur routeur à hash. Détail
   complet des décisions au §11 ; brief de contrat dans `docs/lot3-sync-contrat.md`,
   documentation du paquet offline dans `frontend/src/offline/README.md`. 1488 tests
   backend (2 `xfail` assumés, §11) et 216 tests vitest passent ; 22 tests Playwright,
   dont 13 tournent contre un vrai back sur base éphémère (`frontend/tests/e2e-real/`) et
   couvrent le parcours complet (coupure, saisie, rechargement hors ligne, retour réseau,
   rejeu), l'idempotence de bout en bout (réponse perdue, 503 simulé), les refus/conflits
   et la synchronisation à deux onglets. Un défaut trouvé par la QA (l'en-tête
   `Retry-After` n'était pas exposé en CORS) a été corrigé avant la clôture du lot. Deux
   limites restent ouvertes par décision assumée, pas par oubli : la course entre un lot
   et une écriture en ligne (§11), et le `downgrade` de la migration qui supprime le
   journal (§6, §11).
5. **Lot 4 — Inventaire par impression** — *livré.* Autorisation de proxy portée par le
   deck, puis identité d'inventaire **carte × langue × extension** à travers le modèle
   (deux révisions, `6c9a178b7a1d` et `b7e41d0c9a52`), le contrat (24e opération,
   `GET /extensions` ; `card_set_id` dans les chemins, les écritures et `/sync`), l'import
   krcg (dernière version d'une carte, extension tampon, `--json`), le miroir Dexie
   (versions 3 et 4) et l'UI collection et decks. Plan dans
   `docs/lot4-plan-inventaire.md`, décisions et limites au §11. 1552 tests backend
   (2 `xfail` assumés), 228 tests vitest et 23 tests Playwright passent, dont un nouveau
   scénario contre le vrai back : deux impressions de la même carte et langue saisies hors
   ligne, placées dans un deck puis rejouées. Base de développement migrée à la tête et
   import rejoué sans doublon ni changement d'identifiant.
6. **Lot 5 — Passe design mobile** — *livré.* Refonte
   de l'UI sur le handoff « 1b » (design system Nocturne, `docs/design-handoff/MOBILE.md`) :
   10 écrans phone-first plus les états vides, de chargement et introuvable, sans
   changement de comportement (mêmes routes, mêmes données, même sémantique offline).
   S'y ajoute l'acquisition depuis un deck (Lot 4b, back `acquired_quantity` et couche
   offline), habillée dans le même langage. Plan dans `docs/lot5-plan-design.md`,
   décisions et limites au §11. 1597 tests backend (2 `xfail` assumés), 247 tests vitest
   et 25 tests Playwright passent (9 `chromium`, 16 `real-backend`, décompte vérifié par
   fichier, par `--list` et à l'exécution), dont un nouveau scénario contre le vrai back :
   un deck monté hors ligne avec acquisition totale puis partielle. Le contrôle
   automatisé d'installabilité passe, et la vérification à la main (panneau
   Application, SW *activated*, coupure réseau réelle, invite d'installation sur
   mobile) a été faite le 2026-10-28. Ce lot couvre l'affichage **mobile** uniquement (colonne unique) ; le
   desktop est hors de son périmètre et forme un lot séparé, **Lot 5bis** (handoff
   `docs/design-handoff/DESKTOP.md`, plan `docs/lot5bis-plan-design.md`), sans
   décaler la numérotation des lots suivants.
   Le Lot 5bis est *livré* (PR #17).
   Le **Lot 5c** est *livré* : audit fait, chaque écart tranché, les écarts portés
   implémentés et couverts chacun par un e2e à la largeur où il manquait ; 364 tests
   vitest et 47 tests Playwright passent (9 `chromium`, 21 `real-backend`, 3 `desktop`,
   14 `desktop-real-backend`). Verdicts au §11, table dans `docs/lot5c-plan-design.md`.
   Son objet, pour mémoire : il suit les deux passes et audite la
   **symétrie fonctionnelle** entre mobile et bureau écran par écran, sur les deux
   handoffs et les deux implémentations, puis rend pour chaque écart un verdict écrit —
   porté dans le mode qui le manque, hors périmètre avec justification, ou renvoyé à un
   autre lot. Il existe parce que le Lot 5bis n'a pas la charge de concevoir du mobile
   pour ce qu'il introduit en chemin (§11) ; il ne construit aucune fonctionnalité
   nouvelle et ne rouvre pas les manques présents des deux côtés.
   Un lot **Chercher** (écran de recherche dans le catalogue, hors ligne complet, brief
   dans `docs/lot-chercher-brief.md`) vient ensuite, et livre ses deux dispositions
   lui-même. L'ordre proposé était Lot 5bis, Lot 5c, Chercher, puis les Lots 6 à 11,
   dont la numérotation ne bouge pas. Dans les faits, le Lot 6 est passé avant Chercher
   (D0 de `docs/lot6-plan-comptes.md`, §11) ; Chercher reste reporté, et sa place par
   rapport aux Lots 7 à 11 reste à confirmer avec l'utilisateur.
7. **Lot 6 — Comptes et multi-utilisateur** — *livré* (PR #39). Le pilote sort
   du mono-utilisateur : comptes (inscription ouverte, connexion, déconnexion, `GET /moi`), session serveur de 14 jours fixes dans
   un cookie `HttpOnly` (empreinte seule en base), hachage Argon2id et limitation de
   débit alignés sur Barrin, rôle `user`/`admin` réservant `POST /langues`. Deux
   révisions, `32d62f354d89` (comptes et sessions) et `89695b77ef45` (propriétaire sur
   neuf tables, données existantes converties vers le compte historique) : 25 tables,
   neuf révisions. Contrat à 28 opérations, toute route métier sous session, 404 pour
   la ressource d'un autre compte ; discriminant de deck et comptabilité du stock par
   compte ; propriétaire déjà posé sur les tables du Lot 7. Côté client : une base
   IndexedDB par compte, adoption sur confirmation de la base d'avant le lot, pause du
   moteur de sync sur 401, déconnexion en ligne seulement avec avertissement puis
   purge, écrans de compte en mobile et en bureau. Plan dans
   `docs/lot6-plan-comptes.md`, décisions et limites au §11. 1719 tests backend passent
   (2 `xfail` assumés, `ruff check` propre), dont les 28 de la matrice d'autorisation
   (`backend/tests/test_lot6_authorization_matrix.py`) ; 416 tests vitest sur 30
   fichiers (avec une flakiness résiduelle déjà connue au Lot 5c, §11), lint et
   `tsc` propres ; 51 tests Playwright (8 `chromium`, 26 `real-backend`, 3 `desktop`,
   14 `desktop-real-backend`, contre 47 à la clôture du Lot 5c), dont trois scénarios
   de comptes contre le vrai back : session révoquée pendant une coupure, deux comptes
   successifs dans le même navigateur, déconnexion avec file non vide. Migration
   appliquée le 2026-10-02 sur `backend/vtes.db` après un essai sur copie : 28 entrées
   de stock, 1 deck, 20 lignes de composition et 58 opérations de journal rattachées au
   compte `1`, disponibilités du stock identiques avant et après, sauvegarde dans
   `backend/vtes.db.pre-lot6-20261002-201755.bak`. Compte historique réclamé par
   l'utilisateur le même jour (`manage_accounts.py claim-legacy`).
8. **Lot 7 — Parties & tournois** : saisie, mono/multi-deck, participations.
9. **Lot 8 — Analyse** : perf par deck, historique par lieu/date.
10. **Lot 9 — Import de decks depuis VDB** : importer des decklists externes depuis VDB
  (`github.com/smeaa/vdb`) et les rattacher au modèle deck du Lot 4 (stock par carte,
  langue et extension, `deck_card`, discriminant). À ne pas confondre avec l'import du catalogue krcg
   (§11.1), qui alimente les cartes : ici, ce sont des decks. Restent à trancher
   l'appariement des cartes sur `vekn_id` et le sort d'une carte absente de la
   collection, un deck ne s'alimentant que du stock possédé (§11.2).
11. **Lot 10 — Portage** : packager le socle offline pour barrins-project, côté code —
  le déploiement de gurchon-hall lui-même est traité au Lot 11.
12. **Lot 11 — Playbook Ansible de déploiement** : écrire un playbook qui réutilise
    l'infrastructure de déploiement déjà en place sur barrins-project, où il sera
    hébergé temporairement, plutôt que de monter un déploiement propre à gurchon-hall.
    Dépend du Lot 10 : le portage prépare le terrain côté code, ce lot met gurchon-hall
    en ligne par les moyens de Barrin (HTTPS obligatoire pour la PWA, §2).
