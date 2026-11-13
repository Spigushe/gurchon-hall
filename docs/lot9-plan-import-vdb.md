# Lot 9 — Import de decks depuis VDB : plan d'implémentation

Statut : **proposé le 2026-11-13, avant toute décision et avant tout code.**
Rédigé sur `main` à `745c0a5` (Lot 8 clos). Les propositions P1 à P10 sont à
trancher par l'utilisateur à l'étape A0 ; les décisions A1 à A6 sont des
propositions de conception que les agents de couche reprendront ou
amenderont dans ce fichier. La forme suit `docs/lot8-plan-analyse.md`.

## Portée

La feuille de route (CLAUDE.md §12, point 12) donne au Lot 9 un objet :
**importer une decklist venue de VDB** (`github.com/smeea/vdb`) et en faire un
deck du compte, rattaché au modèle du Lot 4 (lignes carte × langue × extension,
stock possédé, discriminant tiré par le serveur). Elle laisse deux questions
ouvertes, que ce plan range en P4 et P5 :

1. l'appariement d'une carte externe avec le catalogue (identifiant VEKN, ou
   nom, groupe et *advanced*), à écrire en fonction réutilisable ;
2. le sort d'une carte absente de la collection, un deck ne consommant
   d'exemplaire réel que s'il est possédé (§11, décision 2, corrigée après le
   Lot 5).

S'y ajoute une piste de `docs/pistes-evolution.md` que la feuille de route
place au Lot 9 : **l'export texte d'un deck**, sens inverse de l'import (P9).

Ce que le lot ne fait pas :

- synchroniser un tournoi depuis Archon (après la mise en production de la v1,
  `docs/brief-archon.md`) ;
- importer une collection ou un inventaire depuis VDB, ni charger la TWDA
  (lot Inventaires) ;
- mettre à jour un deck existant depuis une liste externe (P8) ;
- publier un lien vers une decklist (piste « lien public », Lot 11 au plus
  tôt).

### Report du lot Inventaires (décision du 2026-11-13)

Le lot Inventaires, placé jusqu'ici juste après ce lot, passe **après la
première mise en ligne** (Lot 11). Deux effets sur le Lot 9 :

- le seul autre consommateur prévu de l'appariement, l'import d'un inventaire
  VDB (A10 de `docs/lot-inventaires-plan.md`), s'éloigne. Le Lot 9 n'a donc
  pas à écrire l'appariement côté serveur « pour plus tard » : il l'écrit là
  où il en a besoin (P1), avec une table de cas que le lot Inventaires
  reprendra, en TypeScript ou dans un jumeau Python ;
- un deck importé puise dans la collection unique d'aujourd'hui, comme tout
  deck. La migration du lot Inventaires le rattachera à l'inventaire principal
  avec les autres, cette fois sur la base de production.

### État de départ relevé le 2026-11-13

Base de développement `backend/vtes.db`, lue en lecture seule : révision
`ac6cda5ad252` (R13), 28 tables, 4212 cartes, données de recette.

Catalogue, mesuré avec la normalisation de VDB décrite plus bas :

- le triplet nom + groupe + *advanced* est unique (aucune collision) ;
- aucun nom de bibliothèque ne se répète, et aucun nom n'est porté à la fois
  par une carte de crypte et une carte de bibliothèque ;
- **15 noms de crypte ont plusieurs versions non *advanced*** (vampires
  réimprimés dans un groupe plus récent : Aisling Sturbridge G2 et G6,
  Annabelle Triabell G3 et G6, Donal O'Connor G2 et G6…). Sans groupe, le nom
  seul ne suffit pas (P4) ;
- 93 noms contiennent une lettre non ASCII. La décomposition de `fold_text` en
  ramène 88 à l'ASCII ; cinq restent : « Bang Nakh — Tiger's Claws »,
  « Bolesław Gutowski », « Clara Hjortshøj », « Przemysław, War Beast »,
  « Sacré-Cœur Cathedral, France » (A2).

Code :

- le miroir Dexie (`CardRow`, `offline/vtes/db.ts`) porte `veknId`, `name`,
  `foldedName`, `groupCode`, `advanced` et `latestCardSetId` : tout ce qu'il
  faut pour apparier **hors ligne** ;
- un deck se crée par `actions.createDeck` (une `client_ref`), puis une ligne
  par `actions.saveDeckCard`, qui accepte `acquiredQuantity` (Lot 4b) ;
  chaque action range **une** opération dans **sa propre** transaction
  (`Outbox.enqueue`, `offline/core/outbox.ts`) ;
- les disponibilités du stock se calculent côté client par
  `useAvailableStock` et `useDeckStockAvailability`, avec la comptabilité du
  serveur ; l'ajout à une ligne existante passe par la fonction pure
  `computeAddedLine` (lot Chercher) ;
- un deck a `name`, `notes`, `archetype` (un des six, Lot 8), `proxy_allowed`
  et `status` ; le discriminant est tiré par le serveur ;
- les tableaux de composition (`DeckTables`, `deckTablesModel.ts`) groupent
  déjà la bibliothèque par type, dans l'ordre que VDB utilise à l'export.

Chiffres de départ : 2680 tests backend (2 `xfail`), 1163 tests vitest sur 73
fichiers, 82 e2e Playwright, 563 `data-testid` distincts, références CRAP
vides des deux côtés, 51 opérations sur 31 chemins au contrat.

## Ce que VDB produit (relevé du 2026-11-13)

Relevé dans le code source de VDB, branche `master` :
`frontend/src/utils/exportDeck.js`, `importDeck.js`, `getDeckInUrl.js` et
`frontend/src/services/deckServices.js`. Ce n'est **pas** un relevé sur de vrais
fichiers : A0 demande des exports réels, versés tels quels dans les fixtures.

| Format VDB | Forme | Identifiant de carte |
| --- | --- | --- |
| `TEXT` | en-tête `Deck Name:`, `Author:`, `Description:` ; `Crypt (12 cards, min=… max=… avg=…)` souligné de `=` ; lignes de crypte en colonnes (`2x  Nom  6 FOO BAR  Titre  Clan:3`) ; `Library (90 cards)` puis un titre par type (`Master (15; 3 trifle)`) et des lignes `3x Nom` | non |
| `TWD`, `TWD_HINTS` | même corps que `TEXT`, précédé d'un en-tête d'événement entre crochets ou commenté par `#` | non |
| `JOL` | une ligne par carte, `2xNom`, sans en-tête | non |
| `LACKEY` | bibliothèque d'abord, une ligne `Crypt:`, puis la crypte ; quantité calée sur 8 caractères, nom en ASCII, `/` retirés des noms de bibliothèque | non |
| `XLSX` | deux feuilles, Crypt et Library, colonnes Quantity, Card… | non |
| Deck dans l'URL | `…/decks/deck?name=…&author=…&description=…#200001=2;100002=4` | **oui**, dans le fragment |
| Lien court | `vdb.im/decks/<id>`, lu par VDB à `{VITE_API_URL}/deck/{id}` (base non publiée dans le code) | oui, mais au serveur de VDB |

Dans tous les formats texte, un nom de crypte porte ` (ADV)` pour un
*advanced* et ` (G<n>)` pour la version **nouvelle** d'un vampire réimprimé ;
la version d'origine n'a aucune marque. `TEXT` et `TWD` donnent en plus le
groupe en fin de ligne (`Clan:3`, `Clan:ANY`).

L'import de VDB lui-même (`importDeck.js`) lit l'en-tête par préfixe, ignore
sans le dire toute ligne vide ou qui ne commence pas par un chiffre, puis
essaie quatre formes de ligne dans l'ordre : *advanced*, groupe entre
parenthèses, groupe après deux-points, nom seul. Il compare des noms
« minifiés » : translittération (`unidecode`), minuscules, « The » de tête
passé en fin, coupure après `--`, retrait de tout caractère non alphanumérique.
Les lignes non reconnues sont rendues à l'appelant, pas devinées. Ce plan
reprend ce comportement, à deux écarts près (A1, A2).

## Propositions à trancher par l'utilisateur

### P1. Où se fait l'import : dans le navigateur ou sur le serveur ?

- **Dans le navigateur, hors ligne** (recommandé). Le texte collé est lu et
  apparié contre le miroir du catalogue, puis le deck s'écrit par les
  opérations qui existent déjà (`deck.create`, puis un `deck_card.upsert` par
  ligne, reliés par la `client_ref`, comme l'acquisition du Lot 4b). Ni route,
  ni champ de contrat, ni type d'opération `/sync`, ni migration, ni version
  Dexie. On importe au club, sans réseau, la liste qu'un ami vient d'envoyer.
- **Sur le serveur**, par une route `POST /decks/import` : un seul appel,
  atomique, apparié contre la base. Mais un geste en ligne seulement, une
  route et un rapport à ajouter au contrat, et une seconde façon de créer un
  deck à côté de `/sync`.

Recommandation : le navigateur. C'est la règle du §10 (« toute écriture front
doit fonctionner hors ligne »), et le report du lot Inventaires retire la
raison d'écrire l'appariement côté serveur dès maintenant. Le jour où un
import serveur en aura besoin, un jumeau Python s'écrira sur la même table de
cas, comme `fold_text` ou la légalité d'une carte.

### P2. Quels formats accepte-t-on ?

Recommandation :

- **un texte collé**, dans l'un des formats `TEXT`, `TWD`, `JOL` ou `LACKEY`,
  et plus généralement toute ligne de la forme « quantité, puis nom » (le
  texte d'Amaranth ou d'une liste de tournoi recopiée à la main passe par la
  même porte) ;
- **un fichier `.txt`** déposé ou choisi, lu par le même analyseur ;
- **une URL « deck dans l'URL »** de VDB, collée dans le même champ :
  l'analyseur la reconnaît et lit les identifiants VEKN du fragment, sans
  appariement par le nom.

Écartés : l'`XLSX`, qui demanderait une bibliothèque de lecture pour un
fichier qui n'a pas plus d'information que le texte ; l'URL d'Amaranth, que
VDB résout par une requête à un service tiers.

### P3. Et le lien court `vdb.im/decks/<id>` ?

C'est la forme la plus courante d'un partage depuis VDB. Le lire demande une
requête au serveur de VDB, par une API que le projet ne documente pas. Deux
chemins :

- **depuis le navigateur**, en ligne seulement, comme les images de cartes,
  si l'API répond avec un CORS ouvert ;
- **par notre serveur**, qui irait chercher le deck pour le client : ce serait
  le premier appel sortant de l'API vers un tiers pendant une requête, avec
  délai, erreurs et limite de débit à gérer.

Recommandation : **vérifier à A0** si l'API répond depuis un navigateur. Si
oui, une étape détachable (D4) ajoute la lecture du lien court côté client, en
ligne, grisée hors connexion. Sinon, la piste part dans
`docs/pistes-evolution.md`, et l'écran d'import dit de copier le texte ou
l'URL longue depuis VDB (« Exporter » ou « Copier l'URL »). Pas de relais par
notre serveur dans ce lot.

### P4. Comment une ligne devient-elle une carte ?

Règles proposées, dans l'ordre :

1. un identifiant (URL longue) désigne la carte de même `vekn_id` ;
2. ` (ADV)` désigne la version *advanced* du nom ;
3. un groupe, entre parenthèses (`(G6)`) ou en fin de ligne (`Clan:6`),
   désigne la version de ce groupe ;
4. un nom seul de bibliothèque désigne la carte de ce nom, unique ;
5. un nom seul de crypte qui n'a qu'une version non *advanced* la désigne ;
6. un nom seul de crypte qui en a plusieurs (les 15 vampires réimprimés)
   désigne, **par la convention de VDB**, la version d'origine, celle qui n'a
   pas de marque « nouvelle » : le plus petit identifiant VEKN parmi les
   versions non *advanced*. La ligne est acceptée mais signalée au rapport
   (« version supposée : G2 ; écrire (G6) pour l'autre »).

Toute autre ligne qui commence par un chiffre est **non reconnue** et listée
avec son numéro et son texte, jamais devinée : nom inconnu, groupe que la
carte n'a pas, *advanced* inexistant. Deux lignes qui désignent la même carte
s'additionnent. Écart volontaire à VDB : une ligne mal formée finit au rapport,
là où VDB lève une exception (relevé dans `importDeck.js`).

Point à trancher avec la règle 6 : accepter la version supposée (recommandé,
c'est ce que VDB voulait dire en l'écrivant sans marque), ou refuser la ligne
et demander le groupe.

### P5. Une carte que je ne possède pas

C'est la question laissée ouverte par la feuille de route. Recommandation :

- pour chaque carte, **les exemplaires libres de la collection sont pris
  d'abord**, avec la comptabilité de `useAvailableStock` (ce que les autres
  decks n'ont pas déjà pris) ;
- **le manque** suit un choix fait une fois pour tout l'import, dans l'écran
  d'aperçu :
  - **en proxy** (par défaut) : le deck importé reçoit `proxy_allowed`, et
    l'écran le dit avant la création ;
  - **acheté** : les exemplaires manquants entrent en collection en même temps
    que la ligne (`acquired_quantity`, Lot 4b) ;
  - **laissé hors du deck** : la carte manquante n'est pas ajoutée, et le
    rapport le dit ; le deck sera incomplet.

Chaque carte se règle ensuite dans le deckbuilder comme aujourd'hui (convertir
des proxies, ajouter, retirer). Écartés : refuser l'import tant que tout n'est
pas possédé, ce qui contredirait la correction du 2026-09-29 ; un choix carte
par carte dans l'aperçu, qui alourdit l'écran pour un réglage que le
deckbuilder fait déjà.

### P6. Sous quelle langue et quelle extension ?

Une liste VDB ne dit ni l'une ni l'autre. Recommandation :

- **exemplaires réels** : pris dans les entrées de collection qui ont des
  exemplaires libres, d'abord celles de la langue choisie pour l'import, puis
  celles qui ont le plus d'exemplaires libres, puis la dernière extension ;
  une ligne de deck par entrée utilisée. Une fonction pure, testée sur table ;
- **proxies et achats** : la langue choisie pour l'import (EN par défaut,
  modifiable dans l'aperçu) et la dernière version de la carte
  (`latest_card_set_id`, D2a du Lot 4), règle actuelle d'une carte jouée en
  proxy.

### P7. Nom, description, archétype, statut

Recommandation :

- **nom** : la ligne `Deck Name:` (ou le paramètre `name` de l'URL), modifiable
  dans l'aperçu ; « Deck importé » à défaut. Le discriminant est tiré par le
  serveur, comme pour tout deck ;
- **notes** : la description, précédée de « Auteur : … » s'il y en a un, et
  suivie de « Importé de VDB le 13 novembre 2026 » ;
- **archétype** : VDB ne l'exporte pas. Les six puces du Lot 8 sont proposées
  dans l'aperçu, sans choix par défaut ;
- **statut** : toujours brouillon. Le passage à « actif » reste gardé par la
  légalité, calculée en ligne (§11, Lot 2).

### P8. Importer dans un deck existant ?

Recommandation : **non, toujours un deck neuf.** Remplacer la composition d'un
deck demanderait une comparaison ligne à ligne, des choix sur les exemplaires
déjà alloués, et toucherait aux versions jouées du Lot 8. Rangé dans
`docs/pistes-evolution.md` (« mettre à jour un deck depuis VDB »), à reprendre
si l'usage le demande, par exemple pour suivre un deck qu'on construit dans VDB.

### P9. Export texte d'un deck

Recommandation : **dans le lot**, au format `TEXT` de VDB, que VDB relit et
qu'un humain lit sans peine. Depuis le détail d'un deck et depuis la liste
d'une version jouée (`#/decks/<clé>/versions/<n>`, Lot 8), qui est la liste à
remettre à un organisateur de tournoi. Calculé hors ligne, depuis le miroir ;
« Copier » et « Télécharger (.txt) ».

Deux raisons de le faire ici : c'est le même format, dans l'autre sens ; et il
donne le meilleur test de l'import, l'aller-retour (exporter un deck, réimporter
le texte, retrouver la même liste carte × quantité).

Écartés pour ce lot : les autres formats d'export (`TWD`, `JOL`, `LACKEY`), à
ajouter en quelques lignes si un besoin précis apparaît.

### P10. Design

Deux écrans neufs mais simples : une feuille d'import (coller, aperçu, choix,
création) et une feuille d'export (texte, copier, télécharger). Recommandation :
**pas de handoff Claude Design**. Les écrans se construisent avec les
composants existants (feuilles du Lot 5, puces de langue, `ArchetypeChips`,
`DeckTables` en lecture seule pour l'aperçu de la composition), en mobile et en
bureau, et se valident sur captures à 390 et 1440px, comme le lot Affichage des
decks. Si l'utilisateur préfère un passage par Claude Design, un brief court
s'écrit à A0 et D0 s'ajoute au découpage.

## Décisions de conception proposées

Rédigées d'après les recommandations ; à reprendre après A0.

### A1. Analyseur pur

`frontend/src/features/decks/import/parseDecklist.ts` : un texte devient un
en-tête (nom, auteur, description), une suite de lignes lues (numéro, texte
d'origine, quantité, nom, *advanced*, groupe, section Crypt ou Library quand le
texte en a une) et une liste de lignes ignorées. Chaque forme de ligne est une
petite fonction d'une table essayée dans l'ordre de P4, sans `switch`, pour
tenir les références CRAP vides. `parseVdbUrl` reconnaît l'URL longue et rend
la même structure, avec les identifiants.

Écart volontaire à VDB : une ligne qui commence par un chiffre et ne se lit
pas est **rapportée**, pas ignorée ni fatale. Les lignes de titre (`Crypt (…)`,
`Master (15; 3 trifle)`, soulignements, en-têtes `#` de `TWD_HINTS`) sont
ignorées sans bruit.

### A2. Appariement pur, sur une table de cas

`matchDecklist(lines, index)`, avec `buildCardIndex(cards)` qui range le miroir
par identifiant VEKN et par nom minifié, groupe et *advanced*. Rend des cartes
appariées (carte, quantité, et comment : identifiant, nom, version supposée)
et des lignes non reconnues avec leur motif.

La minification reprend celle de VDB sur `foldText` (A4 du lot Chercher), plus
une petite table pour les lettres qui ne se décomposent pas (ł, ø, œ, tiret
cadratin) : les cinq noms relevés plus haut sont des cas de la table. La
coupure après `--` de VDB est reprise pour que « Bang Nakh -- Tiger's Claws »,
forme ASCII probable des exports `LACKEY`, retrouve sa carte.

La table de cas vit dans `frontend/tests/fixtures/vdb-import-cases.json`, au
format des tables communes du projet, pour qu'un jumeau Python puisse s'y
tester au lot Inventaires. Les exports réels d'A0 vont dans
`frontend/tests/fixtures/vdb/`. La règle de version supposée (P4) est une
convention, pas une règle VEKN : l'architecte-contrat relit la table (étape
A1 du découpage), comme pour toute règle de jeu.

### A3. Plan d'import pur

`planDeckImport(matched, availability, choices)` rend ce qui sera écrit : les
champs du deck (nom, notes, archétype, `proxy_allowed`), les lignes
(`DeckCardInput`, avec proxies et `acquiredQuantity`) et un résumé (exemplaires
pris en collection, proxies, achats, cartes laissées, lignes non reconnues).
Les disponibilités viennent de la partie pure de `useAvailableStock`, à
extraire si elle ne l'est pas, pour que l'aperçu et le serveur comptent pareil.
Le plan se recalcule au moment de « Créer », pour ne pas écrire sur un stock
changé depuis l'aperçu (autre onglet, synchronisation).

### A4. Un import, une transaction de la file

Créer un deck de 90 cartes, c'est une création et 40 à 70 lignes. Écrites
action par action, une fermeture d'onglet au milieu laisserait un deck à
moitié rangé dans la file. Proposition :

- le cœur générique gagne `Outbox.enqueueAll(operations)`, qui range
  plusieurs opérations, dans l'ordre, en **une** transaction IndexedDB, avec
  les mêmes contrôles qu'`enqueue` (clé déjà vue, `client_ref` déjà prise).
  Rien n'y nomme un deck : c'est un geste générique, utile à Barrin dès qu'une
  saisie produit plusieurs opérations (README du paquet offline à compléter) ;
- l'adaptateur `vtes/` gagne `actions.importDeck(plan)`, qui construit
  `deck.create` et les `deck_card.upsert` avec les contrôles de
  `saveDeckCard` (borne d'acquisition) et les range par `enqueueAll`.

Côté serveur, rien ne change : les opérations partent dans le même lot `/sync`
(200 opérations au plus par lot, un deck en tient largement). La file faisant
foi, une ligne refusée au rejeu (un autre appareil a pris l'exemplaire entre
temps) laisse le deck créé sans elle, et le refus se règle sur l'écran
Synchronisation comme aujourd'hui. Écarté : un type d'opération `deck.import`
atomique, qui doublerait `deck.create` et `deck_card.upsert` pour un cas que
la politique de conflit du Lot 3 couvre déjà.

### A5. Export pur

`exportVdbText(deck, lines, facts)` produit le format `TEXT` de VDB à partir
des groupes de `deckTablesModel.ts` (crypte par capacité, bibliothèque par
type, titres avec leurs comptes et les *trifles*). La version jouée s'exporte
par la même fonction, depuis `deckVersionModel.ts`. Les colonnes de crypte
suivent la mise en page de VDB, pour qu'un texte exporté chez nous et un texte
exporté par VDB se ressemblent ligne à ligne.

**Copier** passe par `navigator.clipboard`, absent hors contexte sécurisé :
en `http://` sur l'adresse du réseau local, comme pendant les vérifications sur
téléphone, le bouton se replie sur la sélection du texte et le téléchargement.

### A6. Ce qui ne change pas

Ni route, ni champ de contrat, ni type d'opération `/sync`, ni migration, ni
version Dexie : CLAUDE.md §6 et §7 ne bougent pas (sauf P3 par le serveur,
non recommandé). Le seul changement hors de `features/` est `enqueueAll` dans
`offline/core/`.

## Écrans (frontend-react)

En mobile puis en bureau :

1. **Entrée** : « Importer depuis VDB » à côté de « Nouveau deck », dans la
   liste des decks (bouton au bureau, feuille « Nouveau deck » au mobile), et
   par l'intention de route `#/decks?action=importer`, sur le patron du Lot 5c.
2. **Feuille d'import, étape 1** : un champ de texte où coller une liste ou une
   URL, un bouton pour choisir un fichier `.txt`, et le format reconnu dit en
   clair (« Format texte de VDB, 12 cartes de crypte, 90 de bibliothèque »).
3. **Feuille d'import, étape 2 (aperçu)** : nom, archétype, langue des proxies
   et des achats, choix du manque (P5) avec son effet écrit (« 14 cartes en
   proxy : le deck autorisera les proxies ») ; la composition dans `DeckTables`
   en lecture seule ; un rapport replié des lignes non reconnues et des
   versions supposées, avec leur numéro de ligne. « Créer le deck » ouvre le
   deckbuilder du deck créé.
4. **Feuille d'export** : depuis les actions du deck (mobile) ou de l'en-tête
   du deckbuilder (bureau), et depuis la liste d'une version : le texte, puis
   « Copier » et « Télécharger ».

## Découpage en étapes ordonnées

| Étape | Agent | Contenu | Dépend de |
| --- | --- | --- | --- |
| A0 | utilisateur, orchestrateur | P1 à P10 tranchées dans ce fichier ; exports réels fournis (voir ci-dessous) ; réponse de l'API du lien court relevée (P3) | rien |
| A1 | architecte-contrat | relecture de la table de cas d'appariement (P4, règle de version supposée), confirmation que le contrat ne bouge pas | A0 |
| C1 | pwa-offline | `Outbox.enqueueAll` dans le cœur, `actions.importDeck`, README du paquet offline | A0 |
| D1 | frontend-react | analyseur, appariement et plan d'import (A1 à A3), en fonctions pures sur les tables de cas | A1 |
| D2 | frontend-react | écrans d'import, mobile et bureau | C1, D1 |
| D3 | frontend-react | export (A5) et sa feuille, depuis un deck et depuis une version | D1 |
| D4 | frontend-react | lien court lu côté client, **seulement si P3 le permet**, détachable | D2 |
| E | qa-tests | tests, e2e aux deux largeurs, CRAP, recensement des `data-testid` | D2, D3 (et D4) |
| F | orchestrateur | vérification sur téléphone, CLAUDE.md, pistes | E |

Exports à fournir à A0, depuis le compte VDB de l'utilisateur :

- un même deck (« Banu Princes », par exemple) dans les formats `TEXT`, `TWD`,
  `JOL` et `LACKEY`, plus son URL longue et son lien court ;
- un deck qui contient un *advanced*, un des vampires réimprimés (avec et
  sans `(G…)`) et, si possible, une carte au nom accentué ou à lettre
  spéciale (Bolesław Gutowski, Clara Hjortshøj).

C1 et D1 avancent en parallèle ; D3 ne dépend que des fonctions pures.

## Tests attendus (E)

- **Fonctions pures** (vitest) : analyseur sur chaque export réel et sur la
  table de cas (en-têtes, titres de section ignorés, lignes non reconnues
  rapportées avec leur numéro, URL longue) ; appariement (identifiant,
  *advanced*, groupe entre parenthèses et après deux-points, groupe `ANY`,
  version supposée des 15 vampires, cinq noms à lettres spéciales, « The » de
  tête, lignes doublées additionnées, carte inconnue) ; plan d'import (stock
  suffisant, partiel, nul ; chaque choix du manque ; langue préférée ; plusieurs
  entrées de collection pour une carte ; `proxy_allowed` posé seulement s'il y
  a un proxy) ; export (`TEXT` conforme, version jouée) ; **aller-retour**
  export puis import sur une liste qui couvre crypte, *advanced* et tous les
  types de bibliothèque.
- **Couche offline** : `enqueueAll` (ordre, une transaction, refus en bloc
  sur une clé déjà vue, diffusion inter-onglets) ; `importDeck` (borne
  d'acquisition, `client_ref` partagée).
- **e2e contre le vrai back, aux deux largeurs** : coller un export `TEXT` hors
  ligne, avec une partie des cartes en collection ; créer le deck en proxy pour
  le reste ; recharger hors ligne ; revenir en ligne, rejouer ; le deck est au
  serveur avec ses lignes réelles et proxies, et sa légalité se lit. Un second
  scénario : exporter la liste d'une version jouée et retrouver le texte.
- **Back** : aucun test nouveau attendu, le serveur ne change pas ; la suite
  doit rester verte.
- **Non-régression** : références CRAP vides, aucun `data-testid` disparu
  (`testid-census.mjs`, nouvelle référence de clôture).

## Risques et points d'attention

- **Le format réel des exports.** Ce plan s'appuie sur le code de VDB, pas sur
  des fichiers. Rien n'est codé avant les exports d'A0, versés tels quels dans
  les fixtures. VDB peut changer son format sans prévenir ; l'analyseur
  tolérant (« quantité, puis nom ») limite la casse.
- **Noms divergents.** VDB tire ses noms de vtescsv, le catalogue de krcg ;
  l'import du lot Chercher a déjà vu des écarts (`same_card_name`, « The » en
  tête ou « , The » en fin). Toute ligne qui ne s'apparie pas est rapportée,
  et chaque écart trouvé devient un cas de la table.
- **La version supposée** (P4, règle 6) peut tromper : une liste écrite à la
  main sans `(G6)` désignera la version d'origine. Le rapport le dit, ligne à
  ligne.
- **Un deck partiel au rejeu.** Si une ligne est refusée (stock pris par un
  autre appareil), le deck existe sans elle. C'est la politique du Lot 3 ; le
  refus apparaît sur l'écran Synchronisation, avec son libellé.
- **Le presse-papiers hors HTTPS** (A5) : à vérifier sur téléphone, où la
  page est servie en `http://` jusqu'au Lot 11.
- **Le lien court** (P3) : une API tierce non documentée, qui peut changer ou
  fermer. D'où l'étape détachable et le repli sur le texte.
- **Score CRAP.** Analyseur et appariement sont des tables de petites
  fonctions ; l'écran d'aperçu, qui cumule choix et rapport, est à découper en
  sous-composants dès le départ.

## Critère de fin de lot

- P1 à P10 tranchées et reportées sous chaque proposition ; exports réels
  versés dans les fixtures.
- Un deck s'importe depuis un texte VDB (`TEXT`, `TWD`, `JOL`, `LACKEY`) ou une
  URL longue, hors ligne, en mobile et en bureau, avec un rapport des lignes non
  reconnues et des versions supposées, et les cartes manquantes traitées selon
  le choix de P5 ; il s'exporte au format `TEXT`, depuis le deck et depuis une
  version jouée.
- Contrat, modèle, `/sync` et version Dexie inchangés (sauf décision contraire
  à P3) ; `enqueueAll` documenté dans le README du paquet offline.
- `uv run pytest` vert hors les deux `xfail` connus, `ruff check` propre ;
  `npm run lint`, `npx tsc --noEmit -p tsconfig.app.json`, `npm run test` et la
  suite Playwright verts ; références CRAP vides.
- Vérification sur téléphone : coller une liste en mode avion, créer le deck,
  sortir du mode avion, voir le deck synchronisé ; exporter une liste et la
  coller dans VDB.
- CLAUDE.md mis à jour (en-tête, §11, §12) ; la piste « export texte d'un
  deck » retirée de `docs/pistes-evolution.md`, et « mettre à jour un deck
  depuis VDB » ajoutée si P8 est retenue.
