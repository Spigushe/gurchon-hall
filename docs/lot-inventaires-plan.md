# Lot Inventaires : plusieurs inventaires, et les decks qu'on peut monter avec

Plan d'implémentation proposé le 2026-11-03 et revu le même jour après une
précision de l'utilisateur, **avant toute décision et avant tout code**. Il
répond aux deux issues ouvertes du dépôt :

| Issue | Titre | Corps |
| --- | --- | --- |
| #48 | Multiples inventaires | « Et binders » |
| #49 | utiliser un inventaire spécifique pour builder un deck | (vide) |

Les deux issues tiennent en un titre. Ce document en tire une lecture, la
justifie, et range ce qui relève encore d'une interprétation dans les
propositions P1 à P9, à trancher par l'utilisateur à l'ouverture du lot. Les
décisions A1 à A11 sont des propositions de conception pour
l'architecte-contrat, qui les reprendra dans son brief. Le reste (découpage,
risques, critère de fin) suit la forme de `docs/lot4-plan-inventaire.md` et
`docs/lot7-plan-parties.md`.

Le nom « Lot Inventaires » est provisoire et ne décale pas la numérotation des
Lots 8 à 11, à la manière du lot Chercher (CLAUDE.md §12).

## Finalité, précisée par l'utilisateur (2026-11-03)

> L'idée de prendre un inventaire ou un binder serait de permettre à l'outil de
> suggérer des decklists viables.

Un inventaire n'est donc pas une fin en soi, ni un simple rangement. C'est le
**périmètre** à partir duquel l'outil répond à la question « quels decks
puis-je monter avec ces cartes-là ? » : avec ce classeur, avec ce que la
collection a encore de libre, avec la boîte que j'emporte au club. L'issue #49,
construire un deck depuis un inventaire précis, est le geste qui suit la
suggestion.

Deux conséquences, décidées par l'utilisateur le même jour :

- **le lot est reporté après le Lot 9** (P0 ci-dessous), puis, le 2026-11-13,
  **après la première mise en ligne** (révision de P0) ;
- **il profite de l'import VDB** : VDB sait exporter une collection, et un
  inventaire tenu dans VDB doit pouvoir entrer tel quel dans l'outil.

## Lecture des deux issues

Aujourd'hui, un compte a **une seule** collection : une entrée de stock est
identifiée par carte × langue × extension (Lot 4), et un deck consomme ses
exemplaires réels dans cette collection unique (`services/stock.py`,
`allocated_real`). Rien ne permet de séparer deux ensembles physiques, ni de
demander ce qu'un ensemble permet de jouer.

L'issue #48 demande plusieurs inventaires par compte. « Et binders » nomme le
cas concret : un classeur (binder) est un ensemble de cartes rangées ensemble,
à côté d'une boîte ou de la collection principale. La lecture retenue fait du
classeur un inventaire comme un autre, avec un genre qui le distingue à
l'affichage (P1, P2).

L'issue #49 en est la suite : construire un deck à partir d'un inventaire
précis. Un deck monté avec les cartes du classeur « Échanges » ne compte que ce
qui est disponible dans ce classeur, et laisse intacte la comptabilité de la
collection principale (P3).

## Portée

Le lot fait six choses :

1. une ressource **inventaire** privée à chaque compte, avec un inventaire
   principal qui existe toujours (sur le patron du « Moi » du Lot 7) ;
2. l'inventaire **entre dans l'identité d'une entrée de stock**, qui devient
   inventaire × carte × langue × extension, de la base jusqu'au miroir Dexie ;
3. un deck **puise dans un inventaire**, et la comptabilité du stock se lit par
   inventaire ;
4. un **transfert** d'exemplaires d'un inventaire à l'autre, hors ligne comme
   en ligne ;
5. l'**import d'un inventaire** depuis l'export de collection de VDB, en
   réutilisant l'appariement des cartes écrit au Lot 9 ;
6. des **suggestions de decklists** viables pour un inventaire, et la
   construction d'un deck depuis une suggestion.

Ce que le lot ne fait pas : pas d'inventaire partagé entre comptes (P5), pas
d'emplacement fin dans un classeur (page, pochette), pas de liste de souhaits.
Pas de génération de deck par l'outil non plus : il suggère des listes qui
existent (P8), il n'en invente pas. La légalité d'un deck ne change pas : elle
porte sur la composition et le catalogue, jamais sur la provenance des
exemplaires.

### État de départ (à relever de nouveau à l'ouverture)

D'après l'en-tête de CLAUDE.md au 2026-11-02, `backend/vtes.db` est à la
révision `e2a7819dd4a2` (R11) et contient la vraie collection de
l'utilisateur : 28 entrées de stock, le deck « Banu Princes » et ses 20 lignes,
toutes au compte `1`, plus 66 opérations au journal. Le lot venant après les
Lots 8 et 9, ces chiffres auront bougé, et la base aura gagné les révisions de
ces lots. C'est au moins la troisième fois, après R9 et R10, qu'une migration
devra **convertir** des données réelles.

## Propositions

### P0. Place dans la feuille de route (tranché le 2026-11-03)

**Après le Lot 9, avant le Lot 10.** L'ordre devient : Lot 7, Chercher, Lot 8,
Lot 9, Inventaires, Lot 10, Lot 11.

La finalité le justifie. Suggérer des decklists demande des decklists à
comparer, et le Lot 9 est le lot qui fait entrer des decks venus d'ailleurs. Il
écrit aussi l'appariement d'une carte externe avec le catalogue, que l'import
d'un inventaire VDB réutilisera. Le Lot 10 (portage du socle hors ligne vers
Barrin) n'en dépend pas, et le lot Inventaires n'ajoute rien au cœur générique
(A8) : l'ordre entre les deux peut encore s'inverser si Barrin presse.

Conséquences : l'ajout « à la collection » du lot Chercher vise l'inventaire
unique d'aujourd'hui, devenu le principal à la migration ; un deck importé au
Lot 9 puise dans la collection unique, et la migration le rattache au principal
comme les autres.

**Révisé le 2026-11-13, par l'utilisateur : après la première mise en ligne.**
L'ordre devient : Lot 9, Lot 10, Lot 11 (première mise en ligne), puis ce lot ;
sa place par rapport à la synchronisation Archon, elle aussi renvoyée après la
v1, reste à trancher. Ce que le report change, à reprendre à l'ouverture :

- **la migration convertira des données de production**, et non plus la base
  de recette : essai sur une copie de la base servie, sauvegarde datée,
  comparaison ligne à ligne par `backend/scripts/compare_db.py`, et des files
  possiblement en attente sur des téléphones, que les références d'inventaire
  facultatives dans `/sync` (A8) doivent laisser se rejouer sans perte. Le
  point « une file en attente sur un téléphone » des risques cesse d'être
  théorique ;
- **l'appariement du Lot 9 est proposé côté client**
  (`docs/lot9-plan-import-vdb.md`, P1), sur une table de cas commune. L'import
  d'un inventaire, prévu ici côté serveur (A10), demandera un jumeau Python
  testé sur cette table, ou passera lui aussi côté client ;
- **le décompte des révisions et des tables** (A9) est à refaire contre ce que
  les Lots 9 à 11 auront ajouté ;
- les pistes « liste des manques » et « checklist d'assemblage », rangées
  « après Inventaires » dans `docs/pistes-evolution.md`, suivent le report.

### P1. Qu'est-ce qu'un inventaire ?

**Proposition : un ensemble physique de cartes, à un seul niveau.** Chaque
exemplaire possédé est dans exactement un inventaire ; la collection d'un
compte est la somme de ses inventaires. Un classeur, une boîte, la collection
principale sont des inventaires de genres différents.

Alternative écartée par défaut : **deux niveaux**, un inventaire (le « fonds »,
sur lequel portent la comptabilité, les decks et les suggestions) qui contient
des emplacements (classeur, boîte), qui ne disent que *où* sont les cartes. Le
coût est un second niveau dans la clé, dans l'UI et dans les transferts, pour
un besoin que les issues n'expriment pas.

### P2. Que veut dire « binder » ?

**Proposition : un genre d'inventaire** (`binder`), à côté de `collection`
(la collection principale), `box` (boîte de rangement) et `other`. Le genre
change l'icône et l'ordre d'affichage, rien d'autre : un classeur alimente un
deck et reçoit des suggestions comme n'importe quel inventaire.

Sous-question : faut-il un genre `loan` pour des cartes **prêtées par un
ami**, qui alimentent un deck mais ne comptent pas dans « ma collection » ? À
trancher ; sans réponse, le lot s'en tient aux quatre genres.

### P3. À quel niveau un deck choisit-il son inventaire ?

**Proposition : au niveau du deck.** Un deck puise dans un seul inventaire,
l'inventaire principal par défaut. C'est le texte de l'issue #49, et cela
garde la clé de `deck_card` intacte.

Alternative : au niveau de la ligne. Plus souple, mais l'inventaire entre dans
la clé de `deck_card`, de `deleted_deck_card`, de deux types d'opérations
`/sync` et du miroir local, et le picker s'alourdit. Le transfert (A6) couvre
le cas courant : on déplace la carte manquante dans l'inventaire du deck, puis
on l'ajoute.

Une troisième forme, « ce deck puise dans tous mes inventaires », est écartée :
il faudrait décider de quel inventaire chaque exemplaire est débité, ce qui
transforme une somme en problème d'affectation. Les suggestions, elles,
peuvent porter sur plusieurs inventaires à la fois (P9), puisqu'elles ne
réservent rien.

### P4. Que montre la Collection ?

**Proposition :** un sélecteur d'inventaire en tête de l'écran, avec une
position « Tout » qui agrège. L'écran s'ouvre sur le dernier choix de
l'appareil. Tant qu'un compte n'a qu'un inventaire, le sélecteur est masqué :
pour l'utilisateur qui ne crée aucun classeur, rien ne change à l'écran. En
vue « Tout », la méta d'une ligne gagne le nom de l'inventaire (« Crypte · FR
· KMW · Échanges »), et une même carte apparaît sur autant de lignes qu'elle a
d'inventaires.

### P5. Un inventaire peut-il être partagé entre comptes ?

**Proposition : non, pas dans ce lot.** Un inventaire est privé, comme un deck
ou un lieu (Lot 6, P5). Le cas « la boîte du club, que trois comptes
utilisent » est réel, mais il demande une notion de membre, des droits, et une
comptabilité qui traverse les comptes, ce que le Lot 6 a justement cloisonné.
Rangé dans `docs/pistes-evolution.md`.

### P6. Faut-il un handoff de design ?

**Proposition : un handoff court, pour l'écran des suggestions seulement.** La
gestion des inventaires, le sélecteur et le transfert réutilisent des
composants qui existent (puces de langue, feuilles, carnet du Lot 7). L'écran
des suggestions est neuf : une liste de decks classés par ce qui manque, un
détail qui sépare le possédé du manquant, et le geste « construire ». Il mérite
un passage par Claude Design, comme le Lot 7 (`docs/design-handoff/LOT7.md`).

### P7. Quel export VDB importe-t-on ?

L'utilisateur indique que VDB exporte une collection en CSV. Ce qui a été
relevé le 2026-11-03, à confronter à un vrai fichier exporté par
l'utilisateur avant toute ligne de code :

- le forum VEKN (fil du développeur de VDB, 2021) décrit un export CSV de deck
  et d'inventaire au format « Quantity,Card ID », l'identifiant étant celui de
  la base VEKN, donc notre `card.vekn_id` ;
- le code actuel de VDB (`github.com/smeea/vdb`,
  `frontend/src/services/deckServices.js`) produit un export Excel en deux
  feuilles, Crypt et Library, avec une colonne `Quantity` et une colonne
  `Card`, nom de carte suffixé « (ADV) » et « (G*n*) » pour la crypte, **sans
  identifiant** ; s'y ajoutent des formats texte (TWD, Lackey, JOL).

**Proposition :** accepter le CSV à identifiant VEKN en premier, apparié sur
`vekn_id` sans ambiguïté ; accepter ensuite le texte et l'Excel par le nom,
avec l'appariement du Lot 9 (nom, groupe, *advanced*, qui est unique sur la
crypte de krcg, §11 Lot 2), et un rapport des lignes non reconnues plutôt
qu'un échec du tout.

Ni l'un ni l'autre ne porte la **langue** ni l'**extension**. L'import demande
donc une langue pour tout le fichier, et range chaque carte sous sa dernière
impression (`latest_card_set_id`, D2a du Lot 4), corrigible ensuite. C'est la
règle du Lot 4 pour un exemplaire dont on ignore l'extension.

Reste à trancher : un import **remplace**-t-il le contenu de l'inventaire
cible (resynchroniser un classeur tenu dans VDB) ou s'y **ajoute**-t-il ?
Proposition : remplacer, dans un inventaire neuf ou vide par défaut, et
refuser de baisser une entrée sous ce que les decks en consomment (même règle
qu'une baisse à la main).

### P8. D'où viennent les decklists suggérées ?

**Proposition : de la TWDA, publiée par krcg, et des decks du compte.**

- **TWDA** (archive des decks gagnants de tournoi) : krcg la publie à
  `https://static.krcg.org/data/v5/twda.json`, un fichier d'environ 30 Mo
  modifié la nuit du relevé (2026-11-03), qui compte 4708 decks. Chaque deck
  liste ses cartes par identifiant VEKN et nombre d'exemplaires, avec son nom,
  son joueur, son auteur et le tournoi (champ `event`). Même source et même licence
  que le catalogue (§11.1), donc pas de source nouvelle à justifier. VDB
  propose déjà une recherche dans la TWDA filtrée par inventaire, ce qui
  confirme que le besoin existe.
- **Decks du compte**, archivés et supprimés compris (leur decklist est
  figée) : « puis-je remonter mon vieux deck Malkavien avec ce classeur ? ».
- Les decks importés de VDB au Lot 9 sont des decks du compte et entrent par
  la même porte.

La TWDA se charge comme le catalogue, par un script d'import rejouable, dans
des tables partagées entre comptes et en lecture seule côté API. Une copie
locale complète dans le miroir Dexie est écartée : 30 Mo pour une lecture
qu'on fait rarement (P9, A11).

### P9. Qu'est-ce qu'un deck « viable » ?

**Proposition :** un deck est suggéré avec ce qui lui manque, et c'est à
l'utilisateur de juger. L'outil classe, il ne tranche pas.

- **Ce qui compte comme disponible** : par défaut, les exemplaires libres de
  l'inventaire choisi (possédés moins alloués à ses decks vivants), toutes
  langues et toutes extensions confondues, puisque l'identité d'une carte ne
  dépend pas de sa langue (§5). Une option compte aussi les exemplaires pris
  par d'autres decks (« si je démonte ce que j'ai déjà »). Une autre réunit
  plusieurs inventaires.
- **Le classement** : nombre d'exemplaires manquants, croissant, puis date du
  tournoi pour la TWDA. Chaque suggestion montre aussi le nombre de cartes
  distinctes manquantes et sa légalité à la date du jour (une carte bannie
  depuis fait chuter le deck dans la liste sans l'en retirer).
- **Proxies** : un manque peut se combler en proxy, mais seulement dans un
  deck qui les autorise. La suggestion dit combien de proxies il faudrait ;
  « viable sans proxy » est un filtre.
- **Filtres** : clan principal de la crypte, nombre maximal de manquants,
  période de la TWDA.

## Décisions de conception proposées à l'architecte

### A1. La table `inventory`

`id` (`AUTOINCREMENT`, comme les tables du Lot 7 depuis R11), `user_id`,
`name` (unique par compte, comparé après rognage), `kind` (enum fermé, CHECK
nommé), `is_default`, `notes`, horodatages. Une unicité (`id`, `user_id`) sert
de cible aux clés étrangères composites, sur le patron de `deck`. Un index
unique partiel garantit au plus un inventaire principal par compte, comme
`ux_player_is_me`.

L'inventaire principal porte le genre `collection` et le nom « Collection ».
Il se renomme mais ne se supprime jamais. Il est créé par la migration pour
chaque compte existant, par `POST /inscription` et par
`manage_accounts.py create`. `check-me` apprend à vérifier aussi l'inventaire
principal, ou une sous-commande voisine fait ce travail (choix de
l'architecte).

### A2. L'inventaire entre dans la clé de `card_copy`

La clé devient (`user_id`, `inventory_id`, `card_id`, `language_code`,
`card_set_id`), avec une clé étrangère composite (`inventory_id`, `user_id`)
vers `inventory`. Pas de clé technique, pour la raison du Lot 4 (D1) : le
client hors ligne désigne une entrée par des valeurs qu'il connaît. Une entrée
à 0 exemplaire reste valide, comme aujourd'hui.

### A3. Un deck porte son inventaire

`deck.inventory_id`, clé étrangère composite (`inventory_id`, `user_id`) vers
`inventory`. Obligatoire pour un deck vivant, archivé compris. À la
suppression logique, il passe à NULL : un deck supprimé ne réserve plus rien
(Lot 2), et sans cela il empêcherait à jamais la suppression de son
inventaire. Un CHECK lie les deux colonnes (`inventory_id` nul si et seulement
si `deleted_at` est posé).

`deck_card` ne change pas. La somme des allocations passe par une jointure sur
`deck` (`deck.inventory_id = :inventaire`), plutôt que par une copie de
l'inventaire sur chaque ligne. Au Lot 6, `user_id` avait été recopié sur
`deck_card` pour servir les sommes par un index ; ici, recopier l'inventaire
obligerait à mettre à jour toutes les lignes d'un deck qui change
d'inventaire (ou à poser un `ON UPDATE CASCADE` sur une clé composite), pour
un gain nul à l'échelle de quelques dizaines de decks. Un index sur
`deck (user_id, inventory_id)` suffit. L'architecte peut choisir l'autre forme
si les mesures la justifient.

### A4. La comptabilité du stock, reformulée par inventaire

> Pour chaque compte, chaque inventaire et chaque entrée de cet inventaire
> (carte × langue × extension), la somme des exemplaires réels
> (`quantity - proxy_quantity`) alloués par les decks vivants qui puisent dans
> cet inventaire (archivés compris) ne dépasse pas `quantity_owned`.

Toutes les fonctions de `services/stock.py` prennent l'inventaire en
paramètre obligatoire, sans valeur par défaut, pour la même raison que le
compte au Lot 6 : un oubli doit échouer au typage, pas compter sur la mauvaise
somme. `acquired_quantity` (Lot 4b) crée ou incrémente l'entrée dans
l'inventaire du deck. Une ligne tout-proxy n'exige toujours aucune entrée.

### A5. Changer l'inventaire d'un deck

Deux gestes, tous deux par `PATCH /decks/{id}` et `deck.update` :

- **puiser désormais ailleurs** (`inventory`) : chaque ligne qui consomme du
  réel est revérifiée contre la disponibilité de l'inventaire cible. Refus en
  409 (`conflict` par `/sync`) qui nomme la première carte manquante, sans
  rien écrire ;
- **emporter les cartes** (`inventory` et `carry_copies: true`) : les
  exemplaires réels alloués sont transférés de l'ancien inventaire vers le
  nouveau dans la même transaction, puis le deck change d'inventaire. C'est le
  geste « je range ce deck et ses cartes dans la boîte ».

Un deck archivé refuse le changement, comme toute modification (Lot 2), sauf
dans une requête qui le désarchive.

### A6. Le transfert

`POST /stock/transferts` et un type `/sync` `stock.transfer` : source,
destination, carte, langue, extension, quantité. C'est un **delta**, comme
`bundle.deposit`, et non un état complet : deux `stock.upsert` successifs
laisseraient la collection fausse si le second était refusé. L'idempotence
vient du journal (`operation_id`), comme pour le versement.

Refus si la quantité dépasse ce qui est **disponible** à la source (possédé
moins alloué) : on ne transfère pas une carte qui est dans un deck. La
destination est créée au besoin. Une source qui tombe à 0 est supprimée si
elle n'a pas de note, gardée sinon. C'est une proposition : l'autre choix
laisserait des dizaines d'entrées à 0 après le déménagement d'un classeur.

### A7. Contrat d'API

- `/inventaires` (`GET`, `POST`) et `/inventaires/{id}` (`GET`, `PATCH`,
  `DELETE`), avec des compteurs en lecture (entrées, exemplaires, decks qui y
  puisent), sur le patron de `/lieux` ;
- suppression refusée (409) tant qu'une entrée a un exemplaire ou qu'un deck
  vivant y puise ; les entrées à 0 partent avec l'inventaire ; l'inventaire
  principal ne se supprime jamais ;
- `/stock` garde ses chemins. Les routes par clé prennent `inventory_id` en
  paramètre de requête **facultatif**, l'inventaire principal par défaut ;
  `GET /stock` sans filtre rend tous les inventaires, chaque ligne portant son
  `inventory_id` ; les corps d'écriture (`CardCopyCreate`, `BundleDeposit`,
  `DeckCreate`, `DeckUpdate`) gagnent une `InventoryRef` facultative ;
- une `InventoryRef` vaut `{"inventory_id": n}` ou `{"client_ref": "…"}`,
  comme les références du Lot 7 (`backend/app/schemas/refs.py`) ; une
  `client_ref` envoyée à une route en ligne rend 422 ;
- `POST /inventaires/{id}/import` (A10) et `GET /inventaires/{id}/suggestions`
  (A11), plus la lecture de la TWDA (`GET /twda`, `GET /twda/{id}`, publique
  comme le catalogue) ;
- la matrice d'autorisation (`test_lot6_authorization_matrix.py`) s'étend aux
  opérations nouvelles ; un inventaire d'un autre compte rend 404.

Le choix d'un paramètre facultatif plutôt que de chemins neufs
(`/inventaires/{id}/stock/...`) tient à la compatibilité : un appel ancien
continue de viser l'inventaire principal, comme avant le lot.

### A8. `/sync` et couche hors ligne

Quatre types de plus : `inventory.create`, `inventory.update`,
`inventory.delete`, `stock.transfer`. Les types existants qui touchent la
collection (`stock.upsert`, `stock.delete`, `bundle.deposit`, `deck.create`,
`deck.update`) gagnent une référence d'inventaire **facultative**, l'inventaire
principal par défaut.

Ce caractère facultatif est voulu, et c'est l'écart principal avec le Lot 4
(D4, « pas de compatibilité avec l'ancienne file ») : la base contient de
vraies données et un téléphone peut avoir une file en attente au moment de la
mise en service. Une opération saisie avant le lot sera rejouée sur
l'inventaire principal, là où elle aurait porté. C'est aussi la marche à
suivre que `frontend/src/offline/README.md` décrit pour Barrin.

Le journal `sync_operation` apprend `inventory_id`, sur le patron de `deck_id`
et des quatre identifiants du Lot 7 (A10 de ce lot-là) ; la référence client
d'inventaire devient un cinquième genre. `inventory.create` lie sa
`client_ref` à l'inventaire existant quand le nom existe déjà, comme
`player.create` et `venue.create` (P5 du Lot 7).

L'import d'un fichier et les suggestions ne passent **pas** par `/sync` : ce
sont des gestes en ligne, comme la lecture de la légalité (§11 Lot 3). Un
import est une écriture, mais il part d'un fichier que l'utilisateur a sous la
main au moment où il l'importe, et en faire une opération de file obligerait
à mettre tout le fichier dans le journal. Le bouton est grisé hors connexion,
comme celui de la synchronisation Archon prévue après la v1. C'est un écart
assumé à la règle « toute écriture fonctionne hors ligne » (§10), à consigner
au §11 à la clôture.

### A9. Migrations

**R12, « inventaires »**, sur la forme de R9 à R11 (renommage puis recréation
à la main, hors mode batch, montée rendue hors ligne par `--sql`) :

1. crée `inventory` et insère un inventaire principal par compte ;
2. recrée `card_copy` avec `inventory_id` dans sa clé, chaque ligne rattachée à
   l'inventaire principal de son compte ;
3. ajoute `deck.inventory_id`, renseigné pour tout deck non supprimé ;
4. ajoute `sync_operation.inventory_id` et élargit ses CHECK d'enum (le journal
   est recopié, comme à R10).

Descente refusée (`RuntimeError`, avant toute modification) dès qu'un compte a
un second inventaire, qu'un deck puise ailleurs que dans le principal ou qu'une
opération d'inventaire figure au journal.

**R13, « archive des decks de tournoi »** : deux tables partagées,
`twda_deck` (identifiant krcg, nom, joueur, et ce que le champ `event` de
krcg donne du tournoi, à relever à l'ouverture) et `twda_deck_card` (deck,
carte, nombre). Rien à convertir,
descente libre. Si le Lot 9 a déjà importé la TWDA, ce lot réutilise ses
tables.

Le nombre de révisions et de tables dépendra de ce que les Lots 8 et 9 auront
ajouté ; à recompter à l'ouverture.

### A10. Import d'un inventaire

`POST /inventaires/{id}/import`, corps : contenu du fichier, format (P7),
langue, mode (`replace` ou `add`). Réponse : un rapport, sur le patron de
`ImportReport` du catalogue, avec les lignes reconnues, les lignes non
reconnues et leur motif, et les entrées qui n'ont pas pu baisser parce
qu'un deck en consomme. Tout ou rien par défaut ; une option `dry_run` rend le
rapport sans rien écrire, pour que l'écran montre ce qui va se passer avant
de confirmer.

L'appariement est une fonction pure partagée avec l'import de decks du Lot 9,
dans `services/` : une carte externe (identifiant VEKN, ou nom suffixé)
devient une carte du catalogue ou une ligne non reconnue.

### A11. Suggestions

Calcul **côté serveur, à la demande**, comme la légalité : une fonction pure
prend les quantités disponibles par carte et une liste de decklists, et rend
pour chacune les manquants et un classement (P9). Le service lit
l'inventaire, les allocations et les decklists, puis appelle la fonction.
4708 decks de la TWDA contre la collection d'un compte, c'est
une somme par carte en mémoire, sans index à concevoir ; à mesurer quand même,
et à mettre en cache par inventaire si la mesure l'exige.

**Construire depuis une suggestion** reprend le chemin de l'acquisition depuis
un deck (Lot 4b) : `deck.create` dans l'inventaire choisi, puis un
`deck_card.upsert` par carte, chaque ligne prenant d'abord les exemplaires
libres (langue et extension choisies par disponibilité), le reste en proxy si
le deck les autorise. Ce geste-là est une suite d'opérations de file ordinaires,
donc il fonctionne hors ligne une fois la suggestion affichée.

## Écrans (frontend-react)

Mobile et bureau dans le même lot, comme depuis le Lot 6 :

- **Collection** : sélecteur d'inventaire (P4), compteurs par inventaire,
  méta de ligne enrichie en vue « Tout » ;
- **Gestion des inventaires** : liste, création, renommage, genre, notes,
  suppression avec ses refus expliqués, et l'import d'un fichier VDB avec son
  rapport en aperçu ;
- **Feuille d'entrée** : choix de l'inventaire à la création (désactivé en
  modification, il fait partie de la clé, comme la langue), et action
  « Déplacer vers… » qui ouvre le transfert ;
- **Versement d'un produit** : inventaire de destination ;
- **Deck** : « Puise dans : Échanges » dans la feuille « Nouveau deck » et
  dans le détail, changement avec les deux gestes de A5 ;
- **Picker** : la disponibilité se lit dans l'inventaire du deck, et une
  mention signale les exemplaires disponibles ailleurs (« 2 dans Collection »),
  avec un raccourci vers le transfert ;
- **Suggestions** (handoff, P6) : depuis un inventaire, la liste des decks
  classés par manquants avec leurs filtres (P9), un détail qui sépare possédé,
  manquant et proxy, et le bouton « Construire ce deck ».

Côté hors ligne (pwa-offline) : Dexie en deux crans, comme au Lot 4, puisque
IndexedDB ne change pas la clé d'un magasin existant (ajout d'`inventories` et
suppression de `stock`, puis recréation de `stock` avec la clé
`[inventoryId+cardId+languageCode+cardSetId]`, `decks` vidé pour gagner
`inventoryId`) ; projection de disponibilité par inventaire ; surcouche du
transfert et du changement d'inventaire ; libellés et corrections de l'écran
Synchronisation pour les quatre types nouveaux. Le cœur générique (`core/`,
`react/`) ne nomme aucun inventaire.

## Découpage en étapes ordonnées

| Étape | Agent | Contenu | Skills |
| --- | --- | --- | --- |
| A0 | orchestrateur | P1 à P9 tranchés, un vrai export VDB en main, brief à jour | `orchestration` |
| A1 | architecte-contrat | modèle, R12 et R13, schémas, contrat, section « Lot Inventaires » de `docs/lot3-sync-contrat.md` | `modele-donnees`, `migrations-alembic`, `contrat-openapi` |
| B1 | backend-fastapi | `/inventaires`, stock par inventaire, transfert, versement | `fastapi-endpoint`, `tests-backend` |
| B2 | backend-fastapi | deck et inventaire (A3, A5), comptabilité (A4), `/sync` (A8) | `fastapi-endpoint`, `regles-vtes` |
| B3 | backend-fastapi | import de la TWDA (script rejouable), import d'un inventaire (A10) | `fastapi-endpoint`, `tests-backend` |
| B4 | architecte-contrat, backend-fastapi | suggestions en fonction pure, puis service et route (A11) | `regles-vtes`, `fastapi-endpoint` |
| C1 | pwa-offline | Dexie, rafraîchissement, surcouche, références, libellés | `pwa-offline` |
| D0 | orchestrateur | handoff de l'écran des suggestions (P6) | `orchestration` |
| D1 | frontend-react | Collection, gestion des inventaires, import, transfert | `react-feature`, `tests-frontend` |
| D2 | frontend-react | deck, picker, versement | `react-feature`, `tests-frontend` |
| D3 | frontend-react | suggestions et construction depuis une suggestion | `react-feature`, `tests-frontend` |
| E | qa-tests | trous de couverture, e2e, CRAP, matrice | `tests-backend`, `tests-frontend` |
| F | orchestrateur, devops | migration de `backend/vtes.db` après essai sur copie, CLAUDE.md | `ci-cd-deploiement` |

B1, B3 et C1 peuvent avancer en parallèle une fois le contrat régénéré ; D1
attend C1, D3 attend B4 et le handoff.

### Tests attendus

- **Back** : comptabilité par inventaire (deux decks sur deux inventaires ne se
  gênent pas, un deck ne voit pas le stock d'un autre inventaire) ; changement
  d'inventaire d'un deck, refusé puis accepté avec `carry_copies` ; transfert
  borné par le disponible ; suppression d'inventaire et ses refus ; rejeu d'une
  opération d'avant le lot sans inventaire ; `inventory.create` lié par le nom ;
  import en `replace` et en `add`, `dry_run` sans écriture, ligne non reconnue,
  baisse refusée sous les allocations ; suggestions sur une table de cas
  (manquants, proxies, carte bannie, plusieurs inventaires) ; import de la
  TWDA rejouable sur un échantillon figé, comme le fixture du catalogue ;
  migrations montée, conversion et descente refusée ; matrice d'autorisation
  étendue.
- **Front** : montée Dexie sans perte de la file ; projection de disponibilité
  par inventaire ; surcouche du transfert ; sélecteur masqué avec un seul
  inventaire ; construction depuis une suggestion en une suite d'opérations.
- **e2e contre le vrai back**, aux deux largeurs : importer un classeur depuis
  un fichier, lire les suggestions, construire un deck, couper le réseau,
  transférer une carte manquante et l'ajouter, revenir en ligne et rejouer.

## Risques et points d'attention

- **Le format réel de l'export VDB.** Les deux relevés de P7 ne disent pas la
  même chose. Rien n'est codé avant d'avoir un fichier exporté par
  l'utilisateur, versé tel quel dans les fixtures de test.
- **La conversion de données réelles.** Essai sur une copie, sauvegarde datée,
  puis comparaison ligne à ligne des entrées, des decks, de leurs lignes et des
  disponibilités avant et après.
- **Une file en attente sur un téléphone.** Couverte par les références
  facultatives (A8). À vérifier à la main à l'étape F, avec une opération
  saisie hors ligne avant la mise à jour du service worker.
- **La TWDA est un schéma tiers**, comme le catalogue : URL figée, import
  testé contre un échantillon, et un rejeu qui ne supprime rien. Un deck retiré
  de l'archive chez krcg resterait en base.
- **Des suggestions décevantes.** La TWDA ne contient que des decks gagnants,
  souvent pointus : avec une petite collection, presque tout manquera. Les
  decks du compte et le filtre « nombre maximal de manquants » compensent ; le
  verdict viendra de l'usage.
- **Lectures du stock disséminées.** Toute lecture qui somme les exemplaires
  d'un compte (Atelier, compteurs d'onglets, « dans N decks ») est à reprendre.
  L'inventaire en paramètre obligatoire des fonctions de service fait échouer
  au typage celles qu'on oublierait côté back ; côté front, un recensement des
  appels à `availableStock` est à faire à l'étape C1.
- **Score CRAP.** `services/stock.py`, la surcouche et le calcul des
  suggestions grossissent ; découper plutôt que d'ajouter une entrée aux
  références (CLAUDE.md §10).

## Critère de fin de lot

Les deux issues se ferment quand un compte peut créer un classeur, le remplir
à la main ou depuis un export VDB, lire les decks qu'il permet de monter,
construire l'un d'eux depuis la suggestion, et y transférer ce qui manque,
hors ligne pour tout ce qui n'est ni l'import ni la lecture des suggestions,
en mobile et en bureau ; quand la base de développement est migrée sans écart
sur ses données ; et quand back, front, e2e et CRAP sont verts, avec les
décisions consignées au §11 de CLAUDE.md.
