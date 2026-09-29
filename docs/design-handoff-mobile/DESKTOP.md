# Handoff — vue bureau (direction « 3a », centrée)

Complète `README.md` (mobile, direction 1b). Mêmes tokens Nocturne, même ton, même copie
française, mêmes hooks/données. Ce document décrit uniquement ce qui change à partir de
**≥ 1024 px** de large. Référence : 1440 × 900. Fidélité : **haute**.

Fichiers : `Gurchon Hall Bureau.dc.html` (section **3a** ; ignorer 3b, écartée),
`TopBar.dc.html` (barre haute), `screenshots/desktop/d01…d09.png`.

## Breakpoint et gabarit
- `< 1024px` : layout mobile du README (barre d'onglets en bas).
- `≥ 1024px` : barre haute + colonne de contenu **max-width 1200px centrée**,
  padding vertical 28px (48px sur Atelier / États). En dessous de 1264px, padding
  horizontal 32px.
- Aucune barre d'onglets en bas sur bureau.

## Barre haute (remplace la barre d'onglets)
Hauteur 56px, `border-bottom:1px solid var(--color-divider)`, fond `--color-bg`.
Intérieur aligné sur la colonne de 1200px, `gap:40px` :
1. Marque : « Gurchon Hall » 16px heading + « VTES » 11px kicker `--color-neutral-500`.
2. Onglets `gap:28px`, 14px : Atelier, Collection, Decks, Synchronisation. Actif =
   `--color-text` + soulignement `box-shadow: inset 0 -2px 0 var(--color-accent)` ;
   inactif = `--color-neutral-400`, hover `--color-text`. Chaque onglet porte son
   raccourci en `kbd` (`G A`, `G C`, `G D`, `G S`).
3. À droite : alerte sync **seulement en cas de problème** (13px `--color-accent-200`,
   `ph-fill ph-warning-circle`, « 2 refusées · hors ligne »), puis champ de recherche
   global 280×34, `--color-surface`, radius md, kbd `/`.

## Style `kbd` (raccourcis visibles)
11px, `border:1px solid var(--color-divider)`, `border-radius:var(--radius-sm)`,
`padding:0 5px`, `line-height:17px`, couleur `--color-neutral-400/500`. Dans un bouton
accent : bordure `--color-accent-700`. Rendre en `<kbd>` et masquer
(`aria-hidden`) au lecteur d'écran si le raccourci est aussi dans `aria-keyshortcuts`.

Raccourcis globaux : `/` recherche · `N` nouveau (entrée ou deck selon la page) ·
`V` verser un produit · `G` puis `A/C/D/S` navigation · `?` aide · `Échap` ferme un
panneau · `⌘↵` / `Ctrl↵` valide un panneau. Inactifs quand le focus est dans un champ
(sauf `Échap`, `⌘↵`).

## Panneau latéral (formulaires)
Remplace les écrans plein écran mobiles pour : Modifier une entrée, Nouveau deck,
Verser un produit. `position:fixed; top:56px; right:0; bottom:0; width:460px`,
`background:--color-surface`, `box-shadow:--shadow-lg`, padding `28px 32px`, gap 24px.
Le contenu derrière passe à `opacity:.35` et n'est pas interactif (`inert`).
En-tête : titre 24px + kbd `Échap` + `ph-x`. Pied : actions alignées à droite,
secondaire « Annuler » (bordure divider), primaire accent outline avec kbd `⌘↵`.
Champs sur bureau : inputs encadrés 40px (`border:1px solid --color-divider`, fond
`--color-bg`, focus = bordure accent) au lieu des champs soulignés mobiles ; steppers
36px ; chips de langue 34px. Focus piégé dans le panneau, retour du focus à l'élément
déclencheur à la fermeture. Entrée : slide depuis la droite 200ms.

## Écrans

**d01 · Deckbuilder** (route `deck`, fusionne DeckDetailPage + CardPicker + légalité).
En-tête : fil « ← Decks · Deck actif · #0001 », titre 30px ; à droite le verdict
(filet accent 2px, « Deck légal » 16px `--color-accent-200`, résumé 12px des comptes) et
le bouton « Recalculer » kbd `R`. Corps en grille `7fr / 5fr`, gap 40px :
- Gauche, le deck : crypte en lignes de 36px (`×n` | nom | clan · disciplines | capacité) ;
  bibliothèque groupée par type sur 2 colonnes, lignes 34px ; groupes restants repliés
  (« tout déplier »). La ligne tout juste modifiée est teintée
  `color-mix(accent 12%)` avec « +2 à l'instant » ~3s.
- Droite, le picker **toujours visible** (`border-left` divider, padding-left 32px) :
  champ focalisé par `/`, carte sélectionnée en tête (image KRCG 112×156, type,
  « en collection 6 · dans le deck 6 », stepper 32px, « Ajouter » kbd `↵`), puis les
  autres résultats en lignes de 40px, légende des raccourcis en pied
  (`↑↓` parcourir, `+ −` quantité, `↵` ajouter, `Échap` vider).
Chaque ajout = une opération `addDeckCard` en file (pas de panier sur bureau).

**d02 · Collection** (route `stock`). En-tête titre + totaux ; boutons « Verser un
produit » `V` et « Ajouter une carte » `N`. Onglets soulignés Toutes / Crypte /
Bibliothèque / Proxy avec compteurs, à droite le sélecteur de langue et un filtre
texte kbd `F`. **Tableau** : colonnes `Nom (2.1fr) · Type 110 · Clan / discipline (1.3fr) ·
Cap./coût 96 · Langue 72 · Ex. 64 · Decks 64 · Notes (1.5fr)`, gap 16, en-tête 34px
12px `--color-neutral-500`, lignes 42px séparées par un filet. Tri par clic sur l'en-tête
(caret accent sur la colonne active). Survol de ligne : fond `color-mix(text 7%)` et
aperçu flottant de l'image KRCG (180×251, `--shadow-lg`) ancré sous le nom après
300ms. **Double-clic sur Ex.** : input 56×30 bordure accent, `↵` valide
(`saveStock`), `Échap` annule ; la colonne Notes affiche l'aide pendant l'édition.
`↵` sur une ligne sélectionnée ouvre d03. « Decks » = nombre de decks utilisant la
carte (calcul local).

**d03 · Modifier une entrée** : panneau latéral. Langue (chips), exemplaires, switch
proxy 40×24, notes, « Utilisée dans » (liste des decks), « Retirer » à gauche du pied.

**d04 · Decks** (route `decks`). Grille `380px / 1fr`, gap 48. Gauche : titre, bouton
« Nouveau » `N`, onglets En cours / Archivés / Tous, liste (item actif = fond
`--color-accent-900` + filet accent 2px à gauche). Droite (`border-left`) : aperçu du
deck sélectionné — titre 30px, verdict, 4 chiffres (crypte, bibliothèque, groupes,
bannies), crypte et bibliothèque par type en deux colonnes, bouton « Ouvrir le
deckbuilder » `↵`.

**d05 · Nouveau deck** : panneau latéral, champs Nom et Archétype, note en citation
(filet divider), primaire « Créer et ouvrir » `⌘↵` → ouvre d01.

**d06 · Synchronisation** (nouvelle route `sync`, onglet dédié). Grille `1fr / 440px`.
Gauche : état (titre 30px « Hors ligne » / « Synchronisation en cours… » / « Tout est à
jour »), bouton « Synchroniser maintenant » `S` (désactivé hors ligne), bloc refusées,
liste Refusées (sélection = fond accent-900) puis En attente (lignes 40px, heure à
droite). Droite : carte `--color-surface` avec la correction de l'opération
sélectionnée (CorrectionForm) et les actions Abandonner / Renvoyer tel quel / Renvoyer
la correction `⌘↵`.

**d07 · Verser un produit** : panneau latéral ; recherche de produit avec résultats en
liste encadrée (sélection accent-900), langue, nombre (1–1000) ; primaire
« Verser 77 cartes » avec le nombre de cartes du produit.

**d08 · Atelier** (route `home`). Grille `1fr / 340px`, gap 72. Gauche : kicker date,
titre 40px, 3 chiffres 36px, alerte (si problème), tableau « En cours »
(nom 18px | comptes | légalité | flèche). Droite : raccourcis principaux, filet estompé,
état du catalogue.

**d09 · États** : même gabarit ; vide (titre 24px + 2 boutons), chargement (squelette de
tableau, lignes 42px, barres 12px `--color-neutral-900`), 404.

## Images de cartes (KRCG)
Deux formes d'URL, même normalisation du nom (minuscules, sans accents ni caractères non
alphanumériques : `Govern the Unaligned` → `governtheunaligned`, `.44 Magnum` → `44magnum`) :
- **Recherche générique** (picker, aperçu collection sans set connu) :
  `https://static.krcg.org/card/<nom>.jpg`
- **Carte d'un set précis** (entrée de collection rattachée à une édition, contenu d'un
  produit versé) : `https://static.krcg.org/card/set/<set>/<nom>.jpg`
  — ex. `https://static.krcg.org/card/set/jyhad/44magnum.jpg`. Si l'image du set
  n'existe pas (404), retomber sur l'URL générique.
KRCG expose aussi l'URL d'image dans son API carte, à privilégier si disponible. Chargement paresseux, `alt` = nom de carte,
fond `--color-neutral-900` pendant le chargement ; hors ligne, masquer l'aperçu (ne pas
précacher toutes les images). Ajouter `static.krcg.org` à la CSP `img-src`.

## Fichiers du repo concernés
Mêmes fichiers que le README mobile, plus : `App.tsx` (barre haute + breakpoint),
nouveau `features/sync/SyncPage.tsx` (d06), un hook `useKeyboardShortcuts` partagé,
un composant `SidePanel` partagé (d03, d05, d07), un composant `CardImage` (KRCG).
