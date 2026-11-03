# Lot Chercher : recherche dans le catalogue, hors ligne

Statut : A0 close le 2026-11-03 : propositions tranchées ; E0, D1a, D1b et A1
livrées le même jour ; B1, C1a, C1b et E1 ouvrables ; neuf précisions
tranchées après A1 ; mise en service sur `backend/vtes.db` (B1b) sur feu vert
de l'utilisateur seulement.

Rédigé le 2026-11-03 par l'orchestrateur sur la branche `lot-chercher`, à
partir de `fce352f` (Lot 7 livré, plan du lot Inventaires versé), relu le même
jour par architecte-contrat, backend-fastapi, pwa-offline, frontend-react et
qa-tests, puis tranché par l'utilisateur à l'étape A0, toujours le 2026-11-03.
Les revues sont résumées en fin de document ; leurs corrections, leurs mesures
et les décisions de l'utilisateur sont intégrées dans le corps du plan, qui
fait foi. Il reprend le brief du 2026-09-25 (`docs/lot-chercher-brief.md`), les
deux points que le Lot 5c a renvoyés à ce lot (`docs/lot5c-plan-design.md`,
table d'écarts, ligne 8 et ligne sans numéro du champ de recherche global), et
la place que l'utilisateur a donnée au lot le 2026-10-29 : après le Lot 7,
avant le Lot 8 (P9 de `docs/lot7-plan-parties.md`, CLAUDE.md §12, point 9).

Il suit la forme de `docs/lot7-plan-parties.md` et de
`docs/lot-inventaires-plan.md` : les décisions de l'utilisateur (P1 à P15),
les décisions de conception (A1 à A10), le découpage par agent, ce qui a été
livré étape par étape, ce qui peut casser.

Le nom « lot Chercher » ne décale pas la numérotation des Lots 8 à 11.

## Portée

Le lot remplace l'onglet Chercher, désactivé depuis le Lot 5, par un écran qui
parcourt le catalogue entier avec les filtres de VDB, hors ligne comme en
ligne, et qui permet d'ajouter une carte trouvée à un deck, à la collection, ou
aux deux. Il livre ses deux dispositions, mobile et bureau, sans rien laisser à
un lot de symétrie (§11, ouverture du Lot 5bis).

Il apporte :

1. le cœur des filtres de recherche de VDB (P1), avec le sens krcg des
   exigences de discipline, plus la légalité à une date et le statut en
   collection et en deck, qui sont propres à l'outil ;
2. deux données de catalogue nouvelles, importées : la **secte** des cartes de
   crypte, dérivée du texte comme le fait VDB (P13), et les **exigences de
   secte et de titre** des cartes de bibliothèque, lues dans
   `vteslibmeta.csv` du dépôt officiel vtescsv (P15), seconde source à côté
   de krcg ; d'où une migration (douzième révision) et un rejeu de l'import sur
   `backend/vtes.db` ;
3. un miroir local du catalogue enrichi de ce qu'il faut pour filtrer, rangé
   dans un magasin Dexie à part pour ne pas alourdir les lectures existantes ;
4. des fonctions de filtrage locales, testées sur des tables de cas, et une
   règle de légalité d'une carte à une date écrite des deux côtés sur une table
   de cas commune, comme le GW certain au Lot 7 ;
5. la compression des réponses de l'API, qui ramène la lecture complète du
   catalogue enrichi de 3,3 Mo à environ 440 Ko ;
6. l'écran Chercher et sa fiche de carte, en mobile et en bureau ;
7. une feuille d'ajout à trois choix (deck, collection, les deux) qui partage
   sa logique avec l'ajout de ligne du deckbuilder (hook livré à l'étape D1a)
   et l'acquisition du Lot 4b, sans type d'opération `/sync` nouveau ;
8. le retour du champ de recherche global de la barre haute bureau, masqué
   depuis le Lot 5c, et l'image de carte là où le Lot 5c l'a laissée en
   suspens.

Taille du lot. Les décisions de l'A0 l'ont élargi par rapport au plan relu :
une migration, une seconde source d'import, un rejeu sur la base de
développement, et un jeu de filtres plus riche (lignes de texte, paires de
disciplines, votes, lignes de capacité, quatre modes de discipline en
bibliothèque, secte et titre des deux côtés). Il reste un lot sans route
nouvelle, sans type `/sync` nouveau et sans table nouvelle si l'architecte
retient la forme de stockage recommandée (A3). C'est le plus gros lot côté
front depuis le Lot 7, et le premier depuis le Lot 6 à changer l'import.

Pour le pilote, l'intérêt est double : le miroir du catalogue s'alourdit, et sa
montée de version Dexie doit se faire sans laisser un téléphone sans catalogue
au club. Barrin rencontrera les deux.

Ce que le lot ne fait pas. Pas d'inventaires multiples ni de classeurs, pas
d'import de collection ou de deck depuis VDB, pas de suggestion de decklists :
tout cela relève du lot Inventaires et du Lot 9. L'ajout « à la collection »
vise la collection unique d'aujourd'hui, qui deviendra l'inventaire principal
au lot Inventaires (P0 de `docs/lot-inventaires-plan.md`). Pas de statistiques
de deck. Pas de légende des raccourcis `?`. Pas de recherche dans les textes
traduits. Les filtres de VDB laissés hors du cœur (traits, regex libre,
capacité exigée, artiste, précon, « Not in TWD », options d'extension) sont
versés à `docs/pistes-evolution.md`. Aucune règle de légalité de deck ne
change.

## Ce qui a changé depuis le brief

Le brief date du 2026-09-25, avant les Lots 6 et 7. Relu contre le code au
2026-11-03 :

- `GET /cartes`, `GET /cartes/{id}` et `GET /extensions` restent publics
  (Lot 6, P5). Le lot n'ajoute aucune route.
- Le miroir vit dans une base IndexedDB par compte
  (`gurchon-hall-offline-u<id>`, Lot 6) : le catalogue est copié dans la base
  de chaque compte qui ouvre l'application sur un appareil.
- La base Dexie est en version 5 depuis le Lot 7. Le brief parlait d'une
  montée « comme aux versions 3 et 4 », c'est-à-dire en vidant des magasins :
  le plan ajoute au contraire un magasin, sans rien vider.
- Les références client du Lot 7 ne touchent pas ce lot : les ajouts passent
  par `stock.upsert` et `deck_card.upsert`.
- Le brief proposait un filtre de secte, impossible sans import. L'utilisateur
  a fait entrer la secte dans le lot (P13), et avec elle l'exigence de secte et
  de titre des cartes de bibliothèque (P15).
- Les URL d'image par impression existent déjà en base
  (`card_printing.image_url`) et sont servies par `GET /cartes/{id}`.

## État de départ relevé dans le code

### Back

`GET /cartes` (`backend/app/routers/catalog.py`, opération `listCards`) prend
`q` (1 à 80 caractères, sous-chaîne du nom anglais, repliée par
`contains_folded`), `category`, `clan_id`, `limit` (1 à 200, 50 par défaut) et
`offset`. Il rend des `CardListItem` triés par `Card.name`, `group_code`,
`id`, en collation binaire de SQLite (limite connue n° 5 du §11).

`CardListItem` (`backend/app/schemas/catalog.py`) hérite de `CardSummary`
(`id`, `vekn_id`, `name`, `category`, `clan`, `capacity`, `group_code`,
`advanced`, `image_url`) et ajoute `card_set_ids` et `latest_card_set_id`
(Lot 4). `CardRead`, la fiche de `GET /cartes/{id}`, hérite de `CardListItem`
et ajoute `sect`, `title`, `path`, `cost_type`, `cost_value`, `burn_option`,
`trifle`, `clan_requirement`, `path_requirement`, `discipline_requirement`
(`mono`, `choice`, `combo`), `card_text`, `flavor_text`, `artist`,
`banned_on`, `legal_from`, `types`, `discipline_links`, `printings` et
`translations`. `CardSummary` reste la vue courte embarquée dans le stock, les
decks et les produits.

Le service (`backend/app/services/catalog.py`) construit la liste par
`CardListItem(**CardSummary.model_validate(card).model_dump(), …)` : ce chemin
ignore tout champ qui n'est pas dans `CardSummary`. `list_cards` précharge le
clan, les impressions, leurs extensions et leurs occurrences, mais ni les types
ni les disciplines ; `get_card` précharge les deux et remplit `CardRead` par
`getattr` sur chaque champ du schéma. Les relations `Card.types` et
`Card.discipline_links` n'ont pas d'`order_by`. Aucun `GZipMiddleware`.

L'import (`backend/app/services/catalog_import.py`) ne lit que krcg
(`vtes.json`, `expansions.json` ; §11 décision 1, « source unique »). Il
remplit clan, capacité, groupe, *advanced*, titre, coût (en chaîne, 25 cartes
coûtant « X »), prérequis de clan et de voie joints par `", "`, exigence de
discipline, texte, dates, types et disciplines (vertus des *imbued* comprises,
codes `def`, `inn`, `jud`, `mar`, `red`, `ven`, `viz`). La secte n'est pas
importée : la table `sect` est vide et `card.sect_id` nul (point [à
confirmer] du §6). Aucune exigence de secte ou de titre des cartes de
bibliothèque n'est connue : krcg v5 ne l'expose pas.

L'API refuse de démarrer contre une base qui n'est pas à la tête des scripts
(`backend/app/db/schema_check.py`) : dès qu'une douzième révision existe,
`backend/vtes.db` doit être migrée pour que l'application démarre.

Relevé sur une copie de `backend/vtes.db` (révision `e2a7819dd4a2`) par
l'architecte, le back et pwa-offline : 4149 cartes (1785 de crypte, dont 1765
vampires et 20 *imbued*, et 2364 de bibliothèque), 51 extensions, 113
produits, 47 clans dont les 7 credos des *imbued*, aucun nom de clan à
virgule, 39 disciplines, 13 types, aucune secte ; 428 cartes traduites (FR et
ES) ; 435 cartes titrées (13 valeurs : Prince, Primogen, Bishop, Archbishop,
Justicar, Priscus, Cardinal, Baron, Magaji, Inner Circle, Regent, « 1 Vote »,
« 2 Votes ») ; 20 cartes bannies ; `legal_from` renseigné pour les 4149
cartes, au plus tard le 2026-02-28, si bien qu'aucune carte n'est aujourd'hui
« pas encore légale » ; 10 010 impressions, dont 676 sans image ; textes de 168
caractères en moyenne, 0,7 Mo au total ; 1215 textes à icônes de discipline
(`[pot]`, `[POT]`), 52 textes `[MERGED]`. Les 1765 vampires commencent tous
leur texte par l'une des cinq sectes (Camarilla 606, Sabbat 600, Independent
374, Anarch 102, Laibon 83), précédée au besoin de « Advanced, » ; six
*advanced* ont un texte fusionné qui change de secte. Le fixture
`backend/tests/fixtures/krcg_vtes.json` compte dix cartes, pas neuf comme
l'écrit CLAUDE.md (à corriger à l'étape F).

### Front

Le miroir du catalogue est le magasin Dexie `cards`
(`frontend/src/offline/vtes/db.ts`), clé `id`, index `foldedName` et
`category`, rempli par `refreshCatalog` (`refresh.ts`), qui lit `GET /cartes`
par pages de 200 (21 requêtes), puis vide et réécrit le magasin dans une
transaction.

`cards` n'est pas lu que par la recherche : `readProjection` (`reads.ts`),
appelée par presque toute lecture de l'application, fait `db.cards.toArray()`
et n'en tire que le nom et la catégorie. Toute ligne alourdie dans `cards`
serait désérialisée à chaque lecture de projection, sur tous les écrans.

Historique des versions Dexie, avec la multiplication par 10 que Dexie
applique (la version 5 déclarée est la version 50 d'IndexedDB) : la version 3
supprime `stock` et `deckCards` et ajoute `cardSets` ; la version 4 recrée
`stock` et `deckCards` avec l'extension dans leur clé, et vide `cards` et
`decks` dans son `upgrade` ; la version 5 ajoute les quatre magasins de la
pratique (déclarés dans `VTES_STORES_V4`), sans `upgrade`.

Le catalogue ne se relit que sur demande, par `refresh({ catalog: true })` :
`CatalogProvider` le télécharge une fois quand le magasin est vide, et
`CatalogPanel` offre le bouton « Mettre à jour le catalogue ». La relecture du
catalogue est la dernière étape de `runRefresh` (`runtime.ts`), sous un délai
global de 60 s, et toute la séquence est rejouée jusqu'à trois fois si un
verdict de sync tombe pendant la lecture.

La recherche locale est `searchCards` : un parcours de `db.cards.filter(...)`
sur le nom replié et la catégorie. `CardPicker` l'appelle avec `limit: 20` et à
partir de deux lettres. `foldText` reproduit `fold_text` du back à l'identique.

L'onglet Chercher de la tab bar mobile est un `<span aria-disabled="true">`
sans `data-testid` (`App.tsx`, `TabBar`). La barre haute bureau a cinq onglets
(raccourcis `G A/C/D/P/S`) et ne rend plus le champ de recherche global. Chaque
page est chargée en `lazy`, avec une liste de préchauffement. Le routeur à hash
(`frontend/src/app/routes.ts`) ne lit dans la query que le paramètre `action`.

`useKeyboardShortcuts` pose un écouteur `keydown` sur `document` par appel,
sans priorité : deux liaisons de la même touche se déclenchent toutes les deux.
`AddDeckCardForm` lie déjà `/` au champ du picker du deckbuilder bureau ; les
touches simples de page évitent toutes `A`, `C`, `D`, `P` et `S`, prises par
les chords de navigation. Sur la Collection, `F` ouvre la feuille de filtres.

`CardImage` prend une seule URL, en deux tailles (`sm`, `lg`), sans
`crossOrigin`, et se replie sur un pictogramme si l'URL manque, si l'image
échoue ou hors ligne. Il sert au bureau seulement, avec l'image générique.
Aucun `runtimeCaching` dans le service worker, pas de CSP. `static.krcg.org`
répond avec `Access-Control-Allow-Origin: *` (relevé le 2026-11-03).

`AddDeckCardForm` envoyait `quantity: copies`, `copies` repartant de 1, alors
que `deck_card.upsert` remplace la quantité d'une ligne existante : le défaut
présumé à la relecture a été confirmé et corrigé à l'étape D1a (section
« Livraisons »).

### Handoffs de design

Aucun handoff ne dessine l'écran Chercher. `MOBILE.md` ne décrit que l'onglet ;
`DESKTOP.md` décrit le champ de la barre haute (280 × 34, kbd `/`), les deux
formes d'URL d'image krcg, et une CSP `img-src` sans objet tant qu'aucune CSP
n'existe (à reprendre au Lot 11).

### VDB et vtescsv

Les filtres de VDB ont été relevés le 2026-11-03 dans son code source
(`smeea/vdb`, branche `master`, commit `99520ec991fac52c57cb629b0585d796aecb27ee`,
`frontend/src/utils/cardFilters.js` et `components/search_forms/`). VDB filtre
entièrement côté client, sur des fichiers générés depuis les CSV de vtescsv.
Les tableaux utiles du relevé sont recopiés dans `docs/pistes-evolution.md`
(entrée « Filtres de VDB non repris par le lot Chercher ») ; le cœur retenu
est décrit en P1.

`vteslibmeta.csv` est publié dans le dépôt officiel vtescsv de GiottoVerducci,
source des textes de cartes :
`https://raw.githubusercontent.com/GiottoVerducci/vtescsv/main/vteslibmeta.csv`,
en-tête `"Id","Name","Requirement"`, environ 380 lignes, `Id` = identifiant
VEKN, donc notre `card.vekn_id`. Valeurs relevées : `sabbat`, `anarch`,
`laibon`, `imbued`, `justicar,inner circle`, `prince,justicar`,
`non-anarch,titled`, `non-sterile`, `1 Gehenna`, `2 Gehenna`,
`capacity 7 or …`. Le dépôt ne déclare aucune licence ; krcg (MIT) dérive
lui-même de vtescsv.

### Tests et chiffres de départ

2276 tests pytest et 2 `xfail`, 752 tests vitest sur 49 fichiers, 59 tests
Playwright en 28 fichiers (8 `chromium`, 30 `real-backend`, 3 `desktop`, 18
`desktop-real-backend`), références CRAP vides des deux côtés. Tests voisins à
étendre plutôt qu'à recréer : `frontend/tests/e2e-real/search-parity.spec.ts`,
`frontend/tests/unit/offline/vtesDbV5.test.ts`, `vtesReads.test.ts`,
`offline-db-schema.spec.ts`, `vtesLegacyAdoption.test.ts`. Après E0 et D1a,
vitest compte 766 tests sur 51 fichiers (section « Livraisons »).

## Décisions de l'utilisateur

Tranchées le 2026-11-03 à l'étape A0. P1, P13 et P15 ont été décidées par
l'utilisateur au-delà des recommandations ; P2 à P12 et P14 adoptent les
recommandations du plan relu.

| # | Sujet | Décision |
| --- | --- | --- |
| P1 | Filtres | le cœur des filtres de VDB, avec le sens krcg pour les modes ET et SEULEMENT des disciplines de bibliothèque ; légalité et statut en plus ; le reste de VDB en pistes |
| P2 | Noms traduits | oui, noms FR et ES seulement |
| P3 | Texte de carte | oui, texte anglais, par les lignes de texte de P1 |
| P4 | Statut | « possédée » et « dans ce deck » à trois états |
| P5 | Filtres côté serveur | non |
| P6 | Handoff de design | oui, court, pour Chercher seulement |
| P7 | Images | en ligne seulement ; image par impression lue à la demande |
| P8 | Champ global bureau | rétabli, il ouvre Chercher ; pas de sixième onglet |
| P9 | Tri | nom replié par défaut, tris secondaires par catégorie |
| P10 | « Les deux » | achat déclaré, quantité totale, proxies remplacés d'abord |
| P11 | Mise à jour du catalogue | relecture automatique une fois, quand les détails manquent |
| P12 | Chercher depuis un deck | oui, deck cible présélectionné |
| P13 | Secte | dans ce lot, dérivée du texte à l'import comme le fait VDB |
| P14 | Stockage persistant | oui, un appel à `navigator.storage.persist()` au démarrage |
| P15 | `vteslibmeta.csv` | intégré à l'import comme seconde source, exigences de secte et de titre filtrables |

### Précisions tranchées le 2026-11-03 (après A1)

Après la livraison d'A1 et de D1b, l'utilisateur a tranché neuf points que le
plan ou les livraisons laissaient ouverts ou présentaient comme des choix de
l'orchestrateur à confirmer. Ils sont reportés dans les sections concernées.

| # | Point | Décision |
| --- | --- | --- |
| 1 | Bishop | implique le Sabbat, contre VDB (P15) |
| 2 | « non-anarch » | toute secte sauf Anarch : une secte est nécessaire, la carte ne répond ni à « non requise » ni à Anarch, et répond aux autres sectes ; forme au choix de l'architecte (P1, P15) |
| 3 | Black Hand et Seraph | traits du Sabbat restés dans les autres valeurs, sans impliquer le Sabbat ; traitement versé aux pistes (P15) |
| 4 | Mode SEULEMENT des disciplines de bibliothèque | « jouable avec les seules disciplines cochées », validé (P1) |
| 5 | Champ principal de Chercher et champ global | nom (FR et ES compris) et texte anglais, comme VDB, contre la recommandation « nom seul » (P1, P3, P8, P9) |
| 6 | Cartes de groupe « Any » | affichées avec tout groupe coché, validé (P1) |
| 7 | *Advanced* fusionné qui change de secte | secte de sa face, validé (P1, P13) |
| 8 | Lien provisoire vers Chercher dans la barre haute | aucun avant D3 (P8) |
| 9 | Mise en service sur `backend/vtes.db` | B1 s'arrête avant ; migration et réimport de la vraie base sur feu vert explicite de l'utilisateur, en B1b (découpage, risques) |

### P1. Les filtres de VDB — tranchée le 2026-11-03

Décision : « les filtres suivent ceux de VDB », dans leur cœur, avec trois
arbitrages de l'utilisateur. Le relevé de VDB est résumé dans l'état de départ
et recopié dans les pistes. Entre filtres différents, tout se combine en ET,
comme chez VDB. Les modes de combinaison d'un filtre suivent le bouton de VDB :
OU, ET, NON (aucune des valeurs), SEULEMENT, selon ce que chaque filtre
expose.

Communs :

- Texte, en lignes multiples. Chaque ligne porte un champ (nom et texte, nom
  seul, texte seul) et un mode, ET (doit correspondre) ou NON (ne doit pas) ;
  les lignes se combinent en ET. Le champ principal de l'écran, et celui de la
  barre haute, cherchent dans le nom (noms FR et ES compris, P2) et dans le
  texte anglais, comme VDB : tranché le 2026-11-03 (après A1) par
  l'utilisateur, contre la recommandation « nom seul » de l'orchestrateur. Les
  lignes ajoutées sont « nom et texte » par défaut, et chacune peut se
  restreindre au nom seul ou au texte seul. Tout passe par `foldText`, si bien
  que la recherche n'est sensible ni à la casse ni aux accents, nom comme
  texte (VDB est sensible aux accents sur le texte : défaut non repris).
- Conséquences du champ principal sur nom et texte. Pertinence : « bleed »
  ramène quelques cartes par leur nom et des centaines par leur texte.
  Proposition, à valider en D1c : sous le tri par défaut, les cartes dont le
  nom correspond (nom, variantes, noms traduits) passent devant celles qui ne
  correspondent que par le texte, chaque groupe gardant ensuite le tri de P9 ;
  un tri explicite choisi par l'utilisateur (capacité, coût) ignore ce
  regroupement. Le compteur de résultats peut distinguer les deux groupes.
  Performance : le texte replié est déjà en mémoire (lecture mémoire de la
  couche offline) et une passe sur nom et texte des 4149 cartes a été mesurée à
  environ 1 ms par pwa-offline ; le coût reste celui du rendu, traité par
  l'affichage par tranches. Le champ principal ne se désactive donc pas sur un
  miroir incomplet pour le nom, mais il n'y cherche que le nom tant que le
  texte manque, et l'écran le dit.
- Variantes de nom retenues : le nom sans ponctuation (« 44 magnum » trouve
  « .44 Magnum », « jacks » trouve un nom à apostrophe) ; les initiales, pour
  une saisie de deux à cinq lettres sans espace, comparée aux initiales des
  mots du nom (« tb » trouve « Theo Bell »), en plus de la sous-chaîne ; les
  noms traduits (P2). La variante « The X » trouve « X, The » de VDB tient à la
  forme des noms de vtescsv ; elle n'est reprise que si le catalogue krcg
  contient des noms en « X, The », ce que C1b vérifie (sinon la sous-chaîne
  suffit). Non retenues : le nom ASCII de VDB (`unidecode`), que `foldText`
  couvre pour toute lettre qui se décompose, les autres (« œ », « ł ») restant
  la limite connue du §11 ; les alias `aka` (krcg `name_variants`, non
  importés), versés aux pistes.
- Regex libre : versée aux pistes. Si elle entre un jour, une expression
  invalide ne correspond à rien et le dit, au lieu de tout faire correspondre
  comme chez VDB.
- Catégorie : toutes, crypte, bibliothèque.
- Extension : plusieurs, en OU (carte imprimée dans l'une des extensions).
  Les options de VDB pour une extension seule (Or Newer, Or Older, Not Newer,
  Not Older), les modes Only In, First Print et Reprint, et « ANY BCP » sont
  versés aux pistes : rien dans l'usage ne les demande aujourd'hui, et First
  Print et Reprint supposent une chronologie des impressions par carte que le
  miroir n'a pas. Or Newer serait bon marché (les dates d'extension sont dans
  `cardSets`) ; il attendra un besoin.
- Légalité, hors VDB : légale, bannie, pas encore légale, à la date du jour
  (A5). VDB n'a que « Banned », en positif.
- Statut, hors VDB : « possédée » et « dans ce deck », à trois états (P4).

Crypte :

- Disciplines : la grille des disciplines, un clic passant de rien à
  inférieure, à supérieure, puis à rien. ET entre disciplines ; inférieure se
  lit « au moins inférieure », supérieure « supérieure seulement ».
- Paires « OU » : des groupes d'exactement deux disciplines, chacune à un
  niveau ; OU dans un groupe, ET entre groupes et avec la grille.
- Vertus des *imbued* : les sept vertus, en ET, avec la même grille (elles sont
  des disciplines dans notre table).
- Clan : plusieurs, en OU, ET ou NON, comparé au clan et à la voie de la carte
  (ET n'a de sens qu'entre un clan et une voie). Les credos des *imbued* et les
  quatre voies sont proposés, comme chez VDB.
- Secte (P13) : Camarilla, Sabbat, Laibon, Independent, Anarch, Imbued, en OU
  ou NON.
- Groupe : plusieurs, en OU. Écart à VDB, tranché le 2026-11-03 (après A1) :
  VDB écarte les deux cartes de groupe « Any » dès qu'un groupe est coché ;
  elles restent ici affichées avec tout groupe coché, comme dans la légalité
  d'un deck (§5), où elles sont neutres, parce qu'elles vont dans toute
  crypte.
- Capacité : des lignes `≤`, `=` ou `≥` suivies d'une valeur de 1 à 11, en OU
  ou NON (une plage 4 à 7 s'écrit NON [`≤ 3`, `≥ 8`], comme chez VDB). Les
  *imbued* y rangent leur vie, ce que l'aide dit.
- Titre : Primogen, Prince, Justicar, Inner Circle, Baron, 1 vote, 2 votes,
  Bishop, Archbishop, Priscus, Cardinal, Regent, Magaji, Non titré, en OU.
- Votes : indifférent, aucun, 1 et plus, 2 et plus, 3 et plus, 4 et plus,
  selon le barème de VDB : primogen 1, prince 2, justicar 3, imperator 3,
  inner circle 4, bishop 1, archbishop 2, priscus 3, cardinal 3, regent 4,
  1 vote 1, 2 votes 2, magaji 2, kholo 2, baron 2.

Le titre et la secte d'un *advanced* sont ceux de sa face (premier mot du
texte, titre krcg), pas ceux de son texte fusionné (tranché le 2026-11-03,
après A1) ; VDB fait de même pour la secte, mais fait aussi correspondre un titre nommé après `[MERGED]`. Ce
rattrapage des titres fusionnés est versé aux pistes ; les six cas de secte
fusionnée sont listés dans la table de cas de la dérivation (P13), avec leur
valeur attendue.

Bibliothèque :

- Type : plusieurs, en OU, ET ou NON ; une carte à plusieurs types répond à
  chacun. Valeurs : les types présents au catalogue, plus « Reflex », que VDB
  définit comme « le texte contient `[REFLEX]` ».
- Disciplines : premier arbitrage, ci-dessous.
- Clan requis : plusieurs, en OU ou NON, plus « non requis » (ni clan ni
  voie exigés). Le prérequis à deux clans est découpé avant comparaison.
- Secte requise (P15) : Camarilla, Sabbat, Laibon, Independent, Anarch,
  Imbued, en OU ou NON, plus « non requise ». Un titre exigé implique sa secte
  (une carte qui exige un Prince exige un vampire Camarilla ; un Bishop, un
  vampire Sabbat, contre VDB qui le range dans la Camarilla, tranché le
  2026-11-03 après A1). Une exigence « non-anarch » se lit « toute secte sauf
  Anarch » (tranché le 2026-11-03, après A1) : une secte est nécessaire, si
  bien que la carte ne répond ni à « non requise » ni à Anarch, et répond à
  chacune des autres sectes de vampire. La forme revient à l'architecte ; à
  l'avis de l'orchestrateur, les sectes exigées valent alors les sectes de
  vampire sauf Anarch. Black Hand et Seraph, traits du Sabbat, restent dans les
  autres valeurs sans impliquer le Sabbat ; leur traitement est versé aux
  pistes.
- Titre requis (P15) : n'importe quel titre (exigence `titled`), non titré
  (`non-titled`), ou un titre précis, en OU ou NON. L'option « Titled
  (specific) » de VDB, dont le sens n'est pas confirmé par le relevé, n'est
  reprise que si A1 l'établit dans `generate_library.py`.
- Coût en sang et coût en pool : une ligne chacun, `≤`, `=` ou `≥` suivi d'une
  valeur (0 à 4 pour le sang, 0 à 6 pour le pool) ; un coût absent vaut 0, un
  coût « X » passe toujours, comme chez VDB. Le coût en conviction n'est pas
  filtrable (VDB non plus ; six cartes).

#### Disciplines de bibliothèque : l'interface de VDB, le sens de krcg

Premier arbitrage de l'utilisateur. L'interface est celle de VDB : des lignes
de disciplines (disciplines, Flight, Maleficia, Striga et vertus), un bouton à
quatre modes, OU, ET, NON, SEULEMENT, et une valeur « non requise ». Le sens
diffère : VDB compare des sous-chaînes de la chaîne d'exigence
(`Dominate/Obfuscate/Vicissitude`), si bien que son ET rend *The World's a
Canvas*, carte au choix, pour Dominate ET Obfuscate. Ici ET et SEULEMENT lisent
l'exigence krcg, `mono`, `choice` ou `combo`, avec l'ensemble *D* de ses
disciplines.

Soit *S* l'ensemble des disciplines cochées. Une carte sans exigence de
discipline n'a pas de *D*.

| Mode | `mono` (*D* = {d}) | `choice` (l'une de *D*) | `combo` (toutes celles de *D*) | sans exigence |
| --- | --- | --- | --- | --- |
| OU : mentionne l'une des cochées | d ∈ *S* | *D* ∩ *S* non vide | *D* ∩ *S* non vide | non |
| ET : exige chacune des cochées | *S* = {d} | jamais, sauf *S* et *D* réduits à la même discipline | *S* ⊆ *D* | non |
| NON : ne mentionne aucune des cochées | d ∉ *S* | *D* ∩ *S* vide | *D* ∩ *S* vide | oui |
| SEULEMENT : jouable avec les seules cochées | d ∈ *S* | *D* ∩ *S* non vide | *D* ⊆ *S* | non |
| non requise | non | non | non | oui |

OU et NON gardent le sens de VDB (mention). ET se lit « la carte ne peut pas
se jouer sans chacune des disciplines cochées » : une carte au choix n'exige
aucune discipline en particulier. SEULEMENT se lit « un vampire qui n'a que les
disciplines cochées peut jouer la carte » (« jouable avec les seules
disciplines cochées », sens validé par l'utilisateur le 2026-11-03, après
A1) : c'est la question de qui construit une bibliothèque pour sa crypte. VDB, lui, lit SEULEMENT comme « la chaîne
mentionne exactement les cochées », et rend 34 cartes pour Dominate seul, là où
ce plan rend les `mono` Dominate et les cartes au choix qui proposent
Dominate.

Exemple gravé dans la table de cas de `filterCards`, *S* = {Dominate,
Obfuscate} :

- OU : les `mono` Dominate et Obfuscate, et toute carte au choix ou combinée
  qui mentionne l'une des deux, *The World's a Canvas* comprise ;
- ET : les seules cartes combinées qui exigent Dominate et Obfuscate (leur
  nombre est relevé en A1 ; il peut être nul). *The World's a Canvas*
  (`choice` Dominate, Obfuscate, Vicissitude) n'y est pas, alors que VDB la
  rend ;
- NON : toute carte qui ne mentionne ni l'une ni l'autre, cartes sans
  discipline comprises ;
- SEULEMENT : les `mono` Dominate et Obfuscate, les cartes au choix qui
  proposent l'une des deux (*The World's a Canvas* comprise, jouable avec
  Dominate), et les combinées dont toutes les disciplines sont parmi les deux ;
- non requise : les cartes sans exigence de discipline.

Le niveau n'a pas de sens en bibliothèque (aucun lien supérieur sur 1218).

#### Défauts de VDB non repris

Une regex invalide qui fait tout correspondre ; la recherche dans le texte
sensible aux accents ; l'exclusion des cartes de groupe « Any ».

### P2. Noms traduits — tranchée le 2026-11-03

Décision : oui, les noms FR et ES seulement, pas les textes. Coût mesuré :
130 Ko bruts, 14 Ko compressés, une requête SQL de plus par page. La recherche
locale trouvera « Majesté » quand `GET /cartes?q=majeste` ne trouvera rien,
`q` restant limité au nom anglais (P5) ; c'est écrit dans la description de
`listCards` et le sera au §11.

### P3. Recherche dans le texte — tranchée le 2026-11-03

Décision : oui, sur le texte anglais, dans le champ principal (nom et texte,
tranché le 2026-11-03 après A1) et dans les lignes de texte de P1. Limite à
écrire dans l'aide : les icônes de discipline du texte (`[pot]`, `[POT]`) se
replient de la même façon, et un mot court comme « pre » trouve toutes les
cartes à icône Presence.

### P4. Statut — tranchée le 2026-11-03

Décision : « possédée » à trois états (possédée, non possédée, indifférent),
une carte comptant comme possédée dès qu'une de ses entrées a au moins un
exemplaire ; « deck » à trois états (indifférent, dans ce deck, pas dans ce
deck), un deck vivant à la fois. Les deux lisent la projection locale.
« Disponible » est laissé au lot Inventaires.

### P5. Filtres côté serveur — tranchée le 2026-11-03

Décision : non. Sans eux, les règles écrites deux fois se limitent à la
légalité d'une carte (A5) ; la secte et les exigences sont calculées une seule
fois, côté serveur, à l'import ou à la lecture (A3), et le client ne fait que
les comparer. `GET /cartes` garde `q`, `category` et `clan_id`, et
`search-parity.spec.ts` vérifie que le miroir et l'API rendent les mêmes
identifiants pour ces deux filtres.

### P6. Handoff de design — tranchée le 2026-11-03

Décision : oui, un handoff court limité à l'écran Chercher. Le brief à Claude
Design (D0) demandera : la ligne de résultat et sa vignette, l'affichage par
tranches, la colonne de filtres au bureau et la feuille de filtres en mobile
(dense : lignes de texte, grille de disciplines à trois états, paires OU,
boutons de mode), l'état « catalogue à mettre à jour », la fiche de carte, la
feuille d'ajout en contrôle segmenté, la taille de l'image du picker mobile, la
place de « Ajouter… » quand le clavier est ouvert, et le libellé du champ
global.

### P7. Images — tranchée le 2026-11-03

Décision : en ligne seulement, pas de précache ni de cache (4149 images, plus
de 200 Mo). Un cache à l'exécution exigerait `crossOrigin="anonymous"` sur
l'image, faute de quoi la réponse serait opaque et comptée très au-delà de sa
taille dans le quota ; il reste une piste. L'image de l'impression sert quand on
parle d'un exemplaire, l'image générique sinon. L'image par impression se lit
à la demande, en ligne, par `GET /cartes/{id}`, gardée en mémoire par carte
pour la session ; `CardImage` retombe sur l'image générique (676 impressions
sans image) avant le pictogramme, et gagne une taille pour le picker mobile.

### P8. Champ global bureau — tranchée le 2026-11-03

Décision : le champ revient dans la barre haute, libellé « Chercher une carte
(catalogue) ». Valider ouvre Chercher avec le texte dans le champ principal,
qui cherche dans le nom et le texte (tranché le 2026-11-03, après A1) ; sur
Chercher, il écrit dans le champ de la page. `/` le focalise depuis tout
écran, la Collection comprise, sauf le deckbuilder. Pas de sixième onglet ni de
chord. Pas de lien provisoire vers Chercher dans la barre haute avant D3
(tranché le 2026-11-03, après A1) : jusque-là, le bureau n'atteint Chercher
que par l'adresse `#/chercher`.

### P9. Tri — tranchée le 2026-11-03

Décision : nom replié, puis groupe et identifiant, par défaut ; capacité et
groupe pour la crypte, coût pour la bibliothèque (valeur croissante, « X »
après les nombres, sans coût en dernier). Tri local, écart d'ordre avec la
Collection accepté. Proposition à valider en D1c, née du champ principal sur
nom et texte : sous le tri par défaut, les correspondances par le nom passent
devant celles par le texte seul (P1).

### P10. « Les deux » — tranchée le 2026-11-03

Décision, pour *n* exemplaires saisis, les quantités étant des états et non des
deltas :

- Deck : la logique du deckbuilder, partagée par `useAddDeckCard` (D1a) ; la
  quantité envoyée est celle de la ligne après ajout ;
- Collection : un `stock.upsert` à la quantité de la projection plus *n* ;
- Les deux : un achat déclaré, une seule opération `deck_card.upsert` avec
  `acquired_quantity = n`. Si la ligne joue déjà la carte en proxy, les *n*
  exemplaires remplacent d'abord des proxies, puis s'ajoutent au-delà ; l'écran
  le dit avant l'envoi.

### P11. Mise à jour du catalogue — tranchée le 2026-11-03

Décision : une relecture automatique, une fois, quand le magasin des détails est
vide ou incomplet et qu'on est en ligne ; sinon le bouton actuel. L'`ETag` est
versé aux pistes.

### P12. Chercher depuis un deck — tranchée le 2026-11-03

Décision : un lien « Chercher une carte pour ce deck » dans le détail d'un deck
non archivé ouvre Chercher avec ce deck comme cible et le filtre deck sur « pas
dans ce deck » ; la cible voyage dans le hash (`#/chercher?deck=<clé>`),
validée par la forme de clé d'un deck, une clé inconnue étant ignorée.

### P13. Secte des cartes de crypte — tranchée le 2026-11-03

Décision : dans ce lot. La secte est dérivée du texte à l'import, comme le fait
VDB : le premier mot du texte, ou le second quand le premier est « Advanced » ;
une carte *imbued* reçoit la secte « Imbued ». La dérivation est une fonction
pure côté serveur (skill `regles-vtes`), testée sur une table de cas, et l'import
remplit la table `sect` et `card.sect_id`, qui existent déjà : pas de migration
pour la secte de crypte. Une carte dont le premier mot n'est pas une secte
connue est signalée dans le rapport d'import, sans faire échouer l'import.

Les six vampires *advanced* dont le texte fusionné change de secte gardent la
secte de leur face (premier mot), comme chez VDB ; ils figurent nommément dans
la table de cas avec cette valeur attendue, pour que le comportement soit fixé
et non subi. Le point [à confirmer] du §6 sur la secte est levé à l'étape F.

### P14. Stockage persistant — tranchée le 2026-11-03

Décision : un appel à `navigator.storage.persist()` au démarrage (étape C1a),
sans écran, résultat noté dans le README de la couche offline et vérifié à la
main à l'étape F. Le comportement varie selon les navigateurs (Chrome accorde
selon l'usage, dont l'installation ; Firefox peut demander à l'utilisateur),
point [à vérifier] en C1a.

### P15. Exigences de secte et de titre des cartes de bibliothèque — tranchée le 2026-11-03

Troisième arbitrage de l'utilisateur. krcg v5 n'expose pas ce qu'une carte de
bibliothèque exige du vampire qui la joue ; VDB le lit dans `vteslibmeta.csv`,
publié dans le dépôt officiel vtescsv, source des textes de cartes. Décision :
ce fichier entre à l'import comme seconde source, à côté de krcg.

Conséquences :

- la décision §11.1 « krcg, source unique » est amendée ; l'amendement est
  consigné au §11 à l'étape F ;
- URL figée (branche `main` du dépôt, comme `v5` pour krcg), fichier
  d'échantillon dans les fixtures de test, import rejouable ;
- jointure par identifiant VEKN ; un `Id` inconnu de krcg, une carte de
  crypte, ou un nom qui ne correspond pas sont signalés dans le rapport
  d'import, sans échec ;
- le stockage de l'exigence demande une migration (A3), dont la forme revient à
  l'architecte ;
- la lecture de l'exigence suit les règles de VDB : un titre exigé implique sa
  secte (prince, primogen, justicar, inner circle, imperator ⇒ camarilla ;
  bishop, archbishop, priscus, cardinal, regent ⇒ sabbat ; baron ⇒ anarch ;
  magaji, kholo ⇒ laibon ; 1 vote, 2 votes ⇒ independent ; vérifié en A1, cf.
  « Livré à l'étape A1 ») ; une carte sans exigence de secte répond à « non
  requise » ;
- écart à VDB, tranché le 2026-11-03 (après A1) : bishop implique le Sabbat,
  là où VDB le range dans la Camarilla ;
- « non-anarch » se lit « toute secte sauf Anarch », tranché le 2026-11-03
  (après A1) : une secte est nécessaire, la carte ne répond ni à « non
  requise » ni à Anarch, et répond à chacune des autres sectes. La forme
  revient à l'architecte (à l'avis de l'orchestrateur, sectes exigées = sectes
  de vampire sauf Anarch) ;
- les valeurs qui ne sont ni une secte ni un titre (`non-sterile`, `Gehenna`,
  `capacity …`, `black hand`, `seraph`, `red list`…) sont stockées brutes et
  non filtrées dans ce lot ; leur filtrage est versé aux pistes. Black Hand et
  Seraph, traits du Sabbat, restent dans ces autres valeurs sans impliquer le
  Sabbat (tranché le 2026-11-03, après A1, traitement reporté).

Le dépôt vtescsv ne déclare aucune licence : point noté, à porter au §11 avec
l'amendement. krcg, sous licence MIT, en dérive déjà.

## Décisions de conception

Proposées par l'orchestrateur, revues par l'architecte et le back, ajustées
après l'A0. Elles peuvent être rouvertes à la demande de l'utilisateur.

### A1. Enrichir `CardListItem`

On remonte de `CardRead` vers `CardListItem` : `sect`, `title`, `path`,
`path_requirement`, `cost_type`, `cost_value`, `clan_requirement`,
`discipline_requirement`, `card_text`, `banned_on`, `legal_from`, `types`,
`discipline_links`, et l'on y ajoute l'exigence de bibliothèque de P15 (forme
au choix de l'architecte, A3). Restent propres à la fiche : `burn_option`,
`trifle`, `flavor_text`, `artist`, `printings`, `translations`. `CardSummary`
ne change pas.

`CardRead` garde le même ensemble de propriétés, de types et d'obligations, à
l'exigence de bibliothèque près, qu'elle gagne par héritage ; l'ordre de ses
propriétés change (Pydantic range les champs hérités en premier), dans le
contrat exporté comme dans la réponse. Le test compare les ensembles, le schéma
de chaque propriété, et un instantané JSON d'une fiche par contenu.

`list_cards` reprend le patron de `get_card` (validation depuis l'objet, plus
les champs calculés), précharge `types`, `discipline_links` et `sect` (sans
quoi une page coûte 401 requêtes au lieu de 5 ou 6), et trie les types par nom
et les disciplines par abréviation. `clan_requirement` reste une chaîne jointe
par `", "`, découpée par le client. `discipline_links` garde sa forme
d'objets : la compression d'A2 rend l'écart avec une liste de codes
négligeable. Ajout pur au contrat, champs nouveaux obligatoires en sortie (§7).

### A2. Compression des réponses, pagination inchangée

Mesures du back et de l'architecte sur une copie de `vtes.db`, lecture complète
en 21 pages de 200 :

| Forme | JSON | Compressé | Requêtes par page | Durée côté serveur |
| --- | --- | --- | --- | --- |
| actuelle | 1,08 Mo | 132 Ko | 3 à 4 | 1,2 à 1,4 s |
| enrichie (A1 avant l'A0) | 3,28 Mo | 440 Ko | 5 à 6 | 1,6 à 2,0 s |
| enrichie, noms traduits (A7) | 3,41 Mo | 454 Ko | 6 à 7 | 1,7 à 1,9 s |

La secte et les exigences de P15 ajoutent peu (une secte par carte de crypte,
environ 380 exigences) ; B1 refait la mesure. La compression est une livraison
de B1 : `GZipMiddleware`, seuil de l'ordre de 1000 octets, sur toute
l'application, en vérifiant qu'elle ne retire ni l'exposition CORS de
`Retry-After` ni `Cache-Control: private, no-store`. Aucun corps ne porte de
secret (§7), d'où l'absence de risque de type BREACH. `limit` reste à 200.

### A3. Une migration, pour l'exigence de bibliothèque

La première version de ce plan n'avait aucune migration. P15 en demande une :
l'exigence d'une carte de bibliothèque n'a pas de place dans le schéma. La
secte de crypte, elle, entre dans `sect` et `card.sect_id`, qui existent.

Question posée à l'architecte pour l'étape A1, avec trois options :

1. une colonne texte nullable `card.library_requirement`, recopie brute de
   `vteslibmeta.csv` (`"prince,justicar"`), lue par le client. Migration
   minimale ; mais la règle « un titre implique sa secte » s'écrirait dans le
   client seul, sans test pytest ni table commune ;
2. la colonne brute, plus deux tables de liaison (`card_required_sect`,
   `card_required_title`) remplies par l'import. Requêtes et contraintes
   possibles côté base ; mais deux tables de plus (27), une migration plus
   lourde, et des préchargements de plus dans `list_cards`, pour des filtres
   qui ne tournent que dans le client (P5) ;
3. recommandée : la colonne brute seule en base, et une fonction pure côté
   serveur (`vtes_rules.py`) qui la lit en trois listes exposées au contrat
   (sectes exigées, titres exigés, autres valeurs), sur le modèle de
   `latest_card_set_id`, calculé une fois par le serveur pour ne pas ouvrir
   d'écart entre en ligne et hors ligne. La règle s'écrit une fois, se teste
   en pytest sur une table de cas, et le client compare des listes. Une
   colonne, aucune table : le modèle reste à 25 tables.

Dans les trois cas : douzième révision, nullable, sans conversion de données
(l'import la remplit au rejeu), sur la forme des révisions récentes (hors mode
batch, montée rendue hors ligne par `--sql`) ; descente sans garde, ou qui
vide la colonne, au choix de l'architecte. L'import change : dérivation de la
secte (P13), lecture de `vteslibmeta.csv` (P15), rapport enrichi. Le rejeu sur
`backend/vtes.db` est fait en B1 (section « Découpage »).

### A4. Le repli du texte se fait côté client

Le client replie texte, noms traduits et variantes de nom avec `foldText`, dont
la parité avec Python est garantie par les tables générées. Stocker le texte
replié ou le recalculer au chargement se décide en C1b sur une mesure ; par
défaut, on le stocke.

### A5. Légalité d'une carte à une date : deux booléens, deux écritures

`card_legality(banned_on, legal_from, on)` rend deux booléens, `banned`
(à partir de `banned_on`, jour inclus) et `not_yet_legal` (`legal_from`
strictement postérieure à `on`), qui ne s'excluent pas ; la carte est légale
quand aucun n'est vrai. *Playing for Keeps*, bannie le 1995-11-01 et légale à
partir du 1996-01-14, est les deux à la fois entre ces dates. `banned_cards`,
`not_yet_legal_cards` et `/legalite` ne changent pas de sortie. Dans Chercher,
chaque option du filtre lit son propre booléen, et la ligne de résultat
affiche « bannie » de préférence.

La jumelle TypeScript, dans `vtes/`, compare des chaînes ISO `YYYY-MM-DD`,
jamais des `Date`. Les deux fonctions prennent la date en paramètre ; seul
l'appelant lit l'horloge (`todayUtc()`), à la date UTC comme `_today()` côté
serveur, ce que l'aide du filtre explique.

Table commune `backend/tests/fixtures/card_legality_cases.json`, avec un champ
`description` et des attendus `{banned, not_yet_legal}` : veille, jour et
lendemain de chaque date ; dates absentes ; `banned_on` seule ; `legal_from`
seule ; `banned_on` avant, égale et après `legal_from` ; *Playing for Keeps*.
Chaque test vérifie que la table contient au moins un cas par combinaison de
résultats. Aucune carte n'étant « pas encore légale » dans la base, les tests
de bout en bout passent par des cartes synthétiques ou une date injectée.

### A6. Les filtres sont des fonctions pures du client

`filterCards(cards, criteria, context)` dans `vtes/`, où `cards` est le
tableau déjà joint des deux magasins et `context` porte ce qui ne vient pas du
catalogue (cartes possédées, lignes du deck choisi, date d'évaluation). Une
fonction par filtre de P1, composées par une fonction courte, sans `switch`
sur les clés (que l'analyseur CRAP compterait par `case`). Les filtres à
modes sont eux-mêmes écrits en petites fonctions : les quatre modes et « non
requise » des disciplines de bibliothèque (tableau de P1), les lignes de
texte, les paires OU de la crypte, les lignes de capacité, le barème des
votes. Les sectes et titres exigés arrivent déjà lus par le serveur (A3,
option 3) : le client ne réécrit pas la règle « un titre implique sa secte ».
Les ensembles précalculés vivent dans un objet distinct, construit et invalidé
avec la lecture mémoire.

### A7. Noms traduits

La route de liste rend une classe fille de `CardListItem`, propre à elle (nom
au choix de l'architecte), qui ajoute `translated_names`, liste de
`{language_code, name}` ; `CardRead` n'en hérite pas. Le contrat gagne deux
schémas. Codes de langue en majuscules.

### A8. Images par impression hors du contrat de liste

`GET /cartes/{id}` sert déjà `printings[].image_url` : aucune évolution de
contrat pour les images. Reconstruire une URL d'impression depuis l'URL
générique est écarté (convention d'un tiers).

### A9. `/sync` inchangé

Aucun type d'opération, genre de référence ou colonne de journal nouveau. Les
quantités sont des états (P10).

### A10. Contrat : ce qui bouge, ce qui ne bouge pas

49 opérations sur 29 chemins, `API_ROUTE_PREFIXES` inchangés. `CardListItem`
s'enrichit (A1, A3), l'ordre des propriétés de `CardRead` change, deux schémas
apparaissent (A7), et un ou plusieurs selon la forme de l'exigence (A3). La
description de `listCards` et la docstring de `CardListItem` sont réécrites.
Client TS régénéré ; `fakeServer.ts` apprend les champs nouveaux et une
pagination au-delà de 200 lignes.

## Couche offline

### Un magasin de détails en version 6

`cards` ne change ni de forme ni de clé. La version 6 ajoute un magasin
`cardDetails`, clé `id`, sans `upgrade`, sur le patron de la version 5
(constantes `VTES_STORES_V5`, déclarées en version 6). Il porte ce que les
filtres demandent : secte, titre, voie, coût, prérequis de clan découpés,
exigence et disciplines avec leur niveau, types, sectes et titres exigés,
texte et texte replié, dates de légalité, noms traduits et variantes de nom
repliés.

- Aucune ligne n'est vidée : un téléphone qui exécute le nouveau code pour la
  première fois hors ligne garde son catalogue, son picker et ses libellés.
- « Miroir incomplet » se lit sans marqueur : `cardDetails` vide ou plus court
  que `cards`. Tant qu'il l'est, Chercher garde le champ principal, réduit au
  nom anglais faute de texte et de noms traduits, et la catégorie, et désactive les autres filtres, légalité comprise, avec le message
  « catalogue à mettre à jour, réseau requis ». Le filtre de légalité ne lit
  jamais une carte sans détails comme légale.
- `refreshCatalog` écrit les deux magasins dans une seule transaction, après
  avoir tout lu ; une lecture interrompue ne touche à aucun des deux.
- Face à un serveur qui ne renvoie pas les champs nouveaux, `cards` est relue
  comme avant, `cardDetails` n'est pas écrit, le miroir reste incomplet.
- La montée se joue dans chaque base de compte et dans la base d'avant le
  Lot 6 quand `legacy.ts` l'ouvre, sans toucher la file, `settled`, les
  correspondances ni les miroirs de la pratique.
- À vérifier en C1a : l'ouverture par l'ancien code d'une base montée en
  version 6 ; résultat noté dans le README.

C'est le patron que le README propose à Barrin : un miroir qu'on enrichit se
double d'un magasin de détails à clé identique, ajouté sans migration.

Le rejeu de l'import en B1 change le contenu du catalogue servi (sectes,
exigences) sans changer sa forme : un appareil déjà à jour le récupère par le
bouton « Mettre à jour le catalogue » ; un appareil dont `cardDetails` est
vide le relit seul (P11).

### Relecture du catalogue hors de la séquence de 60 s

`refresh({ catalog: true })` lance la relecture du catalogue après les autres
miroirs, avec son propre délai (de l'ordre de 180 s, fixé en C1a), sans la
rejouer si un verdict de sync tombe en route. `CatalogProvider` déclenche la
relecture automatique quand le miroir est vide ou incomplet (P11).

### Lecture et filtrage

Le filtre ne coûte presque rien (environ 1 ms par passe sur 4149 cartes,
mesuré hors navigateur). Ce qui coûte : la désérialisation, la jointure, les
ensembles, le rendu. Le catalogue joint est chargé une fois en mémoire et
filtré en mémoire, sans parcours Dexie par frappe. Ce cache vit dans le
runtime, un par base de compte, relu quand `cards` ou `cardDetails` changent,
jeté par `purge()` et à la fermeture de la base, dans `vtes/`. Résultats
affichés par tranches. Au bureau, la recherche se relance à chaque changement
après un court délai (VDB : 250 ms). Le picker et la feuille d'entrée de la
Collection peuvent passer par cette lecture en gardant `limit: 20` et deux
lettres au moins.

### Projections, poids, persistance

Les filtres de statut lisent la projection existante ; la disponibilité de la
feuille d'ajout vient de `useAvailableStock`. Poids mesuré : 1,5 à 2,5 Mo par
base de compte, sans enjeu de quota. P14 traite l'éviction.

## Écrans

Les écrans suivent le handoff (P6) ; ce qui suit est l'intention fonctionnelle
et les contraintes du code.

### Routes

`#/chercher`, avec dans la query du hash le texte cherché (`q`) et le deck
cible (`deck`), lus à l'arrivée ; ensuite la page n'écrit dans l'adresse que par
`history.replaceState`, sans entrée d'historique par frappe. `parseHash` les lit
sans les confondre avec `action`. La fiche s'ouvre dans une feuille (mobile) ou
dans la colonne de détail (bureau). La règle de `apiRoutes.ts` vise les
chemins, pas le hash ; `#/chercher` est préféré à `#/cartes` pour ne pas
laisser croire qu'elle est levée. La page est ajoutée au chargement paresseux
et au préchauffement d'`App.tsx`, et `NavKey` et `navActive` l'apprennent.

### Mobile

Onglet Chercher activé (`nav-search`). En tête, le champ principal (nom et
texte, P1), puis des puces de catégorie et un bouton « Filtres » qui ouvre une feuille, avec le
nombre de filtres actifs. Une ligne de résultat : nom (`cardLabel`), méta selon
la catégorie (clan, secte, capacité, disciplines ; ou type, coût, prérequis),
mention « 3 en collection », mention de légalité. Un toucher ouvre la fiche :
image (en ligne), texte, prérequis et exigences, légalité, impressions,
exemplaires possédés par langue et extension, decks qui la jouent, « Ajouter… ».
États : catalogue absent, catalogue à mettre à jour, aucun résultat, hors
ligne.

### Bureau

Filtres en colonne à gauche ; résultats au centre en tableau triable ; fiche à
droite. Raccourcis de page : `F` focalise la colonne de filtres, `↑↓`
parcourent, `↵` ouvre la fiche (avec `ignoreTarget: isInteractiveTarget`), `N`
ouvre la feuille d'ajout. Les touches simples de page ne prennent jamais `A`,
`C`, `D`, `P` ni `S`.

### Clavier : le `/` global

Un seul `/` existe à la fois. La liaison globale vit dans `App`, avec
`enabled: false` sur la route du deckbuilder, où `/` reste au picker ; elle est
inerte dans un champ et sous une feuille ouverte (cible dans un
`[role="dialog"]`) ; sur Chercher, la page ne lie pas `/`, le global focalise
son champ principal. Un test vitest compte un seul `onTrigger` par frappe.

### Feuille d'ajout

Contrôle segmenté à trois choix exclusifs, selon P10. La logique du deckbuilder
est dans `useAddDeckCard` (D1a) ; le calcul de l'opération est une fonction
pure, `buildAddOperation(choix, état)`, qui réutilise `computeAddedLine` (D1a)
et ajoute le remplacement des proxies propre à « les deux ». Un deck archivé
n'est pas proposé. Préfixe `search-add-*`. Rien n'attend le réseau.

### Images et champ global

`CardImage` gagne une seconde source et une taille mobile ; la fiche lue en
ligne est gardée en mémoire par carte, rien n'est lancé hors ligne. Le champ
global réapparaît dans `TopBar`. Les `data-testid` existants ne disparaissent
pas ; les nouveaux sont ceux qu'E0 a fixés (section « Livraisons »).

## Découpage en étapes ordonnées

| Étape | Agent | Contenu | Dépend de |
| --- | --- | --- | --- |
| A0 | orchestrateur, utilisateur | P1 à P15 tranchées, brief mis à jour, pistes versées — **fait le 2026-11-03** | rien |
| E0 | qa-tests | recensement des `data-testid` avec sa méthode, identifiants nouveaux pour D1b — **fait le 2026-11-03** | rien |
| D1a | frontend-react | hook `useAddDeckCard`, défaut d'écrasement confirmé et corrigé — **fait le 2026-11-03** | rien |
| A1 | architecte-contrat, qa-tests | forme de l'exigence (A3) et douzième révision ; import : dérivation de la secte (P13), lecture de `vteslibmeta.csv` (P15), fixture, rapport ; fonctions pures et tables de cas (secte, exigence, `card_legality`) ; `CardListItem` enrichi, classe fille des noms traduits ; export du contrat, client TS — **fait le 2026-11-03**, correctif « non-anarch » en cours (précision 2 après A1) | A0 |
| B1 | backend-fastapi | `list_cards` (patron de `get_card`, préchargements, tri), `GZipMiddleware`, tests ; mesures ; essai complet de migration et de rejeu de l'import sur une **copie** de `backend/vtes.db` (vérification de `DATABASE_URL`, `upgrade head`, rejeu, comparaisons ligne à ligne), procédure et résultats consignés ; contrôle CRAP. B1 ne touche pas à `backend/vtes.db` | A1 |
| B1b | backend-fastapi, sur feu vert explicite de l'utilisateur | mise en service sur `backend/vtes.db` : vérification de `DATABASE_URL`, sauvegarde datée, `upgrade head`, rejeu de l'import, comparaisons ligne à ligne avec la sauvegarde, selon la procédure éprouvée en B1 | B1, feu vert |
| C1a | pwa-offline | `cardDetails` en version 6, `refreshCatalog` sur deux magasins, miroir incomplet, relecture hors des 60 s et P11, ancien serveur, ancien code, `persist()` (P14), README ; contrôle CRAP | A1 |
| C1b | pwa-offline | légalité TS, `filterCards` et ses modes (A6), variantes de nom, lecture mémoire dans le runtime, hooks, mesure de `foldText` ; contrôle CRAP | A1 |
| E1 | qa-tests | fabrique de catalogue synthétique, table de cas de `filterCards` avec pwa-offline (modes de disciplines, lignes de texte, votes, capacité, exigences), faux serveur paginé, squelette du test de montée | A1 |
| D0 | orchestrateur, utilisateur, Claude Design | brief de design, puis handoff de l'écran Chercher | A0 |
| D1b | frontend-react | route, onglet, chargement paresseux et préchauffement, page avec la recherche par nom existante, mobile et bureau — **fait le 2026-11-03** | A0, E0 |
| D1c | frontend-react | filtres de P1, tri, fiche de carte, mobile puis bureau ; contrôle CRAP | C1a, C1b, D0, D1b |
| D2 | frontend-react | feuille d'ajout (P10, `buildAddOperation`) ; contrôle CRAP | D1a, D1c |
| D3 | frontend-react | champ global et `/`, `CardImage`, image du picker mobile, lecture à la demande, entrée depuis un deck (P12) ; contrôle CRAP | D2 |
| E2 | qa-tests | e2e de recherche et de filtres aux deux largeurs, scénario de la base Dexie 5, extension de `search-parity.spec.ts`, `desktop-real-backend` de `deckbuilder.spec.ts` (non lancé à D1a) | D1c |
| E3 | qa-tests | e2e d'ajout, `/`, images, P12 ; mesures à la main ; décompte final et contrôle de clôture des `data-testid` | D3 |
| F | orchestrateur | CLAUDE.md (§5 ou §6 secte, §6 révision et exigence, §7, §11 avec l'amendement de §11.1, la licence vtescsv et la correction de D1a, §12, fixture à dix cartes), brief clos, vérification à la main sur téléphone | E3, B1b |

Qui fait quoi. L'architecte porte en A1 tout ce qui touche au modèle, à
l'import et aux règles : migration, dérivation de la secte, lecture de
l'exigence, `card_legality`, schémas. qa-tests écrit avec lui les tables de cas
communes. Le back reprend en B1 le service de liste et la compression, et
éprouve la mise en service sur une copie de la base ; il ne migre
`backend/vtes.db` qu'en B1b, sur feu vert explicite de l'utilisateur
(précision 9 après A1). Entre-temps, les tests et les e2e contre le vrai back
tournent sur des bases éphémères et ne sont pas gênés, mais l'API refuse de
démarrer contre `backend/vtes.db` restée à la onzième révision
(`schema_check.py`) : l'usage manuel de l'application sur la vraie base
attend B1b. pwa-offline et le front ne lisent que le contrat.

B1, C1a, C1b et E1 avancent en parallèle une fois le contrat exporté à A1. D1b
ne dépend que de l'A0 et d'E0 et peut commencer tout de suite. D0 est sur le
chemin critique de D1c et D2 seulement.

## Livraisons

### Livré à l'étape E0 (2026-11-03)

Recensement des `data-testid` par un script versionné,
`frontend/scripts/testid-census.mjs`, avec son test miroir
`frontend/tests/unit/testidCensus.test.ts` (8 tests). Trois familles sont
comptées à part : les littéraux `data-testid` (403 distincts, 480 mentions,
le chiffre comparable aux 193 du Lot 5c), les littéraux passés par une prop en
`…testId` (17), et les gabarits `${…}` (24 motifs, exclus des totaux et listés
comme motifs). Les expressions qui relaient une prop ou posent un littéral dans
une condition ne sont pas comptées. Référence d'ouverture :
`docs/qa-baselines/testids-lot-chercher-ouverture.txt` (444 lignes).
`node scripts/testid-census.mjs --check <référence>` échoue si un identifiant a
disparu, ignore les ajouts, et sert de contrôle de clôture. Aucun script npm
n'est ajouté, point laissé à décider.

Identifiants nouveaux pour D1b, sous les préfixes `search-*`, `search-add-*`,
`nav-search`, `topnav-search` et `topbar-search`. Neuf sont à fixer dès D1b :
`nav-search`, `topnav-search`, `topbar-search`, `search-page`,
`search-input`, `search-results`, `search-row`, `search-no-result`,
`search-empty-catalog`. Liste complète proposée : `search-clear`,
`search-count`, `search-category-all`, `-crypt`, `-library`,
`search-filters-open`, `-count`, `-sheet`, `-done`, `-reset`, `-column`,
`search-row-owned`, `search-row-legality`, `search-sort-*`,
`search-outdated`, `search-offline`, `search-loading`, `search-detail` (et
`-empty`, `-close`, `-sheet`, `-image`, `-printings`, `-owned`, `-decks`,
`-add`), `search-add-sheet`, `search-add-target-deck`, `-collection`, `-both`,
`search-add-deck`, `search-add-copies`, `search-add-card-set`,
`search-add-submit`, `search-add-error`, `search-add-feedback`. Les filtres de
P1 décidés depuis demanderont des identifiants de plus (lignes de texte,
grille de disciplines, modes), fixés par qa-tests au brief de D1c.

### Livré à l'étape D1a (2026-11-03)

La logique d'ajout est sortie d'`AddDeckCardForm` dans le hook
`useAddDeckCard(deck, card)` (`frontend/src/features/decks/useAddDeckCard.ts`),
qui ne connaît ni le picker ni Chercher ; le formulaire est réduit à la
présentation, DOM et `data-testid` inchangés.

Défaut confirmé : `AddDeckCardForm` envoyait `quantity: copies`, `copies`
repartant de 1. Ajouter une copie à une ligne Élan vital FR à deux exemplaires
et deux proxies la ramenait à 1/1 au lieu de 3/3, au mobile comme au bureau
(même `submit`) ; « Dans le deck : N » était purement informatif. Le défaut est
reproduit par un test de `tests/unit/ui/decks.test.tsx`, qui échouait avant la
correction, et corrigé dans la fonction pure `computeAddedLine` :
`quantity` = existant + copies ; `proxyQuantity` = proxies existants +
(copies − possédées) ; `acquiredQuantity` = min(possédées, max(0, réels
existants + possédées − disponible)), le disponible étant compté hors de ce
deck. Sans ligne existante, rien ne change. Le remplacement des proxies
d'abord (P10) reste propre à « les deux » (D2). Refus local nouveau si la ligne
dépasserait 2³¹ − 1 (« Le deck ne peut pas contenir autant d'exemplaires de
cette carte. »).

Aucun changement de contrat, de backend ni de `offline/core`. Fichiers :
`src/features/decks/useAddDeckCard.ts` (nouveau), `AddDeckCardForm.tsx`,
`tests/unit/addDeckCardLine.test.ts` (nouveau, 4 tests),
`tests/unit/ui/decks.test.tsx` (2 tests de plus). Vitest : 766 tests sur 51
fichiers (752 sur 49 avant le lot, plus 8 à E0 et 6 à D1a), lint et `tsc`
propres, CRAP sans régression (`AddDeckCardForm` à 23). Les e2e d'acquisition
et `lot5c-symetrie` sont verts en `real-backend` ; `deckbuilder.spec.ts` en
`desktop-real-backend` n'a pas été lancé et l'est en E2. Correction à consigner
au §11 à l'étape F.

### Livré à l'étape D1b (2026-11-03)

Route cliente `#/chercher`, qui lit `q` et un `deck` de forme valide (le deck
est conservé dans l'adresse sans être exploité, P12 étant pour D3) ; le texte
cherché est réécrit par `history.replaceState` (`replaceSearchQuery`), sans
entrée d'historique. Page `features/search/SearchPage.tsx`, chargée à la
demande et préchauffée dans `App.tsx` ; l'onglet Chercher de la tab bar est
actif (`nav-search`). La page réutilise `useLocalCardSearch` (seuil de 2
lettres, plafond de 200 résultats, compteur) et rend une ligne par carte : nom,
catégorie, clan, capacité et exemplaires en collection ; états catalogue absent
(`CatalogPanel compact`, champ désactivé) et aucun résultat.

Pas d'entrée dans la barre haute bureau (P8) : la page s'y ouvre par son
adresse jusqu'au champ global de D3. Identifiants posés : `nav-search`,
`search-page`, `search-input`, `search-count`, `search-results`, `search-row`,
`search-no-result`, `search-empty-catalog` ; `topnav-search` et `topbar-search`
restent à D3. 7 tests vitest (773 sur 52 fichiers), 2 e2e contre le vrai back
(`e2e-real/chercher-d1b.spec.ts` à 390 px, `e2e-desktop-real/chercher-d1b.spec.ts`
à 1440 px : recherche par nom, rechargement hors ligne), lint et `tsc` propres,
CRAP sans régression, aucun identifiant disparu au recensement.

### Livré à l'étape A1 (2026-11-03)

Forme de l'exigence de bibliothèque (A3) : option 3. Une colonne brute
`card.library_requirement`, recopie de `vteslibmeta.csv`, lue par
`vtes_rules.library_requirement` en sectes exigées (celles qu'un titre implique
comprises), titres précis, titré, non titré et autres valeurs, exposées au
contrat (`required_sects`, `required_titles`, `requires_titled`,
`requires_non_titled`, `other_requirements`). Une exclusion (« non-anarch »)
reste dans les autres valeurs : elle ne répond pas au filtre Anarch, et la
carte répond à « non requise ». La table titre ⇒ secte est celle de VDB, sauf
« bishop », que VDB range dans la Camarilla et qui est ici un titre du Sabbat
(aucune ligne du fichier ne l'exige). « Titled (specific) » se déduit de
`required_titles` non vide.

Douzième révision, `8ab23342a26f` : `ADD COLUMN` nullable, sans recréer `card`
(visée par six clés étrangères) ni convertir de données, rendue hors ligne dans
les deux sens. Sa descente retire la colonne sans garde, l'exigence étant la
copie d'une source publique qu'un rejeu de l'import rétablit. Toujours 25
tables. Vérifiée sur une base jetable ; `backend/vtes.db` n'a pas été touchée
(mise en service à B1).

Import : la secte des vampires est dérivée du texte (`vtes_rules.crypt_sect`)
et rangée dans `sect` et `card.sect_id` ; un premier mot inconnu est signalé
(`unknown_sect_cards`), jamais deviné, et le rapport donne le compte par secte.
Les six *advanced* dont le texte fusionné change de secte (Count Germaine,
Dominique, Jeremy MacNeil, Tariq, Valerius Maior, Yazid Tamari) gardent la
secte de leur face. `vteslibmeta.csv` est la seconde source : URL figée sur
`main`, en-tête vérifié avant toute écriture, jointure par identifiant VEKN.
Un identifiant inconnu, une carte de crypte, un nom divergent ou un doublon
sont signalés au rapport et en `--json` sans échec ; le nom divergent est
appliqué quand même. L'article final de vtescsv (« Embrace, The ») n'est pas un
écart (18 cartes). Le fichier est facultatif avec `--from-dir` : sans lui, les
exigences en base ne bougent pas. Fixture krcg inchangée à dix cartes,
échantillon CSV à part (`vteslibmeta_sample.csv`).

Fonctions pures et tables de cas : `card_legality(banned_on, legal_from, on)`
rend deux booléens et sert de base à `banned_cards` et `not_yet_legal_cards`,
dont les sorties ne changent pas. Tables `card_legality_cases.json` (23 cas,
commune avec C1b, *Playing for Keeps* à sept dates), `crypt_sect_cases.json`
(23) et `library_requirement_cases.json` (40), ces deux dernières lues par
pytest seul.

Contrat : `CardListItem` enrichi (A1, A3) ; `GET /cartes` rend
`CardSearchItem`, qui en hérite et ajoute `translated_names`
(`CardTranslatedName`, toutes les traductions connues, FR et ES aujourd'hui).
`CardRead` gagne l'exigence et rien d'autre. `CardListItem` ne figure plus
comme schéma au contrat exporté : le front lira `CardSearchItem`. Toujours 49
opérations sur 29 chemins ; nouveau test `test_contract_card_search.py` par
ensembles de propriétés ; client TS régénéré. `list_cards` remplit déjà la
forme nouvelle avec l'assembleur commun de `get_card` et ses préchargements
(une réponse sans eux aurait été fausse ou en N+1) ; l'ordre des types et des
disciplines, le compte des requêtes, la compression, les mesures et la mise en
service sur `vtes.db` restent à B1.

Chiffres : pytest 2446 tests et 2 `xfail` (2276 à l'ouverture), 711 s sous
couverture ; ruff propre ; CRAP back sans régression (`library_requirement` à
10, couverte à 100 %) ; vitest 773 tests et `tsc` propres. Relevés : krcg compte
4212 cartes au 2026-11-03, 63 de plus qu'en base, dont 1822 de crypte (B1
attendra 1822 sectes, pas 1785) ; aucune carte combinée n'exige Dominate et
Obfuscate, si bien que le mode ET de l'exemple de P1 ne rend aucune carte
réelle. Points ouverts : vtescsv ne déclare aucune licence (§11 à F) ; Black
Hand et Seraph restent dans les autres valeurs sans impliquer le Sabbat, comme
chez VDB ; « city title » et « inquisitor » restent bruts ; le `SKILL.md` de
`regles-vtes` est à compléter des trois fonctions nouvelles à F.

**Corrigé après revue de l'utilisateur (2026-11-03).** Une exclusion de secte
de `vteslibmeta.csv` (« non-anarch ») veut dire « toute secte de vampire sauf
celle-là ». `required_sects` garde sa sémantique « l'une de » : « non-anarch »
y donne Camarilla, Sabbat, Laibon et Independent, sans Imbued puisque ces
cartes visent un vampire. La carte ne répond donc plus à « secte non requise »,
ni à Anarch, mais à chacune des quatre autres sectes. Combinée à une secte
exigée ou impliquée par un titre, l'exclusion la restreint (« non-anarch,prince »
donne la Camarilla) au lieu de l'élargir ; un test le croise pour les quinze
titres. Les exclusions quittent `other_requirements` ; la valeur brute reste
dans `library_requirement`. Le contrat garde sa forme, seules deux descriptions
changent (contrat réexporté, client TS régénéré). Bishop reste un titre du
Sabbat, contre VDB. Black Hand et Seraph restent bruts et n'impliquent pas le
Sabbat, leur traitement étant reporté (pistes). La table
`library_requirement_cases.json` fige ces lectures (49 cas). pytest compte 2474
tests et 2 `xfail`, ruff est propre, et le contrôle CRAP back est sans
régression (331 fonctions, pire score 21).

## Tests attendus

### Côté back

- Dérivation de la secte sur une table de cas : premier mot, « Advanced, » en
  tête, chaque secte, *imbued*, les six textes `[MERGED]` qui changent de secte
  (secte de la face attendue), un premier mot inconnu (signalé) ; sur la base
  rejouée, 1785 cartes de crypte avec une secte.
- Lecture de l'exigence de bibliothèque sur une table de cas :
  `prince,justicar` (Camarilla impliquée), `justicar,inner circle`, `baron`,
  `magaji`, `1 vote`, `bishop` (Sabbat impliqué, contre VDB),
  `non-anarch,titled` (une secte nécessaire : répond à Camarilla, Sabbat,
  Laibon, Independent, pas à Anarch ni à « non requise »), `imbued`,
  `black hand` et `seraph` (autres valeurs, sans Sabbat impliqué),
  `non-sterile`, `1 Gehenna`, `capacity 7 or …` (valeurs brutes conservées,
  non filtrables), exigence vide.
- Import de `vteslibmeta.csv` sur un fichier d'échantillon : jointure par
  identifiant, `Id` inconnu, carte de crypte, nom discordant, tous signalés au
  rapport ; rejeu sans doublon ni changement ; krcg seul sans le fichier
  (l'import ne doit pas dépendre de la présence des deux sources si l'architecte
  en décide ainsi en A1).
- Douzième révision : montée et descente sur base vide, montée sur une base
  peuplée sans perte, montée hors ligne (`--sql`).
- `GET /cartes` rend les champs nouveaux (secte, exigences, types, disciplines,
  texte, coût « X », carte bannie, type multiple, prérequis à deux clans) ; une
  carte créée en test avec `legal_from` au lendemain de la date injectée.
- Nombre de requêtes égal pour `limit=1` et `limit=10`, et borné, sur le patron
  du compteur de `test_play_routes.py`.
- `GET /cartes/{id}` : instantané JSON comparé par contenu, schéma comparé
  propriété par propriété.
- Compression : réponse compressée quand le client l'accepte, `Retry-After`
  exposé, `Cache-Control` inchangé.
- `card_legality` sur `card_legality_cases.json` ; `/legalite` inchangé,
  *Playing for Keeps* compris ; un test de bout en bout avec `_today` remplacé.
- Contrat exporté à jour (`export_openapi.py --check`).

### Côté front

- Montée 5 vers 6 sur le patron de `vtesDbV5.test.ts`, base d'avant le Lot 6
  comprise, double ouverture, ancien code face à une base 6.
- `refreshCatalog` : deux magasins ensemble, lecture interrompue sans effet,
  ancien serveur sans les champs, deux comptes indépendants.
- `filterCards` sur sa table de cas, construite sur un catalogue synthétique,
  une carte positive et une négative par filtre et par mode. Pour les
  disciplines de bibliothèque, le tableau de P1 ligne par ligne, avec
  *S* = {Dominate, Obfuscate} et une carte au choix sur le modèle de *The
  World's a Canvas* (absente en ET, présente en OU et en SEULEMENT), une
  combinée Dominate et Obfuscate (présente en ET), une combinée Dominate et
  Potence (absente en ET et en SEULEMENT), une `mono` Dominate (présente en OU
  et SEULEMENT, absente en ET), une carte sans exigence (présente en NON et
  « non requise » seulement). Pour la crypte : niveaux, paires OU, vertus,
  groupe « Any » retenu, lignes de capacité en OU et NON, barème des votes,
  secte. Pour la bibliothèque : types en OU, ET, NON et « Reflex », clan et
  secte requis avec « non requis », titre impliquant sa secte (lu sur les
  listes du serveur), « non-anarch » qui répond aux sectes autres qu'Anarch,
  coût absent valant 0, « X » qui passe toujours. Pour le texte : champ
  principal sur nom (FR et ES compris) et texte anglais ; lignes ET et NON,
  nom seul, texte seul, les deux ; variantes de nom (ponctuation, initiales),
  noms traduits, icônes de discipline ; champ principal réduit au nom anglais
  sur un miroir incomplet. Si la proposition de P9 est retenue en D1c : sous le
  tri par défaut, une carte trouvée par son nom passe devant une carte trouvée
  par son texte seul.
- Légalité TS sur la table commune ; test d'horloge autour de minuit UTC.
- Filtres avancés, légalité comprise, désactivés sur un miroir incomplet.
- Lecture mémoire : aucun parcours Dexie par frappe, relecture après
  `refreshCatalog` et après la montée, sur 4149 lignes synthétiques.
- Affichage par tranches ; `buildAddOperation` pour les trois choix, ligne
  existante, ligne avec proxies ; `/` déclenché une seule fois, gardé au picker
  sur le deckbuilder, inerte dans un champ et sous une feuille ; tests qui
  comptent les onglets mis à jour.

La couverture qui compte pour le score CRAP est celle de vitest seul.

### Playwright

Contre le vrai back, avec interception de `static.krcg.org` par `page.route` :

1. `real-backend`, 390 × 844 : hors ligne, chercher avec trois filtres combinés
   qui ne rendent qu'une carte du fixture (clan Tremere, discipline
   supérieure, un mot du texte), ouvrir la fiche, ajouter à un deck puis aux
   deux, recharger hors ligne, revenir en ligne, vérifier le rejeu et l'état
   serveur ;
2. `desktop-real-backend`, 1440 × 900 : le même parcours, plus `/` et le champ
   global, et `/` gardé au picker du deckbuilder ;
3. `real-backend` : base Dexie à la version 5 (50 en IndexedDB brut) avec un
   catalogue ancien, ouverte hors ligne : picker utilisable, filtres avancés
   désactivés, tout actif au retour du réseau ;
4. `desktop-real-backend` : variante bureau du scénario 3, ou justification
   écrite ;
5. P12 : un test par largeur ;
6. `search-parity.spec.ts` étendu au texte, aux noms traduits, et aux filtres
   `category` et `clan_id` ;
7. un filtre de secte et un filtre d'exigence de bibliothèque sur le fixture,
   si les cartes du fixture le permettent ; sinon, couverts par vitest seul, ce
   que E2 écrit.

Décompte par `--list` et à l'exécution (précaution OneDrive, §11, Lot 4).

### Mesures à la main

Consignées en E3, sans valeur de réussite : lecture complète du catalogue en
ligne sur le téléphone, poids de la base par `navigator.storage.estimate()`,
chargement à froid, filtrage et rendu par frappe, `readProjection` avant et
après le lot, résultat de `persist()`.

### Score CRAP

Contrôle à la fin de B1, C1a, C1b, D1c, D2 et D3 (D1a : fait, sans
régression). Fonctions à risque : la dérivation de la secte et la lecture de
l'exigence côté back, la fonction d'import qui les appelle, `filterCards` et
ses modes, la lecture mémoire, `buildAddOperation`, la page Chercher et la
colonne de filtres (découpées en sous-composants dès la première version).
Aucune entrée ajoutée aux références `docs/qa-baselines/crap/`.

## Risques et points d'attention

- Rejeu sur `backend/vtes.db` : la base contient la vraie collection et la
  pratique de l'utilisateur. B1 éprouve migration et rejeu sur une copie
  seulement ; la vraie base n'est touchée qu'en B1b, sur feu vert explicite de
  l'utilisateur (précision 9 après A1) : vérifier `DATABASE_URL`, sauvegarde
  datée, puis comparer ligne à ligne stock, decks, lignes, journal et pratique
  avant et après (ils ne doivent pas bouger), et le catalogue (4149 cartes,
  mêmes identifiants de carte, d'extension et d'impression, sectes et exigences
  en plus).
- Attente de B1b : tant que `backend/vtes.db` reste à la onzième révision,
  l'API refuse de démarrer contre elle (`schema_check.py`), donc l'application
  ne s'utilise pas à la main sur la vraie base ; les tests et les e2e, sur bases
  éphémères, ne sont pas concernés. Plus le feu vert tarde, plus cette fenêtre
  dure ; à demander dès que B1 est livrée.
- Champ principal sur nom et texte : une recherche courte ramène beaucoup de
  cartes par leur texte ; la proposition de P9 (correspondances par le nom
  d'abord) est à valider en D1c, sur des recherches réelles.
- Licence de vtescsv : aucune licence déclarée. L'usage reste celui de krcg,
  qui en dérive ; à consigner au §11, et à revoir si le dépôt en publie une
  restrictive.
- Désynchronisation entre krcg et vtescsv : un identifiant présent dans l'un
  et pas dans l'autre, ou un nom qui diverge, après une mise à jour d'un seul
  des deux dépôts. Le rapport d'import le signale ; aucune exigence n'est
  inventée, et une carte sans ligne dans `vteslibmeta.csv` est lue « sans
  exigence ».
- URL sur une branche, `main`, et non sur une version : un changement de forme
  du CSV casserait l'import au rejeu ; le test sur l'échantillon et l'en-tête
  vérifié à la lecture le rendent visible.
- Dérivation de la secte : elle dépend de la forme des textes krcg ; une carte
  nouvelle qui ne commence pas par une secte est signalée, pas devinée.
- Poids du catalogue sur une connexion lente : couvert par la compression et le
  délai propre de la relecture.
- Téléphone sans catalogue au club : couvert par le magasin de détails ajouté
  sans vidage ; à vérifier à la main à l'étape F.
- Régression de toutes les lectures : `cards` ne grossit pas ; mesure de
  `readProjection` avant et après.
- Deux écritures de la légalité d'une carte : deux booléens, une table
  commune.
- Sens des filtres de disciplines : écart volontaire avec VDB sur ET et
  SEULEMENT ; un utilisateur habitué à VDB peut être surpris. L'aide du bouton
  dit le sens de chaque mode ; la table de cas le fige.
- Densité de l'écran de filtres : le cœur de VDB fait beaucoup de contrôles
  pour un téléphone ; c'est l'objet du handoff (P6).
- Images servies par un tiers, ancien onglet pendant la montée, éviction de la
  base (P14), catalogue copié par compte, catalogue jamais rafraîchi après un
  import serveur (hors P11), données krcg qui révèlent des défauts : inchangés
  depuis la relecture.

## Critère de fin de lot

- Décisions de l'A0 reportées au §11 de CLAUDE.md à l'étape F, avec
  l'amendement de §11.1 et la licence de vtescsv ; brief marqué clos.
- Handoff versé dans `docs/design-handoff/` et écrans conformes en mobile et en
  bureau.
- Douzième révision appliquée sur `backend/vtes.db` en B1b, sur feu vert de
  l'utilisateur, après essai sur copie en B1 et sauvegarde, import rejoué : 1785 cartes de crypte avec une secte, exigences
  de bibliothèque chargées, comparaison ligne à ligne sans écart sur les
  données de l'utilisateur.
- Contrat à 49 opérations, `CardListItem` enrichi, client TS régénéré,
  `API_ROUTE_PREFIXES` inchangé ; réponses compressées.
- `uv run pytest` vert à 2276 + N tests, les deux `xfail` inchangés, `ruff
  check` propre ; `npm run lint`, `npx tsc --noEmit -p tsconfig.app.json` et
  `npm run test` propres, à 766 + N tests sur 51 + M fichiers ; Playwright vert
  à au moins 64 tests, ventilés 8 `chromium`, au moins 33 `real-backend`, 3
  `desktop`, au moins 20 `desktop-real-backend` ; totaux exacts relevés en E3.
- `card_legality_cases.json` lue par pytest et par vitest ; tables de cas de la
  secte, de l'exigence et de `filterCards` en place.
- Contrôles CRAP verts, références toujours vides.
- `node scripts/testid-census.mjs --check docs/qa-baselines/testids-lot-chercher-ouverture.txt`
  vert à la clôture.
- Les deux points renvoyés par le Lot 5c soldés.
- Vérification à la main sur téléphone : mise à jour en ligne, puis en mode
  avion, une recherche filtrée et un ajout à un deck, synchronisés au retour du
  réseau ; résultat de `persist()`.
- CLAUDE.md à jour : en-tête, §6 (secte, exigence, douzième révision), §7,
  §11, §12, fixture à dix cartes.

## Revue des agents

Les cinq agents ont relu le plan le 2026-11-03, avant l'A0, chacun dans son
périmètre, avec des vérifications dans le code et sur une copie de
`backend/vtes.db` en lecture seule. Les cinq rendent « validé sous réserves ».
Toutes les réserves ont été levées ou écartées avec leur raison. Les décisions
de l'utilisateur prises ensuite (P1, P13, P15) ont élargi le lot au-delà de ce
qu'ils ont relu : migration, seconde source, rejeu, filtres de VDB. Ces
ajouts n'ont pas été relus par les agents ; l'architecte les reprend en
ouvrant A1, et les autres agents à l'ouverture de leur étape.

### architecte-contrat

Verdict : validé sous réserves.

Il confirme qu'aucune migration n'était nécessaire au plan relu, que le contrat
reste à 49 opérations et que `/sync` ne bouge pas. Ses réserves : `CardRead`
change l'ordre de ses propriétés ; la compression doit être livrée ; une
légalité de carte à verdict unique ferait disparaître *Playing for Keeps* de
l'une des deux listes de `/legalite` ; le sens « toutes » des disciplines de
bibliothèque écarterait les cartes `mono`. Il apporte les mesures de poids, le
séparateur `", "`, le tri des types et disciplines, la limite des icônes dans le
texte, les titres, la faisabilité mesurée de la secte, et la question des
proxies dans « les deux ».

Intégré : A1, A2, A5, A7, A10, P1 (niveaux de crypte, groupe Any, capacité des
*imbued*, credos, titres), P3, P10, P13, fixture à dix cartes. Écarté : la forme
compacte de `discipline_links`, que la compression rend inutile ; la
compression limitée aux routes publiques, aucun corps ne portant de secret. Son
sens « jouable avec » pour les disciplines de bibliothèque est devenu, après
l'A0, le mode SEULEMENT.

### backend-fastapi

Verdict : validé sous réserves.

Ses mesures font de la compression une mesure du lot. Il relève que
l'assemblage par `model_dump` perdrait les champs nouveaux, que
`translated_names` sur `CardListItem` ferait lever `get_card`, que la
précédence des motifs de légalité manque, qu'aucune carte n'est « pas encore
légale », et que la forme actuelle pèse 1,08 Mo.

Intégré : A1, A2, A5, A7 (la seconde de ses deux solutions), tests côté back,
pistes (`ETag`). Écarté : la compression au proxy du Lot 11, le pilote tournant
sans proxy ; la première solution d'A7 ; le tri des liens par identifiant, au
profit d'un tri par nom et abréviation.

### pwa-offline

Verdict : validé sous réserves.

Sa remarque principale renverse la conception du miroir : `readProjection`
relit `cards` à chaque lecture, d'où le magasin `cardDetails` ajouté en version
6 sans `upgrade`. Il demande l'écriture des deux magasins dans une transaction,
la sortie de la relecture du catalogue hors des 60 s, le refus de déclarer
complet un miroir lu sur un ancien serveur, corrige les versions 3 et 4,
rappelle la multiplication par 10 de Dexie, mesure filtre et poids, vérifie
CORS et `crossOrigin`, constate le double `/`, et propose `persist()`.

Intégré : couche offline, état de départ, P7, P14, clavier, C1a et C1b, tests
et mesures. Écarté : `AbortController` (hors lot, comme il le proposait) ; une
aide générique dans `core/`, faute d'usage chez Barrin.

### frontend-react

Verdict : validé sous réserves.

Il établit que le `/` n'a pas de départage, que `A` entre en collision avec `G
A`, et que la quantité de `deck_card.upsert` est un état, d'où le défaut
présumé d'`AddDeckCardForm`, confirmé depuis à D1a. Il relève le chargement
paresseux, `CardImage`, le sens de `F` sur la Collection, et propose D1a, la
lecture du hash à l'arrivée, le filtre deck à trois états, `search-add-*` et
`buildAddOperation`.

Intégré : écrans, P4, P6, P8, P9, P10, P12, découpage D1a à D3. Écarté : `/` vers
le champ local de la Collection, au profit d'un libellé explicite ; un magasin
pour les fiches lues en ligne.

### qa-tests

Verdict : validé sous réserves.

Ses réserves portent sur A5, sur la fixture trop pauvre (catalogue
synthétique), et sur l'absence de tests de volume et de cas d'échec. Il cite les
tests voisins, décrit l'amorçage du scénario sur base version 5, demande
l'interception des images, le décompte par projet, un contrôle CRAP à chaque
étape, le recensement des `data-testid` avec sa méthode et les étapes E1 à E3.

Intégré : A5, tests, scénarios Playwright, mesures, CRAP, critère de fin,
étapes E0 à E3. Écarté : un seuil de temps dans un test. Renvoyé à E1 avec
l'architecte : ajouter ou non deux cartes au fixture krcg ; par défaut non. Les
tables de cas de la secte et de l'exigence, nées de l'A0, relèvent de la même
décision : l'échantillon de `vteslibmeta.csv` est un fichier à part.

## Validation de l'orchestrateur

Verdict : validé, le 2026-11-03, puis A0 close le même jour.

Les cinq revues convergeaient et leurs réserves sont levées. L'A0 a tranché les
quinze propositions (section « Décisions de l'utilisateur ») ; aucune ne reste
ouverte. Trois décisions de l'utilisateur vont au-delà du plan relu et changent
la nature du lot : les filtres suivent le cœur de VDB (P1), la secte est
dérivée dans ce lot (P13), `vteslibmeta.csv` devient une seconde source (P15).
Elles amènent une migration, un changement d'import et un rejeu sur la base de
développement, que les agents n'avaient pas relus ; l'architecte les reprend en
ouvrant A1.

E0 et D1a sont livrées (section « Livraisons ») : la référence des
`data-testid` est posée, et le défaut d'écrasement d'une ligne de deck est
corrigé avant que Chercher ne réutilise la logique d'ajout.

Condition d'ouverture de l'étape A1 : remplie. Une seule question reste à
l'architecte, qu'il tranche en ouvrant A1 : la forme de stockage de l'exigence
de bibliothèque (A3, option 3 recommandée).

Après A1 et D1b, l'utilisateur a tranché neuf précisions (section « Précisions
tranchées le 2026-11-03 (après A1) ») ; les choix de l'orchestrateur qui
attendaient confirmation (sens de SEULEMENT, groupe « Any », secte de la face
d'un *advanced*) sont validés, et deux recommandations sont renversées : le
champ principal cherche dans le nom et le texte, et la mise en service sur
`backend/vtes.db` devient une étape à part, B1b, sur feu vert explicite. Reste
une proposition de l'orchestrateur à valider en D1c : sous le tri par défaut,
les correspondances par le nom passent devant celles par le texte seul (P1,
P9).
