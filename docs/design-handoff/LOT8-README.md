# Handoff : Lot 8 — analyse (Gurchon Hall)

## Overview
Lot 8 de Gurchon Hall, la PWA hors ligne de suivi de pratique *VtES*. Il ajoute :
- un **Bilan**, troisième segment de l'onglet Parties (`#/bilan`) ;
- le **deck des adversaires** dans la saisie d'une partie ;
- la **version de deck** jouée et l'action « Figer sur la liste actuelle » dans le détail d'une partie ;
- la **liste d'une version**, en lecture seule, avec ses changements ;
- un encart **Résultats** dans les decks ;
- les versions et la **légalité à la date** dans le détail d'un tournoi ;
- l'**archétype** en six puces dans le formulaire de deck.

Le brief source est `docs/design-handoff/lot8-brief-claude-design.md` du dépôt `Spigushe/gurchon-hall`.

`LOT8.md` (dans ce dossier) est la spécification écran par écran : copie française exacte, tailles, couleurs, états. Ce README la résume et la situe. **En cas d'écart, `LOT8.md` fait foi.**

## About the Design Files
Les fichiers `.dc.html` de ce dossier sont des **références de design en HTML**. Ce sont des prototypes qui montrent l'apparence et le comportement attendus, pas du code de production à copier. La tâche est de **les recréer dans le frontend existant** (React + TypeScript + Vite, `frontend/src/`), avec ses patrons en place : `Sheet`, `BackRow`, `Pill`, `.seg`, lignes `.row`, tableau bureau, maître/détail, `DeckTables`, `features/search/glyphs.ts`, la base Dexie hors ligne. Le seuil bureau reste à 1024 px.

Pour ouvrir les prototypes, servez le dossier en HTTP (par exemple `npx serve .`) : `lot8-data.js` est chargé par `import()` dynamique et ne se charge pas depuis `file://`.

## Fidelity
**Haute fidélité.** Les couleurs, la typographie, les espacements et la copie sont finaux, sur les tokens Nocturne et **sans nouveau token**. Les gabarits suivent les prototypes des Lots 5 à 7 et de l'affichage des decks.

Les données de démonstration sont celles du brief : 14 parties, 6 GW, 26,5 VP. Les listes v1/v2 de Banu Princes et les classements des tournois sont inventés pour l'illustration.

## Screens / Views
Mobile 390 × 844 (direction 1b) et bureau 1440 × 900 (direction 3a). Le détail complet de chaque écran est dans `LOT8.md`.

| Mobile | Bureau | Écran |
| --- | --- | --- |
| 1b-46, 1b-46b | d25 | Bilan : filtres, résumé, axes Deck / Lieu / Mois / Position / Adversaires |
| 1b-47 | (barre de filtres de d25) | Filtres : période, type de partie, deck |
| 1b-48, 1b-49 | d27 | Saisie : sous-bloc « Son deck », choix du clan, siège sans nom, aide proie/prédateur |
| 1b-50 | d28 | Détail d'une partie : version, figer, table avec decks et positions |
| 1b-51 | d29 | Confirmation « Figer » : texte tournoi (mobile), texte amicale (bureau) |
| 1b-52 | d30 | Liste d'une version, en lecture seule, avec les changements depuis la précédente |
| 1b-53 | d31 | Encart « Résultats » d'un deck |
| 1b-54 | d32 | Détail d'un tournoi : versions et pastille « Légal le 24 octobre » |
| 1b-55 | d33 | Nouveau deck : archétype en six puces |
| 1b-56 à 1b-58 | d34 | États |

### Bilan, l'essentiel
- **Mobile, un axe à la fois.** Onglets soulignés défilants. Résumé en filet accent 2 px : « 6 GW sur 14 parties » en 22 px heading, puis « 26,5 VP, 1,9 VP par partie », puis « 2 tournois joués · 1 finale atteinte ».
- **Ligne d'axe mobile.** Glyphe de clan, nom 16 px heading, étiquette d'archétype ; à droite le VP moyen en 16 px + « VP / partie » en 11 px. Dessous, « 5 GW sur 9 parties · 20,5 VP » en 12 px, puis deux barres de 3 px.
- **Bureau, grille d'axes.** La barre de filtres est en ligne, avec des puces de 32 px. La grille a deux colonnes ; Deck et Position prennent toute la largeur. Chaque tableau a les colonnes `Groupe · Parties · GW · VP total · VP moyen` (`minmax(0,1fr) 44px 44px 54px 64px`, gap 8). L'en-tête fait 30 px et les lignes 40 px. Un clic sur une ligne ouvre le **panneau de droite** (360 px, `border-left`, patron d10), qui liste les parties du groupe.

## Interactions & Behavior
- **Pourcentages : jamais.** On écrit « 6 GW sur 14 parties » et « 1,9 VP par partie », avec une virgule décimale.
- **Barres.** Elles sont en CSS, sans bibliothèque. La barre GW représente GW / parties, en `--color-accent`. La barre VP représente le VP moyen sur 5, en `--color-neutral-400`, plafonnée à 100 %. La piste est en `--color-neutral-800`.
- **Ordre des lignes.** Alphabétique, avec « inconnu » toujours en dernier. Par mois, le plus récent est en haut. Au bureau, un clic sur un en-tête trie la colonne ; un second clic inverse le tri ; « inconnu » reste en dernier.
- **Deck.** La ligne se déplie en versions. Une partie pas encore synchronisée forme sa propre ligne « liste figée à la synchronisation ».
- **Position.**
  - Deux choix exclusifs : Ma proie / Mon prédateur, et Archétype / Clan.
  - Une note en pied : « N parties sans siège ne sont pas comptées ici. »
  - « Plus loin à la table » est replié par défaut. Il couvre la grande proie et le grand prédateur, dans un style atténué. Les parties à 3 joueurs ou moins en sont exclues, avec une note.
- **Filtres.**
  - Période : une seule valeur, par défaut « 12 derniers mois ».
  - Type de partie : plusieurs au choix ; si aucun n'est coché, tous les types comptent.
  - Deck : une seule valeur.
  - Si aucune partie ne correspond : « Aucune partie ne correspond à ces filtres. » + « Effacer les filtres ».
- **Saisie.**
  - Le sous-bloc « Son deck » est replié par défaut. Replié, il résume ce qui est saisi : glyphe + « Clan · Archétype », ou « Facultatif ».
  - Archétype : une seule puce cochée ; un second toucher la décoche.
  - Clan : liste glyphe + nom, avec « Récents » en tête. Au bureau, c'est un menu déroulant.
  - Un deck prêté n'a pas de sous-bloc.
  - « Ajouter un siège sans nom » crée une ligne « Joueur non nommé ». Si cette ligne n'a ni siège ni deck, un message d'erreur s'affiche (`role="alert"`).
  - Aide de positions : proie = (siège mod n) + 1 ; prédateur = siège précédent.
- **Figer.** C'est un bouton explicite, pas un menu. La confirmation explique son effet et précise si la liste deviendra une nouvelle version. Il n'apparaît pas tant que la partie attend la synchronisation.
- **Légalité à la date.** Pastille `.tag.tag-accent` « Légal le 24 octobre ». Hors ligne, `.tag.tag-neutral` « Légalité hors ligne ». C'est un élément isolé, qu'on peut retirer sans toucher au reste.

## State Management
- **Filtres** `{ period: 'year' | '12m' | 'all', types: string[], deck: 'all' | key }`.
- **Bilan.** Il se calcule **sur l'appareil**, à partir des parties locales (Dexie) filtrées. `lot8-data.js` en donne une implémentation de référence :
  - `agg(list)` : parties, GW, VP total, VP moyen ;
  - `axes(list)` : regroupement par deck (avec ses versions), lieu, mois et adversaire nommé ;
  - `groupPos(list, 'prey' | 'pred' | 'gprey' | 'gpred', 'arch' | 'clan')` : regroupement par position, avec les comptes `noSeat` (parties sans siège) et `noGrand` (parties sans grande position) ;
  - `summary(list)` : tournois joués, finales atteintes.
- **État d'interface.**
  - Mobile : axe courant.
  - Bureau : tri par axe et ligne sélectionnée.
  - Communs : position, regroupement, « Plus loin » ouvert ou fermé, decks dépliés.
- **Saisie.** Par adversaire : `{ clan?, archetype?, deckName? }`. Le serveur refuse un deck sur ma ligne ou sur un deck prêté (patron des refus du Lot 7).
- **Versions.** Une liste figée vaut pour tout le tournoi. « Figer » rattache toutes les parties de ce deck dans le tournoi.

## Design Tokens
Ils viennent de `nocturne/styles.css`, sans ajout.
- **Couleurs.**
  - `--color-bg` #161826, `--color-surface` #232532, `--color-text` #e9e9ed, `--color-accent` #9184d9, `--color-divider` = #e9e9ed à 16 %.
  - Neutres : 200 #e4e7f5, 300 #cfd3e5, 400 #b2b6ca, 500 #9397ab, 600 #75798c, 800 #3f424d, 900 #292b31.
  - Accent : 100 #f5f4ff, 200 #e7e5fe, 300 #d2cefd, 700 #5d5294, 800 #423a6a, 900 #2b2741.
- **Typographie.**
  - Inter, titres en graisse 500.
  - Titres d'écran : 30 px au mobile, 26–30 px au bureau.
  - Corps : 14–16 px.
  - Méta : 12–13 px.
  - Kicker : 11 px en capitales, `letter-spacing: .16em`.
  - Chiffres : `font-variant-numeric: tabular-nums`.
- **Rayons.** `--radius-sm` 4 px, `--radius-md` 8 px, `--radius-lg` 14 px. Les étiquettes utilisent `calc(var(--radius-md) * .75)`.
- **Ombres.**
  - `--shadow-sm` : `0 0 0 1px #3f424d`.
  - `--shadow-md` : `0 0 0 1px #595d6c, 0 6px 18px rgba(0,0,0,.55)`.
  - `--shadow-lg` : `0 0 0 1px #9397ab, 0 16px 40px rgba(0,0,0,.65)`.
- **Cibles tactiles.** 44 px minimum au mobile ; puces de 32–34 px au bureau.

## Assets
- **Icônes.** Phosphor 2.1.1 (regular et fill). Utilisées ici : `funnel-simple`, `caret-*`, `clock-countdown`, `push-pin`, `user-plus`, `plus`, `hand-arrow-up`, `arrows-clockwise`, `check-circle`, `address-book`, `trash`, `pencil-simple`, `users-three`.
- **Glyphes.** Polices krcg `vtes-clans.otf` (« VtesClans ») et `ankha2.otf` (« Ankha »). L'application les sert déjà ; réutilisez `features/search/glyphs.ts`.
- **Vérification à faire.** Dans les prototypes, Obfuscation (`o`) et Banu Haqim (`n`) s'affichent comme un carré vide. Ce sont les codes de glyphe du prototype Decks : vérifiez-les contre la table de `glyphs.ts`.
- **Images.** Aucune.

## Files
- `Gurchon Hall Bilan.dc.html` : prototype mobile, écrans 1b-46 à 1b-58. Le bilan, les filtres, la saisie, le choix du clan, la liste d'une version et le formulaire de deck sont interactifs.
- `Gurchon Hall Bilan Bureau.dc.html` : prototype bureau, d25 et d27 à d34. Le bilan (filtres, tri, sélection), la saisie, l'onglet de version et le formulaire de deck sont interactifs.
- `lot8-data.js` : données de démonstration et calculs de référence du bilan.
- `LOT8.md` : spécification écran par écran (fait foi).
- `TabBar.dc.html`, `TopBar.dc.html`, `DeckTables.dc.html` : composants partagés existants, importés par les prototypes.
- `support.js` : moteur d'exécution des prototypes, à ne pas modifier.
- `nocturne/styles.css` : tokens et classes Nocturne.
- `screenshots/1b-*.png` : 390 px à l'échelle 2.
- `screenshots/desktop/d*.png` : 1440 px à l'échelle 1.
