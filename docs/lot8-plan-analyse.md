# Lot 8 — Analyse : plan d'implémentation

Statut : **A0 close le 2026-11-08 ; A1 et A2 livrées le 2026-11-08, B1 et B2
le 2026-11-12** (modèles et R13, `ac6cda5ad252`, puis schémas et contrat, puis
gel des versions, deck adverse et route des versions, puis tests `/sync`, cf.
« Livré à A1 », « Livré à A2 », « Livré à B1 » et « Livré à B2 » sous le
découpage ; A9 tranchée le 2026-11-08 : table dédiée ; front en échec de
typage jusqu'à C1, par décision ; F0, C1, D1 et D2 faits le 2026-11-12, cf.
leurs « Livré à »). Prochaine étape : B3 (légalité datée), puis E. Rédigé sur la branche
`lot-8-analyse`, partie de `75367a7` (lot Affichage des decks clos). P4 et P10
tranchées par l'utilisateur le 2026-11-07, les autres le 2026-11-08 (« Tranché
à A0 » sous chaque proposition). Trois écarts aux recommandations : une
version par deck et par tournoi (P3, qui rend P12 sans objet), une liste
fermée de six archétypes pour toute l'application (P5), jamais de pourcentage
et l'étude de la grande proie et du grand prédateur (P8). Brief Claude Design
écrit (`docs/design-handoff/lot8-brief-claude-design.md`), handoff reçu et
versé le 2026-11-08 (`docs/design-handoff/LOT8.md`, D0) ; il ajoute une
proposition de modèle, A9. Les décisions A1 à A8 sont des propositions de conception pour
l'architecte-contrat, qui les reprendra ou les amendera dans ce fichier. La
forme suit `docs/lot7-plan-parties.md`.

## Portée

La feuille de route (CLAUDE.md §12, point 11) donne au Lot 8 trois objets, dont
un préalable relevé le 2026-11-03 :

1. **figer la decklist jouée** à chaque partie, pour qu'un deck modifié après
   un tournoi ne réécrive pas l'historique de ce tournoi (préalable, première
   piste de `docs/pistes-evolution.md`) ;
2. **le deck de chaque adversaire nommé** (nom et archétype), pour lire les
   résultats d'un de mes decks face au deck de ma proie et à celui de mon
   prédateur (décision 3 du §11, revue le 2026-11-02) ;
3. **l'analyse elle-même** : performance par deck, historique par lieu et par
   date.

Un quatrième objet, facultatif, vient de `docs/pistes-evolution.md` : la
légalité d'un deck à la date d'un tournoi (P11).

Ce que le lot ne fait pas : suivre les résultats des adversaires (décision 3
maintenue), calculer des points de tournoi (P7 du Lot 7), importer un tournoi
d'Archon (après la mise en production de la v1), suggérer des decks (lot Inventaires), ni produire des
statistiques de composition d'un deck (disciplines, coûts), qui restent une
piste.

### État de départ relevé le 2026-11-07

Base de développement `backend/vtes.db`, lue en lecture seule :

- révision `8ab23342a26f` (R12), 25 tables, douze révisions ;
- un compte, deux joueurs (le « Moi » et Mikael Lavallee), deux lieux, un
  tournoi (Championnat de France, mono-deck, 67 joueurs, classement 56,
  trois rondes), deux parties, trois participations, deux decks dont un
  supprimé, 20 lignes de deck, 29 entrées de stock, 71 opérations au journal ;
- les deux parties (la ronde 1 du championnat le 2026-10-31, une amicale à cinq
  le 2026-11-02) pointent le deck 1, « Banu Princes », **modifié pour la
  dernière fois le 2026-11-07**, après les deux parties. Le risque que le
  préalable veut fermer s'est donc déjà réalisé : rien ne dit aujourd'hui
  quelle liste a été jouée au championnat (P4) ;
- sièges : à l'amicale, je suis au siège 3 et Mikael Lavallee au siège 2, soit
  mon prédateur selon la convention proposée en P7 ; à la ronde 1, je suis au
  siège 1, sans adversaire saisi.

Code :

- `participation.deck_id` pointe le deck vivant ; `deck.archetype` est un texte
  libre de 120 caractères ; `deleted_deck_card` fige déjà une decklist à la
  suppression logique (Lot 2), patron le plus proche de ce que demande le
  préalable ;
- la ligne d'un adversaire ne porte que son joueur, son siège, un deck prêté
  et des notes ; VP et GW sont réservés à ma ligne par le service (A13 du
  Lot 7) ;
- côté client, Dexie version 6 ; la table d'une partie est rangée dans sa ligne
  du magasin `games` et relue quand `updated_at` change ; le bilan d'un tournoi
  est déjà recalculé hors ligne (`playRules.tournamentSummary`) ;
- aucune bibliothèque de graphiques dans `frontend/package.json` (Inter,
  Phosphor, Dexie, openapi-fetch, React) ;
- onglet Parties avec le sélecteur « Parties | Tournois » (`PlaySwitcher`),
  carnet à `#/carnet`.

Chiffres de départ : 2491 tests backend (2 `xfail`), 1030 tests vitest sur 63
fichiers, 78 e2e Playwright, 475 `data-testid` distincts, références CRAP vides
des deux côtés, 49 opérations sur 29 chemins au contrat.

## Propositions à trancher par l'utilisateur

Chaque proposition donne une recommandation et ce qu'elle écarte. P1 à P4
portent sur le préalable et changent le modèle : ce sont celles qu'A1 attend.

### P1. Figer : une copie par partie, ou des versions de deck ?

Trois formes possibles.

- **Une copie par participation**, sur le patron de `deleted_deck_card` : à
  chaque partie, la liste du deck est recopiée sous la participation. Simple,
  mais trois rondes d'un tournoi mono-deck donnent trois copies identiques, et
  rien ne permet de dire « la liste d'avril et celle de juin » sans comparer
  les copies entre elles.
- **Une version à chaque modification du deck** : chaque `+` du deckbuilder en
  créerait une. Inutilisable.
- **Des versions coupées au moment où le deck est joué** (recommandé). Quand
  une partie désigne un deck, le serveur compare la liste courante à la
  dernière version de ce deck : identique, il la réutilise ; différente, il en
  crée une nouvelle, numérotée (v1, v2…). La participation pointe la version.

Recommandation : la troisième. Les trois rondes d'un tournoi partagent une
version, l'analyse peut comparer « Banu Princes v2 » à « v3 », et la piste
« historique des versions d'un deck » trouve son support sans travail de plus.
Un deck jamais joué n'a aucune version.

**Tranché à A0 (2026-11-08)** : recommandation retenue, complétée par la règle
du tournoi de P3.

### P2. Qu'est-ce qui distingue deux versions ?

Recommandation : **la liste carte × quantité totale**, sans langue, extension ni
proxy. Convertir un proxy en exemplaire réel ou remplacer une impression
française par une anglaise ne change pas le deck joué, et ne doit pas couper
une version. La version ne stocke donc que carte × quantité, ce qui suffit à
reconstituer une liste de tournoi.

Écarté : recopier les lignes complètes comme `deleted_deck_card`. Elles
diraient avec quels exemplaires physiques j'ai joué, ce que personne n'a
demandé, et chaque changement d'impression créerait une version.

**Tranché à A0 (2026-11-08)** : recommandation retenue.

### P3. À quel moment la liste est-elle figée ?

Recommandation : **par le serveur, quand il applique l'écriture de la partie**
(création, remplacement de la table, ou modification qui change le deck d'une
ligne), jamais à une autre occasion. Par `/sync`, l'ordre de la file reproduit
l'ordre de saisie d'un même appareil : une partie saisie hors ligne au club,
puis le deck retouché dans le train, arrivent dans cet ordre, et la partie
prend la liste d'avant la retouche.

S'y ajoute une action explicite dans le détail d'une partie, **« Figer sur la
liste actuelle »**, pour la partie saisie après coup (le lendemain, une fois le
deck déjà modifié) ou pour les parties d'avant le lot (P4). Elle passe par
`game.update`, avec un drapeau, et ne propose que la liste courante : pas de
choix parmi les versions passées.

Écarté : faire envoyer la liste par le client dans l'opération. Plus exact
quand deux appareils se croisent, mais le contrat devient lourd, le serveur
doit valider une decklist entière par partie, et le miroir du client peut être
en retard. Limite acceptée en échange : une partie saisie hors ligne sur le
téléphone pendant que le deck est modifié en ligne sur l'ordinateur prend la
liste de l'ordinateur.

**Tranché à A0 (2026-11-08)** : recommandation retenue, avec une règle de
plus pour les tournois, voulue par l'utilisateur : **dans un tournoi, la liste
figée à la première partie où un deck est joué est la version de ce deck pour
toutes les autres parties du tournoi**, finale comprise. Un deck ne change pas
pendant un tournoi (VEKN), et l'application ne laisse pas une retouche faite
entre deux rondes produire deux versions dans le même tournoi.

Conséquences :

- au gel d'une partie de tournoi, le serveur cherche d'abord une partie du
  même tournoi déjà figée pour ce deck ; s'il en trouve une, il reprend sa
  version, quelle que soit la liste courante. « Première » veut dire la
  première figée, pas la ronde au plus petit numéro : une ronde 2 saisie avant
  la ronde 1 fixe la version, et la ronde 1 la reprend ;
- la règle vaut par deck : en multi-deck, chaque deck a sa version dans le
  tournoi, figée à sa première partie ;
- une partie déplacée dans un tournoi (`game.update` qui change son tournoi)
  prend la version du tournoi pour son deck s'il y en a une, et la fixe sinon ;
- « Figer sur la liste actuelle » sur une partie de tournoi refige **toutes**
  les parties du tournoi jouées avec ce deck, et la confirmation le dit. C'est
  le seul moyen de corriger la version d'un tournoi, et il garde la règle
  d'une version par deck et par tournoi ;
- une amicale reste figée partie par partie.

### P4. Que faire des parties déjà saisies ?

Deux parties existent, et le deck qu'elles désignent a changé depuis.

- **(a) Les laisser sans version** (recommandé) : la migration ne convertit
  rien, l'analyse les compte sous le deck, dans une ligne « liste non figée ».
  L'utilisateur, qui seul sait si « Banu Princes » a changé depuis le
  championnat, peut figer chaque partie sur la liste actuelle par l'action de
  P3.
- **(b) Figer la liste actuelle** pour toutes, avec une marque « reconstituée ».
  La migration devinerait à la place de l'utilisateur, et la marque devrait
  vivre dans le modèle pour toujours.

Question directe, pour décider de (a) ou (b) : la liste actuelle de « Banu
Princes » est-elle celle jouée au Championnat de France ?

**Tranché à A0 (2026-11-07)** : ni (a) ni (b). L'application n'est pas encore
en ligne, et ce que contient `backend/vtes.db` (parties, decks, stock) est de
la recette : la base sera **écrasée** et reconstruite à neuf à la mise en
service (F0). Il n'y aura donc aucune partie antérieure au gel, et R13 n'a rien
à convertir. L'action « Figer sur la liste actuelle » de P3 garde son usage
pour la partie saisie après coup.

### P5. Comment décrire le deck d'un adversaire ?

La feuille de route propose deux textes libres sur la ligne d'adversaire, nom
et archétype, avec en suggestion les valeurs déjà saisies.

Recommandation : **nom et archétype en texte libre, plus un clan facultatif
choisi dans la liste des clans du catalogue.** Joueurs et organisateurs
décrivent d'abord un deck par son clan (« un Ministry », « du Tremere »), et un
texte libre se fragmente vite : « Ministry », « ministry bleed », « Ministère »
font trois groupes. Le clan, pris dans une liste fermée qui existe déjà, donne
un axe d'analyse fiable ; l'archétype reste libre, regroupé à l'affichage par
`foldText`, et suggéré à partir des archétypes déjà saisis, ceux de mes propres
decks compris.

Les trois champs sont refusés sur ma ligne et sur une ligne qui joue un de mes
decks prêtés (P4 du Lot 7) : là, le deck est déjà connu.

Écarté : une liste fermée d'archétypes. Aucun référentiel ne fait foi (la TWDA
n'en publie pas de structuré), et la tenir serait un travail sans fin.

**Tranché à A0 (2026-11-08)** : **liste fermée d'archétypes, pour toute
l'application**, contre la recommandation : Bleed, Vote, Wall, Toolbox, Rush,
Combo. Le clan principal est retenu. Ce que cela donne :

- **un seul choix** parmi les six, facultatif, sur mes decks comme sur ceux des
  adversaires. Codes `bleed`, `vote`, `wall`, `toolbox`, `rush`, `combo` en
  base et au contrat (enum fermé, CHECK nommé, convention du §6) ; libellés
  affichés tels que l'utilisateur les a donnés, en anglais, puisque c'est le
  vocabulaire des joueurs ;
- `deck.archetype`, texte libre depuis le Lot 1, **devient cet enum** :
  formulaire de deck à six puces au lieu d'un champ texte, et changement de
  contrat sur `DeckCreate`, `DeckUpdate`, `DeckRead` et les opérations
  `deck.create` / `deck.update` de `/sync` (A4, A5, A8) ;
- deck d'un adversaire : **clan principal** (liste des clans du catalogue, avec
  son glyphe), **archétype** (les six), et un **nom** de deck en texte libre,
  gardé pour mémoire mais qui n'entre dans aucun axe d'analyse ;
- le clan principal de **mes** decks ne se saisit pas : il se déduit de la
  crypte de la version jouée (le clan qui y compte le plus d'exemplaires), et
  sert à l'affichage du bilan. Interprétation de l'orchestrateur, à corriger
  si l'utilisateur voulait aussi un champ sur ses propres decks.

### P6. Un adversaire sans nom peut-il avoir un deck ?

Aujourd'hui, une ligne de table exige un joueur du carnet. Au Championnat de
France, 67 joueurs : on ne retient pas toujours le nom de sa proie, mais on sait
qu'elle jouait Tremere. L'analyse face à la proie et au prédateur repose sur les
sièges et les decks, pas sur les noms.

Recommandation : **oui, une ligne d'adversaire peut ne désigner aucun joueur**,
à condition de porter un siège ou un deck (sinon elle ne dit rien). L'interface
la montre comme « Joueur non nommé ». Sans cela, l'utilisateur créerait des
joueurs « Inconnu 1 », « Inconnu 2 » qui pollueraient le carnet.

Coût : `participation.player_id` devient nullable, et la règle « exactement une
ligne du Moi » se lit sur les lignes qui ont un joueur. À écarter si
l'utilisateur préfère garder le carnet comme seule source des lignes.

**Tranché à A0 (2026-11-08)** : recommandation retenue.

### P7. Convention de siège

Le siège est facultatif et le modèle dit seulement « 1 = premier joueur ».

Recommandation : **le jeu tourne dans l'ordre des sièges** ; la proie du siège
*n* est le siège *n* + 1, celle du dernier siège est le siège 1, et le
prédateur du siège *n* est le siège *n* − 1 (le dernier pour le siège 1). Ce
sont la proie et le prédateur **de départ** : les évictions en cours de partie
ne sont pas saisies.

Conséquences, à écrire telles quelles dans l'aide de l'écran :

- une partie sans mon siège sort de l'analyse proie / prédateur, et l'écran
  dit combien (« 3 parties sur 12 sans siège ») ; elle compte partout ailleurs ;
- mon siège et le nombre de joueurs suffisent à savoir **quel** siège est ma
  proie ; si aucune ligne n'est saisie à ce siège, la proie est « inconnue »,
  ce qui reste un groupe affiché ;
- à deux joueurs, proie et prédateur sont le même adversaire : la partie compte
  des deux côtés, sans marque particulière.

**Tranché à A0 (2026-11-08)** : recommandation retenue. Raison donnée par
l'utilisateur : en début de partie, le jeu se joue surtout face aux deux decks
voisins, à gauche et à droite. Proie et prédateur restent donc l'axe principal
de l'analyse par position (P8).

### P8. Que montre l'analyse ?

Recommandation, en indicateurs : parties jouées, GW, VP total et VP moyen par
partie ; pour les tournois, rondes jouées, finales atteintes et classement.
Pas de pourcentage sous cinq parties : « 2 GW sur 3 » plutôt que « 67 % ».

En axes, chacun filtrable par période (de, à), par type de partie (amicale,
préliminaire, finale) et par deck :

- **par deck**, puis par version de ce deck ;
- **par lieu** ;
- **par période** : une ligne par mois, et le cumul ;
- **face à la proie et au prédateur** : par clan, puis par archétype ;
- **par adversaire nommé** : mes résultats aux tables où il était, ce qui reste
  le suivi de **mes** résultats (décision 3).

Écarté pour ce lot : les courbes dans le temps. Le volume (deux parties
aujourd'hui) ne les justifie pas encore.

**Tranché à A0 (2026-11-08)** : recommandation retenue, avec deux
changements.

- **Jamais de pourcentage**, quel que soit le nombre de parties : « 6 GW sur
  14 parties », jamais « 43 % ». Le VP moyen par partie reste, ce n'est pas un
  pourcentage.
- **Grande proie et grand prédateur**, à étudier « sans créer de donnée trop
  littérale ». Réponse : rien à saisir ni à stocker, tout se déduit des sièges
  déjà saisis, comme la proie et le prédateur. La grande proie du siège *n* est
  le siège *n* + 2, le grand prédateur le siège *n* − 2. Ce que cela vaut
  selon la taille de la table :

  | Joueurs | Grande proie | Grand prédateur | Traitement |
  | --- | --- | --- | --- |
  | 5 | *n* + 2 | *n* − 2 | les quatre adversaires sont exactement proie, grande proie, grand prédateur et prédateur |
  | 6 | *n* + 2 | *n* − 2 | le siège d'en face (*n* + 3) n'entre dans aucune des quatre positions |
  | 4 | *n* + 2 | *n* + 2 | le siège d'en face est les deux à la fois ; il compte des deux côtés, comme la table à deux de P7 |
  | 3 ou moins | — | — | *n* + 2 est mon prédateur : pas de grande position, la partie sort de cet axe |

  À l'écran, ces deux positions viennent **après** la proie et le prédateur,
  dans une section repliée (« Plus loin à la table »), pour ne pas leur donner
  le même poids (P7). Elles suivent les mêmes règles : partie sans siège
  exclue et comptée, siège sans ligne saisie « inconnu ».

Avec l'archétype fermé de P5, l'axe par position se regroupe au choix par
archétype ou par clan, et non plus par clan puis archétype libre.

### P9. Où se calcule l'analyse ?

Recommandation : **côté client, en fonctions pures sur le miroir**, hors ligne
comme le reste de l'application, sans route d'analyse. Le miroir contient déjà
les parties et leurs tables ; il lui faut seulement les versions (A6). Le
volume visé, quelques centaines de parties, se parcourt en quelques
millisecondes.

Écarté : une route `/analyse` côté serveur. Elle serait indisponible au club,
dupliquerait le calcul pour les parties encore en file, et n'apporterait rien
au portage vers Barrin.

**Tranché à A0 (2026-11-08)** : recommandation retenue.

### P10. Navigation et design

Recommandation :

- un troisième segment **« Bilan »** dans le sélecteur de l'onglet Parties
  (« Parties | Tournois | Bilan », route `#/bilan`), sans sixième onglet ;
- un encart **« Résultats »** dans l'aperçu bureau d'un deck et dans le détail
  mobile, qui renvoie au bilan filtré sur ce deck ;
- dans le détail d'une partie, la version jouée (« Banu Princes#1234, v3 ») et
  l'action « Figer sur la liste actuelle » ; dans le formulaire, les champs de
  deck adverse sous chaque adversaire ;
- **un handoff Claude Design** avant les écrans, comme aux Lots 7 et Chercher :
  le bilan est un écran neuf, fait de chiffres, et sa lisibilité au téléphone
  ne se devine pas. Brief à écrire dans
  `docs/design-handoff/lot8-brief-claude-design.md` dès A0 ;
- **aucune dépendance de graphique** : tableaux et barres en CSS ou en SVG
  écrit à la main.

**Tranché à A0 (2026-11-07)** : recommandation retenue. Le brief est écrit à
cette étape (`docs/design-handoff/lot8-brief-claude-design.md`), puis
l'utilisateur le transmet à Claude Design et verse le handoff reçu dans
`docs/design-handoff/` (étape D0). Le brief suit les recommandations de P5 à
P8 ; une décision qui s'en écarte se reporte dans le brief avant envoi.

#### Handoff reçu (2026-11-08)

Archive « Implémentation mobile et desktop.zip » versée dans
`docs/design-handoff/` : `LOT8.md` (fait foi pour la forme et la copie),
`LOT8-README.md` (résumé du designer, avec l'état d'interface attendu),
`Gurchon Hall Bilan.dc.html`, `Gurchon Hall Bilan Bureau.dc.html`,
`lot8-data.js` (données et calculs de référence du prototype), captures
`1b-46` à `1b-58` (dont `1b-46b`) et `d25`, `d27` à `d34`. Il n'y a ni `1b-45`
ni `d26` : la numérotation saute la variante écartée. `TabBar`, `TopBar`,
`DeckTables`, `support.js` et `nocturne/styles.css` de l'archive sont ceux du
dépôt, aux fins de ligne près : non recopiés.

Variantes retenues par le designer : au mobile, un axe à la fois sous des
onglets soulignés (Deck, Lieu, Mois, Position, Adversaires) ; au bureau, une
barre de filtres en ligne et les axes en grille, une ligne ouvrant à droite le
panneau des parties du groupe (patron d10). Les règles de A0 sont tenues :
aucun pourcentage écrit, positions éloignées repliées et atténuées, version par
tournoi, six puces d'archétype, clan principal en deux gestes.

Points relevés, à trancher ou à appliquer :

1. **« Figée à la ronde 2 »** (1b-50, 1b-54, d32). L'écran nomme la partie qui
   a figé la liste d'un deck dans un tournoi. Ce n'est pas déductible : la
   première figée n'est pas forcément la ronde au plus petit numéro (P3), et
   après un regel, c'est la partie d'où il est parti. **Seul point du handoff
   qui touche au modèle** ; proposition A9 ci-dessous.
2. **« Elle deviendra la v3 »** (1b-51, d29). La confirmation annonce si la
   liste actuelle diffère de la version. Calculable sur l'appareil, en
   comparant les lignes du deck au miroir et la version, selon la règle de P2
   (carte × quantité totale). Le serveur reste juge ; la phrase est une
   annonce, et une table de cas commune aux deux comparaisons évite qu'elles
   divergent.
3. **« Première partie le 15 octobre · 5 parties »** (1b-52), colonne
   « Depuis » (d31) : déduits des parties du miroir, sans champ de contrat.
4. **« Ouvrir ces parties dans la liste »** (panneau de d25) : la liste des
   parties ne filtre que par type, deck et lieu (Lot 7). Proposition pour D2 :
   le lien n'apparaît que pour les axes Deck et Lieu ; ailleurs, chaque partie
   du panneau ouvre son détail, ce qui suffit.
5. **Barres** : la barre GW montre la part des parties gagnées, sans chiffre
   écrit ; le brief l'autorisait. **Confirmé par l'utilisateur le
   2026-11-12** : les barres restent, aucun pourcentage n'étant écrit.
6. **Glyphes** : le designer signalait Banu Haqim (`n`) et un `o` en carré vide
   dans ses prototypes. Les codes sont ceux de
   `frontend/src/components/glyphs/glyphs.ts` (`"banu haqim": "n"`,
   `brujah: "o"`, `obf` en Ankha) : le défaut vient de la police chargée par le
   prototype, rien à corriger dans l'application.
7. **Fichiers proposés** par le designer (`StatsPage.tsx`,
   `DeckVersionPage.tsx`) : indicatifs. Le modèle d'analyse reste dans
   `features/analysis/` (A7) ; le nom des pages se fixe à D2.

### P11. La légalité d'un deck à la date d'un tournoi

Piste du §11 (limite n°6 du Lot 2), rangée au Lot 8 par `pistes-evolution.md`.
Avec les versions, la question devient précise : la liste jouée était-elle
légale le jour du tournoi ?

Recommandation : **l'inclure, en dernière étape back, détachable** : une route
`GET /decks/{id}/versions/{numero}/legalite?on=AAAA-MM-JJ`, qui réutilise les
fonctions pures existantes, et une pastille dans le détail du tournoi, en ligne
seulement comme toute légalité. Si le lot traîne, on la coupe sans rien
défaire.

**Tranché à A0 (2026-11-08)** : recommandation retenue. Avec la règle de P3,
la version évaluée est celle du tournoi, la même pour toutes ses parties.

### P12. Une liste qui change pendant un tournoi mono-deck

Le règlement interdit de modifier son deck entre deux rondes. Avec les
versions, deux rondes d'un tournoi mono-deck peuvent montrer deux versions du
même deck.

Recommandation : **le signaler dans le détail du tournoi, sans refuser.** Une
correction après coup (P3) peut produire cet état légitimement, et le contrôle
de mono-deck du Lot 7 ne regarde que le deck, pas sa version.

**Tranché à A0 (2026-11-08)** : sans objet. Avec la règle de P3 (une version
par deck et par tournoi, figée à sa première partie), deux versions d'un même
deck ne peuvent plus coexister dans un tournoi. Rien à signaler, rien à
contrôler ; le détail du tournoi dit seulement à quelle partie la liste a été
figée.

## Décisions de conception proposées à l'architecte

Rédigées d'après les décisions de A0 (2026-11-08).

### A1. Deux tables : `deck_version` et `deck_version_card`

`deck_version` : `id` (en `AUTOINCREMENT`, comme les tables du Lot 7 depuis
R11), `user_id`, `deck_id`, `number` (≥ 1), `created_at`. Unicités
(`deck_id`, `number`) et (`id`, `deck_id`, `user_id`), la seconde servant de
cible à la clé composite de `participation`. Clé composite (`deck_id`,
`user_id`) vers `deck`.

`deck_version_card` : `deck_version_id`, `card_id`, `quantity` (≥ 1), clé
primaire sur les deux premiers, clé étrangère vers `card` seulement, comme
`deleted_deck_card` vers `card_set` : une liste figée ne réserve rien.

Pas de colonne d'empreinte : la comparaison de la liste courante à la dernière
version se fait sur une centaine de lignes au plus, en mémoire.

### A2. `participation` gagne quatre colonnes, `deck.archetype` devient un enum

- `deck_version_id`, nullable, avec une clé composite (`deck_version_id`,
  `deck_id`, `user_id`) vers `deck_version` : la base garantit que la version
  appartient au deck de la ligne et au compte. Un CHECK
  `deck_version_id IS NULL OR deck_id IS NOT NULL` complète la clé, que
  `MATCH SIMPLE` désactive dès que `deck_id` est nul ;
- `opponent_deck_name`, texte de 120 caractères ;
- `opponent_deck_archetype`, enum `DeckArchetype` (P5) ;
- `opponent_clan_id`, clé étrangère vers `clan`.

Un enum `DeckArchetype` (`bleed`, `vote`, `wall`, `toolbox`, `rush`, `combo`)
dans `app/models/enums.py`, porté par un CHECK nommé sur `participation` et sur
`deck.archetype`, qui passe de `String(120)` à cet enum, nullable.

Avec P6, `player_id` devient nullable ; l'unicité (`game_id`, `player_id`)
tient, SQLite ne comparant pas les NULL entre eux. Les règles « champs adverses
seulement sur une ligne d'adversaire sans deck prêté » et « une ligne sans
joueur porte un siège ou un deck » sont des règles de service, comme A13.

### A3. Service de gel

Une fonction `freeze_decklist(db, deck, user_id) -> DeckVersion` agrège les
lignes vivantes par carte, compare à la dernière version du deck, la réutilise
ou crée la suivante. Un deck supprimé se fige depuis `deleted_deck_card`.
Appelée par la création d'une partie, le remplacement de sa table et une
modification qui change le deck d'une ligne, pour toute ligne qui désigne un
deck (prêts compris : la règle reste uniforme), et par le drapeau
`refreeze_decklists` de P3. Une écriture qui ne touche pas le deck d'une ligne
garde sa version.

Règle du tournoi (P3) : pour une partie de tournoi, la fonction cherche
d'abord une participation d'une autre partie du même tournoi, avec le même
deck, déjà figée ; elle reprend alors sa version sans regarder la liste
courante. Le drapeau `refreeze_decklists` sur une partie de tournoi fige la
liste courante puis l'applique à toutes les participations du tournoi qui
jouent ce deck, dans la même transaction. Une ligne d'adversaire qui joue un
deck prêté suit la même règle : la version est celle du deck dans le tournoi,
qui que soit le joueur.

Le gel par drapeau doit toucher `updated_at` de chaque partie modifiée, sans
quoi le miroir ne relirait pas leurs tables (A6).

### A4. Contrat

- `ParticipationRead` : `deck_version_id`, `deck_version_number`, et les champs
  adverses ; `ParticipationSummary` (ma ligne en résumé) : `deck_version_id` et
  `deck_version_number`.
- `ParticipationCreate` : les champs adverses, contrôlés en forme seulement ;
  le refus sur ma ligne est un verdict du service, pour qu'un refus par `/sync`
  reste celui d'une seule opération (convention du Lot 7).
- `GameUpdate` : `refreeze_decklists: bool = false`.
- `DeckCreate`, `DeckUpdate`, `DeckRead` : `archetype` devient `DeckArchetype`
  (P5) ; une valeur hors des six rend 422.
- Une route nouvelle, `GET /decks/{id}/versions` : chaque version avec son
  numéro, sa date, ses cartes (carte × quantité) et ses comptes crypte et
  bibliothèque ; lisible pour un deck supprimé, comme `GET /decks/{id}`.
- Avec P11, `GET /decks/{id}/versions/{numero}/legalite` avec `on`.

Soit 50 opérations sur 30 chemins (51 sur 31 avec P11). `API_ROUTE_PREFIXES`
ne bouge pas, tout restant sous `/decks`.

### A5. `/sync`

Aucun type d'opération nouveau. `game.create`, `game.update` et le
remplacement de table gagnent des champs **facultatifs** : une opération de
partie déjà en file, écrite avant le lot, reste valide et se rejoue telle
quelle. Un rejeu rend le verdict mémorisé et ne refige rien.

Une exception, voulue par P5 : `deck.create` et `deck.update` n'acceptent plus
qu'un des six archétypes. Une opération en file avec un archétype en texte
libre ferait refuser le lot en 422, et la bissection l'isolerait. Aucune file
n'existe hors des postes de recette (base écrasée, application en local), si
bien que la rupture est acceptée sans période de transition ; pour Barrin, la
marche à suivre d'une base en service reste celle du README offline (champ
d'abord toléré, le temps de vider les files).
Section « Lot 8 » à ajouter à `docs/lot3-sync-contrat.md`.

### A6. Couche hors ligne : Dexie version 7

Un magasin `deckVersions` (`id, deckId`), ajouté sans changement de clé ni
`upgrade`. `GameMeRow` et `GameTableLineRow` gagnent les champs de A4. Une
partie déjà au miroir sans ces champs les lit comme nuls ; avec la base écrasée
(P4), ce cas ne se présente que dans les tests de montée de version.

Les versions se relisent avec les decks, à chaque rafraîchissement, par
`GET /decks/{id}/versions` pour les decks qui ont des parties. Une partie
saisie hors ligne affiche « liste figée à la synchronisation » jusqu'au rejeu.
Le cœur générique (`core/`) ne change pas.

### A7. Modèle d'analyse côté client

`frontend/src/features/analysis/analysisModel.ts`, en fonctions pures et en
tables de petites fonctions par axe, sans `switch`, pour tenir les références
CRAP vides : `seatPositions(seat, playerCount)` (P7, P8 : proie, prédateur,
grande proie, grand prédateur, chacune un siège ou absente selon la table de
P8), `gameFacts(game)` (ma ligne, adversaire à chaque position, type),
`aggregate(games, axis, filters)`, `mainClan(versionCards)` (P5, clan le plus
représenté de la crypte). Plus de regroupement de texte libre : les
archétypes sont fermés. Aucun pourcentage produit, même en interne, pour que
l'écran ne puisse pas en afficher par mégarde. Une table de cas pour les
sièges (tables de 2 à 6, siège absent, position non saisie), à la manière de
`certain_game_win_cases.json`, mais côté client seulement puisque le serveur
ne calcule rien (P9).

### A8. Migration R13

Une treizième révision : création des deux tables, puis `participation`
renommée et recréée à la main, hors mode batch, comme R9 et R10 (une clé
étrangère composite ne s'ajoute pas par `ALTER TABLE` sous SQLite). `deck`
est recréée de la même façon pour le CHECK de son archétype, comme R9 l'a
fait ; c'est la table visée par le plus de clés étrangères (`deck_card`,
`deleted_deck_card`, `participation`, et désormais `deck_version`), d'où la
coupure des clés étrangères le temps de la migration et le
`foreign_key_check` final déjà assurés par `migrations/env.py`.

Une seule conversion : `deck.archetype`. Une valeur égale à l'un des six
codes une fois repliée (`fold_text`, « Toolbox » → `toolbox`) est convertie ;
toute autre valeur fait **refuser la montée** (`RuntimeError`, avant toute
modification, la liste des valeurs fautives dans le message), sur le patron
des gardes du Lot 4 : la migration ne devine pas qu'un « stealth bleed » est
un Bleed. La descente refuse de tourner s'il existe une version ou une ligne
avec un champ adverse, sur le patron de R10 ; elle rend les archétypes en
texte, sans perte. Montée et descente rendues hors ligne (`--sql`).

La base de développement étant écrasée (P4), R13 n'y sera pas appliquée sur
des données en place. Elle doit pourtant savoir le faire : la base de
production, au Lot 11, partira peut-être d'une révision antérieure. Les tests
d'aller-retour la passent donc sur une base peuplée par les fixtures (parties,
tables, decks prêtés, archétypes convertibles et non convertibles), et
vérifient que les participations ressortent identiques, colonnes nouvelles à
nul.

Le modèle passe à 27 tables et treize révisions (28 avec A9).

### A9. Version d'un deck dans un tournoi (ajoutée après le handoff)

Le handoff affiche la partie où la liste d'un tournoi a été figée (« Handoff
reçu », point 1). Deux voies :

- **une table `tournament_deck_version`** (recommandé) : `user_id`,
  `tournament_id`, `deck_id`, `deck_version_id`, `frozen_by_game_id`, unique
  sur (`tournament_id`, `deck_id`), clés composites vers `tournament`,
  `deck_version` et `game`. Elle dit quelle partie a figé la liste, et la
  règle « une version par deck et par tournoi » de P3 tient en base au lieu de
  reposer sur une recherche du service. Le gel d'une partie de tournoi lit
  d'abord cette ligne ; le regel la réécrit, puis réaligne les participations.
  `frozen_by_game_id` doit être revu quand la partie qui a figé est
  supprimée : la ligne passe à la partie suivante du tournoi avec ce deck, ou
  disparaît s'il n'y en a plus ;
- **changer la copie** pour « liste du tournoi », sans nommer de ronde, et
  garder la recherche de A3. Moins de modèle, mais une information que
  l'utilisateur a validée dans le handoff disparaît.

Exposée au contrat dans `TournamentDetailRead` : une ligne par deck joué, avec
version, numéro et partie qui l'a figée. Le miroir la range dans la ligne du
tournoi, comme `admissibleFinalDecks`.

**Tranché le 2026-11-08** (ouverture de A1) : table dédiée, la recommandation.
Clé primaire (`tournament_id`, `deck_id`) plutôt qu'une unicité à côté d'un
identifiant : rien ne désigne une ligne autrement que par ce couple.
`frozen_by_game_id` est non nul et sa clé étrangère ne cascade pas : la base
refuse de supprimer la partie qui a figé tant que la ligne la désigne, et
c'est le service (B1) qui la fait passer à la partie suivante ou la retire,
dans la même transaction.

#### Précisions pour B1 (2026-11-12)

Règles que A3 et A9 laissaient ouvertes, tranchées par l'architecte avant B1.
Aucune ne revient sur une décision de A0. Deux invariants les résument :

- dans une partie, un deck n'a qu'une version, quelle que soit la ligne qui le
  joue (la mienne ou un prêt) ;
- dans un tournoi, une ligne `tournament_deck_version` existe pour un deck si
  et seulement si une partie du tournoi le joue, et toutes ces parties portent
  sa version.

1. **Remplacement de la table.** Les lignes sont recréées et peuvent n'avoir
   aucun joueur : la version se garde par deck, au sein de la partie. Si
   l'ancienne table jouait déjà ce deck avec une version, la nouvelle ligne la
   reprend ; sinon le deck se fige. Dans un tournoi, la version du tournoi
   prime. Une ligne sans version (partie d'avant le gel, qui n'existe que dans
   les tests de migration) n'a rien à garder : son deck se fige. Corriger un VP
   le lendemain ne change donc pas la liste jouée.
2. **Ligne sans joueur.** « Un siège ou un deck » (P6) s'entend : un siège, un
   deck prêté, ou l'un des trois champs adverses ; « elle jouait Tremere »
   suffit. Des notes seules ne suffisent pas, la ligne est refusée (`invalid`).
   Une telle ligne n'est pas le « Moi » : ni VP ni GW, et pas de champ adverse
   si elle joue un de mes decks, comme une ligne nommée. Le contrôle « même
   joueur deux fois » ignore les lignes sans joueur ; sièges et nombre de
   lignes les comptent.
3. **Deck supprimé.** Accepté sur une ligne si l'ancienne table le jouait
   déjà, sur n'importe quelle ligne : même appariement par deck qu'au point 1,
   à la place de `kept_decks` par joueur. Il garde sa version ; s'il faut le
   figer (ligne sans version, ou regel), c'est depuis `deleted_deck_card` (A3).
4. **Partie suivante.** Quand la partie désignée par `frozen_by_game_id` ne
   joue plus ce deck dans ce tournoi, la ligne passe à la partie restante du
   tournoi qui le joue (prêt compris) au plus petit identifiant, sans changer
   de version, et disparaît s'il n'en reste aucune. Les identifiants n'étant
   jamais réattribués (R11), c'est l'ordre de création, le plus proche de « la
   première figée ». Quatre cas : partie supprimée, partie qui quitte le
   tournoi, ligne dont le deck change ou s'efface, table remplacée sans ce
   deck. Avec le second invariant, supprimer un tournoi vide n'a rien à
   nettoyer.
5. **Partie qui change de tournoi.** Vers une amicale, elle garde la version
   de chaque ligne, sans regel : son deck n'a pas changé, et une amicale est
   figée partie par partie. Vers un tournoi (depuis un autre ou depuis une
   amicale), chaque deck prend la version de ce tournoi s'il en a une ; sinon
   sa version actuelle devient celle du tournoi, cette partie la figeant.
   « La fixe sinon » (P3) veut dire « fixe la version du tournoi », pas « fige
   la liste courante » : la version gardée est la meilleure estimation de la
   liste jouée ce jour-là, la liste courante peut être postérieure. Une ligne
   sans version se fige.
6. **Regel (`refreeze_decklists`).** Il porte sur chaque deck de la table,
   prêts compris, et s'applique après les autres changements de la même
   écriture, sur l'état final. En amicale, sur les lignes de cette partie
   seulement. En tournoi, pour chaque deck : gel de la liste courante (la
   dernière version est réutilisée si elle est identique), réécriture de la
   ligne `tournament_deck_version` (version, et cette partie en
   `frozen_by_game_id`), réalignement de toutes les participations du tournoi
   qui jouent ce deck, `updated_at` touché sur chaque partie dont une ligne a
   changé de version. `tournament.updated_at` ne bouge pas : `deck_versions`
   est une lecture dérivée, comme `admissible_final_decks` qui change déjà
   sans lui, et le miroir relit le détail de chaque tournoi à chaque
   rafraîchissement ; une optimisation future sur cet horodatage devra traiter
   les deux ensemble. Un regel sur une partie sans deck est accepté sans
   effet. La confirmation côté client nomme chaque deck dont la version
   changera.
7. **Deck vide.** Un deck sans ligne, joué, donne une version sans carte,
   réutilisée tant qu'il reste vide. Accepté : une partie n'exige ni deck actif
   ni deck légal (A8 du Lot 7).
8. **`GET /decks/{id}/versions`.** Versions par numéro croissant, cartes de
   chaque version par identifiant de carte croissant ; 404 pour un deck
   inconnu ou d'un autre compte, lisible pour un deck supprimé, liste vide pour
   un deck jamais joué. `DeckVersionRead` et `DeckVersionCardRead` suffisent à
   A4 ; seule la description de `cards` a été précisée (ordre, version vide),
   sans effet sur le contrat tant que la route n'existe pas. Les lignes de
   `TournamentDetailRead.deck_versions` se rendent par `deck_id` croissant.

## Écrans (frontend-react)

Sur le handoff de D0, en mobile puis en bureau :

1. **Formulaire de partie** : sous chaque adversaire, clan principal,
   archétype (six puces) et nom de deck, repliés par défaut ; aide « Votre
   proie : siège 4 · Votre prédateur : siège 2 ». « Ajouter un siège sans nom »
   (P6).
2. **Détail de partie** : version jouée, lien vers sa liste, action « Figer sur
   la liste actuelle » (sur tout le tournoi pour une partie de tournoi, P3),
   deck de chaque adversaire, positions marquées.
3. **Liste d'une version** : `DeckTables` en lecture seule.
4. **Bilan** (`#/bilan`) : filtres communs, puis les axes de P8 en tableaux, le
   nombre de parties toujours visible, les parties exclues d'un axe comptées,
   aucun pourcentage ; grande proie et grand prédateur dans une section
   repliée.
5. **Résultats d'un deck** : encart dans l'aperçu bureau de `#/decks` et dans le
   détail mobile, par version.
6. **Détail de tournoi** : version du tournoi et partie où elle a été figée,
   légalité à la date du tournoi (P11).
7. **Formulaire de deck** (création et modification, mobile et bureau) :
   l'archétype passe d'un champ texte à six puces (P5).

## Découpage en étapes ordonnées

| Étape | Agent | Contenu | Dépend de |
| --- | --- | --- | --- |
| A0 | utilisateur, orchestrateur | P1 à P12 tranchées dans ce fichier ; brief Claude Design écrit — **fait le 2026-11-08** | rien |
| A1 | architecte-contrat | modèles, R13, aller-retour sur base vide et sur base peuplée par les fixtures — **fait le 2026-11-08** (cf. « Livré à A1 ») | A0 |
| A2 | architecte-contrat | schémas, export du contrat, client TS, section « Lot 8 » du contrat de sync — **fait le 2026-11-08** (cf. « Livré à A2 ») | A1 |
| B1 | backend-fastapi | gel des versions et règle du tournoi (A3), champs adverses et leurs règles, archétype fermé des decks, `GET /decks/{id}/versions` — **fait le 2026-11-12** (cf. « Livré à B1 ») | A2 |
| B2 | backend-fastapi | `/sync` : champs facultatifs, drapeau `refreeze_decklists`, archétype fermé dans `deck.*` — **fait le 2026-11-12** (cf. « Livré à B2 ») | B1 |
| F0 | orchestrateur | `vtes.db` **écrasée** et reconstruite à neuf à la tête (P4) — **fait le 2026-11-12** par l'utilisateur (cf. « Livré à F0 ») | B2 |
| C1 | pwa-offline | Dexie 7, miroir des versions, champs des lignes, constructeurs d'opérations, surcouche — **fait le 2026-11-12** (cf. « Livré à C1 ») | B2 |
| D0 | utilisateur, Claude Design | handoff mobile et bureau, versé dans `docs/design-handoff/` — **fait le 2026-11-08** (cf. « Handoff reçu », sous P10) | A0 |
| D1 | frontend-react | formulaire et détail de partie (écrans 1 et 2) — **fait le 2026-11-12** (cf. « Livré à D1 ») | C1, D0 |
| D2 | frontend-react | modèle d'analyse (A7), liste d'une version, bilan, résultats d'un deck, détail de tournoi, formulaire de deck (écrans 3 à 7) — **fait le 2026-11-12** (cf. « Livré à D2 ») | D1 |
| B3 | backend-fastapi | P11 : légalité d'une version à une date, détachable si le lot traîne — **fait le 2026-11-12**, avec sa pastille (cf. « Livré à B3 ») | B1 |
| E | qa-tests | tests, matrice d'autorisation, e2e aux deux largeurs | D2 (et B3) |
| F | orchestrateur | mise en service finale, CLAUDE.md, vérification sur téléphone | E |

**F0 : la base est écrasée, pas migrée** (décision du 2026-11-07, P4).
L'application n'est pas en ligne et les données actuelles sont de la recette.
Placée après B2, la reconstruction donne une base où toute partie saisie
pendant la suite du lot a sa liste figée. Les changements de contrat des
parties étant additifs, le front d'aujourd'hui fonctionne contre le back de B2
en attendant les écrans, à une exception près : l'archétype d'un deck (P5).
Jusqu'à D2, créer un deck en laissant l'archétype vide, ou taper exactement un
des six codes en minuscules ; toute autre saisie est refusée.

L'application ne tourne qu'en local : aucun appareil à déconnecter (précisé
par l'utilisateur le 2026-11-08). Procédure :

1. copie de `vtes.db` en `.bak` par habitude, sans comparaison ;
2. suppression de `vtes.db`, `uv run alembic upgrade head` (en vérifiant
   `DATABASE_URL`), `uv run python scripts/import_catalog.py` ;
3. réclamation du compte historique recréé par R8 (`manage_accounts.py
   claim-legacy`) ou création d'un compte (`create`), au choix de
   l'utilisateur ;
4. si le navigateur du poste montre ensuite des decks ou des parties de
   l'ancienne base, effacer les données du site : le compte réclamé reprend
   l'identifiant `1`, donc le même nom de base IndexedDB
   (`gurchon-hall-offline-u1`) ;
5. en-tête de CLAUDE.md corrigé : la base ne contient plus « la vraie
   collection », les sauvegardes `.bak` des mises en service précédentes
   deviennent sans objet.

D0 avance en parallèle de A1 à C1. C1 peut commencer ce qui ne dépend pas des
types générés dès A2, comme C1a au Lot 7.

### Livré à A1 (2026-11-08)

- `DeckArchetype` (`app/models/enums.py`) ; `deck.archetype` passe à cet enum,
  CHECK `ck_deck_deck_archetype`.
- `DeckVersion` et `DeckVersionCard` dans `app/models/collection.py`, avec la
  relation `Deck.versions` (sans cascade) ; `deck_version` en `AUTOINCREMENT`,
  `created_at` seul (une version ne se modifie pas).
- `Participation` : `player_id` nullable, `deck_version_id` et sa clé
  composite, CHECK `ck_participation_version_requires_deck`, les trois champs
  adverses (CHECK `ck_participation_deck_archetype`, clé vers `clan`) ;
  `is_me` rend faux pour une ligne sans joueur, et `Game.me` passe par lui.
- `TournamentDeckVersion` dans `app/models/play.py` (A9, tranchée ci-dessus),
  index sur `frozen_by_game_id`.
- R13, `ac6cda5ad252` : 28 tables, treize révisions. Trois écarts à A8, à
  connaître :
  - **la descente ne se rend pas hors ligne**, comme celle de R10 : sa garde
    lit la base, et une descente rendue sans garde perdrait les versions sans
    prévenir ;
  - une valeur d'archétype **vide ou faite d'espaces devient NULL** au lieu de
    bloquer la montée : elle ne disait rien, la conversion ne devine pas ;
  - le script hors ligne de la montée appelle `fold_text` : il se joue sur une
    connexion ouverte par l'application, pas dans le client `sqlite3` nu.
- Tests : section « Lot 8 » de `backend/tests/test_migrations.py` (27 tests :
  conversion et conservation des lignes sur une base peuplée par les fixtures,
  montée refusée sur un archétype non convertible, treize refus de contrainte
  à la tête, lignes sans joueur, cascade des cartes d'une version, descente au
  caractère près et ses quatre refus, aller-retour, rendu hors ligne) ;
  comptes de tables portés à 28.
- **Laissé à A2** : les schémas `DeckCreate`, `DeckUpdate` et `DeckRead`
  acceptent encore un archétype libre, que la base refuse désormais, et
  `ParticipationRead` n'expose pas les colonnes nouvelles. Cinq tests
  échouent jusqu'à A2, et seulement eux (2511 verts et 2 `xfail` sinon) :
  `test_api_decks::test_create_deck_defaults_to_draft` et deux tests de
  `test_sync_service` (« Bleed », « Vote » envoyés tels quels),
  `test_schemas_write::test_string_limits_do_not_exceed_the_database_column_lengths`
  (`max_length=120` contre une colonne d'enum) et
  `test_schemas_read::test_read_schema_exposes_every_column_of_its_model[Participation]`.
  Tous verts depuis A2.

### Livré à A2 (2026-11-08)

- **Schémas** (`app/schemas/collection.py`, `app/schemas/play.py`) :
  `archetype` passe à `DeckArchetype` dans `DeckCreate`, `DeckUpdate` et
  `DeckRead`, sans repli de casse ni rognage (le client envoie le code) ;
  `ParticipationCreate.player` devient facultatif et la ligne gagne les trois
  champs adverses (nom de 120 caractères, non rogné comme `notes`) ;
  `ParticipationRead` et `ParticipationSummary` rendent `deck_version_id` et
  `deck_version_number`, `ParticipationRead` aussi les champs adverses et un
  `player_id` nullable ; `GameUpdate.refreeze_decklists` ;
  `TournamentDeckVersionRead` et `TournamentDetailRead.deck_versions` (A9) ;
  `DeckVersionRead` et `DeckVersionCardRead`, écrits mais hors du contrat
  jusqu'à leur route, comme les schémas de partie au Lot 7.
- **Modèles** : propriétés `deck_version_number` sur `Participation` et
  `TournamentDeckVersion`, version chargée en jointure (une liste de parties
  ne fait pas une requête par ligne).
- **Contrat** : toujours 49 opérations sur 29 chemins ; deux schémas neufs
  (`DeckArchetype`, `TournamentDeckVersionRead`) ; client TS régénéré.
  Aucun type `/sync` nouveau ; l'empreinte d'une opération écrite avant le lot
  ne change pas (`exclude_unset`). Section « Lot 8 » écrite dans
  `docs/lot3-sync-contrat.md`.
- **Garde provisoire** dans `app/services/games.py`
  (`_refuse_what_b1_brings`, et le drapeau dans `update_game`) : une ligne
  sans joueur, un champ adverse ou `refreeze_decklists: true` sont refusés en
  422 (verdict `invalid` par `/sync`) jusqu'à ce que B1 sache les
  enregistrer. **À retirer à B1** (fait, cf. « Livré à B1 »).
- **Front rouge jusqu'à C1**, décision de l'utilisateur du 2026-11-08 : A2 ne
  touche aucun fichier du front hors `src/api-client/schema.d.ts`.
  `npx tsc --noEmit -p tsconfig.app.json` signale 10 erreurs, donc le build et
  `preview` échouent ; `vite` en développement tourne. Les erreurs, toutes
  pour C1 (et D1/D2 pour les écrans) : l'archétype en texte libre de
  `offline/vtes/operations.ts` (deux, qui remontent dans `DecksPage.tsx` et
  `DeckDetailPage.tsx`), le joueur facultatif d'une ligne dans
  `features/sync/playCorrection.ts` (cinq) et `offline/vtes/overlayPlay.ts`
  (deux), et `player_id` nullable dans `offline/vtes/refresh.ts` (une), qui
  remonte jusqu'à `LocalTableLine.playerKey` et aux écrans de partie.
- **Tests** : `backend/tests/test_lot8_contract.py` (46 : archétype fermé en
  ligne et par `/sync`, lot refusé en 422 pour un archétype libre en file,
  bornes des champs adverses, aucune version écrite par le client, empreinte
  inchangée, lectures de la version et du deck adverse, gardes provisoires,
  refus d'une seule opération par `/sync`) ; attentes alignées dans
  `test_api_decks`, `test_deck_state_matrix`, `test_sync_service`,
  `test_schemas_write`, `test_schemas_read` et `test_play_routes`.

### Livré à B1 (2026-11-12)

Les règles suivies sont celles de A3 et A9, complétées avant le code par
l'architecte-contrat dans « Précisions pour B1 (2026-11-12) », sous A9 :
une version par deck dans une partie, appariement par deck au remplacement
d'une table, passage de la ligne du tournoi à la partie suivante.

- **Gel** (`app/services/deck_versions.py`, nouveau) : `freeze_decklist`
  agrège la liste par carte, sans langue, extension ni proxy (P2), puis
  réutilise la dernière version si la liste n'a pas changé, ou crée la
  suivante. Un deck supprimé se fige depuis `deleted_deck_card` ; un deck vide
  donne une version sans carte.
- **Règle du tournoi** (A9), dans le même module :
  - `assign_versions` décide la version de chaque deck d'une partie qu'on
    écrit. La version du tournoi passe en premier, puis celle que la partie
    avait déjà, et sinon le deck se fige. La ligne `tournament_deck_version`
    se crée si elle manque.
  - Le regel passe en dernier, sur l'état final. En tournoi, il réécrit la
    ligne, réaligne toutes les participations du deck et touche `updated_at`
    des parties modifiées. `tournament.updated_at` ne bouge pas.
  - `hand_over` fait passer la ligne à la partie restante au plus petit
    identifiant, ou la retire. Il est appelé après chaque écriture qui peut
    changer les decks d'un tournoi, et avant la suppression d'une partie,
    puisque la clé étrangère ne cascade pas.
- **`app/services/games.py`** :
  - la création fige ;
  - la modification ne décide des versions que si la table est remplacée,
    si le tournoi change ou si `refreeze_decklists` est posé ; toute autre
    écriture garde les versions ;
  - `update_game` est découpée en `_resolve_targets`, `_apply_fields` et
    `_write_table`.
- **Ligne sans joueur et deck adverse** (P5, P6) :
  - `Line` accepte un joueur nul et porte les trois champs adverses.
  - Les refus passent en 422 (`invalid` par `/sync`) : un champ adverse sur ma
    ligne ou sur une ligne qui joue un de mes decks, une ligne sans joueur qui
    ne porte ni siège, ni deck prêté, ni champ adverse (des notes seules ne
    suffisent pas), et des VP sur une ligne sans joueur.
  - Un clan inconnu rend 404.
  - Un deck supprimé reste accepté si l'ancienne table le jouait déjà, sur
    n'importe quelle ligne (`kept_decks` devient un ensemble de decks).
  - `vtes_rules.table_issues` ignore les joueurs nuls dans le contrôle de
    doublon.
- **Garde provisoire d'A2 retirée** : `_refuse_what_b1_brings`, `_NOT_YET` et
  le refus du drapeau ont disparu. Les tests qui attendaient ces refus
  constatent maintenant l'enregistrement.
- **Archétype fermé** : aucun reste de texte libre dans les services ni les
  routeurs, rien à changer après A2.
- **Contrat** : `GET /decks/{id}/versions` (`listDeckVersions`) rend les
  versions par numéro croissant, cartes par identifiant croissant, avec les
  comptes de crypte et de bibliothèque. Un deck jamais joué donne une liste
  vide, un deck supprimé reste lisible, et un autre compte reçoit 404.
  `TournamentDetailRead.deck_versions` est rempli, trié par deck. La
  description de `frozen_by_game_id` ne dit plus « la première figée ». Le
  contrat passe à **50 opérations sur 30 chemins**, client TS régénéré.
- **Tests** : `backend/tests/test_lot8_freeze.py` (57, dont 5 ajoutés par
  qa-tests : passage d'un tournoi à un autre, regel en tournoi avec un deck
  prêté, regel dans la même écriture qu'un déplacement vers un tournoi, regel
  d'un deck supprimé, regel sans changement de liste). La route est ajoutée à
  la matrice d'autorisation (401 sans session, 404 pour un autre compte). Les
  décomptes d'opérations sont alignés dans `test_contract_card_search` et
  `test_openapi_contract`.
- **Vérifications** (coûts Argon2 de la CI) :
  - passe complète sous couverture : 2612 verts et 2 `xfail`, aucun échec ;
  - les 5 tests de la QA, venus après cette passe, sont verts seuls (57 verts
    dans `test_lot8_freeze.py`), donc 2617 verts attendus à la prochaine
    passe complète ;
  - `ruff check` propre, contrat à jour (`--check`) ;
  - CRAP back : 363 fonctions, aucune au-dessus de 30, pire 21
    (`admissible_final_decks`, inchangée), aucune régression. Parmi les
    fonctions touchées, `table_issues` est à 14, `update_game` à 13 ;
  - front : toujours 10 erreurs `tsc`, mêmes fichiers et même nature qu'à A2.
- **`/sync`, en avance sur B2** : `game.create`, `game.update` et
  `game.delete` passent par les services modifiés, si bien que le gel, le
  deck adverse et le drapeau s'appliquent déjà par la file. Seul le test
  `/sync` de la ligne sans joueur a changé : il envoie des notes seules et
  attend `invalid`. B2 garde les tests `/sync` dédiés (drapeau, deck adverse,
  rejeu sans regel, opération d'avant le lot) et la combinaison d'un
  remplacement de table et du drapeau dans un même `game.update`, que seule
  la file permet d'écrire (`PUT /parties/{id}/participations` n'a pas le
  drapeau).
- **Écarts au plan** : aucun sur les règles. Deux points à connaître :
  - une collision de numéro de version entre deux écritures concurrentes rend
    le 409 générique des parties (« La partie contredit des données
    existantes. ») ;
  - le cas « ligne sans version, qui se fige » (point 1 des précisions) ne
    se produit qu'après R13 sur une base peuplée. Il n'a pas de test de
    service, puisque la base de développement sera écrasée (P4).

### Livré à B2 (2026-11-12)

- **Aucun code de service ni de schéma** : B1 avait déjà fait passer
  `game.create`, `game.update` et `game.delete` par les services modifiés,
  et A2 avait fermé l'archétype de `deck.create` et `deck.update`. B2 se
  réduit aux tests `/sync` que B1 lui laissait.
- **Tests** : `backend/tests/test_sync_lot8.py` (29), tous par la file :
  - l'ordre de la file fait l'ordre du gel, dans un même lot (partie, puis
    deck retouché) et d'un lot à l'autre ;
  - un rejeu de `game.create` ou d'un regel ne refige rien, même si le deck
    a changé depuis, et ne crée aucune version ;
  - une opération de partie écrite avant le lot (sans aucun champ nouveau)
    s'applique, fige à la création, garde sa version sur une modification de
    notes, et se rejoue en `replayed` ;
  - drapeau omis, à `false` ou `data` absent : pas de regel ;
  - drapeau par `game.update` : liste courante figée, `updated_at` touché ;
    en tournoi, toutes les rondes réalignées et la ligne du tournoi rattachée
    à la partie du regel ;
  - **remplacement de table et drapeau dans la même opération** : le deck
    gardé est refigé, le deck nouveau se fige à sa liste courante ; sans le
    drapeau, le remplacement garde la version ;
  - un regel refusé (table fautive) n'écrit aucune version ;
  - deck adverse et ligne sans joueur enregistrés par la file, et réécrits
    par un remplacement de table ;
  - cinq refus rendus en verdict d'une seule opération, le lot continuant :
    champ adverse sur ma ligne ou sur un deck prêté, notes seules et VP sur
    une ligne sans joueur (`invalid`), clan inconnu (`not_found`) ;
  - une ligne qui porte `deck_version_id` fait refuser le lot entier en 422 ;
  - les six archétypes et `null` par `deck.create` et `deck.update` ; un
    archétype libre dans `deck.update` (casse, espaces, chaîne vide) fait
    refuser le lot en 422 sans rien journaliser.
- **Vérification** : la suppression du drapeau dans `update_game`, essayée
  le temps d'un passage, fait tomber les quatre tests qui le visent. `ruff
  check` propre. Le contrat ne bouge pas (50 opérations sur 30 chemins), ni
  le score CRAP, aucune fonction de `app/` n'ayant changé.

### Livré à F0 (2026-11-12)

Fait par l'utilisateur. Relevé après coup sur `backend/vtes.db` (`DATABASE_URL`
non définie) : révision `ac6cda5ad252` (la tête), catalogue réimporté
(4212 cartes), aucun deck, aucune partie, aucune version. Deux comptes : le
compte historique recréé par R8 (`id = 1`), laissé non réclamé avec son
adresse provisoire, et un compte créé par `manage_accounts.py create`
(`id = 2`), qui a son « Moi ». Le compte utilisé est donc le `2` : sa base
IndexedDB s'appelle `gurchon-hall-offline-u2`, neuve, et le point 4 de la
procédure (effacer les données du site) devient sans objet. Aucune copie
`.bak` de la base d'avant n'apparaît à côté de `vtes.db` ; le point 1 était
facultatif.

### Livré à C1 (2026-11-12)

- **Dexie version 7** (`offline/vtes/db.ts`) : magasin `deckVersions`
  (`id, deckId`), ajouté sans changement de clé. Écart à A6 : l'`upgrade` vide
  `cardDetails`. Le formulaire de partie a besoin de la liste des clans avec
  leur identifiant (`opponent_clan_id`), que le miroir ne gardait pas et
  qu'aucune route ne sert ; `CardDetailRow` gagne `clanId`, et le vidage rend
  le catalogue « incomplet », ce qui déclenche la relecture unique du lot
  Chercher (P11) au retour du réseau. `cards` n'est pas touché : le picker et
  les libellés marchent hors ligne pendant ce temps, seuls les filtres de
  Chercher attendent.
- **Lignes du miroir** : `GameTableLineRow` (joueur nullable, version, trois
  champs adverses), `GameMeRow` (version) et `TournamentRow.deckVersions`
  (A9). Les champs nouveaux sont facultatifs dans le type : une ligne écrite
  avant la version 7 les lit comme nuls, sans vidage du miroir des parties.
  `DeckRow.archetype` passe à `DeckArchetype`.
- **Rafraîchissement** (`refresh.ts`) : les champs nouveaux sont lus, et
  `refreshDeckVersions` s'ajoute après les parties dans `runtime.ts`. Il ne lit
  `GET /decks/{id}/versions` que pour les decks que désignent les parties ou
  les tournois du miroir, et saute un deck dont toutes les versions désignées
  sont déjà connues (une version ne change jamais). Un deck qui n'est plus
  joué sort du magasin ; un deck introuvable (404) est omis.
- **Constructeurs** (`operations.ts`) : `ParticipationInput.player` devient
  facultatif (omis pour un adversaire non nommé, comme le contrat le
  documente), et la ligne gagne `opponentDeckName`, `opponentDeckArchetype`,
  `opponentClanId`. `GameUpdate.refreezeDecklists` n'écrit
  `refreeze_decklists: true` dans `data` que s'il est vrai : `false` et
  l'absence gardent l'empreinte d'une opération d'avant le lot. L'archétype de
  `deck.create` et `deck.update` est typé sur les six codes.
- **Surcouche** (`overlayPlay.ts`) : `LocalTableLine.playerKey` nullable,
  champs adverses, et `deckVersionId` / `deckVersionNumber` sur chaque ligne
  et sur ma ligne en résumé ; `LocalTournament.deckVersions`, avec la partie
  qui a figé désignée par sa clé de surcouche. Le client ne fabrique jamais de
  version. Pour une écriture en file, il applique les règles du serveur à ce
  qu'il sait : version du tournoi pour ce deck, sinon celle que la partie
  avait déjà pour ce deck, sinon rien, ce que l'écran lira « liste figée à la
  synchronisation ». Un regel en file efface la version des decks regelés sur
  la partie et, en tournoi, sur toutes les rondes qui les jouent, et retire la
  ligne du tournoi pour ces decks jusqu'au rejeu.
- **Lectures** : `readDeckVersions` (par clé de deck, référence client
  comprise, sans passer par la projection pour qu'un deck supprimé reste
  lisible), `readDeckVersion`, `readClans` (clans déduits des cartes de
  crypte, triés par nom), et les hooks `useLocalDeckVersions`,
  `useLocalDeckVersion`, `useLocalClans`. `DECK_ARCHETYPES` et
  `DECK_ARCHETYPE_LABELS` (Bleed, Vote, Wall, Toolbox, Rush, Combo) sont
  exportés avec le type.
- **Front de nouveau compilable** : les 10 erreurs `tsc` laissées par A2 sont
  corrigées. `playCorrection.ts` reprend le type généré de la ligne et
  recopie les lignes d'adversaire telles quelles. Les écrans qui affichent un
  adversaire disent « Adversaire sans nom » pour une ligne sans joueur
  (`opponentName`, dans `gameFormat.ts`). Le formulaire de partie reporte le
  deck adverse et la ligne sans joueur à la modification d'une table, sans
  encore les saisir (D1) : remplacer la table sans eux les aurait effacés.
  L'archétype des formulaires de deck passe provisoirement à une liste
  déroulante des six codes (`ArchetypeSelect`), que les puces du handoff
  remplaceront à D2, et s'affiche par son libellé.
- **Tests** : `tests/unit/offline/vtesLot8.test.ts` (22 : constructeurs, lecture
  du miroir avec et sans les champs nouveaux, versions d'une écriture en file
  dans chaque cas des précisions pour B1, regel en amicale et en tournoi,
  aller-retour de la table par le formulaire, montée de la version 6 à la
  version 7, miroir des versions et son cache, lecture par référence client,
  clans). Le serveur factice rend les champs du Lot 8 et la route des
  versions. Attendus mis à jour : version de base 7 dans trois tests de
  montée, `clanId` dans le détail d'une carte, libellé « Vote » dans
  l'Atelier. Un test des decks attend désormais les comptes de la liste par
  `waitFor`, comme les lignes voisines : le rafraîchissement a une étape de
  plus, et ces comptes arrivent un cycle plus tard.
- **Vérifications** : vitest sous couverture, 1052 tests verts sur 64
  fichiers ; `npm run lint` et `npx tsc --noEmit -p tsconfig.app.json`
  propres ; CRAP front sans régression ; aucun `data-testid` disparu.
  Playwright non relancé.
- **Laissé à D1 et D2** : la saisie du deck adverse et de la ligne sans joueur,
  l'action « Figer sur la liste actuelle » (`updateGame(game,
  { refreezeDecklists: true })`, qui passe déjà par la file), l'affichage des
  versions, et les puces d'archétype.

### Livré à D1 (2026-11-12)

Écrans 1 et 2 du handoff (1b-48 à 1b-51, d27 à d29), en mobile et en bureau.

- **Positions à la table** (`features/analysis/analysisModel.ts`, posé ici
  pour que D2 y ajoute les agrégats de A7) : `seatPositions` (P7, P8),
  `positionsOfSeat`, `positionLabel`, `preyPredatorHint`. À deux joueurs, le
  seul adversaire est « proie et prédateur » ; à quatre, le siège d'en face est
  « grande proie et grand prédateur » ; à six, il n'a pas de position.
- **Saisie** (`GameForm.tsx`, bloc des adversaires sorti dans
  `OpponentsSection.tsx`) :
  - aide « Votre proie : siège 3 · Votre prédateur : siège 1 » dès que mon
    siège est saisi, et la position après le nom de chaque adversaire ;
  - sous-bloc « Son deck », replié, qui résume « [glyphe] Clan · Archétype ·
    nom » ou « Facultatif ». Déplié : clan principal (feuille 1b-49 au mobile,
    avec les trois clans récents en tête et « Pas de clan principal » ; liste
    déroulante au bureau), six puces d'archétype (un second toucher décoche),
    nom de deck (120 caractères, envoyé rogné) ;
  - un deck prêté retire le sous-bloc et efface le deck adverse saisi (le
    serveur le refuserait) ; « · deck déjà connu » s'affiche à côté du choix ;
  - « Ajouter un siège sans nom » crée une ligne « Joueur non nommé » (siège en
    pointillés). Tant qu'elle n'a ni siège, ni deck prêté, ni deck adverse,
    l'alerte du handoff bloque l'envoi (`formErrors`, identifiant `unnamed`) ;
  - fonctions pures dans `gameFormModel.ts` : `isEmptyUnnamed`,
    `hasOpponentDeck`, `opponentDeckSummary`, `recentClanIds`.
- **Détail** (`GameDetail.tsx`) :
  - « Mon deck » : « Banu Princes#1234 · v2 », puis « liste du tournoi, figée
    à cette ronde » ou « … figée à la ronde 2 » (d'après
    `TournamentRow.deckVersions`), « liste figée à la synchronisation » pour
    une partie en file, « liste non figée » pour une partie d'avant le gel ;
  - table par siège : deck adverse avec le glyphe de son clan, « Banu Princes ·
    v2 » sur ma ligne, position à droite (proie et prédateur en accent, les
    positions éloignées atténuées) ;
  - bouton « Figer sur la liste actuelle », absent pour une partie en file ou
    sans deck à la table. La confirmation (`FreezeDialog.tsx`) est une feuille
    basse au mobile et un dialogue de 500 px au bureau (Échap garde, Entrée
    fige). Elle nomme les parties rattachées et leurs rondes, la partie du
    tournoi qui ne change pas, et annonce pour chaque deck « elle deviendra la
    v3 », « la partie passera à la v3 » (liste égale à une version plus
    récente), « rien ne change », ou que le serveur tranchera (version jamais
    lue, deck supprimé). Elle envoie `updateGame(…, { refreezeDecklists: true })` ;
  - fonctions pures dans `freezeModel.ts` : comparaison carte × quantité (P2),
    `freezeOutcome`, `freezeScope`, textes, `versionNote`.
- **Liste des parties** : « v2 » après le nom du deck, au mobile et dans le
  tableau bureau (d28).
- **Écarts au handoff** :
  - le lien « Voir la liste v2 » n'est pas posé : la page d'une version
    (écran 3) arrive à D2, qui l'ajoutera au détail ;
  - « Les 3 parties **du tournoi « Open de Lyon »** » au lieu de « de l'Open
    de Lyon » : l'élision ne se devine pas d'un nom saisi (« du Championnat de
    France ») ;
  - « Joueur non nommé », le libellé du handoff, remplace « Adversaire sans
    nom » posé à C1 (`opponentName`) ; le siège vide du détail garde « non
    nommé » ;
  - quand la table joue plusieurs de mes decks (prêts), la citation donne une
    phrase par deck, nommé (précision 6 de B1).
- **Laissé à E** : la table de cas commune au client et au serveur pour la
  comparaison de deux listes (point 2 du handoff) ; `freezeOutcome` a la
  sienne côté client seulement.
- **Tests** : `tests/unit/features/analysis/seatPositions.test.ts` (table de
  cas des sièges, de deux à six joueurs), `features/games/freezeModel.test.ts`,
  `features/games/opponentDeck.test.ts`, et `tests/unit/ui/gamesLot8.test.tsx`
  (8 : saisie complète au mobile avec la feuille des clans, ligne sans nom et
  deck prêté au bureau, report du deck adverse à la modification, détail avec
  version et positions, partie en file, regel en tournoi et en amicale).
- **Vérifications** : vitest sous couverture, 1100 tests verts sur 68
  fichiers ; `npm run lint` et `tsc` propres ; CRAP front sans régression
  (`GameDetail` à 25) ; aucun `data-testid` disparu ; e2e `games-saisie` et
  `club-sans-reseau` verts aux deux largeurs contre le vrai back.

### Livré à D2 (2026-11-12)

Écrans 3 à 7 du handoff (1b-46 à 1b-58, d25, d30 à d34), en mobile et en
bureau. Aucun changement de contrat, de `/sync`, de modèle ni de version Dexie.

- **Modèle du bilan** (`features/analysis/bilanModel.ts`, à côté de
  `analysisModel.ts`, qui garde les positions) : `gameFact` réduit une partie
  à ce que le bilan regroupe, avec le deck de l'adversaire à chaque position
  (deck adverse saisi, ou archétype et clan principal d'un deck prêté).
  Filtres (période, types, deck) ; agrégats `statsOf`, `averageVp` ; axes
  `deckAxis` (et `versionGroups`), `venueAxis`, `monthAxis`, `opponentAxis`,
  `positionAxis` ; `bilanSummary`, `sortGroups`, `mainClan`. Tables de petites
  fonctions, sans `switch`. **Aucun pourcentage**, même en interne : les barres
  se dessinent en `flex-grow` à partir des comptes. Une partie sans VP compte
  pour 0, un GW non saisi pour « non ».
- **Bilan** (`#/bilan`, `BilanPage.tsx` et ses morceaux dans
  `features/analysis/`) : troisième segment de `PlaySwitcher`. Au mobile, ligne
  de filtres et feuille 1b-47 (compte vivant, « Effacer les filtres »), résumé
  en filet accent, un axe à la fois sous des onglets soulignés ; versions
  dépliables sous chaque deck avec « Voir la liste » ; Position avec « Ma proie
  | Mon prédateur », « Archétype | Clan », note des parties sans siège, et
  « Plus loin à la table » replié. Au bureau, barre de filtres en ligne, axes
  en grille, tri au clic d'en-tête (« inconnu » reste en dernier) et panneau
  de droite des parties du groupe. États vide, sans correspondance, sans
  siège. `#/bilan?deck=<clé>` ouvre le bilan filtré sur un deck.
- **Liste d'une version** (`#/decks/<clé>/versions/<n>`,
  `DeckVersionPage.tsx`) : `DeckTables` en lecture seule sans proxies,
  « Première partie le … · N parties », changements depuis la version
  précédente (`deckVersionModel.ts`), en segmenté au mobile et en carte au
  bureau avec les onglets de versions ; « Liste indisponible hors ligne » pour
  une version jamais lue. Liens depuis le détail d'une partie (laissé par D1),
  le bilan, l'encart Résultats et le tournoi.
- **Résultats d'un deck** (`DeckResults.tsx`) : dans le détail mobile et sous
  les tableaux de l'aperçu bureau, une ligne par version, la plus récente en
  haut, « Pas encore joué » sinon, « Voir dans le bilan ».
- **Détail de tournoi** : bloc « Decks joués » (`TournamentDecks.tsx`), version
  de chaque deck, ronde qui l'a figée, rondes jouées avec ; la version s'ajoute
  au deck de chaque ronde dans « Mes rondes ».
- **Formulaire de deck** : six puces (`ArchetypeChips.tsx`) à la place de la
  liste déroulante de C1, création et modification.
- **Lecture ajoutée** : `readAllDeckVersions` / `useLocalAllDeckVersions`
  (clan principal de mes decks, clan d'un deck prêté).
- **Écarts au handoff** :
  - pas de pastille « Légal le 24 octobre » : elle attend la route de B3 et se
    posera à côté de la ligne du tournoi, sans rien toucher d'autre (posée
    à B3) ;
  - pas de lien « Ouvrir ces parties dans la liste » (point 4 du handoff) : la
    liste des parties ne lit aucun filtre dans l'adresse ; chaque partie du
    panneau ouvre son détail ;
  - le retour de la liste d'une version dit « Retour » et revient à l'écran
    d'où l'on vient, puisqu'on y arrive de cinq endroits ;
  - les champs De / À de la période sont modifiables, et passent la période en
    « Période choisie » ;
  - les barres GW sont posées comme le brief l'autorisait, et l'utilisateur
    les a confirmées le 2026-11-12 (point 5 du handoff).
- **Tests** : `tests/unit/features/analysis/bilanModel.test.ts` (filtres,
  axes, positions à quatre et à trois joueurs, tri, clan principal, aucune
  sortie avec « % »), `features/decks/deckVersionModel.test.ts` (changements,
  libellés du tournoi), `tests/unit/ui/bilan.test.tsx` (bilan au mobile et au
  bureau, liste d'une version et version indisponible, résultats d'un deck,
  decks d'un tournoi, puces d'archétype), routes du bilan et d'une version
  dans `routes.test.ts`.
- **Vérifications** : vitest sous couverture, 1135 tests verts sur 71
  fichiers ; `npm run lint`, `tsc` et `vite build` propres ; CRAP front sans
  régression, aucune fonction au-dessus de 30 ; aucun `data-testid` disparu.
  Playwright non relancé (étape E).

### Livré à B3 (2026-11-12)

P11, back et pastille ensemble : la route n'a qu'un usage, et le bloc
« Decks joués » l'attendait (écart de D2).

- **Route** `GET /decks/{id}/versions/{number}/legalite?on=AAAA-MM-JJ`
  (`getDeckVersionLegality`), sous session : les cinq règles du §5 sur la
  liste figée de la version, à la date `on`, le jour UTC si elle manque.
  Lisible pour un deck supprimé, comme ses versions ; 404 « Version 2 du deck
  12 introuvable. » pour un numéro que le deck n'a pas (donc pour un deck
  jamais joué), 404 du deck pour un autre compte, 422 pour un numéro ou une
  date mal formés. Une version vide est jugée comme un deck vide : illégale.
- **Schéma** `DeckVersionLegality` : `DeckLegality` plus `deck_version_id` et
  `number`. Contrat à **51 opérations sur 31 chemins**, le compte du critère
  de fin de lot ; client TS régénéré. Aucun type `/sync`, aucune migration.
- **Service** (`app/services/decks.py`) : le calcul de `get_legality` sort dans
  `_legality_fields`, qui prend des couples (carte, quantité) et sert aux deux
  routes ; `get_version_legality` lit la version et ses cartes en une requête.
  `get_legality` ne change pas de comportement.
- **Pastille** (`TournamentDecks.tsx`, `VersionLegalityTag`) : élément à part
  dans chaque ligne de « Decks joués », lu en ligne à la date de début du
  tournoi par `useVersionLegality`. « Légal le 24 octobre », « Illégal le
  24 octobre · bibliothèque 58/60 » (premier motif, par `illegalReason` de
  l'aperçu des decks) avec tous les motifs en infobulle, « Légalité hors
  ligne » (1b-58), « Légalité… », « Légalité indisponible ». L'année s'ajoute
  hors de l'année en cours. Classes `legality-tag` de l'aperçu bureau.
  Modèle pur dans `tournamentDecksModel.ts` (`versionLegalityTag`,
  `legalityDayLabel`).
- **Surcouche** : `LocalTournamentDeckVersion` gagne `deckId`, l'identifiant
  serveur du deck, la clé pouvant être une `ref:` pour un deck créé hors
  ligne. Aucune version Dexie : le champ vient de la ligne déjà en miroir.
- **Écart au handoff** : au bureau, « Decks joués » reste la liste de D2 et
  non le tableau à quatre colonnes de d32 ; la pastille se place entre la
  ligne du deck et « Voir la liste ».
- **Tests** : `backend/tests/test_lot8_version_legality.py` (19 : liste figée
  et non vivante, une version par liste, bannissement et entrée en légalité
  jour inclus, jour UTC par défaut, deck supprimé, version vide, 404, 422) ;
  la route dans la matrice d'autorisation (401, 404 d'un autre compte) et dans
  les tests du contrat. Côté client, `tournamentDecksModel.test.ts` et deux
  cas dans `tests/unit/ui/bilan.test.tsx` (pastilles au bureau avec la date
  envoyée, aucune lecture hors ligne) ; le harnais UI sert la route.
- **Vérifications** : 2666 tests backend verts sous couverture (2 `xfail`
  connus), `ruff check` propre ; vitest sous couverture, 1144 tests verts
  sur 72 fichiers ; `npm run lint` et `tsc` propres ; CRAP sans régression
  des deux côtés ; aucun `data-testid` disparu. Playwright non relancé
  (étape E).

### Tests attendus (E)

- Back : gel (liste identique réutilisée, liste changée numérotée, deck
  supprimé figé depuis sa liste figée, changement d'impression ou de proxy sans
  nouvelle version, partie modifiée sans changer de deck qui garde sa version,
  drapeau qui refige et touche `updated_at`) ; règle du tournoi (deck modifié
  entre deux rondes qui garde la version de la première, ronde 2 saisie avant
  la ronde 1, multi-deck avec une version par deck, partie déplacée dans un
  tournoi, drapeau qui refige tout le tournoi pour ce deck et seulement lui) ;
  archétype fermé (422 hors des six, en ligne et par `/sync`) ; règles des
  champs adverses ; ligne sans joueur (P6) ; route des versions et légalité
  datée sous la matrice d'autorisation (401, 404 pour un autre compte) ;
  `/sync` avec une opération de partie d'avant le lot, rejeu sans regel ; R13
  aller-retour, conversion des archétypes, montée refusée sur un archétype non
  convertible, descente refusée.
- Client : `vtesDbV7` (montée depuis une base en version 6 peuplée),
  `seatPositions` sur sa table de cas (tables de 2 à 6, siège absent, position
  non saisie, siège d'en face à quatre et à six), `mainClan`, agrégats par
  axe, absence de tout pourcentage dans les sorties.
- e2e contre le vrai back, aux deux largeurs : une partie saisie hors ligne,
  le deck modifié ensuite hors ligne, puis le rejeu, la partie devant montrer
  l'ancienne liste ; le bilan filtré sur un deck, avec sa proie et son
  prédateur.
- Non-régression : références CRAP vides, aucun `data-testid` disparu sans
  justification (`testid-census.mjs`).

## Risques et points d'attention

- **Base IndexedDB du poste** : après F0, le compte reprend l'identifiant `1`
  et retrouve sa base IndexedDB d'avant, avec des miroirs qui visent une base
  disparue (procédure de F0, point 4).
- **Règle du tournoi et saisie en désordre** : la version d'un tournoi est
  celle de la première partie **figée**, pas forcément de la ronde 1. Sur deux
  appareils, c'est l'ordre d'arrivée au serveur qui décide. Le drapeau de regel
  corrige le tournoi entier d'un geste.
- **Deux appareils** : le gel suit l'ordre d'application sur le serveur, pas
  l'ordre de saisie entre appareils (P3). Le drapeau de regel est le remède.
- **Petits nombres** : avec deux parties en base, tout l'écran du bilan
  reposera au début sur des jeux d'essai. Les e2e doivent en semer assez pour
  que chaque axe ait plusieurs groupes.
- **Six archétypes seulement** : un deck à cheval (stealth-bleed avec du vote)
  se range sous un seul. C'est le prix d'un axe d'analyse qui ne se fragmente
  pas ; le nom de deck adverse, libre, garde la nuance pour mémoire.
- **`deck` recréée par R13** : table visée par quatre clés étrangères. Même
  forme que R9, qui l'a déjà fait sans perte.
- **Lectures du miroir** : l'analyse relit toutes les tables de parties, dont
  le premier chargement est déjà lent sur un long carnet (limite du Lot 7).
  À mesurer au-delà de quelques centaines de parties.
- **R13 recrée `participation`** : non exercée sur une vraie base au Lot 8,
  puisque celle de développement est écrasée. Les tests d'aller-retour sur
  base peuplée (A8) sont la seule garantie avant la mise en production du
  Lot 11.

## Critère de fin de lot

- P1 à P12 tranchées et reportées sous chaque proposition ; handoff versé dans
  `docs/design-handoff/` et écrans conformes en mobile et en bureau.
- `backend/vtes.db` reconstruite à neuf à la tête (F0, avant les écrans),
  compte recréé ou réclamé ; R13 éprouvée en aller-retour sur une base peuplée
  par les tests.
- Contrat à 51 opérations sur 31 chemins (P11 compris), archétype fermé dans
  les schémas de deck, client TS régénéré, section « Lot 8 » du contrat de sync
  écrite.
- `uv run pytest` vert hors les deux `xfail` connus, `ruff check` propre ;
  `npm run lint`, `npx tsc --noEmit -p tsconfig.app.json`, `npm run test` et
  la suite Playwright verts ; références CRAP vides.
- Vérification sur téléphone : une partie saisie en mode avion avec le deck de
  ma proie, le deck modifié ensuite, puis la synchronisation, la partie gardant
  sa liste et le bilan la comptant face à ce deck.
- CLAUDE.md mis à jour (§ 5 pour les archétypes et les positions à la table,
  § 6, 7, 11, 12) ; les pistes « figer la decklist jouée » et « légalité à la
  date d'un tournoi » retirées de `docs/pistes-evolution.md`.
