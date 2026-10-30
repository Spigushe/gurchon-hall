# Couche offline

Ce dossier contient tout ce qui permet à l'appli de s'utiliser sans réseau : une
base IndexedDB, une file d'attente d'écritures, le rejeu de cette file vers
`POST /sync`, une recherche locale et les hooks React qui exposent l'état. Il est
écrit pour être copié dans barrins-project ; seul le dossier `vtes/` est propre à
ce dépôt.

Le contrat côté serveur est décrit dans `docs/lot3-sync-contrat.md`. Ce fichier
ne le répète pas : il dit comment la couche client le tient.

## Organisation

```text
offline/
├─ core/            générique : file, moteur de rejeu, repli de texte, base de base
├─ react/           générique : provider et hooks (état de la file, connectivité)
├─ vtes/            propre à VtES : schéma Dexie, opérations, lectures, transport
├─ tools/           générateurs des tables du repli de texte
├─ apiRoutes.ts     préfixes de l'API, exclus du service worker
└─ registerServiceWorker.ts   à importer directement, absent du barrel (voir plus bas)
```

Règle de dépendance : `core/` et `react/` n'importent rien de `vtes/` ni du client
d'API généré. `vtes/runtime.ts` est le seul fichier qui assemble le tout.

## Ce qui est générique (à copier tel quel)

- `core/db.ts` : `OfflineCoreDb`, une base Dexie avec quatre tables (`outbox`,
  `refs`, `meta`, et `settled` depuis la version 2). Une base d'application en
  hérite et ajoute ses tables.
- `core/outbox.ts` : la file. `enqueue`, `list`, `counts`, `reissue`, `discard`.
  Option `retainSettled` : voir « Entre le verdict et le rafraîchissement ».
- `core/settled.ts` : les opérations tranchées en attente de rafraîchissement
  (`lastSettledSeq`, `readSettled`, `pruneSettled`).
- `core/references.ts` (Lot 7) : `collectClientRefs`, un marcheur de références client
  qui lit des chemins déclarés par l'adaptateur (`data.rows[].who`), et `groupCascades`,
  qui range sous la création refusée les refus qui la désignent. Le genre d'une
  référence y est une chaîne opaque.
- `core/assertNever.ts` : garde d'exhaustivité des `switch` sur le type d'opération.
- `core/syncEngine.ts` : le moteur. `start`, `stop`, `flush`, `getStatus`,
  `subscribe`, `whenIdle`, `whenDrained`, `resumeAfterAuthentication` (Lot 6,
  cf. « Pause d'authentification » plus bas).
- `core/foldText.ts` : `foldText` et `containsFolded`, le repli casse et accents.
- `core/types.ts` : `SyncTransport`, `SyncVerdict`, `OutboxEntry`, `TransportResult`
  (dont l'état `unauthenticated`, Lot 6).
- `react/` : `OfflineProvider`, `useSyncStatus`, `useConnectivity`,
  `useRejectedOperations`, `useFlush`, `useLiveQuery`.
- `apiRoutes.ts` : la liste des préfixes de l'API. À adapter, c'est le seul endroit.

Ce que le cœur suppose du serveur : chaque opération porte `operation_id`,
`recorded_at` et `type`, et le serveur répond par un verdict `applied`,
`replayed` ou `rejected` par opération, dans un lot ordonné. Si l'API de Barrin
suit le même protocole, rien d'autre n'est à écrire dans `core/`.

## Ce qui est propre à VtES

- `vtes/db.ts` : les tables miroirs (`stock`, `decks`, `deckCards`, `cards`,
  `cardSets`, `languages`, puis `players`, `venues`, `tournaments`, `games` au
  Lot 7) et les versions du schéma (1 à 5, cf. « Versionnage du schéma
  IndexedDB » plus bas).
- `vtes/references.ts` (Lot 7) : genres de références, table création -> genre
  (`CREATION_BINDINGS`) et champs de référence de chaque type d'opération
  (`REFERENCE_FIELDS`, `referencesOf`). Voir « Chaîner des références de plusieurs
  genres ».
- `vtes/families.ts` : famille d'une opération par préfixe de son type, pour que
  chaque miroir n'efface de `settled` que la sienne.
- `vtes/playRules.ts` : `certainGameWin`, bilan provisoire d'un tournoi et ronde
  suivante, les règles de partie que le client suggère sans les imposer.
- `vtes/operations.ts` : un constructeur par type d'opération du contrat (vingt
  depuis le Lot 7, dont les douze de la pratique de jeu).
- `vtes/overlayPlay.ts` (Lot 7) : projection des joueurs, lieux, tournois et parties
  (clés `ref:<uuid>`, alias, upsert par nom, bilan provisoire). `overlay.ts` l'appelle
  pour ces douze types.
- `vtes/transport.ts` : `POST /sync` par le client typé généré.
- `vtes/overlay.ts`, `vtes/reads.ts` : ce que l'UI lit.
- `vtes/refresh.ts` : rafraîchissement des miroirs depuis les `GET`.
- `vtes/languages.ts` : le repli sur `XX`.
- `vtes/runtime.ts` : `createVtesOffline()`, qui assemble base, file, moteur et
  actions, et expose `purge()` (Lot 6).
- `vtes/account.ts` : identité locale d'un compte — `dbNameForAccount`,
  `saveLocalAccount`/`readLocalAccount` (copie du dernier `GET /moi` dans la
  base du compte), `rememberActiveAccountId`/`readActiveAccountId`/
  `forgetActiveAccountId` (pointeur hors base, cf. « Multi-compte » plus bas).
- `vtes/legacy.ts` : adoption de la base d'avant les comptes —
  `hasPendingLegacyOperations`, `adoptLegacyDatabase`.

Pour porter la couche : recopier `core/`, `react/`, `apiRoutes.ts` et
`tools/`, puis écrire un `vtes/` équivalent (schéma Dexie, constructeurs
d'opérations, transport, lectures). `vtes/runtime.ts` sert de modèle.

## Utilisation

Au démarrage, une seule fois :

```tsx
const offline = createVtesOffline();

<VtesOfflineProvider runtime={offline}>
  <App />
</VtesOfflineProvider>
```

Le provider démarre le moteur : reprise de la file, écoute de `online` et du retour
au premier plan.

Écrire. Chaque appel range l'opération dans IndexedDB et rend la main ; le réseau
n'est jamais attendu.

```ts
const { actions } = useVtesOffline();
// Depuis le Lot 4, une entrée de collection se désigne par carte × langue ×
// extension (`cardSetId`, `GET /extensions` ou `CardRow.cardSetIds`) ;
// `proxyAllowed` est passé de l'entrée de stock au deck.
await actions.saveStock({ cardId: 12, languageCode: "FR", cardSetId: 3, quantityOwned: 2 });
const { key } = await actions.createDeck({ name: "Malkavien", proxyAllowed: true });
await actions.saveDeckCard(key, { cardId: 12, languageCode: "FR", cardSetId: 3, quantity: 2 });
```

**Acquisition depuis un deck (Lot 4b).** `acquiredQuantity` fait entrer des
exemplaires physiques dans la collection avec la ligne, sans passer par
`saveStock` :

```ts
// Deck déjà monté sur la table : la collection n'a pas encore la carte.
await actions.saveDeckCard(key, { cardId: 12, languageCode: "FR", cardSetId: 3, quantity: 4, acquiredQuantity: 4 });
// Un proxy devient une vraie carte : la ligne perd 2 proxies, la collection gagne 2 exemplaires.
await actions.convertProxies(key, { cardId: 12, languageCode: "FR", cardSetId: 3 }, 2);
```

- `saveDeckCard(deck, input)` : `input.acquiredQuantity` (entier >= 0, omis de la charge
  utile s'il vaut 0). `convertProxies(deck, { cardId, languageCode, cardSetId }, count)`
  est un `saveDeckCard` (même quantité, `proxyQuantity - count`, `acquiredQuantity: count`).
- **Borne côté client, avant la file** : l'acquisition ne peut pas dépasser les
  exemplaires réels que l'écriture ajoute à la ligne (`(quantity - proxyQuantity)` après
  moins avant, l'avant étant lu dans la projection, file comprise ; 0 pour une ligne neuve).
  Sinon `AcquisitionBoundError` est levée et **rien** n'est mis en file. Cela évite un
  `invalid` du serveur, qui reste le garde-fou. Cette borne rend aussi impossible de compter
  deux fois une même saisie sur une ligne déjà écrite.
- **Sans acquisition**, l'entrée de collection n'est exigée que si la ligne consomme des
  exemplaires réels (`quantity > proxyQuantity`) : une carte absente du stock n'est pas
  refusée localement dans ce cas non plus, la file part et le serveur rend `conflict`,
  comme avant (l'entrée peut avoir été créée par une opération précédente du même lot, ou
  par un autre appareil). Une ligne entièrement en proxy (`quantity == proxyQuantity`)
  s'écrit sans entrée : le serveur ne l'exige plus, et aucune n'est créée.
- **Miroir** : la projection crée l'entrée de stock (`quantityOwned = acquis`) ou
  l'incrémente, avec la marque « en attente », en même temps que la ligne.
- **`settled`** : une opération qui acquiert touche deux miroirs. Le rafraîchissement du
  stock retire `acquired_quantity` de l'opération retenue (son effet est repris par le
  miroir, dans la même transaction) ; celui des decks n'efface que les opérations qui ne
  l'ont plus. L'opération sort donc de `settled` après les deux, dans n'importe quel
  ordre, sans double comptage du stock ni ligne qui disparaît.

Lire. Les hooks rendent l'instantané du serveur plus ce qui est encore en file, et
se remettent à jour tout seuls.

```ts
const stock = useLocalStock({ q: "elan" });      // trouve « Élan vital »
const decks = useLocalDecks({ state: "active" });
const cards = useLocalCardSearch({ q: "theo" }); // catalogue mis en cache, avec cardSetIds/latestCardSetId
const cardSets = useLocalCardSets();             // extensions du catalogue (GET /extensions)
```

Suivre la file :

```ts
const { pending, sending, rejected, online, lastError, nextRetryAt } = useSyncStatus();
const refused = useRejectedOperations();
```

Un deck seul, avec trois états distincts :

```ts
const deck = useLocalDeck(key);
// undefined : pas encore lu (premier rendu, ou clé qui vient de changer)
// null      : lu, introuvable sur cet appareil
// LocalDeck : le deck, tous états confondus (actif, archivé)
if (deck === undefined) return <Chargement />;
if (deck === null) return <Introuvable />;
```

Les autres lectures (`useLocalStock`, `useLocalDecks`, `useLocalDeckCards`,
`useLocalCardSearch`) rendent `undefined` tant que la première lecture n'a pas
abouti, puis toujours une liste (vide si rien).

Le catalogue complet (environ 4 000 cartes) ne se charge que sur demande :
`runtime.refresh({ catalog: true })`. Sans lui, la saisie hors ligne ne peut pas
proposer de carte inconnue de l'instantané.

### Rafraîchir les miroirs

`runtime.refresh(options)` relit les miroirs depuis les `GET` et ne lève jamais : il
rend un `RefreshReport` (`complete`, `refreshed`, `errors`). Avec `autoRefresh` (défaut),
la couche le lance au démarrage, au retour du réseau et après chaque rejeu.

- **Un seul à la fois, plus un derrière.** Un appel qui arrive pendant une lecture ne
  s'y fond pas (elle a commencé avant lui et peut ne pas voir ce qui vient de se
  passer) : il attend la lecture suivante, que tous les appelants du moment se
  partagent. Leurs options s'additionnent : `refresh()` puis `refresh({ catalog: true })`
  pendant la lecture donnent une seconde lecture, avec catalogue.
- **Il attend la fin de l'envoi en cours** (`engine.whenDrained()`), pour ne pas lire un
  serveur à mi-chemin d'un lot.
- **Ordre des miroirs** : langues, extensions, stock, decks, puis (Lot 7) joueurs,
  lieux, tournois, parties. Les tournois passent avant les parties pour que leur bilan
  soit à jour quand une partie tranchée sort de `settled`. Si les tournois n'ont pas pu
  être lus (401 ou autre erreur), les parties ne sont pas rafraîchies dans ce passage :
  leurs opérations restent dans `settled`, donc projetées avec le bilan recalculé, et le
  rapport est `complete: false`.
- **Les parties se relisent de façon incrémentale** : `GET /parties` ne rend que mon
  résumé, la table vient de `GET /parties/{id}`, lu seulement pour une partie nouvelle
  ou dont `updated_at` a changé. Les tournois, eux, sont relus en détail à chaque fois
  (`GET /tournois/{id}` : bilan et decks admis en finale, qui changent avec une
  *partie* sans que `updated_at` du tournoi bouge). Un 404 sur un détail (ressource
  supprimée entre la liste et le détail) omet la ligne ; un 401 laisse tous les miroirs
  tels quels et se signale par `authRequired`.
- **Garde-fou** : `refreshTimeoutMs` (60 s par défaut). Une lecture qui ne répond jamais
  rend un rapport d'échec et libère la place, au lieu de rendre muets tous les appels
  suivants.

`engine.whenIdle()` attend le rejeu **et** son rappel `onFlushed` ; `engine.whenDrained()`
n'attend que l'envoi et les verdicts. Un rappel `onFlushed`, ou ce qu'il déclenche
(`refresh` en est), ne doit jamais attendre `whenIdle()` : le rejeu attend le rappel, qui
attendrait le rejeu. C'était l'interblocage de `refresh` au retour du réseau.

## Ce que la couche garantit

**La clé d'idempotence ne change pas.** `operation_id` est tiré quand l'utilisateur
saisit, puis stocké avec l'opération. Rien ne le régénère : ni un échec réseau, ni un
rechargement, ni une mise à jour du service worker (la file vit dans la page, pas
dans le worker). Une opération en file ne se modifie pas : le serveur refuserait un
rejeu de la même clé avec un autre corps (`mismatched_replay`).

**Un refus ne se rejoue pas tel quel.** Il reste dans la file avec son motif, et
`useRejectedOperations` le donne à l'UI. Pour le corriger, `outbox.reissue(id,
transform, { position })` crée une nouvelle opération, sous une nouvelle clé, à la même
place dans la file (`position: "same"`, défaut) ou en fin de file (`"end"`, pour une
correction qui exige une opération postérieure à ce qui est déjà saisi). `outbox.discard(id)` l'abandonne. Un refus n'a aucun effet local : la lecture
est recalculée depuis l'instantané, il n'y a rien à défaire.

**Une seule requête à la fois.** Un verrou par onglet et, quand le navigateur l'offre,
un verrou Web Locks entre onglets. Un `flush()` demandé pendant un rejeu en ajoute un
de plus à la fin, sans envoi parallèle.

**Rien ne se perd.** Réseau coupé, 503, autre 5xx, réponse incomplète : le lot repart
en attente sous les mêmes clés et le moteur réessaie avec un délai qui double (1 s,
2 s, 4 s, jusqu'à 60 s). Un 503 accompagné de `Retry-After` allonge ce délai s'il le
faut, sans jamais le raccourcir. L'événement `online` relance tout de suite.

**Un 422 ne bloque pas la file.** Le lot est coupé en deux, récursivement, jusqu'à
isoler l'opération mal formée. Elle est refusée localement (`invalid_request`), les
autres passent.

**Un 401 met le rejeu en pause, il ne le rend pas indisponible (Lot 6).** Voir
« Multi-compte et pause d'authentification » plus bas pour le détail : contrairement
au 422, aucune bissection (un 401 ne désigne aucune opération) ; contrairement à un
503, aucun backoff programmé. Le lot entier reste `pending`, intact, jusqu'à un appel
explicite de `resumeAfterAuthentication()`.

**L'ordre est celui de la saisie.** La file n'est jamais réordonnée ni compactée ; les
lots sont de 200 opérations au plus.

**Le deck créé hors ligne garde la même clé.** `LocalDeck.key` vaut `ref:<uuid>` pour
un deck créé sans réseau, avant comme après sa synchronisation. La correspondance
référence vers `deck_id` est dans la table `refs`, qui survit aux redémarrages.

## Multi-compte et pause d'authentification (Lot 6)

Le pilote sort du mono-utilisateur : une session côté serveur (cookie `HttpOnly`,
14 jours fixes, `docs/lot6-plan-comptes.md`), un compte par donnée privée. Ce que la
couche offline en tient, dans l'ordre où l'étape D (écrans, hors de ce paquet) en a
besoin.

### Pause sur 401, pas indisponibilité

`TransportResult` (`core/types.ts`) porte un état `unauthenticated` à côté de `ok`,
`invalid` et `unavailable`. `vtes/transport.ts` le rend sur un 401 de `POST /sync`
(pas de session, expirée ou révoquée). Le moteur (`core/syncEngine.ts`) le traite comme
une **pause**, pas comme une panne transitoire :

- **aucune bissection** : un 401 ne désigne aucune opération en particulier,
  contrairement à un 422 ;
- **aucun backoff, aucune minuterie programmée** : contrairement à un 503, rien ne se
  reprogramme tout seul ;
- **aucun refus local, aucune purge** : tout le lot reste `pending`, sous ses clés,
  exactement comme avant l'envoi ;
- **aucun nouvel essai automatique** tant que la pause tient : ni l'événement `online`,
  ni le retour au premier plan, ni une nouvelle saisie ne relancent l'envoi (ils le
  feraient tourner en boucle contre le même 401, en silence). Un `flush()` **manuel**
  tente quand même, comme hors ligne — un attribut d'appel explicite, pas d'un
  déclencheur automatique.

`engine.getStatus().authRequired` (donc `useSyncStatus().authRequired`, déjà généralisé)
dit à l'UI qu'une reconnexion est nécessaire. La reprise se fait par
`engine.resumeAfterAuthentication()` : lève la pause puis tente un envoi, exactement
comme `flush()` (c'est littéralement la même chose, sous un nom explicite pour l'appelant).
Si la session est encore invalide, le transport répond de nouveau `unauthenticated` et le
lot repart en pause, intact. **Point d'entrée pour l'étape D** : appeler cette méthode une
fois la reconnexion (`POST /connexion`) confirmée.

`vtes/refresh.ts` distingue le même cas sur un `GET` : `unwrap()` lève `RefreshAuthError`
(sous-classe de l'erreur de lecture ordinaire) sur un 401, et `runtime.ts` la convertit en
`RefreshReport.authRequired = true` plutôt que de l'ajouter à `errors` — le miroir
concerné n'a pas bougé (l'écriture n'a lieu qu'après avoir tout lu avec succès), ce n'est
donc ni une perte de données ni une erreur de lecture au sens où `CatalogProvider` et le
reste de l'UI l'affichent aujourd'hui (voir « Point ouvert pour l'étape D » ci-dessous).

**Le cœur ne sait rien de plus.** `core/syncEngine.ts` et `core/types.ts` ne connaissent
ni compte ni cookie : `unauthenticated`/`authRequired` signalent seulement qu'un envoi est
suspendu faute d'authentification. C'est ce qui rend le mécanisme réutilisable tel quel
pour Barrin, à condition que son API réponde aussi 401 pour signaler une session absente
ou expirée sur `/sync`.

**Consommé côté étape D.** `features/catalog/CatalogProvider.tsx` distingue désormais
`authRequired` de `errors` (un 401 pendant un rafraîchissement n'est plus affiché comme
une panne générique) ; `features/auth/AuthWatcher.tsx` et `ReconnectBanner.tsx` lisent
`useSyncStatus().authRequired` pour, respectivement, faire passer l'écran en mur de
connexion quand la file est vide et afficher un bandeau non bloquant sinon ;
`features/auth/AuthGate.tsx` appelle `engine.resumeAfterAuthentication()` après une
reconnexion réussie. Ces fichiers sont hors du périmètre de ce paquet (`offline/`) et de
l'étape C : vérifiés ici seulement pour s'assurer que l'API exposée (`authRequired`,
`resumeAfterAuthentication`, `RefreshReport.authRequired`) est bien celle qu'ils
consomment, pas relus pour leur propre compte.

### Une base IndexedDB par compte

`vtes/account.ts` :

- `dbNameForAccount(userId)` rend `gurchon-hall-offline-u<id>` ; `createVtesOffline({
  dbName })` l'utilise directement (l'option existait déjà, elle n'attendait que d'être
  branchée à un nom par compte).
- `saveLocalAccount(db, account)` / `readLocalAccount(db)` : copie non secrète du dernier
  `GET /moi` (`id`, `email`, `username`, `role` — jamais de jeton ni d'empreinte, le
  cookie `HttpOnly` n'est ni lisible ni nécessaire ici), écrite **dans la base du
  compte** (table `meta`). Permet d'afficher « connecté en tant que X » hors ligne, sans
  réseau.
- `rememberActiveAccountId(userId)` / `readActiveAccountId()` / `forgetActiveAccountId()` :
  un pointeur **hors de toute base IndexedDB** (en `localStorage`) vers le compte actif
  sur cet appareil. Nécessaire pour résoudre l'œuf et la poule : `dbName` doit être connu
  *avant* d'ouvrir une base, donc avant de pouvoir y lire quoi que ce soit. Un identifiant
  de compte n'est pas secret (CLAUDE.md § 11, Lot 6 accepte déjà les identifiants
  séquentiels comme oracle mineur). **Décision non dictée mot pour mot par
  `docs/lot6-plan-comptes.md`** (qui place la copie de `/moi` « dans la base locale »,
  sans trancher comment retrouver cette base avant de l'ouvrir) : à valider côté
  orchestrateur/architecte si un autre mécanisme est préféré pour Barrin (ex. lire la
  liste des bases IndexedDB existantes au démarrage plutôt qu'un pointeur `localStorage`).

Flux attendu côté étape D :

```ts
// Connexion réussie (POST /connexion -> UserRead) :
const dbName = dbNameForAccount(user.id);
rememberActiveAccountId(user.id);
const runtime = createVtesOffline({ dbName });
await saveLocalAccount(runtime.db, user);
// ... éventuelle adoption (ci-dessous), puis runtime.start().

// Démarrage à froid, sans repasser par le réseau :
const id = readActiveAccountId();
if (id !== null) {
  const runtime = createVtesOffline({ dbName: dbNameForAccount(id) });
  // runtime.db a déjà la dernière identité connue (readLocalAccount), utilisable
  // hors ligne ; une vérification GET /moi en ligne confirme ou corrige ensuite.
}
```

### Adoption de la base d'avant les comptes

`vtes/legacy.ts` :

- `hasPendingLegacyOperations()` : vérification seule, sans effet de bord — y a-t-il, sur
  cet appareil, une base nommée `gurchon-hall-offline` (`LEGACY_DB_NAME`, l'ancien nom par
  défaut) avec des opérations en attente ? Sert à décider si l'étape D doit proposer la
  confirmation (« Des saisies faites avant les comptes attendent sur cet appareil. Les
  rattacher à `<nom>` ? »).
- `adoptLegacyDatabase(targetDbName)` : recopie la file, `settled` et les correspondances
  `client_ref` **sans modification** (mêmes `operation_id`, même corps — donc la même
  empreinte d'idempotence qu'avant : un rejeu reste un rejeu) dans la base du compte qui
  vient de se connecter, puis supprime l'ancienne base. Les miroirs ne sont **pas**
  recopiés : `runtime.refresh()` les recharge depuis le serveur. Seul le rang local
  (`rank`, jamais envoyé au serveur) est décalé pour s'ajouter à la suite de ce que la
  base cible contient déjà, sans jamais réordonner. Ne demande aucune confirmation
  elle-même : c'est le rôle de l'étape D, **avant** d'appeler cette fonction. Rend
  `{ adopted: false, operations: 0 }` sans rien changer si la base historique n'existe
  pas ou si sa file est vide.

### Déconnexion : en ligne seulement

Rien, dans ce paquet, ne purge une base locale de son propre chef : `createVtesOffline()`
ne fait jamais disparaître de données sans qu'on le lui demande explicitement.

- **Savoir si l'appareil est en ligne** pour désactiver le bouton de déconnexion hors
  ligne (le cookie étant `HttpOnly`, le client ne peut hors ligne ni l'effacer ni faire
  supprimer la session côté serveur) : `engine.getStatus().online` (donc
  `useConnectivity()`, déjà générique) suffit, aucun mécanisme nouveau n'a été ajouté ici.
- **`runtime.purge()`** (nouveau, `vtes/runtime.ts`) supprime la base IndexedDB du compte
  **en entier** : miroirs, file, `settled`, correspondances `client_ref`. Arrête le
  moteur et ferme la base au passage. Le precache du service worker (coquille de
  l'application) n'est pas concerné et n'est pas touché.
- **Ordre impératif, à respecter par l'étape D** : appeler `POST /deconnexion` **d'abord**,
  et n'appeler `purge()` qu'**après** sa réponse — succès ou 401, qui dit que la session
  était déjà morte côté serveur. Jamais avant : purger la base locale en laissant le
  cookie en place donnerait, au retour du réseau, une application « déconnectée » dont une
  éventuelle requête encore en vol partirait sous le compte précédent. `purge()` ne parle
  jamais au serveur de son côté ; c'est à l'appelant de respecter cet ordre.
- **D3 du brief (file non vide → avertir puis purger sur confirmation)** : l'avertissement
  et la confirmation sont à l'écran (étape D) ; ce paquet fournit seulement la mécanique
  (compter la file via `outbox.counts()`/`useSyncStatus()`, puis `purge()` une fois
  confirmé).
- **`purge()` ne touche pas au pointeur `localStorage`** (`forgetActiveAccountId`) :
  volontairement séparé, pour rester symétrique avec la connexion
  (`rememberActiveAccountId`, non lié à `createVtesOffline`) et ne pas coupler
  `runtime.ts` à un mécanisme propre à ce dépôt. L'étape D appelle les deux :

  ```ts
  // await apiClient.POST("/deconnexion") d'abord, quel que soit son statut (204 ou 401) :
  await runtime.purge();
  forgetActiveAccountId();
  ```

### `credentials: "include"` et nouvelles routes

- `frontend/src/api-client/client.ts` configure `credentials: "include"` sur le client
  partagé (`apiClient`) : nécessaire pour que le cookie de session parte sur chaque
  requête, y compris cross-origin (front et back sont deux origines distinctes même en
  développement). `vtes/transport.ts` réutilise ce client sans rien reconfigurer ; toute
  route d'authentification appelée directement par l'étape D (hors de ce paquet, en
  ligne seulement) en bénéficie aussi du moment qu'elle passe par `apiClient`.
- `apiRoutes.ts` liste désormais `/inscription`, `/connexion`, `/deconnexion`, `/moi` :
  nécessairement en ligne (on ne vérifie pas un mot de passe hors ligne), donc jamais de
  route cliente portant ces noms, pour la même raison que `/decks` ou `/sync`.

### Pour Barrin

Ce qui doit en sortir réutilisable (voir aussi CLAUDE.md § 11, Lot 6, points
« Côté client, une base IndexedDB par compte », « 401 = pause du moteur de sync » et
« Déconnexion : avertir, puis purger sur confirmation ») : la pause sur 401 dans `core/syncEngine.ts` (générique, sans notion de
compte) ; `dbNameForAccount`/l'option `dbName` pour une base par compte ; la règle
« déconnexion en ligne seulement » (`purge()` après la réponse serveur, jamais avant) ;
`adoptLegacyDatabase` comme modèle pour migrer une file mono-utilisateur existante vers
un compte. Le pointeur `localStorage` du compte actif (`account.ts`) est, lui, une
décision locale à ce dépôt (cf. ci-dessus) : à revoir au cas par cas.

## Chaîner des références de plusieurs genres dans un même lot (Lot 7)

Un lot peut créer un deck, un lieu, un tournoi, deux joueurs puis une partie qui
les nomme tous, chacun désigné par la `client_ref` de sa création. Ce que cela
demande à l'adaptateur, et que le cœur ne sait pas faire seul :

- **Le genre voyage avec la correspondance.** Les identifiants serveur se recouvrent
  d'un genre à l'autre (le joueur 12 et le deck 12 coexistent) ; les `client_ref`, eux,
  sont des UUID et ne se recouvrent pas. `RefBinding.kind` (texte opaque pour le cœur,
  absent = le genre historique, ici un deck) est rangé au verdict, sans cran Dexie :
  c'est un champ non indexé. Tout code qui **retourne** la table `refs` (identifiant ->
  référence, comme `overlay.ts`) doit d'abord filtrer par genre (`bindingsOfKind`),
  sinon le deck 12 prend la référence du joueur 12.
- **Une table création -> genre -> champ d'identifiant.** `toVerdict` lit
  `CREATION_BINDINGS[type]` pour savoir quel champ de la ressource du verdict
  (`deck_id`, `player_id`, `venue_id`, `tournament_id`, `game_id`) porte l'identifiant
  de la création, et le range avec son genre. Un nouveau genre se déclare en une ligne.
- **Une table type d'opération -> champs de référence.** `REFERENCE_FIELDS` dit où
  chaque type désigne d'autres ressources (`deck`, `data.venue`,
  `data.participations[].player`…). `referencesOf(operation)` en tire ce que
  l'opération crée et ce qu'elle désigne par référence client ; une désignation par
  identifiant serveur, ou `{"me": true}`, n'est pas une dépendance. Le cœur fournit le
  marcheur (`collectClientRefs`) et le regroupement (`groupCascades`), pas la liste des
  champs.
- **Les refus en cascade.** Si la création d'un joueur est refusée, la partie qui le
  nomme l'est aussi (`unresolved_client_ref` ou `not_found`). `groupCascades(refusées,
  referencesOf)` les range sous leur racine : l'écran de synchronisation montre la
  cause une fois, et la correction de la racine (`reissue`, au besoin en fin de file)
  suffit souvent à rendre les autres rejouables telles quelles.
- **Les clés de surcouche** (`PlayerKey`, `VenueKey`, `TournamentKey`, `GameKey`,
  comme `DeckKey`) valent `ref:<uuid>` avant et après la synchronisation d'une création
  hors ligne, `id:<n>` pour ce qui vient du serveur. Les cinq types ont la même forme :
  TypeScript ne les distingue pas, c'est la table consultée qui les distingue.
- **Un miroir ne vide que sa famille de `settled`** (`vtes/families.ts`) : relire les
  joueurs n'efface pas une partie tranchée dont le miroir n'est pas encore à jour.

## Pratique de jeu : joueurs, lieux, tournois, parties (Lot 7)

**Écrire.** Une action par type d'opération, toutes par la file :

```ts
const { actions } = useVtesOffline();
const club = await actions.ensureVenue("Club de Lyon");     // { created, key, clientRef, entry }
const tournoi = await actions.createTournament({
  name: "Régionaux", startDate: "2026-10-24", venue: club.key,
  deckPolicy: "multi", finalDeckRule: "free_choice",
});
const marc = await actions.ensurePlayer("Marc");
const partie = await actions.createGame({
  tournament: tournoi.key, venue: club.key, roundType: "preliminary", roundNumber: 1,
  playerCount: 4,                                   // playedAt : maintenant par défaut
  participations: [
    { player: "me", deck: "ref:<uuid du deck>", seat: 2, victoryPoints: 2.5, gameWin: true },
    { player: marc.key, seat: 1 },
  ],
});
await actions.updateGame(partie.key, { table: [...] });   // table COMPLÈTE, table connue seulement
await actions.updateTournament(tournoi.key, { deckPolicy: "mono" }); // envoie final_deck_rule: null
```

- Les créations rendent `{ clientRef, key, entry }` ; la clé `ref:<uuid>` désigne la
  ressource aussitôt, avant et après le verdict. Toute désignation (`venue`, `tournament`,
  `player`, un deck…) accepte une clé `id:<n>` / `ref:<uuid>` ou un sélecteur
  (`{ id }`, `{ clientRef }`) ; `"me"` désigne ma ligne.
- Les champs non fournis sont omis, un `null` explicite part (remettre à zéro). `data`
  et `table` d'un `game.update` ne sont écrits que s'ils sont fournis : `data: {}` et
  `data` omis n'ont pas la même empreinte, la file garde le corps exact.
- `ensurePlayer` / `ensureVenue` ne mettent rien en file si le nom existe déjà
  (casse et accents ignorés, « Moi » exclu pour les joueurs). Le serveur fait de toute
  façon un **upsert par nom** : un `applied` ne veut pas dire « créé », et deux
  références peuvent désigner le même joueur.
- `updateGame` avec `table` lève `GameTableUnknownError` si la table de la partie est
  inconnue (`LocalGame.table === null`) : la remplacer d'un bloc effacerait les adversaires.

**Lire.** `useLocalPlayers`, `useLocalVenues`, `useLocalTournaments({ q, from, to })`,
`useLocalGames({ tournamentKey, casual, deckKey, venueKey, from, to })` rendent une liste
(`undefined` tant qu'elle n'est pas lue) ; `useLocalPlayer`, `useLocalVenue`,
`useLocalTournament`, `useLocalGame` prennent une clé et rendent `undefined` (pas lu),
`null` (introuvable ici) ou la ressource. Les versions sans hook sont les `read*` de
`reads.ts`. Les parties se trient de la plus récente à la plus ancienne, les tournois par
date de début décroissante, les joueurs avec le « Moi » en tête.

- **Clé canonique et alias.** Chaque ressource porte `key` et `aliases` (`id:<n>`,
  chaque `ref:<uuid>` liée) ; les hooks « par clé » et les filtres retrouvent par n'importe
  laquelle, donc une sélection tenue par l'UI survit au verdict. Dans le cas rare d'un
  upsert, la clé canonique d'un joueur peut passer d'une référence à l'autre entre la file
  et le miroir : toujours retrouver par `findByKey` / les hooks, ne pas comparer des clés
  à la main.
- **Table d'une partie.** `LocalGame.table` : `LocalTableLine[]` (`playerKey`, `isMe`,
  `deckKey`, `seat`, VP et GW sur ma seule ligne), ou `null` si inconnue. Une partie saisie
  hors ligne la porte d'emblée. Tant que le miroir des joueurs n'a jamais été lu, ma ligne
  porte la clé `id:0` : se fier à `isMe`, pas à la clé.
- **Bilan d'un tournoi.** `LocalTournament.summary` : celui du serveur, recalculé
  localement dès qu'une partie du tournoi a bougé ; `summaryProvisional` est vrai tant
  qu'une saisie du tournoi est encore en file. `admissibleFinalDecks` (`DeckKey[] | null`)
  vient du dernier rafraîchissement et n'est jamais recalculé hors ligne.
- **GW omis.** Comme le serveur (`resolved_game_win`), la projection prend pour GW d'une
  ligne le GW déclaré, sinon le GW certain que donnent ses VP (`certainGameWin`), sinon
  rien : le bilan provisoire compte donc le même GW que le serveur comptera.
- **Nom du tournoi d'une partie.** Recopié du tournoi projeté ; `null` dès que la partie
  n'a plus de tournoi.
- **Compteurs** (`gameCount`, `tournamentCount`) : ceux du serveur, qui ne suivent pas la file.
- Pour la ronde à proposer : `nextRoundNumber(parties du tournoi.map(roundNumber))` ;
  pour le GW : `certainGameWin` (`playRules.ts`).

**Libellés et corrections** (hors de ce dossier, `features/sync/`) : `describeOperation.ts`
(pur, un libellé par type), `playCorrection.ts` (pur, champs et brouillon de correction)
et `PlayCorrectionFields.tsx`. L'écran Synchronisation range les refus en cascade sous
leur racine (`groupCascades` + `referencesOf`).

## Entre le verdict et le rafraîchissement

Une opération tranchée sort de la file, mais l'instantané du serveur n'est relu que
plus tard. Sans précaution, son effet disparaîtrait entre les deux : un deck créé hors
ligne s'évanouirait de la liste, sa page dirait « introuvable », une quantité de stock
reviendrait à l'ancienne valeur.

La file de VtES est donc créée avec `retainSettled: true`. Dans la **même transaction**
que la sortie de la file, l'opération est copiée dans la table `settled`, et la projection
(`project(snapshot, file, tranchées)`) l'applique avant les opérations en file, sans
marque « en attente ». Une création tranchée connaît son identifiant serveur (table
`refs`) ; son numéro de deck (discriminant) reste vide jusqu'au rafraîchissement. Quand
le miroir contient déjà le deck, il fait foi.

Un rafraîchissement relève le curseur `lastSettledSeq` **avant** de lire le serveur, puis
efface les opérations tranchées jusqu'à ce curseur dans la transaction qui remplace le
miroir (`pruneSettled`) : ce qui a été tranché pendant la lecture reste, la lecture ayant
pu passer avant. Un rafraîchissement qui échoue n'efface rien. Chaque miroir n'efface que
sa famille (stock, decks).

Pour Barrin : activer `retainSettled`, déclarer `CORE_STORES_V2` dans la base, et
appliquer le même protocole dans les fonctions de rafraîchissement. Si une opération
écrit dans **deux** miroirs (Lot 4b : une ligne de deck qui crée du stock), `pruneSettled`
accepte un filtre sur l'entrée entière : le premier miroir relu neutralise sa part de
l'opération retenue (ici, retirer `acquired_quantity`), le second l'efface. Effacer d'un
côté seulement ferait disparaître l'effet de l'autre, ne rien neutraliser le compterait
deux fois.

## Recherche locale

`foldText` reproduit `app.db.folding.fold_text` du back : NFKD, retrait des marques
combinantes, repli de casse. Trois points ne sont pas ceux de JavaScript et sont
compensés par des tables générées :

- `str.casefold()` n'est pas `toLowerCase()` (ß devient ss, ς devient σ) ;
- `unicodedata.combining()` n'est pas `\p{M}` : Python ne retire que les marques de
  classe de combinaison non nulle ;
- les lettres qui ne se décomposent pas restent elles-mêmes : « oe » ne trouve pas
  « Œuvre », « lodz » ne trouve pas « Łódź ».

Les tables sont dans `core/foldData.ts` (généré, ne pas modifier). Pour les
régénérer après un changement de version de Python côté back :

```bash
cd backend
uv run python ../frontend/src/offline/tools/dump_fold_reference.py \
  --source /tmp/fold-source.json \
  --fixture ../frontend/tests/unit/offline/fixtures/fold-parity.json
cd ../frontend
node src/offline/tools/gen_fold_data.mjs /tmp/fold-source.json
```

Le test `tests/unit/offline/foldText.test.ts` compare `foldText` au vrai `fold_text`
Python sur tous les points de code Unicode. Seul écart toléré : un caractère que le
moteur JavaScript connaît et pas la version d'Unicode de Python.

## Langue inconnue

`POST /langues` n'a pas d'équivalent dans la file. Une saisie dans une langue absente
de la liste connue (miroir de `GET /langues`, langues déjà en stock, `XX`) part avec
`XX`, à corriger en ligne ensuite. Tant que la liste n'a jamais été lue, les langues
semées par le serveur (`EN`, `FR`, `ES`, `XX`) font foi. Un code vide est refusé.

## Versionnage du schéma IndexedDB

Une base IndexedDB a un seul numéro de version pour toutes ses tables. Le schéma
actuel est la version 5 : la 1 (`CORE_STORES_V1` plus `VTES_STORES_V1`), la 2 qui
ajoute `settled` (`CORE_STORES_V2`), les 3 et 4 du Lot 4 (`VTES_STORES_V2`,
`VTES_STORES_V3`), puis la 5 du Lot 7 (`VTES_STORES_V4` : `players`, `venues`,
`tournaments`, `games`, un ajout de magasins sans changement de clé, donc un seul
cran et aucune donnée perdue). `OfflineCoreDb` ferme sa connexion quand un autre
onglet monte la version (événement `versionchange`) : sans cela, la mise à niveau
resterait bloquée tant qu'un ancien onglet est ouvert. Pour faire évoluer le schéma en temps normal, ajouter un
`this.version(n + 1).stores({...})` avec les seules tables modifiées, et un
`.upgrade()` si des données doivent migrer. Ne jamais réécrire une version déjà
livrée : des navigateurs ont déjà ouvert la base.

**Cas particulier : changer la clé primaire d'une table.** IndexedDB ne permet pas
de modifier le `keyPath` d'un magasin existant ; Dexie lève `Not yet support for
changing primary key` si on le tente dans un seul cran de version. Le Lot 4 en a eu
besoin pour `stock` et `deckCards` (l'extension s'ajoute à leur clé) : la seule voie
est de supprimer le magasin dans un cran (`{ stock: null }`) puis de le recréer avec
sa nouvelle clé dans le suivant (`db.ts`, `VTES_STORES_V2` puis `VTES_STORES_V3`,
déclarés en version 3 puis 4). Les deux crans se jouent dans la **même** transaction
de mise à niveau pour un navigateur qui ouvre la base pour la première fois, et à la
suite l'un de l'autre pour un navigateur qui a déjà une version antérieure — pas
besoin de prévoir un cas particulier pour l'un ou l'autre. Un magasin dont seule la
*forme* des lignes change (un champ de plus, comme `cards.cardSetIds` ou
`decks.proxyAllowed` au Lot 4), sans changement de clé, n'a pas besoin d'être
supprimé : un `.upgrade()` qui vide la table suffit à écarter les lignes
incomplètes, le prochain rafraîchissement les recharge dans la forme du contrat.

**Note pour Barrin (D4, `docs/lot4-plan-inventaire.md`).** Un changement de contrat
qui rend **obligatoire** un champ nouveau (ici `card_set_id`) casse toute opération
restée dans la file d'un client qui n'a pas encore mis à jour son application : le
serveur la refuse en 422 (champ manquant), et la bissection du moteur l'isole comme
n'importe quelle opération mal formée. gurchon-hall a pu se permettre cette rupture
sans période de transition (D4 : base de développement vide, aucun utilisateur réel).
Sur une base en service, l'ordre à respecter est l'inverse : déclarer le champ
nouveau **facultatif** côté contrat le temps que les clients déployés vident leur
file, puis seulement ensuite le rendre obligatoire. Ce que l'empreinte d'idempotence
(`schemas/sync.py`, `fingerprint`, `exclude_unset=True`) permet directement : elle ne
porte que sur les champs effectivement envoyés, donc une ancienne opération sans le
nouveau champ garde la même empreinte tant qu'elle n'est pas rejouée avec un corps
différent.

## Service worker

`registerServiceWorker.ts` importe `virtual:pwa-register`, fourni par le seul plugin PWA de
Vite : le barrel `offline/index.ts` ne le réexporte donc pas (il ne serait pas importable
sous vitest). L'appli l'importe directement : `import { registerServiceWorker } from
"./offline/registerServiceWorker"`.

Les routes de l'API n'ont pas de préfixe `/api`, donc rien ne les distingue d'une
route de l'app. `apiRoutes.ts` les liste, et `vite.config.ts` en fait la
`navigateFallbackDenylist` : une navigation vers `/sync` ne reçoit jamais la coquille
HTML. Les appels `fetch` de la file ne sont pas interceptés (pas de `runtimeCaching`),
et le precache ne porte que les fichiers du build. Un test compare la liste à
`contracts/openapi.json` : une nouvelle ressource au contrat sans entrée ici fait
échouer la suite.

Conséquence pour l'UI : ne pas nommer une route cliente comme une ressource de l'API
(`/decks`), elle ne s'ouvrirait plus hors ligne à un rechargement. Préférer un préfixe
dédié ou un routeur à hash.

## Limites connues

- `bundle.deposit` n'est pas projeté dans les lectures : le contenu du produit n'est
  pas mis en cache. Le stock correspondant apparaît au rafraîchissement qui suit la
  synchronisation.
- Les miroirs se rafraîchissent en entier, pas en delta, à une exception près : les
  tables des parties (Lot 7), qu'on ne relit que si `updated_at` a changé. Pour la taille
  de ce projet c'est sans conséquence ; à revoir si Barrin a des volumes plus grands.
- Lot 7 : la liste des parties se lit en une requête, mais les tables en une par partie
  nouvelle ou modifiée (sérielles), et les tournois en une par tournoi à chaque
  rafraîchissement. Un premier chargement d'un long carnet est donc lent ; la suite ne
  coûte que ce qui a changé.
- Lot 7 : les compteurs des joueurs et des lieux, et les decks admis en finale, ne suivent
  pas la file ; ils redeviennent exacts au rafraîchissement.
- Le tri local compare les chaînes par unités de code, comme le tri binaire de SQLite
  pour la plupart des textes ; il partage la limite connue du back (majuscules avant
  minuscules, accents en fin).
- Lot 6 : la mécanique (pause, base par compte, adoption, purge) est testée ici au
  niveau du paquet. `features/auth/`, hors de ce paquet, consomme
  `SyncStatus.authRequired` et `RefreshReport.authRequired` pour le mur et le bandeau de
  reconnexion (« Multi-compte et pause d'authentification ») ; il a ses propres tests
  (`frontend/tests/unit/features/auth/`) et trois scénarios de bout en bout contre le
  vrai back (`frontend/tests/e2e-real/lot6-comptes.spec.ts`).
