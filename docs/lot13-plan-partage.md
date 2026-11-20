# Lot 13 — Partage (v1.2) : plan d'implémentation

Statut : **proposé le 2026-11-20, P1 à P10 tranchées le même jour (A0)**,
décisions de conception reprises en conséquence ; A1 à lancer. Rédigé sur la
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
  masqué par le soulignement d'un lien. À confirmer à A1, `_` par défaut ;
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
| A1 | contrat (cinq opérations, filtre `ids` de `GET /cartes`), R16, schémas, client TS régénéré, chiffres de départ recomptés | architecte-contrat |
| B1 | service des liens, routes sous session, trois purges, suppression d'un deck qui révoque les vivants et garde les figés | backend-fastapi |
| B2 | route publique : limite, cache, 404 uniforme, matrice d'autorisation ; filtre `ids` ; export du compte | backend-fastapi |
| C1 | `API_ROUTE_PREFIXES`, interception de `#/liste/` dans `main.tsx` sans base ni moteur | pwa-offline |
| D1 | exports `TWD`, `JOL`, `LACKEY` et choix du format dans la feuille d'export | frontend-react |
| D2 | feuille de partage (deck, version), « Listes partagées » et ses purges dans l'écran Compte | frontend-react |
| D3 | page publique, aux deux largeurs | frontend-react |
| D4 | art de l'extension dans la Collection | frontend-react |
| D5 | « Dupliquer » et « Comparer » : intentions, reprise après connexion, feuille d'import alimentée par la liste, écran de comparaison | frontend-react, pwa-offline pour l'intention qui traverse `AuthGate` |
| D6 | « Réviser » : édition sur la page publique, écarts dans l'adresse, affichage d'une révision | frontend-react |
| E | tests manquants, e2e, CRAP, recensement des `data-testid`, captures | qa-tests |
| F | mise en service v1.2.0 : staging, essai de R16 sur une copie de la production, release, production, vérification sur téléphone et depuis un appareil sans compte | utilisateur, devops-deploiement |

D1 et D4 ne dépendent ni du contrat ni de R16 : elles peuvent commencer dès
A0, en parallèle d'A1.

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
