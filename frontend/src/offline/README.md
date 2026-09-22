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
- `core/syncEngine.ts` : le moteur. `start`, `stop`, `flush`, `getStatus`,
  `subscribe`, `whenIdle`, `whenDrained`.
- `core/foldText.ts` : `foldText` et `containsFolded`, le repli casse et accents.
- `core/types.ts` : `SyncTransport`, `SyncVerdict`, `OutboxEntry`.
- `react/` : `OfflineProvider`, `useSyncStatus`, `useConnectivity`,
  `useRejectedOperations`, `useFlush`, `useLiveQuery`.
- `apiRoutes.ts` : la liste des préfixes de l'API. À adapter, c'est le seul endroit.

Ce que le cœur suppose du serveur : chaque opération porte `operation_id`,
`recorded_at` et `type`, et le serveur répond par un verdict `applied`,
`replayed` ou `rejected` par opération, dans un lot ordonné. Si l'API de Barrin
suit le même protocole, rien d'autre n'est à écrire dans `core/`.

## Ce qui est propre à VtES

- `vtes/db.ts` : les tables miroirs (`stock`, `decks`, `deckCards`, `cards`,
  `languages`) et les versions 1 et 2 du schéma.
- `vtes/operations.ts` : un constructeur par type d'opération du contrat.
- `vtes/transport.ts` : `POST /sync` par le client typé généré.
- `vtes/overlay.ts`, `vtes/reads.ts` : ce que l'UI lit.
- `vtes/refresh.ts` : rafraîchissement des miroirs depuis les `GET`.
- `vtes/languages.ts` : le repli sur `XX`.
- `vtes/runtime.ts` : `createVtesOffline()`, qui assemble base, file, moteur et
  actions.

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
await actions.saveStock({ cardId: 12, languageCode: "FR", quantityOwned: 2 });
const { key } = await actions.createDeck({ name: "Malkavien" });
await actions.saveDeckCard(key, { cardId: 12, languageCode: "FR", quantity: 2 });
```

Lire. Les hooks rendent l'instantané du serveur plus ce qui est encore en file, et
se remettent à jour tout seuls.

```ts
const stock = useLocalStock({ q: "elan" });      // trouve « Élan vital »
const decks = useLocalDecks({ state: "active" });
const cards = useLocalCardSearch({ q: "theo" }); // catalogue mis en cache
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
transform)` crée une nouvelle opération, sous une nouvelle clé, à la même place dans
la file. `outbox.discard(id)` l'abandonne. Un refus n'a aucun effet local : la lecture
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

**L'ordre est celui de la saisie.** La file n'est jamais réordonnée ni compactée ; les
lots sont de 200 opérations au plus.

**Le deck créé hors ligne garde la même clé.** `LocalDeck.key` vaut `ref:<uuid>` pour
un deck créé sans réseau, avant comme après sa synchronisation. La correspondance
référence vers `deck_id` est dans la table `refs`, qui survit aux redémarrages.

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
appliquer le même protocole dans les fonctions de rafraîchissement.

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
actuel est la version 2 : la 1 (`CORE_STORES_V1` plus `VTES_STORES_V1`), et la 2 qui
ajoute `settled` (`CORE_STORES_V2`). Pour le faire
évoluer, ajouter un `this.version(3).stores({...})` avec les seules tables modifiées,
et un `.upgrade()` si des données doivent migrer. Ne jamais réécrire une version déjà
livrée : des navigateurs ont déjà ouvert la base.

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
- Les miroirs se rafraîchissent en entier, pas en delta. Pour la taille de ce projet
  c'est sans conséquence ; à revoir si Barrin a des volumes plus grands.
- Le tri local compare les chaînes par unités de code, comme le tri binaire de SQLite
  pour la plupart des textes ; il partage la limite connue du back (majuscules avant
  minuscules, accents en fin).
