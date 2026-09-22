import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Ce qui est propre à la couche offline (Lot 3) et ne se vérifie que dans un
 * vrai navigateur : le service worker laisse les routes de l'API tranquilles,
 * et la base IndexedDB de l'application existe avec le schéma attendu, y
 * compris hors ligne. Le scénario complet (saisie, coupure, rejeu, conflit)
 * relève de la QA.
 */

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(currentDir, "../../dist");

async function controlledByServiceWorker(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Gurchon Hall" })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

test.describe("couche offline dans le navigateur", () => {
  test("le service worker généré exclut /sync et les routes de l'API du fallback de navigation", async () => {
    const sw = await readFile(path.join(DIST_DIR, "sw.js"), "utf-8");
    for (const route of ["sync", "decks", "stock", "cartes", "bundles", "langues", "health"]) {
      expect(sw, route).toContain(`^\\/${route}(?:[/?#]|$)`);
    }
    // Aucune route d'API dans le precache : seuls les fichiers du build y figurent.
    const precached = [...sw.matchAll(/url:"([^"]+)"/g)].map((match) => match[1]);
    expect(precached.length).toBeGreaterThan(0);
    for (const url of precached) {
      expect(url).not.toMatch(/^(sync|decks|stock|cartes|bundles|langues|health)(\/|$)/);
    }
  });

  test("hors ligne, une navigation vers /sync n'est pas servie par l'app shell", async ({
    page,
    context,
  }) => {
    await controlledByServiceWorker(page);
    await context.setOffline(true);

    // Une route de la SPA reste servie (contrôle)...
    const shell = await page.goto("/");
    expect(shell?.fromServiceWorker()).toBe(true);

    // ... mais /sync ne reçoit jamais la coquille HTML à la place de l'API.
    await expect(page.goto("/sync")).rejects.toThrow(/net::ERR_/);

    // Un POST /sync de la file échoue en erreur réseau (rejeu ultérieur), il
    // n'est ni intercepté ni servi depuis un cache.
    const outcome = await page.evaluate(async () => {
      try {
        const response = await fetch("/sync", { method: "POST", body: "{}" });
        return `servi:${response.status}`;
      } catch {
        return "erreur-reseau";
      }
    });
    expect(outcome).toBe("erreur-reseau");

    await context.setOffline(false);
  });

  test("la base IndexedDB de la file existe avec son schéma, y compris après rechargement hors ligne", async ({
    page,
    context,
  }) => {
    await controlledByServiceWorker(page);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Gurchon Hall" })).toBeVisible();

    const schema = await page.evaluate(
      () =>
        new Promise<{
          version: number;
          stores: Record<string, { keyPath: unknown; indexes: Record<string, boolean> }>;
        }>((resolve, reject) => {
          // Dexie ouvre la base à la première lecture (reprise de la file au démarrage) :
          // on attend qu'elle existe plutôt que de la créer nous-mêmes.
          const started = Date.now();
          const tryOpen = async () => {
            const names = (await indexedDB.databases()).map((database) => database.name);
            if (!names.includes("gurchon-hall-offline")) {
              if (Date.now() - started > 10_000) return reject(new Error("base absente"));
              return setTimeout(tryOpen, 100);
            }
            const request = indexedDB.open("gurchon-hall-offline");
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const stores: Record<string, { keyPath: unknown; indexes: Record<string, boolean> }> = {};
              const tx = db.transaction([...db.objectStoreNames], "readonly");
              for (const name of db.objectStoreNames) {
                const store = tx.objectStore(name);
                stores[name] = {
                  keyPath: store.keyPath,
                  indexes: Object.fromEntries(
                    [...store.indexNames].map((index) => [index, store.index(index).unique]),
                  ),
                };
              }
              // Dexie multiplie la version par 10 : la version 2 du schéma est 20 côté IndexedDB.
              const version = db.version;
              db.close();
              resolve({ version, stores });
            };
          };
          void tryOpen();
        }),
    );

    expect(schema.version).toBe(20);
    expect(Object.keys(schema.stores).sort()).toEqual(
      ["cards", "deckCards", "decks", "languages", "meta", "outbox", "refs", "settled", "stock"].sort(),
    );
    expect(schema.stores.outbox.keyPath).toBe("operationId");
    expect(schema.stores.outbox.indexes.rank).toBe(true); // rang unique : l'ordre de la file
    expect(schema.stores.refs.keyPath).toBe("ref");
    expect(schema.stores.settled.keyPath).toBe("seq"); // opérations tranchées, clé auto-incrémentée
    expect(schema.stores.stock.keyPath).toEqual(["cardId", "languageCode"]);

    await context.setOffline(false);
  });
});
