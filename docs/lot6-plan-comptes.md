# Lot 6 — comptes et multi-utilisateur : plan d'implémentation

Brief d'entrée de lot, écrit par l'architecte-contrat avant toute
implémentation, sur le principe de `docs/lot4-plan-inventaire.md` et de
`docs/lot3-sync-contrat.md`. Il fixe ce qui est tranché, propose ce qui reste à
trancher, découpe le travail par agent et liste ce qui peut casser. Il ne
remplace pas le § 12 de CLAUDE.md (la portée) ; le détail formel des schémas
viendra du contrat exporté (`contracts/openapi.json`).

Toutes les décisions sont prises depuis le 2026-10-01. Les propositions P1 à P5
du premier jet ont été tranchées par l'utilisateur, en partie autrement que
proposé : la section « Décisions finales » les remplace. Plusieurs d'entre
elles s'alignent sur barrins-project (`apps/barrins_identity`), pour que le
pilote reste transposable.

## Portée

Le pilote sort du mono-utilisateur. Le lot apporte quatre choses :

1. **Des comptes** : inscription, connexion, déconnexion, lecture du compte
   courant, mots de passe hachés, sessions côté serveur révocables.
2. **Un propriétaire sur chaque donnée privée** : collection, decks, journal de
   synchronisation, et dès maintenant les tables du Lot 7, encore vides.
3. **Le cloisonnement de l'API** : toute route métier exige une session et ne
   voit que les données du compte ; ce qui appartient à un autre compte n'existe
   pas (404, jamais 403).
4. **Le cloisonnement du client** : base IndexedDB, file `/sync`, clés
   d'idempotence, cache HTTP, changement de compte et déconnexion ne laissent
   passer aucune donnée d'un compte à l'autre.

S'y ajoute un rôle à deux niveaux (`user`, `admin`), qui ne sert dans ce lot
qu'à réserver `POST /langues` aux administrateurs (P4).

Ce que le lot ne fait pas : pas de parties ni de tournois (Lot 7, dont il pose
seulement le propriétaire des tables), aucun envoi d'e-mail (l'adresse sert
d'identifiant de connexion, elle n'est jamais vérifiée ni utilisée pour
écrire), pas de partage de deck entre comptes, pas de suppression de compte,
pas de changement de mot de passe par l'API (réinitialisation par CLI
seulement, voir P2). Les règles de légalité de deck ne changent pas.

**D0 — Ordre des lots.** Le Lot 6 démarre le 2026-10-01, juste après le
Lot 5c, **avant** le lot Chercher, qui est reporté. C'est un écart assumé à
l'ordre prévu jusque-là (5c, Chercher, Lot 6), noté comme un fait et pas
rouvert. Le Lot 6 arrive après le breakpoint bureau et après l'audit de
symétrie : il **livre ses écrans dans les deux dispositions**, mobile et
bureau, et ne laisse rien à rattraper à un lot de symétrie.

### État de départ

Relevé sur `backend/vtes.db` le 2026-10-01, à la révision `f3a91c47b2de` :

| Table | Lignes |
| --- | --- |
| `card_copy` | 28 |
| `deck` | 1 (« Banu Princes ») |
| `deck_card` | 20 |
| `deleted_deck_card` | 0 |
| `sync_operation` | 58 |
| `player`, `tournament`, `game`, `participation`, `venue` | 0 |
| `language` | 4 (EN, ES, FR, XX) |

CLAUDE.md annonce encore huit entrées de stock et aucune ligne de composition :
la base a vécu depuis. C'est la base de l'utilisateur, avec sa vraie collection,
et c'est ce qui commande le choix de migration (D5). Les chiffres sont à
relever de nouveau juste avant d'appliquer les migrations.

## Décisions tranchées par l'utilisateur

**D1 — Une session unique côté serveur, pas de JWT.** Pas de paire
access/refresh : un seul jeton, une seule durée. Une table `auth_session`
porte les sessions ; le navigateur reçoit un jeton opaque dans un cookie
`HttpOnly`, `Secure`, `SameSite`. Seule l'empreinte du jeton est stockée en
base. Révoquer une session, c'est supprimer sa ligne : effet immédiat, sans
liste noire ni attente d'expiration. Un JWT aurait demandé l'inverse (validité
portée par le jeton, révocation par liste) pour un gain nul sur une
application à une seule API.

Une session dure **14 jours** à compter de la connexion. Le chiffre remplace
les 30 jours glissants et 180 jours de plafond du premier jet ; il n'y a
qu'une seule échéance, `expires_at`, posée à la connexion et jamais repoussée
(lecture retenue d'une durée unique, voir « Points d'interprétation »). Hors
ligne, l'accès local survit à l'expiration tant que la file n'est pas vide,
jusqu'à la reconnexion (P3).

**D2 — Le discriminant de deck devient unique par compte.** L'unicité passe de
(`name`, `discriminator`) à (`user_id`, `name`, `discriminator`). C'est un
**changement de la règle d'identité** tranchée au Lot 2 passe 2 (§ 11), pas un
détail d'index. Reformulation, à reporter au § 11 à la clôture :

> Le couple (nom, discriminant) est unique parmi **tous les decks d'un même
> compte**, supprimés compris. Le serveur tire le discriminant parmi ceux que ce
> compte n'a pas encore pris pour ce nom ; le 409 « les 9999 discriminants de ce
> nom sont pris » ne compte que les decks du compte. Deux comptes peuvent avoir
> chacun un « Banu Princes#1234 » : l'identité d'affichage d'un deck n'est plus
> globale.

Pourquoi : avec une unicité globale, une collision de discriminant entre deux
comptes ferait réessayer le tirage, et les 9999 discriminants d'un nom courant
pourraient s'épuiser à cause des decks des autres. Le 409 d'épuisement
deviendrait un oracle (« d'autres comptes ont beaucoup de decks de ce nom »).
Conséquence à garder en tête pour le Lot 9 (import VDB) et pour tout futur
partage : un deck ne se désigne plus de façon univoque sans son propriétaire.

**D3 — Déconnexion avec une file non vide : avertir, puis purger sur
confirmation.** Si la file locale contient des opérations non tranchées (en
attente **ou** refusées : une opération refusée est une saisie que
l'utilisateur n'a pas encore corrigée), la déconnexion affiche le nombre
d'opérations concernées et prévient qu'elles seront perdues. Sur confirmation
explicite, la base IndexedDB du compte est supprimée en entier (miroirs, file,
`settled`, correspondances `client_ref`). Sans confirmation, rien ne bouge. Une
file vide se déconnecte sans question, avec la même purge.

**D4 — Ordre des lots** : remplacé par D0 (démarrage immédiat, Chercher
reporté). Les écrans du lot naissent quand même dans les deux dispositions.

## Décisions de l'architecte, confirmées par l'utilisateur

**D5 — Les données existantes sont converties, pas refusées.** Première
migration du projet qui réécrit des données métier. Le Lot 4 avait fait
l'inverse (D3 de `docs/lot4-plan-inventaire.md` : migrations refusées sur des
tables non vides). Le choix diffère pour trois raisons :

1. **Il y a des données, et ce sont les vraies.** Au Lot 4, les tables étaient
   vides et un code de conversion n'aurait jamais tourné. Ici, refuser obligerait
   l'utilisateur à vider sa collection pour monter de version.
2. **La conversion est totale et sans choix.** Au Lot 4, rattacher une entrée de
   stock existante à une extension aurait demandé de deviner une impression
   ligne par ligne. Ici, toute ligne existante a exactement un propriétaire
   possible, puisqu'il n'y a jamais eu qu'un utilisateur : la conversion est un
   `UPDATE` à valeur constante, sans heuristique.
3. **C'est le cas Barrin.** D3 du Lot 4 se disait « choix de pilote, pas un
   modèle à reproduire sur Barrin, où il y aura des données à reprendre ».
   Barrin aura le même passage du mono- au multi-utilisateur sur une base en
   service : ce lot en est le modèle, et doit être testé sur une base peuplée.

Le journal `sync_operation` est converti comme le reste, et c'est indispensable :
une opération déjà tranchée qui attend encore dans une file (cas `settled`, ou
réponse perdue) doit rester un rejeu après la migration. Si ses 58 lignes
n'avaient pas de propriétaire, le rejeu sous le compte historique ne les
trouverait pas et réappliquerait, par exemple, un versement de produit.

**D6 — Un compte historique reçoit les données existantes.** La première
révision crée un compte d'identifiant fixe `1`, nom d'utilisateur provisoire
`compte-historique`, adresse provisoire
`compte-historique@gurchon-hall.invalid` (domaine réservé, RFC 2606, qui ne
peut appartenir à personne), rôle **`admin`** (P4), avec un **mot de passe
inutilisable** : la valeur stockée (`!`) n'est pas une empreinte Argon2, la
vérification échoue toujours, aucune connexion n'est possible. Un script CLI
pose ensuite la vraie adresse, le vrai nom et le vrai secret (`claim-legacy`,
cf. A2). La migration ne connaît donc aucun secret, ne lit aucune variable
d'environnement et se rejoue à l'identique partout. Le compte se réclame par
CLI et non au premier `POST /inscription`, qui laisserait la première personne
à s'inscrire hériter de la collection — d'autant plus nécessaire que
l'inscription est ouverte (P2). Confirmé par l'utilisateur.

**D7 — Toutes les données privées ont un propriétaire explicite dès ce lot,
tables du Lot 7 comprises.** `player`, `tournament`, `game`, `participation`
et `venue` reçoivent leur `user_id` maintenant, pendant qu'elles sont vides. Le
Lot 7 n'aura ainsi aucune migration de propriété à écrire, et ses routes
naîtront scopées. Le coût est nul aujourd'hui ; plus tard, ce serait une
seconde conversion. Confirmé par l'utilisateur, `venue` compris (P5).

D5 est également confirmé tel quel.

## Modèle de données

Deux tables nouvelles, colonnes de propriétaire sur neuf tables existantes. Le
modèle passe de 23 à **25 tables**. La table `signup_invitation` du premier jet
est abandonnée : l'inscription est ouverte (P2).

### Tables nouvelles

**`user_account`**

| Colonne | Type | Notes |
| --- | --- | --- |
| `id` | entier, PK | le compte historique a l'identifiant `1` (D6) |
| `email` | `String(320)`, unique, NOT NULL | identifiant de connexion (P2) ; index unique `uq_user_account_email` ; règle de normalisation (casse) à fixer par l'architecte et à appliquer à l'écriture comme à la recherche |
| `username` | `String(32)`, unique, NOT NULL | handle public, `^[A-Za-z0-9_-]{3,32}$` (P2) ; index unique `uq_user_account_username` |
| `password_hash` | `String(255)` | chaîne PHC Argon2id ; `!` pour un mot de passe inutilisable |
| `role` | `String`, NOT NULL, défaut `user` | enum fermé `user` / `admin` porté par un CHECK nommé, comme les autres enums du modèle (P4) ; `admin` pour le compte historique |
| `created_at`, `updated_at` | `UtcDateTime` | `TimestampMixin`, sortis suffixés « Z » |

Pas de colonne de vérification d'adresse ni de désactivation : il n'y a pas de
vérification d'e-mail (P2), et la suppression ou la suspension de compte sont
hors lot. Les ajouter plus tard est une migration additive.

**`auth_session`**

| Colonne | Type | Notes |
| --- | --- | --- |
| `id` | entier, PK | |
| `user_id` | FK `user_account.id`, `ON DELETE CASCADE` | indexée |
| `token_hash` | `String(64)`, unique | SHA-256 hexadécimal du jeton (P1) ; c'est la clé de recherche |
| `created_at` | `UtcDateTime` | instant de la connexion |
| `expires_at` | `UtcDateTime` | `created_at` + 14 jours, jamais repoussé (D1) |

Pas de `revoked_at` : révoquer, c'est supprimer la ligne (D1). Pas de
`last_used_at` ni de plafond absolu : avec une échéance fixe, aucune requête
n'a à écrire dans `auth_session`, et la question d'un rafraîchissement qui
attendrait le verrou d'écriture disparaît. Les sessions expirées sont purgées
à la connexion du compte concerné et par une commande CLI ; elles ne servent à
rien d'autre.

### Colonnes de propriétaire

Règle générale : `user_id` entier, **NOT NULL**, clé étrangère vers
`user_account.id` **sans** `ON DELETE` (la suppression de compte est hors lot ;
quand elle viendra, elle se fera par un service explicite, pas par une cascade
qui viderait une collection en silence). Exception : `sync_operation`, qui n'a
aucune clé étrangère par conception (CLAUDE.md § 6, portabilité vers Barrin) et
garde ce principe : `user_id` y est un identifiant, pas une relation.

| Table | Changement | Pourquoi |
| --- | --- | --- |
| `card_copy` | `user_id` entre **en tête de la clé primaire** : (`user_id`, `card_id`, `language_code`, `card_set_id`). La FK composite vers `card_printing` ne change pas. | Deux comptes possèdent chacun leur entrée pour la même carte, langue et extension. Les chemins `/stock/{card_id}/{language_code}/{card_set_id}` restent tels quels : le compte vient de la session, pas de l'URL. |
| `deck` | `user_id` ; `uq_deck_name_discriminator` remplacée par `uq_deck_user_id_name_discriminator` (`user_id`, `name`, `discriminator`) ; nouvelle unicité `uq_deck_id_user_id` (`id`, `user_id`), cible des FK composites ci-dessous. | D2 ; la seconde unicité est redondante avec la PK en logique, mais SQLite exige une clé unique déclarée pour qu'une FK composite la vise. |
| `deck_card` | `user_id`, copie de celui du deck ; la FK simple `deck_id → deck.id` (CASCADE) devient la FK composite (`deck_id`, `user_id`) → `deck` (`id`, `user_id`), CASCADE. L'index `ix_deck_card_card_id_language_code_card_set_id` devient `ix_deck_card_user_id_card_id_language_code_card_set_id`. PK inchangée. | Voir ci-dessous. |
| `deleted_deck_card` | aucun | Le propriétaire se lit par le deck ; une decklist figée ne compte dans aucune somme. |
| `sync_operation` | `user_id` ; l'unicité de `operation_id` devient `uq_sync_operation_user_id_operation_id` ; l'index partiel `ux_sync_operation_client_ref` devient (`user_id`, `client_ref`) avec la même condition `client_ref IS NOT NULL AND status = 'applied'`. | Idempotence et références client par compte (§ « Contrat », `/sync`). |
| `player` | `user_id` ; `name` unique devient (`user_id`, `name`) ; `ux_player_is_me` devient un index unique partiel sur `user_id` avec `WHERE is_me = 1`. | Un « Moi » par compte, pas un seul dans toute la base. |
| `venue` | `user_id` ; `name` unique devient (`user_id`, `name`). | P5. |
| `tournament`, `game` | `user_id` ; unicité (`id`, `user_id`) sur chacune. | Cibles des FK composites. |
| `participation` | `user_id` ; FK composites (`game_id`, `user_id`) → `game`, (`deck_id`, `user_id`) → `deck`. De même `game` (`tournament_id`, `user_id`) → `tournament` et (`venue_id`, `user_id`) → `venue`, `tournament` (`venue_id`, `user_id`) → `venue`. | La base refuse qu'une partie pointe le deck, le tournoi ou le lieu d'un autre compte. |

**Pourquoi `deck_card` porte son propre `user_id`, conséquence de
`f3a91c47b2de`.** Tant que `deck_card` pointait `card_copy` par une FK, la base
reliait une ligne de deck à l'entrée de collection qu'elle consomme ; avec un
`user_id` dans la clé de `card_copy`, cette FK aurait garanti d'elle-même que
le deck et l'exemplaire avaient le même propriétaire. La septième révision a
retiré ce lien pour permettre la ligne tout-proxy : rien ne relie plus une
ligne de deck à une entrée de collection, sinon l'égalité des clés que le
service calcule. Sans `user_id` sur `deck_card`, cette égalité ne pourrait plus
se calculer sans joindre `deck` à chaque somme, et un oubli de jointure dans un
seul service ferait compter les decks d'un compte contre la collection d'un
autre. Avec `user_id` sur la ligne, la correspondance redevient une égalité de
quatre colonnes, la même des deux côtés (`CardCopy.deck_allocations`,
`DeckCard.card_copy`), servie par un index ; et la FK composite vers
`deck (id, user_id)` garantit que cette copie ne peut pas diverger du deck.
`deleted_deck_card` n'en a pas besoin : elle ne réserve rien et ne se lit
qu'à travers son deck.

Pour les FK composites dont une colonne est nullable (`participation.deck_id`,
`game.tournament_id`, `game.venue_id`, `tournament.venue_id`) : SQLite applique
`MATCH SIMPLE`, une colonne NULL désactive le contrôle. C'est le comportement
voulu (partie amicale sans tournoi, participation d'adversaire sans deck).

### Règles portant sur plusieurs lignes, reformulées (skill `regles-vtes`)

**Comptabilité du stock (CLAUDE.md § 6), nouvelle portée.** Ce n'est pas un
détail d'implémentation de `services/stock.py`, c'est la règle elle-même qui
change de domaine :

> Pour **chaque compte** et chaque entrée de sa collection (carte × langue ×
> extension), la somme des exemplaires réels (`quantity - proxy_quantity`)
> alloués par les decks vivants **de ce compte** (archivés compris) ne dépasse
> pas `quantity_owned` de cette entrée. Une ligne de deck qui consomme au moins
> un exemplaire réel exige une entrée **du même compte**. Les decks d'un autre
> compte n'entrent jamais dans la somme.

Si la somme restait globale (`allocated_real` d'aujourd'hui, qui filtre carte,
langue et extension sans propriétaire), deux défauts apparaîtraient dès le
second compte : les decks de B empêcheraient A de baisser sa propre quantité
ou de supprimer son entrée, et le message du 409 (« 3 exemplaire(s) sont
alloués à des decks ») révélerait à A ce que B joue. `allocated_real`,
`proxies_allocated`, `update_copy`, `delete_copy`, `deposit_bundle` et l'ajout
de ligne de deck prennent tous le compte en paramètre obligatoire, sans valeur
par défaut : un appel qui l'oublie doit échouer au typage, pas compter
globalement.

**Identité d'un deck** : D2 ci-dessus.

**Tournoi mono-deck** (Lot 7) : inchangé dans sa formulation (« toutes mes
participations d'un tournoi mono-deck pointent le même deck »), mais « mes »
désigne désormais le joueur `is_me` **du compte** propriétaire du tournoi.

**Légalité d'un deck** : inchangée. Les cinq règles du § 5 portent sur la
composition et le catalogue, qui est partagé.

## Séquence de migrations Alembic (skill `migrations-alembic`)

Deux révisions après `f3a91c47b2de`. Identifiants à tirer par Alembic ; on les
note ici R8 et R9.

### R8 — comptes et sessions

- Crée `user_account` et `auth_session`.
- Insère le compte historique : `id = 1`, `username = 'compte-historique'`,
  `email = 'compte-historique@gurchon-hall.invalid'`, `role = 'admin'`,
  `password_hash = '!'`, horodatages au moment de la migration. Valeurs
  littérales, aucune lecture de la base : la montée se rend hors ligne
  (`upgrade f3a91c47b2de:R8 --sql`).
- Ne touche à aucune table existante.
- **Descente** : refusée (`RuntimeError` avant toute modification) s'il existe
  un compte autre que `1`. Supprimer `user_account` perdrait des comptes que
  l'utilisateur a créés, avec leurs identifiants ; mieux vaut un arrêt explicite
  qui dit lesquels. Avec le seul compte historique, la descente supprime les
  tables (les sessions avec).

### R9 — propriétaire sur les données

Ordre imposé par les dépendances de clés : `deck` avant `deck_card`, `venue` et
`tournament` avant `game`, `game` avant `participation`.

Pour chaque table concernée, la même séquence, qu'elle soit vide ou non :

1. renommer la table (`ALTER TABLE … RENAME TO _old_…`) ;
2. créer la nouvelle avec un DDL écrit à la main, `user_id` NOT NULL et les
   nouvelles contraintes ;
3. recopier les lignes en posant `user_id = 1` (`INSERT INTO … SELECT …, 1
   FROM _old_…`) ; pour `deck_card`, `user_id` vient de la constante, puisque
   tous les decks existants sont au compte `1` ;
4. supprimer l'ancienne table, recréer les index.

Une seule règle pour toutes les tables, vides ou non : pas de garde de vacuité
sur les tables du Lot 7, et pas de code de conversion différent selon qu'il y
a des lignes. Si une table du Lot 7 contenait une ligne de test oubliée, elle
serait rattachée au compte historique au lieu de bloquer la migration, à
l'inverse du piège vécu le 2026-09-29 avec les gardes du Lot 4.

**Recréation à la main plutôt que mode batch**, pour la raison déjà mesurée à
`f3a91c47b2de` : le mode batch recopie les contraintes dans un ordre qui varie
d'un processus à l'autre, et un aller-retour comparé au texte près ne serait
vert qu'une fois sur deux. Effet de bord bienvenu, comme pour la septième
révision : sans réflexion de schéma ni lecture de données, la montée se rend
hors ligne (`upgrade R8:R9 --sql`), et le `xfail` qui vise la tête doit être
réexaminé (il porte sur les révisions du Lot 2 et du Lot 4, pas sur celles-ci).

`migrations/env.py` coupe déjà `PRAGMA foreign_keys` pendant la migration et
passe `foreign_key_check` à la fin : sans cette coupure, renommer puis
supprimer `deck` déclencherait les cascades vers `deck_card`. Le contrôle final
vérifie aussi que chaque `user_id` recopié désigne un compte existant.

Les noms de contraintes existants (`discriminator_format`,
`quantity_owned_positive`, `proxy_quantity_within_quantity`…) sont recopiés à
l'identique : le test d'aller-retour compare le schéma au texte près.

**Descente de R9** : refusée (`RuntimeError`, avant toute modification, avec
le nombre de lignes par table) dès qu'une ligne de l'une des neuf tables
appartient à un autre compte que `1`. C'est le critère exact de ce que le
schéma d'avant ne sait pas représenter : deux decks homonymes au même
discriminant dans deux comptes, deux entrées de stock de même clé, deux
opérations de même `operation_id`. Un second compte sans aucune donnée ne
bloque pas R9, mais il bloque R8 : en pratique, **on ne redescend pas sous le
Lot 6 tant qu'il existe un autre compte que le compte historique**. Sinon, la
descente retire les colonnes et restaure les unicités globales sans perte.

Tests de migration (QA) : montée et descente sur base vide ; **montée sur une
base peuplée** reproduisant l'état de départ (entrées de stock, deck avec
lignes réelles et tout-proxy, journal avec une création `client_ref`
appliquée), puis vérification que tout appartient au compte `1`, que la
comptabilité du stock donne les mêmes disponibilités qu'avant et que le rejeu
d'une opération journalisée reste `replayed` ; refus de descente avec un second
compte ou une donnée étrangère ; `--sql` de R8 et R9 ; aller-retour au texte
près.

## Contrat d'API

### Routes d'authentification

Chemins en français, `operationId` en anglais camelCase, comme le reste du
contrat. Quatre opérations.

| Route | `operationId` | Rôle | Réponses |
| --- | --- | --- | --- |
| `POST /inscription` | `signUp` | crée un compte (`email`, `username`, `password`), actif aussitôt, rôle `user` forcé par le serveur, et ouvre une session | 201 `UserRead` + `Set-Cookie` ; 409 adresse ou nom déjà pris ; 422 (dont tout champ inconnu, `role` compris) ; 429 + `Retry-After` |
| `POST /connexion` | `logIn` | ouvre une session (`email`, `password`) | 200 `UserRead` + `Set-Cookie` ; 401 identifiants invalides ; 429 + `Retry-After` (P1) |
| `POST /deconnexion` | `logOut` | supprime la session courante, efface le cookie | 204, **toujours**, même sans session valide : la déconnexion est idempotente |
| `GET /moi` | `readCurrentUser` | compte de la session | 200 `UserRead` ; 401 |

`UserRead` : `id`, `email`, `username`, `role`, `created_at` (UTC suffixé
« Z »), tous obligatoires en sortie (`ReadModel`). Jamais d'empreinte ni de
jeton dans un corps de réponse : le jeton ne circule que dans `Set-Cookie`.

`POST /moi/mot-de-passe`, proposé en option au premier jet, ne figure pas dans
les décisions finales et **n'entre pas** dans ce lot, faute de validation : un
mot de passe se réinitialise par CLI (P2). L'ajouter plus tard est une route de
plus, sans migration.

`POST /langues` reste au contrat, réservé au rôle `admin` (P4).

Le contrat passe de 24 à **28** opérations (+ 4 routes d'authentification).

### Cookie de session

- Jeton : 32 octets aléatoires (`secrets.token_urlsafe(32)`), jamais stocké en
  clair.
- Attributs : `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, sans `Domain`,
  `Max-Age` égal au plafond absolu restant. En production, nom préfixé
  `__Host-` (qui impose `Secure`, `Path=/` et l'absence de `Domain`).
- `SameSite=Lax` plutôt que `Strict` : `Strict` n'apporte rien de plus à une
  SPA qui n'appelle l'API qu'en `fetch` depuis sa propre origine, et aucun des
  deux ne protège contre un sous-domaine voisin, qui est du même site. Pour
  celui-ci, les méthodes d'écriture (`POST`, `PATCH`, `DELETE`) vérifient
  l'en-tête `Origin` contre `BACKEND_CORS_ORIGINS` et rendent 403 s'il ne
  correspond pas — le seul 403 du contrat, qui ne porte sur aucune ressource et
  ne révèle donc rien. L'hébergement sur l'infrastructure de Barrin (Lot 11)
  rend ce cas réaliste.
- CORS : `allow_credentials` passe de `False` à `True` (`backend/app/main.py`),
  avec la liste fermée d'origines actuelle, qui reste obligatoire (pas de `*`
  avec des cookies). Côté client, `credentials: "include"` sur le client
  généré et sur le transport de `/sync`.
- Développement : `localhost:5173` et `localhost:8000` sont du même site
  (le port ne compte pas), le cookie passe. `127.0.0.1` et `localhost`, eux,
  sont deux sites : mélanger les deux casse la session sans message. Le drapeau
  `Secure` est piloté par une variable (`SESSION_COOKIE_SECURE`, vrai par
  défaut) ; Chrome et Firefox acceptent un cookie `Secure` sur
  `http://localhost`, **[à vérifier]** sur les versions en usage, d'où la
  variable de repli.

### 401 et 404

- **401** : pas de session, session inconnue, expirée ou supprimée. Corps
  `ErrorResponse` (`{"detail": "Authentification requise."}`). Le refus est
  produit par une dépendance FastAPI écrite pour le projet, pas par
  `APIKeyCookie(auto_error=True)`, dont le code de refus (403 ou 401) a varié
  selon les versions de FastAPI. Le cookie est déclaré dans le contrat comme
  schéma de sécurité (`apiKey`, `in: cookie`) pour que le client et la doc le
  connaissent, et chaque opération protégée documente sa 401.
- **404** : tout ce qui appartient à un autre compte, avec **le même message**
  que pour un identifiant qui n'existe pas (« Deck 12 introuvable. »). Jamais
  403, jamais un message qui distinguerait les deux cas.
- **Ordre des contrôles** : authentification d'abord. Une requête non
  authentifiée sur `/decks/999999` rend 401, pas 404 : sans session, on
  n'apprend rien de l'existence d'une ressource.
- **403 pour un rôle insuffisant** : `POST /langues` appelé par un compte
  `user` rend 403 (« Droits insuffisants. »), comme le `require_role` de
  Barrin. Ce refus porte sur une **route**, pas sur une ressource d'un autre
  compte : il ne révèle l'existence de rien, et la règle « 404, jamais 403 »
  pour les données d'autrui reste entière. C'est, avec le contrôle d'`Origin`
  ci-dessus, le seul autre 403 du contrat.

### Ce qui est public, ce qui est protégé

| Routes | Accès |
| --- | --- |
| `/health` | public |
| `GET /cartes`, `GET /cartes/{id}`, `GET /extensions`, `GET /bundles`, `GET /bundles/{id}`, `GET /langues` | public : catalogue partagé en lecture seule, données publiques de krcg, nécessaires au miroir local avant même la première connexion (P5) |
| `POST /inscription`, `POST /connexion`, `POST /deconnexion` | public |
| `POST /langues` | session obligatoire **et** rôle `admin` (P4) |
| tout le reste : `/stock…`, `/decks…`, `POST /bundles/{id}/stock`, `POST /sync`, `GET /moi` | session obligatoire, données du compte seulement |

Toute réponse authentifiée porte `Cache-Control: private, no-store`. Le service
worker ne met aucune route d'API en cache (pas de `runtimeCaching`, § 11
Lot 0), mais le cache HTTP du navigateur, lui, pourrait resservir la réponse
`GET /stock` du compte A après une connexion du compte B dans le même
navigateur.

### Scoping des routes existantes

Aucun chemin ne change et aucun schéma de corps existant ne gagne de
`user_id` : le propriétaire vient de la session, jamais du client. Un champ
`user_id` envoyé dans un corps serait refusé en 422 (`extra="forbid"` des
schémas d'écriture), comme tout champ inconnu.

- `/stock` : liste, lecture, création, modification, suppression sur les
  entrées du compte ; une même clé (carte, langue, extension) existe
  indépendamment dans chaque compte.
- `POST /bundles/{id}/stock` : le produit est partagé, le versement va dans la
  collection du compte.
- `/decks` : listes et lectures filtrées par compte ; un deck d'un autre compte,
  vivant ou supprimé, rend 404 sur toutes les routes, `/legalite` comprise.
- `/decks/{id}/cartes` : une ligne qui consomme du réel puise dans la
  collection du compte du deck, qui est celui de la session.

### `/sync`

- La route exige une session. Elle est vérifiée **une fois**, avant de prendre
  le verrou d'écriture ; une session qui expire pendant le traitement du lot ne
  l'interrompt pas. Un 401 signifie, comme un 503, que **rien n'a été
  appliqué** : le lot se renvoie à l'identique après reconnexion.
- **Idempotence par compte** : la clé est (`user_id`, `operation_id`). La
  recherche des clés déjà tranchées filtre sur le compte. Une `operation_id`
  déjà utilisée par un autre compte est traitée comme neuve : pas de
  `replayed` qui rendrait le verdict d'un autre (fuite de données), pas de
  `mismatched_replay` qui révélerait que la clé existe ailleurs.
- **Références client par compte** : la résolution `client_ref → deck_id` et
  l'unicité des créations appliquées filtrent sur le compte. Une `client_ref`
  prise par un autre compte se comporte exactement comme une référence inconnue
  (`not_found`, même message), et peut être créée par le compte courant.
- Toutes les opérations désignant un deck (`deck_id` ou `client_ref`) rendent
  `not_found` pour un deck d'un autre compte, avec le message d'un deck
  inexistant.
- Les huit types d'opérations et leurs charges utiles ne changent pas. Le
  brief `docs/lot3-sync-contrat.md` reçoit une section « Lot 6 » dans la même
  étape que le contrat (A1).

### Bornes

Comme partout ailleurs, 422 plutôt que 500 : `username` suit
`^[A-Za-z0-9_-]{3,32}$` (P2) ; `email` est validé comme adresse (`EmailStr`,
comme Barrin, ce qui ajoute la dépendance `email-validator`) et borné à 320
caractères ; le mot de passe suit la règle de complexité de P1, **non rogné**,
avec une longueur maximale (128 au premier jet, valeur à confirmer par
l'architecte). Un mot de passe de plusieurs mégaoctets doit être refusé avant
le hachage, sinon il devient un moyen de faire tourner Argon2 sur une entrée
démesurée.

## Décisions finales (P1 à P5), tranchées par l'utilisateur le 2026-10-01

Les cinq points proposés au premier jet sont tranchés. Là où l'utilisateur a
choisi de s'aligner sur barrins-project, la référence est
`C:\Users\Martin\Desktop\barrins-project\apps\barrins_identity` :
`app/core/security.py` (hachage), `app/schemas/auth.py` (règles de mot de
passe et de nom), `app/config/base.py` (coûts et limite de débit),
`app/core/rate_limit.py` (slowapi), `app/dependencies/auth.py` et
`apps/barrins_api/app/core/roles.py` (rôles).

### P1 — Hachage et protection de la connexion (aligné sur Barrin)

- **Mot de passe : Argon2id**, par `argon2-cffi`, avec **les coûts de Barrin**,
  lus dans la configuration et surchargeables par variable d'environnement
  comme chez Barrin : `ARGON2_MEMORY_COST_KIB=65536`, `ARGON2_TIME_COST=3`,
  `ARGON2_PARALLELISM=4`. Un seul `PasswordHasher` construit au chargement du
  module ; `verify_password` ne lève jamais (rend `False` sur une empreinte
  invalide, ce qui couvre le `!` du compte historique) ; `needs_rehash` à
  chaque connexion réussie pour faire évoluer les coûts sans migration.
  Vérifié le 2026-10-01 : `argon2-cffi` 25.1.0 avec `argon2-cffi-bindings`
  26.1.0 s'installe en wheel sous CPython 3.14.4 Windows ; l'installation sous
  Linux reste à confirmer en CI (wheels `abi3`).
- **Égalisation du temps de réponse, reprise de Barrin** : une empreinte
  factice est calculée une fois au chargement du module, et `dummy_verify` la
  vérifie quand l'adresse de connexion ne correspond à aucun compte. Un compte
  existant et un compte inexistant coûtent ainsi le même passage d'Argon2.
- **Politique de mot de passe, celle de Barrin** : au moins 12 caractères, dont
  une minuscule, une majuscule, un chiffre et un symbole, par l'expression de
  `PASSWORD_PATTERN`. Comme chez Barrin, la vérification passe par un
  `AfterValidator` Pydantic (le moteur Rust de Pydantic v2 ne connaît pas les
  lookaheads) ; le motif est seulement **exposé** dans le schéma OpenAPI par
  `json_schema_extra`, pas appliqué par `Field(pattern=...)`. S'y ajoute une
  longueur maximale (cf. « Bornes »), que Barrin n'a pas. La normalisation NFKC
  du premier jet n'est pas reprise, Barrin ne la fait pas.
- **Limitation de débit par `slowapi`, comme Barrin** : un `Limiter` partagé,
  clé = adresse IP (`get_remote_address`), décorateur sur `POST /connexion` à
  **5 par minute** par défaut, lu dans une variable (`LOGIN_RATE_LIMIT`) pour
  l'ajuster à l'échelle du pilote. Au-delà, 429 + `Retry-After`. Compteurs en
  mémoire du processus : remis à zéro au redémarrage, non partagés entre
  processus, limite acceptée pour un uvicorn à un processus. Derrière le proxy
  de Barrin, l'IP viendra de `X-Forwarded-For`, à configurer au Lot 11.
  L'inscription étant ouverte, `POST /inscription` reçoit la même protection,
  avec sa propre variable (voir « Points d'interprétation »).
- **Jetons de session : empreinte au repos, oui.** SHA-256 simple, pas Argon2 :
  le jeton a 256 bits d'entropie, un hachage lent ne protège de rien et
  coûterait 64 Mio de mémoire par requête. Le bénéfice est réel : une copie de
  `vtes.db` (sauvegarde, fichier joint à un ticket) ne donne aucune session
  utilisable.
- **Pas d'oracle sur la connexion** : un seul message 401 pour une adresse
  inconnue et un mauvais mot de passe, et `dummy_verify` quand l'adresse
  n'existe pas, pour que les deux cas prennent le même temps. Aucune expiration
  périodique du mot de passe, pas de vérification contre une liste de mots de
  passe compromis (pas de dépendance réseau au serveur).

### P2 — Périmètre du compte (aligné sur Barrin, sans vérification d'e-mail)

- **L'adresse e-mail est l'identifiant de connexion** : unique, non nulle.
  Un **nom d'utilisateur séparé** sert de handle public : unique, motif
  `^[A-Za-z0-9_-]{3,32}$`, celui de Barrin (`USERNAME_PATTERN`). Un motif sans
  lookaround peut être appliqué directement par `Field(pattern=...)`.
- **Inscription ouverte**, en libre-service, sans invitation. La table
  `signup_invitation`, la commande `invite` et la variable `SIGNUP_MODE` du
  premier jet sont abandonnées.
- **Aucune vérification d'e-mail.** Un compte est actif et utilisable dès son
  inscription, et `POST /inscription` ouvre la session dans la même réponse.
  C'est le comportement du mode `require_email_verification=False` de Barrin,
  mais ici c'est le seul mode : pas de variable pour le basculer, gurchon-hall
  n'ayant aucune infrastructure d'envoi.
- **Pas d'escalade de privilège à l'inscription**, comme le `UserSignup` de
  Barrin : le schéma d'inscription ne déclare pas `role` et interdit les champs
  inconnus (`extra="forbid"`), si bien qu'un `role` envoyé rend 422 ; le
  serveur pose `user` lui-même.
- **Réinitialisation de mot de passe par CLI**, pas par e-mail. Barrin n'est pas
  suivi sur ce point, son parcours passant par l'envoi d'un code. La commande
  `set-password` révoque au passage toutes les sessions du compte.
- **Oracle accepté** : « cette adresse est déjà utilisée » ou « ce nom est déjà
  pris » (409) révèle qu'un compte existe. C'est inhérent à une inscription
  ouverte sans vérification ; la limitation de débit s'applique.
- Commandes CLI, dans un script `backend/scripts/manage_accounts.py` :
  `claim-legacy` (pose adresse, nom et mot de passe du compte historique, une
  seule fois), `create`, `set-password`, `set-role` (promouvoir ou rétrograder
  un compte, seul moyen de créer un second administrateur), `revoke-sessions`,
  `purge-sessions`. Mot de passe lu par `getpass`, jamais en argument (il
  finirait dans l'historique du shell), et soumis à la même règle de
  complexité que l'API.

### P3 — Session et comportement hors ligne

- **Durée : 14 jours fixes**, cf. D1. Remplace les 30 jours glissants et
  180 jours de plafond du premier jet, ainsi que le rafraîchissement quotidien
  de `last_used_at` qui allait avec.
- **Hors ligne, la session ne compte pas.** Le cookie n'est vérifié que par le
  serveur ; tant que l'appareil est hors ligne, l'application lit et saisit
  dans sa base locale comme aujourd'hui, session expirée ou non. Au retour du
  réseau, une session expirée se découvre par un 401 : le moteur se met en
  pause (« reconnexion requise »), la file reste intacte, l'utilisateur se
  reconnecte, le rejeu reprend.
- **L'accès local survit à l'expiration tant que la file n'est pas vide**,
  jusqu'à la reconnexion. C'est la règle actée par l'utilisateur ;
  l'élargissement « file vide ou non » proposé au premier jet n'est **pas**
  retenu. Concrètement : un 401 constaté alors que la file contient des
  opérations laisse l'application ouverte sur la base locale, avec un bandeau
  de reconnexion ; un 401 constaté avec une file vide affiche l'écran de
  connexion (voir « Points d'interprétation » pour ce que devient alors la
  base locale). Le mur de connexion s'affiche aussi au premier lancement et
  après une déconnexion.
- **Hors ligne, qui est connecté ?** Le client garde dans sa base locale une
  copie non secrète du dernier `GET /moi` (identifiant et nom). Le cookie étant
  `HttpOnly`, le JavaScript ne connaît ni le jeton ni son expiration, et n'en a
  pas besoin.
- **Une base IndexedDB par compte.** Nom dérivé de l'identifiant
  (`gurchon-hall-offline-u<id>`), par l'option `dbName` que
  `createVtesOfflineRuntime` accepte déjà (`frontend/src/offline/vtes/runtime.ts`).
  Si la session de A expire et que B se connecte sur le même navigateur, la
  file de A dort dans la base de A, n'est jamais envoyée sous la session de B,
  et repart quand A se reconnecte. Une base unique aurait obligé à choisir
  entre purger les saisies de A et les envoyer sous le compte de B.
- **La base d'avant le Lot 6** (`gurchon-hall-offline`) n'est adoptée par
  aucun compte d'office. À la première connexion, s'il en existe une avec des
  opérations en file, l'application demande : « Des saisies faites avant les
  comptes attendent sur cet appareil. Les rattacher à <nom> ? ». Sur
  confirmation, la file, `settled` et les correspondances `client_ref` sont
  recopiées **sans modification** dans la base du compte (mêmes clés, mêmes
  corps, donc mêmes empreintes : un rejeu reste un rejeu), puis l'ancienne base
  est supprimée. Les miroirs ne sont pas recopiés, ils se rechargent.
- **Déconnexion hors ligne : refusée.** Le cookie est `HttpOnly` : hors ligne,
  le client ne peut ni l'effacer ni faire supprimer la session côté serveur.
  Purger la base locale en laissant le cookie en place donnerait, au retour du
  réseau, une application « déconnectée » dont les requêtes partiraient encore
  sous le compte précédent. Le bouton est donc désactivé hors ligne, avec
  l'explication. Alternative écartée : une déconnexion « en attente »
  mémorisée hors de la base purgée, rejouée en premier au retour du réseau —
  possible, mais un état de plus à tester pour un cas rare.
- **Purge à la déconnexion (D3)** : `POST /deconnexion` d'abord ; la base du
  compte n'est supprimée qu'après sa réponse (ou après un 401, qui dit que la
  session était déjà morte). Le precache du service worker ne contient que la
  coquille de l'application, sans donnée de compte : il n'est pas purgé.

### P4 — Langues : `POST /langues` réservé à un rôle admin (aligné sur Barrin)

`language` est une table partagée : une langue ajoutée par un compte
apparaîtrait chez tous. La route **n'est pas retirée** ; elle exige une session
et le rôle `admin`. Le patron est celui de Barrin
(`apps/barrins_identity/app/dependencies/auth.py`,
`apps/barrins_api/app/core/roles.py`) : une **dépendance FastAPI fabriquée**
par `require_role(min_role)`, ni décorateur ni middleware, qui compare
`current_user.role.level >= min_role.level` et rend 403 sinon.

- Enum de rôle à **deux niveaux** : `user` (niveau 1), `admin` (niveau 2). Les
  niveaux intermédiaires de Barrin (`moderator`, `ml_developer`) n'ont pas de
  sens ici et ne sont pas repris, mais la structure reste la même
  (`StrEnum` + propriété `.level`, comparaison par niveau, jamais par nom) pour
  qu'un rôle intermédiaire puisse s'insérer plus tard sans toucher aux
  dépendances.
- Le rôle par défaut à l'inscription est `user`, forcé par le serveur (P2).
- Le compte historique reçoit `admin` (D6). Un autre administrateur ne se crée
  que par CLI (`set-role`) ; aucune route ne modifie un rôle.
- Aucune UI ne crée de langue aujourd'hui (le front ne fait que lire
  `GET /langues`, et la file hors ligne n'a pas d'opération correspondante, le
  repli sur `XX` couvrant l'inconnu) : la route ne sert que par l'API, et le
  lot n'ajoute pas d'écran d'administration.

### P5 — Partagé ou privé (confirmé tel que proposé)

| Donnée | Décision | Raison |
| --- | --- | --- |
| Catalogue (`card` et liens, `card_printing` et occurrences, `card_translation`), `card_set`, `bundle`, `clan`, `discipline`, `sect`, `card_type` | partagé, lecture seule, public (accessible sans authentification, comme aujourd'hui) | ne bouge que par l'import krcg, données publiques |
| `language` | partagé, lecture publique, écriture réservée au rôle `admin` | P4 |
| `venue` | **par compte** | « Mon club » est une saisie de l'utilisateur, pas une référence publique. Partagée, elle ferait de l'unicité du nom un oracle et laisserait un compte renommer le lieu des autres. Le doublon entre comptes (deux « Le Bar à Dés ») est sans conséquence, puisque rien ne compare les parties de deux comptes. |
| `card_copy`, `deck`, `deck_card`, `deleted_deck_card`, `sync_operation` | par compte | cœur du lot |
| `player`, `tournament`, `game`, `participation` | par compte, dès ce lot | D7 ; les adversaires restent des noms propres au compte (§ 11 point 3) |

### Points d'interprétation

Lectures retenues par l'orchestrateur pour des détails que les décisions
ne fixent pas mot pour mot. Chacune tient en une constante ou un
comportement localisé, et peut être inversée sans reprendre le reste.

1. **« 14 jours » est une échéance fixe**, pas une expiration glissante : une
   durée unique remplace le couple glissant / absolu du premier jet.
2. **401 avec une file vide** : l'écran de connexion s'affiche, mais la base
   locale du compte n'est **pas** purgée (seule une déconnexion explicite
   purge, D3). Se reconnecter sous le même compte la retrouve ; se connecter
   sous un autre compte ouvre une autre base (base par compte).
3. **Limitation de `POST /inscription`** : même mécanisme slowapi par IP, avec
   sa propre variable (`SIGNUP_RATE_LIMIT`), même valeur par défaut que la
   connexion tant que rien ne justifie mieux.
4. **Casse de l'adresse e-mail** : à normaliser de façon que `A@x.fr` et
   `a@x.fr` désignent le même compte ; la règle exacte (minuscules sur toute
   l'adresse ou sur le domaine seulement) est laissée à l'architecte et sera
   écrite dans le contrat.

## Découpage en étapes ordonnées

| # | Étape | Agent | Skills | Fichiers principaux | Dépend de |
| --- | --- | --- | --- | --- | --- |
| A1 | Modèle, R8, R9, schémas, contrat, règles reformulées, brief `/sync` | architecte-contrat | `modele-donnees`, `migrations-alembic`, `contrat-openapi`, `regles-vtes` | `models/` (nouveau `account.py`, `collection.py`, `play.py`, `reference.py`, `sync.py`), deux révisions, `schemas/account.py`, `contracts/openapi.json`, `docs/lot3-sync-contrat.md` | décisions finales (fait) |
| A2 | Authentification : service, hachage façon Barrin, dépendance de session, `require_role`, cookie, contrôle d'`Origin`, slowapi, CORS, scripts CLI | backend-fastapi | `fastapi-endpoint`, `contrat-openapi`, `tests-backend` | `core/security.py` ou `services/auth.py`, `routers/auth.py`, `routers/common.py`, `main.py`, `scripts/manage_accounts.py`, `pyproject.toml` (`argon2-cffi`, `slowapi`, `email-validator`) | A1 |
| A3 | Scoping de toutes les routes et de `/sync`, comptabilité par compte | backend-fastapi | `fastapi-endpoint`, `regles-vtes`, `tests-backend` | `services/stock.py`, `services/decks.py`, `services/sync.py`, tous les routers métier | A2 |
| B | Client TS régénéré, `credentials: "include"` | frontend-react | `contrat-openapi` | `frontend/src/api-client/` | A1 |
| C | Couche offline : 401 = pause, base par compte, adoption de l'ancienne base, purge | pwa-offline | `pwa-offline`, `react-feature` | `offline/core/types.ts`, `syncEngine.ts`, `offline/vtes/transport.ts`, `refresh.ts`, `runtime.ts`, `offline/README.md` | B |
| D | Écrans : connexion, inscription, compte, déconnexion avec avertissement, bandeau de reconnexion, adoption de l'ancienne base — mobile et bureau | frontend-react | `react-feature`, `contrat-openapi`, `tests-frontend` | `features/auth/*`, coquille, routes à hash | C |
| E | Tests et validation de lot | qa-tests | `tests-backend`, `tests-frontend`, `pwa-offline`, `regles-vtes` | `backend/tests/`, `frontend/tests/` | A3 à D |
| F | CI et configuration : variables (`SESSION_COOKIE_SECURE`, `ARGON2_*`, `LOGIN_RATE_LIMIT`, `SIGNUP_RATE_LIMIT`), base éphémère du projet `real-backend` avec un compte, note de déploiement pour le Lot 11 | devops-deploiement | `ci-cd-deploiement` | `.github/`, `scripts/`, config Playwright | A2 |
| G | Clôture : CLAUDE.md § 5, § 6, § 7, § 11, § 12 | orchestrateur | `orchestration`, `ecriture-naturelle` | `CLAUDE.md` | E |

Parallélisme : une fois A1 livré et le contrat exporté, A2/A3 côté back et B,
C, D côté front avancent ensemble. La QA écrit les tests de migration dès A1
(base peuplée comprise) et les tests d'isolation au fil de A3.

### Détails d'étape

**C — couche offline.** Le transport de `/sync` rend aujourd'hui
`unavailable` pour toute réponse inattendue, 401 compris : le moteur
réessaierait en boucle avec backoff, sans rien perdre mais sans jamais rien
dire. Le lot ajoute à `TransportResult` un état `unauthenticated`, générique
(il vaut pour Barrin), que le moteur traite comme une **pause** :

- pas de nouvel essai automatique, pas de backoff, statut `auth_required`
  exposé à l'UI ;
- **jamais de bissection** (un 401 ne dit rien d'une opération en
  particulier), **jamais de refus local**, jamais de purge : toutes les
  opérations du lot restent en attente sous leurs clés ;
- reprise par un appel explicite après une connexion réussie.

Les rafraîchissements de miroir (`refresh.ts`) qui reçoivent un 401 gardent les
miroirs tels quels. Le cœur `core/` ne connaît ni les comptes ni les cookies :
il apprend seulement qu'un envoi peut être suspendu faute d'authentification.
Le choix du nom de base par compte, l'adoption de l'ancienne base et la purge
vivent dans l'adaptateur `vtes/` et la coquille. Le README du paquet reçoit la
marche à suivre pour Barrin : base par compte, pause sur 401, déconnexion en
ligne seulement.

**D — écrans.** Toute écriture métier continue de passer par
`useVtesOffline().actions`. Les routes d'authentification, elles, sont
nécessairement en ligne (on ne vérifie pas un mot de passe hors ligne) : les
formulaires de connexion et d'inscription l'indiquent quand le réseau manque.
Les routes clientes ne portent pas le nom d'une route d'API (`/connexion`,
`/moi`…), pour la même raison qu'au Lot 3 : le service worker les exclurait
du repli de navigation (`navigateFallbackDenylist`), et elles ne
s'ouvriraient plus hors ligne au rechargement. `apiRoutes.ts` reçoit les
nouveaux préfixes.

### Tests attendus (E)

Côté back, en plus de l'adaptation des suites existantes (qui devront presque
toutes s'exécuter sous un compte : une fixture de client authentifié) :

- migrations : cf. section dédiée ;
- authentification : inscription ouverte (compte actif aussitôt, session
  ouverte, rôle `user` ; `role` envoyé dans le corps refusé en 422 ; adresse ou
  nom déjà pris en 409 ; mot de passe hors règle de complexité en 422),
  connexion, mauvais mot de passe et adresse inconnue avec le même 401 (et
  passage par `dummy_verify`), 429 après le seuil, session expirée à 14 jours,
  déconnexion idempotente, `set-password` qui révoque les sessions, empreinte
  seule en base (aucun jeton en clair dans `auth_session`),
  `Cache-Control: no-store`, refus d'une écriture à `Origin` étrangère ;
- rôles : `POST /langues` rend 401 sans session, 403 pour un compte `user`,
  201 pour un compte `admin` ; le compte historique est `admin` après
  migration ; comparaison par niveau ;
- **isolation, route par route** : avec deux comptes A et B, chaque route
  protégée appelée par B sur une ressource de A rend 404 avec le message d'une
  ressource inexistante ; chaque liste de B ignore A ; chaque route protégée
  sans session rend 401 ;
- comptabilité : A et B possèdent la même carte × langue × extension ; les
  decks de B n'entrent pas dans les disponibilités de A, ni dans ses 409, ni
  dans le message de ces 409 ;
- discriminant : A et B obtiennent le même (nom, discriminant) ; l'épuisement
  des 9999 discriminants chez B n'affecte pas A ;
- `/sync` : même `operation_id` envoyée par A puis par B, appliquée deux fois,
  chacune dans son compte ; même `client_ref` dans les deux comptes ; une
  `client_ref` de A désignée par B rend `not_found` ; `mismatched_replay`
  seulement à l'intérieur d'un compte ; 401 sans rien appliquer ni
  journaliser ;
- tables du Lot 7 : les FK composites refusent une participation qui pointe le
  deck d'un autre compte (test de modèle, faute de routes).

Côté front : vitest sur la pause du moteur (401 : aucune bissection, aucune
opération sortie de la file, reprise après connexion), sur le nom de base par
compte, l'adoption de l'ancienne base (empreintes inchangées) et la purge à la
déconnexion. Scénarios `e2e-real` : connexion, saisie hors ligne, session
révoquée côté serveur pendant la coupure, retour réseau, pause, reconnexion,
rejeu complet ; deux comptes successifs dans le même navigateur sans aucune
donnée de l'un visible chez l'autre ; déconnexion avec file non vide,
annulée puis confirmée.

## Risques et points d'attention

**La portée de la comptabilité du stock.** Le risque principal du lot : un seul
appel de `allocated_real` resté global suffit à faire fuir et à fausser. D'où
le compte en paramètre obligatoire de toutes les fonctions de
`services/stock.py`, sans valeur par défaut, et un test d'isolation par
fonction. Même vigilance sur `services/decks.py` (tirage du discriminant,
ajout de ligne) et `services/sync.py` (résolution des références).

**Les oracles d'existence.** À relire comme une liste de contrôle en revue :
403 au lieu de 404 ; message de 404 différent pour « n'existe pas » et
« appartient à un autre » ; 409 de discriminant ou de stock qui compterait les
données d'un autre compte ; `replayed` ou `mismatched_replay` sur une clé d'un
autre compte ; `client_ref` d'un autre compte résolue ou refusée en
`conflict` ; 401 de connexion qui distinguerait un nom inconnu, ou un temps de
réponse qui le trahirait. Reste visible, et accepté : les identifiants
entiers sont séquentiels sur toute la base, donc un compte peut estimer le
nombre total de decks créés en regardant croître les siens. Rien d'autre n'en
découle, chaque identifiant étranger rendant 404.

**Le verrou d'écriture reste global à la base.** `serialized_writes` tient
`BEGIN IMMEDIATE` sur tout le fichier SQLite : le lot `/sync` d'un compte fait
attendre celui d'un autre, au pire jusqu'au 503 + `Retry-After` après 5 s. Ce
n'est pas un défaut mais une **limite acceptée** : 4 à 5 ms par opération,
soit environ une seconde pour un lot plein de 200, et quelques comptes au
plus pendant le pilote. Les invariants étant désormais tous par compte, un
portage vers Postgres pourrait prendre un verrou consultatif par compte
(`pg_advisory_xact_lock(user_id)`) au lieu d'un verrou global ; à écrire dans
la docstring de `app/db/locking.py`. L'échéance de session étant fixe (D1),
une requête authentifiée n'écrit rien dans `auth_session` et n'a pas à
attendre ce verrou ; seules la connexion et la déconnexion écrivent. La course
déjà documentée entre un lot et une écriture en ligne (`xfail` de
`test_sync_online_race.py`) reste ouverte, sans s'élargir entre comptes
puisque deux comptes ne partagent aucune ligne écrite.

**Le 401 dans le moteur de rejeu.** Traité comme un refus métier, il ferait
bissecter le lot puis marquer chaque opération refusée ; traité comme une
indisponibilité ordinaire (le cas actuel), il ferait tourner le backoff
indéfiniment sans prévenir. Il doit être une pause explicite (C). Les clients
déjà installés, d'avant le Lot 6, continueront de le traiter en
indisponibilité jusqu'à leur mise à jour par le service worker (`autoUpdate`) :
ils ne perdent rien.

**L'ordre de déploiement.** Migrer, puis réclamer le compte historique par CLI
(`claim-legacy`), **avant** d'ouvrir l'application. Tant que le compte
historique n'a pas de mot de passe, personne ne peut se connecter pour rejouer
les files des appareils existants ; elles attendent sans dommage.

**La base de développement.** Vérifier `DATABASE_URL` avant toute commande
Alembic. La base contient la vraie collection de l'utilisateur : la copier
avant `upgrade head`, et tester d'abord R9 sur cette copie.

**Postgres.** Les index uniques partiels (`ux_player_is_me`,
`ux_sync_operation_client_ref`) déclarent déjà leur variante `postgresql_where`
ou devront la déclarer ; les FK composites et les recréations de table écrites
à la main sont, elles, propres à SQLite dans leur forme (`ALTER TABLE …
RENAME` puis copie) et seraient à réécrire en `ALTER TABLE ADD COLUMN … NOT
NULL` sous Postgres.

**Barrin.** Ce qui doit en sortir réutilisable : la pause sur 401 dans le cœur
du moteur, la base par compte par l'option `dbName`, la règle « déconnexion en
ligne seulement » et la conversion de données vers un compte historique comme
modèle de migration. L'orchestrateur revoit tout changement de `offline/core/`
à ce titre.

## Critère de fin de lot

- `uv run pytest` vert (base de départ : 1597 tests, 2 `xfail`, à réexaminer
  pour le `--sql` des nouvelles révisions), `uv run ruff check .` propre,
  contrat exporté identique (`--check`) ;
- `npm run lint`, `npm run test`, `npx tsc --noEmit -p tsconfig.app.json`,
  `npm run test:e2e` verts, avec le bon nombre de tests (précaution OneDrive,
  § 11 Lot 4), scénarios d'authentification et d'isolation compris ;
- `uv run alembic upgrade head` passé sur une copie de `backend/vtes.db`, puis
  sur la base elle-même ; toutes les lignes au compte `1` ; disponibilités du
  stock identiques avant et après ; compte historique réclamé par CLI ;
- CLAUDE.md à jour : 25 tables, neuf révisions, 28 opérations au contrat,
  D2 et la nouvelle portée de la comptabilité au § 6 et au § 11, D0 et les
  décisions finales P1 à P5 au § 11, Lot 6 marqué livré au § 12 et lot
  Chercher reporté.
