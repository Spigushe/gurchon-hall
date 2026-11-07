# Lot Affichage des decks : tableaux crypte / bibliothèque

Statut : **lot clos le 2026-11-06.** Plan rédigé le même jour ; A0 close aussitôt,
P1 à P10 et A3 tranchées par l'utilisateur (« Tranché à A0 » sous chaque
proposition), P5 complété par la capture VDB pour la crypte au téléphone, puis
validé à l'écran à la fin de D5. Livraisons et clôture en fin de fichier.

Rédigé sur la branche `design-affichage-decks`, partie de `e69ecec` (lot
Chercher fusionné, #54), à partir du handoff reçu le même jour et versé dans
`docs/design-handoff/DECKS.md`. Ce handoff n'a pas été commandé par un brief,
contrairement à ceux du Lot 7 et du lot Chercher : il ignore une partie de ce
que le code sait déjà faire, et sa section « Raccord au code » liste neuf
points que ce plan reprend.

Le nom « lot Affichage des decks » ne décale pas la numérotation des Lots 8 à
11. Il se place entre le lot Chercher et le Lot 8, sauf décision contraire de
l'utilisateur (P10).

## Portée

Le lot remplace les deux façons dont l'application montre aujourd'hui la
composition d'un deck par un seul composant, `DeckTables`, en deux tableaux à
icônes :

1. l'aperçu bureau de `#/decks` (`DeckCompositionColumns`, `DecksPage.tsx`),
   aujourd'hui deux colonnes de texte « 2× Nom », passe en tableaux **en
   lecture seule** ;
2. la composition du deckbuilder `#/decks/{key}` (`DeckComposition`,
   `DeckComposition.tsx`), aujourd'hui une liste plate d'une ligne par triplet
   carte × langue × extension, avec stepper, « Retirer » et conversion de
   proxies, passe en tableaux **éditables** (lecture seule pour un deck
   archivé) ;
3. la ligne de deck de la liste gagne les icônes de clan de la crypte et le
   compte crypte / bibliothèque ;
4. le picker du deckbuilder bureau devient repliable, avec des onglets
   Crypte / Bibliothèque.

C'est un lot **front seul**. Pas de route, pas de champ de contrat, pas de type
d'opération `/sync`, pas de migration, pas de version Dexie : tout ce que les
tableaux affichent est déjà dans le miroir local depuis le lot Chercher
(`cards` et `cardDetails`). Les écritures restent celles d'aujourd'hui
(`saveDeckCard`, `removeDeckCard`, `convertProxies`).

Ce que le lot ne fait pas : ni figer la decklist jouée (préalable du Lot 8), ni
légalité hors ligne, ni export de decklist, ni refonte de la feuille d'ajout du
picker au-delà des onglets.

## État de départ relevé dans le code

- `DeckComposition.tsx` (329 lignes) : `CompositionRow` par triplet, stepper −/+
  qui envoie `saveDeckCard(quantity ± 1, proxyQuantity)` (le `−` est désactivé
  à 1), bouton « Retirer » (`deck-card-remove`), `ConvertProxiesControl` sur
  une ligne à proxies, teinte « +N à l'instant » au bureau
  (`useRecentIncreases`). Aucune séparation crypte / bibliothèque.
- `DecksPage.tsx` : `DeckCompositionColumns` fusionne déjà les lignes par carte
  et sépare crypte et bibliothèque par `useCardCategoriesById` ; pas de
  regroupement par type, faute de type au miroir à l'époque du Lot 5bis.
  `DeckItem` n'affiche ni clan ni compte.
- `DeckDetailPage.tsx` : au bureau, grille `deck-builder-columns` avec le
  picker (`AddDeckCardForm`) toujours visible ; au mobile, composition, lien
  « Chercher une carte pour ce deck », pilule « Ajouter des cartes ».
- `features/search/glyphs.ts` et `Glyph.tsx` : la table des icônes de krcg,
  plus complète que celle du handoff (Oblivion, Striga, Maleficia, vertus,
  credos, Flight), et `GlyphIcon` avec nom accessible. Polices
  auto-hébergées et précachées (« Ankha VTES », « VTES Clans »).
- `useLocalDeckCounts` (Lot 5c) calcule déjà crypte / bibliothèque d'un deck.
- `useAddDeckCard` et `computeAddedLine` (lot Chercher, D1a) : le calcul d'un
  ajout qui prend d'abord au stock disponible.
- Chiffres de départ : 983 tests vitest sur 61 fichiers, 73 e2e Playwright,
  464 `data-testid` distincts, références CRAP vides des deux côtés.

## Décisions de l'utilisateur (tranchées à A0, 2026-11-06)

Chaque proposition porte la recommandation soumise, puis ce que l'utilisateur
a tranché. Les P1 à P4 changent le comportement de l'écran le plus utilisé de
l'application ; les autres sont de rendu.

### P1. Couleur des icônes Ankha, une règle pour toute l'application

Chercher les affiche en plein, `--color-neutral-300`. Le handoff les veut
sombres (`--color-neutral-900`) avec un contour clair d'un pixel en
`text-shadow`, au motif que les glyphes sont dessinés sombre sur clair ; c'est
ce qu'on voit sur d23. Deux règles différentes d'un écran à l'autre se
verraient tout de suite, puisque la même carte passe de Chercher au deck.

Recommandation : adopter le rendu du handoff partout, dans la classe
`.glyph--ankha`, et vérifier Chercher à l'œil aux deux largeurs (la grille de
filtres, où un glyphe coché prend une couleur d'accent, est le cas à
regarder). Les clans restent pleins, `--color-neutral-100` dans les tableaux.

**Tranché à A0** : recommandation retenue.

### P2. Fusion des lignes d'une même carte

Une ligne de deck a pour clé carte × langue × extension (Lot 4). Le handoff
fusionne à l'affichage les lignes d'une même carte et laisse ouvert ce que
devient le stepper.

Recommandation :

- une ligne par carte dans les deux tableaux, quantités et proxies sommés ;
- si la carte n'a qu'une ligne (le cas courant), le stepper agit dessus ;
- si elle en a plusieurs, la ligne fusionnée n'a pas de stepper mais un total
  et un chevron ; on éditera dans le détail ;
- un clic sur le nom ouvre un **détail** sous la ligne (accordéon) qui liste
  chaque triplet avec sa langue, son extension, son stepper et, s'il a des
  proxies, « convertir des proxies ». Le détail existe pour toute carte, pas
  seulement les fusionnées : c'est là que vont la langue, l'extension et la
  conversion, que la ligne de 34px n'a plus la place d'afficher.

Pas de « ligne principale » à définir : c'est ce qui rendait la proposition du
handoff fragile (que fait `−` quand la principale tombe à 0 et qu'une autre
reste ?).

**Tranché à A0** : recommandation retenue, avec une précision. La ligne
fusionnée d'une carte à plusieurs impressions porte, à la place du stepper,
une icône qui explique pourquoi on ne peut pas l'éditer là (`ph-stack`, nom
accessible et infobulle « 2 impressions : modifiez les quantités dans le
détail »), et dont le clic ouvre le détail.

### P3. Ce que fait le `+`

Aujourd'hui, `+` ajoute un exemplaire réel ; s'il manque au stock, le serveur
refuse l'opération au rejeu, et l'utilisateur la retrouve sur l'écran
Synchronisation. Le handoff ne dit rien de plus.

Recommandation : faire passer le `+` par `computeAddedLine`, comme le picker et
Chercher. Un exemplaire disponible au stock est pris ; sinon, si le deck
autorise les proxies, l'exemplaire ajouté est un proxy ; sinon, le `+` est
désactivé avec une infobulle « Plus d'exemplaire disponible au stock ». Le
refus est connu d'avance, autant ne pas l'envoyer.

**Tranché à A0** : recommandation retenue, avec une règle pour la langue et
l'extension. Le `+` d'une ligne prend d'abord au stock **identique** (même
carte, même langue, même extension que la ligne). S'il n'y en a plus mais
qu'il reste au stock un exemplaire de la même carte dans une autre langue ou
une autre extension, il y a doute : le `+` ne devine pas et n'ajoute pas de
proxy en silence, il ouvre le détail de la carte (P2), où l'utilisateur choisit
entre les exemplaires disponibles (« FR · KoT · 2 disponibles ») et le proxy.
Sans aucun exemplaire de la carte au stock, la règle ci-dessus s'applique
(proxy si le deck l'autorise, sinon désactivé).

### P4. Passer à 0 retire la ligne

Le handoff supprime le bouton « Retirer » : `−` à 1 retire la ligne. C'est
rapide, mais un retrait par erreur fait disparaître la ligne : pour la
rétablir, il faut repasser par le picker, qui redemande langue et extension.

Recommandation : suivre le handoff, sans confirmation, et garder une action
« Retirer du deck » dans le détail de P2 pour qui veut retirer une ligne de
plusieurs exemplaires d'un coup.

**Tranché à A0** : recommandation retenue.

### P5. Les tableaux au téléphone

Les deux captures « mobiles » ont été prises à 909px. À 390px, une ligne de
crypte éditable donne au nom moins de 60px : stepper 78px, capacité 26px,
quatre à six disciplines à 22px, clan 30px, groupe 30px, plus les marges.

Recommandation : sous 440px de largeur de section, les disciplines passent sur
une seconde ligne sous le nom, à 17px (la taille `glyph--row` de Chercher), et
la hauteur de ligne devient libre. Au-delà, la grille du handoff. Faire valider
la capture à 390px par l'utilisateur à l'étape D4 plutôt que de demander un
nouveau handoff.

**Tranché à A0, en partie** : pour la crypte, l'utilisateur fournira une
capture de l'affichage de VDB (smeea/vdb), dont ce handoff s'inspire ; la
disposition mobile de la crypte attend cette capture. La bibliothèque suit la
recommandation, à valider à l'écran à D4.

### P6. Ordre des types de bibliothèque et cartes à plusieurs types

Le handoff donne l'ordre Master, Action, Action Modifier, Political Action,
Ally, Equipment, Retainer, Combat, Reaction, Event. Il oublie Reflex, Power et
Conviction (cartes d'imbued) et ne dit rien d'une carte à deux types
(« Action Modifier/Reaction »).

Recommandation : une carte à plusieurs types forme son propre groupe, intitulé
par ses types joints par « / » comme dans les decklists de la TWDA, placé au
rang de son premier type ; Reflex, Power et Conviction viennent après Event,
dans cet ordre.

**Tranché à A0** : recommandation retenue.

### P7. Ligne de deck dans la liste, aux deux largeurs

Le handoff ajoute, au bureau, les icônes de clan de la crypte et « 12 / 80 »
dans la méta de chaque ligne. Il faut pour cela lire les lignes de tous les
decks listés.

Recommandation : le faire aux deux largeurs (la règle du Lot 5c : une
information présente d'un côté l'est de l'autre), par une seule lecture
groupée des lignes des decks listés, et pas un abonnement par deck.

**Tranché à A0** : à valider visuellement pendant l'implémentation. L'étape
D3 s'arrête sur une **confirmation manuelle** de l'utilisateur (captures de la
liste aux deux largeurs) avant de passer à D4.

### P8. Colonne et total des proxies

Le handoff prévoit `showProxies` sans dire quand le passer à faux.

Recommandation : colonne et total affichés quand le deck autorise les proxies
ou qu'une de ses lignes en a ; masqués sinon.

**Tranché à A0** : recommandation retenue.

### P9. Picker repliable et onglets

Recommandation : état replié mémorisé par appareil (`localStorage`, lecture et
écriture sous `try/catch`, ouvert par défaut). Onglets Crypte / Bibliothèque
qui filtrent la catégorie de la recherche du picker, Bibliothèque par défaut ;
pas de troisième onglet « Toutes ». Au mobile, la feuille d'ajout reçoit les
mêmes onglets, pour ne pas ouvrir d'écart.

**Tranché à A0** : recommandation retenue.

### P10. Place du lot

Recommandation : avant le Lot 8. Le lot ne touche ni au modèle ni au contrat,
et le Lot 8 commencera par figer la decklist jouée, qui touchera les mêmes
écrans : autant qu'il trouve le composant définitif.

**Tranché à A0** : le lot se fait maintenant, avant le Lot 8.

## Décisions de conception

### A1. Une lecture ciblée, pas le catalogue en mémoire

Les tableaux lisent les faits des cartes du deck par un hook
`useDeckCardFacts(cardIds)`, sur le patron de `useCardCategoriesById` : clé
stable triée, `anyOf` sur `cards` puis `cardDetails`, dans une transaction en
lecture. Un deck a quarante à quatre-vingt-dix cartes distinctes ; charger les
4 212 cartes de `CatalogMemory` pour les afficher coûterait de 1,3 à 4,3 s à
froid sur un téléphone lent (mesures E3 du lot Chercher). `useCardCategoriesById`
et `useLocalDeckCounts` se réécrivent sur ce hook.

Un fait de carte porte : catégorie, nom, capacité, groupe, clan, disciplines
(code et niveau), types, `costType` et `costValue`, clans requis, texte
(pour les trifles, A3). Le miroir incomplet (`cardDetails` vide) donne des faits
sans disciplines, types ni coût : voir A5.

### A2. Le calcul des tableaux est une fonction pure

`buildDeckTables(lines, facts)` rend les deux sections prêtes à afficher :
lignes fusionnées par carte avec leurs triplets (P2), crypte triée par capacité
décroissante puis nom replié, bibliothèque groupée par type (P6), statistiques
d'en-tête. Elle se teste sur une table de cas comme `filterCards`, et garde la
complexité hors des composants (règle CRAP).

Les statistiques :

- crypte : groupes présents (`G5–6`, « Any » neutre), capacité moyenne pondérée
  par les quantités, à une décimale ;
- bibliothèque : total sang et total réserve, chaque coût multiplié par sa
  quantité ; un coût X ne s'additionne pas et ajoute « + X » au total ; nombre
  de proxies (P8).

### A3. « Trifle »

Le handoff écrit « · 7 trifle » pour les masters « sans coût ». Trifle est un
mot-clé du texte des masters (« Master: trifle. »), sans rapport avec le coût.
Le compteur compte les masters dont le texte anglais contient « trifle », et
non les masters sans coût.

Confirmé par l'utilisateur à A0 : un trifle est un master dont le premier
joué du tour donne une nouvelle action de phase master. Le mot-clé ouvre le
texte (« Master: trifle. ») ; la détection cherche « trifle » comme mot entier,
replié par `foldText`, dans le texte anglais d'une carte de type Master, et
une table de cas la fige (master trifle, master sans le mot, carte non master
qui le cite).

### A4. Icônes partagées

`features/search/glyphs.ts` et `Glyph.tsx` montent dans `src/components/glyphs/`,
importés par Chercher et par les tableaux ; aucun module `vtesGlyphs.ts` à part.
Une icône inconnue n'est jamais rendue en lettre brute (handoff, et déjà
`CHERCHER.md`) : le repli `.glyph-fallback` qui affiche le code disparaît des
tableaux, la cellule reste vide avec le nom en infobulle. Chercher garde son
repli tant qu'on n'a pas tranché autrement, l'écart étant antérieur.

Accessibilité : une icône de discipline ou de clan seule dans sa cellule garde
son nom accessible (`role="img"`) ; l'en-tête de colonne (« Disc. », « Clan »)
reste lu par le lecteur d'écran grâce à un vrai tableau (`role="table"` ou
`<table>`), ce qui permet aussi aux e2e de viser une cellule par colonne.

### A5. Miroir incomplet et cartes hors catalogue

Sans `cardDetails` (serveur d'avant le lot Chercher), les tableaux restent
lisibles : crypte et bibliothèque séparées par `cards.category`, capacité, clan
et groupe affichés, bibliothèque en un seul groupe « Bibliothèque · détails à
venir », sans icône ni coût, comme Chercher sans ses filtres. Une carte absente
de `cards` (catalogue pas encore chargé) va dans un groupe « Hors catalogue
local » en bas de la bibliothèque, avec « Carte n° … » comme aujourd'hui.

### A6. Ce que garde le deckbuilder

La teinte « +N à l'instant » du bureau (`useRecentIncreases`, DESKTOP.md d01)
reste, appliquée à la ligne fusionnée. Le badge « En attente de
synchronisation » devient une icône `ph-clock-countdown` en bout de nom, avec
le texte complet dans le détail et en nom accessible. Les raccourcis existants
ne bougent pas ; `↵` dans l'aperçu ouvre toujours le deckbuilder.

### A7. Légalité dans l'aperçu

Le badge « Légal » / « Illégal · crypte 8/12 » vient du verdict déjà lu en
ligne par `useDeckLegality`. Hors ligne, pas de badge mais la mention actuelle
de `DeckLegalitySummary` ; le résumé chiffré reste sous le titre, restylé.

### A8. `data-testid`

Disparaissent, avec leur justification dans la PR : `deck-card-remove` (P4,
l'action passe dans le détail sous `deck-card-detail-remove`),
`deck-cards-total` (remplacé par les totaux d'en-tête, `deck-tables-crypt-total`
et `deck-tables-library-total`), `decks-detail-columns`, `decks-detail-crypt`,
`decks-detail-library` (remplacés par `deck-tables` et ses sections). Le
recensement de référence se prend à E0.

`deck-card` change de cible : il désigne une ligne **fusionnée**
(`data-card-id`, `data-quantity`, `data-proxy-quantity` en totaux), et chaque
triplet du détail porte `deck-card-line` avec `data-language`, l'extension en
`deck-card-set` et sa propre quantité. L'assistant `deckCardLine` des e2e
(`tests/e2e-real/support/app.ts`) ouvre le détail puis vise `deck-card-line` ;
c'est la seule façon de garder `printings.spec.ts`, qui place deux impressions
de la même carte dans un deck et les compte.

## Découpage en étapes ordonnées

Tout le lot revient à `frontend-react`, sauf E0 et E1 (`qa-tests`) et F
(orchestrateur). `pwa-offline` relit A1 (lecture Dexie) et le passage à
`computeAddedLine` (P3), sans rien écrire dans `offline/`.

| Étape | Contenu | Agent |
| --- | --- | --- |
| A0 | Trancher P1 à P10 et A3 | utilisateur |
| E0 | Recensement `data-testid` d'ouverture (`docs/qa-baselines/testids-affichage-decks-ouverture.txt`), vérification des références CRAP | qa-tests |
| D1 | Icônes dans `src/components/glyphs/`, couleur de P1 appliquée, Chercher vérifié aux deux largeurs | frontend-react |
| D2 | `useDeckCardFacts`, `buildDeckTables` et sa table de cas, réécriture de `useCardCategoriesById` et `useLocalDeckCounts` | frontend-react |
| D3 | `DeckTables` en lecture seule, aperçu bureau de `#/decks`, ligne de deck à clans et comptes aux deux largeurs (P7) ; **arrêt pour confirmation manuelle** de l'utilisateur sur captures | frontend-react |
| D4 | `DeckTables` éditable : stepper, 0 retire, `+` par `computeAddedLine` avec la règle de doute de P3, détail par carte avec l'icône de P2, conversion de proxies ; disposition mobile de la bibliothèque (P5), celle de la crypte après réception de la capture VDB | frontend-react |
| D5 | Deckbuilder : corps flex, picker repliable et mémorisé, onglets Crypte / Bibliothèque au bureau et dans la feuille mobile | frontend-react |
| E1 | Mise à jour de `decks.test.tsx` et des e2e touchés ; nouveaux e2e aux deux largeurs (A8, ci-dessous) ; recensement et CRAP | qa-tests |
| F | CLAUDE.md (§11 et §12), `DECKS.md` (écarts retenus), clôture | orchestrateur |

D1 et D2 sont indépendantes ; D3 dépend des deux ; D4 et D5 de D3.

Tests à écrire à E1, au minimum :

- table de cas de `buildDeckTables` : tri de la crypte, ordre et fusion des
  types (P6), cartes à plusieurs lignes, X dans les coûts, trifles, miroir
  incomplet, carte hors catalogue ;
- composant : `−` à 1 retire la ligne, `+` prend au stock puis en proxy puis se
  désactive (P3), détail d'une carte à deux impressions, deck archivé sans
  stepper ni picker ;
- e2e `real-backend` et `desktop-real-backend` : hors ligne, un deck modifié
  par les steppers (hausse, baisse jusqu'à retrait) puis synchronisé ; deux
  impressions de la même carte, éditées depuis le détail ;
- e2e `desktop` : picker replié, rechargement, toujours replié.

## Ce qui peut casser

- **Les tests qui lisent la composition** (relevé du 2026-11-06) : côté
  `real-backend`, `acquisition`, `chercher-ajout`, `journey`,
  `lot5c-symetrie`, `printings`, `rejections` et les assistants de
  `support/app.ts` ; côté `desktop-real-backend`, `chercher-ajout`,
  `deckbuilder`, `decks-and-stock` et `lot5c-symetrie` ; en vitest,
  `decks.test.tsx` et `search.test.tsx`. A8 les garde possibles ; à recompter à
  E1, comme d'habitude sous OneDrive (un run n'est vert qu'avec le bon nombre
  de tests).
- **Le `−` qui retire** : un utilisateur habitué au bouton « Retirer » peut
  retirer une ligne sans le vouloir. P4 garde un rattrapage par `+` tant que la
  ligne n'a qu'une impression ; au-delà, il faut repasser par le picker.
- **La couleur des icônes** (P1) change Chercher, livré et vérifié sur
  téléphone le jour même. Un contrôle à l'œil des deux dispositions de
  Chercher fait partie de D1.
- **Lecture des lignes de tous les decks** (P7) : négligeable pour une dizaine
  de decks, à mesurer si la liste en compte des centaines (archivés compris
  sous « Tous »).
- **Largeur mobile** (P5) : aucune capture de référence à 390px ; le rendu se
  valide à l'écran plutôt que contre un handoff.
- **Glyphes manquants** : le carré vide visible sur d23 vient de la table du
  prototype ; la table du projet couvre ces disciplines, mais toute discipline
  nouvelle chez krcg tombera dans le cas « cellule vide » d'A4.

## Livraisons

### Livré aux étapes E0, D1, D2 et D3 (2026-11-06)

- **E0.** Référence d'ouverture `docs/qa-baselines/testids-affichage-decks-ouverture.txt`
  (464 littéraux distincts, 42 par prop, 32 motifs dynamiques) ; aucun identifiant
  disparu par rapport à celle du lot Chercher. Références CRAP vides des deux côtés.
- **D1.** `glyphs.ts` et `Glyph.tsx` montent dans `src/components/glyphs/` ;
  `costLabel` les suit (réexporté par `searchFormat.ts`). Rendu de P1 dans
  `.glyph--ankha` (encre `--glyph-ink`, filet `--glyph-line` dans les huit
  directions) ; les cases de discipline cochées de Chercher changent le filet et
  non plus la couleur du glyphe. Vérifié sur la police entière : tous les glyphes
  restent lisibles. Obfuscate (`o` / `O`) est un cadre vide dans `ankha2.otf`,
  comme chez krcg (police identique octet pour octet, même correspondance dans
  `krcg-blogger.js`) : ce n'est pas un défaut du rendu.
- **D2.** `deckTablesModel.ts` (`buildDeckTables`, `mergeDeckLines`,
  `cryptGroupsLabel`, `isTrifle`, `cryptClans`, `deckListSummary`) et sa table
  de cas ; `useDeckCardFacts` lit `cards` et `cardDetails` par `anyOf` et
  `bulkGet`. Écart de nom : le module pur ne peut pas s'appeler
  `deckTables.ts` à côté de `DeckTables.tsx` sur un disque insensible à la casse.
  Écart au découpage : `useCardCategoriesById` et `useLocalDeckCounts` ne sont
  pas réécrits, rien ne l'exigeait.
- **D3.** `DeckTables.tsx` (tableaux à rôles ARIA, fonctions de rendu pour la
  version éditable), aperçu bureau de `#/decks` (kicker, titre 26px, méta,
  badge de légalité `DeckLegalityTag` et son libellé en fonction pure
  `legalityTagModel.ts`, tableaux en lecture seule), ligne de deck à clans et
  comptes aux deux largeurs. La couche offline gagne une lecture,
  `readDeckCardsByDeck` et son hook `useLocalDeckCardsByDeck`, pour les comptes
  de la liste en une seule lecture (le plan disait « rien dans `offline/` » :
  c'est une lecture, aucune écriture ni version Dexie). Au bureau, la flèche de
  la ligne disparaît (la ligne sélectionne, elle n'ouvre plus) ; colonne maître
  de 360px, sans filet. Le résumé chiffré (`DeckLegalitySummary`) quitte
  l'aperçu, le badge et les en-têtes de tableau le remplacent ; il reste dans
  le deckbuilder. Total de réserve affiché « pool » et non « réserve », comme
  partout ailleurs dans l'application.
- Tests : `deckTablesModel.test.ts` (19 cas), `legalityTagModel.test.ts`, trois
  tests de l'aperçu réécrits dans `decks.test.tsx` (badge, tableaux, ligne
  fusionnée, comptes de la liste).
- **Confirmation manuelle de P7** : captures de la liste et de l'aperçu à 1440 et
  390px, prises sur une copie de `backend/vtes.db`, soumises à l'utilisateur.

### Livré aux étapes D4, D5 et E1 (2026-11-06)

L'implémentation a été interrompue par un arrêt de l'application pendant D5 ;
D4 et D5 étaient écrits, E1 a été fait à la reprise.

- **D4.** `DeckComposition` rend `DeckTables` en version éditable : une ligne
  par carte, stepper quand la carte n'a qu'une ligne langue × extension, icône
  `StackIcon` (nom accessible et infobulle « N impressions : modifiez les
  quantités dans le détail ») sinon, qui ouvre le détail (P2). Le nom ouvre le
  détail sous la ligne : chaque ligne avec langue, extension, proxies, attente
  de synchronisation, son stepper quand la carte en a plusieurs, « Retirer du
  deck » (`deck-card-detail-remove`) et la conversion de proxies ; puis les
  exemplaires libres d'autres langues ou extensions (`deck-card-stock-option`,
  « EN · KoT · 2 disponibles ») et « Un proxy » si le deck l'autorise. `−` à 1
  retire la ligne (P4). Le `+` suit la fonction pure `plusDecision` (P3) :
  stock identique, sinon choix dans le détail, sinon proxy si le deck
  l'autorise, sinon désactivé avec la raison en infobulle ; la décision est
  posée sur le bouton (`data-plus`). Disponibilités par
  `useDeckStockAvailability`, même comptabilité que `useAvailableStock`.
  `useLastDefined` garde la dernière lecture pendant qu'une nouvelle se fait,
  pour que les tableaux ne clignotent pas à chaque écriture. Erreur gardée par
  carte, un envoi à la fois par carte. Disposition mobile de la crypte d'après
  la capture VDB reçue : disciplines en colonnes alignées
  (`cryptDisciplineColumns`), sur la ligne tant qu'il y en a au plus cinq,
  sous le nom au-delà. Bibliothèque au téléphone selon la recommandation de P5.
- **D5.** Au bureau, l'en-tête du deckbuilder porte les actions du deck (statut,
  archivage, modification), le verdict de légalité passe dessous ; le picker
  devient un panneau repliable (`deck-picker-collapse`, `deck-picker-expand`),
  ouvert par défaut, mémorisé sous `gurchon-hall:deck-picker-open` (lecture et
  écriture sous `try/catch`). Un deck archivé n'a ni picker ni bouton pour le
  rouvrir. Onglets Crypte / Bibliothèque (`deck-card-form-category`),
  Bibliothèque par défaut, au bureau et dans la feuille mobile : `CardPicker`
  gagne un paramètre `category` passé à `useLocalCardSearch`. La CSS du corps
  manquait à la reprise (le verdict s'étalait sur toute la page, le bouton `›`
  tombait sous le titre du picker) : corps en flex wrap comme d23, tableaux
  `1 1 640px`, picker `0 1 300px` (260px au moins), bouton vertical une fois
  replié, actions à droite de l'en-tête, verdict détaillé sur 560px.
- **Chiffres à la fin d'E1** : 1030 tests vitest sur 63 fichiers, lint et
  `tsc` propres ; 78 e2e Playwright (8 `chromium`, 41 `real-backend`, 3
  `desktop`, 26 `desktop-real-backend`) ; références CRAP inchangées, aucune
  régression ; 480 `data-testid` littéraux distincts (464 à l'ouverture).
- **Validation de l'utilisateur** (P5) : captures du deckbuilder à 390px
  (crypte et bibliothèque, détail ouvert, feuille d'ajout) et à 1440px (picker
  ouvert et replié), sur une copie de `backend/vtes.db`, validées le
  2026-11-06.
- **E1.** vitest : quatre tests de D5 dans `decks.test.tsx` (picker replié puis
  rouvert après un retour sur le deck, deck archivé sans picker, onglets au
  bureau et dans la feuille mobile), en plus des tests de D4 écrits avec elle
  (`−` à 1, `+` au stock identique puis choix, proxy, désactivé, deck archivé).
  e2e : l'assistant `deckCardLine` vise `deck-card-line` quand on lui passe une
  extension, `openDeckCardDetail` ouvre le détail ; `printings.spec.ts` lit la
  ligne fusionnée puis le détail, `decks-and-stock.spec.ts` vise
  `deck-tables-library`. Nouveaux scénarios communs aux deux largeurs
  (`tests/e2e-real/support/deckTables.ts`) : steppers hors ligne puis rejeu
  (stock identique jusqu'à épuisement, `+` désactivé, `−` à 1 qui retire), et
  deux impressions éditées depuis le détail, avec le choix d'une autre
  impression quand le stock identique est épuisé ; au bureau seulement, picker
  replié qui le reste après un rechargement. Le scénario du picker est dans
  `desktop-real-backend` et non `desktop` : ce projet n'a pas de back, et un
  deck s'ouvre derrière une session.
- **`data-testid`** : disparus par rapport à la référence d'ouverture,
  `deck-card-remove`, `deck-cards-total` et `decks-detail-columns` (prévus par
  A8), plus `deck-cards`, le conteneur de l'ancienne liste, qu'A8 n'avait pas
  listé et qu'aucun test ne visait ; `deck-tables` le remplace.
  `decks-detail-crypt` et `decks-detail-library` ont disparu aussi, mais le
  recensement ne les voyait pas : ils étaient passés en argument à une
  fonction (`column(…, "decks-detail-crypt")`), pas écrits dans un attribut.
  Les `deck-summary*` ont disparu à la clôture, voir ci-dessous.

### Clôture (F, 2026-11-06 et 2026-11-07)

- **Captures validées** par l'utilisateur (P5) : deckbuilder à 390px et à
  1440px, picker ouvert et replié.
- **Légalité du deckbuilder bureau : une pastille avec infobulle**, choix de
  l'utilisateur à la clôture, conforme à d23. Le résumé à quatre chiffres
  (`DeckLegalitySummary`) et le bouton « Recalculer » disparaissent. La pastille
  (`DeckLegalityBadge`) reprend le libellé du badge de l'aperçu
  (« Illégal · bibliothèque 39/60 », `legalityTag`) à côté de la méta ; son
  infobulle (`role="tooltip"`, reliée par `aria-describedby`, ouverte au survol
  ou au focus) donne le verdict chiffré et daté, puis le détail du Lot 5c
  (`DeckLegalityDetails` : motifs, cartes bannies et pas encore légales, note de
  brouillon, alerte de deck actif illégal, avertissement de version, états
  indisponible et erreur). La pastille est un bouton : un clic relance la
  lecture du verdict, comme `R`. Une seule lecture serveur, comme avant. Le
  mobile garde `DeckLegalityPanel`. Ce qui se perd au bureau : le détail n'est
  plus lisible sans survol, et l'alerte « deck actif illégal » n'est plus
  affichée d'emblée ; la pastille « Illégal » à côté de « Deck actif » en tient
  lieu.
- **`data-testid`** : disparaissent en plus `deck-summary`,
  `deck-summary-verdict`, `deck-summary-crypt`, `deck-summary-library`,
  `deck-summary-groups` et `deck-summary-banned`, avec le résumé ;
  `deck-builder-legality` et `deck-legality-refresh` restent, portés par la
  pastille ; `deck-legality-tooltip` s'ajoute. Référence de clôture
  `docs/qa-baselines/testids-affichage-decks-cloture.txt` : 475 littéraux
  distincts, 42 par prop, 33 motifs dynamiques. C'est elle que vise désormais la
  commande de contrôle de CLAUDE.md.
- **Tests** : le test vitest du Lot 5c (légalité détaillée au bureau) vérifie
  la pastille, l'infobulle et son `aria-describedby` ; l'e2e n°14 du Lot 5c
  (`lot5c-symetrie.spec.ts`) vérifie que le détail est masqué puis visible au
  survol de la pastille.
- **Retours de l'utilisateur à l'écran** (2026-11-07) : l'icône des
  impressions (`deck-card-merged`) ouvre et referme le détail, comme le nom,
  avec `aria-expanded` ; le `+` qui fait choisir ne fait qu'ouvrir. Les glyphes
  de clan, trop chargés à 22px (Banu Haqim, Giovanni, Salubri), passent en
  `--color-neutral-300` et en lissage gris partout (`filter: opacity(1)`, qui
  supprime les franges colorées du lissage sous-pixel de Chrome sous Windows
  sans créer de couche graphique), et grandissent dans les tableaux : 26px en
  crypte, 24px en bibliothèque. Variante E d'une planche de six réglages ; la
  police ne contient pas de version simplifiée de ces symboles. Enfin, les
  adresses gardent leurs deux-points en clair (`#/decks/id:1`,
  `#/chercher?deck=id:4`, au lieu de `id%3A1`) : `hrefFor` n'encode plus `:`,
  permis dans un fragment, et la lecture décode toujours, si bien qu'un ancien
  lien en `%3A` s'ouvre encore.
- **Piège relevé** : les projets `real-backend` servent le build `dist-real/`
  et réutilisent un serveur de preview déjà lancé ; un `npx playwright test`
  sans `npm run build:e2e` préalable tourne sur un build périmé et échoue sur
  un identifiant pourtant présent dans le code. `npm run test:e2e` reconstruit
  toujours.
