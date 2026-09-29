# Lot 5bis — passe design desktop Nocturne : plan d'implémentation

Brief de mise en œuvre du handoff `docs/design-handoff-mobile/DESKTOP.md` (direction
« 3a », système Nocturne), écrit avant toute implémentation, sur le même principe que
`docs/lot3-sync-contrat.md` et `docs/lot5-plan-design.md` : il découpe le travail, dit
qui le porte et liste ce qui peut casser. Le contenu visuel lui-même (couleurs, typo,
tracés d'écran) reste dans le handoff, qui fait foi ; ce document n'en est pas une
paraphrase mais un ordre de marche.

Rappel de portée, tel que posé par le handoff : `DESKTOP.md` **complète**
`docs/design-handoff-mobile/README.md` (mobile, direction « 1b », livré au Lot 5) — même
copie française, mêmes tokens Nocturne, mêmes hooks et données, aucun changement de
comportement. Il ne décrit que ce qui change à partir de **≥ 1024 px** : une barre haute
remplace la barre d'onglets basse, les feuilles plein écran deviennent des panneaux
latéraux, et trois écrans (Deckbuilder, Collection, Decks) passent d'une colonne à une
disposition maître/détail ou deux colonnes. En dessous de 1024 px, rien ne bouge : le
Lot 5 reste l'implémentation de référence.

## Ce que ce lot ne touche pas

Aucune migration Alembic, aucun schéma Pydantic, aucune route d'API. Le contrat OpenAPI
ne bouge pas d'une opération. L'**architecte-contrat** et le **backend-fastapi** n'ont
donc pas de rôle d'implémentation ici. Cette affirmation ne tient qu'à une condition,
vérifiée le 2026-09-28 dans `backend/app/schemas/catalog.py` et
`frontend/src/offline/vtes/refresh.ts` : le handoff affiche des données que le miroir
local ne contient pas, et ce lot les **laisse de côté** au lieu d'élargir le contrat.

| Donnée demandée par le handoff | Où | Dans le miroir ? | Sort au Lot 5bis |
| --- | --- | --- | --- |
| clan, capacité, groupe | d01, d02 | oui (`CardRow.clanName`, `capacity`, `groupCode`) | affichés |
| image générique de la carte | d01, d02 | oui (`CardRow.imageUrl`, issu de `CardSummary.image_url`, lui-même l'URL krcg) | affichée |
| disciplines | d01 (crypte), d02 « Clan / discipline » | non (`CardRead` seulement, hors miroir) | colonne réduite au clan |
| type(s) de bibliothèque | d01 et d04 « bibliothèque groupée par type », d02 « Type » | non | catégorie Crypte / Bibliothèque à la place, sans regroupement par type |
| coût | d02 « Cap./coût » | non | capacité seule pour la crypte, vide pour la bibliothèque |
| image d'une impression précise | d02 (entrée rattachée à une extension), d07 | non : `card_printing.image_url` existe en base mais n'est pas exposé | image générique seulement |

**Décidé avec l'utilisateur (2026-09-28) : l'écart est accepté et reporté au lot
Chercher**, comme au Lot 5 (« le miroir n'a ni clan ni capacité ; comblé par le lot
Chercher », CLAUDE.md § 11, Lot 5). Le Lot 5bis livre donc les colonnes et
sections réduites de la dernière colonne du tableau ci-dessus, sans attendre
l'enrichissement du miroir. Combler l'écart relève du lot **Chercher**
(`docs/lot-chercher-brief.md`), qui prévoit déjà d'enrichir `CardListItem` des types,
disciplines et coût, avec montée de version du miroir Dexie — l'ordre entre les deux
lots ne s'inverse pas, l'architecte-contrat n'a pas de rôle dans le Lot 5bis. Ne pas
reconstruire ces données côté client à partir d'autre chose.

La route cliente `sync` (`/#/synchronisation`) existe déjà
(`frontend/src/app/routes.ts`, livrée pendant le Lot 5 pour l'écran plein écran
`SyncPage.tsx`) : ce lot ne crée pas de route, il ajoute un onglet de barre haute qui y
pointe et une disposition à deux colonnes au-delà de 1024 px.

Un point de vigilance repris du Lot 5 : l'onglet **Chercher** n'a toujours ni route ni
écran (`GET /cartes` couvre déjà la recherche catalogue côté API, mais rien côté client).
Le handoff desktop ne le construit pas non plus — le raccourci `/` de la barre haute
ouvre la recherche **existante** (dans l'écran courant), pas un nouvel écran catalogue.

**Décidé avec l'utilisateur (2026-09-28)** : le handoff dessine dans la barre haute un
champ de recherche *global* (280 × 34, kbd `/`), présent sur tous les écrans, alors que
la Collection a en plus son propre filtre (kbd `F`) et que ni l'Atelier ni la
Synchronisation n'ont de recherche à laquelle déléguer. Le champ de la barre haute
délègue à la recherche de l'écran courant (Decks : filtre de liste ; Deckbuilder :
picker ; Collection : même filtre que `F`) et, sur l'Atelier et la Synchronisation, mène
à la Collection avec le texte saisi — solution (a) du choix initialement posé ici, qui
n'invente aucun écran. Ce comportement est un **repli provisoire** : l'utilisateur
confirme que Chercher reste un écran prévu pour un lot ultérieur
(`docs/lot-chercher-brief.md`), pas un renoncement. Quand ce lot livrera l'écran
Chercher, il devra **repointer** le champ global de la barre haute vers Chercher (au
moins pour l'Atelier et la Synchronisation, qui n'ont pas d'autre recherche propre) au
lieu de la Collection — à porter par ce futur lot, pas par le Lot 5bis, mais à garder en
tête pour ne pas coder ce repli comme un choix définitif (éviter par exemple de coupler
le libellé ou le raccourci à « Collection » d'une façon qui rendrait le repointage
coûteux).

## Découpage en étapes ordonnées

Même logique que le Lot 5 : les fondations partagées (breakpoint, composants
transverses) avant les écrans, et les écrans qui partagent un motif (panneau latéral,
raccourcis clavier) traités ensemble. Chaque étape se termine testable indépendamment
(`npm run lint`, `npm run test`) avant de passer à la suivante.

**Prérequis : le Lot 5 est clos.** Son étape 13 est faite (vérification du
2026-09-28) : 25 tests Playwright verts (9 `chromium`, 16 `real-backend`, e2e
d'acquisition compris), 247 tests vitest, `data-testid` recensés (170 occurrences sur
23 fichiers). Seul le contrôle manuel PWA dans Chrome DevTools reste à faire par
l'utilisateur. Le Lot 5bis se mesure contre cet état validé, une fois le Lot 5 commité.
Attention : ces 25 tests tournent en `Desktop Chrome` (1280 × 720), pas en largeur
mobile. L'étape 0 ci-dessous corrige ce point avant tout breakpoint.

| # | Étape | Fichiers principaux | Dépend de |
| --- | --- | --- | --- |
| 0 | Largeurs de test fixées (mobile et bureau) | `frontend/playwright.config.ts`, captures de référence mobile | clôture du Lot 5 |
| 1 | Breakpoint, barre haute et style `kbd` | `frontend/src/App.tsx`, `frontend/src/index.css` | 0 |
| 2 | Hook `useKeyboardShortcuts` et raccourcis de navigation (`G` puis `A/C/D/S`, `?`) | nouveau fichier sous `frontend/src/components/` (ou `app/`), `App.tsx` | 1 |
| 3 | Panneau latéral (d03, d05, d07) et champs bureau (inputs encadrés 40 px, steppers 36 px, chips 34 px) | `frontend/src/components/Sheet.tsx` étendu, ou `SidePanel.tsx` qui le réutilise ; `Stepper.tsx`, `LanguageChips.tsx` ; `index.css` | 1 |
| 4 | Composant `CardImage` (images KRCG) | nouveau `frontend/src/components/CardImage.tsx` | — |
| 5 | Atelier (d08) | `frontend/src/features/home/HomePage.tsx` | 1, 2 |
| 6 | Decks, maître/détail (d04) | `frontend/src/features/decks/DecksPage.tsx` | 1, 2 |
| 7 | Nouveau deck (d05) | `DecksPage.tsx` (feuille de création) | 3, 6 |
| 8 | Collection, vue tableau (d02) | `frontend/src/features/stock/StockPage.tsx`, `StockList.tsx` | 1, 2, 4 |
| 9 | Modifier une entrée (d03) | `frontend/src/features/stock/StockForm.tsx` | 3, 8 |
| 10 | Verser un produit (d07) | `frontend/src/features/stock/BundleDeposit.tsx` | 3, 8 |
| 11 | Deckbuilder (d01) | `DeckDetailPage.tsx`, `DeckComposition.tsx`, `DeckLegalityPanel.tsx`, `CardPicker.tsx`, `AddDeckCardForm.tsx` | 2, 3, 4, 6 ; décision `data-testid` prise avec qa-tests |
| 12 | Synchronisation, deux colonnes (d06) | `frontend/src/features/sync/SyncPage.tsx`, `CorrectionForm.tsx`, `RejectedOperations.tsx` | 1, 2 |
| 13 | États vides / chargement / introuvable (d09) | branches vides des composants ci-dessus, `Loading.tsx`, écran 404 d'`App.tsx` | 5 à 12 |
| 14 | Non-régression et validation de lot | suites vitest/Playwright aux deux largeurs, scénarios bureau, contrôle PWA manuel | 0 à 13 |
| 15 | **Fusion des dossiers de handoff** | `docs/design-handoff-mobile/` → dossier unique, `CLAUDE.md` | 14 |

Justification des regroupements et de l'ordre :

L'étape 0 existe parce que la suite Playwright ne tourne **pas** aujourd'hui en largeur
mobile : les deux projets de `frontend/playwright.config.ts` (`chromium` et
`real-backend`) utilisent `devices["Desktop Chrome"]`, soit 1280 × 720, au-dessus du
seuil de 1024 px. Dès que l'étape 1 posera le breakpoint, toute la suite existante
basculerait en disposition bureau (barre d'onglets basse absente, `nav-home`,
`nav-stock`, `nav-decks` à retrouver dans la barre haute) et la non-régression mobile
ne serait plus vérifiée par personne. Il faut donc, avant le breakpoint, fixer une
largeur mobile explicite aux projets existants (par exemple 390 × 844) et ajouter des
projets bureau (1440 × 900, la référence du handoff) qui ne prendront que les
scénarios de l'étape 14. Les captures de référence mobiles prises au même moment
servent au critère « aucune régression mobile » de la fin de lot.

Les étapes 1 à 4 sont un préalable strict, comme au Lot 5 : tant que la barre haute et
le breakpoint n'existent pas dans `App.tsx`/`index.css`, aucun écran ne peut être adapté
sans travail à refaire ensuite. Le style `kbd` rejoint l'étape 1 et non l'étape 2 : la
barre haute l'affiche sur chaque onglet (`G A`, `G C`…), elle ne peut pas être livrée
sans lui. Le panneau latéral et `CardImage` sont factorisés avant les écrans qui les
utilisent plutôt que réécrits à chaque écran (panneau aux étapes 7, 9, 10 ; `CardImage`
aux étapes 8 et 11). Les étapes 5, 6, 8 et 12 dépendent de l'étape 2 parce que chacun de
ces écrans porte ses raccourcis (`N`, `V`, `F`, `S`, `↵`).

Le panneau latéral n'est pas un composant à écrire de zéro : `Sheet.tsx` (Lot 5) porte
déjà `role="dialog"`, `aria-modal`, la fermeture par Échap et le focus sur le titre à
l'ouverture. Il lui manque ce que le handoff bureau exige : focus piégé, retour du focus
à l'élément déclencheur, fond `inert` à 35 % d'opacité, pied d'actions avec `⌘↵`,
entrée par glissement. Conformément au principe « un seul composant » (§ Risques),
l'étape 3 étend `Sheet` d'une disposition bureau commandée par la media query, ou crée
un `SidePanel` qui l'enveloppe ; elle ne duplique pas sa logique. Le focus piégé et le
retour du focus profiteraient aussi au mobile : les y activer est un changement de
comportement mobile, à déclarer au critère de non-régression. Les styles de champ bureau
(inputs encadrés, steppers, chips) sont décrits par le handoff dans la section du
panneau mais servent aussi au picker du Deckbuilder : ils sont posés ici, d'où la
dépendance de l'étape 11 à l'étape 3.

Les étapes 5 à 7 (Atelier, Decks, Nouveau deck) passent en premier parmi les écrans :
ce sont les points d'entrée de la barre haute et elles n'introduisent aucun motif que
les étapes suivantes ne connaissent pas déjà. L'étape 7 suit l'étape 6 et non seulement
l'étape 3, parce que les deux modifient `DecksPage.tsx`. L'aperçu de deck de l'étape 6
affiche un verdict et le compte des cartes bannies : c'est la légalité, lue en ligne
(`GET /decks/{id}/legalite`, §11 Lot 3 de CLAUDE.md). Hors ligne, l'aperçu garde les
comptes locaux (crypte, bibliothèque) et signale le verdict indisponible, comme
`DeckLegalityPanel` le fait déjà ; le bloc « verdict + comptes » est factorisé ici pour
être réutilisé par l'en-tête du Deckbuilder (étape 11).

Les étapes 8 à 10 (Collection, Modifier une entrée, Verser un produit) vont ensemble
pour la même raison qu'au Lot 5 — elles partagent le panneau latéral et l'écran de
Collection ouvre les deux autres.

L'étape 11 (Deckbuilder) est volontairement la plus tardive parmi les écrans : c'est la
fusion la plus profonde (détail de deck + légalité + picker dans une seule vue à deux
colonnes, **sans panier** contrairement au mobile — chaque ajout part immédiatement en
file). Elle a besoin de `CardImage` (aperçu de la carte sélectionnée, étape 4), des
raccourcis clavier (navigation `↑↓`, `+ −`, validation `↵`, étape 2), des styles de
champ bureau (étape 3 ; le panneau lui-même n'y sert pas) et du bloc verdict factorisé
avec l'aperçu de deck (étape 6). La version précédente de ce plan la faisait dépendre
de l'étape 9 (Modifier une entrée) : aucun élément de d03 n'est repris par d01, cette
dépendance est retirée. Deux points de comportement à concevoir avant d'écrire :
l'acquisition du Lot 4b (compteur « possédés », proxies pour le reste,
`acquired_quantity`) doit rester possible en mode sans panier, et la teinte « +2 à
l'instant » de la ligne modifiée repose sur l'écriture optimiste du miroir, pas sur le
retour du serveur.

L'étape 12 (Synchronisation) est indépendante sur le plan visuel — elle étend
`SyncPage.tsx`, déjà autonome depuis le Lot 5 — mais dépend de la barre haute (1) pour
son onglet dédié et des raccourcis (2) pour `S` et `⌘↵`. Le handoff la présente comme une
« nouvelle route `sync` » : c'est antérieur au Lot 5, la route existe. Sous 1024 px,
rien ne change : la Synchronisation reste hors de la barre d'onglets basse, atteinte
depuis l'alerte de l'Atelier.

L'étape 13 reprend le principe du Lot 5 : une passe transverse une fois que la forme
« pleine » de chaque écran est stabilisée, pas avant.

L'étape 14 (non-régression) valide que le Lot 5 (< 1024 px) n'a pas régressé — le risque
principal de ce lot est justement de casser la disposition mobile en généralisant un
composant partagé (voir § Risques). Elle s'appuie sur les largeurs et les captures
fixées à l'étape 0.

L'étape 15 est décrite en détail ci-dessous.

## Répartition par agent

Comme au Lot 5, le travail relève presque entièrement de **frontend-react**. Le tableau
ci-dessous fixe, étape par étape, l'agent qui **porte** l'étape (il écrit le code et
livre l'étape verte : `npm run lint`, `npm run test`) et ceux qui interviennent en
**soutien** (une partie bornée du travail) ou en **revue** (relecture avant de clore
l'étape, sans écrire le code). L'orchestrateur délègue chaque étape au porteur, lui
transmet ce plan et le handoff, puis déclenche la revue. Aucune étape n'est portée par
l'architecte-contrat, le backend-fastapi ou devops-deploiement dans le périmètre retenu
(voir « Ce que ce lot ne touche pas »).

| # | Étape | Porteur | Soutien ou revue |
| --- | --- | --- | --- |
| 0 | Largeurs de test fixées | **qa-tests** | frontend-react (revue : aucun test existant ne dépend d'une largeur bureau) |
| 1 | Breakpoint, barre haute, `kbd` | **frontend-react** | pwa-offline (revue : l'app shell et le repli de navigation hors ligne tiennent avec la nouvelle structure d'`App.tsx`) ; qa-tests (revue : suite mobile verte à la largeur fixée à l'étape 0, `nav-*` toujours présents sous 1024 px) |
| 2 | `useKeyboardShortcuts` | **frontend-react** | qa-tests (soutien : tests vitest des raccourcis, dont l'inactivité dans un champ de saisie sauf `Échap` et `⌘↵`) |
| 3 | Panneau latéral et champs bureau | **frontend-react** | qa-tests (revue : focus piégé, retour du focus, `inert`, et comportement mobile de `Sheet` inchangé ou changement déclaré) |
| 4 | `CardImage` | **frontend-react** | pwa-offline (soutien : comportement réseau et service worker des images, voir ci-dessous) |
| 5 | Atelier (d08) | **frontend-react** | — |
| 6 | Decks, maître/détail (d04) | **frontend-react** | pwa-offline (revue : verdict de légalité hors ligne signalé indisponible, sans appel bloquant) |
| 7 | Nouveau deck (d05) | **frontend-react** | — |
| 8 | Collection, tableau (d02) | **frontend-react** | pwa-offline (revue : colonne « Decks » et édition en place par `saveStock` calculées et écrites en local, sans appel réseau) |
| 9 | Modifier une entrée (d03) | **frontend-react** | — |
| 10 | Verser un produit (d07) | **frontend-react** | — |
| 11 | Deckbuilder (d01) | **frontend-react** | qa-tests (soutien, **avant** l'étape : décision sur les `data-testid`) ; pwa-offline (revue : ajout immédiat en file, acquisition du Lot 4b, écriture optimiste du miroir) |
| 12 | Synchronisation (d06) | **frontend-react** | pwa-offline (revue : état « Synchroniser maintenant » désactivé hors ligne, sélection d'une opération refusée sans effet sur la file) |
| 13 | États (d09) | **frontend-react** | qa-tests (revue : contrat `aria-busy` de `Loading`, un seul `role="status"` dans la coquille) |
| 14 | Non-régression et validation | **qa-tests** | pwa-offline (soutien : contrôle manuel PWA aux deux largeurs) ; frontend-react (corrections des défauts trouvés) |
| 15 | Fusion des dossiers de handoff | **orchestrateur** | — (documentation et `CLAUDE.md`, rôle propre de l'orchestrateur) |

L'**architecte-contrat** n'a pas d'étape : l'écart de données au handoff (disciplines,
types, coût, image par impression, cf. « Ce que ce lot ne touche pas ») est tranché,
reporté au lot Chercher, et ne rouvre pas l'ordre des lots. **devops-deploiement** n'a
pas d'étape non plus ; il hérite seulement d'une note pour le Lot 11 (CSP, ci-dessous).

**pwa-offline** intervient sur les points suivants :

- **`CardImage` et le réseau externe** (étape 4) : les images de carte viennent de
  `static.krcg.org`. Le handoff demande d'ajouter ce domaine à la CSP `img-src`, mais
  le dépôt **n'a aucune CSP** aujourd'hui (ni balise `meta` dans `frontend/index.html`,
  ni en-tête dans `vite.config.ts` ; vérifié le 2026-09-28) : les images se chargent donc
  sans rien changer. Ce lot n'introduit pas de CSP — ce serait une décision de sécurité
  à part entière, qui toucherait le service worker et le serveur de développement. La
  consigne est reportée au déploiement (Lot 11, devops-deploiement) : toute CSP future
  devra inclure `img-src https://static.krcg.org`. Chargement paresseux, pas de précache
  — CLAUDE.md § 3 exige que l'app shell s'affiche hors ligne, pas que chaque image de
  carte soit disponible hors ligne ; le handoff le dit lui-même (« hors ligne, masquer
  l'aperçu »). À vérifier : que l'échec réseau d'une image ne produit ni erreur non
  gérée ni image cassée visible. Côté service worker, `vite.config.ts` déclare
  `runtimeCaching: []` : aucune image externe n'est mise en cache, et ce lot n'ajoute
  pas de règle ;
- **revues offline** des étapes 1, 6, 8, 11 et 12 (tableau ci-dessus) : aucune saisie ne
  doit passer par un appel bloquant (CLAUDE.md § 10), y compris les nouvelles
  interactions propres au bureau (édition en place dans le tableau, ajout immédiat du
  Deckbuilder) ;
- **cohérence du manifeste et du breakpoint** : aucun changement de manifeste attendu
  ici, mais le contrôle d'installabilité de l'étape 14 doit être repris en fenêtre
  bureau puisque `App.tsx` change de structure au-delà de 1024 px.

**qa-tests** intervient en non-régression et sur un point nouveau par rapport au
Lot 5 : ce lot introduit un **vrai** breakpoint testable, donc un axe de test qui
n'existait pas encore (viewport). Trois angles :

- fixer les largeurs avant tout changement de disposition (étape 0) : contrairement à
  ce que supposait la première version de ce plan, la suite existante ne tourne pas en
  largeur mobile implicite mais en `Desktop Chrome` (1280 × 720) ;
- vérifier que les suites Playwright existantes, une fois ramenées à une largeur mobile
  explicite, restent vertes sans autre modification, et ajouter les scénarios bureau qui en valent la peine
  (au minimum : navigation par la barre haute, ouverture d'un panneau latéral, le
  Deckbuilder à deux colonnes) plutôt que de dupliquer tout le parcours mobile en
  desktop ;
- statuer, comme au Lot 5 étape 10, sur les `data-testid` du Deckbuilder fusionné :
  l'écran desktop réutilise-t-il exactement ceux du picker mobile fusionné du Lot 5, ou
  en faut-il de nouveaux pour la disposition à deux colonnes (carte sélectionnée en
  tête, légende de raccourcis) ? À trancher avec frontend-react avant l'étape 11, pas
  après.

## Risques et points d'attention

**Un seul jeu de composants pour deux dispositions.** Le handoff mobile (Lot 5) et le
handoff desktop décrivent la *même* donnée avec une disposition différente (feuille
plein écran vs panneau latéral, tab bar basse vs barre haute, picker à panier vs picker
immédiat). Le risque concret est qu'une media query mal placée fasse fuiter un style
desktop sous 1024 px, ou qu'un composant desktop soit codé comme un composant séparé qui
diverge du mobile au premier changement de comportement futur. À trancher explicitement
à l'étape 1 : un seul composant par écran, branché par media query CSS et, seulement là
où l'interaction change réellement (Deckbuilder : panier ou non), par une lecture de la
largeur de fenêtre — pas une deuxième copie du composant.

**Le picker sans panier en desktop (étape 11).** Le Lot 5 a fusionné `CardPicker` et
`AddDeckCardForm` en un seul écran, **sans** le panier du handoff mobile : une carte à la
fois, chaque ajout part en file dès sa validation (CLAUDE.md § 11, Lot 5). Le handoff
desktop demande la même chose pour le Deckbuilder, donc l'interaction ne change pas. Ce
qui change, c'est la disposition : un picker toujours visible dans la colonne de droite,
au lieu d'une feuille qu'on ouvre puis referme. Le risque se réduit à ce changement de
disposition, qui reste à traiter dans le même composant et non dans un deuxième.

**Raccourcis clavier et accessibilité.** Les raccourcis globaux (`/`, `N`, `V`, `G` puis
`A/C/D/S`, `?`, `Échap`, `⌘↵`/`Ctrl↵`) doivent rester inactifs quand le focus est dans un
champ de saisie (le handoff le précise), sous peine de conflit avec la frappe normale.
Le `kbd` visible doit être masqué au lecteur d'écran (`aria-hidden`) quand le raccourci
est déjà porté par `aria-keyshortcuts`, pour ne pas le lire deux fois. Le focus piégé du
panneau latéral (étape 3), avec retour du focus à l'élément déclencheur à la fermeture, est un
prérequis d'accessibilité explicite du handoff, pas une amélioration optionnelle.

**Images KRCG et normalisation du nom.** Le handoff décrit deux formes d'URL
(générique vs par set) avec repli sur la forme générique en cas de 404, et recommande de
privilégier l'URL exposée par l'API KRCG plutôt que de reconstruire le nom normalisé à la
main. Vérifié : c'est déjà le cas pour la forme générique. L'import copie le champ `url`
de krcg dans `card.image_url`, exposé par `CardSummary.image_url` et stocké dans le
miroir (`CardRow.imageUrl`) ; `CardImage` le lit tel quel, sans normalisation côté
client. La forme par set n'est pas exposée (`card_printing.image_url` reste en base), et
la reconstruire à la main réintroduirait une normalisation à maintenir : elle est hors
périmètre (voir « Ce que ce lot ne touche pas »). Pour mémoire, `fold_text`/`foldText`
sert la recherche, pas les noms de fichiers KRCG : ce sont deux normalisations
différentes, à ne pas confondre.

**Contrôle manuel PWA à reprendre.** Comme à chaque lot qui touche `App.tsx`, le
panneau Application de Chrome DevTools (manifest, service worker, coupure réseau) est à
revérifier à l'étape 14, cette fois en fenêtre ≥ 1024 px en plus de la fenêtre mobile
déjà validée au Lot 5.

## Étape 15 — Fusion des dossiers de handoff

Demande explicite pour ce lot : à ce jour, `docs/design-handoff-mobile/` contient déjà
les deux handoffs côte à côte (le desktop y a été intégré tel quel avant l'écriture de ce
plan, parce que `DESKTOP.md` référence les mêmes tokens et le même canevas que le
handoff mobile). Le dossier reste cependant nommé comme s'il ne couvrait que le mobile,
ce qui est trompeur une fois le Lot 5bis livré. Cette étape n'ajoute aucun fichier de
design nouveau : elle range ce qui existe déjà sous un nom et une structure qui
reflètent les deux dispositions.

À faire, une fois l'implémentation validée (étape 14) :

1. **Renommer le dossier** `docs/design-handoff-mobile/` → `docs/design-handoff/`.
   `git mv` garde le suivi du fichier, mais touche l'index : le proposer à
   l'utilisateur plutôt que de le lancer d'office, et ne rien commiter sans sa
   validation (règle du projet sur l'historique git).
2. **Un seul point d'entrée** : soit fusionner `README.md` et `DESKTOP.md` en un
   document unique qui décrit d'abord ce qui est commun (tokens Nocturne, copie
   française, comportement), puis les deux dispositions (mobile < 1024 px, desktop
   ≥ 1024 px) chacune dans sa section ; soit garder deux fichiers mais renommés
   symétriquement (`MOBILE.md` / `DESKTOP.md`) avec un `README.md` court qui ne fait que
   les présenter et pointer vers chacun. Choix à trancher à l'écriture plutôt
   qu'ici — les deux options tiennent la promesse « un seul handoff, deux
   dispositions » ; la première évite la duplication entre `README.md` et
   `DESKTOP.md` sur ce qu'ils ont en commun (tokens, copie, portée), que `DESKTOP.md`
   se contente aujourd'hui de renvoyer au `README.md`.
3. **Screenshots** : dossier `screenshots/` unique, déjà organisé en
   `screenshots/1b-*.png` (mobile) et `screenshots/desktop/d0*.png` (desktop) — aucun
   renommage de fichier nécessaire, seul le dossier parent change.
4. **Mettre à jour les références** :
   - `CLAUDE.md` § 4 (arborescence, mention `design-handoff-mobile/`) et § 12
     (Lot 5 : « un handoff de design … dans `docs/design-handoff-mobile/` » ; Lot 5bis :
     retirer la mention « handoff desktop distinct … dans un dossier séparé » si elle y
     figure encore, et pointer vers `docs/design-handoff/`) ;
   - tout lien vivant ailleurs dans `docs/` qui continuera d'être lu après la clôture du
     lot (ce plan lui-même, une éventuelle mise à jour de `docs/lot5-plan-design.md` en
     tête de fichier).
   - `docs/lot5-plan-design.md` décrit un état passé
     (« Ce lot livre l'affichage mobile », chemin `docs/design-handoff-mobile/` tel qu'il
     était pendant le Lot 5) : c'est un document d'époque, pas une référence
     vivante — ne pas le réécrire pour suivre le renommage. Au moment du renommage,
     ajouter en tête de ce plan-ci une ligne signalant que le chemin a changé (elle n'y
     est pas encore : ce plan cite toujours `docs/design-handoff-mobile/`, qui est le
     chemin réel tant que l'étape 15 n'est pas faite).
5. **Vérifier qu'aucun code applicatif ne référence le chemin** (peu probable — les
   handoffs sont de la documentation, pas des assets servis par le front — mais un
   `grep -r "design-handoff-mobile"` sur `frontend/` et `backend/` avant de clore
   l'étape coûte peu).

## Critère de fin de lot

Repris du critère du Lot 5, avec l'ajout du breakpoint :

- `npm run lint` et `npm run test` (vitest) verts, sans suppression ni renommage de
  test pour faire passer la suite ;
- `npm run test:e2e` (Playwright) vert **aux deux largeurs** — la suite existante, ramenée
  à une largeur mobile explicite à l'étape 0 sans autre changement, et les nouveaux
  scénarios bureau de l'étape 14 (sous OneDrive, vérifier le nombre de tests exécutés,
  cf. CLAUDE.md § 11) ;
- tous les `data-testid` recensés à la clôture du Lot 5 toujours présents en dessous de
  1024 px, ou leur disparition justifiée et actée avec qa-tests (cas du Deckbuilder,
  étape 11, symétrique à l'étape 10 du Lot 5) ;
- contrôle manuel de l'installabilité PWA repris en fenêtre ≥ 1024 px en plus de la
  fenêtre mobile ;
- aucune régression sur l'affichage mobile du Lot 5 : la disposition < 1024 px doit
  rester identique aux captures de référence prises à l'étape 0, sauf changement
  déclaré et justifié (par exemple le focus piégé de `Sheet`, étape 3). Aucun outil de
  comparaison au pixel n'est en place aujourd'hui : la comparaison est visuelle, ou par
  `toHaveScreenshot` si qa-tests juge le rendu assez stable pour l'automatiser ;
- les écarts de données au handoff (disciplines, types, coût, image par impression)
  restent conformes à la décision actée (reportés au lot Chercher, non comblés ici) ;
- `docs/design-handoff-mobile/` n'existe plus en tant que tel : un seul dossier de
  handoff, `docs/design-handoff/`, couvre mobile et desktop (étape 15).

## Suivi

Ce document est un plan d'entrée de lot, pas un journal de décisions au sens du § 11 de
CLAUDE.md. Une fois le Lot 5bis clos, les arbitrages qui en valent la peine (structure
retenue à l'étape 15, mode panier/sans-panier du Deckbuilder, `data-testid` du picker
desktop, comportement du champ de recherche global, absence de CSP et consigne
`img-src` pour le Lot 11) ont vocation à migrer vers CLAUDE.md § 11 et § 12, comme pour les lots
précédents.
