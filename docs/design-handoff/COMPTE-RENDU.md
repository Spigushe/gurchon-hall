# Handoff Compte-rendu de tournoi — impression A4

Complète le brief [`compte-rendu-brief-claude-design.md`](compte-rendu-brief-claude-design.md),
qui fait foi pour les règles du jeu et des données ; ce document fixe la forme et la copie de
la **page imprimée** du compte-rendu (lot Compte-rendu de tournoi, v1.3). D'après la décision
P12 citée par le brief, le PDF sort de l'impression du navigateur (« Enregistrer au format
PDF » de Chrome Android et Chrome Windows) : aucun PDF n'est fabriqué par le serveur, ce qui
remplace le point 2 de la décision V7 (`docs/roadmap-v2-proposition.md`). Les écrans du
compte-rendu se font avec les composants en place et ne sont pas couverts ici.

> Le plan `docs/lot-compte-rendu-plan.md`, où le brief situe P12, n'est pas encore dans le
> dépôt (vérifié sur `48cd1a4`).

Fichiers :

- `Gurchon Hall Compte-rendu Impression.dc.html` : les huit pages A4 des deux exemples du brief
  (mono-deck, 4 pages ; multi-deck imprimé en aperçu non synchronisé, 4 pages), sur un fond
  gris d'écran.
- `compte-rendu-print.css` : feuille d'impression complète (`@page`, pied, sauts, tailles,
  filets, glyphes en noir).
- `frontend/src/assets/icons/master.svg` : l'icône du type Master (voir « Glyphe Master »).

Variante retenue : **trame A « Fiche »**, dense, proche d'un export de tournoi. La trame B
« Chronique » (corps 12 pt, accent bordeaux, listes à la suite) a été écartée.

## Règles communes

- **Papier blanc, encre noire.** Texte `#111111`, secondaire `#333333`, étiquettes `#444444`,
  rien de plus clair. Aucune couleur d'accent. Une seule teinte de fond, le gris `#ececec` de
  ma ligne dans une table, qui double le gras et ne porte jamais seul l'information.
- **Police Inter**, chiffres tabulaires partout (`font-variant-numeric: tabular-nums`).
- **Filets** : 3 px sous un résultat et un titre de liste, 2 px en tête de ronde, 1 px `#111111`
  sous les en-têtes de tableau, 1 px `#9a9a9a` entre les lignes. Rien sous 1 px.
- **Jamais de pourcentage.** « 2 GW · 6,5 VP » « en 3 rondes ».
- **Jamais de score des autres** : ni leurs VP, ni leurs points, ni leur place. Pas de colonne
  pour eux.
- **« pas de GW » ne s'écrit nulle part** : une ronde sans GW montre seulement ses VP
  (« 1 VP »), une ronde avec GW « 3 VP · GW ».
- **Une donnée absente disparaît** avec son étiquette : ni tiret, ni « inconnu », ni case vide.
  Seule exception, le siège « – » de « Moi » quand mon siège n'est pas saisi (voir Rondes).
- **Nombres** : virgule décimale (« 6,5 VP », « 0,5 VP ») ; ordinal « 1er », « 2e », « 3e ».
- **Dates** : un jour, « Samedi 14 novembre 2026 » ; deux jours du même mois, « Du 5 au
  6 décembre 2026 » ; de mois différents, « Du 30 novembre au 1er décembre 2026 » ; d'années
  différentes, « Du 31 décembre 2026 au 1er janvier 2027 ». Le 1er du mois s'écrit « 1er ».

## Page

- **A4 portrait**, marges `@page` 14 mm en haut, 15 mm sur les côtés, 18 mm en bas.
  Zone utile ≈ 680 px de large.
- **Pied, dans la marge basse, sur chaque page** : filet 1 px sur toute la largeur, puis à
  gauche « Compte-rendu de Coupe de Lutèce · version 2 du 24 novembre 2026 ·
  gurchon.spigushe.com », à droite « Page 1 / 4 ». 12 px `#333333`. Il porte tout ce qui
  compte, puisque l'utilisateur peut couper les en-têtes et pieds du navigateur.
- **Bandeau d'état, dans la marge haute, sur chaque page**, seulement pour un aperçu ou une
  version antérieure (voir « États »). Cadre 2 px, 12 px. Marge haute portée à 24 mm. Le
  prototype le dessine en tête de la zone de texte ; en production, c'est une boîte de marge.
- Le texte du pied et du bandeau varie : le composant écrit sa propre règle `@page` (mode
  d'emploi en fin de `compte-rendu-print.css`).

## Blocs, dans l'ordre

### 1 · En-tête

- Sur-titre, étiquette 11 px capitales `.08em` `#444444` :
  **« V:TES · Compte-rendu de tournoi · Gurchon Hall »**.
- Nom du tournoi, 30 px, graisse 800, interligne 1,15.
- Une ligne par deck joué, 16 px graisse 500 :
  - mono-deck : « Guns and shit (mostly guns) — Rush » ;
  - multi-deck : « Guns and shit (mostly guns) — Rush · rondes 1 et 3 », « Brujah Trophy
    Hunter · ronde 2 ». Les rondes s'écrivent « ronde 2 », « rondes 1 et 3 », « rondes 1, 2
    et 3 », et « finale » s'ajoute après une virgule (« rondes 2 et 3, finale »).
  - sans archétype, le tiret et l'archétype disparaissent (« Brujah Trophy Hunter · ronde 2 »).
- Grille de faits, trois colonnes (gouttière 24 px, 12 px entre rangées), chaque fait =
  étiquette + valeur 14 px. Dans cet ordre, ceux qui existent :

  | Étiquette | Valeur | Absent si |
  | --- | --- | --- |
  | Date / Dates | « Samedi 14 novembre 2026 » ou « Du 5 au 6 décembre 2026 » | jamais |
  | Lieu | « Le Dé Pipé, Paris », ou la ville seule « Lyon » | ni lieu ni ville |
  | Niveau | Standard, Championnat national, Grand Prix, Championnat continental | non saisi |
  | Format | « Construit · mono-deck · 3R+F » | jamais |
  | Participation | « 22 joueuses et joueurs » | nombre non saisi |
  | Finale | « Au meilleur deck » (règle de finale) | mono-deck, ou règle non saisie |
  | Auteur | « @spigushe » | jamais |

  **Format** : « Construit » ou « Draft », puis « mono-deck » ou « multi-deck », puis la
  structure « 3R+F » (3 rondes suivies d'une finale) ou « 3R » (pas de finale au tournoi). Le
  nombre est celui des rondes préliminaires du tournoi.
- Filet 1 px sous l'en-tête, 18 px plus bas.

### 2 · Résultat

Filet 3 px au-dessus, 1 px en dessous ; trois colonnes. Chaque case : étiquette, valeur 22 px
graisse 700, sous-ligne 13 px `#333333` facultative.

| Case | Valeur | Sous-ligne | Absente si |
| --- | --- | --- | --- |
| Classement | « 3e sur 22 » (« 3e » sans nombre de joueurs) | « classement final » | pas de classement |
| Préliminaires | « 2 GW · 6,5 VP » (« 0 GW · 4 VP » se dit) | « en 3 rondes » (« en 1 ronde ») | aucune ronde jouée |
| Finale | « 1 VP », ou « 3 VP · GW » | aucune | finale non jouée |

Les cases présentes se tassent à gauche (exemple 2 : Préliminaires seule).

### 3 · Notes du tournoi

Étiquette « Notes du tournoi », puis le texte, 14 px, interligne 1,5, 640 px de mesure au
plus. **Texte brut** : un paragraphe par bloc séparé d'une ligne vide (8 px entre
paragraphes), un saut simple gardé (`white-space: pre-line`). Ni gras, ni liste, ni lien
interprété. Absent si vide : le bloc disparaît.

### 4 · Rondes, puis la finale

Une section par ronde dans l'ordre, puis la finale, 22 px au-dessus.

- **Ligne de tête**, filet 2 px au-dessus : « Ronde 1 » ou « Finale » (17 px, 800) ; à sa
  suite, 13 px `#333333`, le deck de la ronde en multi-deck puis la table, séparés par « · »
  (« Guns and shit (mostly guns) · Table à 5 ») ; à droite le score, 15 px graisse 700 :
  « 3 VP · GW », « 1 VP », « 0 VP ». Sans score saisi, rien à droite.
- **Table des sièges**, colonnes `Siège 44 px · Joueur 170 px · Deck · Position 110 px`,
  en-tête 10 px capitales, lignes de 24 px :
  - **Joueur** : le nom du carnet ou « Joueur non nommé ».
  - **Deck** adverse : glyphe de clan + clan · archétype · « nom libre » entre guillemets
    français (« [glyphe] Ventrue · Vote · « Princes de Paris » »). Champs absents omis, avec
    leur séparateur ; cellule vide si les trois manquent.
  - **Ma ligne** : « Moi » en gras, fond `#ececec`, et dans Deck le nom de mon deck.
  - **Position** : étiquette encadrée (1 px, rayon 3 px, 12 px graisse 600) « ma proie » sur
    le siège suivant le mien, « mon prédateur » sur le précédent, d'après les sièges de
    départ. À deux joueurs, le même siège porte « ma proie et mon prédateur ».
  - **Note sur un adversaire** (si l'utilisateur les a incluses) : une ligne sous la sienne,
    décalée sous la colonne Joueur, 13 px : étiquette 10 px « Note sur Thomas · » puis le
    texte. Pour un « Joueur non nommé » : « Note sur le siège 4 · ». Pas de note, pas de ligne.
- **Notes de la partie**, 10 px sous la table, mêmes règles que les notes du tournoi.

Variantes :

- **Sans table saisie** : la ligne de tête seule (« Ronde 2 », « Brujah Trophy Hunter », « 0,5
  VP »), sans « Table à n ».
- **Mon siège non saisi** : les adversaires à leur siège, puis une dernière ligne, fond
  `#ececec` : « – » · « Moi » · « Guns and shit (mostly guns) · siège non saisi ». Ni proie ni
  prédateur.
- **Sans notes** : rien sous la table.
- **Ronde ni table ni notes ni score** : « Ronde 3 » seul, avec son filet.

### 5 · Listes jouées

Chaque liste commence une nouvelle page, une par deck joué, dans l'ordre de première ronde.

- **Tête** : étiquette « Liste jouée » ; nom du deck 24 px 800 et, à côté, étiquette encadrée
  « liste v2 » (13 px 700) ; sous-ligne 13 px « Crypte 12 cartes · bibliothèque 80 cartes ·
  Rush » (archétype omis s'il manque). Filet 3 px dessous.
- **Crypte** : titre « Crypte » 15 px 800, à droite « 12 cartes · groupes 5 et 6 » (« groupe
  6 », « groupes 4, 5 et 6 »). Tableau `Qté · Cap. · Nom · Disciplines · Clan · Gr.`, 13 px,
  lignes de 22 px : « 2× », capacité en gras, nom, disciplines en glyphes (18 px, 5 px
  d'écart, ordre du serveur), glyphe de clan + nom du clan, groupe aligné à droite. Un vampire
  avancé porte l'étiquette « ADV » (10 px 700, encadrée) après son nom.
- **Bibliothèque** : titre « Bibliothèque », à droite « 80 cartes », filet 1 px. Trois
  colonnes (gouttière 26 px). Groupes dans l'ordre et le regroupement de `DeckTables`,
  ceux de VDB pour toutes les decklists depuis le 2026-11-23 (`cardtypeSortedFull.json`, lu
  par `features/decks/libraryTypeOrder.ts` : Master, Conviction, Power, Action, Political
  Action, Ally, Equipment, Retainer, Action Modifier, Reaction, Combat, Event, chaque
  combinaison à sa place dans la liste) ; tête de groupe : icône de type 16 px, nom 13 px 700, total à droite,
  filet 1 px ; puis une carte par ligne, « 7 Villein » (quantité sur 26 px, sans « × »).
- Ni langue, ni extension, ni proxy, ni « trifle ». Pas de légende des disciplines.

## Glyphes krcg

- **Où** : clan des adversaires (table des sièges), disciplines et clan de la crypte, type de
  carte en tête de groupe. Le clan s'écrit toujours aussi en toutes lettres à côté de son
  glyphe ; les disciplines sont en glyphes seuls (la forme distingue inférieure et
  supérieure).
- **Encre** : noire, sans le filet clair de l'écran (`text-shadow` et `filter` retirés en
  impression) ; le dessin sombre sur clair d'ankha2 se lit tel quel sur papier blanc.
- **Glyphe inconnu** : le nom (clan) ou le code (discipline, « dom ») en texte, jamais une
  lettre brute de la police. Les fonctions `clanGlyph`, `disciplineGlyph` et `typeGlyph`
  renvoient déjà `null` dans ce cas.

### Glyphe Master

`ankha2.otf` n'a pas d'icône Master (relu le 2026-11-23 : 106 glyphes, tous encodés, aucun
caché ni produit par ligature, aucun dessin Master). L'icône vient de VDB
(`smeea/vdb`, `frontend/public/images/types/master.svg`, licence MIT) :
`frontend/src/assets/icons/master.svg`. Trois tracés : un carré noir percé d'un disque, un
« M » noir, et le disque blanc au « M » en creux ; donc sombre sur clair, comme ankha2.

Elle vaut pour **tout le projet**, pas seulement l'impression : `typeGlyph("Master")` renvoie
`MASTER_GLYPH` (`font: "image"`), que `GlyphIcon` rend en `<img>` de 1 em dans
`.glyph--image`, avec le même filet clair que les glyphes d'ankha à l'écran. Elle paraît donc
partout où un type a son icône : titres de groupe de `DeckTables`, résultats et fiche de
Chercher, filtres par type.

## Sauts de page

- **Une ronde ne se coupe pas** si elle tient sur une page (`break-inside: avoid`) : elle passe
  entière à la page suivante, quitte à laisser du blanc (exemple 2 : la ronde 3 ouvre la
  page 2).
- **Plus haute qu'une page**, elle se coupe dans ses notes, jamais entre sa ligne de tête et
  sa table (`.cr-round__top` insécable, `break-after: avoid`).
- **Notes** : coupables entre deux lignes, au moins 3 lignes de chaque côté (`orphans`,
  `widows`).
- **Listes** : `break-before: page` ; la tête reste avec la crypte ; la crypte et chaque groupe
  de bibliothèque ne se coupent pas.
- En-tête et Résultat ne se coupent pas.

## États

- **Version figée** (cas normal) : pied « … · version 2 du 24 novembre 2026 · … ».
- **Aperçu non synchronisé** (version saisie hors ligne, pas encore figée par le serveur) :
  imprimable, marqué. Bandeau sur chaque page : « **APERÇU, NON SYNCHRONISÉ** · Cette version
  n'est pas encore enregistrée sur le serveur ; elle peut encore changer. » Pied :
  « Compte-rendu de Nuit des Anarchs · aperçu non synchronisé du 6 décembre 2026 ·
  gurchon.spigushe.com ». Sans numéro de version.
- **Version antérieure** : bandeau sur chaque page : « **VERSION 1 SUR 3** · Une version plus
  récente existe : la version 3 du 9 décembre 2026. » Pied : « Compte-rendu de Nuit des
  Anarchs · version 1 du 7 décembre 2026 · gurchon.spigushe.com ».

## Copie

| Clé | Texte |
| --- | --- |
| Sur-titre | V:TES · Compte-rendu de tournoi · Gurchon Hall |
| Faits | Date, Dates, Lieu, Niveau, Format, Participation, Finale, Auteur |
| Participation | {n} joueuses et joueurs |
| Format | Construit / Draft · mono-deck / multi-deck · {n}R+F / {n}R |
| Finale (règle) | Au meilleur deck |
| Résultat | Classement, Préliminaires, Finale ; « {r} sur {n} » ; « classement final » ; « {g} GW · {v} VP » ; « en {n} rondes » |
| Notes | Notes du tournoi |
| Ronde | Ronde {n}, Finale, Table à {n}, {v} VP, {v} VP · GW |
| Table | Siège, Joueur, Deck, Position ; Moi ; Joueur non nommé ; ma proie ; mon prédateur ; ma proie et mon prédateur ; siège non saisi ; Note sur {nom} · ; Note sur le siège {n} · |
| Liste | Liste jouée ; liste v{n} ; Crypte {n} cartes · bibliothèque {n} cartes ; Crypte ; Bibliothèque ; {n} cartes ; groupe(s) … ; Qté, Cap., Nom, Disciplines, Clan, Gr. ; ADV |
| Pied | Compte-rendu de {tournoi} · version {n} du {date} · gurchon.spigushe.com ; Page {n} / {N} |
| Aperçu | APERÇU, NON SYNCHRONISÉ · Cette version n'est pas encore enregistrée sur le serveur ; elle peut encore changer. ; aperçu non synchronisé du {date} |
| Antérieure | VERSION {n} SUR {N} · Une version plus récente existe : la version {N} du {date}. |

## Données de démonstration

Celles du brief pour les deux tournois, les decks et les listes (`ref-text.txt`,
`difficile-text.txt`). Inventés pour l'illustration : le texte des notes au-delà des débuts
donnés par le brief, les tables des rondes 2, 3 et de la finale de l'exemple 1, les tables et
scores de l'exemple 2 (1 GW, 4,5 VP), et les dates de version de l'exemple 2.

## Points à vérifier à l'implémentation

- Les boîtes de marge `@page` (pied, numéro « Page n / N », bandeau) : à confirmer sur Chrome
  Android et Chrome Windows. Si elles manquent, le pied ne se répète pas.
- Je ne sais pas si Chrome masque ses propres en-têtes et pieds quand la page définit des
  boîtes de marge ; l'utilisateur garde de toute façon la main dessus.
- `break-after: avoid` sur la tête de ronde et de liste : à vérifier dans le moteur
  d'impression de Chrome.
- La largeur du bandeau dans `@top-left` quand les autres boîtes du haut sont vides.
- Le fond gris de ma ligne exige `print-color-adjust: exact` (posé) ; le gras suffit s'il
  saute.

## Repo

| Élément | Fichiers |
| --- | --- |
| Page imprimée | bloc `.cr-print` rendu par la page `#/tournois/<clé>/compte-rendu` (et sa page publique), frère de l'écran `.cr-screen` |
| Styles | `compte-rendu-print.css`, à importer après `index.css` |
| Pied et bandeau | règle `@page` écrite par le composant, chaîne échappée |
| Glyphes | `GlyphIcon`, `DisciplineGlyph`, `ClanGlyph`, `TypeGlyph` (`components/glyphs/`) |
| Glyphe Master | `assets/icons/master.svg`, `MASTER_GLYPH` dans `glyphs.ts`, `.glyph--image` dans `index.css` |
