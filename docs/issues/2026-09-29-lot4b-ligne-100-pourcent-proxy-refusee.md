# Lot 4b — une ligne de deck 100 % proxy ne peut jamais s'écrire

Constaté le 2026-09-29 sur l'écran Synchronisation : 19 opérations refusées sur
le deck « Banu Princes », toutes avec le même message :

> La carte 899 n'est pas en collection en EN : l'ajouter au stock avant de
> l'utiliser dans un deck, ou déclarer les exemplaires acquis avec la ligne
> (`acquired_quantity`).

Quatre exemples relevés à l'écran, tous saisis entre 15h26 et 15h30 : 1 ×
Kasim Bayar (EN, NB2), 4 × Oluwafunmilayo (EN, NB2), 2 × Farah Sarroub (EN,
NB2), 2 × Kassandra Tassaki (EN, V5A). Point commun : chaque ligne est
**intégralement en proxy** (« dont 4 en proxy » pour 4 exemplaires), et aucune
des quatre cartes n'a d'entrée de collection en EN.

## Diagnostic

Le message suggère une marche à suivre — déclarer `acquired_quantity` — qui
est en réalité **impossible à écrire** pour ce genre de ligne.

### Le mécanisme, dans le code

`backend/app/services/decks.py`, `add_card` :

```python
copy = db.get(CardCopy, (payload.card_id, code, payload.card_set_id))
if copy is None:
    if not acquired:
        raise ConflictError(
            f"La carte {payload.card_id} n'est pas en collection en {code} : "
            "l'ajouter au stock avant de l'utiliser dans un deck, ou déclarer "
            "les exemplaires acquis avec la ligne (`acquired_quantity`)."
        )
...
_check_acquisition(acquired, 0, payload.quantity - payload.proxy_quantity)
```

et la borne :

```python
added = max(real_after - real_before, 0)
if acquired > added:
    raise InvalidRequestError(...)   # 422 / `invalid` par /sync
```

Pour une ligne neuve où `quantity == proxy_quantity` (tout en proxy), `added`
vaut 0. Donc `acquired_quantity = 0` tombe dans le `ConflictError` ci-dessus,
et toute valeur `> 0` dépasse la borne. **Il n'existe aucune valeur du champ
qui fasse passer l'écriture.** Ça touche toute ligne 100 % proxy pour une
carte absente de la collection, quel que soit le deck — ce n'est pas un
incident isolé au deck « Banu Princes ».

Le client (`frontend/src/features/decks/AddDeckCardForm.tsx`) n'est pas en
cause : `owned` vaut 0 par défaut, donc sans action de l'utilisateur sur le
compteur « déjà possédées », l'opération part avec `acquiredQuantity: 0`, la
seule valeur que le schéma autorise pour une ligne sans exemplaire réel. Le
champ est transporté correctement de bout en bout (contrat, client TS,
schémas `/sync`) : aucune régression de plomberie.

`backend/tests/test_deck_acquisition.py` couvrait déjà chaque moitié
séparément (le 422 de la borne côté `all-proxies`, le 409 sans acquisition
côté collection absente), sans qu'on remarque qu'elles se refermaient l'une
sur l'autre pour ce cas précis.

## Correction retenue : A1 — la FK de `deck_card` ne pointe plus `card_copy`

Première piste envisagée (créer une entrée fantôme à `quantity_owned = 0`)
**écartée** : ça revient à faire apparaître en collection une carte qu'on ne
possède pas, simplement parce qu'un deck la joue en proxy — contraire à
l'intention.

Décision retenue à la place : **une ligne de deck qui ne consomme aucun
exemplaire réel (`quantity == proxy_quantity`) ne crée et n'exige aucune
entrée de collection.** L'obstacle apparent — `deck_card` porte une FK
composite vers `card_copy`, donc la base semblait interdire une ligne sans
entrée — se lève en changeant la cible de cette FK plutôt qu'en la
supprimant.

### Le précédent existe déjà dans le modèle

`DeletedDeckCard` a exactement les mêmes colonnes et la même PK que
`DeckCard`, mais trois FK séparées (`card_id → card.id`,
`language_code → language.code`, `card_set_id → card_set.id`) au lieu d'une
FK composite vers `card_copy` — précisément parce qu'« une decklist figée ne
réserve rien ». Le patron est déjà écrit, testé et migré (révisions
`5dc50e3c1701`, `b7e41d0c9a52`) ; il reste à l'appliquer à `deck_card`, en
gardant un cran d'intégrité en plus.

### Conception (piste A1)

`DeckCard.__table_args__` remplace la FK composite vers `card_copy` par :

- `ForeignKeyConstraint(["card_id", "card_set_id"], ["card_printing.card_id", "card_printing.card_set_id"])`
  — la même contrainte que `card_copy` porte déjà, ce qui garde la décision D2
  du Lot 4 (« toute entrée pointe une impression réelle ») jusque dans les
  lignes de deck ;
- `language_code` en FK simple vers `language.code`.

Sans `ondelete`, comme pour `card_copy` : une impression ou une langue
utilisée par un deck ne se supprime pas. `DeckCard.card_copy` et
`CardCopy.deck_allocations` deviennent des relations `viewonly=True` sans
chemin FK direct, sur le modèle de ce que fait déjà `CardCopy.printing`.

**Migration** : une seule révision (la septième), sur `deck_card` uniquement,
en mode batch. **Aucune conversion de données et aucune garde façon D3** :
toute ligne existante référence déjà une `card_copy`, qui référence déjà
`card_printing` et `language` — les nouvelles contraintes sont donc
automatiquement satisfaites par les lignes en place. C'est, à la différence
des deux migrations du Lot 4, une révision **exécutable sur une base
peuplée**. Le `downgrade` doit refuser (ou avertir) si une ligne tout-proxy
sans entrée existe, pour ne pas faire échouer le `foreign_key_check` de
`migrations/env.py` à la remontée de la FK vers `card_copy`.

**Corrections de service à faire dans le même mouvement** (non négociables,
sinon le correctif ouvre un trou) :

- `add_card` (`decks.py:560-573`) : conditionner le refus à
  `payload.quantity > payload.proxy_quantity` — une ligne tout-proxy sans
  entrée devient acceptée, sans qu'aucune entrée ne soit créée.
- `_check_allocation` (`decks.py:491-500`) : **bug latent que A1 rendrait
  actif si on ne le corrige pas**. Le calcul de `allocated_real` est
  aujourd'hui sauté quand `copy is None`, ce qui est sans danger tant que la
  FK garantit qu'une ligne existante implique toujours une entrée. Une fois la
  FK assouplie, des lignes peuvent exister sans entrée, et sauter ce calcul
  reviendrait à sur-allouer silencieusement. Correctif : appeler
  `allocated_real` inconditionnellement, sur la clé plutôt que sur l'objet.
- `add_card`, contrôle du doublon : actuellement dans un `elif`, donc ignoré
  quand `copy is None`. Rare aujourd'hui, ce chemin devient le cas courant
  après le correctif (toute ligne tout-proxy) — à sortir du `elif`.
- `update_card` : **n'a pas besoin d'être modifié** (voir plus bas), mais sa
  docstring affirme à tort que l'entrée de collection existe forcément — à
  corriger.
- Import du catalogue (`catalog_import.py:440-447`) : la purge de l'extension
  tampon (D2c) ne compte aujourd'hui que `CardCopy`. Une ligne de deck
  tout-proxy sur cette extension doit désormais aussi compter dans le
  décompte `still_used`, sinon l'import échoue par `IntegrityError`.
- `stock.delete_copy` : aujourd'hui refuse la suppression dès qu'**une**
  ligne de deck existe sur la clé, même si elle ne consomme rien. À
  desserrer : ne refuser que si `allocated_real(...) > 0`. Sinon on obtient
  l'absurdité « la ligne peut naître sans entrée, mais l'entrée ne peut pas
  disparaître à cause de la ligne ».

**Contrat OpenAPI** : aucun changement de forme (aucun champ, aucune
opération, aucun type `/sync` nouveau). Deux descriptions de schéma
deviennent fausses et sont à réécrire
(`CardCopyRead.quantity_owned`, `ACQUIRED_QUANTITY_DESCRIPTION` dans
`backend/app/schemas/collection.py`), puis `contracts/openapi.json` et le
client TS régénérés (types identiques, textes différents).

**Couche offline : zéro ligne de code.** `frontend/src/offline/vtes/overlay.ts`
et `runtime.ts` n'exigent déjà nulle part une entrée de stock pour projeter ou
écrire une ligne de deck — le client fait déjà ce que la décision demande.
Seule une phrase de docstring dans `runtime.ts` (« sans acquisition, une carte
absente du stock est refusée par le serveur ») devient fausse et doit être
corrigée.

### Comptabilité du stock : vérifiée, elle tient

L'invariant du §6 de CLAUDE.md (somme des `quantity - proxy_quantity` sur les
decks vivants ≤ `quantity_owned`) reste vrai sans entrée : une ligne
tout-proxy contribue 0, et les fonctions de somme (`stock.allocated_real`,
`stock.proxies_allocated`) traitent déjà une clé absente comme une somme vide
(`coalesce(..., 0)`). La transition d'une ligne tout-proxy vers une
consommation réelle exige naturellement une entrée (elle se crée via
`acquired_quantity`, chemin déjà écrit dans `_acquire`) : la décision ferme la
porte aux entrées fantômes sans ouvrir de brèche dans la comptabilité.

### Pourquoi `update_card` (PATCH) n'a pas la même impasse

Vérifié par lecture et par trois tests ajoutés à
`backend/tests/test_deck_acquisition.py`, exécutés (48 passent, 0
régression) :

- `test_converting_a_fully_owned_line_to_all_proxies_keeps_the_entry_intact`
- `test_growing_an_all_proxy_line_needs_no_acquisition`
- `test_stock_entry_used_by_a_deck_line_cannot_be_deleted`

`update_card` n'a pas de garde équivalente à celle d'`add_card` : sa
précondition d'entrée (`_load_line` exige une ligne déjà en base) garantissait
jusqu'ici que l'entrée existe forcément, via la FK composite. `_check_acquisition`
y compare à l'état d'avant de la ligne, pas à zéro comme pour une création :
il n'y a donc pas d'impasse à corriger côté PATCH, ni avant A1 ni après.

### Ce que ça change dans la doctrine du projet

Avec A1, un deck 100 % proxy, entièrement légal et activable, devient possible
pour un joueur qui ne possède aucune des cartes — conséquence logique de la
décision, pas un effet de bord (la légalité ne lit que `deck_card` et `card`,
jamais `card_copy`, et « les proxies comptent dans les effectifs », §5). La
phrase de CLAUDE.md §11.2, « une carte doit être en collection pour être
ajoutée à un deck », devrait se lire désormais : *une carte doit être en
collection pour qu'un deck en consomme un exemplaire réel ; un deck qui
autorise les proxies peut jouer une carte qu'on ne possède pas.*

Coûts assumés par ce choix, à donner tels quels plutôt qu'à minimiser :

1. **Perte d'un filet de base.** Aujourd'hui la FK garantit qu'une ligne de
   deck ne peut pas référencer un exemplaire inexistant ; après A1, seuls les
   services le garantissent. La course « suppression d'une entrée pendant
   l'ajout d'une ligne réelle » devient silencieusement possible en écriture
   directe (déjà une limite assumée pour les écritures en ligne hors `/sync`,
   §11 Lot 3, avec son `xfail` dédié) — A1 élargit une brèche déjà
   documentée, il n'en crée pas une nouvelle par nature. Fermée pour les lots
   `/sync` par le verrou d'écriture existant.
2. **`deck_card` devient un second endroit** où vivent des triplets carte ×
   langue × extension sans entrée de collection, à côté de `deleted_deck_card`.
3. **Disparition d'une vue transversale « les cartes que je joue en proxy »**
   — il n'existe plus de ligne de collection à filtrer pour ça. Il faudrait
   ouvrir chaque deck, ou construire une lecture dérivée si le besoin se fait
   sentir (Lot 5c ou lot Chercher, pas ce correctif).

Piste alternative envisagée pour garder le filet de base — deux triggers
SQLite reproduisant une FK conditionnelle — écartée : DDL invisible à
SQLAlchemy et à l'autogénération Alembic, dette de portage vers Barrin pour
un risque déjà couvert par le verrou `/sync`.

## Questions ouvertes — état après investigation

- **Les 19 opérations déjà en file (résolu → purger).** Ce sont 19 lignes de
  la table `outbox` de la base IndexedDB `gurchon-hall-offline`, à l'état
  `rejected`. L'écran Synchronisation a déjà un bouton « Abandonner » par
  ligne (`Outbox.discard`), qui refuse tout ce qui n'est pas `rejected` —
  aucun risque de supprimer une opération encore en vol. Pas de bouton « tout
  abandonner » : 19 clics et confirmations. La purge est strictement locale
  (aucun appel réseau, aucune conséquence côté serveur, dont le journal
  `sync_operation` garde les 19 `operation_id` en `rejected` pour toujours,
  comme prévu §11 Lot 3). Le deck « Banu Princes » lui-même ne disparaît pas :
  seules les 19 lignes de carte quittent son affichage. Une fois le correctif
  livré, resaisir les 19 lignes à la main produira de nouvelles clés
  d'idempotence (nouveaux UUID) : ce sera une nouvelle évaluation par le
  serveur, jamais un rejeu des 19 anciennes.
- **`available === undefined` dans `AddDeckCardForm.tsx` (résolu → non
  fondé, un défaut mineur distinct subsiste).** Sur preuves :
  `frontend/src/offline/vtes/overlay.ts` rend `0`, pas `undefined`, pour une
  carte sans entrée de collection ; le scénario redouté (un utilisateur qui
  déclare posséder des exemplaires pour une carte jamais vue en collection et
  récolte quand même un refus) ne se produit pas. Reste un défaut mineur et
  distinct : si l'utilisateur valide **pendant** le chargement de la
  disponibilité, `available` vaut encore `undefined`, ce qui force
  `acquired = 0` et fait partir la ligne sans acquisition, silencieusement.
  À traiter séparément (désactiver la validation tant que `available` n'est
  pas résolu), sans lien avec le problème de ce rapport.
- **`update_card` (PATCH), même impasse ? (résolu → non).** Voir section
  dédiée ci-dessus : `update_card` n'a jamais eu cette impasse, aucune
  modification n'y est nécessaire.
- **Impact sémantique du correctif sur la collection (résolu → assumé, voir
  « Ce que ça change dans la doctrine du projet » ci-dessus).**

## État : A1 validée le 2026-09-29

L'utilisateur a validé la piste A1, et la mise en œuvre a commencé le jour même.
Faits par l'architecte-contrat : le modèle (`backend/app/models/collection.py`),
la migration (septième révision, `f3a91c47b2de`), les descriptions de contrat
devenues fausses, `contracts/openapi.json`, le client TS, et la documentation
(CLAUDE.md §5, §6, §11 ; `docs/lot4b-acquisition-depuis-deck.md`). Confiés à
d'autres agents : les corrections de service listées ci-dessus, la docstring de
`frontend/src/offline/vtes/runtime.ts`, et les tests (forme de la clé étrangère,
décompte des révisions, cas manquants).

## Ce qu'il restait à faire

- Rédiger le brief de décision dans `docs/` (sur le modèle de
  `docs/lot4b-acquisition-depuis-deck.md`) et amender CLAUDE.md : §5 (phrase
  sur l'autorisation de proxy), §6 (tableau Collection, description de la FK
  de `DeckCard`), §11 point 2 (« une carte doit être en collection… »), §11
  Lot 4 D2a (la justification tient pour la ligne de deck, plus pour
  l'entrée).
- Mettre à jour `docs/lot4b-acquisition-depuis-deck.md` : la ligne du tableau
  « Entrée absente, `acquired_quantity = 0` → 409 » et la phrase d'ouverture
  « il n'existe toujours pas de ligne de deck sans entrée de collection »
  deviennent fausses pour une ligne tout-proxy.
- Écrire la migration (7ᵉ révision) et les corrections de service listées
  plus haut ; reprendre les tests qui vérifient la forme de la FK
  (`backend/tests/test_models_constraints.py`,
  `backend/tests/test_models_relationships.py`,
  `backend/tests/test_migrations.py`) ; ajouter le cas manquant (ligne 100 %
  proxy, carte absente, deck `proxy_allowed` → acceptée, aucune entrée créée)
  et sa contre-épreuve sans `proxy_allowed` (409).
- Vérifier l'état de la base de développement avant migration (au moment du
  diagnostic : `deck_card` = 0 ligne, donc rien à convertir dans l'immédiat).

Deux constats venus de la mise en œuvre, qui n'étaient pas dans la conception :

- **Le mode batch d'Alembic ne convient pas pour cette révision.** Il recopie
  les contraintes de la table recréée dans l'ordre où il les sort d'un ensemble
  Python, qui change d'un processus à l'autre — trois `upgrade head` successifs
  donnent le même schéma mais deux textes de DDL différents. Un aller-retour
  comparé au texte près (test existant) n'aurait été vert qu'une fois sur deux.
  La révision renomme donc l'ancienne table, crée la nouvelle avec un DDL fixe,
  recopie les lignes et supprime l'ancienne : c'est ce que fait le mode batch, à
  l'ordre des contraintes près. Bénéfice inattendu : la montée se rend hors
  ligne (`--sql`), ce qu'aucune révision depuis la première ne savait faire.
- **La descente reproduit la révision précédente à l'octet près**, schéma entier
  compris (vérifié). Ce n'était pas un objectif, c'est venu avec le DDL fixe.
