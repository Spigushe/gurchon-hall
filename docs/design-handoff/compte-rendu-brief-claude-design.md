# Brief Claude Design — compte-rendu de tournoi, mise en page imprimée

À transmettre à Claude Design avec le dossier `docs/design-handoff/` : les
tokens `nocturne/`, les prototypes existants et les captures de
`screenshots/`, utiles pour le vocabulaire de l'application même si ce brief
ne porte pas sur l'écran. D'après la décision P12 du plan
`docs/lot-compte-rendu-plan.md`, le handoff demandé ici couvre **seulement
l'impression** du compte-rendu ; les écrans se font avec les composants en
place.

## Le produit, en deux phrases

Gurchon Hall est une PWA personnelle pour suivre sa pratique de *Vampire: The
Eternal Struggle* : collection, decks, parties et tournois. Elle marche hors
ligne, au club, et se synchronise au retour du réseau.

## Ce qu'on fabrique

Le compte-rendu d'un tournoi : un récit généré par l'application à partir de
ce qu'elle sait déjà (le tournoi, mes rondes, les tables, mes scores, mes
notes, les listes que j'ai jouées), dans une trame fixe. L'utilisateur
n'écrit que ses notes ; titres, ordre et mise en forme viennent de la trame.
Il le partage par un lien public, et il en fait un PDF **en imprimant la
page** (« Enregistrer au format PDF » du navigateur). Pas de PDF fabriqué par
le serveur.

On attend de vous la mise en page de cette impression : comment ces
informations structurées se disposent sur une feuille A4 blanche, pour être
lues sur papier ou en PDF, envoyées à un organisateur ou gardées. Ce n'est pas
une copie de l'écran : l'application est uniquement sombre, la page imprimée
est blanche et doit avoir sa propre hiérarchie.

## Ce qu'on attend

- un prototype `Gurchon Hall Compte-rendu Impression.dc.html` qui montre les
  pages A4 telles qu'elles sortiraient de l'imprimante, sur les deux exemples
  ci-dessous (mono-deck et multi-deck) ;
- la feuille de styles d'impression, ou à défaut des spécifications assez
  précises pour l'écrire : tailles, graisses, interlignes, marges `@page`,
  filets, règles de saut de page (`break-inside`, `break-before`) ;
- un texte de handoff, `COMPTE-RENDU.md`, sur le modèle de `LOT8.md` : chaque
  bloc, ses variantes, ce qui se passe quand une donnée manque, et la copie
  en français.

Pas de nouvelle maquette d'écran, pas de version mobile : le PDF sort au même
format A4 depuis le téléphone (Chrome sur Android) et depuis l'ordinateur
(Chrome sur Windows), les deux navigateurs de l'usage réel.

## Contraintes

- **Papier blanc, encre noire.** L'impression doit rester lisible en noir et
  blanc ; une couleur d'accent, s'il y en a une, ne porte jamais seule une
  information.
- **A4 portrait**, marges à proposer. Numéro de page et pied de page à
  proposer, en sachant que les en-têtes et pieds du navigateur (adresse, date)
  peuvent être coupés par l'utilisateur, pas par nous : le pied de la trame
  doit donc porter lui-même ce qui compte (tournoi, version, date de la
  version).
- **Police Inter**, déjà embarquée.
- **Icônes de krcg** : les clans et les disciplines ont des glyphes (polices
  `vtes-clans.otf` et `ankha2.otf`, voir `DeckTables.dc.html`). Elles
  s'impriment, en noir. Dites où elles aident et où le nom en toutes lettres
  vaut mieux ; un glyphe inconnu doit laisser le nom en texte, jamais une
  lettre brute.
- **Sauts de page maîtrisés** : une ronde ne se coupe pas entre deux pages
  si elle tient sur une ; l'en-tête d'une liste jouée ne reste pas seul en bas
  de page ; une note longue, elle, peut se couper.
- **Les notes sont du texte brut**, sauts de ligne gardés, sans gras ni
  liste : la trame les met en page, elle ne les interprète pas. Elles vont de
  vide à plusieurs paragraphes.
- **Jamais de pourcentage**, nulle part : « 2 GW sur 3 rondes », pas « 67 % ».
- Pas de photo ni d'image de carte.

## Vocabulaire et règles à connaître

- **VP** (*victory points*) : multiples de 0,5. **GW** (*game win*) : gagné
  par le joueur qui a au moins 2 VP et strictement plus que chacun des
  autres. Une table compte de 2 à 6 joueurs, 4 ou 5 en tournoi.
- **Rondes préliminaires**, puis une **finale** à cinq, facultative sous 8
  joueurs. Mon **classement** final est saisi à la main.
- **Mono-deck** : le même deck sur toutes mes parties. **Multi-deck** : un
  deck par ronde, donc plusieurs listes dans le compte-rendu.
- **Positions à la table** : on joue dans l'ordre des sièges ; ma **proie**
  est le siège suivant, mon **prédateur** le siège précédent. Ce sont les
  positions de départ.
- **Adversaire** : un nom du carnet, ou « Joueur non nommé ». Son deck tient
  en trois champs facultatifs : clan principal, archétype (Bleed, Vote, Wall,
  Toolbox, Rush, Combo) et un nom libre.
- **Seuls mes scores existent** : l'outil ne connaît ni les VP des autres, ni
  leurs points de tournoi, ni la place de chacun à la table. N'en dessinez
  pas la colonne.
- **Version du compte-rendu** : chaque « Mettre à jour le compte-rendu » fige
  une version numérotée (v1, v2…), datée. L'impression montre une version.
- **Version d'une liste** : la liste jouée d'un deck est elle aussi figée en
  versions (v1, v2…), une par deck et par tournoi.
- **Notes sur les adversaires** : elles ne figurent que si l'utilisateur les a
  incluses dans les options du compte-rendu. Prévoir leur place sans en faire
  un bloc vide quand elles manquent.

## Le contenu, dans l'ordre

1. **En-tête** : nom du tournoi ; nom du ou des decks joués, avec leur
   archétype ; dates (un jour, ou du … au …) ; lieu et ville ; niveau
   (standard, championnat national, Grand Prix, championnat continental) ;
   format (construit ou draft) ; mono ou multi-deck ; nombre de joueurs et de
   rondes ; auteur (`@nom`).
2. **Résultat** : mon classement (« 3e sur 22 »), le bilan des préliminaires
   (GW, VP, rondes jouées), la finale si je l'ai jouée (VP, GW).
3. **Notes du tournoi** : introduction ou conclusion, au choix de l'auteur.
4. **Une section par ronde, puis la finale** : numéro de ronde, deck joué en
   multi-deck, la table dans l'ordre des sièges (pour chaque siège : joueur ou
   « Joueur non nommé », deck adverse ; pour moi : « Moi », ma proie et mon
   prédateur), mes VP et mon GW, puis les notes de la partie, et sous chaque
   adversaire ses notes si elles sont incluses.
5. **Listes jouées** : une par deck, avec son numéro de version ; crypte
   (quantité, capacité, nom, disciplines, clan, groupe), puis bibliothèque
   groupée par type (Master, Action, Equipment, Reaction, Combat…), totaux
   de crypte et de bibliothèque. Ni langue, ni extension, ni proxy.
6. **Pied** : « Compte-rendu de <tournoi> · version 2 du 24 novembre 2026 ·
   gurchon.spigushe.com ».

Une ronde sans table ni notes s'affiche quand même, réduite à son numéro et à
mon score s'il existe. Un tournoi sans lieu, sans nombre de joueurs ou sans
classement omet la mention, sans tiret ni « inconnu ».

## Exemple 1 : mono-deck

- Tournoi : **Coupe de Lutèce**, samedi 14 novembre 2026, au Dé Pipé, Paris ;
  standard, construit, mono-deck ; 22 joueurs, 3 rondes et une finale.
  Auteur `@spigushe`.
- Deck : **Guns and shit (mostly guns)**, Rush, liste v2.
- Résultat : 3e sur 22. Préliminaires : 2 GW, 6,5 VP en 3 rondes. Finale :
  1 VP, pas de GW.
- Notes du tournoi : deux paragraphes (« Premier tournoi avec la version aux
  Villein… », « Bilan : la crypte tient, mais il manque une deuxième Line
  Brawl… »).
- Ronde 1, table à 5 : siège 1 Marc (Ventrue, Vote, « Princes de Paris »),
  siège 2 Moi, siège 3 Léa (Tremere, Toolbox), siège 4 Joueur non nommé
  (Nosferatu, Bleed), siège 5 Hugo (Malkavian, Bleed, « Dementation
  bleed »). Ma proie : Léa ; mon prédateur : Marc. 3 VP, GW. Notes : un
  paragraphe court.
- Ronde 2, table à 4 : 2,5 VP, GW, une longue note (cinq paragraphes) qui
  doit pouvoir passer d'une page à l'autre ; une note sur un adversaire
  incluse (« Joue très vite, attention aux bleeds à 4 »).
- Ronde 3, table à 5 : 1 VP, pas de GW, pas de notes.
- Finale, table à 5 : 1 VP, pas de GW, notes courtes.
- Liste jouée v2 : celle de `frontend/tests/fixtures/vdb/ref-text.txt`
  (crypte de 12 Brujah de groupes 5 et 6, bibliothèque de 80 cartes en cinq
  types), recopiée ci-dessous.

```text
Crypt (12)
2x Saku Pihlajamäki     8 CEL POT PRE for pro   baron   Brujah:6
2x Aline Gädeke         7 POT PRE cel           baron   Brujah:6
2x Valeriya Zinovieva   7 POT cel pre pro       baron   Brujah:6
2x Atiena               6 CEL obf pot pre       baron   Brujah:6
2x Leumeah              6 PRE cel for pot       baron   Brujah:6
1x Anita Wainwright     3 cel pre                       Brujah:6
1x Laura Goldman        3 cel pre                       Brujah:5

Library (80)
Master (18; 7 trifle)
1x Anarch Free Press, The   1x Carfax Abbey          1x Club Illusion
1x Direct Intervention      1x Dreams of the Sphinx  1x Fame
1x Garibaldi-Meucci Museum  1x New Carthage          1x Papillon
1x Powerbase: Los Angeles   1x Powerbase: Montreal   7x Villein
Action (6)       5x Line Brawl, 1x Open War
Equipment (8)    7x .44 Magnum, 1x Heart of Nizchetus
Reaction (21)    7x Bait and Switch, 14x Organized Resistance
Combat (27)      4x Bollix, 6x Concealed Weapon, 10x Diversion,
                 4x Hell-for-Leather, 3x Taste of Vitae
```

## Exemple 2 : multi-deck

- Tournoi : **Nuit des Anarchs**, du 5 au 6 décembre 2026, à Lyon, sans
  lieu précis ; standard, construit, multi-deck, règle de finale « meilleur
  deck » ; nombre de joueurs non saisi ; pas de finale jouée, pas de
  classement.
- Deux decks : **Guns and shit (mostly guns)** v2 aux rondes 1 et 3,
  **Brujah Trophy Hunter** v1 à la ronde 2 (liste de
  `frontend/tests/fixtures/vdb/difficile-text.txt`, crypte de 13 cartes dont
  un vampire en version *advanced*, bibliothèque de 90 cartes).
- Une ronde sans table saisie (seulement mon score), une table où mon siège
  n'est pas saisi (pas de proie ni de prédateur à montrer).

## À proposer

- La place des listes jouées : à la fin, chacune sur une nouvelle page, ou à
  la suite.
- Le traitement des positions (proie, prédateur) : mention dans la table, ou
  marque sur les sièges.
- Une forme compacte pour la bibliothèque (deux ou trois colonnes, comme un
  export de tournoi) si elle reste lisible.
- L'impression d'un **aperçu non synchronisé** (une version pas encore figée
  par le serveur, saisie hors ligne) : marquée « Aperçu, non synchronisé » en
  tête de chaque page, ou impossible. Notre préférence va au marquage.
- L'impression d'une **version antérieure** : la même page, avec une mention
  « Version 1 sur 3 » qui ne trompe pas le lecteur.
