# Brief Claude Design — Lot 7, parties et tournois

À transmettre à Claude Design avec le dossier `docs/design-handoff/` (tokens
`nocturne/`, prototypes `Gurchon Hall.dc.html` et `Gurchon Hall Bureau.dc.html`,
captures `screenshots/`). Décision P3 du plan `docs/lot7-plan-parties.md` : les
écrans du Lot 7 attendent ce handoff avant d'être implémentés.

## Le produit, en deux phrases

Gurchon Hall est une PWA personnelle pour suivre sa pratique de *Vampire: The
Eternal Struggle* : collection de cartes, decks, et à partir de ce lot les
parties et les tournois. L'application fonctionne hors ligne et se synchronise
au retour du réseau ; c'est le cœur du projet.

## Ce qu'on attend

Le même genre de livrable que pour les Lots 5 et 5bis :

- une section **mobile** (390 × 844, direction « 1b ») et une section
  **bureau** (1440 × 900, direction « 3a », au-delà de 1024 px), dans le
  design system Nocturne existant, sans nouveau token sauf nécessité ;
- un prototype `.dc.html` par disposition, ou une page ajoutée aux prototypes
  existants ;
- des captures, nommées dans la suite des existantes (`1b-12-…`, `d0…`) ;
- un texte de handoff (`MOBILE.md`, `DESKTOP.md` complétés, ou un `LOT7.md`)
  qui décrit chaque écran, ses états et sa copie française.

Contraintes reprises de l'existant : application uniquement sombre, police
Inter, icônes Phosphor, copie en français, composants déjà en place
réutilisés autant que possible (feuille `Sheet`, `Stepper`, `Switch`, `Pill`,
puces, pilule flottante d'action, listes de la collection, tableau du bureau,
disposition maître/détail des Decks).

## Le moment d'usage à soigner

Un soir de tournoi, au club, entre deux rondes. Le téléphone tient dans une
main, le Wi-Fi du bar tombe une fois sur deux. Il faut noter la partie qui
vient de finir en moins d'une minute, au pouce : mon deck, mes points, si j'ai
gagné, et éventuellement qui était à la table. Tout ce qui peut être deviné
doit l'être (heure, lieu, tournoi, ronde suivante, deck déjà joué).

Le suivi se fait **du seul point de vue du joueur**, avec deux résultats
seulement : mes VP et mon Game Win (GW). On ne saisit jamais le score d'un
adversaire, ni ma place à la table, ni des points de tournoi (TP), ni le
classement complet d'une table ou d'un tournoi.

## Navigation

- Mobile : un **cinquième onglet « Parties »** dans la barre du bas, entre
  Decks et Chercher (Chercher reste désactivé). Les cinq doivent tenir à
  390 px, libellés compris.
- Bureau : un onglet « Parties » dans la barre haute.
- L'écran Parties s'ouvre sur un sélecteur **« Parties | Tournois »**.
- Les adversaires et les lieux se gèrent dans un écran secondaire, le
  **Carnet**, ouvert depuis l'écran Parties (pas d'onglet).

## Écrans

### 1. Liste des parties

Une ligne par partie, la plus récente en haut : date et heure, lieu, deck
joué, mes VP et le Game Win (« 2,5 VP · GW »), tournoi et ronde
(« Open de Lyon · ronde 2 », « Finale », ou « Amicale »). Une partie saisie
hors ligne et pas encore synchronisée porte la pastille « en attente » déjà
utilisée pour les decks. Action principale : « Nouvelle partie ». Filtres :
tournoi ou amicale, deck, lieu. Bureau : tableau triable et détail à droite.

### 2. Saisie d'une partie (création et modification)

L'écran le plus important. Champs, dans l'ordre :

| Champ | Valeur par défaut | Remarque |
| --- | --- | --- |
| Date et heure | maintenant | |
| Lieu | dernier utilisé | choisir ou créer en tapant un nom |
| Tournoi | aucun (amicale) | pré-rempli depuis un tournoi |
| Ronde | ronde suivante | préliminaire numérotée, ou « Finale » |
| Nombre de joueurs | 5 | puces 4 / 5 / autre |
| Mon deck | dernier joué | decks actifs d'abord ; en tournoi mono-deck, imposé avec un avertissement s'il diffère ; en finale d'un tournoi multi-deck, seuls les decks admis par la règle de l'organisateur sont proposés |
| Mon siège | vide | 1 à nombre de joueurs |
| Mes VP | 0 | au pas de 0,5 |
| Game Win | non | interrupteur, coché de lui-même quand il est certain (voir ci-dessous) |
| Adversaires | aucun | bloc facultatif, replié par défaut : des noms (choisir ou créer), chacun avec un siège et, s'il joue l'un de mes decks prêté, ce deck ; aucun score |
| Notes | vide | |

Le Game Win se déclare. Il est certain quand mes VP dépassent la moitié du
nombre de joueurs et valent au moins 2 (2,5 VP à quatre, 3 VP à cinq) :
l'interrupteur se coche alors de lui-même, avant même la synchronisation, et
le serveur refusera qu'on le décoche. Dans les autres cas (2 VP à cinq, par exemple), c'est
au joueur de dire s'il a gagné.

Messages d'erreur à prévoir (venant du serveur, affichés après coup sur
l'écran Synchronisation, ou en direct quand c'est vérifiable localement) :
VP qui ne sont pas des multiples de 0,5 ou supérieurs au nombre de joueurs,
Game Win avec moins de 2 VP, Game Win décoché alors qu'il est certain, deck
différent dans un tournoi mono-deck, deck de finale non admis (« la règle
"meilleur deck" impose Banu Princes »), deck supprimé, ronde déjà saisie.

### 3. Détail d'une partie

Mes résultats en tête (VP, GW), le contexte (tournoi, ronde, lieu,
date), puis la table par siège : « Moi », les adversaires nommés et, le cas
échéant, le deck que je leur ai prêté. Aucun score d'adversaire. Actions en boutons explicites, comme le détail
de deck : « Modifier », « Modifier la table », « Supprimer » (avec
confirmation). Pas de menu overflow.

### 4. Liste des tournois

Nom, dates, lieu, mono ou multi-deck, mon classement (« 3e / 27 »), mon bilan
des préliminaires (« 2 GW · 7,5 VP »), pastille « en attente ».
Action : « Nouveau tournoi ».

### 5. Création ou modification d'un tournoi

Feuille, dans l'ordre :

| Champ | Valeur par défaut | Remarque |
| --- | --- | --- |
| Nom | vide | |
| Dates | aujourd'hui | fin facultative |
| Lieu | dernier utilisé | |
| Niveau | Tournoi standard | ou Championnat national, Grand Prix, Championnat continental |
| Decks | Mono-deck | Multi-deck désactivé, avec une phrase d'explication, aux trois niveaux qui l'interdisent |
| Deck en finale | Pas encore annoncé | seulement en multi-deck : « Meilleur deck » ou « Choix libre » |
| Format | Construit | Draft, Autre |
| Rondes prévues | vide | |
| Nombre de joueurs | vide | demandé ici, mais facultatif : souvent inconnu à l'arrivée ; corrigeable à tout moment |
| Notes | vide | |

Une phrase courte sous « Deck en finale » aide à choisir : « Meilleur deck : le
deck de votre meilleure ronde. Choix libre : n'importe quel deck joué en
préliminaires. »

### 6. Détail d'un tournoi

En tête, mon bilan dans l'ordre du classement officiel : GW puis VP des
préliminaires, puis mes VP et mon GW en finale. Ensuite le deck du tournoi s'il est
mono-deck, ou, en multi-deck, les decks admis pour la finale. Puis mes rondes
dans l'ordre, la finale à part, et deux actions : « Ajouter la ronde N », qui
ouvre la saisie pré-remplie, et « Saisir la finale ». En fin de tournoi,
saisie de mon classement final, avec le nombre de joueurs s'il manque encore.
Suppression refusée tant que le tournoi
contient des parties : prévoir le message.

### 7. Carnet (adversaires et lieux)

Deux listes simples. Renommer, supprimer. Le joueur « Moi » apparaît en tête,
renommable mais pas supprimable. Une suppression refusée (joueur ou lieu déjà
utilisé) affiche son motif.

### 8. Atelier

Un raccourci « Nouvelle partie » à côté des raccourcis existants, en mobile
comme en bureau, et une carte « Tournoi en cours » quand un tournoi a commencé
depuis moins de deux jours sans classement final : son nom, ma dernière ronde,
un bouton « Saisir la ronde N ». Au club, l'application s'ouvre sur l'Atelier :
la ronde suivante doit y être à un geste. Pas de statistiques.

## États à dessiner

Liste vide (aucune partie, aucun tournoi), chargement, partie ou tournoi
introuvable, saisie hors ligne (bandeau ou pastille existants), opération
refusée renvoyant vers l'écran Synchronisation (patron existant).

## Hors du brief

Statistiques et graphiques (Lot 8), classement complet d'une table ou d'un
tournoi, scores et performances des adversaires, place à la table et points
de tournoi (on ne suit que ses propres VP et GW), decks propres aux adversaires, écran Chercher, mode clair.
