# Lot 13 — Partage (v1.2) : plan d'implémentation

Statut : **proposé le 2026-11-20, P1 à P10 tranchées le même jour (A0)**,
décisions de conception reprises en conséquence ; **A1, B1, B2, C1, D1, D2,
D3 et D4 livrées le 2026-11-20** (cf. « Livré à … » et « Vérification
d'intégration après B1, B2 et C1 »), A1, D1 et D4 commitées (`a33e5e6`), B1,
B2 et C1 (`236b9b7`) ; D2 et D3 corrigées après relecture des captures ;
**D5 et D6 à venir**. Rédigé sur la
branche `lot13-partage`, ouverte depuis `main` à `ddb2cf3` (v1.1.0 en
production depuis le 2026-11-20). Le Lot 12 n'est pas tout à fait clos : deux
relevés de F attendent le 2026-11-21 (renouvellement d'une session de plus de
24 heures, sauvegarde de la nuit recopiée par `fetch_backups.sh`), et sa
clôture dans CLAUDE.md reste à écrire. Rien de ce plan n'en dépend. Les
décisions A1 à A12 sont des décisions de conception que les agents de couche
reprendront ou amenderont dans ce fichier. La forme suit
`docs/lot12-plan-consolidation.md`.

## Portée

La feuille de route (CLAUDE.md §12, point 15, et
`docs/roadmap-v2-proposition.md`) donne au Lot 13 trois sujets, indépendants
des inventaires, d'où sa place avant eux (V4) :

- **un lien public vers une decklist**, vivant ou figé, qui s'ouvre sans
  compte et montre la liste en lecture seule ; conception de départ et cinq
  points ouverts dans `docs/pistes-evolution.md` (section « Lien public vers
  une decklist ») ; A0 y a ajouté « Dupliquer », « Comparer » et « Réviser »
  depuis la page publique ;
- **l'export aux formats `TWD`, `JOL` et `LACKEY` de VDB**, à côté du `TEXT`
  livré au Lot 9 ;
- **l'art de l'extension dans la Collection** : l'image de l'impression de
  l'exemplaire, et non plus l'image générique de la carte, front seul.

Ce que le lot ne fait pas :

- pas de partage de la collection, d'un inventaire, d'une partie ni d'un bilan :
  seulement des decklists ;
- pas de deck modifiable à plusieurs, pas de commentaire sur la page publique,
  pas de compteur de consultations ;
- pas de comparaison d'une liste partagée avec la collection (« ce qui me
  manque ») : c'est la liste des manques du Lot 17 ;
- pas d'image par langue dans la Collection : krcg ne publie pas de scan par
  extension et par langue (écarté par l'utilisateur le 2026-11-12) ;
- pas d'export `XLSX` ni d'export vers Amaranth ;
- rien des inventaires (Lot 14) ni des retours d'usage (V5), qui courent en
  parallèle.

### État de départ relevé le 2026-11-20

Production : v1.1.0 servie depuis le 2026-11-20 sur `gurchon.spigushe.com`,
tag `v1.1.0` sur `ddb2cf3`, la tête de `main`. Le dépôt a deux fichiers
modifiés non commités, la mise à jour du README et l'avancement de F dans
`docs/lot12-plan-consolidation.md` : ils appartiennent au Lot 12 et ont suivi
sur la branche sans y être commités.

Accès public et sessions :

- hors catalogue et authentification, toute route exige une session
  (CLAUDE.md §7) ; une réponse authentifiée porte
  `Cache-Control: private, no-store` ;
- le jeton de session fait 32 octets, seul son SHA-256 est en base
  (`auth_session.token_hash`) ;
- la limitation de débit `slowapi` par IP existe pour la connexion,
  l'inscription, le changement de mot de passe et la route VDB
  (`VDB_RATE_LIMIT`) ;
- les journaux JSON de l'API n'écrivent que le gabarit de route, jamais le
  chemin brut (`app/observability.py`, A5 du Lot 12) : un jeton dans un
  chemin n'y apparaîtrait pas. nginx, lui, garde ses journaux d'accès avec le
  chemin complet ;
- le test d'export du compte (A4 du Lot 12) échoue sur toute table à
  `user_id` qui n'est ni exportée ni exclue par décision.

Côté client :

- `main.tsx` rend `AuthGate` avant tout : sans session, la coquille montre
  l'écran de connexion ; avec une session, elle ouvre la base IndexedDB du
  compte (`dbNameForAccount`). Aucun écran ne s'affiche aujourd'hui sans
  passer par lui ;
- `DeckTables` et `buildDeckTables(lines, facts)` (lot Affichage des decks)
  prennent des lignes `LocalDeckCard` et des faits de carte (`CardRow`,
  `CardDetailRow`) lus dans le miroir. `cardRowOf` et `cardDetailRowOf`
  (`offline/vtes/refresh.ts`) les fabriquent depuis un `CardSearchItem` du
  contrat ;
- `exportVdbText` (`features/decks/export/`) écrit le `TEXT` de VDB à partir
  des mêmes faits ; `DeckExportSheet` propose « Copier » et « Télécharger
  (.txt) » depuis un deck et depuis une version jouée ;
- les fixtures `frontend/tests/fixtures/vdb/` contiennent déjà de vrais
  exports VDB des decks de référence et des cas difficiles aux quatre formats
  (`ref-twd.txt`, `ref-twd-hints.txt`, `ref-jol.txt`, `ref-lackey.txt`, et
  leurs pendants `difficile-*`) : les nouveaux exports peuvent être vérifiés à
  l'octet près, comme le `TEXT` au Lot 9 ;
- `ChosenCardImage` (lot Chercher) lit `GET /cartes/{id}` à la demande
  (`useCardOnline`), prend l'image de l'impression, puis la générique, puis le
  pictogramme. La Collection n'en profite pas : l'aperçu au survol du tableau
  bureau lit `CardRow.imageUrl` (`features/stock/StockList.tsx`), le mobile
  n'affiche aucune image, ni dans la liste ni dans la feuille d'entrée
  (`StockForm.tsx`) ;
- `API_ROUTE_PREFIXES` (`offline/apiRoutes.ts`) doit lister toute ressource
  de l'API, un test le vérifie contre le contrat.

Chiffres de départ, relevés à la clôture du Lot 12 et à recompter à A1 (deux
mises à jour Dependabot et la PR #66 sont passées depuis) : 3026 tests backend
(2 `xfail`), 1720 tests vitest sur 97 fichiers, 98 e2e Playwright, 674
`data-testid` distincts, références CRAP vides des deux côtés, 57 opérations
sur 36 chemins au contrat, 28 tables, quinze révisions (tête `c4e8a1f2d7b3`).

## Propositions tranchées par l'utilisateur (A0)

Les points suivent l'ordre du parcours : ce que montre un lien, comment il se
crée et disparaît, ce que voit et peut faire celui qui le reçoit, puis les
deux sujets indépendants du lien. P1, P2, P3, P5 et P6 reprennent les cinq
points ouverts de la piste ; les autres viennent de l'écriture du plan. Chaque
point garde les options proposées, recommandation en premier, puis la
décision. Les numéros ont été remis dans cet ordre le 2026-11-20, après les
réponses : les échanges du jour citent l'ancienne numérotation (ancien P5 →
P2, P2 → P3, P3 → P5, P10 → P8, P8 → P9, P9 → P10).

**Tranché le 2026-11-20** :

| Point | Sujet | Décision |
| --- | --- | --- |
| P1 | lien figé | recommandation : le figé a sa propre copie (`deck_share_card`) ; une version jouée se partage en figé |
| P2 | contenu de la page | nom du deck, archétype et nom d'utilisateur sur tous les liens, sans choix ; notes seulement sur case cochée, décochée par défaut |
| P3 | jeton | **autre** : 8 caractères sur 63 (`[A-Za-z0-9_]`, 63⁸), en clair en base |
| P4 | hors ligne | recommandation : en ligne seulement, le figé attend la file du deck |
| P5 | cycle de vie | modifié et archivé, les deux liens marchent ; supprimé, le figé est maintenu et les vivants révoqués ; **la purge est le seul moyen de révoquer** : liens des decks supprimés, tous, ou une sélection parmi les liens des decks non supprimés |
| P6 | page dans la coquille | recommandation : `#/liste/<jeton>` intercepté avant `AuthGate` |
| P7 | actions de la page | recommandation (copier, télécharger), **plus « Dupliquer », « Comparer » et « Réviser »** |
| P8 | réviser | recommandation : révision dans l'adresse, sans compte ni écriture serveur |
| P9 | exports | recommandation : `TWD`, `JOL`, `LACKEY`, sans `TWD_HINTS`, en-tête `TWD` rempli pour une version de tournoi |
| P10 | art de l'extension, design | recommandation : pas d'image dans la liste mobile, pas de handoff |

### P1. Le lien figé : copie propre ou version du Lot 8 ?

Un lien **vivant** suit le deck : chaque consultation montre la composition du
moment. Un lien **figé** montre la liste telle qu'elle était à sa création.
`deck_version` garde déjà carte × quantité, exactement ce qu'il faut montrer.

1. **Recommandé : une copie propre au lien** (`deck_share_card`, carte ×
   quantité, sur le patron de `deleted_deck_card` et `deck_version_card`).
   Les versions du Lot 8 restent liées au seul jeu, et le bilan par version
   ne voit pas apparaître une v4 née d'un partage, sans partie. Prix : une
   troisième table de liste figée, quelques lignes par lien.
2. Couper une version au partage. Une table de moins, mais une version sans
   partie, que le bilan et la liste des versions d'un deck devront filtrer ou
   expliquer, et une règle de gel du Lot 8 (« les versions naissent au jeu »)
   qui ne tient plus.

Dans les deux cas, on peut aussi figer **une version jouée** depuis sa page
(`#/decks/<clé>/versions/<n>`, « Partager cette liste ») : c'est le cas de la
liste donnée à un organisateur après coup. Avec l'option 1, le lien copie la
version ; la copie ne coûte rien et garde un seul mécanisme.

**Décision** : option 1, avec le partage d'une version jouée.

### P2. Que montre la page publique ?

Toujours : le nom du deck (sans le discriminant, qui ne dit rien à un tiers),
l'archétype, la composition dans `DeckTables` en lecture seule, crypte puis
bibliothèque, avec groupes, capacité moyenne, totaux de sang et de pool ;
pour un figé, la date de la liste. Jamais : langue, extension, proxies,
disponibilités, versions, parties, ni rien de la collection.

Proposés au choix à la création du lien, éteints par défaut : le nom
d'utilisateur (`username`), comme le prévoyait la piste, et les notes du
deck, qui portent souvent l'auteur et la description d'un deck importé de
VDB mais peuvent contenir des remarques privées.

Pour un figé, nom, archétype et notes sont copiés à la création, comme la
liste : renommer le deck ne change pas la page.

**Décision** : nom du deck, archétype **et nom d'utilisateur** sur tous les
liens, sans case à cocher. Le nom d'utilisateur (le handle public du Lot 6) se
lit au moment de la consultation, pour un figé comme pour un vivant : aucune
route ne permet de le changer aujourd'hui, et le jour où une route le
permettra, les pages suivront. Les notes ne sont publiques que si
l'utilisateur coche « Montrer les notes » à la création, case décochée par
défaut, avec l'aperçu de ce qui sera public.

### P3. Le jeton : forme et stockage

La route publique se fait par un jeton opaque, jamais par l'identifiant du
deck, qui est séquentiel. Proposition de départ : 32 octets (43 caractères en
base64 URL).

1. **Recommandé : en clair en base.** On peut recopier le lien plus tard
   depuis le deck ou l'écran Compte. Une decklist n'est pas un secret, et une
   copie de `vtes.db` qui donnerait les liens ne donnerait que des listes que
   l'utilisateur a choisi de publier.
2. Empreinte seule, comme `auth_session` : le lien ne se montre qu'une fois, à
   la création. Plus strict, mais un lien perdu oblige à en créer un autre.

**Décision** : en clair, et un jeton de **8 caractères sur un alphabet de
63**, soit 63⁸, plutôt que 43 caractères. Le choix est passé dans la journée
par 8 caractères sur 62, puis 10, avant de revenir à 63⁸. Le lien reste
court et se recopie à la main (`gurchon.spigushe.com/#/liste/aB3x_9pQ`). Ce
que ça change :

- l'alphabet est `[A-Za-z0-9_]` : les 62 lettres et chiffres, plus `_`, sûr
  dans une adresse comme dans un hash. `-` l'aurait été aussi, mais une
  messagerie peut couper la ligne sur un tiret ; `_` a le défaut inverse,
  masqué par le soulignement d'un lien. `_` confirmé par l'utilisateur le
  2026-11-20 ;
- 63⁸, soit environ 2,5 × 10¹⁴ jetons (47,8 bits, contre 256). À 60 essais
  par minute et par IP (A4), 86 400 essais par jour ont environ trois
  chances et demie sur dix millions de tomber sur l'un de mille liens
  existants. La limite de débit devient la vraie protection contre
  l'énumération, plus seulement un frein ;
- le jeton se tire par `secrets.choice`, unique en base ; le service retire
  en cas de collision, comme pour le discriminant d'un deck (20 essais, puis
  409, en pratique jamais) ;
- la casse compte : pas de repli, qui diviserait l'espace par plus de cent ;
- un jeton qui ne suit pas `^[A-Za-z0-9_]{8}$` rend 422 avant toute lecture.

### P4. Créer un lien hors ligne ?

1. **Recommandé : en ligne seulement**, comme la légalité, la mise à jour
   depuis VDB ou l'écran Compte. Un lien sert à être envoyé, donc suppose du
   réseau. Aucun type d'opération `/sync` nouveau ; la liste des liens d'un
   deck est une lecture en ligne, hors du miroir. C'est une exception de plus
   au §10 de CLAUDE.md (« toute écriture front doit fonctionner hors ligne »),
   du même ordre que celles du Lot 12.
2. Jeton tiré par le client, opération `share.create` dans la file : le lien
   se crée au club, mais ne marche qu'après synchronisation, et un lien copié
   avant pourrait être envoyé alors qu'il rend 404.

Avec l'option 1, le serveur fige la liste qu'**il** connaît. Si la file
contient encore des modifications du deck, le figé ne les aurait pas. La
feuille de partage attend donc que la file n'ait plus d'opération en attente
sur ce deck, et le dit (« 2 modifications à synchroniser avant de figer la
liste »), sur le modèle du bandeau de mise à jour du Lot 12. Le vivant n'a
pas ce problème : il montrera les modifications dès qu'elles seront arrivées.

**Décision** : option 1, le figé attendant la file du deck.

### P5. Cycle de vie et purge

Ce que deviennent les liens quand le deck change d'état, d'abord proposé
ainsi :

| Le deck est… | Lien vivant | Lien figé |
| --- | --- | --- |
| modifié | montre la nouvelle liste | ne bouge pas |
| archivé | marche encore (« rangé » n'est pas « retiré ») | marche encore |
| supprimé | 404 | proposé : révoqué avec le deck |

Pour le figé d'un deck supprimé, deux options : le révoquer avec le deck
(recommandé, « supprimé » voulant dire « plus rien de public »), ou le laisser
survivre, puisqu'il ne dépend plus du deck, avec une liste de tous les liens
dans l'écran Compte, seul endroit où retrouver ceux d'un deck supprimé. La
proposition prévoyait aussi une révocation lien par lien.

**Décision** :

- modifié et archivé, les deux genres de lien marchent ;
- **supprimé : la liste figée est maintenue, les liens vivants sont
  révoqués.** La suppression d'un deck retire ses vivants dans la même
  transaction ; ses figés restent publics jusqu'à une purge, et la
  confirmation de suppression dit combien il en reste ;
- « Listes partagées » entre dans l'écran Compte, avec tous les liens du
  compte, decks supprimés compris ;
- **la purge est le seul moyen de révoquer.** Il n'y a pas de bouton
  « Révoquer » sur un lien, mais trois purges, chacune confirmée avec le
  nombre de liens visés :
  - **une sélection** : l'utilisateur coche les liens à purger, parmi ceux
    des decks **non supprimés** ; dans « Listes partagées » comme dans la
    feuille de partage d'un deck ;
  - **les liens des decks supprimés** : leurs figés survivants (les vivants
    sont tombés à la suppression) ;
  - **tout** : tous les liens du compte, vivants et figés.

Un lien d'un deck supprimé ne se sélectionne pas à l'unité : il part avec la
purge des decks supprimés ou avec la purge totale. La purge passe par une
route du compte et non du deck (A1), un deck supprimé refusant toute
écriture.

### P6. La page publique dans la coquille

Sans session, `AuthGate` montre l'écran de connexion. La page publique doit
s'afficher pour n'importe qui, connecté ou non, sur n'importe quel appareil.

1. **Recommandé : une route à hash `#/liste/<jeton>`, interceptée dans
   `main.tsx` avant `AuthGate`.** La page ne lit pas de session, n'ouvre
   aucune base IndexedDB et ne démarre pas le moteur de sync ; elle fait un
   seul `GET /listes/{jeton}` sans cookie. Elle reprend la police, le thème
   Nocturne et les glyphes de l'application, sans tab bar ni barre haute,
   avec un pied « Liste partagée depuis Gurchon Hall » et un lien vers
   l'application. Le jeton reste dans le hash : il n'est jamais envoyé au
   serveur de la PWA, ni dans un en-tête `Referer`.
2. Une page HTML servie par l'API, rendue côté serveur. Plus légère pour qui
   ne veut que lire, mais une seconde manière d'afficher une decklist à
   maintenir à côté de `DeckTables`, et sans les glyphes.

Hors ligne, la page dit qu'elle a besoin du réseau. Le service worker la sert
comme toute la coquille (precache), donc un premier affichage hors ligne
montre ce message plutôt qu'une erreur du navigateur.

**Décision** : option 1.

### P7. Que peut-on faire de la page publique ?

1. **Recommandé : « Copier » et « Télécharger » aux formats de VDB**, les
   mêmes que dans l'application (P9). C'est le geste le plus utile pour qui
   reçoit le lien : coller la liste dans VDB, dans Amaranth, ou dans l'import
   du Lot 9 s'il a un compte.
2. En plus, pour un visiteur connecté, « Importer dans mes decks », qui
   ouvrirait l'import du Lot 9 prérempli. Proposé en report : le
   copier-coller fait la même chose en deux gestes.

**Décision** : option 1, **plus trois actions** :

- **Dupliquer** fait de la liste partagée un deck du compte du visiteur, en
  brouillon. C'est l'import du Lot 9 avec une source de plus : les cartes
  arrivent déjà par identifiant, donc sans appariement ni rapport de lignes
  non reconnues. Mêmes règles qu'un import : tout en proxy, en anglais et
  sous la dernière extension, `proxy_allowed` posé, nom et archétype repris,
  notes reprises si le lien les montre, puis « Dupliqué de la liste partagée
  le … » ; aucun lien gardé avec la liste d'origine (pas de « mettre à jour
  depuis la liste »). Écriture par la file : la lecture de la liste demande
  du réseau, l'écriture non (A8) ;
- **Comparer** met la liste partagée en regard d'un de mes decks, choisi dans
  une feuille : cartes en plus, en moins et quantités changées, sur la
  présentation des « changements depuis la version précédente » du Lot 8.
  Lecture seule. Pas de comparaison avec la collection : « ce qui me manque »
  relève du Lot 17 (A9) ;
- **Réviser** : modifier la liste et partager le lien de la liste modifiée,
  « même comportement que VDB » ; sa forme fait l'objet de P8 (A10).

Dupliquer et Comparer supposent un compte. La page publique, qui n'ouvre
aucune base (P6), ne fait que les proposer : elle les montre quand l'appareil
connaît un compte (`rememberActiveAccountId`), et renvoie dans l'application,
sous `AuthGate`, par une intention à hash
(`#/decks?action=dupliquer&liste=<jeton>`,
`#/decks?action=comparer&liste=<jeton>`), consommée une fois comme les autres
intentions. Sans compte connu, un lien « Se connecter pour dupliquer ou
comparer » mène à l'écran de connexion, qui reprend l'intention ensuite. Le
propriétaire peut dupliquer son propre lien : c'est une façon de repartir
d'une liste figée. Réviser, lui, se fait sans compte (P8).

### P8. « Réviser » une liste tierce

Le besoin : quelqu'un reçoit un lien, retouche la liste (« je mettrais deux
Deflection de plus et j'enlèverais les Govern ») et renvoie un lien vers la
liste retouchée. Chez VDB, à ma connaissance, c'est le **deck dans
l'adresse** : une liste encodée dans l'URL (`vdb.im/decks/deck?name=…#200001=2;…`,
la forme que l'import du Lot 9 sait déjà lire), que n'importe qui modifie sans
compte, l'adresse suivant chaque modification. À vérifier sur VDB pendant
A1 : si « même comportement » visait autre chose (un clone dans son compte),
l'option 3 s'en rapprocherait.

1. **Recommandé : une révision dans l'adresse, sans compte ni écriture
   serveur.** Sur la page publique, « Réviser » passe la liste en édition :
   `+` et `−` sur chaque ligne, ajout d'une carte par une recherche dans le
   catalogue en ligne (`GET /cartes?q=…`, déjà publique). L'adresse devient
   `#/liste/<jeton>?revision=<écarts>`, où les écarts sont une suite
   `identifiant=quantité` par rapport à la liste d'origine. La page d'une
   révision montre la liste retouchée **avec ses écarts marqués** (ajouts,
   retraits, quantités changées, la présentation de « Comparer »), sous un
   en-tête « Révision de la liste de @alice ». La liste d'origine restant lue
   par son jeton, personne ne peut attribuer à @alice une liste qu'elle n'a
   pas écrite : on voit toujours ce qui vient d'elle et ce qui vient du
   réviseur. Rien n'est stocké, rien ne se purge (c'est une adresse), et le
   visiteur n'a pas besoin de compte, ce qui sera le cas le plus courant. Si
   la liste d'origine est purgée, la révision tombe avec elle. Il faut au
   contrat un moyen de lire les faits des cartes ajoutées par identifiant
   (`GET /cartes?ids=…`, filtre public de plus sur une route existante),
   aucune table.
2. Une révision enregistrée par le serveur, pour un visiteur connecté : un
   lien figé de **son** compte, sans deck, avec `parent_share_id` vers la
   liste révisée. Lien court et purgeable, mais il faut un compte, `deck_id`
   devient nullable, et une route de création de plus.
3. « Réviser » = dupliquer dans son compte, ouvrir le deckbuilder, puis
   partager ce deck. Aucun mécanisme nouveau, mais un deck de plus dans la
   collection du visiteur pour chaque révision, et un compte obligatoire.

L'option 1 pourrait produire en plus une adresse au format de VDB
(`vdb.im/decks/deck?…`), puisque l'export sait déjà écrire les noms de VDB :
une révision s'ouvrirait alors aussi dans VDB.

**Décision** : option 1. L'adresse au format de VDB n'a pas été tranchée :
hors du lot par défaut, à rouvrir à D6 si elle ne coûte presque rien.

**Comportement de VDB, précisé par l'utilisateur le 2026-11-20** : ce n'est
pas le deck dans l'adresse mais la **revue** d'un deck,
`vdb.im/review/<identifiant>#<carte>=<écart>;…`, par exemple
`https://vdb.im/review/cc01794e1#100845=1;102366=-1;201436=-1`. Les écarts
sont **signés et relatifs** à la liste d'origine (`+1` ajoute un exemplaire,
`-1` en retire un), pas des quantités. L'option 1 reprend cette forme telle
quelle dans le hash (A10). Une revue de VDB pourrait un jour s'importer par
le Lot 9 ; hors du lot.

### P9. Les exports aux autres formats

Formats proposés à côté du `TEXT` : `TWD`, `JOL`, `LACKEY`, chacun vérifié à
l'octet près contre les exports réels déjà en fixtures. Deux questions :

- **`TWD` avec indications** (`TWD_HINTS`, l'export où VDB commente la liste
  par `#`) : recommandé de l'écarter, personne ne l'a demandé et il double
  les cas de test ;
- **l'en-tête d'événement du `TWD`** (`[Event Name]`, `[Location]`,
  `[Date]`…) : VDB l'écrit vide, avec ses crochets. Recommandé : vide pour un
  deck vivant, comme VDB ; **rempli pour une version jouée en tournoi** (nom
  du tournoi, lieu, date, nombre de joueurs quand il est saisi), puisque la
  version est justement la liste de ce tournoi. Le vainqueur et le lien
  d'événement restent vides : l'outil ne les connaît pas.

Côté écran, la feuille d'export gagne un choix de format (quatre puces,
`TEXT` par défaut et mémorisé par appareil), et le fichier téléchargé garde
son nom du Lot 9 avec le format en suffixe pour les nouveaux
(`Banu Princes#1234 (JOL).txt`). Hors ligne, comme aujourd'hui.

**Décision** : recommandations retenues.

### P10. Art de l'extension et design

**Art de l'extension**, en ligne seulement comme toute image (P7 du lot
Chercher) :

- bureau : l'aperçu au survol du tableau montre l'image de l'impression de
  la ligne, puis la générique ;
- feuille d'entrée, aux deux largeurs : l'image suit le sélecteur
  d'extension pendant une création, et montre celle de l'entrée en
  modification ;
- recommandé : pas d'image dans la liste mobile. Elle demanderait une
  lecture de fiche par ligne visible, et la feuille d'entrée suffit à voir
  l'art d'un exemplaire. Le picker mobile du deckbuilder fait déjà ainsi.

**Design** :

1. **Recommandé : pas de handoff**, comme au Lot 9. La page publique est
   `DeckTables` en lecture seule sous un en-tête, la feuille de partage et
   l'écran Compte réutilisent les composants existants. Captures à 390 et
   1440 px validées par l'utilisateur avant la clôture.
2. Un handoff Claude Design pour la page publique et la feuille de partage,
   si l'on veut soigner ce que verra quelqu'un qui ne connaît pas
   l'application. Compter un aller-retour de brief comme au Lot 12.

**Décision** : recommandations retenues, pas d'image dans la liste mobile et
pas de handoff.

## Décisions de conception

Reprises après les décisions d'A0 (2026-11-20), dans l'ordre des couches :
contrat et données, serveur, puis client.

### A1. Contrat : cinq opérations

| Route | Rôle |
| --- | --- |
| `GET /decks/{id}/partages` (`listDeckShares`) | liens du deck, sous session ; 404 pour le deck d'un autre compte, comme toute route de deck ; lisible pour un deck supprimé (ses figés) |
| `POST /decks/{id}/partages` (`createDeckShare`) | crée un lien (`kind` : `live` ou `frozen`, `show_notes`, et pour figer une version jouée `deck_version_number`) ; 201 `DeckShareRead` avec le jeton ; 409 pour un deck supprimé ; 422 pour `deck_version_number` sur un lien vivant |
| `GET /moi/partages` (`listMyShares`) | tous les liens du compte, decks supprimés compris, chacun avec l'état de son deck, pour l'écran Compte (P5) |
| `DELETE /moi/partages` (`purgeShares`) | purge, seul moyen de révoquer (P5). `scope` obligatoire : `selected`, `deleted_decks` ou `all` ; avec `selected`, `share_id` répété (1 à 200, 422 s'il manque ou s'il accompagne une autre portée). Une sélection est refusée **en entier** si l'un des liens est inconnu ou d'un autre compte (404 « Lien N introuvable. ») ou vise un deck supprimé (409). 200 `{"revoked": n}` ; `deleted_decks` et `all` sont idempotentes (0 au second appel). Sous `/moi` : un deck supprimé refuse toute écriture |
| `GET /listes/{token}` (`readSharedDecklist`) | **publique**, sans session ni cookie : `SharedDecklistRead` ; jeton au motif `^[A-Za-z0-9_]{8}$` (422 sinon) |

`SharedDecklistRead` porte `name`, `archetype`, `kind`, `frozen_at` (nul pour
un vivant), `author` (toujours, P2), `notes` (nul si non montrées), et `cards`
en `{card: CardSearchItem, quantity}`. Reprendre `CardSearchItem` donne au
client de quoi appeler `cardRowOf` et `cardDetailRowOf`, donc
`buildDeckTables` et `exportVdbText` sans miroir. Il faut aussi les versions
des noms de crypte pour marquer `(G6)` un vampire réimprimé à l'export : un
champ `reprinted_card_ids`, calculé par le serveur, évite d'envoyer le
catalogue. Une liste de 40 cartes distinctes pèse une quarantaine de Ko, une
dizaine compressée.

`GET /cartes` gagne un paramètre `ids` (identifiants répétés, 1 à 200), pour
les cartes qu'une révision ajoute (P8, A10) : un filtre de plus sur une route
publique existante, aucune opération nouvelle. `/listes` rejoint
`API_ROUTE_PREFIXES` (`/moi` y est déjà). Contrat à 62 opérations sur 39
chemins. Dupliquer et Comparer n'ajoutent aucune route : ils lisent
`GET /listes/{token}` et écrivent par `/sync`.

**Précisé à A1 (2026-11-20)** :

- `DeckShareRead`, rendu par les trois routes du propriétaire, porte `id`,
  `token`, `kind`, `show_notes`, `created_at`, `frozen_name` (le nom que
  montre la page d'un figé, nul pour un vivant), `deck_version_number` (la
  version qu'un figé a copiée, « v3 », plutôt que son identifiant, que le
  client ne manipule pas) et `deck`, l'état du deck (`SharedDeckState` : `id`,
  `name`, `discriminator`, `archived_at`, `deleted_at`). Un seul schéma pour
  les deux listes : la feuille de partage d'un deck et « Listes partagées »
  lisent la même forme, et `deck.deleted_at` dit au client quels liens ranger
  à part, sans case (P5). Les deux listes vont du plus récent au plus
  ancien ;
- le 422 de `deck_version_number` sur un lien vivant est tenu par le schéma
  (`DeckShareCreate`), règle de forme ; le contrôle croisé de `scope` et
  `share_id` est tenu par la route (`check_purge_selection`, 422 au format de
  FastAPI, `loc` `["query", "share_id"]`), qui dédoublonne la sélection ;
- `reprinted_card_ids` suit exactement `reprintedCardIds` du client
  (`features/decks/export/exportVdbText.ts`) : les cartes de crypte non
  *advanced* de la liste dont le nom replié est porté par une autre carte de
  crypte non *advanced* de plus petit identifiant VEKN ; par identifiant
  croissant ;
- la route publique documente au contrat ses deux en-têtes de réponse
  (`Cache-Control`, `X-Robots-Tag`) et son 429, pour que B2 n'ait pas à
  toucher au contrat ;
- **écart au découpage** : le filtre `ids` de `GET /cartes` est implémenté
  dès A1 (deux lignes, `Card.id.in_(ids)`), plutôt qu'à B2 : un paramètre
  déclaré mais ignoré aurait rendu en silence tout le catalogue. Il se combine
  aux autres filtres, et `limit` et `offset` s'appliquent encore (le client
  porte `limit` au nombre d'identifiants) ;
- tag `partages` pour les cinq opérations, toutes dans
  `app/routers/shares.py`.

### A2. Révision R16 : `deck_share` et `deck_share_card`

`deck_share` : `id` en `AUTOINCREMENT` (un identifiant supprimé n'est jamais
réattribué, cf. R11), `user_id`, `deck_id` avec la FK composite
(`deck_id`, `user_id`) → `deck` (la ligne du deck survit à sa suppression
logique, si bien que le figé d'un deck supprimé garde sa FK), `token`
(`VARCHAR(8)`, unique, CHECK de longueur), `kind` (CHECK nommé),
`show_notes`, `created_at`, et pour un figé `frozen_name`,
`frozen_archetype`, `frozen_notes`, `deck_version_id` (provenance, nullable,
FK composite vers `deck_version`). `deck_share_card` : PK (`deck_share_id`,
`card_id`), `quantity` ≥ 1, FK vers `card` seulement. `ON DELETE CASCADE` de
`deck_share` vers `deck_share_card`.

Deux tables neuves, sans toucher aux tables existantes ni convertir de
données : la montée et la descente se rendent hors ligne, la descente refuse
de tourner s'il existe un lien (une saisie de l'utilisateur, comme
`deck.vdb_deck_id` à R14). Seconde révision appliquée à la production, après
un essai sur une copie de la base servie comme pour R15. Modèle à 30 tables,
seize révisions.

**Amendé à A1 (2026-11-20)** :

- **la descente ne se rend pas hors ligne**, contrairement à ce qui précède :
  sa garde lit la base (combien de liens ?), et une descente rendue sans
  garde supprimerait les liens sans prévenir. Même choix que R10, R13 et R14.
  La montée, elle, se rend hors ligne ;
- le CHECK du jeton porte la forme entière, pas seulement la longueur :
  `length(token) = 8 AND token NOT GLOB '*[^A-Za-z0-9_]*'`
  (`ck_deck_share_token_format`), `GLOB` étant sensible à la casse et propre
  à SQLite, comme le CHECK du discriminant ;
- un CHECK de plus, `ck_deck_share_frozen_fields_match_kind` : un vivant n'a
  ni `frozen_*` ni `deck_version_id`, un figé a toujours son `frozen_name` ;
- pas de clé étrangère simple de `user_id` vers `user_account` : la composite
  vers `deck` l'implique, comme pour `deck_version` ;
- un index (`user_id`, `deck_id`), `ix_deck_share_user_id_deck_id`, pour les
  liens d'un compte et ceux d'un deck ; l'unicité du jeton porte son propre
  index ;
- pas de `updated_at` : un lien ne se modifie pas, il se crée puis se purge ;
- révision `dda2c510a2f2`, modèle dans `app/models/share.py`, genre dans
  `DeckShareKind` (`app/models/enums.py`).

### A3. Service

`app/services/shares.py`, `user_id` obligatoire partout sauf dans la lecture
publique. Le jeton se tire par `secrets.choice` sur `[A-Za-z0-9_]`, huit fois,
avec un nouvel essai si la base refuse le doublon (P3). La purge supprime les
lignes visées dans une transaction et rend leur nombre ; une sélection est
vérifiée en entier avant toute suppression. La lecture publique ne distingue
rien : jeton inconnu ou purgé rendent le même 404 (« Liste introuvable. »),
dans un temps comparable ; un vivant d'un deck supprimé n'existe plus,
puisqu'il a été révoqué avec lui. Un vivant se lit sur `deck_card` (quantités
sommées par carte, langues et extensions confondues, comme `freeze_decklist`
du Lot 8) ; un figé sur `deck_share_card`, avec son nom, son archétype et ses
notes copiés. La suppression d'un deck (`DELETE /decks/{id}`) retire ses liens
vivants dans la même transaction et garde ses figés (P5).

### A4. Route publique : ce qui change par rapport aux autres

- pas de dépendance de session, et l'ordre des contrôles devient 422 (forme
  du jeton), puis limite, puis 404 ;
- limitation de débit par IP, `SHARED_LIST_RATE_LIMIT`, 60 par minute par
  défaut, contre l'énumération : avec un jeton de 8 caractères, c'est elle
  qui protège (P3), et un test la vérifie ;
- `Cache-Control: public, max-age=60` pour les deux genres : une purge
  prend effet en une minute au plus. Un figé aurait pu se cacher plus
  longtemps, mais au prix d'une purge lente ;
- `X-Robots-Tag: noindex` ;
- CORS : la route est lue depuis l'origine de la PWA sans `credentials`, la
  liste fermée d'origines suffit ;
- la matrice d'autorisation (`test_lot6_authorization_matrix.py`) gagne la
  route publique dans sa liste d'exceptions, avec un test qui vérifie qu'elle
  ignore un cookie de session (elle rend la même chose avec ou sans).

### A5. Export du compte

`deck_share` et `deck_share_card` entrent dans `GET /moi/export` (le test
d'A4 du Lot 12 l'exige) : genre, options, dates, deck, liste figée. **Le
jeton n'y figure pas** : le fichier peut traîner, et un jeton suffit à lire.
`format_version` passe à 2, la forme 1 restant décrite dans le schéma.

### A6. Client : feuille de partage et « Listes partagées »

Dans le détail d'un deck (mobile et bureau, à côté d'« Exporter ») et sur la
page d'une version : « Partager », en ligne seulement. La feuille liste les
liens du deck (genre, date, « Copier le lien ») avec une case par lien pour
la purge d'une sélection, puis « Nouveau lien » : vivant ou figé, case
« Montrer les notes » décochée, aperçu de ce qui sera public (nom du deck,
archétype et nom d'utilisateur toujours, P2). Un figé attend la file du deck
(P4).

« Listes partagées », dans l'écran Compte, liste tous les liens du compte,
groupés par deck, ceux des decks supprimés à part et sans case. Trois purges
confirmées, avec le nombre de liens : « Purger la sélection », « Purger les
liens des decks supprimés », « Tout purger » (P5). La confirmation de
suppression d'un deck dit combien de ses liens figés resteront publics et
renvoie à « Listes partagées ».

Hors contexte sécurisé, « Copier » sélectionne le lien, comme l'export. Hook
`useShares`, lectures et écritures directes par le client typé, hors miroir
et hors file.

### A7. Client : page publique

`features/share/PublicDecklistPage.tsx`, montée par `main.tsx` quand le hash
commence par `#/liste/`, sous le seul `ApiClientProvider`. Elle convertit la
réponse en lignes et en faits (`cardRowOf`, `cardDetailRowOf`), rend
`DeckTables` en lecture seule, la feuille d'export (P7, P9), « Réviser »
(A10) et, quand l'appareil connaît un compte, « Dupliquer » et « Comparer »
(A8, A9). Les glyphes passent par `preloadGlyphFonts`, déjà appelé au
démarrage. Le test vitest de `API_ROUTE_PREFIXES` et un e2e vérifient qu'une
navigation vers `/listes/...` n'est pas servie par la coquille.

### A8. Dupliquer une liste partagée (P7)

Dans l'application, sous `AuthGate`, l'intention
`#/decks?action=dupliquer&liste=<jeton>` ouvre la feuille d'import du Lot 9
avec la liste déjà lue : `GET /listes/{token}` en ligne, puis l'aperçu
habituel (nom modifiable, archétype prérempli, langue, notes modifiables). Le
plan d'écriture reprend `importDeck` (`deck.create` puis `deck_card.upsert`,
`Outbox.enqueueAll`) : les lignes `{card_id, quantity}` de la réponse
remplacent la sortie de l'appariement, et `vdbDeckId` reste nul. Les faits
des cartes viennent du miroir du visiteur, pas de la réponse, comme pour tout
deck du compte ; une carte absente du miroir (catalogue en retard) bloque
« Créer » avec un message, plutôt que d'écrire une ligne que le serveur
refuserait. Hors ligne, l'intention dit que la liste demande le réseau, comme
le lien d'un deck VDB. Une révision (A10) se duplique comme une liste : on
duplique la liste retouchée.

### A9. Comparer une liste partagée à un de mes decks (P7)

L'intention `#/decks?action=comparer&liste=<jeton>` lit la liste, puis
demande lequel de mes decks (non supprimés, archivés compris) mettre en
regard. La comparaison est une fonction pure sur carte × quantité totale,
langues et extensions confondues, la même règle de liste que les versions du
Lot 8 : cartes seulement dans la liste partagée, seulement dans mon deck,
quantités différentes, avec les comptes crypte et bibliothèque des deux
côtés. Elle réutilise le calcul des changements de `deckVersionModel.ts` s'il
s'y prête, sans le dupliquer ; la page d'une révision (A10) s'en sert aussi.
Affichage en lecture seule, sous forme d'écran
(`#/decks/<clé>/comparer/<jeton>`, rechargeable et partageable entre ses
propres appareils) ; aucun bouton pour appliquer les différences à mon deck
dans ce lot.

### A10. Réviser une liste partagée (P8)

Sur la page publique, sans compte. « Réviser » passe la liste en édition :
`+` et `−` sur chaque ligne, retrait à 0, et une recherche dans le catalogue
en ligne (`GET /cartes?q=…`) pour ajouter une carte. Chaque modification
réécrit l'adresse sans entrée d'historique (`history.replaceState`), sous la
forme `#/liste/<jeton>?revision=<écarts>`. Les écarts suivent la revue de
VDB (P8) : une suite `identifiant=écart`, séparée par `;`, triée par
identifiant, où l'écart est **signé et relatif** à la liste d'origine
(`100845=1;102366=-1;201436=-1`) ; un écart nul n'est pas écrit, et un retrait
total vaut l'opposé de la quantité d'origine. Le hash portant déjà
`#/liste/<jeton>`, la suite vit dans le paramètre `revision`, lu jusqu'au bout
sans couper sur les `=` qu'elle contient. « Copier le lien de la révision » la
donne.

À l'ouverture d'une adresse de révision, la page lit la liste d'origine par
son jeton, applique les écarts, lit par `GET /cartes?ids=…` les faits des
cartes ajoutées, et montre la liste retouchée avec ses écarts marqués, sous
« Révision de la liste de @alice ». Un écart illisible ou une carte inconnue
est ignoré et signalé (« 1 modification illisible ignorée »), jamais deviné.
Une révision s'exporte, se duplique et se compare comme une liste, et se
révise à son tour. Le code de calcul des écarts est une fonction pure,
testée sur une table de cas (ajout, retrait partiel et total, écart nul,
écart qui ferait passer une quantité sous zéro, ramené à zéro et signalé,
carte inconnue, adresse tronquée, exemple de VDB ci-dessus).

### A11. Exports (P9)

Une fonction pure par format dans `features/decks/export/`
(`exportVdbTwd`, `exportVdbJol`, `exportVdbLackey`), sur les mêmes entrées
qu'`exportVdbText`, testées contre les huit fixtures réelles. `LACKEY` met
la bibliothèque d'abord, calée sur 8 caractères, noms en ASCII sans `/` ;
`JOL` écrit `2xNom` sans en-tête. Les règles exactes se relèvent sur les
fixtures, pas de mémoire.

### A12. Ce qui ne change pas

Aucun type d'opération `/sync`, aucune version Dexie, aucune règle VEKN. Le
gel des versions du Lot 8 ne voit pas les liens. La légalité n'est pas
montrée sur la page publique (elle demanderait un appel de plus, et un deck
en construction est souvent illégal ; à rouvrir si un organisateur la
demande).

## Découpage en étapes ordonnées

| Étape | Contenu | Agent |
| --- | --- | --- |
| A0 | P1 à P10 tranchées, ce fichier mis à jour | utilisateur, orchestrateur |
| A1 | contrat (cinq opérations, filtre `ids` de `GET /cartes`), R16, schémas, client TS régénéré, chiffres de départ recomptés — **fait le 2026-11-20** (cf. « Livré à A1 ») | architecte-contrat |
| B1 | service des liens, routes sous session, trois purges, suppression d'un deck qui révoque les vivants et garde les figés — **fait le 2026-11-20** (cf. « Livré à B1 ») | backend-fastapi |
| B2 | route publique : limite, cache, 404 uniforme, matrice d'autorisation ; filtre `ids` ; export du compte — **fait le 2026-11-20** (cf. « Livré à B2 ») | backend-fastapi |
| C1 | `API_ROUTE_PREFIXES`, interception de `#/liste/` dans `main.tsx` sans base ni moteur — **fait le 2026-11-20** (cf. « Livré à C1 ») | pwa-offline |
| D1 | exports `TWD`, `JOL`, `LACKEY` et choix du format dans la feuille d'export — **fait le 2026-11-20** (cf. « Livré à D1 ») | frontend-react |
| D2 | feuille de partage (deck, version), « Listes partagées » et ses purges dans l'écran Compte — **fait le 2026-11-20** (cf. « Livré à D2 ») | frontend-react |
| D3 | page publique, aux deux largeurs — **fait le 2026-11-20** (cf. « Livré à D3 ») | frontend-react |
| D4 | art de l'extension dans la Collection — **fait le 2026-11-20** (cf. « Livré à D4 ») | frontend-react |
| D5 | « Dupliquer » et « Comparer » : intentions, reprise après connexion, feuille d'import alimentée par la liste, écran de comparaison | frontend-react, pwa-offline pour l'intention qui traverse `AuthGate` |
| D6 | « Réviser » : édition sur la page publique, écarts dans l'adresse, affichage d'une révision | frontend-react |
| E | tests manquants, e2e, CRAP, recensement des `data-testid`, captures | qa-tests |
| F | mise en service v1.2.0 : staging, essai de R16 sur une copie de la production, release, production, vérification sur téléphone et depuis un appareil sans compte | utilisateur, devops-deploiement |

D1 et D4 ne dépendent ni du contrat ni de R16 : elles peuvent commencer dès
A0, en parallèle d'A1.

### Livré à A1 (2026-11-20)

- **Chiffres de départ recomptés** avant toute modification, sur la branche
  à `28e14ae` : 3028 tests backend collectés (3026 verts et 2 `xfail`), 57
  opérations sur 36 chemins au contrat, 28 tables, quinze révisions (tête
  `c4e8a1f2d7b3`). Ceux de la clôture du Lot 12 tiennent : les mises à jour
  Dependabot et la PR #66 n'ont ajouté aucun test backend. Côté front, A1
  n'ajoute aucun test vitest ; la suite complète, lancée pendant A1 avec les
  travaux de D1 et D4 en cours dans l'arbre, compte 1753 tests sur 99
  fichiers, tous verts (1720 sur 97 à la clôture du Lot 12, la différence
  venant de D1 et D4).
- **Modèle et R16** : `DeckShare` et `DeckShareCard` dans
  `app/models/share.py`, `DeckShareKind` (`live`, `frozen`) dans
  `app/models/enums.py`, constantes `SHARE_TOKEN_LENGTH` et
  `SHARE_TOKEN_ALPHABET` (63 caractères, `_` en dernier). Révision
  `dda2c510a2f2`
  (`migrations/versions/20261120_dda2c510a2f2_liens_publics_vers_une_decklist.py`) :
  deux `CREATE TABLE` et un index, sans conversion, montée rendue hors ligne,
  descente gardée (refus avant toute modification dès qu'un lien existe,
  nombre cité) et non rendue hors ligne (A2 amendée). **30 tables, seize
  révisions.** Aucun `upgrade` lancé sur `backend/vtes.db`.
- **Schémas** (`app/schemas/share.py`) : `DeckShareCreate` (`kind`
  obligatoire, `show_notes` faux par défaut, `deck_version_number` borné,
  refusé sur un vivant), `DeckShareRead`, `SharedDeckState`,
  `SharePurgeScope`, `SharePurgeResult`, `SharedDeckCardRead`
  (`{card: CardSearchItem, quantity}`), `SharedDecklistRead`
  (`reprinted_card_ids` défini au paragraphe « Précisé à A1 » d'A1). Aucun
  `user_id` ; pas de jeton dans la lecture publique.
- **Routes** (`app/routers/shares.py`, tag `partages`) :
  `GET`/`POST /decks/{deck_id}/partages`, `GET`/`DELETE /moi/partages`,
  `GET /listes/{token}` (sans dépendance de session, motif du jeton au
  chemin, 404, 429, `Cache-Control` et `X-Robots-Tag` déclarés). Filtre `ids`
  de `GET /cartes` implémenté (A1 précisée). Contrat à **62 opérations sur 39
  chemins**, `contracts/openapi.json` exporté, client TS régénéré, `/listes`
  ajouté à `API_ROUTE_PREFIXES`.
- **Garde provisoire** : le corps des cinq routes rend **501** (« Route pas
  encore livrée (Lot 13, étape B1). », B2 pour la route publique), après le
  contrôle de session, la validation du chemin, du corps et de la requête,
  et le contrôle croisé de `scope` et `share_id`. **À retirer à B1 et B2**,
  avec `test_each_session_route_is_not_delivered_yet` et
  `test_the_public_route_is_not_delivered_yet_but_needs_no_session`. La
  limite de débit de la route publique est au contrat mais pas posée : elle
  vient à B2 (`SHARED_LIST_RATE_LIMIT` à créer dans
  `app/services/rate_limit.py`, sur le patron de `VDB_RATE_LIMIT`, décorateur
  `@limiter.limit` avec `request` en paramètre).
- **Export du compte** : `deck_share` figure dans
  `PENDING_EXPORT_TABLES` de `test_lot12_account_export.py`, pour que le test
  de couverture des tables privées reste vert ; **B2 la verse dans
  `EXPORTED_TABLES`** en l'exportant (A5), et retire l'ensemble.
- **Tests** : `backend/tests/test_lot13_contract.py` (45 : déclaration des
  cinq routes, réponses, paramètres de la purge et du filtre `ids`, schémas
  sans propriétaire, règles de `DeckShareCreate`, 422 du jeton et de la
  purge avant la garde, filtre `ids` en vrai, tables au modèle) ; section
  « Lot 13 » de `test_migrations.py` (24 : CHECK nommés, index, quatorze
  refus de la base, cascade, identifiant jamais réattribué, figé d'un deck
  supprimé, montée sur base peuplée sans perte, descente sans lien,
  descente refusée avec deux liens, aller-retour au DDL près, rendu hors
  ligne de la montée, refus hors ligne de la descente) ; quatre routes de
  plus dans la matrice d'autorisation ; compteurs de tables, d'opérations
  et de révisions mis à jour ; un lien figé de plus dans le jeu complet de
  `test_models_smoke.py` (« toute table accepte une ligne »).
- **Vérifications à la fin d'A1** : `ruff check` propre ; pytest sous
  couverture, **3099 verts et 2 `xfail`** (3101 collectés, 73 de plus qu'au
  départ : 45 du contrat, 24 de migration, 4 de la matrice) ; CRAP back sur
  447 fonctions, aucune au-dessus de 30 (pire 21), aucune régression par
  rapport à la référence ; `export_openapi.py --check` à jour ; côté front,
  `npm run lint`, `tsc -p tsconfig.app.json` et `npm run typecheck:tests`
  propres, tests vitest du contrat et des routes (`apiRoutes`, `api-client`,
  `barrel`, `routes`) verts, 28 sur 5 fichiers. La suite vitest complète,
  relancée en parallèle de pytest avec D1 et D4 en cours, a donné 1752 verts
  sur 1753 : l'échec (`decks.test.tsx`, « borne le nombre de proxies à
  convertir… ») ne touche aucun fichier d'A1 et passe seul (52 sur 52),
  instabilité sous charge du type déjà relevé aux Lots 5c et 6.
- **Ce qui reste à B1** : `app/services/shares.py` (tirage du jeton,
  copie d'un figé, depuis la liste courante ou une version, lectures du
  propriétaire triées du plus récent au plus ancien, trois purges), corps des
  quatre routes sous session, suppression d'un deck qui retire ses vivants
  dans sa transaction. **À B2** : corps de la route publique (vivant lu sur
  `deck_card` sommé par carte, figé sur `deck_share_card`, auteur, notes
  selon `show_notes`, `reprinted_card_ids`), limite, en-têtes, 404 uniforme,
  matrice d'autorisation (exception publique, cookie ignoré), export du
  compte (A5, `format_version` 2).

### Livré à C1 (2026-11-20)

- **Aiguillage** : `src/app/Root.tsx`, rendu par `main.tsx` à la place d'`AuthGate`.
  Un hash `#/liste/…` monte `PublicDecklistPage` et **jamais** `AuthGate` : ni
  session, ni base IndexedDB, ni moteur de sync, ni `GET /moi`. Tout autre hash
  passe par `AuthGate`, comme avant. `registerServiceWorker`,
  `preloadGlyphFonts` et `requestPersistentStorage` restent appelés par
  `main.tsx` dans les deux cas (aucun n'ouvre de base).
- **Mécanique à la traversée : rechargement.** Le côté (publique ou
  application) est figé au premier rendu ; un `hashchange` qui franchit la
  frontière fait `location.reload()` (le hash cible est déjà dans l'adresse),
  sans monter l'autre côté. Raison : démonter `AuthGate` en route laisserait
  runtime Dexie, moteur de sync et abonnements à défaire un à un, ce que rien
  n'est conçu pour faire à froid ; le rechargement garantit qu'une page
  publique n'a jamais ouvert de base. Il est servi par le precache, même hors
  ligne. Entre deux listes publiques, ou entre deux écrans de l'application,
  aucun rechargement. **D5** (intentions `#/decks?action=dupliquer&liste=…`)
  profite de ce choix : le lien de la page publique vers l'application
  recharge, puis `AuthGate` consomme l'intention à froid.
- **Fonction pure** `parsePublicListHash` (`features/share/publicListRoute.ts`) :
  `none`, `invalid` (préfixe `#/liste/` mais jeton hors `^[A-Za-z0-9_]{8}$`,
  sous-chemin compris) ou `list` avec `token` et `revision` (valeur **brute**
  du paramètre, coupée seulement à `&`, jamais décodée ; vide ou absente =
  `null`). Le décodage reste à D6.
- **Page** `PublicDecklistPage` (+ `usePublicDecklist`) : client par
  `useApiClient` (le contexte par défaut, il n'existe pas d'`ApiClientProvider`
  dédié), `GET /listes/{token}` avec `credentials: "omit"` passé à la requête
  (le client de l'application envoie `include`). États : chargement, réseau
  absent (« Cette liste demande une connexion au réseau. »), 404 (« Liste
  introuvable. »), tout autre statut (501, 5xx, 429) en erreur générique,
  jeton mal formé (« Lien invalide. », sans appel), succès (nom, auteur,
  nombre de cartes). Pied « Liste partagée depuis Gurchon Hall » et lien vers
  l'application ; pas de tab bar ni de barre haute ; mise en page sur
  `.auth-screen` / `.auth-card` provisoirement.
- **Service worker** : `/listes` était déjà dans `API_ROUTE_PREFIXES` (A1) ;
  ajout d'un cas au test de `apiRoutes` et d'un e2e dans
  `tests/e2e/offline-layer.spec.ts` (projet `chromium`, sur le patron de
  `/sync`) : hors ligne, `/#/liste/<jeton>` est servie par le service worker et
  affiche le message réseau, alors que `/listes/<jeton>` n'est pas servie.
- **Écart au plan** : aucun sur P6 ni A7. Le test « `main.tsx` passe par
  `AuthGate` » porte sur `Root` (`main.tsx` n'a que des effets de bord et ne se
  teste pas sans lancer l'application).
- **Reste à D3** : `DeckTables` en lecture seule (conversion par `cardRowOf` et
  `cardDetailRowOf`), mise en page deux largeurs au lieu de la carte
  d'authentification, notes, archétype, date du figé, exports, « Réviser »
  (D6, qui lit `revision` déjà rendu par l'aiguillage), « Dupliquer » et
  « Comparer » (D5, via `rememberActiveAccountId` / `readActiveAccountId`, déjà
  lisibles sans base). L'état de chargement du catalogue n'existe pas sur cette
  page : les faits des cartes viennent de la réponse (`CardSearchItem`).

### Livré à B1 (2026-11-20)

Service et routes sous session ; aucun changement de contrat à cette étape.

- **Service** (`app/services/shares.py`) : `user_id` obligatoire partout sauf
  `read_shared_decklist`. `pick_token` (`secrets.choice`, 8 tirages sur les 63
  caractères de `SHARE_TOKEN_ALPHABET`) ; `create_deck_share` retire le jeton
  quand la base refuse le doublon (rollback puis nouvel essai, 20 essais, puis
  409), `pick` injectable pour les tests ; `list_deck_shares` (deck supprimé
  compris), `list_my_shares` (du plus récent au plus ancien, `created_at` puis
  `id`) ; `purge_shares` ; `revoke_live_shares`. Le module n'importe pas
  `services/decks.py` (qui l'importe), il a donc son propre `_get_deck`, au même
  message que celui des decks.
- **Création** : vivant sans copie ; figé copié depuis `deck_card` (somme par
  carte, langues et extensions confondues) ou depuis `deck_version_card` quand
  `deck_version_number` est donné (404 « Version N du deck D introuvable. », le
  message de la légalité d'une version), avec le nom et l'archétype du moment.
  409 pour un deck supprimé, archivé accepté. Aucune version n'est créée par un
  partage.
- **Purges** : `selected` est vérifiée en entier avant toute suppression (404
  « Lien N introuvable. » pour un lien inconnu ou d'un autre compte, même
  message, puis 409 pour un lien d'un deck supprimé, qui nomme l'identifiant) ;
  `deleted_decks` et `all` sont idempotentes ; une transaction, `{"revoked": n}`.
  La route dédoublonne la sélection (`check_purge_selection`, d'A1).
- **Suppression d'un deck** : `decks.delete_deck` appelle
  `shares.revoke_live_shares` avant son `commit`, donc dans la transaction de la
  suppression, aussi pour un `deck.delete` rejoué par `/sync` (testé).
- **Écart à A3** : un figé ne copie les notes que si `show_notes` (amendement
  d'A3 ci-dessus).
- **Gardes 501 retirées** (`_not_yet_delivered` et
  `test_each_session_route_is_not_delivered_yet`).

### Livré à B2 (2026-11-20)

Route publique, export du compte.

- **`GET /listes/{token}`** : `@limiter.limit(shared_list_rate_limit)` avec
  `request` et `response` en paramètres, comme la route VDB ; ordre 422 (forme
  du jeton, FastAPI), 429, 404. Aucune dépendance de session : le cookie n'est
  jamais lu (testé avec la session d'un autre compte et avec un cookie bidon,
  même corps, mêmes en-têtes), si bien que `current_session` ne pose jamais
  `Cache-Control: private, no-store` ici. `Cache-Control: public, max-age=60` et
  `X-Robots-Tag: noindex` sont posés sur le 200 seulement.
- **Corps** : vivant lu sur `deck_card` (somme par carte), figé sur
  `deck_share_card` ; nom, archétype et notes du deck pour un vivant, copiés pour
  un figé ; `author` = `username` lu à la consultation, toujours ; `notes` nul
  sans `show_notes` ; `frozen_at` = `created_at` d'un figé ; `cards` par
  identifiant croissant, `{card: CardSearchItem, quantity}` rendus par
  `catalog.list_cards(ids=…)`, donc exactement la forme de `GET /cartes` (mêmes
  préchargements : le nombre de requêtes ne dépend pas de la taille de la liste) ;
  `reprinted_card_ids` calculé comme `reprintedCardIds` du client (nom replié par
  `fold_text`, crypte non *advanced*, plus petit identifiant VEKN).
- **404 uniforme** : jeton inconnu ou purgé, ou lien vivant d'un deck supprimé
  (garde de défense, la suppression les ayant déjà retirés) : « Liste
  introuvable. ». Une seule lecture du jeton avant tout calcul : le temps d'un
  404 reste voisin de celui d'un 200 d'une petite liste ; aucune attente
  artificielle n'est ajoutée, la limite de débit étant la vraie protection.
- **`SHARED_LIST_RATE_LIMIT`** : `shared_list_rate_limit()` dans
  `app/services/rate_limit.py`, `60/minute` par défaut, lue à chaque appel.
- **Matrice d'autorisation** : `test_the_shared_list_route_is_public_and_ignores_a_session_cookie`.
- **Export du compte (A5)** : `export_shares` ; `deck_share` rejoint
  `EXPORTED_TABLES`, `deck_share_card` `EXPORTED_THROUGH_DECK`,
  `PENDING_EXPORT_TABLES` disparaît. **Seul changement de contrat de B1 et B2**
  (cf. « Précisé à B2 » d'A5) : `format_version` en `[1, 2]`, `shares`,
  `ExportedDeckShare` et `ExportedDeckShareCard` ; `contracts/openapi.json` et
  `schema.d.ts` régénérés. Le jeton n'est dans aucun champ ni nulle part dans
  le fichier (testé sur le texte brut).
- **`test_the_public_route_is_not_delivered_yet_but_needs_no_session`** retiré.
- **Tests** : `backend/tests/test_lot13_shares.py` (40 : jeton et collision,
  vivant et figé, version jouée, notes, archivé, supprimé, purges et refus,
  isolation, 404 uniforme, en-têtes, limite de débit avant le 404,
  `reprinted_card_ids`, `/sync`, export) ; `test_lot6_authorization_matrix.py`
  (+1), `test_lot12_contract.py` et `test_lot12_account_export.py` mis à jour
  (forme 2, tables), `test_lot13_contract.py` allégé de ses sept cas de garde 501.
  Côté front, un seul changement : l'e2e réel `tests/e2e-real/support/lot12.ts`
  attendait `format_version` à 1 contre le vrai back, il attend 2.
- **Vérifications** : `ruff check` propre ; pytest sous couverture, 3133 verts et
  2 `xfail` (3135 collectés, 34 de plus qu'à la fin d'A1 : 3101) — la suite
  complète a tourné une fois, avec 3 échecs qui étaient des tests du Lot 12 non
  encore mis à jour (forme 2), corrigés et relancés avec les tests de la matrice,
  du contrat et des liens (190 verts) ; `shares.py` du service à 99 % des
  lignes et celui du router à 100 % ; CRAP back sur 466 fonctions, aucune
  au-dessus de 30 (pire 21), aucune régression ; `export_openapi.py --check` à
  jour.
- **Reste pour le front** : D2 (feuille de partage et « Listes partagées » :
  `GET/POST /decks/{id}/partages`, `GET/DELETE /moi/partages`), D3 (page publique
  sur `GET /listes/{token}` : `cards` en `CardSearchItem` pour `cardRowOf` et
  `cardDetailRowOf`, `reprinted_card_ids` pour l'export, 404 « Liste introuvable. »
  et 429 à afficher), D5 et D6 (même route, ainsi que `GET /cartes?ids=…`). Le
  CORS de la route publique n'a pas été modifié (liste fermée d'origines, sans
  `credentials`) ; `Retry-After` y est déjà exposé.

### Livré à D1 (2026-11-20)

Exports `TWD`, `JOL` et `LACKEY`, front seul : aucune route, aucun champ de
contrat, aucun type `/sync`, aucune migration, aucune version Dexie.

- **Une fonction pure par format**, dans `features/decks/export/` :
  `exportVdbTwd.ts`, `exportVdbJol.ts`, `exportVdbLackey.ts`, sur les mêmes
  entrées qu'`exportVdbText`. Le commun est resté dans `exportVdbText.ts`,
  désormais exporté (`splitDeck`, `cryptName`, `compareFolded`, `sumQuantity`,
  `groupBlock(group, underlined)`, `cryptLines(rows, reprinted)`) ; la
  sortie du `TEXT` n'a pas bougé. `exportFormats.ts` porte le registre des
  quatre formats (libellé, suffixe de fichier, aide), `exportAs` et la
  mémorisation du choix.
- **Règles relevées sur les huit fixtures, pas de mémoire** :
  - `TWD` : sept lignes d'en-tête entre crochets, `-- [Scores]`, `Deck Name:`,
    `Description:` suivi du gabarit littéral `[Description]` (les notes du deck
    ne sont pas reprises, pas de ligne d'auteur) ; crypte soulignée de `-` sur la
    longueur de son titre ; `Library (n cards)` et titres de type **sans
    soulignement** ; groupes séparés par une ligne vide ;
  - `JOL` : `2xNom`, sans espace ni en-tête, crypte puis bibliothèque, chacune
    par nom replié ; `(ADV)` gardé ;
  - `LACKEY` : bibliothèque d'abord par nom, `Crypt:`, puis la crypte par nom ;
    quantité calée sur 8 caractères ; noms en ASCII (`lackeyName` : accents
    retirés, `ł ø œ æ ß…` transcrits, `/` supprimé, tout autre caractère non
    ASCII retiré).
- **Deux écarts voulus à VDB sur le `TWD`** (décisions de l'utilisateur du
  2026-11-20) : la crypte est rangée **par capacité décroissante, puis par nom**,
  comme le `TEXT`, là où l'export réel (`ref-twd.txt`) la range par quantité
  décroissante puis nom ; et la ligne `[Format]` de l'en-tête n'est pas écrite,
  vivant comme version de tournoi. Les fixtures réelles ne sont pas touchées :
  le test dérive l'attendu de la fixture (crypte reprise dans l'ordre du
  `TEXT`, `[Format]` retiré) et nomme l'écart. `JOL` et `LACKEY` restent fidèles
  aux fixtures (crypte alphabétique, code distinct de celui du `TWD`). Date ISO
  et lieu « nom, ville » de l'en-tête gardés (décision du même jour).
- **Écart assumé, `(G6)`** : seuls `TEXT` et `TWD` écrivent la marque de groupe
  d'un vampire réimprimé. Aucune fixture ne l'établit pour `JOL` et `LACKEY` ;
  un nom seul se relit, à l'import du Lot 9, comme la version d'origine ou celle
  que la crypte rend légale.
- **En-tête du `TWD` d'une version jouée en tournoi** (`useVersionEvent`,
  `useDeckExportText.ts`) : lu dans le miroir seulement, hors ligne. Nom du
  tournoi, lieu (nom et ville du lieu du tournoi, à défaut du lieu de la partie
  qui a figé la version), date de début (`AAAA-MM-JJ`, la forme de la
  description de `ref-text.txt`), nombre de joueurs quand il est saisi.
  Vainqueur et lien d'événement gardent leur gabarit `[…]`, de même que tout
  champ non saisi ; version sans tournoi ou deck vivant : en-tête vide (sans
  `[Format]`). `TWD_HINTS` n'est pas écrit.
- **Feuille d'export** (`DeckExportSheet`) : quatre puces `TEXT | TWD | JOL |
  LACKEY` (`segmented`, `role="radiogroup"`, `deck-export-format-<id>`), `TEXT`
  par défaut, choix mémorisé par appareil sous `gurchon-hall:export-format`
  (`localStorage` sous `try/catch`, valeur inconnue : `TEXT`). La feuille reçoit
  les quatre textes (`useDeckExportTexts`) et le nom de fichier par suffixe ;
  `exportFileName` gagne le suffixe : `Banu Princes#1234 (JOL).txt`,
  `Banu Princes#1234 v2 (TWD).txt`. Depuis un deck et depuis la liste d'une
  version jouée, aux deux largeurs (même composant).
- **Tests** : `exportVdbFormats.test.ts` (15) compare les trois formats aux
  six fixtures `ref-*` et `difficile-*` à l'octet près, sur des decks
  reconstitués depuis les exports `TEXT` des mêmes fixtures (un garde-fou
  vérifie que la reconstitution redonne le `TEXT`), puis l'en-tête rempli ou
  vide, les cas limites (ASCII, liste vide) et le registre ; `exportFile.test.ts`
  (+5, suffixes) ; `deckExport.test.tsx` (+5 : quatre puces, mémorisation,
  valeur inconnue, nom de fichier téléchargé, `TWD` d'une version de tournoi
  et sans tournoi).
- **Captures** (`tests/visual-baseline/lot13-d1-d4.spec.ts`, back de test
  jetable, sortie `docs/qa-baselines/lot13-d1-d4/mobile-390x844/` et
  `desktop-1440x900/`) : `01` à `04` feuille d'export depuis un deck (TEXT, TWD,
  JOL, LACKEY) ; `05` version v1 jouée au « Championnat de Lyon » en TWD,
  en-tête rempli (Le Repaire, Lyon ; 2026-10-24 ; 13 joueurs).
- **`data-testid`** ajoutés : `deck-export-format-text`, `-twd`, `-jol`,
  `-lackey`, `deck-export-hint`. Aucun disparu.

### Livré à D4 (2026-11-20)

Art de l'extension dans la Collection, front seul, en ligne seulement.

- **`PrintingImage`** (`features/catalog/PrintingImage.tsx`) : image de
  l'impression lue par `useCardOnline` et `printingImage`, puis l'image générique
  du miroir, puis le pictogramme, sans la mise en page du picker. L'aperçu au
  survol du tableau bureau (`StockList`) s'en sert : le composant n'est monté
  que quand l'aperçu s'ouvre, si bien qu'aucune fiche n'est lue pour les lignes
  qu'on ne survole pas. Il remplace la lecture de `CardRow.imageUrl` seule.
- **Feuille d'entrée** (`StockForm`, aux deux largeurs) : `ChosenCardImage` dans
  un conteneur `stock-form-image`. En création, l'image suit le sélecteur
  d'extension (présélection sur la dernière version, puis le choix) ; en
  modification, c'est celle de l'impression de l'entrée. Bureau : image `sm` ;
  mobile : variante `enlargeable` (toucher pour agrandir), absente hors ligne
  (conteneur vide masqué par `:empty`). L'image générique de repli d'une
  entrée modifiée est lue dans le miroir (`useCardsById`).
- **Pas d'image dans la liste mobile** (décision) : aucune fiche n'est lue
  pour la liste, vérifié par un test.
- **Hors ligne** : le tableau garde son pictogramme, la feuille de création un
  conteneur sans image, aucun appel.
- **Écart** : `ChosenCardImage` n'a pas reçu de prop d'identifiant de test ; son
  `deck-card-form-image` reste celui de l'image elle-même, y compris dans la
  Collection (le recensement des `data-testid` le compte comme littéral), et le
  conteneur de la Collection porte `stock-form-image`.
- **Captures** (même spec, mêmes dossiers ; les images krcg se chargent sur
  cette machine, ce sont de vraies images) : `06` bureau, aperçu au survol en
  ligne (`06-collection-apercu-en-ligne`) puis hors ligne (`07`, pictogramme) ;
  mobile, `06-collection-liste-sans-image` ; `08` feuille de création
  (extension la plus récente) puis `09` après changement d'extension, `10` au
  mobile image agrandie ; `11` feuille de modification, `12` au mobile image
  agrandie ; `13` feuille de modification hors ligne.
- **Tests** : `tests/unit/ui/stockArt.test.tsx` (7) : aperçu au survol,
  repli générique puis pictogramme hors ligne, feuille bureau en modification,
  création qui suit l'extension, feuille mobile (agrandir, rien hors ligne),
  création hors ligne, liste mobile sans image ni lecture.
- **`data-testid`** ajouté : `stock-form-image`. Aucun disparu (777 en
  référence, tous présents).

### Chiffres à la clôture de D1 et D4

`npm run lint`, `tsc --noEmit -p tsconfig.app.json` et `npm run typecheck:tests`
propres. 1753 tests vitest sur 99 fichiers (1720 sur 97 à la clôture du Lot 12 :
+32 tests de D1 et D4, +2 fichiers). Contrôle CRAP : « Aucune régression ».
`testid-census --check` : aucun identifiant disparu. Aucun e2e Playwright ajouté
ni modifié.

### Livré à D3 (2026-11-20)

Page publique d'une liste partagée, aux deux largeurs, front seul : aucune route,
aucun champ de contrat, aucun type `/sync`, aucune migration, aucune version Dexie.

- **Mise en page** (`PublicDecklistPage.tsx`) : la carte d'authentification
  provisoire de C1 est remplacée par `main.public-list` (colonne bornée à 1200 px,
  marges du bureau à partir de 1024 px, pied collé en bas). Nom, puis
  « par @auteur · archétype · N cartes » (libellés de `DECK_ARCHETYPE_LABELS`), pour
  un figé « Liste du 20 novembre 2026 » (date en UTC), notes sous un `deck-notes`
  (sauts de ligne gardés, Markdown brut), puis `DeckTables` en lecture seule.
  Bureau : crypte et bibliothèque côte à côte en 3 fr / 2 fr (à parts égales, les
  cinq colonnes de disciplines rognaient les noms de crypte) ; mobile : empilées.
  Règles dans un bloc « Lot 13 D3 » à la fin de `src/index.css`.
- **Montage inchangé** : `<LoadedList key={token}>`, `credentials: "omit"`, aucune
  base, aucune session, aucun catalogue local ; les tests d'`indexedDB.open` de C1
  passent tels quels.
- **Conversion pure** (`sharedDecklistModel.ts`) : `sharedListLines` (une ligne
  `LocalDeckCard` par carte, quantité totale, `proxyQuantity` 0, langue `EN`
  jamais affichée, extension = `latest_card_set_id`), `sharedListFacts`
  (`cardRowOf` et `cardDetailRowOf` sur `cards[].card`), `buildSharedListModel`
  (`buildDeckTables` et total), `sharedListTexts` (quatre formats par `exportAs`, `(G6)`
  par `reprinted_card_ids`, notes en description quand le lien les montre, en-tête
  d'événement du TWD vide), `sharedListFileName` (sans discriminant), `formatListDate`.
  `showProxies` est faux : ni colonne ni total de proxies.
- **Export** : `DeckExportSheet` (D1) est déjà pure, elle reçoit les textes et le
  nom de fichier ; **`features/decks/export/` n'est pas modifié**. Bouton
  « Exporter » (`public-list-export`) qui ouvre la feuille aux quatre formats.
- **États** : chargement, hors ligne, 404 « Liste introuvable. », **429** (« Trop de
  demandes, réessayez dans N s » d'après `Retry-After` en secondes entières, « dans un
  moment » sinon ; `usePublicDecklist` gagne l'état `rate-limited`, et le message garde
  le `data-testid` `public-list-error` avec `data-reason="rate-limited"` pour les tests
  de C1), jeton invalide, erreur générique. Pied et lien vers l'application dans tous les états.
- **Document** : `<title>` = nom du deck (« Liste introuvable. » sur un 404), et
  `<meta name="robots" content="noindex">` posé puis retiré par la page, sans toucher
  à `index.html`.
- **Emplacements D5 et D6 : omis.** Pas de bouton désactivé ni de lien
  « Se connecter pour… » : la page n'a rien à dire tant qu'ils ne font rien.
  `public-list-actions` contient seulement « Exporter » ; D5 y ajoute « Dupliquer » et
  « Comparer » (visibles si `readActiveAccountId` donne un compte, lien vers
  `#/decks?action=dupliquer&liste=<jeton>` qui **recharge**, C1), sinon un lien
  « Se connecter pour dupliquer ou comparer » ; D6 y ajoute « Réviser » et lit
  `revision` de `parsePublicListHash`, déjà rendu brut.
- **Écart au cache** : la route publique porte `Cache-Control: public, max-age=60` : un
  rechargement dans la minute resert la liste d'avant une modification du deck. Normal
  (B2), mais l'e2e doit lire dans un contexte neuf.
- **Tests** : `sharedDecklistModel.test.ts` (conversion sur une table de trois cas,
  faits, exports, nom de fichier, date) et `PublicDecklistPageD3.test.tsx` (en-tête,
  tableaux en lecture seule, figé daté et notes, titre et `noindex`, aucune base et
  aucun cookie, export TEXT avec `(G6)` copié, JOL, TWD, LACKEY, téléchargement, 429
  avec et sans `Retry-After`, 404) ; fixture de `PublicDecklistPage.test.tsx` (C1)
  complétée de vraies cartes (`crypt` et `library`), les tests eux-mêmes inchangés.
  e2e réel `lot13-liste-publique` aux deux largeurs (`tests/e2e-real/` et
  `tests/e2e-desktop-real/`, scénario dans `support/lot13share.ts`) : deck, lien vivant
  et lien figé créés sous session, lus dans un contexte sans cookie ni base IndexedDB ;
  le vivant suit une carte ajoutée, le figé non ; export JOL ; jeton inconnu en 404.
- **Captures** (`tests/visual-baseline/lot13-d3.spec.ts`, sortie
  `docs/qa-baselines/lot13-d3/mobile-390x844/` et `desktop-1440x900/`) : `01` liste
  vivante sans notes, `02` figée avec notes, `03` feuille d'export (TEXT), `04` TWD,
  `05` « Liste introuvable », `06` hors ligne.
- **`data-testid`** ajoutés : `public-list-actions`, `public-list-export`,
  `public-list-frozen`, `public-list-notes`. Aucun disparu.
- **Correctifs du 2026-11-20, après relecture des captures** :
  1. *Crypte au mobile.* Cause : sous 440 px, au-delà de cinq colonnes de disciplines
     (P5) elles passent sous le nom, mais la grille gardait 19 px par colonne et
     débordait sur le clan et le groupe dès que la crypte en comptait beaucoup. Le
     défaut existait aussi dans l'application (détail d'un deck à 390 px, où le stepper
     retire 40 px de plus). Corrigé dans `DeckTables` pour les deux usages. Un premier
     correctif réduisait les glyphes à la place restante, jusqu'à 9 px, illisibles.
     Choix de l'utilisateur : garder les six premières et ajouter « … » au besoin.
     Garder les six premières *colonnes* pouvait ne laisser à un vampire que « … »
     (les colonnes sont communes à la crypte) : ce sont donc les six premières
     disciplines **de chaque vampire**. Sous le nom (section de moins de 440 px, plus
     de cinq colonnes), les disciplines ne s'alignent plus : cases vides et
     disciplines au-delà de la sixième cachées (`deck-table__disc-slot--empty`,
     `--overflow`), glyphes à 19 px, et un « … » (`deck-table-disc-more`) dont le nom
     accessible et l'infobulle donnent les disciplines cachées. Au-delà de 440 px,
     rien ne change. `cryptDisciplineColumns` est intact ; un test de
     `PublicDecklistPageD3.test.tsx` couvre le « … ».
  2. *Barre haute du bureau.* Cause : puces `Kbd`, « En ligne » et nom du compte
     pouvaient se replier quand l'alerte « serveur injoignable » prenait la place.
     Corrigé en fin de `index.css` : `nowrap` sur onglets, puces, état et compte,
     éléments de `.topbar__actions` à `flex: none`, et seul le champ de recherche
     rétrécit (`flex: 0 1 280px`, `min-width: 120px`).
  3. Captures refaites aux deux largeurs, avec `07-application-detail-deck` (détail du
     même deck dans l'application, tableaux seuls) et, au bureau,
     `08-barre-haute-alerte` (alerte « serveur injoignable », barre sur une ligne).
     Le spec des captures a un délai de 240 s : la machine était saturée par d'autres
     passes.

### Livré à D2 (2026-11-20)

Feuille de partage et « Listes partagées », front seul : aucune route, aucun champ
de contrat, aucun type `/sync`, aucune version Dexie. Tout vit dans
`features/share/`, avec la page publique de D3 (déplacé de `features/sharing/` le 2026-11-20, cf. correctifs).

- **Lectures et écritures directes**, hors miroir et hors file (P4) : `shareApi.ts`
  (quatre appels sur le client typé, même forme de résultat que `accountApi.ts`,
  dont `attempt` et `failureOf` sont désormais exportés), `useShares` (avec
  `deckId` : liens du deck ; sans : tous ceux du compte ; `create`, `purge` qui
  relit la liste après coup, un 404 ou 409 de sélection voulant dire qu'elle est
  périmée).
- **« Partager »** à côté d'« Exporter », dans le détail d'un deck (aux deux
  largeurs) et sur la page d'une version jouée. Grisé hors ligne, avec la raison
  en infobulle et dessous, et pour un deck créé hors ligne et pas encore connu du
  serveur ; présent pour un deck archivé ; absent d'un deck supprimé, qui n'a pas
  de page.
- **Feuille** (`ShareSheet`) : les liens du deck (genre, date, version d'origine,
  case, « Copier le lien »), « Purger la sélection » confirmée avec le nombre,
  puis « Nouveau lien » (vivant ou figé, « Montrer les notes » éteint, aperçu de
  ce qui sera public). Depuis une version jouée : un figé de cette version, sans
  choix de genre (`deck_version_number`).
- **Le figé attend la file** (P4) : `pendingOperationsOnDeck` compte, dans
  `usePendingOperations`, les `deck.create`, `deck.update`, `deck.delete` et
  `deck_card.*` du deck (par identifiant ou par `client_ref`) ; « Créer » est
  désactivé avec « N modification(s) à synchroniser avant de figer la liste ». Le
  vivant n'attend pas. **Écart voulu** : depuis une version jouée, la file
  n'empêche rien, la version étant déjà connue du serveur.
- **Copie** : `${origin}/#/liste/<jeton>`, repli de l'export (lien sélectionné et
  dit hors contexte sécurisé).
- **Écran Compte** : section « Listes partagées » (`AccountShares`) : liens groupés
  par deck, ceux des decks supprimés à part, sans case ; trois purges confirmées
  avec le nombre de liens visés ; retour (`revoked`) ; sélection refusée (404,
  409) : liste relue. Mobile : après Synchronisation ; bureau : colonne de droite,
  sous les sessions.
- **Confirmation de suppression d'un deck** (`DeleteSharesNote`) : en ligne, le
  nombre de liens figés qui resteront publics et de vivants révoqués, avec un lien
  vers « Listes partagées » ; rien si le deck n'a aucun lien ; hors ligne, une
  phrase prudente sans nombre.
- **Tests** : `tests/unit/ui/shares.test.tsx` (30 : bouton hors ligne, deck non
  synchronisé, archivé, mobile ; feuille vide et aperçu, liens, création vivant,
  figé avec notes, file non vide, copie sécurisée et repli, purge de la sélection,
  404, échecs de lecture et de création ; version jouée ; confirmation de
  suppression ; écran Compte, trois purges, 409, vide, hors ligne, mobile) et
  `tests/unit/features/share/shareModel.test.ts` (13) ; le banc d'essai
  `harness.tsx` gagne `ui.shares` (les quatre routes).
- **Captures** (`tests/visual-baseline/lot13-d2.spec.ts`, back jetable, sortie
  `docs/qa-baselines/lot13-d2/mobile-390x844/` et `desktop-1440x900/`, dix chacune) :
  `01` feuille vide, aperçu sans notes ; `02` figé avec notes ; `03` deux liens ;
  `04` confirmation d'une purge ; `05` figé bloqué par la file ; `06` depuis une
  version jouée ; `07` Compte, « Listes partagées » avec un deck supprimé ; `08`
  et `09` confirmations de purge (sélection, decks supprimés) ; `10` suppression
  d'un deck qui a des figés. Au bureau, les captures du Compte restent à
  1440 × 900 : une capture pleine page redimensionne la fenêtre et remonte
  l'écran Compte, qui perd alors sa confirmation en cours (cause non
  recherchée, sans effet hors capture).
- **`data-testid`** ajoutés : `deck-share`, `deck-version-share`, `deck-share-offline`,
  `deck-version-share-offline`, `deck-delete-shares`, `deck-delete-shares-link`, et les
  préfixes `share-…` (feuille et lignes) et `account-shares-…` (écran Compte). Aucun
  disparu (777 en référence).
- **Chiffres** : lint, `tsc` (application et tests) propres ; vitest 1858 verts sur
  106 fichiers (arbre partagé avec D3 en cours) ; contrôle CRAP sans régression sur
  les fichiers de D2 (`ShareSheet`, à 33 au premier passage, a été découpé dans
  `ShareSheetParts.tsx`).
- **Correctifs du 2026-11-20, après relecture des captures** : les cases à cocher
  (carrés blancs du navigateur) prennent le style Nocturne, aucune case stylée
  n'existant dans l'application (les puces des filtres cachent leur `input`) :
  `appearance: none`, case de 22 px à bordure `--color-neutral-600`, cochée en
  `--color-accent` avec une coche, focus visible, dans un `<label>` de 44 px pour
  la cible tactile, libellé accessible gardé (`aria-label` de chaque case) ;
  règles dans le bloc « Lot 13 D2 » de `index.css`. Les fichiers de D2 quittent
  `features/sharing/` pour `features/share/` (mêmes noms, aucune collision), les
  tests pour `tests/unit/features/share/`. Les dix captures de chaque largeur sont
  refaites, la feuille n'étant prise qu'une fois sa transition d'ouverture finie
  (opacité à 1, position stable) ; la `03` du bureau avait été prise en
  transparence.

### Vérification d'intégration après B1, B2 et C1 (2026-11-20)

Les agents n'ayant pas relancé leurs suites complètes après leurs dernières
corrections, et B2 ayant régénéré le client TS après le passage de vitest de
C1, les deux suites ont été relancées en entier sur l'arbre réuni :
`uv run ruff check .` propre, `uv run pytest` à **3133 verts et 2 `xfail`**
(20 min 24 s) ; `npm run lint`, `tsc -p tsconfig.app.json` et
`npm run typecheck:tests` propres, vitest à **1792 verts sur 102 fichiers**.
Une disparition passagère des modifications de
`test_lot6_authorization_matrix.py`, relevée par l'agent de B1/B2 et refaite
par lui, a été contrôlée : le test de la route publique y est bien. Cause
probable : une resynchronisation de OneDrive.

## Tests attendus (E)

- **Back** : jeton inconnu ou purgé au même 404, jeton mal formé (7 ou 9
  caractères, tiret, accent) en 422 ; route publique identique avec ou sans
  cookie, sans `Cache-Control: private` ; limite de débit ; tirage du jeton
  qui retire sur collision ; vivant qui suit une modification du deck, figé
  qui ne bouge pas ; figé d'une version jouée ; nom d'utilisateur toujours
  présent, notes selon l'option ; deck archivé ; deck supprimé : vivants en
  404, figés toujours lisibles ; purge d'une sélection (refusée en entier
  pour un lien inconnu, d'un autre compte ou d'un deck supprimé), purge
  `deleted_decks` qui ne touche que les figés des decks supprimés, purge
  `all` qui vide tout, chacune limitée au compte ; filtre `ids` de
  `GET /cartes` ; isolation entre comptes sur les quatre routes sous
  session ; export du compte sans jeton ; aller-retour de R16 sur une base
  peuplée.
- **Front** : exports à l'octet près sur les huit fixtures ; en-tête `TWD`
  d'une version de tournoi ; conversion de la réponse publique en faits ;
  feuille de partage hors ligne (désactivée, message) et avec une file non
  vide (P4) ; sélection et purges ; plan de duplication (tout en proxy,
  notes, carte absente du miroir) ; comparaison sur une table de cas (ajouts,
  retraits, quantités, même carte sur plusieurs lignes) ; écarts d'une
  révision sur leur table de cas ; intention reprise après connexion.
- **e2e**, aux deux largeurs contre le vrai back : créer un lien vivant,
  l'ouvrir dans un contexte de navigateur **sans session**, modifier le deck,
  recharger la page publique ; créer un figé, modifier le deck, la page ne
  bouge pas ; purger une sélection, la page dit « Liste introuvable » ;
  supprimer le deck, le vivant tombe et le figé reste, puis tombe à la purge
  des decks supprimés depuis l'écran Compte ; un visiteur sans compte révise
  la liste et ouvre l'adresse de la révision dans un autre contexte ; un
  second compte duplique la liste (deck créé hors ligne après la lecture,
  puis rejoué) et la compare à un de ses decks. Navigation hors ligne vers
  `/listes/...` non servie par la coquille.

## Risques et points d'attention

- **Première donnée privée lisible sans session, derrière un jeton court.**
  Avec 63⁸ (P3), c'est la limite de débit par IP qui rend l'énumération
  vaine ; un attaquant aux adresses nombreuses la contourne en partie. Ce
  qu'il trouverait reste une liste que l'utilisateur a choisi de publier,
  avec son nom d'utilisateur et sans notes par défaut. Allonger le jeton plus
  tard ne demanderait qu'une révision, sans casser les liens existants.
- **Un lien d'un deck supprimé ne se purge pas à l'unité** (P5) : il part
  avec la purge des decks supprimés ou avec la purge totale.
- **Un figé survit à la suppression de son deck** (P5) : supprimer un deck ne
  le rend donc pas invisible. La confirmation de suppression le dit quand le
  deck a des liens figés, et en donne le nombre.
- **Une révision n'appartient à personne** (P8) : elle vit dans une adresse,
  ne se purge pas, et tombe seulement avec la liste d'origine. Ses écarts
  étant marqués, elle ne peut pas passer pour la liste de l'auteur.
- **Journaux.** Ceux de l'API n'écrivent que le gabarit de route ; ceux de
  nginx gardent le chemin complet, donc les jetons. Acceptable sur un VPS que
  seul l'utilisateur administre, à noter dans `docs/deploiement.md`.
- **Un lien vivant montre ce que contient le deck au moment de la lecture**,
  y compris une carte ajoutée par erreur ; la feuille de partage le dit.
- **L'intention qui traverse la connexion** (A8, A9) est la première à
  survivre à l'écran de connexion ; elle ne doit pas se rejouer à chaque
  démarrage. Consommée une fois, comme les autres.
- **Le cache d'une minute** retarde une purge d'autant, chez le visiteur
  qui avait déjà ouvert la page.
- **`main.tsx` gagne une branche avant `AuthGate`** : une erreur là casserait
  toute l'application, pas seulement la page publique. Tests unitaires de
  l'aiguillage, e2e sur les deux chemins.
- **Les exports suivent des formats tiers non documentés**, relevés sur des
  exports réels ; VDB peut les changer sans prévenir.

## Critère de fin de lot

Un lien vivant et un lien figé s'ouvrent depuis un téléphone sans compte, en
HTTPS sur la production, et montrent la bonne liste ; une purge les fait
tomber, la suppression du deck fait tomber le vivant et garde le figé ; un
visiteur révise la liste et partage la révision ; un second compte duplique
la liste et la compare à un de ses decks ; les quatre formats d'export
recollés dans VDB retrouvent la même liste ; l'art de l'extension s'affiche
dans la Collection en ligne et le pictogramme hors ligne ; les quatre acquis
de la v1 (§3 de CLAUDE.md) tiennent, file en attente rejouée après la mise à
jour comprise ; v1.2.0 en production, CLAUDE.md à jour.
