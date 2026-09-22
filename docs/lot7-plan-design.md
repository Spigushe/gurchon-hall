# Lot 7 — passe design Nocturne : plan d'implémentation

Brief de mise en œuvre du handoff `docs/design-handoff-mobile/` (direction « 1b »,
système Nocturne), écrit avant toute implémentation, sur le même principe que
`docs/lot3-sync-contrat.md` : il découpe le travail, dit qui le porte et liste
ce qui peut casser. Le contenu visuel lui-même (couleurs, typo, tracés d'écran)
reste dans le handoff et dans `docs/design-handoff-mobile/nocturne/`, qui font
foi ; ce document n'en est pas une paraphrase mais un ordre de marche.

Rappel de portée, tel que posé par le handoff : dix écrans plus les états
vides / chargement / introuvable, sans changement de comportement — mêmes
routes, mêmes données, même sémantique offline. Seuls layout, typo, couleur,
espacement et chrome de navigation bougent.

## Ce que ce lot ne touche pas

Aucune migration Alembic, aucun schéma Pydantic, aucune route. Le contrat
OpenAPI ne bouge pas d'une opération. L'**architecte-contrat** et le
**backend-fastapi** n'ont donc pas de rôle dans ce lot, et rien ici ne
justifie de les convoquer.

Un seul point de vigilance à ce sujet : l'onglet **Chercher** de la nouvelle
tab bar (recherche dans le catalogue complet, au-delà de la collection
possédée) n'a ni route cliente ni écran aujourd'hui — `frontend/src/app/routes.ts`
ne connaît que `home`, `stock`, `decks` et `deck`. Le handoff le sait et
demande explicitement de garder l'onglet désactivé (45 % d'opacité) plutôt que
de l'implémenter ou de le retirer. Ce lot ne construit donc pas cet écran. Le
jour où il le sera (recherche catalogue en ligne, potentiellement au-delà de
`GET /cartes` déjà existant), ce sera un lot à part avec un rôle pour
l'architecte-contrat si le contrat doit changer — mais rien ne l'indique pour
l'instant, `GET /cartes` couvrant déjà la recherche catalogue côté API.

## Découpage en étapes ordonnées

Ordre pensé pour que les fondations précèdent les écrans, et que les écrans
qui partagent un composant ou un motif (feuille plein écran, puce de langue,
règle à liseré accent) soient traités l'un après l'autre plutôt qu'en
parallèle désordonné. Chaque étape se termine testable indépendamment
(`npm run lint`, `npm run test`) avant de passer à la suivante.

| # | Étape | Fichiers principaux | Dépend de |
| --- | --- | --- | --- |
| 1 | Dépendances et police | `frontend/package.json`, police Inter | — |
| 2 | Tokens et classes globales | `frontend/src/index.css` | 1 |
| 3 | Coquille et navigation | `frontend/src/App.tsx`, `frontend/src/app/Link.tsx`, manifest (`vite.config.ts`) | 2 |
| 4 | Atelier (accueil) | `frontend/src/features/home/HomePage.tsx`, `CatalogPanel.tsx` | 3 |
| 5 | Decks (liste) + Nouveau deck | `frontend/src/features/decks/DecksPage.tsx` | 3 |
| 6 | Collection | `frontend/src/features/stock/StockPage.tsx`, `StockList.tsx` | 3 |
| 7 | Modifier une entrée | `frontend/src/features/stock/StockForm.tsx`, `useLanguageOptions.ts` | 6 |
| 8 | Verser un produit | `frontend/src/features/stock/BundleDeposit.tsx` | 7 |
| 9 | Détail du deck + légalité | `frontend/src/features/decks/DeckDetailPage.tsx`, `DeckComposition.tsx`, `DeckLegalityPanel.tsx` | 5 |
| 10 | Ajouter (picker de cartes) | `frontend/src/features/catalog/CardPicker.tsx`, `frontend/src/features/decks/AddDeckCardForm.tsx` | 7, 9 |
| 11 | Synchronisation et correction | `frontend/src/features/sync/SyncStatusBar.tsx`, `RejectedOperations.tsx`, `CorrectionForm.tsx` | 3 |
| 12 | États vides / chargement / introuvable | branches vides des composants ci-dessus, `App.tsx` (route `not-found`) | 4 à 11 |
| 13 | Non-régression et validation de lot | suites vitest/Playwright existantes, contrôle manuel PWA | 1 à 12 |

Justification des regroupements et de l'ordre :

Les étapes 1 à 3 sont un préalable strict : tant que les variables Nocturne
n'existent pas dans `index.css` et que la tab bar n'existe pas dans `App.tsx`,
aucun écran individuel ne peut être restylé sans travail à refaire ensuite.
L'étape 3 emporte aussi le retrait de l'ancien `.nav` (rangée d'onglets en
haut) et de la `.topbar` permanente (pastille réseau + `SyncStatusBar`
toujours visible) : le handoff les remplace par la tab bar en bas et par une
alerte conditionnelle sur l'Atelier (étape 4) — les deux changements sont donc
liés et doivent atterrir ensemble, sans écran intermédiaire où la barre du
haut aurait disparu sans que rien ne la remplace.

Les étapes 4 et 5 passent avant la Collection et le détail de deck parce
qu'elles sont les points d'entrée de la tab bar et qu'elles n'introduisent
aucun motif nouveau (rangées à règle de séparation, chips) : elles servent de
calibrage avant les écrans plus chargés.

Les étapes 6 à 8 vont ensemble parce qu'elles partagent le motif de la puce de
langue (chip sélectionnable, `Autre ⌄` ouvrant `useLanguageOptions`) introduit
à l'écran « Modifier une entrée » (7) et repris tel quel à « Verser un
produit » (8) ; la Collection (6) doit précéder puisque c'est elle qui ouvre
le formulaire d'édition.

L'étape 9 (détail de deck) est traitée après la liste des decks pour la même
raison de point d'entrée, et avant l'étape 10 parce que le picker de cartes
(« Ajouter ») s'ouvre depuis le détail d'un deck.

L'étape 10 est volontairement isolée et placée tard : c'est la seule où la
maquette change la mécanique d'interaction, pas seulement l'habillage (voir
§ Risques, point sur le picker). Elle a besoin que les puces de langue (7) et
le détail de deck (9) existent déjà.

L'étape 11 (synchronisation, opérations refusées, correction) est indépendante
du reste sur le plan visuel — trois composants déjà autonomes — mais dépend de
la coquille (3) pour son point d'entrée : l'alerte de l'Atelier et l'écran
Synchronisation qu'elle ouvre.

L'étape 12 n'est pas un écran de plus mais une passe transverse : chaque
composant retouché aux étapes 4 à 11 a une branche vide, une branche de
chargement ou (pour `App.tsx`) une branche introuvable qui doit recevoir le
même traitement visuel (squelettes, pastille d'état) une fois la forme
« pleine » de l'écran stabilisée — la traiter avant serait refaire le travail
deux fois si la structure de l'écran plein change encore.

## Répartition par agent

Le travail relève presque entièrement de **frontend-react** : composants,
JSX, classes CSS, `index.css`. Deux agents ont un rôle ponctuel, pas
transverse.

**pwa-offline** intervient sur deux points précis, tous deux liés à l'objectif
pilote « app shell en cache » (CLAUDE.md § 3) :

- le precache de la police Inter et des icônes Phosphor. Aujourd'hui,
  `frontend/vite.config.ts` ne precache que
  `**/*.{js,css,html,svg,png,ico,webmanifest}` (aucune police) et le projet ne
  charge aucune police externe (`system-ui, sans-serif` dans `index.css`,
  aucune dépendance de police dans `package.json`). Si la police est
  self-hébergée (recommandé pour un shell qui doit s'afficher hors ligne dès
  le premier chargement, plutôt que Google Fonts en `runtimeCaching`, qui
  suppose une première visite en ligne), il faut ajouter l'extension des
  fichiers de police (`woff2`) au `globPatterns`, ou lister les fichiers en
  `additionalManifestEntries`. Un choix explicite entre self-host et Google
  Fonts + `runtimeCaching` est un livrable de cette étape, pas un détail
  d'exécution ;
- la cohérence du manifeste PWA (`theme_color: "#1a0410"`,
  `background_color: "#1a0410"` dans `vite.config.ts`) avec le nouveau fond
  Nocturne (`--color-bg #161826`). Un manifeste dont la couleur de thème ne
  correspond plus au fond réel de l'app shell est le genre d'écart que
  Chrome DevTools signale au panneau Application — à vérifier à l'étape 13.

**qa-tests** intervient en non-régression, pas en écriture de nouveaux
scénarios de comportement (aucun comportement ne change). Deux angles :

- vérifier après chaque étape que les suites existantes restent vertes et que
  chaque `data-testid` retouché est bien conservé — 108 occurrences aujourd'hui
  réparties sur 17 fichiers de `frontend/src/`, dénombrées avant ce lot pour
  servir de repère. Les suites les plus exposées : les tests vitest de
  composants (`frontend/tests/unit/App.test.tsx`,
  `frontend/tests/unit/ui/stock.test.tsx`, `ui/decks.test.tsx`,
  `ui/sync.test.tsx`) et deux e2e Playwright qui portent directement sur la
  coquille (`frontend/tests/e2e/installability.spec.ts`,
  `frontend/tests/e2e/offline-app-shell.spec.ts`) ;
- statuer, à l'étape 10 en particulier, sur ce qui doit rester identifiable :
  le picker actuel (`CardPicker.tsx`, recherche dans le catalogue) et le
  formulaire d'ajout (`AddDeckCardForm.tsx`, recherche dans le stock, un ajout
  à la fois) sont deux composants distincts avec leurs propres `data-testid`
  (`card-picker-*` d'un côté, `deck-card-*` de l'autre) ; le handoff les
  fusionne en un seul écran à sélection multiple (« panier »). La fusion doit
  décider quels `data-testid` survivent avant d'être codée, pas après —
  qa-tests est le bon agent pour trancher ce point avec frontend-react avant
  que le composant ne soit réécrit, plutôt que de découvrir après coup qu'un
  test cible un testid disparu.

## Risques et points d'attention

**Le retrait de `color-scheme: light dark`.** `frontend/src/index.css` déclare
aujourd'hui un thème clair et un thème sombre (`@media
(prefers-color-scheme: dark)`), et Nocturne est un système exclusivement
sombre. Le handoff le dit explicitement : retirer le mode clair est une
décision à prendre en connaissance de cause, pas un oubli à corriger plus
tard. Elle est actée par ce plan à l'étape 2 : le lot livre une app
uniquement sombre, une éventuelle rampe claire dérivée de Nocturne restant un
travail futur non planifié ici.

**Le retrait de `--ok-*` / `--ko-*` / `--warn-*` / `--info-*`.** Ces variables
et les classes qui s'y adossent (`badge--ok`, `badge--ko`, `badge--pending`,
`badge--info`, `panel--alert`, `panel--danger`, `network-status--online`,
`network-status--offline`) sont utilisées dans six fichiers de composants
(`DeckDetailPage.tsx`, `DecksPage.tsx`, `RejectedOperations.tsx`,
`DeckLegalityPanel.tsx`, `DeckComposition.tsx`, `StockList.tsx`) en plus de
`index.css`. Nocturne les remplace par la rampe accent et par le texte plutôt
que par la couleur (« le design n'utilise aucun vert/rouge de statut »). Ce
n'est donc pas une passe de CSS pure : chaque usage de ces classes dans les
six fichiers doit être relu et reformulé (accent-toned warning, libellé
explicite) à l'étape où ce fichier est traité — le tableau des étapes ci-dessus
répartit déjà ces six fichiers sur plusieurs étapes (5, 6, 9, 11), donc le
risque est de traiter `index.css` en un bloc à l'étape 2 en supprimant les
variables avant que les fichiers qui les consomment soient prêts à s'en
passer. Solution retenue : garder les anciennes variables en place jusqu'à ce
que le dernier des six fichiers soit converti, et ne les supprimer qu'à la fin
de l'étape 11.

**L'onglet Chercher.** Couvert plus haut : reste désactivé, aucun écran, pas
de route. Le risque concret est qu'un composant de tab bar mal conçu le rende
cliquable par erreur (lien actif au lieu d'un simple item visuel désactivé).

**Le sort de `CatalogPanel`.** Point non couvert explicitement par le handoff :
`CatalogPanel.tsx` (statut du catalogue local et bouton « Mettre à jour le
catalogue ») vit aujourd'hui sur `HomePage.tsx`. La maquette de l'Atelier
prévoit une ligne de pied de page en lecture seule (« Catalogue à jour — 3 812
cartes, synchronisé à 20:41 ») mais ne prévoit pas d'action de mise à jour
visible. Retirer le bouton serait un changement de comportement (impossible
de retélécharger le catalogue depuis l'UI), ce que le handoff exclut par
ailleurs. À trancher explicitement à l'étape 4 plutôt que d'improviser : soit
le pied de page devient cliquable et ouvre l'état complet de `CatalogPanel`,
soit le bouton reste visible sous une forme compacte. Décision pour
frontend-react, à documenter dans le composant au moment de l'écrire.

**Le picker de cartes (étape 10).** C'est la restructuration la plus profonde
du lot. Aujourd'hui, `AddDeckCardForm.tsx` cherche dans le stock possédé et
envoie un `saveDeckCard` par soumission ; `CardPicker.tsx` (utilisé ailleurs
pour choisir une carte du catalogue) est un composant séparé. Le handoff
demande un écran unique cherchant dans le catalogue complet (carte absente de
la collection affichée mais non sélectionnable comme « en collection »),
avec une zone panier qui accumule plusieurs lignes avant un seul geste
d'enregistrement — chaque ligne du panier devenant, à l'enregistrement, une
opération `addDeckCard` mise en file. Le handoff qualifie cela de pur
changement d'interaction (aucune nouvelle action offline, `useVtesOffline().actions`
inchangé), mais c'est la seule étape où le JSX ne peut pas se limiter à
changer des noms de classe : il faut fusionner deux composants et introduire
un état local nouveau (le panier, explicitement prévu au § « State
Management » du handoff). À traiter en dernier parmi les écrans, avec
qa-tests associé dès la conception plutôt qu'après coup.

**Nouvelle dépendance `@phosphor-icons/react`.** Absente de
`frontend/package.json` aujourd'hui. Son ajout passe par `npm install` côté
frontend-react ; à vérifier ensuite que `npm run build` et le bundle e2e
(`npm run build:e2e`) n'en soufrent pas en taille ou en tree-shaking (les
icônes Phosphor s'importent nommément, pas en bloc).

**Police Inter.** Couvert au paragraphe pwa-offline ci-dessus : choix entre
self-host (précaché, cohérent avec l'objectif pilote hors ligne dès la
première ouverture) et Google Fonts en CDN (plus simple, mais dépend du
réseau au premier chargement, contraire à l'esprit du § 3 de CLAUDE.md). Ce
plan recommande le self-host.

**Le tri des listes reste sensible à la casse et aux accents** (dette connue,
CLAUDE.md § 11, non traitée par le Lot 2) : ce lot ne la corrige pas, il ne
fait que réhabiller les listes qui l'exposent (Collection, Decks). À ne pas
confondre avec une régression introduite par la refonte.

## Critère de fin de lot

Repris du critère du Lot 0 (CLAUDE.md § 3) et adapté à une passe qui ne touche
pas l'offline en profondeur mais en modifie la coquille visible :

- `npm run lint` et `npm run test` (vitest) verts, sans suppression ni
  renommage de test pour faire passer la suite ;
- `npm run test:e2e` (Playwright, y compris les 13 tests contre un vrai
  back de `frontend/tests/e2e-real/`) vert sans modification de scénario —
  seuls des sélecteurs cassés par un `data-testid` disparu justifieraient un
  changement, et ce cas est précisément ce que l'étape 13 doit vérifier
  n'arrive pas ;
- tous les `data-testid` recensés avant le lot (108 occurrences, 17 fichiers)
  toujours présents, ou leur disparition justifiée et actée avec qa-tests
  (cas du picker, étape 10) ;
- contrôle manuel de l'installabilité PWA repris (panneau Application de
  Chrome DevTools : manifest sans avertissement, service worker *activated*,
  coupure réseau réelle) puisque `App.tsx`, `index.css` et potentiellement
  `vite.config.ts` (manifeste, precache des polices) changent — un shell qui
  se recompile différemment mérite qu'on revérifie ce qui avait été validé au
  Lot 0, pas qu'on suppose que ça tient ;
- aucune régression sur les points déjà tranchés par les lots précédents :
  recherche insensible à la casse/accents (§ 11), légalité en lecture seule
  et en ligne uniquement, file offline inchangée dans sa mécanique.

## Étape 14 — Rechercher (ajoutée en cours de lot, hors périmètre initial du handoff)

Ajoutée après le démarrage de l'implémentation, à la demande de Martin : le
handoff demandait de garder l'onglet **Chercher** désactivé (§ « Ce que ce lot
ne touche pas », § Risques) faute de route et d'écran. Cette étape lève cette
limite et construit l'écran : ce n'est plus du pur reskin, c'est une extension
fonctionnelle du lot, décidée en cours de route plutôt qu'anticipée par le
handoff. Elle vient après l'étape 4 (Atelier/chrome) chronologiquement, mais
peut être menée en parallèle des étapes 5 à 8 (aucun fichier partagé) ; elle
doit être bouclée avant de considérer le Lot 7 clos.

**Portée** : chercher une carte dans le catalogue complet (comme le
`CardPicker` actuel) puis l'ajouter, au choix, **à la collection, à un deck,
ou aux deux à la fois**, en une seule validation.

**Route** : `{ name: "search" }`, hash `#/rechercher` — même logique prudente
que `sync` → `#/synchronisation` (éviter un hash identique à un chemin
d'API, ici `/cartes` n'est pas heurté mais la prudence reste de mise).
L'onglet **Chercher** de la tab bar (posé désactivé à l'étape 3) devient actif
et y pointe.

**Fichier** : nouvel écran, proposé sous `frontend/src/features/catalog/SearchPage.tsx`
(le domaine « catalogue » est déjà le propriétaire de la recherche via
`CardPicker`/`catalogContext`). Réutilise les hooks existants sans aucun appel
réseau bloquant pour l'écriture : `useLocalCardSearch` (recherche catalogue,
comme `CardPicker`), `useLocalStock` (savoir ce qui est déjà possédé, par
carte et par langue), `useLocalDecks({ state: "active" })` (cible deck
possible), `useVtesOffline().actions` (`saveStock`, `saveDeckCard`).

**Règle métier vérifiée avec l'architecte-contrat avant codage** : `deck_card`
a une FK composite vers `card_copy` (CLAUDE.md § 6, § 11) — une carte doit
être en collection pour entrer dans un deck. Choisir « ajouter à un deck »
seul, pour une carte totalement absente de la collection, suppose donc de
créer d'abord (ou en même temps) la ligne `card_copy` sous-jacente. Voir la
décision actée dans CLAUDE.md § 11 (Lot 7) une fois l'architecte-contrat
consulté ; aucune évolution de contrat, de modèle ou de migration n'est
attendue a priori — la résolution se fait côté client, en préfixant l'ajout au
deck d'un `stock.upsert` implicite si besoin.

**Choix d'UX retenu** (à documenter comme les autres arbitrages du lot, cf.
§ Risques ci-dessus pour le style de décision attendu) : **une carte à la fois**,
pas un panier multi-cartes comme l'écran 5 (« Ajouter » depuis un deck) — les
deux écrans restent distincts et répondent à des besoins différents (l'écran 5
reste focalisé deck, alimenté par le stock existant ; « Rechercher » est plus
généraliste et combine deux destinations possibles par carte, ce qui rendrait
un panier multi-cartes ambigu à valider en un geste). Résultat de recherche
tapé → panneau de détail inline avec : puce de langue (motif déjà posé aux
étapes 6-8), puis deux blocs indépendamment activables — « Ajouter à la
collection » (exemplaires possédés, proxy autorisé, motif de `StockForm`) et
« Ajouter à un deck » (sélection parmi les decks actifs, quantité, proxies,
motif d'`AddDeckCardForm`) — au moins un des deux doit être actif pour
valider. Un seul geste d'enregistrement met en file les opérations
correspondantes (un `stock.upsert` et/ou un `saveDeckCard`). Si aucun deck
actif n'existe, le bloc deck reste visible mais désactivé avec un renvoi vers
la création d'un deck, plutôt que de disparaître silencieusement.

**Répartition** : `frontend-react` pour l'écran et le câblage de route/tab
bar ; `architecte-contrat` déjà consulté pour la règle métier (pas de rôle
d'implémentation, seulement de décision) ; `qa-tests` en repasse une fois
l'écran codé (nouveaux `data-testid`, pas de régression sur le picker
existant de l'écran 5 ni sur `CardPicker`/`AddDeckCardForm`, qui ne changent
pas de comportement par cette étape).

## Suivi

Ce document est un plan d'entrée de lot, pas un journal de décisions au sens
du § 11 de CLAUDE.md. Une fois le Lot 7 clos, les arbitrages qui en valent la
peine (sort de `CatalogPanel`, choix self-host vs CDN pour Inter, `data-testid`
retenus pour le picker fusionné, règle métier et route de l'écran Rechercher
ajouté en cours de lot) ont vocation à migrer vers CLAUDE.md § 11 et § 12,
comme pour les lots précédents.
