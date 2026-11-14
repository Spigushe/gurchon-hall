# Lot 9 — Import de decks depuis VDB : plan d'implémentation

Statut : **A0 tranché le 2026-11-13 (P1 à P10) ; A1 livrée le 2026-11-13**
(cf. « Livré à A1 » après le découpage). Rédigé sur
`main` à `745c0a5` (Lot 8 clos), proposé puis tranché le même jour. Les
exports réels de VDB sont versés dans `frontend/tests/fixtures/vdb/` le même
jour (liste en fin de découpage). Les décisions
A1 à A8 sont des décisions de conception que les agents de couche reprendront
ou amenderont dans ce fichier. La forme suit `docs/lot8-plan-analyse.md`.

## Portée

La feuille de route (CLAUDE.md §12, point 12) donne au Lot 9 un objet :
**importer une decklist venue de VDB** (`github.com/smeea/vdb`) et en faire un
deck du compte, rattaché au modèle du Lot 4 (lignes carte × langue × extension,
discriminant tiré par le serveur). Elle laissait deux questions ouvertes, que
l'utilisateur a tranchées en P4 et P5 :

1. l'appariement d'une carte externe avec le catalogue (identifiant VEKN, ou
   nom, groupe et *advanced*), à écrire en fonction réutilisable ;
2. le sort d'une carte absente de la collection : pour ce lot, tout entre en
   proxy (P5).

Le lot fait en plus, par décision de l'utilisateur à A0 :

- **lire l'URL d'un deck VDB** (`vdb.im/decks/<id>`) par notre serveur (P1,
  P3), et **garder ce lien sur le deck** pour pouvoir le **mettre à jour**
  depuis VDB plus tard (P7, P8) ;
- **exporter un deck** et une version jouée au format texte de VDB, en
  fichier `.txt` (P9).

Ce que le lot ne fait pas :

- synchroniser un tournoi depuis Archon (après la mise en production de la v1,
  `docs/brief-archon.md`) ;
- importer une collection ou un inventaire depuis VDB, ni charger la TWDA
  (lot Inventaires) ;
- prendre des exemplaires au stock, acheter ou laisser une carte hors du deck
  à l'import (P5, après la mise en ligne et les premiers retours) ;
- mettre à jour un deck depuis une liste texte, ni lier après coup à VDB un
  deck créé autrement (P8) ;
- publier un lien vers une decklist (piste « lien public », Lot 11 au plus
  tôt).

### Report du lot Inventaires (décision du 2026-11-13)

Le lot Inventaires, placé jusqu'ici juste après ce lot, passe **après la
première mise en ligne** (Lot 11). Deux effets sur le Lot 9 :

- le seul autre consommateur prévu de l'appariement par le nom, l'import d'un
  inventaire VDB (A10 de `docs/lot-inventaires-plan.md`), s'éloigne. Le Lot 9
  écrit cet appariement là où il sert, dans le navigateur (P1), avec une table
  de cas que le lot Inventaires reprendra, en TypeScript ou dans un jumeau
  Python. La route serveur de ce lot ne fait que relayer des identifiants
  VEKN : elle n'apparie aucun nom ;
- un deck importé vit dans la collection unique d'aujourd'hui, comme tout
  deck. La migration du lot Inventaires le rattachera à l'inventaire principal
  avec les autres, cette fois sur la base de production.

### État de départ relevé le 2026-11-13

Base de développement `backend/vtes.db`, lue en lecture seule : révision
`ac6cda5ad252` (R13), 28 tables, 4212 cartes, données de recette.

Catalogue, mesuré avec la normalisation de VDB décrite plus bas :

- le triplet nom + groupe + *advanced* est unique (aucune collision) ;
- aucun nom de bibliothèque ne se répète, et aucun nom n'est porté à la fois
  par une carte de crypte et une carte de bibliothèque ;
- **15 noms de crypte ont deux versions non *advanced***, un vampire
  réimprimé dans un groupe récent. Les deux groupes sont toujours éloignés
  d'au moins trois, ce qui sert à P4 :
  - G1 et G6 : Gilbert Duane ;
  - G2 et G6 : Aisling Sturbridge, Dónal O'Connor, François Villon, Hesha
    Ruhadze, Kalinda, Nikolaus Vermeulen, Queen Anne, Tegyrius, Vizier,
    Theo Bell ;
  - G2 et G7 : Victoria Ash ;
  - G3 et G6 : Annabelle Triabell, Evan Klein, Mithras ;
  - G3 et G7 : Lucinde, Alastor ;
- 93 noms contiennent une lettre non ASCII. La décomposition de `fold_text` en
  ramène 88 à l'ASCII ; cinq restent : « Bang Nakh — Tiger's Claws »,
  « Bolesław Gutowski », « Clara Hjortshøj », « Przemysław, War Beast »,
  « Sacré-Cœur Cathedral, France » (A2).

Code :

- le miroir Dexie (`CardRow`, `offline/vtes/db.ts`) porte `veknId`, `name`,
  `foldedName`, `groupCode`, `advanced` et `latestCardSetId` : tout ce qu'il
  faut pour apparier **hors ligne** ;
- un deck se crée par `actions.createDeck` (une `client_ref`), puis une ligne
  par `actions.saveDeckCard` ; chaque action range **une** opération dans
  **sa propre** transaction (`Outbox.enqueue`, `offline/core/outbox.ts`) ;
- un deck a `name`, `notes` (texte libre, sans borne au contrat),
  `archetype` (un des six, Lot 8), `proxy_allowed` et `status` ; le
  discriminant est tiré par le serveur ;
- le `−` du deckbuilder baisse la quantité d'une ligne en gardant ses proxies
  dans la limite de la nouvelle quantité (`DeckComposition.tsx`) : il rend
  d'abord un exemplaire réel. À 1, il retire la ligne ;
- les tableaux de composition (`DeckTables`, `deckTablesModel.ts`) groupent
  déjà la bibliothèque par type, dans l'ordre que VDB utilise à l'export ;
- le serveur ne fait aujourd'hui aucun appel sortant pendant une requête. Le
  seul code qui lit le réseau est l'import du catalogue, par `urllib`
  (`services/catalog_import.py`) ; `httpx` n'est qu'une dépendance de
  développement.

Chiffres de départ : 2680 tests backend (2 `xfail`), 1163 tests vitest sur 73
fichiers, 82 e2e Playwright, 563 `data-testid` distincts, références CRAP
vides des deux côtés, 51 opérations sur 31 chemins au contrat.

## Ce que VDB produit (relevé du 2026-11-13)

Relevé dans le code source de VDB, branche `master` : côté client
`frontend/src/utils/exportDeck.js`, `importDeck.js`, `getDeckInUrl.js`,
`frontend/src/services/deckServices.js` et `frontend/.env` ; côté serveur
`backend/api.py` et `backend/routes/decks_routes.py`. Les formats texte ne sont
**pas** relevés sur de vrais fichiers : les exports réels demandés en fin de
plan seront versés tels quels dans les fixtures.

| Format VDB | Forme | Identifiant de carte |
| --- | --- | --- |
| `TEXT` | en-tête `Deck Name:`, `Author:`, `Description:` ; `Crypt (12 cards, min=… max=… avg=…)` souligné de `=` ; lignes de crypte en colonnes (`2x  Nom  6 FOO BAR  Titre  Clan:3`) ; `Library (90 cards)` puis un titre par type (`Master (15; 3 trifle)`) et des lignes `3x Nom` | non |
| `TWD`, `TWD_HINTS` | même corps que `TEXT`, précédé d'un en-tête d'événement entre crochets ou commenté par `#` | non |
| `JOL` | une ligne par carte, `2xNom`, sans en-tête | non |
| `LACKEY` | bibliothèque d'abord, une ligne `Crypt:`, puis la crypte ; quantité calée sur 8 caractères, nom en ASCII, `/` retirés des noms de bibliothèque | non |
| `XLSX` | deux feuilles, Crypt et Library, colonnes Quantity, Card… | non |
| URL avec la liste | `…/decks/deck?name=…&author=…&description=…#200001=2;100002=4` | **oui**, dans le fragment |
| URL d'un deck | `https://vdb.im/decks/<id>`, l'adresse d'un deck enregistré chez VDB, d'un deck de la TWDA ou d'un précon | oui, lue à l'API de VDB |

Dans tous les formats texte, un nom de crypte porte `(ADV)` pour un
*advanced* et `(G<n>)` pour la version **nouvelle** d'un vampire réimprimé ;
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

### L'API d'un deck VDB (vérifiée pour P2 et P3)

- **Adresse** : `https://vdb.im/api/deck/<id>` (`VITE_API_URL` de VDB vaut
  `https://vdb.im/api`). Le client de VDB ramène l'adresse d'un deck à
  `/decks/<9 premiers caractères>` ; l'identifiant d'un précon a la forme
  `extension:précon`, celui d'un deck de la TWDA est numérique.
- **Disponibilité** : la route `GET /api/deck/<id>` n'exige aucune connexion
  et ne regarde pas si le deck est caché ; elle répond **400** pour un
  identifiant inconnu (vérifié en direct : `V5:Ma` rend 400). Aucune limite de
  débit dans le code. API **non documentée** : rien ne promet qu'elle reste
  stable.
- **CORS** : `CORS(app, supports_credentials=True)`, sans liste d'origines.
  `flask-cors` renvoie alors l'origine de la requête : un navigateur peut
  l'appeler depuis n'importe quel site. La lecture depuis le navigateur est
  donc possible ; l'utilisateur a préféré le serveur (P3).
- **Ce qu'elle rend** : `name`, `author`, `description`, `cards` (un
  dictionnaire identifiant VEKN → quantité, crypte et bibliothèque mêlées),
  `tags`, `timestamp`, `deckid`, et des champs propres à VDB
  (`isNonEditable`, `publicParent`, `favorited`…). Pour un deck de la TWDA, la
  description est composée de la date, du nombre de joueurs, de l'événement
  et du lieu.
- **Relevé sur de vrais decks le 2026-11-13** (fixtures de l'utilisateur et
  lectures hors navigateur) : `cards` a pour clés des identifiants VEKN en
  texte et pour valeurs des entiers ; `deckid` est l'identifiant de l'adresse
  (9 caractères pour un deck d'utilisateur, `12761` pour la TWDA,
  `SV5:PCaine` pour un précon). Les trois genres répondent à l'API lue hors
  navigateur, précons compris. Un deck de la TWDA rend d'autres champs
  (`creation_date`, `sect`, `v5_crypt`, `v5_library`, sans `timestamp`) :
  `VdbDeckRead` ne lit que les champs communs. Ouverte **dans un onglet** du
  navigateur, l'adresse de l'API rend un 404 pour un deck d'utilisateur ;
  la réponse se relève alors dans l'onglet Réseau des outils de
  développement. Sans effet sur la route, qui lit l'API depuis le serveur.

## Décisions de l'utilisateur (A0, 2026-11-13)

### P1. Où se fait l'import

**Dans le navigateur pour une liste, sur le serveur pour un lien.**

- Un texte collé, un fichier `.txt` ou une URL avec la liste se lisent et
  s'apparient dans le navigateur, contre le miroir du catalogue, **hors
  ligne**. L'URL avec la liste est un lien, mais elle porte la liste
  elle-même : rien n'est à aller chercher, elle reste côté navigateur
  (interprétation à confirmer).
- L'URL d'un deck VDB se lit **par notre serveur**, en ligne seulement (P3).
  Hors ligne, l'écran d'import affiche un message d'information au lieu de
  l'aperçu : « Un lien VDB se lit en ligne. Hors connexion, collez le texte
  exporté depuis VDB (Exporter, puis Texte). »
- Dans les deux cas, le deck s'écrit par la file `/sync`, comme toute saisie
  (A4) : le serveur rend la liste, il ne crée pas le deck.

### P2. Formats acceptés

**Les trois entrées proposées, plus l'URL d'un deck VDB** :

- un texte collé, au format `TEXT`, `TWD`, `JOL` ou `LACKEY`, et plus
  généralement toute ligne « quantité, puis nom » ;
- un fichier `.txt`, lu par le même analyseur ;
- une URL avec la liste (`vdb.im/decks/deck?…#…`) ;
- **l'URL d'un deck** (`vdb.im/decks/<id>`), avec ou sans `https://`.

Informations disponibles, vérifiées : l'API rend le nom, l'auteur, la
description et les cartes **par identifiant VEKN**, sans ambiguïté de version
ni appariement par le nom ; ses étiquettes (`tags`) ne sont pas reprises,
l'archétype se choisissant à l'import (P7). L'URL avec la liste porte nom,
auteur, description et identifiants. Les formats texte ne portent que des
noms. Écartés : l'`XLSX` et l'URL d'Amaranth.

### P3. L'URL d'un deck VDB : par le serveur

**Par notre serveur**, choix de l'utilisateur alors que le navigateur aurait
pu l'appeler (CORS ouvert, relevé plus haut). Raisons retenues : un seul
endroit à adapter si l'API de VDB change ; délai, erreurs et limite de débit
gérés au même endroit ; et le lien gardé sur le deck (P7) est de toute façon
une donnée du serveur. Route, garde-fous et erreurs en A7.

### P4. Comment une ligne devient une carte

**Les règles 1 à 5 sont retenues telles quelles ; la règle 6 commence par
déduire le groupe du reste de la crypte.**

1. un identifiant (URL avec la liste, API) désigne la carte de même
   `vekn_id` ;
2. `(ADV)` désigne la version *advanced* du nom ;
3. un groupe, entre parenthèses (`(G6)`) ou en fin de ligne (`Clan:6`),
   désigne la version de ce groupe ;
4. un nom seul de bibliothèque désigne la carte de ce nom, unique ;
5. un nom seul de crypte qui n'a qu'une version non *advanced* la désigne ;
6. un nom seul de crypte qui en a deux (les 15 vampires réimprimés) :
   - **d'abord déduit** : on cherche les choix de version qui rendent la
     crypte légale (au plus deux groupes adjacents, les groupes « Any »
     neutres), avec les groupes des cartes déjà déterminées. Si toutes ces
     combinaisons donnent la même version à la ligne, elle est retenue et
     signalée « groupe déduit de la crypte » ;
   - **sinon, convention de VDB** : aucune combinaison légale, ou plusieurs
     qui se contredisent (une crypte faite seulement de vampires réimprimés,
     par exemple). La ligne prend la version d'origine, le plus petit
     identifiant VEKN, et le rapport dit « version supposée : G2 ; écrire
     (G6) pour l'autre ».

Le relevé du catalogue rend la déduction presque toujours concluante : les
deux versions d'un même vampire sont éloignées d'au moins trois groupes, si
bien qu'une seule des deux peut tenir avec n'importe quelle autre carte de
groupe connu. Le calcul énumère au plus 2^k combinaisons pour k lignes
ambiguës, k valant en pratique 0 à 2. Cette déduction ne vaut que pour les
formats texte : un identifiant n'est jamais ambigu.

Toute autre ligne qui commence par un chiffre est **non reconnue** et listée
avec son numéro et son texte, jamais devinée. Deux lignes qui désignent la
même carte s'additionnent. Écart volontaire à VDB : une ligne mal formée finit
au rapport, là où VDB lève une exception.

### P5. Une carte que je ne possède pas

**Pour ce lot, tout entre en proxy.** Le deck importé reçoit `proxy_allowed`,
et chaque carte une seule ligne entièrement jouée en proxy ; l'import ne prend
rien au stock et n'achète rien. L'utilisateur convertit ensuite des proxies en
exemplaires réels depuis le deckbuilder (conversion livrée au lot Affichage
des decks). Interprétation à confirmer : « importer en proxy autorisé » est
compris comme « toutes les lignes en proxy », ce que P6 et la règle de mise à
jour de P7 (« en ajoutant en proxy les nouvelles cartes ») confirment.

Une seconde passe, après la mise en ligne et les premiers retours, dira s'il
faut prendre au stock d'abord, acheter le manque ou laisser une carte hors du
deck (`docs/pistes-evolution.md`). Effet de bord utile : une ligne tout en
proxy ne demande rien à la collection, donc **un import ne peut pas être
refusé au rejeu pour exemplaires insuffisants**.

### P6. Langue et extension

**Anglais et dernière extension par défaut.** Chaque ligne prend la langue
choisie dans l'aperçu (EN présélectionné, puces de langue du Lot 5) et la
dernière version de la carte (`latest_card_set_id`, D2a du Lot 4), règle
actuelle d'une carte jouée en proxy.

### P7. Nom, notes, archétype, statut, lien gardé

- **nom** : la ligne `Deck Name:`, le paramètre `name` de l'URL ou le nom
  rendu par l'API, modifiable dans l'aperçu ; « Deck importé » à défaut ;
- **archétype** : choisi dans l'aperçu, parmi les six puces du Lot 8 ;
  facultatif comme partout ;
- **statut** : toujours brouillon ;
- **notes** : la description, précédée de « Auteur : … » s'il y en a un, et
  suivie de « Importé de VDB le 13 novembre 2026 ». **Pertinence à vérifier
  sur les exports réels** (D2) : une description de VDB peut être longue ou
  porter du Markdown, et celle d'un deck de la TWDA répète l'événement. La
  mention de la date d'import est inutile pour un deck lié, dont le détail
  montre le lien (A8) ;
- **lien gardé** : un deck importé depuis l'URL d'un deck VDB garde
  l'identifiant de ce deck **sur le serveur** (`deck.vdb_deck_id`, A6),
  l'adresse se reconstruisant à partir de lui. Il permet de **mettre à jour le
  deck depuis VDB** :
  - le deck repasse en **brouillon** et garde `proxy_allowed` ;
  - une carte nouvelle entre **en proxy**, en EN et dernière extension (P6) ;
  - une carte dont la quantité augmente, sur une seule ligne : la hausse
    s'ajoute en proxies sur cette ligne ;
  - une carte dont la quantité baisse, sur une seule ligne (une seule langue
    et extension, **pas de conflit**) : la ligne **diminue normalement**,
    comme le `−` du deckbuilder (exemplaires réels rendus d'abord), et
    disparaît à 0 ;
  - une carte dont la quantité change alors que le deck la joue sur
    **plusieurs lignes** (plusieurs langues ou extensions, **conflit**) : ses
    lignes sont **retirées** et refaites en **une seule ligne en proxy** à la
    nouvelle quantité, et un **message** le dit (« Theo Bell (G2) : 2 lignes
    remplacées par 3 proxies, les exemplaires réels ont été rendus à la
    collection ») ;
  - une carte retirée chez VDB est retirée du deck ;
  - une carte inchangée n'est pas touchée, quelle que soit sa répartition ;
  - nom, notes et archétype ne bougent pas : ce sont des saisies locales.

  La mise à jour montre ce qui va changer avant d'écrire. Elle est refusée
  pour un deck archivé (« Désarchivez le deck pour le mettre à jour ») et
  n'existe pas pour un deck supprimé. Les versions jouées (Lot 8) ne bougent
  pas : seule la liste vivante change, et la prochaine partie la figera.

### P8. Importer dans un deck existant

**Seulement par le lien gardé ; sinon, toujours un deck neuf.** Coller l'URL
d'un deck VDB déjà lié à un deck vivant du compte propose de **mettre à jour**
ce deck (P7), plutôt que d'en créer un second. Un texte ou une URL avec la
liste crée toujours un deck neuf, non lié : ils ne portent aucun identifiant
de deck VDB.

### P9. Export

**Export texte seulement** : le format `TEXT` de VDB, que VDB relit et qu'un
humain lit sans peine, avec **« Copier »** et **« Télécharger (.txt) »**
(bouton Copier confirmé par l'utilisateur le 2026-11-13). Depuis le détail
d'un deck et depuis la liste d'une version jouée
(`#/decks/<clé>/versions/<n>`, Lot 8). Pas d'autre format (`TWD`, `JOL`,
`LACKEY`).

**Limite notée : le presse-papiers exige HTTPS.** `navigator.clipboard`
n'existe que dans un contexte sécurisé ; en `http://` sur l'adresse du réseau
local, comme pendant les vérifications sur téléphone jusqu'au Lot 11, le
bouton se replie sur la sélection du texte et le téléchargement (A5). La
copie ne se vérifiera vraiment sur téléphone qu'après la mise en ligne.

L'aller-retour (exporter, réimporter, retrouver la même liste carte ×
quantité) reste le meilleur test de l'import.

### P10. Design

**Pas de handoff Claude Design.** Les écrans se construisent avec les
composants existants, en mobile et en bureau, et se valident sur captures à
390 et 1440px.

## Décisions de conception

### A1. Analyseur pur

`frontend/src/features/decks/import/parseDecklist.ts` : un texte devient un
en-tête (nom, auteur, description), une suite de lignes lues (numéro, texte
d'origine, quantité, nom, *advanced*, groupe, section Crypt ou Library quand le
texte en a une) et une liste de lignes ignorées. Chaque forme de ligne est une
petite fonction d'une table essayée dans l'ordre de P4, sans `switch`, pour
tenir les références CRAP vides.

`parseVdbUrl` reconnaît les deux formes d'URL : avec la liste, il rend la même
structure que l'analyseur, avec les identifiants ; pour l'URL d'un deck, il
rend seulement l'identifiant, validé par le même motif que le serveur (A7). Le
navigateur n'envoie jamais une URL entière au serveur.

Écart volontaire à VDB : une ligne qui commence par un chiffre et ne se lit
pas est **rapportée**, pas ignorée ni fatale. Les lignes de titre (`Crypt (…)`,
`Master (15; 3 trifle)`, soulignements, en-têtes `#` de `TWD_HINTS`) sont
ignorées sans bruit.

### A2. Appariement pur, sur une table de cas

`matchDecklist(lines, index)`, avec `buildCardIndex(cards)` qui range le miroir
par identifiant VEKN et par nom minifié, groupe et *advanced*. Rend des cartes
appariées (carte, quantité, et comment : identifiant, nom, groupe déduit,
version supposée) et des lignes non reconnues avec leur motif. La déduction de
la règle 6 est une fonction à part, `resolveReprintedVampires(matched,
ambiguous)`, qui réutilise le calcul des groupes de crypte de la légalité
(jumeau client des fonctions de `vtes_rules.py`, à reprendre ou à écrire sur
la même règle).

La minification reprend celle de VDB sur `foldText` (A4 du lot Chercher), plus
une petite table pour les lettres qui ne se décomposent pas (ł, ø, œ, tiret
cadratin) : les cinq noms relevés plus haut sont des cas de la table. La
coupure après `--` de VDB est reprise pour que « Bang Nakh -- Tiger's Claws »,
forme ASCII probable des exports `LACKEY`, retrouve sa carte.

La table de cas vit dans `frontend/tests/fixtures/vdb-import-cases.json`, au
format des tables communes du projet, pour qu'un jumeau Python puisse s'y
tester au lot Inventaires. Les exports réels vont dans
`frontend/tests/fixtures/vdb/`. La déduction et la version supposée (P4) sont
des conventions, pas des règles VEKN : l'architecte-contrat relit la table
(étape A1), comme pour toute règle de jeu.

### A3. Plans purs : import et mise à jour

- `planDeckImport(matched, choices)` rend ce qui sera écrit : les champs du
  deck (nom, notes, archétype, `proxy_allowed` à vrai, statut brouillon,
  `vdb_deck_id` s'il y a lieu), une ligne tout en proxy par carte (langue
  choisie, `latestCardSetId`) et un résumé (cartes, proxies, lignes non
  reconnues, groupes déduits, versions supposées). Sans stock pris (P5), il
  ne dépend d'aucune disponibilité.
- `planDeckRefresh(deckLines, vdbCards, choices)` compare, carte par carte, la
  liste vivante du deck à celle de VDB et rend les écritures (lignes à
  modifier, à retirer, à refaire en proxy), le passage en brouillon et les
  messages de conflit, selon les règles de P7. Chaque cas (nouvelle,
  hausse, baisse sans conflit, conflit, retirée, inchangée) est une fonction
  d'une table, couverte par une table de cas. La baisse sans conflit réutilise
  le calcul du `−` du deckbuilder, sorti en fonction pure s'il ne l'est pas.
  Le plan se recalcule au moment d'« Appliquer », sur la liste du deck à cet
  instant.

### A4. Une écriture, une transaction de la file

Créer un deck de 90 cartes, c'est une création et 40 à 70 lignes. Écrites
action par action, une fermeture d'onglet au milieu laisserait un deck à
moitié rangé dans la file. Même chose pour une mise à jour. Donc :

- le cœur générique gagne `Outbox.enqueueAll(operations)`, qui range
  plusieurs opérations, dans l'ordre, en **une** transaction IndexedDB, avec
  les mêmes contrôles qu'`enqueue` (clé déjà vue, `client_ref` déjà prise).
  Rien n'y nomme un deck : c'est un geste générique, utile à Barrin dès qu'une
  saisie produit plusieurs opérations (README du paquet offline à compléter) ;
- l'adaptateur `vtes/` gagne `actions.importDeck(plan)` (un `deck.create`
  puis les `deck_card.upsert`, reliés par la `client_ref`) et
  `actions.refreshDeck(plan)` (un `deck.update` pour le statut, puis les
  `deck_card.upsert` et `deck_card.delete`), rangés par `enqueueAll`.

Aucun type d'opération `/sync` nouveau. Écarté : un `deck.import` ou un
`deck.refresh` atomique côté serveur, qui doubleraient les opérations
existantes pour un cas que la politique de conflit du Lot 3 couvre déjà.

### A5. Export pur

`exportVdbText(deck, lines, facts)` produit le format `TEXT` de VDB à partir
des groupes de `deckTablesModel.ts` (crypte par capacité, bibliothèque par
type, titres avec leurs comptes et les *trifles*). La version jouée s'exporte
par la même fonction, depuis `deckVersionModel.ts`. Les colonnes de crypte
suivent la mise en page de VDB, pour qu'un texte exporté chez nous et un texte
exporté par VDB se ressemblent ligne à ligne. Le fichier se nomme d'après le
deck (`Banu Princes#1234.txt`, caractères interdits remplacés), et la version
d'après son numéro (`… v2.txt`).

**Copier** passe par `navigator.clipboard.writeText`. Hors contexte sécurisé
(`window.isSecureContext` faux) ou en cas de refus, le bouton sélectionne le
texte affiché et dit « Copie impossible sans HTTPS : texte sélectionné,
copiez-le à la main ou téléchargez le fichier ». Le repli est une petite
fonction testée sans navigateur.

### A6. Le lien sur le deck : contrat et migration

- **Modèle** : `deck.vdb_deck_id`, texte nullable de 64 caractères au plus.
  Pas d'index ni d'unicité : le serveur ne cherche jamais un deck par ce
  champ, et le client le retrouve dans son miroir. Deux decks liés au même
  deck VDB restent possibles en théorie (deux appareils hors ligne) ; l'écran
  d'import propose alors le plus récent.
- **Révision R14** : un `ADD COLUMN` nullable sur `deck`, sans recréer la
  table, sur le patron de R12. La montée se rend hors ligne (`--sql`). La
  descente **refuse de tourner** (`RuntimeError`, valeurs citées) s'il existe
  un deck lié : le lien est une donnée de l'utilisateur, contrairement à
  l'exigence de R12 qu'un réimport rétablissait.
- **Contrat** : `vdb_deck_id` dans `DeckCreate` (facultatif, même motif que la
  route, 422 sinon) et dans `DeckRead` (obligatoire en sortie, nullable). Pas
  dans `DeckUpdate` : ni lien après coup ni « délier » dans ce lot. Par
  `/sync`, `deck.create` reprend le schéma de la route : le champ y est
  facultatif, une opération écrite avant le lot se rejoue avec la même
  empreinte (`exclude_unset`, comme au Lot 8).
- **Miroir** : `DeckRow.vdbDeckId`, rempli par le rafraîchissement des decks.
  Champ non indexé, donc **pas de version Dexie** : une ligne lue avant le lot
  n'a pas le champ et se lit « non lié » jusqu'au rafraîchissement suivant.

### A7. La route de lecture d'un deck VDB

- **`GET /vdb/decks/{vdb_deck_id}`** (`readVdbDeck`), sous session comme toute
  route métier. Elle va chercher `https://vdb.im/api/deck/{vdb_deck_id}` et
  rend `VdbDeckRead` : `vdb_deck_id` (celui que rend VDB), `name`, `author`,
  `description`, `cards` (liste de `{vekn_id, quantity}`, par identifiant
  croissant) et `fetched_at`. Elle ne stocke rien et n'apparie rien : les
  identifiants VEKN inconnus du catalogue sont rapportés par le navigateur
  (A2, règle 1).
- **Garde-fous** : hôte et chemin fixés dans le code, identifiant validé par
  un motif fermé (lettres, chiffres, `:`, `-`, `_`, 64 au plus, à confirmer
  sur de vrais identifiants à A1), si bien que la route ne peut pas servir à
  joindre une autre adresse. Délai de 10 s. Limite de débit `slowapi`,
  surchargeable (`VDB_RATE_LIMIT`, 20 par minute par défaut). Réponse de VDB
  bornée en taille avant lecture du JSON.
- **Erreurs** : 404 (`ErrorResponse`, « Deck VDB introuvable. ») quand VDB
  répond 400 ou 404 ; **502** quand VDB est injoignable, dépasse le délai ou
  rend une réponse inattendue (forme, type, quantité hors bornes) ; 429 avec
  `Retry-After` au-delà de la limite. Aucun 5xx de VDB ne remonte tel quel.
- **Client HTTP** : `urllib`, comme l'import du catalogue, derrière une
  fonction de lecture injectable (`services/vdb_client.py`) que les tests
  remplacent ; aucun test ne joint vdb.im. `httpx` reste une dépendance de
  développement.
- **Service worker** : `/vdb` rejoint `API_ROUTE_PREFIXES`, sans quoi le
  service worker servirait la coquille à la place de la réponse (§11,
  Lot 0). Contrat à 52 opérations sur 32 chemins ; la matrice d'autorisation
  gagne la route.

### A8. Ce qui ne change pas

Aucun type d'opération `/sync`, aucune version Dexie, aucune règle de
légalité. Les changements hors de `features/` sont `enqueueAll` dans
`offline/core/`, `importDeck` et `refreshDeck` dans `offline/vtes/`, le champ
`vdbDeckId` du miroir et le préfixe `/vdb` ; côté serveur, la route A7, le
champ et la révision A6.

## Écrans (frontend-react)

En mobile puis en bureau :

1. **Entrée** : « Importer depuis VDB » à côté de « Nouveau deck », dans la
   liste des decks (bouton au bureau, feuille « Nouveau deck » au mobile), et
   par l'intention de route `#/decks?action=importer`, sur le patron du Lot 5c.
2. **Feuille d'import, étape 1** : un champ de texte où coller une liste ou une
   URL, un bouton pour choisir un fichier `.txt`, et ce qui a été reconnu dit
   en clair (« Format texte de VDB, 12 cartes de crypte, 90 de
   bibliothèque », « Lien vers un deck VDB »). Pour un lien, hors ligne : le
   message de P1 à la place de l'aperçu ; en ligne, la lecture par le serveur,
   puis l'aperçu. Un lien déjà lié à un deck vivant mène à la mise à jour
   (écran 4).
3. **Feuille d'import, étape 2 (aperçu)** : nom, archétype, langue des
   proxies, l'effet écrit (« 102 cartes en proxy : le deck autorisera les
   proxies ») ; la composition dans `DeckTables` en lecture seule ; un rapport
   replié des lignes non reconnues, des groupes déduits et des versions
   supposées, avec leur numéro de ligne. « Créer le deck » ouvre le
   deckbuilder du deck créé.
4. **Mise à jour depuis VDB** : action « Mettre à jour depuis VDB » d'un deck
   lié (actions du détail au mobile, en-tête du deckbuilder au bureau),
   grisée hors connexion avec la même explication. Elle lit le deck VDB puis
   montre les changements par carte (ajoutées, augmentées, diminuées,
   retirées, refaites en proxy avec leur message) et le passage en brouillon ;
   « Appliquer » écrit, « Rien à mettre à jour » si les listes sont
   identiques. Le détail d'un deck lié montre le lien vers VDB.
5. **Feuille d'export** : depuis les actions du deck (mobile), l'en-tête du
   deckbuilder (bureau) et la liste d'une version : le texte, puis « Copier »
   et « Télécharger (.txt) ».

## Découpage en étapes ordonnées

| Étape | Agent | Contenu | Dépend de |
| --- | --- | --- | --- |
| A0 | utilisateur, orchestrateur | P1 à P10 tranchées (fait le 2026-11-13) ; exports réels fournis (voir ci-dessous) | rien |
| A1 | architecte-contrat | contrat (route A7, `VdbDeckRead`, `vdb_deck_id` dans `DeckCreate`, `DeckRead` et `deck.create`), révision R14, motif de l'identifiant, relecture de la table de cas d'appariement (déduction et version supposée), `docs/lot3-sync-contrat.md` — **fait le 2026-11-13** (cf. « Livré à A1 ») | A0 |
| B1 | backend-fastapi | `services/vdb_client.py`, route, limite de débit, erreurs, `vdb_deck_id` à la création et en lecture, tests (lecture simulée, matrice d'autorisation, rejeu d'une `deck.create` d'avant le lot) ; relevé de la réponse réelle sur un deck de l'utilisateur | A1 |
| C1 | pwa-offline | `Outbox.enqueueAll`, `actions.importDeck` et `refreshDeck`, `vdbDeckId` au miroir, préfixe `/vdb`, README du paquet offline | A1 |
| D1 | frontend-react | analyseur, appariement avec déduction, plans d'import et de mise à jour (A1 à A3), en fonctions pures sur les tables de cas | A1 |
| D2 | frontend-react | écrans d'import (texte, fichier, URL avec la liste, URL d'un deck), mobile et bureau ; pertinence des notes sur les exports réels | B1, C1, D1 |
| D3 | frontend-react | mise à jour depuis VDB, mobile et bureau | D2 |
| D4 | frontend-react | export (A5) et sa feuille, Copier et Télécharger, depuis un deck et depuis une version | D1 |
| E | qa-tests | tests, e2e aux deux largeurs, CRAP, recensement des `data-testid` | D2, D3, D4 |
| F | orchestrateur | vérification sur téléphone, CLAUDE.md, pistes | E |

Exports à fournir avant D1, depuis le compte VDB de l'utilisateur, copiés
tels quels (sans retouche, en UTF-8), un fichier par export, versés dans
`frontend/tests/fixtures/vdb/`. Ces fichiers seront commités : nom d'auteur et
description y figureront.

1. **Deck de référence**, un vrai deck complet (crypte d'au moins 12,
   bibliothèque de 60 à 90, plusieurs types de bibliothèque dont des masters
   *trifle*), avec un auteur et une description de plusieurs lignes :
   `ref-text.txt` (`TEXT`), `ref-twd.txt` (`TWD`), `ref-twd-hints.txt` (`TWD`
   avec indications), `ref-jol.txt` (`JOL`), `ref-lackey.txt` (`LACKEY`),
   `ref-urls.txt` (l'URL avec la liste, puis l'URL du deck), `ref-api.json`
   (la page `https://vdb.im/api/deck/<id>` enregistrée telle quelle).
2. **Deck des cas difficiles**, un deck de test sans souci de légalité, qui
   contient : un vampire *advanced* ; un vampire réimprimé dans sa version
   récente (VDB écrit `(G6)`) et un autre dans sa version d'origine (sans
   marque), par exemple Theo Bell G6 et Dónal O'Connor G2 ; un vampire de
   groupe « Any » ou un *imbued* ; une ou plusieurs cartes à lettre
   spéciale (Bolesław Gutowski, Clara Hjortshøj, Przemysław, War Beast,
   Sacré-Cœur Cathedral, France, Bang Nakh — Tiger's Claws) ; une carte dont
   le nom commence par « The » ; une carte en plusieurs exemplaires. Mêmes
   sept fichiers, préfixe `difficile-`.
3. **Mise à jour** : le deck 2 lui-même, modifié dans VDB (`maj-url.txt`) :
   sa réponse d'API avant modification (`maj-avant-api.json`, mêmes cartes
   que `difficile-api.json`), puis après l'ajout de Theo Bell (G6) et de
   Sacré-Cœur Cathedral, France, le retrait de Torn Signpost, Pursuit passé de
   6 à 4 et Blur de 2 à 3 (`maj-apres-api.json`, différences vérifiées le
   2026-11-13). Restent facultatifs `maj-apres-text.txt` et
   `maj-apres-lackey.txt`, les exports texte de l'état « après », qui
   montreraient comment VDB écrit un vampire réimprimé marqué et une lettre
   spéciale, cas que le deck 2 n'a pas ; à défaut, la table de cas les écrit
   d'après le code de VDB.
4. **Identifiants** : l'URL et la réponse de l'API d'un deck de la TWDA et
   d'un précon ouverts dans VDB : `twda-url.txt`, `twda-api.json`,
   `precon-url.txt`, `precon-api.json`.
5. **Facultatif** : une liste venue d'ailleurs (export d'Amaranth, liste de
   tournoi recopiée de vekn.net), pour l'analyseur tolérant :
   `autre-source.txt`.

B1, C1 et D1 avancent en parallèle après A1 ; D4 ne dépend que des fonctions
pures.

### Livré à A1 (2026-11-13)

- **Modèle et R14** : `deck.vdb_deck_id`, `VARCHAR(64)` nullable, sans index,
  sans unicité ni CHECK (`app/models/collection.py`). Révision `5f2b8e9d0c41`
  (`migrations/versions/20261113_5f2b8e9d0c41_lien_vdb_sur_le_deck.py`) : un
  `ADD COLUMN` sur le patron de R12, sans conversion ; montée hors ligne
  possible. Écart à A6 : le motif n'est pas un CHECK en base, qui aurait
  obligé à recréer `deck` (quatre clés étrangères la visent) ; il est tenu par
  le schéma, seul chemin d'entrée. La descente refuse de tourner dès qu'un deck
  est lié, en citant les dix premiers (nom#discriminant, identifiant, deck
  VDB) et le nombre des autres ; comme celles de R10 et R13, **elle ne se rend
  pas hors ligne**, sa garde lisant la base. 28 tables, quatorze révisions.
- **Motif de l'identifiant** : `^[A-Za-z0-9:_-]{1,64}$`
  (`app/schemas/vdb.py`, `VDB_DECK_ID_PATTERN`), confirmé sur les identifiants
  réels des fixtures (`4fc0ee5e9`, `b4a7ee6d5`, `31203cb9e`, `6cd179ff5`,
  `12761`, `SV5:PCaine`). Ni rognage ni repli : `/`, `.`, `?`, `#`, `%`, une
  espace ou une adresse entière sont refusés, si bien que la route ne peut
  joindre que `https://vdb.im/api/deck/<id>`.
- **Schémas et contrat** : `vdb_deck_id` facultatif dans `DeckCreate` (donc
  dans `deck.create`), obligatoire et nullable dans `DeckRead`, absent de
  `DeckUpdate` ; `VdbDeckRead` (`vdb_deck_id`, `name`, `author` et
  `description` nullables, `cards` en `VdbDeckCardRead` — `vekn_id`,
  `quantity` ≥ 1 —, `fetched_at`). Route `GET /vdb/decks/{vdb_deck_id}`
  (`readVdbDeck`, `app/routers/vdb.py`) déclarée avec 401, 404, 422, 429
  (`Retry-After`) et 502 (`BAD_GATEWAY`, `app/routers/common.py`). Contrat à
  **52 opérations sur 32 chemins**, client TS régénéré. Comme `Deck(**data)`
  recopie le schéma, le lien est déjà enregistré à la création et rendu en
  lecture, en ligne comme par `/sync` : il ne reste à B1 que la lecture chez
  VDB.
- **Garde provisoire** : le corps de la route rend **501** (« Lecture d'un
  deck VDB pas encore livrée (Lot 9, étape B1). »), après le contrôle de
  session et du motif. **À retirer à B1**, avec son test
  (`test_the_route_is_a_provisional_501_until_b1`).
- **`/vdb` dans `API_ROUTE_PREFIXES`** (`frontend/src/offline/apiRoutes.ts`),
  pris à C1 pour garder vert le test vitest qui compare la liste au contrat ;
  le README du paquet offline reste à C1. `tsc` propre après régénération du
  client.
- **Table de cas d'appariement** : `frontend/tests/fixtures/vdb-import-cases.json`,
  écrite à A1 plutôt que relue, faute d'exister encore. Elle fixe la forme
  d'une ligne lue (`line`, `quantity`, puis `vekn_id`, ou `name`, `advanced`
  et `group` en `G1`…`G7`/`Any`), la clé de nom (`minify`, 16 cas), et 30 cas
  d'appariement : identifiant, *advanced*, groupe écrit, `Any`, « The » de
  tête aux deux écritures, cinq noms à lettres spéciales sous leurs deux
  écritures, casse, lignes doublées, motifs `unknown_vekn_id`,
  `unknown_name`, `no_such_version`, et douze cas de la règle 6 (déduction
  pour G2, G6, G1/G6, G3/G7, Any neutre, groupe écrit ou *advanced* qui fixe
  la crypte, deux lignes ambiguës, un même vampire sur deux lignes ; version
  supposée pour un vampire seul, une crypte de seuls réimprimés, une crypte
  déjà illégale). Elle porte un extrait du catalogue avec toutes les versions
  des noms employés.
- **Relecture des conventions** (déduction et version supposée), tranchée
  sur une implémentation de référence jetable, contre le catalogue complet de
  la base de développement (4212 cartes) : les 30 cas donnent le même
  résultat sur l'extrait et sur le catalogue ; la clé de nom ne fait **aucune
  collision** (triplet clé + groupe + *advanced* unique en crypte, clé unique
  en bibliothèque, aucune clé partagée entre crypte et bibliothèque), et la
  table des lettres se réduit à ł, ø, œ et aux tirets longs, seul « Bang Nakh
  — Tiger's Claws » portant un tiret. Précisions apportées à P4 : la
  déduction se tranche **nom par nom** (un nom peut être déduit pendant qu'un
  autre est supposé) ; les lignes d'un même nom ambigu partagent un choix ;
  les lignes non reconnues et la bibliothèque n'entrent pas dans le calcul ;
  un nom de bibliothèque qui porte *advanced* ou un groupe est
  `no_such_version`. Les exports `JOL` et `LACKEY` des decks de référence et
  difficile, lus sommairement, retrouvent **exactement** la liste de leur
  `*-api.json`, sans ligne non reconnue : aucune divergence de nom entre VDB
  et krcg sur ces deux decks (dont « Sargon Fragment, The » contre « The
  Sargon Fragment » de krcg).
- **Tests** : `backend/tests/test_lot9_contract.py` (motif sur les
  identifiants réels et 13 refus, lien en ligne et par `/sync`, `PATCH`
  refusé, lien partagé par deux decks, lot refusé en 422, empreinte et rejeu
  d'une `deck.create` d'avant le lot, forme du contrat, garde provisoire) ;
  section « Lot 9 » de `test_migrations.py` (colonne, ni table ni index,
  base peuplée conservée, descente sans lien, descente refusée et message
  borné à dix decks, aller-retour, rendu hors ligne de la montée seulement) ;
  matrice d'autorisation, opérations attendues et compte du contrat portés à
  52 ; `test_a_populated_lot6_database_crosses_r10_and_r11_without_loss`
  compare désormais `deck` à la tête sans sa colonne nouvelle. **2732 tests
  backend verts et les 2 `xfail` connus**, `ruff check` propre, aucune
  régression CRAP ; `tsc`, lint et les vitest du contrat et des préfixes verts
  (suite vitest complète et e2e non relancés : aucun code du front ne change
  hors `apiRoutes.ts` et du client généré).
- **Base de développement** : `backend/vtes.db` n'a pas été migrée. L'API
  refuse de démarrer tant qu'elle n'est pas à `5f2b8e9d0c41`
  (`schema_check.py`) : `uv run alembic upgrade head` depuis `backend/`, après
  avoir vérifié `DATABASE_URL`.

## Tests attendus (E)

- **Fonctions pures** (vitest) : analyseur sur chaque export réel et sur la
  table de cas (en-têtes, titres de section ignorés, lignes non reconnues
  rapportées avec leur numéro, deux formes d'URL, identifiant refusé par le
  motif) ; appariement (identifiant, *advanced*, groupe entre parenthèses et
  après deux-points, groupe `ANY`, cinq noms à lettres spéciales, « The » de
  tête, lignes doublées additionnées, carte inconnue) ; **déduction** sur les
  15 vampires (crypte qui tranche pour G2, pour G6, crypte faite seulement de
  vampires réimprimés, crypte déjà illégale, deux lignes ambiguës) ; plan
  d'import (toutes les lignes en proxy, langue choisie, dernière extension,
  `proxy_allowed`) ; **plan de mise à jour**, un cas par règle de P7 et leurs
  combinaisons ; export (`TEXT` conforme, version jouée, nom de fichier,
  repli de « Copier » hors contexte sécurisé) ;
  **aller-retour** export puis import sur une liste qui couvre crypte,
  *advanced* et tous les types de bibliothèque.
- **Couche offline** : `enqueueAll` (ordre, une transaction, refus en bloc
  sur une clé déjà vue, diffusion inter-onglets) ; `importDeck` et
  `refreshDeck` (`client_ref` partagée, statut brouillon).
- **Back** (pytest) : route (succès, 404, 502 sur délai, réponse mal formée
  et quantité hors bornes, 429, motif refusé en 422, 401 sans session) avec
  une lecture simulée ; `vdb_deck_id` à la création, en ligne et par `/sync`,
  et rejeu à l'identique d'une `deck.create` d'avant le lot ; R14 en montée,
  descente et descente refusée ; matrice d'autorisation à 52 opérations.
- **e2e contre le vrai back, aux deux largeurs** : coller un export `TEXT`
  hors ligne ; créer le deck en proxy ; recharger hors ligne ; revenir en
  ligne, rejouer ; le deck est au serveur et sa légalité se lit. Lien VDB
  hors ligne : le message s'affiche. Mise à jour d'un deck lié, avec la
  lecture VDB simulée côté serveur (réglage de test, jamais vdb.im) : une
  carte ajoutée en proxy, une ligne en conflit refaite avec son message.
  Exporter la liste d'une version jouée et retrouver le fichier.
- **Non-régression** : références CRAP vides, aucun `data-testid` disparu
  (`testid-census.mjs`, nouvelle référence de clôture).

## Risques et points d'attention

- **L'API de VDB n'est pas documentée.** Elle peut changer ou fermer sans
  prévenir. Tout passe par `services/vdb_client.py`, une réponse inattendue
  rend un 502 lisible, et l'import par le texte reste toujours possible.
- **Premier appel sortant pendant une requête.** Délai, limite de débit et
  motif fermé de l'identifiant (A7) ; l'appel bloque un fil d'uvicorn pendant
  au plus 10 s, acceptable pour un usage rare.
- **Le format réel des exports.** Les formats texte s'appuient sur le code de
  VDB, pas sur des fichiers. Rien n'est codé avant les exports demandés plus
  haut. L'analyseur tolérant (« quantité, puis nom ») limite la casse.
- **Noms divergents.** VDB tire ses noms de vtescsv, le catalogue de krcg ;
  l'import du lot Chercher a déjà vu des écarts. Toute ligne qui ne s'apparie
  pas est rapportée, et chaque écart trouvé devient un cas de la table.
- **La version supposée** (P4, règle 6) ne joue plus que si la crypte ne
  tranche pas ; le rapport le dit, ligne à ligne.
- **Une mise à jour en conflit rend des exemplaires réels** à la collection :
  voulu (P7), dit par le message avant d'appliquer.
- **Deux appareils.** Une mise à jour préparée sur un appareil pendant que
  l'autre retouche le deck : la file fait foi, le dernier arrivé gagne ligne
  par ligne. Le plan se recalcule à « Appliquer » sur le miroir de l'appareil.
- **Le presse-papiers hors HTTPS** (P9) : « Copier » se replie sur la
  sélection du texte tant que le téléphone ouvre l'application en `http://` ;
  la copie réelle se vérifie après le Lot 11.
- **Decks tout en proxy.** Un deck importé est jouable tout de suite dans un
  tournoi qui accepte les proxies, et seulement là ; la conversion se fait à la
  main. À revoir avec les retours après la mise en ligne (P5).
- **Score CRAP.** Analyseur, appariement et plan de mise à jour sont des
  tables de petites fonctions ; l'écran d'aperçu et celui de mise à jour sont
  à découper en sous-composants dès le départ.

## Critère de fin de lot

- Exports réels versés dans les fixtures ; réponse réelle de l'API relevée.
- Un deck s'importe depuis un texte VDB (`TEXT`, `TWD`, `JOL`, `LACKEY`), un
  fichier `.txt` ou une URL avec la liste, hors ligne, et depuis l'URL d'un
  deck VDB, en ligne ; en mobile et en bureau ; tout en proxy, avec un
  rapport des lignes non reconnues, des groupes déduits et des versions
  supposées.
- Un deck importé par son URL se met à jour depuis VDB selon les règles de
  P7 ; un deck s'exporte au format `TEXT`, copié ou téléchargé en `.txt`,
  depuis le deck et depuis une version jouée.
- Contrat à 52 opérations sur 32 chemins, R14 (28 tables, quatorze
  révisions), aucun type `/sync` nouveau, aucune version Dexie ;
  `enqueueAll` documenté dans le README du paquet offline.
- `uv run pytest` vert hors les deux `xfail` connus, `ruff check` propre ;
  `npm run lint`, `npx tsc --noEmit -p tsconfig.app.json`, `npm run test` et la
  suite Playwright verts ; références CRAP vides.
- Vérification sur téléphone : coller une liste en mode avion, créer le deck,
  sortir du mode avion, voir le deck synchronisé ; importer un lien VDB et le
  mettre à jour ; exporter une liste et la recoller dans VDB.
- CLAUDE.md mis à jour (en-tête, §6, §7, §11, §12) ; pistes mises à jour
  (export, seconde passe de P5, lier et délier un deck VDB).
