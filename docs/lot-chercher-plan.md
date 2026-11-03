# Lot Chercher : recherche dans le catalogue, hors ligne

Statut : plan relu par les agents, validé par l'orchestrateur ; propositions P
à trancher par l'utilisateur.

Rédigé le 2026-11-03 par l'orchestrateur sur la branche `lot-chercher`, à
partir de `fce352f` (Lot 7 livré, plan du lot Inventaires versé), puis relu le
même jour par architecte-contrat, backend-fastapi, pwa-offline, frontend-react
et qa-tests. Les cinq revues sont résumées en fin de document ; leurs
corrections et leurs mesures sont intégrées dans le corps du plan, qui fait
foi. Il reprend le brief du 2026-09-25 (`docs/lot-chercher-brief.md`), les
deux points que le Lot 5c a renvoyés à ce lot (`docs/lot5c-plan-design.md`,
table d'écarts, ligne 8 et ligne sans numéro du champ de recherche global), et
la place que l'utilisateur a donnée au lot le 2026-10-29 : après le Lot 7,
avant le Lot 8 (P9 de `docs/lot7-plan-parties.md`, CLAUDE.md §12, point 9).

Il suit la forme de `docs/lot7-plan-parties.md` et de
`docs/lot-inventaires-plan.md` : ce qui est déjà tranché, ce qui reste à
trancher par l'utilisateur (P1 à P14), les décisions de conception (A1 à A10),
le découpage par agent et ce qui peut casser. Rien n'est codé avant que les
propositions qui conditionnent l'étape A1 soient tranchées (section
« Validation de l'orchestrateur »).

Le nom « lot Chercher » ne décale pas la numérotation des Lots 8 à 11.

## Portée

Le lot remplace l'onglet Chercher, désactivé depuis le Lot 5, par un écran qui
parcourt le catalogue entier avec des filtres, hors ligne comme en ligne, et
qui permet d'ajouter une carte trouvée à un deck, à la collection, ou aux deux.
Il livre ses deux dispositions, mobile et bureau, sans rien laisser à un lot de
symétrie (§11, ouverture du Lot 5bis).

Il apporte :

1. un miroir local du catalogue enrichi de ce qu'il faut pour filtrer : types,
   disciplines et leur niveau, coût, texte de carte, prérequis de clan, titre,
   dates de légalité, rangé dans un magasin Dexie à part pour ne pas alourdir
   les lectures existantes ;
2. une fonction de filtrage locale, testée sur une table de cas, et une règle
   de légalité d'une carte à une date écrite des deux côtés sur une table de
   cas commune, comme le GW certain au Lot 7 ;
3. la compression des réponses de l'API, qui ramène la lecture complète du
   catalogue enrichi de 3,3 Mo à environ 440 Ko ;
4. l'écran Chercher et sa fiche de carte, en mobile et en bureau ;
5. une feuille d'ajout à trois choix (deck, collection, les deux) qui partage
   sa logique avec l'ajout de ligne du deckbuilder et l'acquisition du Lot 4b,
   sans type d'opération `/sync` nouveau ;
6. le retour du champ de recherche global de la barre haute bureau, masqué
   depuis le Lot 5c, et l'image de carte là où le Lot 5c l'a laissée en
   suspens.

Pour le pilote, l'intérêt est double : le miroir du catalogue s'alourdit
(4149 cartes avec leurs textes), et sa montée de version Dexie doit se faire
sans laisser un téléphone sans catalogue au club. Barrin rencontrera les deux.

Ce que le lot ne fait pas. Pas d'inventaires multiples ni de classeurs, pas
d'import de collection ou de deck depuis VDB, pas de suggestion de decklists :
tout cela relève du lot Inventaires et du Lot 9. L'ajout « à la collection »
vise la collection unique d'aujourd'hui, qui deviendra l'inventaire principal
au lot Inventaires (P0 de `docs/lot-inventaires-plan.md`). Pas de
statistiques de deck (répartition des disciplines, des types, des coûts), que
`docs/pistes-evolution.md` place après ce lot. Pas de légende des raccourcis
`?`, reliquat du Lot 5bis sans lot dédié. Pas de recherche dans les textes
traduits. Pas de secte, sauf si P13 en décide autrement. Aucune règle de
légalité de deck ne change.

## Ce qui a changé depuis le brief

Le brief date du 2026-09-25, avant les Lots 6 et 7. Relu contre le code au
2026-11-03 :

- `GET /cartes`, `GET /cartes/{id}` et `GET /extensions` restent publics
  (Lot 6, P5). Le lot n'ajoute aucune route.
- Le miroir vit dans une base IndexedDB par compte
  (`gurchon-hall-offline-u<id>`, Lot 6). Le catalogue, partagé côté serveur,
  est donc copié dans la base de chaque compte qui ouvre l'application sur un
  appareil.
- La base Dexie est en version 5 depuis le Lot 7. Le brief parlait d'une montée
  « comme aux versions 3 et 4 », c'est-à-dire en vidant des magasins : le plan
  ajoute au contraire un magasin, sans rien vider (section « Couche
  offline »).
- Les références client du Lot 7 ne touchent pas ce lot : les ajouts passent
  par `stock.upsert` et `deck_card.upsert`, qui désignent un deck par sa clé
  comme avant.
- Le brief proposait un filtre de secte. La secte n'est pas importée
  (`Card.sect_id` toujours nul, point [à confirmer] du §6) ; la revue de
  l'architecte a mesuré qu'elle se dériverait du texte sans migration. C'est
  devenu un choix de périmètre (P13).
- Les URL d'image par impression existent déjà en base
  (`card_printing.image_url`, importée depuis le champ `url` de chaque
  impression krcg) et sont servies par `GET /cartes/{id}`. Le Lot 5c pensait
  que ce lot devait les construire.

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
`banned_on`, `legal_from`, `types`, `discipline_links`, `printings` (avec
`image_url` par impression) et `translations`. `CardSummary` reste la vue
courte embarquée dans le stock, les decks et les produits.

Le service (`backend/app/services/catalog.py`) construit la liste par
`CardListItem(**CardSummary.model_validate(card).model_dump(), …)` : ce chemin
ignore tout champ qui n'est pas dans `CardSummary`. `list_cards` précharge le
clan, les impressions, leurs extensions et leurs occurrences, mais ni les types
ni les disciplines ; `get_card` précharge déjà les deux et remplit `CardRead`
par `getattr` sur chaque champ du schéma. Les relations `Card.types` et
`Card.discipline_links` n'ont pas d'`order_by` : leur ordre dépend de
l'historique des imports. Aucun `GZipMiddleware` dans `backend/app`.

L'import (`backend/app/services/catalog_import.py`) remplit déjà tout ce que
les filtres demandent : clan, capacité, groupe, *advanced*, titre, coût (type
et valeur, en chaîne parce que 25 cartes coûtent « X »), prérequis de clan et
de voie joints par `", "` (virgule et espace), exigence de discipline, texte,
dates, types et disciplines. Pour une carte de crypte, la casse du code krcg
porte le niveau (majuscules = supérieure) ; pour une carte de bibliothèque, ce
sont les disciplines requises, toujours en minuscules. La secte n'est pas
importée.

Relevé sur une copie de `backend/vtes.db` (révision `e2a7819dd4a2`) par
l'architecte, le back et pwa-offline : 4149 cartes (1785 de crypte, dont 1765
vampires et 20 *imbued*, et 2364 de bibliothèque), 51 extensions, 113
produits, 47 clans dont les 7 credos des *imbued*, aucun nom de clan à
virgule, 39 disciplines, 13 types, aucune secte ; 428 cartes traduites, chacune
en FR et en ES (856 lignes) ; 435 cartes titrées (13 valeurs, dont « 1 Vote »
et « 2 Votes ») ; 20 cartes bannies ; `legal_from` renseigné pour les 4149
cartes, au plus tard le 2026-02-28, si bien qu'aucune carte n'est aujourd'hui
« pas encore légale » ; 10 010 impressions, dont 676 sans image ; textes de 168
caractères en moyenne, 579 au plus, 0,7 Mo au total ; 1215 textes portent des
icônes de discipline en clair (`[pot]`, `[POT]`), 52 un texte `[MERGED]`. Le
fixture `backend/tests/fixtures/krcg_vtes.json` compte dix cartes, pas neuf
comme l'écrit CLAUDE.md (à corriger à l'étape F).

### Front

Le miroir du catalogue est le magasin Dexie `cards`
(`frontend/src/offline/vtes/db.ts`), clé `id`, index `foldedName` et
`category`. Une ligne (`CardRow`) porte `id`, `veknId`, `name`, `foldedName`,
`category`, `clanName`, `capacity`, `groupCode`, `advanced`, `imageUrl`,
`cardSetIds`, `latestCardSetId`. Il est rempli par `refreshCatalog`
(`frontend/src/offline/vtes/refresh.ts`), qui lit `GET /cartes` par pages de
200 (21 requêtes), puis vide et réécrit le magasin dans une transaction.

`cards` n'est pas lu que par la recherche : `readProjection`
(`frontend/src/offline/vtes/reads.ts`), appelée par presque toute lecture de
l'application (stock, decks, parties, picker, libellés), fait
`db.cards.toArray()` et n'en tire que le nom et la catégorie
(`overlay.ts`). Toute ligne alourdie dans `cards` serait désérialisée à chaque
lecture de projection, sur tous les écrans.

Historique des versions Dexie, à lire avec la multiplication par 10 que Dexie
applique (la version 5 déclarée est la version 50 d'IndexedDB) : la version 3
supprime `stock` et `deckCards` et ajoute `cardSets` ; la version 4 recrée
`stock` et `deckCards` avec l'extension dans leur clé, et vide `cards` et
`decks` dans son `upgrade` ; la version 5 ajoute les quatre magasins de la
pratique (déclarés dans `VTES_STORES_V4`), sans `upgrade`.

Le catalogue ne se relit que sur demande, par `refresh({ catalog: true })` :
`CatalogProvider` le télécharge une fois quand le magasin est vide et qu'on est
en ligne, et `CatalogPanel` offre le bouton « Mettre à jour le catalogue ». La
relecture du catalogue est la dernière étape de `runRefresh` (`runtime.ts`),
après huit autres miroirs, sous un délai global de 60 s, et toute la séquence
est rejouée jusqu'à trois fois si un verdict de sync tombe pendant la lecture.

La recherche locale est `searchCards` : un parcours complet du magasin par
`db.cards.filter(...)`, sur le nom replié et la catégorie, trié par nom en
comparaison binaire, tronqué. `CardPicker` l'appelle avec `limit: 20` et à
partir de deux lettres. `foldText` (`frontend/src/offline/core/foldText.ts`)
reproduit `fold_text` du back à l'identique.

L'onglet Chercher de la tab bar mobile est un `<span aria-disabled="true">`
sans `data-testid` (`frontend/src/App.tsx`, `TabBar`). La barre haute bureau a
cinq onglets (raccourcis `G A/C/D/P/S`) et ne rend plus le champ de recherche
global depuis le Lot 5c. Chaque page est chargée en `lazy`, et `App.tsx` tient
une liste de préchauffement qui la charge en ligne pour qu'elle s'ouvre ensuite
hors ligne. Le routeur à hash (`frontend/src/app/routes.ts`) ne lit dans la
query que le paramètre `action`.

`useKeyboardShortcuts` pose un écouteur `keydown` sur `document` par appel,
sans priorité ni `stopPropagation` : deux liaisons de la même touche se
déclenchent toutes les deux. `AddDeckCardForm` lie déjà `/` au champ du picker
du deckbuilder bureau, y compris dans un champ ; le chord `G A` (Atelier)
coexiste avec les touches simples de page, qui évitent toutes `A`, `C`, `D`,
`P` et `S`. Sur la Collection, `F` ouvre la feuille de filtres.

`CardImage` (`frontend/src/components/CardImage.tsx`) prend une seule URL, en
deux tailles (`sm`, `lg`), et se replie sur un pictogramme si l'URL manque,
si l'image échoue ou si l'appareil est hors ligne. Il sert au bureau seulement
(picker du deckbuilder, aperçu au survol de la Collection), toujours avec
l'image générique. Le picker mobile n'affiche aucune image. Pas d'attribut
`crossOrigin`, aucun `runtimeCaching` dans le service worker, pas de CSP.
`static.krcg.org` répond avec `Access-Control-Allow-Origin: *` sur ses images
(relevé par pwa-offline le 2026-11-03, un échantillon de 56 Ko).

`AddDeckCardForm` (`frontend/src/features/decks/AddDeckCardForm.tsx`) porte la
logique d'ajout du Lot 4b : copies, compteur « déjà possédées », disponibilité
par `useAvailableStock`, manque acquis par `acquiredQuantity`. Il envoie
`quantity: copies`, `copies` repartant de 1, alors que `deck_card.upsert`
remplace la quantité d'une ligne existante (`services/sync.py`, projection
dans `overlay.ts`). Frontend-react en déduit qu'« ajouter » une copie à une
ligne qui en compte deux pourrait l'écraser à une : défaut **présumé**, non
rejoué, qu'aucun test ne couvre. Il est vérifié en tout début de lot (D1a).

### Handoffs de design

Aucun handoff ne dessine l'écran Chercher. `MOBILE.md` ne décrit que l'onglet ;
`DESKTOP.md` décrit le champ de la barre haute (280 × 34, kbd `/`), les deux
formes d'URL d'image krcg, et demande d'ajouter `static.krcg.org` à la CSP
`img-src`, consigne sans objet tant qu'aucune CSP n'existe (à reprendre au
Lot 11). Les prototypes `Gurchon Hall Bureau.dc.html` et `TopBar.dc.html`
montrent le champ « Chercher une carte » ; `LOT7.md` le reprend sans l'activer.

### Tests et chiffres de départ

2276 tests pytest et 2 `xfail`, 752 tests vitest sur 49 fichiers, 59 tests
Playwright en 28 fichiers (8 `chromium`, 30 `real-backend`, 3 `desktop`, 18
`desktop-real-backend`), références CRAP vides des deux côtés. Tests voisins à
étendre plutôt qu'à recréer : `frontend/tests/e2e-real/search-parity.spec.ts`
(parité du repli contre le vrai back), `frontend/tests/unit/offline/vtesDbV5.test.ts`
(modèle du test de montée), `vtesReads.test.ts` (`searchCards`),
`offline-db-schema.spec.ts` (inspection de la base de compte),
`vtesLegacyAdoption.test.ts` (base d'avant le Lot 6). Comptage des
`data-testid` au 2026-11-03 par qa-tests : 403 identifiants statiques
distincts, 540 mentions brutes, contre 193 au Lot 5c ; la méthode est fixée à
l'étape E0.

## Propositions à trancher par l'utilisateur

| # | Sujet | Recommandation |
| --- | --- | --- |
| P1 | Filtres et leur sens | ceux du brief sans la secte, avec le titre ; disciplines de bibliothèque lues « jouable avec les disciplines cochées » |
| P2 | Nom cherché aussi dans les noms traduits | oui, noms FR et ES seulement |
| P3 | Recherche dans le texte | oui, texte anglais, champ distinct du nom |
| P4 | Filtres de statut | « possédée » et « dans ce deck », chacun à trois états |
| P5 | Filtres côté serveur sur `GET /cartes` | non |
| P6 | Handoff de design | oui, court, pour Chercher seulement |
| P7 | Images de carte | en ligne seulement ; image par impression lue à la demande |
| P8 | Champ de recherche global bureau | rétabli, il ouvre Chercher ; pas de sixième onglet |
| P9 | Tri des résultats | nom replié par défaut, tris secondaires par catégorie |
| P10 | Sens de « les deux » | un achat déclaré, quantité totale, proxies remplacés d'abord |
| P11 | Mise à jour du catalogue | relecture automatique une fois, quand les détails manquent |
| P12 | Chercher depuis un deck | oui, deck cible présélectionné |
| P13 | Secte | hors de ce lot, versée aux pistes |
| P14 | Stockage persistant (`navigator.storage.persist()`) | oui, un appel au démarrage, dans ce lot |

### P1. Quels filtres, et dans quel sens ?

Proposition :

- communs : nom, catégorie, extension (carte imprimée dans l'extension
  choisie), légalité à la date du jour (A5) ;
- crypte : clan (plusieurs, credos des *imbued* compris), groupe (plusieurs ;
  les deux cartes de groupe « Any » sont neutres et retenues quel que soit le
  groupe coché, comme dans la légalité du §5), capacité (minimum et maximum ;
  les *imbued* y rangent leur vie, ce que l'aide du filtre dit), disciplines
  avec leur niveau, *advanced* (oui, non, indifférent), titre (13 valeurs, dont
  « 1 Vote » et « 2 Votes ») ;
- bibliothèque : type (plusieurs), disciplines requises, clan requis
  (plusieurs), coût (type, valeur minimum et maximum, « X » à part), texte
  (P3) ;
- statut : P4.

Sens quand plusieurs valeurs sont cochées. Clan, groupe, type et titre :
l'une ou l'autre. Disciplines de crypte : toutes les disciplines cochées, au
niveau demandé, « inférieure » se lisant « au moins inférieure » (une
supérieure la contient) et « supérieure » se lisant « supérieure seulement ».
Disciplines de bibliothèque : la première version de ce plan proposait
« toutes », ce qui aurait écarté les 652 cartes `mono` dès que deux
disciplines étaient cochées. Le sens retenu, proposé par l'architecte, est
« jouable avec les disciplines cochées » : une carte `mono` répond si sa
discipline est cochée, une carte `choice` si l'une des siennes l'est, une
carte `combo` si toutes les siennes le sont ; une carte sans exigence est
écartée dès qu'un filtre de discipline est actif. Le niveau n'a pas de sens en
bibliothèque (aucun lien supérieur sur 1218).

Deux limites à écrire dans l'aide des filtres : le titre d'un vampire
*advanced* est celui de sa face de base, pas celui du texte fusionné
(*Alfred Benezri* reste `Bishop`) ; un prérequis de clan à deux clans
(`Tremere, Tremere antitribu`, quatre valeurs de ce genre) est découpé avant
comparaison, si bien que « Tremere » ne trouve pas « Tremere antitribu ».

### P2. Le nom se cherche-t-il aussi en français ?

Aujourd'hui le nom ne se cherche qu'en anglais. 428 cartes ont un nom FR et
ES. Recommandation : oui, les noms traduits seulement, pas les textes. Coût
mesuré : 130 Ko bruts, 14 Ko compressés, une requête SQL de plus par page.
Conséquence à accepter et à écrire dans la description de `listCards` comme
au §11 : la recherche locale trouvera « Majesté » quand `GET /cartes?q=majeste`
ne trouvera rien, `q` restant limité au nom anglais (P5). Aucun appelant
n'utilise `q` côté serveur aujourd'hui.

### P3. Recherche dans le texte de carte

Recommandation : oui, sur le texte anglais, replié par `foldText`, dans un
champ distinct du nom. C'est la seule façon d'approcher ce qui n'est pas
structuré : secte (P13), prérequis de titre ou de capacité des cartes de
bibliothèque, effets. Limite à écrire dans l'aide : les icônes de discipline
du texte (`[pot]`, `[POT]`) se replient de la même façon, la recherche ne
distingue donc pas leur niveau, et un mot court comme « pre » trouve toutes les
cartes à icône Presence.

### P4. Filtres de statut

Recommandation : « possédée » à trois états (possédée, non possédée,
indifférent), une carte comptant comme possédée dès qu'une de ses entrées a au
moins un exemplaire, toutes langues et extensions confondues ; « deck » à trois
états aussi (indifférent, dans ce deck, pas dans ce deck), un deck vivant à la
fois. Les deux lisent la projection locale (instantané plus file). Non retenu,
pour le lot Inventaires : « disponible » (possédée moins allouée).

### P5. Des filtres côté serveur ?

Recommandation : non. L'écran lit le miroir, en ligne comme hors ligne ; des
filtres serveur n'auraient aucun appelant et seraient une seconde écriture de
chaque filtre à tenir en parité. Sans eux, la seule règle VtES écrite deux
fois est la légalité d'une carte (A5), ce qui borne le risque de divergence à
une table de cas. `GET /cartes` garde `q`, `category` et `clan_id`, et
`search-parity.spec.ts` vérifie que le miroir et l'API rendent les mêmes
identifiants pour ces deux filtres-là.

### P6. Faut-il un handoff de design ?

Recommandation : oui, un handoff court limité à l'écran Chercher, comme au
Lot 7. Le brief à Claude Design (étape D0) demandera explicitement : la
ligne de résultat et la place d'une vignette, l'affichage par tranches d'une
liste qui peut compter 4149 lignes, la colonne de filtres au bureau et la
feuille de filtres en mobile, l'état « catalogue à mettre à jour » (filtres
avancés désactivés, message), la fiche de carte, la feuille d'ajout à trois
choix sous forme de contrôle segmenté, la taille de l'image statique du
picker mobile, la place de « Ajouter… » quand le clavier est ouvert, et le
libellé du champ global. Le reste réutilise `StockFilterSheet`, `Sheet`, le
tableau de la Collection et le maître/détail des Decks. Alternative : se
passer de handoff ; plus rapide, au risque d'un écran à reprendre.

### P7. Images de carte

Hors ligne : non. Précacher 4149 images, à une cinquantaine de kilo-octets
l'une (un seul échantillon mesuré, 56 Ko), dépasse 200 Mo ; `DESKTOP.md` va
dans le même sens. Hors ligne, `CardImage` garde son repli sur le pictogramme.
Un cache à l'exécution borné reste possible plus tard : `static.krcg.org`
répond avec `Access-Control-Allow-Origin: *`, mais il faudrait poser
`crossOrigin="anonymous"` sur l'image, faute de quoi la réponse mise en cache
serait opaque et comptée très au-delà de sa taille dans le quota.

Laquelle : l'image de l'impression quand on parle d'un exemplaire (aperçu au
survol de la Collection, extension choisie dans la feuille d'ajout), l'image
générique sinon (résultats, picker). Recommandation : l'image par impression
ne va pas dans le miroir ; elle se lit à la demande, en ligne, par
`GET /cartes/{id}`, appel qui sert aussi la fiche de carte (traductions,
impressions, texte d'ambiance, artiste). La réponse est gardée en mémoire par
carte pour la session, rien n'est lancé hors ligne, et l'appel passe par le
client typé. Une image peut manquer (676 impressions sur 10 010) ou échouer :
`CardImage` apprend alors à retomber sur l'image générique avant le
pictogramme, ce qui est une nouveauté du composant (deux sources), pas un
réglage. Il gagne aussi une taille pour le picker mobile, qui affiche l'image
de la carte choisie (ligne 8 de la table d'écarts du Lot 5c).

Alternative : mettre les URL par impression dans le miroir (A8, variante,
environ 0,8 Mo par base de compte).

### P8. Le champ de recherche global bureau

Recommandation : le champ revient dans la barre haute, libellé « Chercher une
carte (catalogue) » pour qu'on ne le confonde pas avec le champ local de la
Collection. Valider ouvre Chercher avec le texte dans le champ du nom ; sur
Chercher, le champ global écrit dans le champ de la page. `/` le focalise
depuis tout écran, la Collection comprise, sauf le deckbuilder, où `/` reste
au picker. Pas de sixième onglet ni de chord `G` + lettre. Le mobile n'a pas de
champ global, il a l'onglet (verdict du Lot 5c). Le fonctionnement du clavier
est fixé dans la section « Écrans ».

Alternative : un onglet « Chercher » dans la barre haute, avec `G H`.

### P9. Tri des résultats

Recommandation : tri par nom replié (`foldedName`), puis groupe et
identifiant, par défaut ; tris secondaires : capacité et groupe pour la
crypte, coût pour la bibliothèque, avec une règle écrite pour `cost_value`,
qui est une chaîne (valeur numérique croissante, « X » après les nombres, sans
coût en dernier). Le tri est local et ne touche ni le serveur ni les autres
listes, d'où un écart d'ordre avec la Collection, à accepter (la limite n° 5
du §11 reste ouverte ailleurs). Le tableau bureau peut réutiliser
`stockSort.ts` si la fonction reste générique.

### P10. Que veut dire « les deux » ?

La quantité portée par `deck_card.upsert` et par `stock.upsert` est un état,
pas un delta : chaque opération dit la valeur voulue. Le brief décrivait « les
deux » comme « entrée de stock puis ligne de deck ». L'acquisition du Lot 4b
fait déjà les deux en une opération, et le serveur l'accepte jusqu'au nombre
d'exemplaires réels que l'écriture ajoute à la ligne, même s'il en reste de
libres en collection (`backend/app/services/decks.py`, `_check_acquisition`).

Recommandation, pour *n* exemplaires saisis :

- Deck : la logique du deckbuilder, partagée (D1a) : exemplaires libres
  d'abord, manque acquis, reste en proxy si le deck le permet. La quantité
  envoyée est celle de la ligne après ajout (existant plus *n*, lu dans la
  projection) ;
- Collection : un `stock.upsert` à la quantité de la projection plus *n*. Deux
  appareils qui ajoutent chacun hors ligne finissent sur la dernière écriture,
  comme la feuille d'entrée de la Collection depuis le Lot 3 ;
- Les deux : un achat déclaré. Une seule opération `deck_card.upsert`, avec
  `acquired_quantity = n`, sans regarder ce qui est libre. Si la ligne joue
  déjà la carte en proxy, les *n* exemplaires remplacent d'abord des proxies
  (même `quantity`, `proxy_quantity` baissé d'autant), puis s'ajoutent au-delà
  (`quantity` augmentée du reste) : c'est ce qu'un joueur attend d'un achat
  pour un deck qui jouait la carte en proxy. L'écran le dit avant l'envoi.

Une seule opération pour « les deux » évite qu'un `stock.upsert` appliqué
suivi d'une ligne refusée laisse la collection à moitié écrite. Aucun type
d'opération nouveau. Alternative : « les deux » ajoute toujours des copies,
sans toucher aux proxies.

### P11. Le catalogue se met-il à jour seul ?

Recommandation : une relecture automatique, une fois, quand le magasin des
détails est vide ou incomplet et qu'on est en ligne ; sinon le comportement
actuel, bouton compris. Un rafraîchissement périodique, ou un `ETag` dérivé de
la date du dernier import qui ramènerait une relecture inutile à un 304, est
versé à `docs/pistes-evolution.md` à l'étape F.

### P12. Chercher depuis un deck

Recommandation : oui. Un lien « Chercher une carte pour ce deck » dans le
détail d'un deck non archivé (dans la colonne du picker au bureau, où il
apporte les filtres que le picker n'a pas) ouvre Chercher avec ce deck comme
cible de la feuille d'ajout et le filtre deck sur « pas dans ce deck ». La
cible voyage dans le hash (`#/chercher?deck=<clé>`), validée par la même forme
de clé que la route d'un deck ; une clé inconnue, un deck archivé ou supprimé
depuis sont ignorés sans erreur.

### P13. La secte

L'architecte a mesuré que les 1765 vampires commencent tous leur texte par
l'une des cinq sectes (Camarilla 606, Sabbat 600, Independent 374, Anarch 102,
Laibon 83), précédée au besoin de « Advanced, ». Restent à trancher six
vampires *advanced* dont le texte fusionné change de secte, et les 20
*imbued*, qui n'en ont pas. La dériver demanderait un changement d'import, une
table de cas, et un rejeu de l'import à l'étape F, sans migration (`sect` et
`card.sect_id` existent). Elle lèverait le point [à confirmer] du §6.

Recommandation : hors de ce lot, par choix de périmètre et non par
impossibilité ; versée aux pistes avec la mesure. La recherche dans le texte
(P3) en tient lieu, au prix de faux positifs que le filtre de catégorie
écarte. Si l'utilisateur la veut dans ce lot, l'architecte l'écrit à l'import
(jamais dans le client, pour qu'elle reste une donnée de catalogue), A3 perd
sa seconde moitié, et l'étape F gagne un rejeu de l'import sur `vtes.db`.

### P14. Demander un stockage persistant

Tant que `navigator.storage.persist()` n'est pas demandé, le navigateur peut
évincer la base IndexedDB sous pression de stockage, file d'attente comprise.
Ce n'est pas propre à ce lot, mais c'est le risque que le pilote veut
dérisquer, et le miroir s'alourdit. Recommandation : oui, dans ce lot, un
appel au démarrage (étape C1a), sans écran, le résultat noté dans le README de
la couche offline pour Barrin et vérifié à la main à l'étape F. Le
comportement varie selon les navigateurs (Chrome accorde selon des critères
d'usage, dont l'installation ; Firefox peut demander à l'utilisateur), point
[à vérifier] pendant C1a. Alternative : hors lot, versé aux pistes.

## Décisions de conception

Proposées par l'orchestrateur, revues et complétées par l'architecte et le
back. Elles peuvent être rouvertes à la demande de l'utilisateur.

### A1. Enrichir `CardListItem` en remontant des champs de `CardRead`

On remonte de `CardRead` vers `CardListItem` : `title`, `cost_type`,
`cost_value`, `clan_requirement`, `discipline_requirement`, `card_text`,
`banned_on`, `legal_from`, `types`, `discipline_links`. Restent propres à la
fiche : `sect`, `path`, `path_requirement`, `burn_option`, `trifle`,
`flavor_text`, `artist`, `printings`, `translations`. `CardSummary` ne change
pas.

`CardRead` garde le même ensemble de propriétés, de types et d'obligations ;
seul l'ordre des propriétés change, Pydantic rangeant les champs hérités en
premier, dans le contrat exporté comme dans la réponse JSON. La première
version de ce plan promettait une forme identique « au caractère près » :
c'est faux, et le test compare donc les ensembles et le schéma de chaque
propriété, plus un instantané JSON d'une fiche comparé par contenu.

Le service ne peut plus passer par `CardSummary(...).model_dump()`, qui
perdrait les champs nouveaux sans erreur : `list_cards` reprend le patron de
`get_card` (validation depuis l'objet, plus les champs calculés). Il précharge
`types` et `discipline_links` (`selectinload`), sans quoi une page coûte 401
requêtes au lieu de 5 ou 6. Il trie les types par nom et les disciplines par
abréviation, pour un miroir et des tests stables, sans migration.

`clan_requirement` reste une chaîne jointe par `", "`, pour ne pas casser
`CardRead` ; aucun des 47 clans ne contient de virgule, le client découpe sur
la virgule puis rogne. La description du champ, imprécise sur le séparateur,
est corrigée.

`discipline_links` garde sa forme d'objets (660 Ko bruts sur le catalogue,
contre 56 Ko pour une liste de codes) : la compression d'A2 ramène l'écart à
presque rien, et réutiliser les formes de `CardRead` évite un second
vocabulaire au contrat.

C'est un ajout pur : aucun champ ne disparaît ni ne change de type, et les
champs nouveaux sont obligatoires en sortie (§7, sorties complètes).

### A2. Compression des réponses, pagination inchangée

Mesures du back et de l'architecte sur une copie de `vtes.db`, lecture
complète en 21 pages de 200 :

| Forme | JSON | Compressé | Requêtes par page | Durée côté serveur |
| --- | --- | --- | --- | --- |
| actuelle | 1,08 Mo | 132 Ko | 3 à 4 | 1,2 à 1,4 s |
| enrichie (A1) | 3,28 Mo | 440 Ko | 5 à 6 | 1,6 à 2,0 s |
| enrichie, noms traduits (A7) | 3,41 Mo | 454 Ko | 6 à 7 | 1,7 à 1,9 s |

Sur une connexion de 1 Mbit/s utile, 3,28 Mo prennent environ 26 s ; à
500 kbit/s, une cinquantaine. La compression n'est donc pas un levier de
secours, c'est une livraison de B1 : `GZipMiddleware` avec un seuil de l'ordre
de 1000 octets, sur toute l'application. B1 vérifie qu'elle ne retire ni
l'exposition CORS de `Retry-After` ni `Cache-Control: private, no-store`, et
que le client de test et `openapi-fetch` décodent sans changement. Le risque de
type BREACH suppose un secret dans un corps compressé ; le jeton de session
n'apparaît dans aucun corps (§7). Le contrat OpenAPI ne change pas.

`limit` reste plafonné à 200 : une page unique ne réduirait aucun octet et
fixerait le coût d'un échec à tout recommencer. Côté client, la relecture du
catalogue sort de la séquence bornée à 60 s (section « Couche offline »).

### A3. Pas de migration, pas de changement d'import

Tout ce que A1 expose est déjà en base et importé ; le modèle reste à 25
tables et onze révisions. `scripts/import_catalog.py` ne change pas, sauf si
P13 fait dériver la secte ; même alors, aucune migration.

### A4. Le repli du texte se fait côté client

Le serveur ne cherche pas dans le texte (P5). Le client replie le texte avec
`foldText`, dont la parité avec Python est garantie par les tables générées.
Stocker le texte replié ou le recalculer au chargement en mémoire se décide à
l'étape C1b sur une mesure du coût de `foldText` sur 0,7 Mo de texte ; par
défaut, on le stocke.

### A5. Légalité d'une carte à une date : deux booléens, deux écritures

Une fonction pure d'une carte, `card_legality(banned_on, legal_from, on)`, rend
deux booléens, `banned` (à partir de `banned_on`, jour inclus) et
`not_yet_legal` (`legal_from` strictement postérieure à `on`), qui ne
s'excluent pas ; la carte est légale quand aucun des deux n'est vrai. La
première version de ce plan rendait un verdict unique, ce qui aurait obligé à
choisir une priorité et fait disparaître une carte de l'une des deux listes de
`/legalite`. Le cas existe : *Playing for Keeps*, bannie le 1995-11-01 et
légale à partir du 1996-01-14, est les deux à la fois entre ces dates.

`banned_cards` et `not_yet_legal_cards` (`vtes_rules.py`) peuvent s'appuyer sur
elle sans changer de signature ni de sortie, et `/legalite` liste toujours les
deux motifs. Dans Chercher, chaque option du filtre de légalité lit son propre
booléen (une carte bannie et pas encore légale répond aux deux), et la ligne de
résultat affiche « bannie » de préférence quand les deux sont vrais.

La jumelle TypeScript, dans `vtes/`, compare des chaînes ISO `YYYY-MM-DD`,
jamais des `Date`, ce qui écarte tout décalage de fuseau. Les deux fonctions
prennent la date d'évaluation en paramètre ; seul l'appelant lit l'horloge
(`todayUtc()` côté client). Cette date est la date UTC du jour, comme
`_today()` côté serveur (`datetime.now(UTC).date()`), pour qu'un verdict de
Chercher et un verdict de `/legalite` ne divergent pas entre minuit et une ou
deux heures du matin en France ; l'aide du filtre le dit.

Table de cas commune `backend/tests/fixtures/card_legality_cases.json`, sur le
patron de `certain_game_win_cases.json`, avec un champ `description` qui dit
qui la lit et des attendus `{banned, not_yet_legal}` : la veille, le jour et le
lendemain de chaque date ; deux dates absentes ; `banned_on` seule ;
`legal_from` seule ; `banned_on` avant, égale et après `legal_from` ; le cas
*Playing for Keeps*. Chaque test, pytest et vitest, vérifie que la table
contient au moins un cas par combinaison de résultats. Aucune carte de la base
n'étant aujourd'hui « pas encore légale », les tests de bout en bout de ce
filtre passent par des cartes synthétiques ou une date injectée.

### A6. Les filtres sont une fonction pure du client

`filterCards(cards, criteria, context)` dans `vtes/`, où `cards` est le
tableau déjà joint des deux magasins (pas des lignes Dexie, pour que le test
n'ait pas besoin de Dexie) et `context` porte ce qui ne vient pas du catalogue
(cartes possédées, lignes du deck choisi, date d'évaluation). Écrite comme une
table de fonctions, une par critère, composées par une fonction courte ; pas
de `switch` sur les clés des critères, que l'analyseur CRAP compterait par
`case`. Les ensembles précalculés (par clan, discipline, type) vivent dans un
objet distinct, construit avec la lecture mémoire et invalidé avec elle.

### A7. Noms traduits (si P2 est retenu)

Un champ `translated_names` sur `CardListItem` casserait la fiche : `CardRead`
en hériterait, `get_card` le chercherait par `getattr` sur l'objet `Card`, qui
ne l'a pas, et la fiche gagnerait un champ redondant avec `translations`.
Décision : la route de liste rend une classe fille de `CardListItem`, propre à
elle (nom au choix de l'architecte), qui ajoute `translated_names`, liste de
`{language_code, name}` ; `CardRead` n'en hérite pas et reste inchangée. Le
contrat gagne donc deux schémas (la classe fille et l'élément de liste). Les
codes de langue sortent en majuscules (`FR`, `ES`). Le service précharge les
traductions. Si P2 est écarté, A7 tombe.

### A8. Images par impression hors du contrat de liste

Si P7 est retenu, aucune évolution de contrat pour les images :
`GET /cartes/{id}` sert déjà `printings[].image_url`. Variante si l'usage
l'exige : une liste `{card_set_id, image_url}` dans la réponse de liste, à côté
de `card_set_ids`, que l'on garde. Reconstruire une URL d'impression à partir
de l'URL générique (motif `/card/set/<extension>/<carte>.jpg`) est écarté :
convention d'un tiers, non contractuelle.

### A9. `/sync` inchangé

Aucun type d'opération nouveau, aucun genre de référence nouveau, aucune
colonne nouvelle au journal. `docs/lot3-sync-contrat.md` n'a pas de section à
gagner. La sémantique des quantités (état, pas delta) est celle de P10.

### A10. Contrat : ce qui bouge, ce qui ne bouge pas

49 opérations sur 29 chemins, inchangé ; `API_ROUTE_PREFIXES` inchangé. Le
schéma `CardListItem` s'enrichit, l'ordre des propriétés de `CardRead` change,
et deux schémas apparaissent si P2 est retenu. La description de `listCards`
(noms traduits cherchés localement, pas par `q`) et la docstring de
`CardListItem` sont réécrites. La matrice d'autorisation n'a pas d'opération
nouvelle. Client TS régénéré ; le faux serveur des tests vitest
(`fakeServer.ts`) apprend les champs nouveaux et une pagination au-delà de 200
lignes.

## Couche offline

### Un magasin de détails en version 6

La première version de ce plan enrichissait `cards`. pwa-offline a montré que
`readProjection` relit `cards` en entier à chaque lecture de projection : les
textes et leurs replis y seraient désérialisés sur tous les écrans, Decks et
Synchronisation compris. Décision : `cards` ne change ni de forme ni de clé, et
la version 6 ajoute un magasin `cardDetails`, clé `id`, sans `upgrade`, sur le
patron de la version 5. Il porte ce que les filtres demandent : titre, coût,
prérequis de clan découpés, exigence et disciplines avec leur niveau, types,
texte et texte replié, dates de légalité, noms traduits repliés si P2. Les
constantes suivent la numérotation existante (`VTES_STORES_V5`, déclaré en
version 6), ce que le README explique.

Conséquences :

- aucune ligne n'est vidée ni à demi remplie : un téléphone qui exécute le
  nouveau code pour la première fois hors ligne, au club, garde son catalogue,
  son picker et ses libellés ;
- « miroir incomplet » se lit sans marqueur : `cardDetails` vide ou plus court
  que `cards` ;
- tant que le miroir est incomplet, l'écran Chercher garde la recherche par nom
  et la catégorie et désactive les autres filtres, légalité comprise, en disant
  pourquoi (« catalogue à mettre à jour, réseau requis »). Le filtre de
  légalité ne doit jamais lire une carte sans détails comme « sans date, donc
  légale » ;
- `refreshCatalog` écrit les deux magasins dans une seule transaction (`clear`
  puis `bulkPut` sur chacun), après avoir tout lu : une lecture interrompue,
  par une page en échec ou un 503, ne touche à aucun des deux ;
- si le serveur ne renvoie pas les champs nouveaux (nouveau front servi par le
  service worker face à un ancien back), `cards` est relue comme avant,
  `cardDetails` n'est pas écrit et le miroir reste incomplet, sans erreur
  bloquante. Le miroir n'est jamais déclaré complet sur une réponse ancienne ;
- la montée se joue dans chaque base de compte à son ouverture, et dans la base
  d'avant le Lot 6 quand `legacy.ts` l'ouvre ; elle ne touche ni la file, ni
  `settled`, ni les correspondances `client_ref`, ni les miroirs de la
  pratique ;
- à vérifier en C1a : l'ouverture par l'ancien code (onglet resté ouvert) d'une
  base montée en version 6 par le nouveau. `OfflineCoreDb` ferme déjà sa
  connexion sur `versionchange` ; le résultat est noté dans le README.

C'est le patron que le README propose à Barrin : un miroir qu'on enrichit se
double d'un magasin de détails à clé identique, ajouté sans migration.

### Relecture du catalogue hors de la séquence de 60 s

`runRefresh` met le catalogue en dernier, après huit miroirs, sous un délai
global de 60 s, et rejoue toute la séquence jusqu'à trois fois si un verdict de
sync tombe pendant la lecture. Avec un catalogue plus lourd, le délai peut
expirer pendant que la lecture continue, ce qui afficherait une erreur puis un
miroir qui se met à jour seul, et trois relectures de 21 pages ne sont pas
acceptables. Décision : `refresh({ catalog: true })` lance la relecture du
catalogue après les autres miroirs, avec son propre délai (de l'ordre de
180 s, réglage à fixer en C1a), et sans la rejouer si un verdict tombe en
route, le catalogue n'ayant aucun lien avec `settled`. Une lecture annulable
par `AbortController` serait plus propre et dépasse ce lot.

`CatalogProvider` déclenche la relecture automatique quand le miroir est vide
ou incomplet (P11), et non plus seulement quand `cards` est vide.

### Lecture et filtrage

Le filtre lui-même ne coûte rien : pwa-offline a mesuré environ 1 ms par passe
sur 4149 cartes (Node, sous-chaîne sur nom et texte repliés). Ce qui coûte :
la désérialisation des deux magasins, la jointure, la construction des
ensembles, et le rendu. Décision : le catalogue joint est chargé une fois en
mémoire et filtré en mémoire, sans parcours Dexie par frappe. Ce cache vit
dans le runtime, un par base de compte, jamais au niveau du module (deux
comptes successifs dans le même onglet verraient l'index de l'autre). Il est
relu quand `cards` ou `cardDetails` changent (fin de `refreshCatalog`, montée
de version) et jeté par `purge()` et à la fermeture de la base. Il vit dans
`vtes/` ; une aide générique ne passerait dans `core/` que si Barrin en a
l'usage. Les résultats s'affichent par tranches, sans bibliothèque de
virtualisation.

Le picker du deckbuilder et la feuille d'entrée de la Collection peuvent passer
par cette lecture mémoire en gardant leur comportement (`limit: 20`, deux
lettres au moins), que leurs tests couvrent.

### Projections

Les filtres de statut (P4) lisent la projection existante : une carte ajoutée
hors ligne apparaît possédée tout de suite. La disponibilité affichée dans la
feuille d'ajout vient de `useAvailableStock`, comme dans le deckbuilder ; en
« Collection » seule, il n'y a pas de deck à exclure.

### Poids et persistance

Mesuré par pwa-offline sur `vtes.db` : de 1,5 à 2,5 Mo par base de compte
pour le catalogue enrichi, texte replié compris (la première version de ce plan
avançait 3 à 5 Mo). À multiplier par le nombre de comptes d'un appareil,
sans enjeu pour les quotas. P14 traite le risque d'éviction de la base.

## Écrans

Les écrans suivent le handoff si P6 est retenu ; ce qui suit est l'intention
fonctionnelle à lui transmettre, et les contraintes que le code impose.

### Routes

`#/chercher`, avec dans la query du hash le texte cherché (`q`) et, si P12, le
deck cible (`deck`). Ces deux paramètres sont lus à l'arrivée (champ global,
lien depuis un deck) ; ensuite la page n'écrit plus dans l'adresse que par
`history.replaceState`, comme `consumeIntent`, sans entrée d'historique ni
`hashchange` par frappe. `parseHash` apprend à les lire sans les confondre avec
l'intention `action`. La fiche s'ouvre dans une feuille (mobile) ou dans la
colonne de détail (bureau), sans route propre.

La règle de `frontend/src/offline/apiRoutes.ts` vise les chemins : un chemin
qui porte le nom d'une ressource de l'API ne s'ouvre plus hors ligne au
rechargement. Les routes de l'application vivent dans le hash, jamais envoyé
au serveur, si bien que `#/decks` ou `#/parties` existent sans risque. On
préfère `#/chercher` à `#/cartes`, techniquement possible, pour ne pas laisser
croire que la règle est levée.

La page Chercher est ajoutée au chargement paresseux et à la liste de
préchauffement d'`App.tsx`, faute de quoi ouvrir l'onglet pour la première fois
juste après une coupure renverrait l'écran d'erreur de route ; `NavKey` et
`navActive` l'apprennent aussi.

### Mobile

Onglet Chercher activé (`nav-search`, identifiant créé). En tête, le champ du
nom, puis des puces de catégorie et un bouton « Filtres » qui ouvre une feuille
sur le patron de `StockFilterSheet`, avec le nombre de filtres actifs. Une
ligne de résultat : nom (`cardLabel`), méta selon la catégorie (clan,
capacité, disciplines, supérieures en majuscules ; ou type, coût, prérequis),
mention « 3 en collection » si possédée, mention de légalité. Un toucher ouvre
la fiche : image (en ligne), texte, prérequis, légalité, impressions,
exemplaires possédés par langue et extension, decks qui la jouent, bouton
« Ajouter… ». États : catalogue absent (avec `CatalogPanel`), catalogue à
mettre à jour, aucun résultat, hors ligne.

### Bureau

Filtres en colonne à gauche, toujours visibles ; résultats au centre en
tableau triable ; fiche à droite pour la ligne sélectionnée, comme le
maître/détail des Decks ; aperçu d'image au survol d'un nom, comme la
Collection. Raccourcis de page : `F` focalise la colonne de filtres (sur la
Collection, `F` ouvre la feuille de filtres : même lettre, même intention) ;
`↑↓` parcourent ; `↵` ouvre la fiche, lié avec
`ignoreTarget: isInteractiveTarget` pour ne pas voler `Entrée` à un bouton ou
un filtre ; `N` ouvre la feuille d'ajout. La première version proposait `A`,
qui entre en collision avec le chord `G A` ; les touches simples de page ne
prennent jamais `A`, `C`, `D`, `P` ni `S`.

### Clavier : le `/` global

Chaque appel de `useKeyboardShortcuts` pose son propre écouteur ; il faut donc
qu'un seul `/` existe à la fois. Décision :

- la liaison globale de `/` vit dans `App`, avec `enabled: false` sur la route
  du deckbuilder, où `/` reste au picker. Sur un deck archivé, qui n'a pas de
  picker, `/` reste sans effet ;
- elle est inerte dans un champ (pas d'`allowInEditableTarget`), pour qu'on
  puisse taper « / », et sous une feuille ouverte (cible dans un
  `[role="dialog"]`, par `ignoreTarget`) ;
- sur Chercher, la page ne lie pas `/` : le global focalise le champ du nom de
  la page (par une référence exposée par la page) au lieu de naviguer ;
- un test vitest compte les appels : une frappe, un seul `onTrigger`.

### Feuille d'ajout

Contrôle segmenté à trois choix exclusifs (« Deck », « Collection », « Les
deux »), selon P10. La logique d'`AddDeckCardForm` est extraite dans un hook
partagé à l'étape D1a, qui prend la carte en entrée (dans Chercher, elle est
déjà choisie) et ne porte ni `chosen` ni `pick`. Le calcul de l'opération à
envoyer est une fonction pure, `buildAddOperation(choix, état)`, testée à part.
Un deck archivé n'est pas proposé. La feuille de Chercher prend le préfixe
`search-add-*` et ne réutilise pas les `deck-card-form-*` du deckbuilder, que
vitest et six e2e emploient. Rien n'attend le réseau.

### Images et champ global

`CardImage` gagne une seconde source (impression puis générique) et une taille
pour le picker mobile (P7). La lecture de `GET /cartes/{id}` est faite par un
hook qui garde la réponse en mémoire par carte pour la session, ne lance rien
hors ligne, et abandonne à la sortie du survol. Le champ global réapparaît dans
`TopBar`, et le commentaire du Lot 5c qui le remplace disparaît.

Les `data-testid` existants ne disparaissent pas ; les nouveaux suivent les
préfixes `search-*`, `search-add-*`, `nav-search`, `topbar-search`, et leur
liste est fixée dans le brief de D1b par qa-tests (E0), pour que les e2e ne
dépendent pas d'un nom tardif.

## Découpage en étapes ordonnées

| Étape | Agent | Contenu | Dépend de |
| --- | --- | --- | --- |
| A0 | orchestrateur, utilisateur | P1 à P14 tranchés, brief `docs/lot-chercher-brief.md` mis à jour | rien |
| E0 | qa-tests | recensement des `data-testid` avec sa méthode (commande consignée, liste triée gardée pour la clôture), liste des identifiants nouveaux pour D1b | rien |
| A1 | architecte-contrat, qa-tests | `CardListItem` enrichi (A1), classe fille et noms traduits si P2 (A7), `card_legality` et `card_legality_cases.json` avec leurs tests pytest (A5), export du contrat, client TS régénéré ; dérivation de la secte si P13 | A0 |
| B1 | backend-fastapi | `list_cards` sur le patron de `get_card`, préchargements et tri, `GZipMiddleware`, tests (champs, N+1, fiche, compression), mesures sur `vtes.db` ; contrôle CRAP | A1 |
| C1a | pwa-offline | `cardDetails` en version 6, `refreshCatalog` sur deux magasins, miroir incomplet, relecture hors des 60 s et déclenchement P11, ancien serveur, ancien code face à une base 6, `persist()` si P14, README ; contrôle CRAP | A1 |
| C1b | pwa-offline | légalité TS sur la table commune, `filterCards`, lecture mémoire dans le runtime, hooks, mesure de `foldText` (A4) ; contrôle CRAP | A1 |
| E1 | qa-tests | fabrique de catalogue synthétique, table de cas de `filterCards` avec pwa-offline, faux serveur paginé au-delà de 200 lignes, squelette du test de montée 5 vers 6 | A1 |
| D0 | orchestrateur, utilisateur, Claude Design | brief de design, puis handoff de l'écran Chercher versé dans `docs/design-handoff/` (si P6) | A0 |
| D1a | frontend-react | extraction du hook d'`AddDeckCardForm`, refactor pur, test qui reproduit ou infirme l'écrasement d'une ligne existante (état de départ) ; contrôle CRAP | ouverture du lot |
| D1b | frontend-react | route, onglet, chargement paresseux et préchauffement, page avec la recherche par nom existante, mobile et bureau | A0, E0 |
| D1c | frontend-react | filtres, tri et fiche de carte, mobile puis bureau ; contrôle CRAP | C1a, C1b, D0, D1b |
| D2 | frontend-react | feuille d'ajout (P10, `buildAddOperation`) ; contrôle CRAP | D1a, D1c |
| D3 | frontend-react | champ global et `/`, `CardImage` à deux sources et taille mobile, image du picker mobile, lecture à la demande, entrée depuis un deck (P12) ; contrôle CRAP | D2 |
| E2 | qa-tests | e2e de recherche et de filtres aux deux largeurs, scénario de la base Dexie 5, extension de `search-parity.spec.ts` | D1c |
| E3 | qa-tests | e2e d'ajout, `/`, images, P12 ; mesures à la main ; décompte final et recensement de clôture | D3 |
| F | orchestrateur | CLAUDE.md (§6, §7, §11, §12, fixture à dix cartes), brief clos, pistes versées (`ETag`, secte si P13 la renvoie, `persist()` si P14 l'écarte), vérification à la main sur téléphone | E3 |

B1, C1a, C1b et E1 avancent en parallèle une fois le contrat exporté à A1. D1a
et D1b ne dépendent ni du contrat ni du handoff : D1a peut commencer dès
l'ouverture du lot, aucune proposition ne le touchant, et D1b dès A0 ; D1b
s'appuie sur la recherche par nom existante (`useLocalCardSearch`). D0 est
sur le chemin critique de D1c et D2 seulement. Si P6 est écarté, D0 disparaît.
Si D1a confirme le défaut d'écrasement, sa correction (« Ajouter » ajoute à la
ligne existante) fait partie de D1a, puisque le hook partagé en dépend ; elle
est signalée à l'utilisateur et consignée au §11 à l'étape F. Aucune étape ne
migre `backend/vtes.db`.

## Tests attendus

### Côté back

- `GET /cartes` rend les champs nouveaux avec leurs valeurs sur le fixture
  (crypte à disciplines supérieures, bibliothèque `mono`, `choice` et
  `combo`, coût « X », carte bannie, type multiple) ; une carte créée en test
  avec `legal_from` au lendemain de la date injectée, plutôt qu'une date du
  fixture qui vieillit ; une carte sans texte ; un prérequis à deux clans ;
- nombre de requêtes de lecture égal pour `limit=1` et `limit=10`, et borné
  (sept au plus avec A7), sur le patron du compteur `before_cursor_execute` de
  `test_play_routes.py` ;
- `GET /cartes/{id}` : instantané JSON d'une fiche comparé par contenu avant et
  après, et schéma comparé propriété par propriété ;
- types et disciplines rendus dans l'ordre imposé par le service ;
- réponse compressée quand le client l'accepte, `Retry-After` toujours exposé,
  `Cache-Control` inchangé ;
- `card_legality` sur `card_legality_cases.json`, au moins un cas par
  combinaison de résultats ; `banned_cards`, `not_yet_legal_cards` et
  `/legalite` inchangés, *Playing for Keeps* compris ; un test de bout en bout
  avec `_today` remplacé, qui compare `/legalite` au verdict attendu ;
- contrat exporté à jour (`export_openapi.py --check`) ; noms traduits si P2.

### Côté front

- montée 5 vers 6 sur le patron de `vtesDbV5.test.ts` : base écrite en
  version 5, rouverte par le code du lot, `cards`, file, `settled`,
  correspondances et miroirs de la pratique intacts, `cardDetails` vide ;
  double ouverture sans effet ; base d'avant le Lot 6 montée aussi ; ancien
  code face à une base 6 ;
- `refreshCatalog` : deux magasins écrits ensemble ; lecture interrompue à la
  page 7 sur 21 ou par un 503 sans rien toucher ; ancien serveur sans les
  champs nouveaux (miroir incomplet, pas d'erreur) ; deux comptes, deux bases,
  la relecture de l'un ne touche pas l'autre (ou couverture confirmée par
  `vtesAccount.test.ts`) ;
- `filterCards` sur sa table de cas, construite sur un catalogue synthétique
  (fabrique de lignes à partir de la forme `CardListItem`), une carte positive
  et une négative par critère et par sens de combinaison ; le fixture krcg
  n'a ni carte *advanced* ni prérequis de clan ;
- légalité TS sur la table commune ; test d'horloge avec `vi.setSystemTime`
  autour de minuit UTC, fuseau de Paris, sur une `legal_from` ;
- filtre de légalité désactivé, et non permissif, sur un miroir incomplet ;
- lecture mémoire : aucun parcours Dexie par frappe (compte des appels, pas de
  chronomètre), relecture après `refreshCatalog` et après la montée, sur un
  catalogue synthétique de 4149 lignes avec texte ;
- recherche dans le texte replié (accents, casse, jokers littéraux, icônes de
  discipline) ; affichage par tranches en Testing Library ;
- `buildAddOperation` pour les trois choix, ligne existante, ligne avec
  proxies ; le test de D1a sur l'écrasement d'une ligne ;
- `/` : un seul `onTrigger` par frappe ; le picker garde `/` sur le
  deckbuilder ; inerte dans un champ et sous une feuille ;
- tests qui comptent les onglets de la tab bar mis à jour.

La couverture qui compte pour le score CRAP est celle de vitest seul : la page,
la feuille et le hook sont couverts par Testing Library, un e2e ne les
remplace pas.

### Playwright

Contre le vrai back, avec interception de `static.krcg.org` par `page.route`
(image fixe servie en ligne, aucune requête tentée hors ligne, pictogramme
vérifié), pour ne pas dépendre d'un réseau externe :

1. `real-backend`, 390 × 844 : couper le réseau, chercher avec trois filtres
   combinés qui ne rendent qu'une carte du fixture (clan Tremere, discipline
   supérieure, un mot du texte), ouvrir la fiche, ajouter une carte à un deck
   et une autre aux deux, recharger hors ligne et tout retrouver, revenir en
   ligne, vérifier le rejeu et la collection côté serveur ;
2. `desktop-real-backend`, 1440 × 900 : le même parcours, plus `/` puis saisie
   dans le champ global, et `/` qui reste au picker du deckbuilder ;
3. `real-backend` : une base Dexie à la version 5 (version 50 en IndexedDB
   brut) avec un catalogue ancien, amorcée avant que le code du lot ne
   l'ouvre, sur une page déjà contrôlée par le service worker, puis ouverte
   hors ligne : picker utilisable, filtres avancés désactivés avec leur
   message, tout s'active au retour du réseau. L'amorçage est la partie
   délicate (compte connu après connexion, `AuthGate` démarrant sur la copie
   locale de `GET /moi`), décrite par qa-tests dans E2 ;
4. `desktop-real-backend` : variante bureau du scénario 3, ou justification
   écrite de son absence ;
5. P12, si retenu : un test par largeur ;
6. `search-parity.spec.ts` étendu au champ texte, aux noms traduits et aux
   filtres `category` et `clan_id`.

Le décompte se vérifie par `--list` et à l'exécution (précaution OneDrive,
§11, Lot 4).

### Mesures à la main

Consignées dans ce plan en E3, sans valeur de réussite : durée de la lecture
complète du catalogue en ligne, sur le téléphone ; poids de la base de compte
par `navigator.storage.estimate()` ; durée du chargement à froid (lecture des
deux magasins, jointure, ensembles) ; durée d'un filtrage par frappe et du
rendu ; durée de `readProjection` avant et après le lot, sur la base de
développement, pour vérifier que `cards` n'a pas grossi.

### Score CRAP

Contrôle à la fin de B1, C1a, C1b, D1a, D1c, D2 et D3, pas seulement en E,
pour que le découpage revienne à l'agent de couche avant d'empiler. Fonctions
à risque : `filterCards` et sa composition, la lecture mémoire, le hook extrait
d'`AddDeckCardForm`, `buildAddOperation`, la page Chercher (découpée en
sous-composants dès sa première version, comme au Lot 7). Aucune entrée ajoutée
aux références `docs/qa-baselines/crap/`.

## Risques et points d'attention

- Poids du catalogue sur une connexion lente : 3,28 Mo bruts, 440 Ko
  compressés. Couvert par la compression (A2) et le délai propre de la
  relecture.
- Téléphone sans catalogue au club : couvert par le magasin de détails ajouté
  sans vidage. À vérifier à la main à l'étape F (mise à jour du service worker
  en ligne, puis ouverture en mode avion).
- Régression de toutes les lectures : éviter que `cards` grossisse est la
  raison du magasin séparé ; mesure de `readProjection` avant et après.
- Défaut présumé d'`AddDeckCardForm` : une copie ajoutée à une ligne existante
  pourrait en écraser la quantité. Non établi ; D1a le reproduit ou l'infirme
  avant toute extraction.
- Deux écritures de la légalité d'une carte : Python et TypeScript, deux
  booléens, une table de cas commune ; toute évolution touche les deux. La
  date UTC est un choix à expliquer à l'écran.
- Sens des filtres de disciplines : c'est là qu'un résultat peut surprendre ;
  tranché en P1, écrit une fois, couvert par la table de cas.
- Secte absente si P13 la renvoie : la recherche dans le texte la remplace
  imparfaitement.
- Images servies par un tiers : `static.krcg.org` peut être lent ou
  indisponible ; le repli sur l'image générique puis le pictogramme existe.
- Ancien onglet ouvert pendant la montée : à vérifier en C1a ; la fermeture
  sur `versionchange` existe déjà.
- Éviction de la base : couverte par P14 si elle est retenue.
- Catalogue copié par compte : sans enjeu de quota ; pour Barrin, un miroir
  partagé entre comptes demanderait une base commune hors de la base par
  compte (piste, pas décision).
- Catalogue jamais rafraîchi après un import serveur : inchangé hors de la
  relecture de P11 ; l'`ETag` est versé aux pistes.
- Données krcg : les filtres rendent visibles des défauts jusqu'ici muets ; ils
  sont signalés, pas corrigés à la main (§11, Lot 2).

## Critère de fin de lot

- P1 à P14 tranchés, reportés dans ce plan et, pour ce qui dure, au §11 de
  CLAUDE.md ; brief `docs/lot-chercher-brief.md` marqué clos.
- Handoff versé dans `docs/design-handoff/` si P6 est retenu, et écrans
  conformes en mobile et en bureau.
- Contrat à 49 opérations, `CardListItem` enrichi, client TS régénéré,
  `API_ROUTE_PREFIXES` inchangé ; réponses compressées.
- `uv run pytest` vert à 2276 + N tests, les deux `xfail` inchangés, `ruff
  check` propre ; `npm run lint`, `npx tsc --noEmit -p tsconfig.app.json` et
  `npm run test` propres, à 752 + N tests sur 49 + M fichiers ; Playwright vert
  à au moins 64 tests, ventilés 8 `chromium`, au moins 33 `real-backend`
  (scénarios 1, 3 et 5), 3 `desktop`, au moins 20 `desktop-real-backend`
  (scénarios 2 et 5, plus 4 ou sa justification), le scénario 6 s'ajoutant à
  `real-backend` s'il crée des tests ; N, M et les totaux exacts sont relevés
  en E3.
- `card_legality_cases.json` lue par pytest et par vitest.
- Contrôles CRAP verts (`scripts/run.ps1 crap`), références `backend.json` et
  `frontend.json` toujours vides.
- Recensement des `data-testid` fait avec la même méthode qu'à E0, aucun
  identifiant disparu.
- Les deux points renvoyés par le Lot 5c soldés : image de carte (dont la
  forme statique du picker mobile) et champ de recherche global.
- Vérification à la main sur téléphone : mise à jour de l'application en ligne,
  puis en mode avion, une recherche filtrée et un ajout à un deck, synchronisés
  au retour du réseau ; résultat de `persist()` si P14.
- CLAUDE.md à jour : en-tête, §6 (point ouvert de la secte selon P13), §7
  (`CardListItem`, compression), §11 (décisions et limites du lot, fixture à
  dix cartes), §12 (lot livré, Lot 8 suivant).

## Revue des agents

Les cinq agents ont relu le plan le 2026-11-03, chacun dans son périmètre, avec
des vérifications dans le code et sur une copie de `backend/vtes.db` en
lecture seule. Les cinq rendent « validé sous réserves ». Toutes les réserves
sont levées par le texte ci-dessus ; ce qui a été écarté l'est avec sa raison.

### architecte-contrat

Verdict : validé sous réserves.

Il confirme qu'aucune migration n'est nécessaire, que le contrat reste à 49
opérations et que `/sync` ne bouge pas. Ses réserves : `CardRead` change
l'ordre de ses propriétés, si bien que « au caractère près » est faux ; la
compression doit être livrée et non gardée en secours ; une légalité de carte à
verdict unique ferait disparaître *Playing for Keeps* de l'une des deux listes
de `/legalite` ; le sens « toutes » des disciplines de bibliothèque écarterait
toutes les cartes `mono`. Il apporte les mesures de poids, le séparateur
`", "` et les clans à deux valeurs, le tri des types et disciplines, la limite
des icônes `[pot]` dans le texte, les données des titres, la faisabilité
mesurée de la secte, et la question des proxies dans « les deux ».

Intégré : A1 (ordre des propriétés, patron de `get_card`, tri, séparateur,
clans vérifiés), A2 (compression livrée en B1, `limit` inchangé), A3 (secte
sans migration), A5 (deux booléens, *Playing for Keeps*, chaînes ISO, date
UTC), A7 et A10 (schémas nouveaux, description de `listCards`), P1 (sens
« jouable avec », niveaux de crypte, groupe Any, capacité des *imbued*, credos,
titres et leur limite), P3 (icônes), P10 (proxies remplacés d'abord, quantité
absolue de `stock.upsert`), P13 (nouvelle proposition), fixture à dix cartes
(étape F). Écarté : la forme compacte de `discipline_links`, qu'il ne posait
pas en réserve et que la compression rend inutile ; limiter la compression aux
routes publiques, aucun corps ne portant de secret.

### backend-fastapi

Verdict : validé sous réserves.

Ses mesures (3,28 Mo bruts, 440 Ko compressés, 401 requêtes par page sans
préchargement, 5 ou 6 avec) font de la compression une mesure du lot. Il
relève que l'assemblage par `model_dump` perdrait les champs nouveaux, que
`translated_names` sur `CardListItem` ferait lever `get_card`, que la
précédence des motifs de légalité manque, qu'aucune carte n'est aujourd'hui
« pas encore légale », et qu'il faut écrire « environ 1 Mo » pour la forme
actuelle (1,08 Mo mesuré). Il demande un test N+1 comparatif et un instantané
de la fiche.

Intégré : A1 (patron de `get_card`, préchargements), A2 (tableau de mesures,
`GZipMiddleware` en B1, vérifications CORS et `Cache-Control`), A5
(précédence d'affichage, fonctions de deck inchangées, cartes synthétiques),
A7 (classe fille propre à la route de liste, la seconde de ses deux
solutions, qui garde la fiche inchangée), tests côté back, pistes (`ETag`).
Écarté : confier la compression au proxy du Lot 11, le pilote tournant
aujourd'hui sans proxy ; la première solution d'A7 (champ calculé exclu de
`get_card`), qui laissait `CardRead` hériter d'un champ redondant ; le tri des
liens par identifiant, au profit d'un tri par nom et abréviation, utile à
l'affichage.

### pwa-offline

Verdict : validé sous réserves.

Sa remarque principale renverse la conception du miroir : `readProjection`
relit `cards` à chaque lecture de projection, si bien qu'enrichir `cards`
ralentirait toute l'application. Il propose un magasin `cardDetails` ajouté en
version 6 sans `upgrade`, « incomplet » se lisant à son contenu, l'écriture des
deux magasins dans une transaction, la sortie de la relecture du catalogue
hors du délai de 60 s et de la relecture triple, et le refus de déclarer
complet un miroir lu sur un ancien serveur. Il corrige la description des
versions 3 et 4, rappelle la multiplication par 10 de Dexie, mesure le filtre
(1 ms) et le poids (1,5 à 2,5 Mo par base), vérifie CORS sur `static.krcg.org`
et la nécessité de `crossOrigin`, constate que deux `/` se déclenchent tous
deux, et propose `persist()`.

Intégré : section « Couche offline » réécrite (magasin de détails, relecture
hors des 60 s, ancien serveur, ancien code, cache dans le runtime, purge),
état de départ (versions, `readProjection`, Dexie ×10), P7 (CORS,
`crossOrigin`), P14 (nouvelle proposition), clavier, découpage de C1 en C1a et
C1b, tests et mesures demandés. Écarté pour ce lot : la lecture annulable par
`AbortController`, qu'il plaçait lui-même hors lot ; une aide générique dans
`core/`, faute d'usage connu chez Barrin.

### frontend-react

Verdict : validé sous réserves.

Il établit que le `/` n'a pas de départage, que `A` entre en collision avec le
chord `G A`, et que la quantité de `deck_card.upsert` est un état : la feuille
doit envoyer la quantité totale, et `AddDeckCardForm` pourrait écraser une
ligne existante (défaut présumé, non rejoué). Il relève l'oubli du chargement
paresseux et du préchauffement, l'absence de repli et de taille mobile dans
`CardImage`, le sens réel de `F` sur la Collection, et propose de découper D1,
d'extraire le hook en refactor pur avant tout, de lire le hash à l'arrivée puis
d'écrire par `replaceState`, un filtre deck à trois états, un préfixe
`search-add-*` et une fonction `buildAddOperation`.

Intégré : section « Écrans » (routes, chargement paresseux, clavier, feuille
d'ajout, images), P8 (libellé, `/` sur la Collection vers Chercher), P9 (règle
de tri du coût, `stockSort.ts`), P10 (quantité totale), P12 (validation de la
clé, deck archivé, lien dans la colonne du picker), P4 (trois états), P6
(contenu du brief de design), découpage D1a, D1b, D1c, D2, D3, état de départ
(défaut présumé, à vérifier en D1a). Écarté : faire focaliser par `/` le champ
local de la Collection, au profit d'un libellé sans ambiguïté, comme il le
recommandait ; un petit magasin pour les fiches lues en ligne, la mémoire de
session suffisant.

### qa-tests

Verdict : validé sous réserves.

Ses réserves portent sur la sémantique d'A5 (deux booléens, table minimale,
chaînes ISO, date en paramètre, test d'horloge, table qui couvre chaque
résultat), la fixture (dix cartes, trop pauvre pour les filtres : catalogue
synthétique), et l'absence de tests de volume et de cas d'échec. Il cite les
tests voisins à étendre, décrit l'amorçage délicat du scénario sur base
version 5, demande l'interception des images, le décompte visé par projet, un
contrôle CRAP à chaque étape, un recensement des `data-testid` avec sa méthode
(403 identifiants aujourd'hui), et un découpage de son étape en E1, E2, E3.

Intégré : A5, tests côté back et côté front, scénarios Playwright numérotés,
mesures définies, score CRAP, critère de fin avec totaux visés, étapes E0 à
E3, état de départ (tests voisins, chiffres de `data-testid`), fixture à dix
cartes (CLAUDE.md à l'étape F). Écarté : un seuil de temps dans un test,
remplacé par le compte des parcours Dexie, qu'il proposait lui-même. Non
tranché ici, renvoyé à l'étape E1 avec l'architecte : ajouter ou non deux
cartes au fixture krcg (prérequis de clan, *advanced*), ce qui changerait tous
les compteurs d'import ; par défaut, non, le catalogue synthétique couvrant
ces critères.

## Validation de l'orchestrateur

Verdict : validé. Les cinq revues convergent, aucune ne conteste la portée ni
l'architecture du lot ; leurs réserves ont toutes été intégrées ou écartées
avec leur raison. Le plan change sur trois points de conception : le miroir se
double d'un magasin de détails au lieu de grossir, la compression est livrée,
la légalité d'une carte rend deux booléens.

Propositions qui restent à trancher par l'utilisateur :

| # | Sujet | Recommandation |
| --- | --- | --- |
| P1 | Filtres et leur sens | ceux du brief sans la secte, avec le titre ; disciplines de bibliothèque « jouable avec les disciplines cochées » |
| P2 | Noms traduits | oui, noms FR et ES seulement |
| P3 | Texte de carte | oui, anglais, champ distinct |
| P4 | Statut | « possédée » et « dans ce deck » à trois états |
| P5 | Filtres serveur | non |
| P6 | Handoff de design | oui, court |
| P7 | Images | en ligne seulement, image par impression lue à la demande |
| P8 | Champ global bureau | rétabli, ouvre Chercher, pas de sixième onglet |
| P9 | Tri | nom replié par défaut |
| P10 | « Les deux » | achat déclaré, quantité totale, proxies remplacés d'abord |
| P11 | Mise à jour du catalogue | relecture automatique une fois |
| P12 | Chercher depuis un deck | oui |
| P13 | Secte | hors de ce lot, versée aux pistes |
| P14 | Stockage persistant | oui, dans ce lot |

Condition d'ouverture de l'étape A1 : l'utilisateur a tranché P1 (le titre
entre au contrat), P2 (A7 ajoute ou non deux schémas), P5, P7 (A8) et P13 (la
secte toucherait l'import). Les autres propositions peuvent l'être jusqu'à
l'étape qui les emploie : P6 avant D0, P14 avant C1a, P11 avant C1a, P4, P8,
P9, P10 et P12 avant D1c. L'étape E0 et l'étape D1a, qui ne dépendent d'aucune
proposition, peuvent commencer dès que l'utilisateur donne son accord pour
ouvrir le lot.
