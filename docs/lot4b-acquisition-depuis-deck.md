# Lot 4b — Ajouter une carte à la collection depuis un deck

Décision de contrat prise le 2026-09-25 par l'architecte-contrat. Elle assouplit
la décision §11.2 de CLAUDE.md sans la contourner : ce qui change, c'est qu'une
écriture de ligne de deck peut créer l'entrée de collection dont elle a besoin,
ou l'enrichir, dans la même transaction.

> **Amendement du 2026-09-29.** Ce brief affirmait plus loin qu'« il n'existe
> toujours pas de ligne de deck sans entrée de collection ». Ce n'est plus vrai,
> et cette exigence s'est révélée intenable : elle rendait une ligne entièrement
> jouée en proxy impossible à écrire, quelle que soit la valeur du champ décrit
> ici. `deck_card` ne référence plus `card_copy` (révision `f3a91c47b2de`), et
> une ligne qui ne consomme aucun exemplaire réel ne demande plus rien à la
> collection. Le reste du brief tient : `acquired_quantity` sert toujours à
> faire entrer des exemplaires **réels** avec la ligne qui les consomme.
> Diagnostic complet dans
> `docs/issues/2026-09-29-lot4b-ligne-100-pourcent-proxy-refusee.md`.

## Les deux besoins

1. **Un proxy devient une vraie carte.** Le joueur jouait une carte en proxy,
   puis a obtenu l'exemplaire physique. La ligne perd un proxy, la collection
   gagne un exemplaire, et la ligne consomme désormais cet exemplaire.
2. **Un deck existait avant l'application.** Il est déjà monté sur la table ;
   le saisir ne doit pas obliger à remplir d'abord la collection carte par
   carte. Ajouter une ligne crée en même temps les exemplaires.

## La forme retenue : un champ, pas une route

Un seul champ, `acquired_quantity`, sur les écritures de ligne existantes :

- `DeckCardCreate` (`POST /decks/{id}/cartes`, et `data` de `deck_card.upsert`) ;
- `DeckCardUpdate` (`PATCH /decks/{id}/cartes/{card_id}/{language_code}/{card_set_id}`).

Entier de 0 à 2³¹ − 1, facultatif, 0 par défaut. Il dit combien d'exemplaires
physiques l'écriture **ajoute à la collection** sous la clé de la ligne (carte
× langue × extension), exemplaires que la ligne consomme aussitôt.

Convertir `n` proxies s'écrit donc :

```json
PATCH /decks/12/cartes/100432/FR/7
{ "proxy_quantity": 1, "acquired_quantity": 2 }
```

pour une ligne qui jouait trois proxies. Monter un deck s'écrit :

```json
POST /decks/12/cartes
{ "card_id": 100432, "language_code": "FR", "card_set_id": 7,
  "quantity": 4, "acquired_quantity": 4 }
```

Pistes écartées :

- **Une route de conversion dédiée** (`POST …/convertir`) : une opération de
  plus au contrat, et un type de plus dans `/sync`, pour un effet qu'un champ
  exprime déjà.
- **Un nouveau type d'opération `/sync`** : la colonne `operation_type` du
  journal porte un CHECK nommé ; un type neuf exigeait une migration. Étendre
  `deck_card.upsert` n'en demande aucune, et le client garde une seule forme de
  charge utile par écriture de ligne, en ligne comme hors ligne.
- **Un booléen « ajouter à la collection »** : il ne dit pas combien. Dans une
  ligne de quatre exemplaires, deux peuvent être déjà possédés et deux
  nouvellement acquis.
- **La composition dans `DeckCreate`** : créer un deck et sa composition d'une
  seule requête aurait dupliqué toutes les règles de ligne, et par `/sync` une
  seule ligne refusée aurait fait refuser le deck entier. La création d'un
  deck avec sa composition reste une suite : `deck.create`, puis un
  `deck_card.upsert` par ligne (avec `client_ref`), dans le même lot. Chaque
  ligne porte son `acquired_quantity`.

## La borne qui rend le champ sûr

`acquired_quantity` n'est pas un état de la ligne mais un **delta** sur la
collection. Il est borné par ce que l'écriture ajoute d'exemplaires réels à la
ligne :

```
acquired_quantity ≤ (quantity − proxy_quantity) après − (quantity − proxy_quantity) avant
```

une ligne neuve partant de 0. Au-delà, 422 (`loc = body.acquired_quantity`),
ou `invalid` par `/sync`. Trois raisons :

- un exemplaire acquis depuis un deck est, par définition, dans ce deck ;
  enrichir la collection seule relève de `/stock` ;
- convertir plus de proxies que la ligne n'en retire devient impossible à
  écrire ;
- rejouer à l'identique un `PATCH` qui acquiert rend un 422 au lieu de compter
  deux fois les mêmes cartes, et un `POST` rejoué rend déjà un 409 (ligne
  existante). Les routes directes sont donc sûres au rejeu, sans journal.

Pour une ligne neuve, le schéma vérifie la borne seul
(`acquired_quantity ≤ quantity − proxy_quantity`). Pour une ligne existante,
seul le service connaît l'état d'avant.

## Règles, point par point

| Situation | Réponse en ligne | Verdict `/sync` |
| --- | --- | --- |
| Entrée de collection absente, `acquired_quantity > 0` | entrée créée à `quantity_owned = acquired_quantity`, notes vides | `applied` |
| Entrée absente, `acquired_quantity = 0` (ou omis), ligne qui consomme du réel | 409 : les exemplaires réels doivent venir de la collection | `conflict` |
| Entrée absente, ligne entièrement en proxy (`quantity == proxy_quantity`) | acceptée, aucune entrée créée (amendement du 2026-09-29) | `applied` |
| Entrée présente | `quantity_owned += acquired_quantity` | `applied` |
| Total au-delà de 2³¹ − 1 | 409, rien d'écrit | `conflict` |
| Exemplaires disponibles insuffisants malgré l'acquisition | 409, ni entrée créée ni incrément | `conflict` |
| Borne ci-dessus dépassée | 422 | `invalid` |
| Deck archivé ou supprimé | 409 | `conflict` |
| Deck inconnu | 404 | `not_found` |
| `proxy_quantity > 0` sur un deck sans `proxy_allowed` | 409 | `conflict` |
| Langue inconnue (entrée à créer) | 404 | `not_found` |
| Impression inexistante, carte inconnue | 404 | `not_found` |
| Ligne déjà présente (`POST`) | 409 | l'upsert la remplace, borne comprise |

Les exemplaires acquis comptent dans le possédé **avant** le contrôle de
disponibilité : une ligne de trois cartes peut en acquérir deux et prendre la
troisième au stock libre.

Le repli sur `XX` pour une langue inconnue reste une décision de la file
cliente (§11, Lot 3) ; le serveur répond `not_found`.

## Atomicité

Tous les contrôles passent avant la première écriture. L'entrée de collection
et la ligne sont ensuite écrites dans la même transaction et validées par un
seul commit : un refus de la base (course, contrainte) annule les deux. Par
`/sync`, les deux écritures tiennent sous le point de sauvegarde de
l'opération, et un refus revient à ce point sans rien laisser de partiel.

## Rejeu par `/sync`

- Même `operation_id`, même corps : `replayed`, rien n'est réappliqué. C'est le
  journal qui protège le delta, comme pour `bundle.deposit`.
- Même saisie mise deux fois en file sous deux clés : la seconde tombe sur la
  ligne déjà écrite, la borne vaut 0, verdict `invalid`. La collection n'est
  pas comptée deux fois.
- Une opération mise en file avant ce lot garde son empreinte : `fingerprint`
  ne hache que les champs fournis, et le champ nouveau, absent, n'y entre pas.

## Ce qui ne change pas

- Aucune migration, aucune table, aucune opération ni aucun type `/sync` de
  plus. Le contrat reste à 24 opérations. (L'amendement du 2026-09-29 ajoute une
  migration, mais aucune opération : elle ne touche que les clés étrangères de
  `deck_card`.)
- `deleted_deck_card` n'est pas concerné : une decklist figée ne réserve rien
  et ne s'écrit pas. Supprimer un deck ne retire pas de la collection les
  exemplaires acquis par lui : l'acquisition est définitive.
- Un deck neuf ne naît toujours pas `active` : le créer en brouillon, le
  composer, puis l'activer, dans le même lot si besoin.
- Les réponses (`DeckCardRead`, verdicts `/sync`) ne changent pas. Le verdict
  d'un `deck_card.upsert` désigne la ligne ; son triplet est aussi la clé de
  l'entrée de collection à rafraîchir.

## Cas de test

Couverts par `backend/tests/test_deck_acquisition.py` :

- création de l'entrée manquante, incrément d'une entrée existante (y compris
  toute allouée ailleurs), complément par le stock libre, proxies sur un deck
  qui les autorise ;
- sans acquisition, l'entrée doit exister dès que la ligne consomme un
  exemplaire réel (409), `0` explicite identique à l'absence ; une ligne
  entièrement en proxy passe sans entrée (amendement du 2026-09-29) ;
- refus d'allocation sans écriture partielle ; refus de la base (déclencheur
  de test sur `deck_card`) qui annule aussi l'entrée créée, en ligne et par
  `/sync` ;
- bornes du champ (négatif, au-delà de 2³¹ − 1, `null`, décimal) et borne
  métier (plus que la ligne ne consomme) ;
- plafond de `quantity_owned` en 409, à l'ajout comme à la conversion ;
- langue inconnue, impression inexistante, carte inconnue (404) ; deck archivé,
  supprimé (409) ou inconnu (404) ; proxy non autorisé (409) ; ligne déjà
  présente (409) ;
- conversion nominale, conversion partielle sur stock libre, conversion sans
  baisse de proxy ou au-delà des proxies retirés (422), rejeu d'un `PATCH`
  (422, pas de double comptage), conversion à court d'exemplaires (409), achat
  d'exemplaires supplémentaires pour une ligne, retrait de `proxy_allowed`
  après conversion complète ;
- exemplaires acquis conservés après suppression du deck ;
- `/sync` : deck créé et composé dans le même lot, montage complet d'un deck
  légal puis activation, rejeu `replayed`, doublon sous une autre clé
  (`invalid`), conversion sur ligne existante, refus qui n'arrête pas le lot,
  refus `conflict` et `not_found` identiques à la route en ligne, empreinte
  inchangée pour une opération sans le champ.

## Reste à faire hors contrat

- **Couche offline** (`frontend/src/offline/`, pwa-offline) : transporter
  `acquired_quantity` dans les actions de ligne ; dans le miroir local, créer
  ou incrémenter l'entrée de stock de façon optimiste en même temps que la
  ligne ; appliquer la même borne avant de mettre en file, pour qu'un refus
  `invalid` reste l'exception ; ne pas vider `settled` avant que le miroir de
  stock reflète l'acquisition.
- **UI** (frontend) : case ou compteur « je possède ces cartes » à l'ajout
  d'une ligne ; action « ce n'est plus un proxy » sur une ligne à proxies.
