import { expect, test } from "./support/backend";
import { expectSynced, openApp, waitForServiceWorkerControl } from "./support/app";

/**
 * Schéma de la base IndexedDB de la file offline, déplacé ici depuis
 * `tests/e2e/offline-layer.spec.ts` au Lot 6 : `AuthGate` n'ouvre un runtime
 * offline (donc une base Dexie) qu'après une connexion réussie
 * (`src/features/auth/AuthGate.tsx`), ce qui demande un vrai back à
 * authentifier — absent du projet `chromium`. `openApp` se connecte avec
 * `TEST_ACCOUNT` (Lot 6) avant de rendre `<App/>`.
 *
 * La base n'est plus nommée `gurchon-hall-offline` (nom d'avant le Lot 6) mais
 * `gurchon-hall-offline-u<id>` (une base par compte, `dbNameForAccount`) : on
 * la retrouve par motif plutôt que de dépendre de l'identifiant exact du
 * compte de test, qui n'est pas garanti stable.
 */

test("la base IndexedDB de la file existe avec son schéma, par compte, y compris après rechargement hors ligne", async ({
  page,
  context,
  api,
}) => {
  void api; // démarre le vrai back : sans lui la connexion échoue (ERR_CONNECTION_REFUSED)
  await openApp(page);
  await waitForServiceWorkerControl(page);
  await expectSynced(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Gurchon Hall" })).toBeVisible();

  const schema = await page.evaluate(
    () =>
      new Promise<{
        version: number;
        stores: Record<string, { keyPath: unknown; indexes: Record<string, boolean> }>;
      }>((resolve, reject) => {
        const started = Date.now();
        const tryOpen = async () => {
          const names = (await indexedDB.databases()).map((database) => database.name);
          const name = names.find((candidate): candidate is string =>
            !!candidate && /^gurchon-hall-offline-u\d+$/.test(candidate),
          );
          if (!name) {
            if (Date.now() - started > 10_000) return reject(new Error("base absente"));
            return setTimeout(tryOpen, 100);
          }
          const request = indexedDB.open(name);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const stores: Record<string, { keyPath: unknown; indexes: Record<string, boolean> }> = {};
            const tx = db.transaction([...db.objectStoreNames], "readonly");
            for (const storeName of db.objectStoreNames) {
              const store = tx.objectStore(storeName);
              stores[storeName] = {
                keyPath: store.keyPath,
                indexes: Object.fromEntries(
                  [...store.indexNames].map((index) => [index, store.index(index).unique]),
                ),
              };
            }
            // Dexie multiplie la version par 10 : la version 4 du schéma (Lot 4, extension
            // dans la clé de `stock` et `deckCards`, cf. `offline/vtes/db.ts`) est 40 côté IndexedDB.
            const version = db.version;
            db.close();
            resolve({ version, stores });
          };
        };
        void tryOpen();
      }),
  );

  expect(schema.version).toBe(40);
  expect(Object.keys(schema.stores).sort()).toEqual(
    ["cardSets", "cards", "deckCards", "decks", "languages", "meta", "outbox", "refs", "settled", "stock"].sort(),
  );
  expect(schema.stores.outbox.keyPath).toBe("operationId");
  expect(schema.stores.outbox.indexes.rank).toBe(true); // rang unique : l'ordre de la file
  expect(schema.stores.refs.keyPath).toBe("ref");
  expect(schema.stores.settled.keyPath).toBe("seq"); // opérations tranchées, clé auto-incrémentée
  // Identité carte × langue × extension (Lot 4) : l'extension entre dans la clé.
  expect(schema.stores.stock.keyPath).toEqual(["cardId", "languageCode", "cardSetId"]);
  expect(schema.stores.deckCards.keyPath).toEqual(["deckId", "cardId", "languageCode", "cardSetId"]);
  // Copie locale de `GET /moi` (Lot 6, § P3) : une ligne de plus que les dix
  // magasins vérifiés ci-dessus, dans `meta` (clé `"account"`), pas un magasin séparé.

  await context.setOffline(false);
});
