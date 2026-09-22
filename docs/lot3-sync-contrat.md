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
| `stock.delete` | `DELETE /stock/{card_id}/{language_code}` |
| `deck.create` | `POST /decks` |
| `deck.update` | `PATCH /decks/{id}` (archivage compris) |
| `deck.delete` | `DELETE /decks/{id}` |
| `deck_card.upsert` | `POST` ou `PATCH /decks/{id}/cartes` |
| `deck_card.delete` | `DELETE /decks/{id}/cartes/{card_id}/{language_code}` |
| `bundle.deposit` | `POST /bundles/{id}/stock` |

Le catalogue n'y est pas : il ne bouge que par l'import krcg. Les langues non
plus, `POST /langues` restant une écriture en ligne (voir les points ouverts).
Les parties et les tournois attendent le Lot 4 ; les inscrire ici avant qu'ils
aient une route serait promettre une synchronisation sans destination.

Deux écarts de vocabulaire par rapport à REST. D'abord, `upsert` : une file
rejouée ne sait pas ce que le serveur possède déjà, donc l'opération crée ou
remplace, et la charge utile porte l'état complet voulu. Ensuite, pas
d'opération d'archivage : archiver, c'est `deck.update` avec `archived`,
exactement comme en ligne.

Pour le reste, la charge utile est celle de la route correspondante, réutilisée
telle quelle (`CardCopyCreate`, `DeckCreate`, `DeckUpdate`, `DeckCardCreate`,
`BundleDeposit`). Le front n'a donc qu'une forme à écrire, à stocker et à
tester, en ligne comme hors ligne.

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
non autorisé, deck archivé ou supprimé, activation d'un deck illégal, entrée de
stock encore allouée. `/sync` n'assouplit ni ne durcit les règles des services ;
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

Les cinq motifs : `not_found` (la ressource n'existe pas), `conflict` (une règle
métier s'y oppose), `invalid` (charge utile invalide, typiquement après fusion
avec la ligne existante), `unresolved_client_ref` (le deck désigné n'a jamais
été créé, ou sa création a échoué) et `mismatched_replay` (même clé, autre
corps). Le champ `message` reprend le texte du service, celui-là même que la
route en ligne aurait mis dans son 404 ou son 409 : il est fait pour être
affiché.

Une opération `replayed` peut très bien porter une erreur. C'est le refus
mémorisé, rendu à l'identique.

La ressource touchée revient en identifiants seulement (`resource`), pas en
objets. Un versement de produit touche des centaines d'entrées de collection, et
le client rafraîchit par les `GET`. Ce dont il a réellement besoin ici, c'est du
`deck_id` attribué à un deck créé hors ligne.

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
`POST /decks/{id}/cartes`, `PATCH /stock/{card_id}/{language_code}` et leurs
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

**`invalid` n'est pas atteignable par `/sync`.** Le motif est au contrat parce
qu'il l'est côté services (le 422 qu'un service rend après fusion avec la ligne
existante), mais aucun chemin de la file ne le produit aujourd'hui : une charge
utile d'upsert porte l'état complet, `quantity` et `proxy_quantity` arrivent
donc toujours ensemble et le schéma les a déjà comparées. Il reste déclaré — le
client doit savoir le lire le jour où une opération le produira, et le retirer
pour le remettre ensuite coûterait une rupture de contrat.

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
