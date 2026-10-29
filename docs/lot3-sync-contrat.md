# `POST /sync` — contrat de la file hors ligne

Brief de départ du Lot 3, écrit par l'architecte contrat avant toute
implémentation. Il décrit ce que la route promet ; le service qui la tiendra
revient au backend, la file qui l'alimentera à la couche offline, et les deux
lisent le même texte. La description formelle, elle, est dans
`contracts/openapi.json` (schémas `SyncRequest` / `SyncResult`) et dans les
docstrings de `backend/app/schemas/sync.py`.

État au moment où ces lignes sont écrites : la route est servie par
`app.services.sync`, le journal d'idempotence existe, le lot est traité sous
verrou d'écriture, et le client TypeScript est généré depuis le contrat. La 501
des tout premiers jours a disparu, comme prévu.

## Ce que `/sync` fait, et ce qu'il ne fait pas

Une saisie faite au club sans réseau part dans une file IndexedDB. Au retour de
la connexion, le client envoie cette file à `/sync` sous forme d'un lot
ordonné, et reçoit un verdict par opération. C'est tout. Rien ne redescend
d'autre que des verdicts : après une synchronisation, le client rafraîchit ce
qui l'intéresse par les `GET` existants, puisqu'il est en ligne par
construction. Un delta descendant du genre « qu'est-ce qui a changé depuis ? »
n'aurait pas de sens ici, où le serveur ne bouge que sous l'action de ce seul
client.

Le périmètre se limite aux ressources qui existent déjà : la collection, les
decks, leur composition, le versement d'un produit. Huit types d'opérations :

| `type` | Équivalent en ligne |
| --- | --- |
| `stock.upsert` | `POST` ou `PATCH /stock` |
| `stock.delete` | `DELETE /stock/{card_id}/{language_code}/{card_set_id}` |
| `deck.create` | `POST /decks` |
| `deck.update` | `PATCH /decks/{id}` (archivage compris) |
| `deck.delete` | `DELETE /decks/{id}` |
| `deck_card.upsert` | `POST` ou `PATCH /decks/{id}/cartes` |
| `deck_card.delete` | `DELETE /decks/{id}/cartes/{card_id}/{language_code}/{card_set_id}` |
| `bundle.deposit` | `POST /bundles/{id}/stock` |

Le catalogue n'y est pas : il ne bouge que par l'import krcg. Les langues non
plus, `POST /langues` restant une écriture en ligne (voir les points ouverts).
Les parties et les tournois attendaient le Lot 7 : les inscrire ici avant qu'ils
aient une route aurait promis une synchronisation sans destination. Ils sont
arrivés avec leurs routes, et douze types de plus portent `/sync` à vingt (voir
la section « Lot 7 » en fin de document).

Deux écarts de vocabulaire par rapport à REST. D'abord, `upsert` : une file
rejouée ne sait pas ce que le serveur possède déjà, donc l'opération crée ou
remplace, et la charge utile porte l'état complet voulu. Ensuite, pas
d'opération d'archivage : archiver, c'est `deck.update` avec `archived`,
exactement comme en ligne.

Pour le reste, la charge utile est celle de la route correspondante, réutilisée
telle quelle (`CardCopyCreate`, `DeckCreate`, `DeckUpdate`, `DeckCardCreate`,
`BundleDeposit`). Le front n'a donc qu'une forme à écrire, à stocker et à
tester, en ligne comme hors ligne.

Depuis le Lot 4 (passe A), l'autorisation de proxy appartient au deck et non
plus à l'entrée de collection. `deck.create` et `deck.update` la transportent
dans `data.proxy_allowed` (`DeckCreate` : facultatif, `false` par défaut ;
`DeckUpdate` : facultatif, non nullable). `stock.upsert` ne la porte plus :
`CardCopyCreate` a perdu le champ, sans période de compatibilité (décision D4,
`docs/lot4-plan-inventaire.md`). Une ancienne opération `stock.upsert` qui le
contiendrait encore serait refusée en 422 (champ inconnu), et la bissection du
client l'isolerait.

Depuis le Lot 4 (passe B), une entrée de collection se désigne par carte ×
langue × extension. `card_set_id` est **obligatoire** partout où figure
`language_code` : dans `data` de `stock.upsert` (`CardCopyCreate`) et de
`deck_card.upsert` (`DeckCardCreate`), et à plat dans `stock.delete` et
`deck_card.delete`. Même règle que pour le proxy, sans période de
compatibilité (D4) : une opération en file sans `card_set_id` est refusée en
422 et isolée par la bissection. `bundle.deposit` ne change pas, l'extension
venant du produit. Le détail est dans la dernière section de ce document.

## Clés d'idempotence

Chaque opération porte un `operation_id`, un UUID que le client tire **au
moment de la saisie**, pas au moment de l'envoi. C'est le point le plus
important du lot : c'est lui, et lui seul, qui distingue « l'utilisateur a
versé deux fois le même produit » de « le réseau a coupé et le client a rejoué
le même versement ».

Le serveur journalise chaque verdict dans `sync_operation`
(`backend/app/models/sync.py`), indexé sur cette clé. Une clé déjà tranchée
n'est pas réappliquée : le serveur rend le verdict mémorisé, et l'issue devient
`replayed`. C'est ce qui rend `bundle.deposit` sûr au rejeu, là où
`POST /bundles/{id}/stock` additionne à chaque appel — la limite connue n° 2 du
§11 de CLAUDE.md se solde ainsi, pour les écritures qui passent par la file.

Le journal mémorise aussi une empreinte du corps reçu (sha256 de la
représentation JSON des champs fournis, clés triées ; recette figée dans
`fingerprint()`). Une clé déjà vue qui revient avec un corps différent n'est pas
un rejeu mais une collision, et rendre le verdict d'une autre requête serait
plus grave que de refuser : c'est le motif `mismatched_replay`. Corollaire pour
le client : ne jamais modifier une opération déjà en file sans lui donner une
nouvelle clé.

Un lot ne peut pas contenir deux fois la même clé, ni deux créations partageant
la même référence client. Le cas est traité en 422, avant toute écriture : un
lot qui se contredit lui-même signale un bug côté client, et deviner laquelle
des deux entrées compte serait pire que refuser.

## Désigner un deck créé hors ligne

Un deck créé sans réseau n'a pas d'identifiant serveur, et ne peut pas en
avoir : son discriminant est tiré par le serveur, donc son identité n'existe
qu'après coup. Le client lui donne alors une référence à lui, `client_ref` (un
UUID, jamais réutilisé), que `deck.create` porte et que les opérations
suivantes réemploient par `DeckRef` (`{"deck_id": 12}` ou
`{"client_ref": "…"}`, l'un ou l'autre, jamais les deux).

La correspondance référence → identifiant est mémorisée au journal, pas
seulement le temps d'une requête. Ajouter des cartes au deck tout juste créé
fonctionne donc aussi bien dans le même lot qu'un mois plus tard, et même si le
client a perdu la réponse qui lui donnait l'identifiant.

Une référence n'est réservée que par une création **appliquée**. Une création
refusée laisse sa trace au journal sans condamner la référence : le client
corrige sa saisie et rejoue, avec une nouvelle clé d'idempotence et la même
référence.

## Ordre d'application

Les opérations d'un lot sont appliquées dans l'ordre reçu, et cet ordre est
significatif : une carte ne s'ajoute qu'à un deck déjà créé. Le client envoie
donc sa file dans l'ordre de saisie, sans la réordonner ni la compacter.
Un lot est plafonné à 200 opérations ; une file plus longue se découpe, ce qui
ne coûte rien puisque les clés et les références survivent d'un lot à l'autre.

Ce qui n'ordonne rien, en revanche, c'est `recorded_at`. Ce champ existe (fuseau
obligatoire, normalisé en UTC), il est journalisé, et il documente quand
l'utilisateur a agi. Aucune règle ne s'y adosse : l'horloge d'un téléphone
dérive, se remet à l'heure d'un coup et voyage avec son propriétaire. Un
`recorded_at` dans le futur est accepté sans broncher — perdre une saisie parce
que le téléphone avance de deux minutes serait absurde.

## Politique de conflit

Décidée au Lot 3, en une phrase : **la file fait foi, les invariants font
loi**.

La file fait foi. Les charges utiles d'upsert portent l'état complet voulu, et
le serveur les écrit sans se demander ce qu'il contenait auparavant. Dernière
écriture gagnante, donc, l'ordre étant celui de la file. C'est le comportement
attendu d'une saisie faite pour de vrai au club, que le réseau n'a fait que
retarder. Aucune comparaison de version, aucune comparaison d'horloge.

Les invariants font loi. Une opération n'est refusée que si le serveur l'aurait
refusée en ligne, et pour les mêmes raisons : exemplaires insuffisants, proxy
non autorisé par le deck, interdiction du proxy sur un deck qui en joue, deck
archivé ou supprimé, activation d'un deck illégal, entrée de stock encore
allouée, extension où la carte n'a pas été imprimée. `/sync` n'assouplit ni ne durcit les règles des services ;
il les traverse.

Un refus n'arrête rien. Le lot continue, chaque opération reçoit son verdict, et
le client garde la main pour corriger. La seule conséquence en chaîne est
voulue : une création refusée rend irrésolvables les opérations qui la
désignaient, refusées à leur tour avec le motif `unresolved_client_ref`.

Ce qui n'est pas fait : aucune garde optimiste du genre « n'applique que si la
ressource est encore dans l'état X ». Le jour où deux appareils écriraient la
même base, il faudrait ajouter une condition par opération. Le contrat
l'accueillerait sans rupture, ce serait un champ facultatif de plus.

## Ce que le serveur répond

Un résultat par opération, dans le même ordre que la requête, plus trois
compteurs et un `batch_id` que le serveur tire pour relier une trace client à ce
qui a été journalisé. La réponse d'un lot traité est toujours un 200 : un lot ne
bascule jamais en bloc, et ni 404 ni 409 ne sortent de cette route.

Chaque résultat porte une issue (`outcome`) et, le cas échéant, un motif
(`error`). Trois issues seulement : `applied` (écrit maintenant), `replayed`
(la clé était connue, le verdict d'alors est rendu tel quel, rien n'a été
refait) et `rejected`. Le conflit n'est pas une quatrième issue mais un code
d'erreur, parce que deux axes valent mieux qu'un : l'issue dit si l'écriture a
eu lieu, le code dit pourquoi elle n'a pas eu lieu.

Les cinq motifs : `not_found` (la ressource n'existe pas, y compris une
impression : une carte rangée dans une extension où elle n'a pas été imprimée), `conflict` (une règle
métier s'y oppose), `invalid` (charge utile invalide, typiquement après fusion
avec la ligne existante), `unresolved_client_ref` (la ressource désignée par
une référence client, un deck jusqu'au Lot 7, n'a jamais été créée, ou sa
création a échoué) et `mismatched_replay` (même clé, autre
corps). Le champ `message` reprend le texte du service, celui-là même que la
route en ligne aurait mis dans son 404 ou son 409 : il est fait pour être
affiché.

Une opération `replayed` peut très bien porter une erreur. C'est le refus
mémorisé, rendu à l'identique.

La ressource touchée revient en identifiants seulement (`resource`), pas en
objets. Un versement de produit touche des centaines d'entrées de collection, et
le client rafraîchit par les `GET`. Ce dont il a réellement besoin ici, c'est du
`deck_id` attribué à un deck créé hors ligne. Depuis le Lot 4, `resource`
porte aussi `card_set_id` pour les opérations `stock.*` et `deck_card.*` (nul
pour un deck, un versement, ou une opération journalisée avant le Lot 4).

## Les deux réponses qui ne tranchent rien

Deux codes sortent de `/sync` sans porter de verdict sur une seule opération.
Ils se ressemblent par là, et il ne faut les confondre ni l'un avec l'autre, ni
avec un refus.

**422 — le lot est mal formé.** Clé d'idempotence répétée, deck désigné à la
fois par son identifiant et par sa référence, borne dépassée, champ inconnu :
Pydantic refuse avant que le service ne soit appelé. Rien n'a été écrit, et
renvoyer le même lot ne servirait à rien — c'est la file qu'il faut corriger.

**503 — le verrou d'écriture n'a pas été obtenu.** Un lot est traité sous
transaction exclusive (`app.db.locking`), prise avant toute lecture ; si une
autre écriture tient la base au-delà du délai d'attente du pilote SQLite (5 s
par défaut), la route rend un 503 au format `ErrorResponse`
(`{"detail": "…"}`), assorti d'un en-tête `Retry-After` en secondes — une
seconde, le verrou ne couvrant que le temps d'un lot. Ce n'est pas un refus,
c'est une indisponibilité passagère : le verrou est pris *avant* la première
lecture, donc le lot n'a pas commencé, et **rien n'a été appliqué**.

Le client réessaie après ce délai et renvoie **le même lot, clés comprises**. Le
renvoi est sûr même dans le cas limite où le verrou aurait bien été pris et la
réponse perdue en route : les clés d'idempotence sont là pour ça, les
opérations déjà tranchées reviendraient simplement en `replayed`. Ce qu'il ne
faut surtout pas faire, c'est traiter le 503 comme un verdict — vider la file,
marquer les opérations comme refusées, ou leur tirer de nouvelles clés (ce
dernier geste transformerait un rejeu sûr en double écriture).

## Ce que le client doit stocker

Dans IndexedDB, pour chaque opération en file :

- la charge utile complète, sous la forme exacte du contrat (c'est elle qui
  sera envoyée, et c'est sur elle que porte l'empreinte) ;
- son `operation_id`, tiré à la saisie et **jamais régénéré**, y compris après
  un échec réseau, un rechargement de l'application ou une mise à jour du
  service worker ;
- son `recorded_at`, avec le fuseau local du moment ;
- son rang dans la file, l'ordre étant significatif ;
- son état local : en attente, envoyée, tranchée.

Et, hors de la file, une table de correspondance `client_ref` → `deck_id`,
alimentée par les résultats. Elle est ce qui permet à l'application d'afficher
un deck saisi hors ligne avant même qu'il existe côté serveur, puis de le
raccorder à son identité réelle. Une référence est tirée une fois pour un objet
et jamais réutilisée, même entre deux installations.

Au retour d'un `replayed`, il n'y a rien à faire de plus qu'au retour d'un
`applied` : dans les deux cas, l'opération est tranchée et sort de la file.
Un `rejected` ne doit pas être rejoué tel quel — la même clé rendrait
éternellement le même refus. C'est une saisie à corriger, donc une nouvelle
opération avec une nouvelle clé.

## Limites connues du verrou (et deux voisines)

**Le verrou ferme une course, pas toutes.** Un lot est sérialisé vis-à-vis d'un
autre lot : deux `/sync` concurrents se font la queue, et la comptabilité du
stock — « vérifier puis écrire », limite connue n° 1 du §11 de CLAUDE.md —
devient sûre entre eux. Elle ne l'est pas vis-à-vis des routes en ligne :
`POST /decks/{id}/cartes`, `PATCH /stock/{card_id}/{language_code}/{card_set_id}` et leurs
voisines écrivent sur une session ordinaire, sans passer par
`serialized_writes`. Une saisie faite dans l'interface pendant qu'un lot se
synchronise peut donc encore sur-allouer une entrée. Sans effet en usage
mono-utilisateur séquentiel, qui est le nôtre.

**Le verrou est propre à SQLite.** `serialized_writes` s'appuie sur
`BEGIN IMMEDIATE` et lève `NotImplementedError` sur tout autre dialecte, plutôt
que d'ouvrir un bloc qui ne protégerait rien. Une migration vers Postgres (§2 de
CLAUDE.md) demanderait l'équivalent : un verrou consultatif
(`pg_advisory_xact_lock`) ou un `SELECT … FOR UPDATE` sur les lignes de
`card_copy` en jeu.

**`invalid` est atteignable par `/sync`.** Il l'était déjà depuis le Lot 4b
(`acquired_quantity` au-delà de ce que le remplacement ajoute) ; depuis le Lot 7,
il est le motif courant des règles de table, de ronde, de score, de niveau, de
dates et de classement, que les services de la pratique de jeu rendent en 422. Le
client doit savoir le lire et proposer de corriger la saisie.

**Une langue inconnue n'est pas repliée côté serveur.** Une opération qui
désigne un code de langue absent de la table est refusée `not_found`, comme
`POST /stock` la refuserait en ligne. Le repli sur `XX` (« autre ») décrit
ci-dessous est à la charge de la file cliente, au moment de la saisie : le
serveur ne devine pas ce que l'utilisateur voulait dire.

## Points ouverts, à trancher plus tard

Une langue inconnue du serveur ne peut pas naître hors ligne, `POST /langues`
n'ayant pas d'équivalent dans la file. Une saisie dans une langue absente doit
se rabattre sur `XX` (« autre »), quitte à la corriger en ligne. La liste des
langues reste ouverte côté base, donc rien n'interdit d'ajouter
`language.create` plus tard si l'usage le réclame.

Faire passer les écritures en ligne par le même verrou reste à trancher. Cela
fermerait la dernière course décrite plus haut, au prix d'une sérialisation de
toutes les écritures de l'application — cher payé tant qu'un seul utilisateur
écrit, à reconsidérer si ce n'est plus le cas.

Enfin, un retour arrière sur la migration `8cc70f4bbbcc` supprime le journal.
Une file déjà synchronisée et rejouée ensuite serait réappliquée, versements de
produits compris. Vider la file côté client avant tout `downgrade`.

## Lot 4, passe B : l'extension dans l'identité du stock

Décisions de schéma prises à l'étape B1 (architecte-contrat), à l'usage du
backend (B2) et du front (C, D, E). Le cadre est dans
`docs/lot4-plan-inventaire.md` (D1 à D6) ; ce qui suit en est la traduction
dans le modèle et le contrat.

**Révision `b7e41d0c9a52`**, à la suite de `6c9a178b7a1d`. Même garde que la
passe A : elle exige `card_copy`, `deck_card` et `deleted_deck_card` vides, à
la montée comme à la descente, et s'arrête sur un message explicite sinon
(D3). Les trois tables sont supprimées puis recréées (elles sont vides), dans
l'ordre imposé par leurs références ; la descente rend exactement le schéma de
`6c9a178b7a1d`. Elle ne se rejoue pas hors ligne (`--sql`), la garde lisant la
base.

**Modèle.**

- `card_copy` : clé (`card_id`, `language_code`, `card_set_id`). Clé
  étrangère composite (`card_id`, `card_set_id`) vers `card_printing`, qui
  porte depuis la révision initiale l'unicité
  `uq_card_printing_card_id_card_set_id` : la base refuse une entrée dans une
  extension où la carte n'a pas été imprimée. Les clés étrangères vers `card`
  et `language` restent. Pas d'`ondelete` : une impression utilisée par le
  stock ne se supprime pas, ce qui protège la seule suppression que l'import
  s'autorise (l'impression tampon, D2c).
- `deck_card` : clé (`deck_id`, `card_id`, `language_code`, `card_set_id`),
  clé étrangère à trois colonnes vers `card_copy`. L'index de réconciliation
  s'appelle désormais `ix_deck_card_card_id_language_code_card_set_id`.
- `deleted_deck_card` : `card_set_id` dans la clé, clé étrangère vers
  `card_set` (pas vers `card_printing` ni `card_copy`).
- `card_set.is_placeholder` : booléen NOT NULL, `false` par défaut (aussi
  côté base), marqueur de l'extension tampon (D2b).
- `sync_operation.card_set_id` : entier nullable, pour que le verdict rejoué
  d'une opération `stock.*` ou `deck_card.*` rende la même `SyncResourceRef`
  que le verdict d'origine. Ajout qui n'était pas dans le plan : sans cette
  colonne, `resource.card_set_id` d'un `replayed` serait toujours nul.

**Contrat** (24 opérations, 16 chemins).

- `card_set_id` obligatoire, entier de 1 à 2³¹ − 1 : `CardCopyCreate`,
  `DeckCardCreate`, `StockDeleteOperation`, `DeckCardDeleteOperation`, et en
  lecture `CardCopyRead`, `DeckCardRead`. `SyncResourceRef.card_set_id` est
  nullable. `BundleDeposit` et `CardCopyUpdate` ne changent pas.
- Chemins : `/stock/{card_id}/{language_code}/{card_set_id}` et
  `/decks/{deck_id}/cartes/{card_id}/{language_code}/{card_set_id}`. Les
  `operationId` ne changent pas.
- `GET /stock` accepte un filtre `card_set_id`.
- Nouvelle opération `GET /extensions` (`listCardSets`) : liste de
  `CardSetRead`, qui gagne `is_placeholder`. Tri par date de sortie, les
  extensions sans date en dernier, puis par abréviation.
- `GET /cartes` rend désormais des `CardListItem` (et non plus des
  `CardSummary`) : `CardSummary` plus `card_set_ids` (extensions
  d'impression, triées par identifiant) et `latest_card_set_id` (D2a). La
  fiche `CardRead` hérite des deux champs. `CardSummary` lui-même ne change
  pas : c'est la vue courte embarquée dans le stock, les decks et les
  produits, où ces champs n'auraient pas d'usage et coûteraient une requête.
- Refus « hors impression » : 404 en ligne (`POST /stock`,
  `POST /decks/{id}/cartes`), `not_found` par `/sync`, comme pour une carte ou
  une langue inconnue. Pour une ligne de deck, le contrôle d'impression passe
  avant celui de la présence en collection : une entrée qui ne peut pas
  exister est un 404, une entrée qui pourrait exister mais manque reste un
  409.

**Laissé à B2** (marqué `TODO B2` dans le code) :

- le contrôle d'impression avant écriture dans `stock.create_copy` et
  `decks.add_card` ; en attendant, la clé étrangère refuse et le refus sort
  en 409 par `commit_or_conflict` (création de stock) ou en 409 « pas en
  collection » (ligne de deck), pas en 404 ;
- `catalog.latest_card_set_id` : calcul provisoire sur la seule
  `release_date` de l'extension ; la règle complète de D2a (dates des
  occurrences, extension datée avant non datée, abréviation, tampon en
  dernier recours) et son calcul par page de résultats restent à écrire ;
- l'import : identifiants d'extension et d'impression stables au rejeu,
  extension tampon, rapport enrichi, `--json` (D2b, D2c) ;
- la légalité : agrégation des lignes d'une même carte sur ses impressions,
  dédoublonnage de `banned_cards` et `not_yet_legal_cards`.

La clé a déjà été propagée mécaniquement dans les services (recherches,
écritures, comptabilité par carte × langue × extension, versement sous
`bundle.card_set_id`, recopie dans `deleted_deck_card`, journal de `/sync`),
pour que les routes restent cohérentes avec leurs signatures.

**Pour le front.** Les miroirs locaux se clefent sur les mêmes triplets
(`[cardId+languageCode+cardSetId]`), `cardSets` se remplit par
`GET /extensions`, et `CardRow` stocke `card_set_ids` et
`latest_card_set_id` tels que le serveur les rend : l'impression par défaut
d'une carte jouée en proxy ne se recalcule pas côté client.

## Lot 4b : acquisition depuis un deck

`deck_card.upsert` accepte `data.acquired_quantity` (facultatif, 0 par
défaut) : des exemplaires physiques qui entrent en collection avec la ligne,
sous le même point de sauvegarde. Pas de type d'opération nouveau (il aurait
fallu migrer le CHECK de `operation_type`). Le champ est un delta, borné par ce
que l'upsert ajoute d'exemplaires réels à la ligne (`invalid` au-delà) ; le
journal empêche de le rejouer, la borne empêche de compter deux fois une saisie
mise en file sous deux clés. Détail et cas de test :
`docs/lot4b-acquisition-depuis-deck.md`.

## Lot 6 : un journal par compte

Le Lot 6 met un propriétaire sur chaque donnée privée
(`docs/lot6-plan-comptes.md`). Pour `/sync`, les huit types d'opérations et
leurs charges utiles ne changent pas, et aucun corps ne porte de `user_id` :
le compte vient de la session, jamais du client. Un `user_id` glissé dans une
opération est un champ inconnu, donc un 422 comme les autres.

**Session.** La route exige une session (cookie, schéma de sécurité
`sessionCookie` du contrat). Elle est vérifiée **une fois**, avant de prendre
le verrou d'écriture ; une session qui expire pendant le lot ne l'interrompt
pas. Un 401 a le sens d'un 503 : **rien n'a été appliqué ni journalisé**, et le
lot se renvoie à l'identique après reconnexion, mêmes clés et mêmes corps. Le
client ne doit ni bissecter sur un 401 (il ne dit rien d'une opération en
particulier), ni marquer d'opération refusée, ni purger : c'est une pause.
S'y ajoute le 403 du contrôle d'`Origin` des écritures, commun à toutes les
méthodes d'écriture du contrat ; lui non plus ne tranche rien.

**Idempotence par compte.** La clé d'idempotence devient (`user_id`,
`operation_id`) : contrainte `uq_sync_operation_user_id_operation_id`, et la
recherche des clés déjà tranchées filtre sur le compte de la session. Une
`operation_id` déjà employée par un autre compte est **neuve** pour celui-ci :

- pas de `replayed`, qui rendrait le verdict d'un autre compte ;
- pas de `mismatched_replay`, qui révélerait que la clé existe ailleurs.

`mismatched_replay` ne se produit donc qu'à l'intérieur d'un même compte. Une
clé tirée en UUID v4 ne devrait jamais se retrouver dans deux comptes ; la
règle ferme la fuite pour le cas où un client la réutiliserait quand même.

**Références client par compte.** La résolution `client_ref` → `deck_id` et
l'unicité des créations appliquées filtrent sur le compte (index partiel
`ux_sync_operation_client_ref` sur (`user_id`, `client_ref`), même condition
`client_ref IS NOT NULL AND status = 'applied'`). Une `client_ref` prise par un
autre compte se comporte **exactement** comme une référence inconnue : même
code (`unresolved_client_ref`, le refus du Lot 3 pour une référence absente du
journal), même message. Le compte courant peut créer un deck sous cette même
référence, sans conflit.

**Decks d'un autre compte.** Toute opération qui désigne un deck par
`deck_id` (`deck.update`, `deck.delete`, `deck_card.upsert`,
`deck_card.delete`) rend `not_found` pour un deck d'un autre compte, avec le
message d'un deck inexistant. Rien ne distingue « n'existe pas » de
« appartient à un autre ».

**Invariants, reformulés par compte.** La politique de conflit ne change pas
(« la file fait foi, les invariants font loi »), mais les invariants sont
désormais ceux du compte :

- la comptabilité du stock compare les exemplaires réels alloués par les decks
  vivants **du compte** à `quantity_owned` de son entrée ; les decks d'un autre
  compte n'entrent jamais dans la somme ni dans le message d'un `conflict` ;
- une ligne de deck qui consomme un exemplaire réel exige une entrée de
  collection **du même compte** ;
- le discriminant d'un deck est unique parmi les decks du compte (D2) : deux
  comptes peuvent avoir chacun leur « Banu Princes#1234 », et l'épuisement des
  9999 discriminants d'un nom ne compte que les decks du compte ;
- `bundle.deposit` verse le produit (partagé) dans la collection du compte.

**Journal converti, pas vidé.** La révision `89695b77ef45` rattache les lignes
existantes de `sync_operation` au compte historique (`1`). Une opération déjà
tranchée qui attend encore dans une file reste un rejeu après la migration, à
condition que la file soit renvoyée sous ce compte : c'est pourquoi le client
n'envoie jamais la file d'un compte sous la session d'un autre (une base
IndexedDB par compte, adoption explicite de la base d'avant le Lot 6 ; cf.
étape C du brief). Le journal garde sa règle « aucune clé étrangère » :
`user_id` y est un identifiant, pas une relation.

**Verrou.** `serialized_writes` reste global à la base : le lot d'un compte fait
attendre celui d'un autre, au pire jusqu'au 503 + `Retry-After`. Limite
acceptée pour le pilote ; un portage Postgres pourrait verrouiller par compte
(`pg_advisory_xact_lock(user_id)`), les invariants étant désormais tous par
compte.

## Lot 7 : joueurs, lieux, tournois, parties

Le Lot 7 (`docs/lot7-plan-parties.md`) ajoute douze types d'opérations, ce qui
porte `/sync` à vingt. Le principe du Lot 3 ne bouge pas : chaque opération
reprend telle quelle la charge utile de la route en ligne, et
`app.services.sync` appelle le service de cette route, avec
`allow_client_ref=True` là où il existe. Aucune règle métier n'est écrite dans
le module de synchronisation. Le contrat garde ses 49 opérations ; seul le
corps de `POST /sync` s'élargit. Aucune migration à cette étape : la révision
R10 avait déjà élargi les CHECK de `operation_type` et de `resource_kind`.

| `type` | Désignation | Charge utile | Équivalent en ligne |
| --- | --- | --- | --- |
| `player.create` | `client_ref` | `PlayerCreate` | `POST /joueurs`, en upsert par nom |
| `player.update` | `player` (`PlayerRef`) | `PlayerUpdate` | `PATCH /joueurs/{id}` |
| `player.delete` | `player` (`PlayerRef`) | — | `DELETE /joueurs/{id}` |
| `venue.create` | `client_ref` | `VenueCreate` | `POST /lieux`, en upsert par nom |
| `venue.update` | `venue` (`VenueRef`) | `VenueUpdate` | `PATCH /lieux/{id}` |
| `venue.delete` | `venue` (`VenueRef`) | — | `DELETE /lieux/{id}` |
| `tournament.create` | `client_ref` | `TournamentCreate` | `POST /tournois` |
| `tournament.update` | `tournament` (`TournamentRef`) | `TournamentUpdate` | `PATCH /tournois/{id}` |
| `tournament.delete` | `tournament` (`TournamentRef`) | — | `DELETE /tournois/{id}` |
| `game.create` | `client_ref` | `GameCreate`, table comprise | `POST /parties` |
| `game.update` | `game` (`GameRef`) | `data` (`GameUpdate`) et `table` (`GameTableReplace`), tous deux facultatifs | `PATCH /parties/{id}` et `PUT /parties/{id}/participations`, en une fois |
| `game.delete` | `game` (`GameRef`) | — | `DELETE /parties/{id}` |

**Désigner.** Les quatre références nouvelles suivent le patron de `DeckRef` :
`{"player_id": 12}` ou `{"client_ref": "…"}`, exactement l'un des deux (de
même avec `venue_id`, `tournament_id`, `game_id`). Les créations portent une
`client_ref` obligatoire, à plat dans l'opération ; une modification ou une
suppression n'en porte jamais à plat, elle désigne. Les charges utiles
désignent à leur tour par référence : `venue` dans un tournoi et dans une
partie, `tournament` dans une partie, et sur chaque ligne de table `player`
(`ParticipantRef`, qui accepte aussi `{"me": true}` pour le « Moi ») et `deck`
(`DeckRef`). Une `client_ref` n'est admise que par `/sync` : la même charge
utile envoyée à une route en ligne avec une référence client rend un 422.

**Ce que le verdict rend.** `SyncResourceKind` gagne `player`, `venue`,
`tournament` et `game`, et `SyncResourceRef` les quatre identifiants
correspondants. Pour une opération du Lot 7, un seul des quatre est rempli,
celui de son genre, et toutes les autres colonnes restent nulles : un
`tournament.create` qui désigne un lieu ne rend pas de `venue_id`. Les
modifications et suppressions rendent elles aussi l'identifiant de leur genre,
comme `deck.update` rend son `deck_id`, mais seules les créations renvoient une
`client_ref`, dans le résultat comme au journal. Un `replayed` relit ces
colonnes au journal et rend donc les mêmes identifiants, le même verdict et le
même `processed_at` qu'à l'origine.

**Résoudre une référence.** Une `client_ref` se résout au journal du compte,
parmi les créations appliquées **du genre attendu** (`resource_kind`) : celle
d'un lieu passée là où l'on attend un tournoi ne désigne rien. Une référence
d'un autre genre, d'un autre compte, jamais créée ou dont la création a été
refusée est rejetée en `unresolved_client_ref`, avec un message du type
« Aucun tournoi n'a été créé sous la référence client 'x' (création absente du
journal, ou refusée). ». La résolution ignore l'état actuel de la ressource :
la référence d'un joueur supprimé depuis se résout encore vers son
identifiant, et c'est le service qui répond ensuite `not_found` (« Joueur 12
introuvable. »). Un identifiant d'un autre compte rend `not_found` avec le
message d'un identifiant inconnu, qu'il désigne la ressource de l'opération ou
une ressource imbriquée (le lieu d'une partie, le joueur ou le deck d'une ligne
de table).

**Une référence déjà prise.** L'unicité des références vaut pour tous les
genres à la fois : l'index `ux_sync_operation_client_ref` porte sur
(`user_id`, `client_ref`) sans regarder le genre. Avant d'écrire, chacune des
cinq créations (`deck.create` compris) vérifie donc que sa référence n'a été
donnée à aucune création appliquée du compte, quel qu'en soit le genre. Si
c'est le cas, le refus est un `conflict`, jamais une erreur d'intégrité qui
ferait échouer le lot : « La référence client 'x' désigne déjà le lieu 4 : une
référence n'est jamais réutilisée, en tirer une nouvelle. » Le message de
`deck.create` n'a pas changé. Une création refusée ne réserve rien : on peut la
corriger et la renvoyer sous la même référence, avec une nouvelle clé
d'idempotence. Dans un même lot, deux créations qui partagent une
`client_ref`, de genres identiques ou non, rendent un 422 pour le lot entier,
avant toute écriture.

**Upsert par nom (P5).** `player.create` et `venue.create` cherchent d'abord une
ressource du compte de même nom, après rognage et repli par `fold_text`, comme
la recherche (« Éloïse » et « eloise » sont le même joueur). S'il en existe une,
l'opération est `applied` sans rien écrire, et la référence est liée à
l'identifiant existant. Trois conséquences :

- un `applied` ne veut pas dire « créé » ; deux références peuvent désigner le
  même joueur ou le même lieu, et un renommage passé par l'une se voit par
  l'autre ;
- un `venue.create` dont le nom existe déjà n'applique ni sa ville ni ses
  notes : le lieu reste tel qu'il était, et c'est un `venue.update` qui le
  modifie ;
- une table qui désigne deux fois le même joueur par deux références ainsi
  liées est refusée en `invalid` (« La table désigne plusieurs fois le même
  joueur. »).

Le « Moi » est exclu de l'upsert. Un `player.create` dont le nom replié est
celui du « Moi » est un `conflict`, « Ce nom est déjà porté par votre joueur
Moi. », au lieu de lier une référence d'adversaire à ma propre ligne. Les
routes `POST /joueurs` et `POST /lieux` gardent leur 409 sur un doublon, et le
renommage (`player.update`, `venue.update`) les règles de la route : un nom
déjà pris est un `conflict` (« Un joueur nommé 'Marc' existe déjà. »).
L'upsert ne se décide qu'à la première application : un rejeu rend le verdict
du journal sans rien recalculer, même si le joueur a été renommé ou supprimé
depuis.

**`game.update`.** `data` (`GameUpdate`) vaut un objet vide par défaut et suit
la sémantique du `PATCH` : champs omis inchangés, `venue`, `tournament`,
`round_number` et `notes` envoyés à `null` remis à zéro. `table`, s'il est
fourni, est le corps de `PUT /parties/{id}/participations`, la table complète
voulue (A3) ; omis, la table ne change pas. Quand les deux sont là, ils
s'appliquent ensemble par un seul appel au service, sous un contrôle unique de
l'état final et un seul `commit` (un seul point de sauvegarde). Passer une
partie de 5 à 3 joueurs en ramenant les sièges dans la nouvelle table tient
donc en une opération, là où le `PATCH` seul serait refusé à cause des sièges
existants. Un refus ne laisse rien : ni les champs ni la table n'ont bougé.

**Classement des refus.** Mêmes codes et mêmes messages qu'en ligne : un 422 du
service devient `invalid`, un 409 `conflict`, un 404 `not_found`. Un refus
n'interrompt jamais le lot.

- `invalid` : la forme d'une partie (type et numéro de ronde contre le tournoi
  et son nombre de rondes ; table sans ma ligne ou avec deux fois elle, joueur
  ou siège répété, plus de lignes que de joueurs, siège au-delà de la table ;
  VP au-delà de ce que la table distribue ; GW contredit par mes VP, ou déclaré
  sans VP ; VP ou GW sur une ligne d'adversaire) et, sur `tournament.*`, l'état
  fusionné du tournoi : dates, multi-deck à un niveau qui l'interdit, règle de
  deck en finale contre la politique de deck, classement contre le nombre de
  joueurs et ma finale. Passer un tournoi de `multi` à `mono` sans envoyer
  `final_deck_rule: null` dans le même `data` est un `invalid` : le serveur
  n'efface pas la règle de lui-même.
- `conflict` : ce qui contredit des données existantes. Ronde ou finale déjà
  saisie (« La ronde 2 est déjà saisie pour ce tournoi (sur un autre
  appareil ?). », « La finale est déjà saisie pour ce tournoi. ») ; deck
  supprimé sur une ligne nouvelle ou dont le deck change ; écriture de partie
  qui contredit le tournoi (mono-deck, deck de finale selon la règle annoncée,
  classement) ; retrait d'une préliminaire, par `game.delete` ou par un
  `game.update` qui la sort du tournoi, qui changerait le deck attendu en
  finale (message préfixé « Retirer cette ronde changerait le deck attendu en
  finale : ») ; `tournament.update` dont le nombre de rondes passe sous une
  ronde déjà jouée, ou dont `deck_policy` ou `final_deck_rule` contredit les
  parties saisies ; suppression d'un tournoi qui contient des parties, d'un
  lieu qui sert encore, d'un joueur présent à une table ; suppression du
  « Moi » ; nom déjà pris ; référence client déjà prise.
- `not_found` : ressource désignée absente ou d'un autre compte, à quelque
  niveau qu'elle soit désignée.
- `unresolved_client_ref` : référence inconnue, d'un autre genre ou d'un autre
  compte, ou dont la création a été refusée.

Le classement contredit change donc de code selon l'écriture : `invalid` sur
`tournament.*`, comme le 422 de `PATCH /tournois/{id}`, et `conflict` sur
`game.*`, comme le 409 des routes de partie (une finale avec GW ajoutée à un
tournoi où je me suis classé deuxième). Restent au schéma, comme au Lot 3, les
bornes de champ (table de 1 à 6 lignes, VP par pas de 0,5 et au plus 6, siège
au plus 6, `player_count` d'une partie de 2 à 6, longueur des noms) : les
dépasser rend un 422 du lot entier, que la bissection du client isole.

**Idempotence.** Rien de neuf par rapport à la section « Lot 6 » : clés
d'idempotence et références client sont propres au compte, une `client_ref`
d'un autre compte se comporte comme une référence inconnue, et
`mismatched_replay` ne se produit qu'à l'intérieur d'un compte.

**Ce que le client doit faire.**

- Tirer une `client_ref` neuve pour chaque objet créé, de quelque genre qu'il
  soit, et ne jamais la réemployer pour un autre objet ; une création refusée
  puis corrigée garde la sienne.
- Lier la référence à l'identifiant du genre rendu (`resource.player_id` pour
  `player.create`, et de même `venue_id`, `tournament_id`, `game_id`,
  `deck_id`), dans une correspondance qui distingue les genres : un joueur 12
  et un deck 12 ne sont pas le même objet.
- Ne pas supposer qu'un joueur ou un lieu `applied` est neuf : la ligne saisie
  hors ligne peut se fondre dans une ligne existante, et un lieu peut garder
  une autre ville que celle saisie.
- Traiter les refus en cascade : une création refusée rend
  `unresolved_client_ref` toutes les opérations qui la désignaient, dans ce lot
  et les suivants. Une fois la création corrigée et appliquée, ces opérations
  sont à renvoyer sous de nouvelles clés, puisqu'un refus rejoué reste un refus.
- Envoyer `game.update` avec la table complète, jamais une partie de table, et
  ne proposer l'édition que d'une table connue ; envoyer `final_deck_rule: null`
  avec le passage en mono-deck.

**Identifiants jamais réattribués (révision R11, `e2a7819dd4a2`).** Jusqu'à
R10, les tables `player`, `venue`, `tournament` et `game` n'avaient pas
`AUTOINCREMENT` : quand la ligne d'identifiant le plus haut était supprimée,
SQLite redonnait cet identifiant à la création suivante. Le journal gardant la
correspondance référence → identifiant, la référence de la ressource supprimée
désignait alors la nouvelle, et une opération encore en file qui la visait, ou
qui visait l'ancien identifiant, s'y appliquait sans refus : un `player.update`
par la référence de Marc, supprimé, renommait Julie, créée juste après. Le cas
ne se posait pas avant le Lot 7, un deck n'étant supprimé que logiquement et
une entrée de collection se désignant par sa clé naturelle.

Décision du 2026-10-29 : une onzième révision, plutôt qu'un amendement de R10
déjà publiée, passe les quatre tables en `AUTOINCREMENT`. SQLite retient dans
`sqlite_sequence` le plus grand identifiant jamais attribué, si bien qu'une
référence ou un identifiant périmé ne désigne plus rien : la résolution trouve
toujours l'identifiant au journal, et le service répond `not_found`
(« Joueur 12 introuvable. »), comme pour toute ressource supprimée. Rien ne
change au contrat ni au client. À la montée, la séquence de chaque table part
du plus grand identifiant connu, celui des lignes recopiées comme celui que le
journal cite encore pour une ressource disparue (colonnes `player_id`,
`venue_id`, `tournament_id`, `game_id`) ; un identifiant attribué puis
supprimé hors de `/sync` avant R11, que rien n'a retenu, ne se reconstitue
pas. `participation` reste sans `AUTOINCREMENT` : elle se supprime aussi
physiquement, mais aucune opération, référence ni colonne du journal ne la
désigne par son identifiant. Tests de non-régression dans
`backend/tests/test_sync_lot7.py` (section « Identifiants jamais
réattribués ») et `backend/tests/test_migrations.py` (section R11).
