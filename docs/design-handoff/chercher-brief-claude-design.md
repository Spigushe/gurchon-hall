# Brief Claude Design : lot Chercher, recherche dans le catalogue

À transmettre à Claude Design avec le dossier `docs/design-handoff/` (tokens
`nocturne/`, prototypes `.dc.html` mobiles et bureau, captures `screenshots/`,
handoffs `MOBILE.md`, `DESKTOP.md` et `LOT7.md`). Étape D0 du plan
`docs/lot-chercher-plan.md`, décision P6 : un handoff court, limité à l'écran
Chercher. Les filtres, la fiche et la feuille d'ajout attendent ce handoff
avant d'être implémentés (étapes D1c et D2).

## Le produit, en deux phrases

Gurchon Hall est une PWA personnelle pour suivre sa pratique de *Vampire: The
Eternal Struggle* : collection de cartes, decks, parties et tournois. Elle
fonctionne hors ligne et se synchronise au retour du réseau.

## Ce qu'on attend

Le même genre de livrable qu'au Lot 7, en plus court :

- une section **mobile** (390 × 844, direction « 1b ») et une section
  **bureau** (1440 × 900, direction « 3a », au-delà de 1024 px), dans le
  design system Nocturne, sans nouveau token sauf nécessité ;
- un prototype `.dc.html` par disposition (`Gurchon Hall Chercher.dc.html`,
  `Gurchon Hall Chercher Bureau.dc.html`), et `TopBar.dc.html` mis à jour pour
  le champ global ;
- des captures dans la suite des existantes : `1b-26-…` et suivantes en
  mobile, `d17…` et suivantes en bureau ;
- un texte de handoff `CHERCHER.md` qui décrit chaque écran, ses états et sa
  copie française.

Contraintes reprises de l'existant : application uniquement sombre, police
Inter, icônes Phosphor, copie en français, composants en place réutilisés
autant que possible (`Sheet`, `Stepper`, `OptionalStepper`, `Switch`, `Pill`,
`LanguageChips`, `CardImage`, `Kbd`, le sélecteur segmenté « Parties |
Tournois » du Lot 7, les lignes de la Collection, le tableau du bureau, la
disposition maître/détail des Decks, le picker `AddDeckCardForm`).

## Ce qui existe déjà

Une première version de la page est en place (étape D1b) : onglet Chercher
actif dans la tab bar mobile, route `#/chercher`, un champ, une liste de
résultats (nom, catégorie, clan, capacité, exemplaires en collection), les
états « catalogue absent » et « aucun résultat ». Au bureau, la page ne
s'ouvre encore que par son adresse. C'est un squelette fonctionnel, pas un
dessin : tout y est à reprendre.

## Le moment d'usage

Deux situations, à soigner toutes les deux.

Sur le canapé, au téléphone : je construis un deck Banu Haqim et je cherche
les cartes de bibliothèque jouables avec Quietus et Obfuscate, sans dépasser
deux de sang. Je combine trois ou quatre filtres, je parcours une centaine de
résultats au pouce, j'ouvre une fiche, je l'ajoute au deck.

Au club, entre deux rondes, sans réseau : un adversaire vient de jouer une
carte que je ne connais pas. Je tape trois lettres de son nom, en français ou
en anglais, et je lis le texte. L'image, elle, demande le réseau.

## Navigation

- Mobile : l'onglet **Chercher**, déjà présent dans la tab bar, à droite de
  Parties.
- Bureau : **pas de sixième onglet**. Le champ de recherche global de la barre
  haute revient (masqué depuis le Lot 5c), libellé « Chercher une carte
  (catalogue) », 280 × 34 comme dans `DESKTOP.md`, avec le kbd `/`. Valider
  ouvre Chercher avec le texte saisi ; sur Chercher, il écrit dans le champ de
  la page. `/` le focalise depuis tout écran sauf le deckbuilder, où `/` reste
  au picker.
- Depuis le détail d'un deck non archivé, un lien « Chercher une carte pour ce
  deck » ouvre Chercher avec ce deck pour cible et le filtre de statut sur
  « pas dans ce deck ». Il faut une place pour ce lien, et une façon de
  rappeler sur Chercher le deck ciblé (et de l'enlever).

## Écrans

### 1. Résultats

En tête, le champ principal, qui cherche dans le nom (noms français et
espagnols compris) et dans le texte anglais des cartes, sans tenir compte des
accents ni de la casse. Puis des puces de catégorie « Toutes | Crypte |
Bibliothèque », un bouton « Filtres » avec le nombre de filtres actifs, le
compteur de résultats et le tri.

Une ligne de résultat, à dessiner pour les deux catégories :

- crypte : nom (avec groupe et *Adv* pour distinguer « Theo Bell (G2) » de
  « Theo Bell (G2, Adv) »), clan, secte, capacité, disciplines (inférieures en
  minuscules, supérieures en majuscules, ou icônes) ;
- bibliothèque : nom, type(s), coût en sang ou en pool, prérequis de clan ou
  de discipline ;
- dans les deux cas : « 3 en collection » s'il y a lieu, « dans ce deck » si
  un deck est ciblé, et une mention de légalité quand la carte est bannie ou
  pas encore légale (rien quand elle est légale).

La vignette d'image est une question ouverte : elle n'existe qu'en ligne
(4149 images, aucune n'est mise en cache). Dites si la ligne en porte une, et
ce qu'elle montre hors ligne.

Le tri par défaut est le nom. Quand le champ principal correspond à la fois
par le nom et par le texte, les cartes trouvées par leur nom passent devant :
« bleed » trouve quelques cartes par leur nom et des centaines par leur texte.
Le compteur peut distinguer les deux groupes (« 4 par le nom · 312 par le
texte »), et une séparation visuelle entre eux est bienvenue. Tris
secondaires : capacité et groupe pour la crypte, coût pour la bibliothèque ;
un tri choisi efface le regroupement.

Les résultats s'affichent par tranches (plusieurs centaines possibles, 4149
au plus) : dessinez la fin d'une tranche et ce qui charge la suivante.

Bureau : filtres en colonne à gauche, résultats au centre en tableau triable,
fiche à droite.

### 2. Filtres

C'est le morceau dense du brief. Les filtres reprennent le cœur de ceux de VDB
(vdb.im). Entre filtres différents, tout se combine en ET. Plusieurs filtres
ont un **bouton de mode** à deux, trois ou quatre valeurs (OU, ET, NON,
SEULEMENT) : il faut un motif unique, compact et lisible au pouce pour ce
bouton.

Communs :

| Filtre | Forme | Modes |
| --- | --- | --- |
| Texte | des lignes ajoutables ; chacune a un champ (nom et texte, nom seul, texte seul) et un mode | ET, NON |
| Extension | choix multiple dans 51 extensions | OU |
| Légalité | légale, bannie, pas encore légale, à la date du jour | |
| Possédée | possédée, non possédée, indifférent | |
| Deck | un deck à choisir, puis dans ce deck, pas dans ce deck, indifférent | |

Crypte :

| Filtre | Forme | Modes |
| --- | --- | --- |
| Disciplines | grille des disciplines à trois états par toucher : rien, inférieure, supérieure | ET entre disciplines |
| Paires « OU » | groupes d'exactement deux disciplines, chacune à son niveau | OU dans le groupe, ET entre groupes |
| Vertus | sept vertus des *imbued*, même grille | ET |
| Clan | choix multiple (clans, credos des *imbued*, quatre voies) | OU, ET, NON |
| Secte | Camarilla, Sabbat, Laibon, Independent, Anarch, Imbued | OU, NON |
| Groupe | 1 à 7, choix multiple | OU |
| Capacité | des lignes `≤`, `=` ou `≥` suivies d'une valeur de 1 à 11 | OU, NON |
| Titre | treize titres (Primogen, Prince, Justicar, Inner Circle, Baron, 1 vote, 2 votes, Bishop, Archbishop, Priscus, Cardinal, Regent, Magaji), plus « Non titré » | OU |
| Votes | indifférent, aucun, 1+, 2+, 3+, 4+ | |

Bibliothèque :

| Filtre | Forme | Modes |
| --- | --- | --- |
| Type | choix multiple (13 types, plus « Reflex ») | OU, ET, NON |
| Disciplines | lignes de disciplines, plus une valeur « non requise » | OU, ET, NON, SEULEMENT |
| Clan requis | choix multiple, plus « non requis » | OU, NON |
| Secte requise | les six sectes, plus « non requise » | OU, NON |
| Titre requis | n'importe quel titre, non titré, ou un titre précis | OU, NON |
| Coût en sang | une ligne `≤`, `=`, `≥` et une valeur de 0 à 4 | |
| Coût en pool | une ligne `≤`, `=`, `≥` et une valeur de 0 à 6 | |

Le mode SEULEMENT des disciplines de bibliothèque se lit « jouable avec les
seules disciplines cochées » : c'est la question de qui construit une
bibliothèque pour sa crypte. Il mérite une phrase d'aide sous le bouton.
Trois autres phrases d'aide sont à placer : la capacité range la vie des
*imbued* ; la légalité se lit à la date du jour (UTC) ; un mot court cherché
dans le texte trouve aussi les icônes de discipline (« pre » trouve toutes les
cartes à icône Presence).

Mobile : une feuille de filtres, ouverte par le bouton « Filtres ». Elle sera
longue. On attend une proposition d'organisation (sections repliables, onglets
Communs / Crypte / Bibliothèque, ou autre), la place de « Réinitialiser » et
de « Voir N résultats », et un rappel des filtres actifs sur l'écran des
résultats (puces qu'on retire d'un toucher, par exemple). Les filtres de crypte
et de bibliothèque n'ont de sens qu'avec la catégorie correspondante : dites
ce qu'ils deviennent sous « Toutes ».

Bureau : la même chose en colonne à gauche, toujours visible. `F` focalise la
colonne.

### 3. Fiche de carte

Mobile : une feuille ouverte d'un toucher sur une ligne. Bureau : la colonne de
droite. Contenu, dans un ordre à proposer :

- l'image, en ligne seulement, avec un repli hors ligne ou en l'absence
  d'image (676 impressions n'en ont pas) ;
- le nom, et pour la crypte groupe, capacité, clan, secte, titre, disciplines ;
  pour la bibliothèque type, coût, prérequis de clan, de voie et de
  discipline, exigences de secte et de titre ;
- le texte de carte, qui contient des icônes de discipline (`[pot]`, `[POT]`)
  et parfois `[MERGED]` pour un *advanced* ;
- la légalité (bannie le…, légale à partir du…) ;
- les impressions : extensions où la carte a été imprimée ;
- mes exemplaires par langue et extension, et les decks qui la jouent ;
- l'action « Ajouter… », qui ouvre la feuille d'ajout.

Le texte d'ambiance et l'artiste sont disponibles si la fiche a de la place.

### 4. Feuille d'ajout

Un contrôle segmenté à trois choix exclusifs : **Deck**, **Collection**,
**Les deux**. Rien n'attend le réseau : l'ajout part dans la file et se
synchronise plus tard, comme partout dans l'application.

| Choix | Champs | Effet |
| --- | --- | --- |
| Deck | deck (présélectionné s'il est ciblé ; un deck archivé n'est pas proposé), langue, extension, copies, dont possédées | comme le picker du deckbuilder : les possédées sont prises au stock disponible, le reste est en proxy si le deck l'autorise |
| Collection | langue, extension, quantité | s'ajoute aux exemplaires déjà possédés |
| Les deux | deck, langue, extension, quantité | un achat déclaré : les exemplaires entrent en collection et dans le deck ; si le deck joue déjà la carte en proxy, ils remplacent d'abord des proxies |

Pour « Les deux », l'écran dit avant l'envoi ce qui va se passer
(« 2 exemplaires remplacent 2 proxies »). Il faut aussi la confirmation après
l'ajout, sans fermer Chercher, et un message d'erreur local (proxy non
autorisé par le deck, quantité impossible). Bureau : `N` ouvre la feuille.

Sur téléphone, le clavier ouvert couvre la moitié de l'écran : où se trouve
« Ajouter » quand on saisit une quantité ?

### 5. Image du picker mobile

Le picker du deckbuilder mobile (`1b-05-ajouter-picker.png`) gagne l'image de
la carte choisie, en ligne seulement. Quelle taille, et où ? Au bureau, le
picker a déjà son image (112 × 156) et l'aperçu au survol de la Collection
existe (180 × 251).

## États à dessiner

- catalogue absent (premier lancement hors ligne) : champ désactivé, le
  panneau du catalogue existant (`CatalogPanel`) ;
- catalogue à mettre à jour : les noms sont là mais pas encore les textes et
  les détails ; le champ ne cherche alors que dans le nom, et l'écran doit le
  dire. Une mise à jour se lance d'elle-même une fois en ligne ; sinon un
  bouton ;
- chargement, aucun résultat (avec un moyen de retirer les filtres), hors
  ligne (bandeau ou pastille existants, image indisponible dans la fiche) ;
- deck ciblé introuvable : le lien est ignoré sans message, pas besoin de
  dessin.

## Raccourcis bureau

`/` focalise le champ, `F` la colonne de filtres, `↑` `↓` parcourent les
résultats, `↵` ouvre la fiche, `N` ouvre la feuille d'ajout. Les touches `A`,
`C`, `D`, `P` et `S` sont prises par la navigation et ne servent pas ici.

## Hors du brief

Statistiques de deck, suggestion de decklists, inventaires multiples et
classeurs (lot Inventaires), import depuis VDB, recherche dans les textes
traduits, expressions régulières, filtres de VDB laissés de côté (traits,
artiste, précon, options d'extension « or newer »), légende des raccourcis
`?`, mode clair.
