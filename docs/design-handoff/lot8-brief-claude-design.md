# Brief Claude Design — Lot 8, analyse

À transmettre à Claude Design avec le dossier `docs/design-handoff/` (tokens
`nocturne/`, prototypes des Lots 5 à 7, du lot Chercher et de l'affichage des
decks, captures `screenshots/`). Décision P10 du plan
`docs/lot8-plan-analyse.md` : les écrans du Lot 8 attendent ce handoff avant
d'être implémentés.

## Le produit, en deux phrases

Gurchon Hall est une PWA personnelle pour suivre sa pratique de *Vampire: The
Eternal Struggle* : collection, decks, parties et tournois. L'application
fonctionne hors ligne et se synchronise au retour du réseau ; l'analyse de ce
lot se calcule elle aussi sur le téléphone, sans réseau.

## Ce qu'on attend

Le même genre de livrable qu'aux Lots 7 et Chercher :

- une section **mobile** (390 × 844, direction « 1b ») et une section
  **bureau** (1440 × 900, direction « 3a », au-delà de 1024 px), dans le
  design system Nocturne, sans nouveau token sauf nécessité ;
- un prototype `.dc.html` par disposition (`Gurchon Hall Bilan.dc.html`,
  `Gurchon Hall Bilan Bureau.dc.html`), ou des pages ajoutées aux prototypes
  Parties existants pour les écrans 1 et 2 ;
- des captures dans la suite des existantes : mobile à partir de `1b-45-…`,
  bureau à partir de `d25-…` ;
- un texte de handoff, `LOT8.md`, qui décrit chaque écran, ses états et sa
  copie française, sur le modèle de `LOT7.md`.

Contraintes reprises de l'existant : application uniquement sombre, police
Inter, icônes Phosphor, glyphes de clan de krcg (`vtes-clans.otf`, déjà dans
les prototypes Chercher et Decks) selon la règle de `DECKS.md`, copie en
français. Réutiliser les composants en place : feuille `Sheet`, `Pill`, puces,
sélecteur segmenté `.seg`, lignes `.row`, tableau du bureau, maître/détail.
**Aucune bibliothèque de graphiques** : si une barre ou une jauge aide à lire
un chiffre, elle se dessine en CSS ou en SVG simple.

## Les deux moments d'usage

**Au club, entre deux rondes**, le moment déjà soigné au Lot 7 : la saisie
d'une partie doit rester sous la minute. Ce lot y ajoute le deck de mes
adversaires, qui ne doit rien ralentir. Il est facultatif, replié, et souvent
partiel : on sait que sa proie jouait Ministry sans connaître son nom.

**Le lendemain, au calme**, devant le bilan : « mon deck Banu Princes gagne-t-il
plus depuis que j'ai changé la crypte ? », « comment je m'en sors quand ma proie
joue du vote ? », « est-ce que je joue mieux au Bar à Dés qu'au club de
Villeurbanne ? ». Le bilan se lit sur téléphone autant qu'au bureau.

Rappel de périmètre : on ne suit que **mes** résultats, VP et Game Win (GW). Ni
score des adversaires, ni points de tournoi, ni place à la table.

## Vocabulaire et règles à connaître

- **Version d'un deck.** Quand je joue un deck, l'application fige sa liste :
  si elle a changé depuis la dernière partie, elle devient la version suivante
  (v1, v2, v3…). Un deck jamais joué n'a aucune version. Une partie saisie hors
  ligne n'a sa version qu'à la synchronisation (« liste figée à la
  synchronisation »).
- **Une version par tournoi.** Dans un tournoi, la liste figée à la première
  partie jouée avec un deck vaut pour toutes les autres parties du tournoi avec
  ce deck, finale comprise : un deck ne change pas pendant un tournoi. Une
  retouche faite entre deux rondes ne compte qu'à partir du tournoi suivant.
- **Archétypes** : six, pour toute l'application, un seul par deck et
  facultatif : **Bleed, Vote, Wall, Toolbox, Rush, Combo**, écrits ainsi, en
  anglais. Ils remplacent le champ texte « Archétype » de mes propres decks.
- **Clan principal** : pour un deck adverse, il se choisit dans la liste des
  clans du jeu, avec son glyphe. Pour mes decks, il ne se saisit pas : c'est le
  clan le plus représenté de la crypte.
- **Positions à la table.** Le jeu tourne dans l'ordre des sièges : ma proie
  est le joueur assis après moi, mon prédateur celui assis avant (le siège 1 a
  pour prédateur le dernier siège). Ce sont ceux du début de partie, et ce sont
  les deux decks qui comptent le plus. Plus loin : ma **grande proie** est
  deux sièges après moi, mon **grand prédateur** deux sièges avant. À cinq, mes
  quatre adversaires sont exactement ces quatre positions ; à quatre, le joueur
  d'en face est à la fois grande proie et grand prédateur ; à trois ou moins,
  il n'y a pas de grande position. Le siège est facultatif : une partie sans
  mon siège ne compte pas dans l'analyse par position, et l'écran dit combien
  de parties sont dans ce cas. Si je connais mon siège mais que rien n'est
  saisi au siège visé, l'adversaire à cette position est « inconnu », ce qui
  reste un groupe affiché.
- **Adversaire non nommé** : une ligne de la table peut porter un siège et un
  deck sans nom de joueur. Elle s'affiche « Joueur non nommé ».
- **Jamais de pourcentage**, quel que soit le nombre de parties. On écrit
  « 6 GW sur 14 parties », jamais « 43 % ». Le VP moyen par partie reste
  (« 1,9 VP par partie »). Le nombre de parties derrière chaque chiffre reste
  toujours visible.

## Écrans

### 1. Saisie d'une partie : le deck des adversaires

Écran existant (`LOT7.md`, écrans 13 et 14 mobile, d11 bureau). Sous chaque
adversaire du bloc « Adversaires », un sous-bloc « Son deck », replié par
défaut, avec trois champs : **Clan principal** (sélecteur à glyphes),
**Archétype** (six puces, une seule cochée, un second toucher décoche),
**Nom du deck** (texte libre, facultatif, « Ministry stealth bleed »). Replié,
le sous-bloc résume ce qui est saisi (glyphe Ministry · Bleed). Le clan et
l'archétype doivent se saisir au pouce en deux gestes : le nom est le moins
important des trois.

S'y ajoutent :

- une action **« Ajouter un siège sans nom »** à côté de l'ajout d'un
  adversaire du carnet : elle crée une ligne « Joueur non nommé » qui attend un
  siège ou un deck ;
- sur un adversaire qui joue l'un de **mes** decks prêtés (cas existant), pas
  de sous-bloc « Son deck » : le deck est déjà connu ;
- quand mon siège et le nombre de joueurs sont connus, une aide discrète
  nomme la proie et le prédateur (« Votre proie : siège 4 · Votre prédateur :
  siège 2 »), pour que le joueur sache quels decks noter en priorité.

Messages : un champ de deck sur ma ligne ou sur un deck prêté est refusé par
le serveur (patron des refus du Lot 7, écran Synchronisation) ; une ligne sans
nom qui ne porte ni siège ni deck ne peut pas être enregistrée.

### 2. Détail d'une partie

Écran existant (`LOT7.md`, écran 16 mobile, panneau de détail de d10 au bureau). Il gagne :

- sous mon deck, **la version jouée** (« Banu Princes#1234 · v3 ») avec un
  lien vers la liste de cette version, et, pour une partie pas encore
  synchronisée, « liste figée à la synchronisation » ;
- pour une partie de tournoi, la mention de la partie où la liste a été figée
  (« liste du tournoi, figée à la ronde 1 ») ;
- une action **« Figer sur la liste actuelle »**, en bouton explicite parmi les
  autres (pas de menu overflow), avec une confirmation qui dit ce qu'elle fait.
  Deux textes : en amicale, « La partie sera rattachée à la liste actuelle de
  Banu Princes. Utile si vous avez saisi la partie après avoir modifié le
  deck. » ; en tournoi, « Les 3 parties de l'Open de Lyon jouées avec Banu
  Princes (rondes 2 et 3, finale) seront rattachées à sa liste actuelle. »
- dans la table par siège, le deck de chaque adversaire (glyphe de clan,
  archétype, nom), et la position de chaque siège par rapport au mien
  (« proie », « prédateur », « grande proie », « grand prédateur »), les deux
  premières plus visibles que les deux autres.

### 3. Liste d'une version de deck

Lecture seule, ouverte depuis le détail d'une partie ou depuis les résultats
d'un deck : nom du deck, numéro de version, date de la première partie jouée
avec, nombre de parties, puis la liste en deux tableaux crypte et
bibliothèque, **sans quantités possédées ni proxies** (une version ne retient
que carte × quantité). Réutiliser `DeckTables` en lecture seule (`DECKS.md`)
plutôt qu'un nouveau tableau. Entre deux versions, montrer ce qui a changé
serait utile (cartes entrées, sorties, quantités modifiées) : à proposer si
cela tient, sinon laisser pour plus tard.

### 4. Bilan (nouvel écran)

Troisième segment du sélecteur de l'onglet Parties : **« Parties | Tournois |
Bilan »**, route `#/bilan`. Pas de sixième onglet.

En tête, des **filtres communs** : période (de, à, avec des raccourcis « cette
année », « 12 derniers mois », « tout »), type de partie (amicale,
préliminaire, finale ; plusieurs au choix), deck. Puis un **résumé** : parties
jouées, GW, VP total, VP moyen par partie.

Ensuite cinq sections, une par axe, chacune en tableau (mobile : lignes
empilées ; bureau : tableau triable) avec les mêmes colonnes : parties, GW,
VP total, VP moyen.

1. **Par deck**, avec le glyphe de son clan principal et son archétype, chaque
   deck dépliable en ses versions ;
2. **Par lieu** ;
3. **Par mois**, le plus récent en haut ;
4. **Face à ma proie / face à mon prédateur** : un sélecteur proie ou
   prédateur, un second pour regrouper par archétype ou par clan (glyphe et
   nom), puis une ligne par groupe, « inconnu » compris ; en pied, « N parties
   sans siège ne sont pas comptées ici ». Sous le même axe, une section
   **repliée par défaut**, « Plus loin à la table », reprend la même lecture
   pour la grande proie et le grand prédateur, avec sa propre note de pied
   (« les parties à trois joueurs ou moins n'ont pas de grande position ») :
   elle doit se lire comme un complément, pas à égalité avec la proie et le
   prédateur ;
5. **Par adversaire nommé** : mes résultats aux tables où il était.

Pour un tournoi, le bilan existant du Lot 7 (rondes, finale, classement) reste
dans le détail du tournoi ; le bilan général ajoute seulement, dans le résumé,
« tournois joués » et « finales atteintes ».

Au mobile, cinq sections empilées font une longue page : proposer une façon
de passer d'un axe à l'autre (puces d'ancrage, sections repliables, ou autre).
Au bureau, la disposition est libre : par exemple filtres et résumé à gauche,
axes à droite.

### 5. Résultats d'un deck

Un encart **« Résultats »** dans l'aperçu bureau de `#/decks` (sous les
tableaux de `DECKS.md`) et dans le détail mobile d'un deck : parties, GW, VP
moyen, puis une ligne par version. Un lien « Voir dans le bilan » ouvre le
bilan filtré sur ce deck. Un deck jamais joué n'affiche pas l'encart, ou une
seule ligne « Pas encore joué ».

### 6. Détail d'un tournoi

Écran existant (`LOT7.md`, écran 19 mobile, détail de d12 au bureau). Deux ajouts :

- pour chaque deck joué dans le tournoi, sa version et la partie où elle a été
  figée (« Banu Princes · v2, figée à la ronde 2 »), avec un lien vers la
  liste ; en multi-deck, une ligne par deck ;
- à côté de chaque deck, une pastille de légalité **à la date du tournoi**
  (« Légal le 24 octobre »), sur le modèle de la pastille du deckbuilder bureau
  (`DECKS.md`), indisponible hors ligne comme toute légalité. La dessiner de
  façon qu'elle se retire sans toucher au reste : c'est la dernière étape du
  lot, détachable s'il traîne.

### 7. Formulaire de deck : l'archétype

Écran existant (feuille « Nouveau deck » et modification d'un deck, `MOBILE.md`
et `DESKTOP.md`). Le champ texte « Archétype » devient les six puces Bleed,
Vote, Wall, Toolbox, Rush, Combo, même composant que dans le deck d'un
adversaire (écran 1), une seule cochée ou aucune.

## Données de démonstration

À reprendre telles quelles pour que les captures se comparent. Elles
prolongent celles de `LOT7.md` (Open de Lyon, Bar à Dés).

- Decks : **Banu Princes** (Banu Haqim, Toolbox ; v1 jouée en septembre, v2
  depuis le 10 octobre) et **Toreador Mass Vote** (Toreador, Vote ; v1).
- Lieux : Bar à Dés (Lyon), Le Donjon (Villeurbanne).
- 14 parties de septembre à novembre : 9 avec Banu Princes (4 en v1, 5 en
  v2), 5 avec Toreador Mass Vote ; 6 amicales, 7 préliminaires, 1 finale ;
  au total 6 GW et 26,5 VP. À l'Open de Lyon (24 octobre, multi-deck),
  Toreador Mass Vote en ronde 1, Banu Princes v2 en rondes 2 et 3 et en
  finale, liste figée à la ronde 2.
- Proies rencontrées : Ministry (4 fois, Bleed), Tremere (3, Wall),
  Malkavian (2, Bleed), proie inconnue (3) ; deux parties sans mon siège ; une
  partie à trois joueurs (pas de grande position).
- Prédateurs rencontrés : Brujah (4, Rush), Ventrue (3, Vote), Nosferatu
  (2, Toolbox), prédateur inconnu (3).
- Adversaires nommés : Marc, Léa, Mikael ; un « Joueur non nommé » Ministry à
  l'Open de Lyon.

## États à dessiner

Bilan sans aucune partie ; bilan dont les filtres ne laissent aucune partie ;
axe proie / prédateur sans aucune partie avec siège ; section « Plus loin à la
table » sans aucune partie de quatre joueurs ou plus ; deck jamais joué ;
partie en attente de synchronisation (version pas encore figée) ; liste d'une
version indisponible hors ligne si elle n'a jamais été lue ; chargement.

## Hors du brief

Résultats et scores des adversaires, points de tournoi, classement complet
d'une table ou d'un tournoi, courbes d'évolution dans le temps, statistiques de
composition d'un deck (disciplines, coûts), import depuis Archon (Lot 9),
suggestions de decks (lot Inventaires), mode clair.
