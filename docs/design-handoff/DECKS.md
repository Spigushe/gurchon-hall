# Handoff — affichage des decks (crypte / bibliothèque)

Complète `MOBILE.md`, `DESKTOP.md`, `LOT7.md` et `CHERCHER.md` ; ne décrit que la lecture et l'édition de la composition d'un deck. Mêmes tokens Nocturne, même copie française, aucune couleur nouvelle. Reçu le 2026-11-06 (archive « Révision page deck application.zip », dossier `design_handoff_deck_display/`), versé ici sans changement de fond : les seules retouches sont listées en fin de fichier, et la section « Raccord au code » relève ce que le handoff ignore du code actuel.

Fichiers : `Gurchon Hall Decks.dc.html` (les deux routes, `#/decks` et `#/decks/{key}`, données d'exemple, tri, groupes et légalité dans le `<script>`), `DeckTables.dc.html` (le composant de tableaux, éditable ou en lecture seule, importé par le précédent), `Gurchon Hall Deck Page.dc.html` (première version du deckbuilder seul, gardée pour référence). Captures : `screenshots/desktop/d22…d24`, `screenshots/1b-43`, `1b-44`.

## Objet

Un seul composant de tableau crypte + bibliothèque, dense, avec les icônes de krcg. Il remplace :

- `DeckCompositionColumns` dans `DecksPage.tsx` (aperçu bureau de `#/decks`), en **lecture seule** ;
- `DeckComposition` dans `DeckDetailPage.tsx` (`#/decks/{key}`, bureau et mobile), en mode **éditable**, lecture seule si le deck est archivé.

Les `.dc.html` sont des références de rendu et de comportement, pas du code à copier : on les recrée en React + TypeScript avec ce qui existe (`src/components`, hooks de `offline/vtes`, `useIsDesktop`, `useGuardedAction`, classes de `index.css`, Phosphor).

**Fidélité** haute pour les tableaux (tailles, couleurs, icônes, densité). L'en-tête de page, la liste maître et le picker gardent la structure du code ; seules les différences ci-dessous s'appliquent.

## Écrans

### d22 · `#/decks`, liste + aperçu (bureau ≥ 1024px)

- Disposition flex, `gap` `--space-8` (22,4px). Colonne maître `flex: 0 1 360px`, aperçu `flex: 1 1 560px`. Sous 1024px, pas d'aperçu, la ligne ouvre le deck (inchangé).
- Ligne de deck, ajouts : à droite, les icônes des clans distincts de la crypte (VTES Clans 18px, `--color-neutral-200`). Méta `#0001 · actif · combat · proxies autorisés · 12 / 80` (crypte / bibliothèque). Sélection bureau : fond `--color-neutral-800` et barre gauche 3px `--color-accent`.
- Aperçu : kicker « APERÇU » (12px, majuscules, `letter-spacing: .06em`, `--color-neutral-300`), titre 26px/500, méta 13px + badge de légalité (`.tag.tag-accent` « Légal » ou `.tag.tag-outline` « Illégal · crypte 8/12 »), bouton `.btn-primary` « Ouvrir le deckbuilder ↵ », puis `DeckTables` en lecture seule.

### d23, d24 · `#/decks/{key}`, deckbuilder

- En-tête inchangé dans sa logique : fil « ← Decks · Deck actif · #0001 », titre, méta, légalité, actions Modifier / statut / Archiver.
- Corps en flex wrap, `gap` 16,8px. Tableaux `flex: 1 1 640px`, picker `flex: 0 1 300px; min-width: 260px`.
- Picker **repliable** : bouton `›` (`.btn-ghost.btn-icon`) dans son en-tête ; replié, il devient un bouton `.btn-secondary` vertical (`writing-mode: vertical-rl`) « + Ajouter des cartes ». Onglets Crypte / Bibliothèque en `.seg` (`label.seg-opt` + radio caché).
- Mobile (1b-44) : tableaux empilés, pilule flottante « Ajouter des cartes » inchangée.
- Deck archivé : `DeckTables` en lecture seule, pas de picker.

## Composant `DeckTables` (`editable: boolean`)

Grille externe `grid-template-columns: repeat(auto-fit, minmax(min(100%, 440px), 1fr))`, `gap` 16,8px : côte à côte à partir de 2 × 440px, empilés en dessous.

Chaque section : fond `--color-surface`, `border-radius` 8px, `box-shadow: var(--shadow-sm)`, `overflow: hidden`. En-tête : padding 11,2px 11,2px 8,4px, filet bas 1px `--color-neutral-800`, titre 16px/500 + total en `--color-accent-300`, stats à droite en 12px `--color-neutral-300`.

### Crypte

- Tri par capacité décroissante.
- Stats d'en-tête : groupes (`G5–6`) et « cap. moy. 6.2 ».
- Intitulés 11px, majuscules, `letter-spacing: .05em`, `--color-neutral-400` : Qté · Cap · Nom · Disc. · Clan · G.
- Ligne de **34px**, padding horizontal 11,2px, `gap` 8,4px, grille `[qté] 26px minmax(0,1fr) auto 30px 30px`.
  - qté : 78px (stepper) en éditable, 26px (`2×`, 14px, `--color-neutral-200`) en lecture seule ;
  - capacité : pastille ronde 22×22, fond `--color-neutral-800`, `inset 0 0 0 1px var(--color-accent-700)`, 12px/600 ;
  - nom : 14px, points de suspension, survol `--color-accent-200` ;
  - disciplines : Ankha 22px, `gap` 5px ;
  - clan : VTES Clans 22px, `--color-neutral-100`, `title` = nom du clan ;
  - groupe : `G6`, 12px, chiffres tabulaires, aligné à droite.

### Bibliothèque

- Stats d'en-tête : total sang, total réserve, nombre de proxies (masquable).
- Groupes par type, dans cet ordre : Master, Action, Action Modifier, Political Action, Ally, Equipment, Retainer, Combat, Reaction, Event.
- Titre de groupe : padding 11,2px 11,2px 5,6px ; icône de type (Ankha 18px), nom (12px majuscules, `.06em`, `--color-accent-300`), total (12px `--color-neutral-400`), et « · 7 trifle » pour les masters sans coût (12px `--color-neutral-500`).
- Filet sous le titre : 1px, marge 0 11,2px 2,8px, `linear-gradient(90deg, var(--color-accent-600), var(--color-neutral-700) 40%, transparent)`.
- Ligne de **32px**, grille `[qté] minmax(0,1fr) auto 28px 28px 24px` : qté · nom · disciplines (Ankha 20px) · clan requis (VTES Clans 20px) · coût (Ankha 20px, `title` « 2 réserve ») · proxies (`P2`, 11px `--color-neutral-500`, vide à 0).

### Commun aux deux sections

- Zébrage : lignes impaires `color-mix(in oklab, var(--color-neutral-800) 45%, transparent)`, paires transparentes, l'index repartant à chaque section ou groupe.
- Stepper : boutons 22×22, bordure 1px `--color-neutral-700`, radius 4px, texte `--color-neutral-200` ; au survol bordure `--color-accent` et texte `--color-accent-200` ; valeur sur 24px, 14px tabulaire. Placé **à gauche** du nom.
- **Passer à 0 retire la ligne** : le bouton « Retirer » de `CompositionRow` disparaît, et le `−` n'est plus désactivé à 1.
- Plusieurs lignes d'une même carte (langue × extension) se fusionnent à l'affichage (somme des quantités et des proxies). En éditable, le stepper agit sur la ligne principale ; le détail langue / extension et « convertir des proxies » passent dans un détail au clic sur le nom. **À arbitrer** selon le handoff lui-même.
- Glyphes Ankha (disciplines, types, coûts) : `color: var(--color-neutral-900)` et contour clair en `text-shadow` 1px dans les huit directions, en `--color-neutral-100`, parce que les glyphes sont dessinés sombre sur clair. Clans : plein, `--color-neutral-100`.

## État

- `DecksPage` : inchangé (`selectedKey`, filtre, terme).
- `DeckView` : ajoute `pickerOpen` (bureau ; le handoff conseille de le garder en `localStorage`).
- `DeckTables` : sans état ; reçoit `lines`, `editable`, `onSetQuantity(line, n)` (n = 0 → `removeDeckCard`, sinon `saveDeckCard` avec `proxyQuantity = min(proxy, n)`), et `showProxies` pour masquer la colonne et le total des proxies.

## Données attendues par le handoff

Pour chaque ligne : `cardType`, `disciplines` (trigrammes, la casse portant le niveau), `clan` (crypte) ou `requiredClan` (bibliothèque), `capacity`, `group`, `bloodCost`, `poolCost` (nombre ou `"X"`). Une valeur inconnue s'affiche sans icône, jamais en lettre brute.

## Tokens Nocturne utilisés

Couleurs : fond `#161826`, surface `#232532`, texte `#e9e9ed`, accent `#9184d9`, rampes `--color-neutral-100…900` et `--color-accent-200/300/600/700`. Espacements `--space-1` 2,8 · `-2` 5,6 · `-3` 8,4 · `-4` 11,2 · `-6` 16,8 · `-8` 22,4px. Radius 4 / 8 / 14px, ombre `--shadow-sm`. Inter : 26 (titres de page), 16 (titres de section), 14 (lignes), 13 (méta), 12 (stats, kickers), 11 (intitulés, proxies) ; poids 500 au plus, 600 pour la capacité. Le `styles.css` joint à l'archive est identique, octet pour octet, à `nocturne/styles.css` : il n'a pas été recopié.

## Raccord au code

Relevé le 2026-11-06 sur `main` après la fusion du lot Chercher (#54). Le handoff a été dessiné sans connaître ce que ce lot a livré ; ces points sont à reprendre dans le plan d'implémentation, pas à appliquer à la lettre. Ils le sont dans `docs/lot-affichage-decks-plan.md`, qui fait foi pour les données et les règles.

1. **Polices.** Le handoff charge `ankha2.otf` et `vtes-clans.otf` depuis static.krcg.org sous les noms « Ankha » et « VtesClans ». L'application les sert déjà elle-même, précachées, sous « Ankha VTES » et « VTES Clans » (`frontend/src/index.css`, classes `.glyph--ankha` et `.glyph--clans`). Rien à ajouter, et surtout pas d'appel à static.krcg.org, qui casserait l'affichage hors ligne.
2. **Table de glyphes.** Le handoff demande un module `features/decks/vtesGlyphs.ts`. Il existe déjà dans `features/search/glyphs.ts` (`disciplineGlyph`, `typeGlyph`, `costGlyph`, `clanGlyph`) avec le composant `GlyphIcon` de `features/search/Glyph.tsx`, et il est plus complet que les extraits du handoff (Oblivion, Striga, Maleficia, vertus, Flight). À partager entre les deux écrans, par exemple en le remontant dans `src/components/`, plutôt qu'à dupliquer. Le carré vide de la colonne Disc. sur d23 vient de la table incomplète du prototype.
3. **Couleur des glyphes, contradiction avec `CHERCHER.md`.** Chercher affiche les glyphes Ankha en plein, `--color-neutral-300`, alors que ce handoff les veut sombres avec un contour clair. Une seule règle doit gagner pour toute l'application : à trancher.
4. **Repli texte.** Ce handoff interdit la lettre brute pour une valeur inconnue ; `Glyph.tsx` rend aujourd'hui le code en `.glyph-fallback`. Même chose dans `CHERCHER.md` (« Aucun repli texte »), donc un écart déjà présent, pas nouveau.
5. **Données.** Tout ce que le handoff réclame est déjà au miroir local depuis le lot Chercher, mais pas dans `LocalDeckCard` (`offline/vtes/overlay.ts`, qui ne porte que carte, langue, extension, quantités et nom) : capacité, groupe et clan sont dans `cards` (`CardRow`), types, disciplines et coût dans `cardDetails` (`CardDetailRow`), le clan requis dans `clanRequirements`. Le coût y est un couple `costType` / `costValue` et non deux champs `bloodCost` / `poolCost`. Aucune donnée n'est à ajouter au contrat ni à `/sync`. Un miroir **incomplet** (serveur d'avant le lot Chercher, `cardDetails` vide) doit rester lisible : lignes sans icône ni coût, comme Chercher sans ses filtres.
6. **Fusion des lignes d'une même carte.** La clé d'une ligne de deck est carte × langue × extension (Lot 4). Afficher une ligne fusionnée avec un stepper qui agit sur « la ligne principale » demande de définir cette ligne principale et ce que fait `−` quand elle tombe à 0 alors qu'une autre reste. Point ouvert du handoff, à trancher avec le détail au clic sur le nom.
7. **Stepper et acquisition.** `onSetQuantity` avec `proxyQuantity = min(proxy, n)` est exactement ce que fait le stepper actuel de `CompositionRow` : un `+` ajoute un exemplaire réel, que le serveur refuse s'il manque au stock. Le handoff ne change rien là-dessus et ne parle ni de proxy ni d'acquisition (Lot 4b). Garder ce comportement, ou faire passer le `+` par le calcul du picker (`computeAddedLine`, `useAddDeckCard`), est une décision à prendre, pas un détail de rendu.
8. **Passer à 0 retire la ligne.** Retire le bouton « Retirer » : vérifier les `data-testid` et les e2e qui s'appuient dessus (`node scripts/testid-census.mjs --check …`), un identifiant disparu devant être justifié.
9. **Captures.** Celles de l'archive sont des JPEG de 909 à 924px de large, nommés `.png`, et les deux « mobiles » ont été prises à la même largeur que les bureau. Elles sont versées en `.jpg` sous la numérotation du dossier, sans retouche ; elles ne remplacent pas un rendu à 390px. Les régénérer depuis les prototypes par Playwright, comme au lot Chercher, reste possible.

## Retouches au versement

- Prototypes renommés selon l'usage du dossier (`Decks.dc.html` → `Gurchon Hall Decks.dc.html`, `Deck Page.dc.html` → `Gurchon Hall Deck Page.dc.html`) ; `DeckTables.dc.html` garde son nom, que `<dc-import name="DeckTables">` cherche.
- Feuille de style pointée sur `nocturne/styles.css` au lieu de `_ds/nocturne-…/styles.css`, et chargement de `_ds/nocturne-…/_ds_bundle.js` retiré : ni l'un ni l'autre n'était dans l'archive, et les prototypes déjà versés s'en passent.
- Captures renommées : `desktop-01-liste-apercu` → `desktop/d22-decks-apercu.jpg`, `desktop-02-deck-crypte` → `desktop/d23-deck-crypte.jpg`, `desktop-03-deck-bibliotheque` → `desktop/d24-deck-bibliotheque.jpg`, `mobile-01-liste` → `1b-43-decks.jpg`, `mobile-02-deck` → `1b-44-deck.jpg`.

## Écarts retenus à l'implémentation

Lot Affichage des decks, clos le 2026-11-07 ; décisions et justifications dans `docs/lot-affichage-decks-plan.md` (P1 à P10, A1 à A8, livraisons).

- **Glyphes Ankha** : le rendu du handoff (encre sombre, contour clair dans les huit directions) s'applique à toute l'application, Chercher compris (P1). Une case de discipline cochée dans Chercher change le contour, plus la couleur du glyphe.
- **Lignes fusionnées** (point 6 du raccord) : pas de « ligne principale ». Une carte à une seule ligne langue × extension garde son stepper ; à plusieurs, une icône `ph-stack` le remplace, qui ouvre et referme le détail. Le nom ouvre, pour toute carte, un détail sous la ligne avec chaque ligne langue × extension, son stepper, « Retirer du deck », la conversion de proxies, puis les exemplaires libres d'autres langues ou extensions et « Un proxy » (P2).
- **`+`** (point 7) : il prend au stock identique ; s'il reste la même carte dans une autre langue ou extension, il ouvre le détail pour qu'on choisisse ; sinon il ajoute un proxy si le deck l'autorise ; sinon il est désactivé, raison en infobulle (P3). Le handoff gardait le `+` réel que le serveur refusait au rejeu.
- **`−` à 1 retire la ligne**, comme le handoff, sans confirmation ; « Retirer du deck » reste dans le détail (P4).
- **Téléphone, 390px** : la crypte aligne ses disciplines en colonnes, d'après une capture de VDB fournie par l'utilisateur, sur la ligne jusqu'à cinq colonnes et sous le nom au-delà ; en bibliothèque, les disciplines passent sous le nom en 17px sous 440px de section (P5). Rendu validé sur captures, faute de maquette à cette largeur.
- **Types de bibliothèque** : Reflex, Power et Conviction viennent après Event ; une carte à plusieurs types forme son propre groupe, « Action Modifier/Reaction », au rang de son premier type (P6).
- **« trifle »** compte les masters dont le texte contient le mot-clé, pas les masters sans coût (A3).
- **Colonne et total des proxies** affichés si le deck les autorise ou si une ligne en porte (P8).
- **Ligne de deck de la liste** : icônes de clan et « crypte / bibliothèque » aux deux largeurs, pas seulement au bureau (P7). Au bureau, la ligne sélectionne et n'ouvre plus ; sa flèche disparaît.
- **Aperçu bureau** : le résumé à quatre chiffres disparaît, remplacé par le badge et les en-têtes de tableau ; le total de réserve s'écrit « pool », comme ailleurs dans l'application.
- **En-tête du deckbuilder bureau** : actions du deck à droite ; la légalité est la pastille de d23, à côté de la méta, et le détail du verdict (motifs, cartes bannies, alertes, Lot 5c) passe dans son infobulle, au survol ou au focus. Un clic sur la pastille ou `R` recalcule ; le bouton « Recalculer » disparaît.
- **Picker** : état replié mémorisé par appareil (`localStorage`), ouvert par défaut ; onglets Crypte / Bibliothèque, Bibliothèque par défaut, repris dans la feuille d'ajout mobile (P9). Pas de picker pour un deck archivé.
- **Glyphes de clan** : `--color-neutral-300` au lieu de `--color-neutral-100`, lissage en gris, et 26px en crypte, 24px en bibliothèque au lieu de 22 et 20 : les symboles détaillés (Banu Haqim, Giovanni, Salubri) se brouillaient. Couleur et lissage valent pour toute l'application.
- **Icône inconnue** : cellule vide, nom en infobulle, dans les tableaux ; Chercher garde son repli texte, écart antérieur (A4).
- **Miroir incomplet** : bibliothèque en un seul groupe « détails à venir », cartes hors catalogue dans un groupe « Hors catalogue local » (A5).
