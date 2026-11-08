# Handoff Lot 8 — analyse

Complète `MOBILE.md` (direction 1b), `DESKTOP.md` (direction 3a) et `LOT7.md`. Mêmes tokens
Nocturne, **aucun token nouveau**, mêmes composants (`Sheet`, `BackRow`, `Pill`, puces, `.seg`,
lignes `.row`, tableau bureau, maître/détail, `DeckTables` en lecture seule). Le brief
`lot8-brief-claude-design.md` fait foi pour les règles ; ce document fixe la forme et la copie.

Fichiers :

- `Gurchon Hall Bilan.dc.html` : mobile, écrans 1b-46 à 1b-58 (390 × 844).
- `Gurchon Hall Bilan Bureau.dc.html` : bureau, écrans d25 et d27 à d34 (1440 × 900, plus haut pour d30 et d31).
- `lot8-data.js` : données de démonstration et calculs du bilan (prototype uniquement).
- Captures : `screenshots/1b-46-…` à `1b-58-…`, `screenshots/desktop/d25-…` et `d27-…` à `d34-…` (390 de large à l'échelle 2 en mobile, 1440 à l'échelle 1 au bureau).

Variantes retenues : **1b** au mobile (un axe à la fois), **1c** au bureau (filtres en barre,
axes en grille). Les variantes écartées (puces d'ancrage, maître/détail par axe) ont été retirées.

## Règles d'affichage communes

- **Jamais de pourcentage.** On écrit « 6 GW sur 14 parties » et « 1,9 VP par partie ». Le nombre
  de parties reste visible derrière chaque chiffre.
- **Barres.** Deux barres CSS de 3 px (2 px dans les tableaux bureau), sur une piste
  `--color-neutral-800` : GW sur parties en `--color-accent`, VP moyen en `--color-neutral-400`
  sur une échelle fixe de 0 à 5. Une légende sous le résumé, jamais de valeur écrite sur la barre.
- **Ordre des lignes** : alphabétique, groupe « inconnu » toujours en dernier (en
  `--color-neutral-400`). Exception : par mois, le plus récent en haut.
- **Glyphes de clan** : VTES Clans, `--color-neutral-200`, 18–22 px selon la densité, `title` = nom.
- **Archétype** : étiquette `.tag.tag-neutral` (11 px) à côté du nom du deck.
- **Positions** : « proie » et « prédateur » en 13 px heading `--color-accent-300` ; « grande
  proie » et « grand prédateur » en 12 px `--color-neutral-500`.

## Mobile

### 1b-46 · Bilan (`#/bilan`), variante retenue
En-tête de Parties inchangé (titre 30 px, « Bilan · lecture locale », Carnet). Segmenté
pleine largeur **Parties | Tournois | Bilan** (patron `.seg`, 42 px). Ligne de filtres :
résumé texte « 12 derniers mois · Tous types · Tous les decks » + « Filtres »
(`ph-funnel-simple`) qui ouvre 1b-47. Résumé en filet accent : « 6 GW sur 14 parties »
(22 px heading), « 26,5 VP, 1,9 VP par partie », « 2 tournois joués · 1 finale atteinte ».
Onglets soulignés défilants : **Deck · Lieu · Mois · Position · Adversaires**. Un seul axe
affiché.

Ligne d'axe (`padding:14px 0`, filet haut) : glyphe, nom 16 px heading, archétype, à droite
« 2,3 » 16 px + « VP / partie » 11 px ; sous-ligne 12 px « 5 GW sur 9 parties · 20,5 VP » ;
puis les deux barres côte à côte.

- **Deck** : la ligne se déplie (`ph-caret-down`) en versions, retrait 28 px, filet pointillé :
  « v2 · depuis le 10 octobre », « 3 GW sur 5 parties · 14 VP · 2,8 VP / partie », lien
  « Voir la liste » (1b-52). Une partie en attente forme sa propre ligne « liste figée à la
  synchronisation » avec `ph-clock-countdown`.
- **Position** : segmenté « Ma proie | Mon prédateur », puis « Regrouper par Archétype | Clan »
  (onglets soulignés). Pied : « 2 parties sans siège ne sont pas comptées ici. » Dessous, rangée
  repliée « Plus loin à la table · Grande proie, grand prédateur » ; dépliée, filet gauche
  `--color-divider`, onglets plus discrets (`--color-neutral-200`), lignes de 44 px en 14 px et
  sans barre, pied « 1 partie à trois joueurs : les parties à trois joueurs ou moins n'ont pas de
  grande position. » Elle se lit comme un complément.
- **Adversaires** : sous-titre « Mes résultats aux tables où il était ». « Joueur non nommé »
  n'y figure pas.

### 1b-47 · Filtres (feuille)
Kicker « Bilan », titre « Filtres ». Période : puces « Cette année », « 12 derniers mois »
(défaut), « Tout », puis De / À en champs soulignés. Type de partie : puces multiples
« Amicale », « Préliminaire », « Finale », aide « Plusieurs au choix ; aucun coché : tous les
types. » Deck : liste à coche (glyphe + nom), « Tous les decks » en tête. Pied : pilule
« Voir 14 parties » (compte vivant ; « Aucune partie » si vide) + « Effacer les filtres ».

### 1b-48 · Saisie, deck des adversaires
Le bloc Adversaires déplié gagne une aide 12 px `ph-arrows-clockwise` « Votre proie : siège 3 ·
Votre prédateur : siège 1 », affichée dès que le siège et le nombre de joueurs sont connus. Sur
chaque ligne, la position par rapport à mon siège suit le nom. Sous la ligne, retrait 56 px,
sous-bloc **« Son deck »** replié (44 px) qui résume « [glyphe] Brujah · Rush », ou
« Facultatif » s'il est vide. Déplié :

1. **Clan principal** : champ souligné, glyphe 22 px + nom, `ph-caret-right` ; ouvre 1b-49.
2. **Archétype** : six puces 44 px (Bleed, Vote, Wall, Toolbox, Rush, Combo), une seule cochée,
   un second toucher décoche.
3. **Nom du deck (facultatif)** : souligné, exemple « ex. Ministry stealth bleed ».

Deck prêté (`ph-hand-arrow-up` « Joue mon Nosferatu Rush · deck déjà connu ») : pas de
sous-bloc. Actions sous la liste : « Ajouter du carnet » (`ph-user-plus`) et **« Ajouter un
siège sans nom »** (`ph-plus`), qui crée « Joueur non nommé » avec un carré de siège en
pointillés. Tant que cette ligne n'a ni siège ni deck : « Une ligne sans nom doit porter un
siège ou un deck pour être enregistrée. » (13 px `--color-accent-200`, `role="alert"`).

### 1b-49 · Clan principal (feuille)
Kicker « Siège 3 · Mikael ». Section « Récents » (trois clans), puis « Tous les clans »,
alphabétique, lignes de 48 px avec le glyphe 22 px. Le clan choisi passe en `--color-accent-200`
avec `ph-fill ph-check-circle`. Dernière ligne : « Pas de clan principal ». Clan et archétype
se saisissent donc en deux gestes.

### 1b-50 · Détail d'une partie
« Mon deck » : « Banu Princes#1234 · v2 » ; dessous, 12 px, « liste du tournoi, figée à cette
ronde » (ou « figée à la ronde 2 ») ; lien « Voir la liste v2 ». Table par siège : sous chaque
nom, glyphe + « Ministry · Bleed · Ministry stealth bleed » ; à droite, la position. Actions en
pilules : Modifier, Modifier la table, **Figer sur la liste actuelle** (`ph-push-pin`, divider),
Supprimer.

### 1b-51 · Figer, confirmation (tournoi)
Feuille basse : kicker « Banu Princes · v2 », titre « Figer sur la liste actuelle ? », texte
« Les 3 parties de l'Open de Lyon jouées avec Banu Princes (rondes 2 et 3, finale) seront
rattachées à sa liste actuelle. » Citation : « La liste actuelle diffère de la v2 : elle
deviendra la v3. La ronde 1, jouée avec Toreador Mass Vote, ne change pas. » Boutons
« Figer les 3 parties » (accent) et « Garder la v2 ».

### 1b-52 · Liste d'une version
`BackRow` « Partie ». Kicker « Version jouée · lecture seule », titre « Banu Princes · v2 »,
méta « Première partie le 15 octobre · 5 parties ». Segmenté « Liste | Changements depuis v1 ».
Liste : `DeckTables` en lecture seule, sans colonne ni total de proxies. Changements : trois
groupes, « Entrées » (+n en `--color-accent-200`), « Sorties » (−n en `--color-neutral-400`),
« Quantités modifiées » (« 4 → 6 »), puis la note « Carte × quantité seulement : ni quantités
possédées, ni proxies. »

### 1b-53 · Détail d'un deck, encart « Résultats »
Après les faits : kicker « Résultats » + « Voir dans le bilan » (ouvre `#/bilan` filtré sur le
deck), « 5 GW sur 9 parties » 19 px, « 2,3 VP par partie », puis une ligne par version, la plus
récente en haut.

### 1b-54 · Détail d'un tournoi
Nouveau bloc « Decks joués » : glyphe + « Banu Princes · v2 », pastille **« Légal le
24 octobre »** (`.tag.tag-accent`), sous-ligne « figée à la ronde 2 · rondes 2 et 3, finale »,
lien « Voir la liste ». La pastille est un élément à part, qu'on retire sans toucher au reste.

### 1b-55 · Nouveau deck
« Archétype (facultatif) » devient les six puces ; aide « Un seul ; touchez-le de nouveau pour
le retirer. »

### 1b-56 à 1b-58 · États
- Bilan vide : « Rien à analyser pour l'instant », « Le bilan se remplit dès votre première
  partie : votre deck et vos VP suffisent. », pilule « Nouvelle partie ».
- Filtres sans partie : « Aucune partie ne correspond à ces filtres. » + « Effacer les filtres ».
- Position sans siège : « Aucune de ces parties ne porte votre siège : notez-le à la saisie pour
  savoir qui était votre proie. » + note de pied.
- Plus loin à la table, rien à quatre joueurs ou plus : « Aucune partie à quatre joueurs ou plus
  avec votre siège. »
- Deck jamais joué : une seule ligne « Pas encore joué ».
- Partie en attente : « liste figée à la synchronisation » (`ph-clock-countdown`,
  `--color-accent-300`) ; pas de bouton « Figer ».
- Version jamais lue, hors ligne : bloc en filet accent « Liste indisponible hors ligne » +
  « La v1 de Banu Princes n'a jamais été ouverte sur cet appareil. Elle s'affichera au retour du
  réseau. »
- Légalité hors ligne : pastille `.tag.tag-neutral` « Légalité hors ligne ».
- Chargement : squelette.

## Bureau (≥ 1024 px)

- **d25 · Bilan (1c, retenue)** : onglets soulignés « Parties · 14 / Tournois · 2 / Bilan ».
  Barre de filtres en ligne : « Période » (trois puces 32 px + « du … au … »), « Type » (trois
  puces), « Deck » (Tous, puis chaque deck avec son glyphe). Résumé sur une ligne en filet accent,
  légende des barres à droite. Grille de deux colonnes : Deck, Lieu, Mois, Adversaires ; la
  position occupe toute la largeur, avec ses sélecteurs dans l'en-tête de section. Tableau
  `Groupe · Parties · GW · VP total · VP moyen` (1fr / 52 / 52 / 60 / 76), en-tête 30 px, lignes
  40 px, tri au clic d'en-tête (« inconnu » reste en dernier), barres de 2 px sous GW et VP moyen.
  Les versions se déplient sous leur deck. Clic sur une ligne : panneau de droite (360 px,
  patron d10) avec le groupe, son bilan et ses parties (date, deck · version, contexte, résultat),
  puis « Ouvrir ces parties dans la liste ».
- **d27 · Nouvelle partie** : panneau 460 px ; « Son deck » replié en 32 px ; déplié, une ligne
  Clan principal (menu déroulant de glyphes, 36 px) + Nom du deck, puis les six puces 32 px.
  Mêmes aide, alerte et actions qu'au mobile.
- **d28 · Détail d'une partie** : panneau de d10 ; colonne Mon deck dans le tableau avec la
  version en 12 px ; bouton « Figer sur la liste actuelle » parmi Modifier `E` et Modifier la
  table `T` ; table par siège avec deck et position.
- **d29 · Figer, amicale** : dialogue 500 px : « La partie sera rattachée à la liste actuelle de
  Banu Princes. Utile si vous avez saisi la partie après avoir modifié le deck. » + « La liste
  actuelle diffère de la v2 : elle deviendra la v3. » Boutons « Garder la v2 » `Échap` et
  « Figer la partie » `↵`.
- **d30 · Liste d'une version** : fil « ← Partie du 24/10, ronde 2 · Version jouée · lecture
  seule », titre, onglets v1 / v2, carte « Changements depuis v1 » en trois colonnes au-dessus
  de `DeckTables`.
- **d31 · Decks, aperçu** : encart « Résultats » sous les tableaux, au gabarit des sections de
  `DeckTables` (fond surface, titre 16 px + compte accent-300) : « 5 GW sur 9 parties ·
  2,3 VP par partie · Voir dans le bilan → », tableau `Version · Depuis · Parties · GW · VP ·
  VP moyen · Voir la liste`.
- **d32 · Détail d'un tournoi** : tableau « Decks joués » `Deck · version / Liste figée /
  Légalité / Voir la liste`, pastille `.tag.tag-accent` « Légal le 24 octobre » ; la version
  s'ajoute dans « Mes rondes ».
- **d33 · Nouveau deck** : panneau latéral, archétype en six puces 34 px.
- **d34 · États** : bilan vide, chargement (squelette de tableau), version hors ligne, légalité
  hors ligne ; le reste reprend la copie mobile.

## Données de démonstration

Celles du brief, sans écart : 14 parties (9 Banu Princes, dont 4 en v1 et 5 en v2 ;
5 Toreador Mass Vote, dont une en attente de synchronisation) ; 6 amicales, 7 préliminaires,
1 finale ; 6 GW et 26,5 VP. Deux tournois : la Coupe du Rhône (19 septembre, Le Donjon, quatre
rondes avec Banu Princes v1) et l'Open de Lyon. Les listes v1 et v2 de Banu Princes et les
classements finaux sont inventés pour l'illustration.

## Repo

| Écran | Fichiers |
| --- | --- |
| Bilan | nouveau `features/games/StatsPage.tsx` (route `#/bilan`), `GamesPage.tsx` (troisième segment) |
| Deck des adversaires | `features/games/GameForm.tsx` |
| Détail de partie, figer | `features/games/GameDetailPage.tsx` |
| Liste d'une version | nouveau `features/decks/DeckVersionPage.tsx` + `DeckTables` en lecture seule |
| Résultats d'un deck | aperçu de `#/decks`, détail mobile d'un deck |
| Tournoi | `features/games/TournamentDetailPage.tsx` |
| Archétype | formulaire de deck (création et modification) |
