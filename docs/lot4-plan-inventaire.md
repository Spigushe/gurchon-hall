# Lot 4 — inventaire par impression : plan d'implémentation

Brief d'entrée de lot, écrit avant toute implémentation, sur le même principe
que `docs/lot3-sync-contrat.md` et `docs/lot5-plan-design.md` : il fixe ce qui
a été tranché avant d'écrire du code, découpe le travail, dit quel agent le
porte avec quelles skills, et liste ce qui peut casser. Il ne remplace ni le
§ 12 de CLAUDE.md (la portée) ni le brief de contrat de l'architecte (le détail
des schémas).

## Portée

Le lot fait deux choses, que CLAUDE.md a déjà actées dans le texte mais pas
dans le code :

1. **`proxy_allowed` passe de la collection au deck.** Le code actuel le porte
   encore sur `card_copy` (`app/models/collection.py`, `app/services/stock.py`,
   `CardCopyCreate`, `StockRow.proxyAllowed` côté Dexie). CLAUDE.md § 5 et § 11
   le décrivent désormais comme une propriété du deck, choisie selon le tournoi
   visé. C'est un changement de sémantique autant que de schéma : les refus 409
   ne portent plus sur l'entrée de stock mais sur le deck.
2. **L'identité d'une entrée de stock devient carte × langue × extension.**
   Aujourd'hui `card_copy` a pour clé (carte, langue), et `deck_card` pointe
   cette clé. Deux exemplaires français de *Govern the Unaligned* issus de deux
   extensions se confondent. La dimension doit traverser le modèle, le contrat,
   la file `/sync`, le miroir IndexedDB et l'UI.

Ce que le lot ne fait pas : pas de comptes (Lot 6), pas de parties ni de
tournois (Lot 7), pas de passe design (Lot 5). La légalité d'un deck ne change
pas de règles : elle porte sur la carte, pas sur l'impression.

État de départ, relevé sur `backend/vtes.db` le 2026-09-24 :

- 51 extensions, 4149 cartes, 113 produits ;
- **toutes les cartes ont au moins une impression** (1386 n'en ont qu'une), et
  toute extension porte au moins une impression ;
- chaque occurrence `precon` d'un produit désigne une impression de
  l'extension de ce produit (aucune exception) : un versement de produit sait
  donc sans ambiguïté sous quelle impression ranger chaque carte ;
- **aucune entrée de stock, aucun deck**, et aucune opération en attente dans
  la file offline.

## Décisions tranchées

Validées par l'utilisateur le 2026-09-24, à consigner par l'architecte-contrat
dans son brief puis par l'orchestrateur au § 11 de CLAUDE.md à la clôture.

**D1 — L'extension élargit la clé primaire.** `card_copy` a pour PK
(`card_id`, `language_code`, `card_set_id`) ; `deck_card` et
`deleted_deck_card` reprennent la même colonne dans leur PK, et la FK composite
de `deck_card` vers `card_copy` passe à trois colonnes. Pas de clé technique :
le client hors ligne désigne une entrée par des valeurs qu'il connaît, et les
chemins restent lisibles (`/stock/{card_id}/{language_code}/{card_set_id}`).

**D2 — Toute entrée pointe une impression réelle du catalogue.** Aucune carte
du catalogue n'est sans édition, donc pas de pseudo-extension « inconnue » côté
saisie. `card_copy` porte une **FK composite vers `card_printing` (`card_id`,
`card_set_id`)**, qui a déjà sa contrainte d'unicité : la base elle-même refuse
un exemplaire dans une extension où la carte n'a pas été imprimée. Un
exemplaire dont on ignore l'extension se range sous une impression plausible,
corrigée plus tard si besoin. Trois règles complètent la décision.

*D2a — Une carte jouée en proxy entre sous sa dernière version.* Quand une
carte non possédée entre en collection pour être jouée en proxy (entrée à 0
exemplaire, § 11 point 2), elle prend l'impression la plus récente de la carte.
Définition, vérifiée sur le catalogue le 2026-09-24 :

1. date d'une impression = la plus récente `released_on` de ses occurrences,
   à défaut la `release_date` de l'extension. Les deux seules extensions sans
   date (Promo, 1162 impressions, et POD) ont toutes des occurrences datées :
   aucune carte n'est sans date ;
2. à date égale, une extension datée (produit commercial) passe avant une
   extension sans date (Promo, POD) ;
3. puis l'abréviation d'extension, par ordre alphabétique : une règle stable
   d'une base à l'autre, contrairement à l'identifiant.

Quatre cartes seulement arrivent au-delà de la règle 1 : *Ashur Tablets* et
*Emerald Legionnaire* (Promo et POD le 2024-01-01, départagées par l'ordre
alphabétique : POD), *Carlton Van Wyk* et *The Unmasking* (SP et Ant1 le
2019-02-16 : Ant1). L'extension tampon (D2b) ne compte que si elle est la seule.

Le calcul est fait **une seule fois, côté serveur** : `GET /cartes` expose
`latest_card_set_id` pour chaque carte, et le miroir local le stocke. Le
recalculer en TypeScript ferait courir le risque d'un écart entre le calcul en
ligne et le calcul hors ligne, celui que le Lot 3 a dû combler pour
`fold_text`. C'est une valeur par défaut appliquée par l'UI (et, plus tard, par
l'import VDB du Lot 9), pas une contrainte de base : une entrée à 0 exemplaire
peut exister sous une autre impression (cartes revendues, par exemple). Une
réimpression ultérieure ne déplace pas les entrées existantes.

*D2b — Une carte sans extension à l'import reçoit une extension tampon.* Si
krcg publie une carte sans aucune impression, l'import la rattache à une
extension tampon qu'il crée au besoin (une seule pour tout le catalogue, avec
un marqueur dans `card_set`, par exemple `is_placeholder`), avec une
impression tampon pour cette carte. La carte reste donc saisissable. Rien de
tel n'existe aujourd'hui ; si le cas se présente, l'utilisateur vérifie puis
corrige la source par une PR sur krcg.

*D2c — L'import signale ces cartes dans son retour.* `ImportReport`
(`app/services/catalog_import.py`) gagne la liste des cartes placées sous
l'extension tampon (identifiant VEKN et nom). Le script
(`scripts/import_catalog.py`) l'affiche à part, en avertissement sur la sortie
d'erreur, sans faire échouer l'import. Il accepte aussi `--json`, pour qu'un
déclenchement sans humain devant la console (le serveur déployé, cf. Lot 11)
puisse relire le rapport. Au rejeu, une fois krcg corrigé, l'impression
réelle s'ajoute : l'impression tampon est retirée si aucune entrée de stock ne
l'utilise, et gardée sinon, avec la carte signalée « à réattribuer ». C'est la
seule suppression que l'import s'autorise (§ 11 : il ne supprime rien
d'autre), limitée à ce qu'il a lui-même fabriqué.

**D3 — Aucune conversion de données.** Hors catalogue, la base est vide. Les
migrations ne convertissent rien : elles vérifient que `card_copy`, `deck_card`
et `deleted_deck_card` sont vides et s'arrêtent sur un message explicite dans
le cas contraire, plutôt que de porter un code de conversion jamais exécuté. Le
`downgrade` suit la même règle. C'est un choix de pilote, pas un modèle à
reproduire sur Barrin, où il y aura des données à reprendre.

**D4 — Pas de compatibilité avec l'ancienne file.** Aucune opération n'attend
dans la file, et l'application n'a qu'un utilisateur. `card_set_id` est donc
**obligatoire** dans toutes les écritures et dans les opérations `/sync`, et
`proxy_allowed` disparaît purement de `CardCopyCreate` et `CardCopyUpdate`.
Garde-fou côté client tout de même : à la montée de version Dexie, si la file
contient encore des opérations, on ne les réécrit pas (changer le corps
changerait l'empreinte et transformerait un rejeu en collision) ; elles
partiront et seront refusées en 422, isolées par la bissection. Ce qui compte
pour Barrin est à écrire dans `frontend/src/offline/README.md` : un changement
de contrat qui rend obligatoire un champ nouveau doit, sur une base en service,
le déclarer facultatif le temps de vider les files, parce que l'empreinte
(`schemas/sync.py`, `fingerprint`, en `exclude_unset=True`) ne tient compte que
des champs envoyés.

**D6 — La source reste krcg, avec son découpage en extensions.** Le dépôt
vtescsv (GiottoVerducci, dont krcg dérive) a été évalué le 2026-09-24 comme
source de rechange. Il découpe les promos plus finement (75 extensions
`Promo-AAAAMMJJ`, datées et nommées, là où krcg n'a qu'une extension `Promo`
sans date) mais regroupe les rééditions (KoTR, HttBR, Ant1, PP1 à PP3) dans
leur extension d'origine, et il n'a ni traductions, ni `legal_from`, ni noms de
produits, avec 24 codes promo mal formés. L'import reste donc sur krcg, sans
seconde source, et reprend ses extensions telles qu'elles sont publiées.

Limite acceptée : les 26 cartes qui ont plusieurs promos distinctes (trois pour
*The Capuchin*, par exemple) n'ont qu'une impression `Promo`, et leurs
exemplaires promo se confondent dans le stock. Les dates de ces promos restent
connues par les occurrences d'impression ; un découpage ultérieur pourrait s'en
servir sans changer de source. À consigner au § 11 avec les limites du lot.
Hors lot, `vteslibmeta.csv` structure les prérequis des cartes Library (379
cartes), que krcg n'expose pas : c'est la seule piste qui justifierait un jour
d'importer vtescsv en complément.

**D5 — Le catalogue local connaît les impressions.** Pour proposer une
extension hors ligne, il faut une route `GET /extensions` (lecture seule, liste
de `card_set`) et, dans les résultats de `GET /cartes`, les identifiants
d'extension de chaque carte. Le contrat passe de 23 à 24 opérations.

## Découpage en étapes ordonnées

Deux passes, comme au Lot 2, pour garder chaque migration relisible : la passe A
déplace le proxy (petite, sans changement de clé), la passe B ajoute
l'extension. Chaque passe a sa révision Alembic.

| # | Étape | Agent | Skills | Fichiers principaux | Dépend de |
| --- | --- | --- | --- | --- | --- |
| A1 | Proxy : modèle, migration, schémas, contrat | architecte-contrat | `modele-donnees`, `migrations-alembic`, `contrat-openapi`, `regles-vtes` | `models/collection.py`, nouvelle révision, `schemas/collection.py`, `contracts/openapi.json` | — |
| A2 | Proxy : services, routes, `/sync` | backend-fastapi | `fastapi-endpoint`, `regles-vtes`, `tests-backend` | `services/stock.py`, `services/decks.py`, `services/sync.py` | A1 |
| B1 | Extension : modèle, migration, schémas, contrat, brief | architecte-contrat | `modele-donnees`, `migrations-alembic`, `contrat-openapi`, `regles-vtes` | `models/collection.py`, nouvelle révision, `schemas/collection.py`, `schemas/sync.py`, `schemas/catalog.py`, `docs/lot3-sync-contrat.md` | A1 |
| B2 | Extension : services, routes, import | backend-fastapi | `fastapi-endpoint`, `contrat-openapi`, `regles-vtes`, `tests-backend` | `services/stock.py`, `services/decks.py`, `services/catalog.py`, `services/catalog_import.py`, `services/sync.py`, `routers/stock.py`, `routers/decks.py`, `routers/catalog.py` | B1 |
| C | Client TS régénéré | frontend-react | `contrat-openapi` | `frontend/src/api-client/schema.d.ts` | A1, B1 |
| D | Couche offline | pwa-offline | `pwa-offline`, `react-feature` | `offline/vtes/db.ts`, `operations.ts`, `overlay.ts`, `refresh.ts`, `reads.ts`, `types.ts`, `offline/README.md` | C |
| E | UI collection et decks | frontend-react | `react-feature`, `contrat-openapi`, `tests-frontend` | `features/stock/*`, `features/decks/*`, `features/sync/CorrectionForm.tsx`, `useOperationLabels.ts` | D |
| F | Tests et validation de lot | qa-tests | `tests-backend`, `tests-frontend`, `pwa-offline`, `regles-vtes` | `backend/tests/`, `frontend/tests/` | A2 à E |
| G | Clôture : CLAUDE.md § 6, § 7, § 11, § 12 | orchestrateur | `orchestration`, `ecriture-naturelle` | `CLAUDE.md` | F |

L'orchestrateur pilote l'ensemble (skill `orchestration`) : il délègue chaque
étape, revoit l'intégration entre couches à la fin de A2, de B2 et de E, et
n'écrit pas de code métier.

Parallélisme : une fois B1 livré (contrat figé et exporté), B2 côté back et C
puis D côté front avancent en même temps, puisque le front ne dépend que des
types générés. La QA n'attend pas F pour commencer : elle écrit les tests de
migration dès A1 et B1, et les tests de service au fil de A2 et B2.

### A1 — Proxy au niveau du deck (architecte-contrat)

- `deck.proxy_allowed` booléen, défaut `false` ; `card_copy.proxy_allowed`
  supprimé. Migration sans conversion (D3).
- `DeckCreate`, `DeckUpdate`, `DeckRead` gagnent `proxy_allowed` ;
  `CardCopyRead`, `CardCopyCreate` et `CardCopyUpdate` le perdent (D4).
- Une entrée à 0 exemplaire possédé reste valide : c'est toujours ainsi qu'une
  carte jouée uniquement en proxy entre dans un deck (§ 11, point 2).

### A2 — Règles de proxy (backend-fastapi)

- Refus 409 déplacés : « proxy non autorisé par le deck » à l'ajout ou à la
  modification d'une ligne ; « désactivation du proxy sur un deck qui en
  utilise » au `PATCH` du deck. Le refus « interdiction du proxy sur une entrée
  de stock utilisée » disparaît.
- `/sync` : `deck.create` et `deck.update` transportent le champ ; les motifs
  de refus suivent, sans nouveau code d'erreur.

### B1 — Extension dans le modèle et le contrat (architecte-contrat)

- `card_copy` : `card_set_id` dans la PK, FK composite vers `card_printing`
  (`card_id`, `card_set_id`) en plus de la FK vers `language` (D1, D2).
- `deck_card` : `card_set_id` dans la PK, FK composite vers `card_copy` à trois
  colonnes, index `ix_deck_card_card_id_language_code` étendu à l'extension.
- `deleted_deck_card` : `card_set_id` dans la PK, FK vers `card_set` (pas vers
  `card_copy` : une decklist figée ne réserve rien, comme aujourd'hui).
- Migration en mode batch, sans conversion (D3).
- Contrat : `card_set_id` obligatoire en lecture et en écriture partout où
  figure `language_code` (`CardCopyRead`, `CardCopyCreate`, `DeckCardRead`,
  `DeckCardCreate`, opérations `stock.delete` et `deck_card.delete`) ; chemins
  `/stock/{card_id}/{language_code}/{card_set_id}` et
  `/decks/{id}/cartes/{card_id}/{language_code}/{card_set_id}` ; filtre
  `card_set_id` sur `GET /stock` ; `GET /extensions` (avec le marqueur
  d'extension tampon) et, dans `GET /cartes`, les extensions de chaque carte et
  `latest_card_set_id` (D2a, D5). `BundleDeposit` ne change pas : l'extension
  vient du produit.
- `card_set` gagne son marqueur d'extension tampon (D2b) ; la migration le
  pose à `false` sur les 51 extensions existantes.
- Une entrée hors impression est un refus lisible, pas une erreur d'intégrité :
  le service vérifie l'impression avant d'écrire et rend un 404 (ou
  `not_found` par `/sync`), comme pour une langue inconnue. La FK reste le
  dernier filet.
- `docs/lot3-sync-contrat.md` mis à jour dans la même étape ; export du contrat
  (`backend/scripts/export_openapi.py`), le garde-fou `--check` doit passer.

### B2 — Services et import (backend-fastapi)

- `services/stock.py` : `allocated_real` et `proxies_allocated` par carte ×
  langue × extension ; `deposit_bundle` écrit chaque carte sous
  `bundle.card_set_id`.
- `services/decks.py` : une ligne de deck désigne une entrée précise ; la
  suppression logique recopie l'extension dans `deleted_deck_card`.
- Légalité : les effectifs additionnent les lignes d'une même carte sur toutes
  ses impressions, et `banned_cards` / `not_yet_legal_cards` sont dédoublonnées
  par carte. Les fonctions pures de `vtes_rules.py` ne changent pas ; c'est leur
  appel qui agrège.
- Import krcg : l'upsert doit garder l'identifiant de chaque `card_set` et de
  chaque `card_printing` d'un rejeu à l'autre, puisque le stock les référence
  désormais. Il ne supprime déjà rien (§ 11) ; un test doit le figer.
- Import krcg, extension tampon (D2b, D2c) : création au besoin, rapport
  enrichi, sortie `--json` du script, retrait de l'impression tampon au rejeu
  quand elle n'est plus utile. Le fixture de test gagne une carte sans
  impression, pour exercer le cas qui n'existe pas dans la vraie source.
- Calcul de la dernière version (D2a) : une fonction du service catalogue,
  écrite une fois et exposée par `GET /cartes`.
- Recherche `q` de `/stock` inchangée dans sa normalisation (`fold_text`).

### C, D, E — Côté front

- **C** : `npm run generate:client`, puis correction des erreurs de type qui en
  découlent. Aucun type réécrit à la main.
- **D** (pwa-offline) : version 3 de la base Dexie. Clés composées
  `[cardId+languageCode+cardSetId]` pour `stock`,
  `[deckId+cardId+languageCode+cardSetId]` pour `deckCards` ; nouveau miroir
  `cardSets` ; `CardRow` porte la liste de ses extensions. Les miroirs sont des
  instantanés du serveur : la montée de version les vide et le prochain
  rafraîchissement les recharge. La file (`outbox`) et `settled` ne sont pas
  réécrites (D4). `proxyAllowed` passe de `StockRow` à `DeckRow`. Le cœur
  générique `core/` reste sans dépendance au domaine : rien de ce lot ne doit y
  entrer. Le README du paquet reçoit la note de D4 pour Barrin.
- **E** (frontend-react) : choix de l'extension dans `StockForm` parmi les
  impressions de la carte (présélectionnée quand il n'y en a qu'une, ce qui
  vaut pour un tiers du catalogue) ; ajout en proxy d'une carte non possédée
  sous `latest_card_set_id`, sans question à l'utilisateur (D2a) ; affichage
  de l'extension dans `StockList`
  et `DeckComposition`, choix d'une entrée précise dans `AddDeckCardForm`, case
  « proxies autorisés » à la création et à l'édition d'un deck, libellés
  d'opérations et formulaire de correction mis à jour. Tout passe par
  `useVtesOffline().actions`.

### F — Tests (qa-tests)

Côté back, en plus de l'adaptation des suites existantes :

- migrations A et B montées puis descendues sur base vide ; arrêt explicite sur
  base non vide (D3) ; `foreign_key_check` propre ;
- deux entrées d'une même carte et langue dans deux extensions : stock,
  allocations et refus comptés séparément ;
- entrée refusée dans une extension où la carte n'est pas imprimée, en ligne et
  par `/sync` ;
- versement d'un produit : chaque carte rangée sous l'extension du produit ;
- proxy : ajout refusé sur un deck sans autorisation, désactivation refusée sur
  un deck qui en joue, en ligne et par `/sync` ;
- légalité d'un deck dont une carte bannie figure en deux impressions : un seul
  signalement ;
- import rejoué : identifiants d'extension et d'impression inchangés ;
- dernière version (D2a) : les trois règles, dont les quatre égalités réelles
  (*Ashur Tablets*, *Emerald Legionnaire*, *Carlton Van Wyk*, *The Unmasking*) ;
- extension tampon (D2b, D2c) : carte sans impression importée et signalée,
  rapport `--json`, puis rejeu avec l'impression réelle, tampon retiré si
  inutilisé et gardé si une entrée de stock l'utilise.

Côté front : vitest sur l'overlay et les clés Dexie (deux impressions de la même
carte et langue, montée de version 2 → 3), et un scénario `e2e-real` qui saisit
hors ligne deux impressions de la même carte, les place dans un deck, puis
rejoue.

### Rôle de devops-deploiement

Aucun, sauf si la CI casse : les commandes (`scripts/run.ps1`, `run.sh`) et le
workflow ne changent pas. Si le projet `real-backend` de Playwright monte sa
base éphémère par une commande figée, la QA le signale et devops l'adapte
(skill `ci-cd-deploiement`).

## Risques et points d'attention

**Le mode batch et les clés primaires composites.** Changer la PK de
`card_copy` recrée la table, et `deck_card` la référence. `migrations/env.py`
coupe déjà `PRAGMA foreign_keys` pendant une migration puis vérifie
`foreign_key_check`. Les tables étant vides (D3), le risque de perte du Lot 2
(`deck_card` vidée en cascade) ne se matérialise pas ici, mais l'ordre de
recréation doit rester correct pour les tests de migration.

**Deux révisions de plus qui ne se rejouent pas hors ligne.** Le mode batch
exige une vraie base, comme pour les migrations du Lot 2 passe 2 : `upgrade
head --sql` échouera sur ces révisions. Soit le `xfail` existant couvre la
plage, soit il en faut un nouveau ; à documenter au § 11, pas à découvrir en CI.

**La base de développement.** Elle est encore à `5dc50e3c1701`. Avant les tests
manuels du lot : vérifier `DATABASE_URL`, puis `uv run alembic upgrade head`.

**Les identifiants du catalogue deviennent des références.** Jusqu'ici, rien
hors catalogue ne pointait `card_set` ni `card_printing`. Un import qui
recréerait une extension (renommage d'abréviation chez krcg, par exemple)
casserait des entrées de stock. Le test de rejeu de B2 couvre le cas nominal ;
le renommage côté krcg reste une limite à écrire au § 11.

**La course entre un lot `/sync` et une écriture en ligne** reste ouverte
(§ 11, Lot 3). Le lot ne la ferme pas ; le test `xfail(strict=True)` de
`test_sync_online_race.py` doit seulement être adapté à la nouvelle clé, sans
changer de verdict.

**Le handoff de design** (`docs/design-handoff-mobile/`) ne connaît pas
l'extension : l'écran « Modifier une entrée » n'a que la puce de langue. Le Lot
4 se contente d'un champ fonctionnel dans l'UI actuelle ; le Lot 5 devra
intégrer l'extension au design, et `docs/lot5-plan-design.md` le mentionner.

**Barrin.** Rien de ce lot ne touche `offline/core/` ni `offline/react/`. Si une
modification y paraît nécessaire (montée de version Dexie, par exemple), c'est
qu'elle doit être générique : l'orchestrateur la revoit à ce titre.

## Critère de fin de lot

- `uv run pytest` vert (base de départ : 1488 tests, 2 `xfail`), `uv run ruff
  check .` propre, contrat exporté identique (`--check`) ;
- `npm run lint`, `npm run test`, `npm run test:e2e` verts, y compris les
  scénarios `e2e-real` existants et le nouveau scénario à deux impressions ;
- `uv run alembic upgrade head` passé sur `backend/vtes.db`, puis
  `import_catalog.py` rejoué sans doublon ni changement d'identifiant
  d'extension ou d'impression, et sans aucune carte signalée sous l'extension
  tampon ;
- CLAUDE.md à jour : 24 opérations, nouvelles révisions, D1 à D6 au § 11,
  Lot 4 marqué livré au § 12.
